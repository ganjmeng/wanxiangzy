import { generateText, Output } from "ai";
import { z } from "zod";
import type { GenerationDefaults, WorkflowInputImage } from "@/lib/agent/workflow/types";
import { getMastraAgentModel, getMastraAgentModelInfo } from "@/lib/mastra/model";

export type MastraChatRoute = {
  route: "direct_chat" | "workflow_agent";
  confidence: number;
  reason: string;
  source: "llm" | "fallback";
};

export type MastraChatAgentRoute = {
  agentId: "directChatAgent" | "mainAgent";
  effectiveRoute: MastraChatRoute["route"];
  maxSteps: number;
  guarded: boolean;
  guardReason?: string;
};

export type MastraAgentUiContext = {
  mode?: "agent" | "chat";
  speed?: "Instant" | "Balanced" | "Deep";
  appModule?:
    | "auto"
    | "image_analysis"
    | "image_create"
    | "tryon"
    | "pose_variation"
    | "ecommerce_detail"
    | "garment_3d"
    | "free_create";
};

export type MastraChatRouteResolveContext = {
  userText?: string;
  images?: WorkflowInputImage[];
  uiContext?: MastraAgentUiContext;
};

export const WORKFLOW_AGENT_MIN_CONFIDENCE = 0.62;

const chatRouteSchema = z.object({
  route: z.enum(["direct_chat", "workflow_agent"]),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export async function routeMastraChat(params: {
  userText: string;
  images: WorkflowInputImage[];
  recentContext?: Array<{ role: string; content: string }>;
  defaults: GenerationDefaults;
  uiContext?: MastraAgentUiContext;
  abortSignal?: AbortSignal;
}): Promise<MastraChatRoute> {
  const uiHint = getUiContextRouteHint(params.uiContext, params.userText);
  if (uiHint) return uiHint;

  const routeAbort = createRouteAbortSignal(params.abortSignal, 6500);
  try {
    const result = await generateText({
      model: getMastraAgentModel(),
      temperature: 0,
      maxOutputTokens: 500,
      abortSignal: routeAbort.signal,
      output: Output.object({
        schema: chatRouteSchema,
      }),
      system: [
        "You are a semantic router for Wanxiang Agent.",
        "Return structured output only.",
        "Choose direct_chat for greetings, small talk, capability questions, explanations, product brainstorming, architecture discussion, or requests that only ask for advice.",
        "Choose workflow_agent only when the user clearly wants visual execution: image generation, image editing, try-on, pose variation, ecommerce detail page assets, background replacement, 3D display image, workflow status, cancel, retry, or approval.",
        "If images are attached but the user only asks to analyze, explain, or ask what can be done, choose direct_chat.",
        "If the user asks to generate or transform based on images, choose workflow_agent.",
        "Do not rely on keywords alone. Judge the real user goal.",
      ].join("\n"),
      prompt: buildRoutePrompt(params),
    });

    return normalizeMastraChatRoute(result.output);
  } catch (error) {
    console.error("[mastra:chat-router] failed:", {
      model: getMastraAgentModelInfo(),
      error: error instanceof Error ? error.message : String(error),
    });
    return fallbackMastraChatRoute(params);
  } finally {
    routeAbort.cleanup();
  }
}

export function normalizeMastraChatRoute(value: unknown): MastraChatRoute {
  if (!value || typeof value !== "object") {
    return {
      route: "direct_chat",
      confidence: 0.4,
      reason: "Router returned no structured result.",
      source: "fallback",
    };
  }

  const record = value as Record<string, unknown>;
  const route =
    record.route === "workflow_agent" ? "workflow_agent" : "direct_chat";
  const confidence = clampConfidence(record.confidence);
  const reason =
    typeof record.reason === "string" && record.reason.trim()
      ? record.reason.trim()
      : route === "workflow_agent"
        ? "User appears to request visual execution."
        : "User appears to request normal chat.";

  return {
    route,
    confidence,
    reason,
    source: "llm",
  };
}

export function resolveMastraChatAgentRoute(
  route: MastraChatRoute,
  context: MastraChatRouteResolveContext = {},
): MastraChatAgentRoute {
  if (context.uiContext?.mode === "chat") {
    return {
      agentId: "directChatAgent",
      effectiveRoute: "direct_chat",
      maxSteps: 1,
      guarded: route.route === "workflow_agent",
      guardReason:
        route.route === "workflow_agent"
          ? "User selected chat mode, so visual workflow tools are disabled for this turn."
          : undefined,
    };
  }

  const hasResolveContext =
    context.userText !== undefined || context.images !== undefined;
  const directGuardReason =
    route.route === "workflow_agent" && hasResolveContext
      ? getDirectChatGuardReason(context.userText || "", context.images || [])
      : null;
  if (directGuardReason) {
    return {
      agentId: "directChatAgent",
      effectiveRoute: "direct_chat",
      maxSteps: 1,
      guarded: true,
      guardReason: directGuardReason,
    };
  }

  if (
    route.route === "workflow_agent" &&
    route.confidence >= WORKFLOW_AGENT_MIN_CONFIDENCE
  ) {
    return {
      agentId: "mainAgent",
      effectiveRoute: "workflow_agent",
      maxSteps: getMaxStepsForSpeed(context.uiContext?.speed),
      guarded: false,
    };
  }

  if (route.route === "workflow_agent") {
    return {
      agentId: "directChatAgent",
      effectiveRoute: "direct_chat",
      maxSteps: 1,
      guarded: true,
      guardReason: `Workflow route confidence ${route.confidence.toFixed(
        2,
      )} is below ${WORKFLOW_AGENT_MIN_CONFIDENCE}.`,
    };
  }

  return {
    agentId: "directChatAgent",
    effectiveRoute: "direct_chat",
    maxSteps: 1,
    guarded: false,
  };
}

function getDirectChatGuardReason(text: string, images: WorkflowInputImage[]) {
  const normalized = text.trim();
  if (!normalized) {
    return images.length
      ? "Attached images without a clear execution goal should stay in direct chat."
      : "Empty user text should stay in direct chat.";
  }

  if (hasExplicitVisualExecutionIntent(normalized)) return null;

  if (isCapabilityOrConversation(normalized)) {
    return "Conversation or capability question should not enter workflow tools.";
  }

  if (isPlanningOrArchitectureConsultation(normalized)) {
    return "Planning, architecture, or advisory requests should stay in direct chat until the user asks to execute.";
  }

  if (images.length > 0 && isImageAnalysisOnly(normalized)) {
    return "Image analysis-only request should not create a workflow.";
  }

  return null;
}

function buildRoutePrompt(params: {
  userText: string;
  images: WorkflowInputImage[];
  recentContext?: Array<{ role: string; content: string }>;
  defaults: GenerationDefaults;
  uiContext?: MastraAgentUiContext;
}) {
  const recentContext = (params.recentContext || [])
    .slice(-24)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  return [
    "Recent conversation context:",
    recentContext || "(none)",
    "",
    "User text:",
    params.userText || "(empty)",
    "",
    "Attached images:",
    params.images.length
      ? params.images
          .map(
            (image) =>
              `image ${image.index}: role=${image.role || "auto"} file=${image.fileName || ""}`,
          )
          .join("\n")
      : "none",
    "",
    "Generation defaults:",
    JSON.stringify(params.defaults),
    "",
    "Explicit UI context selected by user:",
    JSON.stringify(params.uiContext || { mode: "agent", speed: "Instant", appModule: "auto" }),
    "",
    "Routing guidance:",
    "If mode=chat, prefer direct_chat unless the user explicitly asks to execute a visual job in the text.",
    "If appModule is tryon, pose_variation, ecommerce_detail, garment_3d, image_create, or free_create and the text asks to act, prefer workflow_agent.",
    "If appModule=image_analysis, direct_chat is acceptable for analysis-only requests.",
    "",
    "Return route, confidence, and a short reason.",
  ].join("\n");
}

function fallbackMastraChatRoute(params: {
  userText: string;
  images: WorkflowInputImage[];
}): MastraChatRoute {
  const text = params.userText.trim();
  const hasImages = params.images.length > 0;

  if (!text) {
    return {
      route: hasImages ? "direct_chat" : "direct_chat",
      confidence: 0.45,
      reason: "No textual execution goal was provided.",
      source: "fallback",
    };
  }

  if (looksLikeExecutionRequest(text)) {
    return {
      route: "workflow_agent",
      confidence: 0.66,
      reason: "Fallback detected a likely visual execution request.",
      source: "fallback",
    };
  }

  return {
    route: "direct_chat",
    confidence: 0.6,
    reason: "Fallback did not detect a clear execution request.",
    source: "fallback",
  };
}

function looksLikeExecutionRequest(text: string) {
  return /生成|出图|改图|换装|穿到|姿势|裂变|详情页|主图|海报|背景|3D|重做|重新生成|执行|确认生成|开始/.test(
    text,
  );
}

function hasExplicitVisualExecutionIntent(text: string) {
  return /生成|出图|改图|修图|换装|穿到|穿上|姿势|裂变|详情页|主图|海报|背景替换|去背景|3D|重做|重新生成|执行|确认生成|开始生成|approve|run|generate|create image|try[- ]?on/i.test(
    text,
  );
}

function isCapabilityOrConversation(text: string) {
  return /你是谁|你能|能做什么|可以做什么|介绍一下|怎么用|使用说明|help|who are you|what can you do/i.test(
    text,
  );
}

function isPlanningOrArchitectureConsultation(text: string) {
  return /方案先|先.*方案|给方案|出方案|架构|流程|最佳实践|怎么做|如何做|有什么缺陷|还差什么|打几分|评分|优化到|生产级|不是.*demo|设计文档|review|审核/i.test(
    text,
  );
}

function isImageAnalysisOnly(text: string) {
  return /分析|看看|看一下|判断|识别|理解|适合做什么|能做什么|建议|评价|诊断|哪里不对/i.test(
    text,
  );
}

function getUiContextRouteHint(
  uiContext: MastraAgentUiContext | undefined,
  userText: string,
): MastraChatRoute | null {
  const text = userText.trim();
  if (uiContext?.mode === "chat") {
    return {
      route: "direct_chat",
      confidence: 0.92,
      reason: "User selected chat mode in the composer.",
      source: "fallback",
    };
  }

  if (!text || isCapabilityOrConversation(text) || isPlanningOrArchitectureConsultation(text)) {
    return null;
  }

  const appModule = uiContext?.appModule || "auto";
  if (appModule === "image_analysis") {
    return {
      route: hasExplicitVisualExecutionIntent(text) ? "workflow_agent" : "direct_chat",
      confidence: hasExplicitVisualExecutionIntent(text) ? 0.72 : 0.86,
      reason: "User selected image analysis in the composer.",
      source: "fallback",
    };
  }

  if (
    [
      "image_create",
      "tryon",
      "pose_variation",
      "ecommerce_detail",
      "garment_3d",
      "free_create",
    ].includes(appModule)
  ) {
    return {
      route: "workflow_agent",
      confidence: 0.9,
      reason: `User selected ${appModule} module in the composer.`,
      source: "fallback",
    };
  }

  return null;
}

function getMaxStepsForSpeed(speed: MastraAgentUiContext["speed"]) {
  if (speed === "Deep") return 10;
  if (speed === "Balanced") return 6;
  if (speed === "Instant") return 4;
  return 6;
}

function clampConfidence(value: unknown) {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return 0.5;
  return Math.max(0, Math.min(1, num > 1 ? num / 100 : num));
}

function createRouteAbortSignal(parentSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error("Mastra chat routing timed out."));
  }, timeoutMs);

  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}
