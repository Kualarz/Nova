/**
 * Morning briefing — sent to Jimmy at 8am daily via Telegram.
 *
 * Covers: weather, today's calendar events, top AI news from last 24h.
 */

import { runPrompt } from '../agent/nova.js';
import { logEvent } from '../events/log.js';

const MORNING_BRIEFING_PROMPT = `You are NOVA preparing Jimmy's morning briefing. Today is ${new Date().toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Australia/Melbourne' })}.

Generate a concise morning briefing for Jimmy. Include:
1. **Weather** — current Melbourne conditions and today's forecast (use the get_weather tool)
2. **Calendar** — today's events and anything in the next 48 hours (use the calendar tool if available)
3. **AI news** — top 2–3 stories from the last 24 hours (use get_news with category "ai")

Format:
- Use short bullet points, no waffle
- Lead with the most time-sensitive item
- Keep the whole briefing under 200 words
- End with one sentence: what NOVA thinks Jimmy's priority should be today, based on what's on the calendar and in memory

Tone: direct, like a sharp colleague who has already done the research.`;

export async function sendMorningBriefing(
  sendMessage: (text: string) => Promise<void>
): Promise<void> {
  console.log('[briefing] generating morning briefing...');
  try {
    const briefing = await runPrompt(MORNING_BRIEFING_PROMPT);
    const header = `☀️ *Morning briefing — ${new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Australia/Melbourne' })}*\n\n`;
    await sendMessage(header + briefing);
    await logEvent('morning_briefing_sent', {});
    console.log('[briefing] morning briefing sent');
  } catch (err) {
    console.error('[briefing] failed:', (err as Error).message);
  }
}
