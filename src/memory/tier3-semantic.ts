import { findSimilar, updateAccessStats, Memory } from './store.js';
import { getConfig } from '../lib/config.js';

export interface SemanticSearchResult {
  memories: Memory[];
  formattedContext: string;
}

export async function searchTier3(query: string, limit = 10): Promise<SemanticSearchResult> {
  const config = getConfig();
  if (!config.NOVA_USER_ID) return { memories: [], formattedContext: '' };

  const memories = await findSimilar({
    userId: config.NOVA_USER_ID,
    query,
    limit,
    threshold: 0.65,
  });

  if (memories.length === 0) return { memories, formattedContext: '' };

  await updateAccessStats(memories.map(m => m.id));

  const formattedContext = memories
    .map(m => `[${m.category}] ${m.content}`)
    .join('\n');

  return { memories, formattedContext };
}
