import { getConfig } from '../lib/config.js';
import { OllamaProvider } from './ollama.js';
import { OpenRouterProvider } from './openrouter.js';
import { AnthropicProvider } from './anthropic.js';
import { GroqProvider } from './groq.js';
import type { LLMProvider, Message, ChatOptions, ChatResponse } from './interface.js';

export class ModelRouter {
  readonly name: string;
  readonly embedProvider: OllamaProvider;
  private chatProvider: LLMProvider;
  private config: ReturnType<typeof getConfig>;

  constructor() {
    this.config = getConfig();

    const ollamaProvider = new OllamaProvider({
      host: this.config.OLLAMA_HOST,
      defaultModel: this.config.DEFAULT_MODEL,
      embedModel: this.config.EMBED_MODEL,
    });

    this.embedProvider = ollamaProvider;

    if (this.config.MODEL_PROVIDER === 'groq') {
      this.chatProvider = new GroqProvider({
        apiKey: this.config.GROQ_API_KEY,
        defaultModel: this.config.DEFAULT_MODEL,
      });
      this.name = 'groq';
    } else if (this.config.MODEL_PROVIDER === 'anthropic') {
      this.chatProvider = new AnthropicProvider({
        apiKey: this.config.ANTHROPIC_API_KEY,
        defaultModel: this.config.DEFAULT_MODEL,
      });
      this.name = 'anthropic';
    } else if (this.config.MODEL_PROVIDER === 'openrouter') {
      this.chatProvider = new OpenRouterProvider({
        apiKey: this.config.OPENROUTER_API_KEY,
        defaultModel: this.config.DEFAULT_MODEL,
      });
      this.name = 'openrouter';
    } else {
      this.chatProvider = ollamaProvider;
      this.name = 'ollama';
    }
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    return this.chatProvider.chat(messages, options);
  }

  async *chatStream(messages: Message[], options?: ChatOptions): AsyncGenerator<string> {
    yield* this.chatProvider.chatStream(messages, options);
  }

  async embed(text: string): Promise<number[]> {
    return this.embedProvider.embed(text);
  }

  async listModels(): Promise<string[]> {
    return this.chatProvider.listModels();
  }
}

let _router: ModelRouter | undefined;

export function getModelRouter(): ModelRouter {
  if (!_router) _router = new ModelRouter();
  return _router;
}

export function resetModelRouter(): void {
  _router = undefined;
}
