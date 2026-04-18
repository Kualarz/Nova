# NOVA — Architecture

This document captures the technical decisions for NOVA. Read this before writing any code. If something here needs to change, update this document first, then update the code.

## Tech stack (Phase 1)

| Layer | Choice | Reason |
|---|---|---|
| Brain | `claude-haiku-4-5-20251001` (default) / `claude-opus-4-7` (complex reasoning) | Haiku for routine conversation and tool calls — fast and cheap. Opus reserved for tasks requiring deep reasoning. |
| Language | TypeScript / Node.js | Matches Jimmy's existing stack (Feast AI is Next.js). Allows code sharing with future web dashboard and React Native mobile app. |
| Database | Supabase (free tier) — Postgres + pgvector | Scalable semantic memory store. Already familiar from Feast AI. Portable (can migrate to Neon or self-hosted Postgres later without code changes). |
| Embeddings | OpenAI `text-embedding-3-small` | 1536 dimensions, cheap (~$0.02 per million tokens), well-supported by pgvector tutorials and tooling. |
| Workspace files | Markdown on local disk | Human-readable personality, user profile, and curated memory. Versionable, inspectable, editable without a code change. |
| Runtime | Local Node.js CLI on Windows | Phase 1 runs on Jimmy's machine only. No hosting yet. |
| Dev environment | Claude Desktop (Code tab) | Claude Code runs natively inside the desktop app. No separate CLI install required. |

## Project structure

```
C:\Users\Kualar\Documents\AI\Nova\
├── PROJECT.md                    # Vision + roadmap
├── ARCHITECTURE.md               # This file
├── PHASE-1-PLAN.md               # Build order for Phase 1
├── README.md                     # Quick-start for future Jimmy
├── .env                          # Secrets (NEVER commit)
├── .env.example                  # Template showing required vars
├── .gitignore                    # Must include .env and workspace/ contents that are private
├── package.json
├── tsconfig.json
├── db/
│   └── schema.sql                # Supabase schema (run once in dashboard)
├── workspace/                    # Jimmy's personal NOVA workspace (git-ignored or private repo)
│   ├── SOUL.md                   # NOVA's core personality
│   ├── AGENTS.md                 # Behavior rules (reversibility rule, etc.)
│   ├── USER.md                   # Facts about Jimmy (curated, hand-editable)
│   ├── MEMORY.md                 # Tier 1 — always-loaded curated memory (~100 lines)
│   └── memory/
│       ├── 2026-04-18.md         # Tier 2 — daily notes (auto-created)
│       └── ...
├── src/
│   ├── index.ts                  # CLI entry point (`nova` command)
│   ├── agent/
│   │   ├── nova.ts               # Main agent loop
│   │   ├── system-prompt.ts      # Composes system prompt from workspace files + retrieved memory
│   │   └── tools.ts              # Tool registry
│   ├── memory/
│   │   ├── tier1-curated.ts      # Read MEMORY.md
│   │   ├── tier2-daily.ts        # Read today's + yesterday's daily notes
│   │   ├── tier3-semantic.ts     # pgvector-backed semantic search
│   │   ├── extract.ts            # Post-conversation fact extraction
│   │   ├── reconcile.ts          # Dedup / update / supersede
│   │   └── store.ts              # pgvector read/write for tier 3
│   ├── workspace/
│   │   └── loader.ts             # Reads SOUL.md, USER.md, MEMORY.md, AGENTS.md
│   ├── events/
│   │   └── log.ts                # Event writer
│   ├── conversations/
│   │   └── store.ts              # Conversation persistence
│   ├── tools/
│   │   ├── web-search.ts
│   │   ├── calendar.ts
│   │   └── notion.ts
│   ├── db/
│   │   └── client.ts             # Supabase client singleton
│   └── lib/
│       ├── config.ts             # Env var loading + validation
│       └── log.ts                # Structured logging
└── tests/
    └── (added as needed)
```

## The workspace — personality and curated memory as files

NOVA's personality and user profile live as plain markdown in `workspace/`, not hardcoded in source. This is an OpenClaw-inspired pattern that gives Jimmy direct ownership over how NOVA thinks and what it knows.

### `workspace/SOUL.md` — NOVA's personality

A human-readable description of NOVA's voice, tone, style, and defaults. Example content (Phase 1 seed):

```markdown
# SOUL

I am NOVA — Jimmy's ally. Not a chatbot, not a servant, a partner.

## Voice
- Direct. I get to the point.
- Slightly dry. Conversational like a smart colleague, not customer-service polite.
- No emoji in prose. No exclamation points as filler.

## Style
- I push back when Jimmy commits to something suboptimal, with reasoning.
- I state tradeoffs before recommendations.
- I call out uncertainty openly.
- I match Jimmy's energy — short replies to short messages, thoughtful replies to thoughtful ones.
- I end on substance, never with "let me know if you have any questions."

## Defaults
- Reversible actions: I act freely.
- Irreversible actions: I propose and wait for Jimmy's confirmation.
- When in doubt, I ask rather than guess.
```

Jimmy can edit this file to reshape NOVA's personality without touching code.

### `workspace/USER.md` — who Jimmy is

Curated facts about Jimmy that NOVA should always have in context. Hand-edited, not auto-generated. Example:

```markdown
# USER

- Name: Jimmy
- Location: Melbourne, Australia
- Runs Feast AI (food app, Next.js + Claude + Supabase)
- Building NOVA as a personal AI ally
- Prefers concise answers, directness, and honest pushback
```

### `workspace/MEMORY.md` — Tier 1 curated memory

Always-loaded durable memory, capped at ~100 lines. This is the subset of NOVA's learned memory that matters enough to guarantee loading every session. Extracted and promoted from Tier 3 over time (automatic in Phase 3 via "dreaming"; manual curation in Phase 1).

### `workspace/AGENTS.md` — behavior rules

Non-negotiable operational rules. NOVA reads this every session. Example:

```markdown
# AGENTS

## Reversibility rule
- Reversible actions (read, draft, search, preview) → act freely.
- Irreversible actions (send, delete, publish, book, merge, purchase) → propose, wait for explicit confirmation.

## Confirmation format
When proposing an irreversible action, state: what will happen, where, when it takes effect, and how to cancel.

## Honesty
- State uncertainty when uncertain.
- Do not invent facts. If Jimmy asks something I don't know, say so.
- If a tool call fails, report it plainly; don't paper over it.
```

### Privacy note

`workspace/` contains personal information. Default `.gitignore` excludes it from git. If Jimmy wants workspace under version control, it goes in a separate *private* repo, not the public NOVA codebase.

## The three-tier memory system

OpenClaw-inspired layering that combines guaranteed loading (for high-priority knowledge) with efficient semantic search (for everything else).

### Tier 1 — Always loaded, curated

Source: `workspace/MEMORY.md` (markdown file, hand-edited in Phase 1).

Content: Durable, high-priority facts Jimmy wants NOVA to never forget. Examples: "Jimmy's daughter Maya is 7," "eatr-vibe is pre-launch, currently in beta." Capped at roughly 2000 tokens.

Loaded: At the start of every session. Always in the system prompt.

### Tier 2 — Recent daily context

Source: `workspace/memory/YYYY-MM-DD.md` files (auto-created on first session each day).

Content: Running conversation highlights, decisions made, observations. NOVA appends to today's file as the session progresses. At session start, today's and yesterday's files are loaded.

Loaded: Automatically at session start. Typically a few hundred to a few thousand tokens total.

### Tier 3 — Semantic-searchable deep storage

Source: Supabase `memories` table (pgvector-backed).

Content: Everything else NOVA has learned about Jimmy — extracted facts, preferences, observations, personality notes. Stored with embeddings for similarity search.

Loaded: On-demand, based on query context. Top N most relevant retrieved per turn or per session.

### How they work together

At session start:
1. Read SOUL.md, USER.md, MEMORY.md, AGENTS.md → build static portion of system prompt.
2. Read today's and yesterday's daily notes → append as "recent context."
3. After first user message, semantic-search Tier 3 for relevant deeper memories → inject top results.

During session:
4. On each turn, optionally re-query Tier 3 if the conversation shifts topic.
5. On notable statements from Jimmy, append to today's daily note.

At session end:
6. Extract candidate memories from the conversation.
7. Reconcile against Tier 3 (insert / update / supersede).
8. Optionally, in Phase 3+, run "dreaming" to promote high-signal items from Tier 3 into Tier 1 (MEMORY.md).

## Database schema

All tables include `user_id` even though NOVA is single-user today. This is a one-time cheap decision that keeps the schema future-proof for sharing NOVA with a partner/team later, or for running multiple personalities.

### `users`

```sql
create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
```

Phase 1 inserts exactly one row: Jimmy. All other tables reference this.

### `memories` (Tier 3 storage)

```sql
create table memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  content text not null,                       -- the memory itself, in natural language
  category text not null,                      -- 'fact' | 'preference' | 'observation' | 'personality'
  embedding vector(1536) not null,             -- OpenAI text-embedding-3-small
  source_conversation_id uuid references conversations(id),
  confidence real not null default 1.0,        -- 0.0 to 1.0
  superseded_by uuid references memories(id),  -- when a newer memory replaces this one
  access_count int not null default 0,         -- for decay / staleness detection
  last_accessed_at timestamptz,
  promoted_to_tier1 boolean not null default false,  -- set true when copied to MEMORY.md
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index memories_user_category_idx on memories (user_id, category) where superseded_by is null;
create index memories_embedding_idx on memories using ivfflat (embedding vector_cosine_ops) with (lists = 100);
```

**Categories:**
- `fact` — objective, verifiable things about Jimmy (where he lives, what he does)
- `preference` — how Jimmy likes things (concise responses, dark mode, Thai food)
- `observation` — patterns noticed over time (works late, most productive mornings)
- `personality` — feedback on how NOVA itself behaves well with Jimmy (dry humor lands, don't over-apologize)

**Why `superseded_by` instead of deleting:** Memories are append-only for auditability. When Jimmy corrects something, the old memory points to the new one. Retrieval queries filter `where superseded_by is null`.

### `events`

Narrow event log. Phase 1 only logs what NOVA does in-session (tool calls, decisions). Ambient event sources (calendar webhooks, email) come in later phases. Schema is flexible via JSONB so new event types don't require migrations.

```sql
create table events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  event_type text not null,                    -- 'tool_call' | 'decision' | 'session_start' | 'session_end' | ...
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index events_user_type_time_idx on events (user_id, event_type, created_at desc);
create index events_payload_gin on events using gin (payload);
```

### `conversations` and `messages`

```sql
create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  summary text,                                 -- auto-generated on session end
  memory_extracted boolean not null default false
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null,                           -- 'user' | 'assistant' | 'tool'
  content text not null,
  tool_name text,                               -- if role = 'tool'
  tool_input jsonb,
  tool_output jsonb,
  created_at timestamptz not null default now()
);

create index messages_conversation_idx on messages (conversation_id, created_at);
```

### Required Postgres extensions

```sql
create extension if not exists vector;
create extension if not exists pgcrypto;  -- for gen_random_uuid()
```

## System prompt composition

NOVA's system prompt is built fresh at session start and held constant during the session (never per-message — that's the cost trap).

Structure, in order:

```
[SOUL.md contents]                      — Core personality
[AGENTS.md contents]                    — Operational rules (reversibility, honesty, etc.)
[USER.md contents]                      — Curated facts about Jimmy
[MEMORY.md contents]                    — Tier 1 always-loaded memory
[today's + yesterday's daily notes]     — Tier 2 recent context
[Current date, time, and work context]
[Tool descriptions]
```

After the first user message, a Tier 3 semantic search injects the top ~10 relevant deeper memories as an additional system message. This keeps the base prompt cache-stable (for Claude's prompt caching) while still personalizing per query.

Target total system prompt (before Tier 3 injection): under 3000 tokens.

## The reversibility rule

This rule applies everywhere, forever — not just Phase 1.

**Reversible operations — NOVA acts without confirmation:**
- Reading data (calendar, Notion, web)
- Searching, summarizing, analyzing
- Drafting (emails, documents, messages) — not sending
- Previewing changes
- Creating items in Jimmy's personal space that he can delete easily (e.g., a new Notion note)

**Irreversible operations — NOVA proposes, Jimmy confirms:**
- Sending anything externally (emails, messages)
- Deleting or archiving
- Publishing anywhere public
- Booking, purchasing, scheduling with other people
- Merging code, pushing to shared branches
- Granting access or changing permissions
- Any operation involving money

**Confirmation format** (specified in AGENTS.md):
NOVA states:
1. What will happen
2. Where it takes effect
3. When it takes effect
4. How Jimmy can cancel or undo

Jimmy confirms with "yes" / "go" / "confirmed" (or equivalent). No confirmation = no execution.

## Tools (Phase 1)

Six tools connected as MCP servers via the Anthropic SDK's native MCP support. No custom wrapper code — tool servers are configured and connected, the SDK handles the protocol.

### `web_search`
- MCP: Brave Search MCP or Tavily MCP (Brave recommended — 2000 free queries/month)
- Returns top 5 results with title, URL, snippet
- Reversible → act freely

### `calendar`
- MCP: Official Google Calendar MCP server
- Auth: OAuth 2.0 (Desktop app credentials, shared with `gmail`)
- Operations: `list_events`, `create_event`, `update_event`, `delete_event`
- `list_events` → reversible
- All mutations → irreversible, require confirmation

### `gmail`
- MCP: Official Google Gmail MCP server
- Auth: OAuth 2.0 (same Google Cloud project and credentials as `calendar`)
- Operations: `search_emails`, `get_thread`, `list_labels`, `move_to_label`, `create_draft`, `send_email`, `delete_email`, `archive_email`
- `search_emails`, `get_thread`, `list_labels` → reversible (read)
- `create_draft` → reversible (inform after — Jimmy reviews before sending)
- `send_email`, `delete_email`, `archive_email` → irreversible, require confirmation

### `notion`
- MCP: `@notionhq/notion-mcp-server` (official Notion MCP)
- Auth: Notion integration token
- Operations: `search`, `get_page`, `create_page`, `append_to_page`, `archive_page`
- `search`, `get_page` → reversible
- `create_page`, `append_to_page` → reversible (Jimmy can delete easily), act freely but inform
- `archive_page` → irreversible, require confirmation

### `news_feed`
- MCP: RSS aggregator MCP server (community — configured via `workspace/news-feeds.yaml`)
- Auth: None (RSS is open)
- Operations: `get_news(topics?, since_hours?)`, `get_feed(feed_name)`
- Returns headlines + snippets, deduplicated
- Reversible → act freely
- Default feeds: Anthropic blog, OpenAI blog, Google DeepMind, HuggingFace, BBC World, Reuters, AP News, Ars Technica, The Verge, HackerNews

### `weather`
- MCP: OpenWeatherMap MCP (free tier — 1000 calls/day, no credit card)
- Auth: OpenWeatherMap API key
- Operations: `get_weather(location?)` → current + 3-day forecast
- Default location: Melbourne, Australia (from USER.md)
- Reversible → act freely

## Security and secrets

- All secrets live in `.env` at the project root
- `.env` is git-ignored; `.env.example` is checked in
- `workspace/` is git-ignored by default (or kept in a separate private repo)
- Use the Supabase `service_role` key (not `anon`) — NOVA is a trusted single-user backend
- Never log full API keys; log prefixes only (e.g., `sk-ant-api03-...xxx`)
- API keys are validated on startup via `lib/config.ts`; the app refuses to start if any required key is missing

### Required environment variables

```
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_CREDENTIALS_PATH=     # OAuth creds JSON for Calendar + Gmail (shared)
NOTION_API_KEY=
WEB_SEARCH_API_KEY=          # Brave or Tavily
OPENWEATHER_API_KEY=         # free tier, no credit card
NOVA_USER_ID=                # UUID from the users table, set after first init
NOVA_WORKSPACE_PATH=         # Absolute path to workspace/ folder
```

## Conventions

- Node 20 LTS minimum
- TypeScript strict mode on
- No default exports
- Prefer explicit types on public functions, inference elsewhere
- Async/await, no callback APIs
- Errors bubble up; log at the outermost handler only
- Single-quote strings, trailing commas, 2-space indent (Prettier defaults)
- File naming: kebab-case for files, camelCase for exports
- One public function per file where possible; helper files are fine

## Patterns explicitly deferred to later phases

These are real questions that we chose not to answer yet. When they come up during Phase 1 build, come back to this doc instead of building them early.

- **Heartbeat loop** — Phase 3.
- **Dreaming / memory consolidation** — Phase 3.
- **Skills as markdown files** — Phase 2.
- **Memory flush before compaction** — Phase 2.
- **WebSocket gateway / multi-channel** — Phase 3.
- **Voice layer** — Phase 4.
- **Sub-agents** — Phase 4+ only, and only with a specific justification.
- **Computer use / browser automation** — Phase 4.
- **Web dashboard** — Phase 3. Terminal only for now.
- **Mobile app** — Phase 3+. TypeScript choice keeps this option open.
