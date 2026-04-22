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

const mockLoadAll = vi.fn();
vi.mock('../../src/skills/loader.js', () => ({
  getSkillLoader: () => ({ loadAll: mockLoadAll, buildSkillsPrompt: vi.fn().mockResolvedValue('') }),
  resetSkillLoader: vi.fn(),
}));

// Spy on runPrompt — direct mock to avoid circular-import interception issues (nova↔hooks)
vi.mock('../../src/agent/nova.js', () => ({
  runPrompt: vi.fn().mockResolvedValue('ok'),
  runSession: vi.fn(),
}));

import { getModelRouter } from '../../src/providers/router.js';
import { getDb, resetDb } from '../../src/db/client.js';
import { runPrompt } from '../../src/agent/nova.js';
import { fireHook } from '../../src/automation/hooks.js';

beforeEach(async () => {
  resetDb();
  vi.clearAllMocks();
  vi.mocked(getModelRouter).mockReturnValue({
    chat: vi.fn().mockResolvedValue({ stop_reason: 'stop', content: 'ok', tool_calls: [] }),
    embed: vi.fn().mockResolvedValue(new Array(768).fill(0)),
  } as ReturnType<typeof getModelRouter>);
  vi.mocked(runPrompt).mockResolvedValue('ok');
  mockLoadAll.mockResolvedValue([
    { name: 'greet', body: 'Say hello to the user.', tools: [], enabled: true, reversible: true, description: '', filePath: '' },
  ]);
});

describe('fireHook', () => {
  it('no-ops when no hooks are registered for the event', async () => {
    await fireHook('session.start');
    expect(vi.mocked(runPrompt)).not.toHaveBeenCalled();
  });

  it('calls runPrompt with skill body when a matching hook exists', async () => {
    const db = await getDb();
    await db.insertHook({ event: 'session.start', skillName: 'greet' });

    await fireHook('session.start');

    expect(vi.mocked(runPrompt)).toHaveBeenCalledWith('Say hello to the user.');
  });

  it('appends JSON context when context is provided', async () => {
    const db = await getDb();
    await db.insertHook({ event: 'session.start', skillName: 'greet' });

    await fireHook('session.start', { userId: 'u1' });

    const call = vi.mocked(runPrompt).mock.calls[0]![0];
    expect(call).toContain('Say hello to the user.');
    expect(call).toContain('"userId":"u1"');
  });

  it('skips hooks whose skill_name is not found in loader', async () => {
    const db = await getDb();
    await db.insertHook({ event: 'session.start', skillName: 'nonexistent' });

    await fireHook('session.start');
    expect(vi.mocked(runPrompt)).not.toHaveBeenCalled();
  });

  it('only fires enabled hooks', async () => {
    const db = await getDb();
    const id = await db.insertHook({ event: 'session.start', skillName: 'greet' });
    // Disable the hook directly
    await (db as unknown as { db: { query: (sql: string, params: unknown[]) => Promise<unknown> } })
      .db.query(`UPDATE hooks SET enabled = 0 WHERE id = $1`, [id]);

    await fireHook('session.start');
    expect(vi.mocked(runPrompt)).not.toHaveBeenCalled();
  });
});
