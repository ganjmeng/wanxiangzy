export type PoseVisualGenderExpression = "male" | "female" | "androgynous" | "unknown";
export type PoseVisualAgeRange = "child" | "teen" | "adult" | "unknown";
export type PoseVisualBodyCrop =
  | "full_body"
  | "three_quarter"
  | "upper_body"
  | "lower_body"
  | "closeup"
  | "partial_unknown";

export type PoseVisualAnalysis = {
  personVisible: boolean;
  personCount: number;
  genderExpression: PoseVisualGenderExpression;
  ageRange: PoseVisualAgeRange;
  bodyCrop: PoseVisualBodyCrop;
  headVisible?: boolean | null;
  faceVisible?: boolean | null;
  upperTorsoVisible?: boolean | null;
  lowerBodyVisible?: boolean | null;
  bodyOrientation: string;
  headDirection: string;
  poseBaseline: string;
  cameraFraming: string;
  cameraAngle: string;
  outfitDescription: string;
  hairDescription: string;
  faceIdentityNotes: string;
  skinToneNotes: string;
  background: string;
  lighting: string;
  handsVisible: boolean;
  feetVisible: boolean;
  occlusionNotes: string;
  generationRisks: string[];
  promptNotes: string;
  confidence: number;
};

export type PoseVisualAnalysisDetailItem = {
  label: string;
  value: string;
  title?: string;
};

export const POSE_VISUAL_ANALYSIS_VERSION = "pose-visual-analysis-v2";

export const POSE_VISUAL_GENDER_LABELS: Record<PoseVisualGenderExpression, string> = {
  male: "男",
  female: "女",
  androgynous: "中性",
  unknown: "性别未知",
};

export const POSE_VISUAL_AGE_LABELS: Record<PoseVisualAgeRange, string> = {
  child: "儿童",
  teen: "青少年",
  adult: "成人",
  unknown: "年龄未知",
};

export const POSE_VISUAL_BODY_CROP_LABELS: Record<PoseVisualBodyCrop, string> = {
  full_body: "全身",
  three_quarter: "七分身",
  upper_body: "上半身",
  lower_body: "下半身",
  closeup: "局部特写",
  partial_unknown: "构图未知",
};

export function normalizePoseVisualAnalysis(input: unknown): PoseVisualAnalysis | null {
  const record = toRecord(input);
  if (!record) return null;
  const personVisible = readBoolean(record, "personVisible", "person_visible") ?? true;
  const confidence = normalizeConfidence(record.confidence, personVisible ? 0.5 : 0.35);

  return {
    personVisible,
    personCount: normalizePersonCount(record.personCount ?? record.person_count),
    genderExpression: normalizeGenderExpression(readString(record, "genderExpression", "gender_expression", "gender")),
    ageRange: normalizeAgeRange(readString(record, "ageRange", "age_range", "age")),
    bodyCrop: normalizeBodyCrop(readString(record, "bodyCrop", "body_crop", "crop")),
    headVisible: readBoolean(record, "headVisible", "head_visible", "head"),
    faceVisible: readBoolean(record, "faceVisible", "face_visible", "face"),
    upperTorsoVisible: readBoolean(record, "upperTorsoVisible", "upper_torso_visible", "upperBodyVisible", "upper_body_visible"),
    lowerBodyVisible: readBoolean(record, "lowerBodyVisible", "lower_body_visible", "legsVisible", "legs_visible"),
    bodyOrientation: clampText(readString(record, "bodyOrientation", "body_orientation")),
    headDirection: clampText(readString(record, "headDirection", "head_direction")),
    poseBaseline: clampText(readString(record, "poseBaseline", "pose_baseline", "pose")),
    cameraFraming: clampText(readString(record, "cameraFraming", "camera_framing", "framing")),
    cameraAngle: clampText(readString(record, "cameraAngle", "camera_angle")),
    outfitDescription: clampText(readString(record, "outfitDescription", "outfit_description", "outfit"), 220),
    hairDescription: clampText(readString(record, "hairDescription", "hair_description", "hair")),
    faceIdentityNotes: clampText(readString(record, "faceIdentityNotes", "face_identity_notes", "face"), 220),
    skinToneNotes: clampText(readString(record, "skinToneNotes", "skin_tone_notes", "skin")),
    background: clampText(readString(record, "background", "scene")),
    lighting: clampText(readString(record, "lighting", "light")),
    handsVisible: readBoolean(record, "handsVisible", "hands_visible") ?? false,
    feetVisible: readBoolean(record, "feetVisible", "feet_visible") ?? false,
    occlusionNotes: clampText(readString(record, "occlusionNotes", "occlusion_notes", "occlusion")),
    generationRisks: normalizeStringArray(record.generationRisks ?? record.generation_risks ?? record.risks, 5, 90),
    promptNotes: clampText(readString(record, "promptNotes", "prompt_notes"), 240),
    confidence,
  };
}

export function normalizeConfidence(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clamp(value > 1 ? value / 100 : value, 0, 1);
  }
  if (typeof value !== "string") return clamp(fallback, 0, 1);

  const normalized = value.trim().toLowerCase();
  if (!normalized) return clamp(fallback, 0, 1);

  const numeric = Number(normalized.replace(/%$/, ""));
  if (Number.isFinite(numeric)) {
    return clamp(numeric > 1 ? numeric / 100 : numeric, 0, 1);
  }

  if (/very\s*low|low|weak|uncertain|not\s+confident|低|较低|不确定/.test(normalized)) return 0.38;
  if (/medium|moderate|normal|中|一般|中等/.test(normalized)) return 0.62;
  if (/very\s*high|high|strong|confident|高|很高|高置信/.test(normalized)) return 0.86;
  return clamp(fallback, 0, 1);
}

export function fallbackPoseVisualAnalysis(): PoseVisualAnalysis {
  return {
    personVisible: true,
    personCount: 1,
    genderExpression: "unknown",
    ageRange: "unknown",
    bodyCrop: "partial_unknown",
    headVisible: null,
    faceVisible: null,
    upperTorsoVisible: null,
    lowerBodyVisible: null,
    bodyOrientation: "",
    headDirection: "",
    poseBaseline: "",
    cameraFraming: "",
    cameraAngle: "",
    outfitDescription: "",
    hairDescription: "",
    faceIdentityNotes: "",
    skinToneNotes: "",
    background: "",
    lighting: "",
    handsVisible: false,
    feetVisible: false,
    occlusionNotes: "",
    generationRisks: ["visual analysis unavailable"],
    promptNotes: "Use the source image conservatively: preserve the visible person, outfit, crop, camera distance, background, lighting, gender expression and body proportions.",
    confidence: 0.35,
  };
}

export function buildPoseVisualAnalysisKey(mainImageUrl: string, version = POSE_VISUAL_ANALYSIS_VERSION) {
  return JSON.stringify({
    version,
    mainImageUrl: normalizeAnalysisUrl(mainImageUrl),
  });
}

export function getPoseVisualAnalysisSummary(analysis: PoseVisualAnalysis | null | undefined) {
  if (!analysis) return "";
  const parts = [
    POSE_VISUAL_AGE_LABELS[analysis.ageRange],
    POSE_VISUAL_GENDER_LABELS[analysis.genderExpression],
    POSE_VISUAL_BODY_CROP_LABELS[analysis.bodyCrop],
  ].filter((part) => part && !part.includes("未知"));

  if (isPoseHeadlessCrop(analysis)) parts.push("无头");
  else if (analysis.faceVisible === true) parts.push("露脸");
  else if (analysis.faceVisible === false) parts.push("脸不可见");
  const orientation = toPoseDisplayPhrase(analysis.bodyOrientation);
  if (orientation) parts.push(orientation);
  if (analysis.handsVisible) parts.push("手可见");
  if (analysis.feetVisible) parts.push("脚可见");

  return parts.length ? parts.slice(0, 5).join(" / ") : "主图已识别";
}

export function getPoseVisualAnalysisDetailItems(analysis: PoseVisualAnalysis | null | undefined): PoseVisualAnalysisDetailItem[] {
  if (!analysis) return [];
  const details: PoseVisualAnalysisDetailItem[] = [];
  const outfit = summarizeOutfitForDisplay(analysis.outfitDescription);
  if (outfit) details.push({ label: "服装", value: outfit, title: analysis.outfitDescription });
  const camera = summarizeCameraForDisplay(analysis.cameraFraming);
  if (camera) details.push({ label: "构图", value: camera, title: analysis.cameraFraming });
  const lighting = summarizeLightingForDisplay(analysis.lighting);
  if (lighting) details.push({ label: "光线", value: lighting, title: analysis.lighting });
  const visibility = summarizeVisibilityForDisplay(analysis);
  if (visibility) details.push({ label: "可见性", value: visibility });
  const risks = analysis.generationRisks
    .slice(0, 2)
    .map((risk) => toPoseDisplayPhrase(risk) || summarizeFactForDisplay(risk))
    .filter(Boolean);
  if (risks.length) details.push({ label: "风险", value: risks.join("、"), title: analysis.generationRisks.join("、") });
  details.push({ label: "置信", value: `${Math.round(analysis.confidence * 100)}%` });
  return details;
}

export function getPoseVisualAnalysisDetailText(analysis: PoseVisualAnalysis | null | undefined) {
  return getPoseVisualAnalysisDetailItems(analysis)
    .map((item) => `${item.label}：${item.value}`)
    .join(" · ");
}

export function buildPoseVisualAnalysisRule(
  analysis: PoseVisualAnalysis | null | undefined,
  outputMode: "grid" | "separate" = "grid"
) {
  if (!analysis) return "";
  const person = [
    `${POSE_VISUAL_AGE_LABELS[analysis.ageRange]}${POSE_VISUAL_GENDER_LABELS[analysis.genderExpression]}`,
    analysis.personCount > 1 ? `${analysis.personCount} people detected; generate only the intended same primary person from image 1` : "single source person",
    analysis.bodyOrientation,
    analysis.headDirection,
  ].filter(Boolean).join("; ");
  const cropRule = getBodyCropPromptRule(analysis.bodyCrop);
  const genderRule = getGenderPromptRule(analysis.genderExpression);
  const visibility = [
    analysis.headVisible === false || isPoseHeadlessCrop(analysis) ? "head not visible in source" : analysis.headVisible === true ? "head visible in source" : "head visibility unknown",
    analysis.faceVisible === false || isPoseHeadlessCrop(analysis) ? "face not visible in source" : analysis.faceVisible === true ? "face visible in source" : "face visibility unknown",
    analysis.upperTorsoVisible === false ? "upper torso not visible in source" : analysis.upperTorsoVisible === true ? "upper torso visible in source" : "upper torso visibility unknown",
    analysis.lowerBodyVisible === false ? "lower body not visible in source" : analysis.lowerBodyVisible === true ? "lower body visible in source" : "lower body visibility unknown",
    analysis.handsVisible ? "hands visible in source" : "hands not clearly visible in source",
    analysis.feetVisible ? "feet visible in source" : "feet not clearly visible in source",
  ].join(", ");
  const headlessRule = buildHeadlessPoseRule(analysis);
  const fields = [
    `视觉识别约束（来自图1主图，优先级高于姿势变化）：${person || "source person detected"}.`,
    genderRule,
    `构图：${POSE_VISUAL_BODY_CROP_LABELS[analysis.bodyCrop]}${analysis.cameraFraming ? `；${analysis.cameraFraming}` : ""}${analysis.cameraAngle ? `；${analysis.cameraAngle}` : ""}。${cropRule}`,
    analysis.poseBaseline ? `源姿势：${analysis.poseBaseline}。不要复制源姿势，但要保持真实身体结构和关节逻辑。` : "",
    analysis.outfitDescription ? `服装锁定：${analysis.outfitDescription}；所有姿势保持同一服装结构、颜色、图案、材质、穿着层次和可见细节。` : "",
    analysis.faceIdentityNotes ? `身份锁定：${analysis.faceIdentityNotes}；不要改脸、脸型、五官比例或年龄感。` : "",
    analysis.hairDescription ? `发型锁定：${analysis.hairDescription}。` : "",
    analysis.skinToneNotes ? `肤色锁定：${analysis.skinToneNotes}；不要自动美白或改变冷暖明暗。` : "",
    analysis.background || analysis.lighting ? `场景光线锁定：${[analysis.background, analysis.lighting].filter(Boolean).join("；")}。` : "",
    `可见性：${visibility}。${getFramingFlexRule(analysis.bodyCrop)}`,
    headlessRule,
    shouldSuppressPoseFacePlanning(analysis)
      ? "表情/视线：源图没有可用脸部目标，本次不要规划表情、视线、回眸、看镜头或脸部身份变化。"
      : "表情/视线：保持同一脸部身份和年龄感，但不要机械复制图1表情；每个目标姿势都可以有克制、自然、可察觉的眼神和表情变化。",
    analysis.occlusionNotes ? `遮挡风险：${analysis.occlusionNotes}；动作遮挡必须自然，不能遮掉关键服装结构。` : "",
    analysis.generationRisks.length ? `风险规避：${analysis.generationRisks.join("；")}。` : "",
    analysis.promptNotes ? `补充识别说明：${analysis.promptNotes}` : "",
    outputMode === "separate"
      ? "当前是单张 slot 生成：每个 slot 只改变目标姿势、表情眼神和适配构图，不继承上一张结果，不改变上述图1身份和服装事实。"
      : "当前是四宫格生成：四个分格必须共享上述图1身份、服装、背景和光线事实，但姿势、表情眼神和商业构图可以形成明确差异。",
  ].filter(Boolean);

  return fields.join("\n");
}

export function isPoseHeadlessCrop(analysis: PoseVisualAnalysis | null | undefined) {
  if (!analysis) return false;
  if (analysis.bodyCrop === "lower_body") return true;
  return analysis.headVisible === false && analysis.faceVisible === false;
}

export function shouldSuppressPoseFacePlanning(analysis: PoseVisualAnalysis | null | undefined) {
  if (!analysis) return false;
  return isPoseHeadlessCrop(analysis) || analysis.faceVisible === false || analysis.headVisible === false;
}

function buildHeadlessPoseRule(analysis: PoseVisualAnalysis) {
  if (!shouldSuppressPoseFacePlanning(analysis)) return "";
  if (analysis.bodyCrop === "lower_body") {
    return "无头下半身硬规则：图1是下半身/腰腿脚局部参考，最终必须保持无头、无脸、非完整人像裁切；不要补出头、脸、脖子、肩部、完整上半身、回眸、看镜头或任何表情。姿势变化只能发生在腰胯、腿部、膝部、脚步、裤脚/裙摆、包袋和可见手臂范围内。";
  }
  return "无头裁切硬规则：图1没有可见头部或脸部，最终必须保持同类无头裁切；不要补出头、脸、发型、表情、回眸或完整人像。姿势变化只能发生在原图可见身体范围内。";
}

function getGenderPromptRule(gender: PoseVisualGenderExpression) {
  if (gender === "male") {
    return "性别锁定：图1识别为男性表达；最终必须仍是同一个男性人物，不要女性化身体、妆发、胸腰胯比例、站姿气质或脸部气质。";
  }
  if (gender === "female") {
    return "性别锁定：图1识别为女性表达；最终必须仍是同一个女性人物，不要男性化身体骨架、妆发、站姿气质或脸部气质。";
  }
  if (gender === "androgynous") {
    return "性别锁定：保持图1中性/弱性别化表达，不要强行女性化或男性化。";
  }
  return "性别锁定：图1性别表达置信不足；保持源图原有性别气质、身体骨架、肩宽、胸腰胯比例、妆发和身份感，不要漂移。";
}

function getBodyCropPromptRule(bodyCrop: PoseVisualBodyCrop) {
  if (bodyCrop === "full_body") return "图1是完整身体参考；生成时可按姿势和风格在全身、近全身或七分身之间自然取景，不要因为源图是全身就机械复制全身距离，也不要裁掉正在展示的关键服装细节。";
  if (bodyCrop === "three_quarter") return "图1是七分身/近全身参考；生成时可在近全身、七分身或偏半身商业构图之间自然调整，不要突然变成无关特写或不可信全身扩图。";
  if (bodyCrop === "upper_body") return "保持上半身展示逻辑，不要强行补出不可信的下半身、脚部或远景全身。";
  if (bodyCrop === "lower_body") return "保持下半身展示逻辑，不要强行补出不可信的人脸、头部或完整上半身。";
  if (bodyCrop === "closeup") return "保持局部近景展示逻辑，不要扩成无关全身照。";
  return "以图1实际可见身体范围为参考，允许为目标姿势选择合理商业构图；无法确认的部位不要主动重构。";
}

function getFramingFlexRule(bodyCrop: PoseVisualBodyCrop) {
  if (bodyCrop === "full_body") {
    return "图1全身范围只作为服装和比例参考；目标姿势可在全身、近全身、七分身之间调整镜头距离和留白，避免固定同一画幅。";
  }
  if (bodyCrop === "three_quarter") {
    return "图1近全身范围只作为服装和比例参考；目标姿势可在近全身、七分身或偏半身之间调整构图，关键服装细节必须清楚。";
  }
  if (bodyCrop === "upper_body") {
    return "保持上半身输入逻辑，不要强行扩成全身；可围绕领口、肩线、袖型和上衣结构做构图变化。";
  }
  if (bodyCrop === "lower_body") {
    return "保持下半身输入逻辑，不要强行补脸或完整上半身；可围绕腰胯、腿部、裤脚/裙摆做构图变化。";
  }
  if (bodyCrop === "closeup") {
    return "保持局部近景输入逻辑，只做局部角度、姿态和质感变化，不扩成无关远景。";
  }
  return "可按目标姿势选择合理商业构图，但不要无故变成极端特写或裁掉关键服装结构。";
}

function toPoseDisplayPhrase(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) return "";
  if (isChineseDisplayText(value)) return value.trim();
  const exact: Record<string, string> = {
    front_facing: "正面",
    frontal: "正面",
    front_view: "正面",
    facing_camera: "正面看镜头",
    three_quarter: "三分之二侧身",
    three_quarter_view: "三分之二侧身",
    side_facing: "侧身",
    side_view: "侧身",
    back_facing: "背面",
    back_view: "背面",
    standing: "站姿",
    seated: "坐姿",
    walking: "行走",
    hand_distortion: "手部风险",
    hands_distortion: "手部风险",
    gender_drift: "性别漂移",
    face_drift: "脸部漂移",
    identity_drift: "身份漂移",
    body_proportion_drift: "比例漂移",
    crop_expansion: "构图扩展",
    visual_analysis_unavailable: "识别不可用",
  };
  return exact[normalized] || "";
}

function summarizeOutfitForDisplay(value: string) {
  const text = value.trim();
  if (!text) return "";
  if (isChineseDisplayText(text)) return clampText(text, 46);
  const normalized = text.toLowerCase();
  const parts: string[] = [];
  const color = getFirstMatchLabel(normalized, [
    [/dark\s+red|burgundy|wine\s+red/, "深红"],
    [/red/, "红色"],
    [/black/, "黑色"],
    [/white|ivory|cream/, "白色"],
    [/blue|denim/, "蓝色"],
    [/gray|grey/, "灰色"],
    [/beige|khaki/, "米色"],
    [/green/, "绿色"],
    [/pink/, "粉色"],
  ]);
  if (color) parts.push(color);
  const garment = getFirstMatchLabel(normalized, [
    [/spaghetti[-\s]?strap|camisole|tank/, "吊带"],
    [/mini\s+dress|dress/, "连衣裙"],
    [/skirt/, "半裙"],
    [/jeans|pants|trousers/, "裤装"],
    [/jacket|coat|blazer/, "外套"],
    [/shirt|blouse/, "衬衫"],
    [/t[-\s]?shirt|tee/, "T 恤"],
  ]);
  if (garment) parts.push(garment);
  const detailRules: Array<[RegExp, string]> = [
    [/tiered/, "多层"],
    [/ruffled|ruffle/, "荷叶边"],
    [/lace/, "蕾丝"],
    [/pleated|pleat/, "褶裥"],
    [/denim/, "牛仔"],
    [/sleeveless/, "无袖"],
    [/long[-\s]?sleeve/, "长袖"],
  ];
  const details = detailRules.flatMap(([pattern, label]) => pattern.test(normalized) ? [label] : []);
  parts.push(...details.slice(0, 3));
  return parts.length ? Array.from(new Set(parts)).join(" / ") : "服装已识别";
}

function summarizeFactForDisplay(value: string) {
  const text = value.trim();
  if (!text) return "";
  if (isChineseDisplayText(text)) return clampText(text, 32);
  const mapped = toPoseDisplayPhrase(text);
  if (mapped) return mapped;
  return "";
}

function summarizeVisibilityForDisplay(analysis: PoseVisualAnalysis) {
  const parts: string[] = [];
  if (isPoseHeadlessCrop(analysis)) parts.push("无头");
  else if (analysis.headVisible === true) parts.push("头可见");
  else if (analysis.headVisible === false) parts.push("头不可见");

  if (isPoseHeadlessCrop(analysis) || analysis.faceVisible === false) parts.push("脸不可见");
  else if (analysis.faceVisible === true) parts.push("露脸");

  if (analysis.upperTorsoVisible === true) parts.push("上身可见");
  else if (analysis.upperTorsoVisible === false) parts.push("上身不可见");
  if (analysis.lowerBodyVisible === true) parts.push("下身可见");
  else if (analysis.lowerBodyVisible === false) parts.push("下身不可见");
  if (analysis.handsVisible) parts.push("手可见");
  if (analysis.feetVisible) parts.push("脚可见");
  return Array.from(new Set(parts)).slice(0, 5).join(" / ");
}

function summarizeCameraForDisplay(value: string) {
  const text = value.trim();
  if (!text) return "";
  if (isChineseDisplayText(text)) return clampText(text, 32);
  const normalized = text.toLowerCase().replace(/[_-]+/g, " ");
  const parts: string[] = [];
  if (/center|centred|centered/.test(normalized)) parts.push("居中");
  if (/full\s*body|whole\s*body|head\s*to\s*toe/.test(normalized)) parts.push("全身");
  else if (/three\s*quarter|3\/4|seven/.test(normalized)) parts.push("七分身");
  else if (/upper|half\s*body|medium/.test(normalized)) parts.push("半身");
  else if (/close|detail|crop/.test(normalized)) parts.push("近景");
  if (/studio/.test(normalized)) parts.push("棚拍");
  if (/portrait|vertical/.test(normalized)) parts.push("竖幅");
  return parts.length ? Array.from(new Set(parts)).join("") : summarizeFactForDisplay(text) || "构图已识别";
}

function summarizeLightingForDisplay(value: string) {
  const text = value.trim();
  if (!text) return "";
  if (isChineseDisplayText(text)) return clampText(text, 32);
  const normalized = text.toLowerCase().replace(/[_-]+/g, " ");
  const parts: string[] = [];
  if (/soft|diffused|diffuse/.test(normalized)) parts.push("柔和");
  if (/even|balanced/.test(normalized)) parts.push("均匀");
  if (/studio/.test(normalized)) parts.push("棚拍光");
  else if (/daylight|natural/.test(normalized)) parts.push("自然光");
  if (/backlight|rim/.test(normalized)) parts.push("轮廓光");
  if (/warm/.test(normalized)) parts.push("暖调");
  if (/cool/.test(normalized)) parts.push("冷调");
  return parts.length ? Array.from(new Set(parts)).join("") : summarizeFactForDisplay(text) || "光线已识别";
}

function getFirstMatchLabel(text: string, rules: Array<[RegExp, string]>) {
  return rules.find(([pattern]) => pattern.test(text))?.[1] || "";
}

function containsCjk(value: string) {
  return /[\u3400-\u9fff]/.test(value);
}

function isChineseDisplayText(value: string) {
  return containsCjk(value) && !/[A-Za-z]{4,}/.test(value);
}

function normalizeAnalysisUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.toLowerCase();
  } catch {
    return String(value || "").split("?")[0].trim().toLowerCase();
  }
}

function normalizePersonCount(value: unknown) {
  const count = Number(value);
  if (!Number.isFinite(count)) return 1;
  return Math.min(Math.max(Math.floor(count), 0), 6);
}

function normalizeGenderExpression(value: string): PoseVisualGenderExpression {
  const normalized = value.toLowerCase();
  if (["female", "woman", "women", "girl", "feminine", "女", "女性", "女装"].some((item) => normalized.includes(item))) return "female";
  if (["male", "man", "men", "boy", "masculine", "男", "男性", "男装"].some((item) => normalized.includes(item))) return "male";
  if (["androgynous", "unisex", "neutral", "中性"].some((item) => normalized.includes(item))) return "androgynous";
  return "unknown";
}

function normalizeAgeRange(value: string): PoseVisualAgeRange {
  const normalized = value.toLowerCase();
  if (["adult", "成年人", "成人"].some((item) => normalized.includes(item))) return "adult";
  if (["teen", "teenager", "青少年", "少年"].some((item) => normalized.includes(item))) return "teen";
  if (["child", "kid", "children", "儿童", "小孩", "幼童"].some((item) => normalized.includes(item))) return "child";
  return "unknown";
}

function normalizeBodyCrop(value: string): PoseVisualBodyCrop {
  if (
    value === "full_body"
    || value === "three_quarter"
    || value === "upper_body"
    || value === "lower_body"
    || value === "closeup"
    || value === "partial_unknown"
  ) return value;
  const normalized = value.toLowerCase();
  if (normalized.includes("full") || normalized.includes("全身")) return "full_body";
  if (normalized.includes("three") || normalized.includes("七分") || normalized.includes("3/4")) return "three_quarter";
  if (normalized.includes("upper") || normalized.includes("上半身")) return "upper_body";
  if (normalized.includes("lower") || normalized.includes("下半身")) return "lower_body";
  if (normalized.includes("close") || normalized.includes("局部") || normalized.includes("特写")) return "closeup";
  return "partial_unknown";
}

function readBoolean(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
  }
  return null;
}

function readString(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeStringArray(value: unknown, maxItems: number, maxLength: number) {
  return Array.isArray(value)
    ? value
        .map((item) => typeof item === "string" ? clampText(item, maxLength) : "")
        .filter(Boolean)
        .slice(0, maxItems)
    : [];
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function clampText(value: string, maxLength = 140) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// ---- Pose mode decision ----
// Centralized decision for pose-burst prompt generation. Helps the prompt
// stay single-branch (no contradictory if/then instructions) and gives the
// image-generation model one clear directive set per pose task.
//
// Output: which face-identity / crop mode to apply when composing the prompt.
//   - "preserve_reference_crop": reference crop is headless or partial;
//     keep the reference's body range strictly, no head/face expansion.
//   - "pose_burst_full_subject": reference has a visible full subject;
//     preserve identity (face, body, outfit) and only vary pose.
export type PoseMode = "preserve_reference_crop" | "pose_burst_full_subject";

export function decidePoseMode(params: {
  analysis?: PoseVisualAnalysis | null;
  outputMode: "grid" | "separate";
}): PoseMode {
  const a = params.analysis;
  if (!a) return "pose_burst_full_subject"; // no analysis -> assume we have a person
  if (a.bodyCrop === "lower_body") {
    return "preserve_reference_crop";
  }
  if (a.bodyCrop === "closeup" && !a.headVisible && !a.faceVisible) {
    return "preserve_reference_crop";
  }
  // partial_unknown with no visible head -> treat as headless to be safe
  if (a.bodyCrop === "partial_unknown" && !a.headVisible && !a.faceVisible) {
    return "preserve_reference_crop";
  }
  return "pose_burst_full_subject";
}
