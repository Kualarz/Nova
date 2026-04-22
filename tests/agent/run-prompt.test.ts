import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db/client.js', async () => {
  const { LocalProvider } = await vi.importActual<typeof import('../../src/db/providers/local.js')>(
    '../../src/db/providers/local.js'
  );
  let _p: InstanceType<typeof LocalProvider> | null = null;
  return {
    getDb: async () => {
      if (!_p) {
        _p = new LocalProvider();
        await _p.runMigrations();
      }
      return _p;
    },
    resetDb: () => { _p = null; },
  };
});

vi.mock('../../src/providers/router.js', () => ({ getModelRouter: vi.fn() }));
vi.mock('../../src/lib/config.js', () => ({
  getConfig: () => ({
    NOVA_USER_ID: 'test-user',
    DEFAULT_MODEL: 'test',
    COMPLEX_MODEL: 'test',
    EMBED_MODEL: 'test',
    MODEL_PROVIDER: 'ollama',
  }),
}));
vi.mock('../../src/memory/tier3-semantic.js', () => ({ findSimilar: vi.fn().mockResolvedValue([]) }));
vi.mock('../../src/skills/loader.js', () => ({
  getSkillLoader: () => ({ loadAll: vi.fn().mockResolvedValue([]), buildSkillsPrompt: vi.fn().mockResolvedValue('') }),
  resetSkillLoader: vi.fn(),
}));
vi.mock('../../src/agent/system-prompt.js', () => ({
  buildBaseSystemPrompt: vi.fn().mockResolvedValue('mock system prompt'),
  buildTier3Injection: vi.fn().mockResolvedValue(''),
}));
vi.mock('../../src/automation/hooks.js', () => ({ fireHook: vi.fn().mockResolvedValue(undefined) }));

import { getModelRouter } from '../../src/providers/router.js';
import { getDb, resetDb } from '../../src/db/client.js';
import { runPrompt } from '../../src/agent/nova.js';

beforeEach(() => {
  resetDb();
  vi.mocked(getModelRouter).mockReturnValue({
    chat: vi.fn().mockResolvedValue({ stop_reason: 'stop', content: 'hello back', tool_calls: [] }),
    embed: vi.fn().mockResolvedValue(new Array(768).fill(0)),
  } as ReturnType<typeof getModelRouter>);
});

describe('runPrompt', () => {
  it('returns the model response text', async () => {
    const result = await runPrompt('hello');
    expect(result).toBe('hello back');
  });

  it('persists the conversation to the DB', async () => {
    await runPrompt('test message');
    const db = await getDb();
    // Verify a conversation was started and ended (memory_extracted = 1)
    const result = await (db as unknown as { db: { query: (sql: string) => Promise<{ rows: unknown[] }> } })
      .db.query(`SELECT id FROM conversations WHERE memory_extracted = 1`);
    expect(result.rows.length).toBeGreaterThan(0);
  });
});
