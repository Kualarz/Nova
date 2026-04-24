import { getDb } from '../db/client.js';
import { getConfig } from '../lib/config.js';

export type EventType =
  | 'session_start'
  | 'session_end'
  | 'message'
  | 'tool_call'
  | 'memory_extracted'
  | 'error'
  // Phase 3 — server events
  | 'server_start'
  | 'server_stop'
  | 'heartbeat_sent'
  | 'heartbeat_noreply'
  | 'dreaming_complete'
  | 'morning_briefing_sent'
  | 'evening_digest_sent';

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
