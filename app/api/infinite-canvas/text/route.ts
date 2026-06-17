import { NextRequest, NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api/auth";
import { getChatCompletionsUrl, getLlmConfig } from "@/lib/api/llm-provider";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rate-limit";
import { applyInfiniteCanvasLlmEnv, getInfiniteCanvasTextTimeoutMs } from "@/lib/infinite-canvas-server-env";

export const maxDuration = 60;

const TEXT_TIMEOUT_MS = getInfiniteCanvasTextTimeoutMs();

type CanvasTextMessage = {
  role?: string;
  content?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiUser();
    if (auth.response) return auth.response;

    const limit = await checkRateLimit(`infinite-canvas-text:${auth.user.id}`, 30, 60_000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfterSeconds);

    const body = await request.json().catch(() => ({}));
    const messages = normalizeMessages(body.messages);
    if (!messages.length) {
      return NextResponse.json({ error: "请输入画布问题或提示词" }, { status: 400 });
    }

    const llmKind = hasImageContent(messages) ? "vision" : "text";
    const llm = applyInfiniteCanvasLlmEnv(llmKind, getLlmConfig(llmKind));
    if (!llm.apiKey || !llm.baseUrl) {
      return NextResponse.json({ error: "平台文本模型未配置，暂时无法完成画布问答" }, { status: 503 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TEXT_TIMEOUT_MS);
    const response = await fetch(getChatCompletionsUrl(llm), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${llm.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: llm.model,
        messages,
        max_tokens: 1600,
        temperature: 0.45,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const text = await response.text();
    if (!response.ok) {
      console.error("[infinite-canvas/text] LLM error:", response.status, text.slice(0, 500));
      return NextResponse.json({ error: "平台文本模型调用失败，请稍后重试" }, { status: 502 });
    }

    const payload = JSON.parse(text) as Record<string, unknown>;
    const answer = extractMessageText(payload).trim();
    if (!answer) return NextResponse.json({ error: "平台文本模型没有返回内容" }, { status: 502 });
    return NextResponse.json({ text: answer, source: llm.provider });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ error: "平台文本模型响应超时，请稍后重试" }, { status: 504 });
    }
    console.error("[infinite-canvas/text] error:", error);
    return NextResponse.json({ error: "画布文本生成失败" }, { status: 500 });
  }
}

function normalizeMessages(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): { role: "system" | "user" | "assistant"; content: unknown } | null => {
      if (!item || typeof item !== "object") return null;
      const message = item as CanvasTextMessage;
      const role = message.role === "system" || message.role === "assistant" ? message.role : "user";
      const content = normalizeContent(message.content);
      if (!content) return null;
      return { role, content };
    })
    .filter((item): item is { role: "system" | "user" | "assistant"; content: unknown } => Boolean(item))
    .slice(0, 24);
}

function normalizeContent(value: unknown): unknown {
  if (typeof value === "string") return value.trim().slice(0, 12_000);
  if (!Array.isArray(value)) return "";
  const content = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      if (record.type === "text" && typeof record.text === "string") {
        return { type: "text", text: record.text.slice(0, 12_000) };
      }
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

function hasImageContent(messages: Array<{ content: unknown }>) {
  return messages.some((message) => Array.isArray(message.content) && message.content.some((item) => item && typeof item === "object" && (item as Record<string, unknown>).type === "image_url"));
}

function extractMessageText(data: Record<string, unknown>) {
  const choices = data.choices as Array<Record<string, unknown>> | undefined;
  const message = choices?.[0]?.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          if (typeof record.text === "string") return record.text;
          if (typeof record.content === "string") return record.content;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}
