/**
 * Minimal HTTP dashboard — read-only status page on port 3000.
 *
 * Shows: uptime, last heartbeat, recent memories, recent tasks.
 * No auth (run behind a firewall or Fly.io private network).
 */

import * as http from 'http';
import { getConfig } from '../lib/config.js';
import { getDb } from '../db/client.js';
import { listRecentTasks } from '../tasks/store.js';

const startTime = Date.now();

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m ${s % 60}s`;
}

async function buildDashboardHtml(): Promise<string> {
  const config = getConfig();
  const uptime = formatUptime(Date.now() - startTime);

  let memoryRows = '';
  let taskRows = '';
  let stats = { sessionCount: 0, lastSession: null as string | null, daysActive: 0, memoryCount: 0 };

  try {
    const db = await getDb();
    stats = await db.getSessionStats(config.NOVA_USER_ID);

    const tasks = await listRecentTasks(5);
    taskRows = tasks.map(t => {
      const statusColor = t.status === 'done' ? '#22c55e' : t.status === 'error' ? '#ef4444' : '#f59e0b';
      return `<tr>
        <td style="color:${statusColor}">${t.status}</td>
        <td>${t.description.slice(0, 60)}${t.description.length > 60 ? '…' : ''}</td>
        <td style="color:#6b7280">${t.created_at.slice(0, 16)}</td>
      </tr>`;
    }).join('');
  } catch {
    // Best-effort — show what we can
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>NOVA status</title>
  <meta http-equiv="refresh" content="60">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0a0a0a; color: #e5e5e5; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 14px; padding: 32px; }
    h1 { color: #fff; font-size: 18px; margin-bottom: 24px; letter-spacing: 0.05em; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .card { background: #111; border: 1px solid #222; padding: 16px; }
    .card-label { color: #6b7280; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 6px; }
    .card-value { color: #fff; font-size: 22px; }
    .card-sub { color: #6b7280; font-size: 11px; margin-top: 4px; }
    h2 { color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 32px; }
    td { padding: 8px 12px; border-bottom: 1px solid #1a1a1a; vertical-align: top; }
    tr:hover td { background: #111; }
    .dot { display: inline-block; width: 8px; height: 8px; background: #22c55e; border-radius: 50%; margin-right: 8px; animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    footer { color: #374151; font-size: 11px; margin-top: 24px; }
  </style>
</head>
<body>
  <h1><span class="dot"></span>NOVA</h1>
  <div class="grid">
    <div class="card">
      <div class="card-label">Uptime</div>
      <div class="card-value">${uptime}</div>
    </div>
    <div class="card">
      <div class="card-label">Sessions</div>
      <div class="card-value">${stats.sessionCount}</div>
      <div class="card-sub">${stats.daysActive} days active</div>
    </div>
    <div class="card">
      <div class="card-label">Memories (Tier 3)</div>
      <div class="card-value">${stats.memoryCount}</div>
    </div>
    <div class="card">
      <div class="card-label">Last session</div>
      <div class="card-value" style="font-size:14px">${stats.lastSession ? stats.lastSession.slice(0, 16).replace('T', ' ') : '—'}</div>
    </div>
  </div>

  <h2>Recent tasks</h2>
  ${taskRows
    ? `<table>${taskRows}</table>`
    : '<p style="color:#374151;margin-bottom:32px">No tasks yet.</p>'
  }

  <footer>Auto-refreshes every 60s · NOVA Phase 3</footer>
</body>
</html>`;
}

let _server: http.Server | null = null;

export function startDashboard(port = 3000): void {
  _server = http.createServer(async (req, res) => {
    if (req.url !== '/' && req.url !== '') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    try {
      const html = await buildDashboardHtml();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      res.writeHead(500);
      res.end('Error: ' + (err as Error).message);
    }
  });

  _server.listen(port, () => {
    console.log(`[dashboard] http://localhost:${port}`);
  });
}

export function stopDashboard(): void {
  _server?.close();
  _server = null;
}
