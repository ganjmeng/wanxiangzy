import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiResolvedDeployment } from "@/lib/ai-control-plane/types";
import { __lingyaTaskResponseTestUtils, generateImage } from "../lingya";

const {
  buildImageEditRequest,
  buildImageGenerationRequest,
  buildGeminiNativeImageRequest,
  buildGenerateRequestBody,
  calculateImageRequestHeartbeatProgress,
  extractGeneratedImages,
  getImageEditUrl,
  getImageGenerationUrl,
  getGeminiGenerateContentUrl,
  isDefinitelyUnacceptedProviderResponse,
  normalizeImageTaskResponse,
  resolveGptImage2Size,
  resolveProviderImageModel,
  shouldUseGeminiNativeEndpoint,
  shouldUseImageEditEndpoint,
  shouldRequestAsyncImageTask,
} = __lingyaTaskResponseTestUtils;

function nativeLiteDeployment(): AiResolvedDeployment {
  return {
    id: "banana2-lite-default",
    modelId: "nano-banana-2-lite",
    providerId: "banana2-lite-default",
    upstreamModel: "gemini-3.1-flash-lite-image",
    protocol: "gemini-native",
    enabled: true,
    priority: 10,
    weight: 100,
    maxConcurrency: 24,
    requestsPerMinute: 60,
    burst: 24,
    provider: {
      id: "banana2-lite-default",
      name: "yunwu-native",
      baseUrl: "https://api.new.bi",
      enabled: true,
      timeoutMs: 120_000,
    },
    apiKey: "test-key",
    health: {
      deploymentId: "banana2-lite-default",
      circuitState: "closed",
      consecutiveFailures: 0,
      sampleCount: 0,
      ewmaSuccessRate: 1,
      ewmaLatencyMs: 0,
    },
    score: 1,
    selectionReason: {},
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lingya async task response parsing", () => {
  it("fails over only for gateway responses that prove submission never happened", () => {
    expect(isDefinitelyUnacceptedProviderResponse(503, "model_not_found")).toBe(true);
    expect(isDefinitelyUnacceptedProviderResponse(500, "local:convert_request_failed")).toBe(true);
    expect(isDefinitelyUnacceptedProviderResponse(503, "upstream_timeout")).toBe(false);
    expect(isDefinitelyUnacceptedProviderResponse(500)).toBe(false);
  });

  it("forwards a stable idempotency key on image submissions", () => {
    const request = buildImageGenerationRequest({
      apiBase: "https://api.example.com/v1",
      apiKey: "test-key",
      provider: { name: "admin" },
      body: { model: "gpt-image-2", prompt: "test" },
      idempotencyKey: "gen-image:test:abc123",
    });
    expect(request.init.headers).toMatchObject({ "Idempotency-Key": "gen-image:test:abc123" });
  });
  it("extracts generated image URLs from nested provider result fields", () => {
    const state = normalizeImageTaskResponse({
      data: {
        task_id: "task-1",
        status: "SUCCESS",
        output: {
          results: [
            { file_url: "https://example.com/generated-a.png" },
            { downloadUrl: "https://example.com/generated-b.png" },
          ],
        },
      },
    }, "fallback-task");

    expect(state.status).toBe("completed");
    expect(state.progress).toBe(100);
    expect(state.urls).toEqual([
      "https://example.com/generated-a.png",
      "https://example.com/generated-b.png",
    ]);
  });

  it("keeps a successful task running while the result URL is not ready yet", () => {
    const state = normalizeImageTaskResponse({
      data: {
        task_id: "task-2",
        status: "SUCCESS",
        progress: 100,
        output: {},
      },
    }, "fallback-task");

    expect(state.status).toBe("running");
    expect(state.providerStatus).toBe("SUCCESS");
    expect(state.progress).toBe(99);
    expect(state.urls).toEqual([]);
  });

  it("does not treat echoed input/reference images as generated results", () => {
    const images = extractGeneratedImages({
      status: "RUNNING",
      input: {
        image_url: "https://example.com/source.png",
      },
      request: {
        reference_url: "https://example.com/reference.png",
      },
    });

    expect(images.urls).toEqual([]);
  });

  it("extracts inline images from native Gemini responses", () => {
    const images = extractGeneratedImages({
      candidates: [{
        content: {
          parts: [{
            inlineData: {
              mimeType: "image/jpeg",
              data: "aGVsbG8=",
            },
          }],
        },
      }],
    });

    expect(images.urls).toEqual([]);
    expect(images.b64Json).toBe("data:image/jpeg;base64,aGVsbG8=");
  });

  it("completes a native response that contains both an inline image and task_id without polling", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      task_id: "provider-trace-task",
      candidates: [{
        content: {
          parts: [{ inlineData: { mimeType: "image/jpeg", data: "aGVsbG8=" } }],
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateImage({
      model: "nano-banana-2-lite",
      prompt: "generate a red cup",
      image_size: "1K",
      aspect_ratio: "1:1",
      routingDeployment: nativeLiteDeployment(),
    });

    expect(result.b64_json).toBe("data:image/jpeg;base64,aGVsbG8=");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never polls a task_id returned by a synchronous native protocol without an image", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      task_id: "provider-trace-without-image",
      candidates: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = generateImage({
      model: "nano-banana-2-lite",
      prompt: "generate a red cup",
      image_size: "1K",
      aspect_ratio: "1:1",
      routingDeployment: nativeLiteDeployment(),
    });

    await expect(promise).rejects.toMatchObject({
      code: "PROVIDER_AMBIGUOUS_RESPONSE",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves safe diagnostics for an explicit transient upstream 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "UPSTREAM_ROUTE_NOT_FOUND", message: "untrusted internal detail" },
    }), {
      status: 404,
      headers: { "Content-Type": "application/json", "x-request-id": "newbi-trace-123" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateImage({
      model: "nano-banana-2-lite",
      prompt: "generate a red cup",
      image_size: "1K",
      aspect_ratio: "1:1",
      routingDeployment: nativeLiteDeployment(),
    })).rejects.toMatchObject({
      name: "ProviderHttpResponseError",
      status: 404,
      code: "UPSTREAM_ROUTE_NOT_FOUND",
      providerRequestId: "newbi-trace-123",
      safeToFailover: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not mark an ambiguous upstream 5xx as safe for cross-provider replay", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad gateway", { status: 503 })));

    await expect(generateImage({
      model: "nano-banana-2-lite",
      prompt: "generate a red cup",
      image_size: "1K",
      aspect_ratio: "1:1",
      routingDeployment: nativeLiteDeployment(),
    })).rejects.toMatchObject({
      name: "ProviderHttpResponseError",
      status: 503,
      safeToFailover: false,
    });
  });

  it("uses synchronous image generation for unified control-plane deployments", () => {
    expect(shouldRequestAsyncImageTask({ name: "admin" })).toBe(false);
    expect(getImageGenerationUrl("https://provider.example/v1", { name: "admin" }))
      .toBe("https://provider.example/v1/images/generations");
  });

  it("routes Gemini-native deployments through generateContent", async () => {
    const request = await buildGeminiNativeImageRequest({
      apiBase: "https://provider.example",
      apiKey: "test-key",
      model: "gemini-3.1-flash-image",
      prompt: "generate a red cup",
      imageUrls: [],
      aspectRatio: "3:4",
      imageSize: "2K",
    });

    expect(shouldUseGeminiNativeEndpoint(
      { model: "nano-banana-2" },
      { name: "admin", responseType: "gemini-native" },
    ))
      .toBe(true);
    expect(getGeminiGenerateContentUrl("https://provider.example", "gemini-3.1-flash-image"))
      .toBe("https://provider.example/v1beta/models/gemini-3.1-flash-image:generateContent");
    expect(request.url).toBe("https://provider.example/v1beta/models/gemini-3.1-flash-image:generateContent");
    expect(request.init.headers).toMatchObject({ "x-goog-api-key": "test-key", "Content-Type": "application/json" });
    expect(JSON.parse(String(request.init.body))).toMatchObject({
      contents: [{ role: "user", parts: [{ text: "generate a red cup" }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "3:4", imageSize: "2K" },
      },
    });
  });

  it("routes gpt-image-2 reference image requests through image edits", () => {
    const body = buildGenerateRequestBody({
      model: "gpt-image-2",
      prompt: "swap the face",
      aspect_ratio: "9:16",
      image: ["https://example.com/source.png", "https://example.com/face.jpg"],
      image_size: "1K",
    }, "compiled prompt");

    expect(shouldUseImageEditEndpoint(
      { model: "gpt-image-2", image: ["https://example.com/source.png"] },
      { name: "admin", responseType: "openai-image" },
    ))
      .toBe(true);
    expect(getImageEditUrl("https://provider.example/v1")).toBe("https://provider.example/v1/images/edits");
    expect(body).toMatchObject({
      model: "gpt-image-2",
      prompt: "compiled prompt",
      size: "864x1536",
      quality: "auto",
    });
    expect(body).not.toHaveProperty("image");
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("aspect_ratio");
  });

  it("builds gpt-image-2 edits as multipart form data", async () => {
    const request = await buildImageEditRequest({
      apiBase: "https://provider.example/v1",
      apiKey: "test-key",
      body: {
        model: "gpt-image-2",
        prompt: "make it premium",
        size: "2048x2048",
        quality: "auto",
      },
      imageUrls: ["data:image/png;base64,aGVsbG8="],
      maskUrl: "data:image/png;base64,bWFzaw==",
    });

    expect(request.url).toBe("https://provider.example/v1/images/edits");
    expect(request.init.headers).toMatchObject({
      Authorization: "Bearer test-key",
      Accept: "application/json",
    });
    expect(request.init.headers).not.toHaveProperty("Content-Type");
    expect(request.init.body).toBeInstanceOf(FormData);
    const form = request.init.body as FormData;
    expect(form.getAll("image")).toHaveLength(1);
    expect(form.get("image")).toBeInstanceOf(Blob);
    expect(form.get("mask")).toBeInstanceOf(Blob);
    expect(form.get("n")).toBe("1");
  });

  it("rejects too many gpt-image-2 edit reference images before calling the provider", async () => {
    await expect(buildImageEditRequest({
      apiBase: "https://provider.example/v1",
      apiKey: "test-key",
      body: {
        model: "gpt-image-2",
        prompt: "make it premium",
        size: "2048x2048",
        quality: "auto",
      },
      imageUrls: Array.from({ length: 16 }, () => "data:image/png;base64,aGVsbG8="),
    })).rejects.toThrow("fewer than 16");
  });

  it("maps gpt-image-2 selected resolution into the documented size field", () => {
    expect(resolveGptImage2Size("1K", "1:1")).toBe("1024x1024");
    expect(resolveGptImage2Size("1K", "16:9")).toBe("1536x864");
    expect(resolveGptImage2Size("1K", "9:16")).toBe("864x1536");
    expect(resolveGptImage2Size("1K", "3:4")).toBe("1152x1536");
    expect(resolveGptImage2Size("1K", "4:5")).toBe("1216x1520");
    expect(resolveGptImage2Size("2K", "1:1")).toBe("2048x2048");
    expect(resolveGptImage2Size("2K", "16:9")).toBe("2048x1152");
    expect(resolveGptImage2Size("2K", "9:16")).toBe("1152x2048");
    expect(resolveGptImage2Size("2K", "3:4")).toBe("1536x2048");
    expect(resolveGptImage2Size("4K", "16:9")).toBe("3840x2160");
    expect(resolveGptImage2Size("4K", "9:16")).toBe("2160x3840");
    expect(resolveGptImage2Size("4K", "3:4")).toBe("2448x3264");
    expect(resolveGptImage2Size("4K", "1:1")).toBe("2880x2880");
    expect(resolveGptImage2Size("2K", "auto")).toBe("2048x2048");
    expect(resolveGptImage2Size("4K", "auto")).toBe("3840x2160");
  });

  it("falls back to the safest supported size for unknown image size values", () => {
    const body = buildGenerateRequestBody({
      model: "gpt-image-2",
      prompt: "make it premium",
      aspect_ratio: "16:9",
      image: ["https://example.com/source.png"],
      image_size: "1024x1024" as never,
    }, "compiled prompt");

    expect(body).toMatchObject({ model: "gpt-image-2", size: "1536x864", quality: "auto" });
  });

  it("preserves gpt-image-2 2K and 4K selections in request bodies", () => {
    const twoK = buildGenerateRequestBody({
      model: "gpt-image-2",
      prompt: "make it premium",
      aspect_ratio: "16:9",
      image: ["https://example.com/source.png"],
      image_size: "2K",
    }, "compiled prompt");
    const fourK = buildGenerateRequestBody({
      model: "gpt-image-2",
      prompt: "make it premium",
      aspect_ratio: "16:9",
      image: ["https://example.com/source.png"],
      image_size: "4K",
    }, "compiled prompt");

    expect(twoK).toMatchObject({ model: "gpt-image-2", size: "2048x1152", quality: "auto" });
    expect(fourK).toMatchObject({ model: "gpt-image-2", size: "3840x2160", quality: "auto" });
    expect(twoK).not.toHaveProperty("image_size");
    expect(fourK).not.toHaveProperty("image_size");
  });

  it("does not collapse gpt-image-2 selected resolution when aspect ratio is auto", () => {
    const body = buildGenerateRequestBody({
      model: "gpt-image-2",
      prompt: "make it premium",
      aspect_ratio: "auto",
      image: ["https://example.com/source.png"],
      image_size: "4K",
    }, "compiled prompt");

    expect(body).toMatchObject({ model: "gpt-image-2", size: "3840x2160", quality: "auto" });
  });

  it("keeps nano banana reference image requests on the existing JSON shape", () => {
    const body = buildGenerateRequestBody({
      model: "nano-banana-2",
      prompt: "swap the face",
      aspect_ratio: "3:4",
      image: ["https://example.com/source.png"],
      image_size: "1K",
    }, "compiled prompt");

    expect(shouldUseImageEditEndpoint(
      { model: "nano-banana-2", image: ["https://example.com/source.png"] },
      { name: "admin", responseType: "gemini-native" },
    ))
      .toBe(false);
    expect(body).toMatchObject({
      model: "nano-banana-2",
      prompt: "compiled prompt",
      response_format: "url",
      aspect_ratio: "3:4",
      image: ["https://example.com/source.png"],
      image_size: "1K",
    });
  });

  it("uses the deployment's upstream model code as the source of truth", () => {
    expect(resolveProviderImageModel("gpt-image-2", {
      name: "admin",
      upstreamModel: "provider-gpt-image-code",
    })).toBe("provider-gpt-image-code");
    expect(resolveProviderImageModel("nano-banana-2", {
      name: "admin",
      upstreamModel: "gemini-3.1-flash-image",
    })).toBe("gemini-3.1-flash-image");
    expect(resolveProviderImageModel("nano-banana-2", { name: "admin" })).toBe("nano-banana-2");
  });

  it("eases synchronous request progress while leaving room for completion", () => {
    expect(calculateImageRequestHeartbeatProgress(0, 1, 92)).toBe(2);
    expect(calculateImageRequestHeartbeatProgress(60_000, 2, 92)).toBeGreaterThanOrEqual(40);
    expect(calculateImageRequestHeartbeatProgress(5 * 60_000, 91, 92)).toBe(92);
    expect(calculateImageRequestHeartbeatProgress(5 * 60_000, 92, 92)).toBe(92);
  });
});
