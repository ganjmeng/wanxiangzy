import type { LingyaModel } from "@/lib/api/lingya";

export type ImagePromptKind = "tryon" | "grass" | "modelBackground" | "materialEnhancement" | "pose" | "model" | "garment3d" | "faceSwap" | "commerceDetail" | "productSet";

const KIND_HEADERS: Record<ImagePromptKind, string> = {
  tryon:
    "核心任务：按输入图片编号完成服装上身/换装，服装细节、人物身份、肤色、姿势、场景关系必须严格遵守。",
  grass:
    "核心任务：生成真实社媒服装种草图。图1是服装/穿搭来源；图2如存在，只提供场景、构图、光线、姿势和氛围。保持图1服装，可按图1风格添加少量自然配饰。",
  modelBackground:
    "核心任务：完成换背景/换模特。图1是原始人物/服装/穿搭来源；只换背景时只替换背景，图1人物、脸、发型、服装、姿势和构图保持不变；只换模特时只替换图1脸部，其它不变；背景参考图只提供场景、光线、色彩和空间氛围。人物必须自然融入新背景，匹配光线、色温、曝光、景深、透视、人物尺度、接触阴影和边缘过渡，避免贴纸感。",
  materialEnhancement:
    "核心任务：材质增强。图1是最终画面原图，图2只提供同款/同系列服装材质和细节参考；只增强图1目标服装区域的面料纹理、织纹层次、缝线、压线、纽扣、拉链、五金、刺绣、logo边缘和已有褶皱可见度。人物、脸、皮肤、发型、身体比例、姿势、手脚、服装款式、版型、轮廓、长度、穿着位置、固有颜色、图案位置、logo位置、背景、构图、镜头距离、画幅、透视、光线方向、曝光、阴影和景深必须保持不变。",
  pose:
    "核心任务：生成单张 2x2 四宫格姿势裂变图，四格保持同一人、同一衣服和同一人物比例；镜头、画幅和构图可按用户每格描述变化。",
  model:
    "核心任务：按图像角色均衡融合参考人脸，生成一个真实商业可用的新专属模特身份；发型/发色硬约束优先于人脸参考图原始头发。",
  garment3d:
    "核心任务：把图1服装转换为无真人、无头脸手的 3D 立体商品展示图，只增加体积和棚拍质感，不改变款式颜色细节。",
  faceSwap:
    "核心任务：AI 换脸。图1是原始模特/主体画面，图2只提供面部五官身份；只替换五官，不改变图1肤色、发型、身体、服装款式、背景、光线、曝光、对比度和构图；如启用细节恢复，只允许轻量恢复图1服装已有细节。",
  commerceDetail:
    "Core task: generate one independent e-commerce detail-page section/module, not a complete detail page. The section must be mobile-first, readable, spacious, and structurally different from other sections.",
  productSet:
    "核心任务：生成一张独立商品套图素材。商品图是唯一商品硬参考；样式参考只提供版式和氛围；不要生成整套拼图、网页截图或编辑器界面。",
};

const SOURCE_MATCHED_QUALITY_LINE =
  "图像质量：photorealistic source-matched edit, faithful source exposure and contrast, natural camera texture, no extra sharpening, no HDR, no heavy filter.";
const REFERENCE_MATCHED_QUALITY_LINE =
  "图像质量：photorealistic reference-matched edit, natural filter mood and exposure contrast, true-to-source garment rendering, natural camera texture, no extra sharpening, no HDR.";
const DEFAULT_DETAIL_QUALITY_LINE =
  "图像质量：photorealistic, 8K ultra-detailed, sharp details, commercial photography quality, raw photo quality.";
const SOURCE_TONE_MATCH_RULE =
  "原图影调保真：保持图1/源图的原始曝光、对比度、白平衡、色温、肤色、阴影层次、颗粒/噪点和相机质感；除必要局部融合外，不要整体重调色、HDR、clarity/局部反差增强、额外锐化、超分纹理或商业精修滤镜。";
const REFERENCE_FUSION_TONE_RULE =
  "参考融合影调：种草/换背景可按参考图滤镜观感、曝光反差、背景对比度和新场景光线做自然融合匹配；图1服装的固有色、图案/logo、材质表面和商品结构不能被重绘，且不要 HDR、clarity/局部反差增强、额外锐化、超分纹理或商业精修滤镜。";
const SOURCE_TEXTURE_SAFETY_RULE =
  "细密纹理安全：细条纹、罗纹、针织、裤纹、网纱、格纹和重复图案只按原图可见尺度自然保留；不要增强成摩尔纹、波纹、水波纹、频闪条纹、振荡线、假纤维或不存在的面料纹理。";
const SEPARATE_POSE_QUALITY_LINE =
  "Image quality: source-matched natural camera photo; keep original exposure, contrast, white balance, tone, grain/noise; no HDR, no extra sharpening, no clarity boost, no moire or wavy fabric artifacts.";
const SOURCE_MATCHED_KINDS = new Set<ImagePromptKind>(["grass", "modelBackground", "materialEnhancement", "pose", "faceSwap"]);
const REFERENCE_MATCHED_KINDS = new Set<ImagePromptKind>(["grass", "modelBackground"]);
const OBSOLETE_QUALITY_SANITIZED_KINDS = new Set<ImagePromptKind>(["tryon", ...SOURCE_MATCHED_KINDS]);

const IMPORTANT_PATTERNS = [
  /图像角色|图\d|核心任务|任务|必须|严格|最重要|参考图|服装图|服装图角色隔离|只提供衣服|真人上身|模特脸|发型参考|发色参考/,
  /姿势\s*[1-4]|槽位\s*[1-4]|HARD TARGET POSE SLOT|standalone 3:4 photo|only that pose line|四宫格|2x2|four-panel|contact sheet|镜头统一规则|framing|lens|eye level/,
  /画幅|构图规则|裁切|裁掉|全身|大半身|半身|头像|商品特写|镜头距离|人物占画面|上下留白|脚部|鞋履|下半身|3:4|4:5|9:16|1:1/,
  /服装|版型|颜色|图案|logo|材质|纹理|袖口|下摆|拉链|纽扣|口袋|腰线|廓形|面料/,
  /体态|比例|头身比|头部大小|大头|短腿|儿童化|玩偶|成人|肩颈|腰胯|四肢|脚下接触|身体骨架/,
  /服装适用人群|年龄段|女装|男装|童装|青少年|大童|中童|小童|幼童|幼龄化|成人化|性感化|浓妆/,
  /脸型|骨相|五官|肤色|妆感|年龄感|眼神|发型|发色|身份|融合|自然肤色/,
  /3D|立体|厚度|体积|棚拍|无真人|无头部|无脸|无手|背景/,
  /负面|不要|禁止|不改变|不要换脸|不要换衣服|不要美白|不要雪白皮|不要多余人物/,
  /失败修复指令|拍摄风格档位|展示风格档位|展示质感|自动设计|用户补充要求|用户补充\/视觉分析/,
  /种草|种草硬规则|小红书|社媒|系统预设模板|系统预设风格|预设风格|用户自定义文字提示词|用户自定义|模板目标|卖点|受众|氛围|服装还原|真实分享|买家秀/,
  /佳能|富士|胶片|人像|商业人像|街拍|咖啡店|对镜自拍|试衣间|居家|电梯|帽子遮脸|色彩|光线质感|镜头语言|摄影风格/,
  /模特换背景|换背景|只换背景|只换模特|只换脸|换景|换景硬规则|背景参考|背景规则|背景来源|文生背景|原始人物|原始背景|空间关系|空间透视|光线方向|背景氛围|接触阴影|边缘|贴纸感|融合|色温|曝光/,
];

type RequiredSignal = {
  name: string;
  pattern: RegExp;
  fallback: string;
};

const REQUIRED_SIGNALS: Record<ImagePromptKind, RequiredSignal[]> = {
  tryon: [
    { name: "图片关系", pattern: /图像角色|图1.*服装|图\d/, fallback: "图像角色：必须保留图1、图2、图3等输入图片编号关系。" },
    { name: "任务", pattern: /任务：|核心任务/, fallback: "任务：按图片编号完成服装上身/换装，服装来源、参考图和模特脸图不得混淆。" },
    { name: "服装图隔离", pattern: /服装图角色隔离规则|只提供衣服本身|不得作为人物身份|不得复制服装图/, fallback: "服装图角色隔离规则：服装图即使含真人、姿势、背景或构图，也只提供衣服本身；不得作为人物身份、姿势、背景、场景、镜头距离或构图参考。" },
    { name: "画幅", pattern: /画幅构图规则/, fallback: "画幅构图规则：严格遵守用户选择的输出比例，不要裁掉头部、手部、腿部、脚部或鞋履。" },
    { name: "服装还原", pattern: /服装还原规则/, fallback: "服装还原规则：严格保留图1服装品类、版型、颜色、图案、logo、面料、领口、袖口、下摆、纽扣、拉链、口袋和缝线。" },
    { name: "人体比例", pattern: /服装适用人群规则|体态比例规则/, fallback: "体态比例规则：按用户选择的女装/男装和年龄段生成真实自然比例，避免大头小身、短腿、玩偶感和无依据幼龄化。" },
    { name: "负面约束", pattern: /负面约束|不要生成多余人物/, fallback: "负面约束：不要生成多余人物，不要扭曲身体和服装，不要改变服装结构，不要自动美白，不要文字水印。" },
  ],
  grass: [
    { name: "图片关系", pattern: /图像角色|图1.*服装|图2.*场景/, fallback: "图像角色：图1是服装/穿搭硬参考；图2如存在只作为场景、姿势、背景、构图、镜头距离和氛围参考。" },
    { name: "硬规则", pattern: /种草硬规则|图1是唯一服装/, fallback: "种草硬规则：图1是唯一服装/穿搭来源，参考图或文字不得改变服装款式、颜色、图案、logo和穿搭层次。" },
    { name: "风格来源", pattern: /系统预设风格|上传参考图风格|用户自定义执行|参考图风格/, fallback: "风格来源：系统预设、上传参考图或用户自定义只决定场景、构图、光线、姿势和社媒氛围。" },
    { name: "负面约束", pattern: /负面|不要|避免/, fallback: "负面约束：不要换衣服，不要改颜色，不要改款式，不要新增文字、水印、多余人物或AI渲染感。" },
  ],
  modelBackground: [
    { name: "图片关系", pattern: /图像角色|图1是原始人物/, fallback: "图像角色：图1是原始人物/服装/穿搭硬参考，背景或模特参考不得改变图1服装。" },
    { name: "换景硬规则", pattern: /换景硬规则|只换背景|只换模特|换模特换背景/, fallback: "换景硬规则：按当前模式只替换允许变化的部分，其他人物、服装、姿势和构图关系保持不变。" },
    { name: "自然融合", pattern: /自然融入|接触阴影|边缘|贴纸感|空间透视/, fallback: "自然融合：统一光线方向、色温、曝光、对比度、景深、空间透视、人物尺度、接触阴影和边缘过渡，避免贴纸感。" },
    { name: "负面约束", pattern: /避免|不要|负面/, fallback: "负面约束：不要改变图1服装、不要复制背景参考图人物或衣服、不要白边硬边、漂浮、肢体畸形、水印或AI渲染感。" },
  ],
  materialEnhancement: [
    { name: "图片关系", pattern: /图1是最终画面原图|图2.*服装高清|图2.*材质/, fallback: "图像角色：图1是最终画面原图，图2只提供同款或同系列服装的材质、纹理、工艺和细节参考。" },
    { name: "编辑边界", pattern: /编辑边界|只处理图1目标服装|只增强.*服装/, fallback: "编辑边界：只处理图1目标服装可见区域；人物身份、脸、皮肤、发型、身体比例、姿势、背景、镜头距离、画幅和整体光线方向不变。" },
    { name: "只改细节", pattern: /硬性保图规则|唯一允许改变|必须完全不变|原图其他内容必须保持不变/, fallback: "硬性保图规则：只允许改变图1可见目标服装区域的材质细节表现；原图其他内容必须完全不变。唯一允许改变面料纹理清晰度、织纹层次、缝线/压线、纽扣/拉链/五金、刺绣、logo边缘和已有真实褶皱可见度。" },
    { name: "服装保真", pattern: /服装保真|图1决定.*版型|图2只用于.*面料|材质表现/, fallback: "服装保真：图1决定穿着版型、轮廓、褶皱、垂坠、遮挡和阴影；图2只用于补足面料织法、纹理方向、缝线、压线、纽扣、拉链、刺绣、logo、五金和边缘细节。" },
    { name: "负面约束", pattern: /负面约束|不要换脸|不要换服装|不要改/, fallback: "负面约束：不要换脸、换人、改身体、换背景、换服装款式、改服装主色、改图案/logo位置或新增不存在的服装结构。" },
  ],
  pose: [
    { name: "任务", pattern: /图像角色|核心任务|2x2|四宫格|每个姿势单独生成一张完整图片|本次单图任务|只生成姿势\d|HARD TARGET POSE SLOT|standalone 3:4 photo/, fallback: "核心任务：生成单张2x2四宫格姿势裂变图，四格保持同一人、同一衣服和同一人物比例；镜头、画幅和构图可按用户每格描述变化。" },
    { name: "服装", pattern: /服装展示规则|不要换衣服/, fallback: "服装展示规则：四个姿势都保持同一套服装的结构、颜色、图案、长度、纹理和搭配关系。" },
    { name: "人体", pattern: /身体动作规则|身体比例|手指|肢体/, fallback: "身体动作规则：动作自然可信，避免断手、错位手指、肢体拉长、身体比例漂移和过度瘦身。" },
    { name: "负面约束", pattern: /负面约束|不要换脸|不要换衣服/, fallback: "负面约束：不要换脸，不要换衣服，不要改变场景，不要生成多余人物，不要文字水印。" },
  ],
  model: [
    { name: "图片关系", pattern: /图像角色|人脸.*参考图|发型硬参考|发色硬参考/, fallback: "图像角色：参考图用于融合专属模特身份，发型/发色参考不得被误当成人脸身份。" },
    { name: "融合", pattern: /融合方法|融合规则|人脸风格规则|五官辨识度规则/, fallback: "融合方法：综合参考图脸型骨相、五官比例、肤色、妆感、年龄感和气质，生成稳定真实的新专属模特身份；不要让最后一张参考图主导。" },
    { name: "发型发色", pattern: /发型发色硬约束|发型必须|发色必须/, fallback: "发型发色硬约束：用户选择或上传的发型/发色优先级高于人脸参考图原始头发。" },
    { name: "审美负面", pattern: /负面审美约束|不要默认美白|不要标准鹅蛋脸/, fallback: "负面审美约束：不要默认美白，不要标准鹅蛋脸、小V脸、尖下巴、大眼高鼻网红审美或塑料皮肤。" },
  ],
  garment3d: [
    { name: "任务", pattern: /图像角色|3D|立体|无真人/, fallback: "核心任务：把图1服装转换为无真人、无头脸手的3D立体商品展示图。" },
    { name: "服装还原", pattern: /严格保留|服装.*版型|颜色|材质|纹理/, fallback: "服装还原：严格保留图1服装品类、版型、颜色、材质、纹理、图案、纽扣、拉链、口袋和主要细节。" },
    { name: "负面约束", pattern: /负面约束|不要生成真人|不要改变/, fallback: "负面约束：不要生成真人身体、模特脸或多件衣服，不要改变服装类型、主色、文字、logo和结构。" },
  ],
  faceSwap: [
    { name: "图像角色", pattern: /图1.*原始|图2.*脸|目标脸/, fallback: "图像角色：图1是原始模特/主体画面；图2只提供目标脸的五官身份。" },
    { name: "只换五官", pattern: /只替换|五官|does not change/, fallback: "换脸规则：Swap Face only changes facial features. It does not change the model's skin tone or hairstyle." },
    { name: "保留项", pattern: /肤色|发型|身体|服装|背景|光线|构图/, fallback: "保留项：严格保持图1肤色、发型、发色、身体比例、服装、背景、光线、镜头和构图不变。" },
    { name: "负面约束", pattern: /不要|禁止|负面/, fallback: "负面约束：不要换肤色，不要换发型，不要换衣服，不要改变姿势、场景、画幅，不要生成多余人物或文字水印。" },
  ],
  commerceDetail: [
    { name: "section contract", pattern: /section|module|板块|详情页|detail-page/i, fallback: "Section contract: generate exactly ONE independent detail-page section/module, not a complete detail page." },
    { name: "mobile layout", pattern: /mobile|手机|750|9:16|vertical/i, fallback: "Mobile layout: mobile-first vertical e-commerce section, readable large Chinese typography, spacious hierarchy." },
    { name: "no full page", pattern: /not a complete|Do NOT include all modules|不要.*完整|不是.*完整/i, fallback: "Hard negative: do not create a full detail page, long page, collage, four-grid, or repeated complete page variant." },
    { name: "distinct module", pattern: /structurally different|different from other modules|不同|独立/i, fallback: "Distinct module: this section must have its own content purpose and layout, different from the other requested sections." },
  ],
  productSet: [
    { name: "image roles", pattern: /图片角色|商品硬参考|样式参考/i, fallback: "图片角色：商品图是唯一商品硬参考；样式参考只提供版式结构、视觉层级和氛围，不得复制其商品、人物、文字或品牌。" },
    { name: "single output", pattern: /只生成一张|独立商品套图|不要把整套/i, fallback: "输出契约：只生成一张独立商品套图图片，不要把整套结果塞进一张图，不要生成网页截图或编辑器界面。" },
    { name: "product preservation", pattern: /严格保留.*商品|商品硬规则|不能创造不存在/i, fallback: "商品硬规则：严格保留商品品类、颜色、材质、结构、廓形、比例、纹理、图案、logo/文字位置和可见细节，不创造不存在的新款式。" },
    { name: "commerce copy", pattern: /文案|文字排版|目标平台|目标国家|语言/i, fallback: "电商文案：文案必须短、清晰、可读，适配目标语言和平台，不虚构认证、价格、销量、医学功效或具体尺寸。" },
    { name: "negative", pattern: /负面约束|不要改变商品|不要生成无关商品/i, fallback: "负面约束：不要改变商品颜色和结构，不要生成无关商品，不要文字乱码、水印、平台截图、界面按钮或编辑器边框。" },
  ],
};

export function compileImagePromptForModel(params: {
  kind?: ImagePromptKind;
  model: LingyaModel;
  prompt: string;
}) {
  const normalized = sanitizeSourceImagePrompt(
    params.kind,
    appendSourceImageSafetyGuards(params.kind, normalizePrompt(params.prompt))
  );
  if (!params.kind) return normalized;
  if (params.kind === "tryon") return normalized;

  if (params.kind === "model") {
    return compileConcisePrompt(params.kind, normalized, params.model === "gpt-image-2" ? 3400 : 2300, "专属模特执行提示：图片角色、均衡融合、发型发色硬约束和负面审美约束优先。");
  }

  if (params.kind === "pose" && isSeparatePosePrompt(normalized)) {
    return compileSeparatePosePrompt(
      normalized,
      params.model === "gpt-image-2" ? 2400 : 2200
    );
  }

  if (params.model === "gpt-image-2") {
    return limitPrompt(normalized, 6200);
  }

  if (params.model === "nano-banana-2" || params.model === "nano-banana-pro") {
    return compileConcisePrompt(params.kind, normalized, 2300, "短版执行提示：优先服从图片编号、硬性保留项和负面约束。");
  }

  return compileConcisePrompt(params.kind, normalized, 1900, "Seedream 执行提示：主体和参考图关系优先，避免过长描述稀释重点。");
}

function compileConcisePrompt(kind: ImagePromptKind, prompt: string, maxChars: number, modelLine: string) {
  const lines = splitPromptIntoSignalLines(prompt);
  const requiredSignal = collectRequiredSignalLines(kind, lines);
  const highSignal = lines.filter((line) => IMPORTANT_PATTERNS.some((pattern) => pattern.test(line)));
  const selected = dedupeLines([
    getKindHeader(kind, prompt),
    modelLine,
    ...requiredSignal,
    ...highSignal,
    getQualityLine(kind),
  ]);

  return limitPrompt(selected.join("\n"), maxChars);
}

function getQualityLine(kind: ImagePromptKind) {
  if (kind === "commerceDetail" || kind === "productSet") return DEFAULT_DETAIL_QUALITY_LINE;
  if (REFERENCE_MATCHED_KINDS.has(kind)) return REFERENCE_MATCHED_QUALITY_LINE;
  return SOURCE_MATCHED_KINDS.has(kind) ? SOURCE_MATCHED_QUALITY_LINE : DEFAULT_DETAIL_QUALITY_LINE;
}

function getSourceImageSafetyLines(kind: ImagePromptKind) {
  if (REFERENCE_MATCHED_KINDS.has(kind)) return [REFERENCE_FUSION_TONE_RULE, SOURCE_TEXTURE_SAFETY_RULE];
  return SOURCE_MATCHED_KINDS.has(kind) ? [SOURCE_TONE_MATCH_RULE, SOURCE_TEXTURE_SAFETY_RULE] : [];
}

function appendSourceImageSafetyGuards(kind: ImagePromptKind | undefined, prompt: string) {
  if (!kind || !SOURCE_MATCHED_KINDS.has(kind)) return prompt;
  if (REFERENCE_MATCHED_KINDS.has(kind)) {
    const missing = [
      !/参考融合影调|源图主体保真|reference-matched|filter mood|exposure contrast/i.test(prompt) ? REFERENCE_FUSION_TONE_RULE : "",
      !/细密纹理安全|摩尔纹|moire/i.test(prompt) ? SOURCE_TEXTURE_SAFETY_RULE : "",
    ].filter(Boolean);
    return missing.length ? `${prompt}\n${missing.join("\n")}` : prompt;
  }
  const missing = [
    !/原图影调保真|source exposure|source-matched/i.test(prompt) ? SOURCE_TONE_MATCH_RULE : "",
    !/细密纹理安全|摩尔纹|moire/i.test(prompt) ? SOURCE_TEXTURE_SAFETY_RULE : "",
  ].filter(Boolean);
  return missing.length ? `${prompt}\n${missing.join("\n")}` : prompt;
}

function sanitizeSourceImagePrompt(kind: ImagePromptKind | undefined, prompt: string) {
  if (!kind || !OBSOLETE_QUALITY_SANITIZED_KINDS.has(kind)) return prompt;
  return prompt
    .split("\n")
    .map(sanitizeObsoleteQualityTerms)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function sanitizeObsoleteQualityTerms(line: string) {
  return line
    .replace(/,?\s*8K\s+ultra-detailed\.?/gi, "")
    .replace(/,?\s*RAW\s+photo\s+quality\.?/gi, "")
    .replace(/,?\s*raw\s+photo\s+quality\.?/g, "")
    .replace(/,?\s*sharp\s+details\.?/gi, "")
    .replace(/,?\s*high-frequency\s+garment\s+texture\.?/gi, "")
    .replace(/,?\s*natural\s+micro-contrast\.?/gi, "")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,+/g, ",")
    .replace(/:\s*,\s*/g, ": ")
    .replace(/：\s*,\s*/g, "：")
    .replace(/,\s*\./g, ".")
    .trim();
}

function compileSeparatePosePrompt(prompt: string, maxChars: number) {
  const lines = splitPromptIntoSignalLines(prompt);
  const slotIndex = inferSeparatePoseSlotIndex(prompt);

  if (isProductionSeparatePosePrompt(lines)) {
    const compiled = limitPrompt(prompt, maxChars);
    validateSeparatePoseCompiledPrompt(compiled, slotIndex);
    return compiled;
  }

  const targetPoseLines = extractTargetPoseLines(lines, slotIndex);
  const posePriorityLine = findFirstLine(lines, /^Priority:/i) || findFirstLine(lines, /^Pose priority:/i)
    || "Priority: execute this pose direction clearly; do not copy the source pose.";
  const creativeFreedomLine = findFirstLine(lines, /^Freedom:/i) || findFirstLine(lines, /^Creative freedom:/i)
    || "Freedom: choose natural action details, hand gesture, gaze, expression, body angle and camera language.";
  const cameraLine = findFirstLine(lines, /^Camera:/i)
    || "Camera: auto choose source-matched model framing, lens feel, crop, distance, composition and negative space.";
  const referenceLine = findFirstLine(lines, /^Keep:/i) || findFirstLine(lines, /^Reference only:/i) || findFirstLine(lines, /^Reference lock:/i)
    || "Keep: same person, face, outfit, background, lighting, skin tone and realistic body proportions.";
  const qualityLine = findFirstLine(lines, /^(?:Image quality|图像质量)[:：]/i)
    || SEPARATE_POSE_QUALITY_LINE;
  const negativeLine = findFirstLine(lines, /^Negative:/i)
    || "Negative: no outfit change, no face change, no extra person, no text, no grid/collage, no distorted hands or limbs.";
  const selected = dedupeLines([
    ...targetPoseLines,
    posePriorityLine,
    creativeFreedomLine,
    cameraLine,
    referenceLine,
    ...lines.filter((line) => /^Style:/i.test(line)),
    ...lines.filter((line) => /^补充要求[：:]/.test(line)),
    qualityLine,
    ...getSourceImageSafetyLines("pose"),
    negativeLine,
  ]);
  const compiled = limitPrompt(selected.join("\n"), maxChars);
  validateSeparatePoseCompiledPrompt(compiled, slotIndex);
  return compiled;
}

function isProductionSeparatePosePrompt(lines: string[]) {
  return lines.some((line) => /^Use the source image only (?:for the same person|to preserve)/i.test(line))
    && lines.some((line) => /^Generate one standalone (?:premium (?:womenswear fashion|fashion editorial)|source-matched pose variation) photo/i.test(line))
    && lines.some((line) => /^Keep the outfit (?:commercially )?readable/i.test(line))
    && lines.some((line) => /^Target pose:/i.test(line))
    && lines.some((line) => /^Camera:/i.test(line));
}

const SEPARATE_POSE_TARGET_STOP_PATTERNS = [
  /^Priority:/i,
  /^Freedom:/i,
  /^Camera:/i,
  /^Keep:/i,
  /^Pose priority:/i,
  /^Creative freedom:/i,
  /^Reference only:/i,
  /^Reference lock:/i,
  /^Style:/i,
  /^Style hint:/i,
  /^补充要求[：:]/,
  /^Shot:/i,
  /^Negative:/i,
  /^HARD TARGET POSE SLOT/i,
  /^Generate exactly ONE/i,
  /^This API call/i,
  /^Do NOT generate/i,
  /^Use the uploaded image/i,
  /^Priority:/i,
  /^[1-4]\.\s/,
  /^Keep:/i,
  /^Allow:/i,
  /^Generate one standalone/i,
];

const SEPARATE_POSE_REQUIRED_KEYWORDS: Record<number, string[]> = {
  1: ["front-view", "front silhouette", "outfit"],
  2: ["side-angle", "side silhouette", "shoulder line"],
  3: ["stationary", "not walking", "waistline"],
  4: ["movement", "aligned turning", "same natural direction", "fabric drape"],
};

function extractTargetPoseLines(lines: string[], slotIndex?: number) {
  const targetLines: string[] = [];
  let collecting = false;

  for (const line of lines) {
    if (/^Target pose:/i.test(line)) {
      collecting = true;
      targetLines.push("Target pose:");
      const inlineTarget = line.replace(/^Target pose:\s*/i, "").trim();
      if (inlineTarget) targetLines.push(inlineTarget);
      continue;
    }

    if (collecting) {
      if (SEPARATE_POSE_TARGET_STOP_PATTERNS.some((pattern) => pattern.test(line))) break;
      targetLines.push(line);
    }
  }

  if (targetLines.length > 1) return targetLines;

  const fallbackPoseLine = lines.find((line) => {
    if (slotIndex) {
      return new RegExp(`^Pose\\s*${slotIndex}:`, "i").test(line)
        || new RegExp(`^姿势\\s*${slotIndex}[：:]`).test(line);
    }
    return /^Pose\s*[1-4]:/i.test(line) || /^姿势\s*[1-4][：:]/.test(line);
  });
  return fallbackPoseLine ? ["Target pose:", fallbackPoseLine] : targetLines;
}

function inferSeparatePoseSlotIndex(prompt: string) {
  const slotMatch = prompt.match(/HARD TARGET POSE SLOT\s+([1-4])\/4/i);
  if (slotMatch) return Number(slotMatch[1]);
  const targetMatch = prompt.match(/Target pose:\s*(?:\n|\r\n)?\s*Pose\s*([1-4]):/i);
  if (targetMatch) return Number(targetMatch[1]);
  const onlyMatch = prompt.match(/只生成姿势\s*([1-4])|pose\s*([1-4])/i);
  if (onlyMatch) return Number(onlyMatch[1] || onlyMatch[2]);
  const chinesePoseMatch = prompt.match(/^姿势\s*([1-4])[：:]/m);
  return chinesePoseMatch ? Number(chinesePoseMatch[1]) : undefined;
}

function validateSeparatePoseCompiledPrompt(compiledPrompt: string, slotIndex?: number) {
  if (!slotIndex) return;
  if (!/Target pose:/i.test(compiledPrompt)) {
    throw new Error(`Pose slot ${slotIndex}: compiledPrompt missing Target pose`);
  }

  const keywords = SEPARATE_POSE_REQUIRED_KEYWORDS[slotIndex] || [];
  const lower = compiledPrompt.toLowerCase();
  const hasRequiredKeyword = keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
  const hasCustomPoseLine = new RegExp(`姿势\\s*${slotIndex}[：:]`).test(compiledPrompt);
  if (!hasRequiredKeyword && !hasCustomPoseLine) {
    throw new Error(`Pose slot ${slotIndex}: compiledPrompt missing unique pose keywords`);
  }
}

function getKindHeader(kind: ImagePromptKind, prompt: string) {
  if (kind === "pose" && isSeparatePosePrompt(prompt)) {
    return "核心任务：生成一张独立的单姿势完整图片，保持图1同一人、同一衣服和同一人物比例；不要生成 2x2、四宫格、拼图、分屏或 contact sheet。";
  }

  return KIND_HEADERS[kind];
}

function isSeparatePosePrompt(prompt: string) {
  return /每个姿势单独生成一张完整图片|当前请求只生成一张|本次单图任务|只生成姿势\d|HARD TARGET POSE SLOT|standalone 3:4 photo|独立单图请求|Target pose:|Pose priority:|Creative freedom:|Reference only:|Reference lock:/.test(prompt);
}

function findFirstLine(lines: string[], pattern: RegExp) {
  return lines.find((line) => pattern.test(line));
}

function collectRequiredSignalLines(kind: ImagePromptKind, lines: string[]) {
  const used = new Set<string>();
  return REQUIRED_SIGNALS[kind]
    .map((signal) => {
      const line = lines.find((item) => signal.pattern.test(item));
      const selected = line || signal.fallback;
      const key = `${signal.name}:${selected}`;
      if (used.has(key)) return "";
      used.add(key);
      return selected;
    })
    .filter(Boolean);
}

function splitPromptIntoSignalLines(prompt: string) {
  return prompt
    .split("\n")
    .flatMap((line) => splitLongLine(line.trim()))
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitLongLine(line: string) {
  if (!line || line.length <= 420) return line ? [line] : [];

  const sentenceMatches = line.match(/[^。！？；.!?;]+[。！？；.!?;]?/g) || [line];
  const chunks: string[] = [];
  let current = "";

  sentenceMatches.forEach((sentence) => {
    const next = sentence.trim();
    if (!next) return;
    if ((current + next).length <= 420) {
      current = `${current}${next}`;
      return;
    }
    if (current) chunks.push(current);
    if (next.length <= 420) {
      current = next;
      return;
    }
    chunks.push(...splitOversizedSentence(next));
    current = "";
  });

  if (current) chunks.push(current);
  return chunks;
}

function splitOversizedSentence(sentence: string) {
  const parts = sentence.match(/[^，,、]+[，,、]?/g) || [sentence];
  const chunks: string[] = [];
  let current = "";

  parts.forEach((part) => {
    const next = part.trim();
    if (!next) return;
    if ((current + next).length <= 420) {
      current = `${current}${next}`;
      return;
    }
    if (current) chunks.push(current);
    current = next.length <= 420 ? next : next.slice(0, 420);
  });

  if (current) chunks.push(current);
  return chunks;
}

function normalizePrompt(prompt: string) {
  return prompt
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function dedupeLines(lines: string[]) {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const key = line.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function limitPrompt(prompt: string, maxChars: number) {
  if (prompt.length <= maxChars) return prompt;

  const lines = prompt.split("\n");
  const kept: string[] = [];
  let count = 0;
  for (const line of lines) {
    if (count + line.length + 1 > maxChars) continue;
    kept.push(line);
    count += line.length + 1;
  }

  const result = kept.join("\n").trim();
  return result || prompt.slice(0, maxChars).trim();
}
