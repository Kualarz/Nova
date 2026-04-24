/**
 * Memory flush — proactive extraction during long sessions.
 *
 * Every FLUSH_EVERY turns, extract memories from the conversation so far and
 * reconcile them into Tier 3. This ensures important context is persisted
 * even if the session is interrupted or grows very long.
 *
 * This is NOVA's equivalent of "flush before compaction": we don't run inside
 * Claude Code's compaction harness, so we trigger on turn count instead.
 */

import { extractMemories } from './extract.js';
import { reconcileMemories } from './reconcile.js';

const FLUSH_EVERY = 20; // turns between flushes

export function shouldFlush(turnCount: number): boolean {
  return turnCount > 0 && turnCount % FLUSH_EVERY === 0;
}

/**
 * Silently flush memories from the current transcript.
 * Errors are caught and swallowed — flush is best-effort.
 */
export async function flushMemories(
  transcript: string,
  conversationId: string
): Promise<void> {
  try {
    const candidates = await extractMemories(transcript);
    if (candidates.length > 0) {
      await reconcileMemories(candidates, conversationId);
    }
  } catch {
    // Best-effort — do not surface flush errors to the user
  }
}
