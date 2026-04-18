# NOVA — Next-Order Virtual Ally

## What NOVA is

NOVA is a personal AI ally — a long-lived intelligent system that lives alongside its user (Jimmy), learns him over time, and grows in capability across phases. The name stands for **Next-Order Virtual Ally**. "Ally" is chosen deliberately over "assistant": NOVA is not a servant or a tool, it is a partner with its own durable memory and a consistent personality, on Jimmy's side.

The inspiration is JARVIS from the Iron Man films — but NOVA is not JARVIS. It is scoped to what is actually buildable and useful right now, with a clear evolution path toward the fuller vision.

## North star vision

The long-term vision (years out, not months):

- A single AI ally that sits at the center of Jimmy's digital life
- Manages his calendar, tasks, communications, and information
- Orchestrates specialist sub-agents to do research, write, code, and automate work
- Runs in the background 24/7, not only when the user opens it
- Can execute coding tasks end-to-end via Claude Code integration
- Eventually helps run business operations and coordinate AI agent teams (paperclip-style)
- Voice-enabled (Whisper + ElevenLabs) and accessible from web, mobile, and terminal
- Maintains a consistent personality and a durable memory of Jimmy that deepens over time

This vision is the destination. Nothing below is that vision — everything below is the road to get there.

## The 5-phase roadmap

Each phase is a shippable milestone. Each phase builds on the previous one. Do not skip ahead.

### Phase 1 — "The NOVA that knows me" (current phase)

**Goal:** A terminal chat ally with durable memory and personality that Jimmy prefers over generic chat tools for personal work.

**Scope:**
- Terminal chat interface (dark, Linux-vibes aesthetic)
- Durable memory layer on Supabase + pgvector, organized as three tiers
- File-based personality system (SOUL.md, USER.md, MEMORY.md, AGENTS.md)
- Three tools: web search, calendar, Notion
- Reversibility-based confirmation rule (act freely on reversible, confirm on irreversible)
- Work-hours-only operation (manually started, not background)

**Success criteria:** Jimmy opens NOVA instead of a generic chat tool for his daily thinking, research, and planning work. Memory noticeably improves quality of interactions over 2–3 weeks of use.

**Estimated effort:** 2–4 weeks of casual build time.

### Phase 2 — "The NOVA that executes"

**Goal:** NOVA can launch and manage coding tasks via Claude Code, not just discuss them.

**Scope:**
- Claude Code integration — NOVA spawns Claude Code sessions for specific tasks
- Task queue and result reporting
- Skills system (tools as markdown files with YAML frontmatter, loaded on demand)
- Memory flush before compaction (preserve context before auto-summarization)
- Human approval gates for anything irreversible

**Success criteria:** Jimmy delegates real coding tasks to NOVA and returns to reviewable work product.

**Estimated effort:** 3–6 weeks after Phase 1 is stable.

### Phase 3 — "The NOVA that runs in the background"

**Goal:** Ambient mode. NOVA is always present, not only when opened.

**Scope:**
- 24/7 hosting (migrate off free Supabase tier at this point)
- Heartbeat loop — scheduled proactive check-ins (every ~30 min during active hours)
- Dreaming — nightly background memory consolidation
- Gateway pattern — WebSocket control plane for multiple channels
- First messaging channel integration (WhatsApp or Telegram)
- Scheduled workflows (overnight research, morning briefings)
- First web dashboard

**Success criteria:** Jimmy notices when NOVA is offline.

**Estimated effort:** 4–8 weeks after Phase 2.

### Phase 4 — "The NOVA that operates tools"

**Goal:** NOVA drives other software on Jimmy's behalf.

**Scope:**
- Computer use / browser automation
- Multi-step workflows across apps
- First real sub-agents (only where parallelism or isolated context is genuinely required)
- Voice layer (Whisper + ElevenLabs)
- Additional messaging channels

**Success criteria:** NOVA completes multi-hour tasks that would previously have required a human VA.

**Estimated effort:** 2–4 months after Phase 3.

### Phase 5 — "The NOVA that operates a business"

**Goal:** Paperclip-style orchestration of specialist agents to run real operations.

**Scope:**
- Multi-agent orchestration with dedicated agent memory and roles
- Business process automation (research, content, outreach, ops)
- Decision support with human approval for all consequential actions
- Metrics and accountability layer

**Success criteria:** NOVA does work that would otherwise require hiring. Jimmy remains the decision-maker.

**Estimated effort:** 6+ months after Phase 4. Specific capabilities here depend on where AI tooling is in that timeframe — revisit when we get there.

## CURRENT PHASE: **Phase 1**

All work in this repository is Phase 1 unless explicitly marked otherwise. Do not build Phase 2+ features. If something feels like it belongs in a later phase, write it down as a note for that phase and stay focused.

## Core design principles

These principles guide every decision in every phase.

**Tools-first, sub-agents later.** A tool is a function the main agent calls. A sub-agent is a separate reasoning loop with its own context. Start with tools. Only introduce a sub-agent when there is a concrete reason (parallelism, isolated long context, etc.) — never preemptively.

**Boring durable memory, not "consciousness."** NOVA's memory is a database with good retrieval. It is not conscious. It is designed to *feel* personal through consistency, accumulation, and retrieval — not through metaphysical claims. Avoid framing that overpromises.

**Architect for ambient, run for work hours.** Every piece of infrastructure (memory, events, conversation storage) is designed as if NOVA runs 24/7, even though Phase 1 only runs during active work sessions. This avoids rewrites when Phase 3 arrives.

**Reversibility-based human-in-the-loop.** NOVA acts freely on reversible operations (reads, drafts, searches, previews). NOVA proposes and confirms on irreversible operations (sends, deletes, publishes, bookings, merges, purchases). This rule is permanent, not phase-scoped.

**One brain, many memories.** One coherent agent personality. Many tiers and categories of memory (curated always-loaded, recent auto-loaded, semantic-searchable deep storage). Do not shard the agent itself.

**Human-readable everything.** Personality, facts about Jimmy, and curated memory live as markdown files in the workspace. Only the high-volume semantic memory store uses a database. If Jimmy can't read and edit it as a file, he loses ownership.

**Ship each phase.** A half-built Phase 2 is worse than a finished Phase 1. Every phase ends with something Jimmy actually uses.

## Projects we're learning from

NOVA is not built in a vacuum. A few projects have solved problems we care about, and we're deliberately borrowing their architectural patterns while keeping NOVA as an independent codebase.

### OpenClaw

OpenClaw is a viral open-source personal AI agent framework (Peter Steinberger, late 2025). It has solved a number of real problems in the personal-AI-agent space and its architectural choices are worth studying.

**Patterns we borrow:**

- **File-based personality (SOUL.md, USER.md, MEMORY.md, AGENTS.md)** — Personality and user context live in editable markdown files, not hardcoded in source. Inspectable, versionable, iterable without code changes.
- **Three-tier memory** — Always-loaded curated memory + recent daily context + on-demand semantic search. Solves the retrieval-only weakness of pure RAG.
- **Heartbeat loop** (Phase 3) — Scheduled proactive check-ins with a NO_REPLY sentinel when nothing's urgent. This is how the agent feels ambient and proactive rather than purely reactive.
- **Skills as markdown files** (Phase 2) — Each tool/capability is a `.md` file with YAML frontmatter. Listed as metadata to the model, full details loaded only when triggered. Saves tokens and makes skills pluggable.
- **Memory flush before compaction** (Phase 2) — Silent turn that preserves important context before auto-summarization kicks in.
- **Dreaming** (Phase 3) — Scheduled background pass that promotes short-term signals to long-term memory.
- **Reversibility-based confirmation** — Act freely on reversible actions; confirm on irreversible ones. Cleaner rule than our original "consequential" framing.

**Patterns we deliberately skip:**

- **Third-party skill marketplace (ClawHub)** — Cisco research found ~26% of skills contained security vulnerabilities. NOVA's skills are written by Jimmy (or Claude Code), never installed from a public marketplace.
- **Markdown-only memory storage** — We use pgvector for scalable semantic search. Markdown lives alongside as a human-readable layer, not as the primary store.
- **Full WebSocket gateway protocol** — Over-engineered for Phase 1–2. Adopted in Phase 3 when multi-channel matters.
- **Multi-agent routing with different personalities per channel** — NOVA is one ally, not a fleet. Revisit in Phase 4+ if genuinely useful.

NOVA is its own project. We don't import OpenClaw code, we don't run OpenClaw alongside, we don't fork it. We learn from what they've built and implement our own versions of the patterns that fit NOVA's design.
