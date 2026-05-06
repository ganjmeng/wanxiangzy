import { describe, expect, it } from "vitest";
import {
  evaluateMastraRouteResult,
  MASTRA_ROUTE_EVAL_CASES,
} from "@/lib/mastra/planning/route-evals";

describe("Mastra route eval cases", () => {
  it("covers both direct chat and workflow routing expectations", () => {
    const expectedRoutes = new Set(
      MASTRA_ROUTE_EVAL_CASES.map((testCase) => testCase.expect.effectiveRoute),
    );

    expect(expectedRoutes.has("direct_chat")).toBe(true);
    expect(expectedRoutes.has("workflow_agent")).toBe(true);
  });

  it("passes matching route results", () => {
    const testCase = MASTRA_ROUTE_EVAL_CASES.find(
      (item) => item.id === "commerce-detail-workflow",
    );
    expect(testCase).toBeDefined();
    if (!testCase) return;

    const result = evaluateMastraRouteResult(
      {
        route: "workflow_agent",
        confidence: 0.9,
        reason: "Clear generation request.",
        source: "llm",
      },
      {
        agentId: "mainAgent",
        effectiveRoute: "workflow_agent",
        maxSteps: 6,
        guarded: false,
      },
      testCase,
    );

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("fails when normal chat is routed to the workflow agent", () => {
    const testCase = MASTRA_ROUTE_EVAL_CASES.find(
      (item) => item.id === "plain-chat-direct",
    );
    expect(testCase).toBeDefined();
    if (!testCase) return;

    const result = evaluateMastraRouteResult(
      {
        route: "workflow_agent",
        confidence: 0.8,
        reason: "Incorrectly treated greeting as execution.",
        source: "llm",
      },
      {
        agentId: "mainAgent",
        effectiveRoute: "workflow_agent",
        maxSteps: 6,
        guarded: false,
      },
      testCase,
    );

    expect(result.ok).toBe(false);
    expect(result.failures.join("\n")).toContain("effectiveRoute expected direct_chat");
  });
});
