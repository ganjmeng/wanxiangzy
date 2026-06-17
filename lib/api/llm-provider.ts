import { normalizeOpenAiCompatibleBaseUrl } from "@/lib/api/url-utils";

type LlmKind = "text" | "vision";
type LlmProvider = "xiaomi" | "lingya";

interface LlmConfig {
  provider: LlmProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

const XIAOMI_DEFAULT_BASE_URL = "https://api.xiaomimimo.com/v1";
const XIAOMI_DEFAULT_MODEL = "mimo-v2.5-pro";
const LINGYA_DEFAULT_MODEL = "gpt-4o-mini";

export function getLlmConfig(kind: LlmKind): LlmConfig {
  const provider = getLlmProvider();
  return provider === "lingya" ? getLingyaConfig(kind) : getXiaomiConfig(kind);
}

export function getLlmFallbackConfigs(kind: LlmKind): LlmConfig[] {
  const primary = getLlmConfig(kind);
  const fallback = primary.provider === "xiaomi" ? getLingyaConfig(kind) : getXiaomiConfig(kind);
  const configs = [primary, fallback].filter((config) => config.apiKey && config.baseUrl && config.model);
  const seen = new Set<string>();

  return configs.filter((config) => {
    const key = `${config.provider}:${config.baseUrl}:${config.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getLlmProvider(): LlmProvider {
  return process.env.ANALYZE_LLM_PROVIDER?.toLowerCase() === "lingya"
    ? "lingya"
    : "xiaomi";
}

type ChatCompletionsConfig =
  | Pick<LlmConfig, "baseUrl">
  | { baseUrl: string; provider?: unknown; apiKey?: unknown; model?: unknown };

export function getChatCompletionsUrl(config: ChatCompletionsConfig): string {
  return `${config.baseUrl}/chat/completions`;
}

function getXiaomiConfig(kind: LlmKind): LlmConfig {
  const envBase = process.env.XIAOMI_MIMO_BASE_URL;
  return {
    provider: "xiaomi",
    apiKey: process.env.XIAOMI_MIMO_API_KEY || "",
    baseUrl: envBase ? normalizeOpenAiCompatibleBaseUrl(envBase) : XIAOMI_DEFAULT_BASE_URL,
    model:
      (kind === "vision"
        ? process.env.XIAOMI_MIMO_VISION_MODEL
        : process.env.XIAOMI_MIMO_TEXT_MODEL) ||
      process.env.XIAOMI_MIMO_MODEL ||
      XIAOMI_DEFAULT_MODEL,
  };
}

function getLingyaConfig(kind: LlmKind): LlmConfig {
  const envBase = process.env.LINGYA_BASE_URL;
  return {
    provider: "lingya",
    apiKey: process.env.LINGYA_API_KEY || "",
    baseUrl: envBase ? normalizeOpenAiCompatibleBaseUrl(envBase) : "",
    model:
      (kind === "vision"
        ? process.env.LINGYA_VISION_MODEL
        : process.env.LINGYA_TEXT_MODEL) || LINGYA_DEFAULT_MODEL,
  };
}
