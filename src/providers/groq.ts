import type { LLMProvider, Message, ChatOptions, ChatResponse, ToolCall } from './interface.js';

export interface GroqConfig {
  apiKey: string;
  defaultModel: string;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAIChatResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string;
  }>;
  model: string;
}

interface OpenAIModelsResponse {
  data: Array<{ id: string; owned_by?: string }>;
}

const BASE = 'https://api.groq.com/openai/v1';

export class GroqProvider implements LLMProvider {
  readonly name = 'groq';
  private config: GroqConfig;

  constructor(config: GroqConfig) {
    if (!config.apiKey) throw new Error('GROQ_API_KEY is required to use GroqProvider');
    this.config = config;
  }

  async chat(messages: Message[], options: ChatOptions = {}): Promise<ChatResponse> {
    const model = options.model ?? this.config.defaultModel;

    const body: Record<string, unknown> = { model, messages, stream: false };
    if (options.tools?.length) body['tools'] = options.tools;

    const resp = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Groq error ${resp.status}: ${text || resp.statusText}`);
    }

    const data = (await resp.json()) as OpenAIChatResponse;
    const choice = data.choices[0];
    if (!choice) throw new Error('Groq returned no choices');

    const rawToolCalls = choice.message.tool_calls;
    const toolCalls: ToolCall[] | undefined = rawToolCalls?.length
      ? rawToolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        }))
      : undefined;

    return {
      content: choice.message.content,
      tool_calls: toolCalls,
      stop_reason: toolCalls?.length ? 'tool_calls' : 'stop',
      model: data.model,
    };
  }

  async *chatStream(messages: Message[], options: ChatOptions = {}): AsyncGenerator<string> {
    const model = options.model ?? this.config.defaultModel;
    const resp = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, messages, stream: true }),
    });

    if (!resp.ok || !resp.body) throw new Error(`Groq stream error ${resp.status}`);

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value, { stream: true }).split('\n')) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
        try {
          const parsed = JSON.parse(line.slice(6)) as { choices?: Array<{ delta?: { content?: string } }> };
          const token = parsed.choices?.[0]?.delta?.content;
          if (token) yield token;
        } catch {
          // skip malformed SSE lines
        }
      }
    }
  }

  async embed(_text: string): Promise<number[]> {
    throw new Error('GroqProvider does not support embeddings — use OllamaProvider for embeddings');
  }

  async listModels(): Promise<string[]> {
    const resp = await fetch(`${BASE}/models`, {
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
    });
    if (!resp.ok) throw new Error(`Groq listModels error ${resp.status}`);
    const data = (await resp.json()) as OpenAIModelsResponse;
    return data.data.map(m => m.id);
  }
}
