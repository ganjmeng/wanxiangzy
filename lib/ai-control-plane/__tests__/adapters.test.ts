import { describe, expect, it } from "vitest";

import {
  AI_PROTOCOL_ADAPTERS,
  buildAiAdapterAuthHeaders,
  mergeAiAdapterParameters,
  resolveAiAdapterUrl,
} from "@/lib/ai-control-plane/adapters";

describe("AI protocol adapter registry", () => {
  it("resolves only deployment-relative endpoint templates", () => {
    expect(resolveAiAdapterUrl({
      baseUrl: "https://provider.example/v1/",
      protocol: "gemini-native",
      operation: "generation",
      model: "qwen/image",
    })).toBe("https://provider.example/v1/v1beta/models/qwen%2Fimage:generateContent");
    expect(resolveAiAdapterUrl({
      baseUrl: "https://provider.example",
      protocol: "newapi-video",
      operation: "status",
      taskId: "task/1",
    })).toBe("https://provider.example/v1/video/generations/task%2F1");
  });

  it("keeps canonical task fields authoritative over provider static flags", () => {
    expect(mergeAiAdapterParameters(
      { model: "safe-model", prompt: "user prompt", count: 1 },
      { staticParameters: { model: "wrong-model", prompt: "wrong prompt", watermark: false } },
    )).toEqual({ model: "safe-model", prompt: "user prompt", count: 1, watermark: false });
  });

  it("registers a documented adapter for every exposed protocol", () => {
    expect(Object.keys(AI_PROTOCOL_ADAPTERS).sort()).toEqual([
      "gemini-native",
      "kie-market",
      "newapi-video",
      "openai-chat",
      "openai-image",
    ]);
  });

  it("supports only explicit non-script authentication profiles", () => {
    expect(buildAiAdapterAuthHeaders({ protocol: "gemini-native", apiKey: "secret" })).toEqual({ "x-goog-api-key": "secret" });
    expect(buildAiAdapterAuthHeaders({ protocol: "openai-image", apiKey: "secret", adapterConfig: { authMode: "x-api-key" } })).toEqual({ "x-api-key": "secret" });
  });
});
