import { describe, expect, it } from "vitest";
import {
  isQuietAgentToolName,
  shouldRenderAssistantPart,
  shouldRenderToolInline,
  shouldRenderToolProcessPanel,
} from "@/lib/agent-v2/chat-ui-policy";

describe("agent-v2 chat UI policy", () => {
  it("keeps internal context tools out of normal chat UI", () => {
    const quietTool = {
      type: "tool-call",
      toolName: "getUserContext",
    };

    expect(isQuietAgentToolName("getUserContext")).toBe(true);
    expect(shouldRenderAssistantPart(quietTool)).toBe(false);
    expect(shouldRenderToolProcessPanel(quietTool)).toBe(false);
  });

  it("renders workflow tools inline as product cards", () => {
    const workflowTool = {
      type: "tool-call",
      toolName: "createWorkflowApproval",
    };

    expect(shouldRenderToolInline(workflowTool)).toBe(true);
    expect(shouldRenderAssistantPart(workflowTool)).toBe(true);
    expect(shouldRenderToolProcessPanel(workflowTool)).toBe(false);
  });

  it("uses process panels only for visible non-internal tools", () => {
    const externalTool = {
      type: "tool-call",
      toolName: "lookupWeather",
    };

    expect(shouldRenderToolInline(externalTool)).toBe(false);
    expect(shouldRenderAssistantPart(externalTool)).toBe(true);
    expect(shouldRenderToolProcessPanel(externalTool)).toBe(true);
  });

  it("does not show empty text parts", () => {
    expect(shouldRenderAssistantPart({ type: "text", text: "   " })).toBe(false);
    expect(shouldRenderAssistantPart({ type: "text", text: "可以" })).toBe(true);
  });
});
