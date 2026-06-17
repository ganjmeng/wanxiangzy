import { NextRequest, NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api/auth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rate-limit";
import { normalizeProjectDocument, upsertProjectRow, upsertTombstoneRow } from "../shared";

type RouteContext = {
  params: Promise<{ localId: string }>;
};

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireApiUser();
    if (auth.response) return auth.response;

    const limit = await checkRateLimit(`infinite-canvas-project-write:${auth.user.id}`, 120, 60_000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfterSeconds);

    const { localId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const project = normalizeProjectDocument(body.document || body.project || body, localId);
    if (!project) return NextResponse.json({ error: "画布项目文档无效" }, { status: 400 });

    await upsertProjectRow(auth.supabase, auth.user.id, { ...project, id: localId });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("[infinite-canvas/projects] PUT error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "画布项目保存失败" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireApiUser();
    if (auth.response) return auth.response;

    const limit = await checkRateLimit(`infinite-canvas-project-delete:${auth.user.id}`, 120, 60_000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfterSeconds);

    const { localId } = await context.params;
    await upsertTombstoneRow(auth.supabase, auth.user.id, localId);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("[infinite-canvas/projects] DELETE error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "画布项目删除失败" }, { status: 500 });
  }
}
