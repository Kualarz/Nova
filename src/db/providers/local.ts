import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { DatabaseProvider, InsertMemoryParams, MatchMemoriesParams, ConversationMessage, ConversationSummary, InsertMemoryConnectionParams, FindSimilarForEdgesParams, FindSimilarForEdgesResult, FindNeighborMemoriesParams, Hook, InsertHookParams, SessionStats, Task, InsertTaskParams, UpdateTaskParams, Project, ProjectWithStats, Routine, RoutineRun, CreateRoutineParams, UpdateRoutineParams } from '../interface.js';
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

    for (const file of ['001_pglite.sql', '002_phase2.sql', '003_graph_constraint.sql', '004_automation.sql', '005_tasks.sql', '006_projects.sql', '007_companion.sql', '008_project_memory.sql', '009_connector_permissions.sql', '010_routines.sql']) {
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

  async listMemories(userId: string, limit: number): Promise<Memory[]> {
    const db = await this.getDb();
    const result = await db.query<Memory>(
      `SELECT id, content, category, confidence, access_count, created_at
       FROM memories
       WHERE user_id = $1 AND superseded_by IS NULL
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
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
      `UPDATE memories SET access_count = access_count + 1, last_accessed_at = $1
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
      `UPDATE conversations SET ended_at = now()::text, summary = $2, memory_extracted = 1 WHERE id = $1`,
      [id, summary ?? null]
    );
  }

  async deleteConversation(id: string): Promise<void> {
    const db = await this.getDb();
    // Cascade: messages should already be ON DELETE CASCADE, but be safe
    await db.query(`DELETE FROM messages WHERE conversation_id = $1`, [id]);
    await db.query(`DELETE FROM conversations WHERE id = $1`, [id]);
  }

  async getOrCreateCompanionConversation(userId: string): Promise<string> {
    const db = await this.getDb();
    const r = await db.query<{ id: string }>(
      `SELECT id FROM conversations
       WHERE user_id = $1 AND is_companion = 1
       ORDER BY started_at DESC LIMIT 1`,
      [userId]
    );
    if (r.rows[0]) return r.rows[0].id;
    const c = await db.query<{ id: string }>(
      `INSERT INTO conversations (user_id, is_companion) VALUES ($1, 1) RETURNING id`,
      [userId]
    );
    return c.rows[0]!.id;
  }

  async listProjects(userId: string): Promise<ProjectWithStats[]> {
    const db = await this.getDb();
    const result = await db.query<ProjectWithStats>(
      `SELECT p.id, p.user_id, p.name, p.description, p.instructions, p.created_at, p.updated_at,
         (SELECT COUNT(*) FROM conversations c WHERE c.project_id = p.id)::int AS chat_count
       FROM projects p
       WHERE p.user_id = $1
       ORDER BY p.updated_at DESC`,
      [userId]
    );
    return result.rows;
  }

  async getProject(id: string): Promise<Project | null> {
    const db = await this.getDb();
    const r = await db.query<Project>(`SELECT * FROM projects WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  }

  async createProject(userId: string, name: string, description = '', instructions = ''): Promise<string> {
    const db = await this.getDb();
    const r = await db.query<{ id: string }>(
      `INSERT INTO projects (user_id, name, description, instructions) VALUES ($1, $2, $3, $4) RETURNING id`,
      [userId, name, description, instructions]
    );
    return r.rows[0]!.id;
  }

  async updateProject(id: string, updates: { name?: string; description?: string; instructions?: string }): Promise<void> {
    const db = await this.getDb();
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (updates.name !== undefined)         { fields.push(`name = $${i++}`);         values.push(updates.name); }
    if (updates.description !== undefined)  { fields.push(`description = $${i++}`);  values.push(updates.description); }
    if (updates.instructions !== undefined) { fields.push(`instructions = $${i++}`); values.push(updates.instructions); }
    if (!fields.length) return;
    fields.push(`updated_at = now()::text`);
    values.push(id);
    await db.query(`UPDATE projects SET ${fields.join(', ')} WHERE id = $${i}`, values);
  }

  async deleteProject(id: string): Promise<void> {
    const db = await this.getDb();
    await db.query(`DELETE FROM projects WHERE id = $1`, [id]);
  }

  async listProjectConversations(projectId: string): Promise<Array<{ id: string; started_at: string; ended_at: string | null; first_message: string | null }>> {
    const db = await this.getDb();
    const r = await db.query<{ id: string; started_at: string; ended_at: string | null; first_message: string | null }>(
      `SELECT c.id, c.started_at, c.ended_at,
         (SELECT m.content FROM messages m
          WHERE m.conversation_id = c.id AND m.role = 'user'
          ORDER BY m.created_at ASC LIMIT 1) AS first_message
       FROM conversations c
       WHERE c.project_id = $1
       ORDER BY c.started_at DESC`,
      [projectId]
    );
    return r.rows;
  }

  async linkConversationToProject(conversationId: string, projectId: string | null): Promise<void> {
    const db = await this.getDb();
    await db.query(`UPDATE conversations SET project_id = $1 WHERE id = $2`, [projectId, conversationId]);
  }

  async getConversationProjectId(conversationId: string): Promise<string | null> {
    const db = await this.getDb();
    const r = await db.query<{ project_id: string | null }>(
      `SELECT project_id FROM conversations WHERE id = $1`,
      [conversationId]
    );
    return r.rows[0]?.project_id ?? null;
  }

  async getLatestProjectMemory(projectId: string): Promise<{ id: string; content: string; source: string; created_at: string } | null> {
    const db = await this.getDb();
    const r = await db.query<{ id: string; content: string; source: string; created_at: string }>(
      `SELECT id, content, source, created_at FROM project_memories WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [projectId]
    );
    return r.rows[0] ?? null;
  }

  async insertProjectMemory(projectId: string, content: string, source: string): Promise<string> {
    const db = await this.getDb();
    const r = await db.query<{ id: string }>(
      `INSERT INTO project_memories (project_id, content, source) VALUES ($1, $2, $3) RETURNING id`,
      [projectId, content, source]
    );
    return r.rows[0]!.id;
  }

  async listProjectsForCron(userId: string, sinceHours: number): Promise<Array<{ id: string; name: string }>> {
    const db = await this.getDb();
    // sinceHours is a number we control; safe to interpolate
    const hours = Math.max(1, Math.floor(sinceHours));
    const r = await db.query<{ id: string; name: string }>(
      `SELECT DISTINCT p.id, p.name FROM projects p
       JOIN conversations c ON c.project_id = p.id
       WHERE p.user_id = $1
         AND (c.started_at > (now() - interval '${hours} hours')::text
              OR c.ended_at  > (now() - interval '${hours} hours')::text)`,
      [userId]
    );
    return r.rows;
  }

  async listConnectorPermissions(userId: string, connector?: string): Promise<Array<{ connector: string; tool: string; permission: string }>> {
    const db = await this.getDb();
    if (connector) {
      const r = await db.query<{ connector: string; tool: string; permission: string }>(
        `SELECT connector, tool, permission FROM connector_permissions WHERE user_id = $1 AND connector = $2`,
        [userId, connector]
      );
      return r.rows;
    }
    const r = await db.query<{ connector: string; tool: string; permission: string }>(
      `SELECT connector, tool, permission FROM connector_permissions WHERE user_id = $1`,
      [userId]
    );
    return r.rows;
  }

  async setConnectorPermission(userId: string, connector: string, tool: string, permission: 'always-allow' | 'needs-approval' | 'never'): Promise<void> {
    const db = await this.getDb();
    await db.query(
      `INSERT INTO connector_permissions (user_id, connector, tool, permission) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, connector, tool) DO UPDATE SET permission = EXCLUDED.permission`,
      [userId, connector, tool, permission]
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
      toolInput: r.tool_input ? JSON.parse(r.tool_input) as unknown : undefined,
      toolOutput: r.tool_output ? JSON.parse(r.tool_output) as unknown : undefined,
    }));
  }

  async listConversations(userId: string, limit: number): Promise<ConversationSummary[]> {
    const db = await this.getDb();
    // Filter out:
    //   - Companion chats (those have their own dedicated UI; they aren't part of recents)
    //   - Empty conversations with no user messages (browser opens that never sent a message)
    const result = await db.query<ConversationSummary>(
      `SELECT c.id, c.started_at, c.ended_at,
         (SELECT m.content FROM messages m
          WHERE m.conversation_id = c.id AND m.role = 'user'
          ORDER BY m.created_at ASC LIMIT 1) AS first_message
       FROM conversations c
       WHERE c.user_id = $1
         AND (c.is_companion IS NULL OR c.is_companion = 0)
         AND EXISTS (
           SELECT 1 FROM messages m
           WHERE m.conversation_id = c.id AND m.role = 'user'
         )
       ORDER BY c.started_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  }

  async logEvent(userId: string, type: string, payload: unknown): Promise<void> {
    const db = await this.getDb();
    await db.query(
      `INSERT INTO events (user_id, event_type, payload) VALUES ($1, $2, $3)`,
      [userId, type, JSON.stringify(payload)]
    );
  }

  async insertMemoryConnection(params: InsertMemoryConnectionParams): Promise<void> {
    const db = await this.getDb();
    const [a, b] = [params.memoryAId, params.memoryBId].sort();
    await db.query(
      `INSERT INTO memory_connections (memory_a_id, memory_b_id, similarity, type)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (memory_a_id, memory_b_id) DO UPDATE SET similarity = EXCLUDED.similarity`,
      [a, b, params.similarity, params.type]
    );
  }

  async findSimilarForEdges(params: FindSimilarForEdgesParams): Promise<FindSimilarForEdgesResult[]> {
    const db = await this.getDb();
    const embStr = embeddingToSql(params.embedding);
    const result = await db.query<FindSimilarForEdgesResult>(
      `SELECT id, 1 - (embedding <=> $1::vector) AS similarity
       FROM memories
       WHERE user_id = $2
         AND id != $3
         AND superseded_by IS NULL
         AND 1 - (embedding <=> $1::vector) > $4
       ORDER BY embedding <=> $1::vector
       LIMIT $5`,
      [embStr, params.userId, params.excludeId, params.threshold, params.limit]
    );
    return result.rows;
  }

  async findNeighborMemories(params: FindNeighborMemoriesParams): Promise<Memory[]> {
    if (params.memoryIds.length === 0) return [];
    const db = await this.getDb();
    const phs = params.memoryIds.map((_, i) => `$${i + 2}`).join(', ');
    const result = await db.query<Memory>(
      `SELECT DISTINCT m.id, m.content, m.category, m.confidence, m.access_count, m.created_at
       FROM memories m
       WHERE m.user_id = $1
         AND m.superseded_by IS NULL
         AND m.id NOT IN (${phs})
         AND EXISTS (
           SELECT 1 FROM memory_connections mc
           WHERE (mc.memory_a_id = m.id AND mc.memory_b_id IN (${phs}))
              OR (mc.memory_b_id = m.id AND mc.memory_a_id IN (${phs}))
         )`,
      [params.userId, ...params.memoryIds]
    );
    return result.rows;
  }

  async insertTask(params: InsertTaskParams): Promise<string> {
    const db = await this.getDb();
    const result = await db.query<{ id: string }>(
      `INSERT INTO tasks (user_id, description, project_dir) VALUES ($1, $2, $3) RETURNING id`,
      [params.userId, params.description, params.projectDir]
    );
    return result.rows[0]!.id;
  }

  async updateTask(params: UpdateTaskParams): Promise<void> {
    const db = await this.getDb();
    await db.query(
      `UPDATE tasks SET status = $2, result = $3, error = $4, completed_at = now()::text WHERE id = $1`,
      [params.id, params.status, params.result ?? null, params.error ?? null]
    );
  }

  async deleteTask(id: string): Promise<void> {
    const db = await this.getDb();
    await db.query(`DELETE FROM tasks WHERE id = $1`, [id]);
  }

  async listTasks(userId: string, limit: number): Promise<Task[]> {
    const db = await this.getDb();
    const result = await db.query<Task>(
      `SELECT id, user_id, description, project_dir, status, result, error, created_at, completed_at
       FROM tasks WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  }

  async getTaskCount(userId: string): Promise<number> {
    const db = await this.getDb();
    const result = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM tasks WHERE user_id = $1`,
      [userId]
    );
    return parseInt(result.rows[0]?.count ?? '0', 10);
  }

  async getSessionStats(userId: string): Promise<SessionStats> {
    const db = await this.getDb();

    const convResult = await db.query<{ session_count: string; last_session: string | null; days_active: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE ended_at IS NOT NULL)            AS session_count,
         MAX(ended_at)                                           AS last_session,
         COUNT(DISTINCT SUBSTR(started_at, 1, 10))              AS days_active
       FROM conversations
       WHERE user_id = $1`,
      [userId]
    );

    const memResult = await db.query<{ memory_count: string }>(
      `SELECT COUNT(*) AS memory_count
       FROM memories
       WHERE user_id = $1 AND superseded_by IS NULL`,
      [userId]
    );

    const row = convResult.rows[0];
    const memRow = memResult.rows[0];
    return {
      sessionCount: parseInt(row?.session_count ?? '0', 10),
      lastSession: row?.last_session ?? null,
      daysActive: parseInt(row?.days_active ?? '0', 10),
      memoryCount: parseInt(memRow?.memory_count ?? '0', 10),
    };
  }

  async getEnabledHooks(event: string): Promise<Hook[]> {
    const db = await this.getDb();
    const result = await db.query<Hook>(
      `SELECT id, event, skill_name, enabled FROM hooks WHERE event = $1 AND enabled = 1`,
      [event]
    );
    return result.rows;
  }

  async insertHook(params: InsertHookParams): Promise<string> {
    const db = await this.getDb();
    const result = await db.query<{ id: string }>(
      `INSERT INTO hooks (event, skill_name) VALUES ($1, $2) RETURNING id`,
      [params.event, params.skillName]
    );
    return result.rows[0]!.id;
  }

  async listRoutines(userId: string): Promise<Routine[]> {
    const db = await this.getDb();
    const r = await db.query<Routine>(
      `SELECT * FROM routines WHERE user_id = $1 ORDER BY updated_at DESC`,
      [userId]
    );
    return r.rows;
  }

  async getRoutine(id: string): Promise<Routine | null> {
    const db = await this.getDb();
    const r = await db.query<Routine>(`SELECT * FROM routines WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  }

  async createRoutine(userId: string, params: CreateRoutineParams): Promise<string> {
    const db = await this.getDb();
    const r = await db.query<{ id: string }>(
      `INSERT INTO routines (user_id, name, description, prompt, cron_expr)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, params.name, params.description ?? null, params.prompt, params.cron_expr]
    );
    return r.rows[0]!.id;
  }

  async updateRoutine(id: string, updates: UpdateRoutineParams): Promise<void> {
    const db = await this.getDb();
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined) continue;
      fields.push(`${k} = $${i++}`);
      values.push(v);
    }
    if (!fields.length) return;
    fields.push(`updated_at = now()::text`);
    values.push(id);
    await db.query(`UPDATE routines SET ${fields.join(', ')} WHERE id = $${i}`, values);
  }

  async deleteRoutine(id: string): Promise<void> {
    const db = await this.getDb();
    await db.query(`DELETE FROM routines WHERE id = $1`, [id]);
  }

  async insertRoutineRun(routineId: string): Promise<string> {
    const db = await this.getDb();
    const r = await db.query<{ id: string }>(
      `INSERT INTO routine_runs (routine_id) VALUES ($1) RETURNING id`,
      [routineId]
    );
    return r.rows[0]!.id;
  }

  async completeRoutineRun(id: string, status: string, output?: string, error?: string): Promise<void> {
    const db = await this.getDb();
    await db.query(
      `UPDATE routine_runs SET completed_at = now()::text, status = $1, output = $2, error = $3 WHERE id = $4`,
      [status, output ?? null, error ?? null, id]
    );
  }

  async listRoutineRuns(routineId: string, limit: number): Promise<RoutineRun[]> {
    const db = await this.getDb();
    const r = await db.query<RoutineRun>(
      `SELECT * FROM routine_runs WHERE routine_id = $1 ORDER BY started_at DESC LIMIT $2`,
      [routineId, limit]
    );
    return r.rows;
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }
}
