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
import { getConfig, resetConfig } from '../lib/config.js';
import { resetModelRouter } from '../providers/router.js';
import { getDb } from '../db/client.js';
import { listRecentTasks, createTask, deleteTask } from '../tasks/store.js';
import { runWebTurn } from '../agent/nova.js';
import { buildBaseSystemPrompt } from '../agent/system-prompt.js';
import { startConversation, appendMessage, endConversation } from '../conversations/store.js';
import { extractMemories } from '../memory/extract.js';
import { reconcileMemories } from '../memory/reconcile.js';
import type { Message } from '../providers/interface.js';

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
  'TELEGRAM_BOT_TOKEN',
  'NOTION_API_KEY',
  'WEB_SEARCH_API_KEY',
  'OPENWEATHER_API_KEY',
]);

// Keys the settings form is allowed to overwrite
const WRITABLE_KEYS = new Set([
  'MODEL_PROVIDER', 'DEFAULT_MODEL', 'COMPLEX_MODEL', 'EMBED_MODEL',
  'OLLAMA_HOST', 'OPENROUTER_API_KEY',
  'DATABASE_TYPE', 'PGLITE_PATH',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'NOVA_WORKSPACE_PATH',
  'GOOGLE_CREDENTIALS_PATH', 'NOTION_API_KEY',
  'WEB_SEARCH_API_KEY', 'OPENWEATHER_API_KEY',
  'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
  'NOVA_WORKFLOWS',
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
  conversationId: string;
  history: Message[];
  systemPrompt: string;
  model?: string; // user-selected model override for this session
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
      const provider = (qp === 'openrouter' || qp === 'ollama') ? qp : config.MODEL_PROVIDER;

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
      }
      res.json({ ok: true, updated: Object.keys(updates) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
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

  wss.on('connection', (ws) => {
    // Initialise session asynchronously
    void (async () => {
      try {
        const conversationId = await startConversation();
        const systemPrompt   = await buildBaseSystemPrompt();
        sessions.set(ws, { conversationId, history: [], systemPrompt });
        ws.send(JSON.stringify({ type: 'ready' }));
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: (err as Error).message }));
      }
    })();

    ws.on('message', (raw) => {
      void (async () => {
        const session = sessions.get(ws);
        if (!session) return;

        let text = '';
        try {
          const msg = JSON.parse(raw.toString()) as { type: string; text?: string; model?: string };
          if (msg.type === 'set_model' && msg.model) {
            session.model = msg.model;
            ws.send(JSON.stringify({ type: 'model_set', model: msg.model }));
            return;
          }
          if (msg.type !== 'message' || !msg.text?.trim()) return;
          text = msg.text.trim();
        } catch {
          return;
        }

        // Echo user message back so the UI can render it
        ws.send(JSON.stringify({ type: 'user', text }));
        ws.send(JSON.stringify({ type: 'thinking' }));

        try {
          await appendMessage(session.conversationId, { role: 'user', content: text });
          const { text: reply, newMessages } = await runWebTurn(session.systemPrompt, session.history, text, { model: session.model });

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
          } else if (raw.includes('ECONNREFUSED') || raw.includes('fetch failed')) {
            if (cfg.MODEL_PROVIDER === 'openrouter') {
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

      void (async () => {
        try {
          const transcript = buildHistoryTranscript(session.history);
          if (transcript.trim()) {
            const candidates = await extractMemories(transcript);
            if (candidates.length > 0) {
              await reconcileMemories(candidates, session.conversationId);
            }
          }
          await endConversation(session.conversationId);
        } catch {
          // best-effort
        }
      })();
    });
  });

  server.listen(port, () => {
    console.log(`[web] http://localhost:${port}`);
  });

  _server = server;
}

export function stopWebServer(): void {
  _server?.close();
  _server = null;
}
