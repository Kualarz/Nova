import { CandidateMemory } from './extract.js';
import { findSimilar, insertMemory, supersedeMemory } from './store.js';
import { getConfig } from '../lib/config.js';

const SUPERSEDE_THRESHOLD = 0.92;
const DUPLICATE_THRESHOLD = 0.88;

export async function reconcileMemories(
  candidates: CandidateMemory[],
  sourceConversationId?: string
): Promise<void> {
  const config = getConfig();
  if (!config.NOVA_USER_ID || candidates.length === 0) return;

  for (const candidate of candidates) {
    const similar = await findSimilar({
      userId: config.NOVA_USER_ID,
      query: candidate.content,
      limit: 3,
      threshold: DUPLICATE_THRESHOLD,
    });

    if (similar.length === 0) {
      await insertMemory({
        userId: config.NOVA_USER_ID,
        content: candidate.content,
        category: candidate.category,
        confidence: candidate.confidence,
        sourceConversationId,
      });
      continue;
    }

    const topMatch = similar[0];

    if ((topMatch.similarity ?? 0) >= SUPERSEDE_THRESHOLD) {
      if (topMatch.content !== candidate.content) {
        const newId = await insertMemory({
          userId: config.NOVA_USER_ID,
          content: candidate.content,
          category: candidate.category,
          confidence: candidate.confidence,
          sourceConversationId,
        });
        await supersedeMemory(topMatch.id, newId);
      }
      // else: identical content, skip
    }
    // else: similar but not a supersede — both are distinct enough to keep
  }
}
