export const MAX_GARMENT_DETAIL_IMAGES = 5;

export const GARMENT_DETAIL_SWITCH_DESCRIPTION =
  "用来补充服装的局部细节，比如面料、领口、口袋、纽扣，或者背面、侧面。开启后最多 5 张，不会改动人物、姿势、背景和整体色调。";

export const GARMENT_DETAIL_UPLOAD_FOOTNOTE =
  "拍得越清晰、越近距离越好。每张只拍一个部位就够了，比如只拍领口、或只拍袖口。";

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

  return [
    `服装细节：附加的 ${safeCount} 张图只用于补充当前服装的局部细节（领口、袖口、口袋、纽扣、拉链、背面、侧面等）。`,
    `冲突时以主图为准，只做轻量、局部的真实感恢复，不强化任何纹理、条纹或织法。`,
  ].join("");
}

/**
 * 友商风格主任务模板：把"图编号 ↔ 角色"映射成一句话动作链，模型直接照做。
 * 适用于服装上身（tryon）：图 1 = 参考原图，图 2 = 服装，图 3 = 模特脸，图 4+ = 细节补充。
 */
export function buildTryOnRoleBasedPrompt(params: {
  hasModelFace: boolean;
  detailCount: number;
}) {
  const detailPart = params.detailCount > 0
    ? `图 4 及之后共 ${params.detailCount} 张为图 2 服装的局部细节补充（领口、口袋、纽扣、背面、侧面等），精准还原这些局部特征，不放大任何纹理或条纹。`
    : "";

  const facePart = params.hasModelFace
    ? `2. 把图 3 的面部五官、脸型、骨相、肤色、发型完整移植到图 1。`
    : "";

  return [
    `服装上身：图 1 是参考原图（保留姿势、构图、背景、整体色调不变）。在此基础上完成精准替换：`,
    `1. 把图 2 的服装（版型、长度、颜色、图案、材质）完整替换到图 1 的人物身上；`,
    facePart,
    detailPart,
    `最终输出一张真实自然的融合图：服装是图 2 的${params.hasModelFace ? "，脸是图 3 的" : ""}，姿势和场景是图 1 的。`,
  ].filter(Boolean).join("");
}
