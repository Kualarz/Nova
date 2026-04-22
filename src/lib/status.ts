import chalk from 'chalk';
import { getConfig } from './config.js';
import { getTier2Context } from '../memory/tier2-daily.js';
import * as fs from 'fs';
import * as path from 'path';

export async function printStatus(): Promise<void> {
  const config = getConfig();

  console.log(chalk.bold('\n— NOVA status —\n'));
  console.log(`Provider: ${config.MODEL_PROVIDER} / ${config.DEFAULT_MODEL}`);
  console.log(`Database: ${config.DATABASE_TYPE}`);
  console.log('');

  // Tier 1: MEMORY.md line count (non-comment, non-blank)
  try {
    const memPath = path.join(config.NOVA_WORKSPACE_PATH, 'MEMORY.md');
    if (fs.existsSync(memPath)) {
      const lines = fs.readFileSync(memPath, 'utf-8').split('\n');
      const facts = lines.filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('<!--'));
      console.log(`Tier 1 (curated): ${facts.length} facts in MEMORY.md`);
    } else {
      console.log('Tier 1 (curated): MEMORY.md not found');
    }
  } catch {
    console.log('Tier 1 (curated): could not read');
  }

  // Tier 2: daily note lines
  try {
    const tier2 = getTier2Context();
    const lines = tier2.split('\n').filter(l => l.trim());
    console.log(`Tier 2 (recent): ${lines.length} lines across last 2 days`);
  } catch {
    console.log('Tier 2 (recent): could not read');
  }

  // Tier 3: memory count via DatabaseProvider
  if (config.NOVA_USER_ID) {
    console.log(`Tier 3 (semantic): active (use /recall <topic> to query memories)`);
  } else {
    console.log('Tier 3 (semantic): set NOVA_USER_ID to query');
  }

  console.log('');
}
