/**
 * Telegram channel — grammy bot using long-polling.
 *
 * Setup:
 *  1. Message @BotFather on Telegram → /newbot → copy token
 *  2. Set TELEGRAM_BOT_TOKEN in .env
 *  3. Send /start to your bot to get your chat ID
 *  4. Set TELEGRAM_CHAT_ID in .env
 */

import { Bot } from 'grammy';
import { getConfig } from '../lib/config.js';
import type { Channel } from './interface.js';

export class TelegramChannel implements Channel {
  private bot: Bot;
  private chatId: string;
  private _messageHandler?: (text: string) => Promise<void>;

  constructor() {
    const config = getConfig();
    if (!config.TELEGRAM_BOT_TOKEN) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set in .env');
    }
    if (!config.TELEGRAM_CHAT_ID) {
      throw new Error('TELEGRAM_CHAT_ID is not set in .env');
    }
    this.bot = new Bot(config.TELEGRAM_BOT_TOKEN);
    this.chatId = config.TELEGRAM_CHAT_ID;
    this._setupHandlers();
  }

  private _setupHandlers(): void {
    // Only respond to Jimmy's chat — ignore all other chats
    this.bot.on('message:text', async ctx => {
      if (String(ctx.chat.id) !== this.chatId) return;
      const text = ctx.message.text;
      if (this._messageHandler) {
        try {
          await this._messageHandler(text);
        } catch (err) {
          await ctx.reply(`[error] ${(err as Error).message}`);
        }
      }
    });

    this.bot.catch(err => {
      console.error('[telegram] bot error:', err.message);
    });
  }

  async sendMessage(text: string): Promise<void> {
    // Telegram has a 4096 char limit — chunk if needed
    const chunks = chunkText(text, 4000);
    for (const chunk of chunks) {
      await this.bot.api.sendMessage(this.chatId, chunk, { parse_mode: 'Markdown' });
    }
  }

  onMessage(handler: (text: string) => Promise<void>): void {
    this._messageHandler = handler;
  }

  async start(): Promise<void> {
    // Start long-polling in the background (grammy handles the loop)
    void this.bot.start();
    console.log('[telegram] bot polling started');
  }

  async stop(): Promise<void> {
    await this.bot.stop();
    console.log('[telegram] bot stopped');
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

// Singleton — one bot instance per process
let _channel: TelegramChannel | null = null;

export function getTelegramChannel(): TelegramChannel {
  if (!_channel) _channel = new TelegramChannel();
  return _channel;
}
