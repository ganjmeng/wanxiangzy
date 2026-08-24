import "server-only";

import { createHash } from "node:crypto";
import { parseDocument } from "yaml";

import type { AgentSkill, AgentSkillWorkspace, SkillReferenceRole } from "@/lib/creative-skills";
import {
  GithubCreativeSkillImportError,
  parseGithubLocation,
  type GithubCreativeSkillLocation,
} from "@/lib/github-creative-skill-url";

export { GithubCreativeSkillImportError, parseGithubLocation } from "@/lib/github-creative-skill-url";

const GITHUB_API = "https://api.github.com";
const RAW_GITHUB = "https://raw.githubusercontent.com";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_MARKDOWN_LENGTH = 256_000;
const MAX_TREE_LENGTH = 4_000_000;
const MAX_CANDIDATES = 20;

export type CreativeSkillImportCandidate = { path: string; name: string };
export type CreativeSkillImportResult = { repository: string; ref: string; candidates: CreativeSkillImportCandidate[]; skill?: AgentSkill };

export async function importCreativeSkillFromGithub(input: { url: string; path?: string }): Promise<CreativeSkillImportResult> {
  const location = parseGithubLocation(input.url);
  const repository = await githubJson<{ default_branch?: string; license?: { spdx_id?: string | null } | null }>(`/repos/${location.owner}/${location.repository}`);
  const requestedRef = location.ref || repository.default_branch || "main";
  const ref = await resolveCommit(location, requestedRef);
  const scope = location.path && location.mode !== "blob" ? trimPath(location.path) : "";
  if (location.mode === "blob") {
    const sourcePath = requireSkillPath(location.path);
    return { repository: `${location.owner}/${location.repository}`, ref, candidates: [], skill: await readSkill(location, ref, sourcePath, repository.license?.spdx_id || undefined) };
  }
  const requestedPath = input.path ? trimPath(input.path) : undefined;
  if (requestedPath) {
    if (!isSkillPath(requestedPath) || (scope && requestedPath !== scope && !requestedPath.startsWith(`${scope}/`))) throw new GithubCreativeSkillImportError("所选 Skill 路径不属于当前 GitHub 地址");
    return { repository: `${location.owner}/${location.repository}`, ref, candidates: [], skill: await readSkill(location, ref, requestedPath, repository.license?.spdx_id || undefined) };
  }
  const entries = await githubJson<{ tree?: Array<{ path?: string; type?: string }>; truncated?: boolean }>(`/repos/${location.owner}/${location.repository}/git/trees/${encodeURIComponent(ref)}?recursive=1`, MAX_TREE_LENGTH);
  const candidates = (entries.tree || [])
    .filter((entry) => entry.type === "blob" && typeof entry.path === "string" && isSkillPath(entry.path))
    .map((entry) => ({ path: trimPath(entry.path as string), name: skillNameFromPath(entry.path as string) }))
    .filter((entry) => !scope || entry.path === scope || entry.path.startsWith(`${scope}/`))
    .slice(0, MAX_CANDIDATES);
  if (!candidates.length) throw new GithubCreativeSkillImportError("这个公开仓库或目录中没有找到 SKILL.md");
  if (candidates.length > 1) return { repository: `${location.owner}/${location.repository}`, ref, candidates };
  return { repository: `${location.owner}/${location.repository}`, ref, candidates: [], skill: await readSkill(location, ref, candidates[0].path, repository.license?.spdx_id || undefined) };
}

async function readSkill(location: GithubCreativeSkillLocation, ref: string, sourcePath: string, repositoryLicense?: string): Promise<AgentSkill> {
  const markdown = await githubText(`${RAW_GITHUB}/${location.owner}/${location.repository}/${encodePath(ref)}/${encodePath(sourcePath)}`, MAX_MARKDOWN_LENGTH);
  const normalized = markdown.replace(/^\uFEFF/, "").trim();
  const frontmatter = normalized.startsWith("---") ? readFrontmatter(normalized) : { values: {} as Record<string, unknown>, body: normalized };
  const metadata = asRecord(frontmatter.values.metadata);
  const name = firstText(frontmatter.values.name, metadata.name) || headingName(frontmatter.body) || skillNameFromPath(sourcePath);
  const description = firstText(frontmatter.values.description, metadata.description) || firstParagraph(frontmatter.body) || `来自 ${location.owner}/${location.repository} 的 Agent Skill`;
  const instructions = frontmatter.body.trim();
  if (instructions.length < 10) throw new GithubCreativeSkillImportError("SKILL.md 内容过短，无法作为执行规则");
  const workspaces = parseWorkspaces(frontmatter.values.workspaces ?? metadata.workspaces);
  const referenceRoles = parseReferenceRoles(frontmatter.values.referenceRoles ?? metadata.referenceRoles);
  const sourceUrl = `https://github.com/${location.owner}/${location.repository}/blob/${encodePath(ref)}/${encodePath(sourcePath)}`;
  return {
    id: `github-${location.owner}-${location.repository}-${sourcePath.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}`.slice(0, 180),
    name: name.slice(0, 120), description: description.slice(0, 1_000), plannerSummary: description.slice(0, 2_000),
    instructions: instructions.slice(0, 24_000), enabled: false, keywords: parseKeywords(frontmatter.values.keywords ?? metadata.keywords).slice(0, 30),
    capabilities: workspaces, action: firstText(frontmatter.values.action, metadata.action) === "edit" ? "edit" : "generate",
    requiresReference: Boolean(frontmatter.values.requiresReference ?? metadata.requiresReference) || referenceRoles.some((role) => role.required),
    defaultConfig: parseDefaultConfig(frontmatter.values.defaultConfig ?? metadata.defaultConfig), referenceRoles,
    scope: "user", sourceType: "github", sourceUrl, sourceRepository: `${location.owner}/${location.repository}`,
    sourcePath, sourceVersion: ref, sourceCommit: ref, sourceContentHash: createHash("sha256").update(markdown, "utf8").digest("hex"),
    license: firstText(frontmatter.values.license, metadata.license, repositoryLicense)?.slice(0, 120), userCreated: true,
  };
}

async function resolveCommit(location: GithubCreativeSkillLocation, ref: string) {
  const commit = await githubJson<{ sha?: string }>(`/repos/${location.owner}/${location.repository}/commits/${encodeURIComponent(ref)}`);
  const sha = commit.sha?.trim().toLowerCase() || "";
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new GithubCreativeSkillImportError("GitHub 没有返回可固定的 commit，无法安全导入", 502);
  return sha;
}

async function githubJson<T>(path: string, maxLength = 500_000): Promise<T> { return JSON.parse(await githubText(`${GITHUB_API}${path}`, maxLength)) as T; }
async function githubText(url: string, maxLength: number) {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "Pixel-Diffusion-agent-skill-import" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: "error", cache: "no-store" });
  } catch { throw new GithubCreativeSkillImportError("GitHub 地址暂时无法访问，请稍后重试", 502); }
  if (!response.ok) {
    if (response.status === 404) throw new GithubCreativeSkillImportError("未找到公开仓库或 SKILL.md", 404);
    if (response.status === 403 || response.status === 429) throw new GithubCreativeSkillImportError("GitHub 暂时限制了请求，请稍后重试", 429);
    throw new GithubCreativeSkillImportError(`GitHub 返回了 ${response.status}，暂时无法提取 Skill`, 502);
  }
  const length = Number(response.headers.get("content-length") || 0);
  if (length > maxLength) throw new GithubCreativeSkillImportError("GitHub 文件过大，无法导入");
  const text = await response.text();
  if (text.length > maxLength) throw new GithubCreativeSkillImportError("GitHub 文件过大，无法导入");
  return text;
}

function readFrontmatter(markdown: string) {
  const end = markdown.indexOf("\n---", 3);
  if (end < 0) return { values: {} as Record<string, unknown>, body: markdown };
  try {
    const values = parseDocument(markdown.slice(3, end).trim()).toJS() as unknown;
    return { values: asRecord(values), body: markdown.slice(end + 4).replace(/^\r?\n/, "") };
  } catch { throw new GithubCreativeSkillImportError("SKILL.md 的 YAML 头信息无法解析"); }
}

function parseReferenceRoles(value: unknown): SkillReferenceRole[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((item) => {
    const row = asRecord(item); const id = text(row.id, 80); const label = text(row.label, 80);
    if (!/^[A-Za-z0-9_-]+$/.test(id) || !label) return [];
    const mediaTypes = array(row.mediaTypes).filter((type): type is "image" | "video" => type === "image" || type === "video");
    return [{ id, label, required: row.required === true, maxCount: Math.min(10, Math.max(1, Number(row.maxCount) || 1)), description: text(row.description, 300) || undefined, ...(mediaTypes.length ? { mediaTypes } : {}) }];
  });
}
function parseWorkspaces(value: unknown): AgentSkillWorkspace[] { const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[、,，\s]+/) : []; const parsed = values.filter((item): item is AgentSkillWorkspace => item === "image" || item === "video" || item === "canvas"); return parsed.length ? [...new Set(parsed)] : ["image"]; }
function parseKeywords(value: unknown) { return (Array.isArray(value) ? value : typeof value === "string" ? value.split(/[、,，\n]/) : []).filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean); }
function parseDefaultConfig(value: unknown): Record<string, string | number | boolean> { return Object.fromEntries(Object.entries(asRecord(value)).filter((entry): entry is [string, string | number | boolean] => ["string", "number", "boolean"].includes(typeof entry[1]))); }
function parseGithubPath(value: string) { return value.replace(/^\/+|\/+$/g, ""); }
function trimPath(value: string) { const path = parseGithubPath(value); if (!path || path.split("/").some((part) => part === "." || part === "..")) throw new GithubCreativeSkillImportError("GitHub 路径无效"); return path; }
function requireSkillPath(path: string | undefined) { const value = trimPath(path || ""); if (!isSkillPath(value)) throw new GithubCreativeSkillImportError("地址必须指向 SKILL.md"); return value; }
function encodePath(value: string) { return value.split("/").map(encodeURIComponent).join("/"); }
function isSkillPath(value: string) { return value.split("/").at(-1)?.toLowerCase() === "skill.md"; }
function skillNameFromPath(path: string) { const name = path.split("/").at(-2) || path.split("/").at(-1) || "GitHub Skill"; return name.replace(/[-_]+/g, " ").replace(/\b\w/g, (item) => item.toUpperCase()); }
function headingName(body: string) { return body.match(/^#\s+(.+)$/m)?.[1]?.trim(); }
function firstParagraph(body: string) { return body.replace(/^#.*$/gm, "").split(/\n\s*\n/).map((item) => item.replace(/[`*_>#-]/g, "").trim()).find(Boolean); }
function firstText(...values: unknown[]) { return values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim(); }
function text(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function array(value: unknown) { return Array.isArray(value) ? value : []; }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
