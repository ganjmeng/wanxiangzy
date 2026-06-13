"use client";

import { create } from "zustand";
import { v4 } from "./uuid";
import type { Conversation, Message, ChatImage, GenerationParams, AgentMode, AgentIntentMode, ChatImageRole } from "@/lib/agent/types";
import { DEFAULT_PARAMS } from "@/lib/agent/types";
import { DEFAULT_CONVERSATION_TITLE, deriveConversationTitle, isDefaultConversationTitle } from "@/lib/agent/conversation-title";
import { applyConfirmImageRoles, validateConfirmImageRoles } from "@/lib/agent/confirm-role-params";
import { getCreditCost, normalizeImageSize, type AspectRatio, type ImageSize, type LingyaModel } from "@/lib/api/lingya";
import { applyRepairPrompt, type RepairKind } from "@/lib/generation-repair";
import { uploadImage, compressImageForAgent } from "@/lib/utils";
import { orderWorkflowSteps } from "@/lib/agent/workflow/order";
import type {
  PlanValidationResult,
  WorkflowAssetRecord,
  WorkflowCostEstimate,
  WorkflowEventRecord,
  WorkflowPlan,
  WorkflowRecord,
  WorkflowStatus,
  WorkflowStepPlan,
  WorkflowStepRecord,
} from "@/lib/agent/workflow/types";

// ---- DB 持久化（Supabase） ----

// ---- 类型 ----
type Store = {
  conversations: Conversation[];
  activeId: string | null;
  messages: Message[];
  inputText: string;
  inputImages: ChatImage[];
  params: GenerationParams;
  intentMode: AgentIntentMode;
  isSending: boolean;
  isAIWriting: boolean;
  sidebarOpen: boolean;
  pollTimers: Map<string, ReturnType<typeof setInterval>>;

  loadConversations: () => Promise<void>;
  openLanding: () => void;
  createConversation: () => Promise<void>;
  switchConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => void;
  setInputText: (t: string) => void;
  addImages: (files: File[]) => Promise<void>;
  removeImage: (i: number) => void;
  clearImages: () => void;
  addReferenceUrl: (url: string) => void;
  setImageRole: (index: number, role: ChatImageRole) => void;
  setParams: (p: Partial<GenerationParams>) => void;
  setIntentMode: (mode: AgentIntentMode) => void;
  setSidebarOpen: (v: boolean) => void;
  receiveAgentEvent: (event: Record<string, unknown>) => void;
  sendMessage: () => Promise<void>;
  aiWrite: () => Promise<void>;
  retryMessage: (id: string) => void;
  confirmGeneration: (messageId: string) => Promise<void>;
  confirmWorkflow: (messageId: string) => Promise<void>;
  cancelWorkflow: (messageId: string) => Promise<void>;
  retryWorkflowStep: (messageId: string, stepId: string) => Promise<void>;
  skipWorkflowStep: (messageId: string, stepId: string) => Promise<void>;
  selectWorkflowStepImage: (messageId: string, stepId: string, selectedImageUrl: string) => Promise<void>;
  editWorkflowStep: (messageId: string, stepId: string, patch: { title?: string; params?: Record<string, unknown>; input?: Record<string, unknown> }) => Promise<void>;
  updateConfirmParams: (messageId: string, params: Partial<GenerationParams>) => void;
  updateConfirmImageRole: (messageId: string, imageIndex: number, role: ChatImageRole) => void;
  sendFeedback: (messageId: string, rating: "good" | "bad", reason?: string, tags?: string[]) => Promise<void>;
  repairGeneration: (messageId: string, repairValue: string) => void;
  reset: () => void;
};

type WorkflowClientPayload = {
  workflow: WorkflowRecord;
  steps: WorkflowStepRecord[];
  events: WorkflowEventRecord[];
  assets: WorkflowAssetRecord[];
  validation?: PlanValidationResult;
  costEstimate?: WorkflowCostEstimate;
  plan?: WorkflowPlan;
};

type WorkflowPlanApiResponse = {
  ok?: boolean;
  plan?: WorkflowPlan;
  validation?: PlanValidationResult;
  costEstimate?: WorkflowCostEstimate;
  error?: string;
};

// ---- 工具 ----
function revoke(urls: string[]) {
  if (typeof window === "undefined") return;
  for (const u of urls) if (u.startsWith("blob:")) URL.revokeObjectURL(u);
}

/**
 * 清理 generation 对象后持久化到 DB
 * 保留 _confirmData（用户未确认时需要它来重新显示确认按钮）
 */
function sanitizeGenerationForDB(gen: unknown): Record<string, unknown> | null {
  if (!gen || typeof gen !== "object") return null;
  const g = gen as Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  if (g.status) clean.status = g.status;
  if (typeof g.progress === "number") clean.progress = g.progress;
  if (Array.isArray(g.resultUrls)) clean.resultUrls = g.resultUrls;
  if (g.error) clean.error = g.error;
  if (g.generationId) clean.generationId = g.generationId;
  if (g.creditsUsed) clean.creditsUsed = g.creditsUsed;
  if (g.module) clean.module = g.module;
  // 保留确认数据（pending 状态需要，completed/failed 时清理）
  if (g._confirmData && g.status === "pending") {
    clean._confirmData = g._confirmData;
  }
  if (g._lastRunData) {
    clean._lastRunData = g._lastRunData;
  }
  return Object.keys(clean).length > 0 ? clean : null;
}

/** 保存消息到 DB */
function saveMessage(convId: string, msg: { id?: string; role: string; content: string; images?: ChatImage[]; generation?: unknown; params?: Record<string, unknown>; mode?: string }) {
  console.log("[agent-store] saveMessage:", { convId, role: msg.role, contentLen: msg.content.length, hasGeneration: !!msg.generation });
  fetch(`/api/conversations/${convId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      images: msg.images || [],
      generation: sanitizeGenerationForDB(msg.generation),
      params: msg.params || {},
      mode: msg.mode || "agent",
    }),
  }).catch((err) => console.error("[agent-store] saveMessage failed:", err));
}

/** 更新消息的 generation 状态 */
function updateMessageGeneration(convId: string, messageId: string, generation: unknown) {
  const clean = sanitizeGenerationForDB(generation);
  console.log("[agent-store] updateMessageGeneration:", { messageId, status: (clean as Record<string, unknown>)?.status });
  fetch(`/api/conversations/${convId}/messages`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageId, generation: clean }),
  }).catch((err) => console.error("[agent-store] updateMessageGeneration failed:", err));
}

function updateMessageParams(convId: string, messageId: string, params: Record<string, unknown>) {
  fetch(`/api/conversations/${convId}/messages`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageId, params }),
  }).catch((err) => console.error("[agent-store] updateMessageParams failed:", err));
}

function updateMessageImages(convId: string, messageId: string, images: ChatImage[]) {
  fetch(`/api/conversations/${convId}/messages`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageId, images }),
  }).catch((err) => console.error("[agent-store] updateMessageImages failed:", err));
}

function patchConversationList(
  conversations: Conversation[],
  convId: string,
  patch: Partial<Pick<Conversation, "title" | "updated_at" | "images">>,
) {
  const updatedAt = patch.updated_at || new Date().toISOString();
  return conversations
    .map((conversation) =>
      conversation.id === convId ? { ...conversation, ...patch, updated_at: updatedAt } : conversation
    )
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

function inferDefaultImageRole(index: number): ChatImageRole {
  if (index === 1) return "clothing";
  if (index === 2) return "reference";
  if (index === 3) return "face";
  return "auto";
}

function getNextImageIndex(images: ChatImage[]) {
  return Math.max(0, ...images.map((image) => Number(image.index) || 0)) + 1;
}

function readSavedIntentMode(): AgentIntentMode {
  return "smart";
}

// ---- Store ----
export const useAgentStore = create<Store>((set, get) => ({
  conversations: [],
  activeId: null,
  messages: [],
  inputText: "",
  inputImages: [],
  params: { ...DEFAULT_PARAMS },
  intentMode: readSavedIntentMode(),
  isSending: false,
  isAIWriting: false,
  sidebarOpen: false,

  // ======== 对话管理 ========
  loadConversations: async () => {
    try {
      const res = await fetch("/api/conversations");
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      set({ conversations: data });
    } catch {}
  },

  openLanding: () => {
    revoke(get().inputImages.map((img) => img.url));
    set({
      activeId: null,
      messages: [],
      inputText: "",
      inputImages: [],
      intentMode: "smart",
      isSending: false,
      isAIWriting: false,
    });
  },

  createConversation: async () => {
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: DEFAULT_CONVERSATION_TITLE, mode: "agent" }),
      });
      if (!res.ok) return;
      const conv = await res.json();
      set((s) => ({
        conversations: [conv, ...s.conversations],
        activeId: conv.id,
        messages: [],
        inputText: "",
        inputImages: [],
        intentMode: "smart",
      }));
    } catch {}
  },

  switchConversation: async (id: string) => {
    set({ activeId: id, messages: [], inputText: "", inputImages: [], isSending: false });
    const conv = get().conversations.find((c) => c.id === id);
    if (conv && Array.isArray(conv.images)) {
      set({ inputImages: conv.images });
    }
    // 从 DB 加载消息
    try {
      const res = await fetch(`/api/conversations/${id}/messages`);
      if (res.ok) {
        const dbMessages = await res.json();
        if (Array.isArray(dbMessages)) {
          set({ messages: dbMessages });
          resumeGenerationPolling(get, set, id, dbMessages);
        }
      }
    } catch {}
  },

  deleteConversation: (id: string) => {
    fetch(`/api/conversations/${id}`, { method: "DELETE" }).catch((err) => console.error("[agent-store] deleteConversation failed:", err));
    set((s) => {
      const convs = s.conversations.filter((c) => c.id !== id);
      if (s.activeId !== id) return { conversations: convs };
      revoke(s.inputImages.map((img) => img.url));
      return {
        conversations: convs,
        activeId: null,
        messages: [],
        inputText: "",
        inputImages: [],
        isSending: false,
        isAIWriting: false,
      };
    });
  },

  // ======== 输入 ========
  setInputText: (t) => set({ inputText: t }),

  addImages: async (files: File[]) => {
    const current = get().inputImages;
    const start = getNextImageIndex(current) - 1;
    const placeholders: ChatImage[] = files.map((f, i) => ({
      index: start + i + 1,
      url: URL.createObjectURL(f),
      fileName: f.name,
      role: inferDefaultImageRole(start + i + 1),
      uploading: true,
    }));
    set((s) => ({ inputImages: [...s.inputImages, ...placeholders] }));

    for (let i = 0; i < files.length; i++) {
      try {
        const compressed = await compressImageForAgent(files[i]);
        const result = await uploadImage(compressed);
        set((s) => ({
          inputImages: s.inputImages.map((img) =>
            img.index === placeholders[i].index ? { ...img, hostedUrl: result.url, uploading: false } : img
          ),
        }));
      } catch {
        set((s) => ({
          inputImages: s.inputImages.map((img) =>
            img.index === placeholders[i].index
              ? { ...img, uploading: false, uploadError: "上传失败，请移除后重新上传" }
              : img
          ),
        }));
      }
    }
    // 持久化图片到对话（用 hostedUrl 替代 blob URL）
    const { activeId, inputImages } = get();
    if (activeId) {
      const persisted = inputImages
        .filter((img) => !img.uploadError)
        .map((img) => ({
          ...img,
          url: img.hostedUrl || img.url,
        }));
      fetch(`/api/conversations/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: persisted }),
      }).catch((err) => console.error("[agent-store] persistImages failed:", err));
    }
  },

  removeImage: (index: number) => {
    let nextImages: ChatImage[] = [];
    set((s) => {
      const removed = s.inputImages[index];
      if (removed?.url?.startsWith("blob:")) URL.revokeObjectURL(removed.url);
      nextImages = s.inputImages.filter((_, i) => i !== index);
      return { inputImages: nextImages };
    });
    const { activeId } = get();
    if (activeId) {
      fetch(`/api/conversations/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: nextImages }),
      }).catch((err) => console.error("[agent-store] removeImage persist failed:", err));
    }
  },

  clearImages: () => {
    const { activeId, inputImages } = get();
    revoke(inputImages.map((img) => img.url));
    set({ inputImages: [] });
    if (activeId) {
      fetch(`/api/conversations/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: [] }),
      }).catch((err) => console.error("[agent-store] clearImages persist failed:", err));
    }
  },

  setImageRole: (index: number, role: ChatImageRole) => {
    set((s) => ({
      inputImages: s.inputImages.map((img) => img.index === index ? { ...img, role } : img),
    }));
    const { activeId, inputImages } = get();
    if (activeId) {
      const persisted = inputImages.map((img) => img.index === index ? { ...img, role } : img);
      fetch(`/api/conversations/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: persisted }),
      }).catch((err) => console.error("[agent-store] setImageRole persist failed:", err));
    }
  },

  /** 将远程 URL 直接加入图片托盘（用于"用作参考图"） */
  addReferenceUrl: (url: string) => {
    if (!url) return;
    set((s) => ({
      inputImages: [
        ...s.inputImages,
        {
          index: getNextImageIndex(s.inputImages),
          url,
          hostedUrl: url,
          fileName: "参考图",
          role: "reference",
          uploading: false,
        },
      ],
    }));
  },

  setParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
  setIntentMode: (mode) => {
    set({ intentMode: mode });
  },
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  receiveAgentEvent: (event: Record<string, unknown>) => {
    const kind = typeof event.kind === "string" ? event.kind : "";
    if (!kind) return;
    set((s) => {
      const targetIndex = findLatestAssistantMessageIndex(s.messages);
      if (targetIndex < 0) return {};
      const messages = s.messages.map((message, index) => {
        if (index !== targetIndex) return message;
        const liveEvents = Array.isArray(message.params?.agentLiveEvents)
          ? message.params.agentLiveEvents as Record<string, unknown>[]
          : [];
        return {
          ...message,
          params: {
            ...(message.params || {}),
            agentLiveEvents: [...liveEvents, event].slice(-30),
            ...(message.params?.showAgentTimeline === true
              ? { agentTimeline: mergeTimelineWithBackendEvent(readTimelineFromParams(message.params), event) }
              : {}),
          },
        };
      });
      return { messages };
    });
  },

  // ======== 核心：发送消息 ========
  sendMessage: async () => {
    const { inputText, inputImages, params, intentMode, activeId } = get();
    const trimmed = inputText.trim();
    if (!trimmed && inputImages.length === 0) return;
    if (inputImages.some((image) => image.uploading || image.uploadError)) return;

    // 确保有对话
    let convId = activeId;
    if (!convId) {
      await get().createConversation();
      convId = get().activeId;
      if (!convId) return;
    }

    // 快照图片（保留在托盘中），只清空文字
    const currentImages = [...inputImages];
    set({ inputText: "", isSending: true });
    const conversationPatch: Partial<Pick<Conversation, "title" | "updated_at" | "images">> = {
      updated_at: new Date().toISOString(),
    };

    // 持久化图片
    if (currentImages.length > 0) {
      conversationPatch.images = currentImages;
      fetch(`/api/conversations/${convId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: currentImages }),
      }).catch((err) => console.error("[agent-store] sendMessage persistImages failed:", err));
    }

    // 更新对话标题：新建后发送时必须用最新 store 快照，避免侧边栏一直显示"新对话"
    const conv = get().conversations.find((c) => c.id === convId);
    if (!conv || isDefaultConversationTitle(conv.title)) {
      const title = deriveConversationTitle(trimmed, currentImages);
      conversationPatch.title = title;
      fetch(`/api/conversations/${convId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      }).catch((err) => console.error("[agent-store] sendMessage updateTitle failed:", err));
    }
    set((s) => ({
      conversations: patchConversationList(s.conversations, convId, conversationPatch),
    }));

    // 用户消息（图片 URL 永久化：优先用 hostedUrl）
    const persistedImages: ChatImage[] = currentImages.map((img) => ({
      ...img,
      url: img.hostedUrl || img.url, // 优先 imgbb URL，blob URL 仅作最后 fallback
    }));

    const userMsg: Message = {
      id: uid(), conversation_id: convId, role: "user", content: trimmed,
      images: persistedImages, generation: null, params: {}, mode: "agent",
      created_at: new Date().toISOString(),
    };
    const showPlanningTimeline = shouldShowPlanningTimeline(trimmed, currentImages.length, intentMode);
    const timelineProfile = createAgentTimelineProfile(trimmed, currentImages.length);

    // AI 消息占位
    const aiMsg: Message = {
      id: uid(), conversation_id: convId, role: "assistant", content: "",
      images: [], generation: null, params: showPlanningTimeline ? {
        showAgentTimeline: true,
        agentTimeline: timelineProfile.initial,
      } : {}, mode: "agent",
      created_at: new Date().toISOString(),
    };

    set((s) => ({ messages: [...s.messages, userMsg, aiMsg] }));
    if (showPlanningTimeline) {
      timelineProfile.advances.forEach((advance) => {
        window.setTimeout(() => {
          set((s) => ({
            messages: s.messages.map((m) =>
              m.id === aiMsg.id && m.params?.showAgentTimeline === true
                ? { ...m, params: { ...(m.params || {}), agentTimeline: runningAgentTimeline(readTimelineFromParams(m.params), advance.label, advance.detail) } }
                : m
            ),
          }));
        }, advance.delayMs);
      });
    }

    // 保存用户消息
    saveMessage(convId, { id: userMsg.id, role: "user", content: trimmed, images: persistedImages, mode: "agent" });

    try {
      // 当前上传的图片
      let imageUrls = currentImages.map((img) => ({
        index: img.index,
        url: img.hostedUrl || img.url,
        role: img.role || "auto",
        fileName: img.fileName,
      })).filter((img) => img.url);

      const history = get().messages
        .filter((m) => m.id !== userMsg.id && m.id !== aiMsg.id)
        .slice(-10)
        .map((m) => ({
          role: m.role,
          content: m.content || (m.generation?.resultUrls?.length ? `[生成了 ${m.generation.resultUrls.length} 张图片]` : ""),
        }));

      const workflowPayload = await maybeCreateWorkflowMessage({
        convId,
        userMessageId: userMsg.id,
        message: trimmed,
        images: imageUrls,
        history,
        intentMode,
        params,
      });

      if (workflowPayload) {
        const reply = buildWorkflowReply(workflowPayload);
      const workflowParams = {
        workflow: workflowPayload,
        showAgentTimeline: false,
        agentTimeline: completeAgentTimeline("已拆解成可执行 workflow，等待确认。"),
      };
        set((s) => ({
          isSending: false,
          messages: s.messages.map((m) =>
            m.id === aiMsg.id
              ? { ...m, content: reply, streamingDone: true, params: workflowParams }
              : m
          ),
        }));
        saveMessage(convId, {
          id: aiMsg.id,
          role: "assistant",
          content: reply,
          params: workflowParams,
          mode: "agent",
        });
        return;
      }

      if (showPlanningTimeline) {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === aiMsg.id
              ? { ...m, params: { ...(m.params || {}), agentTimeline: runningAgentTimeline(readTimelineFromParams(m.params), "选择工具", "已进入 Agent Brain 多工具循环，正在匹配最稳的执行路径") } }
              : m
          ),
        }));
      }

      // 调用统一 Agent API
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: convId,
          message: trimmed,
          images: imageUrls,
          history,
          intentMode,
          params: { model: params.model, aspectRatio: params.aspectRatio, imageSize: params.imageSize, count: params.count },
          lastTask: getLastAgentTaskContext(get().messages),
        }),
      });

      const data = await res.json();
      const reply = typeof data.reply === "string" ? data.reply : "处理完成。";
      const traceParams: Record<string, unknown> = {
        ...(typeof data.trace_id === "string" ? { traceId: data.trace_id } : {}),
        showAgentTimeline: false,
      };
      if (showPlanningTimeline || data.action === "confirm_generate") {
        traceParams.agentTimeline = completeAgentTimeline(data.action === "confirm_generate" ? "已生成确认卡，等待你确认后执行。" : "已完成理解和回复。");
      }

      console.log("[agent-store] sendMessage response:", {
        action: data.action,
        module: data.module,
        module_label: data.module_label,
        api_path: data.api_path,
        credits_cost: data.credits_cost,
        replyLen: reply.length,
        hasImages: imageUrls.length > 0,
      });

      if (data.action === "confirm_generate" && data.api_path) {
        // 生图任务：显示确认卡片（需要用户确认后才扣灵点执行）
        set((s) => ({
          isSending: false,
          messages: s.messages.map((m) =>
            m.id === aiMsg.id ? {
              ...m,
              content: reply,
              streamingDone: true,
              params: traceParams,
              generation: {
                status: "pending" as const,
                progress: 0,
                resultUrls: [],
                module: data.module_label || data.module,
                creditsUsed: data.credits_cost,
                // 存储待确认的参数
                _confirmData: {
                  apiPath: data.api_path,
                  module: data.module,
                  params: data.generation_params,
                  jobPayload: data.job_payload,
                  creditsCost: data.credits_cost,
                  taskBrief: data.task_brief,
                },
              },
            } : m
          ),
        }));

        // 保存 AI 消息（含 generation 数据）
        const confirmGen = get().messages.find((m) => m.id === aiMsg.id)?.generation;
        saveMessage(convId, { id: aiMsg.id, role: "assistant", content: reply, generation: confirmGen || null, params: traceParams, mode: "agent" });
      } else {
        // 对话回复
        set((s) => ({
          isSending: false,
          messages: s.messages.map((m) =>
            m.id === aiMsg.id ? { ...m, content: reply, streamingDone: true, params: traceParams } : m
          ),
        }));
        saveMessage(convId, { id: aiMsg.id, role: "assistant", content: reply, params: traceParams, mode: "agent" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "处理失败";
      const errorParams: Record<string, unknown> = { agentError: msg };
      set((s) => ({
        isSending: false,
        messages: s.messages.map((m) =>
          m.id === aiMsg.id ? { ...m, content: msg, streamingDone: true, generation: null, params: { ...(m.params || {}), ...errorParams } } : m
        ),
      }));
      saveMessage(convId, { id: aiMsg.id, role: "assistant", content: msg, params: errorParams, mode: "agent" });
    }
  },

  // ======== AI 帮写 ========
  aiWrite: async () => {
    const { inputImages } = get();
    if (inputImages.length === 0) return;
    const urls = inputImages.map((img) => img.hostedUrl || img.url).filter(Boolean);
    if (urls.length === 0) return;

    set({ isAIWriting: true });
    try {
      const res = await fetch("/api/agent/ai-write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: urls, currentPrompt: get().inputText }),
      });
      const data = await res.json();
      if (data.optimizedPrompt) set({ inputText: data.optimizedPrompt });
    } catch {}
    set({ isAIWriting: false });
  },

  // ======== 重试 ========
  retryMessage: (id: string) => {
    const { messages } = get();
    const idx = messages.findIndex((m) => m.id === id);
    if (idx < 0) return;
    const target = messages[idx];
    const lastRun = target?.generation?._lastRunData;
    if (target?.role === "assistant" && lastRun) {
      const normalizedParams = normalizeConfirmRunParams(lastRun.params);
      const creditsCost = calculateConfirmCredits(normalizedParams);
      const nextConfirmData = {
        ...lastRun,
        params: writeConfirmParams(lastRun.params, normalizedParams),
        jobPayload: writeConfirmPayloadParams(lastRun.jobPayload, normalizedParams),
        creditsCost,
      };
      let updatedGeneration: unknown = null;
      set((s) => ({
        messages: s.messages.map((m) => {
          if (m.id !== id || !m.generation) return m;
          const generation = {
            ...m.generation,
            status: "pending" as const,
            progress: 0,
            resultUrls: [],
            error: undefined,
            generationId: undefined,
            creditsUsed: creditsCost,
            _confirmData: nextConfirmData,
            _lastRunData: lastRun,
          };
          updatedGeneration = generation;
          return { ...m, generation };
        }),
      }));
      if (updatedGeneration) updateMessageGeneration(target.conversation_id, id, updatedGeneration);
      return;
    }
    if (idx < 1) return;
    const userMsg = messages[idx - 1];
    if (userMsg.role !== "user") return;
    set({ inputText: userMsg.content, inputImages: userMsg.images || [] });
    get().sendMessage();
  },

  // ======== 确认生图（用户确认后才扣灵点执行） ========
  updateConfirmParams: (messageId: string, patch: Partial<GenerationParams>) => {
    let updatedGeneration: unknown = null;
    let convId = "";
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== messageId || !m.generation?._confirmData) return m;
        convId = m.conversation_id;
        const current = readConfirmParams(m.generation._confirmData.params);
        const nextModel = patch.model || current.model;
        const nextRatio = patch.aspectRatio || current.aspectRatio;
        const nextSize = normalizeImageSize(nextModel, patch.imageSize || current.imageSize, nextRatio);
        const nextCount = Math.min(Math.max(Number(patch.count ?? current.count) || 1, 1), 4);
        const nextPrompt = patch.prompt ?? current.prompt;
        const nextCost = calculateConfirmCredits({
          model: nextModel,
          aspectRatio: nextRatio,
          imageSize: nextSize,
          count: nextCount,
          prompt: nextPrompt,
        });
        const nextParams = writeConfirmParams(m.generation._confirmData.params, {
          model: nextModel,
          aspectRatio: nextRatio,
          imageSize: nextSize,
          count: nextCount,
          prompt: nextPrompt,
        });
        const nextJobPayload = writeConfirmPayloadParams(m.generation._confirmData.jobPayload, {
          model: nextModel,
          aspectRatio: nextRatio,
          imageSize: nextSize,
          count: nextCount,
          prompt: nextPrompt,
        });
        const generation = {
          ...m.generation,
          creditsUsed: nextCost,
          _confirmData: {
            ...m.generation._confirmData,
            params: nextParams,
            jobPayload: nextJobPayload,
            creditsCost: nextCost,
          },
        };
        updatedGeneration = generation;
        return { ...m, generation };
      }),
    }));
    if (convId && updatedGeneration) updateMessageGeneration(convId, messageId, updatedGeneration);
  },

  updateConfirmImageRole: (messageId: string, imageIndex: number, role: ChatImageRole) => {
    let convId = "";
    let updatedGeneration: unknown = null;
    let updatedUserMessageId = "";
    let updatedUserImages: ChatImage[] = [];
    let nextTrayImages: ChatImage[] = [];

    set((s) => {
      const assistantIndex = s.messages.findIndex((m) => m.id === messageId);
      const assistant = assistantIndex >= 0 ? s.messages[assistantIndex] : null;
      if (!assistant?.generation?._confirmData) return {};

      convId = assistant.conversation_id;
      const previousUserIndex = findPreviousUserImageMessageIndex(s.messages, assistantIndex);
      const sourceImages = previousUserIndex >= 0
        ? s.messages[previousUserIndex].images || []
        : s.inputImages;
      const roleImages = sourceImages.map((img) =>
        img.index === imageIndex ? { ...img, role } : img
      );
      const { params, jobPayload } = applyConfirmImageRoles(
        assistant.generation._confirmData.module,
        assistant.generation._confirmData.params,
        assistant.generation._confirmData.jobPayload,
        roleImages
      );
      const generation = {
        ...assistant.generation,
        _confirmData: {
          ...assistant.generation._confirmData,
          params,
          jobPayload,
        },
      };

      updatedGeneration = generation;
      nextTrayImages = s.inputImages.map((img) => img.index === imageIndex ? { ...img, role } : img);

      const messages = s.messages.map((m, idx) => {
        if (idx === assistantIndex) return { ...m, generation };
        if (idx === previousUserIndex) {
          updatedUserMessageId = m.id;
          updatedUserImages = roleImages;
          return { ...m, images: roleImages };
        }
        return m;
      });

      return {
        messages,
        inputImages: nextTrayImages,
      };
    });

    if (convId && updatedGeneration) updateMessageGeneration(convId, messageId, updatedGeneration);
    if (convId && updatedUserMessageId) updateMessageImages(convId, updatedUserMessageId, updatedUserImages);
    if (convId && nextTrayImages.length) {
      fetch(`/api/conversations/${convId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: nextTrayImages }),
      }).catch((err) => console.error("[agent-store] confirmGeneration persistImages failed:", err));
    }
  },

  sendFeedback: async (messageId: string, rating: "good" | "bad", reason?: string, tags?: string[]) => {
    const msg = get().messages.find((m) => m.id === messageId);
    if (!msg || msg.role !== "assistant") return;
    const traceId = typeof msg.params?.traceId === "string" ? msg.params.traceId : undefined;
    const nextParams = {
      ...(msg.params || {}),
      feedback: {
        rating,
        status: "sending",
        reason: reason || "",
        tags: tags || [],
        updatedAt: new Date().toISOString(),
      },
    };
    set((s) => ({
      messages: s.messages.map((m) => m.id === messageId ? { ...m, params: nextParams } : m),
    }));
    updateMessageParams(msg.conversation_id, messageId, nextParams);

    try {
      const res = await fetch("/api/agent/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: msg.conversation_id,
          messageId,
          traceId,
          rating,
          reason,
          tags,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "反馈提交失败");
      const doneParams = {
        ...nextParams,
        feedback: {
          ...(nextParams.feedback as Record<string, unknown>),
          status: "saved",
          learned: Boolean(data.learned),
        },
      };
      set((s) => ({
        messages: s.messages.map((m) => m.id === messageId ? { ...m, params: doneParams } : m),
      }));
      updateMessageParams(msg.conversation_id, messageId, doneParams);
    } catch (err) {
      const failedParams = {
        ...nextParams,
        feedback: {
          ...(nextParams.feedback as Record<string, unknown>),
          status: "failed",
          error: err instanceof Error ? err.message : "反馈提交失败",
        },
      };
      set((s) => ({
        messages: s.messages.map((m) => m.id === messageId ? { ...m, params: failedParams } : m),
      }));
      updateMessageParams(msg.conversation_id, messageId, failedParams);
    }
  },

  repairGeneration: (messageId: string, repairValue: string) => {
    let convId = "";
    let updatedGeneration: unknown = null;

    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== messageId || !m.generation?._lastRunData) return m;
        convId = m.conversation_id;
        const lastRun = m.generation._lastRunData;
        const repairKind = getRepairKind(lastRun.module);
        const current = readConfirmParams(lastRun.params);
        const repairedPrompt = applyRepairPrompt(current.prompt || String(lastRun.params.prompt || ""), repairKind, repairValue);
        const nextParams = writeConfirmParams(lastRun.params, { ...current, prompt: repairedPrompt });
        const nextJobPayload = writeConfirmPayloadParams(lastRun.jobPayload, { ...current, prompt: repairedPrompt });
        const generation = {
          ...m.generation,
          status: "pending" as const,
          progress: 0,
          resultUrls: [],
          error: undefined,
          generationId: undefined,
          creditsUsed: lastRun.creditsCost,
          _confirmData: {
            ...lastRun,
            params: nextParams,
            jobPayload: nextJobPayload,
          },
        };
        updatedGeneration = generation;
        return { ...m, generation };
      }),
    }));

    if (convId && updatedGeneration) updateMessageGeneration(convId, messageId, updatedGeneration);
  },

  confirmGeneration: async (messageId: string) => {
    const { messages } = get();
    const msg = messages.find((m) => m.id === messageId);
    if (!msg?.generation?._confirmData) {
      console.warn("[agent-store] confirmGeneration: no _confirmData found for", messageId);
      return;
    }
    const convId = msg.conversation_id;

    const confirmData = msg.generation._confirmData as {
      apiPath: string;
      module: string;
      params: Record<string, unknown>;
      jobPayload: Record<string, unknown>;
      creditsCost: number;
    };
    const messageIndex = messages.findIndex((m) => m.id === messageId);
    const previousUserIndex = messageIndex >= 0 ? findPreviousUserImageMessageIndex(messages, messageIndex) : -1;
    const confirmImages = previousUserIndex >= 0 ? messages[previousUserIndex].images || [] : get().inputImages;
    const roleErrors = validateConfirmImageRoles(confirmData.module, confirmData.params, confirmImages)
      .filter((issue) => issue.severity === "error");
    if (roleErrors.length > 0) {
      const errorMessage = roleErrors.map((issue) => issue.message).join("；");
      set((s) => ({
        isSending: false,
        messages: s.messages.map((m) =>
          m.id === messageId && m.generation
            ? { ...m, generation: { ...m.generation, status: "pending" as const, error: errorMessage } }
            : m
        ),
      }));
      const blockedGen = get().messages.find((m) => m.id === messageId)?.generation;
      if (blockedGen) updateMessageGeneration(convId, messageId, blockedGen);
      return;
    }
    // 更新为 generating 状态
    set((s) => ({
      isSending: true,
      messages: s.messages.map((m) =>
        m.id === messageId && m.generation
          ? { ...m, generation: { ...m.generation, status: "generating" as const, progress: 0, _lastRunData: confirmData } }
          : m
      ),
    }));
    const generatingGen = get().messages.find((m) => m.id === messageId)?.generation;
    if (generatingGen) {
        updateMessageGeneration(convId, messageId, generatingGen);
    }

    try {
      // 调用 API 执行生成
      const res = await fetch(confirmData.apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirmData.params),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "生成失败");
      }

      // 通用生图：直接返回结果（无 generation_id）
      if (data.result_urls && data.result_urls.length > 0) {
        const verifiedResultUrls = await verifyGeneratedResultUrls(data.result_urls);
        set((s) => ({
          isSending: false,
          messages: s.messages.map((m) =>
            m.id === messageId && m.generation
              ? {
                  ...m,
                  generation: {
                    ...m.generation,
                    status: "completed" as const,
                    progress: 100,
                    resultUrls: verifiedResultUrls,
                    creditsUsed: data.credits_cost || confirmData.creditsCost,
                    _lastRunData: confirmData,
                    _confirmData: undefined,
                  },
                }
              : m
          ),
        }));
        const finalGen = get().messages.find((m) => m.id === messageId)?.generation;
        if (finalGen) updateMessageGeneration(convId, messageId, finalGen);
        return;
      }

      // 模块生图：需要轮询
      if (!data.generation_id) {
        throw new Error(data.error || "生成失败");
      }

      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === messageId && m.generation
            ? {
                ...m,
                generation: {
                  ...m.generation,
                  status: "generating" as const,
                  progress: normalizeServerProgress(data.progress, "processing_tryon"),
                  generationId: data.generation_id,
                  creditsUsed: data.credits_cost || confirmData.creditsCost,
                  _lastRunData: confirmData,
                  _confirmData: undefined,
                },
              }
            : m
        ),
      }));

      const updatedGen = get().messages.find((m) => m.id === messageId)?.generation;
      if (updatedGen) {
        updateMessageGeneration(convId, messageId, updatedGen);
      }

      pollGeneration(get, set, messageId, convId, data.generation_id);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "生成失败";
      set((s) => ({
        isSending: false,
        messages: s.messages.map((m) =>
          m.id === messageId && m.generation
            ? { ...m, generation: { ...m.generation, status: "failed" as const, error: errMsg, _lastRunData: confirmData, _confirmData: undefined } }
            : m
        ),
      }));
      const failedGen = get().messages.find((m) => m.id === messageId)?.generation;
      if (failedGen) updateMessageGeneration(convId, messageId, failedGen);
    }
  },

  confirmWorkflow: async (messageId: string) => {
    const { messages } = get();
    const msg = messages.find((m) => m.id === messageId);
    const payload = getWorkflowPayload(msg?.params);
    const workflowId = payload?.workflow.id;
    if (!msg || !payload || !workflowId) return;

    set((s) => ({
      isSending: true,
      messages: s.messages.map((m) =>
        m.id === messageId
          ? { ...m, params: { ...(m.params || {}), workflow: markWorkflowStatus(payload, "queued") } }
          : m
      ),
    }));

    try {
      const res = await fetch(`/api/agent/workflows/${workflowId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoRun: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "确认 workflow 失败");

      const nextPayload = normalizeWorkflowPayload(data) || markWorkflowStatus(payload, "queued");
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === messageId
            ? { ...m, params: { ...(m.params || {}), workflow: nextPayload } }
            : m
        ),
      }));
      updateMessageParams(msg.conversation_id, messageId, { ...(msg.params || {}), workflow: nextPayload });
      pollWorkflow(get, set, messageId, msg.conversation_id, workflowId);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "确认 workflow 失败";
      const failedPayload = {
        ...payload,
        workflow: {
          ...payload.workflow,
          status: "failed" as WorkflowStatus,
          error_message: errorMessage,
        },
      };
      set((s) => ({
        isSending: false,
        messages: s.messages.map((m) =>
          m.id === messageId
            ? { ...m, params: { ...(m.params || {}), workflow: failedPayload } }
            : m
        ),
      }));
      updateMessageParams(msg.conversation_id, messageId, { ...(msg.params || {}), workflow: failedPayload });
    }
  },

  cancelWorkflow: async (messageId: string) => {
    const msg = get().messages.find((m) => m.id === messageId);
    const payload = getWorkflowPayload(msg?.params);
    const workflowId = payload?.workflow.id;
    if (!msg || !payload || !workflowId) return;

    const optimisticPayload = markWorkflowStatus(payload, "cancelled");
    clearPollTimer(get, set, `workflow:${workflowId}`);
    set((s) => ({
      isSending: false,
      messages: s.messages.map((m) =>
        m.id === messageId
          ? { ...m, params: { ...(m.params || {}), workflow: optimisticPayload } }
          : m
      ),
    }));
    updateMessageParams(msg.conversation_id, messageId, { ...(msg.params || {}), workflow: optimisticPayload });

    try {
      const res = await fetch(`/api/agent/workflows/${workflowId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "取消 workflow 失败");
      const nextPayload = normalizeWorkflowPayload(data) || optimisticPayload;
      set((s) => ({
        isSending: false,
        messages: s.messages.map((m) =>
          m.id === messageId
            ? { ...m, params: { ...(m.params || {}), workflow: nextPayload } }
            : m
        ),
      }));
      const currentParams = get().messages.find((m) => m.id === messageId)?.params || {};
      updateMessageParams(msg.conversation_id, messageId, { ...currentParams, workflow: nextPayload });
    } catch (err) {
      const syncedPayload = {
        ...optimisticPayload,
        workflow: {
          ...optimisticPayload.workflow,
          error_message: `已在本地取消，服务端同步失败：${err instanceof Error ? err.message : "未知错误"}`,
        },
      };
      set((s) => ({
        isSending: false,
        messages: s.messages.map((m) =>
          m.id === messageId
            ? { ...m, params: { ...(m.params || {}), workflow: syncedPayload } }
            : m
        ),
      }));
      const currentParams = get().messages.find((m) => m.id === messageId)?.params || {};
      updateMessageParams(msg.conversation_id, messageId, { ...currentParams, workflow: syncedPayload });
    }
  },

  retryWorkflowStep: async (messageId: string, stepId: string) => {
    await mutateWorkflowFromMessage(get, set, messageId, `steps/${stepId}/retry`, { poll: true });
  },

  skipWorkflowStep: async (messageId: string, stepId: string) => {
    await mutateWorkflowFromMessage(get, set, messageId, `steps/${stepId}/skip`, { poll: true });
  },

  selectWorkflowStepImage: async (messageId: string, stepId: string, selectedImageUrl: string) => {
    await mutateWorkflowFromMessage(get, set, messageId, `steps/${stepId}/select`, {
      poll: true,
      body: { selectedImageUrl },
    });
  },

  editWorkflowStep: async (messageId: string, stepId: string, patch: { title?: string; params?: Record<string, unknown>; input?: Record<string, unknown> }) => {
    await mutateWorkflowFromMessage(get, set, messageId, `steps/${stepId}/edit`, {
      poll: true,
      body: patch,
    });
  },

  // ======== 重置 ========
  reset: () => {
    get().pollTimers?.forEach((t) => clearInterval(t));
    revoke(get().inputImages.map((img) => img.url));
    set({
      messages: [], inputText: "", inputImages: [], intentMode: "smart", isSending: false,
      activeId: null, conversations: [], pollTimers: new Map(),
    });
    get().loadConversations();
  },

  pollTimers: new Map(),
}));

async function maybeCreateWorkflowMessage(args: {
  convId: string;
  userMessageId: string;
  message: string;
  images: Array<{ index: number; url: string; role: string; fileName?: string }>;
  history: Array<{ role: string; content: string }>;
  intentMode: AgentIntentMode;
  params: GenerationParams;
}): Promise<WorkflowClientPayload | null> {
  if (!shouldTryWorkflowRequest(args.message, args.images.length, args.intentMode)) return null;

  const planRes = await fetch("/api/agent/workflows/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: args.message,
      images: args.images,
      mode: args.intentMode === "create" ? "agent" : "auto",
      params: {
        model: args.params.model,
        aspectRatio: args.params.aspectRatio,
        imageSize: args.params.imageSize,
        count: args.params.count,
      },
      conversationSummary: args.history
        .map((item) => `${item.role}: ${item.content}`)
        .join("\n")
        .slice(-1800),
    }),
  }).catch(() => null);

  const planData = planRes
    ? await planRes.json().catch(() => ({})) as WorkflowPlanApiResponse
    : {} as WorkflowPlanApiResponse;
  if (planRes?.ok && shouldUseWorkflowPlan(planData, args.message, args.intentMode, args.images.length) && planData.plan) {
    return createWorkflowFromPlan(args, planData.plan, planData);
  }

  const fallbackPlan = buildClientFallbackWorkflowPlan(args);
  if (fallbackPlan) {
    return createWorkflowFromPlan(args, fallbackPlan, {
      ...planData,
      plan: fallbackPlan,
    });
  }

  if (!planRes?.ok && args.intentMode === "create") {
    throw new Error(planData.error || "我暂时没能完成任务规划，请稍后再试。");
  }
  if (!planRes?.ok || isStrongWorkflowClientRequest(args.message, args.images.length)) {
    return null;
  }

  return null;
}

async function createWorkflowFromPlan(
  args: {
    convId: string;
    userMessageId: string;
    message: string;
    images: Array<{ index: number; url: string; role: string; fileName?: string }>;
    params: GenerationParams;
  },
  plan: WorkflowPlan,
  planData: WorkflowPlanApiResponse
): Promise<WorkflowClientPayload | null> {
  const createRes = await fetch("/api/agent/workflows", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `${args.convId}:${args.userMessageId}:workflow`,
    },
    body: JSON.stringify({
      plan,
      images: args.images,
      mode: "agent",
      params: {
        model: args.params.model,
        aspectRatio: args.params.aspectRatio,
        imageSize: args.params.imageSize,
        count: args.params.count,
      },
      conversationId: args.convId,
      idempotencyKey: `${args.convId}:${args.userMessageId}:workflow`,
    }),
  });
  const createData = await createRes.json().catch(() => ({}));
  if (!createRes.ok) throw new Error(createData.error || "创建任务失败，请检查图片角色后再试。");
  return normalizeWorkflowPayload({
    ...createData,
    plan,
    validation: createData.validation || planData.validation,
    costEstimate: createData.costEstimate || planData.costEstimate,
  });
}

function buildClientFallbackWorkflowPlan(args: {
  message: string;
  images: Array<{ index: number; url: string; role: string; fileName?: string }>;
  params: GenerationParams;
}): WorkflowPlan | null {
  const text = args.message.trim();
  const imageCount = args.images.length;
  const wantsTryon = /穿上|穿到|传到|转移到|套到|换到|换装|上身|试穿|把.*衣服.*(?:穿|传|转移|套|换)|(?:穿|传|转移|套|换).*衣服|衣服.*(?:穿|传|转移|套|换)|模特.*衣服/.test(text);
  const wantsPose = /姿势|裂变|站姿|动作|pose/i.test(text);
  const wantsDetail = /详情页|商品详情|长图|卖点图|参数图|功能图|尺码图|规格图|材质图|淘宝|天猫|京东|拼多多|PDD|pdd|抖音|小红书|独立站|shopify|官网/i.test(text) && !/主图|banner|海报/.test(text);
  const wantsCreative = /主图|banner|海报|活动图|推广图|封面/.test(text);
  const wantsGeneralImage = /生成|制作|出图|设计|画|做一张|来一张|改图|重做|重新/.test(text);
  const steps: WorkflowStepPlan[] = [];
  const refs = inferClientTryonRefs(text, args.images);

  if (wantsTryon && imageCount > 0) {
    steps.push({
      id: "step_1",
      type: "tryon",
      title: "服装穿到模特身上",
      dependsOn: [],
      input: {
        personImage: refs.personImage || findClientImageRef(args.images, ["person", "reference", "source", "auto"], refs.clothingImage) || (imageCount > 1 ? `图${args.images[1].index}` : `图${args.images[0].index}`),
        clothingImage: refs.clothingImage || findClientImageRef(args.images, ["clothing", "product"], refs.personImage) || `图${args.images[0].index}`,
      },
      params: { prompt: text, count: 1 },
      expectedOutput: { imageUrls: true },
      riskNotes: ["需要检查服装结构、人物身份和身体比例。"],
    });
  }

  if (wantsPose && imageCount > 0) {
    const previous = steps[steps.length - 1];
    const separate = !/四宫格|宫格|2x2/i.test(text) || /每张|单独|独立|4\s*张|四\s*张/.test(text);
    steps.push({
      id: `step_${steps.length + 1}`,
      type: "pose_variation",
      title: separate ? "生成 4 张姿势图" : "生成四宫格姿势图",
      dependsOn: previous ? [previous.id] : [],
      input: { sourceImage: previous ? `$${previous.id}.output.imageUrls[0]` : `图${args.images[0].index}` },
      params: { prompt: text, outputMode: separate ? "separate" : "grid", count: separate ? 4 : 1 },
      expectedOutput: { imageUrls: true },
      riskNotes: ["需要检查手指、关节、脸和身体比例。"],
    });
  }

  if (wantsDetail && imageCount > 0) {
    const detailSteps = buildClientCommerceDetailSteps(args, steps.length);
    const upstream = steps[steps.length - 1];
    if (upstream) {
      detailSteps.forEach((step) => {
        if (step.type !== "commerce_detail_section") return;
        step.dependsOn = Array.from(new Set([...(step.dependsOn || []), upstream.id]));
        step.input = {
          ...step.input,
          referenceImages: [`$${upstream.id}.output.imageUrls[0]`],
        };
      });
    }
    steps.push(...detailSteps);
  }

  if (!steps.length && (wantsCreative || wantsGeneralImage)) {
    steps.push({
      id: "step_1",
      type: wantsCreative ? "commerce_creative" : imageCount > 0 ? "image_to_image" : "text_to_image",
      title: wantsCreative ? "商业视觉图" : imageCount > 0 ? "通用图生图" : "通用文生图",
      dependsOn: [],
      input: imageCount > 0 ? { referenceImages: args.images.map((img) => `图${img.index}`), sourceImages: args.images.map((img) => `图${img.index}`) } : {},
      params: { prompt: text, count: args.params.count },
      expectedOutput: { imageUrls: true },
      riskNotes: [],
    });
  }

  if (!steps.length) return null;

  return {
    intent: steps.length > 1 ? "multi_step_visual_workflow" : steps[0].type,
    summary: steps.map((step, index) => `${index + 1}. ${step.title}`).join(" -> "),
    confidence: 0.72,
    needsClarification: false,
    imageRoles: args.images.map((image, index) => ({
      ref: `图${image.index}`,
      imageIndex: image.index,
      role: normalizeClientImageRole(image.role, index),
      confidence: image.role && image.role !== "auto" ? 0.86 : 0.58,
      reason: image.role && image.role !== "auto" ? "用户已设置图片角色" : "按图片顺序和指令自动推断",
    })),
    userConstraints: [],
    assumptions: ["已根据文字和图片角色自动规划；确认前可修改图片角色或步骤。"],
    steps,
  };
}

function inferClientTryonRefs(
  text: string,
  images: Array<{ index: number; role: string }>
) {
  const hasImage = (index: number) => images.some((image) => image.index === index);
  const clothingToPerson = text.match(/图\s*(\d+)\s*(?:的)?(?:衣服|服装|裙子|上衣|裤子|外套).*?(?:穿到|穿在|给|传到|转移到|套到|换到).*?(?:图\s*(\d+))?/);
  if (clothingToPerson) {
    const clothingIndex = Number(clothingToPerson[1]);
    const personIndex = clothingToPerson[2] ? Number(clothingToPerson[2]) : NaN;
    if (hasImage(clothingIndex)) {
      return {
        clothingImage: `图${clothingIndex}`,
        personImage: Number.isFinite(personIndex) && hasImage(personIndex)
          ? `图${personIndex}`
          : findClientImageRef(images, ["person", "reference", "source", "auto"], `图${clothingIndex}`),
      };
    }
  }

  const personToClothing = text.match(/图\s*(\d+)\s*(?:的)?(?:人物|模特|人).*?(?:穿|换上|穿上|上身).*?图\s*(\d+)/);
  if (personToClothing) {
    const personIndex = Number(personToClothing[1]);
    const clothingIndex = Number(personToClothing[2]);
    if (hasImage(personIndex) && hasImage(clothingIndex)) {
      return { personImage: `图${personIndex}`, clothingImage: `图${clothingIndex}` };
    }
  }

  return {
    clothingImage: findClientImageRef(images, ["clothing", "product"]),
    personImage: findClientImageRef(images, ["person", "reference", "source", "auto"], findClientImageRef(images, ["clothing", "product"])),
  };
}

function buildClientCommerceDetailSteps(
  args: {
    message: string;
    images: Array<{ index: number; url: string; role: string; fileName?: string }>;
    params: GenerationParams;
  },
  startIndex: number
): WorkflowStepPlan[] {
  const text = args.message.trim();
  const sectionCount = inferClientCommerceSectionCount(text, args.params.count);
  const platform = inferClientCommercePlatform(text);
  const layout = inferClientCommerceLayout(text, platform);
  const mobileWidth = inferClientCommerceWidth(text, platform);
  const aspectRatio = layout === "desktop" ? "16:9" : "9:16";
  const sectionBlueprints = getClientCommerceSectionBlueprints(sectionCount, platform);
  const references = args.images.map((img) => `图${img.index}`);
  const steps: WorkflowStepPlan[] = sectionBlueprints.map((section, index) => {
    const id = `step_${startIndex + index + 1}`;
    return {
      id,
      type: "commerce_detail_section",
      title: section.title,
      dependsOn: [],
      input: { referenceImages: references },
      params: {
        prompt: text,
        platform,
        layout,
        mobileWidth,
        aspectRatio,
        imageSize: args.params.imageSize,
        sectionIndex: index + 1,
        sectionTotal: sectionCount,
        sectionTitle: section.title,
        sectionPurpose: section.purpose,
        moduleMode: "single_distinct_section",
        count: 1,
      },
      expectedOutput: { imageUrls: true },
      riskNotes: ["多张详情页图表示多个不同模块；每一步只生成当前模块，避免把全部内容挤进同一张整页。"],
    };
  });

  if (inferClientCommerceOutputMode(text) !== "sections" && steps.length > 1) {
    steps.push({
      id: `step_${startIndex + steps.length + 1}`,
      type: "commerce_detail_stitch",
      title: layout === "desktop" ? "整理详情页模块预览" : "拼接手机详情长图",
      dependsOn: steps.map((step) => step.id),
      input: { imageUrls: steps.map((step) => `$${step.id}.output.imageUrls[0]`) },
      params: {
        platform,
        layout,
        mobileWidth,
        width: mobileWidth,
        gap: 0,
        sectionHeight: layout === "desktop" ? 900 : platform === "xiaohongshu" ? 1200 : 1320,
      },
      expectedOutput: { imageUrls: true },
      riskNotes: [],
    });
  }

  return steps;
}

function inferClientCommerceSectionCount(text: string, defaultCount: number) {
  const explicit = text.match(/(\d+)\s*(?:张|个|屏|段|页|版块|板块|模块|section|sections)/i);
  const count = explicit ? Number(explicit[1]) : Number(defaultCount || 4);
  if (!Number.isFinite(count)) return 4;
  return Math.min(Math.max(Math.floor(count), 1), 8);
}

function inferClientCommercePlatform(text: string) {
  if (/拼多多|PDD|pinduoduo/i.test(text)) return "pdd";
  if (/抖音|douyin|tiktok/i.test(text)) return "douyin";
  if (/小红书|xiaohongshu|rednote|red book/i.test(text)) return "xiaohongshu";
  if (/京东|JD|jingdong/i.test(text)) return "jd";
  if (/天猫|tmall/i.test(text)) return "tmall";
  if (/淘宝|taobao/i.test(text)) return "taobao";
  if (/独立站|shopify|官网|independent/i.test(text)) return "independent";
  return "general";
}

function inferClientCommerceLayout(text: string, platform: string): "mobile" | "desktop" {
  if (/PC|pc|电脑|桌面端|横版|宽屏|官网首屏|web/i.test(text) && !/手机|移动端|竖版|长图/.test(text)) return "desktop";
  if (platform === "independent" && /官网|web|PC|pc|电脑|桌面端/i.test(text)) return "desktop";
  return "mobile";
}

function inferClientCommerceWidth(text: string, platform: string) {
  const explicit = text.match(/(?:宽度|width)\s*[:：]?\s*(\d{3,4})/i);
  if (explicit) return Math.min(Math.max(Number(explicit[1]), 320), 1440);
  if (platform === "xiaohongshu" || platform === "douyin") return 1080;
  return 750;
}

function inferClientCommerceOutputMode(text: string): "sections" | "both" {
  if (/只要.*(?:独立|分开)|不要.*(?:长图|拼接)|独立图|分开给/i.test(text)) return "sections";
  return "both";
}

function getClientCommerceSectionBlueprints(count: number, platform: string) {
  const sections = [
    { title: "首屏主视觉", purpose: "商品完整展示、核心标题和第一购买理由" },
    { title: "核心卖点", purpose: "把最重要的购买理由做成清晰可扫读的视觉层级" },
    { title: "材质细节", purpose: "展示面料、纹理、工艺、版型和触感信息" },
    { title: "场景搭配", purpose: "展示穿搭、使用场景、风格氛围或人群定位" },
    { title: "功能参数", purpose: "尺码、规格、功能、护理或商品参数" },
    { title: "对比证明", purpose: "优势对比、痛点解决和真实细节证明" },
    { title: "信任背书", purpose: "品质、服务、保障、物流或品牌可信度" },
    { title: "收尾转化", purpose: "购买理由总结、搭配建议和行动引导" },
  ];
  if (platform === "pdd") {
    sections[1] = { title: "价格与利益点", purpose: "直接突出利益点、价格感和购买理由" };
  }
  if (platform === "xiaohongshu" || platform === "douyin") {
    sections[1] = { title: "种草亮点", purpose: "用内容平台语气表达真实使用价值和记忆点" };
    sections[3] = { title: "生活方式场景", purpose: "用更自然的场景和氛围展示商品适用性" };
  }
  return sections.slice(0, count);
}

function findClientImageRef(
  images: Array<{ index: number; role: string }>,
  roles: string[],
  excludeRef?: string | null
) {
  const found = images.find((image) => roles.includes(image.role || "auto") && `图${image.index}` !== excludeRef);
  return found ? `图${found.index}` : null;
}

function normalizeClientImageRole(role: string, index: number) {
  if (["person", "clothing", "product", "background", "style", "source", "reference", "face"].includes(role)) return role as "person" | "clothing" | "product" | "background" | "style" | "source" | "reference" | "face";
  return index === 0 ? "source" : "reference";
}

function shouldTryWorkflowRequest(text: string, imageCount: number, mode: AgentIntentMode) {
  if (mode === "chat") return false;
  const normalized = text.trim();
  if (!normalized) return imageCount > 0;
  if (/(\u7136\u540e|\u518d|\u63a5\u7740|\u6700\u540e|\u5148.*\u518d|\u4ece.*\u9009|\u5de5\u4f5c\u6d41|\u5206\u6b65)/.test(normalized)) return true;
  return /(\u751f\u6210|\u8bbe\u8ba1|\u753b|\u91cd\u7ed8|\u6539|\u6362|\u7a7f|\u8bd5\u7a7f|\u4e0a\u8eab|\u59ff\u52bf|\u80cc\u666f|\u6d77\u62a5|\u8be6\u60c5\u9875|\u79cd\u8349|\u4ea7\u54c1|3D|3d|\u6a21\u578b|\u56fe\u751f\u56fe|\u6587\u751f\u56fe)/.test(normalized);
}

function shouldShowPlanningTimeline(text: string, imageCount: number, mode: AgentIntentMode) {
  if (mode === "chat") return false;
  return shouldTryWorkflowRequest(text, imageCount, mode);
}

function isStrongWorkflowClientRequest(text: string, imageCount: number) {
  if (imageCount > 0 && /(\u7136\u540e|\u518d|\u63a5\u7740|\u6700\u540e|\u5148.*\u518d|\u4ece.*\u9009|\u5de5\u4f5c\u6d41|\u5206\u6b65)/.test(text)) return true;
  if (/图\s*\d+.*(?:穿|传|转移|套|换|换上|穿上|上身).*图\s*\d+|图\s*\d+.*(?:人物|模特|人).*图\s*\d+.*(?:衣服|服装|裙子|上衣|裤子|外套)|图\s*\d+.*(?:衣服|服装|裙子|上衣|裤子|外套).*图\s*\d+.*(?:人物|模特|人)/.test(text)) return true;
  if (/(\u6bcf\u5f20.*\u5355\u72ec|\u72ec\u7acb\u51fa\u56fe|\u4e0d\u540c\u59ff\u52bf|\u56db\u4e2a.*\u59ff\u52bf|4\u4e2a.*\u59ff\u52bf)/.test(text)) return true;
  return false;
}

function shouldUseWorkflowPlan(
  data: WorkflowPlanApiResponse,
  text: string,
  mode: AgentIntentMode,
  imageCount: number
) {
  const plan = data.plan;
  if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) return false;
  if (plan.needsClarification) return false;
  const blockingErrors = data.validation?.errors?.filter((issue) => issue.severity === "error") || [];
  if (data.ok === false && blockingErrors.length > 0) return false;
  if (mode === "create") return true;

  const stepTypes = plan.steps.map((step) => step.type);
  const advanced = stepTypes.some((type) =>
    [
      "tryon",
      "pose_variation",
      "garment_3d",
      "commerce_detail",
      "commerce_creative",
      "background_replace",
      "select_image",
      "image_quality_check",
      "prompt_repair",
    ].includes(type)
  );
  const multiStepText = /(\u7136\u540e|\u518d|\u63a5\u7740|\u6700\u540e|\u5148.*\u518d|\u4ece.*\u9009|\u5de5\u4f5c\u6d41|\u5206\u6b65)/.test(text);
  const visualText = /(\u751f\u6210|\u8bbe\u8ba1|\u753b|\u91cd\u7ed8|\u6539|\u6362|\u7a7f|\u59ff\u52bf|\u80cc\u666f|\u6d77\u62a5|\u8be6\u60c5\u9875|\u79cd\u8349|\u4ea7\u54c1|3D|3d|\u56fe\u751f\u56fe|\u6587\u751f\u56fe)/.test(text);

  return advanced || plan.steps.length > 1 || multiStepText || (visualText && imageCount > 0);
}

function buildWorkflowReply(payload: WorkflowClientPayload) {
  const count = payload.steps.length || payload.plan?.steps.length || 0;
  const credits = payload.costEstimate?.total || payload.workflow.cost_estimate?.total || 0;
  const summary = payload.workflow.summary || payload.plan?.summary || "视觉任务";
  return [
    `我已经把这个需求拆成 ${count || 1} 个可执行步骤，确认后会按顺序处理。`,
    "",
    `目标：${summary}`,
    credits ? `预计消耗：${credits} 灵点，确认前不会扣费。` : "确认前不会扣费。",
  ].join("\n");
}

function getWorkflowPayload(params: Record<string, unknown> | undefined): WorkflowClientPayload | null {
  if (!params || typeof params !== "object") return null;
  return normalizeWorkflowPayload(params.workflow);
}

function normalizeWorkflowPayload(value: unknown): WorkflowClientPayload | null {
  if (!isPlainObject(value) || !isPlainObject(value.workflow)) return null;
  return {
    workflow: value.workflow as WorkflowRecord,
    steps: Array.isArray(value.steps) ? orderWorkflowSteps(value.steps as WorkflowStepRecord[]) : [],
    events: Array.isArray(value.events) ? value.events as WorkflowEventRecord[] : [],
    assets: Array.isArray(value.assets) ? value.assets as WorkflowAssetRecord[] : [],
    validation: isPlainObject(value.validation) ? value.validation as PlanValidationResult : undefined,
    costEstimate: isPlainObject(value.costEstimate) ? value.costEstimate as WorkflowCostEstimate : undefined,
    plan: isPlainObject(value.plan) ? value.plan as WorkflowPlan : undefined,
  };
}

function markWorkflowStatus(payload: WorkflowClientPayload, status: WorkflowStatus): WorkflowClientPayload {
  return {
    ...payload,
    workflow: {
      ...payload.workflow,
      status,
      updated_at: new Date().toISOString(),
    },
  };
}

function pollWorkflow(
  get: () => Store,
  set: (fn: (s: Store) => Partial<Store>) => void,
  messageId: string,
  convId: string,
  workflowId: string
) {
  const timerKey = `workflow:${workflowId}`;
  clearPollTimer(get, set, timerKey);
  let attempts = 0;
  let consecutiveErrors = 0;

  const tick = async () => {
    try {
      attempts += 1;
      const stillExists = get().messages.some((message) => message.id === messageId);
      if (!stillExists) {
        clearPollTimer(get, set, timerKey);
        return;
      }
      if (attempts > 180) {
        throw new Error("workflow 执行超时，请稍后刷新状态或重试。");
      }
      const res = await fetch(`/api/agent/workflows/${workflowId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "读取 workflow 状态失败");
      const payload = normalizeWorkflowPayload(data);
      if (!payload) throw new Error("workflow 状态格式异常");
      consecutiveErrors = 0;
      const terminal = isTerminalWorkflowStatus(payload.workflow.status);

      set((s) => ({
        isSending: terminal ? false : s.isSending,
        messages: s.messages.map((m) =>
          m.id === messageId
            ? { ...m, params: { ...(m.params || {}), workflow: payload } }
            : m
        ),
      }));

      const currentParams = get().messages.find((m) => m.id === messageId)?.params || {};
      updateMessageParams(convId, messageId, { ...currentParams, workflow: payload });

      if (terminal) {
        clearPollTimer(get, set, timerKey);
      }
    } catch (err) {
      consecutiveErrors += 1;
      if (consecutiveErrors < 5) return;
      clearPollTimer(get, set, timerKey);
      const errorMessage = err instanceof Error ? err.message : "workflow 状态读取失败";
      set((s) => ({
        isSending: false,
        messages: s.messages.map((message) => {
          if (message.id !== messageId) return message;
          const payload = getWorkflowPayload(message.params);
          if (!payload) return message;
          const failedPayload = {
            ...payload,
            workflow: {
              ...payload.workflow,
              status: "failed" as WorkflowStatus,
              error_message: errorMessage,
            },
          };
          return { ...message, params: { ...(message.params || {}), workflow: failedPayload } };
        }),
      }));
      const currentParams = get().messages.find((message) => message.id === messageId)?.params || {};
      updateMessageParams(convId, messageId, currentParams);
    }
  };

  const timer = setInterval(tick, 5_000);
  set((s) => {
    const timers = new Map(s.pollTimers);
    timers.set(timerKey, timer);
    return { pollTimers: timers };
  });
  void tick();
}

async function mutateWorkflowFromMessage(
  get: () => Store,
  set: (fn: (s: Store) => Partial<Store>) => void,
  messageId: string,
  actionPath: string,
  options: { poll: boolean; body?: Record<string, unknown> }
) {
  const msg = get().messages.find((m) => m.id === messageId);
  const payload = getWorkflowPayload(msg?.params);
  const workflowId = payload?.workflow.id;
  if (!msg || !payload || !workflowId) return;

  set((s) => ({ isSending: options.poll ? true : s.isSending }));
  try {
    const res = await fetch(`/api/agent/workflows/${workflowId}/${actionPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options.body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "workflow 操作失败");
    const nextPayload = normalizeWorkflowPayload(data);
    if (!nextPayload) return;
    set((s) => ({
      isSending: isTerminalWorkflowStatus(nextPayload.workflow.status) ? false : s.isSending,
      messages: s.messages.map((m) =>
        m.id === messageId
          ? { ...m, params: { ...(m.params || {}), workflow: nextPayload } }
          : m
      ),
    }));
    updateMessageParams(msg.conversation_id, messageId, { ...(msg.params || {}), workflow: nextPayload });
    if (options.poll && !isTerminalWorkflowStatus(nextPayload.workflow.status)) {
      pollWorkflow(get, set, messageId, msg.conversation_id, workflowId);
    }
  } catch (err) {
    const failedPayload = {
      ...payload,
      workflow: {
        ...payload.workflow,
        error_message: err instanceof Error ? err.message : "workflow 操作失败",
      },
    };
    set((s) => ({
      isSending: false,
      messages: s.messages.map((m) =>
        m.id === messageId
          ? { ...m, params: { ...(m.params || {}), workflow: failedPayload } }
          : m
      ),
    }));
    updateMessageParams(msg.conversation_id, messageId, { ...(msg.params || {}), workflow: failedPayload });
  }
}

function isTerminalWorkflowStatus(status: WorkflowStatus | string) {
  return ["completed", "partially_completed", "failed", "cancelled"].includes(status);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clearPollTimer(
  get: () => Store,
  set: (fn: (s: Store) => Partial<Store>) => void,
  timerKey: string
) {
  const current = get().pollTimers.get(timerKey);
  if (current) clearInterval(current);
  set((s) => {
    if (!s.pollTimers.has(timerKey)) return {};
    const timers = new Map(s.pollTimers);
    timers.delete(timerKey);
    return { pollTimers: timers };
  });
}

// ======== 轮询 ========
const AGENT_GENERATION_POLL_INTERVAL_MS = 4_000;
const AGENT_GENERATION_POLL_BASE_TIMEOUT_MS = 20 * 60 * 1000;
const AGENT_GENERATION_POLL_PER_IMAGE_MS = 4 * 60 * 1000;
const AGENT_GENERATION_POLL_MAX_TIMEOUT_MS = 90 * 60 * 1000;

function pollGeneration(
  get: () => Store,
  set: (fn: (s: Store) => Partial<Store>) => void,
  aiMsgId: string,
  convId: string,
  generationId: string
) {
  const url = `/api/generation-status?generation_id=${generationId}`;
  clearPollTimer(get, set, aiMsgId);
  let attempts = 0;
  let consecutiveErrors = 0;

  const tick = async () => {
    try {
      attempts++;
      const maxAttempts = getAgentGenerationPollMaxAttempts(get, aiMsgId);
      const stillExists = get().messages.some((message) => message.id === aiMsgId);
      if (!stillExists) {
        clearPollTimer(get, set, aiMsgId);
        return;
      }
      if (attempts > maxAttempts) {
        clearPollTimer(get, set, aiMsgId);
        set((s) => ({
          isSending: false,
          messages: s.messages.map((m) =>
            m.id === aiMsgId && m.generation
              ? { ...m, generation: { ...m.generation, status: "generating" as const, progress: Math.max(m.generation.progress || 0, 99), error: undefined } }
              : m
          ),
        }));
        const delayedGen = get().messages.find((m) => m.id === aiMsgId)?.generation;
        if (delayedGen) updateMessageGeneration(convId, aiMsgId, delayedGen);
        return;
      }
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "读取生成状态失败");
      consecutiveErrors = 0;
      const status = data.status as string;
      const resultUrls: string[] = Array.isArray(data.result_urls)
        ? data.result_urls.filter((url: unknown): url is string => typeof url === "string" && url.trim().length > 0)
        : [];
      const expectedCount = Math.max(
        Number(data.expected_count) || 0,
        readAgentGenerationExpectedCount(get().messages.find((m) => m.id === aiMsgId)?.generation),
        resultUrls.length || 1,
      );
      const serverProgress = normalizeServerProgress(data.progress, status);
      const partialProgress = resultUrls.length > 0
        ? Math.floor((Math.min(resultUrls.length, expectedCount) / Math.max(1, expectedCount)) * 100)
        : 0;
      const progress = status === "completed" ? 100 : Math.min(99, Math.max(serverProgress, partialProgress));
      const done = status === "completed" || (resultUrls.length > 0 && resultUrls.length >= expectedCount);
      const failed = status === "failed";

      if (done || failed) {
        clearPollTimer(get, set, aiMsgId);
        console.log("[agent-store] pollGeneration completed:", { aiMsgId, done, failed, resultCount: resultUrls.length });
        let verifiedResultUrls: string[] = [];
        let finalFailed = failed;
        let finalError = failed ? (data.error || "生成失败") : undefined;

        if (!failed) {
          try {
            verifiedResultUrls = await verifyGeneratedResultUrls(resultUrls);
          } catch (err) {
            finalFailed = true;
            finalError = err instanceof Error ? err.message : "结果图片不可用";
          }
        }

        const finalGeneration = {
          status: finalFailed ? ("failed" as const) : ("completed" as const),
          progress: 100,
          resultUrls: verifiedResultUrls,
          error: finalError,
        };

        set((s) => ({
          isSending: false,
          messages: s.messages.map((m) =>
            m.id === aiMsgId && m.generation ? {
              ...m,
              generation: { ...m.generation, ...finalGeneration },
            } : m
          ),
        }));

        // 持久化 generation 状态到 DB（用消息自带的 convId，不依赖 activeId）
        const msgConvId = get().messages.find((m) => m.id === aiMsgId)?.conversation_id || get().activeId || "";
        updateMessageGeneration(msgConvId, aiMsgId, {
          ...get().messages.find((m) => m.id === aiMsgId)?.generation,
          ...finalGeneration,
        });

        return;
      }

      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === aiMsgId && m.generation ? { ...m, generation: { ...m.generation, progress, status: "generating", resultUrls } } : m
        ),
      }));
    } catch (err) {
      consecutiveErrors += 1;
      if (consecutiveErrors < 5) return;
      clearPollTimer(get, set, aiMsgId);
      const errorMessage = err instanceof Error ? err.message : "生成状态读取失败";
      set((s) => ({
        isSending: false,
        messages: s.messages.map((m) =>
          m.id === aiMsgId && m.generation
            ? {
                ...m,
                generation: {
                  ...m.generation,
                  status: "failed" as const,
                  error: errorMessage,
                },
              }
            : m
        ),
      }));
      const failedGen = get().messages.find((m) => m.id === aiMsgId)?.generation;
      if (failedGen) updateMessageGeneration(convId, aiMsgId, failedGen);
    }
  };

  void tick();
  const timer = setInterval(() => { void tick(); }, AGENT_GENERATION_POLL_INTERVAL_MS);

  set((s) => {
    const timers = new Map(s.pollTimers);
    timers.set(aiMsgId, timer);
    return { pollTimers: timers };
  });
}

function resumeGenerationPolling(
  get: () => Store,
  set: (fn: (s: Store) => Partial<Store>) => void,
  convId: string,
  messages: Message[]
) {
  for (const message of messages) {
    const generationId = message.generation?.generationId;
    if (message.generation?.status === "generating" && generationId) {
      pollGeneration(get, set, message.id, convId, generationId);
    }
  }
}

function getAgentGenerationPollMaxAttempts(get: () => Store, aiMsgId: string) {
  const generation = get().messages.find((message) => message.id === aiMsgId)?.generation;
  const expectedCount = readAgentGenerationExpectedCount(generation);
  const timeoutMs = Math.min(
    Math.max(
      AGENT_GENERATION_POLL_BASE_TIMEOUT_MS + expectedCount * AGENT_GENERATION_POLL_PER_IMAGE_MS,
      AGENT_GENERATION_POLL_BASE_TIMEOUT_MS,
    ),
    AGENT_GENERATION_POLL_MAX_TIMEOUT_MS,
  );
  return Math.max(1, Math.ceil(timeoutMs / AGENT_GENERATION_POLL_INTERVAL_MS));
}

function readAgentGenerationExpectedCount(generation?: Message["generation"]) {
  const data = generation?._lastRunData || generation?._confirmData;
  const params = data?.params || {};
  const payload = data?.jobPayload || {};
  const count = firstPositiveNumber([
    params.count,
    params.gen_count,
    payload.genCount,
    payload.count,
    generation?.resultUrls?.length,
  ]);
  const referenceCount = Array.isArray(params.reference_urls)
    ? params.reference_urls.filter(Boolean).length
    : Array.isArray(params.referenceUrls)
      ? params.referenceUrls.filter(Boolean).length
      : Array.isArray(payload.referenceUrls)
        ? payload.referenceUrls.filter(Boolean).length
        : 0;
  return Math.max(1, Math.min(count * Math.max(1, referenceCount || 1), 32));
}

function firstPositiveNumber(values: unknown[]) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return Math.floor(number);
  }
  return 1;
}

function normalizeServerProgress(value: unknown, status: string) {
  const num = Number(value);
  if (Number.isFinite(num)) {
    const max = status === "completed" ? 100 : 99;
    return Math.min(Math.max(Math.round(num), 0), max);
  }
  if (status === "queued") return 0;
  if (status === "processing_tryon" || status === "processing_face_swap" || status === "uploading") return 1;
  return 0;
}

function readConfirmParams(params: Record<string, unknown>): GenerationParams {
  const model = String(params.model || params.ai_model || DEFAULT_PARAMS.model) as LingyaModel;
  const aspectRatio = String(params.aspectRatio || params.aspect_ratio || DEFAULT_PARAMS.aspectRatio) as AspectRatio;
  const imageSize = String(params.imageSize || params.image_size || DEFAULT_PARAMS.imageSize) as ImageSize;
  const count = Number(params.count || params.gen_count || DEFAULT_PARAMS.count);
  const prompt = typeof params.prompt === "string" ? params.prompt : "";
  return {
    model,
    aspectRatio,
    imageSize,
    count: Math.min(Math.max(count || 1, 1), 4),
    prompt,
  };
}

function normalizeConfirmRunParams(params: Record<string, unknown>): GenerationParams {
  const current = readConfirmParams(params);
  return {
    ...current,
    imageSize: normalizeImageSize(current.model, current.imageSize, current.aspectRatio),
  };
}

function calculateConfirmCredits(params: Record<string, unknown> | GenerationParams) {
  const current = isGenerationParams(params) ? params : normalizeConfirmRunParams(params);
  const count = Math.min(Math.max(Number(current.count) || 1, 1), 4);
  const imageSize = normalizeImageSize(current.model, current.imageSize, current.aspectRatio);
  return getCreditCost(current.model, imageSize, current.aspectRatio) * count;
}

function isGenerationParams(params: Record<string, unknown> | GenerationParams): params is GenerationParams {
  return typeof (params as GenerationParams).model === "string" &&
    typeof (params as GenerationParams).aspectRatio === "string" &&
    typeof (params as GenerationParams).imageSize === "string" &&
    typeof (params as GenerationParams).count === "number";
}

function writeConfirmParams(params: Record<string, unknown>, next: GenerationParams): Record<string, unknown> {
  const output = { ...params };
  if ("model" in output || !("ai_model" in output)) output.model = next.model;
  if ("aspectRatio" in output || !("aspect_ratio" in output)) output.aspectRatio = next.aspectRatio;
  if ("imageSize" in output || !("image_size" in output)) output.imageSize = next.imageSize;
  if ("count" in output || !("gen_count" in output)) output.count = next.count;
  if ("ai_model" in output) output.ai_model = next.model;
  if ("aspect_ratio" in output) output.aspect_ratio = next.aspectRatio;
  if ("image_size" in output) output.image_size = next.imageSize;
  if ("gen_count" in output) output.gen_count = next.count;
  if (typeof next.prompt === "string") output.prompt = next.prompt;
  return output;
}

function writeConfirmPayloadParams(payload: Record<string, unknown>, next: GenerationParams): Record<string, unknown> {
  const output: Record<string, unknown> = {
    ...payload,
    aiModel: next.model,
    aspectRatio: next.aspectRatio,
    imageSize: next.imageSize,
    genCount: next.count,
  };
  if (typeof next.prompt === "string") output.prompt = next.prompt;
  return output;
}

function getRepairKind(module: string): RepairKind {
  if (module === "grass") return "grass";
  if (module === "pose") return "pose";
  if (module === "model") return "model";
  if (module === "garment_3d") return "garment3d";
  if (module === "model_background") return "modelBackground";
  if (module === "material_enhancement" || module === "materialEnhancement") return "materialEnhancement";
  if (module === "tryon") return "tryon";
  return "general";
}

function getLastAgentTaskContext(messages: Message[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const generation = messages[i].generation;
    const data = generation?._confirmData || generation?._lastRunData;
    if (!data?.module || !data.params) continue;
    return {
      module: data.module,
      label: generation?.module,
      params: data.params,
      prompt: typeof data.params.prompt === "string" ? data.params.prompt : "",
      taskBrief: data.taskBrief,
    };
  }
  return null;
}

function findPreviousUserImageMessageIndex(messages: Message[], beforeIndex: number): number {
  for (let i = beforeIndex - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "user" && Array.isArray(message.images) && message.images.length > 0) {
      return i;
    }
  }
  return -1;
}

async function verifyGeneratedResultUrls(urls: unknown): Promise<string[]> {
  const list = Array.isArray(urls)
    ? urls.filter((url): url is string => typeof url === "string" && url.trim().length > 0)
    : [];

  if (list.length === 0) {
    throw new Error("生成完成但没有返回结果图片");
  }

  if (typeof window === "undefined") return list;

  await Promise.all(list.map((url) => preloadImage(url)));
  return list;
}

function preloadImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (url.startsWith("data:image/")) {
      resolve();
      return;
    }

    const img = new Image();
    const timer = window.setTimeout(() => {
      img.onload = null;
      img.onerror = null;
      reject(new Error("结果图片加载超时，请重试生成"));
    }, 10_000);

    img.onload = () => {
      window.clearTimeout(timer);
      resolve();
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("结果图片不可用，可能被拦截或转存失败"));
    };
    img.src = url;
  });
}

function uid() {
  return v4();
}

type AgentTimelineItem = { label: string; status: string; detail?: string };

function createAgentTimelineProfile(text: string, imageCount: number): {
  initial: AgentTimelineItem[];
  advances: Array<{ label: string; detail: string; delayMs: number }>;
} {
  const hasImages = imageCount > 0;
  const labelsV2 = buildAgentTimelineLabels(text, imageCount);
  const initialV2 = labelsV2.map((label, index) => ({
    label,
    status: index === 0 ? "done" : index === 1 ? "running" : "pending",
    detail: getTimelineDetail(label, imageCount),
  }));
  const advancesV2 = labelsV2.slice(2).map((label, index) => ({
    label,
    detail: getTimelineDetail(label, imageCount),
    delayMs: hasImages ? 650 + index * 760 : 560 + index * 720,
  }));
  return { initial: initialV2, advances: advancesV2 };

  const wantsDetail = /详情页|长图|卖点图|参数图|拼接|PDD|拼多多|淘宝|天猫|京东|抖音|小红书|独立站/i.test(text);
  const wantsMultiStep = /然后|再|接着|最后|先.*再|工作流|分步|裂变|姿势|换装|试穿|穿到|传到/.test(text);
  const labels = hasImages
    ? ["接收请求", "分析图片", "识别图片关系", wantsMultiStep || wantsDetail ? "拆解任务" : "理解意图", "选择工具", "复核方案"]
    : ["接收请求", "理解意图", ...(wantsMultiStep || wantsDetail ? ["拆解任务"] : []), "选择工具", "复核方案"];

  const initial = labels.map((label, index) => ({
    label,
    status: index === 0 ? "done" : index === 1 ? "running" : "pending",
    detail: index === 0 ? getTimelineDetail(label, imageCount) : getTimelineDetail(label, imageCount),
  }));

  const advances = labels.slice(2).map((label, index) => ({
    label,
    detail: getTimelineDetail(label, imageCount),
    delayMs: hasImages ? 700 + index * 850 : 650 + index * 850,
  }));

  return { initial, advances };
}

function buildAgentTimelineLabels(text: string, imageCount: number) {
  const hasImages = imageCount > 0;
  const wantsDetail = /详情页|长图|卖点图|参数图|拼接|PDD|拼多多|淘宝|天猫|京东|抖音|小红书|独立站/i.test(text);
  const wantsTryon = /换装|试穿|穿到|穿上|衣服.*模特|模特.*衣服/i.test(text);
  const wantsPose = /裂变|姿势|动作|pose|多张|4张|四张/i.test(text);
  const wants3d = /3d|三维|建模|立体|旋转展示/i.test(text);
  const wantsMultiStep = /然后|再|接着|最后|先.*再|工作流|分步/.test(text) || [wantsDetail, wantsTryon, wantsPose, wants3d].filter(Boolean).length > 1;

  const labels = ["接收请求"];
  if (hasImages) {
    labels.push("分析图片", "识别图片关系");
  } else {
    labels.push("理解意图");
  }
  if (wantsTryon) labels.push("确认换装顺序");
  if (wantsPose) labels.push("规划姿势变化");
  if (wantsDetail) labels.push("规划详情页板块");
  if (wants3d) labels.push("评估3D素材");
  if (wantsMultiStep) labels.push("拆解任务");
  labels.push("选择工具", "复核方案");

  return Array.from(new Set(labels));
}

function runningAgentTimeline(timeline: AgentTimelineItem[], activeLabel: string, detail: string) {
  const labels = timeline.length ? timeline.map((item) => item.label) : ["接收请求", "理解意图", "选择工具", "复核方案"];
  const activeIndex = labels.includes(activeLabel) ? labels.indexOf(activeLabel) : Math.max(labels.length - 1, 0);
  const resolvedActiveLabel = labels[activeIndex];
  return labels.map((label) => ({
    label,
    status: label === resolvedActiveLabel ? "running" : labels.indexOf(label) < activeIndex ? "done" : "pending",
    detail: label === resolvedActiveLabel ? detail : getTimelineDetail(label),
  }));
}

function completeAgentTimeline(detail: string) {
  return [
    { label: "接收请求", status: "done", detail: "已拿到文字、图片和当前上下文" },
    { label: "理解意图", status: "done", detail: "已完成语义路由和图片关系判断" },
    { label: "选择工具", status: "done", detail: "已选择合适的生成或对话路径" },
    { label: "复核计划", status: "done", detail },
  ];
}

function getTimelineDetail(label: string, imageCount = 0) {
  const details: Record<string, string> = {
    接收请求: imageCount > 0 ? `已收到 ${imageCount} 张图片和你的任务描述` : "已拿到文字和当前上下文",
    分析图片: "正在读取画面主体、服装结构、人物姿态和可用素材",
    识别图片关系: "正在判断主图、服装图、模特图、参考图之间的关系",
    确认换装顺序: "正在确认先换装再裂变/详情页，避免步骤顺序反了",
    规划姿势变化: "正在规划每张独立姿势图的数量、输出方式和一致性约束",
    规划详情页板块: "正在按目标平台拆分卖点、主图、细节、参数和长图拼接策略",
    评估3D素材: "正在判断当前素材是否适合做3D展示，并预留后续视频接入路径",
    理解意图: "正在判断是聊天、生成、工作流还是需要追问",
    拆解任务: "正在把复合需求拆成可执行步骤，并安排先后顺序",
    选择工具: "根据目标和图片关系选择可执行能力",
    复核方案: "检查是否误判、是否需要确认、是否会扣分",
    复核计划: "检查是否误判、是否需要确认或扣分",
  };
  return details[label] || "";
}

function findLatestAssistantMessageIndex(messages: Message[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") return i;
  }
  return -1;
}

function readTimelineFromParams(params: Record<string, unknown> | undefined) {
  if (Array.isArray(params?.agentTimeline)) return params.agentTimeline as AgentTimelineItem[];
  return completeAgentTimeline("等待后端事件。");
}

function mergeTimelineWithBackendEvent(
  timeline: AgentTimelineItem[],
  event: Record<string, unknown>
) {
  const kind = typeof event.kind === "string" ? event.kind : "";
  const eventName = typeof event.event === "string" ? event.event : typeof event.type === "string" ? event.type : kind;
  const detail = getBackendEventDetail(event);
  if (kind === "brain_trace") {
    return completeAgentTimeline("后端已完成 Brain trace，可打开“过程”查看详情。");
  }
  if (kind === "workflow_event") {
    const nextStatus = getWorkflowEventTimelineStatus(eventName, event);
    const reviewLabel = timeline.some((item) => item.label === "复核方案") ? "复核方案" : "复核计划";
    return timeline.map((item) =>
      item.label === reviewLabel ? { ...item, status: nextStatus, detail: `后端工作流事件：${eventName} ${detail}`.trim() } : item
    );
  }
  if (kind === "agent_metric") {
    const reviewLabel = timeline.some((item) => item.label === "复核方案") ? "复核方案" : "复核计划";
    return timeline.map((item) =>
      item.label === reviewLabel ? { ...item, detail: `后端指标：${eventName} ${detail}`.trim() } : item
    );
  }
  return timeline;
}

function getWorkflowEventTimelineStatus(eventName: string, event: Record<string, unknown>) {
  const normalized = eventName.toLowerCase();
  const rawStatus =
    typeof event.status === "string"
      ? event.status
      : isPlainObject(event.workflow) && typeof event.workflow.status === "string"
        ? event.workflow.status
        : "";
  const status = rawStatus.toLowerCase();

  if (["draft", "planned", "needs_confirmation", "confirmed", "waiting_user", "queued", "completed", "partially_completed", "failed", "cancelled"].includes(status)) {
    return "done";
  }
  if (["running", "processing", "generating"].includes(status)) {
    return "running";
  }
  if (/(created|planned|validated|confirmed|queued|completed|failed|cancelled|skipped|selected|updated|persisted)/.test(normalized)) {
    return "done";
  }
  if (/(started|processing|running|generating|quality|retry|repair)/.test(normalized)) {
    return "running";
  }
  return "done";
}

function getBackendEventDetail(event: Record<string, unknown>) {
  if (typeof event.message === "string") return event.message;
  if (typeof event.module === "string") return event.module;
  if (typeof event.action === "string") return event.action;
  return "";
}
