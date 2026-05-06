export function readToolName(part: unknown) {
  if (!part || typeof part !== "object") return "";
  const toolName = (part as { toolName?: unknown }).toolName;
  return typeof toolName === "string" ? toolName : "";
}

export function isWorkflowSurfaceToolName(toolName: string) {
  return (
    toolName === "createWorkflowApproval" ||
    toolName === "getWorkflowStatus" ||
    toolName === "cancelWorkflow"
  );
}

export function isQuietAgentToolName(toolName: string) {
  return (
    toolName === "describeAttachedImages" ||
    toolName === "getUserContext" ||
    toolName === "rememberPreference"
  );
}

export function shouldRenderToolInline(part: unknown) {
  return isWorkflowSurfaceToolName(readToolName(part));
}

export function isQuietAgentTool(part: unknown) {
  return isQuietAgentToolName(readToolName(part));
}

export function shouldRenderToolProcessPanel(part: unknown) {
  const toolName = readToolName(part);
  if (!toolName) return false;
  if (isWorkflowSurfaceToolName(toolName)) return false;
  return !isQuietAgentToolName(toolName);
}

export function shouldRenderAssistantPart(part: unknown) {
  if (!part || typeof part !== "object") return false;
  const type = (part as { type?: unknown }).type;
  if (type === "text") {
    const text = (part as { text?: unknown }).text;
    return typeof text === "string" && text.trim().length > 0;
  }
  if (type === "data") return true;
  if (type === "tool-call") return !isQuietAgentTool(part);
  return false;
}
