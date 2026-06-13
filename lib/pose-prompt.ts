import {
  POSE_SERIES_STYLES,
  buildPoseSeparateStylePresetPrompt,
  getPoseSeriesStylePoseLines,
  type PoseSeriesStyle,
} from "@/lib/module-style-presets";
import {
  buildPoseVisualAnalysisRule,
  decidePoseMode,
  shouldSuppressPoseFacePlanning,
  type PoseVisualAnalysis,
} from "@/lib/pose-analysis";
import {
  buildPosePlanPoseLines,
  buildPoseSlotPlanDirective,
  normalizePosePlan,
  type PosePlan,
} from "@/lib/pose-plan";

export type PoseOutputMode = "grid" | "separate";

export const POSE_QUALITY =
  "photorealistic source-matched fashion photo, faithful source exposure and contrast, neutral source color management, natural facial detail, true-to-source garment rendering, no extra sharpening, no HDR";

const POSE_SEPARATE_QUALITY =
  "Image quality: source-matched natural camera photo; no HDR, no extra sharpening, no moire or wavy fabric artifacts.";

export const POSE_LAYOUT_REQUIREMENT =
  "必须生成单张图片中的 2x2 四宫格 / four-panel pose variation / contact sheet，四个分格分别展示姿势1、姿势2、姿势3、姿势4；不要只生成单人单姿势，不要只生成一张普通照片，不要把四个姿势拆成多张独立图片。";

export const POSE_SEPARATE_LAYOUT_REQUIREMENT =
  "输出方式：当前请求只生成一张 3:4 单人完整图片；不要四宫格、拼图、分屏、边框、编号文字或 contact sheet。";

export const POSE_CONSISTENCY_REQUIREMENT =
  "四个分格必须保持图1同一个人物身份、同一性别表达、同一年龄感、同一身体骨架、同一张脸、同一脸型骨相、同一自然肤色、同一发型、同一身体比例、同一套服装、同一面料纹理、同一颜色图案、同一背景场景、同一光线、同一色调和同一摄影质量。";

export const POSE_SOURCE_ROLE_REQUIREMENT =
  "图1角色：唯一的人物、性别表达、年龄感、身体骨架、服装、比例、场景和光线参考；文字只改变姿势、可选镜头和构图。";

export const POSE_CAMERA_REQUIREMENT =
  "镜头构图规则：四个分格保持同一商业摄影风格、真实透视和稳定人物比例，但不要机械复制图1画幅或固定同一相机距离；可按姿势在全身、近全身、七分身或偏半身商业构图之间自然变化，关键服装结构必须清楚。避免 extreme close-up、无关特写、大广角、俯拍、仰拍或夸张透视。";

export const POSE_PROPORTION_LOCK_RULE =
  "比例锁定：保持图1头身比、头部大小、肩宽、腰胯、四肢长度、脚部大小、腰线和服装穿着尺度；不要拉高拉瘦、长腿化或变体型。";

export const POSE_GENDER_IDENTITY_LOCK_RULE =
  "性别身份锁定：必须保持图1人物的性别表达、年龄感、身体骨架、肩宽、胸腰胯比例、肌肉/脂肪分布、发型气质和整体身份气质；如果图1是男性，最终必须仍是同一个男性人物，不要把男性变成女性、不要女性化、不要变成女模、不要生成女性胸型、女性腰胯比例、女性妆容、女性发型或女性化站姿；如果图1是女性，也不要男性化或改变原本性别气质。";

export const POSE_SERIES_RULE =
  "时装大片连贯性规则：四个分格必须像同一套商业时装大片的连续 pose sheet，而不是四张不同照片拼贴；保持统一构图、统一背景、统一光线、统一肤色质感、统一色彩管理和统一服装展示尺度。";

export const POSE_CLOTHING_RULE =
  "服装展示规则：四个姿势都要清楚展示同一套服装的版型、腰线、肩线、袖长、下摆、面料垂坠、纹理和图案；允许动作造成自然褶皱、遮挡和张力变化，但绝不能改变服装结构、颜色、图案、长度、开口位置或搭配关系。";

export const POSE_GARMENT_PRODUCT_FIDELITY_RULE =
  "服装产品保真规则：把图1服装当作受保护的商品资产；锁定版型、固有色、图案/logo、面料表面和清洁度。姿势变化只改变人体动作、受力褶皱、垂坠和真实阴影，不重新设计布料、不套风格滤镜。";

export const POSE_SOURCE_TONE_LOCK_RULE =
  "原图影调保真规则：保持图1原始曝光、对比度、白平衡、色温、肤色明暗、阴影/高光层次、颗粒/噪点和相机质感；姿势变化只做必要局部融合，不要整体重调色、HDR、提高 clarity、提高局部反差、额外锐化、超分纹理或商业精修滤镜。";

export const POSE_FINE_TEXTURE_SAFETY_RULE =
  "细密纹理安全规则：细条纹、罗纹、针织、裤纹、网纱、格纹、logo/文字和重复图案只按图1可见尺度自然保留；不要增强成摩尔纹、波纹、水波纹、频闪条纹、振荡线、假纤维或不存在的面料纹理。";

export const POSE_BODY_RULE =
  "身体动作规则：动作变化要自然、可信、符合真人关节运动，保留图1或自然商业模特的真实头身比例、肩宽、腰胯比例、四肢长度和体态；头部、颈部、肩膀和躯干转向必须协调一致，避免头部单独回望、过度扭颈、肩颈错位、夸张扭腰、断手、错位手指、肢体拉长、腿被拉长、头被缩小、身体比例漂移或过度瘦身。";

export const POSE_SKIN_COLOR_RULE =
  "肤色和色彩规则：四个分格必须保留图1人物的自然肤色、肤色明暗、冷暖调、局部红润、阴影层次和真实皮肤质感；保持准确白平衡和真实曝光，不要自动美白、不要雪白皮、不要冷白皮、不要过度提亮肤色，不要把画面统一调成过曝白亮或粉白滤镜。";

export const POSE_FACE_SHAPE_RULE =
  "脸型五官规则：四个分格必须保持图1人物的脸型骨相、脸长宽比例、颧骨、下颌线、下巴形状、眼型、眼距、鼻翼宽度、唇形和真实五官辨识度；不要自动变成标准鹅蛋脸、小V脸、尖下巴、大眼高鼻的网红脸。";

export const POSE_CREATIVE_VARIATION_RULE =
  "姿势：未逐条指定时，由 AI 按风格自由设计自然、不同、适合展示服装的姿势；不要套模板。";

export const POSE_EXPRESSION_VARIATION_REQUIREMENT =
  "表情规则：保持同一个人、同一张脸、同一年龄感，不要换脸；四个姿势必须有轻微自然但可察觉的眼神和表情差异，例如轻松直视、轻微微笑、沉静侧视、自信轻抬下巴等，避免复制粘贴脸或僵硬同脸。不要夸张表情，不要改变五官身份。";

export const POSE_EXPRESSION_CONSISTENT_REQUIREMENT =
  POSE_EXPRESSION_VARIATION_REQUIREMENT;

// 合并后的精简规则：把原本散落的 9 条规则压成 3 条。
// - POSE_GARMENT_FIDELITY_MERGED_RULE: POSE_SERIES_RULE + POSE_CLOTHING_RULE + POSE_GARMENT_PRODUCT_FIDELITY_RULE
// - POSE_PERSON_IDENTITY_MERGED_RULE: POSE_GENDER_IDENTITY_LOCK_RULE + POSE_PROPORTION_LOCK_RULE + POSE_FACE_SHAPE_RULE + POSE_BODY_RULE
// - POSE_SOURCE_TONE_MERGED_RULE: POSE_SOURCE_TONE_LOCK_RULE + POSE_FINE_TEXTURE_SAFETY_RULE + POSE_SKIN_COLOR_RULE

export const POSE_GARMENT_FIDELITY_MERGED_RULE =
  "服装保真规则：原图服装的款式、版型、固有色、图案、logo、文字、面料表面、领口、袖口、下摆、纽扣、拉链、口袋、缝线必须保持不变；姿势变化只允许自然褶皱、垂坠、张力、接触阴影的变化，不能重新设计布料、不能换服装、不能套滤镜。";

export const POSE_PERSON_IDENTITY_MERGED_RULE =
  "人物身份规则：原图人物的性别表达、年龄感、脸型骨相、脸长宽比例、颧骨下颌下巴、眼型眼距、鼻翼唇形、五官辨识度、肤色冷暖、皮肤质感、头身比、肩宽腰胯、四肢长度、身体骨架必须保持不变；不能拉高拉瘦、不能变体型、不能磨皮、不能变成网红脸、不能更换身份。";

export const POSE_SOURCE_TONE_MERGED_RULE =
  "原图色调规则：保持原图的曝光、对比度、白平衡、色温、肤色明暗、阴影层次、颗粒噪点和相机质感；细条纹、罗纹、针织、裤纹、网纱、格纹、重复图案按原图可见尺度自然保留，不要强化成摩尔纹/波纹/频闪条纹/假纤维；不要整体重调色、HDR、提高 clarity、额外锐化、超分纹理或商业精修滤镜。";

const POSE_SINGLE_IMAGE_CONSISTENCY_REQUIREMENT =
  "当前单张图片以图1作为人物身份、性别表达、年龄感、身体骨架、服装、背景和光线参考；优先让姿势明显变化，同时保持同一套服装设计、颜色、图案、面料质感、自然脸部身份、肤色和真实身体比例。";

const POSE_HEADLESS_SINGLE_IMAGE_CONSISTENCY_REQUIREMENT =
  "当前单张图片以图1可见身体范围、性别表达、身体骨架、服装、背景和光线参考；优先让姿势在原图可见范围内明显变化，同时保持同一套服装设计、颜色、图案、面料质感、肤色和真实身体比例。图1没有可用脸部目标时，不要补头、补脸或扩成完整人像。";

const POSE_SINGLE_IMAGE_CAMERA_REQUIREMENT =
  "当前单张图片允许相机距离、身体角度、景别和画面留白随目标姿势自然调整；不要因为图1是全身就固定生成全身照，可按服装展示需要选择全身、近全身、七分身或偏半身商业构图。避免 extreme close-up、无关特写、wide angle、大广角、俯拍、仰拍或夸张透视。";

const POSE_HEADLESS_SINGLE_IMAGE_CAMERA_REQUIREMENT =
  "当前单张图片必须保持图1同类无头裁切和可见身体范围；相机距离、身体角度、景别和画面留白只在原图可见范围内自然调整。不要扩成完整人像，不要补出头、脸、脖子、肩部或原图外身体部位。";

const POSE_SINGLE_EXPRESSION_VARIATION_REQUIREMENT =
  "表情规则：保持图1同一个人、同一张脸和同一年龄感；当前姿势必须匹配动作产生轻微自然但可察觉的眼神或表情变化，不要照搬图1原表情。不要夸张表情，不要改变五官身份，不要复制成僵硬表情。";

const POSE_SINGLE_EXPRESSION_CONSISTENT_REQUIREMENT =
  POSE_SINGLE_EXPRESSION_VARIATION_REQUIREMENT;

const POSE_SEPARATE_BASE_PROMPT = [
  "Use the source image only to preserve: same person, same gender expression, face, hair, body proportions, outfit, fabric/color/pattern, background, lighting and skin tone.",
  "Do not copy the source pose; execute the target pose clearly.",
  "Generate one standalone source-matched pose variation photo, not a beautified or regraded fashion editorial.",
  POSE_SEPARATE_QUALITY,
  "Keep head/neck/shoulders/torso aligned; preserve face identity and adapt gaze/expression.",
  "Keep the outfit readable: neckline, shoulder line, sleeves, waistline, hem, lower garment and shoes if visible.",
  "Product fidelity: outfit is protected; keep source color, pattern/logo and textile surface; folds/shadows only; no retexturing or style filter.",
  "Source tone lock: keep source exposure/contrast/white balance/grain; no recolor, HDR, clarity/local-contrast boost, extra sharpening or retouch filter.",
  "Fine textile safety: keep repeated patterns at source scale; no moire, wavy/ripple/vibrating fabric lines, fake fibers or invented detail.",
  "Negative:",
  "no outfit/face/gender change, no feminized body, no garment retexturing, no color/contrast shift, no heavy filter, no extra sharpening, no moire, no extra person, text/watermark/grid/collage, distorted hands/limbs, twisted neck, disconnected head or unrealistic body.",
].join("\n");

const POSE_HEADLESS_SEPARATE_BASE_PROMPT = [
  "Use the source image only to preserve: same visible body range, same gender expression, body proportions, outfit, fabric/color/pattern, background, lighting and visible skin tone.",
  "Do not copy the source pose; execute the target pose clearly within the original visible crop.",
  "Generate one standalone source-matched pose variation photo, not a beautified or regraded fashion editorial.",
  POSE_SEPARATE_QUALITY,
  "Hard crop lock: if the source image has no visible head or face, keep the result headless and faceless. Do not invent a head, face, neck, shoulders, portrait, gaze or expression.",
  "Keep the outfit readable inside the visible body area: waistline, hips, legs, hem, lower garment, shoes and visible accessories if present.",
  "Product fidelity: outfit is protected; keep source color, pattern/logo and textile surface; folds/shadows only; no retexturing or style filter.",
  "Source tone lock: keep source exposure/contrast/white balance/grain; no recolor, HDR, clarity/local-contrast boost, extra sharpening or retouch filter.",
  "Fine textile safety: keep repeated patterns at source scale; no moire, wavy/ripple/vibrating fabric lines, fake fibers or invented detail.",
  "Negative:",
  "no head, no face, no portrait expansion, no gaze, no expression, no outfit/gender change, no garment retexturing, no color/contrast shift, no heavy filter, no extra sharpening, no moire, no extra person, text/watermark/grid/collage, distorted limbs, unrealistic body.",
].join("\n");

const DEFAULT_POSE_LINES = [
  "姿势1：正面服装展示方向；AI 可自由选择自然手势、重心、视线、轻松直视或淡定表情和镜头语言，服装正面轮廓必须清楚。",
  "姿势2：侧身或三分之二侧身展示方向；AI 可自由选择头发/衣领/袖口/衣摆手势、腿部节奏、微笑或侧向视线和镜头语言，侧面轮廓和肩线必须清楚。",
  "姿势3：站定造型方向，不要走路；AI 可自由选择扶腰、胯部、肩线、手部造型、自信眼神或轻微抬下巴和镜头语言，腰线、廓形和面料垂坠必须清楚。",
  "姿势4：轻微迈步或自然转身方向，不要静态扶腰；头部方向与肩膀、躯干和身体转向保持一致，不要单独回头看镜头；AI 可自由选择步态、手臂运动、身体转向、更有呼吸感的自然表情和镜头语言，服装运动褶皱和垂坠必须清楚。",
];

const NEGATIVE_POSE_REQUIREMENT =
  "负面约束：不要换脸，不要换衣服，不要改变性别表达，不要把男性变成女性，不要女性化男性身体骨架或妆发，不要改变场景，不要改变服装结构，不要重绘服装材质或改变服装固有色，不要改变原图曝光/对比度/白平衡，不要额外锐化，不要摩尔纹、波纹、水波纹、频闪条纹、振荡线或假纤维，不要生成多余人物，不要扭曲手指和肢体，不要身体比例漂移，不要自动美白，不要雪白皮或冷白皮，不要标准鹅蛋脸或小V脸，不要塑料皮肤，不要AI渲染感，不要文字水印。";

export function enforcePosePromptRequirements(
  prompt: string,
  options: { poseStyle?: PoseSeriesStyle; outputMode?: PoseOutputMode; poseAnalysis?: PoseVisualAnalysis | null; posePlan?: PosePlan | null } = {}
) {
  if (!prompt.trim()) return "";
  const suppressFacePlanning = shouldSuppressPoseFacePlanning(options.poseAnalysis);

  let nextPrompt = prompt
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!/图1/.test(nextPrompt)) {
    nextPrompt = `保持图1的人物身份、服装、场景、光影一致。${nextPrompt}`;
  }

  if (!/图1角色|图像角色硬规则/.test(nextPrompt)) {
    nextPrompt = `${POSE_SOURCE_ROLE_REQUIREMENT}\n${nextPrompt}`;
  }

  const analysisRule = buildPoseVisualAnalysisRule(options.poseAnalysis, options.outputMode);
  if (analysisRule && !nextPrompt.includes("视觉识别约束")) {
    nextPrompt = `${analysisRule}\n${nextPrompt}`;
  }

  const activePosePlan = options.posePlan
    ? normalizePosePlan(options.posePlan, {
        poseAnalysis: options.poseAnalysis,
        poseStyle: options.poseStyle,
        outputMode: options.outputMode,
        prompt,
      })
    : null;

  if (options.outputMode === "separate") {
    nextPrompt = normalizeSeparatePromptScope(removeGridLayoutWording(nextPrompt));
    if (!/当前请求只生成一张|不要四宫格|不要生成四宫格/.test(nextPrompt)) {
      nextPrompt = `${POSE_SEPARATE_LAYOUT_REQUIREMENT}\n${nextPrompt}`;
    }
  } else if (!/(四宫格|2x2|four-panel|4-panel|contact sheet)/i.test(nextPrompt)) {
    nextPrompt = `${POSE_LAYOUT_REQUIREMENT}\n${nextPrompt}`;
  }

  if (!/same face identity|同一张脸|人物身份/.test(nextPrompt)) {
    const consistencyRule = suppressFacePlanning
      ? POSE_HEADLESS_SINGLE_IMAGE_CONSISTENCY_REQUIREMENT
      : options.outputMode === "separate"
        ? POSE_SINGLE_IMAGE_CONSISTENCY_REQUIREMENT
        : POSE_CONSISTENCY_REQUIREMENT;
    nextPrompt = `${consistencyRule}\n${nextPrompt}`;
  }

  const requiredRules = [
    ["服装保真规则", POSE_GARMENT_FIDELITY_MERGED_RULE],
    ["人物身份规则", POSE_PERSON_IDENTITY_MERGED_RULE],
    ["原图色调规则", POSE_SOURCE_TONE_MERGED_RULE],
  ] as const;
  requiredRules.forEach(([marker, rule]) => {
    if (suppressFacePlanning && marker === "人物身份规则") return;
    if (!nextPrompt.includes(marker)) {
      const nextRule = options.outputMode === "separate" ? toSinglePoseRule(rule) : rule;
      nextPrompt = `${nextPrompt}\n${nextRule}`;
    }
  });

  nextPrompt = nextPrompt
    .split("\n")
    .filter((line) => !/表情控制|表情：|表情-|expression variation|facial expression/i.test(line))
    .join("\n")
    .trim();
  if (suppressFacePlanning) {
    nextPrompt = `${nextPrompt}\n无脸裁切规则：图1没有可用脸部目标，当前姿势只规划原图可见身体范围、服装和构图变化；不要规划或生成表情、视线、回眸、看镜头、头发、头部、脸部或完整人像。`;
  } else {
    const expressionRule = options.outputMode === "separate"
      ? POSE_SINGLE_EXPRESSION_VARIATION_REQUIREMENT
      : POSE_EXPRESSION_VARIATION_REQUIREMENT;
    nextPrompt = `${nextPrompt}\n${expressionRule}`;
  }

  if (!/consistent .*medium full-body framing|consistent medium full-body framing/i.test(nextPrompt)) {
    const cameraRule = suppressFacePlanning
      ? POSE_HEADLESS_SINGLE_IMAGE_CAMERA_REQUIREMENT
      : options.outputMode === "separate"
        ? POSE_SINGLE_IMAGE_CAMERA_REQUIREMENT
        : POSE_CAMERA_REQUIREMENT;
    nextPrompt = `${nextPrompt}\n${cameraRule}`;
  }

  if (activePosePlan) {
    nextPrompt = removePosePlanLines(nextPrompt);
  }
  const poseLines = getPoseSeriesStylePoseLines(options.poseStyle);
  const requiredPoseLines = activePosePlan
    ? buildPosePlanPoseLines(activePosePlan)
    : options.poseStyle === "user_custom" ? [] : poseLines.length ? poseLines : DEFAULT_POSE_LINES;
  requiredPoseLines.forEach((line, index) => {
    const poseNumber = index + 1;
    if (!new RegExp(`^\\s*姿势\\s*${poseNumber}[：:]`, "m").test(nextPrompt)) {
      nextPrompt = `${nextPrompt}\n${line}`;
    }
  });

  if (!/负面约束/.test(nextPrompt)) {
    nextPrompt = `${nextPrompt}\n${NEGATIVE_POSE_REQUIREMENT}`;
  }

  const missingQuality = POSE_QUALITY
    .split(", ")
    .filter((dimension) => !nextPrompt.includes(dimension));
  if (missingQuality.length) {
    nextPrompt = `${nextPrompt}\n${POSE_QUALITY}`;
  }

  return nextPrompt;
}

export function buildSeparatePoseSlotDirective(poseIndex: number, poseStyle?: PoseSeriesStyle) {
  const safeIndex = Math.min(Math.max(Math.floor(Number(poseIndex) || 1), 1), 4);
  const directives = getSeparatePoseSlotDirectives(poseStyle);
  return directives[safeIndex - 1];
}

export function buildSeparatePosePrompt(
  prompt: string,
  poseIndex: number,
  poseStyleOverride?: PoseSeriesStyle,
  styleSourcePrompt = prompt,
  poseAnalysis?: PoseVisualAnalysis | null,
  posePlan?: PosePlan | null
) {
  const explicitPosePattern = new RegExp(`^\\s*姿势\\s*${poseIndex}[：:]`, "m");
  const poseStyle = poseStyleOverride || inferPoseStyleFromPrompt(prompt);
  const explicitPoseLines = extractExplicitPoseLines(prompt);
  const currentPoseLine = explicitPoseLines.find((line) => explicitPosePattern.test(line));
  const normalizedPosePlan = posePlan
    ? normalizePosePlan(posePlan, { poseAnalysis, poseStyle, outputMode: "separate", prompt })
    : null;
  const planSlotDirective = normalizedPosePlan
    ? buildPoseSlotPlanDirective(normalizedPosePlan.slots[Math.min(Math.max(poseIndex, 1), 4) - 1])
    : "";
  const slotDirective = planSlotDirective || buildSeparatePoseSlotDirective(poseIndex, poseStyle);
  const targetPose = planSlotDirective
    ? planSlotDirective
    : currentPoseLine && poseStyle === "user_custom"
    ? buildCustomSeparatePoseSlotPrompt(sanitizeSeparatePoseLine(currentPoseLine))
    : slotDirective;
  const stylePrompt = compactSeparateStylePrompt(buildPoseSeparateStylePresetPrompt(
    poseStyle,
    extractCustomSeparateStyleDirection(styleSourcePrompt)
  ));
  const supplementLines = extractSeparatePoseSupplementLines(prompt);
  const analysisRule = buildPoseVisualAnalysisRule(poseAnalysis, "separate");
  const suppressFacePlanning = shouldSuppressPoseFacePlanning(poseAnalysis);

  return [
    suppressFacePlanning ? POSE_HEADLESS_SEPARATE_BASE_PROMPT : POSE_SEPARATE_BASE_PROMPT,
    analysisRule,
    stylePrompt,
    suppressFacePlanning && !planSlotDirective ? buildHeadlessSeparatePoseSlotPrompt(poseIndex, targetPose) : targetPose,
    ...supplementLines,
  ].filter(Boolean).join("\n");
}

function compactSeparateStylePrompt(prompt: string) {
  const lines = prompt
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return "";

  if (lines[1] === "Custom user style.") {
    const customIndex = lines.findIndex((line) => line === "Follow the user's custom style direction:");
    const customLine = customIndex >= 0 ? lines[customIndex + 1] : "";
    return [
      "Style preset:",
      "Custom user style.",
      customLine ? `Follow custom style: ${customLine}` : "Follow the user's custom pose, camera and style notes.",
      "Keep same person/outfit and readable clothing; avoid outfit change, face change, distorted limbs or excessive retouching.",
    ].join("\n");
  }

  const positive = lines.find((line) => /Use |Keep |Prioritize|Create|The result|The mood|The image/i.test(line) && !/^Avoid/i.test(line));
  const negative = lines.find((line) => /^Avoid/i.test(line));
  return [
    lines[0],
    lines[1],
    positive,
    negative,
  ].filter(Boolean).join("\n");
}

function extractSeparatePoseSupplementLines(prompt: string) {
  return prompt
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^补充要求[：:]/.test(line))
    .map((line) => line.length > 360 ? `${line.slice(0, 360)}...` : line);
}

function extractCustomSeparateStyleDirection(prompt: string) {
  return prompt
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^姿势\s*[1-4][：:]/.test(line))
    .filter((line) => !/^补充要求[：:]/.test(line))
    .filter((line) => !line.includes("姿势裂变拍摄风格档位"))
    .join("\n")
    .trim()
    .slice(0, 600);
}

function extractExplicitPoseLines(prompt: string) {
  return prompt
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^姿势\s*[1-4][：:]/.test(line));
}

function removePosePlanLines(prompt: string) {
  return prompt
    .split("\n")
    .filter((line) => !/^\s*姿势\s*[1-4][：:]/.test(line.trim()))
    .join("\n")
    .trim();
}

function buildCustomSeparatePoseSlotPrompt(targetPose: string) {
  return [
    "Target pose:",
    targetPose,
    "",
    "Camera:",
    "AI may choose source-matched framing, crop, distance, composition and negative space for this target pose.",
    "Keep head, body and important clothing details readable.",
  ].join("\n");
}

function buildHeadlessSeparatePoseSlotPrompt(poseIndex: number, fallbackTargetPose: string) {
  const safeIndex = Math.min(Math.max(Math.floor(Number(poseIndex) || 1), 1), 4);
  const lowerBodyTargets = [
    "Lower-body front outfit read. Keep waist, hips, legs, hem and shoes readable inside the same headless crop.",
    "Lower-body three-quarter or side-angle outfit read. Show side seam, fabric thickness, leg line and hem profile without expanding upward.",
    "Stationary lower-body weight-shift pose. One knee or hip may relax naturally while waistline and garment structure remain clear.",
    "Small lower-body step or aligned turn. Show natural fabric movement around hem, knees, pant legs or skirt edge without adding a portrait.",
  ];
  return [
    "Target pose:",
    lowerBodyTargets[safeIndex - 1] || lowerBodyTargets[0],
    "Do not use any target pose instruction that requires gaze, expression, head direction, hair movement, portrait framing, or looking at camera.",
    fallbackTargetPose ? `Original slot intent, body-only interpretation: ${stripHeadlessUnsafeText(fallbackTargetPose)}` : "",
    "",
    "Camera:",
    "Keep the source headless lower-body/local-body crop. Do not zoom out or pan upward to reveal head, face, neck or a full portrait.",
  ].filter(Boolean).join("\n");
}

function sanitizeSeparatePoseLine(line: string) {
  return line
    .replace(/镜头[：:].*$/i, "")
    .replace(/consistent medium full-body framing/gi, "medium full-body fashion photo")
    .replace(/same camera distance|same lens style|统一构图|统一镜头语言|同一相机距离|同一焦段|同一画幅留白/gi, "")
    .trim();
}

function stripHeadlessUnsafeText(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/(Expression|gaze|face|head|hair|portrait|look(?:ing)? at camera|表情|视线|眼神|脸|头|头发|回眸|看镜头|完整人像)/i.test(line))
    .join("\n")
    .slice(0, 420);
}

function inferPoseStyleFromPrompt(prompt: string): PoseSeriesStyle | undefined {
  const markerMatch = prompt.match(/姿势裂变拍摄风格档位：([^。\n]+)/);
  if (!markerMatch) return undefined;
  const label = markerMatch[1].trim();
  return POSE_SERIES_STYLES.find((style) => label.includes(style.label))?.value;
}

function getSeparatePoseSlotDirectives(poseStyle?: PoseSeriesStyle) {
  const defaultDirectives = [
    [
      "Target pose:",
      "Relaxed front-view outfit read.",
      "Keep the front silhouette clear.",
      "Do not reuse the exact original stance.",
      "Change at least two details from the source pose: hand placement, weight shift, gaze direction, torso angle or expression.",
      "",
      "Camera:",
      "Source-matched full-body product-readable framing.",
      "Balanced centered composition.",
      "Keep the full outfit clearly readable.",
      "",
      "Expression:",
      "Calm natural expression, relaxed eyes, soft direct gaze.",
    ].join("\n"),
    [
      "Target pose:",
      "Strong three-quarter or side-angle outfit read.",
      "The body must clearly read as side or three-quarter view, not front-facing.",
      "Show side silhouette, shoulder line, sleeve shape, waist thickness, fabric drape and hem profile.",
      "",
      "Camera:",
      "Full-body or 7/8-body source-matched three-quarter framing.",
      "",
      "Expression:",
      "Soft slight smile, gaze slightly away from camera.",
    ].join("\n"),
    [
      "Target pose:",
      "Stationary confident shape pose.",
      "Emphasize natural body structure, shoulder line, waist/hip balance and source garment readability.",
      "Feet stay planted.",
      "One hand may rest on waist, touch the outfit edge, adjust sleeve or hold a natural styling gesture.",
      "Not walking.",
      "Not strong side-angle.",
      "",
      "Camera:",
      "Full-body or 7/8-body source-matched outfit framing.",
      "Slightly closer than Slot 1.",
      "Focus on waistline, body proportion and upper outfit structure.",
      "Do not crop important outfit parts.",
      "",
      "Expression:",
      "Confident natural gaze, relaxed lips, subtle chin lift.",
    ].join("\n"),
    [
      "Target pose:",
      "Light movement or natural aligned turning pose.",
      "Use a small step, gentle side or three-quarter body turn, or soft side-back rotation.",
      "The head, neck, shoulders and torso must face the same natural direction.",
      "The gaze should follow the body direction or look slightly side-forward.",
      "Do not create an over-shoulder look, independent head turn, twisted neck or disconnected shoulder line.",
      "Do not create a large walking stride or exaggerated motion.",
      "Keep the movement elegant, controlled and aligned with the source person's gender expression.",
      "Show a slight sense of motion through body turn, soft arm movement, and natural fabric drape.",
      "The outfit must remain clearly readable with source-matched color and texture.",
      "",
      "Camera:",
      "Elegant full-body or 7/8-body movement framing.",
      "Allow slight directional negative space.",
      "Keep the body visually stable and balanced.",
      "Avoid aggressive action framing, extreme stride, strong street-style walking energy, excessive motion blur or extreme crop.",
      "",
      "Expression:",
      "Soft candid expression with gaze aligned to the body direction.",
      "Natural, relaxed, slightly lively, but not exaggerated.",
    ].join("\n"),
  ];

  void poseStyle;
  return defaultDirectives;
}

function removeGridLayoutWording(prompt: string) {
  return prompt
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      if (/不要生成四宫格|不要生成.*拼图|不要生成.*contact sheet/i.test(line)) return true;
      return !/(四宫格|2x2|four-panel|4-panel|contact sheet|分格|分屏|拼图|pose sheet)/i.test(line);
    })
    .join("\n")
    .trim();
}

function normalizeSeparatePromptScope(prompt: string) {
  return prompt
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      if (/^姿势\s*[1-4][：:]/.test(line)) return true;
      return !/(单图裂变规则|单张生产线分镜|本组四张|生产线四槽计划|用户自定义四槽计划|全组差异校验|其它槽位|其他槽位|同组四张|四张独立图|四张独立图片)/.test(line);
    })
    .map((line) => /^姿势\s*[1-4][：:]/.test(line) ? line : toSinglePoseRule(line))
    .map(removeSeparateCameraLockWording)
    .join("\n")
    .trim();
}

function removeSeparateCameraLockWording(line: string) {
  return line
    .replace(/镜头[：:].*?(consistent medium full-body framing|same camera distance|same lens style).*$/i, "镜头：medium full-body fashion photo, eye-level camera")
    .replace(/same camera distance|same lens style|consistent framing/gi, "")
    .replace(/统一构图、?/g, "")
    .replace(/统一镜头语言、?/g, "")
    .replace(/同一相机距离、?/g, "")
    .replace(/同一焦段、?/g, "")
    .replace(/同一画幅留白、?/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function toSinglePoseRule(rule: string) {
  return rule
    .replace(/同组四张独立图片都必须/g, "当前单张图片必须")
    .replace(/同组四张独立图片/g, "当前单张图片")
    .replace(/四张独立图中的姿势/g, "当前姿势")
    .replace(/四张独立图片/g, "当前单张图片")
    .replace(/四张独立图/g, "当前单张图片")
    .replace(/四个分格必须/g, "当前单张图片必须")
    .replace(/四个分格/g, "当前单张图片")
    .replace(/四个姿势都要/g, "当前单张图片必须")
    .replace(/四个姿势/g, "当前姿势")
    .replace(/四格/g, "当前单张图片")
    .replace(/每格/g, "当前单张图片")
    .replace(/同一套商业时装大片的连续 pose sheet，而不是四张不同照片拼贴/g, "图1延展出来的同一套商业时装大片画面")
    .replace(/同一套商业时装大片的连续姿势系列，而不是四张风格割裂的照片/g, "图1延展出来的同一套商业时装大片画面")
    .replace(/同组独立图/g, "当前单张图片")
    .replace(/四宫格/g, "单图");
}

// ---- Hard rule (must lead every pose prompt) ----
// Single source of truth for which identity-preservation rules apply.
// Output is short, single-branch, bilingual so both image-generation models
// and visual analyzers stay aligned.
//
// We deliberately keep this small (~250 chars) so it can be prepended to
// every pose prompt without bloating token budget.
export function buildPoseHardRule(params: {
  poseMode: "preserve_reference_crop" | "pose_burst_full_subject";
  outputMode: "grid" | "separate";
}): string {
  const { poseMode, outputMode } = params;
  const layoutHint = outputMode === "grid"
    ? "必须生成 2x2 四宫格，四个分格分别展示姿势 1/2/3/4；不要拆成多张独立图，不要只生成单人单姿势。"
    : "当前请求只生成一张 3:4 单人完整图；不要四宫格、不要拼图、不要分屏、不要边框、不要编号文字、不要 contact sheet。";
  if (poseMode === "preserve_reference_crop") {
    return [
      "【HARD 硬规则 · 姿势身份模式 preserve_reference_crop】",
      "1) 严格保持图 1 的画面裁切范围：头/脸/上半身/下半身各自落在哪一档就只动哪一档；不要扩展到原本没出现的人体部位。",
      "2) 仅改变姿势/构图：人物身份、性别表达、年龄感、身材骨架、肤色、发型、服装款式/颜色/纹理、背景、光线、色调必须与图 1 完全一致。",
      "3) 禁止生成新的人物、禁止换脸、禁止改服装、禁止改背景。",
      layoutHint,
    ].join("\n");
  }
  return [
    "【HARD 硬规则 · 姿势身份模式 pose_burst_full_subject】",
    "1) 仅改变姿势：人物身份、性别表达、年龄感、身材骨架、脸型骨相、肤色、发型必须与图 1 严格一致；禁止换脸、禁止合成新脸、禁止改体型。",
    "2) 服装与配件：款式、颜色、面料纹理、印花、logo、口袋、纽扣等细节与图 1 完全一致；禁止改款、禁止改色、禁止加 logo 或去除 logo。",
    "3) 场景与光线：背景、光线、色温、相机风格必须与图 1 保持同一套商业时装大片感觉；不要换背景、不要加 HDR、不要磨皮。",
    layoutHint,
  ].join("\n");
}

// Re-export so callers don't need to import the analysis file twice.
export { decidePoseMode };

