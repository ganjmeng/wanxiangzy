import { describe, expect, it } from "vitest";
import { estimateWorkflowCost } from "@/lib/agent/workflow/cost";
import { planWorkflow } from "@/lib/agent/workflow/planner";
import { normalizeGenerationDefaults } from "@/lib/agent/workflow/request";
import { WORKFLOW_TOOLS } from "@/lib/agent/workflow/tools";
import { validateWorkflowPlan } from "@/lib/agent/workflow/validator";
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

describe("workflow production core", () => {
  it("normalizes generation defaults sent from the agent UI", () => {
    const normalized = normalizeGenerationDefaults({
      model: "nano-banana-2",
      aspectRatio: "9:16",
      imageSize: "4K",
      count: 9,
    });

    expect(normalized).toEqual({
      model: "nano-banana-2",
      aspectRatio: "9:16",
      imageSize: "4K",
      count: 4,
    });
  });

  it("registers core visual tools and keeps future video disabled", () => {
    expect(WORKFLOW_TOOLS.text_to_image.enabled).toBe(true);
    expect(WORKFLOW_TOOLS.image_to_image.enabled).toBe(true);
    expect(WORKFLOW_TOOLS.tryon.enabled).toBe(true);
    expect(WORKFLOW_TOOLS.pose_variation.enabled).toBe(true);
    expect(WORKFLOW_TOOLS.garment_3d.enabled).toBe(true);
    expect(WORKFLOW_TOOLS.image_to_video.enabled).toBe(false);
  });

  it("fallback planner builds a multi-step tryon and pose workflow", async () => {
    const plan = await planWorkflow({
      userText: "让图1人物穿图2衣服，再生成4个不同站姿",
      images,
      mode: "agent",
      defaults,
    });

    expect(plan.steps.map((step) => step.type)).toEqual(["tryon", "pose_variation"]);
    expect(plan.steps[1].dependsOn).toEqual(["step_1"]);
  });

  it("Mastra planner path clarifies instead of using deterministic keyword fallback", async () => {
    const plan = await planWorkflow({
      userText: "put image 2 clothes on image 1 person, then create four pose variations",
      images,
      mode: "agent",
      defaults,
      fallbackStrategy: "clarify",
    });

    expect(plan.needsClarification).toBe(true);
    expect(plan.steps).toEqual([]);
  });

  it("respects explicit person and clothing image references", async () => {
    const plan = await planWorkflow({
      userText: "图2人物穿图1衣服，然后生成4个不同姿势，每张单独出图",
      images: [
        { index: 1, url: "https://example.com/clothing.png", role: "auto" },
        { index: 2, url: "https://example.com/person.png", role: "auto" },
      ],
      mode: "agent",
      defaults,
    });

    expect(plan.steps.map((step) => step.type)).toEqual(["tryon", "pose_variation"]);
    expect(plan.steps[0].input.personImage).toBe("图2");
    expect(plan.steps[0].input.clothingImage).toBe("图1");
    expect(plan.steps[1].params.outputMode).toBe("separate");
  });

  it("understands garment transfer wording as tryon before pose variation", async () => {
    const plan = await planWorkflow({
      userText: "帮我把图1的衣服传到图2的模特上，然后再生成4张姿势裂变图",
      images: [
        { index: 1, url: "https://example.com/clothing.png", role: "clothing" },
        { index: 2, url: "https://example.com/model.png", role: "reference" },
      ],
      mode: "agent",
      defaults,
    });

    expect(plan.steps.map((step) => step.type)).toEqual(["tryon", "pose_variation"]);
    expect(plan.steps[0].input.personImage).toBe("图2");
    expect(plan.steps[0].input.clothingImage).toBe("图1");
  });

  it("uses the non-clothing image as model when the user says model without image number", async () => {
    const plan = await planWorkflow({
      userText: "帮我把图1的衣服穿到模特身上，然后裂变4个姿势图",
      images: [
        { index: 1, url: "https://example.com/clothing.png", role: "clothing" },
        { index: 2, url: "https://example.com/model.png", role: "reference" },
      ],
      mode: "agent",
      defaults,
    });

    expect(plan.steps.map((step) => step.type)).toEqual(["tryon", "pose_variation"]);
    expect(plan.steps[0].input.personImage).toBe("图2");
    expect(plan.steps[0].input.clothingImage).toBe("图1");
  });

  it("validator blocks disabled video steps while keeping image workflow valid", async () => {
    const plan = await planWorkflow({
      userText: "图1人物穿图2衣服，再做走秀视频",
      images,
      mode: "agent",
      defaults,
    });
    const result = validateWorkflowPlan({ plan, images, defaults });

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.code === "TOOL_DISABLED")).toBe(true);
  });

  it("estimates cost per executable workflow step", async () => {
    const plan = await planWorkflow({
      userText: "把这件衣服做成立体3D商品展示图",
      images: [images[1]],
      mode: "agent",
      defaults,
    });
    const estimate = estimateWorkflowCost(plan, defaults);

    expect(estimate.total).toBeGreaterThan(0);
    expect(estimate.steps[0].toolType).toBe("garment_3d");
  });
});
