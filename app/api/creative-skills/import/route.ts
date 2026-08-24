import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api/auth";
import { API_RATE_LIMITS, enforceApiRateLimit } from "@/lib/api/rate-limit";
import { CreativeSkillError, saveUserCreativeSkill } from "@/lib/creative-skills.server";
import { refineImportedCreativeSkill } from "@/lib/creative-skill-import-refiner.server";
import { GithubCreativeSkillImportError, importCreativeSkillFromGithub } from "@/lib/github-creative-skill-import.server";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.response) return auth.response;
    const rateLimit = await enforceApiRateLimit(auth.user.id, API_RATE_LIMITS.favoriteMutation);
    if (rateLimit) return rateLimit;
    const body = await request.json().catch(() => null) as { url?: unknown; path?: unknown; save?: unknown } | null;
    const result = await importCreativeSkillFromGithub({
      url: typeof body?.url === "string" ? body.url : "",
      path: typeof body?.path === "string" ? body.path : undefined,
    });
    if (!result.skill) return NextResponse.json(result);
    const refined = await refineImportedCreativeSkill({ skill: result.skill, userId: auth.user.id });
    if (body?.save !== true) return NextResponse.json({ ...result, skill: refined });
    const skill = await saveUserCreativeSkill(getAdminClient(), { userId: auth.user.id, value: refined });
    return NextResponse.json({ ...result, skill }, { status: 201 });
  } catch (error) {
    if (error instanceof GithubCreativeSkillImportError || error instanceof CreativeSkillError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "GitHub Skill 导入失败" }, { status: 500 });
  }
}
