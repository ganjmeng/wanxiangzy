import { describe, expect, it } from "vitest";

import {
  __generationJobTestUtils,
  getImageBatchConcurrency,
  resolveImageBatchConcurrency,
  runCapacityAwareBatchWorkers,
  type GenerationJobPayload,
} from "@/lib/api/generation-jobs";

const basePayload: GenerationJobPayload = {
  kind: "generalImage",
  mode: "text-to-image",
  referenceUrls: [],
  aiModel: "nano-banana-2",
  aspectRatio: "1:1",
  imageSize: "1K",
  prompt: "catalog image",
  genCount: 4,
};

describe("generation batch capacity resume", () => {
  it("uses a strict independently configurable per-generation image limit", () => {
    expect(getImageBatchConcurrency({})).toBe(8);
    expect(getImageBatchConcurrency({ GENERATION_IMAGE_BATCH_CONCURRENCY: "8" })).toBe(8);
    expect(() => getImageBatchConcurrency({ GENERATION_IMAGE_BATCH_CONCURRENCY: "9" })).toThrow(/between 1 and 8/);
  });

  it("caps a nine-slot batch by the configured limit and provider pool", async () => {
    expect(await resolveImageBatchConcurrency("nano-banana-2", 9)).toBe(8);
    expect(await resolveImageBatchConcurrency("nano-banana-2", 0)).toBe(0);
  });

  it("stops assigning new slots after capacity rejection but awaits in-flight slots", async () => {
    const events: string[] = [];
    let releaseSlow!: () => void;
    const slow = new Promise<void>((resolve) => { releaseSlow = resolve; });

    const execution = runCapacityAwareBatchWorkers({
      count: 6,
      concurrency: 2,
      run: async (index) => {
        events.push(`start:${index}`);
        if (index === 0) {
          await slow;
          events.push("finish:0");
          return;
        }
        throw Object.assign(new Error("busy"), {
          name: "AiCapacityUnavailableError",
          retryAfterSeconds: 5,
        });
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["start:0", "start:1"]);
    releaseSlow();
    await expect(execution).rejects.toMatchObject({ name: "AiCapacityUnavailableError" });
    expect(events).toEqual(["start:0", "start:1", "finish:0"]);
  });

  it("persists stable result slots and restores only the completed slots", () => {
    const first = "/api/media-assets/6ba7b810-9dad-41d1-80b4-00c04fd430c8";
    const third = "/api/media-assets/6ba7b811-9dad-41d1-80b4-00c04fd430c8";
    const payload = __generationJobTestUtils.appendResumableBatchProgress(basePayload, {
      resultUrls: [first, "", third, ""],
      promptTrace: [],
      progress: 50,
    });

    expect(payload.generationBatchProgress).toMatchObject({
      version: 1,
      expectedCount: 4,
      resultUrls: [first, "", third, ""],
    });
    expect(__generationJobTestUtils.readResumableBatchResultUrls(payload, 4)).toEqual([
      first,
      "",
      third,
      "",
    ]);
    expect(__generationJobTestUtils.isCanonicalMediaAssetUrl(first)).toBe(true);
    expect(__generationJobTestUtils.isCanonicalMediaAssetUrl("https://oss.example/raw.png?Signature=secret")).toBe(false);
  });

  it("rejects stale resume state when the requested output count changes", () => {
    const payload: GenerationJobPayload = {
      ...basePayload,
      generationBatchProgress: {
        version: 1,
        expectedCount: 4,
        resultUrls: ["one", "two", "", ""],
        updatedAt: new Date().toISOString(),
      },
    };

    expect(__generationJobTestUtils.readResumableBatchResultUrls(payload, 2)).toEqual(["", ""]);
  });

  it("removes internal resume metadata before final settlement", () => {
    const payload: GenerationJobPayload = {
      ...basePayload,
      generationBatchProgress: {
        version: 1,
        expectedCount: 4,
        resultUrls: ["one", "two", "three", "four"],
        updatedAt: new Date().toISOString(),
      },
    };

    expect(__generationJobTestUtils.clearResumableBatchProgress(payload))
      .not.toHaveProperty("generationBatchProgress");
  });

  it("settles durable partial results instead of failing the whole batch after retry exhaustion", () => {
    expect(__generationJobTestUtils.shouldSettlePartialResultOnRetryExhaustion(1)).toBe(false);
    expect(__generationJobTestUtils.shouldSettlePartialResultOnRetryExhaustion(2)).toBe(true);
  });
});
