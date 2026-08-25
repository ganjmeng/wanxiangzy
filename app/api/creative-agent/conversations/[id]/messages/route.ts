import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { API_RATE_LIMITS, enforceApiRateLimit } from "@/lib/api/rate-limit";
import { planCreativeAgentTurn } from "@/lib/creative-agent-planner.server";
import { appendUserCreativeExchange, listUserCreativeMessages, requireUserCreativeConversation } from "@/lib/creative-conversations.server";
import { CreativeRunError } from "@/lib/creative-runs.server";
import { getAdminClient } from "@/lib/supabase/admin";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await requireApiUser();
    if (auth.response) return auth.response;
    const rateLimit = await enforceApiRateLimit(auth.user.id, API_RATE_LIMITS.conversationReadMutation);
    if (rateLimit) return rateLimit;
    const { id } = await context.params;
    const messages = await listUserCreativeMessages(auth.supabase, auth.user.id, id);
    return NextResponse.json({ messages }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error, "对话消息加载失败");
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireApiUser();
    if (auth.response) return auth.response;
    const rateLimit = await enforceApiRateLimit(auth.user.id, API_RATE_LIMITS.messageMutation);
    if (rateLimit) return rateLimit;
    const { id } = await context.params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const content = typeof body?.content === "string" ? body.content.trim() : "";
    if (!content || content.length > 4_000) return NextResponse.json({ error: "消息需为 1-4000 个字符" }, { status: 400 });
    const creationMode = body?.creationMode === "image" || body?.creationMode === "video" ? body.creationMode : "agent";
    const preferredCapability = body?.preferredCapability === "video" ? "video" : "image";
    const admin = getAdminClient();
    await requireUserCreativeConversation(admin, auth.user.id, id);
    const history = await listUserCreativeMessages(admin, auth.user.id, id, 24);
    const decision = await planCreativeAgentTurn({
      userId: auth.user.id,
      content,
      history,
      creationMode,
      preferredCapability,
      hasReferences: body?.hasReferences === true,
      hasSkill: body?.hasSkill === true,
    });
    const messages = await appendUserCreativeExchange(admin, {
      userId: auth.user.id,
      conversationId: id,
      userContent: content,
      assistantContent: decision.reply,
      assistantMetadata: {
        kind: decision.kind,
        capability: decision.capability,
        ...(decision.providerId ? { providerId: decision.providerId } : {}),
        ...(decision.deploymentId ? { deploymentId: decision.deploymentId } : {}),
      },
    });
    return NextResponse.json({ decision, messages });
  } catch (error) {
    return errorResponse(error, "Agent 对话失败");
  }
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof CreativeRunError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[creative-agent:messages]", error);
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}
