/**
 * NOVA server — long-running background process for Phase 3.
 *
 * Starts:
 *  - Telegram bot (messages in/out)
 *  - Heartbeat scheduler (every 30 min during active hours)
 *  - Dreaming scheduler (nightly at 3am Melbourne)
 *  - Workflow schedulers (morning briefing + evening digest)
 *  - Web UI — Express + WebSocket (port 3000)
 *
 * Run: npm run server
 */

import { getConfig } from './lib/config.js';
import { getTelegramChannel } from './channels/telegram.js';
import { startHeartbeat, stopHeartbeat } from './heartbeat/scheduler.js';
import { startDreaming, stopDreaming } from './dreaming/scheduler.js';
import { startWorkflows, stopWorkflows } from './workflows/scheduler.js';
import { startWebServer, stopWebServer } from './server/web.js';
import { runPrompt } from './agent/nova.js';
import { logEvent } from './events/log.js';

async function main(): Promise<void> {
  const config = getConfig();

  console.log('nova server booting...');
  console.log(`  provider  : ${config.MODEL_PROVIDER} / ${config.DEFAULT_MODEL}`);
  console.log(`  database  : ${config.DATABASE_TYPE}`);

  // --- Telegram channel (optional — skipped if token not set) ---
  let send: (text: string) => Promise<void> = async (text) => {
    console.log(`[telegram] (no bot configured) would send: ${text.slice(0, 80)}`);
  };
  let stopTelegram: () => Promise<void> = async () => {};

  if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
    const telegram = getTelegramChannel();

    telegram.onMessage(async (text: string) => {
      console.log(`[telegram] ← ${text.slice(0, 80)}`);
      try {
        const response = await runPrompt(text);
        await telegram.sendMessage(response);
        console.log(`[telegram] → ${response.slice(0, 80)}`);
      } catch (err) {
        await telegram.sendMessage(`[error] ${(err as Error).message}`);
      }
    });

    await telegram.start();
    send = (text: string) => telegram.sendMessage(text);
    stopTelegram = () => telegram.stop();
  } else {
    console.log('[telegram] skipped — set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID to enable');
  }

  // --- Discord channel (optional — skipped if token not set) ---
  let stopDiscord: () => Promise<void> = async () => {};
  if (config.DISCORD_BOT_TOKEN && config.DISCORD_USER_ID) {
    try {
      const { getDiscordChannel } = await import('./channels/discord.js');
      const discord = getDiscordChannel();

      discord.onMessage(async (text: string) => {
        console.log(`[discord] ← ${text.slice(0, 80)}`);
        try {
          const response = await runPrompt(text);
          await discord.sendMessage(response);
          console.log(`[discord] → ${response.slice(0, 80)}`);
        } catch (err) {
          await discord.sendMessage(`[error] ${(err as Error).message}`);
        }
      });

      await discord.start();
      stopDiscord = () => discord.stop();
    } catch (err) {
      console.warn('[discord] failed to start:', (err as Error).message);
    }
  } else {
    console.log('[discord] skipped — set DISCORD_BOT_TOKEN + DISCORD_USER_ID to enable');
  }

  // --- Schedulers ---
  startHeartbeat(send);
  startDreaming();
  startWorkflows(send);

  // --- Web UI ---
  const dashPort = parseInt(process.env.PORT ?? '3000', 10);
  startWebServer(dashPort);

  await logEvent('server_start', { provider: config.MODEL_PROVIDER });
  console.log('\nnova server online. Ctrl+C to stop.\n');

  // --- Graceful shutdown ---
  const shutdown = async (reason: string) => {
    console.log(`\n[server] shutting down (${reason})...`);
    try {
      stopHeartbeat();
      stopDreaming();
      stopWorkflows();
      stopWebServer();
      await stopTelegram();
      await stopDiscord();
      await logEvent('server_stop', { reason });
    } catch {
      // best-effort
    }
    process.exit(0);
  };

  process.on('SIGINT',  () => { void shutdown('sigint');  });
  process.on('SIGTERM', () => { void shutdown('sigterm'); });
}

main().catch(err => {
  console.error('[server] fatal:', err);
  process.exit(1);
});
