import { getVideoProviderBaseUrl, type VideoProviderName } from "@/lib/api/video-catalog";

export const VIDEO_PROVIDERS_CONFIG_KEY = "video.providers";

export type VideoProviderResponseType = "kie-market" | "newapi-video";

export type VideoProviderOverride = {
  enabled: boolean;
  provider: VideoProviderName;
  baseUrl: string;
  apiKey?: string;
  responseType: VideoProviderResponseType;
};

export type VideoProviderOverrides = Partial<Record<VideoProviderName, VideoProviderOverride>>;

export const ALL_VIDEO_PROVIDERS: readonly VideoProviderName[] = ["minimax", "seedance", "seedance25", "wan"];

export const DEFAULT_VIDEO_BASE_URL = "https://api.kie.ai";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeVideoProviderName(value: unknown): VideoProviderName {
  const token = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (token === "wan" || token === "wan3" || token === "wan-3") return "wan";
  if (token === "seedance25" || token === "seedance-2.5" || token === "seedance2.5") return "seedance25";
  if (token === "seedance" || token === "doubao" || token === "doubao-seedance") return "seedance";
  return "minimax";
}

export function normalizeVideoProviderResponseType(value: unknown): VideoProviderResponseType | null {
  if (value === "kie-market") return "kie-market";
  if (value === "newapi-video" || value === "minimax-video" || value === "seedance-video" || value === "happyhorse-video") {
    return "newapi-video";
  }
  return null;
}

export function normalizeVideoProviderBaseUrl(value: string | undefined, provider: VideoProviderName): string {
  const fallback = getVideoProviderBaseUrl(provider);
  const base = (value || fallback).trim().replace(/\/+$/, "");
  return base.replace(/\/v2$/i, "") || fallback;
}

function buildProviderOverride(provider: VideoProviderName, raw: Record<string, unknown>): VideoProviderOverride {
  return {
    enabled: raw.enabled !== false,
    provider,
    baseUrl: normalizeVideoProviderBaseUrl(typeof raw.baseUrl === "string" ? raw.baseUrl : undefined, provider),
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey.trim() : undefined,
    responseType: normalizeVideoProviderResponseType(raw.responseType) ?? "kie-market",
  };
}

export function getEnvVideoProviderOverrides(): VideoProviderOverrides {
  const provider = normalizeVideoProviderName(process.env.VIDEO_PROVIDER);
  const override: VideoProviderOverride = {
    enabled: true,
    provider,
    baseUrl: normalizeVideoProviderBaseUrl(
      process.env.VIDEO_BASE_URL || process.env.MINIMAX_VIDEO_BASE_URL || process.env.MINIMAX_BASE_URL,
      provider,
    ),
    apiKey: process.env.VIDEO_API_KEY?.trim() || process.env.MINIMAX_VIDEO_API_KEY?.trim() || process.env.MINIMAX_API_KEY?.trim(),
    responseType: "kie-market",
  };
  return { [provider]: override };
}

export function parseVideoProviderOverrides(value: unknown): VideoProviderOverrides {
  if (!isRecord(value)) return {};
  const container = isRecord(value.models) ? value.models : value;
  const rawVideo = isRecord(container.video) ? container.video : container;

  // New multi-provider shape: { video: { providers: { minimax: {...}, seedance: {...} } } }
  if (isRecord(rawVideo.providers)) {
    const providersRaw = rawVideo.providers;
    const out: VideoProviderOverrides = {};
    for (const provider of ALL_VIDEO_PROVIDERS) {
      const raw = providersRaw[provider];
      if (isRecord(raw)) out[provider] = buildProviderOverride(provider, raw);
    }
    return out;
  }

  // Legacy single-provider shape: { video: { provider, baseUrl, apiKey, ... } }
  const provider = normalizeVideoProviderName(rawVideo.provider);
  return { [provider]: buildProviderOverride(provider, rawVideo) };
}
