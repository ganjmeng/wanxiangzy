import { describe, expect, it } from "vitest";
import { applyPoseSeriesStylePrompt } from "@/lib/module-style-presets";
import { buildSeparatePosePrompt, buildSeparatePoseSlotDirective, buildPoseHardRule, enforcePosePromptRequirements } from "@/lib/pose-prompt";
import { normalizePoseVisualAnalysis } from "@/lib/pose-analysis";
import { buildFallbackPosePlan } from "@/lib/pose-plan";

describe("pose prompt handling", () => {
  it("keeps user custom pose lines instead of replacing them with defaults", () => {
    const prompt = [
      "保持图1原始场景和镜头距离。",
      "镜头统一规则：consistent medium full-body framing, 50mm lens, eye level angle",
      "姿势1：双手插兜，正面站立。",
      "姿势2：左手扶帽檐，身体侧转。",
      "姿势3：右手拿包，轻微迈步。",
      "姿势4：背对镜头回眸，手扶腰。",
    ].join("\n");

    const styled = applyPoseSeriesStylePrompt(prompt, "user_custom");

    expect(styled).toContain("姿势2：左手扶帽檐，身体侧转。");
    expect(styled).toContain("姿势4：背对镜头回眸，手扶腰。");
    expect(styled).not.toContain("一手轻抚头发或整理衣领");
    expect(styled).toContain("不用默认姿势覆盖");
  });

  it("does not append default pose lines during custom prompt enforcement", () => {
    const prompt = [
      "保持图1原始场景和镜头距离。",
      "姿势1：双手插兜，正面站立。",
      "姿势2：左手扶帽檐，身体侧转。",
      "姿势3：右手拿包，轻微迈步。",
      "姿势4：背对镜头回眸，手扶腰。",
    ].join("\n");

    const enforced = enforcePosePromptRequirements(prompt, {
      poseStyle: "user_custom",
    });

    expect(enforced).toContain("姿势3：右手拿包，轻微迈步。");
    expect(enforced).not.toContain("一手轻抚头发或整理衣领");
    expect(enforced).toContain("人物身份规则");
    expect(enforced).toContain("图1角色");
  });

  it("restores default pose scripts for preset styles", () => {
    const prompt = "保持图1人物、服装和商业摄影质感，生成四宫格姿势裂变。";

    const styled = applyPoseSeriesStylePrompt(prompt, "korean_clean");
    const enforced = enforcePosePromptRequirements(styled, {
      poseStyle: "korean_clean",
    });

    expect(enforced).toContain("姿势1：正面服装展示方向");
    expect(enforced).toContain("姿势2：侧身或三分之二侧身展示方向");
    expect(enforced).toContain("姿势4：轻微迈步或自然转身方向");
    expect(enforced).toContain("头部方向与肩膀、躯干和身体转向保持一致");
    expect(enforced).not.toContain("动态行走、转身或回眸方向");
    expect(enforced).not.toContain("consistent medium full-body framing");
    expect(enforced).toContain("服装保真规则");
    expect(enforced).not.toContain("手指自然整理发丝或衣领");
    expect(enforced).not.toContain("由 AI 按风格自由设计");
  });

  it("switches layout wording for separate pose outputs", () => {
    const styled = applyPoseSeriesStylePrompt("保持图1人物和服装，生成四宫格姿势裂变，像连续 pose sheet。", "luxury_lookbook");
    const enforced = enforcePosePromptRequirements(styled, {
      poseStyle: "source_continuity",
      outputMode: "separate",
    });

    expect(enforced).toContain("当前请求只生成一张");
    expect(enforced).toContain("不要四宫格");
    expect(enforced).not.toContain("必须生成单张图片中的 2x2 四宫格");
    expect(enforced).not.toContain("生成四宫格姿势裂变");
    expect(enforced).not.toContain("四个分格");
    expect(enforced).not.toContain("连续 pose sheet");
    expect(enforced).toContain("姿势裂变拍摄风格档位：轻奢 Lookbook");
    expect(enforced).not.toContain("单图裂变规则");
    expect(enforced).not.toContain("单张生产线分镜");
    expect(enforced).not.toContain("同组四张");
    expect(enforced).toContain("当前单张图片");
  });

  it("scopes separate execution prompt to one slot without group storyboard noise", () => {
    const basePrompt = enforcePosePromptRequirements(
      [
        "保持图1人物、服装和商业摄影质感，生成姿势裂变。",
        "姿势1：正面自然站立，双手自然下垂。",
        "姿势2：身体侧转30度，一手整理衣领。",
        "姿势3：重心偏移，一手扶腰。",
        "姿势4：轻微迈步回眸。",
      ].join("\n"),
      { poseStyle: "fashion_editorial", outputMode: "separate" }
    );

    const slot2 = buildSeparatePosePrompt(basePrompt, 2, "fashion_editorial");

    expect(slot2.startsWith("Use the source image only")).toBe(true);
    expect(slot2).toContain("same gender expression");
    expect(slot2).toContain("Generate one standalone source-matched pose variation photo");
    expect(slot2).toContain("Image quality:");
    expect(slot2).toContain("source-matched natural camera photo");
    expect(slot2).toContain("no extra sharpening");
    expect(slot2).toContain("no moire");
    expect(slot2).not.toContain("8K");
    expect(slot2).not.toContain("RAW photo quality");
    expect(slot2).toContain("Keep the outfit readable");
    expect(slot2).toContain("Target pose:");
    expect(slot2).toContain("Strong three-quarter or side-angle outfit read");
    expect(slot2).toContain("The body must clearly read as side or three-quarter view");
    expect(slot2).toContain("Camera:");
    expect(slot2).toContain("Full-body or 7/8-body source-matched three-quarter framing");
    expect(slot2).toContain("Expression:");
    expect(slot2).toContain("Soft slight smile");
    expect(slot2).toContain("Negative:");
    expect(slot2).not.toContain("Shot:");
    expect(slot2).not.toContain("avoid close-up");
    expect(slot2).not.toContain("HARD TARGET POSE SLOT");
    expect(slot2).not.toContain("API call has no memory");
    expect(slot2).not.toContain("姿势2：身体侧转30度");
    expect(slot2).not.toContain("姿势1：");
    expect(slot2).not.toContain("姿势3：");
    expect(slot2).not.toContain("姿势4：");
    expect(slot2).not.toContain("本组四张");
    expect(slot2).not.toContain("用户自定义四槽计划");
    expect(slot2).not.toContain("全组差异校验");
    expect(slot2).not.toContain("same camera distance");
    expect(slot2).not.toContain("统一构图");
    expect(slot2).not.toContain("统一镜头语言");
    expect(slot2.length).toBeLessThan(2200);
  });

  it("provides distinct default directions for separate pose slots", () => {
    expect(buildSeparatePoseSlotDirective(1)).toContain("Relaxed front-view");
    expect(buildSeparatePoseSlotDirective(2)).toContain("Strong three-quarter or side-angle");
    expect(buildSeparatePoseSlotDirective(3)).toContain("Stationary confident shape pose");
    expect(buildSeparatePoseSlotDirective(3)).toContain("natural body structure");
    expect(buildSeparatePoseSlotDirective(3)).not.toContain("womenswear");
    expect(buildSeparatePoseSlotDirective(4)).toContain("Light movement or natural aligned turning pose");
    expect(buildSeparatePoseSlotDirective(4)).toContain("same natural direction");
    expect(buildSeparatePoseSlotDirective(4)).toContain("source person's gender expression");
    expect(buildSeparatePoseSlotDirective(4)).not.toContain("feminine");
    expect(buildSeparatePoseSlotDirective(4)).not.toContain("over-shoulder gaze");
  });

  it("keeps preset style as a mood hint without changing the production slot structure", () => {
    const prompt = buildSeparatePosePrompt("", 3, "fashion_editorial");
    expect(prompt).toContain("Style preset:");
    expect(prompt).toContain("Fashion editorial.");
    expect(prompt).toContain("Use stronger styling attitude");
    expect(prompt).toContain("Stationary confident shape pose");
    expect(prompt).toContain("Full-body or 7/8-body source-matched outfit framing");
    expect(prompt).toContain("Confident natural gaze");
  });

  it("keeps separate execution prompts short even when the source prompt is noisy", () => {
    const noisyPrompt = [
      "High-end fashion photo series, consistent framing, same camera distance, same lens style.",
      "同组四张独立图片必须保持统一构图、统一镜头语言和同一画幅留白。",
      "生产线四槽计划：",
      "姿势1：正面自然站立，镜头：consistent medium full-body framing, 50mm lens, eye level angle",
      "姿势2：身体轻微侧转30度，镜头：consistent medium full-body framing, 50mm lens, eye level angle",
      "姿势3：重心轻微偏移，镜头：consistent medium full-body framing, 50mm lens, eye level angle",
      "姿势4：轻微迈步回眸，镜头：consistent medium full-body framing, 50mm lens, eye level angle",
      "补充要求：衣服图案必须清楚。",
    ].join("\n");

    const slot2 = buildSeparatePosePrompt(noisyPrompt, 2);

    expect(slot2).toContain("Target pose:");
    expect(slot2).toContain("Strong three-quarter or side-angle outfit read");
    expect(slot2).toContain("补充要求：衣服图案必须清楚。");
    expect(slot2).not.toContain("Generate exactly ONE");
    expect(slot2).not.toContain("same camera distance");
    expect(slot2).not.toContain("consistent medium full-body framing");
    expect(slot2).not.toContain("统一构图");
    expect(slot2).not.toContain("生产线四槽计划");
    expect(slot2.length).toBeLessThan(1800);
  });

  it("keeps expression guidance fixed instead of exposing a toggle", () => {
    const enforced = enforcePosePromptRequirements("保持图1人物和服装，生成姿势变化。");

    expect(enforced).toContain("表情规则");
    expect(enforced).toContain("轻微自然");
    expect(enforced).toContain("身体骨架必须保持不变");
    expect(enforced).not.toContain("表情控制");
  });

  it("locks source gender identity and body frame for pose generation", () => {
    const enforced = enforcePosePromptRequirements("保持图1人物和服装，生成姿势变化。");

    expect(enforced).toContain("人物身份规则");
    expect(enforced).toContain("同一性别表达");
    expect(enforced).toContain("原图人物的性别表达");
  });

  it("uses product-fidelity wording instead of defect keyword stuffing", () => {
    const enforced = enforcePosePromptRequirements("保持图1人物和服装，生成姿势变化。");
    const separate = buildSeparatePosePrompt("补充要求：保持衣服质感。", 2);

    expect(enforced).toContain("服装保真规则");
    expect(enforced).toContain("原图服装的款式");
    expect(enforced).toContain("原图色调规则");
    expect(enforced).toContain("摩尔纹");
    expect(enforced).not.toContain("cinematic color grade");
    expect(separate).toContain("Product fidelity");
    expect(separate).toContain("outfit is protected");
    expect(separate).toContain("Fine textile safety");
    expect(separate).not.toContain("8K");
    expect(separate).not.toContain("RAW photo quality");
    expect(separate).not.toContain("dirty fabric");
  });

  it("injects structured visual analysis as high priority pose constraints", () => {
    const analysis = normalizePoseVisualAnalysis({
      genderExpression: "male",
      ageRange: "adult",
      bodyCrop: "full_body",
      bodyOrientation: "front-facing standing posture",
      outfitDescription: "black blazer, white shirt, straight trousers",
      faceIdentityNotes: "angular face and short hair",
      skinToneNotes: "natural warm skin tone",
      confidence: 0.82,
    });

    const enforced = enforcePosePromptRequirements("保持图1人物和服装，生成姿势变化。", {
      poseAnalysis: analysis,
    });

    expect(enforced).toContain("视觉识别约束");
    expect(enforced).toContain("图1识别为男性表达");
    expect(enforced).toContain("black blazer");
    expect(enforced).toContain("natural warm skin tone");
    expect(enforced).toContain("不要把男性变成女性");
  });

  it("passes visual analysis into separate slot prompts without relying on previous slots", () => {
    const analysis = normalizePoseVisualAnalysis({
      genderExpression: "female",
      ageRange: "adult",
      bodyCrop: "upper_body",
      cameraFraming: "upper-body studio portrait crop",
      outfitDescription: "cream knit top with visible neckline",
      confidence: 0.76,
    });

    const slot1 = buildSeparatePosePrompt("补充要求：领口细节必须清楚。", 1, "korean_clean", "", analysis);

    expect(slot1).toContain("视觉识别约束");
    expect(slot1).toContain("图1识别为女性表达");
    expect(slot1).toContain("保持上半身展示逻辑");
    expect(slot1).toContain("cream knit top");
    expect(slot1).toContain("每个 slot 只改变目标姿势");
    expect(slot1).toContain("领口细节必须清楚");
  });

  it("keeps lower-body headless pose generation from inventing faces", () => {
    const analysis = normalizePoseVisualAnalysis({
      genderExpression: "female",
      ageRange: "adult",
      bodyCrop: "lower_body",
      headVisible: false,
      faceVisible: false,
      upperTorsoVisible: false,
      lowerBodyVisible: true,
      handsVisible: false,
      feetVisible: true,
      cameraFraming: "waist-to-feet crop, no head or face",
      outfitDescription: "blue denim knee-length shorts, socks and sneakers",
      confidence: 0.92,
    });
    const posePlan = buildFallbackPosePlan({
      poseAnalysis: analysis,
      outputMode: "separate",
    });

    expect(posePlan.slots.every((slot) => slot.headDirection === "")).toBe(true);
    expect(posePlan.slots[0].cameraFraming).toContain("无头");
    expect(posePlan.slots[0].avoidRules).toContain("invented head");
    expect(posePlan.slots[0].avoidRules).toContain("invented face");

    const enforced = enforcePosePromptRequirements("保持图1服装和构图，生成姿势变化。", {
      poseAnalysis: analysis,
      posePlan,
      outputMode: "separate",
    });
    expect(enforced).toContain("无头下半身硬规则");
    expect(enforced).toContain("无脸裁切规则");
    expect(enforced).toContain("不要规划或生成表情、视线、回眸、看镜头");
    expect(enforced).not.toContain("脸型五官规则");

    const slotPrompt = buildSeparatePosePrompt("补充要求：短裤长度和牛仔水洗必须保持。", 2, "korean_clean", "", analysis);
    expect(slotPrompt).toContain("Hard crop lock");
    expect(slotPrompt).toContain("no head, no face");
    expect(slotPrompt).toContain("Lower-body three-quarter or side-angle outfit read");
    expect(slotPrompt).toContain("Do not zoom out or pan upward");
    expect(slotPrompt).not.toContain("Expression:");
    expect(slotPrompt).not.toContain("Soft slight smile");
  });

  it("uses pose plan lines for grid prompts", () => {
    const posePlan = buildFallbackPosePlan({
      poseStyle: "fashion_editorial",
      poseAnalysis: normalizePoseVisualAnalysis({
        genderExpression: "male",
        ageRange: "adult",
        bodyCrop: "full_body",
        confidence: 0.8,
      }),
    });

    const enforced = enforcePosePromptRequirements("保持图1人物和服装，生成姿势变化。\n姿势1：旧姿势。", {
      poseStyle: "fashion_editorial",
      posePlan,
    });

    expect(enforced).toContain("姿势1：正面服装展示方向");
    expect(enforced).toContain("姿势2：侧身或三分之二侧身展示方向");
    expect(enforced).not.toContain("姿势1：旧姿势。");
  });

  it("uses only the current pose plan slot for separate prompts", () => {
    const posePlan = buildFallbackPosePlan({
      poseStyle: "ecommerce_clean",
      outputMode: "separate",
    });

    const slot3 = buildSeparatePosePrompt("补充要求：衣摆清晰。", 3, "ecommerce_clean", "", null, posePlan);

    expect(slot3).toContain("Target pose:");
    expect(slot3).toContain(posePlan.slots[2].poseName);
    expect(slot3).toContain(posePlan.slots[2].bodyAction);
    expect(slot3).not.toContain(posePlan.slots[0].bodyAction);
    expect(slot3).toContain("补充要求：衣摆清晰。");
  });
});

describe("buildPoseHardRule", () => {
  it("emits preserve_reference_crop segment with crop-lock + grid layout hint", () => {
    const rule = buildPoseHardRule({ poseMode: "preserve_reference_crop", outputMode: "grid" });
    expect(rule).toContain("HARD 硬规则");
    expect(rule).toContain("preserve_reference_crop");
    expect(rule).toContain("严格保持图 1 的画面裁切范围");
    expect(rule).toContain("2x2 四宫格");
  });

  it("emits pose_burst_full_subject segment with single-image layout hint for separate mode", () => {
    const rule = buildPoseHardRule({ poseMode: "pose_burst_full_subject", outputMode: "separate" });
    expect(rule).toContain("HARD 硬规则");
    expect(rule).toContain("pose_burst_full_subject");
    expect(rule).toContain("禁止换脸");
    expect(rule).toContain("3:4 单人完整图");
  });

  it("keeps the rule short and single-branch (no if/then language)", () => {
    const rule = buildPoseHardRule({ poseMode: "pose_burst_full_subject", outputMode: "grid" });
    expect(rule).not.toMatch(/如果/);
    expect(rule).not.toMatch(/如果图/);
    expect(rule.length).toBeLessThan(700);
  });
});

describe("pose prompt end-to-end: hard rule must not break Target pose detection", () => {
  it("buildSeparatePosePrompt output still contains 'Target pose:' when hard rule is appended to fallback", () => {
    const posePlan = buildFallbackPosePlan({
      poseStyle: "ecommerce_clean",
      outputMode: "separate",
    });
    const hardRule = buildPoseHardRule({ poseMode: "pose_burst_full_subject", outputMode: "separate" });
    const fallbackPrompt = [
      enforcePosePromptRequirements("", { poseStyle: "ecommerce_clean", outputMode: "separate", posePlan }),
      hardRule,
    ].filter(Boolean).join("\n");
    const slotPrompt = buildSeparatePosePrompt(fallbackPrompt, 1, "ecommerce_clean", "", null, posePlan);
    expect(slotPrompt).toContain("Target pose:");
  });
});
