import {
  TRYON_CLOTHING_ROLE_LABELS,
  normalizeTryOnClothingMode,
  normalizeTryOnClothingRole,
  type TryOnClothingMode,
  type TryOnClothingRole,
} from "@/lib/tryon-upload-rules";

export type TryOnInputReference = {
  url: string;
  label: string;
};

export const TRYON_INPUT_REFERENCE_LIMIT = 19;

type TryOnInputReferenceParams = {
  clothingUrls?: unknown;
  clothingMode?: TryOnClothingMode | string | null;
  clothingRoles?: unknown;
  referenceUrl?: unknown;
  referenceUrls?: unknown;
  modelFaceUrl?: unknown;
  garmentDetailUrls?: unknown;
};

export function buildTryOnInputReferences(params: TryOnInputReferenceParams): TryOnInputReference[] {
  const clothingUrls = stringArray(params.clothingUrls);
  const clothingMode = normalizeTryOnClothingMode(params.clothingMode || (clothingUrls.length > 1 ? "multi" : "single"));
  const clothingRoles = Array.isArray(params.clothingRoles) ? params.clothingRoles : [];
  const references: TryOnInputReference[] = [];

  clothingUrls.forEach((url, index) => {
    const fallback = getFallbackClothingRole(clothingMode, index);
    const role = normalizeTryOnClothingRole(clothingRoles[index], fallback);
    references.push({
      url,
      label: TRYON_CLOTHING_ROLE_LABELS[role] || `服装${index + 1}`,
    });
  });

  const referenceUrls = stringArray(params.referenceUrls);
  const fallbackReferenceUrl = stringValue(params.referenceUrl);
  const allReferenceUrls = referenceUrls.length ? referenceUrls : fallbackReferenceUrl ? [fallbackReferenceUrl] : [];
  allReferenceUrls.forEach((url, index) => {
    references.push({ url, label: allReferenceUrls.length > 1 ? `参考图${index + 1}` : "参考图" });
  });

  const modelFaceUrl = stringValue(params.modelFaceUrl);
  if (modelFaceUrl) {
    references.push({ url: modelFaceUrl, label: "模特" });
  }

  stringArray(params.garmentDetailUrls).forEach((url, index) => {
    references.push({ url, label: `服装细节${index + 1}` });
  });

  return uniqueReferences(references).slice(0, TRYON_INPUT_REFERENCE_LIMIT);
}

export function getTryOnInputReferenceUrls(params: TryOnInputReferenceParams): string[] {
  return buildTryOnInputReferences(params).map((item) => item.url);
}

function getFallbackClothingRole(mode: TryOnClothingMode, index: number): TryOnClothingRole {
  if (mode !== "multi") return "single";
  if (index === 0) return "upper";
  if (index === 1) return "lower";
  return "extra";
}

function uniqueReferences(items: TryOnInputReference[]) {
  const seen = new Set<string>();
  const unique: TryOnInputReference[] = [];
  for (const item of items) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    unique.push(item);
  }
  return unique;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(stringValue).filter((item): item is string => Boolean(item));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
