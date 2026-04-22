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
