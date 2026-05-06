import { describe, expect, it } from "vitest";
import { runDeterministicPlanCritic } from "@/lib/mastra/planning/workflow-critic";
import type { GenerationDefaults, PlanValidationResult, WorkflowInputImage, WorkflowPlan } from "@/lib/agent/workflow/types";

const defaults: GenerationDefaults = {
  model: "gpt-image-2",
  aspectRatio: "3:4",
  imageSize: "1K",
  count: 1,
};

const images: WorkflowInputImage[] = [
  { index: 1, url: "https://example.com/a.png", role: "source" },
  { index: 2, url: "https://example.com/b.png", role: "clothing" },
];

const validValidation: PlanValidationResult = {
  ok: true,
  errors: [],
  warnings: [],
  blockedStepIds: [],
};

describe("Mastra workflow critic", () => {
  it("blocks ecommerce detail-page requests that were planned as generic creative images", () => {
    const result = runDeterministicPlanCritic({
      userText: "根据这张图生成淘宝详情页长图",
      images: images.slice(0, 1),
      defaults,
      validation: validValidation,
      plan: planWithSteps([{
        id: "step_1",
        type: "commerce_creative",
        title: "电商创意图",
        dependsOn: [],
        input: { referenceImages: ["图1"] },
        params: { prompt: "生成淘宝详情页" },
        expectedOutput: { imageUrls: true },
      }]),
    });

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === "DETAIL_PAGE_INTENT_MISMATCH")).toBe(true);
  });

  it("blocks pose plans that ignore separate output mode", () => {
    const result = runDeterministicPlanCritic({
      userText: "生成4个姿势，每个姿势一张，单独出图",
      images: images.slice(0, 1),
      defaults,
      validation: validValidation,
      plan: planWithSteps([{
        id: "step_1",
        type: "pose_variation",
        title: "姿势裂变",
        dependsOn: [],
        input: { sourceImage: "图1" },
        params: { outputMode: "grid" },
        expectedOutput: { imageUrls: true },
      }]),
    });

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === "POSE_OUTPUT_MODE_MISMATCH")).toBe(true);
  });

  it("approves a coherent tryon then separate pose plan", () => {
    const result = runDeterministicPlanCritic({
      userText: "图2衣服穿到图1人物上，然后生成4个姿势，每张单独出图",
      images,
      defaults,
      validation: validValidation,
      plan: planWithSteps([
        {
          id: "step_1",
          type: "tryon",
          title: "人物换装",
          dependsOn: [],
          input: { personImage: "图1", clothingImage: "图2" },
          params: { prompt: "图2衣服穿到图1人物上" },
          expectedOutput: { imageUrls: true },
        },
        {
          id: "step_2",
          type: "pose_variation",
          title: "姿势裂变",
          dependsOn: ["step_1"],
          input: { sourceImage: "$step_1.output.imageUrls[0]" },
          params: { outputMode: "separate" },
          expectedOutput: { imageUrls: true },
        },
      ]),
    });

    expect(result.ok).toBe(true);
    expect(result.action).toBe("approve");
  });
});

function planWithSteps(steps: WorkflowPlan["steps"]): WorkflowPlan {
  return {
    intent: "visual_workflow",
    summary: "test plan",
    confidence: 0.8,
    needsClarification: false,
    imageRoles: [],
    userConstraints: [],
    assumptions: [],
    steps,
  };
}
