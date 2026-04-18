# NOVA — Phase 1 Build Plan

This is the execution plan for Phase 1. Claude Code works through these steps with Jimmy, one checkpoint at a time. Do not skip ahead. Do not build Phase 2+ features even if they seem easy to add.

## Prerequisites (Jimmy does these before building)

Jimmy completes these setup steps *before* asking Claude Code to build. Claude Code should verify they are done in Step 1.

- [ ] Claude Desktop app installed, Claude Pro subscription active
- [ ] Node.js LTS (20+) installed, verify with `node --version`
- [ ] Project folder created: `C:\Users\Kualar\Documents\AI\Nova`
- [ ] `PROJECT.md`, `ARCHITECTURE.md`, `PHASE-1-PLAN.md` saved in that folder
- [ ] Anthropic API key — from console.anthropic.com, with ~$5 credits
- [ ] OpenAI API key — from platform.openai.com, with ~$5 credits
- [ ] Supabase project created — named `nova`, Sydney region, free tier. Project URL and `service_role` key saved.
- [ ] Notion integration token — from notion.so/my-integrations, with access granted to the relevant Notion pages
- [ ] Google Cloud project with Calendar API + Gmail API enabled — OAuth credentials downloaded as JSON (walk-through in Step 7)
- [ ] Web search API key — recommend Brave Search API (free tier: 2000 queries/month)
- [ ] OpenWeatherMap API key — free tier at openweathermap.org (no credit card, 1000 calls/day)

## Build steps

Each step ends with a checkpoint. Claude Code verifies the checkpoint with Jimmy before moving to the next step.

---

### Step 1 — Verify prerequisites and initialize the project

**Goal:** Empty TypeScript project wired up, all required environment variables present.

Actions:
1. Verify Node.js version (>= 20)
2. Verify all three docs are present in the project folder
3. `npm init -y`
4. Install dev dependencies: `typescript`, `@types/node`, `tsx`, `dotenv`
5. Install runtime dependencies: `@anthropic-ai/sdk`, `openai`, `@supabase/supabase-js`, `zod`, `chalk`
6. Create `tsconfig.json` (strict mode, ESM, Node 20 target)
7. Create `.gitignore` with `.env`, `node_modules`, `dist`, `workspace/memory/`, `workspace/MEMORY.md`
8. Create `.env.example` with all required variable names from ARCHITECTURE.md (values blank)
9. Create `.env` (copy from `.env.example`, Jimmy fills in values — keep `NOVA_USER_ID` blank for now, filled in Step 2)
10. Create `src/lib/config.ts` that loads `.env`, validates all required vars with Zod, exports typed config
11. Create `src/index.ts` with a single `console.log('nova booting...')` for smoke test
12. Add `"nova": "tsx src/index.ts"` to npm scripts

**Checkpoint:** `npm run nova` prints `nova booting...` without errors. Config validation confirms all required env vars are set (except `NOVA_USER_ID` which is filled next step).

---

### Step 2 — Database schema

**Goal:** Supabase has the NOVA schema with pgvector enabled.

Actions:
1. Create `db/schema.sql` containing all the DDL from `ARCHITECTURE.md` (extensions, users, memories, events, conversations, messages, indexes)
2. Jimmy opens Supabase dashboard → SQL editor → pastes and runs `db/schema.sql`
3. Verify tables exist via Supabase table editor
4. Insert Jimmy's user row:
   ```sql
   insert into users (name) values ('Jimmy') returning id;
   ```
5. Jimmy copies the returned UUID and saves it as `NOVA_USER_ID` in `.env`
6. Create `src/db/client.ts` exporting a singleton Supabase client using the service-role key
7. Create a quick connectivity test script that queries `users` and prints Jimmy's name

**Checkpoint:** Test script successfully reads Jimmy's user row from Supabase. All five tables visible in Supabase dashboard.

---

### Step 3 — Workspace folder + seed personality files

**Goal:** NOVA's personality, user profile, and rules exist as editable markdown files.

Actions:
1. Create `workspace/` directory inside the project
2. Add `workspace/` path to `.env` as `NOVA_WORKSPACE_PATH`
3. Seed `workspace/SOUL.md` with NOVA's personality (use the personality spec from the kickoff prompt as the starting content)
4. Seed `workspace/AGENTS.md` with the reversibility rule and confirmation format
5. Seed `workspace/USER.md` with Jimmy's basic facts (name, location, Feast AI, preferences)
6. Create empty `workspace/MEMORY.md` with a comment explaining it's Tier 1 curated memory
7. Create `workspace/memory/` directory (will hold daily notes)
8. Create `src/workspace/loader.ts` with functions to read each file and concatenate for the system prompt
9. Quick test: load all four files, print their combined contents

**Checkpoint:** All four workspace files exist and are human-readable. The loader successfully reads them. Jimmy can open any of them in a text editor and see the content.

---

### Step 4 — Memory layer (all three tiers)

**Goal:** NOVA can store, retrieve, and reconcile memories across three tiers.

Actions:
1. `src/memory/tier1-curated.ts` — Reads `workspace/MEMORY.md`. Returns its contents (for inclusion in system prompt).
2. `src/memory/tier2-daily.ts` — Reads today's and yesterday's `workspace/memory/YYYY-MM-DD.md` files. Auto-creates today's if it doesn't exist. Appends new entries on demand.
3. `src/memory/store.ts` — Low-level insert/update/find-similar for Tier 3 memories, using OpenAI embeddings and pgvector cosine similarity.
4. `src/memory/tier3-semantic.ts` — Semantic search with recency boost, returns top N memories, updates `access_count` and `last_accessed_at`.
5. `src/memory/extract.ts` — Takes a conversation transcript, calls Claude with a structured extraction prompt, returns typed candidate memories.
6. `src/memory/reconcile.ts` — For each candidate, search for similar existing Tier 3 memories; decide insert / update / supersede / skip.
7. Write a manual test script `tests/memory-roundtrip.ts` that:
   - Inserts a fake conversation about Jimmy liking Thai food
   - Runs extraction
   - Runs reconciliation
   - Retrieves memories with a relevant query and prints them
   - Appends an entry to today's daily note and reads it back
   - Confirms Tier 1 MEMORY.md is still readable

**Checkpoint:** Test script produces sensible memories, stores them, retrieves them. Running the script a second time does *not* duplicate memories (reconciliation works). Daily note file exists with the appended entry.

---

### Step 5 — Conversation and event stores

**Goal:** NOVA persists every session and event.

Actions:
1. `src/conversations/store.ts` — start conversation (returns ID), append message, end conversation (optionally generate a summary via Claude)
2. `src/events/log.ts` — simple `logEvent(type, payload)` writes to `events` table
3. Wire `session_start` and `session_end` events; wire `message` events on each turn

**Checkpoint:** A test conversation flow writes rows to `conversations`, `messages`, and `events` tables. All rows are queryable.

---

### Step 6 — Agent core (no tools yet)

**Goal:** NOVA can have a text-only conversation with the full three-tier memory system + workspace personality in the loop.

Actions:
1. `src/agent/system-prompt.ts` — Builds the system prompt at session start:
   - Load SOUL.md, AGENTS.md, USER.md from workspace
   - Load MEMORY.md (Tier 1)
   - Load today's + yesterday's daily notes (Tier 2)
   - Inject current date/time and "Phase 1 context: work-hours terminal session"
   - After first user message, do a Tier 3 semantic search and inject top ~10 relevant memories
2. `src/agent/nova.ts` — Main agent loop:
   - On session start: create conversation, build system prompt from workspace + Tier 1 + Tier 2
   - Read line from stdin → send to Claude with full message history → print response → persist both messages
   - Optionally append notable statements to today's daily note during the session
   - On exit: end conversation, run memory extraction + reconciliation on the transcript (Tier 3)
3. `src/index.ts` — REPL-style CLI, shows a `nova > ` prompt, handles Ctrl+C gracefully to trigger session end
4. Terminal styling: minimal, dark, Linux-vibes. Use Chalk for just three colors: dim gray for prompt, white for response, red for errors. No boxes, no ASCII art.

**Checkpoint:** Jimmy can run `npm run nova`, have a real conversation, exit cleanly, and see memories written to the DB + today's daily note file. Running `npm run nova` a second time: NOVA retrieves the memories and references them naturally. Jimmy can open `workspace/MEMORY.md` and manually add a curated fact — NOVA picks it up on next session.

**This is the first point where NOVA feels real.** Spend time here — test it for a day before adding tools.

---

### Step 7 — Tools: Google Calendar + Gmail

**Goal:** NOVA can read calendar and email freely, and propose changes with confirmation. Both use the same Google OAuth credentials.

Actions:
1. Walk Jimmy through Google Cloud Console:
   - Enable Calendar API + Gmail API (same project)
   - Create OAuth 2.0 credentials (Desktop app type)
   - Download credentials JSON, save path to `GOOGLE_CREDENTIALS_PATH` in `.env`
2. Connect official Google MCP servers via Anthropic SDK `mcp` config in `src/agent/nova.ts`
3. First run triggers OAuth device flow, saves refresh token locally
4. Apply reversibility rule from AGENTS.md:
   - Calendar `list_events` → reversible
   - Calendar mutations → irreversible, confirm
   - Gmail `search_emails`, `get_thread`, `list_labels` → reversible
   - Gmail `create_draft` → reversible (inform after)
   - Gmail `send_email`, `delete_email`, `archive_email` → irreversible, confirm

**Checkpoint:**
- "What's on my calendar tomorrow?" → lists without asking
- "Add lunch with Sam Friday 12:30" → proposes, waits, creates
- "Summarize my unread emails from today" → reads and summarizes freely
- "Draft a reply to [X]'s email" → creates draft, informs Jimmy
- "Send that draft" → proposes what/where/when/how-to-cancel, waits for "go"

---

### Step 8 — Tool: Notion

**Goal:** NOVA can search, read, and write to Notion following the reversibility rule.

Actions:
1. Connect `@notionhq/notion-mcp-server` via Anthropic SDK `mcp` config
2. `NOTION_API_KEY` in `.env`
3. Apply reversibility rule:
   - `search`, `get_page` → reversible
   - `create_page`, `append_to_page` → reversible, inform after
   - `archive_page` → irreversible, confirm

**Checkpoint:** "Add a note to my Ideas page: 'explore NOVA voice'" → does it, confirms. "Archive that old meeting notes page" → proposes, Jimmy confirms, archives.

---

### Step 9 — Tool: Web search

**Goal:** NOVA can search the web and cite sources.

Actions:
1. Connect Brave Search MCP or Tavily MCP via Anthropic SDK `mcp` config
2. `WEB_SEARCH_API_KEY` in `.env`
3. NOVA cites sources when it uses results. Reversible — no confirmation needed.

**Checkpoint:** Jimmy asks a current-events question, NOVA searches and answers with sources.

---

### Step 10 — Tool: News feed

**Goal:** NOVA can pull topic-based news digests from RSS feeds.

Actions:
1. Connect RSS aggregator MCP server via Anthropic SDK `mcp` config
2. Configure with Jimmy's feeds from `workspace/news-feeds.yaml` (created in Step 3)
3. Reversible — act freely. NOVA surfaces AI news and world events on request.
4. Default feeds: Anthropic, OpenAI, Google DeepMind, HuggingFace, BBC World, Reuters, AP News, Ars Technica, The Verge, HackerNews

**Checkpoint:**
- "What happened in AI this week?" → NOVA returns digest with sources
- "Show me today's world news headlines" → returns BBC/Reuters headlines
- Jimmy edits `workspace/news-feeds.yaml` → NOVA picks up new feed next session

---

### Step 11 — Tool: Weather

**Goal:** NOVA knows current conditions and forecast for Melbourne.

Actions:
1. Connect OpenWeatherMap MCP via Anthropic SDK `mcp` config
2. `OPENWEATHER_API_KEY` in `.env` (free tier)
3. Default location: Melbourne, Australia (from USER.md). Reversible — act freely.

**Checkpoint:** "What's the weather this weekend?" → NOVA returns Melbourne Friday–Sunday forecast.

---

### Step 12 — Polish pass

**Goal:** Phase 1 is Jimmy's daily driver.

Actions:
1. Add a `--status` flag that prints: memory count per tier, last session, session count, days active
2. Add basic error recovery so a failed tool call doesn't crash the session
3. Add a `/forget` slash-command: lets Jimmy supersede a specific memory by ID or keyword
4. Add a `/recall` slash-command: lets Jimmy see what NOVA remembers matching a query (searches all three tiers)
5. Add a `/promote` slash-command: lets Jimmy manually copy a Tier 3 memory into Tier 1 (MEMORY.md)
6. Add a `/news` slash-command: quick news digest from all configured feeds
7. Write a short `README.md` with "how to run NOVA each morning"
8. Dogfood for one week. Track friction. Fix the top 3 pain points.

**Checkpoint:** Jimmy opens NOVA daily for a week without thinking about it. It remembers him. It helps.

---

## Phase 1 definition of done

- NOVA starts from a terminal with one command
- Workspace files (SOUL.md, USER.md, MEMORY.md, AGENTS.md) exist and Jimmy has edited at least one to test the live-reload behavior
- All three memory tiers are working and populated
- Every session persists: conversation, events, memories (Tier 3), and daily note (Tier 2)
- NOVA's replies reflect memory from prior sessions in a way Jimmy notices
- All six tools work reliably with correct reversibility behavior (act freely on reads, confirm on irreversible writes)
- Jimmy prefers NOVA over generic chat tools for his personal work

When this is all true for two weeks, Phase 1 is done. Move on to planning Phase 2.

## Rules of engagement for Claude Code

- **Before starting any step, re-read the relevant section of this plan and ARCHITECTURE.md.** Do not build from memory.
- **Stop at every checkpoint.** Confirm with Jimmy that the checkpoint passes before moving on.
- **No Phase 2+ features.** If a shortcut tempts you toward Phase 2 (e.g., "we could add the heartbeat now…"), decline and note it for later.
- **Never commit secrets.** `.env` and `workspace/` must always be in `.gitignore`. If you see a key in a file that will be committed, stop and flag it.
- **Prefer small, focused commits.** One logical change per commit. Makes rollback easy.
- **Ask when in doubt.** Jimmy is the product owner. If a decision isn't in PROJECT.md or ARCHITECTURE.md, ask him — don't guess.
- **Keep explanations tight.** Jimmy values clarity over verbosity.
- **Update docs first.** If reality during build doesn't match the docs, update the docs first, then change the code. Don't build something inconsistent with what's written.
