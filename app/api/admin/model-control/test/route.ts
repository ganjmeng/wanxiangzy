import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin/auth";
import { writeAdminAuditLog } from "@/lib/admin/audit";
import { getAiControlPlaneConfig } from "@/lib/ai-control-plane/server";
import type { AiProviderProtocol } from "@/lib/ai-control-plane/types";
import { decryptProviderSecret } from "@/lib/api/model-provider-secrets";

export const maxDuration = 30;

export async function POST(request: Request) {
  const auth = await requireAdminApi("providers:write");
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({})) as {
    providerId?: unknown;
    baseUrl?: unknown;
    apiKey?: unknown;
    protocol?: unknown;
    upstreamModel?: unknown;
  };
  const providerId = text(body.providerId);
  const baseUrl = text(body.baseUrl);
  const protocol = normalizeProtocol(body.protocol);
  const upstreamModel = text(body.upstreamModel);
  if (!providerId || !baseUrl || !protocol) return NextResponse.json({ error: "供应商、Base URL 和协议不能为空" }, { status: 400 });
  const safeUrl = await validateOutboundUrl(baseUrl);
  if (!safeUrl.ok) return NextResponse.json({ error: safeUrl.error }, { status: 400 });

  const config = await getAiControlPlaneConfig({ decryptSecrets: true, allowLegacy: true });
  const existing = config?.providers.find((item) => item.id === providerId);
  const apiKey = decryptProviderSecret(text(body.apiKey)) || existing?.apiKey || "";
  if (!apiKey) return NextResponse.json({ error: "请先填写 API Key" }, { status: 400 });

  const target = connectionTestTarget(safeUrl.url, protocol, apiKey);
  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(target.url, { method: target.method, headers: target.headers, signal: controller.signal }).finally(() => clearTimeout(timer));
    const textBody = await response.text().catch(() => "");
    if (!response.ok) {
      return NextResponse.json({ error: `连接失败（HTTP ${response.status}）：${textBody.slice(0, 160) || "请检查地址、协议和密钥"}` }, { status: 400 });
    }
    const availableModels = extractModelIds(textBody);
    if (upstreamModel && availableModels.size && !availableModels.has(normalizeModelId(upstreamModel))) {
      return NextResponse.json({
        error: `连接成功，但账号模型列表中不存在 ${upstreamModel}。请修正上游模型名或停用该部署。`,
      }, { status: 400 });
    }
    const latencyMs = Date.now() - startedAt;
    await writeAdminAuditLog(auth.context, {
      action: "ai_provider.connection_test",
      resourceType: "ai_provider",
      resourceId: providerId,
      reason: "执行无计费连接测试",
      metadata: { protocol, latencyMs, ok: true },
    });
    return NextResponse.json({
      ok: true,
      latencyMs,
      message: upstreamModel
        ? `连接及模型 ${upstreamModel} 校验成功，响应耗时 ${latencyMs} ms（未执行计费生成）`
        : `连接成功，响应耗时 ${latencyMs} ms（未执行计费生成）`,
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "连接超时（10 秒）" : error instanceof Error ? error.message : "网络错误";
    return NextResponse.json({ error: `连接失败：${message}` }, { status: 400 });
  }
}

function connectionTestTarget(baseUrl: string, protocol: AiProviderProtocol, apiKey: string): { url: string; method: string; headers: Record<string, string> } {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (protocol === "gemini-native") {
    const root = normalized.replace(/\/v1(?:beta)?$/i, "");
    return { url: `${root}/v1beta/models`, method: "GET", headers: { "x-goog-api-key": apiKey } };
  }
  const v1 = /\/v1$/i.test(normalized) ? normalized : `${normalized}/v1`;
  return { url: `${v1}/models`, method: "GET", headers: { Authorization: `Bearer ${apiKey}` } };
}

function extractModelIds(body: string) {
  const ids = new Set<string>();
  try {
    const parsed = JSON.parse(body) as { data?: unknown; models?: unknown };
    const items = Array.isArray(parsed.data) ? parsed.data : Array.isArray(parsed.models) ? parsed.models : [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const record = item as { id?: unknown; name?: unknown };
      const id = text(record.id) || text(record.name);
      if (id) ids.add(normalizeModelId(id));
    }
  } catch {
    // A provider may return a non-standard but successful health response. In
    // that case the endpoint remains a connection-only check.
  }
  return ids;
}

function normalizeModelId(value: string) {
  return value.trim().replace(/^models\//i, "");
}

async function validateOutboundUrl(value: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:")) return { ok: false, error: "生产供应商地址必须使用 HTTPS" };
    if (process.env.NODE_ENV !== "production") return { ok: true, url: value.replace(/\/+$/, "") };
    const results = await lookup(url.hostname, { all: true });
    if (!results.length || results.some((item) => privateAddress(item.address))) return { ok: false, error: "供应商地址不能解析到内网、回环或保留地址" };
    return { ok: true, url: value.replace(/\/+$/, "") };
  } catch {
    return { ok: false, error: "Base URL 不合法或无法解析" };
  }
}

function privateAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
}
function normalizeProtocol(value: unknown): AiProviderProtocol | null { return ["openai-image", "gemini-native", "openai-chat", "newapi-video"].includes(text(value)) ? text(value) as AiProviderProtocol : null; }
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
