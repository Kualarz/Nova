# NOVA — Next-Order Virtual Ally

A personal AI ally for daily thinking, research, and planning. Remembers everything across sessions, uses real tools, and works from your terminal.

---

## Quick start

```bash
# 1. Install dependencies (once)
npm install

# 2. Copy and fill in your env file (once)
cp .env.example .env
# Edit .env with your API keys

# 3. Run the Supabase schema (once)
# Open db/schema.sql in the Supabase SQL editor and run it.
# Copy the returned UUID into NOVA_USER_ID in your .env.

# 4. Start NOVA
npm run nova
```

---

## Daily use

```bash
npm run nova          # start a session
npm run nova --status # memory stats, session count, last session time
```

Inside a session:

```
nova > What's the weather this weekend?
nova > What's new in AI today?
nova > Search for recent news about Claude 4
nova > Add a note to my Ideas page: explore NOVA voice
nova > /news ai          # quick news digest, no conversation turn
nova > /recall Melbourne  # search all memory tiers for a topic
nova > /forget [keyword]  # supersede matching memories
nova > /promote [id]      # promote a Tier 3 memory to MEMORY.md
nova > /help             # all slash commands
Ctrl+C                   # clean session end, extracts memories
```

---

## Tools

| Tool | What it does | Key |
|---|---|---|
| `web_search` | Brave Search — current events, facts | `WEB_SEARCH_API_KEY` |
| `get_weather` | OpenWeatherMap current + 3-day forecast | `OPENWEATHER_API_KEY` |
| `get_news` | RSS feeds — AI, world, tech headlines | *(none)* |
| `notion_search` | Search your Notion workspace | `NOTION_API_KEY` |
| `notion_get_page` | Read a Notion page by ID or URL | `NOTION_API_KEY` |
| `notion_append_to_page` | Append a note to a Notion page | `NOTION_API_KEY` |

NOVA uses tools automatically when they're relevant. Read-only tools (search, weather, news) run without asking. Write tools (append to Notion) confirm after, so you can see what happened.

---

## Memory

NOVA uses three memory tiers:

| Tier | Where | When used |
|---|---|---|
| **Tier 1** | `workspace/MEMORY.md` | Every session — always loaded |
| **Tier 2** | `workspace/memory/YYYY-MM-DD.md` | Recent context from last 2 days |
| **Tier 3** | Supabase (pgvector) | Semantically relevant facts from all prior sessions |

After each session (on Ctrl+C), NOVA extracts facts from the transcript and stores them in Tier 3. Use `/promote` to permanently move something into MEMORY.md.

---

## Customising your workspace

All personality and context files live in `workspace/`. Edit them directly — changes take effect next session.

| File | Purpose |
|---|---|
| `workspace/SOUL.md` | NOVA's personality and tone |
| `workspace/AGENTS.md` | Reversibility rules and confirmation format |
| `workspace/USER.md` | Your facts, projects, preferences |
| `workspace/MEMORY.md` | Hand-curated always-loaded facts (Tier 1) |
| `workspace/news-feeds.yaml` | RSS feeds for the `get_news` tool |

---

## Environment variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key (for embeddings) |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `GOOGLE_CREDENTIALS_PATH` | Path to Google OAuth credentials JSON *(reserved for Calendar/Gmail — Step 7)* |
| `NOTION_API_KEY` | Notion integration token |
| `WEB_SEARCH_API_KEY` | Brave Search API key |
| `OPENWEATHER_API_KEY` | OpenWeatherMap API key (free tier) |
| `NOVA_USER_ID` | Your UUID from the `users` table (set after running schema) |
| `NOVA_WORKSPACE_PATH` | Absolute path to the `workspace/` directory |

---

## Getting API keys

- **Anthropic**: [console.anthropic.com](https://console.anthropic.com)
- **OpenAI** (embeddings): [platform.openai.com](https://platform.openai.com)
- **Supabase**: [supabase.com](https://supabase.com) — free tier is fine
- **Brave Search**: [brave.com/search/api](https://brave.com/search/api) — free tier: 2000 queries/month
- **OpenWeatherMap**: [openweathermap.org/api](https://openweathermap.org/api) — free tier: 1000 calls/day
- **Notion**: [notion.so/my-integrations](https://notion.so/my-integrations) — create an internal integration, connect it to your pages

---

## Architecture

```
src/
  index.ts                  CLI entry — validates env, routes --status vs session
  agent/
    nova.ts                 Main REPL loop — tool-use handling, memory extraction
    system-prompt.ts        Composes system prompt from workspace + memory tiers
    slash-commands.ts       /recall /forget /promote /news /help
    tools/
      index.ts              Tool registry and executor
      web-search.ts         Brave Search
      weather.ts            OpenWeatherMap
      news.ts               RSS aggregator
      notion.ts             Notion REST API
  memory/
    tier1-curated.ts        Reads MEMORY.md
    tier2-daily.ts          Reads/writes daily notes
    tier3-semantic.ts       pgvector semantic search
    store.ts                Embed + insert + findSimilar
    extract.ts              Claude-powered fact extraction
    reconcile.ts            Insert / update / supersede logic
  workspace/
    loader.ts               Reads personality + user files
  conversations/
    store.ts                Supabase conversation + message store
  events/
    log.ts                  Event logging
  db/
    client.ts               Supabase singleton
  lib/
    config.ts               Env var validation (Zod)
    status.ts               --status output
```
