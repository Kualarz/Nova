# NOVA Phase 2 — Plan 1: Foundation (ModelRouter + DatabaseProvider)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Anthropic + OpenAI paid APIs with free local Ollama, add optional OpenRouter for any paid model, and abstract the database so NOVA works with local PGlite (zero setup) or cloud Supabase.

**Architecture:** A `ModelRouter` in `src/providers/` picks between `OllamaProvider` (free, local) and `OpenRouterProvider` (any paid cloud model) based on config. A `DatabaseProvider` interface in `src/db/` is implemented by `LocalProvider` (PGlite — PostgreSQL-in-WASM, zero setup) and `SupabaseProvider` (existing cloud setup). All callers of the Anthropic client, OpenAI client, and raw `getDb()` are updated to use these abstractions. After this plan, NOVA runs entirely free with `MODEL_PROVIDER=ollama DATABASE_TYPE=local`.

**Tech Stack:** `@electric-sql/pglite` + `@electric-sql/pglite/vector` (local DB), `vitest` (tests), native `fetch` (Ollama + OpenRouter HTTP calls), `tsx` (existing runner).

**Spec reference:** `docs/superpowers/specs/2026-04-22-nova-phase2-design.md` — Sections 3 and 4.

---

## Prerequisites (do before Task 1)

Install Ollama from https://ollama.com and pull the required models:

```bash
# Install Ollama (follow installer for your OS), then:
ollama pull qwen2.5:7b
ollama pull nomic-embed-text
# Verify Ollama is running:
curl http://localhost:11434/api/tags
```

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/providers/interface.ts` | Create | LLMProvider interface + Message/Tool/ChatResponse types |
| `src/providers/ollama.ts` | Create | OllamaProvider — chat, embed, listModels |
| `src/providers/openrouter.ts` | Create | OpenRouterProvider — chat via openrouter.ai |
| `src/providers/router.ts` | Create | ModelRouter — picks provider from config, caches instances |
| `src/db/interface.ts` | Create | DatabaseProvider interface — typed domain operations |
| `src/db/providers/local.ts` | Create | LocalProvider — PGlite (PostgreSQL WASM, zero setup) |
| `src/db/providers/supabase.ts` | Create | SupabaseProvider — wraps existing Supabase client |
| `src/db/client.ts` | Modify | Return `DatabaseProvider` from config instead of raw `SupabaseClient` |
| `src/lib/config.ts` | Modify | Add MODEL_PROVIDER, DEFAULT_MODEL, OLLAMA_HOST, DATABASE_TYPE, etc. |
| `src/agent/tools/index.ts` | Modify | `toApiTools()` returns OpenAI format (`function.parameters`) not Anthropic format |
| `src/agent/nova.ts` | Modify | Replace Anthropic client + types with ModelRouter + provider-agnostic Message types |
| `src/memory/store.ts` | Modify | `embed()` uses `getModelRouter().embed()`, DB calls use `DatabaseProvider` |
| `src/conversations/store.ts` | Modify | All `getDb()` calls replaced with `DatabaseProvider` methods |
| `src/events/log.ts` | Modify | `getDb()` call replaced with `DatabaseProvider.logEvent()` |
| `src/db/migrations/002_phase2.sql` | Create | New tables: memory_connections, routines, dispatch_queue, hooks, action_log |
| `tests/providers/ollama.test.ts` | Create | Unit tests for OllamaProvider |
| `tests/providers/openrouter.test.ts` | Create | Unit tests for OpenRouterProvider |
| `tests/providers/router.test.ts` | Create | Unit tests for ModelRouter |
| `tests/db/local.test.ts` | Create | Unit tests for LocalProvider (in-memory PGlite) |
| `tests/db/provider.test.ts` | Create | Provider switching integration test |
| `vitest.config.ts` | Create | Vitest configuration |

---

## Task 1: Test Infrastructure

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Install vitest**

```bash
npm install --save-dev vitest
```

- [ ] **Step 2: Create vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Update package.json scripts**

Open `package.json`. Replace the `"test"` script and add watch/coverage:

```json
"scripts": {
  "nova": "tsx src/index.ts",
  "build": "tsc",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

- [ ] **Step 4: Create tests directory and write a smoke test**

Create `tests/smoke.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('test infrastructure', () => {
  it('works', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run tests and verify they pass**

```bash
npm test
```

Expected output:
```
✓ tests/smoke.test.ts (1)
  ✓ test infrastructure > works

Test Files  1 passed (1)
Tests       1 passed (1)
```

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts package.json tests/smoke.test.ts
git commit -m "feat: add vitest test infrastructure"
```

---

## Task 2: LLMProvider Interface

**Files:**
- Create: `src/providers/interface.ts`

- [ ] **Step 1: Create `src/providers/` directory**

```bash
mkdir -p src/providers
```

- [ ] **Step 2: Write the interface**

Create `src/providers/interface.ts`:

```typescript
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatOptions {
  model?: string;
  tools?: Tool[];
  temperature?: number;
}

export interface ChatResponse {
  content: string | null;
  tool_calls?: ToolCall[];
  stop_reason: 'stop' | 'tool_calls';
  model: string;
}

export interface LLMProvider {
  readonly name: string;
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;
  chatStream(messages: Message[], options?: ChatOptions): AsyncGenerator<string>;
  embed(text: string): Promise<number[]>;
  listModels(): Promise<string[]>;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/providers/interface.ts
git commit -m "feat: add LLMProvider interface and message types"
```

---

## Task 3: OllamaProvider

**Files:**
- Create: `src/providers/ollama.ts`
- Create: `tests/providers/ollama.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/providers/ollama.test.ts`:

```typescript
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
        model: 'qwen2.5:7b',
      }),
    } as Response);

    const provider = new OllamaProvider({ host: MOCK_HOST, defaultModel: 'qwen2.5:7b' });
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
        model: 'qwen2.5:7b',
      }),
    } as Response);

    const provider = new OllamaProvider({ host: MOCK_HOST, defaultModel: 'qwen2.5:7b' });
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

    const provider = new OllamaProvider({ host: MOCK_HOST, defaultModel: 'qwen2.5:7b' });
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

    const provider = new OllamaProvider({ host: MOCK_HOST, defaultModel: 'qwen2.5:7b' });
    await expect(provider.chat([{ role: 'user', content: 'hi', tool_calls: undefined }])).rejects.toThrow('500');
  });
});
```

- [ ] **Step 2: Run tests — expect them to fail**

```bash
npm test -- tests/providers/ollama.test.ts
```

Expected: FAIL with `Cannot find module '../../src/providers/ollama.js'`

- [ ] **Step 3: Implement OllamaProvider**

Create `src/providers/ollama.ts`:

```typescript
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
    });

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
    });

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
    });

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
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
npm test -- tests/providers/ollama.test.ts
```

Expected:
```
✓ tests/providers/ollama.test.ts (4)
Test Files  1 passed (1)
Tests       4 passed (4)
```

- [ ] **Step 5: Commit**

```bash
git add src/providers/ollama.ts tests/providers/ollama.test.ts
git commit -m "feat: add OllamaProvider with chat, embed, and stream"
```

---

## Task 4: OpenRouterProvider

**Files:**
- Create: `src/providers/openrouter.ts`
- Create: `tests/providers/openrouter.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/providers/openrouter.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- tests/providers/openrouter.test.ts
```

Expected: FAIL with `Cannot find module '../../src/providers/openrouter.js'`

- [ ] **Step 3: Implement OpenRouterProvider**

Create `src/providers/openrouter.ts`:

```typescript
import type { LLMProvider, Message, Tool, ChatOptions, ChatResponse, ToolCall } from './interface.js';

export interface OpenRouterConfig {
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
  data: Array<{ id: string }>;
}

export class OpenRouterProvider implements LLMProvider {
  readonly name = 'openrouter';
  private config: OpenRouterConfig;

  constructor(config: OpenRouterConfig) {
    if (!config.apiKey) throw new Error('OPENROUTER_API_KEY is required to use OpenRouterProvider');
    this.config = config;
  }

  async chat(messages: Message[], options: ChatOptions = {}): Promise<ChatResponse> {
    const model = options.model ?? this.config.defaultModel;

    const body: Record<string, unknown> = { model, messages, stream: false };
    if (options.tools?.length) {
      body['tools'] = options.tools;
    }

    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/kualarz/nova',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`OpenRouter error ${resp.status}: ${text || resp.statusText}`);
    }

    const data = (await resp.json()) as OpenAIChatResponse;
    const choice = data.choices[0];
    if (!choice) throw new Error('OpenRouter returned no choices');

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
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/kualarz/nova',
      },
      body: JSON.stringify({ model, messages, stream: true }),
    });

    if (!resp.ok || !resp.body) throw new Error(`OpenRouter stream error ${resp.status}`);

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
    throw new Error('OpenRouterProvider does not support embeddings — use OllamaProvider for embeddings');
  }

  async listModels(): Promise<string[]> {
    const resp = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
    });
    if (!resp.ok) throw new Error(`OpenRouter listModels error ${resp.status}`);
    const data = (await resp.json()) as OpenAIModelsResponse;
    return data.data.map(m => m.id);
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- tests/providers/openrouter.test.ts
```

Expected: 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/providers/openrouter.ts tests/providers/openrouter.test.ts
git commit -m "feat: add OpenRouterProvider for paid cloud models"
```

---

## Task 5: ModelRouter

**Files:**
- Create: `src/providers/router.ts`
- Create: `tests/providers/router.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/providers/router.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must mock config before importing router
vi.mock('../../src/lib/config.js', () => ({
  getConfig: vi.fn(),
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
      DEFAULT_MODEL: 'qwen2.5:7b',
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
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- tests/providers/router.test.ts
```

Expected: FAIL with `Cannot find module '../../src/providers/router.js'`

- [ ] **Step 3: Implement ModelRouter**

Create `src/providers/router.ts`:

```typescript
import { getConfig } from '../lib/config.js';
import { OllamaProvider } from './ollama.js';
import { OpenRouterProvider } from './openrouter.js';
import type { LLMProvider, Message, Tool, ChatOptions, ChatResponse } from './interface.js';

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

    if (this.config.MODEL_PROVIDER === 'openrouter') {
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
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- tests/providers/router.test.ts
```

Expected: 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/providers/router.ts tests/providers/router.test.ts
git commit -m "feat: add ModelRouter — picks Ollama or OpenRouter from config"
```

---

## Task 6: Update config.ts

**Files:**
- Modify: `src/lib/config.ts`

- [ ] **Step 1: Read current config**

Open `src/lib/config.ts`. It currently requires `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`. We make both optional and add new provider env vars.

- [ ] **Step 2: Update the schema**

Replace the entire contents of `src/lib/config.ts` with:

```typescript
import * as dotenv from 'dotenv';
import { z } from 'zod';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const ConfigSchema = z.object({
  // Required — core infrastructure
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL').default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(''),
  NOVA_USER_ID: z.union([z.literal(''), z.string().uuid()]).default(''),
  NOVA_WORKSPACE_PATH: z.string().min(1, 'NOVA_WORKSPACE_PATH is required'),

  // AI providers — Ollama is default (free, local)
  MODEL_PROVIDER: z.enum(['ollama', 'openrouter']).default('ollama'),
  DEFAULT_MODEL: z.string().default('qwen2.5:7b'),
  COMPLEX_MODEL: z.string().default(''),
  EMBED_MODEL: z.string().default('nomic-embed-text'),
  OLLAMA_HOST: z.string().default('http://localhost:11434'),
  OPENROUTER_API_KEY: z.string().default(''),

  // Database — local PGlite is default (zero setup)
  DATABASE_TYPE: z.enum(['local', 'supabase']).default('local'),
  PGLITE_PATH: z.string().default('./workspace/nova.db'),

  // Optional paid APIs (legacy — kept for backward compat)
  ANTHROPIC_API_KEY: z.string().default(''),
  OPENAI_API_KEY: z.string().default(''),

  // Optional tool API keys
  GOOGLE_CREDENTIALS_PATH: z.string().default(''),
  NOTION_API_KEY: z.string().default(''),
  WEB_SEARCH_API_KEY: z.string().default(''),
  OPENWEATHER_API_KEY: z.string().default(''),
});

export type Config = z.infer<typeof ConfigSchema>;

let _config: Config | undefined;

export function getConfig(): Config {
  if (_config !== undefined) return _config;

  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    console.error('NOVA cannot start — missing or invalid environment variables:\n' + missing);
    console.error('\nCopy .env.example to .env and fill in all values.');
    process.exit(1);
  }

  _config = result.data;
  return _config;
}

export function resetConfig(): void {
  _config = undefined;
}
```

- [ ] **Step 3: Update `.env.example` with new vars**

Open `.env.example` and replace with:

```
# === AI Providers ===
# Default: Ollama (free, local). Install from https://ollama.com
# then run: ollama pull qwen2.5:7b && ollama pull nomic-embed-text
MODEL_PROVIDER=ollama
DEFAULT_MODEL=qwen2.5:7b
COMPLEX_MODEL=
EMBED_MODEL=nomic-embed-text
OLLAMA_HOST=http://localhost:11434

# Optional: set MODEL_PROVIDER=openrouter and add key to use paid models
# Get a key at https://openrouter.ai (pay-per-token, no subscription)
OPENROUTER_API_KEY=

# === Database ===
# local: PGlite (zero setup, works offline, stores in PGLITE_PATH)
# supabase: cloud PostgreSQL (requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
DATABASE_TYPE=local
PGLITE_PATH=./workspace/nova.db

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# === Identity ===
NOVA_USER_ID=
NOVA_WORKSPACE_PATH=

# === Optional Tool Keys ===
GOOGLE_CREDENTIALS_PATH=
NOTION_API_KEY=
WEB_SEARCH_API_KEY=
OPENWEATHER_API_KEY=
```

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/config.ts .env.example
git commit -m "feat: update config — Ollama default, optional Anthropic/OpenAI, database type"
```

---

## Task 7: Update toApiTools() to OpenAI Format

**Files:**
- Modify: `src/agent/tools/index.ts`

The current `toApiTools()` returns Anthropic format (`input_schema`). Ollama expects OpenAI format (`function.parameters`). We update `toApiTools()` and add the `Tool` type from the provider interface.

- [ ] **Step 1: Update `src/agent/tools/index.ts`**

Replace the `toApiTools` function:

```typescript
import type { Tool } from '../../providers/interface.js';

/** Convert to the OpenAI/Ollama tool format used by ModelRouter. */
export function toApiTools(): Tool[] {
  return ALL_TOOLS.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));
}
```

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: all tests pass (no tests currently use `toApiTools` directly, but type-checking will catch issues).

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/index.ts
git commit -m "feat: update toApiTools() to OpenAI/Ollama format"
```

---

## Task 8: Update nova.ts to Use ModelRouter

**Files:**
- Modify: `src/agent/nova.ts`

This is the most impactful change: replaces the Anthropic client and its typed messages with ModelRouter and the provider-agnostic `Message` type. The tool-use loop changes from Anthropic format (`block.type === 'tool_use'`) to OpenAI format (`response.tool_calls`).

- [ ] **Step 1: Replace nova.ts**

Replace the entire `src/agent/nova.ts` with:

```typescript
import * as readline from 'readline';
import chalk from 'chalk';
import { getConfig } from '../lib/config.js';
import { getModelRouter } from '../providers/router.js';
import type { Message } from '../providers/interface.js';
import { buildBaseSystemPrompt, buildTier3Injection } from './system-prompt.js';
import { startConversation, appendMessage, endConversation } from '../conversations/store.js';
import { logEvent } from '../events/log.js';
import { appendToDailyNote } from '../memory/tier2-daily.js';
import { extractMemories } from '../memory/extract.js';
import { reconcileMemories } from '../memory/reconcile.js';
import { toApiTools, executeTool } from './tools/index.js';
import { handleSlashCommand, isSlashCommand } from './slash-commands.js';

function buildTranscript(history: Message[]): string {
  return history
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => {
      if (m.tool_calls?.length) {
        const names = m.tool_calls.map(tc => tc.function.name).join(', ');
        return `NOVA: [called ${names}]`;
      }
      const text = m.content ?? '';
      return m.role === 'user' ? `Jimmy: ${text}` : `NOVA: ${text}`;
    })
    .join('\n');
}

async function runTurn(
  systemPrompt: string,
  history: Message[]
): Promise<{ text: string; newMessages: Message[] }> {
  const tools = toApiTools();
  const added: Message[] = [];
  const router = getModelRouter();

  let messages: Message[] = [
    { role: 'system', content: systemPrompt },
    ...history,
  ];

  for (let i = 0; i < 10; i++) {
    const response = await router.chat(messages, { tools });

    if (response.stop_reason === 'stop') {
      const text = response.content ?? '';
      const msg: Message = { role: 'assistant', content: text };
      added.push(msg);
      return { text, newMessages: added };
    }

    if (response.stop_reason === 'tool_calls' && response.tool_calls?.length) {
      const assistantMsg: Message = {
        role: 'assistant',
        content: response.content,
        tool_calls: response.tool_calls,
      };
      added.push(assistantMsg);
      messages = [...messages, assistantMsg];

      for (const toolCall of response.tool_calls) {
        let toolOutput: string;
        try {
          const toolInput = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
          console.log(chalk.dim(`  [tool] ${toolCall.function.name}(${toolCall.function.arguments})`));
          toolOutput = await executeTool(toolCall.function.name, toolInput);
        } catch (err) {
          toolOutput = `Error: ${(err as Error).message}`;
        }

        const resultMsg: Message = {
          role: 'tool',
          content: toolOutput,
          tool_call_id: toolCall.id,
        };
        added.push(resultMsg);
        messages = [...messages, resultMsg];
      }
      continue;
    }

    const text = response.content ?? '';
    added.push({ role: 'assistant', content: text });
    return { text, newMessages: added };
  }

  return { text: '[Max tool iterations reached]', newMessages: added };
}

export async function runSession(): Promise<void> {
  const config = getConfig();
  const conversationId = await startConversation();
  await logEvent('session_start', { conversation_id: conversationId });

  let systemPrompt = buildBaseSystemPrompt();
  const history: Message[] = [];
  let tier3Injected = false;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(chalk.dim('\nNOVA online. Type your message, or Ctrl+C to exit.\n'));

  const prompt = (): Promise<string> =>
    new Promise(resolve => rl.question(chalk.dim('nova > '), resolve));

  const handleShutdown = async (reason: string) => {
    rl.close();
    console.log(chalk.dim('\nexiting...'));
    try {
      const transcript = buildTranscript(history);
      if (transcript.trim()) {
        const candidates = await extractMemories(transcript);
        if (candidates.length > 0) {
          await reconcileMemories(candidates, conversationId);
          await logEvent('memory_extracted', {
            conversation_id: conversationId,
            count: candidates.length,
          });
        }
      }
      await endConversation(conversationId);
      await logEvent('session_end', { conversation_id: conversationId, reason });
    } catch (err) {
      console.error(chalk.red(`[nova] session end error: ${(err as Error).message}`));
    }
    process.exit(0);
  };

  process.on('SIGINT', () => { void handleShutdown('sigint'); });

  for (;;) {
    let userInput: string;
    try {
      userInput = await prompt();
    } catch {
      await handleShutdown('eof');
      return;
    }

    if (!userInput.trim()) continue;

    if (isSlashCommand(userInput)) {
      await handleSlashCommand(userInput);
      continue;
    }

    history.push({ role: 'user', content: userInput });
    await appendMessage(conversationId, { role: 'user', content: userInput });
    await logEvent('message', { conversation_id: conversationId, role: 'user' });

    if (!tier3Injected) {
      tier3Injected = true;
      try {
        const tier3 = await buildTier3Injection(userInput);
        if (tier3) systemPrompt = systemPrompt + '\n\n---\n\n' + tier3;
      } catch {
        // best-effort
      }
    }

    try {
      const { text, newMessages } = await runTurn(systemPrompt, history);
      for (const msg of newMessages) history.push(msg);

      console.log('\n' + chalk.white(text) + '\n');

      await appendMessage(conversationId, { role: 'assistant', content: text });
      await logEvent('message', { conversation_id: conversationId, role: 'assistant' });

      if (userInput.length > 50) {
        await appendToDailyNote(userInput.slice(0, 200));
      }
    } catch (err) {
      console.error(chalk.red(`\n[nova] error: ${(err as Error).message}\n`));
    }
  }
}
```

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: all tests pass. TypeScript errors indicate integration issues to fix.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Fix any type errors before committing.

- [ ] **Step 4: Commit**

```bash
git add src/agent/nova.ts
git commit -m "feat: migrate nova.ts from Anthropic SDK to ModelRouter"
```

---

## Task 9: Update embed() in memory/store.ts

**Files:**
- Modify: `src/memory/store.ts`

Replace the OpenAI `embed()` call with `getModelRouter().embed()`. The rest of `store.ts` (Supabase calls) stays unchanged for now — that changes in Tasks 10–14.

- [ ] **Step 1: Update the embed function**

Open `src/memory/store.ts`. Replace the top of the file (lines 1–10) and the `embed()` function:

```typescript
import { getDb } from '../db/client.js';
import { getModelRouter } from '../providers/router.js';

export type MemoryCategory = 'fact' | 'preference' | 'observation' | 'personality';

export interface Memory {
  id: string;
  content: string;
  category: MemoryCategory;
  confidence: number;
  access_count: number;
  created_at: string;
  similarity?: number;
}

export async function embed(text: string): Promise<number[]> {
  return getModelRouter().embed(text);
}
```

Remove the `import OpenAI from 'openai'` line and the `getOpenAI()` function entirely.

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/memory/store.ts
git commit -m "feat: replace OpenAI embeddings with Ollama via ModelRouter"
```

---

## Task 10: DatabaseProvider Interface

**Files:**
- Create: `src/db/interface.ts`
- Install: `@electric-sql/pglite`

- [ ] **Step 1: Install PGlite**

```bash
npm install @electric-sql/pglite
```

- [ ] **Step 2: Create the DatabaseProvider interface**

Create `src/db/interface.ts`:

```typescript
import type { MemoryCategory, Memory } from '../memory/store.js';

export interface InsertMemoryParams {
  userId: string;
  content: string;
  category: MemoryCategory;
  embedding: number[];
  confidence: number;
  sourceConversationId?: string;
}

export interface MatchMemoriesParams {
  userId: string;
  embedding: number[];
  limit: number;
  threshold: number;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
}

export interface DatabaseProvider {
  // Memories
  insertMemory(params: InsertMemoryParams): Promise<string>;
  matchMemories(params: MatchMemoriesParams): Promise<Memory[]>;
  supersedeMemory(oldId: string, newId: string): Promise<void>;
  incrementMemoryAccess(memoryIds: string[], accessedAt: string): Promise<void>;

  // Conversations
  startConversation(userId: string): Promise<string>;
  appendConversationMessage(conversationId: string, msg: ConversationMessage): Promise<void>;
  endConversation(id: string, summary?: string): Promise<void>;
  getConversationMessages(conversationId: string): Promise<ConversationMessage[]>;

  // Events
  logEvent(userId: string, type: string, payload: unknown): Promise<void>;

  // Setup
  runMigrations(): Promise<void>;
  close(): Promise<void>;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/db/interface.ts package.json package-lock.json
git commit -m "feat: add DatabaseProvider interface and install PGlite"
```

---

## Task 11: LocalProvider (PGlite)

**Files:**
- Create: `src/db/providers/local.ts`
- Create: `tests/db/local.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/db/local.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { LocalProvider } from '../../src/db/providers/local.js';

describe('LocalProvider', () => {
  let provider: LocalProvider;

  beforeEach(async () => {
    provider = new LocalProvider();   // in-memory (no dataDir = ephemeral)
    await provider.runMigrations();
  });

  it('inserts and retrieves a memory via vector search', async () => {
    const embedding = new Array(1536).fill(0).map((_, i) => i / 1536);

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
    const embedding = new Array(1536).fill(0.1);

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
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- tests/db/local.test.ts
```

Expected: FAIL with `Cannot find module '../../src/db/providers/local.js'`

- [ ] **Step 3: Create migrations SQL**

Create `src/db/migrations/002_phase2.sql`:

```sql
-- Phase 2 tables

CREATE TABLE IF NOT EXISTS memory_connections (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  memory_a_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  memory_b_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  similarity  REAL NOT NULL,
  type        TEXT NOT NULL DEFAULT 'semantic',
  created_at  TEXT NOT NULL DEFAULT now()::text
);

CREATE TABLE IF NOT EXISTS routines (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT NOT NULL,
  cron        TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_run    TEXT,
  created_at  TEXT NOT NULL DEFAULT now()::text
);

CREATE TABLE IF NOT EXISTS dispatch_queue (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  prompt       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  result       TEXT,
  created_at   TEXT NOT NULL DEFAULT now()::text,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS hooks (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event      TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS action_log (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  session_id  TEXT,
  tool_name   TEXT,
  input       TEXT,
  output      TEXT,
  reversible  INTEGER NOT NULL DEFAULT 1,
  approved    INTEGER,
  created_at  TEXT NOT NULL DEFAULT now()::text
);
```

- [ ] **Step 4: Create migrations directory and base SQL**

Create `src/db/migrations/001_phase1.sql` by reading `db/schema.sql`:

```bash
mkdir -p src/db/migrations
cp db/schema.sql src/db/migrations/001_phase1.sql
```

- [ ] **Step 5: Implement LocalProvider**

Create `src/db/providers/local.ts`:

```typescript
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { DatabaseProvider, InsertMemoryParams, MatchMemoriesParams, ConversationMessage } from '../interface.js';
import type { Memory } from '../../memory/store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function embeddingToSql(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export class LocalProvider implements DatabaseProvider {
  private db: PGlite | null = null;
  private dataDir?: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir;
  }

  private async getDb(): Promise<PGlite> {
    if (!this.db) {
      this.db = await PGlite.create({
        dataDir: this.dataDir,
        extensions: { vector },
      });
    }
    return this.db;
  }

  async runMigrations(): Promise<void> {
    const db = await this.getDb();
    await db.exec('CREATE EXTENSION IF NOT EXISTS vector;');

    const migrationsDir = join(__dirname, '../migrations');

    for (const file of ['001_phase1.sql', '002_phase2.sql']) {
      try {
        const sql = readFileSync(join(migrationsDir, file), 'utf8');
        await db.exec(sql);
      } catch {
        // Migration file may not exist yet — skip
      }
    }
  }

  async insertMemory(params: InsertMemoryParams): Promise<string> {
    const db = await this.getDb();
    const { userId, content, category, embedding, confidence, sourceConversationId } = params;

    const result = await db.query<{ id: string }>(
      `INSERT INTO memories (user_id, content, category, embedding, confidence, source_conversation_id)
       VALUES ($1, $2, $3, $4::vector, $5, $6)
       RETURNING id`,
      [userId, content, category, embeddingToSql(embedding), confidence, sourceConversationId ?? null]
    );

    return result.rows[0]!.id;
  }

  async matchMemories(params: MatchMemoriesParams): Promise<Memory[]> {
    const db = await this.getDb();
    const { userId, embedding, limit, threshold } = params;
    const embStr = embeddingToSql(embedding);

    const result = await db.query<Memory & { similarity: number }>(
      `SELECT id, content, category, confidence, access_count, created_at,
         1 - (embedding <=> $1::vector) AS similarity
       FROM memories
       WHERE user_id = $2
         AND superseded_by IS NULL
         AND 1 - (embedding <=> $1::vector) > $3
       ORDER BY embedding <=> $1::vector
       LIMIT $4`,
      [embStr, userId, threshold, limit]
    );

    return result.rows;
  }

  async supersedeMemory(oldId: string, newId: string): Promise<void> {
    const db = await this.getDb();
    await db.query(
      `UPDATE memories SET superseded_by = $1, updated_at = now()::text WHERE id = $2`,
      [newId, oldId]
    );
  }

  async incrementMemoryAccess(memoryIds: string[], accessedAt: string): Promise<void> {
    if (memoryIds.length === 0) return;
    const db = await this.getDb();
    const placeholders = memoryIds.map((_, i) => `$${i + 2}`).join(', ');
    await db.query(
      `UPDATE memories SET access_count = access_count + 1, accessed_at = $1
       WHERE id IN (${placeholders})`,
      [accessedAt, ...memoryIds]
    );
  }

  async startConversation(userId: string): Promise<string> {
    const db = await this.getDb();
    const result = await db.query<{ id: string }>(
      `INSERT INTO conversations (user_id) VALUES ($1) RETURNING id`,
      [userId]
    );
    return result.rows[0]!.id;
  }

  async appendConversationMessage(conversationId: string, msg: ConversationMessage): Promise<void> {
    const db = await this.getDb();
    await db.query(
      `INSERT INTO messages (conversation_id, role, content, tool_name, tool_input, tool_output)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        conversationId,
        msg.role,
        msg.content,
        msg.toolName ?? null,
        msg.toolInput ? JSON.stringify(msg.toolInput) : null,
        msg.toolOutput ? JSON.stringify(msg.toolOutput) : null,
      ]
    );
  }

  async endConversation(id: string, summary?: string): Promise<void> {
    const db = await this.getDb();
    await db.query(
      `UPDATE conversations SET ended_at = now()::text, summary = $2, memory_extracted = true WHERE id = $1`,
      [id, summary ?? null]
    );
  }

  async getConversationMessages(conversationId: string): Promise<ConversationMessage[]> {
    const db = await this.getDb();
    const result = await db.query<{
      role: string; content: string;
      tool_name: string | null; tool_input: string | null; tool_output: string | null;
    }>(
      `SELECT role, content, tool_name, tool_input, tool_output FROM messages
       WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [conversationId]
    );

    return result.rows.map(r => ({
      role: r.role as ConversationMessage['role'],
      content: r.content,
      toolName: r.tool_name ?? undefined,
      toolInput: r.tool_input ? JSON.parse(r.tool_input) : undefined,
      toolOutput: r.tool_output ? JSON.parse(r.tool_output) : undefined,
    }));
  }

  async logEvent(userId: string, type: string, payload: unknown): Promise<void> {
    const db = await this.getDb();
    await db.query(
      `INSERT INTO events (user_id, event_type, payload) VALUES ($1, $2, $3)`,
      [userId, type, JSON.stringify(payload)]
    );
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }
}
```

- [ ] **Step 6: Run tests — expect PASS**

```bash
npm test -- tests/db/local.test.ts
```

Expected: 4 tests passing.

- [ ] **Step 7: Commit**

```bash
git add src/db/providers/local.ts src/db/interface.ts src/db/migrations/ tests/db/local.test.ts
git commit -m "feat: add LocalProvider using PGlite (zero-setup local database)"
```

---

## Task 12: SupabaseProvider

**Files:**
- Create: `src/db/providers/supabase.ts`

- [ ] **Step 1: Implement SupabaseProvider**

Create `src/db/providers/supabase.ts`:

```typescript
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from '../../lib/config.js';
import type { DatabaseProvider, InsertMemoryParams, MatchMemoriesParams, ConversationMessage } from '../interface.js';
import type { Memory } from '../../memory/store.js';

export class SupabaseProvider implements DatabaseProvider {
  private client: SupabaseClient;

  constructor() {
    const config = getConfig();
    if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        'DATABASE_TYPE=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env'
      );
    }
    this.client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
  }

  async insertMemory(params: InsertMemoryParams): Promise<string> {
    const { data, error } = await this.client
      .from('memories')
      .insert({
        user_id: params.userId,
        content: params.content,
        category: params.category,
        embedding: JSON.stringify(params.embedding),
        confidence: params.confidence,
        source_conversation_id: params.sourceConversationId ?? null,
      })
      .select('id')
      .single();
    if (error) throw new Error(`insertMemory failed: ${error.message}`);
    return data.id as string;
  }

  async matchMemories(params: MatchMemoriesParams): Promise<Memory[]> {
    const { data, error } = await this.client.rpc('match_memories', {
      query_embedding: JSON.stringify(params.embedding),
      match_user_id: params.userId,
      match_threshold: params.threshold,
      match_count: params.limit,
    });
    if (error) throw new Error(`matchMemories failed: ${error.message}`);
    return (data ?? []) as Memory[];
  }

  async supersedeMemory(oldId: string, newId: string): Promise<void> {
    const { error } = await this.client
      .from('memories')
      .update({ superseded_by: newId, updated_at: new Date().toISOString() })
      .eq('id', oldId);
    if (error) throw new Error(`supersedeMemory failed: ${error.message}`);
  }

  async incrementMemoryAccess(memoryIds: string[], accessedAt: string): Promise<void> {
    if (memoryIds.length === 0) return;
    await this.client.rpc('increment_memory_access', {
      memory_ids: memoryIds,
      accessed_at: accessedAt,
    });
  }

  async startConversation(userId: string): Promise<string> {
    const { data, error } = await this.client
      .from('conversations')
      .insert({ user_id: userId })
      .select('id')
      .single();
    if (error) throw new Error(`startConversation failed: ${error.message}`);
    return data.id as string;
  }

  async appendConversationMessage(conversationId: string, msg: ConversationMessage): Promise<void> {
    const { error } = await this.client.from('messages').insert({
      conversation_id: conversationId,
      role: msg.role,
      content: msg.content,
      tool_name: msg.toolName ?? null,
      tool_input: msg.toolInput ?? null,
      tool_output: msg.toolOutput ?? null,
    });
    if (error) throw new Error(`appendMessage failed: ${error.message}`);
  }

  async endConversation(id: string, summary?: string): Promise<void> {
    const { error } = await this.client
      .from('conversations')
      .update({ ended_at: new Date().toISOString(), summary: summary ?? null, memory_extracted: true })
      .eq('id', id);
    if (error) throw new Error(`endConversation failed: ${error.message}`);
  }

  async getConversationMessages(conversationId: string): Promise<ConversationMessage[]> {
    const { data, error } = await this.client
      .from('messages')
      .select('role, content, tool_name, tool_input, tool_output')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`getConversationMessages failed: ${error.message}`);
    return (data ?? []).map(r => ({
      role: r.role as ConversationMessage['role'],
      content: r.content as string,
      toolName: r.tool_name as string | undefined,
      toolInput: r.tool_input,
      toolOutput: r.tool_output,
    }));
  }

  async logEvent(userId: string, type: string, payload: unknown): Promise<void> {
    if (!userId) return;
    const { error } = await this.client.from('events').insert({
      user_id: userId,
      event_type: type,
      payload,
    });
    if (error) console.error(`[nova] logEvent failed (${type}): ${error.message}`);
  }

  async runMigrations(): Promise<void> {
    // Supabase migrations are run manually via Supabase dashboard or CLI
    // Run db/schema.sql + src/db/migrations/002_phase2.sql in Supabase SQL editor
    console.log('[nova] Supabase migrations must be run manually in the Supabase SQL editor.');
  }

  async close(): Promise<void> {
    // Supabase client has no explicit close — no-op
  }
}
```

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: all tests pass. (SupabaseProvider has no unit tests — it wraps Supabase which requires a live connection.)

- [ ] **Step 3: Commit**

```bash
git add src/db/providers/supabase.ts
git commit -m "feat: add SupabaseProvider wrapping existing Supabase client"
```

---

## Task 13: Update db/client.ts and all callers

**Files:**
- Modify: `src/db/client.ts`
- Modify: `src/memory/store.ts`
- Modify: `src/conversations/store.ts`
- Modify: `src/events/log.ts`

- [ ] **Step 1: Replace db/client.ts**

Replace the entire `src/db/client.ts` with:

```typescript
import { getConfig } from '../lib/config.js';
import type { DatabaseProvider } from './interface.js';

let _provider: DatabaseProvider | undefined;

export async function getDb(): Promise<DatabaseProvider> {
  if (_provider) return _provider;

  const config = getConfig();

  if (config.DATABASE_TYPE === 'supabase') {
    const { SupabaseProvider } = await import('./providers/supabase.js');
    _provider = new SupabaseProvider();
  } else {
    const { LocalProvider } = await import('./providers/local.js');
    _provider = new LocalProvider(config.PGLITE_PATH);
    await _provider.runMigrations();
  }

  return _provider;
}

export function resetDb(): void {
  _provider = undefined;
}
```

> **Note:** `getDb()` is now async. All callers must `await getDb()`.

- [ ] **Step 2: Update `src/memory/store.ts` to use DatabaseProvider**

Replace the full `src/memory/store.ts`:

```typescript
import { getDb } from '../db/client.js';
import { getModelRouter } from '../providers/router.js';
import { getConfig } from '../lib/config.js';

export type MemoryCategory = 'fact' | 'preference' | 'observation' | 'personality';

export interface Memory {
  id: string;
  content: string;
  category: MemoryCategory;
  confidence: number;
  access_count: number;
  created_at: string;
  similarity?: number;
}

export async function embed(text: string): Promise<number[]> {
  return getModelRouter().embed(text);
}

export async function insertMemory(params: {
  userId: string;
  content: string;
  category: MemoryCategory;
  confidence?: number;
  sourceConversationId?: string;
}): Promise<string> {
  const db = await getDb();
  const embedding = await embed(params.content);
  return db.insertMemory({
    userId: params.userId,
    content: params.content,
    category: params.category,
    embedding,
    confidence: params.confidence ?? 1.0,
    sourceConversationId: params.sourceConversationId,
  });
}

export async function supersedeMemory(oldId: string, newId: string): Promise<void> {
  const db = await getDb();
  return db.supersedeMemory(oldId, newId);
}

export async function findSimilar(params: {
  userId: string;
  query: string;
  limit?: number;
  threshold?: number;
}): Promise<Memory[]> {
  const db = await getDb();
  const embedding = await embed(params.query);
  return db.matchMemories({
    userId: params.userId,
    embedding,
    limit: params.limit ?? 10,
    threshold: params.threshold ?? 0.7,
  });
}

export async function updateAccessStats(memoryIds: string[]): Promise<void> {
  if (memoryIds.length === 0) return;
  const db = await getDb();
  return db.incrementMemoryAccess(memoryIds, new Date().toISOString());
}
```

- [ ] **Step 3: Update `src/conversations/store.ts`**

Replace entire `src/conversations/store.ts`:

```typescript
import { getDb } from '../db/client.js';
import { getConfig } from '../lib/config.js';

export interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
}

export async function startConversation(): Promise<string> {
  const db = await getDb();
  return db.startConversation(getConfig().NOVA_USER_ID);
}

export async function appendMessage(conversationId: string, msg: Message): Promise<void> {
  const db = await getDb();
  return db.appendConversationMessage(conversationId, msg);
}

export async function endConversation(conversationId: string, summary?: string): Promise<void> {
  const db = await getDb();
  return db.endConversation(conversationId, summary);
}

export async function getConversationMessages(conversationId: string): Promise<Message[]> {
  const db = await getDb();
  return db.getConversationMessages(conversationId);
}
```

- [ ] **Step 4: Update `src/events/log.ts`**

Replace entire `src/events/log.ts`:

```typescript
import { getDb } from '../db/client.js';
import { getConfig } from '../lib/config.js';

export type EventType =
  | 'session_start'
  | 'session_end'
  | 'message'
  | 'tool_call'
  | 'memory_extracted'
  | 'error';

export async function logEvent(type: EventType, payload: Record<string, unknown> = {}): Promise<void> {
  const config = getConfig();
  if (!config.NOVA_USER_ID) return;

  try {
    const db = await getDb();
    await db.logEvent(config.NOVA_USER_ID, type, payload);
  } catch (err) {
    console.error(`[nova] logEvent failed (${type}): ${(err as Error).message}`);
  }
}
```

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Fix any remaining type errors.

- [ ] **Step 7: Commit**

```bash
git add src/db/client.ts src/memory/store.ts src/conversations/store.ts src/events/log.ts
git commit -m "feat: update all DB callers to use DatabaseProvider abstraction"
```

---

## Task 14: Provider Switching Test + Smoke Test

**Files:**
- Create: `tests/db/provider.test.ts`

- [ ] **Step 1: Write provider switching test**

Create `tests/db/provider.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/config.js', () => ({ getConfig: vi.fn(), resetConfig: vi.fn() }));

import { getConfig } from '../../src/lib/config.js';
import { getDb, resetDb } from '../../src/db/client.js';

describe('DatabaseProvider factory', () => {
  beforeEach(() => {
    resetDb();
    vi.restoreAllMocks();
  });

  it('returns LocalProvider when DATABASE_TYPE=local', async () => {
    vi.mocked(getConfig).mockReturnValue({
      DATABASE_TYPE: 'local',
      PGLITE_PATH: undefined,
    } as ReturnType<typeof getConfig>);

    const db = await getDb();
    expect(db.constructor.name).toBe('LocalProvider');
  });

  it('same instance is returned on subsequent calls', async () => {
    vi.mocked(getConfig).mockReturnValue({
      DATABASE_TYPE: 'local',
      PGLITE_PATH: undefined,
    } as ReturnType<typeof getConfig>);

    const db1 = await getDb();
    const db2 = await getDb();
    expect(db1).toBe(db2);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm test -- tests/db/provider.test.ts
```

Expected: 2 tests passing.

- [ ] **Step 3: Full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Smoke test — verify NOVA boots on Ollama**

Ensure Ollama is running and models are pulled, then:

```bash
# Set env vars for the smoke test
DATABASE_TYPE=local MODEL_PROVIDER=ollama NOVA_WORKSPACE_PATH=./workspace npm run nova
```

Expected: NOVA prints `NOVA online. Type your message, or Ctrl+C to exit.`
Type `hello` — NOVA responds using Ollama. No errors about Anthropic or OpenAI API keys.

- [ ] **Step 5: Final commit**

```bash
git add tests/db/provider.test.ts
git commit -m "feat: Plan 1 complete — NOVA runs free on Ollama with DatabaseProvider abstraction"
```

---

## Spec Coverage Self-Review

| Spec requirement | Covered by |
|---|---|
| Replace Anthropic API with Ollama | Tasks 3, 5, 8 |
| Replace OpenAI embeddings with nomic-embed-text | Tasks 3, 9 |
| OpenRouter for any paid model | Task 4 |
| ModelRouter (provider abstraction) | Task 5 |
| New env vars (MODEL_PROVIDER, DEFAULT_MODEL, etc.) | Task 6 |
| DATABASE_TYPE=local (PGlite, zero setup) | Task 11 |
| DATABASE_TYPE=supabase (existing cloud) | Task 12 |
| DatabaseProvider interface (domain operations) | Task 10 |
| Phase 2 DB tables (memory_connections, routines, etc.) | Task 11 step 3 |
| nova.ts uses OpenAI message format | Task 8 |
| toApiTools() returns OpenAI format | Task 7 |
| All callers updated to async getDb() | Task 13 |

All Phase 2 spec Section 3 and Section 4 requirements are covered. Sections 5–17 are covered in Plans 2–6.
