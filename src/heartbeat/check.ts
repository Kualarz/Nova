/**
 * Heartbeat check — NOVA decides if there's something worth telling Jimmy right now.
 *
 * Uses NO_REPLY sentinel: if the model returns the literal string "NO_REPLY",
 * nothing is sent. This prevents spam when nothing is urgent.
 */

import { runPrompt } from '../agent/nova.js';

const NO_REPLY = 'NO_REPLY';

const HEARTBEAT_PROMPT = `You are NOVA running a background heartbeat check.

Your job: decide if there is anything worth proactively telling Jimmy right now.

Check:
- Is there anything time-sensitive from today's notes or upcoming calendar?
- Is there a piece of news or information Jimmy would want to know immediately?
- Has anything been sitting unresolved that deserves a nudge?

Rules:
- If there is nothing urgent or useful to say, reply with exactly: NO_REPLY
- If there IS something worth saying, reply with a short, direct message (2–4 sentences max)
- Never send generic check-ins like "just checking in" or "hope you're doing well"
- Only send something if it genuinely adds value right now

Reply with either NO_REPLY or the message to send.`;

/**
 * Run the heartbeat check.
 * Returns the message to send, or null if NO_REPLY.
 */
export async function runHeartbeatCheck(): Promise<string | null> {
  try {
    const response = await runPrompt(HEARTBEAT_PROMPT);
    const trimmed = response.trim();
    if (trimmed === NO_REPLY || trimmed.startsWith(NO_REPLY)) return null;
    return trimmed;
  } catch (err) {
    console.error('[heartbeat] check failed:', (err as Error).message);
    return null;
  }
}
