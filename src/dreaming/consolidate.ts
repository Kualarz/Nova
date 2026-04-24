/**
 * Dreaming — nightly memory consolidation.
 *
 * Reads Tier 2 daily notes from the last 7 days, extracts anything
 * worth promoting to Tier 3, and reconciles with existing memories.
 * This is how short-term signals become durable long-term memory.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from '../lib/config.js';
import { extractMemories } from '../memory/extract.js';
import { reconcileMemories } from '../memory/reconcile.js';
import { logEvent } from '../events/log.js';

function getLast7DaysNotes(): string {
  const config = getConfig();
  const memDir = path.join(config.NOVA_WORKSPACE_PATH, 'memory');
  const parts: string[] = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const filePath = path.join(memDir, `${dateStr}.md`);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      if (content) parts.push(`### ${dateStr}\n${content}`);
    }
  }

  return parts.join('\n\n');
}

export async function runDreaming(): Promise<{ extracted: number }> {
  console.log('[dreaming] starting nightly consolidation...');

  const notes = getLast7DaysNotes();
  if (!notes.trim()) {
    console.log('[dreaming] no daily notes found — nothing to consolidate');
    return { extracted: 0 };
  }

  try {
    const candidates = await extractMemories(notes);
    if (candidates.length === 0) {
      console.log('[dreaming] no new memories to extract');
      return { extracted: 0 };
    }

    // Use a synthetic conversation ID for dreaming sessions
    const dreamConvId = `dream-${new Date().toISOString().slice(0, 10)}`;
    await reconcileMemories(candidates, dreamConvId);

    await logEvent('dreaming_complete', { extracted: candidates.length });
    console.log(`[dreaming] consolidated ${candidates.length} memories from last 7 days`);
    return { extracted: candidates.length };
  } catch (err) {
    console.error('[dreaming] error:', (err as Error).message);
    return { extracted: 0 };
  }
}
