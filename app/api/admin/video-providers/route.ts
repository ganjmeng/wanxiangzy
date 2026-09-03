import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin/auth";

const DEPRECATED_RESPONSE = {
  error: "旧视频供应商配置已停用，请使用统一模型控制台 /admin/providers",
  configKey: "ai.control-plane.v1",
};

export async function GET() {
  const auth = await requireAdminApi("providers:read");
  if (!auth.ok) return auth.response;
  return NextResponse.json(DEPRECATED_RESPONSE, { status: 410, headers: { "Cache-Control": "no-store" } });
}

export async function POST() {
  const auth = await requireAdminApi("providers:write");
  if (!auth.ok) return auth.response;
  return NextResponse.json(DEPRECATED_RESPONSE, { status: 410, headers: { "Cache-Control": "no-store" } });
}
