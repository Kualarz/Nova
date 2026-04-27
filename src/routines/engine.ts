/**
 * Routine engine — node-cron scheduler for user-defined recurring prompts.
 *
 * A routine is: name + prompt + cron_expr + enabled. When the cron fires we
 * run the prompt through the model router with NOVA's base system prompt and
 * record the result in the routine_runs table for history.
 */

import cron, { type ScheduledTask } from 'node-cron';
import { getDb } from '../db/client.js';
import { getModelRouter } from '../providers/router.js';
import { buildBaseSystemPrompt } from '../agent/system-prompt.js';
import type { Routine } from '../db/interface.js';

const _scheduledTasks = new Map<string, ScheduledTask>();

export async function executeRoutine(routine: Routine): Promise<{ status: 'success' | 'error'; output?: string; error?: string }> {
  const db = await getDb();
  const runId = await db.insertRoutineRun(routine.id);
  console.log(`[routine:${routine.name}] Starting run ${runId}`);

  try {
    const systemPrompt = await buildBaseSystemPrompt();
    const router = getModelRouter();
    const resp = await router.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: `[Routine: ${routine.name}]\n\n${routine.prompt}` },
      ],
      { temperature: 0.5 }
    );

    const output = (resp.content ?? '').trim();
    const truncated = output.slice(0, 2000);

    await db.completeRoutineRun(runId, 'success', output);
    await db.updateRoutine(routine.id, {
      last_run_at: new Date().toISOString(),
      last_run_status: 'success',
      last_run_output: truncated,
    });

    console.log(`[routine:${routine.name}] Done`);
    return { status: 'success', output };
  } catch (err) {
    const errMsg = (err as Error).message;
    await db.completeRoutineRun(runId, 'error', undefined, errMsg);
    await db.updateRoutine(routine.id, {
      last_run_at: new Date().toISOString(),
      last_run_status: 'error',
      last_run_output: errMsg.slice(0, 2000),
    });
    console.error(`[routine:${routine.name}] Failed:`, errMsg);
    return { status: 'error', error: errMsg };
  }
}

export function scheduleRoutine(routine: Routine): void {
  unscheduleRoutine(routine.id);
  if (!routine.enabled) return;
  if (!cron.validate(routine.cron_expr)) {
    console.warn(`[routines] Invalid cron expression for ${routine.name}: ${routine.cron_expr}`);
    return;
  }
  const task = cron.schedule(routine.cron_expr, () => {
    void executeRoutine(routine);
  });
  _scheduledTasks.set(routine.id, task);
  console.log(`[routines] Scheduled ${routine.name} (${routine.cron_expr})`);
}

export function unscheduleRoutine(id: string): void {
  const existing = _scheduledTasks.get(id);
  if (existing) {
    existing.stop();
    _scheduledTasks.delete(id);
  }
}

export async function loadAllRoutines(userId: string): Promise<void> {
  const db = await getDb();
  const routines = await db.listRoutines(userId);
  for (const r of routines) {
    scheduleRoutine(r);
  }
  console.log(`[routines] Loaded ${routines.length} routine(s)`);
}
