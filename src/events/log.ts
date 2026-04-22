import { getDb } from '../db/client.js';
import { getConfig } from '../lib/config.js';

export type EventType =
  | 'session_start'
  | 'session_end'
  | 'message'
  | 'tool_call'
  | 'memory_extracted'
  | 'error';

export async function logEvent(type: EventType, payload: Record<string, unknown> = {}): Promise<void> {
  const config = getConfig();
  if (!config.NOVA_USER_ID) return;

  try {
    const db = await getDb();
    await db.logEvent(config.NOVA_USER_ID, type, payload);
  } catch (err) {
    console.error(`[nova] logEvent failed (${type}): ${(err as Error).message}`);
  }
}
