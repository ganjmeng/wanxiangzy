import { describe, expect, it } from "vitest";
import { buildMastraPlannerPrompt, normalizeMastraPlannerOutput } from "@/lib/mastra/planning/workflow-planner";
import type { GenerationDefaults, WorkflowInputImage } from "@/lib/agent/workflow/types";

const defaults: GenerationDefaults = {
  model: "gpt-image-2",
  aspectRatio: "3:4",
  imageSize: "1K",
  count: 1,
};

const images: WorkflowInputImage[] = [
  { index: 1, url: "https://example.com/person.png", role: "source" },
  { index: 2, url: "https://example.com/clothing.png", role: "clothing" },
];

describe("Mastra workflow planner", () => {
  it("builds a semantic prompt that protects ecommerce detail-page intent", () => {
    const prompt = buildMastraPlannerPrompt({
      userText: "根据这张图生成淘宝详情页",
      images: images.slice(0, 1),
      defaults,
      userPreferences: { negativeRules: ["详情页不要误判成种草图"] },
    });

    expect(prompt).toContain("Workflow tool catalog");
    expect(prompt).toContain("Do not silently reinterpret ecommerce detail-page requests");
    expect(prompt).toContain("详情页不要误判成种草图");
  });

  it("normalizes a multi-step tryon and pose plan without deterministic keyword fallback", () => {
    const plan = normalizeMastraPlannerOutput({
      intent: "tryon_then_pose",
      summary: "先换装，再生成姿势裂变",
      confidence: 0.86,
      needsClarification: false,
      imageRoles: [
        { ref: "图1", imageIndex: 1, role: "person", confidence: 0.8, reason: "人物图" },
        { ref: "图2", imageIndex: 2, role: "clothing", confidence: 0.9, reason: "服装图" },
      ],
      userConstraints: ["每张单独出图"],
      assumptions: ["保持人物身份和服装结构"],
      steps: [
        {
          id: "step_1",
          type: "tryon",
          title: "人物换装",
          dependsOn: [],
          input: { personImage: "图1", clothingImage: "图2" },
          params: {},
          expectedOutput: { imageUrls: true },
          riskNotes: [],
        },
        {
          id: "step_2",
          type: "pose_variation",
          title: "姿势裂变",
          dependsOn: ["step_1"],
          input: { sourceImage: "$step_1.output.imageUrls[0]" },
          params: { outputMode: "separate" },
          expectedOutput: { imageUrls: true },
          riskNotes: ["检查手指和比例"],
        },
      ],
    }, {
      userText: "把图2衣服穿到图1人物上，然后生成4个姿势，每张单独出图",
      images,
      defaults,
    });

    expect(plan.steps.map((step) => step.type)).toEqual(["tryon", "pose_variation"]);
    expect(plan.steps[0].params.prompt).toContain("把图2衣服");
    expect(plan.steps[1].dependsOn).toEqual(["step_1"]);
    expect(plan.imageRoles[1].role).toBe("clothing");
  });

  it("turns empty step output into clarification instead of a guessed workflow", () => {
    const plan = normalizeMastraPlannerOutput({
      intent: "chat",
      summary: "普通聊天",
      confidence: 0.7,
      needsClarification: false,
      imageRoles: [],
      userConstraints: [],
      assumptions: [],
      steps: [],
    }, {
      userText: "你好",
      images: [],
      defaults,
    });

    expect(plan.needsClarification).toBe(true);
    expect(plan.steps).toEqual([]);
  });
});
