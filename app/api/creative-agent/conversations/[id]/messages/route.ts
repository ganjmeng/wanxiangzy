import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { API_RATE_LIMITS, enforceApiRateLimit } from "@/lib/api/rate-limit";
import { planCreativeAgentTurn } from "@/lib/creative-agent-planner.server";
import { appendUserCreativeExchange, listUserCreativeMessages, requireUserCreativeConversation, updateUserCreativeAssistantMessage } from "@/lib/creative-conversations.server";
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
  const planningStartedAt = Date.now();
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
    const referenceUrls = Array.isArray(body?.referenceUrls) ? body.referenceUrls.flatMap((value) => {
      if (typeof value !== "string" || value.length > 2_048 || !/^https?:\/\//i.test(value)) return [];
      return [value];
    }).slice(0, 10) : [];
    const selectedSkillId = typeof body?.selectedSkillId === "string" ? body.selectedSkillId.trim().slice(0, 160) : "";
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
      userMetadata: {
        ...(referenceUrls.length ? { referenceUrls } : {}),
        ...(selectedSkillId ? { selectedSkillId } : {}),
        creationMode,
      },
      assistantContent: decision.reply,
      assistantMetadata: {
        kind: decision.kind,
        capability: decision.capability,
        process: {
          status: "completed",
          elapsedMs: Math.max(1, Date.now() - planningStartedAt),
          steps: [
            {
              id: "understand",
              title: "理解需求",
              status: "completed",
              detail: decision.kind === "generation" ? "已识别创作目标与交付类型" : "已识别为对话与信息请求",
            },
            {
              id: "route",
              title: decision.kind === "generation" ? "匹配创作能力" : "检索上下文",
              status: "completed",
              detail: decision.kind === "generation" ? `已选择${decision.capability === "video" ? "视频" : "图片"}生成链路` : "已结合当前会话组织答案",
            },
            {
              id: "respond",
              title: decision.kind === "generation" ? "确定执行方案" : "组织回复",
              status: "completed",
              detail: decision.kind === "generation" ? "方案已确定，准备创建后台任务" : "回答已完成",
            },
          ],
        },
        ...(decision.providerId ? { providerId: decision.providerId } : {}),
        ...(decision.deploymentId ? { deploymentId: decision.deploymentId } : {}),
      },
    });
    return NextResponse.json({ decision, messages });
  } catch (error) {
    return errorResponse(error, "Agent 对话失败");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireApiUser();
    if (auth.response) return auth.response;
    const rateLimit = await enforceApiRateLimit(auth.user.id, API_RATE_LIMITS.messageMutation);
    if (rateLimit) return rateLimit;
    const { id } = await context.params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const messageId = typeof body?.messageId === "string" ? body.messageId : "";
    const runId = typeof body?.runId === "string" ? body.runId : undefined;
    const status = body?.status === "running" || body?.status === "completed" || body?.status === "failed" || body?.status === "cancelled" ? body.status : undefined;
    if (!messageId) return NextResponse.json({ error: "缺少消息 ID" }, { status: 400 });
    const admin = getAdminClient();
    if (runId) {
      const { data: run, error } = await admin.from("creative_runs").select("id").eq("id", runId).eq("user_id", auth.user.id).eq("conversation_id", id).maybeSingle();
      if (error) throw new CreativeRunError(`任务校验失败: ${error.message}`);
      if (!run) throw new CreativeRunError("任务不存在或不属于当前对话", 404);
    }
    const messages = await updateUserCreativeAssistantMessage(admin, {
      userId: auth.user.id,
      conversationId: id,
      messageId,
      ...(runId ? { runId } : {}),
      ...(status ? { status } : {}),
      ...(typeof body?.content === "string" ? { content: body.content } : {}),
      ...(body?.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? { metadata: body.metadata as Record<string, unknown> } : {}),
    });
    return NextResponse.json({ messages });
  } catch (error) {
    return errorResponse(error, "Agent 状态更新失败");
  }
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof CreativeRunError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[creative-agent:messages]", error);
  return NextResponse.json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}
