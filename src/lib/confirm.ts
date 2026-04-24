/**
 * Structural human approval gate.
 *
 * Used for irreversible structural actions (spawning Claude Code tasks, etc.)
 * where we need a hard code-level block — not just a model prompt — before proceeding.
 *
 * Usage:
 *   const ok = await confirm('Run claude -p in /path/to/project?');
 *   if (!ok) return;
 */

import * as readline from 'readline';
import chalk from 'chalk';

export async function confirm(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise(resolve => {
    rl.question(chalk.dim(prompt + ' (y/n) '), answer => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}
