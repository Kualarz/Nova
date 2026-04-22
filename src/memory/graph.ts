import { getDb } from '../db/client.js';
import { embed, updateAccessStats, type Memory } from './store.js';

export async function buildEdges(params: {
  memoryId: string;
  userId: string;
  embedding: number[];
}): Promise<void> {
  const db = await getDb();
  const similar = await db.findSimilarForEdges({
    embedding: params.embedding,
    userId: params.userId,
    limit: 50,
    threshold: 0.75,
    excludeId: params.memoryId,
  });

  for (const { id, similarity } of similar) {
    const [a, b] = [params.memoryId, id].sort();
    await db.insertMemoryConnection({ memoryAId: a!, memoryBId: b!, similarity, type: 'cosine' });
  }
}

export async function graphRagSearch(params: {
  userId: string;
  query: string;
  limit?: number;
  threshold?: number;
}): Promise<Memory[]> {
  const db = await getDb();
  const limit = params.limit ?? 10;
  const threshold = params.threshold ?? 0.7;

  const embedding = await embed(params.query);
  const seeds = await db.matchMemories({ userId: params.userId, embedding, limit, threshold });
  if (seeds.length === 0) return [];

  const seedIds = seeds.map(m => m.id);
  const neighbors = await db.findNeighborMemories({ memoryIds: seedIds, userId: params.userId });

  const byId = new Map<string, Memory>();
  for (const m of seeds) byId.set(m.id, m);
  for (const m of neighbors) {
    if (!byId.has(m.id)) byId.set(m.id, m);
  }

  const now = Date.now();
  const ranked = [...byId.values()]
    .map(m => {
      const sim = m.similarity ?? 0;
      const daysOld = (now - new Date(m.created_at).getTime()) / 86_400_000;
      const recency = Math.exp(-daysOld / 7);
      return { mem: m, score: sim * 0.6 + recency * 0.4 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ mem }) => mem);

  updateAccessStats(ranked.map(m => m.id)).catch(() => {});

  return ranked;
}
