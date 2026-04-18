import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from '../lib/config.js';

let _client: SupabaseClient | undefined;

export function getDb(): SupabaseClient {
  if (_client) return _client;
  const config = getConfig();
  _client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
  return _client;
}
