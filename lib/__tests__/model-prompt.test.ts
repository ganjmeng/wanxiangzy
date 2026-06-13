import { describe, expect, it } from "vitest";
import { enforceModelPromptRequirements } from "@/lib/model-prompt";

describe("model prompt handling", () => {
  it("builds a compact protocol that prevents the last reference from dominating", () => {
    const prompt = enforceModelPromptRequirements({
      prompt: [
        "图像角色：旧规则。",
        "融合规则：旧的长规则会被替换。",
        "专属模特拍摄风格档位：融合原生感。保留自然真实模特卡质感。",
        "用户希望眼神更温柔，商业头像可复用。",
      ].join("\n"),
      referenceCount: 3,
      gender: "female",
      hairStyle: "齐肩短波波头，空气刘海，发尾内扣",
      hairColor: "深棕色",
    });

    expect(prompt).toContain("专属模特生成协议 v2");
    expect(prompt).toContain("图1、图2、图3 是同等权重");
    expect(prompt).toContain("HARD 硬规则 · 模特身份模式");
    expect(prompt).toContain("不要把最后一张当主脸");
    expect(prompt).toContain("发型必须采用「齐肩短波波头，空气刘海，发尾内扣」");
    expect(prompt).toContain("发色必须采用「深棕色」");
    expect(prompt).toContain("专属模特拍摄风格档位：融合原生感");
    expect(prompt).toContain("用户希望眼神更温柔");
    expect(prompt).not.toContain("旧的长规则");
  });

  it("treats uploaded hair references as hard constraints outside face identity", () => {
    const prompt = enforceModelPromptRequirements({
      prompt: "需要高级品牌模特感。",
      referenceCount: 3,
      gender: "female",
      hairReferenceIndex: 4,
      hairColorReferenceIndex: 5,
    });

    expect(prompt).toContain("图4 是发型硬参考");
    expect(prompt).toContain("图5 是发色硬参考");
    expect(prompt).toContain("发型必须优先跟随图4");
    expect(prompt).toContain("发色必须优先跟随图5");
    expect(prompt).toContain("不参与人脸身份");
  });

  it("is idempotent instead of appending more rules on every pass", () => {
    const first = enforceModelPromptRequirements({
      prompt: "专属模特拍摄风格档位：电商模特。自然可信。",
      referenceCount: 2,
      gender: "male",
      hairStyle: "短寸头，清爽硬朗",
    });
    const second = enforceModelPromptRequirements({
      prompt: first,
      referenceCount: 2,
      gender: "male",
      hairStyle: "短寸头，清爽硬朗",
    });

    expect(second.match(/专属模特生成协议 v2/g)?.length).toBe(1);
    // Idempotency: round-trip self-enforce is now a no-op (marker + hard
    // rule already present → return as-is). The 400-char tolerance from
    // the previous version masked a real bug: hard rule was being pulled
    // into userIntent and re-wrapped, causing 2-3x duplication.
    expect(second).toBe(first);
  });

  it("hard rule segment appears exactly once even with multiple references and user prompt", () => {
    const prompt = enforceModelPromptRequirements({
      prompt: [
        "专属模特拍摄风格档位：融合原生感。",
        "用户希望眼神更温柔。",
        "多一些雀斑保留。",
        "想要淡妆。",
      ].join("\n"),
      referenceCount: 3,
      gender: "female",
      hairStyle: "齐肩短波波头",
      hairColor: "深棕色",
    });
    // HARD 硬规则 marker must appear exactly once
    const hardRuleCount = prompt.match(/【HARD 硬规则/g)?.length ?? 0;
    expect(hardRuleCount).toBe(1);
    // The 3 numbered children should also appear exactly once each
    expect(prompt.match(/1\) 脸型骨相/g)?.length).toBe(1);
    expect(prompt.match(/2\) 多参考融合/g)?.length).toBe(1);
    expect(prompt.match(/3\) 年龄感/g)?.length).toBe(1);
  });
});
