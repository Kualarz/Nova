import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must mock config before importing router
vi.mock('../../src/lib/config.js', () => ({
  getConfig: vi.fn(),
  resetConfig: vi.fn(),
}));

import { getConfig } from '../../src/lib/config.js';
import { getModelRouter, resetModelRouter } from '../../src/providers/router.js';

describe('ModelRouter', () => {
  beforeEach(() => {
    resetModelRouter();
    vi.restoreAllMocks();
  });

  it('returns OllamaProvider when MODEL_PROVIDER=ollama', () => {
    vi.mocked(getConfig).mockReturnValue({
      MODEL_PROVIDER: 'ollama',
      DEFAULT_MODEL: 'gemma3:4b',
      EMBED_MODEL: 'nomic-embed-text',
      OLLAMA_HOST: 'http://localhost:11434',
      OPENROUTER_API_KEY: '',
    } as ReturnType<typeof getConfig>);

    const router = getModelRouter();
    expect(router.name).toBe('ollama');
  });

  it('returns OpenRouterProvider when MODEL_PROVIDER=openrouter', () => {
    vi.mocked(getConfig).mockReturnValue({
      MODEL_PROVIDER: 'openrouter',
      DEFAULT_MODEL: 'openai/gpt-4o',
      EMBED_MODEL: 'nomic-embed-text',
      OLLAMA_HOST: 'http://localhost:11434',
      OPENROUTER_API_KEY: 'sk-test-key',
    } as ReturnType<typeof getConfig>);

    const router = getModelRouter();
    expect(router.name).toBe('openrouter');
  });

  it('throws when openrouter selected but no key set', () => {
    vi.mocked(getConfig).mockReturnValue({
      MODEL_PROVIDER: 'openrouter',
      DEFAULT_MODEL: 'openai/gpt-4o',
      EMBED_MODEL: 'nomic-embed-text',
      OLLAMA_HOST: 'http://localhost:11434',
      OPENROUTER_API_KEY: '',
    } as ReturnType<typeof getConfig>);

    expect(() => getModelRouter()).toThrow('OPENROUTER_API_KEY is required');
  });

  it('getEmbedProvider always returns OllamaProvider', () => {
    vi.mocked(getConfig).mockReturnValue({
      MODEL_PROVIDER: 'openrouter',
      DEFAULT_MODEL: 'openai/gpt-4o',
      EMBED_MODEL: 'nomic-embed-text',
      OLLAMA_HOST: 'http://localhost:11434',
      OPENROUTER_API_KEY: 'sk-test',
    } as ReturnType<typeof getConfig>);

    const router = getModelRouter();
    expect(router.embedProvider.name).toBe('ollama');
  });
});
