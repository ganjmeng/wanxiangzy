import { describe, expect, it } from "vitest";
import {
  normalizeMastraChatRoute,
  resolveMastraChatAgentRoute,
} from "@/lib/mastra/planning/chat-router";

describe("Mastra chat router", () => {
  it("keeps normal chat out of the workflow agent", () => {
    const route = normalizeMastraChatRoute({
      route: "direct_chat",
      confidence: 0.9,
      reason: "The user is asking who the assistant is.",
    });

    expect(route.route).toBe("direct_chat");
    expect(route.source).toBe("llm");
    expect(route.confidence).toBe(0.9);
  });

  it("routes clear visual execution requests to the workflow agent", () => {
    const route = normalizeMastraChatRoute({
      route: "workflow_agent",
      confidence: 0.86,
      reason: "The user wants to generate ecommerce detail page assets.",
    });

    expect(route.route).toBe("workflow_agent");
    expect(route.reason).toContain("detail page");
  });

  it("falls back to direct chat when structured routing is missing", () => {
    const route = normalizeMastraChatRoute(null);

    expect(route.route).toBe("direct_chat");
    expect(route.source).toBe("fallback");
  });

  it("guards low-confidence workflow routes from entering the tool agent", () => {
    const resolved = resolveMastraChatAgentRoute({
      route: "workflow_agent",
      confidence: 0.41,
      reason: "The intent may be visual, but key context is missing.",
      source: "llm",
    });

    expect(resolved.agentId).toBe("directChatAgent");
    expect(resolved.effectiveRoute).toBe("direct_chat");
    expect(resolved.guarded).toBe(true);
    expect(resolved.maxSteps).toBe(1);
  });

  it("allows confident workflow routes to use the tool agent", () => {
    const resolved = resolveMastraChatAgentRoute({
      route: "workflow_agent",
      confidence: 0.88,
      reason: "The user clearly asks to execute a try-on workflow.",
      source: "llm",
    });

    expect(resolved.agentId).toBe("mainAgent");
    expect(resolved.effectiveRoute).toBe("workflow_agent");
    expect(resolved.guarded).toBe(false);
    expect(resolved.maxSteps).toBeGreaterThan(1);
  });

  it("guards capability questions even when the LLM misroutes them to workflow", () => {
    const resolved = resolveMastraChatAgentRoute(
      {
        route: "workflow_agent",
        confidence: 0.92,
        reason: "Incorrectly treated a capability question as execution.",
        source: "llm",
      },
      {
        userText: "你好，你能帮我做什么？",
        images: [],
      },
    );

    expect(resolved.agentId).toBe("directChatAgent");
    expect(resolved.effectiveRoute).toBe("direct_chat");
    expect(resolved.guarded).toBe(true);
    expect(resolved.guardReason).toContain("capability");
  });

  it("guards image-analysis-only requests from creating workflows", () => {
    const resolved = resolveMastraChatAgentRoute(
      {
        route: "workflow_agent",
        confidence: 0.87,
        reason: "Image attached, but user only asks for analysis.",
        source: "llm",
      },
      {
        userText: "帮我分析这张图适合做什么",
        images: [{ index: 1, url: "https://example.com/product.jpg", role: "auto" }],
      },
    );

    expect(resolved.agentId).toBe("directChatAgent");
    expect(resolved.effectiveRoute).toBe("direct_chat");
    expect(resolved.guarded).toBe(true);
  });

  it("does not guard explicit visual execution requests", () => {
    const resolved = resolveMastraChatAgentRoute(
      {
        route: "workflow_agent",
        confidence: 0.9,
        reason: "Clear detail page generation request.",
        source: "llm",
      },
      {
        userText: "根据这张商品图生成一套淘宝详情页素材",
        images: [{ index: 1, url: "https://example.com/product.jpg", role: "product" }],
      },
    );

    expect(resolved.agentId).toBe("mainAgent");
    expect(resolved.effectiveRoute).toBe("workflow_agent");
    expect(resolved.guarded).toBe(false);
  });
});
