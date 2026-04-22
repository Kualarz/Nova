import { describe, it, expect, beforeEach } from 'vitest';
import { LocalProvider } from '../../src/db/providers/local.js';

describe('LocalProvider', () => {
  let provider: LocalProvider;

  beforeEach(async () => {
    provider = new LocalProvider();   // in-memory (no dataDir = ephemeral)
    await provider.runMigrations();
  });

  it('inserts and retrieves a memory via vector search', async () => {
    const embedding = new Array(768).fill(0).map((_, i) => i / 768);

    const id = await provider.insertMemory({
      userId: 'test-user',
      content: 'I prefer dark mode',
      category: 'preference',
      embedding,
      confidence: 0.9,
    });

    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');

    const results = await provider.matchMemories({
      userId: 'test-user',
      embedding,
      limit: 5,
      threshold: 0.5,
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.content).toBe('I prefer dark mode');
    expect(results[0]!.similarity).toBeGreaterThan(0.9);
  });

  it('supersedes a memory', async () => {
    const embedding = new Array(768).fill(0.1);

    const oldId = await provider.insertMemory({
      userId: 'test-user',
      content: 'old fact',
      category: 'fact',
      embedding,
      confidence: 1,
    });

    const newId = await provider.insertMemory({
      userId: 'test-user',
      content: 'updated fact',
      category: 'fact',
      embedding,
      confidence: 1,
    });

    await provider.supersedeMemory(oldId, newId);

    // Superseded memory should not appear in search
    const results = await provider.matchMemories({
      userId: 'test-user',
      embedding,
      limit: 10,
      threshold: 0.0,
    });

    const ids = results.map(r => r.id);
    expect(ids).not.toContain(oldId);
    expect(ids).toContain(newId);
  });

  it('stores and retrieves conversation messages', async () => {
    const convId = await provider.startConversation('test-user');
    expect(convId).toBeTruthy();

    await provider.appendConversationMessage(convId, {
      role: 'user',
      content: 'Hello NOVA',
    });

    const msgs = await provider.getConversationMessages(convId);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.content).toBe('Hello NOVA');
    expect(msgs[0]!.role).toBe('user');
  });

  it('logs events without throwing', async () => {
    await expect(
      provider.logEvent('test-user', 'session_start', { test: true })
    ).resolves.not.toThrow();
  });
});
