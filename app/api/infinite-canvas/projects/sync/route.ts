import { NextRequest, NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api/auth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rate-limit";
import {
  fetchProjectRows,
  isNewerOrEqual,
  normalizeProjectDocument,
  projectClientUpdatedAt,
  rowToProject,
  sortProjects,
  upsertProjectRow,
  type CanvasProjectDocument,
} from "../shared";

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiUser();
    if (auth.response) return auth.response;

    const limit = await checkRateLimit(`infinite-canvas-sync:${auth.user.id}`, 40, 60_000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfterSeconds);

    const body = await request.json().catch(() => ({}));
    const localProjects = normalizeLocalProjects(body.projects);
    const remoteRows = await fetchProjectRows(auth.supabase, auth.user.id);
    const tombstoneById = new Map(remoteRows.filter((row) => row.deleted_at).map((row) => [row.local_id, row.deleted_at || ""]));
    const activeRemoteRows = remoteRows.filter((row) => !row.deleted_at);
    const remoteById = new Map(activeRemoteRows.map((row) => [row.local_id, row]));
    const mergedById = new Map<string, CanvasProjectDocument>();
    let uploaded = 0;
    let restored = 0;

    for (const localProject of localProjects) {
      const tombstone = tombstoneById.get(localProject.id);
      if (tombstone) continue;

      const remoteRow = remoteById.get(localProject.id);
      const remoteProject = remoteRow ? rowToProject(remoteRow) : null;
      if (remoteRow && remoteProject && isNewerOrEqual(remoteRow.client_updated_at, projectClientUpdatedAt(localProject))) {
        mergedById.set(remoteProject.id, remoteProject);
        continue;
      }

      await upsertProjectRow(auth.supabase, auth.user.id, localProject);
      mergedById.set(localProject.id, localProject);
      uploaded += 1;
    }

    for (const remoteRow of activeRemoteRows) {
      const remoteProject = rowToProject(remoteRow);
      if (!remoteProject) continue;
      const current = mergedById.get(remoteProject.id);
      if (!current) {
        mergedById.set(remoteProject.id, remoteProject);
        restored += 1;
        continue;
      }
      if (isNewerOrEqual(remoteRow.client_updated_at, projectClientUpdatedAt(current))) {
        mergedById.set(remoteProject.id, remoteProject);
      }
    }

    return NextResponse.json({
      projects: sortProjects(Array.from(mergedById.values())),
      uploaded,
      restored,
      tombstones: Array.from(tombstoneById.entries()).map(([localId, deletedAt]) => ({ localId, deletedAt })),
    });
  } catch (error: unknown) {
    console.error("[infinite-canvas/projects/sync] error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "画布项目同步失败" }, { status: 500 });
  }
}

function normalizeLocalProjects(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const id = item && typeof item === "object" ? (item as Record<string, unknown>).id : "";
      return normalizeProjectDocument(item, typeof id === "string" ? id : "");
    })
    .filter((project): project is CanvasProjectDocument => Boolean(project));
}
