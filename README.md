# Signal — Contact Center Insights Agent

A live agent that unifies real-time data from multiple contact center systems
(Genesys PureCloud, Amazon Connect, Salesforce) into one picture, monitors it
continuously, and reasons with Claude — using real tool-calling — about when
something is actually worth flagging.

Built to explore agentic AI architecture against a domain I know well: 9 years
in CX / contact center solutions consulting keeps surfacing the same gap —
fragmented vendor data, no unified real-time view, no proactive alerting. This
is what solving that looks like with an agent instead of a static dashboard.

<img width="1153" height="878" alt="Screenshot 2026-07-25 at 21 55 06" src="https://github.com/user-attachments/assets/1a22de66-6bb7-4946-bff7-f36bb0eda9c8" />

<img width="1153" height="878" alt="Screenshot 2026-07-25 at 21 56 14" src="https://github.com/user-attachments/assets/9b3b2742-b82f-4142-ad11-b515f3c5f8b9" />


---

## What it does

- **Unifies three vendor sources** behind one adapter contract — SLA/AHT from
  Genesys, volume/abandonment from Amazon Connect, sentiment from Salesforce
- **Monitors autonomously** on a continuous loop: Observe → Evaluate → Decide → Act,
  logged transparently in an activity panel
- **Calls the model only when it matters** — a deterministic rule engine checks
  thresholds every cycle for free; Claude is only invoked on a real breach or a
  routine cadence, not on every tick
- **Uses real tool-calling** — Claude has functions (`get_metric_trend`,
  `get_active_alerts`, `list_connected_sources`) and decides for itself when it
  needs more context before answering
- **Answers on demand** via chat, grounded in the same live snapshot and tools
- **Speaks two audiences** — an Ops Manager view (granular, sparklines) and an
  Executive view (headline metrics, business-impact framing)

## Architecture

Full write-up with diagram: [`cx-insights-agent-architecture.md`](./cx-insights-agent-architecture.md)

```
Vendor Systems → Adapter Layer → Normalize/Merge → Metric History
                                                          ↓
                                                     Evaluate (rules)
                                                          ↓
                                                       Decide
                                              ┌───────────┼───────────┐
                                         Escalate    Routine      Idle
                                              └───────────┼
                                                    Agent Core (Claude + tools)
                                                          ↓
                                                   Narrative / Alert → UI
```

## Tech stack

- React (hooks-based state, no external state library)
- Recharts for sparkline trend visualization
- Anthropic API (`claude-sonnet-4-6`) with function calling / tool use
- Adapter pattern for pluggable data sources

## Getting a screenshot

This was built and run as a Claude Artifact. Open the artifact in your Claude
conversation, let it run for a minute so the dashboard populates with live
data and an AI insight, then take a screenshot (or a short screen recording
converted to GIF) and drop it in `docs/screenshot-dashboard.png`.

## Running it

This was built as a Claude Artifact — the API calls are proxied by Claude.ai's
artifact sandbox without needing a key. To run it as a standalone app outside
that environment:

1. Add a lightweight backend (e.g. a serverless function) that holds your
   Anthropic API key and proxies requests to `/v1/messages` — never expose the
   key client-side.
2. Point the `callClaudeRaw` function in `cx-insights-agent.jsx` at your proxy
   endpoint instead of `https://api.anthropic.com/v1/messages`.
3. Swap the mock adapters (`GenesysAdapter`, `ConnectAdapter`,
   `SalesforceAdapter`) for real implementations of the same `poll()`
   contract — see the adapter section in the architecture doc.

## What's mocked vs. production-ready

| Component | Here | In production |
|---|---|---|
| Data sources | Simulated state | Real vendor SDKs/REST APIs behind the same `poll()` contract |
| Alerts | UI banner | Twilio (SMS) / SendGrid (email) / Slack webhook |
| History | In-memory array | Time-series store (TimescaleDB, DynamoDB) |
| Scheduling | Browser `setInterval` | Serverless cron / queue worker |

---

Built by [Adity Rastogi](https://www.linkedin.com/in/adityrastogi/) — Senior Solutions
Consultant with a background in Genesys PureCloud, Amazon Connect, Salesforce
integration, and enterprise CX analytics, currently building toward Solution
Architecture and agentic AI.
