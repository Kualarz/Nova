/**
 * NOVA Web UI server — Express + WebSocket, replaces bare dashboard.
 *
 * REST:
 *   GET  /api/status
 *   GET  /api/memories
 *   GET  /api/tasks
 *   GET  /api/workspace          — list editable files
 *   GET  /api/workspace/*        — read file
 *   PUT  /api/workspace/*        — save file (creates .bak backup)
 *   GET  /api/settings           — config, secrets masked
 *   POST /api/settings           — update .env + reload config
 *
 * WebSocket /ws — per-connection chat with in-memory history
 */

import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import { fileURLToPath } from 'url';
import * as path from 'path';
import * as fs from 'fs';
import cron from 'node-cron';
import { getConfig, resetConfig } from '../lib/config.js';
import { resetModelRouter } from '../providers/router.js';
import { getDb, resetDb } from '../db/client.js';
import { listRecentTasks, createTask, deleteTask } from '../tasks/store.js';
import { runWebTurn } from '../agent/nova.js';
import { buildBaseSystemPrompt } from '../agent/system-prompt.js';
import { startConversation, appendMessage, endConversation } from '../conversations/store.js';
import { extractMemories } from '../memory/extract.js';
import { reconcileMemories } from '../memory/reconcile.js';
import { CONNECTOR_CATALOG, defaultPermission } from '../connectors/catalog.js';
import { loadAllRoutines, scheduleRoutine, unscheduleRoutine, executeRoutine } from '../routines/engine.js';
import type { Message } from '../providers/interface.js';

function getProjectFilesDir(workspacePath: string, projectId: string): string {
  return path.join(workspacePath, 'projects', projectId, 'files');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
// Static assets are not compiled — resolve from project root at runtime
const PUBLIC_DIR = path.resolve(process.cwd(), 'src', 'server', 'public');

// ── Secrets that are masked in GET /api/settings ──────────────────────────────
const SECRET_KEYS = new Set([
  'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'GROQ_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'DISCORD_BOT_TOKEN',
  'NOTION_API_KEY',
  'WEB_SEARCH_API_KEY',
  'OPENWEATHER_API_KEY',
  'WHISPER_API_KEY',
  'ELEVENLABS_API_KEY',
]);

// Keys the settings form is allowed to overwrite
const WRITABLE_KEYS = new Set([
  'MODEL_PROVIDER', 'DEFAULT_MODEL', 'COMPLEX_MODEL', 'EMBED_MODEL',
  'OLLAMA_HOST', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY',
  'DATABASE_TYPE', 'PGLITE_PATH',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'NOVA_WORKSPACE_PATH',
  'GOOGLE_CREDENTIALS_PATH', 'NOTION_API_KEY',
  'WEB_SEARCH_API_KEY', 'OPENWEATHER_API_KEY',
  'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
  'DISCORD_BOT_TOKEN', 'DISCORD_USER_ID',
  'WHISPER_API_KEY', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID',
  'NOVA_WORKFLOWS',
  'PROFILE_NAME', 'PROFILE_BACKGROUND', 'PROFILE_STYLE',
  'PROFILE_FULL_NAME', 'PROFILE_NICKNAME', 'PROFILE_WORK', 'PROFILE_PREFERENCES',
  'NOTIFY_COMPLETIONS', 'APPEARANCE_COLOR', 'APPEARANCE_BG_ANIM',
  'MEMORY_SEARCH', 'MEMORY_GENERATE', 'ARTIFACTS', 'TOOL_LOAD_MODE',
]);

function maskSecret(key: string, value: string): string {
  if (!SECRET_KEYS.has(key) || !value) return value;
  return value.length <= 8 ? '••••••••' : '••••••••' + value.slice(-4);
}

// ── .env file updater ─────────────────────────────────────────────────────────
function updateDotEnv(updates: Record<string, string>): void {
  const envPath = path.resolve(process.cwd(), '.env');
  let content = '';
  try { content = fs.readFileSync(envPath, 'utf8'); } catch { /* new file */ }

  for (const [key, value] of Object.entries(updates)) {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(content)) {
      content = content.replace(re, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
  }
  fs.writeFileSync(envPath, content, 'utf8');
}

// ── Workspace helpers ─────────────────────────────────────────────────────────
function getWorkspaceFiles(workspacePath: string): string[] {
  const files: string[] = [];
  for (const f of ['SOUL.md', 'USER.md', 'MEMORY.md', 'AGENTS.md']) {
    if (fs.existsSync(path.join(workspacePath, f))) files.push(f);
  }
  const skillsDir = path.join(workspacePath, 'skills');
  if (fs.existsSync(skillsDir)) {
    fs.readdirSync(skillsDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .forEach(f => files.push(`skills/${f}`));
  }
  const memoryDir = path.join(workspacePath, 'memory');
  if (fs.existsSync(memoryDir)) {
    fs.readdirSync(memoryDir)
      .filter(f => f.endsWith('.md'))
      .sort().reverse()
      .slice(0, 14)
      .forEach(f => files.push(`memory/${f}`));
  }
  return files;
}

function safeWorkspacePath(workspacePath: string, filePath: string): string | null {
  if (!filePath || !filePath.endsWith('.md')) return null;
  const resolved = path.resolve(workspacePath, filePath);
  if (!resolved.startsWith(path.resolve(workspacePath) + path.sep) &&
      resolved !== path.resolve(workspacePath)) return null;
  return resolved;
}

// ── Per-connection chat state ─────────────────────────────────────────────────
interface ChatSession {
  conversationId: string | null;
  history: Message[];
  systemPrompt: string;
  model?: string; // user-selected model override for this session
  isCompanion?: boolean;
  // Phase 3b: in-flight tool-approval requests, keyed by request_id. The
  // resolve() callback flips a Promise the agent loop is awaiting; timer
  // auto-denies after 60s so the agent never blocks indefinitely.
  pendingApprovals?: Map<string, { resolve: (allow: boolean) => void; timer: NodeJS.Timeout }>;
  requestApproval?: (tool: string, args: unknown, description: string) => Promise<boolean>;
}

function requestToolApproval(
  ws: WebSocket,
  session: ChatSession,
  tool: string,
  args: unknown,
  description: string,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const id = Math.random().toString(36).slice(2);
    if (!session.pendingApprovals) session.pendingApprovals = new Map();
    const timer = setTimeout(() => {
      session.pendingApprovals?.delete(id);
      resolve(false);
    }, 60_000);
    session.pendingApprovals.set(id, { resolve, timer });
    try {
      ws.send(JSON.stringify({ type: 'approval_request', request_id: id, tool, args, description }));
    } catch {
      // Socket closed before we could ask — fail-safe deny.
      clearTimeout(timer);
      session.pendingApprovals.delete(id);
      resolve(false);
    }
  });
}

function buildHistoryTranscript(history: Message[]): string {
  return history
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => (m.role === 'user' ? `Jimmy: ${m.content ?? ''}` : `NOVA: ${m.content ?? ''}`))
    .join('\n');
}

// ── Uptime tracking ───────────────────────────────────────────────────────────
const startTime = Date.now();

// ── Server factory ────────────────────────────────────────────────────────────
let _server: http.Server | null = null;

export function startWebServer(port = 3000): void {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Static files (the web UI)
  app.use(express.static(PUBLIC_DIR));

  // ── REST ─────────────────────────────────────────────────────────────────────

  app.get('/api/status', async (_req, res) => {
    try {
      const config = getConfig();
      const db = await getDb();
      const stats = await db.getSessionStats(config.NOVA_USER_ID);
      const tasks = await listRecentTasks(200);
      const tasksByStatus = { running: 0, done: 0, error: 0 };
      for (const t of tasks) {
        if (t.status in tasksByStatus) tasksByStatus[t.status as keyof typeof tasksByStatus]++;
      }
      const wsFiles = config.NOVA_WORKSPACE_PATH
        ? (() => { try { return getWorkspaceFiles(config.NOVA_WORKSPACE_PATH).length; } catch { return 0; } })()
        : 0;
      res.json({
        ...stats,
        uptime: Date.now() - startTime,
        provider: config.MODEL_PROVIDER,
        model: config.DEFAULT_MODEL,
        complexModel: config.COMPLEX_MODEL,
        database: config.DATABASE_TYPE,
        workspacePath: config.NOVA_WORKSPACE_PATH,
        workspaceFiles: wsFiles,
        tasks: { total: tasks.length, ...tasksByStatus },
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/memories', async (_req, res) => {
    try {
      const config = getConfig();
      const db = await getDb();
      const memories = await db.listMemories(config.NOVA_USER_ID, 100);
      res.json(memories);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/tasks', async (_req, res) => {
    try {
      const tasks = await listRecentTasks(50);
      res.json(tasks);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/tasks', async (req, res) => {
    try {
      const { topic, detail, action } = req.body as { topic?: string; detail?: string; action?: string };
      if (!topic?.trim()) return res.status(400).json({ error: 'topic is required' });
      // Build a description from the fields
      const desc = [topic.trim(), detail?.trim(), action?.trim()].filter(Boolean).join(' — ');
      const id = await createTask(desc, process.cwd());
      const tasks = await listRecentTasks(50);
      res.json({ id, tasks });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/tasks/:id', async (req, res) => {
    try {
      await deleteTask(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/models', async (req, res) => {
    try {
      const config = getConfig();
      const qp = req.query.provider as string | undefined;
      const provider = (qp === 'openrouter' || qp === 'ollama' || qp === 'anthropic' || qp === 'groq') ? qp : config.MODEL_PROVIDER;

      if (provider === 'groq') {
        const resp = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${config.GROQ_API_KEY}` },
        });
        if (!resp.ok) return res.status(502).json({ error: `Groq unreachable: ${resp.status}` });
        const data = (await resp.json()) as { data: Array<{ id: string; owned_by?: string }> };
        const models = (data.data ?? [])
          .sort((a, b) => a.id.localeCompare(b.id))
          .map(m => ({ name: m.id, label: m.id, size: 0 }));
        return res.json({ models, current: config.DEFAULT_MODEL, provider: 'groq' });
      }

      if (provider === 'anthropic') {
        const models = [
          { name: 'claude-opus-4-7',           label: 'Claude Opus 4.7',   size: 0 },
          { name: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6', size: 0 },
          { name: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',  size: 0 },
        ];
        return res.json({ models, current: config.DEFAULT_MODEL, provider: 'anthropic' });
      }

      if (provider === 'openrouter') {
        const resp = await fetch('https://openrouter.ai/api/v1/models', {
          headers: { Authorization: `Bearer ${config.OPENROUTER_API_KEY}` },
        });
        if (!resp.ok) return res.status(502).json({ error: 'OpenRouter unreachable' });
        const data = (await resp.json()) as { data: Array<{ id: string; name: string; pricing?: { prompt: string } }> };
        const models = (data.data ?? [])
          .filter(m => m.id.endsWith(':free') || m.pricing?.prompt === '0')
          .sort((a, b) => a.id.localeCompare(b.id))
          .map(m => ({ name: m.id, label: m.name, size: 0 }));
        return res.json({ models, current: config.DEFAULT_MODEL, provider: 'openrouter' });
      }

      // Ollama
      const resp = await fetch(`${config.OLLAMA_HOST}/api/tags`);
      if (!resp.ok) return res.status(502).json({ error: 'Ollama unreachable' });
      const data = (await resp.json()) as { models: Array<{ name: string; size: number }> };
      const models = (data.models ?? []).map(m => ({ name: m.name, label: m.name, size: m.size }));
      res.json({ models, current: config.DEFAULT_MODEL, provider: 'ollama' });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/conversations', async (_req, res) => {
    try {
      const config = getConfig();
      const db = await getDb();
      const convs = await db.listConversations(config.NOVA_USER_ID, 40);
      res.json(convs);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/conversations/:id', async (req, res) => {
    try {
      const db = await getDb();
      await db.deleteConversation(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/conversations/:id/messages', async (req, res) => {
    try {
      const db = await getDb();
      const messages = await db.getConversationMessages(req.params.id);
      res.json(messages.filter(m => m.role === 'user' || m.role === 'assistant'));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.patch('/api/conversations/:id/project', async (req, res) => {
    try {
      const db = await getDb();
      const { projectId } = req.body as { projectId: string | null };
      await db.linkConversationToProject(req.params.id, projectId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/skills', (_req, res) => {
    try {
      const config = getConfig();
      const skillsDir = path.join(config.NOVA_WORKSPACE_PATH, 'skills');
      if (!fs.existsSync(skillsDir)) return res.json([]);
      const skills = fs.readdirSync(skillsDir)
        .filter(f => f.endsWith('.md'))
        .map(f => ({ name: f.replace(/\.md$/, ''), path: `skills/${f}` }));
      res.json(skills);
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  // ── Projects CRUD ───────────────────────────────────────────────────────────
  app.get('/api/projects', async (_req, res) => {
    try {
      const config = getConfig();
      const db = await getDb();
      const projects = await db.listProjects(config.NOVA_USER_ID);
      res.json(projects);
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  app.post('/api/projects', async (req, res) => {
    try {
      const config = getConfig();
      const db = await getDb();
      const { name, description, instructions } = req.body as { name?: string; description?: string; instructions?: string };
      if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
      const id = await db.createProject(config.NOVA_USER_ID, name.trim(), description?.trim() || '', instructions?.trim() || '');
      const project = await db.getProject(id);
      res.json(project);
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  app.get('/api/projects/:id', async (req, res) => {
    try {
      const db = await getDb();
      const project = await db.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      const conversations = await db.listProjectConversations(req.params.id);
      res.json({ ...project, conversations });
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  app.patch('/api/projects/:id', async (req, res) => {
    try {
      const db = await getDb();
      const { name, description, instructions } = req.body as { name?: string; description?: string; instructions?: string };
      await db.updateProject(req.params.id, { name, description, instructions });
      const project = await db.getProject(req.params.id);
      res.json(project);
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  app.delete('/api/projects/:id', async (req, res) => {
    try {
      const db = await getDb();
      await db.deleteProject(req.params.id);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  // ── Project memory ──────────────────────────────────────────────────────────
  app.get('/api/projects/:id/memory', async (req, res) => {
    try {
      const db = await getDb();
      const memory = await db.getLatestProjectMemory(req.params.id);
      res.json(memory);
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  app.post('/api/projects/:id/memory/regenerate', async (req, res) => {
    try {
      const { synthesizeProjectMemory } = await import('../memory/project-synthesis.js');
      const result = await synthesizeProjectMemory(req.params.id, 'chat-end');
      res.json({ ok: true, synthesis: result });
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  // ── Project files (workspace/projects/<id>/files/) ──────────────────────────
  app.get('/api/projects/:id/files', (req, res) => {
    try {
      const config = getConfig();
      const dir = getProjectFilesDir(config.NOVA_WORKSPACE_PATH, req.params.id);
      if (!fs.existsSync(dir)) return res.json([]);
      const files = fs.readdirSync(dir).map(name => {
        const stats = fs.statSync(path.join(dir, name));
        return { name, size: stats.size, modified: stats.mtime.toISOString() };
      });
      res.json(files);
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  app.post('/api/projects/:id/files', (req, res) => {
    try {
      const config = getConfig();
      const dir = getProjectFilesDir(config.NOVA_WORKSPACE_PATH, req.params.id);
      fs.mkdirSync(dir, { recursive: true });
      const { name, content } = req.body as { name?: string; content?: string };
      if (!name || content === undefined) return res.status(400).json({ error: 'name + content required' });
      const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
      fs.writeFileSync(path.join(dir, safe), content, 'utf8');
      res.json({ ok: true, name: safe });
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  app.delete('/api/projects/:id/files/:name', (req, res) => {
    try {
      const config = getConfig();
      const dir = getProjectFilesDir(config.NOVA_WORKSPACE_PATH, req.params.id);
      const safe = req.params.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const p = path.join(dir, safe);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  // ── Connector catalog + permissions ─────────────────────────────────────────
  app.get('/api/connectors/catalog', (_req, res) => {
    res.json(CONNECTOR_CATALOG);
  });

  app.get('/api/connectors/:id/permissions', async (req, res) => {
    try {
      const config = getConfig();
      const db = await getDb();
      const def = CONNECTOR_CATALOG.find(c => c.id === req.params.id);
      if (!def) return res.status(404).json({ error: 'Unknown connector' });
      const stored = await db.listConnectorPermissions(config.NOVA_USER_ID, req.params.id);
      const result = def.tools.map(t => {
        const found = stored.find(s => s.tool === t.name);
        return {
          ...t,
          permission: found?.permission ?? defaultPermission(t.type),
        };
      });
      res.json(result);
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  app.post('/api/connectors/:id/permissions', async (req, res) => {
    try {
      const config = getConfig();
      const db = await getDb();
      const { tool, permission } = req.body as { tool?: string; permission?: string };
      if (!tool || !['always-allow', 'needs-approval', 'never'].includes(permission ?? '')) {
        return res.status(400).json({ error: 'tool + permission required (always-allow|needs-approval|never)' });
      }
      await db.setConnectorPermission(
        config.NOVA_USER_ID,
        req.params.id,
        tool,
        permission as 'always-allow' | 'needs-approval' | 'never'
      );
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  // ── Routines (scheduled prompts) ────────────────────────────────────────────
  app.get('/api/routines', async (_req, res) => {
    try {
      const config = getConfig();
      const db = await getDb();
      const routines = await db.listRoutines(config.NOVA_USER_ID);
      res.json(routines);
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  app.get('/api/routines/:id', async (req, res) => {
    try {
      const db = await getDb();
      const routine = await db.getRoutine(req.params.id);
      if (!routine) return res.status(404).json({ error: 'Not found' });
      const runs = await db.listRoutineRuns(req.params.id, 20);
      res.json({ ...routine, runs });
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  app.post('/api/routines', async (req, res) => {
    try {
      const config = getConfig();
      const db = await getDb();
      const { name, description, prompt, cron_expr } = req.body as { name?: string; description?: string; prompt?: string; cron_expr?: string };
      if (!name?.trim() || !prompt?.trim() || !cron_expr?.trim()) {
        return res.status(400).json({ error: 'name, prompt, cron_expr required' });
      }
      if (!cron.validate(cron_expr)) {
        return res.status(400).json({ error: 'Invalid cron expression' });
      }
      const id = await db.createRoutine(config.NOVA_USER_ID, {
        name: name.trim(),
        description,
        prompt: prompt.trim(),
        cron_expr: cron_expr.trim(),
      });
      const routine = await db.getRoutine(id);
      if (routine) scheduleRoutine(routine);
      res.json(routine);
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  app.patch('/api/routines/:id', async (req, res) => {
    try {
      const db = await getDb();
      const { name, description, prompt, cron_expr, enabled } = req.body as {
        name?: string; description?: string; prompt?: string; cron_expr?: string; enabled?: boolean;
      };
      if (cron_expr && !cron.validate(cron_expr)) {
        return res.status(400).json({ error: 'Invalid cron expression' });
      }
      const updates: { name?: string; description?: string; prompt?: string; cron_expr?: string; enabled?: number } = {
        name, description, prompt, cron_expr,
      };
      if (typeof enabled === 'boolean') updates.enabled = enabled ? 1 : 0;
      await db.updateRoutine(req.params.id, updates);
      const updated = await db.getRoutine(req.params.id);
      if (updated) scheduleRoutine(updated);
      res.json(updated);
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  app.delete('/api/routines/:id', async (req, res) => {
    try {
      const db = await getDb();
      unscheduleRoutine(req.params.id);
      await db.deleteRoutine(req.params.id);
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  app.post('/api/routines/:id/run', async (req, res) => {
    try {
      const db = await getDb();
      const routine = await db.getRoutine(req.params.id);
      if (!routine) return res.status(404).json({ error: 'Not found' });
      void executeRoutine(routine);
      res.json({ ok: true, message: 'Routine started — check status in a moment' });
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  app.get('/api/workspace', (_req, res) => {
    try {
      const config = getConfig();
      res.json(getWorkspaceFiles(config.NOVA_WORKSPACE_PATH));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/workspace/{*path}', (req, res) => {
    try {
      const config = getConfig();
      const _p = (req.params as unknown as Record<string, unknown>).path;
      const filePath = Array.isArray(_p) ? _p.join('/') : ((_p as string) ?? '');
      const abs = safeWorkspacePath(config.NOVA_WORKSPACE_PATH, filePath);
      if (!abs) return res.status(400).json({ error: 'Invalid path' });
      if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Not found' });
      res.json({ path: filePath, content: fs.readFileSync(abs, 'utf8') });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.put('/api/workspace/{*path}', (req, res) => {
    try {
      const config = getConfig();
      const _p2 = (req.params as unknown as Record<string, unknown>).path;
      const filePath = Array.isArray(_p2) ? _p2.join('/') : ((_p2 as string) ?? '');
      const abs = safeWorkspacePath(config.NOVA_WORKSPACE_PATH, filePath);
      if (!abs) return res.status(400).json({ error: 'Invalid path' });
      const content = (req.body as { content?: string }).content ?? '';
      // Backup the previous version
      if (fs.existsSync(abs)) fs.copyFileSync(abs, abs + '.bak');
      // Ensure directory exists (e.g. for new skills)
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/settings', (_req, res) => {
    try {
      const config = getConfig();
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(config)) {
        out[k] = maskSecret(k, String(v ?? ''));
      }
      res.json(out);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/settings', (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const updates: Record<string, string> = {};
      for (const [k, v] of Object.entries(body)) {
        if (!WRITABLE_KEYS.has(k) || typeof v !== 'string') continue;
        if (v.startsWith('••••')) continue; // unchanged masked field
        updates[k] = v;
      }
      if (Object.keys(updates).length > 0) {
        updateDotEnv(updates);
        // Inject directly into process.env so the running server picks them up
        for (const [k, v] of Object.entries(updates)) {
          process.env[k] = v;
        }
        resetConfig();
        resetModelRouter();
        // If DB-related keys changed, reset the cached DB provider so the next
        // request reinstantiates with the new DATABASE_TYPE / connection params.
        if (updates['DATABASE_TYPE'] || updates['SUPABASE_URL'] ||
            updates['SUPABASE_SERVICE_ROLE_KEY'] || updates['PGLITE_PATH']) {
          resetDb();
        }
      }
      res.json({ ok: true, updated: Object.keys(updates) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Phase 4.4: server-side voice ───────────────────────────────────────────
  // Whisper STT — accepts raw audio bytes (any codec the browser produced),
  // forwards to OpenAI as multipart/form-data, returns the transcript.
  app.post('/api/voice/transcribe', express.raw({ type: '*/*', limit: '25mb' }), async (req, res) => {
    try {
      const config = getConfig();
      if (!config.WHISPER_API_KEY) {
        return res.status(503).json({ error: 'WHISPER_API_KEY not configured' });
      }
      const buf = req.body as Buffer;
      if (!buf || !buf.length) return res.status(400).json({ error: 'no audio body' });
      const contentType = req.header('x-audio-mime') || 'audio/webm';

      const fd = new FormData();
      const blob = new Blob([new Uint8Array(buf)], { type: contentType });
      fd.append('file', blob, 'audio.webm');
      fd.append('model', 'whisper-1');

      const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${config.WHISPER_API_KEY}` },
        body: fd as unknown as ReadableStream,
      });
      if (!resp.ok) {
        const err = await resp.text().catch(() => '');
        return res.status(resp.status).json({ error: `Whisper error: ${err.slice(0, 300)}` });
      }
      const data = await resp.json() as { text?: string };
      res.json({ text: data.text ?? '' });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ElevenLabs TTS — accepts JSON {text}, returns audio/mpeg bytes.
  app.post('/api/voice/synthesize', async (req, res) => {
    try {
      const config = getConfig();
      if (!config.ELEVENLABS_API_KEY) {
        return res.status(503).json({ error: 'ELEVENLABS_API_KEY not configured' });
      }
      const { text } = req.body as { text?: string };
      if (!text?.trim()) return res.status(400).json({ error: 'text required' });
      // ElevenLabs caps ~5000 chars/request — clip to be safe.
      const clipped = text.slice(0, 4500);
      const voiceId = config.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';

      const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
        method: 'POST',
        headers: {
          'xi-api-key': config.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: clipped,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      });
      if (!resp.ok) {
        const err = await resp.text().catch(() => '');
        return res.status(resp.status).json({ error: `ElevenLabs error: ${err.slice(0, 300)}` });
      }
      const audio = Buffer.from(await resp.arrayBuffer());
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', audio.length);
      res.send(audio);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // List ElevenLabs voices (for an eventual picker UI).
  app.get('/api/voice/voices', async (_req, res) => {
    try {
      const config = getConfig();
      if (!config.ELEVENLABS_API_KEY) return res.json([]);
      const resp = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': config.ELEVENLABS_API_KEY },
      });
      if (!resp.ok) return res.json([]);
      const data = await resp.json() as { voices: Array<{ voice_id: string; name: string; labels?: Record<string, string> }> };
      res.json(data.voices.map(v => ({ id: v.voice_id, name: v.name, labels: v.labels ?? {} })));
    } catch {
      res.json([]);
    }
  });

  // SPA fallback — serve index.html for any non-API route
  app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  // ── HTTP server ───────────────────────────────────────────────────────────────
  const server = http.createServer(app);

  // ── WebSocket chat ────────────────────────────────────────────────────────────
  const wss = new WebSocketServer({ server, path: '/ws' });
  const sessions = new Map<WebSocket, ChatSession>();

  // Helper: race a promise against a timeout so a stuck dependency surfaces
  // as an error instead of an indefinite "connecting…" state on the client.
  function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      ),
    ]);
  }

  wss.on('connection', (ws, req) => {
    // Initialise session asynchronously
    void (async () => {
      try {
        // Detect companion mode from query string (?mode=companion)
        const url = new URL(req.url ?? '', 'http://x');
        const isCompanion = url.searchParams.get('mode') === 'companion';

        let conversationId: string | null;
        let history: Message[] = [];

        if (isCompanion) {
          const config = getConfig();
          const db = await withTimeout(getDb(), 8000, 'getDb (companion)');
          conversationId = await withTimeout(
            db.getOrCreateCompanionConversation(config.NOVA_USER_ID),
            8000,
            'getOrCreateCompanionConversation'
          );
          // Replay ALL user/assistant messages so the companion truly retains
          // every previous conversation (no slice cap — companion is the
          // user's persistent relationship with NOVA).
          const msgs = await withTimeout(
            db.getConversationMessages(conversationId),
            8000,
            'getConversationMessages (companion)'
          );
          history = msgs
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
        } else {
          // Resume a specific conversation if the client passed one. Each entry
          // in the recents list is a full conversation that persists across
          // page reloads — only "New chat" creates a fresh row.
          const requestedId = url.searchParams.get('conversation');
          if (requestedId) {
            try {
              const db = await withTimeout(getDb(), 8000, 'getDb (resume)');
              const msgs = await withTimeout(
                db.getConversationMessages(requestedId),
                8000,
                'getConversationMessages (resume)'
              );
              conversationId = requestedId;
              history = msgs
                .filter(m => m.role === 'user' || m.role === 'assistant')
                .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
            } catch {
              // Conversation not found / can't load → start fresh on first message
              conversationId = null;
            }
          } else {
            // Lazy creation: don't insert a row in the DB until the user
            // actually sends a message.
            conversationId = null;
          }
        }

        const systemPrompt = await withTimeout(buildBaseSystemPrompt(), 8000, 'buildBaseSystemPrompt');
        const session: ChatSession = {
          conversationId, history, systemPrompt, isCompanion,
          pendingApprovals: new Map(),
        };
        session.requestApproval = (tool, args, description) =>
          requestToolApproval(ws, session, tool, args, description);
        sessions.set(ws, session);
        ws.send(JSON.stringify({
          type: 'ready',
          companion: isCompanion,
          historyLen: history.length,
          conversationId, // tell client which conversation it's actually attached to
        }));
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: (err as Error).message }));
      }
    })();

    ws.on('message', (raw) => {
      void (async () => {
        const session = sessions.get(ws);
        if (!session) return;

        let text = '';
        let adaptive = false;
        try {
          const msg = JSON.parse(raw.toString()) as {
            type: string;
            text?: string;
            model?: string;
            adaptive?: boolean;
            request_id?: string;
            allow?: boolean;
          };
          if (msg.type === 'set_model' && msg.model) {
            session.model = msg.model;
            ws.send(JSON.stringify({ type: 'model_set', model: msg.model }));
            return;
          }
          if (msg.type === 'approval_response') {
            const id = msg.request_id ?? '';
            const pending = session.pendingApprovals?.get(id);
            if (pending) {
              clearTimeout(pending.timer);
              session.pendingApprovals!.delete(id);
              pending.resolve(!!msg.allow);
            }
            return;
          }
          if (msg.type !== 'message' || !msg.text?.trim()) return;
          text = msg.text.trim();
          adaptive = msg.adaptive === true;
        } catch {
          return;
        }

        // Echo user message back so the UI can render it
        ws.send(JSON.stringify({ type: 'user', text }));
        ws.send(JSON.stringify({ type: 'thinking' }));

        try {
          // Lazy creation — only insert the conversation row now that the
          // user is sending a real message (avoids empty "Untitled" rows).
          if (!session.conversationId) {
            session.conversationId = await startConversation();
          }
          await appendMessage(session.conversationId, { role: 'user', content: text });
          const { text: reply, newMessages, modelUsed, modelReason } = await runWebTurn(
            session.systemPrompt, session.history, text,
            { model: session.model, adaptive, requestApproval: session.requestApproval }
          );
          if (modelUsed) {
            ws.send(JSON.stringify({ type: 'model_used', model: modelUsed, reason: modelReason }));
          }

          for (const m of newMessages) session.history.push(m);
          await appendMessage(session.conversationId, { role: 'assistant', content: reply });

          ws.send(JSON.stringify({ type: 'response', text: reply }));

          // Send approximate context usage (chars ÷ 4 ≈ tokens)
          const totalChars = session.history.reduce((s, m) => s + (m.content?.length ?? 0), 0);
          const approxTokens = Math.round(totalChars / 4);
          ws.send(JSON.stringify({ type: 'context_update', tokens: approxTokens, limit: 128000 }));

        } catch (err) {
          const raw = (err as Error).message ?? '';
          let friendly = raw;
          const cfg = getConfig();
          if (raw.includes('429')) {
            // Extract upstream reason if present
            const metaMatch = raw.match(/"raw"\s*:\s*"([^"]+)"/);
            const reason = metaMatch ? metaMatch[1] : 'This model is temporarily rate-limited.';
            friendly = `Rate limited (429): ${reason}\n\nTip: Switch to a different free model using the model picker below, e.g. deepseek/deepseek-chat-v3-0324:free or meta-llama/llama-3.3-70b-instruct:free`;
          } else if (raw.includes('404')) {
            if (cfg.MODEL_PROVIDER === 'openrouter') {
              friendly = `Model not found on OpenRouter: "${session.model ?? cfg.DEFAULT_MODEL}". Select a different model in Settings or the model picker.`;
            } else {
              friendly = `Model not found in Ollama (404). Run: ollama pull ${cfg.DEFAULT_MODEL}\n\nThen restart the server.`;
            }
          } else if (raw.includes('401') || raw.includes('403')) {
            if (cfg.MODEL_PROVIDER === 'anthropic') {
              friendly = `Invalid Anthropic API key. Check ANTHROPIC_API_KEY in Settings.`;
            } else if (cfg.MODEL_PROVIDER === 'openrouter') {
              friendly = `Invalid OpenRouter API key. Check OPENROUTER_API_KEY in Settings.`;
            } else if (cfg.MODEL_PROVIDER === 'groq') {
              friendly = `Invalid Groq API key. Check GROQ_API_KEY in Settings.`;
            }
          } else if (raw.includes('ECONNREFUSED') || raw.includes('fetch failed')) {
            if (cfg.MODEL_PROVIDER === 'anthropic') {
              friendly = `Cannot reach Anthropic. Check your internet connection or API key in Settings.`;
            } else if (cfg.MODEL_PROVIDER === 'openrouter') {
              friendly = `Cannot reach OpenRouter. Check your internet connection or API key in Settings.`;
            } else {
              friendly = `Cannot reach Ollama at ${cfg.OLLAMA_HOST}. Make sure Ollama is running.`;
            }
          }
          ws.send(JSON.stringify({ type: 'error', message: friendly }));
        }
      })();
    });

    ws.on('close', () => {
      const session = sessions.get(ws);
      sessions.delete(ws);
      if (!session) return;

      // Resolve any in-flight approval prompts as deny so the agent loop
      // wakes up rather than hanging on a dead socket.
      if (session.pendingApprovals) {
        for (const { resolve, timer } of session.pendingApprovals.values()) {
          clearTimeout(timer);
          resolve(false);
        }
        session.pendingApprovals.clear();
      }

      // Companion sessions never "end" — they're the user's persistent
      // relationship with NOVA. We keep the raw history and skip both
      // memory extraction (the conversation IS the memory) and endConversation.
      if (session.isCompanion) return;

      // Lazy-creation guard: if no conversationId was ever assigned, the user
      // never sent a message. Nothing to extract, end, or synthesize.
      const convId = session.conversationId;
      if (!convId) return;

      void (async () => {
        try {
          const cfg = getConfig();
          if (cfg.MEMORY_GENERATE === 'on') {
            const transcript = buildHistoryTranscript(session.history);
            if (transcript.trim()) {
              const candidates = await extractMemories(transcript);
              if (candidates.length > 0) {
                await reconcileMemories(candidates, convId);
              }
            }
          }
          // NOTE: We intentionally do NOT call endConversation() here.
          // Conversations should stay resumable across page reloads — the user
          // expects each entry in Recents to be a coherent multi-turn chat,
          // not get fragmented every time the browser disconnects.
          // Memory extraction above still captures any new content.

          // If this conversation is linked to a project, fire-and-forget
          // a project-memory synthesis so the right rail stays fresh.
          try {
            const db = await getDb();
            const projectId = await db.getConversationProjectId(convId);
            if (projectId) {
              const { synthesizeProjectMemory } = await import('../memory/project-synthesis.js');
              void synthesizeProjectMemory(projectId, 'chat-end');
            }
          } catch {
            // best-effort
          }
        } catch {
          // best-effort
        }
      })();
    });
  });

  server.listen(port, () => {
    console.log(`[web] http://localhost:${port}`);
  });

  // Load and schedule existing routines on server start
  void (async () => {
    try {
      const config = getConfig();
      await loadAllRoutines(config.NOVA_USER_ID);
    } catch (err) {
      console.error('[routines] Failed to load:', (err as Error).message);
    }
  })();

  // Nightly project memory synthesis at 3 AM
  cron.schedule('0 3 * * *', async () => {
    try {
      console.log('[cron] Running nightly project memory synthesis');
      const config = getConfig();
      const db = await getDb();
      const projects = await db.listProjectsForCron(config.NOVA_USER_ID, 24);
      const { synthesizeProjectMemory } = await import('../memory/project-synthesis.js');
      for (const p of projects) {
        console.log(`[cron] Synthesizing project ${p.name}`);
        await synthesizeProjectMemory(p.id, 'nightly-cron');
      }
      console.log(`[cron] Done — ${projects.length} projects synthesized`);
    } catch (err) {
      console.error('[cron] Failed:', (err as Error).message);
    }
  });

  _server = server;
}

export function stopWebServer(): void {
  _server?.close();
  _server = null;
}
