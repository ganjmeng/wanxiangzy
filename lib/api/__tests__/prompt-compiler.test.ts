import { describe, it, expect } from "vitest";
import { compileImagePromptForModel, type ImagePromptKind } from "@/lib/api/prompt-compiler";
import { buildFaceSwapPrompt } from "@/lib/face-swap";
import { buildSeparatePosePrompt } from "@/lib/pose-prompt";

describe("compileImagePromptForModel", () => {
  const shortPrompt =
    "图像角色：图1是服装图。核心任务：将图1服装穿到人物身上。服装还原规则：保留颜色和版型。负面约束：不要多余人物。图像质量：photorealistic, 8K ultra-detailed.";

  it("returns normalized prompt when kind is undefined", () => {
    const result = compileImagePromptForModel({
      kind: undefined,
      model: "gpt-image-2",
      prompt: shortPrompt,
    });
    expect(result).toBe(shortPrompt);
  });

  it("returns tryon prompt without obsolete 8K/RAW quality terms", () => {
    const result = compileImagePromptForModel({
      kind: "tryon",
      model: "gpt-image-2",
      prompt: shortPrompt,
    });
    expect(result).toContain("图像角色：图1是服装图");
    expect(result).toContain("图像质量：photorealistic");
    expect(result).not.toContain("8K ultra-detailed");
    expect(result).not.toContain("RAW photo quality");
  });

  it("truncates long prompt for gpt-image-2 to 6200 chars", () => {
    const longPrompt = "A".repeat(8000);
    const result = compileImagePromptForModel({
      kind: "grass",
      model: "gpt-image-2",
      prompt: longPrompt,
    });
    expect(result.length).toBeLessThanOrEqual(6200);
  });

  it("produces concise prompt for nano-banana-2 with required signals", () => {
    const result = compileImagePromptForModel({
      kind: "grass",
      model: "nano-banana-2",
      prompt: shortPrompt,
    });
    // Should contain kind header
    expect(result).toContain("种草");
    // Should contain quality line
    expect(result).toContain("photorealistic");
    // Should be within limit
    expect(result.length).toBeLessThanOrEqual(2300);
  });

  it("preserves material enhancement edit boundaries in concise prompts", () => {
    const result = compileImagePromptForModel({
      kind: "materialEnhancement",
      model: "nano-banana-2",
      prompt: "任务：增强服装材质。图2只提供服装细节。负面约束：不要换脸。",
    });

    expect(result).toContain("材质增强");
    expect(result).toContain("图1是最终画面原图");
    expect(result).toContain("只处理图1目标服装可见区域");
    expect(result).toContain("只允许改变图1可见目标服装区域的材质细节表现");
    expect(result).toContain("原图其他内容必须完全不变");
    expect(result).toContain("图2只用于补足面料织法");
    expect(result).toContain("不要换脸");
    expect(result.length).toBeLessThanOrEqual(2300);
  });

  it("uses source/reference matched quality for image-edit modules while keeping detail prompts unchanged", () => {
    const grass = compileImagePromptForModel({
      kind: "grass",
      model: "nano-banana-2",
      prompt: shortPrompt,
    });
    const commerceDetail = compileImagePromptForModel({
      kind: "commerceDetail",
      model: "nano-banana-2",
      prompt: shortPrompt,
    });
    const productSet = compileImagePromptForModel({
      kind: "productSet",
      model: "nano-banana-2",
      prompt: shortPrompt,
    });

    expect(grass).toContain("reference-matched edit");
    expect(grass).toContain("exposure contrast");
    expect(grass).not.toContain("RAW photo quality");
    expect(grass).not.toContain("8K ultra-detailed");
    expect(commerceDetail).toContain("raw photo quality");
    expect(commerceDetail).not.toContain("RAW photo quality");
    expect(productSet).toContain("raw photo quality");
    expect(productSet).not.toContain("RAW photo quality");
  });

  it("produces concise prompt for nano-banana-pro with required signals", () => {
    const result = compileImagePromptForModel({
      kind: "pose",
      model: "nano-banana-pro",
      prompt: shortPrompt,
    });
    expect(result).toContain("四宫格");
    expect(result).toContain("photorealistic");
    expect(result.length).toBeLessThanOrEqual(1900);
  });

  it("does not wrap separate pose prompts with generic task boilerplate", () => {
    const result = compileImagePromptForModel({
      kind: "pose",
      model: "nano-banana-2",
      prompt: buildSeparatePosePrompt("", 2),
    });

    expect(result.startsWith("Use the source image only")).toBe(true);
    expect(result).toContain("same gender expression");
    expect(result).toContain("Generate one standalone source-matched pose variation photo");
    expect(result).toContain("Image quality:");
    expect(result).toContain("source-matched natural camera photo");
    expect(result).toContain("no extra sharpening");
    expect(result).toContain("no moire");
    expect(result).not.toContain("8K");
    expect(result).not.toContain("RAW photo quality");
    expect(result).toContain("Keep the outfit readable");
    expect(result).toContain("Target pose:");
    expect(result).toContain("Strong three-quarter or side-angle outfit read");
    expect(result).toContain("Camera:");
    expect(result).toContain("Full-body or 7/8-body source-matched three-quarter framing");
    expect(result).toContain("Expression:");
    expect(result).toContain("Soft slight smile");
    expect(result).toContain("Negative:");
    expect(result).not.toContain("Shot:");
    expect(result).not.toContain("avoid close-up");
    expect(result).not.toContain("生成一张独立的单姿势完整图片");
    expect(result).not.toContain("不要生成 2x2、四宫格、拼图、分屏或 contact sheet");
    expect(result).not.toContain("生成单张 2x2 四宫格姿势裂变图");
  });

  it("keeps gpt-image-2 separate pose prompts concise", () => {
    const posePrompt = [
      buildSeparatePosePrompt("", 3),
      "冗余描述".repeat(2000),
    ].join("\n");
    const result = compileImagePromptForModel({
      kind: "pose",
      model: "gpt-image-2",
      prompt: posePrompt,
    });

    expect(result.startsWith("Use the source image only")).toBe(true);
    expect(result).toContain("Target pose:");
    expect(result).toContain("Stationary confident shape pose");
    expect(result).toContain("Emphasize natural body structure");
    expect(result).toContain("Full-body or 7/8-body source-matched outfit framing");
    expect(result).toContain("Confident natural gaze");
    expect(result).not.toContain("HARD TARGET POSE SLOT");
    expect(result).not.toContain("图像质量：");
    expect(result.length).toBeLessThanOrEqual(2400);
  });

  it("preserves each separate pose target in the final compiled prompt", () => {
    const slotAssertions = [
      { slot: 1, keywords: ["Target pose:", "front-view", "front silhouette", "Source-matched full-body product-readable framing"] },
      { slot: 2, keywords: ["Target pose:", "side-angle", "side silhouette", "Full-body or 7/8-body"] },
      { slot: 3, keywords: ["Target pose:", "stationary", "not walking", "waistline"] },
      { slot: 4, keywords: ["Target pose:", "light movement", "aligned turning", "same natural direction", "natural fabric drape"] },
    ];

    slotAssertions.forEach(({ slot, keywords }) => {
      const result = compileImagePromptForModel({
        kind: "pose",
        model: "gpt-image-2",
        prompt: buildSeparatePosePrompt("", slot),
      });

      expect(result.startsWith("Use the source image only")).toBe(true);
      expect(result).not.toContain("Generate exactly ONE");
      expect(result).not.toContain("核心任务：");
      keywords.forEach((keyword) => expect(result.toLowerCase()).toContain(keyword.toLowerCase()));
    });
  });

  it("throws before model call when a separate pose compiled prompt would lose target pose", () => {
    expect(() =>
      compileImagePromptForModel({
        kind: "pose",
        model: "gpt-image-2",
        prompt: [
          "HARD TARGET POSE SLOT 2/4.",
          "Generate exactly ONE standalone 3:4 photo for pose 2.",
          "Use the uploaded image as the only reference for the same person, outfit, background and lighting.",
          "Keep: same outfit and identity.",
          "Allow: clear pose change.",
          "Negative: no grid.",
        ].join("\n"),
      })
    ).toThrow("compiledPrompt missing Target pose");
  });

  it("normalizes line breaks and excess whitespace", () => {
    const messyPrompt = "  Hello   world  \r\n\r\n\r\n  Test  ";
    const result = compileImagePromptForModel({
      kind: undefined,
      model: "gpt-image-2",
      prompt: messyPrompt,
    });
    // normalizePrompt collapses spaces to single space, then trims
    expect(result).toContain("Hello world");
    expect(result).toContain("Test");
    expect(result).not.toContain("\r");
    expect(result).not.toMatch(/\n{3,}/);
  });

  it("grass kind includes required image relationship signal", () => {
    const result = compileImagePromptForModel({
      kind: "grass",
      model: "nano-banana-2",
      prompt: "一些描述文字，没有图号",
    });
    // Should inject fallback signal for image relationship
    expect(result).toContain("图1");
  });

  it("garment3d kind includes required 3D signal", () => {
    const result = compileImagePromptForModel({
      kind: "garment3d",
      model: "nano-banana-2",
      prompt: "一些描述文字",
    });
    expect(result).toContain("3D");
    expect(result).toContain("无真人");
  });

  it("modelBackground kind includes required fusion signal", () => {
    const result = compileImagePromptForModel({
      kind: "modelBackground",
      model: "nano-banana-2",
      prompt: "一些描述文字",
    });
    expect(result).toContain("图1");
    expect(result).toContain("参考融合影调");
    expect(result).toContain("背景对比度");
    expect(result).toContain("reference-matched edit");
    expect(result).not.toContain("RAW photo quality");
  });

  it("model kind includes required identity signal", () => {
    const result = compileImagePromptForModel({
      kind: "model",
      model: "nano-banana-2",
      prompt: "一些描述文字",
    });
    expect(result).toContain("参考图");
  });

  it("keeps conservative face-swap detail recovery signal for nano prompts when explicitly enabled", () => {
    const result = compileImagePromptForModel({
      kind: "faceSwap",
      model: "nano-banana-2",
      prompt: buildFaceSwapPrompt("保持冷感表情", true),
    });

    expect(result).toContain("服装轻量细节恢复");
    expect(result).toContain("材质");
    expect(result).toContain("细密纹理安全");
    expect(result).toContain("不要磨皮");
    expect(result).not.toContain("8K ultra-detailed");
    expect(result).not.toContain("RAW photo quality");
    expect(result).not.toContain("high-frequency garment texture");
    expect(result.length).toBeLessThanOrEqual(2300);
  });

  it("keeps gpt-image-2 model prompts concise with hair constraints", () => {
    const longPrompt = [
      "【专属模特生成协议 v2】",
      "图像角色：图1、图2、图3 是同等权重的人脸、气质、妆感和审美融合参考；每张都必须留下可感知贡献，禁止把图3或任意单张直接当最终脸复制。",
      "融合方法：先分别提取图1、图2、图3的脸型骨相、五官比例、眼神气质、肤色冷暖、妆感、年龄感和真实皮肤质感，再重组为一个新长相；图1、图2、图3权重均衡，图3即使更清晰也不能成为主脸，只能贡献部分特征。",
      "发型发色硬约束：发型必须采用「齐肩短波波头」；发色必须采用「深棕色」。",
      "用户补充/视觉分析：".padEnd(5000, "视觉分析"),
    ].join("\n");

    const result = compileImagePromptForModel({
      kind: "model",
      model: "gpt-image-2",
      prompt: longPrompt,
    });

    expect(result.length).toBeLessThanOrEqual(3400);
    expect(result).toContain("图3即使更清晰也不能成为主脸");
    expect(result).toContain("发型发色硬约束");
  });
});

describe("prompt compiler hard rule leading", () => {
  it("commerceDetail kind header is now Chinese (no longer English Core task)", () => {
    const result = compileImagePromptForModel({
      kind: "commerceDetail",
      model: "nano-banana-2",
      prompt: "生成一个分段。",
    });
    expect(result).toContain("核心任务：生成一个独立的电商详情页分段/分模块素材");
    expect(result).not.toContain("Core task: generate one independent e-commerce");
  });

  it("separate pose quality line is now Chinese (no longer English Image quality)", () => {
    // Trigger compileSeparatePosePrompt via a separate-pose prompt shape.
    const result = compileImagePromptForModel({
      kind: "pose",
      model: "nano-banana-2",
      prompt: [
        "每个姿势单独生成一张完整图片",
        "Use the source image only to preserve: same person, same outfit.",
        "Image 1 is the original model photo and the target canvas.",
        "Target pose:",
        "Pose 1: standing front.",
        "Priority: execute this pose direction clearly.",
      ].join("\n"),
    });
    // Chinese quality line leads; English "Image quality:" is gone.
    expect(result).toContain("图像质量：");
    expect(result).not.toMatch(/^Image quality:/m);
  });

  it("preserves a leading HARD rule marker at the head of the compiled prompt (grid pose path)", () => {
    // Use a non-separate pose prompt so it goes through compileConcisePrompt
    // (where the new getHardRuleLine hook is wired in).
    const result = compileImagePromptForModel({
      kind: "pose",
      model: "nano-banana-2",
      prompt: [
        "【HARD 硬规则 · 姿势身份模式 pose_burst_full_subject】",
        "1) 仅改变姿势：人物身份、性别表达、年龄感必须与图 1 严格一致。",
        "2) 禁止换脸、禁止合成新脸。",
        "Use the source image only to preserve: same person, same outfit.",
        "Image 1 is the original model photo and the target canvas.",
        "Priority: execute this pose direction clearly.",
      ].join("\n"),
    });
    // HARD marker should appear at or near the top of the compiled prompt
    const headSlice = result.slice(0, 500);
    expect(headSlice).toContain("【HARD 硬规则");
  });
});
