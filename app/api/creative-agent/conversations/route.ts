import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api/auth";
import { API_RATE_LIMITS, enforceApiRateLimit } from "@/lib/api/rate-limit";
import { getAdminClient } from "@/lib/supabase/admin";
import { createUserCreativeConversation, listUserCreativeConversations } from "@/lib/creative-conversations.server";
import { CreativeRunError } from "@/lib/creative-runs.server";

export async function GET(request: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.response) return auth.response;
    const rateLimit = await enforceApiRateLimit(auth.user.id, API_RATE_LIMITS.conversationReadMutation);
    if (rateLimit) return rateLimit;
    const requestedLimit = Number(new URL(request.url).searchParams.get("limit"));
    const conversations = await listUserCreativeConversations(auth.supabase, auth.user.id, requestedLimit || 30);
    return NextResponse.json({ conversations }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error, "对话记录加载失败");
  }
}

export async function POST() {
  try {
    const auth = await requireApiUser();
    if (auth.response) return auth.response;
    const rateLimit = await enforceApiRateLimit(auth.user.id, API_RATE_LIMITS.conversationMutation);
    if (rateLimit) return rateLimit;
    const conversation = await createUserCreativeConversation(getAdminClient(), auth.user.id);
    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "对话创建失败");
  }
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof CreativeRunError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[creative-agent:conversations]", error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
