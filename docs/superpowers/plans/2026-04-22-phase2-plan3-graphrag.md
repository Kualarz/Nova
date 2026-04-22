# Plan 3: GraphRAG + Memory Upgrades

**Date:** 2026-04-22  
**Phase:** 2  
**Branch:** master (continuing Phase 2 series)

## Goal

Upgrade NOVA's memory retrieval from pure cosine-similarity vector search to a GraphRAG pipeline: seed → expand 1 hop → rerank by score = `sim × 0.6 + recency × 0.4`. Also build graph edges automatically on memory insert.

## Context

- `memory_connections` table already exists (migration 002_phase2.sql): `memory_a_id`, `memory_b_id`, `similarity`, `type`, `created_at`
- No new migration needed
- Embedding dimension: 768 (nomic-embed-text)
- All existing callers of `findSimilar()` stay unchanged — `graphRagSearch()` is a new export

## Tasks

### Task 1: Extend DatabaseProvider interface

File: `src/db/interface.ts`

Add three new interfaces and extend `DatabaseProvider`:

```typescript
export interface InsertMemoryConnectionParams {
  memoryAId: string;
  memoryBId: string;
  similarity: number;
  type: string;
}

export interface FindSimilarForEdgesResult {
  id: string;
  similarity: number;
}

export interface FindSimilarForEdgesParams {
  embedding: number[];
  userId: string;
  limit: number;
  threshold: number;
  excludeId: string;
}

export interface FindNeighborMemoriesParams {
  memoryIds: string[];
  userId: string;
}
```

Add to `DatabaseProvider`:
```typescript
insertMemoryConnection(params: InsertMemoryConnectionParams): Promise<void>;
findSimilarForEdges(params: FindSimilarForEdgesParams): Promise<FindSimilarForEdgesResult[]>;
findNeighborMemories(params: FindNeighborMemoriesParams): Promise<Memory[]>;
```

### Task 2: Implement graph methods in LocalProvider

File: `src/db/providers/local.ts`

**insertMemoryConnection**: canonical ordering (`min(a,b)`, `max(a,b)`), upsert on conflict.

**findSimilarForEdges**: vector search excluding `excludeId`, returning `id + similarity`, limit 50 at threshold 0.75.

**findNeighborMemories**: find memories connected (in either direction) to any seed ID, excluding the seeds themselves.

```sql
-- findNeighborMemories
SELECT DISTINCT m.id, m.content, m.category, m.confidence, m.access_count, m.created_at
FROM memories m
WHERE m.user_id = $1
  AND m.superseded_by IS NULL
  AND m.id != ALL($2::uuid[])
  AND EXISTS (
    SELECT 1 FROM memory_connections mc
    WHERE (mc.memory_a_id = m.id AND mc.memory_b_id = ANY($2::uuid[]))
       OR (mc.memory_b_id = m.id AND mc.memory_a_id = ANY($2::uuid[]))
  )
```

### Task 3: Add stubs to SupabaseProvider

File: `src/db/providers/supabase.ts`

Stub implementations that throw `'not implemented'` (Supabase graph is manual — same pattern as `runMigrations`).

### Task 4: Create src/memory/graph.ts

Two exports:

**buildEdges(params)**: called after memory insert with the new memory's id, userId, and embedding. Finds top-50 similar (threshold 0.75, excludes self) and inserts connections.

**graphRagSearch(params)**: seed (matchMemories) → expand (findNeighborMemories) → combine → rerank by `sim * 0.6 + recency * 0.4` → fire-and-forget updateAccessStats → return top-N.

Recency formula: `Math.exp(-daysOld / 7)` where `daysOld = (Date.now() - new Date(m.created_at).getTime()) / 86_400_000`.

### Task 5: Wire buildEdges into store.ts insertMemory

File: `src/memory/store.ts`

After the `db.insertMemory()` call, await `buildEdges({ memoryId: id, userId, embedding })`.

### Task 6: Tests

File: `tests/db/graph.test.ts`

Using `LocalProvider` in-memory (same pattern as `tests/db/local.test.ts`):

1. `insertMemoryConnection` creates a retrievable edge
2. `findSimilarForEdges` returns similar memories above threshold, excludes self
3. `findNeighborMemories` returns 1-hop neighbors of seeds
4. `graphRagSearch` returns seeds + neighbors, reranked (use orthogonal unit vectors where cosine sim is predictable by hand — dim 768, set one dimension to 1.0 for clarity)

## Decisions

- Edge direction: `memoryAId = min(id1, id2)`, `memoryBId = max(id1, id2)` (string/UUID ordering)
- Edge threshold: 0.75 cosine similarity
- Edge fan-out: top 50 per insert
- buildEdges is in-band (awaited inside insertMemory)
- Memory bump: fire-and-forget inside graphRagSearch
- Supabase graph: stubs only (manual setup required)
