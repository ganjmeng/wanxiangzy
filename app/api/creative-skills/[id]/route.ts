import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api/auth";
import { API_RATE_LIMITS, enforceApiRateLimit } from "@/lib/api/rate-limit";
import { CreativeSkillError, deleteUserCreativeSkill, listCreativeSkills, saveUserCreativeSkill } from "@/lib/creative-skills.server";
import { getAdminClient } from "@/lib/supabase/admin";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiUser();
    if (auth.response) return auth.response;
    const rateLimit = await enforceApiRateLimit(auth.user.id, API_RATE_LIMITS.favoriteMutation);
    if (rateLimit) return rateLimit;
    const { id } = await context.params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const skills = await listCreativeSkills(getAdminClient(), { userId: auth.user.id, workspace: "all", includeDisabledOwn: true });
    const current = skills.find((skill) => skill.id === id && skill.scope === "user");
    if (!current) throw new CreativeSkillError("Skill 不存在或无权修改", 404);
    const skill = await saveUserCreativeSkill(getAdminClient(), { userId: auth.user.id, value: { ...current, ...(body || {}), id } });
    return NextResponse.json({ skill });
  } catch (error) {
    if (error instanceof CreativeSkillError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Skill 更新失败" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiUser();
    if (auth.response) return auth.response;
    const rateLimit = await enforceApiRateLimit(auth.user.id, API_RATE_LIMITS.favoriteMutation);
    if (rateLimit) return rateLimit;
    await deleteUserCreativeSkill(getAdminClient(), { userId: auth.user.id, skillId: (await context.params).id });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof CreativeSkillError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Skill 删除失败" }, { status: 500 });
  }
}
