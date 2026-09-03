import type {
  AiDeploymentAdapterConfig,
  AiModality,
  AiProviderProtocol,
} from "@/lib/ai-control-plane/types";

export type AiProtocolAdapterDefinition = {
  id: AiProviderProtocol;
  label: string;
  modalities: AiModality[];
  requestShape: string;
  responseShape: string;
  defaultAuthMode: NonNullable<AiDeploymentAdapterConfig["authMode"]>;
  defaultPaths: {
    generation: string;
    edit?: string;
    status?: string;
  };
};

export const AI_PROTOCOL_ADAPTERS: Record<AiProviderProtocol, AiProtocolAdapterDefinition> = {
  "openai-image": {
    id: "openai-image",
    label: "OpenAI Images",
    modalities: ["image"],
    requestShape: "JSON 生成 / multipart 编辑",
    responseShape: "data[].url / data[].b64_json / 异步 task",
    defaultAuthMode: "bearer",
    defaultPaths: { generation: "/images/generations", edit: "/images/edits", status: "/images/tasks/{taskId}" },
  },
  "gemini-native": {
    id: "gemini-native",
    label: "Gemini Native",
    modalities: ["image"],
    requestShape: "contents + generationConfig + inline_data",
    responseShape: "candidates[].content.parts[].inlineData",
    defaultAuthMode: "x-goog-api-key",
    defaultPaths: { generation: "/v1beta/models/{model}:generateContent" },
  },
  "kie-market": {
    id: "kie-market",
    label: "Kie Market Jobs",
    modalities: ["image", "video"],
    requestShape: "model + input 异步任务 JSON",
    responseShape: "data.taskId + recordInfo.resultJson.resultUrls",
    defaultAuthMode: "bearer",
    defaultPaths: { generation: "/api/v1/jobs/createTask", status: "/api/v1/jobs/recordInfo" },
  },
  "openai-chat": {
    id: "openai-chat",
    label: "OpenAI Chat Completions",
    modalities: ["text", "vision", "audio", "embedding"],
    requestShape: "messages + model",
    responseShape: "choices[] + usage",
    defaultAuthMode: "bearer",
    defaultPaths: { generation: "/chat/completions" },
  },
  "newapi-video": {
    id: "newapi-video",
    label: "NewAPI Video",
    modalities: ["video"],
    requestShape: "异步 video/generations JSON",
    responseShape: "task_id + 轮询状态 + video URL",
    defaultAuthMode: "bearer",
    defaultPaths: { generation: "/v1/video/generations", status: "/v1/video/generations/{taskId}" },
  },
};

export function resolveAiAdapterUrl(input: {
  baseUrl: string;
  protocol: AiProviderProtocol;
  operation: "generation" | "edit" | "status";
  adapterConfig?: AiDeploymentAdapterConfig;
  model?: string;
  taskId?: string;
}) {
  const definition = AI_PROTOCOL_ADAPTERS[input.protocol];
  const configured = input.operation === "generation"
    ? input.adapterConfig?.generationPath
    : input.operation === "edit"
      ? input.adapterConfig?.editPath
      : input.adapterConfig?.statusPath;
  const template = configured || definition.defaultPaths[input.operation];
  if (!template) throw new Error(`${definition.label} 不支持 ${input.operation} 操作`);
  const path = template
    .replaceAll("{model}", encodeURIComponent(input.model || ""))
    .replaceAll("{taskId}", encodeURIComponent(input.taskId || ""));
  return `${input.baseUrl.replace(/\/+$/, "")}${path}`;
}

export function buildAiAdapterAuthHeaders(input: {
  protocol: AiProviderProtocol;
  apiKey: string;
  adapterConfig?: AiDeploymentAdapterConfig;
}): Record<string, string> {
  const mode = input.adapterConfig?.authMode || AI_PROTOCOL_ADAPTERS[input.protocol].defaultAuthMode;
  if (mode === "x-api-key") return { "x-api-key": input.apiKey };
  if (mode === "x-goog-api-key") return { "x-goog-api-key": input.apiKey };
  return { Authorization: `Bearer ${input.apiKey}` };
}

/**
 * Provider-only switches are merged first. Canonical request fields always
 * win, so a deployment cannot rewrite the user's prompt, model or media.
 */
export function mergeAiAdapterParameters(
  canonical: Record<string, unknown>,
  adapterConfig?: AiDeploymentAdapterConfig,
) {
  return { ...(adapterConfig?.staticParameters || {}), ...canonical };
}
