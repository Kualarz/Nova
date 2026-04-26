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
  item.addEventListener('click', () => {
    if (item.dataset.panel === 'chat') {
      // "New chat" — clear messages and reconnect
      document.getElementById('chat-messages').innerHTML = '';
      _hasMessages = false;
      setWelcome(true);
      if (typeof clearAttachments === 'function') clearAttachments();
      if (ws) ws.close();
    }
    switchPanel(item.dataset.panel);
  });
});

// ── Sidebar collapse ──────────────────────────────────────────────────────────
document.getElementById('sidebar-toggle-btn').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
});

// ── User menu popup ───────────────────────────────────────────────────────────
const userMenu    = document.getElementById('user-menu');
const userBtn     = document.getElementById('sidebar-user-btn');
let userMenuOpen  = false;

function openUserMenu() {
  const rect = userBtn.getBoundingClientRect();
  userMenu.style.left   = rect.left + 'px';
  userMenu.style.width  = rect.width + 'px';
  userMenu.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
  userMenu.classList.remove('hidden');
  userBtn.classList.add('open');
  userMenuOpen = true;
}

function closeUserMenu() {
  userMenu.classList.add('hidden');
  userBtn.classList.remove('open');
  userMenuOpen = false;
}

userBtn.addEventListener('click', e => {
  e.stopPropagation();
  userMenuOpen ? closeUserMenu() : openUserMenu();
});

document.addEventListener('click', () => closeUserMenu());
userMenu.addEventListener('click', e => e.stopPropagation());

// Settings
document.getElementById('um-settings').addEventListener('click', () => {
  closeUserMenu();
  switchPanel('settings');
});

// About NOVA
document.getElementById('um-about').addEventListener('click', () => {
  closeUserMenu();
  switchPanel('status');
});

// Get help — open a chat message pre-filled
document.getElementById('um-help').addEventListener('click', () => {
  closeUserMenu();
  switchPanel('chat');
  const input = document.getElementById('chat-input');
  input.value = 'Hey NOVA, what can you help me with?';
  input.focus();
});

// Quick nav
document.getElementById('um-stats').addEventListener('click', () => { closeUserMenu(); switchPanel('status'); });
document.getElementById('um-memory').addEventListener('click', () => { closeUserMenu(); switchPanel('memory'); });
document.getElementById('um-workspace').addEventListener('click', () => { closeUserMenu(); switchPanel('workspace'); });

// Reconnect AI — close WS so it auto-reconnects
document.getElementById('um-reconnect').addEventListener('click', () => {
  closeUserMenu();
  if (ws) { ws.close(); }
});

// Clear session
document.getElementById('um-clear').addEventListener('click', () => {
  closeUserMenu();
  document.getElementById('chat-messages').innerHTML = '';
  _hasMessages = false;
  setWelcome(true);
  clearAttachments();
  if (ws) ws.close();
  switchPanel('chat');
});

// Ctrl+, shortcut → Settings
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === ',') {
    e.preventDefault();
    switchPanel('settings');
  }
});

// ── Sidebar search ────────────────────────────────────────────────────────────
let searchVisible = false;
document.getElementById('sidebar-search-btn').addEventListener('click', e => {
  e.stopPropagation();
  searchVisible = !searchVisible;
  const wrap = document.getElementById('sb-search-wrap');
  wrap.classList.toggle('hidden', !searchVisible);
  if (searchVisible) document.getElementById('sb-search-input').focus();
});

document.getElementById('sb-search-input').addEventListener('input', function () {
  const q = this.value.toLowerCase();
  document.querySelectorAll('#recents-list .conv-item').forEach(el => {
    const title = el.querySelector('.conv-title')?.textContent?.toLowerCase() ?? '';
    el.style.display = title.includes(q) ? '' : 'none';
  });
  const label = document.getElementById('recents-label');
  if (label) label.style.display = q ? 'none' : '';
});

// ── Conversation management ──────────────────────────────────────────────────
const PIN_KEY    = 'nova:pinned-conversations';
const TITLE_KEY  = 'nova:custom-titles';

function getPinned()        { try { return JSON.parse(localStorage.getItem(PIN_KEY) || '[]'); } catch { return []; } }
function setPinned(ids)     { localStorage.setItem(PIN_KEY, JSON.stringify(ids)); }
function getCustomTitles()  { try { return JSON.parse(localStorage.getItem(TITLE_KEY) || '{}'); } catch { return {}; } }
function setCustomTitles(t) { localStorage.setItem(TITLE_KEY, JSON.stringify(t)); }

function isPinned(id) { return getPinned().includes(id); }
function togglePin(id) {
  const pins = getPinned();
  const idx = pins.indexOf(id);
  if (idx >= 0) pins.splice(idx, 1);
  else pins.unshift(id);
  setPinned(pins);
}
function setTitle(id, title) {
  const titles = getCustomTitles();
  if (title && title.trim()) titles[id] = title.trim();
  else delete titles[id];
  setCustomTitles(titles);
}
function getTitle(id, fallback) {
  return getCustomTitles()[id] || fallback;
}

let _allConversations = [];

async function loadConversations() {
  const recentsList = document.getElementById('recents-list');
  try {
    _allConversations = await apiFetch('/api/conversations');
    renderConversations();
  } catch {
    if (recentsList) recentsList.innerHTML = '<div class="conv-placeholder">—</div>';
  }
}

function renderConversations() {
  const pinnedList  = document.getElementById('pinned-list');
  const recentsList = document.getElementById('recents-list');
  if (!pinnedList || !recentsList) return;

  const pinnedIds = getPinned();
  const pinned    = [];
  const recents   = [];
  for (const c of _allConversations) {
    (pinnedIds.includes(c.id) ? pinned : recents).push(c);
  }

  // Sort pinned by the pinned array order (most recent pin first)
  pinned.sort((a, b) => pinnedIds.indexOf(a.id) - pinnedIds.indexOf(b.id));

  pinnedList.innerHTML  = pinned.map(c => convItemHtml(c, true)).join('') ||
    '<div class="conv-placeholder" style="font-size:11px">No pinned chats yet — use the ⋯ menu</div>';
  recentsList.innerHTML = recents.map(c => convItemHtml(c, false)).join('') ||
    '<div class="conv-placeholder">No recent chats</div>';

  // Wire up three-dot menus and click handlers
  document.querySelectorAll('#pinned-list .conv-item, #recents-list .conv-item').forEach(el => {
    const id = el.dataset.id;
    const moreBtn = el.querySelector('.conv-more-btn');
    if (moreBtn) {
      moreBtn.addEventListener('click', e => {
        e.stopPropagation();
        openConvMenu(el, id);
      });
    }
  });
}

function convItemHtml(c, isPinnedItem) {
  const fallbackTitle = c.first_message
    ? c.first_message.slice(0, 60).replace(/\n/g, ' ')
    : 'Untitled conversation';
  const title = getTitle(c.id, fallbackTitle);
  const pinIcon = isPinnedItem
    ? `<svg width="11" height="11" viewBox="0 0 12 12" fill="none" class="conv-pin-icon"><path d="M7.5 1.5L10.5 4.5L6 9L1.5 7.5L4.5 4.5L7.5 1.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M6 9L5 11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`
    : '';
  return `
    <div class="conv-item" data-id="${escapeHtml(c.id)}" title="${escapeHtml(title)}">
      ${pinIcon}
      <span class="conv-title">${escapeHtml(title)}</span>
      <button class="conv-more-btn" type="button" title="Options">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="3" cy="7" r="1.1" fill="currentColor"/><circle cx="7" cy="7" r="1.1" fill="currentColor"/><circle cx="11" cy="7" r="1.1" fill="currentColor"/></svg>
      </button>
    </div>
  `;
}

// ── Three-dot menu ────────────────────────────────────────────────────────────
let convMenuEl = null;

function closeConvMenu() {
  if (convMenuEl) { convMenuEl.remove(); convMenuEl = null; }
}

function openConvMenu(itemEl, id) {
  closeConvMenu();
  const rect = itemEl.getBoundingClientRect();
  const pinned = isPinned(id);

  const menu = document.createElement('div');
  menu.className = 'conv-menu';
  menu.innerHTML = `
    <button class="conv-menu-item" data-action="pin">
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M8 1.5L11 4.5L6.5 9L2 7.5L5 4.5L8 1.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M6.5 9L5 11.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      ${pinned ? 'Unpin' : 'Pin'}
    </button>
    <button class="conv-menu-item" data-action="rename">
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M8.5 2L11 4.5L4.5 11H2V8.5L8.5 2Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
      Rename
    </button>
    <button class="conv-menu-item danger" data-action="delete">
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2.5 3.5h8M4.5 3.5V2h4v1.5M5.5 6v4M7.5 6v4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><rect x="2" y="3.5" width="9" height="7" rx="1" stroke="currentColor" stroke-width="1.3"/></svg>
      Delete
    </button>
  `;

  menu.style.position = 'fixed';
  menu.style.left   = (rect.right + 4) + 'px';
  menu.style.top    = rect.top + 'px';
  document.body.appendChild(menu);
  convMenuEl = menu;

  menu.querySelector('[data-action="pin"]').addEventListener('click', () => {
    togglePin(id);
    closeConvMenu();
    renderConversations();
  });
  menu.querySelector('[data-action="rename"]').addEventListener('click', () => {
    const cur = getTitle(id, '');
    const next = prompt('Rename conversation:', cur);
    if (next !== null) {
      setTitle(id, next);
      closeConvMenu();
      renderConversations();
    } else closeConvMenu();
  });
  menu.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    closeConvMenu();
    if (!confirm('Delete this conversation? This cannot be undone.')) return;
    try {
      await apiFetch('/api/conversations/' + encodeURIComponent(id), { method: 'DELETE' });
      // Also remove from pin list if pinned
      const pins = getPinned().filter(p => p !== id);
      setPinned(pins);
      // Remove custom title
      const titles = getCustomTitles();
      delete titles[id];
      setCustomTitles(titles);
      // Reload
      await loadConversations();
    } catch (e) {
      alert('Delete failed: ' + e.message);
    }
  });
}

document.addEventListener('click', () => closeConvMenu());

// Initial load
loadConversations();

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
function escapeHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ── STATUS PANEL ──────────────────────────────────────────────────────────────
async function loadStatus() {
  try {
    const s = await apiFetch('/api/status');
    document.getElementById('stat-uptime').textContent        = fmtUptime(s.uptime);
    document.getElementById('stat-sessions').textContent      = s.sessionCount ?? '—';
    document.getElementById('stat-days').textContent          = (s.daysActive ?? '—') + ' days active';
    document.getElementById('stat-days2').textContent         = s.daysActive ?? '—';
    document.getElementById('stat-last').textContent          = s.lastSession ? fmtDate(s.lastSession) : 'never';
    document.getElementById('stat-memories').textContent      = s.memoryCount ?? '—';
    document.getElementById('stat-provider').textContent      = s.provider ?? '—';
    document.getElementById('stat-model').textContent         = s.model ?? '—';
    document.getElementById('stat-complex').textContent       = s.complexModel ?? '—';
    document.getElementById('stat-db').textContent            = s.database ?? '—';
    document.getElementById('stat-wsfiles').textContent       = s.workspaceFiles ?? '—';
    document.getElementById('stat-wspath').textContent        = s.workspacePath ?? '—';
    document.getElementById('stat-tasks-total').textContent   = s.tasks?.total ?? '—';
    document.getElementById('stat-tasks-running').textContent = s.tasks?.running ?? '0';
    document.getElementById('stat-tasks-done').textContent    = s.tasks?.done ?? '0';
    document.getElementById('stat-tasks-error').textContent   = s.tasks?.error ?? '0';
  } catch (e) {
    console.error('status load failed', e);
  }
}
document.getElementById('refresh-status-btn').addEventListener('click', loadStatus);

// ── CHAT — welcome state ──────────────────────────────────────────────────────
let _hasMessages = false;

function setWelcome(show) {
  const el = document.getElementById('chat-welcome');
  if (!el) return;
  if (show) el.classList.remove('hidden');
  else      el.classList.add('hidden');
}

// ── CHAT — message rendering ──────────────────────────────────────────────────
function appendChatMsg(role, text) {
  // Hide welcome on first message
  if (!_hasMessages) {
    _hasMessages = true;
    setWelcome(false);
  }

  const box  = document.getElementById('chat-messages');
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role;

  if (role === 'nova') {
    const sender = document.createElement('div');
    sender.className = 'msg-sender';
    sender.textContent = 'NOVA';
    wrap.appendChild(sender);
  }

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.textContent = text;
  wrap.appendChild(bubble);

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.textContent = fmtTime(new Date().toISOString());
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
    const sender = document.createElement('div');
    sender.className = 'msg-sender';
    sender.textContent = 'NOVA';
    thinkingEl.appendChild(sender);
    const dots = document.createElement('div');
    dots.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div>';
    thinkingEl.appendChild(dots);
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

// ── CHAT — WebSocket ──────────────────────────────────────────────────────────
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
      loadModels(); // populate model selector on connect
    } else if (msg.type === 'thinking') {
      showThinking(true);
    } else if (msg.type === 'response') {
      showThinking(false);
      appendChatMsg('nova', msg.text);
    } else if (msg.type === 'error') {
      showThinking(false);
      appendChatMsg('error', msg.message);
    } else if (msg.type === 'model_set') {
      updateModelLabel(msg.model);
    } else if (msg.type === 'context_update') {
      updateContextRing(msg.tokens, msg.limit);
    }
  };

  ws.onclose = () => {
    wsReady = false;
    setChatStatus('disconnected — reconnecting…', 'error');
    document.getElementById('send-btn').disabled = true;
    setTimeout(connectWS, 3000);
  };

  ws.onerror = () => setChatStatus('connection error', 'error');
}

// ── CHAT — send ───────────────────────────────────────────────────────────────
let pendingAttachments = []; // [{name, content}]

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  let text = input.value.trim();
  if (!wsReady) return;

  // Prepend any attachments as context blocks
  if (pendingAttachments.length > 0) {
    const ctx = pendingAttachments.map(a =>
      `[Attached: ${a.name}]\n\`\`\`\n${a.content.slice(0, 4000)}\n\`\`\``
    ).join('\n\n');
    text = ctx + (text ? '\n\n' + text : '');
    clearAttachments();
  }

  if (!text) return;

  appendChatMsg('user', input.value.trim() || '(attached file)');
  ws.send(JSON.stringify({ type: 'message', text }));
  input.value = '';
  input.style.height = 'auto';
}

document.getElementById('send-btn').addEventListener('click', sendChatMessage);

document.getElementById('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
});

document.getElementById('chat-input').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 200) + 'px';
});

document.getElementById('clear-chat-btn').addEventListener('click', () => {
  document.getElementById('chat-messages').innerHTML = '';
  _hasMessages = false;
  setWelcome(true);
  clearAttachments();
  if (ws) ws.close();
});

// New Chat button (sidebar) — same as clear
document.getElementById('new-chat-btn').addEventListener('click', () => {
  document.getElementById('chat-messages').innerHTML = '';
  _hasMessages = false;
  setWelcome(true);
  clearAttachments();
  if (ws) ws.close();
  switchPanel('chat');
});

// ── CHAT — attachment chips ───────────────────────────────────────────────────
function addAttachment(name, content) {
  pendingAttachments.push({ name, content });
  renderAttachments();
}

function clearAttachments() {
  pendingAttachments = [];
  renderAttachments();
}

function renderAttachments() {
  const el = document.getElementById('chat-attachments');
  el.innerHTML = pendingAttachments.map((a, i) => `
    <div class="attach-chip">
      <span>📄</span>
      <span class="attach-chip-name" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</span>
      <button class="attach-chip-remove" data-idx="${i}">×</button>
    </div>
  `).join('');
  el.querySelectorAll('.attach-chip-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingAttachments.splice(Number(btn.dataset.idx), 1);
      renderAttachments();
    });
  });
}

// ── CHAT — + menu (plus button) ───────────────────────────────────────────────
const plusWrap = document.getElementById('plus-wrap');
const plusMenu = document.getElementById('plus-menu');
let plusOpen = false;

function togglePlusMenu(e) {
  e.stopPropagation();
  plusOpen = !plusOpen;
  plusMenu.style.display = plusOpen ? 'block' : 'none';
  if (plusOpen) closeModelMenu();
}
function closePlusMenu() { plusOpen = false; plusMenu.style.display = 'none'; }

document.getElementById('plus-btn').addEventListener('click', togglePlusMenu);

// Attach file
document.getElementById('attach-file-btn').addEventListener('click', () => {
  closePlusMenu();
  document.getElementById('file-input').click();
});

document.getElementById('file-input').addEventListener('change', async function() {
  const file = this.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    addAttachment(file.name, text);
  } catch {
    addAttachment(file.name, '[binary file — cannot preview]');
  }
  this.value = '';
});

// Attach image
document.getElementById('attach-image-btn').addEventListener('click', () => {
  closePlusMenu();
  document.getElementById('image-input').click();
});

document.getElementById('image-input').addEventListener('change', async function() {
  const file = this.files[0];
  if (!file) return;
  addAttachment(file.name, `[Image: ${file.name} — ${(file.size/1024).toFixed(1)} KB]`);
  this.value = '';
});

// Browse workspace
document.getElementById('browse-workspace-btn').addEventListener('click', async () => {
  closePlusMenu();
  await openWsPicker();
});

// ── CHAT — workspace file picker ──────────────────────────────────────────────
async function openWsPicker() {
  const overlay = document.getElementById('ws-picker');
  const list    = document.getElementById('ws-picker-list');
  overlay.style.display = 'flex';
  list.innerHTML = '<div style="padding:12px;color:var(--dimmer)">Loading…</div>';

  try {
    const files = await apiFetch('/api/workspace');
    if (!files.length) {
      list.innerHTML = '<div style="padding:12px;color:var(--dimmer)">No files found in workspace.</div>';
      return;
    }
    list.innerHTML = files.map(f => {
      const icon = f.startsWith('skills/') ? '⚙️' : f.startsWith('memory/') ? '📓' : '📄';
      const name = f.split('/').pop();
      const dir  = f.includes('/') ? f.split('/')[0] : '';
      return `
        <div class="ws-picker-item" data-path="${escapeHtml(f)}">
          <span class="ws-picker-item-icon">${icon}</span>
          <span class="ws-picker-item-name">${escapeHtml(name)}</span>
          ${dir ? `<span class="ws-picker-item-path">${escapeHtml(dir)}</span>` : ''}
        </div>
      `;
    }).join('');

    list.querySelectorAll('.ws-picker-item').forEach(item => {
      item.addEventListener('click', async () => {
        const path = item.dataset.path;
        closeWsPicker();
        try {
          const data = await apiFetch('/api/workspace/' + path);
          addAttachment(path, data.content);
        } catch (e) {
          appendChatMsg('error', 'Failed to load file: ' + e.message);
        }
      });
    });
  } catch (e) {
    list.innerHTML = `<div style="padding:12px;color:var(--red)">${escapeHtml(e.message)}</div>`;
  }
}

function closeWsPicker() {
  document.getElementById('ws-picker').style.display = 'none';
}
document.getElementById('ws-picker-close').addEventListener('click', closeWsPicker);
document.getElementById('ws-picker').addEventListener('click', e => {
  if (e.target === document.getElementById('ws-picker')) closeWsPicker();
});

// ── CHAT — model selector ─────────────────────────────────────────────────────
let installedModels = [];
let activeModel = '';

const modelWrap = document.getElementById('model-wrap');
const modelMenu = document.getElementById('model-menu');
let modelMenuOpen = false;

function toggleModelMenu(e) {
  e.stopPropagation();
  modelMenuOpen = !modelMenuOpen;
  modelMenu.style.display = modelMenuOpen ? 'block' : 'none';
  if (modelMenuOpen) closePlusMenu();
}
function closeModelMenu() { modelMenuOpen = false; modelMenu.style.display = 'none'; }

document.getElementById('model-btn').addEventListener('click', toggleModelMenu);

// ── Context window ring ───────────────────────────────────────────────────────
const CIRCUMFERENCE = 62.83; // 2π × r=10
let contextOpen = false;

function closeContextPopover() {
  contextOpen = false;
  document.getElementById('context-popover').classList.add('hidden');
}

document.getElementById('context-btn').addEventListener('click', e => {
  e.stopPropagation();
  contextOpen = !contextOpen;
  document.getElementById('context-popover').classList.toggle('hidden', !contextOpen);
  if (contextOpen) { closePlusMenu(); closeModelMenu(); }
});

function updateContextRing(tokens, limit) {
  const pct  = Math.min(tokens / limit, 1);
  const offset = CIRCUMFERENCE * (1 - pct);
  const fill = document.getElementById('context-ring-fill');
  const bar  = document.getElementById('context-pop-bar');

  fill.style.strokeDashoffset = offset.toFixed(2);
  bar.style.width = (pct * 100).toFixed(1) + '%';

  const cls = pct >= 0.9 ? 'crit' : pct >= 0.7 ? 'warn' : '';
  fill.className = 'context-ring-fill' + (cls ? ' ' + cls : '');
  bar.className  = 'context-pop-bar'   + (cls ? ' ' + cls : '');

  const pctLabel = (pct * 100).toFixed(0) + '%';
  document.getElementById('context-pct').textContent = pctLabel;

  const kFmt = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n;
  document.getElementById('context-pop-val').textContent  = `${kFmt(tokens)} / ${kFmt(limit)}`;
  document.getElementById('context-pop-hint').textContent = `${pctLabel} of context used`;
}

// Close menus when clicking outside
document.addEventListener('click', () => { closePlusMenu(); closeModelMenu(); closeContextPopover(); });

let modelProvider = 'ollama';

async function loadModels() {
  try {
    const data = await apiFetch('/api/models');
    installedModels = data.models || [];
    activeModel = data.current || '';
    modelProvider = data.provider || 'ollama';
    updateModelLabel(activeModel);
    renderModelMenu();
  } catch {
    document.getElementById('model-btn-label').textContent = 'model';
  }
}

function fmtSize(bytes) {
  if (!bytes) return '';
  const gb = bytes / 1e9;
  return gb >= 1 ? gb.toFixed(1) + ' GB' : (bytes / 1e6).toFixed(0) + ' MB';
}

function shortModelName(id) {
  // openrouter: "meta-llama/llama-3.3-70b-instruct:free" → "llama-3.3-70b"
  // ollama: "gemma3:4b" → "gemma3:4b"
  if (id.includes('/')) {
    return id.split('/').pop().replace(/:free$/, '').replace(/-instruct$/, '');
  }
  return id.replace(/:latest$/, '');
}

function renderModelMenu() {
  if (!installedModels.length) {
    modelMenu.innerHTML = '<div class="popover-section-label">No models found</div>';
    return;
  }

  const label = modelProvider === 'openrouter' ? 'Free models · OpenRouter' : 'Installed models · Ollama';

  modelMenu.innerHTML = `
    <div class="popover-section-label">${label}</div>
    ${installedModels.map(m => {
      const isActive = m.name === activeModel;
      const displayName = m.label && m.label !== m.name ? m.label : shortModelName(m.name);
      const sub = m.size ? fmtSize(m.size) : (m.name.endsWith(':free') ? 'free' : '');
      return `
        <button class="popover-item${isActive ? ' active' : ''}" data-model="${escapeHtml(m.name)}" title="${escapeHtml(m.name)}">
          <span class="popover-icon">${isActive ? '✓' : '🤖'}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(displayName)}</span>
          ${sub ? `<span class="popover-item-sub">${escapeHtml(sub)}</span>` : ''}
        </button>
      `;
    }).join('')}
  `;

  modelMenu.querySelectorAll('.popover-item[data-model]').forEach(btn => {
    btn.addEventListener('click', () => {
      const model = btn.dataset.model;
      activeModel = model;
      updateModelLabel(model);
      renderModelMenu();
      closeModelMenu();
      if (ws && wsReady) {
        ws.send(JSON.stringify({ type: 'set_model', model }));
      }
    });
  });
}

function updateModelLabel(model) {
  document.getElementById('model-btn-label').textContent = shortModelName(model) || 'model';
}

// ── WORKSPACE PANEL ───────────────────────────────────────────────────────────
async function loadWorkspaceTree() {
  try {
    const files = await apiFetch('/api/workspace');
    renderWorkspaceTree(files);
  } catch (e) {
    const tree = document.getElementById('file-tree');
    tree.innerHTML = `<div class="ws-error">Failed to load: ${escapeHtml(e.message)}</div>`;
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
    document.getElementById('editor-placeholder').style.display = 'flex';
    document.getElementById('editor-main').style.display = 'none';
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

// ── TASKS PANEL ───────────────────────────────────────────────────────────────
let allTasks = [];

async function loadTasks() {
  try {
    allTasks = await apiFetch('/api/tasks');
    renderTasks(allTasks);
  } catch (e) {
    document.getElementById('tasks-list').innerHTML =
      `<div class="empty-state" style="color:var(--red)">Failed to load: ${escapeHtml(e.message)}</div>`;
  }
}

function renderTasks(tasks) {
  const list = document.getElementById('tasks-list');
  if (!tasks.length) {
    list.innerHTML = '<div class="empty-state">No tasks yet — click <strong>+ New Task</strong> to add one.</div>';
    return;
  }
  list.innerHTML = tasks.map(t => `
    <div class="task-card" data-id="${escapeHtml(t.id)}">
      <div class="task-card-header">
        <span class="task-status-dot ${t.status}" title="${t.status}"></span>
        <span class="task-desc">${escapeHtml(t.description)}</span>
        <span class="task-dates">${fmtAge(t.created_at)}</span>
        <button class="btn btn-sm btn-danger task-delete-btn" data-id="${escapeHtml(t.id)}" title="Delete task">✕</button>
      </div>
      ${t.result ? `<div class="task-result">${escapeHtml(t.result.slice(0, 300))}${t.result.length > 300 ? '…' : ''}</div>` : ''}
      ${t.error  ? `<div class="task-error">${escapeHtml(t.error)}</div>` : ''}
    </div>
  `).join('');

  // Wire delete buttons
  list.querySelectorAll('.task-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (!confirm('Delete this task?')) return;
      try {
        await apiFetch('/api/tasks/' + id, { method: 'DELETE' });
        await loadTasks();
      } catch (err) {
        alert('Delete failed: ' + err.message);
      }
    });
  });
}

document.getElementById('refresh-tasks-btn').addEventListener('click', loadTasks);

// Task modal open/close
const taskModal = document.getElementById('task-modal');
function openTaskModal() {
  document.getElementById('task-topic').value  = '';
  document.getElementById('task-detail').value = '';
  document.getElementById('task-action').value = '';
  taskModal.style.display = 'flex';
  document.getElementById('task-topic').focus();
}
function closeTaskModal() {
  taskModal.style.display = 'none';
}

document.getElementById('new-task-btn').addEventListener('click', openTaskModal);
document.getElementById('task-modal-close').addEventListener('click', closeTaskModal);
document.getElementById('task-modal-cancel').addEventListener('click', closeTaskModal);
taskModal.addEventListener('click', e => { if (e.target === taskModal) closeTaskModal(); });

document.getElementById('task-modal-submit').addEventListener('click', async () => {
  const topic  = document.getElementById('task-topic').value.trim();
  const detail = document.getElementById('task-detail').value.trim();
  const action = document.getElementById('task-action').value.trim();
  if (!topic) {
    document.getElementById('task-topic').focus();
    return;
  }
  const btn = document.getElementById('task-modal-submit');
  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    const res = await apiFetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, detail, action }),
    });
    allTasks = res.tasks;
    renderTasks(allTasks);
    closeTaskModal();
  } catch (err) {
    alert('Failed to create task: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Task';
  }
});

// Keyboard shortcut: Enter in topic field submits modal
document.getElementById('task-topic').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('task-modal-submit').click();
});

// ── SETTINGS PANEL ────────────────────────────────────────────────────────────
// Tab switching
document.querySelectorAll('.stab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.stab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.settings-tab-body').forEach(b => b.style.display = 'none');
    tab.classList.add('active');
    const body = document.getElementById('stab-' + tab.dataset.stab);
    if (body) body.style.display = 'block';
  });
});

async function loadSettingsModels(provider, savedDefault, savedComplex) {
  const selDefault = document.getElementById('cfg-DEFAULT_MODEL');
  const selComplex = document.getElementById('cfg-COMPLEX_MODEL');
  if (!selDefault) return;

  selDefault.innerHTML = '<option value="">Loading…</option>';
  selDefault.disabled = true;
  if (selComplex) { selComplex.innerHTML = '<option value="">None (same as default)</option>'; selComplex.disabled = true; }

  try {
    const url = provider ? `/api/models?provider=${encodeURIComponent(provider)}` : '/api/models';
    const data = await apiFetch(url);
    const models = data.models || [];

    if (!models.length) {
      selDefault.innerHTML = '<option value="">No models found</option>';
      selDefault.disabled = false;
      if (selComplex) selComplex.disabled = false;
      return;
    }

    const opts = models.map(m => {
      const display = (m.label && m.label !== m.name) ? m.label : shortModelName(m.name);
      return `<option value="${escapeHtml(m.name)}">${escapeHtml(display)}</option>`;
    }).join('');

    selDefault.innerHTML = opts;
    selDefault.disabled = false;
    if (selComplex) {
      selComplex.innerHTML = `<option value="">None (same as default)</option>${opts}`;
      selComplex.disabled = false;
    }

    if (savedDefault) selDefault.value = savedDefault;
    if (savedComplex && selComplex) selComplex.value = savedComplex;
  } catch (e) {
    selDefault.innerHTML = '<option value="">Failed to load — is server running?</option>';
    selDefault.disabled = false;
    if (selComplex) selComplex.disabled = false;
  }
}

async function loadSettings() {
  try {
    const cfg = await apiFetch('/api/settings');
    setField('MODEL_PROVIDER',           cfg.MODEL_PROVIDER);
    showProviderSection(cfg.MODEL_PROVIDER || 'ollama');
    setField('EMBED_MODEL',              cfg.EMBED_MODEL);
    setField('OLLAMA_HOST',              cfg.OLLAMA_HOST);
    setField('OPENROUTER_API_KEY',       cfg.OPENROUTER_API_KEY);
    setField('ANTHROPIC_API_KEY',        cfg.ANTHROPIC_API_KEY);
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

    // Mirror the Ollama host into the disabled embed-host field
    const embedHost = document.getElementById('cfg-OLLAMA_HOST_EMBED');
    if (embedHost) embedHost.value = cfg.OLLAMA_HOST || 'http://localhost:11434';

    // Database tab: show the right section
    showDatabaseSection(cfg.DATABASE_TYPE || 'local');

    // Integrations tab: refresh connect-button states
    refreshConnectButtons(cfg);

    await loadSettingsModels(cfg.MODEL_PROVIDER, cfg.DEFAULT_MODEL, cfg.COMPLEX_MODEL);
  } catch (e) {
    setSettingsStatus('Failed to load: ' + e.message, 'error');
  }
}

// Show/hide the provider-specific settings section.
function showProviderSection(provider) {
  document.querySelectorAll('.provider-section').forEach(s => {
    s.classList.toggle('visible', s.dataset.provider === provider);
  });
  const hint = document.getElementById('provider-hint');
  if (hint) {
    const hints = {
      ollama:     'Free, runs locally. Requires Ollama installed.',
      openrouter: 'Free models available with daily limits. No card needed.',
      anthropic:  'Best quality. Requires paid Anthropic API credits.',
    };
    hint.textContent = hints[provider] || '';
  }
}

// Show/hide the database-specific settings section.
function showDatabaseSection(type) {
  document.querySelectorAll('.db-section').forEach(s => {
    s.classList.toggle('visible', s.dataset.database === type);
  });
  const hint = document.getElementById('database-hint');
  if (hint) {
    const hints = {
      local:    'PGlite stores data in a single file on this machine. Best for single-user, offline.',
      supabase: 'Cloud Postgres with vector search. Best for multi-device sync. Free tier available.',
    };
    hint.textContent = hints[type] || '';
  }
}

document.getElementById('cfg-DATABASE_TYPE').addEventListener('change', function () {
  showDatabaseSection(this.value);
});

// Re-fetch models when provider changes
document.getElementById('cfg-MODEL_PROVIDER').addEventListener('change', function () {
  showProviderSection(this.value);
  loadSettingsModels(this.value, '', '');
});

document.getElementById('reload-models-btn').addEventListener('click', () => {
  const provider = document.getElementById('cfg-MODEL_PROVIDER').value;
  const cur = document.getElementById('cfg-DEFAULT_MODEL').value;
  const curC = document.getElementById('cfg-COMPLEX_MODEL')?.value || '';
  loadSettingsModels(provider, cur, curC);
});

function setField(id, value) {
  const el = document.getElementById('cfg-' + id);
  if (!el) return;
  el.value = value || '';
}

function setSettingsStatus(msg, cls) {
  const el = document.getElementById('settings-status');
  el.textContent = msg;
  el.className   = cls || '';
}

document.getElementById('settings-save-btn').addEventListener('click', async () => {
  const fields = [
    'MODEL_PROVIDER','DEFAULT_MODEL','COMPLEX_MODEL','EMBED_MODEL','OLLAMA_HOST',
    'OPENROUTER_API_KEY','ANTHROPIC_API_KEY','DATABASE_TYPE','PGLITE_PATH','SUPABASE_URL',
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
        ? `Saved: ${updated.join(', ')}`
        : 'No changes detected',
      'ok'
    );
    // After successful save, refresh the chat toolbar model picker
    // to match the new provider/model
    if (typeof loadModels === 'function') {
      loadModels();
    }
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

// ── Connections (integrations) ────────────────────────────────────────────────
function refreshConnectButtons(cfg) {
  document.querySelectorAll('.connect-btn').forEach(btn => {
    const key = btn.dataset.key;
    const value = cfg ? cfg[key] : document.getElementById('cfg-' + key)?.value;
    // Server returns masked values like "••••" for set secrets — any non-empty
    // string means the integration is connected.
    const isConnected = value && String(value).length > 0;
    btn.classList.toggle('connected', !!isConnected);
    btn.textContent = isConnected ? 'Connected' : 'Connect';
  });
}

let connectModalKey = null;

document.querySelectorAll('.connect-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.key;
    const name = btn.dataset.name;
    const doc = btn.dataset.doc;
    const isConnected = btn.classList.contains('connected');

    if (isConnected) {
      // Disconnect: clear the value
      if (confirm(`Disconnect ${name}? Your stored token will be removed from .env`)) {
        const hidden = document.getElementById('cfg-' + key);
        if (hidden) hidden.value = '';
        triggerSettingsSave().then(() => refreshConnectButtons());
      }
      return;
    }

    // Open modal to connect AND auto-open docs page in a new tab
    connectModalKey = key;
    document.getElementById('connect-modal-title').textContent = `Connect ${name}`;
    document.getElementById('connect-modal-doc').href = doc;
    document.getElementById('connect-modal-input').value = '';
    document.getElementById('connect-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('connect-modal-input').focus(), 50);

    // Auto-open the service's API key page in a new tab so the user
    // doesn't have to click the link in the modal — the smoothest possible
    // self-hosted "OAuth-ish" flow without actual OAuth infrastructure.
    if (doc && doc !== '#') {
      window.open(doc, '_blank', 'noopener,noreferrer');
    }
  });
});

function closeConnectModal() {
  document.getElementById('connect-modal').classList.add('hidden');
  connectModalKey = null;
}

document.getElementById('connect-modal-close').addEventListener('click', closeConnectModal);
document.getElementById('connect-modal-cancel').addEventListener('click', closeConnectModal);
document.getElementById('connect-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('connect-modal')) closeConnectModal();
});

document.getElementById('connect-modal-confirm').addEventListener('click', async () => {
  const value = document.getElementById('connect-modal-input').value.trim();
  if (!value) return;
  if (!connectModalKey) return;
  const hidden = document.getElementById('cfg-' + connectModalKey);
  if (hidden) hidden.value = value;
  closeConnectModal();
  await triggerSettingsSave();
  refreshConnectButtons();
});

async function triggerSettingsSave() {
  const fields = ['NOTION_API_KEY','WEB_SEARCH_API_KEY','OPENWEATHER_API_KEY','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID'];
  const body = {};
  for (const f of fields) {
    const el = document.getElementById('cfg-' + f);
    if (el) body[f] = el.value;
  }
  try {
    await apiFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSettingsStatus('Saved', 'ok');
  } catch (e) {
    setSettingsStatus('Save failed: ' + e.message, 'error');
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
connectWS();
switchPanel('chat');
loadStatus(); // pre-load so status tab is instant
