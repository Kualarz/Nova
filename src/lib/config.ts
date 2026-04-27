import * as dotenv from 'dotenv';
import { z } from 'zod';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const ConfigSchema = z.object({
  // Required — core infrastructure
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL').default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(''),
  NOVA_USER_ID: z.union([z.literal(''), z.string().uuid()]).default(''),
  NOVA_WORKSPACE_PATH: z.string().min(1, 'NOVA_WORKSPACE_PATH is required'),

  // AI providers — Ollama is default (free, local)
  MODEL_PROVIDER: z.enum(['ollama', 'openrouter', 'anthropic', 'groq']).default('ollama'),
  DEFAULT_MODEL: z.string().default('gemma3:4b'),
  COMPLEX_MODEL: z.string().default(''),
  EMBED_MODEL: z.string().default('nomic-embed-text'),
  OLLAMA_HOST: z.string().default('http://localhost:11434'),
  OPENROUTER_API_KEY: z.string().default(''),
  GROQ_API_KEY: z.string().default(''),

  // Database — local PGlite is default (zero setup)
  DATABASE_TYPE: z.enum(['local', 'supabase']).default('local'),
  PGLITE_PATH: z.string().default('./workspace/nova.db'),

  // Optional paid APIs (legacy — kept for backward compat)
  ANTHROPIC_API_KEY: z.string().default(''),
  OPENAI_API_KEY: z.string().default(''),

  // Optional tool API keys
  GOOGLE_CREDENTIALS_PATH: z.string().default(''),
  NOTION_API_KEY: z.string().default(''),
  WEB_SEARCH_API_KEY: z.string().default(''),
  OPENWEATHER_API_KEY: z.string().default(''),

  // Phase 3 — Telegram channel
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_CHAT_ID: z.string().default(''),

  // Phase 4.5 — Discord channel
  DISCORD_BOT_TOKEN: z.string().default(''),
  DISCORD_USER_ID: z.string().default(''),

  // Phase 4.4 — server-side voice
  WHISPER_API_KEY: z.string().default(''),     // OpenAI API key for Whisper STT
  ELEVENLABS_API_KEY: z.string().default(''),  // ElevenLabs API key for TTS
  ELEVENLABS_VOICE_ID: z.string().default('21m00Tcm4TlvDq8ikWAM'),  // Default = Rachel

  // Phase 3 — server options
  NOVA_WORKFLOWS: z.enum(['on', 'off']).default('on'),

  // User profile (Customize → Profile) — legacy keys kept for backward compat
  PROFILE_NAME: z.string().default(''),
  PROFILE_BACKGROUND: z.string().default(''),
  PROFILE_STYLE: z.string().default('balanced'),

  // New profile keys (claude.ai-aligned)
  PROFILE_FULL_NAME: z.string().default(''),
  PROFILE_NICKNAME: z.string().default('Jimmy'),
  PROFILE_WORK: z.string().default(''),
  PROFILE_PREFERENCES: z.string().default(''),
  NOTIFY_COMPLETIONS: z.string().default('off'),
  APPEARANCE_COLOR: z.string().default('dark'),
  APPEARANCE_BG_ANIM: z.string().default('auto'),

  // Capabilities toggles
  MEMORY_SEARCH: z.string().default('on'),
  MEMORY_GENERATE: z.string().default('on'),
  ARTIFACTS: z.string().default('on'),
  TOOL_LOAD_MODE: z.string().default('on-demand'),
});

export type Config = z.infer<typeof ConfigSchema>;

let _config: Config | undefined;

export function getConfig(): Config {
  if (_config !== undefined) return _config;

  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    console.error('NOVA cannot start — missing or invalid environment variables:\n' + missing);
    console.error('\nCopy .env.example to .env and fill in all values.');
    process.exit(1);
  }

  _config = result.data;
  return _config;
}

export function resetConfig(): void {
  _config = undefined;
}
