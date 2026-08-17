import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
  getAiToolProviderStatus: vi.fn(),
  submitAiToolTask: vi.fn(),
  getAiToolTask: vi.fn(),
  persistCompletedAiToolOutputs: vi.fn(),
  resolveOwnedAiToolSubmission: vi.fn(),
  beginAiToolTaskSubmission: vi.fn(),
  bindAiToolTaskProviderResult: vi.fn(),
  findOwnedAiToolTaskByProviderTaskId: vi.fn(),
  getReusableAiToolTaskResult: vi.fn(),
  markAiToolTaskSubmissionFailed: vi.fn(),
  recordAiToolTaskProviderResult: vi.fn(),
  syncAiToolTaskQueueById: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock("@/lib/api/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitResponse: mocks.rateLimitResponse,
}));
vi.mock("@/lib/api/ai-tools/provider.server", () => ({
  AiToolProviderError: class AiToolProviderError extends Error {},
  getAiToolProviderStatus: mocks.getAiToolProviderStatus,
  submitAiToolTask: mocks.submitAiToolTask,
  getAiToolTask: mocks.getAiToolTask,
}));
vi.mock("@/lib/api/ai-tools/output-storage.server", () => ({
  AiToolOutputStorageError: class AiToolOutputStorageError extends Error {
    readonly code: string;
    readonly status: number;
    readonly retryable: boolean;
    readonly taskId: string;

    constructor(
      message: string,
      options: { code: string; taskId: string; status?: number; retryable?: boolean },
    ) {
      super(message);
      this.code = options.code;
      this.status = options.status ?? 502;
      this.retryable = options.retryable ?? true;
      this.taskId = options.taskId;
    }
  },
  persistCompletedAiToolOutputs: mocks.persistCompletedAiToolOutputs,
}));
vi.mock("@/lib/api/ai-tools/input-ownership.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/ai-tools/input-ownership.server")>();
  return { ...actual, resolveOwnedAiToolSubmission: mocks.resolveOwnedAiToolSubmission };
});
vi.mock("@/lib/api/ai-tools/task-repository.server", () => ({
  AiToolTaskRepositoryError: class AiToolTaskRepositoryError extends Error {
    readonly code: string;
    readonly status: number;
    readonly retryable: boolean;

    constructor(message: string, options: { code: string; status?: number; retryable?: boolean }) {
      super(message);
      this.code = options.code;
      this.status = options.status ?? 503;
      this.retryable = options.retryable ?? false;
    }
  },
  beginAiToolTaskSubmission: mocks.beginAiToolTaskSubmission,
  bindAiToolTaskProviderResult: mocks.bindAiToolTaskProviderResult,
  findOwnedAiToolTaskByProviderTaskId: mocks.findOwnedAiToolTaskByProviderTaskId,
  getReusableAiToolTaskResult: mocks.getReusableAiToolTaskResult,
  markAiToolTaskSubmissionFailed: mocks.markAiToolTaskSubmissionFailed,
  recordAiToolTaskProviderResult: mocks.recordAiToolTaskProviderResult,
}));
vi.mock("@/lib/task-queue-store", () => ({
  syncAiToolTaskQueueById: mocks.syncAiToolTaskQueueById,
}));

import { GET, POST } from "@/app/api/ai-tools/route";
import { GET as GET_CAPABILITIES } from "@/app/api/ai-tools/capabilities/route";
import { AiToolOutputStorageError } from "@/lib/api/ai-tools/output-storage.server";
import { AiToolInputOwnershipError } from "@/lib/api/ai-tools/input-ownership.server";
import { AiToolTaskRepositoryError } from "@/lib/api/ai-tools/task-repository.server";

const authenticatedSupabase = {
  from: vi.fn(),
  rpc: vi.fn(),
};

describe("AI tools API", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({
      supabase: authenticatedSupabase,
      user: { id: "user-1" },
      response: null,
    });
    mocks.checkRateLimit.mockResolvedValue({ ok: true });
    mocks.syncAiToolTaskQueueById.mockResolvedValue(undefined);
    mocks.persistCompletedAiToolOutputs.mockImplementation(async (result: unknown) => result);
    mocks.resolveOwnedAiToolSubmission.mockImplementation(async (request: Record<string, unknown>) => ({
      request,
      sourceOwnership: {
        assetId: null,
        url: request.source_url,
        width: 800,
        height: 800,
        proof: "resource_asset",
      },
    }));
    mocks.beginAiToolTaskSubmission.mockImplementation(async () => ({
      state: "claimed",
      task: durableTask(),
      leaseToken: "lease-1",
    }));
    mocks.bindAiToolTaskProviderResult.mockImplementation(async (
      task: Record<string, unknown>,
      _lease: string,
      result: { task_id: string },
    ) => ({ ...task, providerTaskId: result.task_id }));
    mocks.findOwnedAiToolTaskByProviderTaskId.mockImplementation(
      async (_userId: string, taskId: string) => durableTask(taskId),
    );
    mocks.getReusableAiToolTaskResult.mockReturnValue(null);
    mocks.markAiToolTaskSubmissionFailed.mockResolvedValue(undefined);
    mocks.recordAiToolTaskProviderResult.mockImplementation(async (task: unknown) => task);
  });

  it("fails closed with a structured 503 when the provider is unavailable", async () => {
    mocks.getAiToolProviderStatus.mockReturnValue({
      provider: "aliyun-segmentation",
      capability: "segment",
      requested_mode: "live",
      execution_mode: "live",
      available: false,
      configured: false,
      mock: false,
      reason: "NOT_CONFIGURED",
      message: "AI 工具 Provider 尚未配置",
    });

    const response = await POST(aiToolRequest({
      request_id: "request-1234",
      operation: "matting",
      source_url: "https://assets.example.com/source.png",
      options: {},
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "AI_TOOL_PROVIDER_UNAVAILABLE",
      operation: "matting",
      provider_status: { reason: "NOT_CONFIGURED" },
      retryable: false,
    });
    expect(mocks.submitAiToolTask).not.toHaveBeenCalled();
  });

  it("exposes the eight-tool capability catalog without provider secrets", async () => {
    vi.stubEnv("AI_TOOLS_PROVIDER_OPERATIONS", "matting");
    mocks.getAiToolProviderStatus.mockImplementation((slug: string) => ({
      provider: slug === "resize" ? "sharp" : "generative-image-edit",
      capability: slug === "resize" ? "resize" : "inpaint",
      requested_mode: "live",
      execution_mode: "live",
      available: false,
      configured: false,
      mock: false,
      reason: "NOT_CONFIGURED",
      message: "AI 工具 Provider 尚未配置",
    }));

    const response = await GET_CAPABILITIES();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body.enabled).toBe(false);
    expect(body.configuration).toMatchObject({
      provider_operation_policy: "explicit-allowlist",
      live_prerequisites: ["aliyun-oss", "supabase-service-role", "published-image-model-provider"],
    });
    expect(body.tools).toHaveLength(8);
    expect(body.tools[0]).toMatchObject({ slug: "matting", label: "AI抠图", available: false });
    expect(JSON.stringify(body)).not.toContain("server-secret");
  });

  it("validates mask requirements before provider submission", async () => {
    const response = await POST(aiToolRequest({
      request_id: "request-1234",
      operation: "erase",
      source_url: "https://assets.example.com/source.png",
      options: {},
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "AI_TOOL_VALIDATION_FAILED",
      details: { issues: [expect.objectContaining({ path: "$.mask_url" })] },
    });
    expect(mocks.getAiToolProviderStatus).not.toHaveBeenCalled();
  });

  it("requires an editor mask for limb repair before provider submission", async () => {
    const response = await POST(aiToolRequest({
      request_id: "request-1234",
      operation: "repair-limbs",
      source_url: "https://assets.example.com/person.png",
      options: { target: "both" },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "AI_TOOL_VALIDATION_FAILED",
      details: { issues: [expect.objectContaining({ path: "$.mask_url", code: "missing_field" })] },
    });
    expect(mocks.getAiToolProviderStatus).not.toHaveBeenCalled();
  });

  it("returns a no-charge mock result supplied by the server provider", async () => {
    mocks.getAiToolProviderStatus.mockReturnValue({
      provider: "sharp",
      capability: "resize",
      requested_mode: "mock",
      execution_mode: "mock",
      available: true,
      configured: true,
      mock: true,
      reason: "MOCK_READY",
      message: "开发 Mock Provider 已启用",
    });
    mocks.submitAiToolTask.mockResolvedValue({
      task_id: "mock-task-1",
      request_id: "request-1234",
      operation: "resize",
      status: "completed",
      stage: "mock_completed",
      progress: 100,
      expected_count: 1,
      result_urls: ["https://assets.example.com/source.png"],
      outputs: [{
        url: "https://assets.example.com/source.png",
        role: "result",
        kind: "image",
        mime_type: "image/png",
        dimensions: { width: 800, height: 800 },
      }],
      warnings: ["mock"],
      error: null,
      execution_mode: "mock",
      provider: "sharp",
      capability: "resize",
    });

    const response = await POST(aiToolRequest({
      request_id: "request-1234",
      operation: "resize",
      source_url: "https://assets.example.com/source.png",
      options: { width: 800, height: 800 },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      task_id: "mock-task-1",
      execution_mode: "mock",
      outputs: [{
        role: "result",
        kind: "image",
        mime_type: "image/png",
        dimensions: { width: 800, height: 800 },
      }],
      credits_cost: 0,
      billing_status: "not_debited",
    });
    expect(mocks.persistCompletedAiToolOutputs).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: "mock-task-1", status: "completed" }),
      { userId: "user-1" },
    );
  });

  it("returns only the safely persisted completed live outputs", async () => {
    mocks.getAiToolProviderStatus.mockReturnValue({
      provider: "aliyun-segmentation",
      capability: "segment",
      requested_mode: "live",
      execution_mode: "live",
      available: true,
      configured: true,
      mock: false,
      reason: "READY",
      message: "AI 工具 Provider 已就绪",
    });
    const providerResult = {
      task_id: "live-task-1234",
      request_id: "request-1234",
      operation: "matting",
      status: "completed",
      stage: "completed",
      progress: 100,
      expected_count: 1,
      result_urls: ["https://provider.example/result.png"],
      outputs: [{
        url: "https://provider.example/result.png",
        role: "result",
        kind: "image",
        mime_type: "image/png",
        dimensions: { width: 800, height: 800 },
      }],
      warnings: [],
      error: null,
      execution_mode: "live",
      provider: "aliyun-segmentation",
      capability: "segment",
    };
    mocks.submitAiToolTask.mockResolvedValue(providerResult);
    mocks.persistCompletedAiToolOutputs.mockResolvedValue({
      ...providerResult,
      result_urls: ["https://bucket.example/generated/result.png"],
      outputs: [{
        ...providerResult.outputs[0],
        url: "https://bucket.example/generated/result.png",
      }],
    });

    const response = await POST(aiToolRequest({
      request_id: "request-1234",
      operation: "matting",
      source_url: "https://assets.example.com/source.png",
      options: {},
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      result_urls: ["https://bucket.example/generated/result.png"],
      outputs: [{ url: "https://bucket.example/generated/result.png", role: "result" }],
    });
    expect(mocks.persistCompletedAiToolOutputs).toHaveBeenCalledWith(
      providerResult,
      expect.objectContaining({ userId: "user-1", task: expect.any(Object) }),
    );
    expect(mocks.resolveOwnedAiToolSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ source_url: "https://assets.example.com/source.png" }),
      {},
      expect.objectContaining({ userId: "user-1", executionMode: "live" }),
    );
    expect(mocks.submitAiToolTask).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "matting" }),
      { userId: "user-1", client: authenticatedSupabase },
    );
  });

  it("does not submit a live provider task when source ownership cannot be proven", async () => {
    mocks.getAiToolProviderStatus.mockReturnValue({
      provider: "sharp",
      capability: "resize",
      requested_mode: "live",
      execution_mode: "live",
      available: true,
      configured: true,
      mock: false,
      reason: "READY",
      message: "AI 工具 Provider 已就绪",
    });
    mocks.resolveOwnedAiToolSubmission.mockRejectedValue(new AiToolInputOwnershipError(
      "原图不属于当前用户，请重新上传或从资源仓库选择",
      { code: "AI_TOOL_INPUT_NOT_OWNED", status: 403 },
    ));

    const response = await POST(aiToolRequest({
      request_id: "request-1234",
      operation: "resize",
      source_url: "https://attacker.example/source.png",
      options: { width: 800, height: 800 },
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      code: "AI_TOOL_INPUT_NOT_OWNED",
      stage: "input_ownership_failed",
      retryable: false,
    });
    expect(mocks.submitAiToolTask).not.toHaveBeenCalled();
  });

  it("fails closed with a structured postprocessing error when output storage fails", async () => {
    mocks.getAiToolProviderStatus.mockReturnValue({
      provider: "aliyun-segmentation",
      capability: "segment",
      requested_mode: "live",
      execution_mode: "live",
      available: true,
      configured: true,
      mock: false,
      reason: "READY",
      message: "AI 工具 Provider 已就绪",
    });
    mocks.submitAiToolTask.mockResolvedValue({
      task_id: "live-task-5678",
      request_id: "request-1234",
      operation: "matting",
      status: "completed",
      result_urls: ["https://provider.example/result.png"],
      outputs: [],
    });
    mocks.persistCompletedAiToolOutputs.mockRejectedValue(new AiToolOutputStorageError(
      "AI 工具结果转存失败，请稍后重试",
      {
        code: "AI_TOOL_OUTPUT_STORE_FAILED",
        taskId: "live-task-5678",
        status: 502,
        retryable: true,
      },
    ));

    const response = await POST(aiToolRequest({
      request_id: "request-1234",
      operation: "matting",
      source_url: "https://assets.example.com/source.png",
      options: {},
    }));

    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      code: "AI_TOOL_OUTPUT_STORE_FAILED",
      task_id: "live-task-5678",
      status: "failed",
      stage: "postprocessing_failed",
      result_urls: [],
      outputs: [],
      task_error: { retryable: true },
    });
  });

  it("keeps polling when another instance currently owns the output persistence lease", async () => {
    mocks.getAiToolProviderStatus.mockReturnValue({
      provider: "aliyun-segmentation",
      capability: "segment",
      requested_mode: "live",
      execution_mode: "live",
      available: true,
      configured: true,
      mock: false,
      reason: "READY",
      message: "AI 工具 Provider 已就绪",
    });
    mocks.submitAiToolTask.mockResolvedValue({
      task_id: "live-task-busy-1",
      request_id: "request-1234",
      operation: "matting",
      status: "completed",
      stage: "completed",
      progress: 100,
      expected_count: 1,
      result_urls: ["https://provider.example/result.png"],
      outputs: [],
      warnings: [],
      error: null,
      execution_mode: "live",
      provider: "aliyun-segmentation",
      capability: "segment",
    });
    mocks.persistCompletedAiToolOutputs.mockRejectedValue(new AiToolOutputStorageError(
      "AI 工具结果正在安全转存，请稍后重试",
      {
        code: "AI_TOOL_OUTPUT_PERSISTENCE_BUSY",
        taskId: "live-task-busy-1",
        status: 409,
        retryable: true,
      },
    ));

    const response = await POST(aiToolRequest({
      request_id: "request-1234",
      operation: "matting",
      source_url: "https://assets.example.com/source.png",
      options: {},
    }));

    expect(response.status).toBe(202);
    expect(response.headers.get("Retry-After")).toBe("2");
    await expect(response.json()).resolves.toMatchObject({
      task_id: "live-task-busy-1",
      status: "processing",
      stage: "persisting_outputs",
      retryable: true,
    });
  });

  it("rejects a missing or malformed task_id before provider lookup", async () => {
    const response = await GET(new Request("http://localhost/api/ai-tools?task_id=bad/id"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "AI_TOOL_TASK_ID_INVALID",
      details: { issues: [expect.objectContaining({ path: "$query.task_id" })] },
    });
    expect(mocks.getAiToolTask).not.toHaveBeenCalled();
  });

  it("looks up the durable user/task binding before calling the live provider", async () => {
    mocks.findOwnedAiToolTaskByProviderTaskId.mockRejectedValue(new AiToolTaskRepositoryError(
      "AI 工具任务不存在",
      { code: "AI_TOOL_TASK_NOT_FOUND", status: 404 },
    ));

    const response = await GET(new Request("http://localhost/api/ai-tools?task_id=task-other-user"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "AI_TOOL_TASK_NOT_FOUND",
      stage: "task_persistence_failed",
    });
    expect(mocks.findOwnedAiToolTaskByProviderTaskId).toHaveBeenCalledWith("user-1", "task-other-user");
    expect(mocks.getAiToolTask).not.toHaveBeenCalled();
  });

  it("fails closed before provider submission when the durable task migration is missing", async () => {
    mocks.getAiToolProviderStatus.mockReturnValue({
      provider: "aliyun-segmentation",
      capability: "segment",
      requested_mode: "live",
      execution_mode: "live",
      available: true,
      configured: true,
      mock: false,
      reason: "READY",
      message: "AI 工具 Provider 已就绪",
    });
    mocks.beginAiToolTaskSubmission.mockRejectedValue(new AiToolTaskRepositoryError(
      "AI 工具任务持久化迁移尚未部署",
      { code: "AI_TOOL_TASK_STORE_MIGRATION_REQUIRED", status: 503 },
    ));

    const response = await POST(aiToolRequest({
      request_id: "request-1234",
      operation: "matting",
      source_url: "https://assets.example.com/source.png",
      options: {},
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "AI_TOOL_TASK_STORE_MIGRATION_REQUIRED",
      request_id: "request-1234",
      stage: "task_persistence_failed",
      retryable: false,
    });
    expect(mocks.submitAiToolTask).not.toHaveBeenCalled();
  });

  it("reuses an idempotent request response without submitting a second provider task", async () => {
    mocks.getAiToolProviderStatus.mockReturnValue({
      provider: "aliyun-segmentation",
      capability: "segment",
      requested_mode: "live",
      execution_mode: "live",
      available: true,
      configured: true,
      mock: false,
      reason: "READY",
      message: "AI 工具 Provider 已就绪",
    });
    const result = {
      task_id: "task-existing-1234",
      request_id: "request-1234",
      operation: "matting",
      status: "queued",
      stage: "queued",
      progress: 0,
      expected_count: 1,
      result_urls: [],
      outputs: [],
      warnings: [],
      error: null,
      execution_mode: "live",
      provider: "aliyun-segmentation",
      capability: "segment",
    };
    mocks.beginAiToolTaskSubmission.mockResolvedValue({
      state: "existing",
      task: durableTask(result.task_id),
      result,
    });

    const response = await POST(aiToolRequest({
      request_id: "request-1234",
      operation: "matting",
      source_url: "https://assets.example.com/source.png",
      options: {},
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ task_id: result.task_id, status: "queued" });
    expect(mocks.submitAiToolTask).not.toHaveBeenCalled();
  });

  it("returns the normalized asynchronous task state", async () => {
    mocks.getAiToolTask.mockResolvedValue({
      task_id: "task-12345678",
      request_id: "request-1234",
      operation: "erase",
      status: "processing",
      stage: "provider_running",
      progress: 47,
      expected_count: 1,
      result_urls: [],
      outputs: [{
        url: "https://assets.example.com/preview.png",
        role: "preview",
        kind: "image",
        mime_type: "image/png",
        dimensions: { width: 640, height: 640 },
      }],
      warnings: [],
      error: null,
      execution_mode: "live",
      provider: "generative-image-edit",
      capability: "inpaint",
      provider_status: "RUNNING",
      credits_cost: 6,
      billing_status: "debited",
    });

    const response = await GET(new Request("http://localhost/api/ai-tools?task_id=task-12345678"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      task_id: "task-12345678",
      status: "processing",
      progress: 47,
      result_urls: [],
      outputs: [{
        role: "preview",
        kind: "image",
        mime_type: "image/png",
        dimensions: { width: 640, height: 640 },
      }],
      error: null,
      credits_cost: 6,
      billing_status: "debited",
      task_context: {
        operation: "matting",
        source_url: "https://assets.example.com/source.png",
        source_width: 800,
        source_height: 800,
      },
    });
    expect(mocks.getAiToolTask).toHaveBeenCalledWith("task-12345678", {
      userId: "user-1",
      client: authenticatedSupabase,
      operation: "matting",
      requestId: "request-1234",
    });
  });

  it("persists completed outputs returned by task polling before responding", async () => {
    const providerResult = {
      task_id: "task-87654321",
      request_id: "request-1234",
      operation: "matting",
      status: "completed",
      stage: "completed",
      progress: 100,
      expected_count: 1,
      result_urls: ["https://provider.example/result.png"],
      outputs: [{
        url: "https://provider.example/result.png",
        role: "result",
        kind: "image",
        mime_type: "image/png",
        dimensions: { width: 640, height: 480 },
      }],
      warnings: [],
      error: null,
      execution_mode: "live",
      provider: "aliyun-segmentation",
      capability: "segment",
    };
    mocks.getAiToolTask.mockResolvedValue(providerResult);
    mocks.persistCompletedAiToolOutputs.mockResolvedValue({
      ...providerResult,
      result_urls: ["https://bucket.example/generated/result.png"],
      outputs: [{ ...providerResult.outputs[0], url: "https://bucket.example/generated/result.png" }],
    });

    const response = await GET(new Request("http://localhost/api/ai-tools?task_id=task-87654321"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "completed",
      result_urls: ["https://bucket.example/generated/result.png"],
    });
    expect(mocks.persistCompletedAiToolOutputs).toHaveBeenCalledWith(
      providerResult,
      expect.objectContaining({ userId: "user-1", task: expect.any(Object) }),
    );
  });
});

function aiToolRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/ai-tools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function durableTask(providerTaskId: string | null = null) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    userId: "user-1",
    requestId: "request-1234",
    provider: "aliyun-segmentation",
    providerTaskId,
    operation: "matting",
    requestFingerprint: "a".repeat(64),
    sourceAssetId: null,
    sourceUrl: "https://assets.example.com/source.png",
    sourceWidth: 800,
    sourceHeight: 800,
    sourceOwnership: {},
    requestPayload: null,
    status: "queued",
    providerPayload: {},
    outputs: [],
    resultUrls: [],
    responsePayload: {},
    outputSignature: null,
    outputPersistenceStatus: "pending",
    submissionLeaseToken: null,
    submissionLeaseExpiresAt: null,
    outputLeaseToken: null,
    outputLeaseExpiresAt: null,
    generationId: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}
