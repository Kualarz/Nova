# NOVA Phase 2 — "Free, Always-On, Self-Aware NOVA"
**Design Document — 2026-04-22**

---

## 1. Overview & Goals

Phase 1 delivered a terminal chat ally with durable three-tier memory and a set of tools. It worked — but it requires a paid Anthropic API, only runs when manually launched, and has no voice or visual presence.

Phase 2 transforms NOVA into something fundamentally different: a free, optionally always-on desktop companion that listens for your voice, speaks back, proactively checks in, manages its own skills, and gives you a web dashboard to control everything. It runs entirely on your hardware — no API bills for daily use.

**Phase 2 Goals:**
- Replace all paid AI APIs with free local alternatives (Ollama)
- NOVA can auto-start with Windows — **user-controlled, off by default**
- Full voice conversation (speak to it, it speaks back)
- Proactive — NOVA initiates check-ins, reminders, and alerts
- Skills system — capabilities as loadable markdown files (same concept Claude Code uses)
- GraphRAG memory — richer retrieval via knowledge graph
- Web dashboard — chat, model switching, settings, activity feed
- Database abstraction — local SQLite (zero setup) or cloud Supabase
- Self-aware — NOVA detects broken tools and updates its own skills
- Built so anyone can open source and self-host it with zero accounts

**Success criteria:** Jimmy wakes up, NOVA has already prepared his morning briefing. He speaks to it, it responds. He opens the web dashboard and switches to a paid model for a complex task. He closes his laptop — NOVA queued a background task while he was away.

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  UI LAYER                                                         │
│                                                                   │
│  Electron Desktop App              Web Dashboard (Next.js)        │
│  ├── System tray icon              ├── Chat interface             │
│  ├── Floating overlay window       ├── Model switcher            │
│  └── Voice status indicator        ├── Settings (tools, voice)   │
│                                    ├── Routines manager          │
│                                    ├── Activity feed             │
│                                    └── Reasoning traces          │
└──────────────┬───────────────────────────────┬───────────────────┘
               │ Electron IPC                  │ HTTP (localhost:3001)
┌──────────────▼───────────────────────────────▼───────────────────┐
│  CORE LAYER  (Node.js / TypeScript — Electron main process)       │
│                                                                   │
│  Agent Loop          Skills System        Automation              │
│  ├── ReAct reasoning ├── Skill loader     ├── Routines (cron)    │
│  ├── Streaming       ├── Tool registry    ├── Dispatch queue     │
│  └── Session mgmt   └── Custom tools     ├── Hooks engine       │
│                                           └── Heartbeat loop     │
│  Memory Layer        Voice Pipeline       Self-Awareness         │
│  ├── Tier 1-3 (P1)  ├── Whisper STT      ├── Self-diagnosis     │
│  ├── GraphRAG        ├── Piper TTS        └── Skill self-update  │
│  ├── Memory bump     └── Mode manager                            │
│  ├── Dreaming                                                     │
│  └── Self-reflection  API Server (Express — localhost:3001)       │
│                                                                   │
│  ModelRouter                       DatabaseProvider               │
│  ├── OllamaProvider                ├── SQLiteProvider (local)    │
│  └── OpenRouterProvider            └── SupabaseProvider (cloud)  │
└──────────────┬───────────────────────────────────────────────────┘
               │ HTTP / child_process / IPC
┌──────────────▼───────────────────────────────────────────────────┐
│  LOCAL AI LAYER  (external processes on your machine)             │
│                                                                   │
│  Ollama                Whisper.cpp             Piper TTS          │
│  ├── qwen2.5:7b        └── speech → text       └── text → speech │
│  ├── nomic-embed-text                                             │
│  └── any other model                                             │
└──────────────────────────────────────────────────────────────────┘
```

**What changes from Phase 1:**

| Component | Phase 1 | Phase 2 |
|---|---|---|
| AI brain | Anthropic Claude API (paid) | Ollama local (free) |
| Embeddings | OpenAI API (paid) | nomic-embed-text via Ollama (free) |
| Extra models | None | Any model via OpenRouter (optional paid) |
| Interface | Terminal REPL | Electron tray + overlay + web dashboard |
| Voice | None | Whisper STT + Piper TTS, three modes |
| Startup | Manual `npm run nova` | Windows auto-start |
| Proactive | None | Heartbeat loop + routines + dreaming |
| Memory retrieval | Vector similarity only | GraphRAG (vector + graph traversal) |
| Skills | Hardcoded tools | Markdown skill files, loaded on demand |
| Database | Supabase only | SQLiteProvider or SupabaseProvider |

**What stays the same:** Three-tier memory architecture, workspace files (SOUL.md, USER.md, MEMORY.md, AGENTS.md), tool registry pattern, reversibility rules, Supabase schema (extended, not replaced).

---

## 3. ModelRouter — Universal AI Provider

### Purpose
Decouple NOVA's agent loop from any specific AI provider. NOVA calls `modelRouter.chat(messages)` — the router handles where to send it.

### Providers

**OllamaProvider** — Free, local, always available
- Endpoint: `http://localhost:11434/api/chat`
- Models: `qwen2.5:7b` (default brain), `nomic-embed-text` (embeddings), any Ollama model
- Zero cost, works offline, no accounts

**OpenRouterProvider** — Any cloud model, one API key
- Endpoint: `https://openrouter.ai/api/v1` (OpenAI-compatible)
- Models: `anthropic/claude-opus-4-7`, `openai/gpt-4o`, `google/gemini-2.0-flash`, `deepseek/deepseek-r1`, 200+ more
- Pay per token, no subscriptions. DeepSeek R1 costs 95% less than Claude Opus.
- Optional — NOVA works without it. User adds `OPENROUTER_API_KEY` to .env to unlock.

### Multi-Model Routing

NOVA routes requests to different models based on task type:

```
Task type              → Model
─────────────────────────────────────
Quick chat / daily     → qwen2.5:7b (Ollama, free)
Complex reasoning      → qwen2.5:14b or openrouter model (if key set)
Embeddings             → nomic-embed-text (Ollama, free)
Skill self-update      → qwen2.5:7b (fast, local)
Dreaming / reflection  → qwen2.5:7b (runs at night, free)
```

User can override routing from the web dashboard at any time.

### File Structure
```
src/
└── providers/
    ├── interface.ts          ← LLMProvider interface
    ├── ollama.ts             ← OllamaProvider
    ├── openrouter.ts         ← OpenRouterProvider
    └── router.ts             ← ModelRouter (reads config, picks provider)
```

### Config (.env)
```
MODEL_PROVIDER=ollama             # default
DEFAULT_MODEL=qwen2.5:7b
COMPLEX_MODEL=qwen2.5:14b         # optional, falls back to DEFAULT_MODEL
OPENROUTER_API_KEY=               # optional — unlocks paid models
```

---

## 4. Database Layer — DatabaseProvider Abstraction

### Purpose
NOVA works out of the box with zero accounts (SQLite). Users who want cloud sync or have existing Supabase projects switch with one env var.

### Providers

**SQLiteProvider** — Local default, zero setup
- Engine: `better-sqlite3` + `sqlite-vec` extension (vector search)
- Database file: `workspace/nova.db` (single file, easy to backup)
- No server, no Docker, no account, works offline forever
- Same query interface as SupabaseProvider — no code differences elsewhere

**SupabaseProvider** — Cloud, Jimmy's existing setup
- Existing Supabase project + pgvector (Phase 1 setup)
- Used when `DATABASE_TYPE=supabase` in .env

### New Tables (added to both providers)

```sql
-- Memory graph edges (GraphRAG)
CREATE TABLE memory_connections (
  id          TEXT PRIMARY KEY,
  memory_a_id TEXT NOT NULL REFERENCES memories(id),
  memory_b_id TEXT NOT NULL REFERENCES memories(id),
  similarity  REAL NOT NULL,           -- cosine similarity score
  type        TEXT NOT NULL DEFAULT 'semantic', -- semantic | temporal | causal
  created_at  TEXT NOT NULL
);

-- Routines
CREATE TABLE routines (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  cron        TEXT NOT NULL,           -- cron expression e.g. "0 8 * * *"
  prompt      TEXT NOT NULL,           -- what NOVA does when triggered
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_run    TEXT,
  created_at  TEXT NOT NULL
);

-- Dispatch queue
CREATE TABLE dispatch_queue (
  id          TEXT PRIMARY KEY,
  prompt      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | running | done | failed
  result      TEXT,
  created_at  TEXT NOT NULL,
  completed_at TEXT
);

-- Hooks
CREATE TABLE hooks (
  id          TEXT PRIMARY KEY,
  event       TEXT NOT NULL,           -- session.start | tool.before | tool.after | session.end
  skill_name  TEXT NOT NULL,           -- which skill handles this hook
  enabled     INTEGER NOT NULL DEFAULT 1
);

-- Accountability log
CREATE TABLE action_log (
  id          TEXT PRIMARY KEY,
  session_id  TEXT,
  tool_name   TEXT,
  input       TEXT,                    -- JSON
  output      TEXT,
  reversible  INTEGER NOT NULL,
  approved    INTEGER,                 -- null = auto, 1 = user approved, 0 = rejected
  created_at  TEXT NOT NULL
);
```

### File Structure
```
src/db/
├── interface.ts              ← DatabaseProvider interface
├── client.ts                 ← reads DATABASE_TYPE, exports active provider
├── providers/
│   ├── sqlite.ts             ← SQLiteProvider (better-sqlite3 + sqlite-vec)
│   └── supabase.ts           ← SupabaseProvider (existing Phase 1 client)
└── migrations/
    ├── 001_phase1_schema.sql
    └── 002_phase2_schema.sql ← new tables above
```

### Config (.env)
```
DATABASE_TYPE=sqlite           # local default (zero setup)
DATABASE_TYPE=supabase         # cloud (requires SUPABASE_URL + key)
```

---

## 5. Memory System Upgrades

Phase 1 built the three-tier memory architecture. Phase 2 adds three upgrades on top.

### 5a. GraphRAG — Knowledge Graph Retrieval

**What changes:** When a memory is stored, NOVA computes its cosine similarity against the 50 most recent memories. Any pair scoring above 0.75 gets an edge inserted into `memory_connections`. Retrieval now runs in two stages:

1. **Seed**: Vector similarity search returns top-3 directly relevant memories
2. **Expand**: Graph traversal follows edges from each seed (1 hop) — returns connected memories
3. **Rerank**: Combined results reranked by (similarity × 0.6) + (recency × 0.4)

Result: asking about "Feast AI" returns the Feast AI memory AND automatically surfaces connected memories (Next.js setup notes, Claude integration, Supabase config) without the user needing to ask about them explicitly.

**Files:**
```
src/memory/
├── graph.ts          ← buildEdges(), traverseGraph(), getConnected()
└── store.ts          ← modified: insertMemory() calls buildEdges() after insert
                         findSimilar() upgraded to graphRagSearch()
```

### 5b. Memory Bump

When a memory is accessed (retrieved and included in context), its `accessed_at` timestamp updates and its recency score increases. Frequently-recalled memories stay in reach; unused memories naturally fade. One-line change to `findSimilar()` — fire-and-forget update after retrieval.

### 5c. Dreaming — Nightly Memory Consolidation

A background process that runs at 3am (configurable). NOVA reviews the last 7 days of daily notes and Tier 3 memories, identifies patterns and important signals, and promotes key facts to MEMORY.md (Tier 1). It also supersedes contradictory memories and prunes very low-confidence entries.

```
src/memory/
└── dream.ts          ← runDream() — called by the scheduler at 3am
```

### 5d. Self-Reflection — Post-Session Learning

At the end of every conversation session (Ctrl+C or explicit goodbye), NOVA runs a brief reflection pass: reviews the conversation, extracts new facts about Jimmy, and stores them via `insertMemory()`. This already existed in a basic form in Phase 1 — Phase 2 makes it more structured with an extraction prompt tuned to find preferences, project updates, and corrections.

---

## 6. Skills System

### Concept
Borrowed from OpenClaw. Each NOVA capability is a `.md` file with YAML frontmatter. NOVA loads skill metadata at startup (cheap — just the frontmatter). Full skill content is loaded only when the skill is triggered. This keeps the system prompt small and lets Jimmy add or modify capabilities by editing a markdown file.

### Skill File Format
```markdown
---
name: web-search
description: Search the web for current information, recent events, or anything outside training data
triggers:
  - search
  - look up
  - find
  - what is
tools:
  - web_search
reversible: true
---

# Web Search

Use this skill when the user asks about current events, recent news, facts that
may have changed, or anything you are not confident about from training data.

Always cite the source URL. Return the top 3 results with title, URL, and a
1-sentence summary of each.
```

### Skill Loading
```
workspace/
└── skills/
    ├── web-search.md
    ├── calendar.md
    ├── notion.md
    ├── gmail.md
    ├── weather.md
    ├── news.md
    ├── dispatch.md
    └── self-update.md     ← NOVA updates its own skills
```

### Skill Loader
`src/skills/loader.ts` — reads all `.md` files from `workspace/skills/`, parses frontmatter, builds the skill registry. Skills listed to Claude as tool descriptions; full content injected into system prompt only when a matching tool is called.

### Self-Update Skill
A special skill that allows NOVA to rewrite its own skill files when they become outdated or incorrect. NOVA proposes the change, you approve, it writes the file. This is how NOVA improves its own capabilities without requiring a code deployment.

---

## 7. Automation Engine

### 7a. Routines (Scheduled Tasks)

Routines are cron-scheduled prompts stored in the `routines` table. Examples:

```
Every day at 8:00am   → "Give me a morning briefing: weather, calendar for today, top news headlines"
Every Monday at 9:00am → "Review my week ahead and suggest priorities"
Every day at 6:00pm   → "Summarize what I accomplished today based on our conversations"
```

Managed via web dashboard. NOVA speaks the result aloud (TTS) and shows it in the overlay if the user is at the computer; queues it as a notification otherwise.

**File:** `src/automation/routines.ts` — uses `node-cron`, reads `routines` table, fires prompts through the agent loop.

### 7b. Dispatch Queue (Background Tasks)

Dispatch lets you give NOVA a task that runs asynchronously in the background without interrupting your current conversation. Example: "dispatch: research the top 5 Python web frameworks and save a summary to my Notion ideas page."

NOVA inserts the task into `dispatch_queue`, picks it up in a background worker, runs the full agent loop with tools, saves the result. You can check status from the web dashboard.

**File:** `src/automation/dispatch.ts` — worker polls `dispatch_queue` every 30 seconds for pending tasks.

### 7c. Hooks Engine

Hooks are event-driven skill triggers — the same concept Claude Code uses. When a specific event fires, NOVA automatically runs the associated skill.

| Event | Example use |
|---|---|
| `session.start` | Load today's calendar, check for urgent emails |
| `session.end` | Run self-reflection, update daily note |
| `tool.before` | Log every tool call to accountability log |
| `tool.after` | Check if tool result contains a memory-worthy fact |
| `routine.fire` | Pre-warm model before scheduled routine runs |

Hooks stored in the `hooks` table. Managed from web dashboard.

**File:** `src/automation/hooks.ts` — `fireHook(event, context)` — looks up enabled hooks for the event and runs the skill.

### 7d. Heartbeat Loop

The heartbeat runs every 10 minutes while NOVA is awake. It checks:
- Any calendar events in the next 30 minutes?
- Any overdue routines?
- Any completed dispatch tasks to report?
- Anything NOVA wants to proactively mention (based on recent memory)?

If nothing is urgent, the heartbeat returns a **NO_REPLY sentinel** and stays silent. This prevents NOVA from being noisy. If something is worth saying, it speaks via TTS and shows the overlay.

**File:** `src/automation/heartbeat.ts` — `runHeartbeat()` called by a 10-minute interval in the Electron main process.

---

## 8. Desktop App — Electron Shell

### Structure
```
electron/
├── main.ts               ← Electron entry point, app lifecycle, IPC handlers
├── tray.ts               ← System tray icon + context menu
├── overlay.ts            ← Floating overlay window (frameless, always-on-top)
├── voice-manager.ts      ← Coordinates STT/TTS + mode switching
└── preload.ts            ← IPC bridge for renderer

renderer/                 ← Overlay UI (HTML/CSS/TS)
├── overlay.html
├── overlay.css
└── overlay.ts
```

### System Tray
- Icon in Windows taskbar notification area
- Right-click menu: Open Dashboard | Mute | Pause Heartbeat | Switch Model | Settings | Quit
- Icon state: normal | listening (animated) | speaking (animated) | thinking (animated)

### Floating Overlay
- Frameless, transparent-background window, always on top
- Appears when NOVA speaks (heartbeat message, routine result, alert)
- Appears when user activates voice
- Shows: NOVA's response text + voice waveform animation + "thinking" indicator during processing
- Auto-dismisses after 10 seconds of inactivity, or user clicks elsewhere
- Draggable — user positions it anywhere on screen

### Windows Auto-Start
**Off by default.** NOVA does not register itself in Windows startup unless the user explicitly enables it. First-launch prompt: "Would you like NOVA to start automatically with Windows? (You can change this anytime in Settings)". Options: [Yes, auto-start] / [No, I'll launch it manually].

Toggled from web dashboard Settings → Startup. Implemented via the `auto-launch` npm package. Uninstalling NOVA removes the startup entry automatically.

This is a user preference — not an assumption. Some users want always-on; others prefer to launch manually for privacy or performance reasons.

---

## 9. Voice Pipeline

All components run locally — no cloud, no API keys, no cost.

### Components

**Whisper.cpp — Speech to Text (STT)**
Local port of OpenAI Whisper. Runs on CPU+GPU. Accuracy is excellent — comparable to the paid API. Model size: `whisper-base` (140MB, fast) or `whisper-small` (460MB, better accuracy). NOVA ships with `whisper-base` as default.

**Piper TTS — Text to Speech**
Fast, high-quality local TTS. Multiple voice models available. Responses feel natural, not robotic. Generates audio in real time as NOVA streams its response (token-by-token TTS). User can pick a voice from the web dashboard.

### Three Voice Modes

**Push-to-talk** (default)
User holds a configurable hotkey (default: `F12`). While held, microphone is open and Whisper records. On release, audio is transcribed and sent to NOVA. Simple, reliable, zero accidental triggers.

**Wake word**
NOVA passively monitors audio using a lightweight keyword detector (`porcupine` — free tier for personal use, or `openWakeWord` fully open source). Detected "Hey NOVA" → microphone opens → Whisper records until silence → sends to agent. Low CPU usage because the wake word detector is tiny compared to Whisper.

**Always listening**
Microphone is always open. Whisper processes audio in 3-second chunks, detecting speech vs. silence. Any speech longer than 1 second is transcribed and sent to NOVA. Highest CPU usage. Best for hands-free workflows.

> **Privacy note:** Always-listening mode keeps your microphone open continuously. All processing is 100% local — no audio ever leaves your machine. However, for users who are sensitive about microphone access, push-to-talk is recommended. Always-listening is **opt-in only** — it cannot be set as the default in settings; the user must explicitly switch to it.

**Voice entirely disabled**
A fourth option: voice features are fully off. No microphone access, no TTS. NOVA is text-only. For users who want maximum privacy or are in a shared/office environment.

**Mode switching:** "Hey NOVA, switch to push-to-talk mode" or via web dashboard toggle. Current mode always visible in the tray icon tooltip and the web dashboard header.

### Voice Pipeline Flow
```
Microphone input
    │
    ▼
Mode manager (push-to-talk / wake word / always-on)
    │ audio buffer
    ▼
Whisper.cpp (child_process)
    │ transcribed text
    ▼
Agent loop → streams response tokens
    │ token stream
    ▼
Piper TTS (child_process) → audio chunks
    │
    ▼
Windows audio output (speakers)
```

**Files:**
```
src/voice/
├── stt.ts          ← WhisperSTT — spawn whisper.cpp, return transcript
├── tts.ts          ← PiperTTS — stream tokens → audio chunks → speaker
├── wake-word.ts    ← WakeWordDetector (openWakeWord)
├── push-to-talk.ts ← GlobalHotkey listener
└── manager.ts      ← VoiceManager — mode state, coordinates all above
```

---

## 10. Web Dashboard

A Next.js app that runs locally at `http://localhost:3000`. Structured from day one for cloud deployment (Vercel) — environment variables and API calls all point to `NEXT_PUBLIC_API_URL` which defaults to `http://localhost:3001`.

### Pages & Features

**Chat** (`/`)
Full conversation interface with NOVA. Streaming responses. Model switcher dropdown in header (shows all Ollama models + OpenRouter models if key is set). Conversation history. Voice toggle button (activate/deactivate mic from browser).

**Activity Feed** (`/activity`)
Real-time log of everything NOVA has done: every tool call, every memory access, every hook fired, every dispatch task. Each entry shows: timestamp, event type, what happened, and a "Reasoning" expandable that shows NOVA's chain-of-thought for that action. This is NOVA's console — the developer view.

**Routines** (`/routines`)
List of all scheduled routines. Create / edit / enable / disable / run-now. Shows last run time and result.

**Dispatch** (`/dispatch`)
Task queue. Submit a background task. See status (pending / running / done / failed). View results. Cancel running tasks.

**Skills** (`/skills`)
List of all loaded skills with their frontmatter metadata. Edit skill files inline. Enable / disable skills. Create new skill from template.

**Settings** (`/settings`)
- **Model**: Default model, complex reasoning model, embedding model
- **Voice**: Mode (push-to-talk / wake word / always-on), hotkey, wake word, voice/speed/pitch for TTS
- **Database**: Current provider, storage stats
- **Startup**: Toggle Windows auto-start
- **API Keys**: OpenRouter key (masked), other optional keys
- **Appearance**: Overlay position, theme

### Cloud Deployment
When Jimmy or an open source user wants cloud access:
1. Push frontend to Vercel (free tier, one command: `vercel deploy`)
2. Set `NEXT_PUBLIC_API_URL` to their machine's public URL (or a tunnel like Tailscale/Cloudflare Tunnel)
3. NOVA's API server handles auth via a secret token in headers

No backend infrastructure changes required — the API server already runs on their machine.

---

## 11. API Server

An Express server running at `localhost:3001`. Serves the web dashboard's data needs and exposes NOVA's capabilities to other local apps.

### Endpoints

```
POST   /api/chat                → send message, stream response
GET    /api/conversations       → list conversations
GET    /api/conversations/:id   → get conversation with messages
GET    /api/activity            → recent action log (SSE stream for real-time)
GET    /api/models              → list available models (Ollama + OpenRouter)
POST   /api/dispatch            → submit background task
GET    /api/dispatch/:id        → task status + result
GET    /api/routines            → list routines
POST   /api/routines            → create routine
PATCH  /api/routines/:id        → update / enable / disable
GET    /api/skills              → list skills with metadata
PATCH  /api/skills/:name        → update skill file content
GET    /api/settings            → read settings
PATCH  /api/settings            → update settings
GET    /api/memory/search       → search memories (query param)
GET    /api/memory/graph        → memory graph edges for visualization (Phase 3)
```

**File:** `src/api/server.ts` — Express app, started by Electron main process on boot.

---

## 12. Self-Awareness

### Self-Diagnosis
On every tool call failure, NOVA logs the error to the action log and runs a brief diagnosis: what tool failed, what the error was, is it a config issue (missing API key), a network issue, or a bug? The result appears in the web dashboard activity feed with a suggested fix. Example: "web_search failed — WEB_SEARCH_API_KEY is not set. Add it to .env or disable this tool in Settings."

**File:** `src/self/diagnosis.ts` — `diagnoseToolFailure(toolName, error)` — returns structured diagnosis.

### Skill Self-Update
A skill (`workspace/skills/self-update.md`) that NOVA can invoke when:
- A skill is consistently failing or producing poor results
- Jimmy asks NOVA to improve how it handles a specific task
- NOVA's own self-reflection flags a skill as underperforming

NOVA proposes the updated skill file content, shows Jimmy the diff, and waits for approval before writing. This is always reversible — the old file is backed up before overwriting.

**File:** `src/self/skill-updater.ts` — `proposeSkillUpdate(skillName, currentContent, proposedContent)` — diff, confirm, write.

---

## 13. Updated File Structure

```
nova/
├── electron/                     ← Electron shell
│   ├── main.ts
│   ├── tray.ts
│   ├── overlay.ts
│   ├── voice-manager.ts
│   └── preload.ts
├── renderer/                     ← Overlay UI
│   ├── overlay.html
│   └── overlay.ts
├── web/                          ← Next.js dashboard
│   ├── app/
│   │   ├── page.tsx              ← Chat
│   │   ├── activity/page.tsx
│   │   ├── routines/page.tsx
│   │   ├── dispatch/page.tsx
│   │   ├── skills/page.tsx
│   │   └── settings/page.tsx
│   └── package.json
├── src/                          ← Core (Node.js/TypeScript)
│   ├── agent/
│   │   ├── nova.ts               ← main agent loop (updated)
│   │   ├── system-prompt.ts      ← updated to inject active skills
│   │   └── tools/                ← Phase 1 tools (unchanged)
│   ├── api/
│   │   └── server.ts             ← Express API server
│   ├── automation/
│   │   ├── routines.ts
│   │   ├── dispatch.ts
│   │   ├── hooks.ts
│   │   └── heartbeat.ts
│   ├── db/
│   │   ├── interface.ts
│   │   ├── client.ts
│   │   ├── providers/
│   │   │   ├── sqlite.ts
│   │   │   └── supabase.ts
│   │   └── migrations/
│   │       ├── 001_phase1.sql
│   │       └── 002_phase2.sql
│   ├── memory/
│   │   ├── tier1-curated.ts      ← Phase 1 (unchanged)
│   │   ├── tier2-daily.ts        ← Phase 1 (unchanged)
│   │   ├── tier3-semantic.ts     ← updated: graphRagSearch()
│   │   ├── store.ts              ← updated: buildEdges() on insert
│   │   ├── graph.ts              ← NEW: knowledge graph
│   │   ├── dream.ts              ← NEW: nightly consolidation
│   │   └── extract.ts            ← Phase 1 (unchanged)
│   ├── providers/
│   │   ├── interface.ts
│   │   ├── ollama.ts
│   │   ├── openrouter.ts
│   │   └── router.ts
│   ├── self/
│   │   ├── diagnosis.ts
│   │   └── skill-updater.ts
│   ├── skills/
│   │   └── loader.ts
│   ├── voice/
│   │   ├── stt.ts
│   │   ├── tts.ts
│   │   ├── wake-word.ts
│   │   ├── push-to-talk.ts
│   │   └── manager.ts
│   ├── conversations/            ← Phase 1 (unchanged)
│   ├── events/                   ← Phase 1 (unchanged)
│   └── lib/
│       ├── config.ts             ← updated: new env vars
│       └── logger.ts             ← NEW: structured logging
├── workspace/
│   ├── skills/                   ← NEW: skill markdown files
│   │   ├── web-search.md
│   │   ├── calendar.md
│   │   ├── notion.md
│   │   ├── gmail.md
│   │   ├── weather.md
│   │   ├── news.md
│   │   ├── dispatch.md
│   │   └── self-update.md
│   ├── SOUL.md                   ← Phase 1
│   ├── USER.md                   ← Phase 1
│   ├── MEMORY.md                 ← Phase 1
│   ├── AGENTS.md                 ← Phase 1
│   └── news-feeds.yaml           ← Phase 1
├── db/
│   └── schema.sql                ← updated with Phase 2 tables
├── .env
└── package.json                  ← updated: electron, next, voice deps
```

---

## 14. Build Order

Steps are ordered to keep NOVA working at every checkpoint. Foundation first, features layer on top.

### Step 1 — ModelRouter
Replace `@anthropic-ai/sdk` calls with `OllamaProvider`. Add `OpenRouterProvider`. Wire `ModelRouter`. Replace OpenAI embedding calls with `nomic-embed-text` via Ollama.

**Checkpoint:** NOVA boots and chats using local Ollama. No paid APIs used. `npm run nova` works with empty `ANTHROPIC_API_KEY`.

### Step 2 — DatabaseProvider Abstraction
Build `DatabaseProvider` interface. Implement `SQLiteProvider` (better-sqlite3 + sqlite-vec). Wrap existing Supabase calls in `SupabaseProvider`. Run Phase 2 migrations (new tables).

**Checkpoint:** `DATABASE_TYPE=sqlite` — NOVA boots and stores memories locally with no Supabase connection. `DATABASE_TYPE=supabase` — existing behaviour preserved.

### Step 3 — Skills System
Build skill loader. Create `workspace/skills/` with skill files for all existing tools. Update system prompt composition to inject active skill metadata. Update agent loop to load full skill content on trigger.

**Checkpoint:** All Phase 1 tools work as skills. Adding a new `.md` file to `workspace/skills/` and restarting NOVA makes it available.

### Step 4 — GraphRAG + Memory Upgrades
Add `memory_connections` table. Build `graph.ts` (edge building + traversal). Update `store.ts` to call `buildEdges()` after insert. Upgrade `findSimilar()` to `graphRagSearch()`. Add memory bump.

**Checkpoint:** Memory retrieval noticeably surfaces related memories. `memory_connections` table accumulates edges over time.

### Step 5 — Automation Engine
Build routines (node-cron), dispatch queue (background worker), hooks engine (event emitter), heartbeat loop (10-min interval). Wire all into agent loop and session lifecycle.

**Checkpoint:** Create a test routine: "every minute, say hello". It fires. Dispatch a task: it runs in the background and the result appears. Hook on `session.start` fires.

### Step 6 — Dreaming + Self-Reflection
Build `dream.ts` (scheduler + LLM consolidation pass). Tune self-reflection extraction prompt. Wire dreaming to 3am cron. Wire self-reflection to session end.

**Checkpoint:** End a session — reflection runs, new memories appear. Trigger a manual dream run — MEMORY.md gets promoted entries.

### Step 7 — Self-Awareness
Build `diagnosis.ts` and `skill-updater.ts`. Wire diagnosis to every tool failure. Create `self-update.md` skill.

**Checkpoint:** Break a tool deliberately (remove API key) — NOVA diagnoses it and reports in activity log. Ask NOVA to improve a skill — it proposes a diff and awaits approval.

### Step 8 — API Server
Build Express server (`src/api/server.ts`). Implement all endpoints. Add SSE stream for activity feed.

**Checkpoint:** `curl localhost:3001/api/models` returns list of Ollama models. POST to `/api/chat` returns streaming response.

### Step 9 — Web Dashboard
Build Next.js app in `web/`. Implement Chat, Activity, Routines, Dispatch, Skills, Settings pages.

**Checkpoint:** Open `http://localhost:3000`. Chat with NOVA from the browser. Switch model from dropdown. See activity feed update in real time.

### Step 10 — Electron Shell
Scaffold Electron app. Build system tray (icon + menu). Build floating overlay window. Wire Electron IPC to core layer. Move agent loop into Electron main process.

**Checkpoint:** NOVA launches as a desktop app. Tray icon appears. Click to open overlay. Chat from overlay. Web dashboard opens from tray menu.

### Step 11 — Voice Pipeline
Install Whisper.cpp and Piper. Build `stt.ts`, `tts.ts`, `wake-word.ts`, `push-to-talk.ts`, `manager.ts`. Wire into Electron overlay.

**Checkpoint:** Press F12, speak, NOVA transcribes and responds by voice. Say "Hey NOVA" — it activates. Overlay shows waveform while listening.

### Step 12 — Windows Auto-Start + Polish
Register auto-launch. Add startup prompt ("Start with Windows?"). Polish overlay animations. Add error recovery (failed tool doesn't crash session). Performance pass (startup time, memory usage).

**Checkpoint:** Enable auto-start in Settings → reboot → NOVA tray icon appears. Disable auto-start → reboot → NOVA does not launch. Enable "always listening" from dashboard → microphone activates. Switch to "disabled" → no microphone access. All features work. No crashes in 30 minutes of use.

---

## 15. New Environment Variables

```
# AI Providers
MODEL_PROVIDER=ollama
DEFAULT_MODEL=qwen2.5:7b
COMPLEX_MODEL=qwen2.5:14b
EMBED_MODEL=nomic-embed-text
OLLAMA_HOST=http://localhost:11434
OPENROUTER_API_KEY=                   # optional — unlocks paid models

# Database
DATABASE_TYPE=sqlite                  # sqlite | supabase
SQLITE_PATH=./workspace/nova.db       # used when DATABASE_TYPE=sqlite

# Voice (all opt-in — push-to-talk is the safe default)
VOICE_MODE=push-to-talk               # push-to-talk | wake-word | always-on | disabled
VOICE_HOTKEY=F12
WAKE_WORD=hey nova
WHISPER_MODEL=base                    # base | small | medium
PIPER_VOICE=en_US-lessac-medium

# Existing (unchanged)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
NOVA_USER_ID=
NOVA_WORKSPACE_PATH=
NOTION_API_KEY=
WEB_SEARCH_API_KEY=
OPENWEATHER_API_KEY=
GOOGLE_CREDENTIALS_PATH=
```

---

## 16. Success Criteria

Phase 2 is complete when:

1. `npm start` opens NOVA as a tray app — no terminal REPL
2. No paid API keys required — NOVA chats using Ollama
3. PC reboot → NOVA tray icon appears automatically
4. Press F12, speak a message → NOVA responds by voice
5. Say "Hey NOVA" → NOVA activates and listens
6. 8am routine fires → NOVA speaks morning briefing unprompted
7. Dispatch a research task → it runs in background, result in web dashboard
8. Open `localhost:3000` → chat with NOVA, see activity feed, switch model
9. Remove a tool's API key → NOVA self-diagnoses and reports the issue
10. Ask NOVA to improve a skill → it proposes a diff, you approve, skill file updated
11. `DATABASE_TYPE=sqlite` → all features work, no Supabase account required
12. An open source user clones the repo, runs `npm install && npm start`, picks SQLite → NOVA works in under 10 minutes

---

## 17. Out of Scope (Phase 3)

The following are explicitly deferred to avoid scope creep:

- Sub-agents, Council Mode, project workspaces
- Memory Constellation 3D visualization
- Code execution sandbox, browser automation
- Self-patching (NOVA modifies its own core code)
- Tree-of-thoughts, self-consistency reasoning
- Workflow builder UI
- Cloud deployment of web dashboard
- Vision/image input
- Mobile app
