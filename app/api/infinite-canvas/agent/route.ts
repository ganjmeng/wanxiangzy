import { NextRequest, NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api/auth";
import { getChatCompletionsUrl, getLlmConfig } from "@/lib/api/llm-provider";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rate-limit";
import { applyInfiniteCanvasLlmEnv, getInfiniteCanvasTextTimeoutMs } from "@/lib/infinite-canvas-server-env";

export const maxDuration = 60;

const AGENT_TIMEOUT_MS = getInfiniteCanvasTextTimeoutMs();

type CanvasAgentTool = {
    type?: unknown;
    function?: {
        name?: unknown;
        description?: unknown;
        parameters?: unknown;
        strict?: unknown;
    };
};

type CanvasAgentToolChoice = "auto" | "required" | { type: "function"; function: { name: string } };

type ChatToolCall = {
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
};

type ChatCompletionResponse = {
    choices?: Array<{
        message?: {
            content?: unknown;
            tool_calls?: ChatToolCall[];
            function_call?: { name?: string; arguments?: string };
        };
    }>;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type ChatCompletionMessage = NonNullable<NonNullable<ChatCompletionResponse["choices"]>[number]["message"]>;

export async function POST(request: NextRequest) {
    try {
        const auth = await requireApiUser();
        if (auth.response) return auth.response;

        const limit = await checkRateLimit(`infinite-canvas-agent:${auth.user.id}`, 20, 60_000);
        if (!limit.ok) return rateLimitResponse(limit.retryAfterSeconds);

        const body = await request.json().catch(() => ({}));
        const messages = normalizeMessages((body as Record<string, unknown>).messages);
        const tools = normalizeTools((body as Record<string, unknown>).tools);
        const toolChoice = normalizeToolChoice((body as Record<string, unknown>).toolChoice);

        if (!messages.length) return NextResponse.json({ error: "请输入画布 Agent 请求内容" }, { status: 400 });
        if (!tools.length) return NextResponse.json({ error: "画布 Agent 工具列表为空" }, { status: 400 });

        const llmKind = hasImageContent(messages) ? "vision" : "text";
        const llm = applyInfiniteCanvasLlmEnv(llmKind, getLlmConfig(llmKind));
        if (!llm.apiKey || !llm.baseUrl || !llm.model) {
            return NextResponse.json({ error: "平台 Agent 模型未配置，请检查 INFINITE_CANVAS_TEXT_* / INFINITE_CANVAS_VISION_* 或站内 LLM ENV" }, { status: 503 });
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);
        const response = await fetch(getChatCompletionsUrl(llm), {
            method: "POST",
            headers: {
                Authorization: `Bearer ${llm.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: llm.model,
                messages,
                tools,
                tool_choice: toolChoice,
                temperature: 0.2,
                max_tokens: 1800,
            }),
            signal: controller.signal,
        }).finally(() => clearTimeout(timeout));

        const text = await response.text();
        if (!response.ok) {
            console.error("[infinite-canvas/agent] LLM error:", response.status, text.slice(0, 600));
            return NextResponse.json({ error: readProviderError(text) || "平台 Agent 模型调用失败，请稍后重试" }, { status: 502 });
        }

        const payload = JSON.parse(text) as ChatCompletionResponse;
        if (payload.error?.message || (typeof payload.code === "number" && payload.code !== 0)) {
            return NextResponse.json({ error: payload.error?.message || payload.msg || "平台 Agent 模型调用失败" }, { status: 502 });
        }

        const message = payload.choices?.[0]?.message;
        return NextResponse.json({
            content: extractContent(message?.content),
            toolCalls: normalizeToolCalls(message),
            source: llm.provider,
            model: llm.model,
        });
    } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") {
            return NextResponse.json({ error: "平台 Agent 响应超时，请稍后重试" }, { status: 504 });
        }
        console.error("[infinite-canvas/agent] error:", error);
        return NextResponse.json({ error: "平台 Agent 请求失败" }, { status: 500 });
    }
}

function normalizeMessages(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
        .map((item): Record<string, unknown> | null => {
            if (!item || typeof item !== "object") return null;
            const message = item as Record<string, unknown>;
            if (message.type === "function_call") {
                const callId = stringValue(message.call_id);
                const name = stringValue(message.name);
                if (!callId || !name) return null;
                return {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                        {
                            id: callId,
                            type: "function",
                            function: { name, arguments: stringValue(message.arguments) || "{}" },
                        },
                    ],
                };
            }
            if ("role" in message && message.role === "tool") {
                const toolCallId = stringValue(message.tool_call_id);
                if (!toolCallId) return null;
                return { role: "tool", tool_call_id: toolCallId, content: stringifyContent(message.content) };
            }
            const role = message.role === "system" || message.role === "assistant" ? message.role : "user";
            const content = normalizeContent(message.content);
            if (!content) return null;
            return { role, content };
        })
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .slice(-24);
}

function normalizeContent(value: unknown): unknown {
    if (typeof value === "string") return value.trim().slice(0, 40_000);
    if (!Array.isArray(value)) return "";
    const content = value
        .map((item) => {
            if (!item || typeof item !== "object") return null;
            const record = item as Record<string, unknown>;
            if (record.type === "text" && typeof record.text === "string") return { type: "text", text: record.text.slice(0, 40_000) };
            if (record.type === "image_url") {
                const imageUrl = record.image_url && typeof record.image_url === "object" ? (record.image_url as Record<string, unknown>).url : undefined;
                if (typeof imageUrl === "string" && (/^https?:\/\//i.test(imageUrl) || /^data:image\//i.test(imageUrl))) {
                    return { type: "image_url", image_url: { url: imageUrl } };
                }
            }
            return null;
        })
        .filter(Boolean);
    return content.length ? content : "";
}

function normalizeTools(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
        .map((item): Record<string, unknown> | null => {
            if (!item || typeof item !== "object") return null;
            const tool = item as CanvasAgentTool;
            const fn = tool.function;
            const name = stringValue(fn?.name);
            if (tool.type !== "function" || !name) return null;
            return {
                type: "function",
                function: {
                    name,
                    description: stringValue(fn?.description),
                    parameters: fn?.parameters && typeof fn.parameters === "object" ? fn.parameters : { type: "object", properties: {} },
                    ...(typeof fn?.strict === "boolean" ? { strict: fn.strict } : {}),
                },
            };
        })
        .filter((item): item is Record<string, unknown> => Boolean(item));
}

function normalizeToolChoice(value: unknown): CanvasAgentToolChoice {
    if (value === "required") return "required";
    if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        const name = stringValue(record.name);
        if (record.type === "function" && name) return { type: "function", function: { name } };
    }
    return "auto";
}

function normalizeToolCalls(message: ChatCompletionMessage | undefined) {
    const record = message && typeof message === "object" ? (message as { tool_calls?: ChatToolCall[]; function_call?: { name?: string; arguments?: string } }) : {};
    const calls = Array.isArray(record.tool_calls) ? record.tool_calls : [];
    const normalized = calls
        .map((call) => ({
            id: call.id || crypto.randomUUID(),
            type: "function" as const,
            function: { name: call.function?.name || "", arguments: call.function?.arguments || "{}" },
        }))
        .filter((call) => call.function.name);
    if (normalized.length || !record.function_call?.name) return normalized;
    return [
        {
            id: crypto.randomUUID(),
            type: "function" as const,
            function: { name: record.function_call.name, arguments: record.function_call.arguments || "{}" },
        },
    ];
}

function hasImageContent(messages: Record<string, unknown>[]) {
    return messages.some((message) => Array.isArray(message.content) && message.content.some((item) => Boolean(item && typeof item === "object" && (item as Record<string, unknown>).type === "image_url")));
}

function extractContent(value: unknown) {
    if (typeof value === "string") return value;
    if (!Array.isArray(value)) return "";
    return value
        .map((item) => {
            if (typeof item === "string") return item;
            if (item && typeof item === "object") {
                const record = item as Record<string, unknown>;
                return stringValue(record.text) || stringValue(record.content);
            }
            return "";
        })
        .filter(Boolean)
        .join("\n");
}

function stringifyContent(value: unknown) {
    return typeof value === "string" ? value : JSON.stringify(value ?? "");
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function readProviderError(text: string) {
    try {
        const data = JSON.parse(text) as ChatCompletionResponse;
        return data.error?.message || data.msg || "";
    } catch {
        return text.slice(0, 300);
    }
}
