import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  BUILTIN_AGENT_SKILLS,
  type AgentSkill,
  type AgentSkillSourceType,
  type AgentSkillWorkspace,
  type SkillReferenceRole,
} from "@/lib/creative-skills";

const SKILL_COLUMNS = [
  "id", "owner_user_id", "scope", "name", "description", "planner_summary", "instructions",
  "enabled", "keywords", "workspaces", "action", "requires_reference", "default_config",
  "reference_roles", "source_type", "source_url", "source_repository", "source_path",
  "source_version", "source_commit", "source_content_hash", "license", "current_version",
].join(",");

const TABLE_UNAVAILABLE = /creative_agent_skills|schema cache|does not exist|could not find/i;

export type SkillRunMode = "quick" | "professional";
export type SkillRoleAssetIds = Record<string, string[]>;

export type CreativeSkillSnapshot = AgentSkill & {
  schemaVersion: 1;
  resolvedVersion: number;
  contentHash: string;
  selectedRunMode: SkillRunMode;
  referenceRoleAssetIds: SkillRoleAssetIds;
};

export type ResolvedCreativeSkillRun = {
  skills: AgentSkill[];
  snapshots: CreativeSkillSnapshot[];
  effectivePrompt: string;
  generationPreferences: Record<string, unknown>;
};

export class CreativeSkillError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "CreativeSkillError";
    this.status = status;
  }
}

export async function listCreativeSkills(
  client: SupabaseClient,
  input: { userId: string; workspace?: AgentSkillWorkspace | "all"; includeDisabledOwn?: boolean },
) {
  const workspace = input.workspace || "all";
  const { data, error } = await client
    .from("creative_agent_skills")
    .select(SKILL_COLUMNS)
    .or(`scope.eq.system,owner_user_id.eq.${input.userId}`)
    .order("updated_at", { ascending: false });

  if (!error) {
    return (data || [])
      .map(normalizeSkillRow)
      .filter((skill): skill is AgentSkill => Boolean(skill))
      .filter((skill) => (skill.enabled !== false || (input.includeDisabledOwn && skill.scope === "user")))
      .filter((skill) => workspace === "all" || skill.capabilities.includes(workspace));
  }
  if (!TABLE_UNAVAILABLE.test(error.message)) throw new CreativeSkillError("Skill 加载失败", 500);
  return listLegacySkills(client, input.userId, workspace);
}

export async function listSystemCreativeSkills(client: SupabaseClient) {
  const { data, error } = await client
    .from("creative_agent_skills")
    .select(SKILL_COLUMNS)
    .eq("scope", "system")
    .order("updated_at", { ascending: false });
  if (error) {
    if (TABLE_UNAVAILABLE.test(error.message)) return BUILTIN_AGENT_SKILLS;
    throw new CreativeSkillError("系统 Skill 加载失败", 500);
  }
  return (data || []).map(normalizeSkillRow).filter((skill): skill is AgentSkill => Boolean(skill));
}

export async function resolveCreativeSkillRun(
  client: SupabaseClient,
  input: {
    userId: string;
    selectedSkillIds: string[];
    surface: "agent" | "canvas";
    mode: "agent" | "image" | "video" | "audio";
    intent: string;
    generationPreferences: Record<string, unknown>;
    roleAssetIds: SkillRoleAssetIds;
    runMode: SkillRunMode;
  },
): Promise<ResolvedCreativeSkillRun> {
  const ids = uniqueSkillIds(input.selectedSkillIds);
  if (!ids.length) return { skills: [], snapshots: [], effectivePrompt: input.intent, generationPreferences: input.generationPreferences };
  const workspace: AgentSkillWorkspace = input.surface === "canvas" ? "canvas" : input.mode === "video" ? "video" : "image";
  // Disabled Skills remain visible to their owner for management, but they must
  // never enter a run snapshot or influence generation through a forged API call.
  const available = await listCreativeSkills(client, { userId: input.userId, workspace, includeDisabledOwn: false });
  const map = new Map(available.map((skill) => [skill.id, skill]));
  const skills = ids.map((id) => map.get(id)).filter((skill): skill is AgentSkill => Boolean(skill));
  if (skills.length !== ids.length) throw new CreativeSkillError("部分所选 Skill 不存在、未启用或不适用于当前创作入口");
  for (const skill of skills) validateSkillReferences(skill, input.roleAssetIds);
  const generationPreferences = mergeSkillDefaults(input.generationPreferences, skills);
  const snapshots = skills.map((skill) => snapshotSkill(skill, input.runMode, input.roleAssetIds));
  return {
    skills,
    snapshots,
    generationPreferences,
    effectivePrompt: buildSkillExecutionPrompt(input.intent, snapshots),
  };
}

export async function saveUserCreativeSkill(
  client: SupabaseClient,
  input: { userId: string; value: unknown },
) {
  const skill = normalizeSkillInput(input.value, { userId: input.userId });
  const { data: existing, error: existingError } = await client
    .from("creative_agent_skills")
    .select("id,current_version,owner_user_id")
    .eq("id", skill.id)
    .maybeSingle();
  if (existingError && !TABLE_UNAVAILABLE.test(existingError.message)) throw new CreativeSkillError("Skill 版本读取失败", 500);
  if (existing && existing.owner_user_id !== input.userId) throw new CreativeSkillError("无权修改该 Skill", 403);
  const version = Math.max(1, Number(existing?.current_version || 0) + (existing ? 1 : 0));
  const snapshot = { ...skill, currentVersion: version };
  const contentHash = hashSkill(snapshot);
  const row = skillToRow(snapshot, input.userId, version, contentHash);
  const { error } = await client.from("creative_agent_skills").upsert(row, { onConflict: "id" });
  if (error) {
    if (TABLE_UNAVAILABLE.test(error.message)) throw new CreativeSkillError("Skill 运行时数据库迁移尚未应用", 503);
    throw new CreativeSkillError("Skill 保存失败", 500);
  }
  const { error: versionError } = await client.from("creative_agent_skill_versions").insert({
    skill_id: skill.id,
    version,
    status: "published",
    snapshot: snapshotForStorage(snapshot, contentHash),
    content_hash: contentHash,
    created_by: input.userId,
    published_at: new Date().toISOString(),
  });
  if (versionError) throw new CreativeSkillError("Skill 已保存，但版本快照创建失败", 500);
  return { ...snapshot, sourceContentHash: contentHash, userCreated: true };
}

export async function saveSystemCreativeSkill(
  client: SupabaseClient,
  input: { actorUserId: string; value: unknown },
) {
  const body = asRecord(input.value);
  const requestedId = cleanId(body.id || `system:${crypto.randomUUID()}`);
  const { data: existing, error: existingError } = await client
    .from("creative_agent_skills")
    .select(SKILL_COLUMNS)
    .eq("id", requestedId)
    .eq("scope", "system")
    .maybeSingle();
  if (existingError) {
    if (TABLE_UNAVAILABLE.test(existingError.message)) throw new CreativeSkillError("Skill 运行时数据库迁移尚未应用", 503);
    throw new CreativeSkillError("系统 Skill 版本读取失败", 500);
  }
  const current = existing ? normalizeSkillRow(existing) : null;
  const normalizedUserShape = normalizeSkillInput({
    ...(current || {}),
    ...body,
    id: `custom:${crypto.randomUUID()}`,
  }, { userId: input.actorUserId });
  const version = Math.max(1, Number(current?.currentVersion || 0) + (current ? 1 : 0));
  const snapshot: AgentSkill = {
    ...normalizedUserShape,
    id: requestedId,
    scope: "system",
    sourceType: body.sourceType === "github" ? "github" : current?.sourceType || "local",
    userCreated: false,
    currentVersion: version,
  };
  const contentHash = hashSkill(snapshot);
  const row = {
    ...skillToRow(snapshot, input.actorUserId, version, contentHash),
    owner_user_id: null,
    scope: "system",
    created_by: input.actorUserId,
  };
  const { error } = await client.from("creative_agent_skills").upsert(row, { onConflict: "id" });
  if (error) throw new CreativeSkillError("系统 Skill 保存失败", 500);
  const { error: versionError } = await client.from("creative_agent_skill_versions").insert({
    skill_id: requestedId,
    version,
    status: snapshot.enabled === false ? "disabled" : "published",
    snapshot: snapshotForStorage(snapshot, contentHash),
    content_hash: contentHash,
    created_by: input.actorUserId,
    published_at: new Date().toISOString(),
  });
  if (versionError) throw new CreativeSkillError("系统 Skill 已保存，但版本快照创建失败", 500);
  return { ...snapshot, sourceContentHash: contentHash };
}

export async function deleteUserCreativeSkill(client: SupabaseClient, input: { userId: string; skillId: string }) {
  const id = cleanId(input.skillId);
  const { data, error } = await client
    .from("creative_agent_skills")
    .delete()
    .eq("id", id)
    .eq("owner_user_id", input.userId)
    .eq("scope", "user")
    .select("id")
    .maybeSingle();
  if (error) throw new CreativeSkillError("Skill 删除失败", 500);
  if (!data) throw new CreativeSkillError("Skill 不存在或无权删除", 404);
}

export async function getCreativeRunExecutionContext(
  client: SupabaseClient,
  input: { userId: string; runId: string; fallbackPrompt: string },
) {
  let { data, error } = await client
    .from("creative_runs")
    .select("id,status,intent,input_payload,skill_snapshot,selected_skill_ids")
    .eq("id", input.runId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (error && /skill_snapshot|selected_skill_ids|schema cache|column/i.test(error.message)) {
    const fallback = await client.from("creative_runs").select("id,status,intent,input_payload").eq("id", input.runId).eq("user_id", input.userId).maybeSingle();
    data = fallback.data as typeof data;
    error = fallback.error;
  }
  if (error || !data) throw new CreativeSkillError("创作任务不存在或无权访问", 404);
  const payload = asRecord(data.input_payload);
  const rawSnapshots = Array.isArray(data.skill_snapshot) ? data.skill_snapshot : Array.isArray(payload.skillSnapshot) ? payload.skillSnapshot : [];
  const snapshots = rawSnapshots.map(normalizeSnapshot).filter((item): item is CreativeSkillSnapshot => Boolean(item));
  return {
    prompt: snapshots.length ? buildSkillExecutionPrompt(text(data.intent, 4_000) || input.fallbackPrompt, snapshots) : input.fallbackPrompt,
    generationPreferences: asRecord(payload.generationPreferences),
    snapshots,
  };
}

export function normalizeSkillInput(value: unknown, options: { userId: string; imported?: Partial<AgentSkill> }): AgentSkill {
  const body: Record<string, unknown> = { ...asRecord(value), ...((options.imported || {}) as Record<string, unknown>) };
  const id = cleanId(body.id || `custom:${crypto.randomUUID()}`);
  if (!id.startsWith("custom:") && !id.startsWith("github-")) throw new CreativeSkillError("用户 Skill ID 无效");
  const name = text(body.name, 120);
  const instructions = text(body.instructions, 24_000);
  if (!name || !instructions) throw new CreativeSkillError("Skill 名称和执行规则不能为空");
  const referenceRoles = withDefaultReferenceRole(normalizeReferenceRoles(body.referenceRoles), body.requiresReference === true);
  return {
    id,
    name,
    description: text(body.description, 1_000),
    plannerSummary: text(body.plannerSummary, 2_000) || text(body.description, 1_000) || instructions.slice(0, 500),
    instructions,
    enabled: body.enabled !== false,
    keywords: stringArray(body.keywords, 30, 60),
    capabilities: normalizeWorkspaces(body.capabilities ?? body.workspaces),
    action: body.action === "edit" ? "edit" : "generate",
    requiresReference: body.requiresReference === true || referenceRoles.some((role) => role.required),
    defaultConfig: primitiveRecord(body.defaultConfig),
    referenceRoles,
    scope: "user",
    sourceType: normalizeSourceType(body.sourceType),
    sourceUrl: optionalText(body.sourceUrl, 2_000),
    sourceRepository: optionalText(body.sourceRepository, 300),
    sourcePath: optionalText(body.sourcePath, 1_000),
    sourceVersion: optionalText(body.sourceVersion, 120),
    sourceCommit: optionalText(body.sourceCommit, 80),
    sourceContentHash: optionalHash(body.sourceContentHash),
    license: optionalText(body.license, 120),
    userCreated: true,
  };
}

function validateSkillReferences(skill: AgentSkill, roleAssetIds: SkillRoleAssetIds) {
  const roles = skill.referenceRoles || [];
  const total = Object.values(roleAssetIds).reduce((count, ids) => count + ids.length, 0);
  if (skill.requiresReference && !total) throw new CreativeSkillError(`Skill「${skill.name}」需要参考素材`);
  for (const role of roles) {
    const ids = roleAssetIds[role.id] || [];
    if (role.required && !ids.length) throw new CreativeSkillError(`Skill「${skill.name}」缺少必填素材：${role.label}`);
    if (ids.length > role.maxCount) throw new CreativeSkillError(`${role.label}最多选择 ${role.maxCount} 项素材`);
  }
  const known = new Set(roles.map((role) => role.id));
  for (const [roleId, ids] of Object.entries(roleAssetIds)) {
    if (!known.has(roleId) && ids.length) throw new CreativeSkillError(`Skill 素材角色无效：${roleId}`);
  }
}

function mergeSkillDefaults(preferences: Record<string, unknown>, skills: AgentSkill[]) {
  const merged = structuredClone(preferences);
  const image = asRecord(merged.image);
  const video = asRecord(merged.video);
  for (const skill of skills) {
    const defaults = skill.defaultConfig || {};
    if ((image.aspectRatio === undefined || image.aspectRatio === "auto") && typeof defaults.aspectRatio === "string") image.aspectRatio = defaults.aspectRatio;
    if ((image.count === undefined || image.count === 1) && typeof defaults.imageCount === "number") image.count = clamp(defaults.imageCount, 1, 20);
    if ((image.quality === undefined || image.quality === "smart") && typeof defaults.imageQuality === "string") image.quality = defaults.imageQuality;
    if ((video.aspectRatio === undefined || video.aspectRatio === "auto") && typeof defaults.aspectRatio === "string") video.aspectRatio = defaults.aspectRatio;
    if ((video.count === undefined || video.count === 1) && typeof defaults.videoCount === "number") video.count = clamp(defaults.videoCount, 1, 20);
    if ((video.seconds === undefined || video.seconds === 5) && typeof defaults.videoSeconds === "number") video.seconds = clamp(defaults.videoSeconds, 1, 300);
    if ((video.resolution === undefined || video.resolution === "720p") && typeof defaults.videoResolution === "string") video.resolution = defaults.videoResolution;
    if (typeof defaults.generateAudio === "boolean" && video.generateAudio === undefined) video.generateAudio = defaults.generateAudio;
  }
  merged.image = image;
  merged.video = video;
  return merged;
}

function snapshotSkill(skill: AgentSkill, runMode: SkillRunMode, roleAssetIds: SkillRoleAssetIds): CreativeSkillSnapshot {
  const referenceRoleAssetIds = Object.fromEntries((skill.referenceRoles || []).map((role) => [role.id, [...(roleAssetIds[role.id] || [])]]));
  const base = {
    ...skill,
    enabled: true,
    schemaVersion: 1 as const,
    resolvedVersion: skill.currentVersion || 1,
    selectedRunMode: runMode,
    referenceRoleAssetIds,
  };
  return { ...base, contentHash: skill.sourceContentHash || hashSkill(base) };
}

function buildSkillExecutionPrompt(intent: string, snapshots: CreativeSkillSnapshot[]) {
  if (!snapshots.length) return intent;
  const rules = snapshots.map((skill, index) => {
    const roles = (skill.referenceRoles || []).flatMap((role) => {
      const ids = skill.referenceRoleAssetIds[role.id] || [];
      return ids.length ? [`- ${role.label}：${ids.join("、")}`] : [];
    });
    return [
      `Skill ${index + 1}「${skill.name}」· ${skill.selectedRunMode === "professional" ? "专业" : "快速"}模式`,
      `用途摘要：${skill.plannerSummary || skill.description}`,
      skill.instructions,
      ...(roles.length ? ["参考素材角色：", ...roles] : []),
    ].join("\n");
  });
  return `${intent}\n\n执行以下已选 Skill 约束：\n${rules.join("\n\n")}`;
}

function normalizeSkillRow(row: unknown): AgentSkill | null {
  const value = asRecord(row);
  const id = cleanId(value.id, false);
  const name = text(value.name, 120);
  const instructions = text(value.instructions, 24_000);
  if (!id || !name || !instructions) return null;
  return {
    id, name, instructions,
    description: text(value.description, 1_000),
    plannerSummary: text(value.planner_summary, 2_000),
    enabled: value.enabled !== false,
    keywords: stringArray(value.keywords, 30, 60),
    capabilities: normalizeWorkspaces(value.workspaces),
    action: value.action === "edit" ? "edit" : "generate",
    requiresReference: value.requires_reference === true,
    defaultConfig: primitiveRecord(value.default_config),
    referenceRoles: withDefaultReferenceRole(normalizeReferenceRoles(value.reference_roles), value.requires_reference === true),
    scope: value.scope === "system" ? "system" : "user",
    sourceType: normalizeSourceType(value.source_type),
    sourceUrl: optionalText(value.source_url, 2_000),
    sourceRepository: optionalText(value.source_repository, 300),
    sourcePath: optionalText(value.source_path, 1_000),
    sourceVersion: optionalText(value.source_version, 120),
    sourceCommit: optionalText(value.source_commit, 80),
    sourceContentHash: optionalHash(value.source_content_hash),
    license: optionalText(value.license, 120),
    currentVersion: clamp(value.current_version, 1, 1_000_000),
    userCreated: value.scope !== "system",
  };
}

async function listLegacySkills(client: SupabaseClient, userId: string, workspace: AgentSkillWorkspace | "all") {
  const builtins = BUILTIN_AGENT_SKILLS.filter((skill) => workspace === "all" || skill.capabilities.includes(workspace));
  const { data } = await client
    .from("creative_user_skills")
    .select("id,name,description,instructions,keywords,capabilities,action,requires_reference")
    .eq("user_id", userId);
  const custom = (data || []).map((row) => normalizeSkillRow({
    ...row,
    scope: "user",
    enabled: true,
    workspaces: row.capabilities,
    requires_reference: row.requires_reference,
  })).filter((skill): skill is AgentSkill => Boolean(skill));
  return [...builtins, ...custom].filter((skill) => workspace === "all" || skill.capabilities.includes(workspace));
}

function skillToRow(skill: AgentSkill, userId: string, version: number, contentHash: string) {
  return {
    id: skill.id, owner_user_id: userId, scope: "user", name: skill.name,
    description: skill.description, planner_summary: skill.plannerSummary || skill.description,
    instructions: skill.instructions, enabled: skill.enabled !== false, keywords: skill.keywords,
    workspaces: skill.capabilities, action: skill.action, requires_reference: skill.requiresReference,
    default_config: skill.defaultConfig || {}, reference_roles: skill.referenceRoles || [],
    source_type: skill.sourceType || "local", source_url: skill.sourceUrl || null,
    source_repository: skill.sourceRepository || null, source_path: skill.sourcePath || null,
    source_version: skill.sourceVersion || null, source_commit: skill.sourceCommit || null,
    source_content_hash: skill.sourceContentHash || contentHash, license: skill.license || null,
    current_version: version, created_by: userId, updated_at: new Date().toISOString(),
  };
}

function snapshotForStorage(skill: AgentSkill, contentHash: string) {
  return { ...skill, contentHash, schemaVersion: 1 };
}

function normalizeSnapshot(value: unknown): CreativeSkillSnapshot | null {
  const row = asRecord(value);
  const skill = normalizeSkillRow({
    ...row,
    planner_summary: row.plannerSummary,
    workspaces: row.capabilities,
    requires_reference: row.requiresReference,
    default_config: row.defaultConfig,
    reference_roles: row.referenceRoles,
    source_type: row.sourceType,
    source_url: row.sourceUrl,
    source_repository: row.sourceRepository,
    source_path: row.sourcePath,
    source_version: row.sourceVersion,
    source_commit: row.sourceCommit,
    source_content_hash: row.sourceContentHash,
    current_version: row.resolvedVersion,
  });
  if (!skill) return null;
  return {
    ...skill,
    schemaVersion: 1,
    resolvedVersion: clamp(row.resolvedVersion, 1, 1_000_000),
    contentHash: optionalHash(row.contentHash) || hashSkill(skill),
    selectedRunMode: row.selectedRunMode === "professional" ? "professional" : "quick",
    referenceRoleAssetIds: normalizeRoleAssetIds(row.referenceRoleAssetIds),
  };
}

function normalizeReferenceRoles(value: unknown): SkillReferenceRole[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((item) => {
    const row = asRecord(item);
    const id = cleanRoleId(row.id);
    const label = text(row.label, 80);
    if (!id || !label) return [];
    const mediaTypes = stringArray(row.mediaTypes, 2, 10).filter((type): type is "image" | "video" => type === "image" || type === "video");
    const modes = stringArray(row.modes, 2, 20).filter((mode): mode is "quick" | "professional" => mode === "quick" || mode === "professional");
    return [{ id, label, required: row.required === true, maxCount: clamp(row.maxCount, 1, 10), description: optionalText(row.description, 300), ...(mediaTypes.length ? { mediaTypes } : {}), ...(modes.length ? { modes } : {}) }];
  });
}

function withDefaultReferenceRole(roles: SkillReferenceRole[], required: boolean) {
  return roles.length || !required
    ? roles
    : [{ id: "reference", label: "参考素材", required: true, maxCount: 10, description: "执行该 Skill 所需素材", mediaTypes: ["image"] } satisfies SkillReferenceRole];
}

function normalizeRoleAssetIds(value: unknown): SkillRoleAssetIds {
  return Object.fromEntries(Object.entries(asRecord(value)).flatMap(([key, item]) => {
    const id = cleanRoleId(key);
    return id ? [[id, stringArray(item, 10, 500)]] : [];
  }));
}

function normalizeWorkspaces(value: unknown): AgentSkillWorkspace[] {
  const parsed = stringArray(value, 3, 20).filter((item): item is AgentSkillWorkspace => item === "image" || item === "video" || item === "canvas");
  return parsed.length ? [...new Set(parsed)] : ["image", "canvas"];
}

function normalizeSourceType(value: unknown): AgentSkillSourceType { return value === "github" ? "github" : value === "builtin" ? "builtin" : "local"; }
function primitiveRecord(value: unknown): Record<string, string | number | boolean> { return Object.fromEntries(Object.entries(asRecord(value)).filter((entry): entry is [string, string | number | boolean] => ["string", "number", "boolean"].includes(typeof entry[1]))); }
function uniqueSkillIds(ids: string[]) { const values = [...new Set(ids.map((id) => cleanId(id, false)).filter(Boolean))]; if (values.length > 6) throw new CreativeSkillError("一次最多使用 6 个 Skill"); return values; }
function cleanId(value: unknown, required = true) { const id = text(value, 180); if (!id && !required) return ""; if (!/^[A-Za-z0-9._:-]{1,180}$/.test(id)) throw new CreativeSkillError("Skill ID 无效"); return id; }
function cleanRoleId(value: unknown) { const id = text(value, 80); return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : ""; }
function stringArray(value: unknown, maxItems: number, maxLength: number) { return Array.isArray(value) ? value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim().slice(0, maxLength)] : []).slice(0, maxItems) : []; }
function text(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function optionalText(value: unknown, max: number) { return text(value, max) || undefined; }
function optionalHash(value: unknown) { const hash = text(value, 64).toLowerCase(); return /^[a-f0-9]{64}$/.test(hash) ? hash : undefined; }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function clamp(value: unknown, min: number, max: number) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : min; }
function hashSkill(value: unknown) { return createHash("sha256").update(stableStringify(value)).digest("hex"); }
function stableStringify(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`; return JSON.stringify(value); }
