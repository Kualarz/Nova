---
name: claude-code
description: Delegate coding tasks to Claude Code via /spawn. Use when Jimmy asks NOVA to build, fix, or refactor code in a project directory.
tools: []
reversible: false
enabled: true
---

## When to use

Use `/spawn` when Jimmy asks you to:
- Build a feature, component, or script in a project
- Fix a bug in a codebase
- Refactor or reorganise code
- Write tests for existing code
- Set up a new project scaffold

Do not suggest `/spawn` for quick code snippets or explanations — answer those directly.

## How to guide Jimmy

When a task is suitable for Claude Code, tell Jimmy:

> I can delegate this to Claude Code. Use:
> `/spawn <clear task description> --dir <absolute path to project>`

Write the task description as a clear, direct instruction to an engineer — Claude Code will read it as its first prompt. Include enough context that it can start without asking questions.

**Example:**
> `/spawn "Add a login form to the React app. Use Tailwind for styling. Form fields: email, password. On submit, POST to /api/auth/login and redirect to /dashboard on success." --dir /Users/jimmy/Projects/my-app`

## After spawning

NOVA will notify you inline when the task completes. Use `/tasks` to see all running and recent tasks with their output.

If a task errors, check `/tasks` for the error message. Common issues:
- Wrong `--dir` path (use absolute paths)
- Claude Code doesn't have context about the project — make the task description more specific
- The task is too large — break it into smaller `/spawn` calls
