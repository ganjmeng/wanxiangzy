const MODEL_QUALITY =
  "photorealistic, 8K ultra-detailed, commercial portrait quality, cinematic color grade, sharp facial details, sharp hair details, RAW photo quality";
const MODEL_PROMPT_MARKER = "专属模特生成协议 v2";

// 7 rules kept as exports because the vision-LLM analyze route composes them
// directly into its prompt. They are NOT dead. See app/api/model/analyze/route.ts.
export const MODEL_FACE_STYLE_RULE =
  "人脸风格规则：参考图不仅用于五官融合，也用于定义最终模特的长相风格、审美方向和气质标签。必须提取参考图中最明显的脸部审美特征、年龄感、眼神气质、面部氛围、镜头表现力和整体模特感，让生成结果看起来像同一类风格的专属模特，而不是普通随机人脸。";

export const MODEL_MAKEUP_RULE =
  "妆感规则：参考图也用于提取妆容风格，包括底妆质感、遮瑕程度、眉形、眼妆色系、眼妆轮廓、眼线、睫毛、卧蚕、腮红位置、修容高光位置、唇形、唇色、唇妆质地和整体妆感浓淡。最终模特需要保留参考图的妆发审美和面部氛围，但妆容必须自然真实、贴合商业模特摄影，不要夸张网红妆、脏妆、塑料感或过度磨皮。";

export const MODEL_FUSION_RULE =
  "融合规则：最终模特是由所有人脸参考图融合出来的新身份，需要综合每张图的脸型优势、五官比例、眼神气质、肤色、妆感和真实质感；如果参考图之间差异明显，按自然真人审美融合成协调的新脸，不要生成与任意单张参考图几乎完全相同的脸，也不要机械平均成没有风格记忆点的陌生脸。";

export const MODEL_SKIN_TONE_RULE =
  "肤色规则：从参考人脸图中提取自然肤色范围、冷暖调、明暗层次、局部红润、阴影层次和真实皮肤质感，生成协调自然的肤色；不要默认美白，不要雪白皮，不要冷白皮，不要过度提亮肤色，不要把亚洲肤色统一变成瓷白。";

export const MODEL_FACE_SHAPE_RULE =
  "脸型骨相规则：参考图用于提取真实脸型结构，包括脸长宽比例、颧骨位置、下颌线、下巴形状、额头宽度、面中比例、太阳穴饱满度和面部骨相。最终模特可以自然美化，但不能统一变成标准鹅蛋脸、小V脸、尖下巴或网红脸，必须保留参考图中有辨识度的脸型倾向。";

export const MODEL_FEATURE_IDENTITY_RULE =
  "五官辨识度规则：保留参考图中有记忆点的眼型、眼距、眉眼关系、鼻梁高度、鼻翼宽度、鼻头形状、人中长度、唇形厚薄、嘴角走势和面部不对称细节；不要自动优化成大眼、高鼻、尖下巴、过度标准化的精修美女脸。";

export const MODEL_AGE_TEXTURE_RULE =
  "年龄感和肤质规则：保留参考图的年龄感、成熟度、面部软组织状态、眼下细纹、法令纹、皮肤微纹理、真实皮肤反光和局部瑕疵；不要统一少女化，不要磨成无纹理蜡像皮。";

// Hard rules (single-branch, ~250 chars) lead every model prompt.
// Compresses 7 long rules into 3 imperative lines + 1 marker.
const MODEL_HARD_FACE_RULE =
  "1) 脸型骨相 + 五官比例 + 肤色冷暖 + 妆感 + 年龄感：严格提取自人脸参考图；不要标准化成鹅蛋脸/小V脸/尖下巴/大眼高鼻网红审美。";
const MODEL_HARD_FUSION_RULE =
  "2) 多参考融合：每张人脸参考图都贡献等权重的脸型优势、五官比例、眼神气质、肤色和真实质感；不要照搬任一张，不要把最后一张当主脸。";
const MODEL_HARD_AGE_TEXTURE_RULE =
  "3) 年龄感 + 肤质：保留参考图的成熟度、眼下细纹、法令纹、皮肤微纹理、局部瑕疵和真实反光；不要统一少女化，不要磨成无纹理蜡像皮。";

export function getModelQualityPrompt() {
  return MODEL_QUALITY;
}

export function buildModelIdentityRoleStatement(params: {
  referenceCount: number;
  hairReferenceIndex?: number | null;
  hairColorReferenceIndex?: number | null;
}) {
  const referenceCount = normalizeReferenceCount(params.referenceCount);
  const refs = buildReferenceList(referenceCount);
  const extraRoles = [
    params.hairReferenceIndex ? `图${params.hairReferenceIndex} 是发型硬参考，只参考发型轮廓、长度、刘海、分缝、蓬松度和发丝走向，不参与人脸身份` : "",
    params.hairColorReferenceIndex ? `图${params.hairColorReferenceIndex} 是发色硬参考，只参考头发颜色、明暗层次和染发质感，不参与人脸身份` : "",
  ].filter(Boolean);

  const faceRole = referenceCount > 1
    ? `${refs} 是同等权重的人脸、气质、妆感和审美融合参考；每张都必须留下可感知贡献，禁止把图${referenceCount}或任意单张直接当最终脸复制`
    : "图1 是唯一人脸身份参考，必须保留其脸型骨相、五官比例、肤色、年龄感和真实质感";

  return `图像角色：${faceRole}${extraRoles.length ? `；${extraRoles.join("；")}` : ""}。`;
}

export function enforceModelPromptRequirements(params: {
  prompt: string;
  referenceCount: number;
  gender?: "female" | "male" | string | null;
  hairStyle?: string | null;
  hairColor?: string | null;
  hairReferenceIndex?: number | null;
  hairColorReferenceIndex?: number | null;
}) {
  if (!params.prompt.trim()) return "";

  const referenceCount = normalizeReferenceCount(params.referenceCount);
  const normalizedPrompt = normalizeModelPrompt(params.prompt);

  // Idempotency: if the prompt already contains the protocol marker and
  // the hard-rule segment, return it as-is. This prevents the bug where
  // a previous round's output is fed back as input and ends up duplicated
  // (HARD 硬规则 segment gets pulled into userIntent and re-wrapped).
  if (normalizedPrompt.includes(`【${MODEL_PROMPT_MARKER}】`) && normalizedPrompt.includes("【HARD 硬规则")) {
    return normalizedPrompt;
  }

  const fragments = extractModelPromptFragments(normalizedPrompt);

  const roleStatement = buildModelIdentityRoleStatement({
    referenceCount,
    hairReferenceIndex: params.hairReferenceIndex,
    hairColorReferenceIndex: params.hairColorReferenceIndex,
  });

  // 6 段结构（v3）：marker → 角色 → 硬规则（脸）→ 发型硬约束 + 核心任务 → 商业输出 → 质量/负面
  return [
    `【${MODEL_PROMPT_MARKER}】`,
    roleStatement,
    buildModelHardRule(referenceCount),
    `${buildModelHairRule({
      hairStyle: params.hairStyle,
      hairColor: params.hairColor,
      hairReferenceIndex: params.hairReferenceIndex,
      hairColorReferenceIndex: params.hairColorReferenceIndex,
    })} ${buildModelCoreTask(params.gender)} 商业输出：单人半身头像/模特卡照片，白色基础上衣，干净浅灰或白色棚拍背景，柔和商业摄影布光；皮肤保留自然纹理、毛孔和轻微瑕疵，发丝边缘清晰真实。`,
    fragments.styleLine,
    fragments.userIntent ? `用户补充/视觉分析：${fragments.userIntent}` : "",
    `图像质量：${MODEL_QUALITY}`,
    "负面审美约束：不要多个人，不要随机陌生脸，不要只像单张参考图，不要让最后一张参考图主导，不要默认美白、雪白皮或冷白皮，不要标准鹅蛋脸、小V脸、尖下巴、大眼高鼻网红审美，不要忽略发型/发色硬约束，不要过度磨皮、塑料皮肤、蜡像感、畸形五官、文字水印。",
  ].filter(Boolean).join("\n");
}

function buildModelHardRule(referenceCount: number) {
  const lines = [
    "【HARD 硬规则 · 模特身份模式】",
    MODEL_HARD_FACE_RULE,
  ];
  if (referenceCount > 1) {
    lines.push(MODEL_HARD_FUSION_RULE);
  }
  lines.push(MODEL_HARD_AGE_TEXTURE_RULE);
  return lines.join("\n");
}

function normalizeReferenceCount(referenceCount: number) {
  const count = Math.floor(Number(referenceCount) || 1);
  return Math.max(count, 1);
}

function buildReferenceList(referenceCount: number) {
  return Array.from({ length: referenceCount }, (_, index) => `图${index + 1}`).join("、");
}

function buildModelCoreTask(gender?: string | null) {
  const genderText = gender === "male" ? "男性" : gender === "female" ? "女性" : "人物";
  return `核心任务：生成一位真实商业可用的${genderText}专属模特；最终长相必须是融合后的单一新身份，不是拼贴、换脸、平均脸或照搬任意参考图。`;
}

function buildModelFusionMethod(referenceCount: number) {
  if (referenceCount <= 1) {
    return "融合方法：以图1为身份基准，保留脸长宽比例、颧骨/下颌/下巴、眼型眼距、鼻翼鼻头、唇形厚薄、肤色冷暖、妆感和年龄质感；允许自然商业化美化，但不得换成模板脸。";
  }

  const refs = buildReferenceList(referenceCount);
  return `融合方法：先分别提取${refs}的脸型骨相、五官比例、眼神气质、肤色冷暖、妆感、年龄感和真实皮肤质感，再重组为一个新长相；${refs}权重均衡，图${referenceCount}即使更清晰也不能成为主脸，只能贡献部分特征。`;
}

function buildModelHairRule(params: {
  hairStyle?: string | null;
  hairColor?: string | null;
  hairReferenceIndex?: number | null;
  hairColorReferenceIndex?: number | null;
}) {
  const hairStyle = cleanInlineText(params.hairStyle);
  const hairColor = cleanInlineText(params.hairColor);
  const hairRule = params.hairReferenceIndex
    ? `发型必须优先跟随图${params.hairReferenceIndex}的轮廓、长度、刘海/分缝、蓬松度和发丝走向；该优先级高于人脸参考图里的原始发型`
    : hairStyle
      ? `发型必须采用「${hairStyle}」；该优先级高于人脸参考图里的原始发型`
      : "发型按融合后的脸型自然适配，避免随机改成夸张或不协调发型";
  const colorRule = params.hairColorReferenceIndex
    ? `发色必须优先跟随图${params.hairColorReferenceIndex}的颜色、明暗层次和染发质感；不改变人脸身份`
    : hairColor
      ? `发色必须采用「${hairColor}」；不要被人脸参考图原始发色覆盖`
      : "发色保持自然真实并服务整体商业质感";

  return `发型发色硬约束：${hairRule}；${colorRule}。`;
}

function normalizeModelPrompt(prompt: string) {
  return prompt
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractModelPromptFragments(prompt: string) {
  const styleLines: string[] = [];
  const userLines: string[] = [];

  prompt.split("\n").forEach((rawLine) => {
    const line = unwrapModelUserLine(rawLine.trim());
    if (!line) return;
    if (line.includes("专属模特拍摄风格档位")) {
      styleLines.push(line);
      return;
    }
    if (MODEL_SYSTEM_LINE_PATTERNS.some((pattern) => pattern.test(line))) return;
    userLines.push(line);
  });

  return {
    styleLine: dedupeTextParts(styleLines).join("\n"),
    userIntent: limitModelIntent(dedupeTextParts(userLines).join("；")),
  };
}

function unwrapModelUserLine(line: string) {
  return line
    .replace(/^用户补充\/视觉分析[:：]\s*/, "")
    .replace(/^用户补充要求[:：]\s*/, "用户要求：")
    .trim();
}

const MODEL_SYSTEM_LINE_PATTERNS = [
  new RegExp(MODEL_PROMPT_MARKER),
  /^【?专属模特生成协议/,
  /^图像角色[:：]/,
  /^核心任务[:：]/,
  /^任务[:：]融合/,
  /^融合方法[:：]/,
  /^发型发色硬约束[:：]/,
  /^商业输出[:：]/,
  /^图像质量[:：]/,
  /^负面/,
  /^生成规则[:：]/,
  /^融合规则[:：]/,
  /^人脸风格规则[:：]/,
  /^妆感规则[:：]/,
  /^肤色规则[:：]/,
  /^脸型骨相规则[:：]/,
  /^五官辨识度规则[:：]/,
  /^年龄感和肤质规则[:：]/,
  /^白色基础上衣/,
  /^图\d+\s*(是|只作为).*?(发型|发色).*?参考/,
  // HARD hard-rule segment lines (whole segment or numbered children) MUST
  // be treated as system lines, not user intent. Without these, round-trip
  // re-enforce causes 2-3x duplication of the hard rule.
  /^【HARD 硬规则/,
  /^\d+\)\s*(脸型|多参考|年龄感|年龄)/,
];

function cleanInlineText(value?: string | null) {
  return (value || "")
    .replace(/\s+/g, " ")
    .replace(/[。；;]+$/g, "")
    .trim();
}

function dedupeTextParts(parts: string[]) {
  const seen = new Set<string>();
  return parts.filter((part) => {
    const key = part.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function limitModelIntent(text: string, maxChars = 520) {
  const clean = text.replace(/\s+/g, " ").replace(/；{2,}/g, "；").trim();
  if (clean.length <= maxChars) return clean;

  const sentences = clean.match(/[^。！？；.!?;]+[。！？；.!?;]?/g) || [clean];
  let result = "";
  for (const sentence of sentences) {
    const next = sentence.trim();
    if (!next) continue;
    if (result.length + next.length > maxChars) break;
    result += next;
  }

  return (result || clean.slice(0, maxChars)).trim();
}
