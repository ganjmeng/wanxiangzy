import type { AspectRatio, ImageSize, LingyaModel } from "@/lib/api/lingya";
import faceSwapAssets from "@/lib/face-swap-assets.generated.json";

export type FaceSwapSampleImage = {
  id: number;
  url: string;
  width: number;
  height: number;
};

export type FaceSwapLibraryItem = {
  id: number;
  gender: "female" | "male";
  url: string;
  sort: number;
};

type GeneratedFaceSwapAssets = {
  sampleImages: FaceSwapSampleImage[];
  library: FaceSwapLibraryItem[];
};

const FACE_SWAP_ASSETS = faceSwapAssets as GeneratedFaceSwapAssets;

export const FACE_SWAP_SAMPLE_IMAGES: FaceSwapSampleImage[] = FACE_SWAP_ASSETS.sampleImages;
export const FACE_SWAP_LIBRARY: FaceSwapLibraryItem[] = FACE_SWAP_ASSETS.library;

if (process.env.NODE_ENV !== "production") {
  const legacy = [...FACE_SWAP_SAMPLE_IMAGES, ...FACE_SWAP_LIBRARY].find((asset) => isLegacyOssAssetUrl(asset.url));
  if (legacy) {
    console.warn("[face-swap] legacy OSS asset is still present; run scripts/sync-face-swap-assets.mjs", legacy);
  }
}

function isLegacyOssAssetUrl(url: string) {
  return url.includes("zhiyi-image.oss-cn-hangzhou.aliyuncs.com") || url.includes("aliyuncs.com/devops/comfyui");
}

export const FACE_SWAP_NOTE =
  "Swap Face only changes facial features. It does not change the model's skin tone or hairstyle. 换脸只改五官身份，不改模特肤色和发型。";

export const DEFAULT_FACE_SWAP_TEXTURE_ENHANCE = false;
export const MAX_FACE_SWAP_SOURCE_IMAGES = 8;
export const MAX_FACE_SWAP_RESULT_IMAGES = MAX_FACE_SWAP_SOURCE_IMAGES * 4;

// Single hard-rule marker. Centralized so enforce / isFaceSwapSystemPrompt
// / getFaceSwapUserPromptFromPayload all agree on idempotency.
export const FACE_SWAP_HARD_RULE_MARK = "【HARD 硬规则 · 换脸模式】";

// Hard rule (≤700 chars). Leads every face-swap prompt. Single-branch.
// Compresses the previous 7 inline "Hard rule: ..." lines into 3 numbered
// lines so the model sees the constraint up front instead of buried mid-prompt.
export const FACE_SWAP_HARD_RULE = `${FACE_SWAP_HARD_RULE_MARK}
1) 图1是固定底图：身体、姿势、头角度、眼神、表情、发型、发色、肤色、颈部、身材比例、服装、配件、背景、镜头、构图、光线、曝光、对比度、白平衡、色温、阴影、高光、颗粒/噪点、相机质感全部不变；只把图1五官身份替换为图2的五官。
2) 图2只提供五官几何：眼型、眉形、鼻形、唇形、颧骨、下颌线、脸型骨相、身份辨识度；不复制图2的发型、发际线、肤色、妆容、配件、表情、姿势、服装、背景、光线。
3) 必须保留：原图所有配饰（眼镜、墨镜、耳环、项链、帽子、戒指、发饰）的形状、颜色、透明度、反光、位置、遮挡；原图微表情（嘴部、眼睑开合、眼神、眉部）；原图真实皮肤纹理（毛孔、雀斑、痣、瑕疵、自然不对称、局部红润、阴影、皮肤颗粒）；原图服装（颜色、印花、logo、文字、面料纹理、缝线、褶皱、袖形、下摆）。
${FACE_SWAP_NOTE}`;

export const DEFAULT_FACE_SWAP_PROMPT = [
  FACE_SWAP_HARD_RULE,
  "Use image 1 as the fixed base photo. Only perform a local facial-identity edit; do not recreate, reframe, beautify, or generate a new photo.",
  "Image 1 is the original model photo and the target canvas. Image 2 is the target face identity reference.",
  "Replace only the inner facial identity of the person in image 1 with the identity from image 2.",
  "源色调锁定：不要全局调色、不要重打光、不要 HDR、不要提高 clarity、不要提高局部反差、不要额外锐化、不要超分纹理、不要加商业滤镜，不要改变图1原始曝光/对比度平衡。",
  "细密纹理安全：细条纹、罗纹、针织、裤纹、网纱、格纹、logo/文字和重复图案只按图1可见尺度自然保留；不要把模糊区域脑补成高频织纹，不要生成摩尔纹、波纹、水波纹、频闪条纹、振荡线、假纤维或不存在的面料纹理。",
  "过渡自然：额头、下颌线、耳朵、颈部、发际线过渡必须无缝真实；保持原图肤色，不要美白、不要美黑、不要少女化、不要老龄化、不要改妆容、不要改发型、不要去除配件、不要改服装。",
  "输出：photorealistic source-matched fashion photo, faithful source tone, natural pores, no face distortion, no extra people, no watermark, no AI-render look.",
].join("\n");

export const FACE_SWAP_TEXTURE_ENHANCE_PROMPT = [
  `${FACE_SWAP_HARD_RULE_MARK} · 增强模式
1) 服装轻量细节恢复规则：开启后仍以图1为固定底图，只允许在服装可见区域做保守的局部清晰度恢复；脸部身份仍只来自图2，不能把任务变成全图商业精修或重新生成照片。
2) 增强范围：在不改变图1服装款式、固有色、图案、logo、文字、版型、长度、穿搭关系、光线和阴影层次的前提下，轻量恢复原图已经存在的缝线、袖口、领口、下摆、纽扣、拉链、口袋边缘、自然褶皱、接触阴影和可见材质细节。
3) 影调锁定：增强服装时必须保持图1原始曝光、对比度、白平衡、色温、肤色、阴影/高光层次、颗粒/噪点和相机质感；不要全图调色、HDR、提高 clarity、提高局部反差、额外锐化、超分纹理、商业精修滤镜或干净曝光重算。
4) 细密纹理安全：细条纹、罗纹、针织、裤纹、网纱、格纹和重复图案只按图1可见尺度自然保留；不要把模糊区域脑补成高频织纹，不要生成摩尔纹、波纹、水波纹、频闪条纹、振荡线、假纤维或不存在的面料纹理。
5) 分区控制：只对服装做轻量局部细节恢复；脸部只能做自然融合，必须保留图1表情、肤色、毛孔、雀斑、痣、瑕疵和皮肤颗粒，不要磨皮、不要美白、不要网红脸。
6) 负面约束：不要改变服装结构、颜色、图形、文字或logo，不要新增不存在的纹样，不要把衣服变成另一种面料，不要塑料感、蜡像感、过锐化光晕、磨皮、雪白皮或AI渲染感。`,
].join("\n");

export function buildFaceSwapPrompt(extra?: string, textureEnhance = DEFAULT_FACE_SWAP_TEXTURE_ENHANCE) {
  const userExtra = typeof extra === "string" ? extra.trim() : "";
  const parts = [DEFAULT_FACE_SWAP_PROMPT];
  if (textureEnhance) parts.push(FACE_SWAP_TEXTURE_ENHANCE_PROMPT);
  if (userExtra) parts.push(`User extra instruction: ${userExtra}`);
  return parts.join("\n\n");
}

export function normalizeFaceSwapTextureEnhance(value: unknown) {
  if (value === true || value === "true" || value === "1" || value === 1) return true;
  if (value === false || value === "false" || value === "0" || value === 0) return false;
  return DEFAULT_FACE_SWAP_TEXTURE_ENHANCE;
}

export function isFaceSwapSystemPrompt(value: string) {
  const normalized = value.trim();
  if (!normalized) return false;
  return [
    "Image 1 is the original model photo and the target canvas.",
    "Image 2 is the target face identity reference.",
    "Replace only the inner facial identity",
    FACE_SWAP_HARD_RULE_MARK,
  ].some((marker) => normalized.includes(marker));
}

export function getFaceSwapUserPromptFromPayload(payload: { prompt?: unknown; userPrompt?: unknown }) {
  if (typeof payload.userPrompt === "string") return payload.userPrompt.trim();

  const storedPrompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  if (!storedPrompt) return "";

  const marker = "User extra instruction:";
  const markerIndex = storedPrompt.lastIndexOf(marker);
  if (markerIndex >= 0) {
    const extraBlock = storedPrompt.slice(markerIndex + marker.length).trim();
    const hardRuleIndex = extraBlock.search(/\n\s*Hard rule:/);
    return (hardRuleIndex >= 0 ? extraBlock.slice(0, hardRuleIndex) : extraBlock).trim();
  }

  return isFaceSwapSystemPrompt(storedPrompt) ? "" : storedPrompt;
}

export function enforceFaceSwapPromptRequirements(prompt: string) {
  const normalized = prompt.trim() || DEFAULT_FACE_SWAP_PROMPT;
  // Idempotency: if marker is present, assume the hard rule is already
  // composed. The old "Hard rule: image 1 is the target canvas" string is
  // still kept as a back-compat marker so older prompts round-trip cleanly.
  if (normalized.includes(FACE_SWAP_HARD_RULE_MARK)) return normalized;
  if (normalized.includes("Hard rule: image 1 is the target canvas")) return normalized;
  return `${DEFAULT_FACE_SWAP_PROMPT}\n\n${normalized}`;
}

function hasTextureEnhancePrompt(prompt: string) {
  return /服装质感增强规则|服装轻量细节恢复规则|Texture enhancement mode|texture enhancement is active/i.test(prompt);
}

export function normalizeFaceSwapCount(value: unknown) {
  const count = Number(value || 1);
  if (!Number.isFinite(count)) return 1;
  return Math.min(Math.max(Math.floor(count), 1), 4);
}

export function normalizeFaceSwapSourceUrls(value: unknown, fallback?: unknown) {
  const values = Array.isArray(value) ? value : [];
  const allValues = values.length ? values : fallback !== undefined ? [fallback] : [];
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const item of allValues) {
    if (typeof item !== "string") continue;
    const url = item.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= MAX_FACE_SWAP_SOURCE_IMAGES) break;
  }

  return urls;
}

export type FaceSwapApiPayload = {
  sourceUrl: string;
  sourceUrls?: string[];
  faceUrl: string;
  aiModel: LingyaModel;
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  userPrompt?: string;
  prompt: string;
  genCount: number;
  textureEnhance?: boolean;
};
