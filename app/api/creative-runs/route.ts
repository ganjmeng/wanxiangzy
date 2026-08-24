import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { API_RATE_LIMITS, enforceApiRateLimit } from "@/lib/api/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  CreativeRunError,
  createUserCreativeRun,
  listUserCreativeRuns,
} from "@/lib/creative-runs.server";
import { CreativeSkillError } from "@/lib/creative-skills.server";

export async function GET(request: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.response) return auth.response;
    const rateLimit = await enforceApiRateLimit(auth.user.id, API_RATE_LIMITS.historyRead);
    if (rateLimit) return rateLimit;
    const requestedLimit = Number(new URL(request.url).searchParams.get("limit"));
    const runs = await listUserCreativeRuns(auth.supabase, auth.user.id, requestedLimit || 20);
    return NextResponse.json({ runs }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return creativeRunErrorResponse(error, "创作记录加载失败");
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.response) return auth.response;
    const rateLimit = await enforceApiRateLimit(auth.user.id, API_RATE_LIMITS.favoriteMutation);
    if (rateLimit) return rateLimit;
    const run = await createUserCreativeRun(getAdminClient(), {
      userId: auth.user.id,
      body: await request.json().catch(() => null),
    });
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    return creativeRunErrorResponse(error, "创作任务创建失败");
  }
}

function creativeRunErrorResponse(error: unknown, fallback: string) {
  if (error instanceof CreativeRunError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof CreativeSkillError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}
