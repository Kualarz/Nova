import OpenAI from 'openai';
import { getDb } from '../db/client.js';
import { getConfig } from '../lib/config.js';

let _openai: OpenAI | undefined;

function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: getConfig().OPENAI_API_KEY });
  return _openai;
}

export type MemoryCategory = 'fact' | 'preference' | 'observation' | 'personality';

export interface Memory {
  id: string;
  content: string;
  category: MemoryCategory;
  confidence: number;
  access_count: number;
  created_at: string;
  similarity?: number;
}

export async function embed(text: string): Promise<number[]> {
  const res = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return res.data[0].embedding;
}

export async function insertMemory(params: {
  userId: string;
  content: string;
  category: MemoryCategory;
  confidence?: number;
  sourceConversationId?: string;
}): Promise<string> {
  const db = getDb();
  const embedding = await embed(params.content);

  const { data, error } = await db
    .from('memories')
    .insert({
      user_id: params.userId,
      content: params.content,
      category: params.category,
      embedding: JSON.stringify(embedding),
      confidence: params.confidence ?? 1.0,
      source_conversation_id: params.sourceConversationId ?? null,
    })
    .select('id')
    .single();

  if (error) throw new Error(`insertMemory failed: ${error.message}`);
  return data.id as string;
}

export async function supersedeMemory(oldId: string, newId: string): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from('memories')
    .update({ superseded_by: newId, updated_at: new Date().toISOString() })
    .eq('id', oldId);
  if (error) throw new Error(`supersedeMemory failed: ${error.message}`);
}

export async function findSimilar(params: {
  userId: string;
  query: string;
  limit?: number;
  threshold?: number;
}): Promise<Memory[]> {
  const db = getDb();
  const embedding = await embed(params.query);
  const limit = params.limit ?? 10;
  const threshold = params.threshold ?? 0.7;

  const { data, error } = await db.rpc('match_memories', {
    query_embedding: JSON.stringify(embedding),
    match_user_id: params.userId,
    match_threshold: threshold,
    match_count: limit,
  });

  if (error) throw new Error(`findSimilar failed: ${error.message}`);
  return (data ?? []) as Memory[];
}

export async function updateAccessStats(memoryIds: string[]): Promise<void> {
  if (memoryIds.length === 0) return;
  const db = getDb();
  const now = new Date().toISOString();
  await db.rpc('increment_memory_access', { memory_ids: memoryIds, accessed_at: now });
}
