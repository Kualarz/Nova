import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaProvider } from '../../src/providers/ollama.js';

const MOCK_HOST = 'http://localhost:11434';

describe('OllamaProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends chat request to correct endpoint', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { role: 'assistant', content: 'Hello!', tool_calls: undefined },
        done_reason: 'stop',
        model: 'gemma3:4b',
      }),
    } as Response);

    const provider = new OllamaProvider({ host: MOCK_HOST, defaultModel: 'gemma3:4b' });
    const response = await provider.chat([{ role: 'user', content: 'Hi', tool_calls: undefined }]);

    expect(fetchSpy).toHaveBeenCalledWith(
      `${MOCK_HOST}/api/chat`,
      expect.objectContaining({ method: 'POST' })
    );
    expect(response.content).toBe('Hello!');
    expect(response.stop_reason).toBe('stop');
  });

  it('maps tool_calls response correctly', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            { function: { name: 'web_search', arguments: '{"query":"test"}' } },
          ],
        },
        done_reason: 'tool_calls',
        model: 'gemma3:4b',
      }),
    } as Response);

    const provider = new OllamaProvider({ host: MOCK_HOST, defaultModel: 'gemma3:4b' });
    const response = await provider.chat([{ role: 'user', content: 'search for test', tool_calls: undefined }]);

    expect(response.stop_reason).toBe('tool_calls');
    expect(response.tool_calls).toHaveLength(1);
    expect(response.tool_calls![0]!.function.name).toBe('web_search');
  });

  it('sends embed request to correct endpoint', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: new Array(1536).fill(0.1) }),
    } as Response);

    const provider = new OllamaProvider({ host: MOCK_HOST, defaultModel: 'gemma3:4b' });
    const embedding = await provider.embed('hello world');

    expect(embedding).toHaveLength(1536);
    expect(embedding[0]).toBe(0.1);
  });

  it('throws on non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response);

    const provider = new OllamaProvider({ host: MOCK_HOST, defaultModel: 'gemma3:4b' });
    await expect(provider.chat([{ role: 'user', content: 'hi', tool_calls: undefined }])).rejects.toThrow('500');
  });
});
