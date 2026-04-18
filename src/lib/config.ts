import * as dotenv from 'dotenv';
import { z } from 'zod';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const ConfigSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  GOOGLE_CREDENTIALS_PATH: z.string().default(''), // Optional — Calendar/Gmail tools require Step 7 OAuth setup
  NOTION_API_KEY: z.string().default(''),         // Optional — Notion tools won't work without it
  WEB_SEARCH_API_KEY: z.string().default(''),     // Optional — web search won't work without it
  OPENWEATHER_API_KEY: z.string().default(''),    // Optional — weather tool won't work without it
  NOVA_USER_ID: z.union([z.literal(''), z.string().uuid()]).default(''),
  NOVA_WORKSPACE_PATH: z.string().min(1, 'NOVA_WORKSPACE_PATH is required'),
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
