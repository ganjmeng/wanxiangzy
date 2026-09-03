import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  generateNewApiFirstLastFrame,
  generateNewApiImageToVideo,
} from "@/lib/api/newapi-video";
import { isGenerationSubmissionOutcomeUnknownError } from "@/lib/api/generation-errors";

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const minimaxProvider = {
  provider: "minimax" as const,
  apiBase: "https://api.new.bi",
  apiKey: "test-key",
};

function minimaxInput() {
  return {
    provider: "minimax" as const,
    imageUrl: "https://cdn.example.com/model.png",
    prompt: "模特自然走动展示服装。",
    modelMode: "pro" as const,
    duration: 5 as const,
    resolution: "2k" as const,
    aspectRatio: "9:16" as const,
    audioMode: "off" as const,
    generateAudio: false,
  };
}

describe("newapi video adapter (new.bi gateway)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it("submits image-to-video with the catalog-selected model and polls until completed", async () => {
    const requests: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
    let pollCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      const url = String(input);
      const rawBody = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
      requests.push({ method, url, body: rawBody });

      if (method === "POST") {
        return jsonResponse({ id: "task_1", task_id: "task_1", object: "video", model: "minimax-h3", status: "queued", progress: 0 });
      }
      pollCount += 1;
      if (pollCount === 1) {
        return jsonResponse({ code: "success", data: { status: "IN_PROGRESS", progress: "40%", data: { data: { data: { object: "video", status: "in_progress", progress: 40, video_url: null } } } } });
      }
      return jsonResponse({ code: "success", data: { status: "SUCCESS", progress: "100%", data: { data: { data: { object: "video", status: "completed", progress: 100, video_url: "https://cdn.example.com/result.mp4" } } } } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const onProgress = vi.fn();
    const pending = generateNewApiImageToVideo({ ...minimaxInput(), onProgress }, minimaxProvider);
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await pending;

    const post = requests.find((item) => item.method === "POST");
    const gets = requests.filter((item) => item.method === "GET");

    expect(post?.url).toBe("https://api.new.bi/v1/video/generations");
    expect(post?.body).toMatchObject({ model: "minimax-h3/image-to-video", duration: 5 });
    expect(post?.body?.image).toBe("https://cdn.example.com/model.png");
    expect(gets[0]?.url).toBe("https://api.new.bi/v1/video/generations/task_1");
    expect(result).toMatchObject({ taskId: "task_1", url: "https://cdn.example.com/result.mp4", providerStatus: "completed" });
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ status: "running" }));
  });

  it("forwards a deterministic idempotency key on provider submission", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method || "GET").toUpperCase() === "POST") {
        return jsonResponse({ task_id: "task_idempotent", object: "video", status: "queued" });
      }
      return jsonResponse({ object: "video", task_id: "task_idempotent", status: "completed", video_url: "https://cdn.example.com/idempotent.mp4" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = generateNewApiImageToVideo({
      ...minimaxInput(),
      idempotencyKey: "gen-6ba7b810-9dad-41d1-80b4-00c04fd430c8-video-0",
    }, minimaxProvider);
    await vi.advanceTimersByTimeAsync(20_000);
    await pending;

    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("gen-6ba7b810-9dad-41d1-80b4-00c04fd430c8-video-0");
  });

  it("quarantines a transport failure after submission because the provider outcome is unknown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed: connection reset")));

    const error = await generateNewApiImageToVideo(minimaxInput(), minimaxProvider).catch((cause) => cause);

    expect(isGenerationSubmissionOutcomeUnknownError(error)).toBe(true);
  });

  it("resumes polling a persisted provider task without resubmitting", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect((init?.method || "GET").toUpperCase()).toBe("GET");
      return jsonResponse({ object: "video", task_id: "task_resume_1", status: "completed", video_url: "https://cdn.example.com/resumed.mp4" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const onProgress = vi.fn();
    const pending = generateNewApiImageToVideo({
      ...minimaxInput(),
      resumeTask: { taskId: "task_resume_1", requestId: "request_resume_1" },
      onProgress,
    }, minimaxProvider);
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/video/generations/task_resume_1");
    expect(result.url).toBe("https://cdn.example.com/resumed.mp4");
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ providerStatus: "RESUMING" }));
  });

  it("maps minimax 768p and seedance mini to their upstream models", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      if (method === "POST") {
        return jsonResponse({ id: "task_2", task_id: "task_2", object: "video", model: "minimax-h3-768p", status: "queued" });
      }
      return jsonResponse({ code: "success", data: { status: "SUCCESS", progress: "100%", data: { data: { data: { object: "video", status: "completed", progress: 100, video_url: "https://cdn.example.com/r.mp4" } } } } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = generateNewApiImageToVideo({
      ...minimaxInput(),
      modelMode: "pro",
      resolution: "768p",
      onProgress: undefined,
    }, minimaxProvider);
    await vi.advanceTimersByTimeAsync(20_000);
    await pending;

    const body1 = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as { model: string };
    expect(body1.model).toBe("minimax-h3/image-to-video");
  });

  it("passes the first and last frames as top-level fields", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      if (method === "POST") {
        return jsonResponse({ id: "task_3", task_id: "task_3", object: "video", model: "minimax-h3-768p", status: "queued" });
      }
      return jsonResponse({ code: "success", data: { status: "SUCCESS", progress: "100%", data: { data: { data: { object: "video", status: "completed", progress: 100, video_url: "https://cdn.example.com/frame.mp4" } } } } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = generateNewApiFirstLastFrame({
      provider: "minimax",
      firstFrameUrl: "https://cdn.example.com/first.png",
      lastFrameUrl: "https://cdn.example.com/last.png",
      prompt: "自然过渡",
      modelMode: "pro",
      duration: 5,
      resolution: "768p",
      aspectRatio: "1:1",
      audioMode: "generated",
      generateAudio: true,
    }, minimaxProvider);

    await vi.advanceTimersByTimeAsync(20_000);
    await pending;

    const post = (fetchMock.mock.calls[0]?.[1] as RequestInit);
    const body = JSON.parse(String(post.body)) as { model: string; first_frame_image: string; last_frame_image: string; duration: number };
    expect(body.model).toBe("minimax-h3/image-to-video");
    expect(body.first_frame_image).toBe("https://cdn.example.com/first.png");
    expect(body.last_frame_image).toBe("https://cdn.example.com/last.png");
    expect(body).not.toHaveProperty("metadata");
    expect(body.duration).toBe(5);
  });
});
