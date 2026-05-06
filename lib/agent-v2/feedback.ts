export type AssistantUiFeedbackType = "positive" | "negative";
export type AgentFeedbackRating = "good" | "bad";

export type AgentFeedbackPayload = {
  conversationId: string;
  messageId: string;
  traceId?: string;
  messageExcerpt?: string;
  assistantExcerpt?: string;
  imageUrls?: string[];
  rating: AgentFeedbackRating;
  reason: string;
  tags: string[];
};

type BuildAgentFeedbackPayloadInput = {
  conversationId: string;
  messageId: string;
  type: AssistantUiFeedbackType;
  traceId?: string | null;
  messageExcerpt?: string | null;
  assistantExcerpt?: string | null;
  imageUrls?: string[];
  reason?: string;
  tags?: string[];
};

type FeedbackContextMessage = {
  id: string;
  role: string;
  content?: readonly unknown[];
  attachments?: readonly unknown[];
};

const DEFAULT_REASONS: Record<AssistantUiFeedbackType, string> = {
  positive: "\u7ed3\u679c\u7b26\u5408\u9884\u671f",
  negative: "\u7528\u6237\u6807\u8bb0\u8fd9\u6b21\u56de\u7b54\u6216\u8ba1\u5212\u4e0d\u7b26\u5408\u9884\u671f",
};

const DEFAULT_TAGS: Record<AssistantUiFeedbackType, string[]> = {
  positive: ["assistant_ui", "quick_positive"],
  negative: ["assistant_ui", "quick_negative"],
};

export function buildAgentFeedbackPayload({
  conversationId,
  messageId,
  type,
  traceId,
  messageExcerpt,
  assistantExcerpt,
  imageUrls,
  reason,
  tags,
}: BuildAgentFeedbackPayloadInput): AgentFeedbackPayload {
  const normalizedMessageExcerpt = normalizeReason(messageExcerpt);
  const normalizedAssistantExcerpt = normalizeReason(assistantExcerpt);
  const normalizedImageUrls = normalizeImageUrls(imageUrls);
  const normalizedTags = normalizeTags(tags);

  return {
    conversationId,
    messageId,
    ...(traceId ? { traceId } : {}),
    ...(normalizedMessageExcerpt ? { messageExcerpt: normalizedMessageExcerpt } : {}),
    ...(normalizedAssistantExcerpt ? { assistantExcerpt: normalizedAssistantExcerpt } : {}),
    ...(normalizedImageUrls.length ? { imageUrls: normalizedImageUrls } : {}),
    rating: type === "positive" ? "good" : "bad",
    reason: normalizeReason(reason) || DEFAULT_REASONS[type],
    tags: normalizedTags.length ? normalizedTags : DEFAULT_TAGS[type],
  };
}

export function buildAgentFeedbackContext(
  messages: readonly FeedbackContextMessage[],
  assistantMessageId: string,
) {
  const index = messages.findIndex((message) => message.id === assistantMessageId);
  const assistant = index >= 0 ? messages[index] : null;
  const previousUser = index >= 0
    ? [...messages.slice(0, index)].reverse().find((message) => message.role === "user") || null
    : null;

  return {
    messageExcerpt: previousUser ? getFeedbackMessageText(previousUser) : "",
    assistantExcerpt: assistant ? getFeedbackMessageText(assistant) : "",
    imageUrls: previousUser ? getFeedbackImageUrls(previousUser) : [],
  };
}

export function extractTraceIdFromMetadata(metadata: unknown): string | null {
  if (!isRecord(metadata)) return null;
  return (
    readString(metadata.custom, "traceId") ||
    readString(metadata.custom, "trace_id") ||
    readString(metadata.unstable_state, "traceId") ||
    readString(metadata.unstable_state, "trace_id") ||
    null
  );
}

function normalizeReason(reason: unknown) {
  return typeof reason === "string" ? reason.trim().slice(0, 800) : "";
}

function normalizeTags(tags: unknown) {
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeImageUrls(urls: unknown) {
  if (!Array.isArray(urls)) return [];
  return urls
    .filter((url): url is string => typeof url === "string" && /^https?:\/\//i.test(url))
    .slice(0, 8);
}

function getFeedbackMessageText(message: FeedbackContextMessage) {
  return (message.content || [])
    .map((part) => {
      if (!isRecord(part)) return "";
      if ((part.type === "text" || part.type === "reasoning") && typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim()
    .slice(0, 2000);
}

function getFeedbackImageUrls(message: FeedbackContextMessage) {
  const fromContent = (message.content || []).flatMap(readImagePart);
  const fromAttachments = (message.attachments || []).flatMap((attachment) => {
    if (!isRecord(attachment)) return [];
    return Array.isArray(attachment.content) ? attachment.content.flatMap(readImagePart) : [];
  });
  return Array.from(new Set([...fromContent, ...fromAttachments])).slice(0, 8);
}

function readImagePart(part: unknown) {
  if (!isRecord(part)) return [];
  if (part.type === "image" && typeof part.image === "string") return [part.image];
  if (part.type === "file") {
    const mimeType = typeof part.mimeType === "string" ? part.mimeType : "";
    const data = typeof part.data === "string" ? part.data : "";
    return mimeType.startsWith("image/") && /^https?:\/\//i.test(data) ? [data] : [];
  }
  return [];
}

function readString(value: unknown, key: string) {
  if (!isRecord(value)) return null;
  const item = value[key];
  return typeof item === "string" && item.trim() ? item.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
