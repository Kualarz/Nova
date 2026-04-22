import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenRouterProvider } from '../../src/providers/openrouter.js';

describe('OpenRouterProvider', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sends request to openrouter endpoint with auth header', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'Hi', tool_calls: null }, finish_reason: 'stop' }],
        model: 'anthropic/claude-haiku-4-5',
      }),
    } as Response);

    const provider = new OpenRouterProvider({ apiKey: 'test-key', defaultModel: 'anthropic/claude-haiku-4-5' });
    const response = await provider.chat([{ role: 'user', content: 'Hello', tool_calls: undefined }]);

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      })
    );
    expect(response.content).toBe('Hi');
    expect(response.stop_reason).toBe('stop');
  });

  it('maps tool_calls from OpenAI format', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_abc',
              type: 'function',
              function: { name: 'web_search', arguments: '{"query":"AI news"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        model: 'openai/gpt-4o',
      }),
    } as Response);

    const provider = new OpenRouterProvider({ apiKey: 'test-key', defaultModel: 'openai/gpt-4o' });
    const response = await provider.chat([{ role: 'user', content: 'search AI news', tool_calls: undefined }]);

    expect(response.stop_reason).toBe('tool_calls');
    expect(response.tool_calls![0]!.id).toBe('call_abc');
    expect(response.tool_calls![0]!.function.name).toBe('web_search');
  });

  it('throws when apiKey is empty', () => {
    expect(() => new OpenRouterProvider({ apiKey: '', defaultModel: 'openai/gpt-4o' }))
      .toThrow('OPENROUTER_API_KEY is required');
  });

  it('embed throws — use OllamaProvider for embeddings', async () => {
    const provider = new OpenRouterProvider({ apiKey: 'test-key', defaultModel: 'openai/gpt-4o' });
    await expect(provider.embed('hello')).rejects.toThrow('use OllamaProvider');
  });
});
