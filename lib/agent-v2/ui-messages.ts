import type { UIMessage } from "ai";
import type { AgentV2WorkflowApprovalInput } from "@/lib/agent-v2/workflow-approval";
import type { WorkflowInputImage } from "@/lib/agent/workflow/types";

type UnknownRecord = Record<string, unknown>;

export function getLastUserText(messages: unknown[]): string {
  const lastUser = [...messages].reverse().find(isUserMessage);
  if (!lastUser) return "";
  return extractTextFromMessage(lastUser).trim();
}

export function getLastAssistantMessageId(messages: unknown[]): string | undefined {
  const last = messages[messages.length - 1];
  if (!isRecord(last) || last.role !== "assistant") return undefined;
  return typeof last.id === "string" ? last.id : undefined;
}

export function normalizeUiMessages(messages: unknown): UIMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.filter(isRecord) as unknown as UIMessage[];
}

export function prepareMessagesForMastra(messages: UIMessage[]): UIMessage[] {
  const lastUserIndex = findLastUserMessageIndex(messages);
  return messages.map((message, index) => {
    if (!isRecord(message)) return message;
    if (index === lastUserIndex) return message;

    const text = extractTextFromMessage(message).trim();
    return {
      ...message,
      content: text,
      parts: text ? [{ type: "text", text }] : [],
      images: undefined,
      attachments: undefined,
    } as unknown as UIMessage;
  });
}

export function buildFallbackAgentReply(userText: string): string {
  const text = userText.trim();
  if (!text) {
    return "我在。你可以直接告诉我想聊什么，或者上传图片让我分析。涉及生成、扣积分或创建任务时，我会先让你确认。";
  }

  if (/你是谁|你能干什么|能做什么|介绍一下|有什么能力|快捷指令/i.test(text)) {
    return [
      "我是万象衣造的 AI 助手，可以像普通聊天一样帮你分析、整理想法，也可以在你确认后执行视觉生产任务。",
      "",
      "我能处理服装图分析、文生图、图生图、换装、姿势裂变、电商详情页、商品展示和 3D 展示这类任务。涉及生成或扣积分时，我会先给你确认卡，不会直接开跑。",
    ].join("\n");
  }

  if (/生成|出图|换装|穿到|姿势|详情页|3d|3D|主图|海报|banner/i.test(text)) {
    return [
      "我理解这可能是一个视觉生成任务。",
      "",
      "当前 Mastra 服务暂时没有完成响应，所以我没有替你创建任务。你可以再发一次，系统会重新进入 Mastra 规划；确认前不会扣积分或调用生成模型。",
    ].join("\n");
  }

  return "可以，我们先按自然对话处理。你继续说，我会在需要生成、扣积分或创建任务时先明确确认。";
}

export function toLegacyHistory(messages: unknown[]): Array<{ role: string; content: string }> {
  return getRecentConversationContext(messages, 80);
}

export function getRecentConversationContext(
  messages: unknown[],
  limit = 80,
): Array<{ role: string; content: string }> {
  return messages
    .filter(isRecord)
    .map((message) => {
      const role = typeof message.role === "string" ? message.role : "user";
      return {
        role,
        content: extractTextFromMessage(message),
      };
    })
    .filter((message) => message.content.trim().length > 0)
    .slice(-limit);
}

export function extractWorkflowImagesFromMessages(messages: unknown[]): WorkflowInputImage[] {
  const records = messages.filter(isRecord);
  const lastUser = [...records].reverse().find(isUserMessage);
  const source = lastUser ? extractImageUrlsFromMessage(lastUser) : [];

  const unique: WorkflowInputImage[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    unique.push({
      index: unique.length + 1,
      url: item.url,
      role: item.role || "auto",
      fileName: item.fileName,
    });
  }
  return unique.slice(-8).map((image, index) => ({ ...image, index: index + 1 }));
}

export function writeTextToUiStream(
  writer: {
    write: (chunk: { type: "start"; messageId?: string } | { type: "text-start"; id: string } | { type: "text-delta"; id: string; delta: string } | { type: "text-end"; id: string } | { type: "finish"; finishReason: "stop" }) => void;
  },
  text: string,
  options?: { messageId?: string; textPartId?: string; finish?: boolean }
) {
  const messageId = options?.messageId || crypto.randomUUID();
  const textPartId = options?.textPartId || "text-1";
  writer.write({ type: "start", messageId });
  writer.write({ type: "text-start", id: textPartId });

  for (const chunk of splitTextForStreaming(text)) {
    writer.write({ type: "text-delta", id: textPartId, delta: chunk });
  }

  writer.write({ type: "text-end", id: textPartId });
  if (options?.finish !== false) writer.write({ type: "finish", finishReason: "stop" });
}

export function writeWorkflowApprovalToolToUiStream(
  writer: {
    write: (chunk:
      | { type: "tool-input-available"; toolCallId: string; toolName: string; input: AgentV2WorkflowApprovalInput; title?: string }
      | { type: "tool-output-available"; toolCallId: string; output: { state: "waiting_approval"; canExecute: false } }
    ) => void;
  },
  input: AgentV2WorkflowApprovalInput
) {
  const toolCallId = `tool-${crypto.randomUUID()}`;
  writer.write({
    type: "tool-input-available",
    toolCallId,
    toolName: "createWorkflowApproval",
    title: input.title,
    input,
  });
  writer.write({
    type: "tool-output-available",
    toolCallId,
    output: {
      state: "waiting_approval",
      canExecute: false,
    },
  });
}

function splitTextForStreaming(text: string): string[] {
  const chunks = text.match(/.{1,18}(\s|$)|\S+/g);
  return chunks && chunks.length > 0 ? chunks : [text];
}

function isUserMessage(value: unknown): value is UnknownRecord {
  return isRecord(value) && value.role === "user";
}

function findLastUserMessageIndex(messages: unknown[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isUserMessage(messages[index])) return index;
  }
  return -1;
}

function extractTextFromMessage(message: UnknownRecord): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.parts)) return "";

  return message.parts
    .map((part) => {
      if (!isRecord(part)) return "";
      if (part.type === "text" && typeof part.text === "string") return part.text;
      if (part.type === "input-text" && typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractImageUrlsFromMessage(message: UnknownRecord): WorkflowInputImage[] {
  const fromImages: WorkflowInputImage[] = Array.isArray(message.images)
    ? message.images.flatMap((image, index) => {
      if (typeof image === "string") {
        const item: WorkflowInputImage = { index: index + 1, url: image, role: "auto" };
        return [item];
      }
      if (!isRecord(image)) return [];
      const url = typeof image.url === "string"
        ? image.url
        : typeof image.hostedUrl === "string"
          ? image.hostedUrl
          : "";
      if (!url) return [];
      const item: WorkflowInputImage = {
        index: Number(image.index || index + 1),
        url,
        role: typeof image.role === "string" ? image.role as WorkflowInputImage["role"] : "auto" as const,
        fileName: typeof image.fileName === "string" ? image.fileName : undefined,
      };
      return [item];
    })
    : [];

  const fromAttachments: WorkflowInputImage[] = Array.isArray(message.attachments)
    ? message.attachments.flatMap((attachment, index) => {
      if (!isRecord(attachment)) return [];
      const content = Array.isArray(attachment.content) ? attachment.content : [];
      return content.flatMap((part) => readImagePart(part, index));
    })
    : [];

  const fromParts: WorkflowInputImage[] = Array.isArray(message.parts)
    ? message.parts.flatMap((part, index) => readImagePart(part, index))
    : [];

  return [...fromImages, ...fromAttachments, ...fromParts];
}

function readImagePart(part: unknown, index: number): WorkflowInputImage[] {
  if (!isRecord(part)) return [];
  if (part.type === "image" && typeof part.image === "string") {
    return [{
      index: index + 1,
      url: part.image,
      role: typeof part.role === "string" ? part.role as WorkflowInputImage["role"] : "auto",
      fileName: typeof part.filename === "string" ? part.filename : undefined,
    }];
  }
  if (part.type === "file") {
    const mediaType = typeof part.mediaType === "string"
      ? part.mediaType
      : typeof part.mimeType === "string"
        ? part.mimeType
        : "";
    if (!mediaType.startsWith("image/")) return [];
    const url = typeof part.url === "string" ? part.url : typeof part.data === "string" ? part.data : "";
    if (!url) return [];
    return [{
      index: index + 1,
      url,
      role: typeof part.role === "string" ? part.role as WorkflowInputImage["role"] : "auto",
      fileName: typeof part.filename === "string" ? part.filename : undefined,
    }];
  }
  return [];
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object";
}
