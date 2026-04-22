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
