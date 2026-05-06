import { describe, expect, it } from "vitest";
import {
  buildWorkflowQualityRecommendations,
  summarizeWorkflowQualityEvents,
} from "@/lib/agent/workflow/quality-observability";

describe("workflow quality observability", () => {
  it("summarizes visual quality checks and quality retries", () => {
    const summary = summarizeWorkflowQualityEvents([
      {
        id: "q1",
        type: "quality_checked",
        workflow_id: "w1",
        step_id: "s1",
        created_at: "2026-05-06T00:00:00.000Z",
        payload: {
          ok: true,
          score: 0.92,
          shouldRegenerate: false,
          source: "vision_llm",
          summary: "good",
          issues: [],
        },
      },
      {
        id: "q2",
        type: "quality_checked",
        workflow_id: "w1",
        step_id: "s2",
        created_at: "2026-05-06T00:01:00.000Z",
        payload: {
          ok: false,
          score: 0.41,
          shouldRegenerate: true,
          source: "deterministic",
          summary: "bad",
          issues: ["missing output", "missing output"],
        },
      },
      {
        id: "r1",
        type: "step_retried",
        message: "Pose variation will retry after visual quality review",
        payload: { score: 0.41 },
      },
    ]);

    expect(summary.totalChecks).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.needsAttention).toBe(1);
    expect(summary.regenerateRequested).toBe(1);
    expect(summary.autoRetries).toBe(1);
    expect(summary.autoRetryRate).toBe(0.5);
    expect(summary.averageScore).toBe(0.665);
    expect(summary.sources).toEqual({ vision_llm: 1, deterministic: 1 });
    expect(summary.topIssues).toEqual([{ issue: "missing output", count: 2 }]);
    expect(summary.latest[0]).toMatchObject({ id: "q1", ok: true, score: 0.92 });
  });

  it("builds useful recommendations for empty, healthy, and risky quality summaries", () => {
    expect(buildWorkflowQualityRecommendations(summarizeWorkflowQualityEvents([]))[0])
      .toContain("No workflow quality checks");

    expect(buildWorkflowQualityRecommendations(summarizeWorkflowQualityEvents([
      { type: "quality_checked", payload: { ok: true, score: 0.91, source: "vision_llm" } },
    ]))[0]).toBe("Workflow visual quality checks look healthy.");

    const risky = summarizeWorkflowQualityEvents([
      { type: "quality_checked", payload: { ok: false, score: 0.4, shouldRegenerate: true, issues: ["bad hands"] } },
      { type: "quality_checked", payload: { ok: false, score: 0.5, shouldRegenerate: true, issues: ["bad hands"] } },
      { type: "quality_checked", payload: { ok: false, score: 0.55, shouldRegenerate: true, issues: ["bad layout"] } },
      { type: "step_retried", payload: { score: 0.4 } },
      { type: "step_retried", payload: { score: 0.5 } },
    ]);
    const recommendations = buildWorkflowQualityRecommendations(risky).join(" ");
    expect(recommendations).toContain("score is low");
    expect(recommendations).toContain("Multiple outputs requested regeneration");
  });
});

