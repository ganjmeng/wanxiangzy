import { runAgentBrainV2 } from "@/lib/agent/brain";
import { getAgentFeatureFlags } from "@/lib/agent/brain/feature-flags";
import { getAgentKnowledgeContext } from "@/lib/agent/brain/knowledge";
import { getAgentUserPreferences } from "@/lib/agent/brain/preferences";
import type { AgentBrainDecision } from "@/lib/agent/brain/types";
import type { AgentImageInput } from "@/lib/agent/decision-utils";
import { toLegacyHistory } from "@/lib/agent-v2/ui-messages";

export async function runLegacyBrainForAgentV2({
  userId,
  conversationId,
  userText,
  messages,
  images = [],
}: {
  userId: string;
  conversationId: string | null;
  userText: string;
  messages: unknown[];
  images?: AgentImageInput[];
}): Promise<AgentBrainDecision> {
  const featureFlags = getAgentFeatureFlags(userId);
  const userPreferences = featureFlags.memory ? await getAgentUserPreferences(userId) : null;
  const projectKnowledge = featureFlags.memory
    ? await getAgentKnowledgeContext({
      userId,
      conversationId,
      query: userText,
    })
    : [];

  return runAgentBrainV2({
    userId,
    conversationId,
    userText,
    images,
    history: toLegacyHistory(messages),
    intentMode: "smart",
    params: {},
    userPreferences,
    projectKnowledge,
    featureFlags,
    lastTask: null,
  });
}

export function toAgentV2Reply(decision: AgentBrainDecision): string {
  if (decision.action === "chat" || decision.action === "clarify") return decision.reply;

  return [
    "我已把这个需求整理成可确认的视觉任务。",
    "确认前不会扣积分，也不会调用生成模型。",
  ].join("\n");
}
