// Tool registry — all tools NOVA can use.
//
// Each tool is reversible (read-only or append) or flagged as irreversible.
// nova.ts never calls irreversible tools without a user confirmation step.

export interface InputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: InputSchema;
  /** Whether this action can't be undone. Default: false (reversible). */
  irreversible?: boolean;
  run(input: Record<string, unknown>): Promise<string>;
}

import type { Tool } from '../../providers/interface.js';
import { webSearchTool } from './web-search.js';
import { weatherTool } from './weather.js';
import { newsTool } from './news.js';
import { notionSearchTool, notionGetPageTool, notionCreatePageTool } from './notion.js';
import { calendarTool, gmailSearchTool } from './google.js';
import { spawnSubagentTool } from './spawn-subagent.js';
import { resolveToolPermission } from '../../connectors/permissions.js';

/** Optional knobs passed by `runWebTurn` so the agent loop can request user
 *  approval for tools tagged `'needs-approval'`. CLI paths leave these unset,
 *  in which case `'needs-approval'` falls through to allow (no channel to ask).
 */
export interface ExecuteToolOptions {
  requestApproval?: (tool: string, args: unknown, description: string) => Promise<boolean>;
}

export const ALL_TOOLS: ToolDefinition[] = [
  webSearchTool,
  weatherTool,
  newsTool,
  notionSearchTool,
  notionGetPageTool,
  notionCreatePageTool,
  calendarTool,
  gmailSearchTool,
  spawnSubagentTool,
];

/** Convert to the OpenAI/Ollama tool format used by ModelRouter. */
export function toApiTools(): Tool[] {
  return ALL_TOOLS.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));
}

/** Execute a tool by name. Throws if tool not found.
 *
 * Phase 3b: consults connector_permissions before running. `'never'` short-
 * circuits with a refusal string the agent sees as the tool result; the
 * model decides how to recover. `'needs-approval'` emits a WS approval
 * request via `options.requestApproval` (when provided) and waits for the
 * user's decision. CLI runs (no requestApproval) treat needs-approval as
 * allow — the tools are already approved by being available in the registry.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  options: ExecuteToolOptions = {}
): Promise<string> {
  const tool = ALL_TOOLS.find(t => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);

  const perm = await resolveToolPermission(name);
  if (perm.permission === 'never') {
    return `[blocked] User has disabled the tool "${name}". Pick a different approach or ask them to enable it under Customize → Connectors.`;
  }
  if (perm.permission === 'needs-approval' && options.requestApproval) {
    const description = `NOVA wants to call ${name}. Allow this once?`;
    const allowed = await options.requestApproval(name, input, description);
    if (!allowed) {
      return `[denied] User denied permission for "${name}". Tell them you skipped it and continue without that data.`;
    }
  }

  return tool.run(input);
}
