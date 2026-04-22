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
