import { loadWorkspace } from '../workspace/loader.js';
import { getTier2Context } from '../memory/tier2-daily.js';
import { searchTier3 } from '../memory/tier3-semantic.js';

function currentDateTime(): string {
  return new Date().toLocaleString('en-AU', {
    timeZone: 'Australia/Melbourne',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function buildBaseSystemPrompt(): string {
  const ws = loadWorkspace();
  const tier2 = getTier2Context();

  const parts: string[] = [
    ws.soul,
    ws.agents,
    `## User Profile\n${ws.user}`,
    `## Curated Memory (Tier 1)\n${ws.tier1Memory}`,
  ];

  if (tier2.trim()) {
    parts.push(`## Recent Context (last 2 days)\n${tier2}`);
  }

  parts.push(`## Current Session\n- ${currentDateTime()} (Melbourne, Australia)\n- Phase 1: work-hours terminal session`);

  return parts.join('\n\n---\n\n');
}

export async function buildTier3Injection(query: string): Promise<string> {
  const { formattedContext } = await searchTier3(query, 10);
  if (!formattedContext) return '';
  return `## Relevant Memories (Tier 3)\n${formattedContext}`;
}
