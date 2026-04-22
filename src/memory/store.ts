import { getDb } from '../db/client.js';
import { getModelRouter } from '../providers/router.js';
import { buildEdges } from './graph.js';

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
  return getModelRouter().embed(text);
}

export async function insertMemory(params: {
  userId: string;
  content: string;
  category: MemoryCategory;
  confidence?: number;
  sourceConversationId?: string;
}): Promise<string> {
  const db = await getDb();
  const embedding = await embed(params.content);
  const id = await db.insertMemory({
    userId: params.userId,
    content: params.content,
    category: params.category,
    embedding,
    confidence: params.confidence ?? 1.0,
    sourceConversationId: params.sourceConversationId,
  });
  await buildEdges({ memoryId: id, userId: params.userId, embedding });
  return id;
}

export async function supersedeMemory(oldId: string, newId: string): Promise<void> {
  const db = await getDb();
  return db.supersedeMemory(oldId, newId);
}

export async function findSimilar(params: {
  userId: string;
  query: string;
  limit?: number;
  threshold?: number;
}): Promise<Memory[]> {
  const db = await getDb();
  const embedding = await embed(params.query);
  return db.matchMemories({
    userId: params.userId,
    embedding,
    limit: params.limit ?? 10,
    threshold: params.threshold ?? 0.7,
  });
}

export async function updateAccessStats(memoryIds: string[]): Promise<void> {
  if (memoryIds.length === 0) return;
  const db = await getDb();
  return db.incrementMemoryAccess(memoryIds, new Date().toISOString());
}
