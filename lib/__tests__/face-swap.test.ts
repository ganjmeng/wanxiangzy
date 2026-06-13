import { describe, expect, it } from "vitest";
import {
  buildFaceSwapPrompt,
  DEFAULT_FACE_SWAP_TEXTURE_ENHANCE,
  enforceFaceSwapPromptRequirements,
  FACE_SWAP_HARD_RULE,
  FACE_SWAP_HARD_RULE_MARK,
  isFaceSwapSystemPrompt,
  normalizeFaceSwapTextureEnhance,
} from "@/lib/face-swap";

describe("face swap prompt", () => {
  it("keeps garment detail recovery disabled by default", () => {
    const prompt = buildFaceSwapPrompt();

    expect(DEFAULT_FACE_SWAP_TEXTURE_ENHANCE).toBe(false);
    expect(prompt).not.toContain("服装轻量细节恢复规则");
    expect(prompt).toContain("HARD 硬规则 · 换脸模式");
    expect(prompt).toContain("Only perform a local facial-identity edit");
    expect(prompt).toContain("源色调锁定");
    expect(prompt).toContain("细密纹理安全");
    expect(prompt).toContain("过渡自然");
    expect(prompt).not.toContain("8K ultra-detailed");
    expect(prompt).not.toContain("RAW photo quality");
    expect(prompt).not.toContain("high-frequency garment texture");
    expect(prompt).not.toContain("natural micro-contrast");
  });

  it("keeps conservative hard rules when detail recovery is explicitly enabled", () => {
    const prompt = enforceFaceSwapPromptRequirements(buildFaceSwapPrompt("保留冷感表情", true));

    expect(prompt).toContain("服装轻量细节恢复规则");
    expect(prompt).toContain("HARD 硬规则 · 换脸模式");
    expect(prompt).toContain("· 增强模式");
    expect(prompt).toContain("分区控制");
    expect(prompt).toContain("影调锁定");
    expect(prompt).toContain("User extra instruction: 保留冷感表情");
    expect(prompt).not.toContain("8K ultra-detailed");
    expect(prompt).not.toContain("RAW photo quality");
    expect(prompt).not.toContain("high-frequency garment texture");
  });

  it("can be explicitly disabled for preservation-only jobs", () => {
    const prompt = buildFaceSwapPrompt("", false);

    expect(prompt).not.toContain("服装轻量细节恢复规则");
    expect(prompt).toContain("HARD 硬规则 · 换脸模式");
  });

  it("enforce is idempotent: marker present → returns as-is", () => {
    const first = buildFaceSwapPrompt("保留冷感表情", true);
    const second = enforceFaceSwapPromptRequirements(first);
    expect(second).toBe(first);
    expect(second.match(/HARD 硬规则 · 换脸模式/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("isFaceSwapSystemPrompt detects both old English marker and new HARD marker", () => {
    expect(isFaceSwapSystemPrompt("Image 1 is the original model photo and the target canvas. Image 2 is the target face identity reference.")).toBe(true);
    expect(isFaceSwapSystemPrompt(buildFaceSwapPrompt())).toBe(true);
    expect(isFaceSwapSystemPrompt("let me know your thoughts")).toBe(false);
  });

  it("normalizes explicit texture enhancement values without swallowing true", () => {
    expect(normalizeFaceSwapTextureEnhance(true)).toBe(true);
    expect(normalizeFaceSwapTextureEnhance("true")).toBe(true);
    expect(normalizeFaceSwapTextureEnhance(false)).toBe(false);
    expect(normalizeFaceSwapTextureEnhance(undefined)).toBe(false);
  });

  it("hard rule is exported and contains the three numbered constraints", () => {
    expect(FACE_SWAP_HARD_RULE).toContain(FACE_SWAP_HARD_RULE_MARK);
    expect(FACE_SWAP_HARD_RULE).toContain("1) 图1是固定底图");
    expect(FACE_SWAP_HARD_RULE).toContain("2) 图2只提供五官几何");
    expect(FACE_SWAP_HARD_RULE).toContain("3) 必须保留");
    expect(FACE_SWAP_HARD_RULE.length).toBeLessThan(900);
  });
});
