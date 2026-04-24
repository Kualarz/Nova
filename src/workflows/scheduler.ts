/**
 * Workflow scheduler — cron runner for morning briefing and evening digest.
 *
 * Morning briefing: 8am Melbourne
 * Evening digest:   6pm Melbourne
 *
 * Both can be disabled by setting NOVA_WORKFLOWS=off in .env.
 */

import cron from 'node-cron';
import { sendMorningBriefing } from './morning-briefing.js';
import { sendEveningDigest } from './digest.js';
import { getConfig } from '../lib/config.js';

const tasks: cron.ScheduledTask[] = [];

export function startWorkflows(sendMessage: (text: string) => Promise<void>): void {
  const config = getConfig();
  if (config.NOVA_WORKFLOWS === 'off') {
    console.log('[workflows] disabled (NOVA_WORKFLOWS=off)');
    return;
  }

  // 8am Melbourne = 22:00 UTC (AEST) / 21:00 UTC (AEDT)
  // Using 22:00 UTC as a stable approximation
  tasks.push(
    cron.schedule('0 22 * * *', async () => {
      await sendMorningBriefing(sendMessage);
    })
  );

  // 6pm Melbourne = 08:00 UTC (AEST) / 07:00 UTC (AEDT)
  tasks.push(
    cron.schedule('0 8 * * *', async () => {
      await sendEveningDigest(sendMessage);
    })
  );

  console.log('[workflows] scheduled: morning briefing (8am), evening digest (6pm) — Melbourne time');
}

export function stopWorkflows(): void {
  tasks.forEach(t => t.stop());
  tasks.length = 0;
}
