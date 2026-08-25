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
  role: "user" | "assistant";
  status: "running" | "completed" | "failed";
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CreativeAgentTurnDecision = {
  kind: "conversation" | "generation";
  capability: "image" | "video" | null;
  reply: string;
};
