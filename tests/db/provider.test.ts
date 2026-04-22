import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/config.js', () => ({ getConfig: vi.fn(), resetConfig: vi.fn() }));

import { getConfig } from '../../src/lib/config.js';
import { getDb, resetDb } from '../../src/db/client.js';

describe('DatabaseProvider factory', () => {
  beforeEach(() => {
    resetDb();
    vi.restoreAllMocks();
  });

  it('returns LocalProvider when DATABASE_TYPE=local', async () => {
    vi.mocked(getConfig).mockReturnValue({
      DATABASE_TYPE: 'local',
      PGLITE_PATH: undefined,
    } as unknown as ReturnType<typeof getConfig>);

    const db = await getDb();
    expect(db.constructor.name).toBe('LocalProvider');
  });

  it('same instance is returned on subsequent calls', async () => {
    vi.mocked(getConfig).mockReturnValue({
      DATABASE_TYPE: 'local',
      PGLITE_PATH: undefined,
    } as unknown as ReturnType<typeof getConfig>);

    const db1 = await getDb();
    const db2 = await getDb();
    expect(db1).toBe(db2);
  });
});
