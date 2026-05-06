import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createServerSupabase>>;

async function requireOwnedConversation(
  supabase: SupabaseServerClient,
  conversationId: string,
  userId: string,
) {
  const { data, error } = await supabase
    .from("agent_conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Conversation not found" }, { status: 404 });
  }

  return null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const ownershipError = await requireOwnedConversation(supabase, id, user.id);
  if (ownershipError) return ownershipError;

  const { data, error } = await supabase
    .from("agent_messages")
    .select("*")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const body = await request.json().catch(() => ({}));

  const ownershipError = await requireOwnedConversation(supabase, id, user.id);
  if (ownershipError) return ownershipError;

  const row = {
    ...(typeof body.id === "string" ? { id: body.id } : {}),
    conversation_id: id,
    role: body.role || "user",
    content: body.content || "",
    images: body.images || [],
    generation: body.generation || null,
    params: body.params || {},
    mode: body.mode || "agent",
  };

  const query =
    typeof body.id === "string"
      ? supabase.from("agent_messages").upsert(row, { onConflict: "id" })
      : supabase.from("agent_messages").insert(row);

  const { data, error } = await query.select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const conversationUpdates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  const inferredTitle = inferConversationTitle(body.role, body.content);
  if (inferredTitle) {
    const { data: conversation } = await supabase
      .from("agent_conversations")
      .select("title")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (isUntitledConversation(conversation?.title)) {
      conversationUpdates.title = inferredTitle;
    }
  }

  await supabase
    .from("agent_conversations")
    .update(conversationUpdates)
    .eq("id", id)
    .eq("user_id", user.id);

  return NextResponse.json(data);
}

/** 更新消息（用于更新 generation 状态） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: convId } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const messageId = body.messageId;
  if (!messageId) return NextResponse.json({ error: "Missing messageId" }, { status: 400 });

  const ownershipError = await requireOwnedConversation(supabase, convId, user.id);
  if (ownershipError) return ownershipError;

  const updates: Record<string, unknown> = {};
  if (body.content !== undefined) updates.content = body.content;
  if (body.generation !== undefined) updates.generation = body.generation;
  if (body.images !== undefined) updates.images = body.images;
  if (body.params !== undefined) updates.params = body.params;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("agent_messages")
    .update(updates)
    .eq("id", messageId)
    .eq("conversation_id", convId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

function inferConversationTitle(role: unknown, content: unknown) {
  if (role && role !== "user") return "";
  if (typeof content !== "string") return "";
  const text = content.replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 26 ? `${text.slice(0, 26)}...` : text;
}

function isUntitledConversation(title: unknown) {
  const value = typeof title === "string" ? title.trim() : "";
  return !value || value === "新对话" || value === "New chat" || value === "Untitled";
}
