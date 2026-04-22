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
