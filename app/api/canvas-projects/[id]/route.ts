import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { API_RATE_LIMITS, enforceApiRateLimit } from "@/lib/api/rate-limit";
import {
  deleteCanvasProject,
  getCanvasProject,
  updateCanvasProject,
} from "@/lib/canvas-projects.server";
import { canvasProjectErrorResponse } from "@/lib/canvas-projects.http";

type RouteProps = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteProps) {
  try {
    const auth = await requireApiUser();
    if (auth.response) return auth.response;
    const limit = await enforceApiRateLimit(auth.user.id, API_RATE_LIMITS.historyRead);
    if (limit) return limit;
    const { id } = await params;
    return NextResponse.json({ project: await getCanvasProject(auth.supabase, auth.user.id, id) });
  } catch (error) {
    return canvasProjectErrorResponse(error, "画布加载失败");
  }
}

export async function PATCH(request: Request, { params }: RouteProps) {
  try {
    const auth = await requireApiUser();
    if (auth.response) return auth.response;
    const limit = await enforceApiRateLimit(auth.user.id, API_RATE_LIMITS.favoriteMutation);
    if (limit) return limit;
    const { id } = await params;
    const project = await updateCanvasProject(
      auth.supabase,
      auth.user.id,
      id,
      await request.json().catch(() => null),
    );
    return NextResponse.json({ project });
  } catch (error) {
    return canvasProjectErrorResponse(error, "画布保存失败");
  }
}

export async function DELETE(_request: Request, { params }: RouteProps) {
  try {
    const auth = await requireApiUser();
    if (auth.response) return auth.response;
    const limit = await enforceApiRateLimit(auth.user.id, API_RATE_LIMITS.favoriteMutation);
    if (limit) return limit;
    const { id } = await params;
    await deleteCanvasProject(auth.supabase, auth.user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return canvasProjectErrorResponse(error, "画布删除失败");
  }
}
