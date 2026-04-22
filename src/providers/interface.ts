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
