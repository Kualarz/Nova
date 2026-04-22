import { getConfig } from '../lib/config.js';
import type { DatabaseProvider } from './interface.js';

let _provider: DatabaseProvider | undefined;

export async function getDb(): Promise<DatabaseProvider> {
  if (_provider) return _provider;

  const config = getConfig();

  if (config.DATABASE_TYPE === 'supabase') {
    const { SupabaseProvider } = await import('./providers/supabase.js');
    _provider = new SupabaseProvider();
  } else {
    const { LocalProvider } = await import('./providers/local.js');
    _provider = new LocalProvider(config.PGLITE_PATH);
    await _provider.runMigrations();
  }

  return _provider;
}

export function resetDb(): void {
  _provider = undefined;
}
