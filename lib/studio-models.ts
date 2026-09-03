"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";

import type { ImageSize, LingyaModel } from "@/lib/api/lingya";
import type { ResolutionOption } from "@/components/studio/ResolutionSelector";
import { useVisibleImageModels } from "@/lib/use-visible-image-models";

const STUDIO_MODEL_ASSET_BASE =
  "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/model-covers";

/**
 * Studio 图像模型选项的单一事实来源。
 * 此前 8 个页面各自维护 MODELS 数组 + 预翻译 map；这里统一为：
 * 策展元数据（根相对翻译键 Shared.modelDesc.max4k / Shared.modelBadge.*）
 * 全量展示，可见性由 StudioModelSelector 的服务端 /api/model-catalog 过滤。
 *
 * 注意：不要从用户持久化的 config.imageModels 推导列表——老用户本地
 * 存储的 channels/imageModels 可能缺少后来发布的模型（曾导致工作台
 * 只剩 gpt-image-2）。新增/下架模型 = 更新本表 + 后台 catalog 开关。
 */
export const STUDIO_IMAGE_MODEL_META: Record<
  string,
  { label: string; englishLabel: string; descKey: string; badgeKey: string; icon: string }
> = {
  "gpt-image-2": {
    label: "GPT Image 2",
    englishLabel: "GPT Image 2",
    descKey: "Shared.modelDesc.fineDetail",
    badgeKey: "Shared.modelBadge.latest",
    icon: `${STUDIO_MODEL_ASSET_BASE}/gpt-image-2.png`,
  },
  "nano-banana-2": {
    label: "香蕉2",
    englishLabel: "Nano Banana 2",
    descKey: "Shared.modelDesc.fastGeneral",
    badgeKey: "Shared.modelBadge.recommended",
    icon: `${STUDIO_MODEL_ASSET_BASE}/banana-2.png`,
  },
  "nano-banana-2-lite": {
    label: "香蕉2 Lite",
    englishLabel: "Nano Banana 2 Lite",
    descKey: "Shared.modelDesc.fastGeneral",
    badgeKey: "Shared.modelBadge.recommended",
    icon: `${STUDIO_MODEL_ASSET_BASE}/banana-2-lite-v2.png`,
  },
  "nano-banana-pro": {
    label: "香蕉Pro",
    englishLabel: "Nano Banana Pro",
    descKey: "Shared.modelDesc.commercialRetouch",
    badgeKey: "Shared.modelBadge.highQuality",
    icon: `${STUDIO_MODEL_ASSET_BASE}/banana-pro.png`,
  },
  "qwen3": {
    label: "千问3",
    englishLabel: "Qwen3 Image",
    descKey: "Shared.modelDesc.fastGeneral",
    badgeKey: "Shared.modelBadge.latest",
    icon: `${STUDIO_MODEL_ASSET_BASE}/qwen.png`,
  },
  "qwen3-pro": {
    label: "千问3 Pro",
    englishLabel: "Qwen3 Image Pro",
    descKey: "Shared.modelDesc.commercialRetouch",
    badgeKey: "Shared.modelBadge.highQuality",
    icon: `${STUDIO_MODEL_ASSET_BASE}/qwen.png`,
  },
  "z-image": {
    label: "Z-Image",
    englishLabel: "Z-Image",
    descKey: "Shared.modelDesc.fastGeneral",
    badgeKey: "Shared.modelBadge.latest",
    icon: `${STUDIO_MODEL_ASSET_BASE}/z-image.png`,
  },
};

const ALL_CURATED_MODELS = Object.keys(STUDIO_IMAGE_MODEL_META) as LingyaModel[];

/**
 * 清晰度选项（1K/2K/4K）的统一分层，供 ResolutionSelector 直接消费：
 * - 标签只传 "1K"/"2K"/"4K"，组件统一组合本地化的标清/高清/超清
 * - 价格 / 单件积分保留在无障碍描述，并在 RunBar summary 中展示
 * - 2K 的「推荐」角标由 ResolutionSelector 统一渲染
 */
export function useResolutionOptions(
  sizes: ImageSize[],
  getCost: (size: ImageSize) => number,
  creditsUnit: string
): ResolutionOption<ImageSize>[] {
  const tRoot = useTranslations();
  return useMemo(
    () =>
      sizes.map((size) => {
        const tierKey =
          size === "1K"
            ? "Shared.resolutionStandard"
            : size === "2K"
              ? "Shared.resolutionHD"
              : "Shared.resolutionUltra";
        return {
          value: size,
          label: size,
          description: `${tRoot(tierKey)} · ${getCost(size)}${creditsUnit}`,
        };
      }),
    [sizes, getCost, creditsUnit, tRoot],
  );
}

/**
 * 旧版 StudioOptionGrid 兼容导出（保留以防旧调用方残留，description 含单价）。
 * 新代码请直接使用 ResolutionSelector + useResolutionOptions。
 *
 * @deprecated use ResolutionSelector + useResolutionOptions
 */
export function useImageSizeOptions(
  sizes: ImageSize[],
  getCost: (size: ImageSize) => number,
  creditsUnit: string,
) {
  const tRoot = useTranslations();
  return useMemo(
    () =>
      sizes.map((size) => {
        const tierKey =
          size === "1K"
            ? "Shared.resolutionStandard"
            : size === "2K"
              ? "Shared.resolutionHD"
              : "Shared.resolutionUltra";
        return {
          value: size,
          label: size,
          description: `${tRoot(tierKey)} · ${getCost(size)}${creditsUnit}`,
          badge: size === "2K" ? tRoot("Shared.modelBadge.recommended") : undefined,
        };
      }),
    [sizes, getCost, creditsUnit, tRoot],
  );
}

export function useStudioImageModelOptions(requiredCapability: "generation" | "edit" = "edit") {
  const tRoot = useTranslations();
  const locale = useLocale();
  const isChinese = locale.toLowerCase().startsWith("zh");
  const { catalog } = useVisibleImageModels();

  return useMemo(
    () => {
      const publishedById = new Map((catalog || []).map((item) => [item.id, item]));
      const curated = ALL_CURATED_MODELS.map((value) => {
        const meta = STUDIO_IMAGE_MODEL_META[value];
        const published = publishedById.get(value);
        const localized = resolveCatalogLocale(published?.locales, locale);
        const compactBadge = value === "gpt-image-2"
          ? "NEW"
          : value === "nano-banana-2"
            ? "REC"
            : value === "nano-banana-pro" || value === "qwen3-pro"
              ? "PRO"
              : "NEW";
        return {
          value,
          label: localized?.title || published?.shortTitle || published?.displayName || (isChinese ? meta.label : meta.englishLabel),
          desc: localized?.description || published?.description || tRoot(meta.descKey),
          badge: localized?.badge || published?.badge || (isChinese ? tRoot(meta.badgeKey) : compactBadge),
          icon: published?.iconUrl || published?.coverUrl || meta.icon,
          capabilities: published?.capabilities || (value === "z-image" ? ["generation"] : ["generation", "edit"]),
        };
      });
      const curatedIds = new Set(curated.map((item) => item.value));
      const dynamic = (catalog || [])
        .filter((item) => !curatedIds.has(item.id as LingyaModel))
        .map((item) => {
          const localized = resolveCatalogLocale(item.locales, locale);
          return {
            value: item.id as LingyaModel,
            label: localized?.title || item.shortTitle || item.displayName,
            desc: localized?.description || item.description || `${item.supportedSizes.join(" / ")} · ${item.capabilities.join(" · ")}`,
            badge: localized?.badge || item.badge || (item.featured ? "REC" : "NEW"),
            icon: item.iconUrl || item.coverUrl,
            capabilities: item.capabilities,
          };
        });
      const combined = [...curated, ...dynamic];
      const eligible = combined.filter((item) => item.capabilities.includes(requiredCapability));
      if (!catalog?.length) return eligible;
      const publishedOrder = new Map(catalog.map((item, index) => [item.id, index]));
      return eligible.sort((a, b) => (publishedOrder.get(a.value) ?? Number.MAX_SAFE_INTEGER) - (publishedOrder.get(b.value) ?? Number.MAX_SAFE_INTEGER));
    },
    [catalog, isChinese, locale, requiredCapability, tRoot],
  );
}

function resolveCatalogLocale<T>(locales: Record<string, T> | undefined, locale: string): T | undefined {
  if (!locales) return undefined;
  return locales[locale]
    || locales[locale.toLowerCase()]
    || locales[locale.split("-")[0]]
    || locales[Object.keys(locales).find((key) => key.toLowerCase() === locale.toLowerCase()) || ""];
}
