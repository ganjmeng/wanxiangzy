import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiToolCreateRequestFor } from "@/lib/ai-tools/types";
import * as localResizeProvider from "@/lib/api/ai-tools/resize.server";

const generativeMocks = vi.hoisted(() => ({
  submit: vi.fn(),
  get: vi.fn(),
}));

vi.mock("@/lib/api/ai-tools/generative-provider.server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api/ai-tools/generative-provider.server")>(),
  submitGenerativeAiToolTask: generativeMocks.submit,
  getGenerativeAiToolTask: generativeMocks.get,
}));
import {
  AiToolProviderError,
  getAiToolProviderStatus,
  getAiToolTask,
  submitAiToolTask,
} from "@/lib/api/ai-tools/provider.server";

const LIVE_ENV = {
  NODE_ENV: "production",
  AI_TOOLS_EXECUTION_MODE: "live",
  AI_TOOLS_PROVIDER_GATEWAY_URL: "https://gateway.example.com/v1/",
  AI_TOOLS_PROVIDER_GATEWAY_TOKEN: "server-token",
  AI_TOOLS_PROVIDER_OPERATIONS: "matting,upscale",
  IMAGE_STORAGE_PROVIDER: "aliyun-oss",
  ALIYUN_OSS_ACCESS_KEY_ID: "key",
  ALIYUN_OSS_ACCESS_KEY_SECRET: "secret",
  ALIYUN_OSS_BUCKET: "bucket",
  ALIYUN_OSS_REGION: "oss-cn-hangzhou",
  ALIYUN_OSS_PUBLIC_BASE_URL: "https://oss.example.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
} as const;

const authenticatedClient = {
  from: vi.fn(),
  rpc: vi.fn(),
};

describe("AI tools provider adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("denies every gateway operation when the allowlist is omitted", () => {
    const env = { ...LIVE_ENV, AI_TOOLS_PROVIDER_OPERATIONS: undefined };
    expect(getAiToolProviderStatus("matting", env)).toMatchObject({
      available: false,
      reason: "NOT_CONFIGURED",
    });
    expect(getAiToolProviderStatus("repair-footwear", env)).toMatchObject({
      available: true,
      reason: "READY",
      provider: "generative-image-edit",
    });
  });

  it("strictly enables only explicitly listed gateway operations", () => {
    const env = {
      ...LIVE_ENV,
      AI_TOOLS_PROVIDER_OPERATIONS: "matting, upscale",
    } as const;

    expect(getAiToolProviderStatus("matting", env)).toMatchObject({ available: true });
    expect(getAiToolProviderStatus("upscale", env)).toMatchObject({ available: true });
    expect(getAiToolProviderStatus("outpaint", env)).toMatchObject({
      available: true,
      configured: true,
      reason: "READY",
      provider: "generative-image-edit",
    });
  });

  it("fails closed when the provider operation allowlist contains an invalid tool", () => {
    expect(getAiToolProviderStatus("matting", {
      ...LIVE_ENV,
      AI_TOOLS_PROVIDER_OPERATIONS: "matting,resize,unknown",
    })).toMatchObject({
      available: false,
      configured: false,
      reason: "INVALID_CONFIGURATION",
      message: "AI_TOOLS_PROVIDER_OPERATIONS 包含无效工具：resize, unknown",
    });
  });

  it("disables every gateway operation when the explicit allowlist is empty", () => {
    expect(getAiToolProviderStatus("matting", {
      ...LIVE_ENV,
      AI_TOOLS_PROVIDER_OPERATIONS: "",
    })).toMatchObject({
      available: false,
      configured: false,
      reason: "NOT_CONFIGURED",
      message: "AI_TOOLS_PROVIDER_OPERATIONS 未启用 matting",
    });
  });

  it("requires OSS and Supabase service-role prerequisites before reporting live ready", () => {
    expect(getAiToolProviderStatus("matting", {
      ...LIVE_ENV,
      SUPABASE_SERVICE_ROLE_KEY: "",
    })).toMatchObject({
      available: false,
      configured: false,
      reason: "NOT_CONFIGURED",
      message: "AI 工具任务持久化配置缺失：SUPABASE_SERVICE_ROLE_KEY",
    });
    expect(getAiToolProviderStatus("matting", {
      ...LIVE_ENV,
      ALIYUN_OSS_PUBLIC_BASE_URL: "http://oss.example.com",
    })).toMatchObject({
      available: false,
      configured: false,
      reason: "INVALID_CONFIGURATION",
      message: "ALIYUN_OSS_PUBLIC_BASE_URL 必须是无凭证的 HTTPS 地址",
    });
  });

  it("queries the live gateway and normalizes an asynchronous task", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      task_id: "task-12345678",
      request_id: "request-1234",
      operation: "erase",
      status: "RUNNING",
      stage: "provider_running",
      progress: "47%",
      outputs: [{
        url: "https://assets.example.com/partial.png",
        role: "preview",
        kind: "image",
        mime_type: "image/png",
        dimensions: { width: 1200, height: 1600 },
      }],
      provider_status: "RUNNING",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getAiToolTask("task-12345678", { userId: "user-1" }, LIVE_ENV);

    expect(result).toMatchObject({
      task_id: "task-12345678",
      request_id: "request-1234",
      operation: "erase",
      status: "processing",
      stage: "provider_running",
      progress: 47,
      provider: "generative-image-edit",
      capability: "inpaint",
      outputs: [{
        url: "https://assets.example.com/partial.png",
        role: "preview",
        kind: "image",
        mime_type: "image/png",
        dimensions: { width: 1200, height: 1600 },
      }],
      error: null,
    });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://gateway.example.com/v1/tasks/task-12345678");
    expect(init.method).toBe("GET");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer server-token");
    expect(new Headers(init.headers).get("X-Wanxiang-User-Id")).toBe("user-1");
  });

  it("uses durable task metadata when an asynchronous gateway response omits operation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      task_id: "task-12345678",
      request_id: "request-1234",
      status: "completed",
      outputs: [{
        url: "https://assets.example.com/upscaled.png",
        role: "result",
        kind: "image",
        mime_type: "image/png",
        dimensions: { width: 2400, height: 3200 },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getAiToolTask("task-12345678", {
      userId: "user-1",
      operation: "upscale",
      requestId: "request-1234",
    }, LIVE_ENV);

    expect(result).toMatchObject({
      operation: "upscale",
      request_id: "request-1234",
      provider: "aliyun-image-enhancement",
      capability: "upscale",
      status: "completed",
    });
  });

  it("rejects a gateway operation that conflicts with durable task metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      task_id: "task-12345678",
      request_id: "request-1234",
      operation: "matting",
      status: "processing",
    }), { status: 200 })));

    await expect(getAiToolTask("task-12345678", {
      userId: "user-1",
      operation: "upscale",
      requestId: "request-1234",
    }, LIVE_ENV)).rejects.toMatchObject({
      code: "AI_TOOL_PROVIDER_INVALID_RESPONSE",
      status: 502,
    });
  });

  it("never sends a local resize task to the gateway", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAiToolTask("task-12345678", {
      userId: "user-1",
      operation: "resize",
      requestId: "request-1234",
    }, {
      NODE_ENV: "production",
      AI_TOOLS_EXECUTION_MODE: "live",
      IMAGE_STORAGE_PROVIDER: "aliyun-oss",
      ALIYUN_OSS_ACCESS_KEY_ID: "key",
      ALIYUN_OSS_ACCESS_KEY_SECRET: "secret",
      ALIYUN_OSS_BUCKET: "bucket",
      ALIYUN_OSS_REGION: "oss-cn-hangzhou",
      ALIYUN_OSS_PUBLIC_BASE_URL: "https://oss.example.com",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    })).rejects.toMatchObject({
      code: "AI_TOOL_TASK_NOT_POLLABLE",
      status: 409,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes editor assets on submit and keeps auxiliary outputs out of result_urls", async () => {
    const request: AiToolCreateRequestFor<"matting"> = {
      request_id: "request-1234",
      operation: "matting",
      source_url: "https://assets.example.com/source.png",
      reference_urls: [],
      options: {
        subject: "product",
        background: "transparent",
        edge_refinement: "fine",
        output_format: "png",
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      task_id: "task-12345678",
      request_id: request.request_id,
      operation: request.operation,
      status: "completed",
      outputs: [
        {
          url: "https://assets.example.com/result.png",
          role: "result",
          kind: "image",
          mime_type: "image/png",
          dimensions: { width: 1200, height: 1600 },
        },
        {
          url: "https://assets.example.com/mask.png",
          role: "mask",
          kind: "mask",
          mime_type: "image/png",
          dimensions: { width: 1200, height: 1600 },
        },
        {
          url: "https://assets.example.com/alpha.png",
          role: "alpha",
          kind: "alpha",
          mime_type: "image/png",
          dimensions: { width: 1200, height: 1600 },
        },
      ],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitAiToolTask(request, { userId: "user-1" }, LIVE_ENV);

    expect(result.result_urls).toEqual(["https://assets.example.com/result.png"]);
    expect(result.outputs).toEqual([
      expect.objectContaining({ role: "result", kind: "image" }),
      expect.objectContaining({ role: "mask", kind: "mask" }),
      expect.objectContaining({ role: "alpha", kind: "alpha" }),
    ]);
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(init.method).toBe("POST");
  });

  it("routes outpaint to the internal generation queue without calling the external gateway", async () => {
    const request: AiToolCreateRequestFor<"outpaint"> = {
      request_id: "request-1234",
      operation: "outpaint",
      source_url: "https://assets.example.com/source.png",
      reference_urls: [],
      options: {
        target_width: 1600,
        target_height: 1200,
        anchor: "center",
        position_x: 0.25,
        position_y: 0.75,
        mask_feather: 8,
        output_format: "png",
      },
    };
    generativeMocks.submit.mockResolvedValue(generativeQueuedResult(request));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await submitAiToolTask(request, { userId: "user-1", client: authenticatedClient }, LIVE_ENV);

    expect(generativeMocks.submit).toHaveBeenCalledWith(request, {
      userId: "user-1",
      client: authenticatedClient,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed instead of using service-role credentials when user auth context is missing", async () => {
    const request: AiToolCreateRequestFor<"outpaint"> = {
      request_id: "request-auth-context-1234",
      operation: "outpaint",
      source_url: "https://assets.example.com/source.png",
      reference_urls: [],
      options: {
        target_width: 1600,
        target_height: 1200,
        anchor: "center",
        position_x: 0.5,
        position_y: 0.5,
        mask_feather: 8,
        output_format: "png",
      },
    };

    await expect(submitAiToolTask(request, { userId: "user-1" }, LIVE_ENV)).rejects.toMatchObject({
      code: "AI_TOOL_AUTH_CONTEXT_MISSING",
      status: 500,
      retryable: true,
    });
    expect(generativeMocks.submit).not.toHaveBeenCalled();
  });

  it("polls generative tools from the owned generations record without calling the external gateway", async () => {
    const result = {
      ...generativeQueuedResult({ request_id: "request-1234", operation: "erase" }),
      status: "processing" as const,
      stage: "generation_processing",
      progress: 45,
    };
    generativeMocks.get.mockResolvedValue(result);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAiToolTask(result.task_id, {
      userId: "user-1",
      client: authenticatedClient,
      operation: "erase",
      requestId: "request-1234",
    }, LIVE_ENV)).resolves.toEqual(result);

    expect(generativeMocks.get).toHaveBeenCalledWith(result.task_id, {
      userId: "user-1",
      client: authenticatedClient,
      operation: "erase",
      requestId: "request-1234",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the strict garment reference type to the internal generation adapter", async () => {
    const request: AiToolCreateRequestFor<"repair-garment"> = {
      request_id: "request-1234",
      operation: "repair-garment",
      source_url: "https://assets.example.com/person.png",
      mask_url: "https://assets.example.com/source-mask.png",
      reference_urls: ["https://assets.example.com/garment.png"],
      reference_mask_url: "https://assets.example.com/reference-mask.png",
      options: {
        reference_type: "model",
        preserve_logo: true,
        repair_mode: "detail",
        mask_feather: 8,
        output_format: "png",
      },
    };
    generativeMocks.submit.mockResolvedValue(generativeQueuedResult(request));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await submitAiToolTask(request, { userId: "user-1", client: authenticatedClient }, LIVE_ENV);

    expect(generativeMocks.submit).toHaveBeenCalledWith(request, {
      userId: "user-1",
      client: authenticatedClient,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the normalized limb target and source mask to the internal generation adapter", async () => {
    const request: AiToolCreateRequestFor<"repair-limbs"> = {
      request_id: "request-1234",
      operation: "repair-limbs",
      source_url: "https://assets.example.com/person.png",
      mask_url: "https://assets.example.com/limbs-mask.png",
      reference_urls: [],
      options: {
        target: "feet",
        preserve_identity: true,
        mask_feather: 8,
        output_format: "png",
      },
    };
    generativeMocks.submit.mockResolvedValue(generativeQueuedResult(request));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await submitAiToolTask(request, { userId: "user-1", client: authenticatedClient }, LIVE_ENV);

    expect(generativeMocks.submit).toHaveBeenCalledWith(request, {
      userId: "user-1",
      client: authenticatedClient,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes resize to the local Sharp provider without calling the AI gateway", async () => {
    const request: AiToolCreateRequestFor<"resize"> = {
      request_id: "request-1234",
      operation: "resize",
      source_url: "https://oss.example.com/source.png",
      reference_urls: [],
      options: {
        width: 800,
        height: 600,
        fit: "cover",
        position_x: 0.25,
        position_y: 0.75,
        output_format: "png",
        quality: 92,
        without_enlargement: false,
      },
    };
    const localResult = {
      task_id: "resize-task-1234",
      request_id: request.request_id,
      operation: "resize" as const,
      status: "completed" as const,
      stage: "local_resize_completed",
      progress: 100,
      expected_count: 1 as const,
      result_urls: ["https://oss.example.com/generated/result.png"],
      outputs: [{
        url: "https://oss.example.com/generated/result.png",
        role: "result" as const,
        kind: "image" as const,
        mime_type: "image/png" as const,
        dimensions: { width: 800, height: 600 },
      }],
      warnings: [],
      error: null,
      execution_mode: "live" as const,
      provider: "sharp" as const,
      capability: "resize" as const,
    };
    const execute = vi.spyOn(localResizeProvider, "executeLocalResizeTask").mockResolvedValue(localResult);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitAiToolTask(request, { userId: "user-1" }, {
      NODE_ENV: "production",
      AI_TOOLS_EXECUTION_MODE: "live",
      IMAGE_STORAGE_PROVIDER: "aliyun-oss",
      ALIYUN_OSS_ACCESS_KEY_ID: "key",
      ALIYUN_OSS_ACCESS_KEY_SECRET: "secret",
      ALIYUN_OSS_BUCKET: "bucket",
      ALIYUN_OSS_REGION: "oss-cn-hangzhou",
      ALIYUN_OSS_PUBLIC_BASE_URL: "https://oss.example.com",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    })).resolves.toEqual(localResult);
    expect(execute).toHaveBeenCalledWith(request, { userId: "user-1" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps legacy result_urls responses compatible with explicit synthesized metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      task_id: "task-12345678",
      request_id: "request-1234",
      operation: "upscale",
      status: "completed",
      result_urls: [
        "https://assets.example.com/result.webp?version=1",
        "https://assets.example.com/result-without-extension",
      ],
    }), { status: 200 })));

    const result = await getAiToolTask("task-12345678", { userId: "user-1" }, LIVE_ENV);

    expect(result.result_urls).toEqual([
      "https://assets.example.com/result.webp?version=1",
      "https://assets.example.com/result-without-extension",
    ]);
    expect(result.outputs).toEqual([
      {
        url: "https://assets.example.com/result.webp?version=1",
        role: "result",
        kind: "image",
        mime_type: "image/webp",
        dimensions: null,
      },
      {
        url: "https://assets.example.com/result-without-extension",
        role: "result",
        kind: "image",
        mime_type: null,
        dimensions: null,
      },
    ]);
  });

  it.each([
    {
      label: "missing editor metadata",
      output: { url: "https://assets.example.com/result.png" },
    },
    {
      label: "unsupported role-kind pair",
      output: {
        url: "https://assets.example.com/mask.png",
        role: "mask",
        kind: "image",
        mime_type: "image/png",
        dimensions: { width: 1200, height: 1600 },
      },
    },
    {
      label: "unsupported mime type",
      output: {
        url: "https://assets.example.com/result.avif",
        role: "result",
        kind: "image",
        mime_type: "image/avif",
        dimensions: { width: 1200, height: 1600 },
      },
    },
    {
      label: "incomplete dimensions",
      output: {
        url: "https://assets.example.com/result.png",
        role: "result",
        kind: "image",
        mime_type: "image/png",
        dimensions: { width: 1200 },
      },
    },
  ])("rejects a structured output with $label", async ({ output }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      task_id: "task-12345678",
      request_id: "request-1234",
      operation: "matting",
      status: "completed",
      outputs: [output],
    }), { status: 200 })));

    await expect(getAiToolTask("task-12345678", { userId: "user-1" }, LIVE_ENV))
      .rejects.toMatchObject({
        code: "AI_TOOL_PROVIDER_INVALID_RESPONSE",
        status: 502,
        retryable: true,
      });
  });

  it("returns a provider task failure as a normal terminal state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      task_id: "task-12345678",
      request_id: "request-1234",
      operation: "repair-limbs",
      status: "failed",
      progress: 68,
      error: {
        code: "CONTENT_REJECTED",
        message: "图片未通过内容检查",
        retryable: false,
      },
    }), { status: 200 })));

    const result = await getAiToolTask("task-12345678", { userId: "user-1" }, LIVE_ENV);

    expect(result).toMatchObject({
      status: "failed",
      progress: 68,
      result_urls: [],
      outputs: [],
      error: {
        code: "CONTENT_REJECTED",
        message: "图片未通过内容检查",
        retryable: false,
      },
    });
  });

  it("keeps development mock task state available to the creating user", async () => {
    const request: AiToolCreateRequestFor<"matting"> = {
      request_id: "request-1234",
      operation: "matting",
      source_url: "https://assets.example.com/source.png",
      reference_urls: [],
      options: {
        subject: "auto",
        background: "transparent",
        edge_refinement: "standard",
        output_format: "png",
      },
    };
    const env = { NODE_ENV: "development", AI_TOOLS_EXECUTION_MODE: "mock" } as const;

    const created = await submitAiToolTask(request, { userId: "user-1" }, env);
    const polled = await getAiToolTask(created.task_id, { userId: "user-1" }, env);

    expect(polled).toEqual(created);
    expect(polled).toMatchObject({
      status: "completed",
      progress: 100,
      outputs: [{
        url: request.source_url,
        role: "result",
        kind: "image",
        mime_type: "image/png",
        dimensions: null,
      }],
      error: null,
    });
    await expect(getAiToolTask(created.task_id, { userId: "user-2" }, env)).rejects.toMatchObject({
      code: "AI_TOOL_TASK_NOT_FOUND",
      status: 404,
    });
  });

  it("maps a gateway 404 to a non-retryable task lookup error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "not found",
    }), { status: 404 })));

    await expect(getAiToolTask("task-12345678", { userId: "user-1" }, LIVE_ENV))
      .rejects.toEqual(expect.objectContaining<Partial<AiToolProviderError>>({
        code: "AI_TOOL_TASK_NOT_FOUND",
        status: 404,
        retryable: false,
      }));
  });
});

function generativeQueuedResult(
  request: {
    request_id: string;
    operation: "outpaint" | "erase" | "repair-limbs" | "repair-garment" | "repair-footwear";
  },
) {
  return {
    task_id: "00000000-0000-4000-8000-000000000111",
    request_id: request.request_id,
    operation: request.operation,
    status: "queued" as const,
    stage: "generation_queued",
    progress: 1,
    expected_count: 1 as const,
    result_urls: [],
    outputs: [],
    warnings: [],
    error: null,
    execution_mode: "live" as const,
    provider: "generative-image-edit" as const,
    capability: request.operation === "outpaint" ? "outpaint" as const : "inpaint" as const,
    provider_status: "QUEUED",
  };
}
