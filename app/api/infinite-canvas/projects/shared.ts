import type { SupabaseClient } from "@supabase/supabase-js";

export type CanvasProjectDocument = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  nodes: unknown[];
  connections: unknown[];
  chatSessions: unknown[];
  activeChatId: string | null;
  backgroundMode: string;
  showImageInfo: boolean;
  viewport: { x: number; y: number; k: number };
};

export type CanvasProjectRow = {
  local_id: string;
  title: string;
  document: unknown;
  client_updated_at: string;
  deleted_at: string | null;
  created_at?: string;
  updated_at?: string;
};

export function normalizeProjectDocument(value: unknown, fallbackId: string): CanvasProjectDocument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const now = new Date().toISOString();
  const id = stringValue(record.id) || fallbackId;
  if (!id) return null;
  const createdAt = validDateString(record.createdAt) || now;
  const updatedAt = validDateString(record.updatedAt) || createdAt;
  const viewport = record.viewport && typeof record.viewport === "object" ? (record.viewport as Record<string, unknown>) : {};
  return {
    id,
    title: stringValue(record.title) || "未命名画布",
    createdAt,
    updatedAt,
    nodes: Array.isArray(record.nodes) ? record.nodes : [],
    connections: Array.isArray(record.connections) ? record.connections : [],
    chatSessions: Array.isArray(record.chatSessions) ? record.chatSessions : [],
    activeChatId: typeof record.activeChatId === "string" ? record.activeChatId : null,
    backgroundMode: stringValue(record.backgroundMode) || "lines",
    showImageInfo: record.showImageInfo === true,
    viewport: {
      x: numberValue(viewport.x, 0),
      y: numberValue(viewport.y, 0),
      k: numberValue(viewport.k, 1),
    },
  };
}

export function rowToProject(row: CanvasProjectRow) {
  const project = normalizeProjectDocument(row.document, row.local_id);
  if (!project) return null;
  return {
    ...project,
    id: row.local_id,
    title: row.title || project.title,
    updatedAt: validDateString(project.updatedAt) || row.client_updated_at,
  };
}

export function projectClientUpdatedAt(project: CanvasProjectDocument) {
  return validDateString(project.updatedAt) || validDateString(project.createdAt) || new Date().toISOString();
}

export function isNewerOrEqual(left: string | null | undefined, right: string | null | undefined) {
  return Date.parse(left || "") >= Date.parse(right || "");
}

export function sortProjects<T extends { updatedAt: string; createdAt: string }>(projects: T[]) {
  return [...projects].sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));
}

export async function fetchProjectRows(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("canvas_projects")
    .select("local_id,title,document,client_updated_at,deleted_at,created_at,updated_at")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return (data || []) as CanvasProjectRow[];
}

export async function upsertProjectRow(supabase: SupabaseClient, userId: string, project: CanvasProjectDocument) {
  const clientUpdatedAt = projectClientUpdatedAt(project);
  const { error } = await supabase.from("canvas_projects").upsert(
    {
      user_id: userId,
      local_id: project.id,
      title: project.title || "未命名画布",
      document: project,
      client_updated_at: clientUpdatedAt,
      deleted_at: null,
    },
    { onConflict: "user_id,local_id" },
  );
  if (error) throw new Error(error.message);
}

export async function upsertTombstoneRow(supabase: SupabaseClient, userId: string, localId: string) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("canvas_projects").upsert(
    {
      user_id: userId,
      local_id: localId,
      title: "Deleted canvas",
      document: { id: localId, deleted: true, updatedAt: now },
      client_updated_at: now,
      deleted_at: now,
    },
    { onConflict: "user_id,local_id" },
  );
  if (error) throw new Error(error.message);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function validDateString(value: unknown) {
  if (typeof value !== "string") return "";
  return Number.isFinite(Date.parse(value)) ? value : "";
}
