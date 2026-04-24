# NOVA — Phase 2 Build Plan

Phase 2 goal: **"The NOVA that executes."** Jimmy can delegate real coding tasks to NOVA, which spawns Claude Code sessions, tracks them, and reports results.

---

## What's already done (built during Phase 1)

These Phase 2 features were scaffolded early and are complete — do not rebuild them:

- **Skills system** — `src/skills/loader.ts`, `src/skills/types.ts`, wired into `system-prompt.ts`
- **Workspace skills files** — `workspace/skills/*.md` (calendar, gmail, web-search, notion, news, weather, dispatch)
- **Hooks system** — `src/automation/hooks.ts`, `004_automation.sql` migration, `hooks` table in DB
- **Model router** — `src/providers/router.ts` with Ollama and OpenRouter support

---

## What this phase builds

### Feature 1 — Claude Code integration

NOVA can spawn a `claude -p` subprocess to execute coding tasks in a specified directory. The `claude` CLI is confirmed installed and working (v2.1.112). `--output-format text` returns the final response as plain text.

**Spawn flow:**
1. Jimmy types `/spawn <task description>` (optionally: `--dir /path/to/project`)
2. NOVA shows what it will do and asks for confirmation (approval gate — see Feature 3)
3. On confirmation: NOVA spawns `claude -p "<task>" --output-format text` as a child process in the target directory
4. NOVA stores the task in the DB with `status = 'running'` and prints the task ID
5. The process runs in the background (non-blocking — Jimmy can continue chatting)
6. On completion: NOVA updates the task to `status = 'done'` with the result text, or `status = 'error'` with stderr
7. NOVA notifies Jimmy inline: `[task <id> done]` on the next turn

**Files:**
- `src/db/migrations/005_tasks.sql` — tasks table
- `src/tasks/store.ts` — DB CRUD for tasks
- `src/tasks/spawn.ts` — spawn subprocess, stream output, update store on completion

### Feature 2 — Task queue and result reporting

Jimmy can inspect running and completed tasks from within a NOVA session.

**Slash commands added:**
- `/spawn <task> [--dir <path>]` — delegate a coding task to Claude Code
- `/tasks` — list all tasks (running + last 10 completed) with status, short description, elapsed time

**Status integration:**
- `npm run nova -- --status` shows total task count and last task status

**Files:**
- `src/agent/slash-commands.ts` — add `/spawn`, `/tasks`
- `src/lib/status.ts` — add task count

### Feature 3 — Human approval gates (structural)

Phase 1 had soft approval (AGENTS.md instructed the model to ask). Phase 2 adds a **structural** `confirm()` primitive that gates the `/spawn` command — the code itself cannot proceed without a `y` response, regardless of what the model says.

```
NOVA will spawn a Claude Code session.
  Task: Build a login form
  Directory: /Users/jimmy/Projects/my-app
  This will run claude -p and may modify files in that directory.
Proceed? (y/n) _
```

**File:** `src/lib/confirm.ts` — readline-based y/n prompt, returns boolean

This same primitive is available for any future irreversible structural action. It is NOT used for reversible tool calls — those are handled by the model's AGENTS.md instructions.

### Feature 4 — Memory flush (periodic extraction)

In NOVA's context, "flush before compaction" means: **proactively extract and store memories during long sessions**, so important context is never lost if the session ends unexpectedly or grows very long.

This is NOT about Claude's auto-compaction (NOVA doesn't run inside Claude Code's compaction harness). It is: every 20 turns in the session, run `extractMemories` + `reconcileMemories` silently on the conversation so far. Reset the counter after each flush.

**File:** `src/memory/flush.ts` — `shouldFlush(turnCount)` + `flushMemories(transcript)` — called from the main agent loop in `nova.ts`

---

## Build order

1. `005_tasks.sql` — schema first
2. DB interface + provider implementations — add task methods
3. `src/tasks/store.ts` and `src/tasks/spawn.ts`
4. `src/lib/confirm.ts`
5. `src/memory/flush.ts`
6. Wire flush into `nova.ts`
7. Add `/spawn` and `/tasks` to `slash-commands.ts`
8. Update `status.ts` for task count
9. Write `workspace/skills/claude-code.md` skill file
10. TypeScript check + test pass

---

## What we are not building in Phase 2

- Skills marketplace — security risk (PROJECT.md)
- Multi-agent routing / different personalities per channel — Phase 4+
- WebSocket gateway — Phase 3
- Heartbeat / dreaming — Phase 3
- Voice layer — Phase 4

---

## Phase 2 definition of done

- Jimmy can type `/spawn build a todo CLI in TypeScript --dir /path/to/project` and NOVA spawns a Claude Code session, tracks it, and reports the result
- `/tasks` shows current and recent tasks with status
- Memory flush runs silently every 20 turns (verifiable by checking Tier 3 count growing within a long session)
- The structural `confirm()` gate blocks task spawning until Jimmy explicitly types `y`
- TypeScript clean, all existing tests pass
