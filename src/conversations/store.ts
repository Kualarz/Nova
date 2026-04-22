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
  const db = await getDb();
  return db.startConversation(getConfig().NOVA_USER_ID);
}

export async function appendMessage(conversationId: string, msg: Message): Promise<void> {
  const db = await getDb();
  return db.appendConversationMessage(conversationId, msg);
}

export async function endConversation(conversationId: string, summary?: string): Promise<void> {
  const db = await getDb();
  return db.endConversation(conversationId, summary);
}

export async function getConversationMessages(conversationId: string): Promise<Message[]> {
  const db = await getDb();
  return db.getConversationMessages(conversationId);
}
