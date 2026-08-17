import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_TOOL_CATALOG, isAiToolSlug } from "@/lib/ai-tools/catalog";
import {
  AiToolLocalResizeError,
  executeLocalResizeTask,
} from "@/lib/api/ai-tools/resize.server";
import {
  getGenerativeAiToolTask,
  isGenerativeAiToolRequest,
  isGenerativeAiToolOperation,
  submitGenerativeAiToolTask,
} from "@/lib/api/ai-tools/generative-provider.server";
import {
  isAiToolTaskId,
  type AiToolOutput,
  type AiToolOutputKind,
  type AiToolOutputMimeType,
  type AiToolOutputRole,
  type AiToolCreateRequest,
  type AiToolProviderStatus,
  type AiToolSubmitResult,
  type AiToolTaskError,
  type AiToolTaskStatus,
} from "@/lib/ai-tools/types";

const DEFAULT_PROVIDER_TIMEOUT_MS = 45_000;
const MIN_PROVIDER_TIMEOUT_MS = 1_000;
const MAX_PROVIDER_TIMEOUT_MS = 60_000;
const MOCK_TASK_TTL_MS = 30 * 60_000;
const MOCK_TASK_LIMIT = 500;
const MAX_PROVIDER_OUTPUTS = 8;
const MAX_OUTPUT_DIMENSION = 32_768;
const MAX_OUTPUT_PIXELS = 100_000_000;
const OUTPUT_ROLES = new Set<AiToolOutputRole>(["result", "mask", "alpha", "preview"]);
const OUTPUT_KINDS = new Set<AiToolOutputKind>(["image", "mask", "alpha"]);
const OUTPUT_MIME_TYPES = new Set<AiToolOutputMimeType>([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const mockTasks = new Map<string, {
  userId: string;
  expiresAt: number;
  result: AiToolSubmitResult;
}>();

type AiToolProviderContext = {
  userId: string;
  /** Request-scoped client carrying the authenticated user's JWT. */
  client?: Pick<SupabaseClient, "from" | "rpc">;
};

type RuntimeEnv = Partial<Pick<NodeJS.ProcessEnv,
  | "NODE_ENV"
  | "AI_TOOLS_EXECUTION_MODE"
  | "AI_TOOLS_PROVIDER_GATEWAY_URL"
  | "AI_TOOLS_PROVIDER_GATEWAY_TOKEN"
  | "AI_TOOLS_PROVIDER_OPERATIONS"
  | "AI_TOOLS_PROVIDER_TIMEOUT_MS"
  | "IMAGE_STORAGE_PROVIDER"
  | "ALIYUN_OSS_ACCESS_KEY_ID"
  | "ALIYUN_OSS_ACCESS_KEY_SECRET"
  | "ALIYUN_OSS_BUCKET"
  | "ALIYUN_OSS_REGION"
  | "ALIYUN_OSS_PUBLIC_BASE_URL"
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "SUPABASE_SERVICE_ROLE_KEY"
>>;

export class AiToolProviderError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly providerStatus?: AiToolProviderStatus;

  constructor(
    message: string,
    options: {
      code: string;
      status: number;
      retryable?: boolean;
      providerStatus?: AiToolProviderStatus;
    },
  ) {
    super(message);
    this.name = "AiToolProviderError";
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.providerStatus = options.providerStatus;
  }
}

export function getAiToolProviderStatus(
  requestOrSlug: AiToolCreateRequest | AiToolCreateRequest["operation"],
  env: RuntimeEnv = process.env,
): AiToolProviderStatus {
  const operation = typeof requestOrSlug === "string" ? requestOrSlug : requestOrSlug.operation;
  const tool = AI_TOOL_CATALOG[operation];
  const requestedMode = (env.AI_TOOLS_EXECUTION_MODE || "live").trim().toLowerCase();
  const nodeEnv = (env.NODE_ENV || "production").trim().toLowerCase();

  if (operation === "resize") {
    return getLocalResizeProviderStatus(requestedMode, env);
  }

  if (requestedMode === "mock") {
    if (nodeEnv === "development" || nodeEnv === "test") {
      return {
        provider: tool.provider,
        capability: tool.capability,
        requested_mode: requestedMode,
        execution_mode: "mock",
        available: true,
        configured: true,
        mock: true,
        reason: "MOCK_READY",
        message: "开发 Mock Provider 已启用",
      };
    }
    return {
      provider: tool.provider,
      capability: tool.capability,
      requested_mode: requestedMode,
      execution_mode: "live",
      available: false,
      configured: false,
      mock: false,
      reason: "MOCK_DISABLED_IN_PRODUCTION",
      message: "生产环境禁止启用 AI 工具 Mock Provider",
    };
  }

  if (requestedMode !== "live") {
    return {
      provider: tool.provider,
      capability: tool.capability,
      requested_mode: requestedMode,
      execution_mode: "live",
      available: false,
      configured: false,
      mock: false,
      reason: "INVALID_EXECUTION_MODE",
      message: "AI_TOOLS_EXECUTION_MODE 仅支持 live 或 mock",
    };
  }

  if (tool.provider === "generative-image-edit") {
    const infrastructure = getLiveInfrastructureStatus(env);
    return {
      provider: tool.provider,
      capability: tool.capability,
      requested_mode: requestedMode,
      execution_mode: "live",
      available: infrastructure.ready,
      configured: infrastructure.ready,
      mock: false,
      reason: infrastructure.ready ? "READY" : infrastructure.reason,
      message: infrastructure.ready
        ? "后台已发布生图模型、阿里云 OSS 与任务持久化已就绪"
        : infrastructure.message,
    };
  }

  const operationPolicy = getProviderOperationPolicy(env);
  if (!operationPolicy.valid) {
    return {
      provider: tool.provider,
      capability: tool.capability,
      requested_mode: requestedMode,
      execution_mode: "live",
      available: false,
      configured: false,
      mock: false,
      reason: "INVALID_CONFIGURATION",
      message: operationPolicy.message,
    };
  }
  if (!operationPolicy.operations.has(operation)) {
    return {
      provider: tool.provider,
      capability: tool.capability,
      requested_mode: requestedMode,
      execution_mode: "live",
      available: false,
      configured: false,
      mock: false,
      reason: "NOT_CONFIGURED",
      message: `AI_TOOLS_PROVIDER_OPERATIONS 未启用 ${operation}`,
    };
  }

  const rawGatewayUrl = env.AI_TOOLS_PROVIDER_GATEWAY_URL?.trim();
  const gatewayUrl = normalizeGatewayUrl(rawGatewayUrl, nodeEnv);
  const gatewayToken = env.AI_TOOLS_PROVIDER_GATEWAY_TOKEN?.trim();
  if (rawGatewayUrl && !gatewayUrl) {
    return {
      provider: tool.provider,
      capability: tool.capability,
      requested_mode: requestedMode,
      execution_mode: "live",
      available: false,
      configured: false,
      mock: false,
      reason: "INVALID_CONFIGURATION",
      message: "AI 工具 Provider Gateway 地址无效",
    };
  }
  if (!gatewayUrl || !gatewayToken) {
    return {
      provider: tool.provider,
      capability: tool.capability,
      requested_mode: requestedMode,
      execution_mode: "live",
      available: false,
      configured: false,
      mock: false,
      reason: "NOT_CONFIGURED",
      message: "AI 工具 Provider 尚未配置",
    };
  }

  const infrastructure = getLiveInfrastructureStatus(env);
  if (!infrastructure.ready) {
    return {
      provider: tool.provider,
      capability: tool.capability,
      requested_mode: requestedMode,
      execution_mode: "live",
      available: false,
      configured: false,
      mock: false,
      reason: infrastructure.reason,
      message: infrastructure.message,
    };
  }

  return {
    provider: tool.provider,
    capability: tool.capability,
    requested_mode: requestedMode,
    execution_mode: "live",
    available: true,
    configured: true,
    mock: false,
    reason: "READY",
    message: "AI 工具 Provider、阿里云 OSS 与任务持久化已就绪",
  };
}

export async function submitAiToolTask(
  request: AiToolCreateRequest,
  context: AiToolProviderContext,
  env: RuntimeEnv = process.env,
): Promise<AiToolSubmitResult> {
  const providerStatus = getAiToolProviderStatus(request, env);
  if (!providerStatus.available) {
    throw new AiToolProviderError(providerStatus.message, {
      code: "AI_TOOL_PROVIDER_UNAVAILABLE",
      status: 503,
      retryable: false,
      providerStatus,
    });
  }

  if (providerStatus.mock) {
    return createMockResult(request, context.userId, providerStatus);
  }

  if (request.operation === "resize") {
    try {
      return await executeLocalResizeTask(request, context);
    } catch (error) {
      if (error instanceof AiToolLocalResizeError) {
        throw new AiToolProviderError(error.message, {
          code: error.code,
          status: error.status,
          retryable: error.retryable,
          providerStatus,
        });
      }
      throw new AiToolProviderError("本地图片处理失败", {
        code: "AI_TOOL_RESIZE_FAILED",
        status: 500,
        retryable: true,
        providerStatus,
      });
    }
  }

  if (isGenerativeAiToolRequest(request)) {
    try {
      return await submitGenerativeAiToolTask(request, {
        userId: context.userId,
        client: requireAuthenticatedClient(context, providerStatus),
      });
    } catch (error) {
      throw translateGenerativeProviderError(error, providerStatus, "AI 工具生图任务提交失败");
    }
  }

  return submitToProviderGateway(request, context, providerStatus, env);
}

function getLocalResizeProviderStatus(
  requestedMode: string,
  env: RuntimeEnv,
): AiToolProviderStatus {
  const infrastructure = getLiveInfrastructureStatus(env);
  return {
    provider: "sharp",
    capability: "resize",
    requested_mode: requestedMode,
    execution_mode: "live",
    available: infrastructure.ready,
    configured: infrastructure.ready,
    mock: false,
    reason: infrastructure.ready ? "READY" : infrastructure.reason,
    message: infrastructure.ready
      ? "本地 Sharp、阿里云 OSS 与任务持久化已就绪"
      : infrastructure.message,
  };
}

type ProviderOperationPolicy =
  | { valid: true; operations: ReadonlySet<Exclude<AiToolCreateRequest["operation"], "resize">> }
  | { valid: false; message: string };

function getProviderOperationPolicy(env: RuntimeEnv): ProviderOperationPolicy {
  const configured = env.AI_TOOLS_PROVIDER_OPERATIONS;
  const supported = new Set(["matting", "upscale"] as const) as Set<Exclude<AiToolCreateRequest["operation"], "resize">>;
  if (configured === undefined) return { valid: true, operations: new Set() };

  const values = configured.split(",").map((value) => value.trim()).filter(Boolean);
  const invalid = [...new Set(values.filter((value) => !supported.has(
    value as Exclude<AiToolCreateRequest["operation"], "resize">,
  )))];
  if (invalid.length) {
    return {
      valid: false,
      message: `AI_TOOLS_PROVIDER_OPERATIONS 包含无效工具：${invalid.join(", ")}`,
    };
  }
  return {
    valid: true,
    operations: new Set(values as Array<Exclude<AiToolCreateRequest["operation"], "resize">>),
  };
}

function getLiveInfrastructureStatus(env: RuntimeEnv):
  | { ready: true }
  | { ready: false; reason: "NOT_CONFIGURED" | "INVALID_CONFIGURATION"; message: string } {
  if (env.IMAGE_STORAGE_PROVIDER?.trim().toLowerCase() !== "aliyun-oss") {
    return {
      ready: false,
      reason: "NOT_CONFIGURED",
      message: "AI 工具需要将 IMAGE_STORAGE_PROVIDER 配置为 aliyun-oss",
    };
  }

  const missingOss = [
    "ALIYUN_OSS_ACCESS_KEY_ID",
    "ALIYUN_OSS_ACCESS_KEY_SECRET",
    "ALIYUN_OSS_BUCKET",
    "ALIYUN_OSS_REGION",
  ].filter((name) => !env[name as keyof RuntimeEnv]?.trim());
  if (missingOss.length) {
    return {
      ready: false,
      reason: "NOT_CONFIGURED",
      message: `阿里云 OSS 配置缺失：${missingOss.join(", ")}`,
    };
  }
  if (!env.ALIYUN_OSS_PUBLIC_BASE_URL?.trim()) {
    return {
      ready: false,
      reason: "NOT_CONFIGURED",
      message: "阿里云 OSS 配置缺失：ALIYUN_OSS_PUBLIC_BASE_URL",
    };
  }
  if (!isValidHttpsBaseUrl(env.ALIYUN_OSS_PUBLIC_BASE_URL)) {
    return {
      ready: false,
      reason: "INVALID_CONFIGURATION",
      message: "ALIYUN_OSS_PUBLIC_BASE_URL 必须是无凭证的 HTTPS 地址",
    };
  }

  if (!env.NEXT_PUBLIC_SUPABASE_URL?.trim() || !env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    const missing = [
      !env.NEXT_PUBLIC_SUPABASE_URL?.trim() ? "NEXT_PUBLIC_SUPABASE_URL" : null,
      !env.SUPABASE_SERVICE_ROLE_KEY?.trim() ? "SUPABASE_SERVICE_ROLE_KEY" : null,
    ].filter((value): value is string => Boolean(value));
    return {
      ready: false,
      reason: "NOT_CONFIGURED",
      message: `AI 工具任务持久化配置缺失：${missing.join(", ")}`,
    };
  }
  if (!isValidHttpsBaseUrl(env.NEXT_PUBLIC_SUPABASE_URL)) {
    return {
      ready: false,
      reason: "INVALID_CONFIGURATION",
      message: "NEXT_PUBLIC_SUPABASE_URL 必须是无凭证的 HTTPS 地址",
    };
  }
  return { ready: true };
}

function isValidHttpsBaseUrl(value: string | undefined) {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export async function getAiToolTask(
  taskId: string,
  context: AiToolProviderContext & {
    operation?: AiToolCreateRequest["operation"];
    requestId?: string;
  },
  env: RuntimeEnv = process.env,
): Promise<AiToolSubmitResult> {
  if (!isAiToolTaskId(taskId)) {
    throw new AiToolProviderError("task_id 格式无效", {
      code: "AI_TOOL_TASK_ID_INVALID",
      status: 400,
      retryable: false,
    });
  }

  // Live polling is always backed by the durable application task. Older
  // gateways may omit operation/request_id from GET responses, so prefer the
  // trusted task metadata supplied by the route and only use response fields
  // as a compatibility fallback.
  const runtimeStatus = getAiToolProviderStatus(context.operation || "matting", env);
  if (!runtimeStatus.available) {
    throw new AiToolProviderError(runtimeStatus.message, {
      code: "AI_TOOL_PROVIDER_UNAVAILABLE",
      status: 503,
      retryable: false,
      providerStatus: runtimeStatus,
    });
  }

  if (runtimeStatus.mock) {
    return getMockResult(taskId, context.userId, runtimeStatus);
  }

  if (context.operation === "resize") {
    throw new AiToolProviderError("本地改尺寸任务不支持 Provider 轮询", {
      code: "AI_TOOL_TASK_NOT_POLLABLE",
      status: 409,
      retryable: false,
      providerStatus: runtimeStatus,
    });
  }

  if (context.operation && isGenerativeAiToolOperation(context.operation)) {
    if (!context.requestId) {
      throw new AiToolProviderError("生图任务缺少可信 request_id", {
        code: "AI_TOOL_TASK_BINDING_MISMATCH",
        status: 502,
        retryable: false,
        providerStatus: runtimeStatus,
      });
    }
    try {
      return await getGenerativeAiToolTask(taskId, {
        userId: context.userId,
        client: requireAuthenticatedClient(context, runtimeStatus),
        operation: context.operation,
        requestId: context.requestId,
      });
    } catch (error) {
      throw translateGenerativeProviderError(error, runtimeStatus, "AI 工具生图任务查询失败");
    }
  }

  return getTaskFromProviderGateway(taskId, context, runtimeStatus, env);
}

function requireAuthenticatedClient(
  context: AiToolProviderContext,
  providerStatus: AiToolProviderStatus,
) {
  if (context.client) return context.client;
  throw new AiToolProviderError("AI 工具生图任务缺少用户认证上下文，请刷新页面后重试", {
    code: "AI_TOOL_AUTH_CONTEXT_MISSING",
    status: 500,
    retryable: true,
    providerStatus,
  });
}

function translateGenerativeProviderError(
  error: unknown,
  providerStatus: AiToolProviderStatus,
  fallbackMessage: string,
) {
  if (error instanceof AiToolProviderError) return error;
  const record = error as Error & { code?: string; status?: number; retryable?: boolean };
  const status = Number.isInteger(record?.status) ? Number(record.status) : 500;
  const message = error instanceof Error && error.message ? error.message : fallbackMessage;
  return new AiToolProviderError(message, {
    code: typeof record?.code === "string" ? record.code : "AI_TOOL_GENERATIVE_PROVIDER_FAILED",
    status,
    retryable: record?.retryable === true || status >= 500,
    providerStatus,
  });
}

function createMockResult(
  request: AiToolCreateRequest,
  userId: string,
  providerStatus: AiToolProviderStatus,
): AiToolSubmitResult {
  const result: AiToolSubmitResult = {
    task_id: `mock-${randomUUID()}`,
    request_id: request.request_id,
    operation: request.operation,
    status: "completed",
    stage: "mock_completed",
    progress: 100,
    expected_count: 1,
    result_urls: [request.source_url],
    outputs: [{
      url: request.source_url,
      role: "result",
      kind: "image",
      mime_type: inferImageMimeType(request.source_url),
      dimensions: null,
    }],
    warnings: ["当前为开发演示模式，结果使用原图占位，未调用外部 AI Provider，也未扣费。"],
    error: null,
    execution_mode: "mock",
    provider: providerStatus.provider,
    capability: providerStatus.capability,
    provider_status: "MOCK_COMPLETED",
  };
  cleanupMockTasks();
  mockTasks.set(result.task_id, {
    userId,
    expiresAt: Date.now() + MOCK_TASK_TTL_MS,
    result,
  });
  return result;
}

function getMockResult(
  taskId: string,
  userId: string,
  providerStatus: AiToolProviderStatus,
) {
  cleanupMockTasks();
  const task = mockTasks.get(taskId);
  if (!task || task.userId !== userId) {
    throw new AiToolProviderError("AI 工具任务不存在或已过期", {
      code: "AI_TOOL_TASK_NOT_FOUND",
      status: 404,
      retryable: false,
      providerStatus,
    });
  }
  return task.result;
}

function cleanupMockTasks() {
  const now = Date.now();
  for (const [taskId, task] of mockTasks) {
    if (task.expiresAt <= now) mockTasks.delete(taskId);
  }
  while (mockTasks.size >= MOCK_TASK_LIMIT) {
    const oldestTaskId = mockTasks.keys().next().value;
    if (typeof oldestTaskId !== "string") break;
    mockTasks.delete(oldestTaskId);
  }
}

async function submitToProviderGateway(
  request: AiToolCreateRequest,
  context: { userId: string },
  providerStatus: AiToolProviderStatus,
  env: RuntimeEnv,
): Promise<AiToolSubmitResult> {
  const payload = await requestProviderGateway({
    path: "tasks",
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": request.request_id,
      },
      body: JSON.stringify({
        api_version: "v1",
        user_id: context.userId,
        provider: providerStatus.provider,
        capability: providerStatus.capability,
        request,
      }),
    },
    providerStatus,
    env,
  });

  return normalizeGatewayResult(payload, {
    request,
    providerStatus,
  });
}

async function getTaskFromProviderGateway(
  taskId: string,
  context: {
    userId: string;
    operation?: AiToolCreateRequest["operation"];
    requestId?: string;
  },
  runtimeStatus: AiToolProviderStatus,
  env: RuntimeEnv,
): Promise<AiToolSubmitResult> {
  const payload = await requestProviderGateway({
    path: `tasks/${encodeURIComponent(taskId)}`,
    init: {
      method: "GET",
      headers: {
        "X-Wanxiang-User-Id": context.userId,
      },
    },
    providerStatus: runtimeStatus,
    env,
    taskLookup: true,
  });

  if (!isRecord(payload)) {
    throw invalidProviderResponse(runtimeStatus);
  }
  const responseOperation = payload.operation;
  if (responseOperation !== undefined && !isAiToolSlug(responseOperation)) {
    throw invalidProviderResponse(runtimeStatus);
  }
  if (context.operation && responseOperation && context.operation !== responseOperation) {
    throw invalidProviderResponse(runtimeStatus);
  }
  const operation = context.operation || responseOperation;
  if (!operation || !isAiToolSlug(operation)) throw invalidProviderResponse(runtimeStatus);
  const providerStatus = getAiToolProviderStatus(operation, env);
  return normalizeGatewayResult(payload, {
    expectedTaskId: taskId,
    expectedOperation: operation,
    expectedRequestId: context.requestId,
    providerStatus,
  });
}

async function requestProviderGateway(params: {
  path: string;
  init: RequestInit;
  providerStatus: AiToolProviderStatus;
  env: RuntimeEnv;
  taskLookup?: boolean;
}): Promise<unknown> {
  const gatewayUrl = normalizeGatewayUrl(params.env.AI_TOOLS_PROVIDER_GATEWAY_URL, params.env.NODE_ENV);
  const gatewayToken = params.env.AI_TOOLS_PROVIDER_GATEWAY_TOKEN?.trim();
  if (!gatewayUrl || !gatewayToken) {
    throw new AiToolProviderError("AI 工具 Provider 尚未配置", {
      code: "AI_TOOL_PROVIDER_UNAVAILABLE",
      status: 503,
      providerStatus: params.providerStatus,
    });
  }

  const headers = new Headers(params.init.headers);
  headers.set("Authorization", `Bearer ${gatewayToken}`);
  headers.set("Accept", "application/json");
  const timeoutMs = normalizeTimeout(params.env.AI_TOOLS_PROVIDER_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(new URL(params.path, ensureTrailingSlash(gatewayUrl)), {
      ...params.init,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    const timeout = error instanceof Error && (
      error.name === "TimeoutError" || error.name === "AbortError" || error.message.toLowerCase().includes("timeout")
    );
    throw new AiToolProviderError(
      timeout ? "AI 工具 Provider 请求超时" : "AI 工具 Provider 暂时不可用",
      {
        code: timeout ? "AI_TOOL_PROVIDER_TIMEOUT" : "AI_TOOL_PROVIDER_REQUEST_FAILED",
        status: timeout ? 504 : 502,
        retryable: true,
        providerStatus: params.providerStatus,
      },
    );
  }

  const payload = await readJsonResponse(response);
  if (response.ok) return payload;

  const message = isRecord(payload)
    ? readString(payload, "error") || readString(payload, "message") || `Provider HTTP ${response.status}`
    : `Provider HTTP ${response.status}`;
  if (params.taskLookup && response.status === 404) {
    throw new AiToolProviderError("AI 工具任务不存在", {
      code: "AI_TOOL_TASK_NOT_FOUND",
      status: 404,
      retryable: false,
      providerStatus: params.providerStatus,
    });
  }
  if (response.status === 401 || response.status === 403) {
    throw new AiToolProviderError("AI 工具 Provider 鉴权失败", {
      code: "AI_TOOL_PROVIDER_AUTH_FAILED",
      status: 503,
      retryable: false,
      providerStatus: params.providerStatus,
    });
  }
  throw new AiToolProviderError(message, {
    code: response.status === 429 ? "AI_TOOL_PROVIDER_RATE_LIMITED" : "AI_TOOL_PROVIDER_REJECTED",
    status: response.status === 429 ? 503 : response.status >= 500 ? 502 : 422,
    retryable: response.status === 429 || response.status >= 500,
    providerStatus: params.providerStatus,
  });
}

function normalizeGatewayResult(
  payload: unknown,
  context: {
    request?: AiToolCreateRequest;
    expectedTaskId?: string;
    expectedOperation?: AiToolCreateRequest["operation"];
    expectedRequestId?: string;
    providerStatus: AiToolProviderStatus;
  },
): AiToolSubmitResult {
  if (!isRecord(payload)) {
    throw invalidProviderResponse(context.providerStatus);
  }

  const responseTaskId = firstString(payload, ["task_id", "generation_id", "id"]);
  if (responseTaskId && context.expectedTaskId && responseTaskId !== context.expectedTaskId) {
    throw invalidProviderResponse(context.providerStatus);
  }
  const taskId = context.expectedTaskId || responseTaskId;
  if (!taskId || !isAiToolTaskId(taskId)) throw invalidProviderResponse(context.providerStatus);

  const responseOperation = payload.operation;
  if (responseOperation !== undefined && !isAiToolSlug(responseOperation)) {
    throw invalidProviderResponse(context.providerStatus);
  }
  const expectedOperation = context.request?.operation || context.expectedOperation;
  if (expectedOperation && responseOperation && responseOperation !== expectedOperation) {
    throw invalidProviderResponse(context.providerStatus);
  }
  const operation = expectedOperation || responseOperation;
  if (!operation || !isAiToolSlug(operation)) throw invalidProviderResponse(context.providerStatus);

  const responseRequestId = firstString(payload, ["request_id"]);
  const expectedRequestId = context.request?.request_id || context.expectedRequestId;
  if (responseRequestId && expectedRequestId && responseRequestId !== expectedRequestId) {
    throw invalidProviderResponse(context.providerStatus);
  }
  const requestId = expectedRequestId || responseRequestId;
  if (!requestId) throw invalidProviderResponse(context.providerStatus);

  const status = normalizeTaskStatus(payload.status);
  const outputs = normalizeOutputs(payload, context.providerStatus);
  const resultUrls = outputs
    .filter((output) => output.role === "result")
    .map((output) => output.url);
  if (status === "completed" && resultUrls.length === 0) {
    throw invalidProviderResponse(context.providerStatus);
  }
  const taskError = normalizeTaskError(payload, status);

  return {
    task_id: taskId,
    request_id: requestId,
    operation,
    status,
    stage: firstString(payload, ["stage", "provider_status"]) || status,
    progress: normalizeProgress(payload.progress, status),
    expected_count: 1,
    result_urls: resultUrls,
    outputs,
    warnings: Array.isArray(payload.warnings)
      ? payload.warnings.filter((item): item is string => typeof item === "string").slice(0, 8)
      : [],
    error: taskError,
    execution_mode: "live",
    provider: context.providerStatus.provider,
    capability: context.providerStatus.capability,
    provider_status: firstString(payload, ["provider_status"]),
    external_request_id: firstString(payload, ["external_request_id", "provider_request_id"]),
  };
}

function normalizeOutputs(
  payload: Record<string, unknown>,
  providerStatus: AiToolProviderStatus,
): AiToolOutput[] {
  if (payload.outputs !== undefined) {
    if (!Array.isArray(payload.outputs)) throw invalidProviderResponse(providerStatus);
    return normalizeStructuredOutputs(payload.outputs, providerStatus);
  }
  if (payload.result_urls !== undefined) {
    if (!Array.isArray(payload.result_urls)) throw invalidProviderResponse(providerStatus);
    return normalizeLegacyResultUrls(payload.result_urls, providerStatus);
  }
  return [];
}

function normalizeStructuredOutputs(
  values: unknown[],
  providerStatus: AiToolProviderStatus,
): AiToolOutput[] {
  if (values.length > MAX_PROVIDER_OUTPUTS) throw invalidProviderResponse(providerStatus);

  const outputs: AiToolOutput[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (!isRecord(value)) throw invalidProviderResponse(providerStatus);
    const url = readString(value, "url");
    const role = readString(value, "role");
    const kind = readString(value, "kind");
    const mimeType = readString(value, "mime_type");
    const dimensions = readOutputDimensions(value.dimensions);

    if (
      !url
      || !isPublicHttpUrl(url)
      || seen.has(url)
      || !role
      || !OUTPUT_ROLES.has(role as AiToolOutputRole)
      || !kind
      || !OUTPUT_KINDS.has(kind as AiToolOutputKind)
      || !isValidRoleKindPair(role as AiToolOutputRole, kind as AiToolOutputKind)
      || !mimeType
      || !OUTPUT_MIME_TYPES.has(mimeType as AiToolOutputMimeType)
      || !dimensions
    ) {
      throw invalidProviderResponse(providerStatus);
    }

    seen.add(url);
    outputs.push({
      url,
      role: role as AiToolOutputRole,
      kind: kind as AiToolOutputKind,
      mime_type: mimeType as AiToolOutputMimeType,
      dimensions,
    });
  }
  return outputs;
}

function normalizeLegacyResultUrls(
  values: unknown[],
  providerStatus: AiToolProviderStatus,
): AiToolOutput[] {
  if (values.length > MAX_PROVIDER_OUTPUTS) throw invalidProviderResponse(providerStatus);
  const outputs: AiToolOutput[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string" || !isPublicHttpUrl(value) || seen.has(value)) {
      throw invalidProviderResponse(providerStatus);
    }
    seen.add(value);
    outputs.push({
      url: value,
      role: "result",
      kind: "image",
      mime_type: inferImageMimeType(value),
      dimensions: null,
    });
  }
  return outputs;
}

function readOutputDimensions(value: unknown) {
  if (!isRecord(value)) return null;
  const width = readPositiveInteger(value.width);
  const height = readPositiveInteger(value.height);
  if (
    !width
    || !height
    || width > MAX_OUTPUT_DIMENSION
    || height > MAX_OUTPUT_DIMENSION
    || width * height > MAX_OUTPUT_PIXELS
  ) {
    return null;
  }
  return { width, height };
}

function isValidRoleKindPair(role: AiToolOutputRole, kind: AiToolOutputKind) {
  if (role === "mask") return kind === "mask";
  if (role === "alpha") return kind === "alpha";
  return kind === "image";
}

function inferImageMimeType(urlValue: string): AiToolOutputMimeType | null {
  try {
    const pathname = new URL(urlValue).pathname.toLowerCase();
    if (pathname.endsWith(".png")) return "image/png";
    if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
    if (pathname.endsWith(".webp")) return "image/webp";
  } catch {
    // URL validity is checked before this helper is used for provider responses.
  }
  return null;
}

function normalizeTaskError(
  payload: Record<string, unknown>,
  status: AiToolTaskStatus,
): AiToolTaskError | null {
  if (status !== "failed") return null;
  const rawError = payload.error;
  const record = isRecord(rawError) ? rawError : null;
  const message = typeof rawError === "string" && rawError.trim()
    ? rawError.trim()
    : record
      ? readString(record, "message")
      : readString(payload, "error_message");
  const code = record
    ? readString(record, "code")
    : readString(payload, "error_code");
  return {
    code: code || "AI_TOOL_TASK_FAILED",
    message: message || "AI 工具任务执行失败",
    retryable: record && typeof record.retryable === "boolean" ? record.retryable : false,
  };
}

function invalidProviderResponse(providerStatus: AiToolProviderStatus) {
  return new AiToolProviderError("AI 工具 Provider 返回格式无效", {
    code: "AI_TOOL_PROVIDER_INVALID_RESPONSE",
    status: 502,
    retryable: true,
    providerStatus,
  });
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 300) };
  }
}

function normalizeGatewayUrl(value: string | undefined, nodeEnv: string | undefined) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    const normalizedNodeEnv = (nodeEnv || "production").trim().toLowerCase();
    if (url.protocol !== "https:" && !(normalizedNodeEnv !== "production" && url.protocol === "http:")) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeTimeout(value: string | undefined) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_PROVIDER_TIMEOUT_MS;
  return Math.min(Math.max(Math.round(number), MIN_PROVIDER_TIMEOUT_MS), MAX_PROVIDER_TIMEOUT_MS);
}

function normalizeTaskStatus(value: unknown): AiToolTaskStatus {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "queued";
  if (normalized === "completed" || normalized === "succeeded" || normalized === "success") return "completed";
  if (normalized === "failed" || normalized === "error" || normalized === "cancelled" || normalized === "canceled") return "failed";
  if (normalized === "processing" || normalized === "running" || normalized === "in_progress") return "processing";
  return "queued";
}

function normalizeProgress(value: unknown, status: AiToolTaskStatus) {
  if (status === "completed") return 100;
  const number = typeof value === "string"
    ? Number(value.match(/\d+(?:\.\d+)?/)?.[0])
    : Number(value);
  if (!Number.isFinite(number)) return status === "processing" ? 25 : 0;
  return Math.min(Math.max(Math.round(number), 0), 99);
}

function isPublicHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function firstString(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const string = readString(value, key);
    if (string) return string;
  }
  return undefined;
}

function readString(value: Record<string, unknown>, key: string) {
  const field = value[key];
  return typeof field === "string" && field.trim() ? field.trim() : undefined;
}

function readPositiveInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
