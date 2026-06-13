import type { AspectRatio, ImageSize, LingyaModel } from "@/lib/api/lingya";

const SITE_ASSET_BASE = "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original";

export type ModelBackgroundMode = "model_background" | "background_only" | "model_only";
export type BackgroundSourceMode = "preset" | "upload" | "text" | "auto";
export type BackgroundPresetId =
  | "cafe-courtyard"
  | "red-brick-white-wall"
  | "sunny-lawn"
  | "reef-seaside"
  | "distant-mountain-lake"
  | "summer-hydrangea"
  | "romantic-street"
  | "forest-studio"
  | "brown-backdrop";

export type PresetModel = {
  id: string;
  name: string;
  imageUrl: string;
};

export type ModelBackgroundRuleDemo = {
  title: string;
  description: string;
  imageUrl: string;
};

export type BackgroundPreset = {
  id: BackgroundPresetId;
  name: string;
  imageUrl: string;
  prompt: string;
};

export const MODEL_BACKGROUND_MODE_LABELS: Record<ModelBackgroundMode, string> = {
  model_background: "换模特换背景",
  background_only: "只换背景",
  model_only: "只换模特",
};

export const BACKGROUND_SOURCE_LABELS: Record<BackgroundSourceMode, string> = {
  preset: "预设背景",
  upload: "上传背景",
  text: "文生背景",
  auto: "自动设计",
};

export const PRESET_BACKGROUND_MODELS: PresetModel[] = [
  { id: "m0", name: "自然", imageUrl: `${SITE_ASSET_BASE}/models/model-natural-smile.jpg` },
  { id: "m1", name: "甜妹", imageUrl: `${SITE_ASSET_BASE}/models/model-18542-0875a4d282bb.jpg` },
  { id: "m2", name: "优雅", imageUrl: `${SITE_ASSET_BASE}/models/model-22921-89d4664cd1b0.jpg` },
  { id: "m3", name: "红裙", imageUrl: `${SITE_ASSET_BASE}/models/model-26829-dca5c791efa8.jpg` },
  { id: "m4", name: "酷飒", imageUrl: `${SITE_ASSET_BASE}/models/model-97612-bdc397740113.jpg` },
  { id: "m5", name: "清纯", imageUrl: `${SITE_ASSET_BASE}/models/model-35127-693ee11382eb.png` },
  { id: "m6", name: "清透", imageUrl: `${SITE_ASSET_BASE}/models/model-clear-black-long-20260502.png` },
];

export const MODEL_BACKGROUND_UPLOAD_RULE = {
  title: "请上传需要处理的人物/穿搭原图",
  uploadSpecText: "文件大小在20KB~15MB之间，分辨率大于400*400，格式支持jpg/jpeg/png/heic/webp",
  demos: [
    {
      title: "模特图 1",
      description: "人物主体完整，服装清晰，适合换模特或换背景",
      imageUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/i.ibb.co/Nnb8n8xg/model-bg-demo-model-1-3e7d00ee48.webp",
    },
    {
      title: "模特图 2",
      description: "全身穿搭清楚，人物边界明确，适合生成种草氛围图",
      imageUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/i.ibb.co/v4fFMsQL/model-bg-demo-model-2-fabb161f17.webp",
    },
    {
      title: "模特图 3",
      description: "人物姿态自然，服装和配件关系清晰",
      imageUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/i.ibb.co/vCybGS35/model-bg-demo-model-3-6447e8d07b.webp",
    },
    {
      title: "模特图 4",
      description: "主图完整可识别，适合换模特、换背景和只换背景",
      imageUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/i.ibb.co/GSD7gQP/model-bg-demo-model-4-509697bd7d.webp",
    },
  ] satisfies ModelBackgroundRuleDemo[],
  badExamples: [
    { title: "平铺图", imageUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/i.ibb.co/Rkkg54Ym/model-bg-bad-flat-lay-14a795a3e1.png" },
    { title: "挂拍图", imageUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/i.ibb.co/CKsLjqL0/model-bg-bad-hanging-7e7af9617c.png" },
    { title: "无肢体人台图", imageUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/i.ibb.co/hJgBmLV6/model-bg-bad-mannequin-516d36ef05.png" },
    { title: "不完整的商品", imageUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/i.ibb.co/271M6jtD/model-bg-bad-incomplete-a097e08ab0.png" },
  ],
} as const;

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  {
    id: "cafe-courtyard",
    name: "网红店庭院",
    imageUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/i.ibb.co/Jw2f4PcC/bg-cafe-courtyard-26119de07a.jpg",
    prompt: "网红店庭院背景，精致商业空间、自然日光、适合小红书种草和品牌 Lookbook。",
  },
  {
    id: "red-brick-white-wall",
    name: "红砖白墙",
    imageUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/i.ibb.co/WNBwzNNj/bg-red-brick-602adeccd3.jpg",
    prompt: "红砖白墙背景，干净室内空间、柔和自然光、轻复古质感，适合突出服装轮廓和真实穿搭。",
  },
  {
    id: "sunny-lawn",
    name: "阳光草坪",
    imageUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/i.ibb.co/GrtfjhK/bg-sunny-lawn-53bac7a546.jpg",
    prompt: "阳光草坪背景，明亮户外自然光、清新生活方式氛围，人物阴影和草地接触关系自然。",
  },
  {
    id: "reef-seaside",
    name: "礁石海边",
    imageUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/i.ibb.co/7JzNFYD3/bg-reef-seaside-d91ba8f17d.jpg",
    prompt: "礁石海边户外背景，海风感、自然天光、清爽度假氛围，空间开阔但不抢服装主体。",
  },
  {
    id: "distant-mountain-lake",
    name: "远山湖泊",
    imageUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/i.ibb.co/M5fjTvkG/bg-mountain-lake-aac995240f.jpg",
    prompt: "远山湖泊自然背景，柔和户外光、通透空气感、安静旅行氛围，人物和服装自然融入。",
  },
  {
    id: "summer-hydrangea",
    name: "夏日绣球",
    imageUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/i.ibb.co/spTk4hV0/bg-hydrangea-2f8323696f.jpg",
    prompt: "夏日绣球花园背景，清新自然光、柔和花影、明亮生活方式氛围，适合轻盈女装。",
  },
  {
    id: "romantic-street",
    name: "浪漫街头",
    imageUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/i.ibb.co/V004GhLP/bg-romantic-street-85e09fa3af.jpg",
    prompt: "浪漫街头背景，城市街拍氛围、柔和自然光、轻松出门感，人物曝光、阴影、边缘和街道路面自然统一。",
  },
  {
    id: "forest-studio",
    name: "森系棚拍",
    imageUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/i.ibb.co/dSJrqSc/bg-forest-studio-3c9f108d93.jpg",
    prompt: "森系棚拍背景，干净室内布景、柔和棚拍光、自然绿植氛围，突出服装质感。",
  },
  {
    id: "brown-backdrop",
    name: "棕色背景",
    imageUrl: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/remote/i.ibb.co/TBkCW0SF/bg-brown-backdrop-1262c2052a.jpg",
    prompt: "棕色纯色背景，干净棚拍质感、暖调商业光，适合突出人物轮廓和服装细节。",
  },
];

export const DEFAULT_BACKGROUND_TEXT = "午后阳光斑驳的时尚街区或有格调的咖啡店门口，真实自然光，干净高级，适合服装种草内容。";

export const MODEL_BACKGROUND_USER_PROMPT_PLACEHOLDER = "可选：例如保留原图人物肤色与衣服细节，画面真实自然，像可直接发布的品牌内容图。";

export const BACKGROUND_TEXT_PRESETS = [
  "午后阳光斑驳的街区，浅景深，真实街拍感",
  "高级咖啡店门口，暖色自然光，生活方式种草",
  "干净室内白墙与木地板，柔和窗光，Lookbook 质感",
  "电梯镜面自拍场景，真实手机拍摄，全身穿搭清晰",
  "试衣间全身镜，柔和顶光，真实试穿分享氛围",
  "城市街角斑马线，轻微动态抓拍，时尚街拍气质",
];

export function normalizeModelBackgroundMode(value: unknown): ModelBackgroundMode {
  return value === "background_only" || value === "model_only" || value === "model_background" ? value : "background_only";
}

export function normalizeBackgroundSourceMode(value: unknown): BackgroundSourceMode {
  return value === "upload" || value === "text" || value === "auto" || value === "preset" ? value : "preset";
}

export function normalizeBackgroundPreset(value: unknown): BackgroundPresetId {
  return BACKGROUND_PRESETS.some((item) => item.id === value) ? value as BackgroundPresetId : "cafe-courtyard";
}

export function getBackgroundPreset(presetId: BackgroundPresetId) {
  return BACKGROUND_PRESETS.find((item) => item.id === presetId) || BACKGROUND_PRESETS[0];
}

const MODEL_BACKGROUND_HARD_RULE_MARK = "【HARD 硬规则 · 换景身份模式】";
const MODEL_BACKGROUND_PRODUCT_FIDELITY_RULE =
  "服装产品保真：图1服装按商品资产处理，锁定品类、版型、固有色、图案/logo、面料表面、穿着层次和清洁度；换背景/换模特只允许调整环境光、投影、接触阴影和边缘融合，不重新设计布料、不套风格滤镜。";

// Resolve the explicit caller mode today. Centralized so the prompt builder,
// enforce, and downstream callers agree on the hard-rule branch.
//
// We treat the caller's `mode` as authoritative (no "auto" yet). This
// function is a decision POINT for future auto-mode logic; today it just
// passes the caller mode through, but a single switch here keeps the
// rest of the file single-branch on a string.
export function decideModelBackgroundMode(params: {
  mode: ModelBackgroundMode;
  hasModelReference: boolean;
  hasBackgroundReference: boolean;
}): ModelBackgroundMode {
  return params.mode;
}

function buildModelBackgroundHardRule(params: {
  mode: ModelBackgroundMode;
  hasModelReference: boolean;
  hasBackgroundReference: boolean;
}) {
  const resolvedMode = decideModelBackgroundMode(params);
  const modelIndex = params.hasModelReference ? "图2" : "模特参考";
  const backgroundIndex = params.hasModelReference ? "图3" : "图2";

  if (resolvedMode === "background_only") {
    return `${MODEL_BACKGROUND_HARD_RULE_MARK}
1) 只换背景。图1是唯一人物和唯一服装来源，保留同一张脸、发型、肤色、身材比例、衣服、穿搭和主体姿态。
2) ${MODEL_BACKGROUND_PRODUCT_FIDELITY_RULE}
3) ${params.hasBackgroundReference ? `${backgroundIndex} 只提供无人环境参考：场景、空间透视、光线、色彩、景深、墙面、地面、建筑、绿植等。忽略 ${backgroundIndex} 里的人物、脸、衣服、包、配饰和姿势。` : "没有背景参考图时，只根据文字描述更换背景。"}
4) 必须把图1人物真实放进新环境，不要像抠图贴上去：根据新背景重新匹配光线方向、色温、曝光、对比度、景深、镜头距离、地面透视和人物尺度；在脚下、腿部、衣摆、鞋子与地面接触处生成自然接触阴影和环境反射；人物边缘、发丝、袖口、裙摆和鞋底边界要自然融合，没有白边、硬切边、漂浮感或贴纸感。
5) 任何冲突都以图1人物和服装为准。`;
  }

  if (resolvedMode === "model_background") {
    return `${MODEL_BACKGROUND_HARD_RULE_MARK}
1) 换模特换背景。图1是唯一服装/穿搭来源，不能被任何参考图替换。
2) ${MODEL_BACKGROUND_PRODUCT_FIDELITY_RULE}
3) ${modelIndex} 是必选模特参考图，只参考脸型气质、五官比例、肤色、发型和身材比例，不复制服装或背景。
4) ${params.hasBackgroundReference ? `${backgroundIndex} 只参考背景场景、光线、色彩和空间氛围；忽略其中人物、衣服、包、配饰和姿势。` : "没有背景参考图时，根据文字或预设设计背景。"}
5) 生成的人物必须自然融入新环境：统一光线方向、色温、曝光、对比度、景深、镜头距离和地面透视；脸部、颈部、手臂等可见皮肤要处在同一套光影和肤色连续性里，头部大小、颈肩衔接和头身比真实自然；脚下与地面有可信接触阴影，边缘没有抠图白边、硬切边或漂浮感。`;
  }

  // model_only (face swap)
  return `${MODEL_BACKGROUND_HARD_RULE_MARK}
1) 只换模特脸部。图1是唯一身体、服装、发型、姿势、构图、背景、头部位置、头部大小、颈肩衔接和光影来源；只把图1脸部身份/五官替换为${modelIndex}的脸部特征。
2) 禁止合成新脸、禁止面具边缘、禁止改头部比例、禁止复制模特图的身体或服装。
3) 最终脸部肤色、曝光、色温、阴影、噪点和清晰度必须匹配图1的颈部、身体和整体摄影质感；脸、颈和可见身体皮肤要自然连续。`;
}

export function enforceModelBackgroundPromptRequirements(prompt: string, params: {
  mode: ModelBackgroundMode;
  hasModelReference: boolean;
  hasBackgroundReference: boolean;
}) {
  const resolvedMode = decideModelBackgroundMode(params);
  const normalized = prompt.trim();
  if (!normalized) return buildModelBackgroundHardRule({ ...params, mode: resolvedMode });
  if (normalized.includes(MODEL_BACKGROUND_HARD_RULE_MARK)) return normalized;
  return `${buildModelBackgroundHardRule({ ...params, mode: resolvedMode })}

${normalized}`;
}

export function buildModelBackgroundPrompt(params: {
  mode: ModelBackgroundMode;
  backgroundSource: BackgroundSourceMode;
  templateId: BackgroundPresetId;
  backgroundText: string;
  userPrompt: string;
  hasModelReference: boolean;
  hasBackgroundReference: boolean;
}) {
  const preset = getBackgroundPreset(normalizeBackgroundPreset(params.templateId));
  const modelIndex = params.hasModelReference ? "图2" : "模特参考";
  const backgroundIndex = params.hasModelReference ? "图3" : "图2";
  const hardRule = buildModelBackgroundHardRule({
    mode: params.mode,
    hasModelReference: params.hasModelReference,
    hasBackgroundReference: params.hasBackgroundReference,
  });

  const modeRule = params.mode === "background_only"
    ? "只替换背景和拍摄场景，图1人物与服装保持不变。"
    : params.mode === "model_only"
      ? "只替换图1的脸部身份/五官，保留图1身体、发型、服装、姿势、构图、光线和背景。"
      : "同时替换模特和背景，模特参考图必选，但图1服装与穿搭必须保持一致。";

  const modelRule = params.mode !== "background_only"
    ? params.hasModelReference
      ? params.mode === "model_only"
        ? `${modelIndex} 只参考脸部身份、五官、脸型、自然肤色范围、年龄感和气质；头部大小、颈肩衔接、光线方向、色温、曝光和最终肤色连续性跟随图1，不要复制其发型、身体、服装、背景或姿势。`
        : `${modelIndex} 是必选模特参考图，只参考人物脸型气质、五官比例、肤色、发型和身材比例，不复制其衣服或背景。`
      : "缺少模特参考图：当前模式需要用户选择系统预设模特或上传模特图后才能生成。"
    : "不要读取或生成新的模特身份，图1人物必须保持。";

  const backgroundRule = params.mode !== "model_only"
    ? params.backgroundSource === "preset"
      ? `${backgroundIndex} 是预设背景参考图：${preset.name}。只参考场景、光线、色彩、空间感、镜头距离和景深；不要复制图里的真人、脸、发型、穿搭、包、配饰和姿势。${preset.prompt}`
      : params.hasBackgroundReference
        ? `${backgroundIndex} 只提供背景氛围，只取场景、光线、色彩、空间感、镜头距离和景深，让图1人物/穿搭自然融入。`
      : params.backgroundSource === "auto"
        ? "自动设计背景：根据图1服装风格选择真实街拍、咖啡店、居家、试衣间、电梯自拍或 Lookbook 场景。"
        : `文生背景：${params.backgroundText.trim() || DEFAULT_BACKGROUND_TEXT}`
    : "不要改变图1原始背景、空间关系、光线方向和构图。";

  const integrationRule = params.mode !== "model_only"
    ? "融合：人物不是贴纸合成，必须根据新背景重新渲染整体自然光影。匹配背景的主光方向、环境光、色温、曝光、对比度、景深、镜头高度、地面透视和人物尺度；补充脚下接触阴影、腿部/衣摆/鞋底遮挡关系和轻微环境反光。环境光可以影响服装明暗，但不能改变服装固有色或面料表面。禁止白边、硬边、漂浮、比例不对、脚不落地、人物过亮或背景过暗。"
    : "融合：只替换脸部身份，头部位置、头部大小、头身比、颈肩衔接、脸部光线、肤色、清晰度、噪点和镜头质感必须匹配图1原图；脸、颈部和可见身体皮肤要自然连续，不要出现换脸贴片感、面具边缘、不同图层光影或头部比例变化。";

  const userPromptText = params.userPrompt.trim();

  const modelRoleText = params.mode === "model_only"
    ? ` ${modelIndex} 是脸部参考图，只用于替换图1脸部。`
    : params.mode === "model_background"
      ? ` ${modelIndex} 是必选模特参考图。`
      : "";

  return `${hardRule}

换背景生成任务。
图像角色：图1是原始人物/服装/穿搭图。${modelRoleText}${params.mode !== "model_only" ? ` ${backgroundIndex} 如存在，只提供背景氛围。` : ""}

目标：生成真实、自然、高级的服装视觉内容图，适合电商、社媒种草和品牌内容。
模式：${modeRule}
模特：${modelRule}
背景：${backgroundRule}
${integrationRule}
${MODEL_BACKGROUND_PRODUCT_FIDELITY_RULE}
服装：保持图1服装的品类、版型、颜色、图案/logo、面料纹理、穿着层次和搭配关系；允许自然贴合身体产生真实褶皱和阴影，不改款、不换色。
摄影：自然光影，白平衡准确，肤色真实不过白，人物比例稳定，手指和肢体自然。
用户补充：${userPromptText || "无，按以上模式和硬规则执行。"}

输出质量：photorealistic commercial fashion lifestyle photography, reference-matched exposure/contrast and color mood, true-to-source garment rendering, natural skin texture, natural camera texture.
避免：改变图1服装、丢失图案文字、把服装重绘成新材质或滤镜风格、额外锐化、摩尔纹、波纹、水波纹、频闪条纹、振荡线、假纤维、多余人物、复制背景参考图里的人物/衣服/包/配饰/姿势、肢体畸形、手指错误、塑料皮肤、AI 渲染感、水印、文字。`;
}

export type ModelBackgroundPayloadBase = {
  sourceUrl: string;
  modelReferenceUrl?: string | null;
  backgroundReferenceUrl?: string | null;
  mode: ModelBackgroundMode;
  backgroundSource: BackgroundSourceMode;
  templateId: BackgroundPresetId;
  backgroundText: string;
  userPrompt: string;
  aiModel: LingyaModel;
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  prompt: string;
  genCount: number;
};
