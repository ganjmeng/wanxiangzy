import { normalizeGenerationDefaults } from "@/lib/agent/workflow/request";
import type { GenerationDefaults, WorkflowInputImage } from "@/lib/agent/workflow/types";
import {
  resolveMastraChatAgentRoute,
  routeMastraChat,
  type MastraChatAgentRoute,
  type MastraChatRoute,
} from "@/lib/mastra/planning/chat-router";
import { getAdminClient } from "@/lib/supabase/admin";

export type MastraRouteEvalCase = {
  id: string;
  title: string;
  request: {
    userText: string;
    images: WorkflowInputImage[];
    defaults?: Partial<GenerationDefaults>;
  };
  expect: {
    effectiveRoute: MastraChatRoute["route"];
    agentId: MastraChatAgentRoute["agentId"];
    guarded?: boolean;
  };
};

export type MastraRouteEvalRunResult = {
  runId: string;
  total: number;
  passed: number;
  failed: number;
  score: number;
  results: Array<{
    caseId: string;
    title: string;
    ok: boolean;
    failures: string[];
    requestedRoute: string;
    effectiveRoute: string;
    agentId: string;
    confidence: number;
    guarded: boolean;
    source: string;
  }>;
};

export const MASTRA_ROUTE_EVAL_CASES: MastraRouteEvalCase[] = [
  {
    id: "plain-chat-direct",
    title: "普通聊天不能进入工作流 Agent",
    request: {
      userText: "你好，你是谁？",
      images: [],
    },
    expect: {
      effectiveRoute: "direct_chat",
      agentId: "directChatAgent",
      guarded: false,
    },
  },
  {
    id: "capability-question-direct",
    title: "能力咨询直接聊天",
    request: {
      userText: "你能帮我做什么？",
      images: [],
    },
    expect: {
      effectiveRoute: "direct_chat",
      agentId: "directChatAgent",
      guarded: false,
    },
  },
  {
    id: "image-analysis-direct",
    title: "只要求分析图片时不创建工作流",
    request: {
      userText: "帮我分析这张图适合做什么",
      images: [{ index: 1, url: "https://example.com/product.jpg", role: "auto" }],
    },
    expect: {
      effectiveRoute: "direct_chat",
      agentId: "directChatAgent",
    },
  },
  {
    id: "architecture-advice-direct",
    title: "架构和生产级方案咨询不进入工作流 Agent",
    request: {
      userText: "继续优化到生产级 agent，先给我审核架构和方案",
      images: [],
    },
    expect: {
      effectiveRoute: "direct_chat",
      agentId: "directChatAgent",
    },
  },
  {
    id: "commerce-detail-workflow",
    title: "淘宝详情页生成进入工作流 Agent",
    request: {
      userText: "根据这张商品图生成一套淘宝详情页素材",
      images: [{ index: 1, url: "https://example.com/product.jpg", role: "product" }],
    },
    expect: {
      effectiveRoute: "workflow_agent",
      agentId: "mainAgent",
      guarded: false,
    },
  },
  {
    id: "tryon-workflow",
    title: "明确换装请求进入工作流 Agent",
    request: {
      userText: "把图1衣服穿到图2模特身上，然后生成4个不同姿势",
      images: [
        { index: 1, url: "https://example.com/clothing.jpg", role: "clothing" },
        { index: 2, url: "https://example.com/person.jpg", role: "person" },
      ],
    },
    expect: {
      effectiveRoute: "workflow_agent",
      agentId: "mainAgent",
      guarded: false,
    },
  },
];

export function evaluateMastraRouteResult(
  chatRoute: MastraChatRoute,
  resolvedRoute: MastraChatAgentRoute,
  testCase: MastraRouteEvalCase,
) {
  const failures: string[] = [];
  if (resolvedRoute.effectiveRoute !== testCase.expect.effectiveRoute) {
    failures.push(
      `effectiveRoute expected ${testCase.expect.effectiveRoute}, got ${resolvedRoute.effectiveRoute}`,
    );
  }
  if (resolvedRoute.agentId !== testCase.expect.agentId) {
    failures.push(
      `agentId expected ${testCase.expect.agentId}, got ${resolvedRoute.agentId}`,
    );
  }
  if (
    typeof testCase.expect.guarded === "boolean" &&
    resolvedRoute.guarded !== testCase.expect.guarded
  ) {
    failures.push(
      `guarded expected ${testCase.expect.guarded}, got ${resolvedRoute.guarded}`,
    );
  }

  return {
    ok: failures.length === 0,
    failures,
    requestedRoute: chatRoute.route,
    effectiveRoute: resolvedRoute.effectiveRoute,
    agentId: resolvedRoute.agentId,
    confidence: chatRoute.confidence,
    guarded: resolvedRoute.guarded,
    source: chatRoute.source,
  };
}

export async function runMastraRouteEvalSuite(params: {
  userId: string;
  routeFn?: (request: {
    userText: string;
    images: WorkflowInputImage[];
    defaults: GenerationDefaults;
  }) => Promise<MastraChatRoute>;
}): Promise<MastraRouteEvalRunResult> {
  const started = Date.now();
  const runId = crypto.randomUUID();
  const routeFn = params.routeFn || routeMastraChat;
  const results: MastraRouteEvalRunResult["results"] = [];

  for (const testCase of MASTRA_ROUTE_EVAL_CASES) {
    const defaults = normalizeGenerationDefaults(testCase.request.defaults || {});
    const chatRoute = await routeFn({
      userText: testCase.request.userText,
      images: testCase.request.images,
      defaults,
    });
    const resolvedRoute = resolveMastraChatAgentRoute(chatRoute, {
      userText: testCase.request.userText,
      images: testCase.request.images,
    });
    const evaluated = evaluateMastraRouteResult(chatRoute, resolvedRoute, testCase);
    results.push({
      caseId: testCase.id,
      title: testCase.title,
      ok: evaluated.ok,
      failures: evaluated.failures,
      requestedRoute: evaluated.requestedRoute,
      effectiveRoute: evaluated.effectiveRoute,
      agentId: evaluated.agentId,
      confidence: evaluated.confidence,
      guarded: evaluated.guarded,
      source: evaluated.source,
    });
  }

  const passed = results.filter((item) => item.ok).length;
  const output: MastraRouteEvalRunResult = {
    runId,
    total: results.length,
    passed,
    failed: results.length - passed,
    score: results.length ? Math.round((passed / results.length) * 100) : 0,
    results,
  };
  await persistMastraRouteEvalRun({
    userId: params.userId,
    runId,
    output,
    latencyMs: Date.now() - started,
  });
  return output;
}

async function persistMastraRouteEvalRun(params: {
  userId: string;
  runId: string;
  output: MastraRouteEvalRunResult;
  latencyMs: number;
}) {
  try {
    const supabase = getAdminClient();
    await supabase.from("agent_eval_runs").insert({
      id: params.runId,
      user_id: params.userId,
      total: params.output.total,
      passed: params.output.passed,
      failed: params.output.failed,
      score: params.output.score,
      latency_ms: params.latencyMs,
      summary: {
        kind: "mastra_route",
        ...params.output,
      },
    });
    if (params.output.results.length) {
      await supabase.from("agent_eval_results").insert(
        params.output.results.map((result) => ({
          run_id: params.runId,
          user_id: params.userId,
          case_id: `mastra-route:${result.caseId}`,
          title: result.title,
          ok: result.ok,
          failures: result.failures,
          action: result.effectiveRoute === "workflow_agent" ? "generate" : "chat",
          module: result.agentId,
          confidence: result.confidence,
          trace_id: null,
        })),
      );
    }
  } catch (error) {
    console.warn(
      "[mastra-route-eval] persist skipped:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
