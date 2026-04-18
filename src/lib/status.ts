import chalk from 'chalk';
import { getDb } from '../db/client.js';
import { getConfig } from './config.js';
import { getTier2Context } from '../memory/tier2-daily.js';
import * as fs from 'fs';
import * as path from 'path';

export async function printStatus(): Promise<void> {
  const config = getConfig();
  const db = getDb();

  console.log(chalk.bold('\n— NOVA status —\n'));

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

  // Tier 3: memory count from Supabase
  if (config.NOVA_USER_ID) {
    try {
      const { count, error } = await db
        .from('memories')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', config.NOVA_USER_ID)
        .is('superseded_by', null);
      if (error) throw error;
      console.log(`Tier 3 (semantic): ${count ?? 0} active memories`);
    } catch {
      console.log('Tier 3 (semantic): could not query');
    }

    // Session stats
    try {
      const { count: sessionCount, error: sessionErr } = await db
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', config.NOVA_USER_ID);
      if (sessionErr) throw sessionErr;
      console.log(`Sessions total: ${sessionCount ?? 0}`);
    } catch {
      console.log('Sessions: could not query');
    }

    // Last session
    try {
      const { data: lastSession, error: lsErr } = await db
        .from('conversations')
        .select('started_at, ended_at')
        .eq('user_id', config.NOVA_USER_ID)
        .order('started_at', { ascending: false })
        .limit(1)
        .single();
      if (!lsErr && lastSession) {
        const started = new Date(lastSession.started_at as string);
        console.log(`Last session: ${started.toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' })}`);
      }
    } catch {
      // skip
    }
  } else {
    console.log('(Supabase stats unavailable — NOVA_USER_ID not set)');
  }

  console.log('');
}
