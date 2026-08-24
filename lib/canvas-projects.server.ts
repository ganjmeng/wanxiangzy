import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EMPTY_CANVAS_DOCUMENT,
  normalizeCanvasDocument,
  normalizeCanvasTitle,
  type CanvasProject,
} from "@/lib/canvas-contract";

const PROJECT_COLUMNS = "id,title,document,cover_url,node_count,revision,created_at,updated_at";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CanvasProjectError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "CanvasProjectError";
    this.status = status;
  }
}

export async function listCanvasProjects(client: SupabaseClient, userId: string) {
  const { data, error } = await client
    .from("creative_canvas_projects")
    .select(PROJECT_COLUMNS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(60);
  if (error) throw databaseError(error.message);
  return (Array.isArray(data) ? data : []).map(canvasProjectRowToClient);
}

export async function getCanvasProject(client: SupabaseClient, userId: string, projectId: string) {
  const id = requireProjectId(projectId);
  const { data, error } = await client
    .from("creative_canvas_projects")
    .select(PROJECT_COLUMNS)
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw databaseError(error.message);
  if (!data) throw new CanvasProjectError("画布不存在或无权访问", 404);
  return canvasProjectRowToClient(data);
}

export async function createCanvasProject(client: SupabaseClient, userId: string, input: unknown) {
  const body = asRecord(input);
  const title = normalizeCanvasTitle(body.title || "未命名画布");
  const document = body.document ? normalizeCanvasDocument(body.document) : EMPTY_CANVAS_DOCUMENT;
  const { data, error } = await client
    .from("creative_canvas_projects")
    .insert({
      user_id: userId,
      title,
      document,
      node_count: document.nodes.length,
    })
    .select(PROJECT_COLUMNS)
    .single();
  if (error) throw databaseError(error.message);
  return canvasProjectRowToClient(data);
}

export async function updateCanvasProject(
  client: SupabaseClient,
  userId: string,
  projectId: string,
  input: unknown,
) {
  const id = requireProjectId(projectId);
  const body = asRecord(input);
  const revision = Number(body.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new CanvasProjectError("画布版本无效", 400);
  const patch: Record<string, unknown> = {
    revision: revision + 1,
    updated_at: new Date().toISOString(),
  };
  if (Object.prototype.hasOwnProperty.call(body, "title")) patch.title = normalizeCanvasTitle(body.title);
  if (Object.prototype.hasOwnProperty.call(body, "document")) {
    const document = normalizeCanvasDocument(body.document);
    patch.document = document;
    patch.node_count = document.nodes.length;
    patch.cover_url = document.nodes.find((node) => node.type === "image")?.content || null;
  }
  if (Object.keys(patch).length === 2) throw new CanvasProjectError("没有可保存的画布内容", 400);

  const { data, error } = await client
    .from("creative_canvas_projects")
    .update(patch)
    .eq("user_id", userId)
    .eq("id", id)
    .eq("revision", revision)
    .select(PROJECT_COLUMNS)
    .maybeSingle();
  if (error) throw databaseError(error.message);
  if (!data) throw new CanvasProjectError("画布已在其他页面更新，请刷新后继续", 409);
  return canvasProjectRowToClient(data);
}

export async function deleteCanvasProject(client: SupabaseClient, userId: string, projectId: string) {
  const id = requireProjectId(projectId);
  const { error } = await client
    .from("creative_canvas_projects")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw databaseError(error.message);
}

function canvasProjectRowToClient(value: unknown): CanvasProject {
  const row = asRecord(value);
  return {
    id: String(row.id || ""),
    title: String(row.title || "未命名画布"),
    document: normalizeCanvasDocument(row.document || EMPTY_CANVAS_DOCUMENT),
    coverUrl: typeof row.cover_url === "string" ? row.cover_url : null,
    nodeCount: Number(row.node_count) || 0,
    revision: Number(row.revision) || 1,
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

function requireProjectId(value: string) {
  if (!UUID_PATTERN.test(value)) throw new CanvasProjectError("画布 ID 无效", 400);
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function databaseError(message: string) {
  return new CanvasProjectError(`画布数据访问失败: ${message}`);
}
