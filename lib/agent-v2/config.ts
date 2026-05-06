export type AgentRuntimeProvider = "legacy" | "mastra";
export type AgentUiProvider = "legacy" | "assistant_ui";

export type AgentV2Config = {
  chatV2Enabled: boolean;
  runtimeProvider: AgentRuntimeProvider;
  uiProvider: AgentUiProvider;
  mastraTraceEnabled: boolean;
  mastraEvalEnabled: boolean;
  mastraMemoryEnabled: boolean;
  model: string;
};

export function getAgentV2Config(): AgentV2Config {
  return {
    chatV2Enabled: readBool("AGENT_CHAT_V2_ENABLED", true),
    runtimeProvider: readRuntimeProvider(process.env.AGENT_RUNTIME_PROVIDER ?? "mastra"),
    uiProvider: readUiProvider(process.env.AGENT_UI_PROVIDER ?? "assistant_ui"),
    mastraTraceEnabled: readBool("AGENT_MASTRA_TRACE_ENABLED", true),
    mastraEvalEnabled: readBool("AGENT_MASTRA_EVAL_ENABLED", true),
    mastraMemoryEnabled: readBool("AGENT_MASTRA_MEMORY_ENABLED", true),
    model: process.env.AGENT_MASTRA_MODEL?.trim() || "openai/gpt-5.4",
  };
}

export function isAgentV2UiEnabled(): boolean {
  const config = getAgentV2Config();
  return config.chatV2Enabled && config.uiProvider === "assistant_ui";
}

function readRuntimeProvider(value: string | undefined): AgentRuntimeProvider {
  return value === "mastra" ? "mastra" : "legacy";
}

function readUiProvider(value: string | undefined): AgentUiProvider {
  return value === "assistant_ui" ? "assistant_ui" : "legacy";
}

function readBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return !["0", "false", "off", "no"].includes(value.toLowerCase());
}
