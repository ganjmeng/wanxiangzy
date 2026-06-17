import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api/auth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rate-limit";
import { fetchProjectRows, rowToProject, sortProjects } from "./shared";

export async function GET() {
  try {
    const auth = await requireApiUser();
    if (auth.response) return auth.response;

    const limit = await checkRateLimit(`infinite-canvas-projects:${auth.user.id}`, 60, 60_000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfterSeconds);

    const rows = await fetchProjectRows(auth.supabase, auth.user.id);
    const projects = rows
      .filter((row) => !row.deleted_at)
      .map(rowToProject)
      .filter((project): project is NonNullable<ReturnType<typeof rowToProject>> => Boolean(project));
    const tombstones = rows
      .filter((row) => row.deleted_at)
      .map((row) => ({ localId: row.local_id, deletedAt: row.deleted_at }));

    return NextResponse.json({ projects: sortProjects(projects), tombstones });
  } catch (error: unknown) {
    console.error("[infinite-canvas/projects] GET error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "画布项目读取失败" }, { status: 500 });
  }
}
