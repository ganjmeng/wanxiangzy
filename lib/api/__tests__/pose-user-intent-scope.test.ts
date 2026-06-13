import { describe, expect, it } from "vitest";
import { scopePoseUserIntentToSlot } from "@/lib/api/generation-jobs";

describe("scopePoseUserIntentToSlot", () => {
  // Production shape: preset plan prompt contains 4 姿势 lines joined.
  const presetPrompt = [
    "Use image 1 as the only reference.",
    "Main priority: create clearly different body poses while keeping...",
    "",
    "姿势1：正面服装展示方向；AI 可自由选择自然手势、重心、视线...",
    "姿势2：侧身或三分之二侧身展示方向；AI 可自由选择头发/衣领/袖口...",
    "姿势3：站定造型方向，不要走路；AI 可自由选择扶腰、胯部...",
    "姿势4：轻微迈步或自然转身方向；不要静态扶腰；...",
    "",
    "Negative: no outfit change, no face change, no extra person...",
  ].join("\n");

  it("slot 1 keeps only 姿势1 + non-pose lines, drops 姿势2/3/4", () => {
    const out = scopePoseUserIntentToSlot(presetPrompt, 1);
    expect(out).toContain("姿势1：正面服装展示方向");
    expect(out).not.toContain("姿势2：");
    expect(out).not.toContain("姿势3：");
    expect(out).not.toContain("姿势4：");
    expect(out).toContain("Use image 1 as the only reference.");
    expect(out).toContain("Negative: no outfit change");
  });

  it("slot 3 keeps only 姿势3 + non-pose lines, drops 姿势1/2/4", () => {
    const out = scopePoseUserIntentToSlot(presetPrompt, 3);
    expect(out).toContain("姿势3：站定造型方向");
    expect(out).not.toContain("姿势1：");
    expect(out).not.toContain("姿势2：");
    expect(out).not.toContain("姿势4：");
  });

  it("returns empty string for empty input", () => {
    expect(scopePoseUserIntentToSlot("", 1)).toBe("");
  });

  it("regression: scoped output for slot 1 contains exactly one 姿势 line", () => {
    const out = scopePoseUserIntentToSlot(presetPrompt, 1);
    const poseLineCount = (out.match(/^姿势\s*[1-4][：:]/gm) || []).length;
    expect(poseLineCount).toBe(1);
  });
});
