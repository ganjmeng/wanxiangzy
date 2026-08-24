import type { SupabaseClient } from "@supabase/supabase-js";
import { createCreativeRun } from "@/lib/api/creative-runtime";
import { resolveCreativeSkillRun } from "@/lib/creative-skills.server";

export type CreativeRunClient = {
  id: string;
  status: string;
  intent: string;
  summary: string;
  surface: string;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  errorMessage: string | null;
  steps: Array<{
    id: string;
    status: string;
    title: string;
    generationId: string | null;
    resultUrls: string[];
    errorMessage: string | null;
  }>;
};

export class CreativeRunError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "CreativeRunError";
    this.status = status;
  }
}

export async function createUserCreativeRun(
  client: SupabaseClient,
  input: { userId: string; body: unknown },
) {
  const body = asRecord(input.body);
  const intent = typeof body.intent === "string" ? body.intent.trim() : "";
  if (!intent || intent.length > 4_000) throw new CreativeRunError("创作需求需为 1-4000 个字符", 400);
  const surface = body.surface === "canvas" ? "canvas" : "agent";
  const projectId = optionalUuid(body.projectId, "画布项目 ID");
  if (surface === "canvas" && !projectId) throw new CreativeRunError("画布任务缺少项目 ID", 400);
  if (surface === "canvas" && projectId) {
    const { data: project, error: projectError } = await client
      .from("creative_canvas_projects")
      .select("id")
      .eq("id", projectId)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (projectError) throw databaseError(projectError.message);
    if (!project) throw new CreativeRunError("画布项目不存在或无权访问", 404);
  }
  const clientRequestId = typeof body.clientRequestId === "string" ? body.clientRequestId.trim().slice(0, 160) : undefined;
  const mode = body.mode === "video" ? "video" : body.mode === "image" ? "image" : body.mode === "audio" ? "audio" : "agent";
  const generationPreferences = asRecord(body.generationPreferences);
  const selectedSkillIds = stringArray(body.selectedSkillIds).slice(0, 6).map((value) => value.slice(0, 160));
  const skillRunMode = body.skillRunMode === "professional" ? "professional" as const : "quick" as const;
  const skillReferenceRoleAssetIds = sanitizeRoleAssetIds(asRecord(body.skillReferenceRoleAssetIds));
  const skillExecution = await resolveCreativeSkillRun(client, {
    userId: input.userId,
    selectedSkillIds,
    surface,
    mode,
    intent,
    generationPreferences,
    roleAssetIds: skillReferenceRoleAssetIds,
    runMode: skillRunMode,
  });
  const runId = await createCreativeRun(client, {
    userId: input.userId,
    intent,
    summary: intent.slice(0, 120),
    surface,
    projectId: surface === "canvas" ? projectId || undefined : undefined,
    clientRequestId,
    inputPayload: {
      mode,
      aspectRatio: typeof body.aspectRatio === "string" ? body.aspectRatio.slice(0, 20) : "auto",
      imageSize: typeof body.imageSize === "string" ? body.imageSize.slice(0, 20) : "1K",
      selectedModelIds: stringArray(body.selectedModelIds).slice(0, 6).map((value) => value.slice(0, 120)),
      selectedSkillIds,
      skillRunMode,
      skillReferenceRoleAssetIds,
      generationPreferences: sanitizePreferences(skillExecution.generationPreferences),
      skillSnapshot: skillExecution.snapshots,
      source: "vozeb-migration",
    },
  });
  const { error: snapshotError } = await client
    .from("creative_runs")
    .update({ selected_skill_ids: selectedSkillIds, skill_snapshot: skillExecution.snapshots, skill_schema_version: 1 })
    .eq("id", runId)
    .eq("user_id", input.userId);
  if (snapshotError && !/selected_skill_ids|skill_snapshot|schema cache|does not exist/i.test(snapshotError.message)) {
    throw new CreativeRunError("Skill 执行快照保存失败", 500);
  }
  if (skillExecution.snapshots.length) {
    await client.from("creative_run_events").insert({
      run_id: runId,
      user_id: input.userId,
      event_type: "skills.selected",
      message: "已固定本次创作使用的 Skill 版本",
      metadata: {
        schemaVersion: 1,
        runMode: skillRunMode,
        skills: skillExecution.snapshots.map((skill) => ({
          id: skill.id,
          name: skill.name,
          version: skill.resolvedVersion,
          plannerSummary: skill.plannerSummary || skill.description,
          contentHash: skill.contentHash,
        })),
      },
    });
  }
  return {
    id: runId,
    status: "draft" as const,
    execution: {
      generationPreferences: sanitizePreferences(skillExecution.generationPreferences),
      skills: skillExecution.skills.map((skill) => ({ id: skill.id, name: skill.name, version: skill.currentVersion || 1 })),
    },
  };
}

export async function listUserCreativeRuns(client: SupabaseClient, userId: string, limit = 20) {
  const pageSize = Math.min(50, Math.max(1, Math.floor(limit)));
  const { data: runs, error: runError } = await client
    .from("creative_runs")
    .select("id,status,intent,summary,surface,project_id,error_message,created_at,updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(pageSize);
  if (runError) throw databaseError(runError.message);
  const runRows = Array.isArray(runs) ? runs : [];
  const runIds = runRows.map((row) => String(row.id));
  if (!runIds.length) return [] as CreativeRunClient[];

  const { data: steps, error: stepError } = await client
    .from("creative_run_steps")
    .select("id,run_id,status,title,generation_id,error_message,created_at")
    .eq("user_id", userId)
    .in("run_id", runIds)
    .order("created_at", { ascending: true });
  if (stepError) throw databaseError(stepError.message);
  const stepRows = Array.isArray(steps) ? steps : [];
  const generationIds = stepRows.flatMap((step) => typeof step.generation_id === "string" ? [step.generation_id] : []);
  const generationMap = new Map<string, { resultUrls: string[]; errorMessage: string | null }>();
  if (generationIds.length) {
    const { data: generations, error: generationError } = await client
      .from("generations")
      .select("id,result_urls,error_message")
      .eq("user_id", userId)
      .in("id", generationIds);
    if (generationError) throw databaseError(generationError.message);
    for (const generation of Array.isArray(generations) ? generations : []) {
      generationMap.set(String(generation.id), {
        resultUrls: stringArray(generation.result_urls),
        errorMessage: typeof generation.error_message === "string" ? generation.error_message : null,
      });
    }
  }

  return runRows.map((run): CreativeRunClient => ({
    id: String(run.id),
    status: String(run.status || "draft"),
    intent: String(run.intent || ""),
    summary: String(run.summary || ""),
    surface: String(run.surface || "agent"),
    projectId: typeof run.project_id === "string" ? run.project_id : null,
    createdAt: String(run.created_at || ""),
    updatedAt: String(run.updated_at || ""),
    errorMessage: typeof run.error_message === "string" ? run.error_message : null,
    steps: stepRows.filter((step) => step.run_id === run.id).map((step) => {
      const generationId = typeof step.generation_id === "string" ? step.generation_id : null;
      const generation = generationId ? generationMap.get(generationId) : undefined;
      return {
        id: String(step.id),
        status: String(step.status || "queued"),
        title: String(step.title || "生成结果"),
        generationId,
        resultUrls: generation?.resultUrls || [],
        errorMessage: generation?.errorMessage || (typeof step.error_message === "string" ? step.error_message : null),
      };
    }),
  }));
}

function optionalUuid(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new CreativeRunError(`${label}无效`, 400);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item)) : [];
}

function sanitizePreferences(value: Record<string, unknown>) {
  const image = asRecord(value.image);
  const video = asRecord(value.video);
  const audio = asRecord(value.audio);
  return {
    image: {
      aspectRatio: shortString(image.aspectRatio, 20),
      imageSize: shortString(image.imageSize, 20),
      quality: shortString(image.quality, 20),
      count: boundedNumber(image.count, 1, 20),
      customWidth: shortString(image.customWidth, 5),
      customHeight: shortString(image.customHeight, 5),
    },
    video: {
      aspectRatio: shortString(video.aspectRatio, 20),
      resolution: shortString(video.resolution, 20),
      count: boundedNumber(video.count, 1, 20),
      seconds: boundedNumber(video.seconds, 1, 300),
      generateAudio: video.generateAudio === true,
      watermark: video.watermark === true,
      referenceMode: shortString(video.referenceMode, 32),
    },
    audio: {
      voice: shortString(audio.voice, 80),
      format: shortString(audio.format, 12),
      speed: boundedNumber(audio.speed, 0.5, 2),
    },
  };
}

function shortString(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function boundedNumber(value: unknown, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
}

function sanitizeRoleAssetIds(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).slice(0, 20).flatMap(([roleId, assetIds]) => {
    if (!/^[A-Za-z0-9._:-]{1,80}$/.test(roleId)) return [];
    return [[roleId, stringArray(assetIds).slice(0, 10).map((assetId) => assetId.slice(0, 180))]];
  }));
}

function databaseError(message: string) {
  return new CreativeRunError(`创作任务访问失败: ${message}`);
}
