import { getDb } from '../db/client.js';
import { getConfig } from '../lib/config.js';

export interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
}

export async function startConversation(): Promise<string> {
  const db = getDb();
  const { data, error } = await db
    .from('conversations')
    .insert({ user_id: getConfig().NOVA_USER_ID })
    .select('id')
    .single();
  if (error) throw new Error(`startConversation failed: ${error.message}`);
  return data.id as string;
}

export async function appendMessage(conversationId: string, msg: Message): Promise<void> {
  const db = getDb();
  const { error } = await db.from('messages').insert({
    conversation_id: conversationId,
    role: msg.role,
    content: msg.content,
    tool_name: msg.toolName ?? null,
    tool_input: msg.toolInput ?? null,
    tool_output: msg.toolOutput ?? null,
  });
  if (error) throw new Error(`appendMessage failed: ${error.message}`);
}

export async function endConversation(
  conversationId: string,
  summary?: string
): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from('conversations')
    .update({
      ended_at: new Date().toISOString(),
      summary: summary ?? null,
      memory_extracted: true,
    })
    .eq('id', conversationId);
  if (error) throw new Error(`endConversation failed: ${error.message}`);
}

export async function getConversationMessages(conversationId: string): Promise<Message[]> {
  const db = getDb();
  const { data, error } = await db
    .from('messages')
    .select('role, content, tool_name, tool_input, tool_output')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`getConversationMessages failed: ${error.message}`);
  return (data ?? []).map(r => ({
    role: r.role as Message['role'],
    content: r.content as string,
    toolName: r.tool_name as string | undefined,
    toolInput: r.tool_input,
    toolOutput: r.tool_output,
  }));
}
