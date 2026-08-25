import { describe, expect, it } from "vitest";

import {
  applyStaleRunningFallback,
  indexRowToTaskQueueItem,
  normalizeAiToolTaskQueueItem,
  normalizeGenerationTaskQueueItem,
  taskQueueStatusGroup,
  taskQueueItemToIndexWrite,
} from "../task-queue-index";
import type { TaskQueueItem } from "../task-queue";

describe("task queue index", () => {
  it("surfaces ambiguous upstream submissions as failed review items", () => {
    expect(taskQueueStatusGroup("needs_review")).toBe("failed");
  });

  it("never exposes diagnostic errors while a task is queued or running", () => {
    const queued = {
      id: "queued-task",
      module: "generalImage",
      title: "任务",
      status: "queued",
      statusGroup: "queued" as const,
      time: "刚刚",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      error: "供应商池当前已满，将在队列中稍后重试",
      progress: 0,
      expectedCount: 1,
      resultCount: 0,
      inputThumbnails: [],
      resultThumbnails: [],
      thumbnails: [],
      applyUrl: "",
    };

    expect(applyStaleRunningFallback(queued).error).toBe("");
  });

  it("normalizes a generation into the lightweight queue shape", () => {
    const item = normalizeGenerationTaskQueueItem({
      id: "gen_1",
      user_id: "user_1",
      status: "processing_tryon",
      error_message: null,
      result_urls: ["https://example.com/result.png"],
      created_at: "2026-05-16T10:00:00.000Z",
      completed_at: null,
      processing_started_at: "2026-05-16T10:00:10.000Z",
      job_payload: {
        kind: "productSet",
        genCount: 3,
        productImageUrls: ["https://example.com/product.png"],
      },
      clothing_urls: [],
      model_face_url: null,
      reference_url: null,
    });

    expect(item.module).toBe("productSet");
    expect(item.title).toBe("商品套图");
    expect(item.resultThumbnails).toEqual(["https://example.com/result.png"]);
    expect(item.inputThumbnails).toEqual(["https://example.com/product.png"]);
    expect(item.expectedCount).toBe(3);
  });

  it("round-trips through the task_queue_items row shape without large payload fields", () => {
    const item = normalizeGenerationTaskQueueItem({
      id: "gen_2",
      user_id: "user_1",
      status: "completed",
      error_message: null,
      result_urls: ["https://example.com/one.png", "https://example.com/two.png", "https://example.com/three.png"],
      created_at: "2026-05-16T10:00:00.000Z",
      completed_at: "2026-05-16T10:01:00.000Z",
      job_payload: { kind: "tryon", genCount: 3 },
      clothing_urls: ["https://example.com/clothing.png"],
      model_face_url: null,
      reference_url: null,
    });

    const row = taskQueueItemToIndexWrite(item, {
      userId: "user_1",
      sourceType: "generation",
    });

    expect(Object.keys(row)).not.toContain("job_payload");
    expect(Object.keys(row)).not.toContain("result_urls");
    expect(row.result_thumbnails).toHaveLength(3);
    expect(indexRowToTaskQueueItem(row).resultCount).toBe(3);
  });

  it("uses the completed parent over a stale failed child diagnostic", () => {
    const item = normalizeGenerationTaskQueueItem({
      id: "gen_completed_with_stale_child",
      user_id: "user_1",
      status: "completed",
      error_message: null,
      result_urls: ["https://example.com/one.png", "https://example.com/two.png"],
      created_at: "2026-08-22T10:35:00.000Z",
      completed_at: "2026-08-22T10:39:57.000Z",
      job_payload: {
        kind: "generalImage",
        genCount: 2,
        asyncTask: { status: "FAILED", progress: 50 },
      },
      clothing_urls: [],
      model_face_url: null,
      reference_url: null,
    });

    expect(item).toMatchObject({
      status: "completed",
      statusGroup: "completed",
      progress: 100,
      resultCount: 2,
      error: "",
    });
  });

  it("multiplies try-on expected count by selected reference count", () => {
    const item = normalizeGenerationTaskQueueItem({
      id: "gen_3",
      user_id: "user_1",
      status: "processing_tryon",
      error_message: null,
      result_urls: [],
      created_at: "2026-05-16T10:00:00.000Z",
      completed_at: null,
      job_payload: {
        kind: "tryon",
        genCount: 2,
        referenceUrls: [
          "https://example.com/ref-1.png",
          "https://example.com/ref-2.png",
          "https://example.com/ref-3.png",
        ],
      },
      clothing_urls: ["https://example.com/clothing.png"],
      model_face_url: null,
      reference_url: null,
    });

    expect(item.expectedCount).toBe(6);
    expect(item.inputThumbnails).toEqual([
      "https://example.com/clothing.png",
      "https://example.com/ref-1.png",
      "https://example.com/ref-2.png",
      "https://example.com/ref-3.png",
    ]);
  });

  it("keeps stale running tasks non-terminal so late provider results can still appear", () => {
    const staleRunning: TaskQueueItem = {
      id: "gen_stale",
      module: "tryon",
      title: "服装上身",
      status: "processing_tryon",
      statusGroup: "running",
      time: "60:00",
      createdAt: "2026-05-16T10:00:00.000Z",
      updatedAt: "2026-05-16T10:00:00.000Z",
      completedAt: null,
      error: "",
      progress: 34,
      expectedCount: 4,
      resultCount: 0,
      inputThumbnails: ["https://example.com/input.png"],
      resultThumbnails: [],
      thumbnails: ["https://example.com/input.png"],
      applyUrl: "/create?apply=gen_stale",
    };

    expect(applyStaleRunningFallback(staleRunning)).toMatchObject({
      status: "processing_delayed",
      statusGroup: "running",
      error: "",
      progress: 99,
    });
  });

  it("projects an AI tool task into the shared toolbox rail", () => {
    const item = normalizeAiToolTaskQueueItem({
      id: "7cc2845a-5a1d-4891-8af4-8908e7f03b1e",
      user_id: "user_1",
      provider_task_id: "task-12345678",
      operation: "repair-garment",
      status: "completed",
      source_url: "https://example.com/source.png",
      provider_payload: { expected_count: 2, progress: 100 },
      output_persistence_status: "completed",
      result_urls: ["https://example.com/result.png"],
      last_error: null,
      created_at: "2026-08-18T10:00:00.000Z",
      updated_at: "2026-08-18T10:01:00.000Z",
      completed_at: "2026-08-18T10:01:00.000Z",
    });

    expect(item).toMatchObject({
      module: "toolbox",
      scope: "repair-garment",
      title: "服饰修复",
      statusGroup: "completed",
      expectedCount: 2,
      resultCount: 1,
      applyUrl: "/ai-tools/clothing-repair?task=task-12345678",
    });
    expect(item.thumbnails).toEqual(["https://example.com/result.png"]);
  });

  it("recognizes the fallback generation row as the same toolbox operation", () => {
    const item = normalizeGenerationTaskQueueItem({
      id: "gen-ai-tool",
      user_id: "user_1",
      status: "processing",
      error_message: null,
      result_urls: [],
      created_at: "2026-08-18T10:00:00.000Z",
      completed_at: null,
      job_payload: {
        kind: "generalImage",
        aiTool: { operation: "erase" },
        sourceUrl: "https://example.com/source.png",
      },
      clothing_urls: [],
      model_face_url: null,
      reference_url: null,
    });

    expect(item).toMatchObject({
      module: "toolbox",
      scope: "erase",
      applyUrl: "/ai-tools/erase?task=gen-ai-tool",
    });
  });

  it("keeps provider-complete AI tools running until outputs are durably stored", () => {
    const item = normalizeAiToolTaskQueueItem({
      id: "d4045f3e-b3da-4d28-bf1d-3773841e3a22",
      user_id: "user_1",
      provider_task_id: "task-persisting",
      operation: "outpaint",
      status: "completed",
      output_persistence_status: "processing",
      source_url: "https://example.com/source.png",
      provider_payload: { progress: 100 },
      result_urls: [],
      created_at: "2026-08-18T10:00:00.000Z",
    });

    expect(item).toMatchObject({
      status: "processing",
      statusGroup: "running",
      progress: 99,
      resultCount: 0,
    });
  });
});
