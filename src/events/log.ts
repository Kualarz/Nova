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

  const db = getDb();
  const { error } = await db.from('events').insert({
    user_id: config.NOVA_USER_ID,
    event_type: type,
    payload,
  });

  if (error) {
    console.error(`[nova] logEvent failed (${type}): ${error.message}`);
  }
}
