"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useChat, type CreateUIMessage, type UIMessage } from "@ai-sdk/react";
import type { AppendMessage } from "@assistant-ui/core";
import {
  RuntimeAdapterProvider,
  useAui,
  useAuiState,
  useRemoteThreadListRuntime,
  type AssistantRuntime,
  type Attachment,
  type AttachmentAdapter,
  type CompleteAttachment,
  type FeedbackAdapter,
  type GenericThreadHistoryAdapter,
  type MessageFormatAdapter,
  type MessageFormatItem,
  type MessageFormatRepository,
  type RemoteThreadListAdapter,
  type ThreadHistoryAdapter,
  type ThreadMessage,
  type PendingAttachment,
} from "@assistant-ui/react";
import { AssistantChatTransport, useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import { createAssistantStream } from "assistant-stream";
import { compressImageForAgent, uploadImage } from "@/lib/utils";
import {
  buildAgentFeedbackContext,
  buildAgentFeedbackPayload,
  extractTraceIdFromMetadata,
} from "@/lib/agent-v2/feedback";
import { clearAttachmentRole, getAttachmentRole } from "@/components/agent-v2/attachment-role-store";
import { useAgentV2GenerationSettings } from "./AgentV2GenerationSettings";

type ConversationRow = {
  id: string;
  title?: string | null;
  mode?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  images?: unknown;
};

type AgentMessageRow = {
  id: string;
  role?: string | null;
  content?: string | null;
  images?: unknown;
  generation?: unknown;
  params?: unknown;
  mode?: string | null;
  created_at?: string | null;
};

type StoredAssistantUiMessage<TStorageFormat extends Record<string, unknown>> = {
  version: 1;
  format: string;
  client_id?: string;
  parent_client_id?: string | null;
  parent_id?: string | null;
  content: TStorageFormat;
};

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function useWanxiangAssistantRuntime(): AssistantRuntime {
  const { settings, uiContext } = useAgentV2GenerationSettings();
  const settingsRef = useRef(settings);
  const uiContextRef = useRef(uiContext);
  settingsRef.current = settings;
  uiContextRef.current = uiContext;

  const transport = useMemo(
    () =>
      new AssistantChatTransport<UIMessage>({
        api: "/api/agent/chat-v2",
        credentials: "same-origin",
        body: () => ({
          generationDefaults: settingsRef.current,
          agentUiContext: uiContextRef.current,
        }),
      }),
    [],
  );

  const adapter = useMemo<RemoteThreadListAdapter>(
    () => ({
      list: async () => {
        try {
          const conversations = await requestJson<ConversationRow[]>("/api/conversations", {
            method: "GET",
            cache: "no-store",
          });
          return { threads: conversations.map(toThreadMetadata) };
        } catch (error) {
          console.warn("[assistant-ui] failed to load conversations", error);
          return { threads: [] };
        }
      },
      initialize: async (threadId) => {
        const conversation = await requestJson<ConversationRow>("/api/conversations", {
          method: "POST",
          body: JSON.stringify({ title: "\u65b0\u5bf9\u8bdd", mode: "agent" }),
        });
        return { remoteId: conversation.id, externalId: threadId };
      },
      fetch: async (threadIdOrRemoteId) => {
        const conversation = await requestJson<ConversationRow>(
          `/api/conversations/${encodeURIComponent(threadIdOrRemoteId)}`,
          { method: "GET", cache: "no-store" },
        );
        return toThreadMetadata(conversation);
      },
      rename: async (remoteId, newTitle) => {
        await requestJson(`/api/conversations/${encodeURIComponent(remoteId)}`, {
          method: "PATCH",
          body: JSON.stringify({ title: newTitle }),
        });
      },
      archive: async () => {
        // The current schema has no archived state; keep this a no-op so the
        // runtime can stay compatible without forcing another migration.
      },
      unarchive: async () => {},
      delete: async (remoteId) => {
        await requestJson(`/api/conversations/${encodeURIComponent(remoteId)}`, {
          method: "DELETE",
        });
      },
      generateTitle: async (remoteId, messages) => {
        const title = makeThreadTitle(messages);
        await requestJson(`/api/conversations/${encodeURIComponent(remoteId)}`, {
          method: "PATCH",
          body: JSON.stringify({ title }),
        }).catch(() => undefined);
        return createAssistantStream((controller) => {
          controller.appendText(title);
          controller.close();
        });
      },
      unstable_Provider: WanxiangThreadHistoryProvider,
    }),
    [],
  );

  return useRemoteThreadListRuntime({
    adapter,
    allowNesting: true,
    runtimeHook: function WanxiangRuntimeHook() {
      return useWanxiangChatThreadRuntime(transport);
    },
  });
}

function WanxiangThreadHistoryProvider({ children }: { children?: ReactNode }) {
  const aui = useAui();
  const history = useMemo(
    () =>
      new WanxiangThreadHistoryAdapter(() =>
        aui.threadListItem.source ? aui.threadListItem().getState().remoteId : undefined,
      ),
    [aui],
  );

  return <RuntimeAdapterProvider adapters={{ history }}>{children}</RuntimeAdapterProvider>;
}

function useWanxiangChatThreadRuntime(transport: AssistantChatTransport<UIMessage>) {
  const id = useAuiState((state) => state.threadListItem.id);
  const aui = useAui();
  const chat = useChat<UIMessage>({ id, transport });
  useAutoThreadTitle(aui);
  const feedback = useMemo(
    () =>
      createWanxiangFeedbackAdapter({
        getRemoteId: () =>
          aui.threadListItem.source ? aui.threadListItem().getState().remoteId : undefined,
        getMessages: () => aui.thread().getState().messages,
      }),
    [aui],
  );
  const runtime = useAISDKRuntime<UIMessage>(chat, {
    toCreateMessage: toWanxiangCreateMessage,
    adapters: {
      attachments: wanxiangAttachmentAdapter,
      feedback,
    },
  });

  transport.setRuntime(runtime);
  transport.__internal_setGetThreadListItem(() =>
    aui.threadListItem.source ? aui.threadListItem() : undefined,
  );

  return runtime;
}

function useAutoThreadTitle(aui: ReturnType<typeof useAui>) {
  const remoteId = useAuiState((state) => state.threadListItem.remoteId);
  const currentTitle = useAuiState((state) => state.threadListItem.title);
  const firstUserText = useAuiState((state) => {
    const firstUser = state.thread.messages.find((message) => message.role === "user");
    return firstUser?.content.map(readThreadTextPart).join("").trim() || "";
  });
  const lastRequestedRef = useRef("");

  useEffect(() => {
    if (!remoteId || !isUntitledConversationTitle(currentTitle)) return;
    const nextTitle = normalizeTitle(firstUserText);
    if (isUntitledConversationTitle(nextTitle)) return;

    const requestKey = `${remoteId}:${nextTitle}`;
    if (lastRequestedRef.current === requestKey) return;
    lastRequestedRef.current = requestKey;
    aui.threadListItem().rename(nextTitle);
  }, [aui, currentTitle, firstUserText, remoteId]);
}

function toWanxiangCreateMessage<UI_MESSAGE extends UIMessage = UIMessage>(
  message: AppendMessage,
): CreateUIMessage<UI_MESSAGE> {
  const attachmentRoles = message.attachments?.map((attachment, index) => ({
    id: attachment.id,
    index: index + 1,
    name: attachment.name,
    role: readAttachmentRole(attachment),
  }));
  const inputParts = [
    ...message.content.filter((part) => part.type !== "file"),
    ...(message.attachments?.flatMap((attachment) =>
      attachment.content.map((part) => ({
        ...part,
        filename: attachment.name,
      })),
    ) ?? []),
  ];

  const parts = inputParts.map((part) => {
    switch (part.type) {
      case "text":
        return {
          type: "text",
          text: part.text,
        };
      case "image": {
        const role = readPartRole(part);
        return {
          type: "file",
          url: part.image,
          ...(part.filename && { filename: part.filename }),
          mediaType: readPartMediaType(part) || "image/png",
          ...(role ? { role } : {}),
        };
      }
      case "file": {
        const role = readPartRole(part);
        return {
          type: "file",
          url: part.data,
          mediaType: part.mimeType,
          ...(part.filename && { filename: part.filename }),
          ...(role ? { role } : {}),
        };
      }
      default:
        throw new Error(`Unsupported part type: ${part.type}`);
    }
  });

  const metadata = isRecord(message.metadata)
    ? {
        ...message.metadata,
        custom: {
          ...(isRecord(message.metadata.custom) ? message.metadata.custom : {}),
          ...(attachmentRoles?.length ? { attachmentRoles } : {}),
        },
      }
    : attachmentRoles?.length
      ? { custom: { attachmentRoles } }
      : message.metadata;

  return {
    role: message.role,
    parts,
    metadata,
  } as CreateUIMessage<UI_MESSAGE>;
}

class WanxiangThreadHistoryAdapter implements ThreadHistoryAdapter {
  constructor(private readonly getRemoteId: () => string | undefined) {}

  async load() {
    return { messages: [] };
  }

  async append() {}

  withFormat<TMessage, TStorageFormat extends Record<string, unknown>>(
    formatAdapter: MessageFormatAdapter<TMessage, TStorageFormat>,
  ): GenericThreadHistoryAdapter<TMessage> {
    return {
      load: async () => this.loadFormatted(formatAdapter),
      append: async (item) => this.appendFormatted(formatAdapter, item),
      update: async (item, localMessageId) => this.updateFormatted(formatAdapter, item, localMessageId),
    };
  }

  private async loadFormatted<TMessage, TStorageFormat extends Record<string, unknown>>(
    formatAdapter: MessageFormatAdapter<TMessage, TStorageFormat>,
  ): Promise<MessageFormatRepository<TMessage>> {
    const remoteId = this.getRemoteId();
    if (!remoteId) return { messages: [] };
    const rows = await requestJson<AgentMessageRow[]>(
      `/api/conversations/${encodeURIComponent(remoteId)}/messages`,
      { method: "GET", cache: "no-store" },
    );

    const messages: MessageFormatItem<TMessage>[] = [];
    let previousId: string | null = null;

    for (const row of rows) {
      const stored = readStoredMessage<TStorageFormat>(row.params, formatAdapter.format);
      if (stored) {
        try {
          const parentId = stored.parent_id ?? toDbMessageId(remoteId, stored.parent_client_id) ?? null;
          const decoded = formatAdapter.decode({
            id: row.id,
            parent_id: parentId,
            format: stored.format,
            content: stored.content,
          });
          messages.push(decoded);
          previousId = formatAdapter.getId(decoded.message);
          continue;
        } catch (error) {
          console.warn("[assistant-ui] failed to decode stored message, using legacy fallback", {
            messageId: row.id,
            error,
          });
        }
      }

      const legacyMessage = toLegacyUiMessage(row) as TMessage;
      messages.push({ parentId: previousId, message: legacyMessage });
      previousId = formatAdapter.getId(legacyMessage);
    }

    return { headId: previousId, messages };
  }

  private async appendFormatted<TMessage, TStorageFormat extends Record<string, unknown>>(
    formatAdapter: MessageFormatAdapter<TMessage, TStorageFormat>,
    item: MessageFormatItem<TMessage>,
  ) {
    const remoteId = this.getRemoteId();
    if (!remoteId) return;
    const localMessageId = formatAdapter.getId(item.message);
    const dbMessageId = toRequiredDbMessageId(remoteId, localMessageId);
    const payload = makePersistPayload(formatAdapter, item, remoteId, dbMessageId, localMessageId);

    try {
      await requestJson(`/api/conversations/${encodeURIComponent(remoteId)}/messages`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    } catch (error) {
      await this.updateMessage(remoteId, dbMessageId, payload);
    }
  }

  private async updateFormatted<TMessage, TStorageFormat extends Record<string, unknown>>(
    formatAdapter: MessageFormatAdapter<TMessage, TStorageFormat>,
    item: MessageFormatItem<TMessage>,
    localMessageId: string,
  ) {
    const remoteId = this.getRemoteId();
    if (!remoteId) return;
    const dbMessageId = toRequiredDbMessageId(remoteId, localMessageId);
    const payload = makePersistPayload(formatAdapter, item, remoteId, dbMessageId, localMessageId);

    try {
      await this.updateMessage(remoteId, dbMessageId, payload);
    } catch (error) {
      await requestJson(`/api/conversations/${encodeURIComponent(remoteId)}/messages`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }
  }

  private updateMessage(remoteId: string, dbMessageId: string, payload: Record<string, unknown>) {
    return requestJson(`/api/conversations/${encodeURIComponent(remoteId)}/messages`, {
      method: "PATCH",
      body: JSON.stringify({
        messageId: dbMessageId,
        content: payload.content,
        params: payload.params,
        images: payload.images,
      }),
    });
  }

}

function toThreadMetadata(conversation: ConversationRow) {
  return {
    status: "regular" as const,
    remoteId: conversation.id,
    externalId: conversation.id,
    title: normalizeTitle(conversation.title),
    custom: {
      mode: conversation.mode || "agent",
      updatedAt: conversation.updated_at || conversation.created_at || null,
    },
  };
}

function makePersistPayload<TMessage, TStorageFormat extends Record<string, unknown>>(
  formatAdapter: MessageFormatAdapter<TMessage, TStorageFormat>,
  item: MessageFormatItem<TMessage>,
  remoteId: string,
  dbMessageId: string,
  localMessageId: string,
) {
  const encoded = formatAdapter.encode(item);
  const role = readRole(encoded);
  const content = extractMessageText(encoded);
  const parentId = toDbMessageId(remoteId, item.parentId);

  return {
    id: dbMessageId,
    role,
    content,
      images: extractPersistedImages(encoded),
    mode: "agent",
    params: {
      assistant_ui: {
        version: 1,
        format: formatAdapter.format,
        client_id: localMessageId,
        parent_client_id: item.parentId,
        parent_id: parentId,
        content: encoded,
      } satisfies StoredAssistantUiMessage<TStorageFormat>,
    },
  };
}

function readStoredMessage<TStorageFormat extends Record<string, unknown>>(
  params: unknown,
  expectedFormat: string,
): StoredAssistantUiMessage<TStorageFormat> | null {
  if (!isRecord(params)) return null;
  const candidate = params.assistant_ui;
  if (!isRecord(candidate)) return null;
  if (candidate.version !== 1 || candidate.format !== expectedFormat) return null;
  if (!isRecord(candidate.content)) return null;

  return {
    version: 1,
    format: String(candidate.format),
    client_id: typeof candidate.client_id === "string" ? candidate.client_id : undefined,
    parent_client_id:
      typeof candidate.parent_client_id === "string" || candidate.parent_client_id === null
        ? candidate.parent_client_id
        : undefined,
    parent_id:
      typeof candidate.parent_id === "string" || candidate.parent_id === null
        ? candidate.parent_id
        : undefined,
    content: candidate.content as TStorageFormat,
  };
}

function toLegacyUiMessage(row: AgentMessageRow): UIMessage {
  const textParts = [row.content, imageMarkdown(row.images), generationMarkdown(row.generation)]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join("\n\n");

  return {
    id: row.id,
    role: readLegacyRole(row.role),
    parts: [{ type: "text", text: textParts }],
  };
}

function imageMarkdown(images: unknown) {
  const urls = readImageUrls(images);
  if (urls.length === 0) return "";
  return urls.map((url, index) => `![Image ${index + 1}](${url})`).join("\n");
}

function generationMarkdown(generation: unknown) {
  if (!isRecord(generation)) return "";
  const urls = Array.isArray(generation.resultUrls)
    ? generation.resultUrls.filter((url): url is string => typeof url === "string" && url.length > 0)
    : [];
  if (urls.length === 0) return "";
  return urls.map((url, index) => `![Result ${index + 1}](${url})`).join("\n");
}

function readImageUrls(images: unknown) {
  if (!Array.isArray(images)) return [];
  return images
    .map((image) => {
      if (typeof image === "string") return image;
      if (!isRecord(image)) return "";
      return typeof image.url === "string"
        ? image.url
        : typeof image.hostedUrl === "string"
          ? image.hostedUrl
          : "";
    })
    .filter((url) => url.length > 0);
}

function readLegacyRole(role: unknown): UIMessage["role"] {
  if (role === "assistant" || role === "system") return role;
  return "user";
}

function readRole(encoded: Record<string, unknown>) {
  const role = encoded.role;
  if (role === "assistant" || role === "system" || role === "user") return role;
  return "assistant";
}

function extractMessageText(encoded: Record<string, unknown>) {
  const parts = Array.isArray(encoded.parts) ? encoded.parts : [];
  const text = parts
    .map((part) => (isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();

  if (text) return text;
  return typeof encoded.content === "string" ? encoded.content : "";
}

const wanxiangAttachmentAdapter: AttachmentAdapter = {
  accept: "image/png,image/jpeg,image/webp",
  async *add({ file }) {
    if (!file.type.startsWith("image/")) {
      throw new Error("Only image attachments are supported in Agent chat.");
    }

    const id = crypto.randomUUID();
    const baseAttachment = {
      id,
      type: file.type.startsWith("image/") ? "image" : "file",
      name: file.name,
      file,
      contentType: file.type,
      content: [],
    } satisfies Omit<PendingAttachment, "status">;

    const uploadTask = uploadAgentAttachmentImage(file);
    pendingAttachmentUploads.set(id, uploadTask);

    yield {
      ...baseAttachment,
      status: { type: "running", reason: "uploading", progress: 0.2 },
    };

    try {
      await uploadTask;
      yield {
        ...baseAttachment,
        status: { type: "requires-action", reason: "composer-send" },
      };
    } catch (error) {
      pendingAttachmentUploads.delete(id);
      console.warn("[assistant-ui] attachment upload failed", error);
      yield {
        ...baseAttachment,
        status: { type: "incomplete", reason: "error" },
      };
    }
  },
  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    if (!attachment.file.type.startsWith("image/")) {
      throw new Error("Only image attachments are supported in Agent chat.");
    }

    const url = await getUploadedAttachmentUrl(attachment);
    const role = getAttachmentRole(attachment.id);
    clearAttachmentRole(attachment.id);
    const imagePart = {
      type: "image" as const,
      image: url,
      filename: attachment.name,
      mediaType: attachment.file.type,
      role,
    } as CompleteAttachment["content"][number] & { role: typeof role };

    return {
      ...attachment,
      status: { type: "complete" },
      content: [imagePart] as CompleteAttachment["content"],
    };
  },
  async remove(attachment: Attachment) {
    clearAttachmentRole(attachment.id);
    pendingAttachmentUploads.delete(attachment.id);
  },
};

const pendingAttachmentUploads = new Map<string, Promise<string>>();

async function uploadAgentAttachmentImage(file: File) {
  const compressed = await compressImageForAgent(file);
  const uploaded = await uploadImage(compressed);
  const url = uploaded.url || uploaded.display_url;
  if (!url) throw new Error("Image upload did not return a URL.");
  return url;
}

async function getUploadedAttachmentUrl(attachment: PendingAttachment) {
  const existing = pendingAttachmentUploads.get(attachment.id);
  if (existing) {
    try {
      return await existing;
    } finally {
      pendingAttachmentUploads.delete(attachment.id);
    }
  }

  const content = Array.isArray(attachment.content) ? attachment.content : [];
  const imageUrl = content.map(readAttachmentContentImageUrl).find(Boolean);
  if (imageUrl) return imageUrl;

  return uploadAgentAttachmentImage(attachment.file);
}

function readAttachmentContentImageUrl(part: unknown) {
  if (!isRecord(part)) return "";
  if (part.type === "image" && typeof part.image === "string") return part.image;
  if (part.type === "file" && typeof part.url === "string") return part.url;
  return "";
}

function createWanxiangFeedbackAdapter({
  getRemoteId,
  getMessages,
}: {
  getRemoteId: () => string | undefined;
  getMessages: () => readonly ThreadMessage[];
}): FeedbackAdapter {
  return {
    submit({ message, type }) {
      try {
        if (message.role !== "assistant") return;
        const conversationId = getRemoteId();
        if (!conversationId) return;

        const payload = buildAgentFeedbackPayload({
          conversationId,
          messageId: toRequiredDbMessageId(conversationId, message.id),
          type,
          traceId: extractTraceIdFromMetadata(message.metadata),
          ...buildAgentFeedbackContext(getMessages(), message.id),
        });

        void requestJson("/api/agent/feedback", {
          method: "POST",
          body: JSON.stringify(payload),
        }).catch((error) => {
          console.warn("[assistant-ui] failed to submit feedback", error);
        });
      } catch (error) {
        console.warn("[assistant-ui] failed to build feedback payload", error);
      }
    },
  };
}

function extractPersistedImages(encoded: Record<string, unknown>) {
  const parts = Array.isArray(encoded.parts) ? encoded.parts : [];
  return parts
    .map((part, index) => {
      if (!isRecord(part)) return null;
      if (part.type === "file" && typeof part.url === "string" && String(part.mediaType || "").startsWith("image/")) {
        return {
          index: index + 1,
          url: part.url,
          hostedUrl: part.url,
          fileName: typeof part.filename === "string" ? part.filename : undefined,
          role: typeof part.role === "string" ? part.role : "auto",
        };
      }
      if (part.type === "image" && typeof part.image === "string") {
        return {
          index: index + 1,
          url: part.image,
          hostedUrl: part.image,
          fileName: typeof part.filename === "string" ? part.filename : undefined,
          role: typeof part.role === "string" ? part.role : "auto",
        };
      }
      return null;
    })
    .filter(Boolean);
}

function makeThreadTitle(messages: readonly ThreadMessage[]) {
  const firstUserText =
    messages.find((message) => message.role === "user")?.content.map(readThreadTextPart).join("").trim() || "";
  return normalizeTitle(firstUserText) || "\u65b0\u5bf9\u8bdd";
}

function readThreadTextPart(part: ThreadMessage["content"][number]) {
  return part.type === "text" ? part.text : "";
}

function normalizeTitle(value: unknown) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text) return "\u65b0\u5bf9\u8bdd";
  return text.length > 26 ? `${text.slice(0, 26)}...` : text;
}

function isUntitledConversationTitle(value: unknown) {
  const title = typeof value === "string" ? value.trim() : "";
  return !title || title === "\u65b0\u5bf9\u8bdd" || title === "New chat" || title === "Untitled";
}

function readAttachmentRole(attachment: Pick<Attachment, "content">) {
  for (const part of attachment.content || []) {
    const role = readPartRole(part);
    if (role) return role;
  }
  return "auto";
}

function readPartRole(part: unknown) {
  if (!isRecord(part)) return undefined;
  return typeof part.role === "string" ? part.role : undefined;
}

function readPartMediaType(part: unknown) {
  if (!isRecord(part)) return undefined;
  return typeof part.mediaType === "string"
    ? part.mediaType
    : typeof part.mimeType === "string"
      ? part.mimeType
      : undefined;
}

async function requestJson<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string" ? body.error : response.statusText;
    throw new ApiError(message || "Request failed", response.status);
  }

  return body as T;
}

function toDbMessageId(conversationId: string, messageId: string | null | undefined) {
  if (!messageId) return null;
  if (UUID_RE.test(messageId)) return messageId.toLowerCase();
  return stableUuid(`${conversationId}:${messageId}`);
}

function toRequiredDbMessageId(conversationId: string, messageId: string) {
  const dbMessageId = toDbMessageId(conversationId, messageId);
  if (!dbMessageId) throw new Error("Message id is required");
  return dbMessageId;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stableUuid(input: string) {
  const hash = cyrb128(input).map(toUint32Hex).join("");
  const normalized = `${hash.slice(0, 12)}5${hash.slice(13, 16)}${((Number.parseInt(hash[16], 16) & 3) | 8).toString(16)}${hash.slice(17, 32)}`;
  return [
    normalized.slice(0, 8),
    normalized.slice(8, 12),
    normalized.slice(12, 16),
    normalized.slice(16, 20),
    normalized.slice(20, 32),
  ].join("-");
}

function cyrb128(value: string) {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;

  for (let i = 0; i < value.length; i++) {
    const k = value.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }

  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);

  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

function toUint32Hex(value: number) {
  return value.toString(16).padStart(8, "0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
