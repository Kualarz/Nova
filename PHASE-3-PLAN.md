# NOVA — Phase 3 Build Plan

Phase 3 goal: **"The NOVA that runs in the background."** NOVA is always present — Jimmy notices when it's offline.

---

## Architecture shift

Phase 1–2: NOVA is a CLI you open and close.
Phase 3: NOVA is a **server process** that runs continuously, proactively messages Jimmy on Telegram, and the CLI becomes one of several interfaces.

Two processes after Phase 3:
- `npm run nova` — terminal REPL (Phase 1–2, unchanged)
- `npm run server` — long-running background server (Phase 3, new)

Both share the same DB, workspace files, and memory layer.

---

## Prerequisites Jimmy must complete before building

- [ ] **Telegram bot token** — message @BotFather on Telegram, `/newbot`, copy the token. Save as `TELEGRAM_BOT_TOKEN` in `.env`.
- [ ] **Telegram chat ID** — after creating the bot, send it `/start`. Save your chat ID as `TELEGRAM_CHAT_ID` in `.env`. (Use @userinfobot to find your ID if needed.)
- [ ] **Hosting decision** — Phase 3 requires something running 24/7. Options:
  - **Fly.io** (recommended) — free tier, Node.js, persistent volumes. `fly.toml` provided.
  - **Railway** — simpler, small cost.
  - **Local machine** — works if Jimmy's machine runs 24/7. Not truly ambient.
  - Decision affects which deployment config we write. Defaulting to Fly.io.

---

## What this phase builds

### Feature 1 — Telegram channel

Jimmy can message NOVA on Telegram and get replies. NOVA can proactively send messages to Jimmy.

**Flow:**
- Incoming message → bot webhook → NOVA processes via `runPrompt()` → reply sent
- Outgoing message → any NOVA component calls `sendMessage(text)` → Jimmy sees it on Telegram

**Files:**
- `src/channels/interface.ts` — channel interface (`sendMessage`, `onMessage`)
- `src/channels/telegram.ts` — grammy bot, webhook/polling, maps to interface

**Config:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

---

### Feature 2 — Heartbeat loop

Every 30 minutes during active hours (8am–10pm Melbourne), NOVA:
1. Checks calendar (any events in next 2 hours?)
2. Checks Tier 2 memory (anything time-sensitive from today's notes?)
3. Asks itself: "Is there anything worth telling Jimmy right now?"
4. If yes: sends a short Telegram message
5. If no: sends nothing (NO_REPLY sentinel — no spam)

Jimmy can configure active hours in `workspace/USER.md`.

**Files:**
- `src/heartbeat/check.ts` — runs a NOVA prompt that decides whether to notify
- `src/heartbeat/scheduler.ts` — cron: every 30 min during active hours

---

### Feature 3 — Dreaming (nightly memory consolidation)

Every night at 3am Melbourne time:
1. Read all Tier 2 daily notes from the past 7 days
2. Run extraction + reconciliation to promote important signals to Tier 3
3. Optionally summarise and append a consolidated note to MEMORY.md if something seems durable enough for Tier 1

This is how NOVA "processes" what it learned during the day — making short-term signals durable.

**Files:**
- `src/dreaming/consolidate.ts` — reads Tier 2, runs extraction, writes to Tier 3
- `src/dreaming/scheduler.ts` — cron: 3am daily

---

### Feature 4 — Scheduled workflows

Two scheduled workflows running via Telegram:

**Morning briefing** (8am daily):
- Current Melbourne weather
- Today's calendar events
- Top 3 AI news items from last 24h
- Sent as a single Telegram message

**Daily digest** (6pm daily, optional):
- What was worked on today (from Tier 2 notes)
- Any outstanding tasks (from `/tasks`)
- Short reminder of tomorrow's calendar

Both are configurable — Jimmy can enable/disable in `workspace/USER.md`.

**Files:**
- `src/workflows/morning-briefing.ts`
- `src/workflows/digest.ts`
- `src/workflows/scheduler.ts` — cron runner for both

---

### Feature 5 — Server entry point + basic HTTP dashboard

A long-running process that starts all of the above.

`npm run server`:
- Starts Telegram bot (polling or webhook)
- Starts heartbeat scheduler
- Starts dreaming scheduler
- Starts workflow schedulers
- Optionally: serves a minimal HTTP dashboard on port 3000 showing NOVA status

Dashboard (simple, read-only):
- Status: online/offline, uptime
- Last heartbeat: time + whether it notified
- Recent memories: last 10 Tier 3 entries
- Recent tasks: last 5 tasks with status

**Files:**
- `src/server.ts` — entry point
- `src/server/dashboard.ts` — minimal Express HTTP server + static HTML

---

## Deployment (Fly.io)

**Files:**
- `fly.toml` — Fly.io config (Node.js, 256MB, single region: Sydney)
- `Dockerfile` — multi-stage build
- `.env` in Fly secrets (never committed)

Deploy command after setup: `fly deploy`

---

## Build order

1. Install new dependencies: `grammy`, `node-cron`
2. `src/channels/interface.ts` + `src/channels/telegram.ts`
3. `src/heartbeat/check.ts` + `src/heartbeat/scheduler.ts`
4. `src/dreaming/consolidate.ts` + `src/dreaming/scheduler.ts`
5. `src/workflows/morning-briefing.ts` + `src/workflows/digest.ts` + `src/workflows/scheduler.ts`
6. `src/server.ts` (wires everything together)
7. `src/server/dashboard.ts` (minimal HTTP status page)
8. `fly.toml` + `Dockerfile`
9. Update `.env.example` with new vars
10. TypeScript check + test pass

---

## What we are not building in Phase 3

- Multiple messaging channels (WhatsApp, Discord) — Telegram only
- WebSocket gateway (full protocol) — plain HTTP + Telegram polling is sufficient
- Multi-agent routing — still one NOVA
- Voice — Phase 4

---

## Phase 3 definition of done

- `npm run server` starts and stays alive
- Jimmy sends a message to NOVA on Telegram and gets a reply
- NOVA sends Jimmy an unprompted Telegram message during the heartbeat window
- Morning briefing arrives at 8am without Jimmy doing anything
- Dreaming runs at 3am and Tier 3 memory count grows
- `npm run nova` (terminal) still works alongside the server
- Deployed to Fly.io (or equivalent) — NOVA survives Jimmy closing his laptop
