import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const { data, error } = await supabase
    .from("agent_conversations")
    .select("*")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const conversations = data || [];
  const untitledIds = conversations
    .filter((conversation) => isUntitledConversation(conversation.title))
    .map((conversation) => conversation.id)
    .filter((id): id is string => typeof id === "string");

  if (untitledIds.length === 0) {
    return NextResponse.json(conversations);
  }

  const { data: messages } = await supabase
    .from("agent_messages")
    .select("conversation_id, content, created_at")
    .eq("role", "user")
    .in("conversation_id", untitledIds)
    .order("created_at", { ascending: true });

  const titleByConversation = new Map<string, string>();
  for (const message of messages || []) {
    if (typeof message.conversation_id !== "string") continue;
    if (titleByConversation.has(message.conversation_id)) continue;
    const title = inferConversationTitle(message.content);
    if (title) titleByConversation.set(message.conversation_id, title);
  }

  return NextResponse.json(
    conversations.map((conversation) => {
      const title = titleByConversation.get(conversation.id);
      return title && isUntitledConversation(conversation.title)
        ? { ...conversation, title }
        : conversation;
    }),
  );
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title : "新对话";
  const mode = body.mode === "chat" ? "chat" : "agent";

  const { data, error } = await supabase
    .from("agent_conversations")
    .insert({ user_id: user.id, title, mode, images: [] })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

function inferConversationTitle(content: unknown) {
  if (typeof content !== "string") return "";
  const text = content.replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 26 ? `${text.slice(0, 26)}...` : text;
}

function isUntitledConversation(title: unknown) {
  const value = typeof title === "string" ? title.trim() : "";
  return !value || value === "新对话" || value === "New chat" || value === "Untitled";
}
