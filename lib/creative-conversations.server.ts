import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreativeConversationClient, CreativeMessageClient } from "@/lib/creative-conversations";
import { CreativeRunError } from "@/lib/creative-runs.server";

export async function listUserCreativeConversations(
  client: SupabaseClient,
  userId: string,
  limit = 30,
): Promise<CreativeConversationClient[]> {
  const pageSize = Math.min(50, Math.max(1, Math.floor(limit)));
  const { data, error } = await client
    .from("creative_conversations")
    .select("id,title,status,surface,created_at,updated_at,last_message_at")
    .eq("user_id", userId)
    .eq("surface", "agent")
    .eq("status", "active")
    .order("last_message_at", { ascending: false })
    .limit(pageSize);
  if (error) throw new CreativeRunError(`对话记录加载失败: ${error.message}`);
  return (Array.isArray(data) ? data : []).map(mapConversation);
}

export async function createUserCreativeConversation(
  client: SupabaseClient,
  userId: string,
): Promise<CreativeConversationClient> {
  const { data, error } = await client
    .from("creative_conversations")
    .insert({ user_id: userId, surface: "agent", title: "新对话", status: "active" })
    .select("id,title,status,surface,created_at,updated_at,last_message_at")
    .single();
  if (error || !data) throw new CreativeRunError(`对话创建失败: ${error?.message || "empty database response"}`);
  return mapConversation(data);
}

export async function requireUserCreativeConversation(
  client: SupabaseClient,
  userId: string,
  conversationId: string,
) {
  const { data, error } = await client
    .from("creative_conversations")
    .select("id,title,status,surface,created_at,updated_at,last_message_at")
    .eq("id", requireUuid(conversationId))
    .eq("user_id", userId)
    .eq("surface", "agent")
    .maybeSingle();
  if (error) throw new CreativeRunError(`对话访问失败: ${error.message}`);
  if (!data) throw new CreativeRunError("对话不存在或无权访问", 404);
  if (data.status !== "active") throw new CreativeRunError("该对话已归档", 409);
  return mapConversation(data);
}

export async function listUserCreativeMessages(
  client: SupabaseClient,
  userId: string,
  conversationId: string,
  limit = 100,
): Promise<CreativeMessageClient[]> {
  await requireUserCreativeConversation(client, userId, conversationId);
  const pageSize = Math.min(100, Math.max(1, Math.floor(limit)));
  const { data, error } = await client
    .from("creative_messages")
    .select("id,conversation_id,run_id,sequence,role,status,content,metadata,created_at,updated_at")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .order("sequence", { ascending: false })
    .limit(pageSize);
  if (error) throw new CreativeRunError(`对话消息加载失败: ${error.message}`);
  return (Array.isArray(data) ? data : []).reverse().map(mapMessage);
}

export async function appendUserCreativeExchange(
  client: SupabaseClient,
  input: {
    userId: string;
    conversationId: string;
    userContent: string;
    userMetadata?: Record<string, unknown>;
    assistantContent: string;
    assistantMetadata?: Record<string, unknown>;
  },
) {
  const { data, error } = await client.rpc("append_creative_conversation_exchange", {
    p_user_id: input.userId,
    p_conversation_id: requireUuid(input.conversationId),
    p_user_content: input.userContent,
    p_assistant_content: input.assistantContent,
    p_assistant_metadata: input.assistantMetadata || {},
  });
  if (error) throw new CreativeRunError(`对话保存失败: ${error.message}`);
  if (input.userMetadata && data && typeof data === "object" && !Array.isArray(data)) {
    const userMessageId = (data as Record<string, unknown>).userMessageId;
    if (typeof userMessageId === "string") {
      const { error: metadataError } = await client
        .from("creative_messages")
        .update({ metadata: input.userMetadata })
        .eq("id", requireUuid(userMessageId))
        .eq("conversation_id", requireUuid(input.conversationId))
        .eq("user_id", input.userId)
        .eq("role", "user");
      if (metadataError) throw new CreativeRunError(`对话素材保存失败: ${metadataError.message}`);
    }
  }
  return listUserCreativeMessages(client, input.userId, input.conversationId);
}

export async function updateUserCreativeAssistantMessage(
  client: SupabaseClient,
  input: {
    userId: string;
    conversationId: string;
    messageId: string;
    runId?: string | null;
    status?: CreativeMessageClient["status"];
    content?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await requireUserCreativeConversation(client, input.userId, input.conversationId);
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.runId !== undefined) updates.run_id = input.runId ? requireUuid(input.runId) : null;
  if (input.status) updates.status = input.status;
  if (typeof input.content === "string") updates.content = input.content.trim().slice(0, 4_000);
  if (input.metadata) updates.metadata = input.metadata;
  const { error } = await client
    .from("creative_messages")
    .update(updates)
    .eq("id", requireUuid(input.messageId))
    .eq("conversation_id", requireUuid(input.conversationId))
    .eq("user_id", input.userId)
    .eq("role", "assistant");
  if (error) throw new CreativeRunError(`对话状态更新失败: ${error.message}`);
  return listUserCreativeMessages(client, input.userId, input.conversationId);
}

function mapConversation(row: Record<string, unknown>): CreativeConversationClient {
  return {
    id: String(row.id || ""),
    title: String(row.title || "新对话"),
    status: row.status === "archived" ? "archived" : "active",
    surface: row.surface === "canvas" ? "canvas" : "agent",
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
    lastMessageAt: String(row.last_message_at || row.updated_at || ""),
  };
}

function mapMessage(row: Record<string, unknown>): CreativeMessageClient {
  const role = row.role === "assistant" || row.role === "system" || row.role === "tool" ? row.role : "user";
  const status = row.status === "running" || row.status === "failed" || row.status === "cancelled" ? row.status : "completed";
  return {
    id: String(row.id || ""),
    conversationId: String(row.conversation_id || ""),
    runId: typeof row.run_id === "string" ? row.run_id : null,
    sequence: Number(row.sequence || 0),
    role,
    status,
    content: String(row.content || ""),
    metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : {},
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

function requireUuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new CreativeRunError("对话 ID 无效", 400);
  }
  return value;
}
