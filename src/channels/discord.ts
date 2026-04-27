/**
 * Discord channel — discord.js bot using gateway connection.
 *
 * Setup:
 *  1. Create app at https://discord.com/developers/applications
 *  2. Bot tab → Reset Token → copy → set DISCORD_BOT_TOKEN in .env
 *  3. Bot tab → enable "Message Content Intent"
 *  4. OAuth2 → URL Generator → scopes: bot, applications.commands
 *     bot permissions: Send Messages, Read Message History
 *     Open the generated URL → invite to a server you control
 *  5. Get your Discord user ID (right-click your name in Discord → Copy User ID
 *     — Developer Mode must be on in Settings → Advanced)
 *  6. DM your bot once so it can DM you back. Set DISCORD_USER_ID in .env.
 */

import { Client, GatewayIntentBits, Partials, Events, type Message as DiscordMessage } from 'discord.js';
import { getConfig } from '../lib/config.js';
import type { Channel } from './interface.js';

export class DiscordChannel implements Channel {
  private client: Client;
  private userId: string;
  private _messageHandler?: (text: string) => Promise<void>;
  private _ready = false;

  constructor() {
    const config = getConfig();
    if (!config.DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN is not set in .env');
    if (!config.DISCORD_USER_ID)  throw new Error('DISCORD_USER_ID is not set in .env');
    this.userId = config.DISCORD_USER_ID;

    this.client = new Client({
      intents: [
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
        // GuildMessages would let it listen in servers too — we only want DMs
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    this._setupHandlers();
  }

  private _setupHandlers(): void {
    this.client.once(Events.ClientReady, c => {
      this._ready = true;
      console.log(`[discord] logged in as ${c.user.tag}`);
    });

    this.client.on(Events.MessageCreate, async (msg: DiscordMessage) => {
      // Only respond to DMs from the configured user, ignore the bot itself
      if (msg.author.bot) return;
      if (msg.author.id !== this.userId) return;
      if (msg.guild) return; // Ignore guild messages — DMs only
      const text = msg.content;
      if (!text || !this._messageHandler) return;
      try {
        await this._messageHandler(text);
      } catch (err) {
        try { await msg.reply(`[error] ${(err as Error).message}`); } catch { /* best-effort */ }
      }
    });

    this.client.on(Events.Error, err => {
      console.error('[discord] client error:', err.message);
    });
  }

  async sendMessage(text: string): Promise<void> {
    if (!this._ready) {
      // Wait briefly for client ready in case start() was just called
      await new Promise(r => setTimeout(r, 500));
    }
    const user = await this.client.users.fetch(this.userId);
    // Discord limit is 2000 chars per message — chunk if needed
    const chunks = chunkText(text, 1900);
    for (const chunk of chunks) {
      await user.send(chunk);
    }
  }

  onMessage(handler: (text: string) => Promise<void>): void {
    this._messageHandler = handler;
  }

  async start(): Promise<void> {
    const config = getConfig();
    await this.client.login(config.DISCORD_BOT_TOKEN);
    console.log('[discord] gateway connecting…');
  }

  async stop(): Promise<void> {
    await this.client.destroy();
    console.log('[discord] disconnected');
  }
}

function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + maxLen));
    i += maxLen;
  }
  return chunks;
}

let _channel: DiscordChannel | null = null;

export function getDiscordChannel(): DiscordChannel {
  if (!_channel) _channel = new DiscordChannel();
  return _channel;
}
