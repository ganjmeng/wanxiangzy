import { afterEach, describe, expect, it } from "vitest";
import { getMastraAgentModelInfo } from "@/lib/mastra/model";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("Mastra agent model selection", () => {
  it("uses Xiaomi OpenAI-compatible config when the Xiaomi key is configured", () => {
    process.env.XIAOMI_MIMO_API_KEY = "xiaomi-key";
    process.env.XIAOMI_MIMO_BASE_URL = "https://token-plan-cn.xiaomimimo.com";
    process.env.XIAOMI_MIMO_TEXT_MODEL = "mimo-v2.5-pro";
    process.env.AGENT_MASTRA_MODEL = "";

    expect(getMastraAgentModelInfo()).toEqual({
      provider: "xiaomi",
      baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
      modelId: "mimo-v2.5-pro",
    });
  });

  it("does not pass gateway model slugs to the Xiaomi endpoint", () => {
    process.env.XIAOMI_MIMO_API_KEY = "xiaomi-key";
    process.env.XIAOMI_MIMO_BASE_URL = "https://token-plan-cn.xiaomimimo.com/v1";
    process.env.XIAOMI_MIMO_TEXT_MODEL = "mimo-v2.5-pro";
    process.env.AGENT_MASTRA_MODEL = "openai/gpt-5.4";

    expect(getMastraAgentModelInfo()).toEqual({
      provider: "xiaomi",
      baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
      modelId: "mimo-v2.5-pro",
    });
  });

  it("allows AGENT_MASTRA_MODEL to override the Xiaomi model id", () => {
    process.env.XIAOMI_MIMO_API_KEY = "xiaomi-key";
    process.env.XIAOMI_MIMO_BASE_URL = "https://token-plan-cn.xiaomimimo.com/v1";
    process.env.AGENT_MASTRA_MODEL = "mimo-custom";

    expect(getMastraAgentModelInfo()).toEqual({
      provider: "xiaomi",
      baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
      modelId: "mimo-custom",
    });
  });

  it("falls back to the configured gateway model when Xiaomi is not configured", () => {
    delete process.env.XIAOMI_MIMO_API_KEY;
    process.env.AGENT_MASTRA_MODEL = "openai/gpt-5.4";

    expect(getMastraAgentModelInfo()).toEqual({
      provider: "gateway",
      modelId: "openai/gpt-5.4",
    });
  });
});
