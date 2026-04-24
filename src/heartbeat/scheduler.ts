/**
 * Heartbeat scheduler — fires every 30 minutes during active hours.
 *
 * Active hours: 8am–10pm Melbourne (AEDT/AEST).
 * If the heartbeat check returns something, it's sent to Jimmy via the active channel.
 */

import cron from 'node-cron';
import { runHeartbeatCheck } from './check.js';
import { logEvent } from '../events/log.js';

let _task: cron.ScheduledTask | null = null;

const ACTIVE_START = 8;  // 8am Melbourne
const ACTIVE_END   = 22; // 10pm Melbourne

function isMelbourneActiveHour(): boolean {
  // node-cron runs in server local time. If the server is on Fly.io (UTC),
  // Melbourne AEST = UTC+10, AEDT = UTC+11.
  // For simplicity, we use the process timezone offset.
  const now = new Date();
  const hour = new Date(
    now.toLocaleString('en-US', { timeZone: 'Australia/Melbourne' })
  ).getHours();
  return hour >= ACTIVE_START && hour < ACTIVE_END;
}

export function startHeartbeat(
  sendMessage: (text: string) => Promise<void>
): void {
  if (_task) return; // already running

  // Every 30 minutes
  _task = cron.schedule('*/30 * * * *', async () => {
    if (!isMelbourneActiveHour()) return;

    const message = await runHeartbeatCheck();
    if (message) {
      try {
        await sendMessage(message);
        await logEvent('heartbeat_sent', { message: message.slice(0, 100) });
      } catch (err) {
        console.error('[heartbeat] send failed:', (err as Error).message);
      }
    } else {
      await logEvent('heartbeat_noreply', {});
    }
  });

  console.log('[heartbeat] scheduler started (every 30 min, active hours 8am–10pm Melbourne)');
}

export function stopHeartbeat(): void {
  _task?.stop();
  _task = null;
}
