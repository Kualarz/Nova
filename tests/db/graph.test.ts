import { describe, it, expect, beforeEach } from 'vitest';
import { LocalProvider } from '../../src/db/providers/local.js';

function unitVec(pos: number): number[] {
  const v = new Array(768).fill(0);
  v[pos] = 1;
  return v;
}

// Normalised vector mostly along pos=0, with a small component at pos=1
// cos_sim to unitVec(0) = 0.9 (above the 0.75 edge threshold)
const VEC_CLOSE = (() => {
  const v = new Array(768).fill(0);
  v[0] = 0.9;
  v[1] = Math.sqrt(1 - 0.81); // keeps |v| = 1
  return v;
})();

describe('LocalProvider graph methods', () => {
  let provider: LocalProvider;

  beforeEach(async () => {
    provider = new LocalProvider();
    await provider.runMigrations();
  });

  async function insertMem(pos: number, content = `mem-${pos}`): Promise<string> {
    return provider.insertMemory({
      userId: 'u1',
      content,
      category: 'fact',
      embedding: unitVec(pos),
      confidence: 1,
    });
  }

  // ── insertMemoryConnection ──────────────────────────────────────────────────

  it('insertMemoryConnection stores an edge retrievable by findNeighborMemories', async () => {
    const idA = await insertMem(0);
    const idB = await insertMem(1);

    const [a, b] = [idA, idB].sort();
    await provider.insertMemoryConnection({ memoryAId: a!, memoryBId: b!, similarity: 0.85, type: 'cosine' });

    const neighbors = await provider.findNeighborMemories({ memoryIds: [idA], userId: 'u1' });
    expect(neighbors.map(n => n.id)).toContain(idB);
  });

  it('insertMemoryConnection upserts — duplicate edge does not throw', async () => {
    const idA = await insertMem(0);
    const idB = await insertMem(1);
    const [a, b] = [idA, idB].sort();

    await provider.insertMemoryConnection({ memoryAId: a!, memoryBId: b!, similarity: 0.8, type: 'cosine' });
    await expect(
      provider.insertMemoryConnection({ memoryAId: a!, memoryBId: b!, similarity: 0.9, type: 'cosine' })
    ).resolves.not.toThrow();
  });

  // ── findSimilarForEdges ─────────────────────────────────────────────────────

  it('findSimilarForEdges returns memories above threshold and excludes self', async () => {
    const idA = await provider.insertMemory({
      userId: 'u1', content: 'A', category: 'fact', embedding: unitVec(0), confidence: 1,
    });
    // B is close to A (cos_sim ≈ 0.9)
    await provider.insertMemory({
      userId: 'u1', content: 'B', category: 'fact', embedding: VEC_CLOSE, confidence: 1,
    });
    // C is orthogonal to A (cos_sim = 0)
    await provider.insertMemory({
      userId: 'u1', content: 'C', category: 'fact', embedding: unitVec(1), confidence: 1,
    });

    const results = await provider.findSimilarForEdges({
      embedding: unitVec(0),
      userId: 'u1',
      limit: 10,
      threshold: 0.75,
      excludeId: idA,
    });

    const ids = results.map(r => r.id);
    expect(ids).not.toContain(idA);       // self excluded
    expect(results.some(r => r.similarity > 0.75)).toBe(true); // B found
    // C has sim = 0, should not appear
    expect(results.every(r => r.similarity > 0.75)).toBe(true);
  });

  it('findSimilarForEdges returns empty when no memory is above threshold', async () => {
    const idA = await insertMem(0);
    await insertMem(2); // orthogonal

    const results = await provider.findSimilarForEdges({
      embedding: unitVec(0),
      userId: 'u1',
      limit: 10,
      threshold: 0.75,
      excludeId: idA,
    });

    expect(results).toHaveLength(0);
  });

  // ── findNeighborMemories ────────────────────────────────────────────────────

  it('findNeighborMemories returns 1-hop neighbors from both edge directions', async () => {
    const idA = await insertMem(0);
    const idB = await insertMem(1);
    const idC = await insertMem(2);

    // A-B edge (store canonical order)
    const [ab1, ab2] = [idA, idB].sort();
    await provider.insertMemoryConnection({ memoryAId: ab1!, memoryBId: ab2!, similarity: 0.8, type: 'cosine' });

    // A is also a neighbor of C — test reverse direction
    const [ac1, ac2] = [idA, idC].sort();
    await provider.insertMemoryConnection({ memoryAId: ac1!, memoryBId: ac2!, similarity: 0.8, type: 'cosine' });

    const neighbors = await provider.findNeighborMemories({ memoryIds: [idA], userId: 'u1' });
    const ids = neighbors.map(n => n.id);

    expect(ids).toContain(idB);
    expect(ids).toContain(idC);
    expect(ids).not.toContain(idA); // seed excluded
  });

  it('findNeighborMemories returns empty when no connections exist', async () => {
    const idA = await insertMem(0);
    const neighbors = await provider.findNeighborMemories({ memoryIds: [idA], userId: 'u1' });
    expect(neighbors).toHaveLength(0);
  });

  it('findNeighborMemories does not return memories from a different user', async () => {
    const idA = await insertMem(0);
    // Insert B for a different user
    const idB = await provider.insertMemory({
      userId: 'other-user', content: 'other', category: 'fact', embedding: unitVec(1), confidence: 1,
    });
    const [a, b] = [idA, idB].sort();
    await provider.insertMemoryConnection({ memoryAId: a!, memoryBId: b!, similarity: 0.8, type: 'cosine' });

    const neighbors = await provider.findNeighborMemories({ memoryIds: [idA], userId: 'u1' });
    expect(neighbors.map(n => n.id)).not.toContain(idB);
  });
});
