import { getConfig } from './lib/config.js';
import { printStatus } from './lib/status.js';
import { runSession } from './agent/nova.js';

async function main(): Promise<void> {
  getConfig(); // validates all env vars, exits if any are missing

  const args = process.argv.slice(2);
  if (args.includes('--status') || args.includes('-s')) {
    await printStatus();
    process.exit(0);
  }

  console.log('nova booting...');
  await runSession();
}

main().catch(err => {
  console.error('[nova] fatal:', err);
  process.exit(1);
});
