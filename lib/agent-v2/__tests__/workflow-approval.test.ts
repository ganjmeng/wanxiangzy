import { describe, expect, it } from "vitest";
import { buildWorkflowApprovalInput, shouldCreateWorkflowApproval } from "@/lib/agent-v2/workflow-approval";
import type { AgentBrainDecision } from "@/lib/agent/brain/types";

describe("agent-v2 workflow approval", () => {
  it("builds a structured approval card for generation decisions", () => {
    const decision = makeDecision({
      action: "generate",
      module: "pose",
      confidence: 0.87,
    });

    const approval = buildWorkflowApprovalInput(decision, "生成4个姿势裂变图");

    expect(shouldCreateWorkflowApproval(decision)).toBe(true);
    expect(approval.kind).toBe("workflow_approval");
    expect(approval.module).toBe("pose");
    expect(approval.steps.length).toBeGreaterThan(1);
    expect(approval.nextAction).toBe("confirm_required");
    expect(approval.canExecute).toBe(false);
  });

  it("does not create approval for plain chat", () => {
    const decision = makeDecision({ action: "chat", module: null });

    expect(shouldCreateWorkflowApproval(decision)).toBe(false);
  });
});

function makeDecision(patch: Partial<AgentBrainDecision>): AgentBrainDecision {
  return {
    action: "chat",
    reply: "ok",
    module: null,
    params: {},
    style: null,
    confidence: 0.8,
    missingFields: [],
    source: "deterministic",
    visualTaskPlan: null,
    imageUnderstanding: null,
    safety: {
      allowed: true,
      requiresClarification: false,
      reasons: [],
      blockedModules: [],
    },
    trace: {
      id: "trace-test",
      version: "agent-brain-v2",
      startedAt: new Date(0).toISOString(),
      events: [],
    },
    ...patch,
  };
}
