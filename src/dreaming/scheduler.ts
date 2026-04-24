/**
 * Dreaming scheduler — runs nightly at 3am Melbourne time.
 */

import cron from 'node-cron';
import { runDreaming } from './consolidate.js';

let _task: cron.ScheduledTask | null = null;

export function startDreaming(): void {
  if (_task) return;

  // 3am Melbourne = 5pm UTC (AEST, UTC+10) or 4pm UTC (AEDT, UTC+11)
  // Using 17:00 UTC as a stable approximation (runs close to 3am in both AEST/AEDT)
  _task = cron.schedule('0 17 * * *', async () => {
    await runDreaming();
  });

  console.log('[dreaming] scheduler started (nightly at ~3am Melbourne)');
}

export function stopDreaming(): void {
  _task?.stop();
  _task = null;
}
