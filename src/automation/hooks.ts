import { getDb } from '../db/client.js';
import { getSkillLoader } from '../skills/loader.js';
import { runPrompt } from '../agent/nova.js';

// Recursion guard — prevents tool.before/tool.after hooks from nesting runTurns infinitely.
// Only outer-loop events (session.start, session.end, routine.fire) are safe to fire.
let _depth = 0;

export async function fireHook(event: string, context?: Record<string, unknown>): Promise<void> {
  if (_depth > 0) return;

  const db = await getDb();
  const hooks = await db.getEnabledHooks(event);
  if (hooks.length === 0) return;

  const skills = await getSkillLoader().loadAll();

  for (const hook of hooks) {
    const skill = skills.find(s => s.name === hook.skill_name);
    if (!skill) continue;

    const prompt = context
      ? `${skill.body}\n\nContext: ${JSON.stringify(context)}`
      : skill.body;

    _depth++;
    try {
      await runPrompt(prompt);
    } catch (err) {
      console.error(`[hooks] ${event}/${hook.skill_name} error: ${(err as Error).message}`);
    } finally {
      _depth--;
    }
  }
}
