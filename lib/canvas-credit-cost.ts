/**
 * Client-safe credit cost helpers for the infinite canvas.
 * The values must stay in sync with the server's CREDIT_COSTS in lib/api/lingya.ts
 * (the server is the source of truth — these are mirrored for UI display only).
 */

export type CanvasLingyaModel = "gpt-image-2" | "nano-banana-pro" | "nano-banana-2";
export type CanvasImageSize = "1K" | "2K" | "4K";

export const CANVAS_CREDIT_COSTS: Record<CanvasLingyaModel, Record<CanvasImageSize, number>> = {
    "gpt-image-2":     { "1K": 2, "2K": 3, "4K": 4 },
    "nano-banana-pro": { "1K": 2, "2K": 3, "4K": 4 },
    "nano-banana-2":   { "1K": 1, "2K": 2, "4K": 3 },
};

const KNOWN_LINGYA_MODELS: CanvasLingyaModel[] = ["gpt-image-2", "nano-banana-pro", "nano-banana-2"];

export function isCanvasLingyaModel(value: string): value is CanvasLingyaModel {
    return KNOWN_LINGYA_MODELS.includes(value as CanvasLingyaModel);
}

/** Strip the "channelId::" prefix from a model option value. */
export function extractCanvasModelName(modelValue: string): string {
    const index = modelValue.indexOf("::");
    if (index < 0) return modelValue;
    return modelValue.slice(index + 2);
}

/** Map the canvas's `quality` field to a normalized image size. Mirrors normalizePlatformImageSize. */
export function qualityToImageSize(quality: string | undefined): CanvasImageSize {
    const normalized = (quality || "").trim().toLowerCase();
    if (normalized === "4k" || normalized === "high") return "4K";
    if (normalized === "2k" || normalized === "medium" || normalized === "hd") return "2K";
    return "1K";
}

/** Compute the credit cost for a canvas image generation request. */
export function getCanvasImageCreditCost(options: {
    model: string;
    quality?: string;
    count?: number;
}): number {
    const modelName = extractCanvasModelName(options.model);
    if (!isCanvasLingyaModel(modelName)) return 0;
    const size = qualityToImageSize(options.quality);
    const perImage = CANVAS_CREDIT_COSTS[modelName][size];
    const count = Math.max(1, Math.floor(Math.abs(Number(options.count) || 1)));
    return perImage * count;
}
