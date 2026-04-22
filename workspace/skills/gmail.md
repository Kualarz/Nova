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
