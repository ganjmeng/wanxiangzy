import { describe, expect, it } from "vitest";
import {
  buildOutfitFusionDemoResults,
  buildOutfitFusionPrompt,
  clampOutfitFusionCount,
  decideOutfitFusionMode,
  decideOutfitFusionFaceOwner,
  DEFAULT_OUTFIT_FUSION_CONFIG,
  enforceOutfitFusionPromptRequirements,
  normalizeOutfitFusionAssistantPrompt,
  outfitFusionReferencesFromAssets,
  OUTFIT_FUSION_TEMPLATES,
  type OutfitFusionAsset,
} from "@/lib/outfit-fusion";
import { createGenericImagePreviewSession, getPreviewCanvasInputReferences } from "@/lib/studio-image-preview";

describe("outfit fusion templates", () => {
  it("keeps reusable example templates with assets and demo results", () => {
    expect(OUTFIT_FUSION_TEMPLATES.length).toBeGreaterThanOrEqual(10);

    for (const template of OUTFIT_FUSION_TEMPLATES) {
      expect(template.id).toBeTruthy();
      expect(template.prompt).toContain("搭配");
      expect(template.assets.length).toBeGreaterThanOrEqual(3);
      expect(template.coverUrl).toMatch(/^https:\/\//);
      expect(new URL(template.coverUrl).host).not.toBe("img.alicdn.com");
      for (const asset of template.assets) {
        expect(asset.url).toMatch(/^https:\/\//);
        expect(new URL(asset.url).host).not.toBe("img.alicdn.com");
      }
    }
  });

  it("builds an industry prompt with role locks and negative constraints", () => {
    const template = OUTFIT_FUSION_TEMPLATES[0];
    const prompt = buildOutfitFusionPrompt({
      templatePrompt: template.prompt,
      assets: template.assets,
      customPrompt: "保持电商商拍质感",
      config: DEFAULT_OUTFIT_FUSION_CONFIG,
    });

    expect(prompt).toContain("HARD 硬规则 · 套装融合模式");
    expect(prompt).toContain("核心任务");
    expect(prompt).toContain("图片关系");
    expect(prompt).toContain("商品保真");
    expect(prompt).toContain("不要多余肢体");
    expect(prompt).toContain("保持电商商拍质感");
  });

  it("keeps multi-image count out of the single-image generation prompt", () => {
    const template = OUTFIT_FUSION_TEMPLATES[0];
    const prompt = buildOutfitFusionPrompt({
      templatePrompt: template.prompt,
      assets: template.assets,
      config: { ...DEFAULT_OUTFIT_FUSION_CONFIG, aiModel: "gpt-image-2", genCount: 4 },
    });

    expect(prompt).toContain("最终只生成一张完整的单人商业摄影穿搭照片");
    expect(prompt).toContain("多个候选结果");
    expect(prompt).toContain("拼图、四宫格");
    expect(prompt).not.toContain("生成 4 张候选图");
    expect(prompt).not.toContain("GPT-Image-2");
  });

  it("clamps generation count and repeats demo results to the requested count", () => {
    expect(clampOutfitFusionCount(0)).toBe(1);
    expect(clampOutfitFusionCount(8)).toBe(4);

    const urls = buildOutfitFusionDemoResults(OUTFIT_FUSION_TEMPLATES[0], 4);
    expect(urls).toHaveLength(4);
    expect(urls.every((url) => url.startsWith("https://"))).toBe(true);
  });

  it("keeps every outfit fusion input visible in preview canvas references", () => {
    const template = OUTFIT_FUSION_TEMPLATES[0];
    const references = outfitFusionReferencesFromAssets(template.assets);
    const session = createGenericImagePreviewSession({
      module: "outfitFusion",
      urls: template.resultUrls,
      references,
      expectedCount: 4,
    });

    expect(getPreviewCanvasInputReferences(session)).toHaveLength(references.length);
  });

  it("normalizes AI write output to a single user-visible sentence", () => {
    const echoedInternalPrompt = [
      "图像角色：图1是参考图；图2是参考图。",
      "任务：这是搭配融图的 AI 帮写任务，请调用视觉理解能力分析所有输入图。",
      "输出格式：让【参考图X】的模特穿着【搭配图Y】的商品，把模特换成【模特图M】的模特。",
      "图片输入关系如下，仅供你判断编号和商品，不要原样输出：",
      "用户已有要求: 让【参考图8】的模特穿着【搭配图1】的一双银色的高跟凉鞋，穿着【搭配图2】的一件浅灰色的吊带连衣裙，戴着【搭配图4】的米色编织帽子，拿着【搭配图6】的绿色手提包，把模特换成【模特图7】的模特。",
      "最终只返回这一句话本身，不要追加后台固定规则。画面真实自然，photorealistic, sharp details。",
    ].join(" ");

    expect(normalizeOutfitFusionAssistantPrompt(echoedInternalPrompt, "")).toBe(
      "让【参考图8】的模特穿着【搭配图1】的一双银色的高跟凉鞋，穿着【搭配图2】的一件浅灰色的吊带连衣裙，戴着【搭配图4】的米色编织帽子，拿着【搭配图6】的绿色手提包，把模特换成【模特图7】的模特。"
    );
  });
});

describe("decideOutfitFusionMode", () => {
  function items(...n: number[]): OutfitFusionAsset[] {
    return n.map((i) => ({ id: `i${i}`, role: "outfit" as const, url: `https://e.com/${i}.jpg` }));
  }
  function ref(): OutfitFusionAsset { return { id: "r1", role: "reference", url: "https://e.com/r.jpg" }; }
  function mdl(): OutfitFusionAsset { return { id: "m1", role: "model", url: "https://e.com/m.jpg" }; }

  it("returns full when reference + model + items are all present", () => {
    expect(decideOutfitFusionMode([ref(), mdl(), ...items(1, 2)])).toBe("full");
  });

  it("returns with_model when only model + items are present", () => {
    expect(decideOutfitFusionMode([mdl(), ...items(1, 2)])).toBe("with_model");
  });

  it("returns with_reference when only reference + items are present", () => {
    expect(decideOutfitFusionMode([ref(), ...items(1, 2)])).toBe("with_reference");
  });

  it("returns items_only when only items are present", () => {
    expect(decideOutfitFusionMode(items(1, 2, 3))).toBe("items_only");
  });
});

describe("decideOutfitFusionFaceOwner", () => {
  it("returns 1-based index of the first model asset", () => {
    // Assets: [ref, items1, items2, model] → 1-based model index = 4
    expect(decideOutfitFusionFaceOwner([
      { id: "r1", role: "reference", url: "u" },
      { id: "i1", role: "outfit", url: "u" },
      { id: "i2", role: "outfit", url: "u" },
      { id: "m1", role: "model", url: "u" },
    ])).toBe(4);
  });

  it("returns undefined when no model asset is present", () => {
    expect(decideOutfitFusionFaceOwner([
      { id: "r1", role: "reference", url: "u" },
      { id: "i1", role: "outfit", url: "u" },
    ])).toBeUndefined();
  });

  it("face owner line is injected into the leading hard rule when a model is present", () => {
    const template = OUTFIT_FUSION_TEMPLATES[0];
    const prompt = buildOutfitFusionPrompt({
      templatePrompt: template.prompt,
      assets: template.assets,
      config: DEFAULT_OUTFIT_FUSION_CONFIG,
    });
    // The face-owner line must be the FIRST numbered rule (0)).
    const headSlice = prompt.split("\n").slice(0, 6).join("\n");
    expect(headSlice).toContain("【HARD 硬规则 · 套装融合模式】");
    expect(headSlice).toContain("脸主锁定");
    expect(headSlice).toMatch(/图\d+（模特图）.*唯一脸部身份/);
    // And the 3 responsibility rules (mirroring tryon) must all be present
    expect(prompt).toContain("搭配图角色隔离规则");
    expect(prompt).toContain("模特图规则");
    expect(prompt).toContain("参考图规则");
    expect(prompt).toContain("服装还原规则");
    expect(prompt).toContain("单张输出规则");
  });
});

describe("enforceOutfitFusionPromptRequirements", () => {
  const template = OUTFIT_FUSION_TEMPLATES[0];

  it("is idempotent when hard rule marker is present", () => {
    const prompt = buildOutfitFusionPrompt({
      templatePrompt: template.prompt,
      assets: template.assets,
      config: DEFAULT_OUTFIT_FUSION_CONFIG,
    });
    const second = enforceOutfitFusionPromptRequirements(prompt, {
      assets: template.assets,
      config: DEFAULT_OUTFIT_FUSION_CONFIG,
      templatePrompt: template.prompt,
    });
    expect(second).toBe(prompt);
  });

  it("wraps older prompts with the hard rule segment", () => {
    const wrapped = enforceOutfitFusionPromptRequirements("让模特穿上所有服装", {
      assets: template.assets,
      config: DEFAULT_OUTFIT_FUSION_CONFIG,
    });
    expect(wrapped).toContain("HARD 硬规则 · 套装融合模式");
    expect(wrapped).toContain("让模特穿上所有服装");
  });
});
