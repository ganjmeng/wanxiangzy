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
  "Swap Face only changes facial features. It does not change the model's skin tone or hairstyle.";

export const DEFAULT_FACE_SWAP_TEXTURE_ENHANCE = false;
export const MAX_FACE_SWAP_SOURCE_IMAGES = 8;
export const MAX_FACE_SWAP_RESULT_IMAGES = MAX_FACE_SWAP_SOURCE_IMAGES * 4;

export const DEFAULT_FACE_SWAP_PROMPT = [
  "Use image 1 as the fixed base photo. Only perform a local facial-identity edit; do not recreate, reframe, beautify, or generate a new photo.",
  "Image 1 is the original model photo and the target canvas. Image 2 is the target face identity reference.",
  "Replace only the inner facial identity of the person in image 1 with the identity from image 2.",
  "Keep image 1 unchanged for body, pose, head angle, gaze direction, facial expression, hairstyle, hair color, skin tone, neck, body proportions, clothing, accessories, background, camera angle, framing, lighting, exposure, contrast, white balance, color temperature, shadows, highlights, grain/noise, and camera texture.",
  FACE_SWAP_NOTE,
  "Use image 2 only for facial identity geometry: eyes, eyebrows, nose, lips, cheekbones, jaw shape, face structure, and recognizable identity. Do not copy image 2 hairstyle, hairline style, skin tone, makeup style, accessories, expression, pose, clothing, background, or lighting.",
  "Preserve all source-image accessories exactly. If image 1 has glasses, sunglasses, tinted lenses, earrings, necklace, hat, rings, or hair accessories, keep their exact shape, color, transparency, reflection, position, and occlusion in front of the swapped face.",
  "Preserve the source facial expression and micro-expression from image 1, including mouth tension, eyelid openness, gaze direction, brow tension, and calm or serious mood. Do not replace it with the neutral expression from image 2.",
  "Preserve real skin texture from image 1: pores, freckles, moles, tiny blemishes, natural asymmetry, local redness, shadows, and realistic skin grain. Do not smooth skin, whiten skin, make porcelain skin, remove freckles or blemishes, or create a generic beauty face.",
  "Preserve image 1 garment design exactly: clothing color, print, logo, text, fabric texture, seams, folds, sleeve shape, hem, pants/skirt, styling, and hand-clothing interaction.",
  "Source tone lock: do not globally retouch, relight, recolor, HDR, increase clarity, increase local contrast, add sharpening, add super-resolution texture, add a commercial filter, or change the source photo's contrast/exposure balance.",
  "Fine textile safety: preserve stripes, ribs, knit, pants weave, mesh, plaid, logo/text and repeated patterns only at the scale visible in image 1; do not create moire, wavy fabric lines, water-ripple patterns, vibrating stripes, fake fibers, or invented textile detail.",
  "The transition around forehead, jawline, ears, neck, and hairline must be seamless and realistic. Keep the original model skin tone and do not whiten, tan, beautify, age-shift, change makeup style, change hairstyle, remove accessories, or change clothing.",
  "Output a photorealistic source-matched fashion photo with faithful source tone, natural pores, no face distortion, no extra people, no watermark, no AI-render look.",
].join("\n");

export const FACE_SWAP_TEXTURE_ENHANCE_PROMPT = [
  "服装轻量细节恢复规则：开启后仍以图1为固定底图，只允许在服装可见区域做保守的局部清晰度恢复；脸部身份仍只来自图2，不能把任务变成全图商业精修或重新生成照片。",
  "增强范围：在不改变图1服装款式、固有色、图案、logo、文字、版型、长度、穿搭关系、光线和阴影层次的前提下，轻量恢复原图已经存在的缝线、袖口、领口、下摆、纽扣、拉链、口袋边缘、自然褶皱、接触阴影和可见材质细节。",
  "影调锁定：增强服装时必须保持图1原始曝光、对比度、白平衡、色温、肤色、阴影/高光层次、颗粒/噪点和相机质感；不要全图调色、HDR、提高 clarity、提高局部反差、额外锐化、超分纹理、商业精修滤镜或干净曝光重算。",
  "细密纹理安全：细条纹、罗纹、针织、裤纹、网纱、格纹和重复图案只按图1可见尺度自然保留；不要把模糊区域脑补成高频织纹，不要生成摩尔纹、波纹、水波纹、频闪条纹、振荡线、假纤维或不存在的面料纹理。",
  "分区控制：只对服装做轻量局部细节恢复；脸部只能做自然融合，必须保留图1表情、肤色、毛孔、雀斑、痣、瑕疵和皮肤颗粒，不要磨皮、不要美白、不要网红脸。",
  "负面约束：不要改变服装结构、颜色、图形、文字或logo，不要新增不存在的纹样，不要把衣服变成另一种面料，不要塑料感、蜡像感、过锐化光晕、磨皮、雪白皮或AI渲染感。",
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
    "Hard rule: image 1 is the target canvas",
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
  const required = [
    "Hard rule: image 1 is the target canvas; image 2 is face identity only.",
    `Hard rule: ${FACE_SWAP_NOTE}`,
    "Hard rule: preserve image 1 expression, gaze, head angle, glasses, sunglasses, earrings, necklace, hat, and all accessories exactly.",
    "Hard rule: preserve pores, freckles, moles, blemishes, natural skin grain, original skin tone, and realistic facial asymmetry; no beauty smoothing or whitening.",
    "Hard rule: preserve source exposure, contrast, white balance, color temperature, shadows, highlights, grain/noise, and camera texture; do not globally retouch, relight, recolor, HDR, increase clarity, increase local contrast, add sharpening, or add a commercial filter.",
    "Hard rule: preserve fine textile patterns at source scale; do not create moire, wavy fabric lines, water-ripple patterns, vibrating stripes, fake fibers, or invented textile detail.",
    "Do not change body, pose, hairstyle, hair color, skin tone, clothing, garment print, accessories, background, lighting, exposure, contrast, camera, framing, or image 1 composition.",
    "Do not blend two identities; replace facial features cleanly and realistically while preserving original skin tone, expression, accessories, and hair.",
  ];
  if (hasTextureEnhancePrompt(normalized)) {
    required.push(
      "Hard rule: texture enhancement is active only as conservative local garment detail recovery; keep image 1 clothing structure, color, graphics, text, exposure, contrast, shadows, white balance, and composition unchanged.",
      "Hard rule: do not apply beauty smoothing, whitening, porcelain skin, generic makeup, face retouching, global sharpening, clarity boost, local contrast boost, or moire-prone fabric enhancement while recovering clothing detail."
    );
  }
  const missing = required.filter((line) => !normalized.includes(line));
  return missing.length ? `${normalized}\n\n${missing.join("\n")}` : normalized;
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
