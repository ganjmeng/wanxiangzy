import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runKieMarketTask } from "@/lib/api/kie-market";

function response(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("Kie Market task protocol", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("creates and polls a task using the shared documented envelope", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ code: 200, data: { taskId: "task-kie-1" } }))
      .mockResolvedValueOnce(response({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["https://cdn.example.com/result.png"] }) } }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = runKieMarketTask({
      apiBase: "https://api.kie.ai",
      apiKey: "test-key",
      model: "z-image",
      modelInput: { prompt: "a white shoe" },
      pollIntervalMs: 250,
      timeoutMs: 5_000,
    });
    await vi.advanceTimersByTimeAsync(250);
    const result = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.kie.ai/api/v1/jobs/createTask");
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      model: "z-image",
      input: { prompt: "a white shoe" },
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/api/v1/jobs/recordInfo?taskId=task-kie-1");
    expect(result.urls).toEqual(["https://cdn.example.com/result.png"]);
  });
});
