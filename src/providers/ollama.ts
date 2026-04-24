import type { LLMProvider, Message, Tool, ChatOptions, ChatResponse, ToolCall } from './interface.js';

export interface OllamaConfig {
  host: string;
  defaultModel: string;
  embedModel?: string;
}

interface OllamaToolCall {
  function: { name: string; arguments: string | Record<string, unknown> };
}

interface OllamaChatResponse {
  message: {
    role: string;
    content: string | null;
    tool_calls?: OllamaToolCall[];
  };
  done_reason: string;
  model: string;
}

interface OllamaEmbedResponse {
  embedding: number[];
}

interface OllamaTagsResponse {
  models: Array<{ name: string }>;
}

function normalizeToolCalls(raw: OllamaToolCall[] | undefined): ToolCall[] | undefined {
  if (!raw?.length) return undefined;
  return raw.map((tc, i) => ({
    id: `call_${i}`,
    type: 'function' as const,
    function: {
      name: tc.function.name,
      arguments: typeof tc.function.arguments === 'string'
        ? tc.function.arguments
        : JSON.stringify(tc.function.arguments),
    },
  }));
}

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  private config: OllamaConfig;

  constructor(config: OllamaConfig) {
    this.config = config;
  }

  private throwIfConnectionRefused(err: unknown, endpoint: string): never {
    const msg = (err instanceof Error) ? err.message : String(err);
    if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
      throw new Error(
        `Ollama is not reachable at ${this.config.host}${endpoint}.\n` +
        `Make sure Ollama is running: open the Ollama app or run 'ollama serve' in a terminal.\n` +
        `Then verify the model is available: ollama pull ${this.config.defaultModel}`
      );
    }
    throw err;
  }

  async chat(messages: Message[], options: ChatOptions = {}): Promise<ChatResponse> {
    const model = options.model ?? this.config.defaultModel;

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: false,
    };

    if (options.tools?.length) {
      body['tools'] = options.tools;
    }

    const resp = await fetch(`${this.config.host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch((err: unknown): never => this.throwIfConnectionRefused(err, '/api/chat'));

    if (!resp.ok) {
      throw new Error(`Ollama chat error ${resp.status}: ${resp.statusText}`);
    }

    const data = (await resp.json()) as OllamaChatResponse;
    const toolCalls = normalizeToolCalls(data.message.tool_calls);

    return {
      content: data.message.content,
      tool_calls: toolCalls,
      stop_reason: toolCalls?.length ? 'tool_calls' : 'stop',
      model: data.model,
    };
  }

  async *chatStream(messages: Message[], options: ChatOptions = {}): AsyncGenerator<string> {
    const model = options.model ?? this.config.defaultModel;

    const resp = await fetch(`${this.config.host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true }),
    }).catch((err: unknown): never => this.throwIfConnectionRefused(err, '/api/chat'));

    if (!resp.ok || !resp.body) {
      throw new Error(`Ollama stream error ${resp.status}: ${resp.statusText}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { message?: { content?: string } };
          if (parsed.message?.content) yield parsed.message.content;
        } catch {
          // skip malformed lines
        }
      }
    }
  }

  async embed(text: string): Promise<number[]> {
    const model = this.config.embedModel ?? 'nomic-embed-text';

    const resp = await fetch(`${this.config.host}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
    }).catch((err: unknown): never => this.throwIfConnectionRefused(err, '/api/embeddings'));

    if (!resp.ok) {
      throw new Error(`Ollama embed error ${resp.status}: ${resp.statusText}`);
    }

    const data = (await resp.json()) as OllamaEmbedResponse;
    return data.embedding;
  }

  async listModels(): Promise<string[]> {
    const resp = await fetch(`${this.config.host}/api/tags`);
    if (!resp.ok) throw new Error(`Ollama listModels error ${resp.status}`);
    const data = (await resp.json()) as OllamaTagsResponse;
    return data.models.map(m => m.name);
  }
}
