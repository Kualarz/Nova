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
