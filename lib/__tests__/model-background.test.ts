import { describe, expect, it } from "vitest";
import {
  buildModelBackgroundPrompt,
  decideModelBackgroundMode,
  enforceModelBackgroundPromptRequirements,
} from "@/lib/model-background";

describe("model background prompt handling", () => {
  it("keeps garment protection framed as commercial product fidelity", () => {
    const prompt = buildModelBackgroundPrompt({
      mode: "background_only",
      backgroundSource: "text",
      templateId: "cafe-courtyard",
      backgroundText: "高级咖啡店门口，自然光。",
      userPrompt: "",
      hasModelReference: false,
      hasBackgroundReference: false,
    });

    expect(prompt).toContain("HARD 硬规则 · 换景身份模式");
    expect(prompt).toContain("服装产品保真");
    expect(prompt).toContain("图1服装按商品资产处理");
    expect(prompt).toContain("环境光可以影响服装明暗");
    expect(prompt).toContain("不能改变服装固有色或面料表面");
    expect(prompt).toContain("匹配背景的主光方向");
    expect(prompt).toContain("对比度");
    expect(prompt).toContain("reference-matched exposure/contrast");
    expect(prompt).toContain("true-to-source garment rendering");
    expect(prompt).not.toContain("8K ultra-detailed");
    expect(prompt).not.toContain("RAW photo quality");
    expect(prompt).not.toContain("realistic color grade");
    expect(prompt).not.toContain("霉点");
    expect(prompt).not.toContain("毛球");
  });

  it("enforces product-fidelity hard rules on custom prompts", () => {
    const prompt = enforceModelBackgroundPromptRequirements("把背景换成森林街拍。", {
      mode: "model_background",
      hasModelReference: true,
      hasBackgroundReference: true,
    });

    expect(prompt).toContain("HARD 硬规则 · 换景身份模式");
    expect(prompt).toContain("换模特换背景");
    expect(prompt).toContain("图1是唯一服装/穿搭来源");
    expect(prompt).toContain("服装产品保真");
    expect(prompt).toContain("不重新设计布料");
  });

  it("face-swap mode preserves the model_only hard rule (no body/pose change)", () => {
    const prompt = enforceModelBackgroundPromptRequirements("", {
      mode: "model_only",
      hasModelReference: true,
      hasBackgroundReference: false,
    });
    expect(prompt).toContain("HARD 硬规则 · 换景身份模式");
    expect(prompt).toContain("只换模特脸部");
    expect(prompt).toContain("禁止合成新脸");
    expect(prompt).toContain("禁止面具边缘");
  });
});

describe("decideModelBackgroundMode", () => {
  it("returns the caller mode today (decision point reserved for future auto)", () => {
    expect(decideModelBackgroundMode({ mode: "background_only", hasModelReference: false, hasBackgroundReference: false })).toBe("background_only");
    expect(decideModelBackgroundMode({ mode: "model_only", hasModelReference: true, hasBackgroundReference: false })).toBe("model_only");
    expect(decideModelBackgroundMode({ mode: "model_background", hasModelReference: true, hasBackgroundReference: true })).toBe("model_background");
  });
});
