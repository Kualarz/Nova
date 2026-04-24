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
import { getDb } from '../db/client.js';
import { listRecentTasks } from '../tasks/store.js';
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
      res.json({
        ...stats,
        uptime: Date.now() - startTime,
        provider: config.MODEL_PROVIDER,
        model: config.DEFAULT_MODEL,
        database: config.DATABASE_TYPE,
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
      const tasks = await listRecentTasks(20);
      res.json(tasks);
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
      const filePath = (req.params as unknown as Record<string, string>).path ?? '';
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
      const filePath = (req.params as unknown as Record<string, string>).path ?? '';
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
        resetConfig();
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
          const msg = JSON.parse(raw.toString()) as { type: string; text?: string };
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
          const { text: reply, newMessages } = await runWebTurn(session.systemPrompt, session.history, text);

          for (const m of newMessages) session.history.push(m);
          await appendMessage(session.conversationId, { role: 'assistant', content: reply });

          ws.send(JSON.stringify({ type: 'response', text: reply }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: (err as Error).message }));
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
