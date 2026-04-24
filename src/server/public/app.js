/* ── NOVA Web UI ─────────────────────────────────────────────────────────────── */
'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let ws         = null;
let wsReady    = false;
let currentFile = null;
let fileOriginal = '';
let allMemories  = [];
let currentPanel = 'chat';

// ── Panel navigation ──────────────────────────────────────────────────────────
function switchPanel(name) {
  currentPanel = name;
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const panel = document.getElementById('panel-' + name);
  const nav   = document.querySelector(`.nav-item[data-panel="${name}"]`);
  if (panel) panel.classList.add('active');
  if (nav)   nav.classList.add('active');

  // Lazy-load data when panel becomes visible
  if (name === 'status')    loadStatus();
  if (name === 'memory')    loadMemories();
  if (name === 'tasks')     loadTasks();
  if (name === 'workspace') loadWorkspaceTree();
  if (name === 'settings')  loadSettings();
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => switchPanel(item.dataset.panel));
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-AU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0)  return `${d}d ${h % 24}h`;
  if (h > 0)  return `${h}h ${m % 60}m`;
  return `${m}m ${s % 60}s`;
}
function fmtAge(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
async function apiFetch(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const j = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(j.error || res.statusText);
  }
  return res.json();
}

// ── STATUS PANEL ──────────────────────────────────────────────────────────────
async function loadStatus() {
  try {
    const s = await apiFetch('/api/status');
    document.getElementById('stat-uptime').textContent   = fmtUptime(s.uptime);
    document.getElementById('stat-sessions').textContent = s.sessionCount;
    document.getElementById('stat-days').textContent     = s.daysActive + ' days';
    document.getElementById('stat-memories').textContent = s.memoryCount;
    document.getElementById('stat-last').textContent     = s.lastSession ? fmtDate(s.lastSession) : '—';
    document.getElementById('stat-provider').textContent = `${s.provider} / ${s.model}`;
    document.getElementById('stat-db').textContent       = s.database;
  } catch (e) {
    console.error('status load failed', e);
  }
}

// ── CHAT PANEL ────────────────────────────────────────────────────────────────
function appendChatMsg(role, text) {
  const box  = document.getElementById('chat-messages');
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role;

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.textContent = text;

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.textContent = fmtTime(new Date().toISOString());

  wrap.appendChild(bubble);
  wrap.appendChild(meta);
  box.appendChild(wrap);
  box.scrollTop = box.scrollHeight;
  return wrap;
}

let thinkingEl = null;
function showThinking(show) {
  const box = document.getElementById('chat-messages');
  if (show && !thinkingEl) {
    thinkingEl = document.createElement('div');
    thinkingEl.className = 'msg nova';
    thinkingEl.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div>';
    box.appendChild(thinkingEl);
    box.scrollTop = box.scrollHeight;
  } else if (!show && thinkingEl) {
    thinkingEl.remove();
    thinkingEl = null;
  }
}

function setChatStatus(msg, cls) {
  const el = document.getElementById('chat-status');
  el.textContent = msg;
  el.className   = cls || '';
}

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);
  setChatStatus('connecting…');

  ws.onopen = () => setChatStatus('connecting…');

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'ready') {
      wsReady = true;
      setChatStatus('connected', 'connected');
      document.getElementById('send-btn').disabled = false;
    } else if (msg.type === 'thinking') {
      showThinking(true);
    } else if (msg.type === 'response') {
      showThinking(false);
      appendChatMsg('nova', msg.text);
    } else if (msg.type === 'error') {
      showThinking(false);
      appendChatMsg('error', 'Error: ' + msg.message);
    }
    // 'user' echoes are handled locally for instant feedback — ignore server echo
  };

  ws.onclose = () => {
    wsReady = false;
    setChatStatus('disconnected — reconnecting…', 'error');
    document.getElementById('send-btn').disabled = true;
    setTimeout(connectWS, 3000);
  };

  ws.onerror = () => {
    setChatStatus('connection error', 'error');
  };
}

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text || !wsReady) return;

  appendChatMsg('user', text);
  ws.send(JSON.stringify({ type: 'message', text }));
  input.value = '';
  input.style.height = 'auto';
}

document.getElementById('send-btn').addEventListener('click', sendChatMessage);

document.getElementById('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});

// Auto-resize textarea
document.getElementById('chat-input').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 140) + 'px';
});

document.getElementById('clear-chat-btn').addEventListener('click', () => {
  document.getElementById('chat-messages').innerHTML = '';
  // Reconnect to start fresh conversation
  if (ws) ws.close();
});

// ── WORKSPACE PANEL ───────────────────────────────────────────────────────────
async function loadWorkspaceTree() {
  try {
    const files = await apiFetch('/api/workspace');
    renderWorkspaceTree(files);
  } catch (e) {
    console.error('workspace load failed', e);
  }
}

function renderWorkspaceTree(files) {
  const tree = document.getElementById('file-tree');
  tree.innerHTML = '';

  const groups = {
    'Root': files.filter(f => !f.includes('/')),
    'Skills': files.filter(f => f.startsWith('skills/')),
    'Daily Notes': files.filter(f => f.startsWith('memory/')),
  };

  for (const [label, group] of Object.entries(groups)) {
    if (!group.length) continue;
    const section = document.createElement('div');
    section.className = 'file-tree-section';
    section.innerHTML = `<div class="file-tree-label">${label}</div>`;
    for (const f of group) {
      const item = document.createElement('div');
      item.className = 'file-item';
      if (f === currentFile) item.classList.add('active');
      item.textContent = f.split('/').pop();
      item.title = f;
      item.addEventListener('click', () => openFile(f));
      section.appendChild(item);
    }
    tree.appendChild(section);
  }
}

async function openFile(filePath) {
  // Warn about unsaved changes
  if (currentFile && fileModified()) {
    if (!confirm('You have unsaved changes. Discard them?')) return;
  }
  try {
    const data = await apiFetch('/api/workspace/' + filePath);
    currentFile    = filePath;
    fileOriginal   = data.content;

    document.getElementById('editor-filename').textContent = filePath;
    document.getElementById('editor-filename').className   = 'editor-filename';
    document.getElementById('file-content').value = data.content;
    document.getElementById('editor-placeholder').style.display = 'none';
    document.getElementById('editor-main').style.display = 'flex';
    setEditorStatus('');

    // Update tree selection
    document.querySelectorAll('.file-item').forEach(el => {
      el.classList.toggle('active', el.title === filePath);
    });
  } catch (e) {
    setEditorStatus('Failed to load: ' + e.message, 'error');
  }
}

function fileModified() {
  return document.getElementById('file-content').value !== fileOriginal;
}

document.getElementById('file-content').addEventListener('input', () => {
  const el = document.getElementById('editor-filename');
  if (fileModified()) el.classList.add('modified');
  else el.classList.remove('modified');
});

function setEditorStatus(msg, cls) {
  const el = document.getElementById('editor-status');
  el.textContent = msg;
  el.className   = 'editor-status' + (cls ? ' ' + cls : '');
}

document.getElementById('save-btn').addEventListener('click', async () => {
  if (!currentFile) return;
  try {
    setEditorStatus('Saving…');
    await apiFetch('/api/workspace/' + currentFile, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: document.getElementById('file-content').value }),
    });
    fileOriginal = document.getElementById('file-content').value;
    document.getElementById('editor-filename').classList.remove('modified');
    setEditorStatus('Saved  (backup: ' + currentFile + '.bak)', 'ok');
  } catch (e) {
    setEditorStatus('Save failed: ' + e.message, 'error');
  }
});

document.getElementById('discard-btn').addEventListener('click', () => {
  if (!currentFile) return;
  document.getElementById('file-content').value = fileOriginal;
  document.getElementById('editor-filename').classList.remove('modified');
  setEditorStatus('Changes discarded');
});

document.getElementById('new-skill-btn').addEventListener('click', async () => {
  const name = prompt('Skill filename (without .md):');
  if (!name || !name.trim()) return;
  const filename = name.trim().replace(/[^a-z0-9-_]/gi, '-').toLowerCase() + '.md';
  const template = `---\nname: ${name.trim()}\ndescription: Describe when NOVA should use this skill.\n---\n\n# ${name.trim()}\n\nWrite skill instructions here.\n`;
  try {
    await apiFetch('/api/workspace/skills/' + filename, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: template }),
    });
    await loadWorkspaceTree();
    await openFile('skills/' + filename);
  } catch (e) {
    alert('Failed to create skill: ' + e.message);
  }
});

// ── MEMORY PANEL ──────────────────────────────────────────────────────────────
async function loadMemories() {
  try {
    allMemories = await apiFetch('/api/memories');
    renderMemories(allMemories);
  } catch (e) {
    console.error('memories load failed', e);
  }
}

function renderMemories(memories) {
  const list = document.getElementById('memory-list');
  if (!memories.length) {
    list.innerHTML = '<div class="empty-state">No memories yet — chat with NOVA to build them up.</div>';
    return;
  }
  list.innerHTML = memories.map(m => `
    <div class="memory-card">
      <div class="memory-card-meta">
        <span class="mem-badge ${m.category}">${m.category}</span>
        <span class="mem-date">${fmtDate(m.created_at)}</span>
        <span class="mem-conf">${Math.round((m.confidence ?? 1) * 100)}% conf · ${m.access_count ?? 0} accesses</span>
      </div>
      <div class="memory-card-content">${escapeHtml(m.content)}</div>
    </div>
  `).join('');
}

document.getElementById('memory-search').addEventListener('input', function() {
  const q = this.value.toLowerCase();
  if (!q) { renderMemories(allMemories); return; }
  renderMemories(allMemories.filter(m =>
    m.content.toLowerCase().includes(q) || m.category.toLowerCase().includes(q)
  ));
});

document.getElementById('refresh-memories-btn').addEventListener('click', loadMemories);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ── TASKS PANEL ───────────────────────────────────────────────────────────────
async function loadTasks() {
  try {
    const tasks = await apiFetch('/api/tasks');
    const list  = document.getElementById('tasks-list');
    if (!tasks.length) {
      list.innerHTML = '<div class="empty-state">No tasks yet — use /spawn in NOVA to queue Claude Code tasks.</div>';
      return;
    }
    list.innerHTML = tasks.map(t => `
      <div class="task-card">
        <div class="task-card-header">
          <span class="task-status-dot ${t.status}"></span>
          <span class="task-desc">${escapeHtml(t.description)}</span>
          <span class="task-dates">${fmtAge(t.created_at)}</span>
        </div>
        ${t.result ? `<div class="task-result">${escapeHtml(t.result.slice(0, 300))}${t.result.length > 300 ? '…' : ''}</div>` : ''}
        ${t.error  ? `<div class="task-error">${escapeHtml(t.error)}</div>` : ''}
      </div>
    `).join('');
  } catch (e) {
    console.error('tasks load failed', e);
  }
}

document.getElementById('refresh-tasks-btn').addEventListener('click', loadTasks);

// ── SETTINGS PANEL ────────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const cfg = await apiFetch('/api/settings');
    // Populate form fields
    setField('MODEL_PROVIDER',           cfg.MODEL_PROVIDER);
    setField('DEFAULT_MODEL',            cfg.DEFAULT_MODEL);
    setField('COMPLEX_MODEL',            cfg.COMPLEX_MODEL);
    setField('EMBED_MODEL',              cfg.EMBED_MODEL);
    setField('OLLAMA_HOST',              cfg.OLLAMA_HOST);
    setField('OPENROUTER_API_KEY',       cfg.OPENROUTER_API_KEY);
    setField('DATABASE_TYPE',            cfg.DATABASE_TYPE);
    setField('PGLITE_PATH',              cfg.PGLITE_PATH);
    setField('SUPABASE_URL',             cfg.SUPABASE_URL);
    setField('SUPABASE_SERVICE_ROLE_KEY', cfg.SUPABASE_SERVICE_ROLE_KEY);
    setField('NOVA_WORKSPACE_PATH',      cfg.NOVA_WORKSPACE_PATH);
    setField('GOOGLE_CREDENTIALS_PATH',  cfg.GOOGLE_CREDENTIALS_PATH);
    setField('NOTION_API_KEY',           cfg.NOTION_API_KEY);
    setField('WEB_SEARCH_API_KEY',       cfg.WEB_SEARCH_API_KEY);
    setField('OPENWEATHER_API_KEY',      cfg.OPENWEATHER_API_KEY);
    setField('TELEGRAM_BOT_TOKEN',       cfg.TELEGRAM_BOT_TOKEN);
    setField('TELEGRAM_CHAT_ID',         cfg.TELEGRAM_CHAT_ID);
    setField('NOVA_WORKFLOWS',           cfg.NOVA_WORKFLOWS);
  } catch (e) {
    setSettingsStatus('Failed to load: ' + e.message, 'error');
  }
}

function setField(id, value) {
  const el = document.getElementById('cfg-' + id);
  if (!el) return;
  if (el.tagName === 'SELECT') {
    el.value = value || '';
  } else {
    el.value = value || '';
  }
}

function setSettingsStatus(msg, cls) {
  const el = document.getElementById('settings-status');
  el.textContent = msg;
  el.className   = cls || '';
}

document.getElementById('settings-save-btn').addEventListener('click', async () => {
  const fields = [
    'MODEL_PROVIDER','DEFAULT_MODEL','COMPLEX_MODEL','EMBED_MODEL','OLLAMA_HOST',
    'OPENROUTER_API_KEY','DATABASE_TYPE','PGLITE_PATH','SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY','NOVA_WORKSPACE_PATH','GOOGLE_CREDENTIALS_PATH',
    'NOTION_API_KEY','WEB_SEARCH_API_KEY','OPENWEATHER_API_KEY',
    'TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','NOVA_WORKFLOWS',
  ];
  const body = {};
  for (const f of fields) {
    const el = document.getElementById('cfg-' + f);
    if (el) body[f] = el.value;
  }
  try {
    setSettingsStatus('Saving…');
    const res = await apiFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const updated = res.updated || [];
    setSettingsStatus(
      updated.length
        ? `Saved ${updated.length} setting(s): ${updated.join(', ')}`
        : 'No changes detected',
      'ok'
    );
  } catch (e) {
    setSettingsStatus('Save failed: ' + e.message, 'error');
  }
});

// Toggle show/hide for password fields
document.querySelectorAll('.toggle-secret').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.for);
    if (!input) return;
    if (input.type === 'password') { input.type = 'text'; btn.textContent = 'hide'; }
    else                           { input.type = 'password'; btn.textContent = 'show'; }
  });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
connectWS();
switchPanel('chat');
loadStatus(); // pre-load so status tab is instant
