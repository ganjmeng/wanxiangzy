import { getSupportedImageSizes, type AspectRatio, type ImageSize, type LingyaModel } from "@/lib/api/lingya";
import {
  PRODUCT_SET_PRESET_PLANS,
  normalizeProductSetVisualDirectorPlan,
  shouldUseModelForTemplate,
  type ProductSetCreationMode,
  type ProductSetCustomTemplate,
  type ProductSetFontStyle,
  type ProductSetImageType,
  type ProductSetModuleOverride,
  type ProductSetProductProfile,
  type ProductSetResolvedTemplate,
  type ProductSetSettings,
} from "@/lib/product-set";

const SUPPORTED_MODELS: LingyaModel[] = [
  "gpt-image-2",
  "nano-banana-2",
  "nano-banana-pro",
  "qwen3",
  "qwen3-pro",
];

const SUPPORTED_ASPECTS: AspectRatio[] = ["auto", "4:3", "3:4", "9:16", "16:9", "1:1", "3:2", "2:3", "21:9"];

export type SavedProductSetPlanModule = {
  name: string;
  moduleRole: string;
  aspectRatio: AspectRatio;
  source: ProductSetResolvedTemplate["source"];
  usesModel: boolean;
};

export type SavedProductSetPlan = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  mode: ProductSetCreationMode;
  imageType: ProductSetImageType;
  genCount: number;
  settings: ProductSetSettings;
  selectedTemplateIds: number[];
  customTemplates: ProductSetCustomTemplate[];
  moduleOverrides: ProductSetModuleOverride[];
  aiModel: LingyaModel;
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  qualityMode: "standard" | "advanced";
  planPreview: SavedProductSetPlanModule[];
};

export type FavoritePlanApplyState = {
  mode: ProductSetCreationMode;
  planSourceTab: ProductSetPlanSourceTab;
  selectedPlanId: string;
  imageType: ProductSetImageType;
  selectedTemplateIds: number[];
  customTemplates: ProductSetCustomTemplate[];
  moduleOverrides: ProductSetModuleOverride[];
  settings: ProductSetSettings;
  aiModel: LingyaModel;
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  qualityMode: "standard" | "advanced";
  genCount: number;
};

export type ProductSetPlanSourceTab = "smart" | "preset" | "upload" | "favorites";

export function cloneProductSetUiState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function buildDefaultFavoritePlanName(
  productName: string,
  imageType: ProductSetImageType,
  isPlaceholderProductName: (name: string) => boolean = (name) => !name.trim()
) {
  const cleanedName = productName.trim();
  const base = cleanedName && !isPlaceholderProductName(cleanedName)
    ? cleanedName
    : imageType === "details" ? "AI详情页方案" : "AI主图方案";
  return `${base} · ${imageType === "details" ? "详情页" : "主图"}`.slice(0, 40);
}

export function buildFavoritePlanPreview(
  templates: ProductSetResolvedTemplate[],
  productProfile: ProductSetProductProfile
): SavedProductSetPlanModule[] {
  return templates.slice(0, 12).map((template) => ({
    name: template.name,
    moduleRole: template.moduleRole,
    aspectRatio: template.aspectRatio,
    source: template.source,
    usesModel: shouldUseModelForTemplate(template, productProfile),
  }));
}

export function buildSavedProductSetPlan(input: {
  existingPlan?: SavedProductSetPlan;
  name: string;
  now: string;
  mode: ProductSetCreationMode;
  imageType: ProductSetImageType;
  genCount: number;
  settings: ProductSetSettings;
  selectedTemplateIds: number[];
  customTemplates: ProductSetCustomTemplate[];
  moduleOverrides: ProductSetModuleOverride[];
  aiModel: LingyaModel;
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  qualityMode: "standard" | "advanced";
  planTemplates: ProductSetResolvedTemplate[];
  productProfile: ProductSetProductProfile;
}): SavedProductSetPlan {
  return {
    id: input.existingPlan?.id || `favorite-${Date.now()}`,
    name: input.name,
    createdAt: input.existingPlan?.createdAt || input.now,
    updatedAt: input.now,
    mode: input.mode,
    imageType: input.imageType,
    genCount: input.mode === "smart" ? input.genCount : input.planTemplates.length,
    settings: cloneProductSetUiState(input.settings),
    selectedTemplateIds: [...input.selectedTemplateIds],
    customTemplates: cloneProductSetUiState(input.customTemplates),
    moduleOverrides: cloneProductSetUiState(input.moduleOverrides),
    aiModel: input.aiModel,
    aspectRatio: input.aspectRatio,
    imageSize: input.imageSize,
    qualityMode: input.qualityMode,
    planPreview: buildFavoritePlanPreview(input.planTemplates, input.productProfile),
  };
}

export function normalizeFavoriteProductSetPlan(
  value: unknown,
  defaultSettings: ProductSetSettings
): SavedProductSetPlan | null {
  if (!isPlainObject(value)) return null;
  const item = value as Partial<SavedProductSetPlan>;
  const imageType: ProductSetImageType = item.imageType === "details" ? "details" : "main";
  const mode: ProductSetCreationMode = item.mode === "custom" ? "custom" : "smart";
  const aiModel = isLingyaModel(item.aiModel) ? item.aiModel : "nano-banana-2";
  const aspectRatio = isAspectRatio(item.aspectRatio) ? item.aspectRatio : "auto";
  const imageSize = isImageSize(item.imageSize) ? item.imageSize : "1K";
  const qualityMode = item.qualityMode === "advanced" ? "advanced" : "standard";
  const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString();
  const settings = normalizeSavedProductSetSettings(item.settings, defaultSettings);

  return {
    id: typeof item.id === "string" && item.id ? item.id : `favorite-${Date.now()}`,
    name: typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 40) : buildDefaultFavoritePlanName("", imageType),
    createdAt: typeof item.createdAt === "string" ? item.createdAt : updatedAt,
    updatedAt,
    mode,
    imageType,
    genCount: clampPlanCount(item.genCount, imageType),
    settings,
    selectedTemplateIds: normalizeNumberArray(item.selectedTemplateIds).slice(0, 10),
    customTemplates: normalizeSavedCustomTemplates(item.customTemplates),
    moduleOverrides: normalizeSavedModuleOverrides(item.moduleOverrides),
    aiModel,
    aspectRatio,
    imageSize,
    qualityMode,
    planPreview: normalizeSavedPlanPreview(item.planPreview),
  };
}

export function getSelectedPlanIdForProductSetState(input: {
  mode: ProductSetCreationMode;
  imageType: ProductSetImageType;
  selectedTemplateIds: number[];
}) {
  if (input.mode === "smart") return "smart";
  const matchingPreset = PRODUCT_SET_PRESET_PLANS.find((plan) => (
    plan.id !== "smart" &&
    plan.imageType === input.imageType &&
    areSameNumberList(plan.templateIds, input.selectedTemplateIds)
  ));
  return matchingPreset?.id || "custom";
}

export function getPlanSourceTabForProductSetState(input: {
  mode: ProductSetCreationMode;
  selectedPlanId: string;
  customTemplates?: ProductSetCustomTemplate[];
  fallback?: ProductSetPlanSourceTab;
}): ProductSetPlanSourceTab {
  if (input.mode === "smart" || input.selectedPlanId === "smart") return "smart";
  if (input.selectedPlanId && input.selectedPlanId !== "custom") return "preset";
  if (input.customTemplates?.length) return "upload";
  return input.fallback || "upload";
}

export function getProductSetModeForPlanSource(tab: ProductSetPlanSourceTab): ProductSetCreationMode {
  return tab === "smart" ? "smart" : "custom";
}

export function buildFavoritePlanApplyState(
  plan: SavedProductSetPlan,
  input: {
    defaultSettings: ProductSetSettings;
    defaultGenCount?: number;
  }
): FavoritePlanApplyState {
  const nextAspect = plan.aspectRatio || "auto";
  const nextSizes = getSupportedImageSizes(plan.aiModel, nextAspect);
  const selectedTemplateIds = [...plan.selectedTemplateIds];
  return {
    mode: plan.mode,
    planSourceTab: getPlanSourceTabForProductSetState({
      mode: plan.mode,
      selectedPlanId: getSelectedPlanIdForProductSetState({
        mode: plan.mode,
        imageType: plan.imageType,
        selectedTemplateIds,
      }),
      customTemplates: plan.customTemplates,
      fallback: "favorites",
    }),
    selectedPlanId: getSelectedPlanIdForProductSetState({
      mode: plan.mode,
      imageType: plan.imageType,
      selectedTemplateIds,
    }),
    imageType: plan.imageType,
    selectedTemplateIds,
    customTemplates: cloneProductSetUiState(plan.customTemplates),
    moduleOverrides: cloneProductSetUiState(plan.moduleOverrides),
    settings: cloneProductSetUiState({ ...input.defaultSettings, ...plan.settings }),
    aiModel: plan.aiModel,
    aspectRatio: nextAspect,
    imageSize: nextSizes.includes(plan.imageSize) ? plan.imageSize : nextSizes[0] || "1K",
    qualityMode: plan.qualityMode,
    genCount: clampPlanCount(plan.genCount || input.defaultGenCount, plan.imageType),
  };
}

export function normalizeSavedProductSetSettings(value: unknown, defaultSettings: ProductSetSettings): ProductSetSettings {
  const input = isPlainObject(value) ? value as Partial<ProductSetSettings> : {};
  return {
    ...defaultSettings,
    ...input,
    country: typeof input.country === "string" ? input.country : defaultSettings.country,
    language: typeof input.language === "string" ? input.language : defaultSettings.language,
    platform: typeof input.platform === "string" ? input.platform : defaultSettings.platform,
    themeMode: input.themeMode === "custom" ? "custom" : "auto",
    themeColor: typeof input.themeColor === "string" ? input.themeColor : defaultSettings.themeColor,
    fontStyle: isProductSetFontStyle(input.fontStyle) ? input.fontStyle : "auto",
    stylePackId: typeof input.stylePackId === "string" ? input.stylePackId as ProductSetSettings["stylePackId"] : "auto",
    extraDescription: typeof input.extraDescription === "string" ? input.extraDescription : "",
    visualDirectorScript: typeof input.visualDirectorScript === "string" ? input.visualDirectorScript : "",
    visualDirectorPlan: normalizeProductSetVisualDirectorPlan(input.visualDirectorPlan),
  };
}

function normalizeSavedCustomTemplates(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is ProductSetCustomTemplate => (
      isPlainObject(item) &&
      typeof item.id === "string" &&
      typeof item.name === "string" &&
      typeof item.typeDescription === "string" &&
      (item.imageType === "main" || item.imageType === "details")
    ))
    .slice(0, 10);
}

function normalizeSavedModuleOverrides(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is ProductSetModuleOverride => isPlainObject(item) && typeof item.key === "string")
    .slice(0, 12);
}

function normalizeSavedPlanPreview(value: unknown): SavedProductSetPlanModule[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is SavedProductSetPlanModule => (
      isPlainObject(item) &&
      typeof item.name === "string" &&
      isAspectRatio(item.aspectRatio) &&
      (item.source === "preset" || item.source === "ai" || item.source === "custom")
    ))
    .map((item) => ({
      name: item.name.slice(0, 40),
      moduleRole: typeof item.moduleRole === "string" ? item.moduleRole.slice(0, 120) : "",
      aspectRatio: item.aspectRatio,
      source: item.source,
      usesModel: Boolean(item.usesModel),
    }))
    .slice(0, 12);
}

function normalizeNumberArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => Number.isFinite(item));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isLingyaModel(value: unknown): value is LingyaModel {
  return typeof value === "string" && SUPPORTED_MODELS.includes(value as LingyaModel);
}

function isAspectRatio(value: unknown): value is AspectRatio {
  return typeof value === "string" && SUPPORTED_ASPECTS.includes(value as AspectRatio);
}

function isImageSize(value: unknown): value is ImageSize {
  return value === "1K" || value === "2K" || value === "4K";
}

function isProductSetFontStyle(value: unknown): value is ProductSetFontStyle {
  return value === "auto" || value === "minimal" || value === "elegant" || value === "bold" || value === "handwritten" || value === "custom";
}

function clampPlanCount(value: unknown, imageType: ProductSetImageType) {
  const fallback = imageType === "details" ? 5 : 3;
  const raw = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(Math.max(Math.round(raw), 1), imageType === "details" ? 8 : 6);
}

function areSameNumberList(left: number[], right: number[]) {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}
