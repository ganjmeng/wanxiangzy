import {
  IMAGE_CREDIT_COSTS,
  IMAGE_MODEL_DISPLAY_ORDER,
  type PricedImageModel,
  type PricedImageSize,
} from "@/lib/model-pricing";
import type { AiModelLocalizedPresentation } from "@/lib/ai-control-plane/types";

export type ImageModelCatalogItem = {
  id: string;
  displayName: string;
  description?: string;
  creditPrices: Partial<Record<PricedImageSize, number>>;
  supportedSizes: PricedImageSize[];
  capabilities: string[];
  shortTitle?: string;
  badge?: string;
  iconUrl?: string;
  coverUrl?: string;
  group?: string;
  tags?: string[];
  sortOrder?: number;
  featured?: boolean;
  locales?: Record<string, AiModelLocalizedPresentation>;
};

const runtimeCatalog = new Map<string, ImageModelCatalogItem>();

export const LEGACY_IMAGE_MODEL_CATALOG: ImageModelCatalogItem[] = IMAGE_MODEL_DISPLAY_ORDER.map((id) => ({
  id,
  displayName: legacyDisplayName(id),
  creditPrices: legacyPrices(id),
  supportedSizes: legacySupportedSizes(id),
  capabilities: id === "z-image" ? ["generation"] : ["generation", "edit"],
}));

export function registerImageModelCatalog(items: readonly ImageModelCatalogItem[]) {
  runtimeCatalog.clear();
  for (const item of items) runtimeCatalog.set(item.id, item);
}

export function getRegisteredImageModel(modelId: string) {
  return runtimeCatalog.get(modelId);
}

export function getRegisteredImageCreditCost(modelId: string, size: PricedImageSize) {
  return runtimeCatalog.get(modelId)?.creditPrices[size];
}

export function getRegisteredImageSizes(modelId: string): PricedImageSize[] | undefined {
  const sizes = runtimeCatalog.get(modelId)?.supportedSizes;
  return sizes?.length ? [...sizes] : undefined;
}

export function isPricedImageModel(value: string): value is PricedImageModel {
  return Object.prototype.hasOwnProperty.call(IMAGE_CREDIT_COSTS, value);
}

function legacyDisplayName(id: PricedImageModel) {
  if (id === "nano-banana-2") return "Nano Banana 2";
  if (id === "nano-banana-2-lite") return "Nano Banana 2 Lite";
  if (id === "nano-banana-pro") return "Nano Banana Pro";
  if (id === "qwen3") return "Qwen3 Image";
  if (id === "qwen3-pro") return "Qwen3 Image Pro";
  if (id === "z-image") return "Z-Image";
  return "GPT Image 2";
}

function legacySupportedSizes(id: PricedImageModel): PricedImageSize[] {
  if (id === "nano-banana-2-lite" || id === "z-image") return ["1K"];
  if (id === "qwen3" || id === "qwen3-pro") return ["1K", "2K"];
  return ["1K", "2K", "4K"];
}

function legacyPrices(id: PricedImageModel): Partial<Record<PricedImageSize, number>> {
  return Object.fromEntries(legacySupportedSizes(id).map((size) => [size, IMAGE_CREDIT_COSTS[id][size]]));
}
