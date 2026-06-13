export const MAX_GARMENT_DETAIL_IMAGES = 5;

export const GARMENT_DETAIL_SWITCH_DESCRIPTION =
  "默认关闭；仅在面料、领口、口袋、背面/侧面等细节需要保真时开启。开启后最多上传 5 张细节图，只用于补充服装局部材质与做工，不改变人物、姿势、背景、曝光、对比度、白平衡、服装款式和主色，也不强化细密条纹或裤纹。";

export const GARMENT_DETAIL_UPLOAD_FOOTNOTE =
  "最佳实践：优先传清晰、近距离、无滤镜的原商品细节图；每张只表达一个部位。图片会追加在数组尾部，仅作服装局部细节参考，不参与现有图1/图2编号。";

export function normalizeGarmentDetailUrls(value: unknown, max = MAX_GARMENT_DETAIL_IMAGES): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") continue;
    const url = item.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= max) break;
  }

  return urls;
}

export function buildGarmentDetailReferencePrompt(count: number) {
  const safeCount = Math.min(Math.max(Math.floor(Number(count) || 0), 0), MAX_GARMENT_DETAIL_IMAGES);
  if (!safeCount) return "";
  const imageWord = safeCount === 1 ? "image" : "images";

  return [
    `Garment detail references: the final ${safeCount} appended input ${imageWord} are optional detail references for the existing garment only.`,
    "Use them only to recover local clothing details such as fabric weave, collar, cuffs, pockets, zipper/buttons, logo/text, back view, side view, lining, stitching, seams, and close-up construction.",
    "They are appended after all existing task images and must not change the existing image-reference numbering or the main source/target relationship.",
    "If any detail reference conflicts with the main garment/source image, the main garment/source image wins.",
    "Do not change the person, pose, face, body proportions, background, camera framing, exposure, contrast, white balance, overall color grade, garment silhouette, main color, pattern placement, or logo placement.",
    "Do not sharpen or invent dense stripes, trouser texture, moire, fake weave, or noisy fibers; apply only light, local, realistic garment-detail recovery.",
  ].join(" ");
}
