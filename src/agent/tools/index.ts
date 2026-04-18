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

import { webSearchTool } from './web-search.js';
import { weatherTool } from './weather.js';
import { newsTool } from './news.js';
import { notionSearchTool, notionGetPageTool, notionCreatePageTool } from './notion.js';
import { calendarTool, gmailSearchTool } from './google.js';

export const ALL_TOOLS: ToolDefinition[] = [
  webSearchTool,
  weatherTool,
  newsTool,
  notionSearchTool,
  notionGetPageTool,
  notionCreatePageTool,
  calendarTool,
  gmailSearchTool,
];

/** Convert to the shape the Anthropic SDK expects for messages.create(). */
export function toApiTools() {
  return ALL_TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

/** Execute a tool by name. Throws if tool not found. */
export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  const tool = ALL_TOOLS.find(t => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.run(input);
}
