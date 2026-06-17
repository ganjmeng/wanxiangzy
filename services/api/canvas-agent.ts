import type { ResponseFunctionTool, ResponseInputMessage, ToolResponseResult } from "@/services/api/image";

type ToolChoice = "auto" | "required" | { type: "function"; name: string };
type RequestOptions = { signal?: AbortSignal };

export async function requestPlatformAgentResponse(
    messages: ResponseInputMessage[],
    tools: ResponseFunctionTool[],
    toolChoice: ToolChoice = "auto",
    onDelta?: (text: string) => void,
    options?: RequestOptions,
): Promise<ToolResponseResult> {
    const response = await fetch("/api/infinite-canvas/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, tools, toolChoice }),
        signal: options?.signal,
    });

    const payload = (await response.json().catch(() => ({}))) as ToolResponseResult & { error?: string };
    if (!response.ok) throw new Error(payload.error || readStatusError(response.status));
    const result = { content: payload.content || "", toolCalls: Array.isArray(payload.toolCalls) ? payload.toolCalls : [] };
    if (result.content) onDelta?.(result.content);
    return result;
}

function readStatusError(status: number) {
    if (status === 401 || status === 403) return "请先登录后使用平台 Agent";
    if (status === 402) return "积分不足，请充值后继续使用平台 Agent";
    if (status === 429) return "请求过于频繁，请稍后重试";
    return "平台 Agent 请求失败";
}
