import { executeLlmChatRouted } from "@/lib/api/llm-routing.server";
import type { CreativeAgentTurnDecision, CreativeMessageClient } from "@/lib/creative-conversations";

type PlannerInput = {
  userId: string;
  content: string;
  history: CreativeMessageClient[];
  creationMode: "agent" | "image" | "video";
  preferredCapability: "image" | "video";
  hasReferences: boolean;
  hasSkill: boolean;
};

export async function planCreativeAgentTurn(input: PlannerInput): Promise<CreativeAgentTurnDecision & { providerId?: string; deploymentId?: string }> {
  if (input.creationMode === "image" || input.creationMode === "video") {
    return {
      kind: "generation",
      capability: input.creationMode,
      reply: `好的，我会按当前${input.creationMode === "video" ? "视频" : "图片"}参数开始创作。`,
    };
  }

  const recentHistory = input.history.slice(-12).map((message) => ({
    role: message.role,
    content: message.content.slice(0, 4_000),
  }));
  try {
    const completion = await executeLlmChatRouted({
      kind: "text",
      context: { userId: input.userId },
      body: {
        messages: [
          {
            role: "system",
            content: `你是 Pixel Diffusion 创作 Agent。先结合历史消息判断用户本轮意图：问候、闲聊、能力咨询、使用说明和知识问答属于 conversation；明确要求生成、制作、绘制、编辑图片或视频属于 generation。用户已有素材或已选择 Skill 时，除非明显只是在提问，否则优先 generation。generation 只选择 image 或 video，并参考用户偏好 ${input.preferredCapability}。reply 使用自然、简洁的中文：conversation 直接回答用户，generation 简要确认将执行的内容。只返回一个 JSON 对象，格式严格为 {"kind":"conversation|generation","capability":"image|video|null","reply":"..."}，不要 Markdown。`,
          },
          ...recentHistory,
          { role: "user", content: input.content },
        ],
        response_format: { type: "json_object" },
        max_tokens: 500,
        temperature: 0.2,
      },
    });
    const decision = parseCreativeAgentDecision(completion.data, input.preferredCapability);
    return { ...decision, providerId: completion.providerId, deploymentId: completion.deploymentId };
  } catch (error) {
    const fallback = localConversationFallback(input.content);
    if (fallback) return { kind: "conversation", capability: null, reply: fallback };
    throw error;
  }
}

export function parseCreativeAgentDecision(
  data: Record<string, unknown>,
  preferredCapability: "image" | "video",
): CreativeAgentTurnDecision {
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const first = choices[0] && typeof choices[0] === "object" && !Array.isArray(choices[0]) ? choices[0] as Record<string, unknown> : {};
  const message = first.message && typeof first.message === "object" && !Array.isArray(first.message) ? first.message as Record<string, unknown> : {};
  const raw = typeof message.content === "string" ? message.content.trim() : "";
  // Reasoning models may prepend a private <think> block even when asked for
  // strict JSON. Never expose that block in the conversation and parse the
  // visible payload that follows it.
  const visible = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const normalized = visible.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let value: Record<string, unknown>;
  try {
    const parsed = JSON.parse(normalized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid planner object");
    value = parsed as Record<string, unknown>;
  } catch {
    if (visible && !visible.startsWith("{") && !visible.startsWith("[")) {
      return { kind: "conversation", capability: null, reply: visible.slice(0, 4_000) };
    }
    throw new Error("Agent 规划模型返回了无效结果");
  }
  const kind = value.kind === "generation" ? "generation" : value.kind === "conversation" ? "conversation" : null;
  const reply = typeof value.reply === "string" ? value.reply.trim().slice(0, 4_000) : "";
  if (!kind || !reply) throw new Error("Agent 规划模型返回了不完整结果");
  if (kind === "conversation") return { kind, capability: null, reply };
  const capability = value.capability === "video" ? "video" : value.capability === "image" ? "image" : preferredCapability;
  return { kind, capability, reply };
}

function localConversationFallback(content: string) {
  const normalized = content.trim().replace(/[!！?？。,.，\s]/g, "");
  if (/^(你好|您好|嗨|哈喽|hello|hi|在吗|你在吗)$/i.test(normalized)) {
    return "你好！我是 Pixel Diffusion 创作 Agent。你可以直接和我对话，也可以让我生成或编辑图片、视频。";
  }
  if (/(你能做什么|怎么用|如何使用|使用说明|帮助)/.test(normalized)) {
    return "我可以理解连续对话，规划并生成图片或视频，也能结合你上传的素材、生成参数和 Skill 完成创作。直接告诉我目标即可。";
  }
  return "";
}
