import type { MemoryCategory, Memory } from '../memory/store.js';

export interface InsertMemoryConnectionParams {
  memoryAId: string;
  memoryBId: string;
  similarity: number;
  type: string;
}

export interface FindSimilarForEdgesResult {
  id: string;
  similarity: number;
}

export interface FindSimilarForEdgesParams {
  embedding: number[];
  userId: string;
  limit: number;
  threshold: number;
  excludeId: string;
}

export interface FindNeighborMemoriesParams {
  memoryIds: string[];
  userId: string;
}

export interface Hook {
  id: string;
  event: string;
  skill_name: string;
  enabled: number;
}

export interface InsertHookParams {
  event: string;
  skillName: string;
}

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

  // Graph edges
  insertMemoryConnection(params: InsertMemoryConnectionParams): Promise<void>;
  findSimilarForEdges(params: FindSimilarForEdgesParams): Promise<FindSimilarForEdgesResult[]>;
  findNeighborMemories(params: FindNeighborMemoriesParams): Promise<Memory[]>;

  // Hooks
  getEnabledHooks(event: string): Promise<Hook[]>;
  insertHook(params: InsertHookParams): Promise<string>;

  // Setup
  runMigrations(): Promise<void>;
  close(): Promise<void>;
}
