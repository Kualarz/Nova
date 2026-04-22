# Plan 4a: Headless Agent + Hooks Engine

**Date:** 2026-04-22  
**Spec:** Step 5 — Automation Engine (partial)  
**Scope:** Extract `runPrompt()` (headless agent), add hooks DB table, build `HooksEngine`, wire session lifecycle hooks.  
**Deferred to Plan 4b:** Routines (node-cron), Dispatch queue, Heartbeat loop.

---

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| Hooks column | `skill_name TEXT` (spec) | `SkillLoader.loadAll()` makes "find by name" trivial |
| `runPrompt` memory extraction | Off by default | Prevents every hook/routine run from seeding spurious memories |
| Recursion guard | Depth counter in `fireHook` — skip if depth > 0 | Prevents `tool.before`/`tool.after` events from nesting infinite runTurns |
| `session.end` hook order | Fire hooks **before** memory extraction in `handleShutdown` | Hooks can contribute context to the extraction pass |

---

## Tasks

### Task 1: Migration 004 — hooks table
Create `src/db/migrations/004_automation.sql`:
```sql
CREATE TABLE IF NOT EXISTS hooks (
  id         TEXT PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  event      TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (now()::text)
);
```

### Task 2: Register migration in LocalProvider
Add `'004_automation.sql'` to the `runMigrations()` loop in `src/db/providers/local.ts`.

### Task 3: Add DB interface for hooks
In `src/db/interface.ts`, add:
```typescript
export interface Hook { id: string; event: string; skill_name: string; enabled: number; }
export interface InsertHookParams { event: string; skillName: string; }
// Add to DatabaseProvider:
getEnabledHooks(event: string): Promise<Hook[]>;
insertHook(params: InsertHookParams): Promise<string>;
```
Implement in `LocalProvider`. Add stubs in `SupabaseProvider`.

### Task 4: Extract `runPrompt()` from nova.ts
Add export to `src/agent/nova.ts`:
```typescript
export async function runPrompt(userPrompt: string): Promise<string>
```
Internals:
1. `startConversation()` — own isolated conversation
2. `buildBaseSystemPrompt()` + Tier 3 injection
3. `runTurn(systemPrompt, [{ role: 'user', content: userPrompt }])`
4. `appendMessage()` for both sides
5. `endConversation()` — no memory extraction
6. Return `text`

### Task 5: Build `src/automation/hooks.ts`
```typescript
// Recursion guard — module-level depth counter
let _depth = 0;

export async function fireHook(event: string, context?: Record<string, unknown>): Promise<void>
```
Steps:
1. If `_depth > 0` return immediately (recursion guard)
2. Query `db.getEnabledHooks(event)`
3. For each hook: load skill body via `getSkillLoader().loadAll().find(s => s.name === hook.skill_name)`
4. If skill found: build prompt = skill body + (context ? `\n\nContext: ${JSON.stringify(context)}` : '')
5. `_depth++; try { await runPrompt(prompt) } finally { _depth-- }`
6. Log errors but don't throw (automation must not crash the session)

### Task 6: Wire session lifecycle hooks in nova.ts
- After `console.log('\nNOVA online...')` in `runSession()`: call `fireHook('session.start').catch(() => {})`
- In `handleShutdown()`, before memory extraction: call `await fireHook('session.end').catch(() => {})`

### Task 7: Tests

**`tests/agent/run-prompt.test.ts`**
- Mock `../../src/db/client.js` → in-memory LocalProvider (same pattern as graph.test.ts)
- Mock `../../src/providers/router.js` → stub `embed` + `chat` returning fixed response
- Verify `runPrompt('hello')` returns the mocked response text

**`tests/automation/hooks.test.ts`**
- Mock db client, router, skill loader
- `fireHook('session.start')` with a matching hook → verifies `runPrompt` was called
- `fireHook('unknown.event')` → no-op
- Recursion guard: calling `fireHook` from within a hook handler → inner call skipped

---

## Verification
```
npx vitest run
```
All existing 36 tests still pass. New tests for `runPrompt` and `hooks` pass.
