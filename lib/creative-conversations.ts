export type CreativeConversationClient = {
  id: string;
  title: string;
  status: "active" | "archived";
  surface: "agent" | "canvas";
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
};

export type CreativeMessageClient = {
  id: string;
  conversationId: string;
  runId: string | null;
  sequence: number;
  role: "user" | "assistant" | "system" | "tool";
  status: "running" | "completed" | "failed" | "cancelled";
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CreativeAgentProcessStep = {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "failed";
  detail?: string;
  startedAt?: string;
  completedAt?: string;
};

export type CreativeAgentProcess = {
  status: "running" | "completed" | "failed";
  elapsedMs?: number;
  steps: CreativeAgentProcessStep[];
};

export type CreativeAgentTurnDecision = {
  kind: "conversation" | "generation";
  capability: "image" | "video" | null;
  reply: string;
};
