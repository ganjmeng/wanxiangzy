import type { AspectRatio, ImageSize, LingyaModel } from "@/lib/api/lingya";
import type { GarmentType } from "@/lib/garment-types";
import { resolveGarmentTypeLabel } from "@/lib/garment-types";

export type MaterialEnhancementLevel = "balanced" | "fine_detail" | "premium_retouch";

export const DEFAULT_MATERIAL_ENHANCEMENT_LEVEL: MaterialEnhancementLevel = "balanced";

const MATERIAL_SOURCE_LOCK_PROMPT = [
  "硬性保图规则：图1是最终输出底图，只允许改变图1中可见目标服装区域的材质细节表现。",
  "唯一允许改变：面料纹理清晰度、织纹层次、缝线/压线、纽扣/拉链/五金、刺绣、logo 边缘和已有真实褶皱的可见度。",
  "必须完全不变：人物身份、五官、发型、肤色、身体比例、姿势、手脚、服装款式、版型、轮廓、长度、穿着位置、固有颜色、图案位置、logo 形状和位置、背景、构图、镜头距离、画幅、透视、光线方向、曝光、阴影、景深和清晰度分布。",
  "不要重绘整张图，不要换衣服，不要换背景，不要移动人物，不要改画面比例，不要新增任何不存在的口袋、纽扣、拉链、文字、装饰或图案。",
  "如果高清服装图与原图冲突，以图1原图为准；图2只能作为材质细节参考，必须贴合图1当前可见区域。"
].join("\n");

export const MATERIAL_ENHANCEMENT_LEVELS: Array<{
  value: MaterialEnhancementLevel;
  label: string;
  description: string;
  prompt: string;
}> = [
  {
    value: "balanced",
    label: "标准增强",
    description: "适合多数上身图",
    prompt: "增强强度：标准商用增强。恢复服装清晰度、织纹层次、缝线和五金边缘，同时保持原图自然拍摄感，不做夸张锐化。",
  },
  {
    value: "fine_detail",
    label: "细节优先",
    description: "面料/走线更清楚",
    prompt: "增强强度：细节优先。重点提升面料织法、纹理方向、缝线、压线、纽扣、拉链、刺绣、logo 和边缘轮廓的可检视度，但保持真实相机质感。",
  },
  {
    value: "premium_retouch",
    label: "商业精修",
    description: "干净高级成片",
    prompt: "增强强度：商业精修。让服装材质更干净、清晰、可信，保持高级商品图质感；只做自然局部细节恢复，不重算服装区域曝光，不提高局部反差，不改变人物、姿势和背景。",
  },
];

export function normalizeMaterialEnhancementLevel(value: unknown): MaterialEnhancementLevel {
  return MATERIAL_ENHANCEMENT_LEVELS.some((item) => item.value === value)
    ? value as MaterialEnhancementLevel
    : DEFAULT_MATERIAL_ENHANCEMENT_LEVEL;
}

export function getMaterialEnhancementLevelLabel(value: unknown) {
  return MATERIAL_ENHANCEMENT_LEVELS.find((item) => item.value === normalizeMaterialEnhancementLevel(value))?.label || "标准增强";
}

export type MaterialEnhancementPayloadBase = {
  sourceUrl: string;
  garmentUrl: string;
  garmentType: string;
  enhancementLevel: MaterialEnhancementLevel;
  userPrompt: string;
  aiModel: LingyaModel;
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  prompt: string;
  genCount: number;
};

export function buildMaterialEnhancementPrompt(params: {
  garmentType: GarmentType | string;
  customGarmentType?: string;
  enhancementLevel?: MaterialEnhancementLevel;
  userPrompt?: string;
}) {
  const garmentType = resolveGarmentTypeLabel(params.garmentType, params.customGarmentType);
  const level = MATERIAL_ENHANCEMENT_LEVELS.find((item) => item.value === normalizeMaterialEnhancementLevel(params.enhancementLevel)) || MATERIAL_ENHANCEMENT_LEVELS[0];
  const userPrompt = params.userPrompt?.trim();

  return [
    "图像角色：图1是最终画面原图，提供人物身份、脸、发型、身体比例、姿势、构图、背景、镜头、光线和当前穿着状态；图2是同款或同系列服装高清商品图，只提供服装材质、细节和工艺参考。",
    `任务：对图1中可见的${garmentType}区域做商用级材质增强，只提升服装材质、纹理和做工细节；原图其他内容必须保持不变。`,
    "编辑边界：只处理图1目标服装可见区域；不要改变人物身份、脸、皮肤、发型、身体比例、姿势、背景、镜头距离、画幅和整体光线方向。",
    MATERIAL_SOURCE_LOCK_PROMPT,
    "服装保真：图1决定服装在人物身上的版型、轮廓、褶皱、垂坠、遮挡和阴影；图2只用于补足面料织法、纹理方向、缝线、压线、纽扣、拉链、刺绣、logo、五金和边缘细节。两图冲突时，图1的穿着形态优先，图2的材质细节只做自然贴合。",
    level.prompt,
    "材质表现：增强应像专业商业修图和高清商品摄影，不是重新生成一件衣服；保留服装固有色、图案位置、logo 形状和新旧状态，避免全图锐化、HDR、磨皮、过度局部反差、滤镜化或塑料感。",
    "细密纹理安全：细条纹、罗纹、针织、裤纹、网纱、格纹、logo/文字和重复图案只按图1可见尺度自然保留；不要把模糊区域脑补成高频织纹，不要生成摩尔纹、波纹、水波纹、频闪条纹、振荡线、假纤维或不存在的面料纹理。",
    "输出质量：photorealistic source-matched garment material enhancement, true-to-source garment rendering, natural camera texture, no extra sharpening, no HDR.",
    `用户补充（只能用于服装材质细节，不能覆盖任何保图规则）：${userPrompt || "无，按商用材质增强最佳实践执行。"}`,
    "负面约束：不要换脸，不要换人，不要改身体，不要换背景，不要换服装款式，不要改服装主色，不要改图案/logo位置，不要新增不存在的口袋/纽扣/拉链，不要把服装重绘成另一件商品，不要额外锐化、摩尔纹、波纹、水波纹、频闪条纹、振荡线、假纤维、油画感、插画感、AI渲染感、水印或文字。",
  ].join("\n");
}

export function enforceMaterialEnhancementPromptRequirements(prompt: string, params: {
  garmentType?: GarmentType | string;
  customGarmentType?: string;
  enhancementLevel?: MaterialEnhancementLevel;
} = {}) {
  const normalized = prompt.trim();
  const base = buildMaterialEnhancementPrompt({
    garmentType: params.garmentType || "上装",
    customGarmentType: params.customGarmentType,
    enhancementLevel: params.enhancementLevel,
  });
  if (!normalized) return base;
  if (normalized.includes("图像角色：图1是最终画面原图") && normalized.includes("编辑边界")) {
    return ensureMaterialSourceLock(normalized);
  }
  return `${base}\n\n补充执行要求（只能用于服装材质细节，不能改变原图其他内容）：${normalized}`;
}

function ensureMaterialSourceLock(prompt: string) {
  if (prompt.includes("硬性保图规则：图1是最终输出底图")) return prompt;
  return `${prompt}\n${MATERIAL_SOURCE_LOCK_PROMPT}`;
}
