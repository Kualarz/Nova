/**
 * Evening digest — sent at 6pm daily via Telegram.
 *
 * Covers: what was worked on today, outstanding tasks, tomorrow's calendar.
 */

import { runPrompt } from '../agent/nova.js';
import { logEvent } from '../events/log.js';
import { listRecentTasks } from '../tasks/store.js';

export async function sendEveningDigest(
  sendMessage: (text: string) => Promise<void>
): Promise<void> {
  console.log('[digest] generating evening digest...');
  try {
    const tasks = await listRecentTasks(5);
    const runningTasks = tasks.filter(t => t.status === 'running');
    const taskContext = runningTasks.length > 0
      ? `Running tasks: ${runningTasks.map(t => t.description.slice(0, 60)).join('; ')}`
      : 'No tasks currently running.';

    const DIGEST_PROMPT = `You are NOVA preparing Jimmy's evening digest.

Context: ${taskContext}

Generate a concise end-of-day digest. Include:
1. **Today** — what was worked on (from today's memory notes and conversation history)
2. **Outstanding** — anything unfinished or pending a response
3. **Tomorrow** — first thing on the calendar tomorrow

Keep it under 150 words. Tone: brief, no fluff. If there's nothing notable, say so in one line.`;

    const digest = await runPrompt(DIGEST_PROMPT);
    const header = `🌆 *Evening digest — ${new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Australia/Melbourne' })}*\n\n`;
    await sendMessage(header + digest);
    await logEvent('evening_digest_sent', {});
    console.log('[digest] evening digest sent');
  } catch (err) {
    console.error('[digest] failed:', (err as Error).message);
  }
}
