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
