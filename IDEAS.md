# IDEAS

Captured ideas, visions, and feature concepts that came up during work but aren't being built yet. Nothing here is committed to a phase or scheduled — but nothing here is lost either.

## How this file works

- When Jimmy mentions a vision, idea, or feature while we are focused on something else, capture it here. Date-stamped. Verbatim or lightly summarized so the meaning survives.
- Stay focused on the current task — do not pivot.
- Revisit this file periodically to promote ideas into `PROJECT.md`, a phase plan, or `ARCHITECTURE.md` when they're ready to be built.
- Keep entries short and meaningful. If an entry grows past a screen, split it into its own design doc and link it.

---

## 2026-04-26 — Web UI: two-pane conversation + Nova as orchestrator

### Vision (from Jimmy)

A web UI for Nova built around two parts:

**1. Main "everything" conversation (the big container)**
- One long-running stream where Jimmy and Nova talk like friends, coworkers, partners
- Contains a lot of conversation across many sessions — not reset per session
- Nova learns from this stream over time (patterns, preferences, opinions)
- All topics flow together: consultation, casual chat, planning, advice
- This is the *primary* surface — most of the relationship lives here
- Jimmy can click in and talk to Nova personally
- **Voice + text together**: Nova replies with voice *and* shows the transcript. Jimmy speaks *and* his text appears too. Both directions: voice + transcript visible at the same time.

**2. Focused topic sessions (the side container)**
- Separate sessions scoped to a specific topic
- Still inherit the full memory and Nova's personality
- The conversation stays focused on the chosen topic
- Used when Jimmy wants to dig deep on one thing without polluting the main stream
- Same voice + transcript treatment as the main pane

### Nova as UI orchestrator + multi-agent coordinator

Jimmy talks only to Nova. Nova drives everything else.

- Jimmy tells Nova: "build me this website"
- Nova plans, advises, then **calls upon other agents** (e.g. a coding agent)
- Nova clicks the coding feature itself, opens the relevant tool window
- A window pops up showing the coding agent working — visible process
- Nova converses **both** with Jimmy *and* with the coding agent in real time, like a real assistant managing a contractor
- Jimmy grants permission for what Nova is allowed to do; Nova respects those bounds
- Nova asks before irreversible actions; acts freely on reversible ones (already in the reversibility rule)

### The throughline

Nova is Jimmy's assistant *and* his friend *and* his coworker *and* his business partner *and* his companion along the journey. The UI should reflect this: it should feel like talking to a person who can also drive your tools, not like talking to a chatbot inside a tool.

### Where this lands in the existing roadmap

- The web dashboard is currently a one-line item in **Phase 3**
- The agent-orchestration piece overlaps with **Phase 2** (Claude Code integration) and **Phase 4** (NOVA operates tools)
- The voice piece is currently sketched as Phase 4-5 (Whisper + ElevenLabs)
- This vision suggests a richer Phase 3+ that fuses these together — worth expanding `PROJECT.md` when we get there

### Open questions for later

- Single workspace per user, or one per topic-thread on the side pane?
- Does the main "everything" conversation paginate / archive old context, or is it infinite scroll backed by memory tiers?
- Voice playback: real-time streaming TTS or wait-for-full-response?
- How does Nova "click the coding feature" — actual UI automation, or function-call style with a UI surface that reflects the call?
- Permission model: per-action prompts, persistent grants, role-based scopes, or some mix?
