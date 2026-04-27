/**
 * Phase 4.3 — `spawn_subagent` tool.
 *
 * The main NOVA agent calls this to delegate a focused task to a specialist
 * persona. The sub-agent runs in its own loop with:
 *   - an isolated message history (parent context not leaked)
 *   - a curated subset of tools (or none for pure-chat agents)
 *   - auto-approval (sub-agents shouldn't prompt the user mid-run)
 *
 * The sub-agent's final assistant text is returned as the tool result.
 */

import { getDb } from '../../db/client.js';
import { runTurn } from '../nova.js';
import { buildBaseSystemPrompt } from '../system-prompt.js';
import { getSubagent, loadSubagents } from '../../agents/catalog.js';
import type { ToolDefinition } from './index.js';

export const spawnSubagentTool: ToolDefinition = {
  name: 'spawn_subagent',
  description:
    "Spawn a specialist sub-agent with isolated context to handle a focused task. Use when the main thread shouldn't get cluttered with the full back-and-forth — e.g., research that needs many web searches, planning that needs deliberation, writing that needs space. Returns the sub-agent's final output. Available agents: researcher, writer, coder, planner (plus any defined in workspace/agents/).",
  input_schema: {
    type: 'object',
    properties: {
      agent: {
        type: 'string',
        description:
          'Name of the sub-agent to spawn. One of: researcher, writer, coder, planner — or any custom agent from workspace/agents/*.md.',
      },
      task: {
        type: 'string',
        description:
          'The task for the sub-agent. Be specific about the deliverable; the sub-agent has no memory of this conversation.',
      },
    },
    required: ['agent', 'task'],
  },
  async run(input: Record<string, unknown>): Promise<string> {
    const agent = String(input.agent ?? '').trim();
    const task = String(input.task ?? '').trim();
    if (!agent || !task) {
      return 'Error: spawn_subagent requires both `agent` and `task`.';
    }
    const result = await runSubagent(agent, task);
    if (result.ok) return result.output;
    return `[error] ${result.error}`;
  },
};

export type SubagentResult =
  | { ok: true; output: string; runId: string }
  | { ok: false; error: string; runId?: string };

/**
 * Programmatic entry point — also reused by the manual-run REST endpoint.
 * Records a row in `subagent_runs` for the UI history panel.
 */
export async function runSubagent(
  agentName: string,
  task: string,
  parentConvId: string | null = null
): Promise<SubagentResult> {
  const def = getSubagent(agentName);
  if (!def) {
    const available = loadSubagents().map(a => a.name).join(', ');
    return {
      ok: false,
      error: `Unknown sub-agent "${agentName}". Available: ${available}.`,
    };
  }

  const db = await getDb();
  let runId: string | undefined;
  try {
    runId = await db.insertSubagentRun(parentConvId, agentName, task);
  } catch {
    // DB unavailable — proceed without persistence rather than failing the run.
  }

  try {
    const baseSystemPrompt = await buildBaseSystemPrompt();
    const systemPrompt = [
      baseSystemPrompt,
      '',
      `# Sub-agent role: ${def.name}`,
      def.prompt,
      '',
      `You are operating as the "${def.name}" sub-agent. Stay focused on the task. When done, return your final output as your reply — that's what gets passed back to the parent.`,
    ].join('\n');

    const result = await runTurn(systemPrompt, [{ role: 'user', content: task }], {
      allowedTools: def.tools,
      requestApproval: () => Promise.resolve(true),
    });

    const output = (result.text ?? '').trim();
    if (runId) {
      try { await db.completeSubagentRun(runId, 'success', output); } catch { /* best-effort */ }
    }
    return { ok: true, output, runId: runId ?? '' };
  } catch (err) {
    const msg = (err as Error).message;
    if (runId) {
      try { await db.completeSubagentRun(runId, 'error', undefined, msg); } catch { /* best-effort */ }
    }
    return { ok: false, error: msg, runId };
  }
}
