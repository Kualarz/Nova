import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getConfig } from '../../lib/config.js';
import type { DatabaseProvider, InsertMemoryParams, MatchMemoriesParams, ConversationMessage, ConversationSummary, InsertMemoryConnectionParams, FindSimilarForEdgesParams, FindSimilarForEdgesResult, FindNeighborMemoriesParams, Hook, InsertHookParams, SessionStats, Task, InsertTaskParams, UpdateTaskParams } from '../interface.js';
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

  async listMemories(userId: string, limit: number): Promise<Memory[]> {
    const { data, error } = await this.client
      .from('memories')
      .select('id, content, category, confidence, access_count, created_at')
      .eq('user_id', userId)
      .is('superseded_by', null)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`listMemories failed: ${error.message}`);
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

  async deleteConversation(id: string): Promise<void> {
    const msgErr = await this.client.from('messages').delete().eq('conversation_id', id);
    if (msgErr.error) throw new Error(`deleteConversation (messages) failed: ${msgErr.error.message}`);
    const convErr = await this.client.from('conversations').delete().eq('id', id);
    if (convErr.error) throw new Error(`deleteConversation failed: ${convErr.error.message}`);
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

  async listConversations(userId: string, limit: number): Promise<ConversationSummary[]> {
    const { data, error } = await this.client
      .from('conversations')
      .select('id, started_at, ended_at')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`listConversations failed: ${error.message}`);
    // first_message requires a join — return null for Supabase (no RPC available here)
    return (data ?? []).map(r => ({
      id: r.id as string,
      started_at: r.started_at as string,
      ended_at: r.ended_at as string | null,
      first_message: null,
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

  async insertMemoryConnection(_params: InsertMemoryConnectionParams): Promise<void> {
    throw new Error('insertMemoryConnection: not implemented for Supabase — run graph SQL manually');
  }

  async findSimilarForEdges(_params: FindSimilarForEdgesParams): Promise<FindSimilarForEdgesResult[]> {
    throw new Error('findSimilarForEdges: not implemented for Supabase');
  }

  async findNeighborMemories(_params: FindNeighborMemoriesParams): Promise<Memory[]> {
    throw new Error('findNeighborMemories: not implemented for Supabase');
  }

  async insertTask(params: InsertTaskParams): Promise<string> {
    const { data, error } = await this.client
      .from('tasks')
      .insert({ user_id: params.userId, description: params.description, project_dir: params.projectDir })
      .select('id')
      .single();
    if (error) throw new Error(`insertTask failed: ${error.message}`);
    return data.id as string;
  }

  async updateTask(params: UpdateTaskParams): Promise<void> {
    const { error } = await this.client
      .from('tasks')
      .update({
        status: params.status,
        result: params.result ?? null,
        error: params.error ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', params.id);
    if (error) throw new Error(`updateTask failed: ${error.message}`);
  }

  async deleteTask(id: string): Promise<void> {
    const { error } = await this.client.from('tasks').delete().eq('id', id);
    if (error) throw new Error(`deleteTask failed: ${error.message}`);
  }

  async listTasks(userId: string, limit: number): Promise<Task[]> {
    const { data, error } = await this.client
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`listTasks failed: ${error.message}`);
    return (data ?? []) as Task[];
  }

  async getTaskCount(userId: string): Promise<number> {
    const { count, error } = await this.client
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (error) throw new Error(`getTaskCount failed: ${error.message}`);
    return count ?? 0;
  }

  async getSessionStats(userId: string): Promise<SessionStats> {
    const { data: convData, error: convError } = await this.client
      .from('conversations')
      .select('ended_at, started_at')
      .eq('user_id', userId);

    if (convError) throw new Error(`getSessionStats failed: ${convError.message}`);

    const rows = convData ?? [];
    const completed = rows.filter(r => r.ended_at != null);
    const sessionCount = completed.length;
    const lastSession = completed.length > 0
      ? completed.reduce((max, r) => (r.ended_at! > max ? r.ended_at! : max), '')
      : null;
    const daysActive = new Set(rows.map(r => (r.started_at as string).slice(0, 10))).size;

    const { count, error: memError } = await this.client
      .from('memories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('superseded_by', null);

    if (memError) throw new Error(`getSessionStats memory count failed: ${memError.message}`);

    return { sessionCount, lastSession, daysActive, memoryCount: count ?? 0 };
  }

  async getEnabledHooks(_event: string): Promise<Hook[]> {
    throw new Error('getEnabledHooks: not implemented for Supabase');
  }

  async insertHook(_params: InsertHookParams): Promise<string> {
    throw new Error('insertHook: not implemented for Supabase');
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
