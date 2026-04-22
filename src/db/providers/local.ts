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

    for (const file of ['001_pglite.sql', '002_phase2.sql']) {
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
