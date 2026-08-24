import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { API_RATE_LIMITS, enforceApiRateLimit } from "@/lib/api/rate-limit";
import {
  createCanvasProject,
  listCanvasProjects,
} from "@/lib/canvas-projects.server";
import { canvasProjectErrorResponse } from "@/lib/canvas-projects.http";

export async function GET() {
  try {
    const auth = await requireApiUser();
    if (auth.response) return auth.response;
    const limit = await enforceApiRateLimit(auth.user.id, API_RATE_LIMITS.historyRead);
    if (limit) return limit;
    return NextResponse.json({ projects: await listCanvasProjects(auth.supabase, auth.user.id) });
  } catch (error) {
    return canvasProjectErrorResponse(error, "画布列表加载失败");
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.response) return auth.response;
    const limit = await enforceApiRateLimit(auth.user.id, API_RATE_LIMITS.favoriteMutation);
    if (limit) return limit;
    const project = await createCanvasProject(
      auth.supabase,
      auth.user.id,
      await request.json().catch(() => null),
    );
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return canvasProjectErrorResponse(error, "画布创建失败");
  }
}
