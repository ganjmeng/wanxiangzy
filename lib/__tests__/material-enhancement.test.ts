import { describe, expect, it } from "vitest";
import {
  buildMaterialEnhancementPrompt,
  enforceMaterialEnhancementPromptRequirements,
  normalizeMaterialEnhancementLevel,
} from "@/lib/material-enhancement";

describe("material enhancement prompt", () => {
  it("defines strict image roles and an edit boundary for commercial garment detail enhancement", () => {
    const prompt = buildMaterialEnhancementPrompt({
      garmentType: "上装",
      enhancementLevel: "fine_detail",
      userPrompt: "重点增强针织纹理和纽扣边缘。",
    });

    expect(prompt).toContain("图1是最终画面原图");
    expect(prompt).toContain("图2是同款或同系列服装高清商品图");
    expect(prompt).toContain("HARD 硬规则 · 材质增强模式");
    expect(prompt).toContain("允许改变（仅限图1可见服装区域）");
    expect(prompt).toContain("必须不变：人物身份");
    expect(prompt).toContain("图1决定服装在人物身上的版型、轮廓、褶皱、垂坠、遮挡和阴影");
    expect(prompt).toContain("图2只用于补足面料织法、纹理方向、缝线");
    expect(prompt).toContain("细节优先");
    expect(prompt).toContain("source-matched garment material enhancement");
    expect(prompt).toContain("细密纹理安全");
    expect(prompt).toContain("摩尔纹");
    expect(prompt).not.toContain("8K ultra-detailed");
    expect(prompt).not.toContain("RAW photo quality");
    expect(prompt).toContain("重点增强针织纹理和纽扣边缘");
  });

  it("wraps custom prompts with the required material enhancement guardrails", () => {
    const prompt = enforceMaterialEnhancementPromptRequirements("让衣服细节更清楚。", {
      garmentType: "下装",
      enhancementLevel: "balanced",
    });

    expect(prompt).toContain("图像角色：图1是最终画面原图");
    expect(prompt).toContain("任务：对图1中可见的下装区域做商用级材质增强");
    expect(prompt).toContain("原图其他内容必须保持不变");
    expect(prompt).toContain("补充执行要求（只能用于服装材质细节，不能改变原图其他内容）：让衣服细节更清楚。");
  });

  it("adds source lock guardrails to older material prompts", () => {
    const prompt = enforceMaterialEnhancementPromptRequirements("图像角色：图1是最终画面原图。\n编辑边界：只处理服装。", {
      garmentType: "上装",
      enhancementLevel: "balanced",
    });

    // older prompts without HARD marker get wrapped; marker re-applied
    expect(prompt).toContain("HARD 硬规则 · 材质增强模式");
    expect(prompt).toContain("补充执行要求");
  });

  it("normalizes unsupported enhancement levels to the default", () => {
    expect(normalizeMaterialEnhancementLevel("fine_detail")).toBe("fine_detail");
    expect(normalizeMaterialEnhancementLevel("unknown")).toBe("balanced");
  });
});
