# NOVA Phase 2 — Plan 2: Skills System

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make NOVA's capabilities loadable from markdown files in `workspace/skills/`. Each skill is a `.md` file with YAML frontmatter (name, description, tools) and a body of usage instructions. At startup the skill loader reads all skill files, parses them, and their content is injected into the system prompt. Adding a new skill = drop a `.md` file in `workspace/skills/` and restart.

**Design decision (inject-all):** All active skill bodies are injected into the system prompt at startup. No lazy-loading in this plan — prompt overhead is acceptable for ≤15 skills with moderate body sizes. Optimise in a future plan if needed.

**Architecture:** `src/skills/loader.ts` reads `workspace/skills/*.md`, parses frontmatter with `gray-matter`, and returns structured `Skill` objects. `src/agent/system-prompt.ts` calls the loader and includes skill descriptions + bodies in the base system prompt. Existing tool implementations in `src/agent/tools/index.ts` are **unchanged** — skills add instruction context on top of the executable tools.

**Spec reference:** `docs/superpowers/specs/2026-04-22-nova-phase2-design.md` — Section 6.

---

## Prerequisites (do before Task 1)

```bash
# Verify all 19 Plan 1 tests still pass
npm test
```

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/skills/loader.ts` | Create | SkillLoader — reads workspace/skills/*.md, parses frontmatter |
| `src/skills/types.ts` | Create | Skill, SkillFrontmatter types |
| `src/agent/system-prompt.ts` | Modify | Add `buildSkillsContext()`, inject into base system prompt |
| `workspace/skills/web-search.md` | Create | Skill for `web_search` tool |
| `workspace/skills/weather.md` | Create | Skill for `get_weather` tool |
| `workspace/skills/news.md` | Create | Skill for `get_news` tool |
| `workspace/skills/notion.md` | Create | Skill for `notion_search`, `notion_get_page`, `notion_create_page` |
| `workspace/skills/calendar.md` | Create | Skill for `list_calendar_events` |
| `workspace/skills/gmail.md` | Create | Skill for `search_emails` |
| `workspace/skills/dispatch.md` | Create | Stub skill for future dispatch tool |
| `tests/skills/loader.test.ts` | Create | Unit tests for SkillLoader |

---

## Task 1: Install gray-matter

`gray-matter` parses YAML/TOML frontmatter from markdown files. It's the standard tool for this pattern (used by Jekyll, Next.js, Hugo).

- [ ] **Step 1: Install gray-matter**

```bash
npm install gray-matter
npm install --save-dev @types/gray-matter
```

- [ ] **Step 2: Verify import works (ESM check)**

Run a quick check to make sure gray-matter works in ESM:

```bash
node --input-type=module <<'EOF'
import matter from 'gray-matter';
const result = matter('---\nname: test\n---\n\n# Body');
console.log('gray-matter OK:', result.data.name, '|', result.content.trim());
EOF
```

Expected output: `gray-matter OK: test | # Body`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: install gray-matter for skill frontmatter parsing"
```

---

## Task 2: Skill Types

**Files:**
- Create: `src/skills/types.ts`

- [ ] **Step 1: Create types file**

Create `src/skills/types.ts`:

```typescript
/** Parsed frontmatter from a skill .md file. */
export interface SkillFrontmatter {
  /** Unique skill identifier — matches the filename without .md */
  name: string;
  /** One-sentence description shown to the model as context */
  description: string;
  /** Tool names this skill covers — must match keys in ALL_TOOLS */
  tools: string[];
  /** Whether this skill's actions can be undone. Default: true */
  reversible?: boolean;
  /** Whether this skill is enabled. Default: true */
  enabled?: boolean;
}

/** A fully parsed skill — frontmatter + body content. */
export interface Skill {
  /** Unique identifier (from frontmatter or filename) */
  name: string;
  /** One-sentence description */
  description: string;
  /** Tool names this skill covers */
  tools: string[];
  /** Whether this skill's actions can be undone */
  reversible: boolean;
  /** Whether this skill is active */
  enabled: boolean;
  /** Full markdown body — usage instructions for the model */
  body: string;
  /** Absolute path to the source .md file */
  filePath: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/skills/types.ts
git commit -m "feat: add Skill and SkillFrontmatter types"
```

---

## Task 3: SkillLoader (TDD)

**Files:**
- Create: `src/skills/loader.ts`
- Create: `tests/skills/loader.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/skills/loader.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SkillLoader } from '../../src/skills/loader.js';

function mkTmp(): string {
  const dir = join(tmpdir(), `nova-skills-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('SkillLoader', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkTmp();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads a single skill from a .md file', async () => {
    writeFileSync(join(tmpDir, 'web-search.md'), [
      '---',
      'name: web-search',
      'description: Search the web for current information',
      'tools:',
      '  - web_search',
      'reversible: true',
      '---',
      '',
      '# Web Search',
      '',
      'Always cite the source URL.',
    ].join('\n'));

    const loader = new SkillLoader(tmpDir);
    const skills = await loader.loadAll();

    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('web-search');
    expect(skills[0]!.description).toBe('Search the web for current information');
    expect(skills[0]!.tools).toEqual(['web_search']);
    expect(skills[0]!.reversible).toBe(true);
    expect(skills[0]!.enabled).toBe(true);
    expect(skills[0]!.body).toContain('Always cite the source URL');
  });

  it('returns empty array when skills directory does not exist', async () => {
    const loader = new SkillLoader('/nonexistent/path');
    const skills = await loader.loadAll();
    expect(skills).toEqual([]);
  });

  it('skips disabled skills', async () => {
    writeFileSync(join(tmpDir, 'disabled.md'), [
      '---',
      'name: disabled-skill',
      'description: This skill is off',
      'tools: []',
      'enabled: false',
      '---',
      '',
      'Disabled body.',
    ].join('\n'));

    const loader = new SkillLoader(tmpDir);
    const skills = await loader.loadAll();
    expect(skills).toEqual([]);
  });

  it('loads multiple skills and skips non-.md files', async () => {
    writeFileSync(join(tmpDir, 'weather.md'), [
      '---',
      'name: weather',
      'description: Get current weather',
      'tools:',
      '  - get_weather',
      '---',
      '',
      'Weather instructions.',
    ].join('\n'));

    writeFileSync(join(tmpDir, 'news.md'), [
      '---',
      'name: news',
      'description: Fetch news headlines',
      'tools:',
      '  - get_news',
      '---',
      '',
      'News instructions.',
    ].join('\n'));

    // Non-.md files should be ignored
    writeFileSync(join(tmpDir, 'README.txt'), 'ignore me');

    const loader = new SkillLoader(tmpDir);
    const skills = await loader.loadAll();

    expect(skills).toHaveLength(2);
    const names = skills.map(s => s.name).sort();
    expect(names).toEqual(['news', 'weather']);
  });

  it('buildSkillsPrompt returns formatted string with all skill bodies', async () => {
    writeFileSync(join(tmpDir, 'weather.md'), [
      '---',
      'name: weather',
      'description: Get current weather',
      'tools:',
      '  - get_weather',
      '---',
      '',
      'Check weather with get_weather tool.',
    ].join('\n'));

    const loader = new SkillLoader(tmpDir);
    const prompt = await loader.buildSkillsPrompt();

    expect(prompt).toContain('## Skills');
    expect(prompt).toContain('weather');
    expect(prompt).toContain('Check weather with get_weather tool.');
  });

  it('buildSkillsPrompt returns empty string when no skills', async () => {
    const loader = new SkillLoader(tmpDir);
    const prompt = await loader.buildSkillsPrompt();
    expect(prompt).toBe('');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- tests/skills/loader.test.ts
```

Expected: FAIL with `Cannot find module '../../src/skills/loader.js'`

- [ ] **Step 3: Implement SkillLoader**

Create `src/skills/loader.ts`:

```typescript
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import type { Skill, SkillFrontmatter } from './types.js';

export class SkillLoader {
  private skillsDir: string;
  private _skills: Skill[] | null = null;

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
  }

  /** Load all enabled skills from the skills directory. Results are cached per instance. */
  async loadAll(): Promise<Skill[]> {
    if (this._skills !== null) return this._skills;

    if (!existsSync(this.skillsDir)) {
      this._skills = [];
      return this._skills;
    }

    let files: string[];
    try {
      files = readdirSync(this.skillsDir).filter(f => f.endsWith('.md'));
    } catch {
      this._skills = [];
      return this._skills;
    }

    const skills: Skill[] = [];

    for (const file of files) {
      const filePath = join(this.skillsDir, file);
      try {
        const raw = readFileSync(filePath, 'utf8');
        const parsed = matter(raw);
        const fm = parsed.data as Partial<SkillFrontmatter>;

        // Skip if explicitly disabled
        if (fm.enabled === false) continue;

        // Name defaults to filename without .md
        const name = fm.name ?? file.replace(/\.md$/, '');
        const description = fm.description ?? '';
        const tools = Array.isArray(fm.tools) ? fm.tools : [];
        const reversible = fm.reversible !== false; // default true
        const enabled = fm.enabled !== false;       // default true
        const body = parsed.content.trim();

        skills.push({ name, description, tools, reversible, enabled, body, filePath });
      } catch (err) {
        console.warn(`[skills] Failed to parse ${file}: ${(err as Error).message}`);
      }
    }

    this._skills = skills;
    return skills;
  }

  /** Return a formatted prompt section with all skill bodies, ready to inject into system prompt. */
  async buildSkillsPrompt(): Promise<string> {
    const skills = await this.loadAll();
    if (skills.length === 0) return '';

    const lines: string[] = ['## Skills'];
    lines.push('');
    lines.push(`NOVA has ${skills.length} active skill${skills.length !== 1 ? 's' : ''}. Each skill provides instructions for using a set of tools.`);
    lines.push('');

    for (const skill of skills) {
      lines.push(`### ${skill.name}`);
      lines.push(`**Tools:** ${skill.tools.join(', ') || 'none'}`);
      lines.push(`**Description:** ${skill.description}`);
      lines.push('');
      if (skill.body) {
        lines.push(skill.body);
        lines.push('');
      }
    }

    return lines.join('\n').trimEnd();
  }

  /** Invalidate cache (call after a skill file is edited). */
  invalidate(): void {
    this._skills = null;
  }
}

// Module-level singleton — points to workspace/skills/ relative to cwd
let _loader: SkillLoader | null = null;

export function getSkillLoader(skillsDir?: string): SkillLoader {
  if (!_loader) {
    const dir = skillsDir ?? join(process.cwd(), 'workspace', 'skills');
    _loader = new SkillLoader(dir);
  }
  return _loader;
}

export function resetSkillLoader(): void {
  _loader = null;
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- tests/skills/loader.test.ts
```

Expected:
```
✓ tests/skills/loader.test.ts (6)
Test Files  1 passed (1)
Tests       6 passed (6)
```

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all 25 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/skills/loader.ts src/skills/types.ts tests/skills/loader.test.ts
git commit -m "feat: add SkillLoader — parses workspace/skills/*.md with gray-matter"
```

---

## Task 4: Create Skill Files for Existing Tools

**Files:**
- Create: `workspace/skills/web-search.md`
- Create: `workspace/skills/weather.md`
- Create: `workspace/skills/news.md`
- Create: `workspace/skills/notion.md`
- Create: `workspace/skills/calendar.md`
- Create: `workspace/skills/gmail.md`
- Create: `workspace/skills/dispatch.md`

Each skill file teaches NOVA *how* to use the corresponding tool well. The frontmatter maps it to the tool name; the body provides usage instructions.

- [ ] **Step 1: Create `workspace/skills/web-search.md`**

```markdown
---
name: web-search
description: Search the web for current information, recent events, or anything outside training data
tools:
  - web_search
reversible: true
---

# Web Search

Use this skill when the user asks about current events, recent news, facts that may have changed since your training, specific URLs, or anything you are not confident about.

**Always:**
- Cite the source URL in your response
- Return the top 3 most relevant results with title, URL, and a 1-2 sentence summary
- Prefer recent results (check publication dates)
- If results are outdated or irrelevant, say so and suggest a more specific search query

**Never:**
- Fabricate search results
- Present search summaries as confirmed facts without qualification
- Search for things you already know with high confidence from training data
```

- [ ] **Step 2: Create `workspace/skills/weather.md`**

```markdown
---
name: weather
description: Get the current weather and forecast for any location
tools:
  - get_weather
reversible: true
---

# Weather

Use this skill to answer weather questions. Jimmy is based in Melbourne, Australia — default to Melbourne when no location is specified.

**Response format:**
- Current conditions (temp in °C, feels like, humidity, wind)
- Short 2-3 day outlook if the user asks about plans
- Convert to °F only if the user explicitly asks

**When to use:**
- "What's the weather like?"
- "Should I bring an umbrella today?"
- "Is it going to rain this week?"
- Any travel planning involving weather

**When not to use:**
- Historical weather data (not available in this tool)
- Climate science questions (use your training data)
```

- [ ] **Step 3: Create `workspace/skills/news.md`**

```markdown
---
name: news
description: Fetch current news headlines on any topic from configured RSS feeds
tools:
  - get_news
reversible: true
---

# News

Use this skill when Jimmy wants to catch up on news. The tool reads from RSS feeds configured in `workspace/news-feeds.yaml`.

**Response format:**
- Group headlines by topic when showing multiple feeds
- Include publication time (relative: "2 hours ago")
- Brief 1-sentence summary per article
- Link to full article if Jimmy wants to read more

**When to use:**
- "What's in the news?"
- "Any AI news today?"
- "Catch me up on [topic]"
- Morning briefing routines

**Handling gaps:**
If a feed returns no results or errors, mention it briefly and continue with working feeds. Do not show stack traces.
```

- [ ] **Step 4: Create `workspace/skills/notion.md`**

```markdown
---
name: notion
description: Search, read, and create pages in Jimmy's Notion workspace
tools:
  - notion_search
  - notion_get_page
  - notion_create_page
reversible: false
---

# Notion

Jimmy uses Notion for notes, project tracking, and knowledge management. This skill covers searching and reading pages (safe) and creating new pages (irreversible — confirm with Jimmy before creating).

**Search (notion_search):**
- Use for: "find my notes on X", "search Notion for Y", "do I have anything on Z"
- Always show: page title, last edited date, brief excerpt
- If no results: say so clearly, offer to create a new page

**Read page (notion_get_page):**
- Use after search to get full content of a specific page
- Summarize long pages rather than dumping raw content

**Create page (notion_create_page) — requires confirmation:**
- Ask Jimmy to confirm before creating: "I'll create a new Notion page titled '[title]' — should I go ahead?"
- Default parent: Jimmy's main workspace unless he specifies a database/page

**Privacy:** Notion content is personal — never include Notion page content in summaries saved to memory without Jimmy's permission.
```

- [ ] **Step 5: Create `workspace/skills/calendar.md`**

```markdown
---
name: calendar
description: Read Jimmy's Google Calendar — upcoming events, free/busy slots, scheduling context
tools:
  - list_calendar_events
reversible: true
---

# Calendar

Use this skill to check Jimmy's schedule. The tool reads from Google Calendar (read-only).

**When to use:**
- "What do I have today / this week?"
- "Am I free on Thursday afternoon?"
- "When is my next meeting?"
- Morning briefings and routine check-ins
- Before suggesting scheduling anything

**Response format:**
- Show events in chronological order
- Include: time, title, duration, location (if set)
- Highlight conflicts if any
- Use Melbourne time (AEST/AEDT)

**Interpreting results:**
- All-day events: show date only, no time
- Multi-day events: show start and end date
- If calendar is empty for a period: confirm "Nothing scheduled"
```

- [ ] **Step 6: Create `workspace/skills/gmail.md`**

```markdown
---
name: gmail
description: Search Jimmy's Gmail inbox for emails, threads, and attachments
tools:
  - search_emails
reversible: true
---

# Gmail

Use this skill to search Jimmy's email. The tool uses Gmail search syntax (read-only).

**When to use:**
- "Did I get an email from X?"
- "Find emails about Y"
- "Check if my invoice from Z arrived"
- Following up on something mentioned in conversation

**Response format:**
- Show: sender, subject, date, brief snippet
- List up to 5 results; if more exist, mention the count
- If the user wants to read a specific email, say you can show the full thread

**Gmail search tips:**
- `from:person@example.com` — from a specific sender
- `subject:keyword` — subject line search
- `has:attachment` — emails with attachments
- `is:unread` — unread emails
- Combine with `after:2024/01/01` for date filtering

**Privacy:** Email content is sensitive. Do not store email content in memory without explicit user request.
```

- [ ] **Step 7: Create `workspace/skills/dispatch.md`**

```markdown
---
name: dispatch
description: Queue a background task for NOVA to work on asynchronously (Phase 2 Plan 5)
tools: []
enabled: false
---

# Dispatch (Coming in Plan 5)

This skill will allow Jimmy to dispatch long-running tasks to a background worker. Examples:
- "Research the top 5 Python web frameworks and summarise to Notion"
- "Every morning, check my calendar and prepare talking points"

Not yet implemented. Enable this skill when the Automation Engine (Plan 5) is complete.
```

- [ ] **Step 8: Verify files exist**

```bash
ls workspace/skills/
```

Expected: `web-search.md  weather.md  news.md  notion.md  calendar.md  gmail.md  dispatch.md`

- [ ] **Step 9: Commit**

```bash
git add workspace/skills/
git commit -m "feat: add skill files for all Phase 1 tools"
```

---

## Task 5: Inject Skills into System Prompt

**Files:**
- Modify: `src/agent/system-prompt.ts`

The skill context is injected into the base system prompt. `buildBaseSystemPrompt()` becomes async since it now calls the skill loader.

- [ ] **Step 1: Update `src/agent/system-prompt.ts`**

Replace the entire file:

```typescript
import { loadWorkspace } from '../workspace/loader.js';
import { getTier2Context } from '../memory/tier2-daily.js';
import { searchTier3 } from '../memory/tier3-semantic.js';
import { getSkillLoader } from '../skills/loader.js';

function currentDateTime(): string {
  return new Date().toLocaleString('en-AU', {
    timeZone: 'Australia/Melbourne',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export async function buildBaseSystemPrompt(): Promise<string> {
  const ws = loadWorkspace();
  const tier2 = getTier2Context();
  const skillsContext = await getSkillLoader().buildSkillsPrompt();

  const parts: string[] = [
    ws.soul,
    ws.agents,
    `## User Profile\n${ws.user}`,
    `## Curated Memory (Tier 1)\n${ws.tier1Memory}`,
  ];

  if (tier2.trim()) {
    parts.push(`## Recent Context (last 2 days)\n${tier2}`);
  }

  parts.push(`## Current Session\n- ${currentDateTime()} (Melbourne, Australia)\n- Phase 2: Skills System active`);

  if (skillsContext) {
    parts.push(skillsContext);
  }

  return parts.join('\n\n---\n\n');
}

export async function buildTier3Injection(query: string): Promise<string> {
  const { formattedContext } = await searchTier3(query, 10);
  if (!formattedContext) return '';
  return `## Relevant Memories (Tier 3)\n${formattedContext}`;
}
```

> **Note:** `buildBaseSystemPrompt()` is now async. Update all callers.

- [ ] **Step 2: Update `src/agent/nova.ts` to await the system prompt**

In `nova.ts`, find the call to `buildBaseSystemPrompt()` and add `await`:

```typescript
// Before (in runSession):
let systemPrompt = buildBaseSystemPrompt();

// After:
let systemPrompt = await buildBaseSystemPrompt();
```

Also update the import:
```typescript
import { buildBaseSystemPrompt, buildTier3Injection } from './system-prompt.js';
```

(The import line doesn't change — just ensure `await` is present on the call.)

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Fix any type errors (likely caller sites where `buildBaseSystemPrompt()` was used without `await`).

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: all tests pass. (System prompt tests aren't unit-tested — it's an integration concern covered by the smoke test.)

- [ ] **Step 5: Commit**

```bash
git add src/agent/system-prompt.ts src/agent/nova.ts
git commit -m "feat: inject active skill bodies into system prompt at startup"
```

---

## Task 6: Add Skills Directory to .gitignore Exception

The `workspace/skills/` directory contains non-personal skill files that should be version-controlled (unlike `MEMORY.md`, `USER.md`, etc.).

- [ ] **Step 1: Verify workspace/skills/ is not ignored**

```bash
git check-ignore -v workspace/skills/web-search.md
```

Expected: no output (file is NOT ignored). If it IS ignored, add an exception to `.gitignore`:

```
# Skills — version-controlled (not personal data)
!workspace/skills/
```

- [ ] **Step 2: Run final test suite**

```bash
npm test
```

Expected: all tests pass (19 Plan 1 tests + 6 new skills tests = 25 total).

- [ ] **Step 3: TypeScript compile check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Smoke test — verify skills load on boot**

```bash
DATABASE_TYPE=local MODEL_PROVIDER=ollama NOVA_WORKSPACE_PATH=./workspace npm run nova
```

When NOVA boots, it should silently load 6 active skills (dispatch is `enabled: false`). Type `what's the weather in Melbourne` — NOVA should call `get_weather` tool. Ctrl+C to exit.

- [ ] **Step 5: Final commit**

```bash
git add .gitignore
git commit -m "feat: Plan 2 complete — Skills System with 6 active skills loaded at startup"
```

---

## Spec Coverage Self-Review

| Spec requirement | Covered by |
|---|---|
| Skill files as .md with YAML frontmatter | Task 2 (types) + Task 3 (loader) |
| `workspace/skills/` directory with skill files | Task 4 |
| Skill loader reads frontmatter + body | Task 3 |
| Skills listed as context in system prompt | Task 5 |
| Disabled skills (`enabled: false`) skipped | Task 3 (loader) |
| Existing Phase 1 tools work as skills | Task 4 (6 skill files) |
| `dispatch.md` stub (for Plan 5) | Task 4 Step 7 |

Spec Section 6 "Skills System" is covered. `self-update.md` (Section 12) is deferred to Plan 7 (Self-Awareness).
