import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api/auth";
import { API_RATE_LIMITS, enforceApiRateLimit } from "@/lib/api/rate-limit";
import { CreativeSkillError, listCreativeSkills, saveUserCreativeSkill } from "@/lib/creative-skills.server";
import { getAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.response) return auth.response;
    const rateLimit = await enforceApiRateLimit(auth.user.id, API_RATE_LIMITS.historyRead);
    if (rateLimit) return rateLimit;
    const params = new URL(request.url).searchParams;
    const rawWorkspace = params.get("workspace");
    const workspace = rawWorkspace === "image" || rawWorkspace === "video" || rawWorkspace === "canvas" ? rawWorkspace : "all";
    const skills = await listCreativeSkills(getAdminClient(), {
      userId: auth.user.id,
      workspace,
      includeDisabledOwn: params.get("includeDisabled") === "1",
    });
    return NextResponse.json({ skills, persistenceReady: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return skillErrorResponse(error, "Skill 加载失败");
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.response) return auth.response;
    const rateLimit = await enforceApiRateLimit(auth.user.id, API_RATE_LIMITS.favoriteMutation);
    if (rateLimit) return rateLimit;
    const skill = await saveUserCreativeSkill(getAdminClient(), { userId: auth.user.id, value: await request.json().catch(() => null) });
    return NextResponse.json({ skill }, { status: 201 });
  } catch (error) {
    return skillErrorResponse(error, "Skill 保存失败");
  }
}

function skillErrorResponse(error: unknown, fallback: string) {
  if (error instanceof CreativeSkillError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: fallback }, { status: 500 });
}
