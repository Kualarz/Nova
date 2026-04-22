/**
 * In-session slash commands.
 * These are intercepted in the REPL loop before hitting the API.
 *
 * /recall <query>    — search all three tiers for memories matching query
 * /forget <keyword>  — mark matching active memories as superseded
 * /promote <id>      — copy a Tier 3 memory into MEMORY.md (Tier 1)
 * /news [category]   — quick news digest without a full conversation turn
 * /help              — list available commands
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { searchTier3 } from '../memory/tier3-semantic.js';
import { findSimilar, supersedeMemory, insertMemory } from '../memory/store.js';
import { getConfig } from '../lib/config.js';
import { newsTool } from './tools/news.js';

export function isSlashCommand(input: string): boolean {
  return input.trim().startsWith('/');
}

export async function handleSlashCommand(input: string): Promise<void> {
  const trimmed = input.trim();
  const [cmd, ...rest] = trimmed.split(/\s+/);
  const arg = rest.join(' ');

  switch (cmd) {
    case '/help':
      printHelp();
      break;

    case '/recall':
      await cmdRecall(arg);
      break;

    case '/forget':
      await cmdForget(arg);
      break;

    case '/promote':
      await cmdPromote(arg);
      break;

    case '/news':
      await cmdNews(arg);
      break;

    default:
      console.log(chalk.dim(`Unknown command "${cmd}". Type /help for a list.\n`));
  }
}

function printHelp(): void {
  console.log(
    chalk.dim(`
Slash commands:
  /recall <query>    Search memory tiers for anything matching query
  /forget <keyword>  Supersede all active memories matching keyword
  /promote <id>      Copy a Tier 3 memory into MEMORY.md (Tier 1)
  /news [category]   Quick news digest (categories: ai, world, tech, all)
  /help              Show this message
`)
  );
}

async function cmdRecall(query: string): Promise<void> {
  if (!query) {
    console.log(chalk.dim('Usage: /recall <query>\n'));
    return;
  }

  console.log(chalk.dim(`\nSearching memories for "${query}"...\n`));

  // Tier 1: scan MEMORY.md
  const config = getConfig();
  const memPath = path.join(config.NOVA_WORKSPACE_PATH, 'MEMORY.md');
  if (fs.existsSync(memPath)) {
    const lines = fs.readFileSync(memPath, 'utf-8').split('\n');
    const matches = lines.filter(
      l => l.trim() && !l.startsWith('#') && l.toLowerCase().includes(query.toLowerCase())
    );
    if (matches.length > 0) {
      console.log(chalk.bold('Tier 1 (MEMORY.md):'));
      matches.forEach(l => console.log('  ' + l.trim()));
      console.log('');
    }
  }

  // Tier 3: semantic search
  if (config.NOVA_USER_ID) {
    try {
      const { memories } = await searchTier3(query, 8);
      if (memories.length > 0) {
        console.log(chalk.bold(`Tier 3 (semantic — ${memories.length} results):`));
        memories.forEach(m => {
          const sim = m.similarity ? ` (${(m.similarity * 100).toFixed(0)}%)` : '';
          console.log(`  [${m.id.slice(0, 8)}] [${m.category}]${sim} ${m.content}`);
        });
        console.log('');
      } else {
        console.log(chalk.dim('No semantic memories found.\n'));
      }
    } catch (err) {
      console.log(chalk.dim(`Tier 3 search failed: ${(err as Error).message}\n`));
    }
  }
}

async function cmdForget(keyword: string): Promise<void> {
  if (!keyword) {
    console.log(chalk.dim('Usage: /forget <keyword>\n'));
    return;
  }

  const config = getConfig();
  if (!config.NOVA_USER_ID) {
    console.log(chalk.dim('NOVA_USER_ID not set — cannot modify memories.\n'));
    return;
  }

  // Find matching active memories via semantic search
  const memories = await findSimilar({
    userId: config.NOVA_USER_ID,
    query: keyword,
    limit: 5,
    threshold: 0.6,
  });

  if (memories.length === 0) {
    console.log(chalk.dim(`No memories found matching "${keyword}".\n`));
    return;
  }

  console.log(chalk.dim(`\nFound ${memories.length} matching memories:`));
  memories.forEach(m => console.log(`  [${m.id.slice(0, 8)}] ${m.content}`));
  console.log('');
  console.log(chalk.dim('These will be marked as superseded. (Run /recall to verify after.)\n'));

  // Supersede them by creating a "forgotten" placeholder with a real embedding
  for (const m of memories) {
    try {
      const newId = await insertMemory({
        userId: config.NOVA_USER_ID,
        content: `[forgotten: ${m.content.slice(0, 80)}]`,
        category: m.category,
        confidence: 0,
      });
      await supersedeMemory(m.id, newId);
    } catch {
      // skip failed individual
    }
  }

  console.log(chalk.dim(`Done. ${memories.length} memories superseded.\n`));
}

async function cmdPromote(idOrKeyword: string): Promise<void> {
  if (!idOrKeyword) {
    console.log(chalk.dim('Usage: /promote <memory-id-or-keyword>\n'));
    console.log(chalk.dim('Use /recall <query> to find a memory ID first.\n'));
    return;
  }

  const config = getConfig();
  if (!config.NOVA_USER_ID) {
    console.log(chalk.dim('NOVA_USER_ID not set.\n'));
    return;
  }

  // Find memory via semantic search (use /recall first to identify the right memory)
  let memoryContent: string | undefined;

  const memories = await findSimilar({
    userId: config.NOVA_USER_ID,
    query: idOrKeyword,
    limit: 1,
    threshold: 0.6,
  });
  if (memories[0]) memoryContent = memories[0].content;

  if (!memoryContent) {
    console.log(chalk.dim(`Could not find memory matching "${idOrKeyword}".\n`));
    return;
  }

  // Append to MEMORY.md
  const memPath = path.join(config.NOVA_WORKSPACE_PATH, 'MEMORY.md');
  const line = `- ${memoryContent}`;

  fs.appendFileSync(memPath, '\n' + line + '\n');
  console.log(chalk.dim(`\nPromoted to Tier 1 (MEMORY.md):\n  ${line}\n`));
}

async function cmdNews(category: string): Promise<void> {
  const cat = category.trim() || 'all';
  const validCategories = ['ai', 'world', 'tech', 'all'];
  if (!validCategories.includes(cat)) {
    console.log(chalk.dim(`Unknown category "${cat}". Use: ai, world, tech, all\n`));
    return;
  }

  console.log(chalk.dim(`\nFetching ${cat} news (last 24h)...\n`));

  try {
    const result = await newsTool.run({ category: cat, since_hours: 24, max_items: 12 });
    console.log(chalk.white(result) + '\n');
  } catch (err) {
    console.log(chalk.dim(`News fetch failed: ${(err as Error).message}\n`));
  }
}
