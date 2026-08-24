import { NextResponse } from "next/server";

import { writeAdminAuditLog } from "@/lib/admin/audit";
import { requireAdminApi } from "@/lib/admin/auth";
import {
  CreativeSkillError,
  listSystemCreativeSkills,
  saveSystemCreativeSkill,
} from "@/lib/creative-skills.server";
import { getAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const auth = await requireAdminApi("prompts:read");
  if (!auth.ok) return auth.response;
  try {
    const skills = await listSystemCreativeSkills(getAdminClient());
    return NextResponse.json({ skills }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return skillErrorResponse(error, "系统 Skill 加载失败");
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminApi("prompts:write");
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as { skill?: unknown; reason?: unknown } | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 240) : "";
  if (reason.length < 4) return NextResponse.json({ error: "请填写至少 4 个字的操作原因" }, { status: 400 });
  try {
    const skill = await saveSystemCreativeSkill(getAdminClient(), {
      actorUserId: auth.context.userId,
      value: body?.skill,
    });
    await writeAdminAuditLog(auth.context, {
      action: "creative_skill.publish",
      resourceType: "creative_agent_skill",
      resourceId: skill.id,
      reason,
      metadata: {
        version: skill.currentVersion,
        enabled: skill.enabled !== false,
        workspaces: skill.capabilities,
        contentHash: skill.sourceContentHash,
      },
    });
    return NextResponse.json({ skill }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return skillErrorResponse(error, "系统 Skill 保存失败");
  }
}

function skillErrorResponse(error: unknown, fallback: string) {
  if (error instanceof CreativeSkillError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: fallback }, { status: 500 });
}
