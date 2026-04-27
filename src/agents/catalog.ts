/**
 * Phase 4.3 — sub-agent catalog.
 *
 * Sub-agents are specialist NOVA personas the main agent can spawn for focused
 * work. Each runs in its own loop with an isolated history and a curated tool
 * subset. Definitions live as markdown files in `${NOVA_WORKSPACE_PATH}/agents/`
 * with YAML-ish frontmatter; if that directory doesn't exist (or is empty) we
 * fall back to the hard-coded DEFAULT_SUBAGENTS below so things work out of the
 * box.
 *
 *   ---
 *   name: researcher
 *   description: Deep research with web search
 *   tools: web_search, notion_search
 *   ---
 *   You are a research specialist…
 */

import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from '../lib/config.js';

export interface SubagentDef {
  name: string;
  description: string;
  /** Tool names the sub-agent is allowed to call. Empty => pure chat (no tools). */
  tools: string[];
  /** System-prompt body for this specialist. */
  prompt: string;
}

export const DEFAULT_SUBAGENTS: SubagentDef[] = [
  {
    name: 'researcher',
    description: 'Deep research with web search; produces a balanced fact-checked summary',
    tools: ['web_search', 'notion_search'],
    prompt: `You are a research specialist. Given a topic, you systematically gather information from multiple sources, weigh evidence, and produce a balanced summary. You distinguish facts from opinions, cite sources, and surface uncertainty when sources disagree. Output: a markdown briefing with sections (Overview, Key Findings, Sources, Open Questions).`,
  },
  {
    name: 'writer',
    description: 'Polished prose writing — emails, posts, briefs',
    tools: [],
    prompt: `You are a writing specialist. Given a brief, you produce polished, clear, voice-appropriate prose. You match the user's tone, keep things concise, and remove filler. You never start with "Sure!" or "Certainly!" — you just write.`,
  },
  {
    name: 'coder',
    description: 'Writes code from a spec; reads workspace files for context',
    tools: [],
    prompt: `You are a coding specialist. Given a clear spec, you write working code. You explain your approach briefly, write idiomatic code that matches conventions described in the spec, and call out key tradeoffs. You don't add features beyond the spec.`,
  },
  {
    name: 'planner',
    description: 'Breaks down a goal into a step-by-step plan',
    tools: [],
    prompt: `You are a planning specialist. Given a goal, you produce a numbered plan with concrete actionable steps. Each step should be small enough to execute in one go. You note dependencies between steps and call out risks. Output: numbered list with brief justifications.`,
  },
];

/**
 * Loads all sub-agent definitions. Files in workspace/agents/*.md override the
 * defaults of the same name; defaults that aren't overridden are still exposed
 * so the four built-in personas always work.
 *
 * Returns the defaults on any error — callers should never see this throw.
 */
export function loadSubagents(): SubagentDef[] {
  try {
    const config = getConfig();
    const dir = path.join(config.NOVA_WORKSPACE_PATH, 'agents');
    if (!fs.existsSync(dir)) return [...DEFAULT_SUBAGENTS];

    const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.md'));
    if (files.length === 0) return [...DEFAULT_SUBAGENTS];

    const loaded: SubagentDef[] = [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, f), 'utf8');
        const parsed = parseAgentFile(raw);
        if (parsed) loaded.push(parsed);
      } catch {
        // skip individually-bad files
      }
    }

    // Merge: workspace definitions take precedence over defaults of the same name.
    const names = new Set(loaded.map(a => a.name));
    for (const d of DEFAULT_SUBAGENTS) {
      if (!names.has(d.name)) loaded.push(d);
    }
    return loaded;
  } catch {
    return [...DEFAULT_SUBAGENTS];
  }
}

export function getSubagent(name: string): SubagentDef | null {
  const all = loadSubagents();
  return all.find(a => a.name === name) ?? null;
}

/**
 * Parse a markdown file with simple YAML-ish frontmatter:
 *
 *   ---
 *   name: foo
 *   tools: [a, b, c]   (or "a, b, c", or "a b c")
 *   ---
 *   prompt body…
 *
 * Tolerates loose spacing; rejects files without `name`.
 */
function parseAgentFile(raw: string): SubagentDef | null {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(raw);
  if (!m) return null;
  const [, frontmatter, body] = m;

  const fm: Record<string, string> = {};
  for (const line of frontmatter.split('\n')) {
    const match = /^([A-Za-z_]\w*):\s*(.+)$/.exec(line);
    if (match) fm[match[1].toLowerCase()] = match[2].trim();
  }
  if (!fm.name) return null;

  let tools: string[] = [];
  if (fm.tools) {
    // Accept `[a, b]`, `a, b`, or `a b`
    tools = fm.tools
      .replace(/^\[|\]$/g, '')
      .split(/[,\s]+/)
      .map(t => t.replace(/^["']|["']$/g, '').trim())
      .filter(Boolean);
  }

  return {
    name: fm.name,
    description: fm.description ?? '',
    tools,
    prompt: body.trim(),
  };
}
