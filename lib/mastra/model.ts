import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { normalizeOpenAiCompatibleBaseUrl } from "@/lib/api/url-utils";
import { getAgentV2Config } from "@/lib/agent-v2/config";

const XIAOMI_DEFAULT_BASE_URL = "https://api.xiaomimimo.com/v1";
const XIAOMI_DEFAULT_MODEL = "mimo-v2.5-pro";

export type MastraAgentModelInfo =
  | {
      provider: "xiaomi";
      baseUrl: string;
      modelId: string;
    }
  | {
      provider: "gateway";
      modelId: string;
    };

export function getMastraAgentModel() {
  const xiaomiConfig = getXiaomiAgentModelConfig();
  if (xiaomiConfig) {
    const xiaomi = createOpenAICompatible({
      name: "xiaomi-mimo",
      baseURL: xiaomiConfig.baseUrl,
      apiKey: xiaomiConfig.apiKey,
      includeUsage: true,
    });

    return xiaomi.chatModel(xiaomiConfig.modelId);
  }

  return getAgentV2Config().model;
}

export function getMastraAgentModelInfo(): MastraAgentModelInfo {
  const xiaomiConfig = getXiaomiAgentModelConfig();
  if (xiaomiConfig) {
    return {
      provider: "xiaomi",
      baseUrl: xiaomiConfig.baseUrl,
      modelId: xiaomiConfig.modelId,
    };
  }

  return {
    provider: "gateway",
    modelId: getAgentV2Config().model,
  };
}

function getXiaomiAgentModelConfig():
  | {
      apiKey: string;
      baseUrl: string;
      modelId: string;
    }
  | undefined {
  const apiKey = process.env.XIAOMI_MIMO_API_KEY?.trim();
  if (!apiKey) return undefined;

  const baseUrl = normalizeOpenAiCompatibleBaseUrl(
    process.env.XIAOMI_MIMO_BASE_URL?.trim() || XIAOMI_DEFAULT_BASE_URL,
  );
  const modelId = getXiaomiAgentModelId();

  if (!baseUrl || !modelId) return undefined;

  return {
    apiKey,
    baseUrl,
    modelId,
  };
}

function getXiaomiAgentModelId(): string {
  const agentModel = process.env.AGENT_MASTRA_MODEL?.trim();
  if (agentModel && !looksLikeGatewayModelSlug(agentModel)) {
    return agentModel;
  }

  return (
    process.env.XIAOMI_MIMO_TEXT_MODEL?.trim() ||
    process.env.XIAOMI_MIMO_MODEL?.trim() ||
    XIAOMI_DEFAULT_MODEL
  );
}

function looksLikeGatewayModelSlug(value: string): boolean {
  return value.includes("/");
}
