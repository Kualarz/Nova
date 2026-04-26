import type { LLMProvider, Message, Tool, ChatOptions, ChatResponse, ToolCall } from './interface.js';

export interface AnthropicConfig {
  apiKey: string;
  defaultModel: string;
}

interface AnthropicContentBlock {
  type: 'text' | 'tool_use';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicChatResponse {
  content: AnthropicContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  model: string;
}

interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Array<Record<string, unknown>>;
}

const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS_DEFAULT = 4096;

/**
 * Convert NOVA's OpenAI-style messages array to Anthropic's format:
 *   - Leading `system` messages are extracted into the top-level `system` field.
 *   - `tool` role becomes `user` with a `tool_result` content block.
 *   - assistant messages with `tool_calls` get converted to a content array
 *     containing `tool_use` blocks (and optional leading text).
 */
function convertMessages(messages: Message[]): { system: string; messages: AnthropicMessage[] } {
  const systemParts: string[] = [];
  const out: AnthropicMessage[] = [];

  for (const m of messages) {
    if (m.role === 'system') {
      if (m.content) systemParts.push(m.content);
      continue;
    }

    if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.tool_call_id ?? '',
            content: m.content ?? '',
          },
        ],
      });
      continue;
    }

    if (m.role === 'assistant' && m.tool_calls?.length) {
      const blocks: Array<Record<string, unknown>> = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.tool_calls) {
        let parsedInput: Record<string, unknown> = {};
        try { parsedInput = JSON.parse(tc.function.arguments) as Record<string, unknown>; } catch { /* keep empty */ }
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: parsedInput,
        });
      }
      out.push({ role: 'assistant', content: blocks });
      continue;
    }

    // Plain user / assistant text message
    if (m.role === 'user' || m.role === 'assistant') {
      out.push({ role: m.role, content: m.content ?? '' });
    }
  }

  return { system: systemParts.join('\n\n'), messages: out };
}

function convertTools(tools: Tool[]): AnthropicToolDef[] {
  return tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

function mapStopReason(r: AnthropicChatResponse['stop_reason']): 'stop' | 'tool_calls' {
  return r === 'tool_use' ? 'tool_calls' : 'stop';
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private config: AnthropicConfig;

  constructor(config: AnthropicConfig) {
    if (!config.apiKey) throw new Error('ANTHROPIC_API_KEY is required to use AnthropicProvider');
    this.config = config;
  }

  async chat(messages: Message[], options: ChatOptions = {}): Promise<ChatResponse> {
    const model = options.model ?? this.config.defaultModel;
    const { system, messages: anthMessages } = convertMessages(messages);

    const body: Record<string, unknown> = {
      model,
      max_tokens: MAX_TOKENS_DEFAULT,
      messages: anthMessages,
    };
    if (system) body['system'] = system;
    if (options.tools?.length) body['tools'] = convertTools(options.tools);

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.config.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Anthropic error ${resp.status}: ${text || resp.statusText}`);
    }

    const data = (await resp.json()) as AnthropicChatResponse;

    // Combine text blocks into ChatResponse.content
    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];
    for (const block of data.content) {
      if (block.type === 'text' && block.text) {
        textParts.push(block.text);
      } else if (block.type === 'tool_use' && block.id && block.name) {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
        });
      }
    }

    return {
      content: textParts.length ? textParts.join('') : null,
      tool_calls: toolCalls.length ? toolCalls : undefined,
      stop_reason: mapStopReason(data.stop_reason),
      model: data.model,
    };
  }

  async *chatStream(messages: Message[], options: ChatOptions = {}): AsyncGenerator<string> {
    const model = options.model ?? this.config.defaultModel;
    const { system, messages: anthMessages } = convertMessages(messages);

    const body: Record<string, unknown> = {
      model,
      max_tokens: MAX_TOKENS_DEFAULT,
      messages: anthMessages,
      stream: true,
    };
    if (system) body['system'] = system;
    if (options.tools?.length) body['tools'] = convertTools(options.tools);

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.config.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Anthropic stream error ${resp.status}: ${text || resp.statusText}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by blank lines; split on \n and process `data:` lines
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (!payload) continue;
        try {
          const parsed = JSON.parse(payload) as {
            type?: string;
            delta?: { type?: string; text?: string };
          };
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta' && parsed.delta.text) {
            yield parsed.delta.text;
          }
        } catch {
          // skip malformed SSE chunks
        }
      }
    }
  }

  async embed(_text: string): Promise<number[]> {
    throw new Error('AnthropicProvider does not support embeddings — use OllamaProvider for embeddings');
  }

  async listModels(): Promise<string[]> {
    return [
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
    ];
  }
}
