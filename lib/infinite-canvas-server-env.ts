import { normalizeOpenAiCompatibleBaseUrl } from "@/lib/api/url-utils";

type CanvasLlmKind = "text" | "vision";
type CanvasLlmConfig = {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
};

function readEnv(name: string) {
  return process.env[name]?.trim() || "";
}

export function getInfiniteCanvasTextTimeoutMs() {
  return Number(readEnv("INFINITE_CANVAS_TEXT_TIMEOUT_MS") || process.env.LINGYA_ANALYZE_TIMEOUT_MS || 45_000);
}

export function applyInfiniteCanvasLlmEnv(
  kind: CanvasLlmKind,
  fallback: CanvasLlmConfig,
): CanvasLlmConfig {
  const prefix = kind === "vision" ? "INFINITE_CANVAS_VISION" : "INFINITE_CANVAS_TEXT";
  const apiKey = readEnv(`${prefix}_API_KEY`);
  const baseUrl = readEnv(`${prefix}_BASE_URL`);
  const model = readEnv(`${prefix}_MODEL`);
  const provider = readEnv(`${prefix}_PROVIDER`);

  if (!apiKey && !baseUrl && !model && !provider) return fallback;

  return {
    provider: provider || fallback.provider,
    apiKey: apiKey || fallback.apiKey,
    baseUrl: baseUrl ? normalizeOpenAiCompatibleBaseUrl(baseUrl) : fallback.baseUrl,
    model: model || fallback.model,
  };
}
