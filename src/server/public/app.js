/* ── NOVA Web UI ─────────────────────────────────────────────────────────────── */
'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let ws         = null;
let wsReady    = false;
let currentFile = null;
let fileOriginal = '';
let allMemories  = [];
let currentPanel = 'chat';
// Companion mode: when true, the WS uses ?mode=companion and the chat panel
// shows a banner. Persisted across reconnects so onclose can decide whether
// to reconnect to the companion conversation or a fresh one.
let _isCompanionMode = false;

// ── Voice input (Web Speech API) ──────────────────────────────────────────────
// Browser-native; no server work. Click to start, click again or 3s of silence
// to stop. Final transcript appears in the chat textarea so the user can edit
// before sending.
let _recognition  = null;
let _silenceTimer = null;
function startVoiceInput() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    alert('Voice input not supported in this browser. Use Chrome or Edge.');
    return;
  }
  if (_recognition) { _recognition.stop(); _recognition = null; return; }

  _recognition = new SR();
  _recognition.continuous     = true;
  _recognition.interimResults = true;
  _recognition.lang           = navigator.language || 'en-US';

  const input = document.getElementById('chat-input');
  const btn   = document.getElementById('chat-voice-btn');
  if (btn) btn.classList.add('recording');

  let finalTranscript = input.value.trim();
  if (finalTranscript) finalTranscript += ' ';

  _recognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalTranscript += t + ' ';
      else interim += t;
    }
    input.value = finalTranscript + interim;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';

    clearTimeout(_silenceTimer);
    _silenceTimer = setTimeout(() => stopVoiceInput(), 3000);
  };

  _recognition.onerror = (e) => {
    console.warn('Speech error:', e.error);
    stopVoiceInput();
  };

  _recognition.onend = () => {
    if (btn) btn.classList.remove('recording');
    _recognition = null;
    clearTimeout(_silenceTimer);
  };

  _recognition.start();
}

function stopVoiceInput() {
  if (_recognition) {
    try { _recognition.stop(); } catch {}
  }
  const btn = document.getElementById('chat-voice-btn');
  if (btn) btn.classList.remove('recording');
}

// ── Voice output (Web Speech Synthesis) ───────────────────────────────────────
function isVoiceOutputOn() {
  return localStorage.getItem('nova:voice-output') === 'on';
}
function setVoiceOutput(on) {
  localStorage.setItem('nova:voice-output', on ? 'on' : 'off');
  const btn = document.getElementById('voice-output-toggle');
  if (btn) btn.classList.toggle('voice-on', on);
  if (!on && window.speechSynthesis) window.speechSynthesis.cancel();
}
function speakText(text) {
  if (!isVoiceOutputOn() || !window.speechSynthesis) return;
  // Strip markdown so TTS doesn't read out backticks, asterisks, code blocks.
  const clean = String(text || '')
    .replace(/```[\s\S]*?```/g, '. code block omitted. ')
    .replace(/[*_`#>]/g, '')
    .replace(/\n+/g, '. ')
    .trim();
  if (!clean) return;
  const utter = new SpeechSynthesisUtterance(clean);
  utter.rate  = 1.05;
  utter.pitch = 1.0;
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => /samantha|aria|natural|google/i.test(v.name)) || voices[0];
  if (preferred) utter.voice = preferred;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

// ── Companion mode helpers ────────────────────────────────────────────────────
function showCompanionHeader(on) {
  let banner = document.getElementById('companion-banner');
  if (on) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'companion-banner';
      banner.className = 'companion-banner';
      banner.innerHTML = '<span>●</span> Companion mode — your persistent chat with NOVA';
      const panel = document.getElementById('panel-chat');
      if (panel) panel.prepend(banner);
    }
  } else if (banner) {
    banner.remove();
  }
}

function enterCompanionMode() {
  _isCompanionMode = true;
  switchPanel('chat');
  // switchPanel made [data-panel="chat"] active — move that highlight to the
  // Companion item so the sidebar visually reflects the current mode.
  document.querySelector('.nav-item[data-panel="chat"]')?.classList.remove('active');
  document.querySelector('.nav-item-companion')?.classList.add('active');
  // Hide welcome unconditionally — even if companion has no history yet,
  // the banner already explains the mode and the welcome screen would clash.
  document.getElementById('chat-messages').innerHTML = '';
  _hasMessages = true;
  setWelcome(false);
  showCompanionHeader(true);
  reconnectWS(true);
}

async function fetchCompanionHistory() {
  try {
    const res = await fetch('/api/companion');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    document.getElementById('chat-messages').innerHTML = '';
    for (const m of (data.messages || [])) {
      if (m.role === 'user') appendChatMsg('user', m.content);
      else if (m.role === 'assistant') appendChatMsg('nova', m.content);
      // Tool messages are intentionally not rendered here.
    }
    _hasMessages = (data.messages || []).length > 0;
    setWelcome(!_hasMessages);
  } catch (e) {
    console.warn('Failed to load companion history:', e);
  }
}

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
  if (name === 'workspace') loadProjectsList();
  if (name === 'settings')  loadSettings();
  if (name === 'customize') loadCustomize();
  if (name === 'chat')      updateWelcomeGreeting();
}

function openSearchModal() {
  // Reuses the sidebar search bar — toggle it open and focus
  searchVisible = true;
  const wrap = document.getElementById('sb-search-wrap');
  if (wrap) {
    wrap.classList.remove('hidden');
    const input = document.getElementById('sb-search-input');
    if (input) setTimeout(() => input.focus(), 50);
  }
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const target = item.dataset.panel;
    if (target === 'search') {
      openSearchModal();
      return;
    }
    if (target === 'companion') {
      enterCompanionMode();
      return;
    }
    if (target === 'chat') {
      // Leaving companion mode? Drop the banner so the user knows they're
      // back in a fresh, ephemeral chat.
      if (_isCompanionMode) {
        _isCompanionMode = false;
        showCompanionHeader(false);
      }
      // "New chat" — clear messages and reconnect (fresh, non-companion)
      document.getElementById('chat-messages').innerHTML = '';
      _hasMessages = false;
      setWelcome(true);
      if (typeof clearAttachments === 'function') clearAttachments();
      reconnectWS(false);
    }
    switchPanel(target);
  });
});

// Re-bind dynamically-added nav items (inside More expander)
function rebindNavItems() {
  document.querySelectorAll('.sb-more-items .nav-item').forEach(item => {
    if (item.dataset.bound) return;
    item.dataset.bound = '1';
    item.addEventListener('click', () => {
      switchPanel(item.dataset.panel);
    });
  });
}
rebindNavItems();

// More expander toggle
const moreToggle = document.getElementById('sb-more-toggle');
if (moreToggle) {
  moreToggle.addEventListener('click', () => {
    const items = document.getElementById('sb-more-items');
    items.classList.toggle('hidden');
    moreToggle.classList.toggle('expanded');
  });
}

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

// Reconnect AI — close WS so it auto-reconnects (preserve companion mode)
document.getElementById('um-reconnect').addEventListener('click', () => {
  closeUserMenu();
  reconnectWS(_isCompanionMode);
});

// Clear session — leaves companion mode and starts a fresh ephemeral chat
document.getElementById('um-clear').addEventListener('click', () => {
  closeUserMenu();
  if (_isCompanionMode) { _isCompanionMode = false; showCompanionHeader(false); }
  document.getElementById('chat-messages').innerHTML = '';
  _hasMessages = false;
  setWelcome(true);
  clearAttachments();
  reconnectWS(false);
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
    <button class="conv-menu-item" data-action="pin">⭐ ${pinned ? 'Unstar' : 'Star'}</button>
    <button class="conv-menu-item" data-action="rename">✏️ Rename</button>
    <button class="conv-menu-item" data-action="move">📁 Move to project</button>
    <button class="conv-menu-item danger" data-action="delete">🗑 Delete</button>
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
  const moveBtn = menu.querySelector('[data-action="move"]');
  if (moveBtn) {
    moveBtn.addEventListener('click', async () => {
      closeConvMenu();
      try {
        const projects = await apiFetch('/api/projects');
        if (!projects.length) {
          if (confirm('No projects yet. Create one?')) {
            switchPanel('workspace');
          }
          return;
        }
        const list = projects.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
        const choice = prompt(`Move to which project?\n\n${list}\n\n(Enter number, or empty to unlink)`, '');
        if (choice === null) return;
        const trimmed = choice.trim();
        let projectId = null;
        if (trimmed) {
          const idx = parseInt(trimmed, 10) - 1;
          if (Number.isNaN(idx) || !projects[idx]) { alert('Invalid choice'); return; }
          projectId = projects[idx].id;
        }
        await apiFetch('/api/conversations/' + encodeURIComponent(id) + '/project', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId }),
        });
        await loadConversations();
      } catch (e) {
        alert('Move failed: ' + e.message);
      }
    });
  }
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

    // ── New large cards (AI Configuration) ────────────────────────────────
    const provLarge   = document.getElementById('stat-provider-large');
    const modelLarge  = document.getElementById('stat-model-large');
    const embedLarge  = document.getElementById('stat-embed-model');
    const provStatus  = document.getElementById('stat-provider-status');
    if (provLarge)  provLarge.textContent  = (s.provider || '—').toUpperCase();
    if (modelLarge) modelLarge.textContent = s.model || '—';
    if (embedLarge) embedLarge.textContent = 'nomic-embed-text';
    if (provStatus) provStatus.textContent = s.database === 'local' ? 'PGlite local' : 'Supabase';

    // ── Integrations status ───────────────────────────────────────────────
    try {
      const cfg = await apiFetch('/api/settings');
      const checks = [
        { key: 'NOTION_API_KEY',          name: 'Notion' },
        { key: 'GOOGLE_CREDENTIALS_PATH', name: 'Google' },
        { key: 'WEB_SEARCH_API_KEY',      name: 'Web Search' },
        { key: 'OPENWEATHER_API_KEY',     name: 'Weather' },
        { key: 'TELEGRAM_BOT_TOKEN',      name: 'Telegram' },
      ];
      const integHtml = checks.map(c => {
        const connected = cfg[c.key] && String(cfg[c.key]).length > 0;
        return `<div class="stat-card"><div class="stat-label">${c.name}</div><div class="stat-value" style="font-size:13px;color:${connected ? 'var(--green)' : 'var(--dimmer)'}">${connected ? '● Connected' : '○ Not connected'}</div></div>`;
      }).join('');
      const intEl = document.getElementById('status-integrations');
      if (intEl) intEl.innerHTML = integHtml;
    } catch {}
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
  if (show) {
    el.classList.remove('hidden');
    updateWelcomeGreeting();
  } else {
    el.classList.add('hidden');
  }
}

function updateWelcomeGreeting() {
  const greetEl = document.getElementById('welcome-greeting');
  const chipsEl = document.getElementById('welcome-chips');
  if (!greetEl || !chipsEl) return;
  const name = (window.userPreferredName || 'Jimmy');
  const h = new Date().getHours();
  let greeting;
  if (h >= 5 && h < 12)        greeting = `Good morning, ${name}`;
  else if (h >= 12 && h < 17)  greeting = `Good afternoon, ${name}`;
  else if (h >= 17 && h < 21)  greeting = `Good evening, ${name}`;
  else                          greeting = `Hello, night owl`;
  greetEl.textContent = greeting;

  const allChips = [
    { icon: '</>', label: 'Code' },
    { icon: '📊', label: 'Strategize' },
    { icon: '🎓', label: 'Learn' },
    { icon: '✏️', label: 'Write' },
    { icon: '📧', label: 'From Gmail' },
    { icon: '🔍', label: 'Research' },
    { icon: '📅', label: 'Plan my day' },
    { icon: '📝', label: 'Summarize' },
  ];
  const shuffled = [...allChips].sort(() => Math.random() - 0.5).slice(0, 5);
  chipsEl.innerHTML = shuffled.map(c =>
    `<button class="welcome-chip" data-prompt="${escapeHtml(c.label)}">${c.icon} ${escapeHtml(c.label)}</button>`
  ).join('');
  chipsEl.querySelectorAll('.welcome-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const ci = document.getElementById('chat-input');
      ci.value = btn.dataset.prompt + ': ';
      ci.focus();
    });
  });
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
// connectWS reads `_isCompanionMode` so reconnects (manual or auto) land in the
// same mode the user last selected. Pass a value to reconnectWS() instead of
// mutating ws.close handlers — that avoids the stale-onclose race where a
// previous connection's onclose fires 3s later and reconnects to the wrong mode.
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const path  = _isCompanionMode ? '/ws?mode=companion' : '/ws';
  ws = new WebSocket(`${proto}//${location.host}${path}`);
  setChatStatus('connecting…');

  ws.onopen = () => setChatStatus('connecting…');

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'ready') {
      wsReady = true;
      setChatStatus(msg.companion ? 'companion · connected' : 'connected', 'connected');
      document.getElementById('send-btn').disabled = false;
      loadModels(); // populate model selector on connect
      if (msg.companion) {
        // Server replays history — fetch and render it
        fetchCompanionHistory();
      }
    } else if (msg.type === 'thinking') {
      showThinking(true);
    } else if (msg.type === 'response') {
      showThinking(false);
      appendChatMsg('nova', msg.text);
      speakText(msg.text);
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

// Tear down the existing socket without triggering its auto-reconnect, then
// open a fresh one in the requested mode. Used when toggling Companion ↔ New.
function reconnectWS(companion) {
  _isCompanionMode = !!companion;
  if (ws) {
    // Null out every handler so an in-flight message or close on the dying
    // socket can't bleed into the fresh one we're about to open.
    try { ws.onclose = null; ws.onerror = null; ws.onmessage = null; ws.close(); } catch {}
    ws = null;
  }
  wsReady = false;
  document.getElementById('send-btn').disabled = true;
  connectWS();
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
  const adaptive = localStorage.getItem('nova:adaptive-thinking') !== 'off';
  ws.send(JSON.stringify({ type: 'message', text, adaptive }));
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
  if (_isCompanionMode) { _isCompanionMode = false; showCompanionHeader(false); }
  document.getElementById('chat-messages').innerHTML = '';
  _hasMessages = false;
  setWelcome(true);
  clearAttachments();
  reconnectWS(false);
});

// New Chat button (sidebar) — same as clear
document.getElementById('new-chat-btn').addEventListener('click', () => {
  if (_isCompanionMode) { _isCompanionMode = false; showCompanionHeader(false); }
  document.getElementById('chat-messages').innerHTML = '';
  _hasMessages = false;
  setWelcome(true);
  clearAttachments();
  reconnectWS(false);
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

function describeModel(name) {
  const lower = (name || '').toLowerCase();
  if (lower.includes('opus') || lower.includes('70b') || lower.includes('large')) return 'Most capable for ambitious work';
  if (lower.includes('haiku') || lower.includes('8b') || lower.includes('mini') || lower.includes('instant')) return 'Fastest for quick answers';
  return 'Most efficient for everyday tasks';
}

function renderModelMenu() {
  if (!installedModels.length) {
    modelMenu.innerHTML = '<div class="popover-section-label">No models found</div>';
    return;
  }

  const primary = installedModels.slice(0, 3);
  const more    = installedModels.slice(3);

  const primaryHtml = primary.map(m => {
    const display = m.label || shortModelName(m.name);
    const desc = describeModel(m.name);
    const isActive = m.name === activeModel;
    return `
      <button class="model-option${isActive ? ' active' : ''}" data-model="${escapeHtml(m.name)}">
        <div class="model-option-name">${escapeHtml(display)}${isActive ? ' <span class="model-checkmark">✓</span>' : ''}</div>
        <div class="model-option-desc">${escapeHtml(desc)}</div>
      </button>
    `;
  }).join('');

  const adaptiveOn = localStorage.getItem('nova:adaptive-thinking') !== 'off';
  const adaptiveHtml = `
    <div class="model-divider"></div>
    <button class="model-option" id="adaptive-thinking-toggle">
      <div class="model-option-name">Adaptive thinking <span class="model-toggle ${adaptiveOn ? 'on' : ''}"></span></div>
      <div class="model-option-desc">Thinks for more complex tasks</div>
    </button>
  `;

  const moreHtml = more.length ? `
    <div class="model-divider"></div>
    <button class="model-option" id="model-more-toggle">
      <div class="model-option-name">More models <span style="float:right">▸</span></div>
    </button>
    <div class="model-more-submenu" id="model-more-submenu" style="display:none">
      ${more.map(m => `<button class="model-option-sub" data-model="${escapeHtml(m.name)}">${escapeHtml(shortModelName(m.name))}</button>`).join('')}
    </div>
  ` : '';

  modelMenu.innerHTML = primaryHtml + adaptiveHtml + moreHtml;

  modelMenu.querySelectorAll('[data-model]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const model = btn.dataset.model;
      activeModel = model;
      updateModelLabel(model);
      renderModelMenu();
      closeModelMenu();
      if (ws && wsReady) ws.send(JSON.stringify({ type: 'set_model', model }));
    });
  });

  const adaptiveBtn = document.getElementById('adaptive-thinking-toggle');
  if (adaptiveBtn) {
    adaptiveBtn.addEventListener('click', e => {
      e.stopPropagation();
      const cur = localStorage.getItem('nova:adaptive-thinking') !== 'off';
      localStorage.setItem('nova:adaptive-thinking', cur ? 'off' : 'on');
      renderModelMenu();
      updateModelLabel(activeModel);
    });
  }

  const moreBtn = document.getElementById('model-more-toggle');
  if (moreBtn) {
    moreBtn.addEventListener('click', e => {
      e.stopPropagation();
      const sub = document.getElementById('model-more-submenu');
      if (sub) sub.style.display = sub.style.display === 'none' ? 'block' : 'none';
    });
  }
}

function updateModelLabel(model) {
  const adaptiveOn = localStorage.getItem('nova:adaptive-thinking') !== 'off';
  const label = shortModelName(model) || 'model';
  const adaptiveSpan = adaptiveOn ? ' <span class="adaptive-label">Adaptive</span>' : '';
  const el = document.getElementById('model-btn-label');
  if (el) el.innerHTML = escapeHtml(label) + adaptiveSpan;
}

// ── PROJECTS PANEL ────────────────────────────────────────────────────────────
let _currentProject = null; // { id, ...project, conversations: [] } when viewing detail

async function loadProjectsList() {
  const grid = document.getElementById('projects-grid');
  const empty = document.getElementById('projects-empty');
  document.getElementById('projects-list-view').classList.remove('hidden');
  document.getElementById('project-detail-view').classList.add('hidden');
  const createView = document.getElementById('project-create-view');
  if (createView) createView.classList.add('hidden');

  try {
    const projects = await apiFetch('/api/projects');
    if (!projects.length) {
      empty.classList.remove('hidden');
      grid.innerHTML = '';
      return;
    }
    empty.classList.add('hidden');
    grid.innerHTML = projects.map(p => `
      <div class="project-card" data-id="${escapeHtml(p.id)}">
        <div class="project-card-name">${escapeHtml(p.name)}</div>
        <div class="project-card-desc">${escapeHtml(p.description || 'No description')}</div>
        <div class="project-card-meta">
          <span>💬 ${p.chat_count} chat${p.chat_count === 1 ? '' : 's'}</span>
          <span>${fmtAge(p.updated_at)}</span>
        </div>
      </div>
    `).join('');
    grid.querySelectorAll('.project-card').forEach(card => {
      card.addEventListener('click', () => openProject(card.dataset.id));
    });
  } catch (e) {
    grid.innerHTML = `<div class="projects-empty-desc" style="color:var(--red)">Failed to load: ${escapeHtml(e.message)}</div>`;
  }
}

async function openProject(id) {
  try {
    _currentProject = await apiFetch('/api/projects/' + encodeURIComponent(id));
    renderProjectDetail();
  } catch (e) {
    alert('Failed to load project: ' + e.message);
  }
}

function renderProjectDetail() {
  const p = _currentProject;
  if (!p) return;
  document.getElementById('projects-list-view').classList.add('hidden');
  document.getElementById('project-create-view')?.classList.add('hidden');
  document.getElementById('project-detail-view').classList.remove('hidden');

  const nameEl = document.getElementById('project-detail-name-display');
  const descEl = document.getElementById('project-detail-desc-display');
  if (nameEl) nameEl.textContent = p.name || 'Untitled project';
  if (descEl) descEl.textContent = p.description || '';

  // Show/hide "Show more" depending on description length
  const showMore = document.getElementById('project-show-more');
  if (showMore) showMore.style.display = (p.description && p.description.length > 200) ? 'block' : 'none';

  // Instructions card body
  const instBody = document.getElementById('rail-instructions-body');
  if (instBody) {
    instBody.textContent = p.instructions
      ? p.instructions.slice(0, 120) + (p.instructions.length > 120 ? '…' : '')
      : "Add instructions to tailor NOVA's responses";
    instBody.style.color = p.instructions ? 'var(--text)' : 'var(--dim)';
  }

  const list = document.getElementById('project-chats-list');
  if (!p.conversations || !p.conversations.length) {
    list.innerHTML = '<div class="project-chats-empty" style="padding:24px;text-align:center;font-size:12.5px;color:var(--dimmer)">No chats yet. Use the input above to start one.</div>';
  } else {
    list.innerHTML = p.conversations.map(c => {
      const title = c.first_message ? c.first_message.slice(0, 80).replace(/\n/g, ' ') : 'Untitled';
      return `
        <div class="project-chat-row" data-id="${escapeHtml(c.id)}">
          <div class="project-chat-title">${escapeHtml(title)}</div>
          <div class="project-chat-meta">${fmtAge(c.started_at)}</div>
        </div>
      `;
    }).join('');
  }

  // Load right-rail memory + files
  loadProjectMemory(p.id);
  loadProjectFiles(p.id);
}

async function loadProjectMemory(projectId) {
  const body = document.getElementById('rail-memory-body');
  if (!body) return;
  try {
    const memory = await apiFetch('/api/projects/' + encodeURIComponent(projectId) + '/memory');
    if (memory && memory.content) {
      body.innerHTML = `
        <div class="rail-memory-content">${escapeHtml(memory.content)}</div>
        <div class="rail-memory-meta">Updated ${fmtAge(memory.created_at)} · ${escapeHtml(memory.source)}</div>
      `;
    } else {
      body.innerHTML = `
        <div style="color:var(--dimmer);font-size:12px">No memory yet. Chat in this project and a synthesis will appear after the conversation ends.</div>
        <button class="btn btn-sm" id="rail-memory-regen-btn" style="margin-top:10px">Generate now</button>
      `;
      document.getElementById('rail-memory-regen-btn')?.addEventListener('click', async () => {
        body.innerHTML = '<div style="color:var(--dim)">Generating…</div>';
        try {
          const result = await apiFetch('/api/projects/' + encodeURIComponent(projectId) + '/memory/regenerate', { method: 'POST' });
          if (result.synthesis) {
            body.innerHTML = `<div class="rail-memory-content">${escapeHtml(result.synthesis)}</div><div class="rail-memory-meta">Just now · manual</div>`;
          } else {
            body.innerHTML = '<div style="color:var(--dimmer);font-size:12px">No content to synthesize yet — start chatting in this project.</div>';
          }
        } catch (e) {
          body.innerHTML = `<div style="color:var(--red);font-size:12px">Failed: ${escapeHtml(e.message)}</div>`;
        }
      });
    }
  } catch (e) {
    body.innerHTML = `<div style="color:var(--red);font-size:12px">Failed to load: ${escapeHtml(e.message)}</div>`;
  }
}

async function loadProjectFiles(projectId) {
  const body = document.getElementById('rail-files-body');
  if (!body) return;
  try {
    const files = await apiFetch('/api/projects/' + encodeURIComponent(projectId) + '/files');
    if (!files.length) {
      body.innerHTML = `<div class="rail-files-empty"><div class="rail-files-icon">📄</div>Add PDFs, documents, or other text to reference in this project.</div>`;
      return;
    }
    body.innerHTML = files.map(f => `
      <div class="rail-file-item" data-name="${escapeHtml(f.name)}">
        <span class="rail-file-icon">📄</span>
        <span class="rail-file-name">${escapeHtml(f.name)}</span>
        <span class="rail-file-size">${(f.size / 1024).toFixed(1)} KB</span>
        <button class="rail-file-remove" data-name="${escapeHtml(f.name)}">×</button>
      </div>
    `).join('');
    body.querySelectorAll('.rail-file-remove').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Remove "${btn.dataset.name}" from this project?`)) return;
        try {
          await apiFetch('/api/projects/' + encodeURIComponent(projectId) + '/files/' + encodeURIComponent(btn.dataset.name), { method: 'DELETE' });
          loadProjectFiles(projectId);
        } catch (err) { alert(err.message); }
      });
    });
  } catch (e) {
    body.innerHTML = `<div style="color:var(--red);font-size:12px">${escapeHtml(e.message)}</div>`;
  }
}

// Wire the + button on the Files card
document.getElementById('rail-files-add')?.addEventListener('click', e => {
  e.stopPropagation();
  if (!_currentProject) return;
  let fileInput = document.getElementById('project-file-upload-input');
  if (!fileInput) {
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'project-file-upload-input';
    fileInput.style.display = 'none';
    fileInput.accept = '.txt,.md,.pdf,.json,.csv,.html,.js,.ts,.py';
    document.body.appendChild(fileInput);
    fileInput.addEventListener('change', async function() {
      if (!this.files[0] || !_currentProject) return;
      const file = this.files[0];
      try {
        const content = await file.text();
        await apiFetch('/api/projects/' + encodeURIComponent(_currentProject.id) + '/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, content }),
        });
        loadProjectFiles(_currentProject.id);
      } catch (err) { alert('Upload failed: ' + err.message); }
      this.value = '';
    });
  }
  fileInput.click();
});

// Back button
document.getElementById('project-back-btn')?.addEventListener('click', () => {
  _currentProject = null;
  loadProjectsList();
});

// Show more toggle
document.getElementById('project-show-more')?.addEventListener('click', () => {
  const desc = document.getElementById('project-detail-desc-display');
  const btn = document.getElementById('project-show-more');
  if (!desc || !btn) return;
  desc.classList.toggle('expanded');
  btn.textContent = desc.classList.contains('expanded') ? 'Show less' : 'Show more';
});

// 3-dot menu
document.getElementById('project-3dot-btn')?.addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('project-3dot-menu')?.classList.toggle('hidden');
});
document.addEventListener('click', () => {
  document.getElementById('project-3dot-menu')?.classList.add('hidden');
});

// 3-dot actions
document.querySelectorAll('#project-3dot-menu .project-3dot-item').forEach(btn => {
  btn.addEventListener('click', async e => {
    e.stopPropagation();
    document.getElementById('project-3dot-menu')?.classList.add('hidden');
    const action = btn.dataset.action;
    if (!_currentProject) return;
    if (action === 'edit') {
      document.getElementById('project-edit-name').value = _currentProject.name || '';
      document.getElementById('project-edit-desc').value = _currentProject.description || '';
      document.getElementById('project-edit-modal').classList.remove('hidden');
    } else if (action === 'archive') {
      if (confirm('Archive this project? (Behaves like delete for now — no archive API yet.)')) {
        try {
          await apiFetch('/api/projects/' + encodeURIComponent(_currentProject.id), { method: 'DELETE' });
          _currentProject = null;
          loadProjectsList();
        } catch (err) { alert('Archive failed: ' + err.message); }
      }
    } else if (action === 'delete') {
      if (confirm(`Delete project "${_currentProject.name}"? Chats inside will remain but become unlinked.`)) {
        try {
          await apiFetch('/api/projects/' + encodeURIComponent(_currentProject.id), { method: 'DELETE' });
          _currentProject = null;
          loadProjectsList();
        } catch (err) { alert('Delete failed: ' + err.message); }
      }
    }
  });
});

// Edit details modal
document.getElementById('project-edit-close')?.addEventListener('click', () => {
  document.getElementById('project-edit-modal').classList.add('hidden');
});
document.getElementById('project-edit-cancel')?.addEventListener('click', () => {
  document.getElementById('project-edit-modal').classList.add('hidden');
});
document.getElementById('project-edit-save')?.addEventListener('click', async () => {
  if (!_currentProject) return;
  const updates = {
    name: document.getElementById('project-edit-name').value.trim(),
    description: document.getElementById('project-edit-desc').value.trim(),
  };
  try {
    await apiFetch('/api/projects/' + encodeURIComponent(_currentProject.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    _currentProject = await apiFetch('/api/projects/' + encodeURIComponent(_currentProject.id));
    document.getElementById('project-edit-modal').classList.add('hidden');
    renderProjectDetail();
  } catch (e) { alert('Save failed: ' + e.message); }
});

// Instructions modal — open via card click or + button
function openInstructionsModal() {
  if (!_currentProject) return;
  document.getElementById('project-instructions-textarea').value = _currentProject.instructions || '';
  document.getElementById('project-instructions-modal').classList.remove('hidden');
}
document.getElementById('rail-instructions-card')?.addEventListener('click', openInstructionsModal);
document.getElementById('rail-instructions-add')?.addEventListener('click', e => { e.stopPropagation(); openInstructionsModal(); });
document.getElementById('project-instructions-close')?.addEventListener('click', () => {
  document.getElementById('project-instructions-modal').classList.add('hidden');
});
document.getElementById('project-instructions-cancel')?.addEventListener('click', () => {
  document.getElementById('project-instructions-modal').classList.add('hidden');
});
document.getElementById('project-instructions-save')?.addEventListener('click', async () => {
  if (!_currentProject) return;
  const instructions = document.getElementById('project-instructions-textarea').value.trim();
  try {
    await apiFetch('/api/projects/' + encodeURIComponent(_currentProject.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instructions }),
    });
    _currentProject = await apiFetch('/api/projects/' + encodeURIComponent(_currentProject.id));
    document.getElementById('project-instructions-modal').classList.add('hidden');
    renderProjectDetail();
  } catch (e) { alert('Save failed: ' + e.message); }
});

// Project chat input — pressing Enter opens a new chat with the project active
document.getElementById('project-chat-send')?.addEventListener('click', () => {
  if (!_currentProject) return;
  const text = document.getElementById('project-chat-input').value.trim();
  sessionStorage.setItem('nova:active-project', _currentProject.id);
  switchPanel('chat');
  document.getElementById('chat-messages').innerHTML = '';
  _hasMessages = false;
  setWelcome(true);
  if (text) {
    const ci = document.getElementById('chat-input');
    if (ci) ci.value = text;
  }
  if (ws) ws.close();
});

// Create view (Item 3) — full-page replaces modal
function openCreateProject() {
  document.getElementById('projects-list-view').classList.add('hidden');
  document.getElementById('project-detail-view').classList.add('hidden');
  document.getElementById('project-create-view').classList.remove('hidden');
  document.getElementById('project-create-name').value = '';
  document.getElementById('project-create-desc').value = '';
  setTimeout(() => document.getElementById('project-create-name').focus(), 50);
}
function closeCreateProject() {
  document.getElementById('project-create-view').classList.add('hidden');
  document.getElementById('projects-list-view').classList.remove('hidden');
}

document.getElementById('new-project-btn').addEventListener('click', openCreateProject);
document.getElementById('projects-empty-create-btn').addEventListener('click', openCreateProject);
document.getElementById('project-create-back')?.addEventListener('click', closeCreateProject);
document.getElementById('project-create-cancel')?.addEventListener('click', closeCreateProject);

document.getElementById('project-create-confirm')?.addEventListener('click', async () => {
  const name = document.getElementById('project-create-name').value.trim();
  const description = document.getElementById('project-create-desc').value.trim();
  if (!name) { alert('Name is required'); return; }
  try {
    const project = await apiFetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
    });
    await openProject(project.id);
  } catch (e) { alert('Create failed: ' + e.message); }
});

// ── MEMORY PANEL ──────────────────────────────────────────────────────────────
async function loadMemories() {
  try {
    allMemories = await apiFetch('/api/memories');
    renderMemories(allMemories);
    updateMemoryStats(allMemories);
  } catch (e) {
    document.getElementById('memory-list').innerHTML =
      `<div class="memory-empty" style="color:var(--red)">Failed: ${escapeHtml(e.message)}</div>`;
  }
}

function updateMemoryStats(mems) {
  const byCat = {};
  for (const m of mems) byCat[m.category] = (byCat[m.category] || 0) + 1;
  const setStat = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setStat('mem-total',       mems.length);
  setStat('mem-personal',    byCat['personal']   || 0);
  setStat('mem-preferences', byCat['preference'] || 0);
  setStat('mem-projects',    byCat['project']    || 0);
}

function renderMemories(memories) {
  const list = document.getElementById('memory-list');
  if (!memories.length) {
    list.innerHTML = '<div class="memory-empty">No memories yet. Have a conversation with NOVA — important facts will be stored here automatically.</div>';
    return;
  }
  list.innerHTML = memories.map(m => `
    <div class="memory-card">
      <div class="memory-card-content">${escapeHtml(m.content)}</div>
      <div class="memory-card-footer">
        <span class="memory-card-category">${escapeHtml(m.category || 'note')}</span>
        <span>${fmtAge(m.created_at)}</span>
        <span>confidence: ${Math.round((m.confidence ?? 1) * 100)}%</span>
      </div>
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

// ── ROUTINES PANEL ────────────────────────────────────────────────────────────
let _routines = [];
let _editingRoutineId = null;

async function loadTasks() {
  // Nav handler still says "tasks" (data-panel="tasks") but it's the Routines UI now.
  await loadRoutines();
}

async function loadRoutines() {
  const list = document.getElementById('routines-list');
  if (!list) return;
  document.getElementById('routines-list-view').classList.remove('hidden');
  document.getElementById('routine-detail-view').classList.add('hidden');
  try {
    _routines = await apiFetch('/api/routines');
    if (!_routines.length) {
      list.innerHTML = '<div class="routine-card-empty">No routines yet. Click <strong>+ New routine</strong> to schedule something.</div>';
      return;
    }
    list.innerHTML = _routines.map(r => {
      const statusClass = r.last_run_status || 'never';
      const statusLabel = r.last_run_status ? r.last_run_status : 'never run';
      return `
        <div class="routine-card" data-id="${escapeHtml(r.id)}">
          <div class="routine-card-row">
            <div style="flex:1;min-width:0">
              <div class="routine-card-name">${escapeHtml(r.name)}</div>
              <div class="routine-card-cron">${escapeHtml(r.cron_expr)}${r.description ? ' · ' + escapeHtml(r.description) : ''}</div>
            </div>
            <span class="routine-card-status ${statusClass}">${escapeHtml(statusLabel)}</span>
            <div class="routine-card-actions">
              <label class="settings-toggle routine-toggle"><input type="checkbox" ${r.enabled ? 'checked' : ''} data-toggle="${escapeHtml(r.id)}"><span></span></label>
              <button class="btn btn-sm" data-action="run" data-id="${escapeHtml(r.id)}">Run now</button>
              <button class="btn btn-sm" data-action="edit" data-id="${escapeHtml(r.id)}">Edit</button>
              <button class="btn btn-sm" data-action="view" data-id="${escapeHtml(r.id)}">View</button>
              <button class="btn btn-sm btn-danger" data-action="delete" data-id="${escapeHtml(r.id)}">×</button>
            </div>
          </div>
          ${r.last_run_at ? `<div class="routine-card-last">Last run: ${fmtAge(r.last_run_at)}</div>` : ''}
        </div>
      `;
    }).join('');

    list.querySelectorAll('[data-toggle]').forEach(input => {
      input.addEventListener('change', async () => {
        try {
          await apiFetch('/api/routines/' + encodeURIComponent(input.dataset.toggle), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: input.checked }),
          });
        } catch (e) { alert('Toggle failed: ' + e.message); loadRoutines(); }
      });
    });

    list.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const action = btn.dataset.action;
        if (action === 'run') {
          btn.disabled = true; btn.textContent = 'Running…';
          try {
            await apiFetch('/api/routines/' + encodeURIComponent(id) + '/run', { method: 'POST' });
            setTimeout(loadRoutines, 1500);
          } catch (e) { alert('Run failed: ' + e.message); }
          finally { btn.disabled = false; btn.textContent = 'Run now'; }
        }
        if (action === 'edit')   openRoutineModal(id);
        if (action === 'view')   viewRoutineDetail(id);
        if (action === 'delete') {
          if (!confirm('Delete this routine?')) return;
          try {
            await apiFetch('/api/routines/' + encodeURIComponent(id), { method: 'DELETE' });
            loadRoutines();
          } catch (e) { alert('Delete failed: ' + e.message); }
        }
      });
    });
  } catch (e) {
    list.innerHTML = `<div class="routine-card-empty" style="color:var(--red)">${escapeHtml(e.message)}</div>`;
  }
}

async function viewRoutineDetail(id) {
  try {
    const data = await apiFetch('/api/routines/' + encodeURIComponent(id));
    document.getElementById('routines-list-view').classList.add('hidden');
    document.getElementById('routine-detail-view').classList.remove('hidden');
    document.getElementById('routine-detail-name').textContent = data.name;
    document.getElementById('routine-detail-meta').textContent =
      `${data.cron_expr} · ${data.enabled ? 'Enabled' : 'Disabled'} · last run: ${data.last_run_at ? fmtAge(data.last_run_at) : 'never'}`;
    document.getElementById('routine-detail-output').textContent = data.last_run_output || '(no output yet)';
    const runs = data.runs || [];
    const runsList = document.getElementById('routine-runs-list');
    if (!runs.length) {
      runsList.innerHTML = '<div style="color:var(--dimmer);font-size:12px">No runs yet</div>';
    } else {
      runsList.innerHTML = runs.map(r => `
        <div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;display:flex;gap:14px;align-items:center">
          <span class="routine-card-status ${escapeHtml(r.status)}">${escapeHtml(r.status)}</span>
          <span style="color:var(--dim)">${fmtAge(r.started_at)}</span>
          <span style="color:var(--dimmer)">${r.completed_at ? 'completed ' + fmtAge(r.completed_at) : 'in progress'}</span>
        </div>
      `).join('');
    }
  } catch (e) { alert('Failed to load: ' + e.message); }
}

document.getElementById('routine-back-btn')?.addEventListener('click', loadRoutines);

const routineModal = document.getElementById('routine-modal');
function openRoutineModal(id = null) {
  _editingRoutineId = id;
  document.getElementById('routine-modal-title').textContent = id ? 'Edit routine' : 'New routine';
  if (id) {
    const r = _routines.find(x => x.id === id);
    if (r) {
      document.getElementById('routine-name').value   = r.name;
      document.getElementById('routine-desc').value   = r.description || '';
      document.getElementById('routine-prompt').value = r.prompt;
      document.getElementById('routine-cron').value   = r.cron_expr;
    }
  } else {
    document.getElementById('routine-name').value   = '';
    document.getElementById('routine-desc').value   = '';
    document.getElementById('routine-prompt').value = '';
    document.getElementById('routine-cron').value   = '0 8 * * *';
  }
  routineModal.style.display = 'flex';
  document.getElementById('routine-name').focus();
}
function closeRoutineModal() { routineModal.style.display = 'none'; }

document.getElementById('new-routine-btn')?.addEventListener('click', () => openRoutineModal());
document.getElementById('routine-modal-close')?.addEventListener('click', closeRoutineModal);
document.getElementById('routine-cancel')?.addEventListener('click', closeRoutineModal);
routineModal?.addEventListener('click', e => { if (e.target === routineModal) closeRoutineModal(); });

document.getElementById('routine-save')?.addEventListener('click', async () => {
  const body = {
    name:        document.getElementById('routine-name').value.trim(),
    description: document.getElementById('routine-desc').value.trim(),
    prompt:      document.getElementById('routine-prompt').value.trim(),
    cron_expr:   document.getElementById('routine-cron').value.trim(),
  };
  if (!body.name || !body.prompt || !body.cron_expr) {
    alert('Name, prompt, and schedule are required');
    return;
  }
  const btn = document.getElementById('routine-save');
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = 'Saving…';
  try {
    if (_editingRoutineId) {
      await apiFetch('/api/routines/' + encodeURIComponent(_editingRoutineId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } else {
      await apiFetch('/api/routines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
    closeRoutineModal();
    loadRoutines();
  } catch (e) {
    alert('Save failed: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
});

// ── SETTINGS PANEL ────────────────────────────────────────────────────────────
// Tab switching (new sub-sidebar)
document.querySelectorAll('.settings-nav-item').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.settings-nav-item').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#panel-settings .settings-tab-body').forEach(b => {
      b.classList.remove('active');
      b.style.display = 'none';
    });
    tab.classList.add('active');
    const body = document.getElementById('stab-' + tab.dataset.stab);
    if (body) {
      body.classList.add('active');
      body.style.display = 'block';
    }
    if (tab.dataset.stab === 'capabilities') {
      loadMemoryPreview();
    }
  });
});

async function loadMemoryPreview() {
  try {
    const mems = await apiFetch('/api/memories');
    const meta = document.getElementById('memory-preview-meta');
    const list = document.getElementById('memory-preview-list');
    if (meta) meta.textContent = `${mems.length} memor${mems.length === 1 ? 'y' : 'ies'}`;
    if (list) {
      const top = mems.slice(0, 5);
      list.innerHTML = top.length
        ? top.map(m => `<div class="memory-preview-item">${escapeHtml(m.content)}</div>`).join('')
        : '<div class="memory-preview-item" style="color:var(--dimmer)">No memories yet — chat with NOVA and they\'ll appear here.</div>';
    }
  } catch {}
}

document.getElementById('memory-view-all-btn')?.addEventListener('click', () => {
  switchPanel('memory');
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
    setField('GROQ_API_KEY',             cfg.GROQ_API_KEY);
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
    setField('PROFILE_NAME',             cfg.PROFILE_NAME);
    setField('PROFILE_BACKGROUND',       cfg.PROFILE_BACKGROUND);
    setField('PROFILE_STYLE',            cfg.PROFILE_STYLE);
    setField('PROFILE_FULL_NAME',        cfg.PROFILE_FULL_NAME);
    setField('PROFILE_NICKNAME',         cfg.PROFILE_NICKNAME);
    setField('PROFILE_WORK',             cfg.PROFILE_WORK);
    setField('PROFILE_PREFERENCES',      cfg.PROFILE_PREFERENCES);

    // Boolean toggles
    const setCheck = (id, val) => { const el = document.getElementById('cfg-' + id); if (el) el.checked = (String(val) === 'on' || val === true); };
    setCheck('NOTIFY_COMPLETIONS', cfg.NOTIFY_COMPLETIONS);
    setCheck('MEMORY_SEARCH',     cfg.MEMORY_SEARCH);
    setCheck('MEMORY_GENERATE',   cfg.MEMORY_GENERATE);
    setCheck('ARTIFACTS',         cfg.ARTIFACTS);

    // Expose nickname for welcome greeting
    window.userPreferredName = cfg.PROFILE_NICKNAME || cfg.PROFILE_NAME || 'Jimmy';
    if (typeof updateWelcomeGreeting === 'function') updateWelcomeGreeting();

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
      groq:       'Very fast inference (~500 tok/s). Generous free tier, no card needed.',
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
    'OPENROUTER_API_KEY','ANTHROPIC_API_KEY','GROQ_API_KEY','DATABASE_TYPE','PGLITE_PATH','SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY','NOVA_WORKSPACE_PATH','GOOGLE_CREDENTIALS_PATH',
    'NOTION_API_KEY','WEB_SEARCH_API_KEY','OPENWEATHER_API_KEY',
    'TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','NOVA_WORKFLOWS',
    'PROFILE_NAME','PROFILE_BACKGROUND','PROFILE_STYLE',
    'PROFILE_FULL_NAME','PROFILE_NICKNAME','PROFILE_WORK','PROFILE_PREFERENCES',
  ];
  const body = {};
  for (const f of fields) {
    const el = document.getElementById('cfg-' + f);
    if (el) body[f] = el.value;
  }
  // Boolean toggles → 'on'/'off' strings
  for (const f of ['NOTIFY_COMPLETIONS','MEMORY_SEARCH','MEMORY_GENERATE','ARTIFACTS']) {
    const el = document.getElementById('cfg-' + f);
    if (el && 'checked' in el) body[f] = el.checked ? 'on' : 'off';
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

// ── + menu submenus (Item 6) ──────────────────────────────────────────────────
function openPlusSubmenu(triggerId, submenuId, populateFn) {
  const trigger = document.getElementById(triggerId);
  const submenu = document.getElementById(submenuId);
  if (!trigger || !submenu) return;
  document.querySelectorAll('.plus-submenu').forEach(s => s.classList.add('hidden'));
  const rect = trigger.getBoundingClientRect();
  populateFn();
  submenu.style.left = (rect.right + 4) + 'px';
  submenu.style.top  = rect.top + 'px';
  submenu.classList.remove('hidden');
}

function closePlusSubmenus() {
  document.querySelectorAll('.plus-submenu').forEach(s => s.classList.add('hidden'));
}

document.getElementById('plus-add-to-project')?.addEventListener('click', e => {
  e.stopPropagation();
  openPlusSubmenu('plus-add-to-project', 'plus-submenu-projects', async () => {
    const sm = document.getElementById('plus-submenu-projects');
    sm.innerHTML = '<div class="popover-section-label">Loading…</div>';
    try {
      const projects = await apiFetch('/api/projects');
      sm.innerHTML = projects.map(p =>
        `<button class="popover-item" data-project-id="${escapeHtml(p.id)}"><span class="popover-icon">📁</span>${escapeHtml(p.name)}</button>`
      ).join('') + '<div class="plus-divider"></div><button class="popover-item" id="plus-start-project">+ Start a new project</button>';
      sm.querySelectorAll('[data-project-id]').forEach(btn => {
        btn.addEventListener('click', () => {
          sessionStorage.setItem('nova:active-project', btn.dataset.projectId);
          alert('Linked to project (will apply to your next new chat).');
          closePlusMenu();
          closePlusSubmenus();
        });
      });
      document.getElementById('plus-start-project')?.addEventListener('click', () => {
        closePlusMenu();
        closePlusSubmenus();
        switchPanel('workspace');
        document.getElementById('new-project-btn')?.click();
      });
    } catch {
      sm.innerHTML = '<div class="popover-section-label">Failed to load</div>';
    }
  });
});

document.getElementById('plus-skills')?.addEventListener('click', e => {
  e.stopPropagation();
  openPlusSubmenu('plus-skills', 'plus-submenu-skills', async () => {
    const sm = document.getElementById('plus-submenu-skills');
    sm.innerHTML = '<div class="popover-section-label">Loading…</div>';
    try {
      const skills = await apiFetch('/api/skills');
      sm.innerHTML = (skills.length
        ? skills.map(s => `<button class="popover-item"><span class="popover-icon">📜</span>${escapeHtml(s.name)}</button>`).join('')
        : '<div class="popover-section-label">No skills yet</div>'
      ) + '<div class="plus-divider"></div><button class="popover-item" id="plus-manage-skills">📂 Manage skills</button>';
      document.getElementById('plus-manage-skills')?.addEventListener('click', () => {
        closePlusMenu(); closePlusSubmenus();
        switchPanel('customize');
        const skillsTab = document.querySelector('.customize-nav-item[data-cstab="skills"]');
        skillsTab?.click();
      });
    } catch {
      sm.innerHTML = '<div class="popover-section-label">Failed to load</div>';
    }
  });
});

document.getElementById('plus-connectors')?.addEventListener('click', e => {
  e.stopPropagation();
  openPlusSubmenu('plus-connectors', 'plus-submenu-connectors', async () => {
    const sm = document.getElementById('plus-submenu-connectors');
    try {
      const cfg = await apiFetch('/api/settings');
      const connectors = [
        { key: 'NOTION_API_KEY',          name: 'Notion' },
        { key: 'WEB_SEARCH_API_KEY',      name: 'Web Search' },
        { key: 'OPENWEATHER_API_KEY',     name: 'Weather' },
        { key: 'TELEGRAM_BOT_TOKEN',      name: 'Telegram' },
        { key: 'GOOGLE_CREDENTIALS_PATH', name: 'Google' },
      ];
      sm.innerHTML = connectors.map(c => {
        const connected = cfg[c.key] && String(cfg[c.key]).length > 0;
        return `<button class="popover-item"><span class="popover-icon">${connected ? '🟢' : '⚫'}</span>${escapeHtml(c.name)}</button>`;
      }).join('') + '<div class="plus-divider"></div><button class="popover-item" id="plus-manage-connectors">📂 Manage connectors</button>';
      document.getElementById('plus-manage-connectors')?.addEventListener('click', () => {
        closePlusMenu(); closePlusSubmenus();
        switchPanel('customize');
        document.querySelector('.customize-nav-item[data-cstab="connectors"]')?.click();
      });
    } catch {}
  });
});

document.getElementById('plus-use-style')?.addEventListener('click', e => {
  e.stopPropagation();
  const trigger = document.getElementById('plus-use-style');
  const submenu = document.getElementById('plus-submenu-styles');
  document.querySelectorAll('.plus-submenu').forEach(s => s.classList.add('hidden'));
  const cur = localStorage.getItem('nova:style') || 'normal';
  submenu.querySelectorAll('.style-option').forEach(o => o.classList.toggle('active', o.dataset.style === cur));
  const rect = trigger.getBoundingClientRect();
  submenu.style.left = (rect.right + 4) + 'px';
  submenu.style.top  = rect.top + 'px';
  submenu.classList.remove('hidden');
});

document.querySelectorAll('.style-option').forEach(opt => {
  opt.addEventListener('click', e => {
    e.stopPropagation();
    localStorage.setItem('nova:style', opt.dataset.style);
    closePlusSubmenus();
    closePlusMenu();
  });
});

// Web search toggle
const webSearchBtn = document.getElementById('plus-web-search');
if (webSearchBtn) {
  // Initialize visual state
  const cur = localStorage.getItem('nova:web-search') !== 'off';
  document.getElementById('plus-web-search-mark')?.classList.toggle('off', !cur);
  webSearchBtn.addEventListener('click', e => {
    e.stopPropagation();
    const isOn = localStorage.getItem('nova:web-search') !== 'off';
    localStorage.setItem('nova:web-search', isOn ? 'off' : 'on');
    document.getElementById('plus-web-search-mark')?.classList.toggle('off', isOn);
  });
}

// Close submenus when outer click
document.addEventListener('click', () => closePlusSubmenus());

// ── Customize panel (Item 10) ─────────────────────────────────────────────────
function switchCustomizeTab(name) {
  document.querySelectorAll('.customize-nav-item').forEach(t => t.classList.toggle('active', t.dataset.cstab === name));
  document.querySelectorAll('.customize-tab-body').forEach(b => b.style.display = 'none');
  const body = document.getElementById('customize-' + name);
  if (body) body.style.display = '';
  if (name === 'skills') loadCustomizeSkills();
  if (name === 'connectors') loadCustomizeConnectors();
}

document.querySelectorAll('.customize-nav-item').forEach(item => {
  item.addEventListener('click', () => switchCustomizeTab(item.dataset.cstab));
});

document.querySelectorAll('.customize-action-card').forEach(card => {
  card.addEventListener('click', () => switchCustomizeTab(card.dataset.cstab));
});

function loadCustomize() {
  switchCustomizeTab('landing');
}

async function loadCustomizeSkills() {
  const list = document.getElementById('customize-skills-list');
  if (!list) return;
  list.innerHTML = '<div class="customize-list-section-label">Loading…</div>';
  try {
    const skills = await apiFetch('/api/skills');
    if (!skills.length) {
      list.innerHTML = '<div style="padding:10px;color:var(--dimmer);font-size:12px">No skills yet</div>';
      return;
    }
    list.innerHTML = skills.map(s =>
      `<div class="customize-list-item" data-skill="${escapeHtml(s.path)}">📜 ${escapeHtml(s.name)}</div>`
    ).join('');
    list.querySelectorAll('.customize-list-item').forEach(item => {
      item.addEventListener('click', async () => {
        list.querySelectorAll('.customize-list-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        const detail = document.getElementById('customize-skill-detail');
        detail.innerHTML = '<div class="customize-detail-empty">Loading…</div>';
        try {
          const data = await apiFetch('/api/workspace/' + item.dataset.skill);
          detail.innerHTML = `<div class="customize-skill-content">${escapeHtml(data.content)}</div>`;
        } catch (e) {
          detail.innerHTML = `<div class="customize-detail-empty" style="color:var(--red)">Failed: ${escapeHtml(e.message)}</div>`;
        }
      });
    });
  } catch {
    list.innerHTML = '<div style="padding:10px;color:var(--red);font-size:12px">Failed to load</div>';
  }
}

async function showConnectorDetail(envKeyOrId) {
  const detail = document.getElementById('customize-connector-detail');
  if (!detail) return;
  detail.innerHTML = '<div style="padding:24px">Loading…</div>';
  try {
    const catalog = await apiFetch('/api/connectors/catalog');
    // Match by id first, fall back to envKey lookup
    let def = catalog.find(c => c.id === envKeyOrId);
    if (!def) def = catalog.find(c => c.envKey === envKeyOrId);
    if (!def) {
      detail.innerHTML = `<div style="padding:24px;color:var(--dim)">No tool catalog defined for "${escapeHtml(envKeyOrId)}". Manage credentials in Settings → Integrations.</div>`;
      return;
    }

    const tools = await apiFetch('/api/connectors/' + encodeURIComponent(def.id) + '/permissions');
    const cfg = await apiFetch('/api/settings');
    const isConnected = cfg[def.envKey] && String(cfg[def.envKey]).length > 0;

    const readTools = tools.filter(t => t.type === 'read');
    const writeTools = tools.filter(t => t.type !== 'read');

    detail.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px">
        <div>
          <h2 style="font-size:18px;font-weight:600;margin:0 0 4px">${escapeHtml(def.name)}</h2>
          <div style="font-size:12.5px;color:var(--dim);margin-top:2px">${escapeHtml(def.description)}</div>
        </div>
        <button class="btn btn-sm" id="cstm-conn-toggle">${isConnected ? 'Disconnect' : 'Connect'}</button>
      </div>

      <h3 style="font-size:12px;font-weight:600;color:var(--dim);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px">Tool permissions</h3>
      <div style="font-size:12px;color:var(--dim);margin-bottom:16px">Choose when NOVA is allowed to use these tools.</div>

      ${readTools.length ? `
        <div class="tool-permissions-section">
          <div class="tool-perms-header">Read-only tools <span class="tool-perms-count">${readTools.length}</span></div>
          ${readTools.map(t => permissionRowHtml(def.id, t)).join('')}
        </div>
      ` : ''}

      ${writeTools.length ? `
        <div class="tool-permissions-section">
          <div class="tool-perms-header">Write/delete tools <span class="tool-perms-count">${writeTools.length}</span></div>
          ${writeTools.map(t => permissionRowHtml(def.id, t)).join('')}
        </div>
      ` : ''}
    `;

    document.getElementById('cstm-conn-toggle')?.addEventListener('click', () => {
      const oldBtn = document.querySelector(`.connect-btn[data-key="${def.envKey}"]`);
      if (oldBtn) oldBtn.click();
      else {
        switchPanel('settings');
        document.querySelector('.settings-nav-item[data-stab="integrations"]')?.click();
      }
    });

    detail.querySelectorAll('.tool-perm-select').forEach(sel => {
      sel.addEventListener('change', async () => {
        try {
          await apiFetch('/api/connectors/' + encodeURIComponent(def.id) + '/permissions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tool: sel.dataset.tool, permission: sel.value }),
          });
        } catch (err) { alert('Save failed: ' + err.message); }
      });
    });
  } catch (e) {
    detail.innerHTML = `<div style="padding:24px;color:var(--red)">Failed: ${escapeHtml(e.message)}</div>`;
  }
}

function permissionRowHtml(connectorId, t) {
  return `
    <div class="tool-perm-row">
      <div>
        <div class="tool-perm-name">${escapeHtml(t.description)}</div>
        <div class="tool-perm-id">${escapeHtml(t.name)}</div>
      </div>
      <select class="tool-perm-select" data-tool="${escapeHtml(t.name)}">
        <option value="always-allow" ${t.permission === 'always-allow' ? 'selected' : ''}>Always allow</option>
        <option value="needs-approval" ${t.permission === 'needs-approval' ? 'selected' : ''}>Needs approval</option>
        <option value="never" ${t.permission === 'never' ? 'selected' : ''}>Never</option>
      </select>
    </div>
  `;
}

async function loadCustomizeConnectors() {
  const connectedEl = document.getElementById('customize-connected-list');
  const disconnectedEl = document.getElementById('customize-disconnected-list');
  if (!connectedEl || !disconnectedEl) return;
  try {
    const cfg = await apiFetch('/api/settings');
    const connectors = [
      { key: 'NOTION_API_KEY',          name: 'Notion',          icon: '📓' },
      { key: 'GOOGLE_CREDENTIALS_PATH', name: 'Google',          icon: '📅' },
      { key: 'WEB_SEARCH_API_KEY',      name: 'Web Search',      icon: '🔍' },
      { key: 'OPENWEATHER_API_KEY',     name: 'OpenWeather',     icon: '☀️' },
      { key: 'TELEGRAM_BOT_TOKEN',      name: 'Telegram',        icon: '✈️' },
    ];
    const connected = connectors.filter(c => cfg[c.key] && String(cfg[c.key]).length > 0);
    const disconnected = connectors.filter(c => !(cfg[c.key] && String(cfg[c.key]).length > 0));
    const renderItem = c => `<div class="customize-list-item" data-key="${escapeHtml(c.key)}">${c.icon} ${escapeHtml(c.name)}</div>`;
    connectedEl.innerHTML = connected.length ? connected.map(renderItem).join('') : '<div style="padding:6px 10px;color:var(--dimmer);font-size:12px">None</div>';
    disconnectedEl.innerHTML = disconnected.length ? disconnected.map(renderItem).join('') : '<div style="padding:6px 10px;color:var(--dimmer);font-size:12px">All connected</div>';

    document.querySelectorAll('#customize-connectors .customize-list-item').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('#customize-connectors .customize-list-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        showConnectorDetail(item.dataset.key);
      });
    });
  } catch {
    connectedEl.innerHTML = '<div style="padding:6px 10px;color:var(--red);font-size:12px">Failed to load</div>';
  }
}

// ── Voice button wiring ───────────────────────────────────────────────────────
document.getElementById('chat-voice-btn')?.addEventListener('click', startVoiceInput);
document.getElementById('voice-output-toggle')?.addEventListener('click', () => {
  setVoiceOutput(!isVoiceOutputOn());
});
// Restore persisted voice-output toggle on load
setVoiceOutput(isVoiceOutputOn());

// ── Boot ──────────────────────────────────────────────────────────────────────
connectWS();
switchPanel('chat');
loadStatus(); // pre-load so status tab is instant
// Pull profile early so welcome greeting picks up the right name
loadSettings().catch(() => {});
