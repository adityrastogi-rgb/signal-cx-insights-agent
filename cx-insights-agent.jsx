import React, { useState, useEffect, useRef, useCallback } from "react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import {
  Radio,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Settings2,
  Send,
  X,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Plug,
  Terminal,
} from "lucide-react";

// =====================================================================================
// DESIGN TOKENS
// =====================================================================================
const COLORS = {
  ink: "#0A1120",
  panel: "#111B2E",
  panelAlt: "#0D1626",
  steel: "#233350",
  steelLight: "#2E4166",
  teal: "#2DD9C4",
  tealDim: "#1B7A6E",
  amber: "#F2A93B",
  coral: "#FF6767",
  violet: "#9B8CFF",
  mist: "#8CA0BE",
  paper: "#E9EEF7",
  paperDim: "#C3CEE0",
};
const FONT_DISPLAY = "'Space Grotesk', 'IBM Plex Sans', sans-serif";
const FONT_BODY = "'IBM Plex Sans', 'Inter', sans-serif";
const FONT_MONO = "'IBM Plex Mono', 'Roboto Mono', monospace";

// =====================================================================================
// MODULE: ADAPTERS
// Each adapter implements the same contract: { id, label, color, status, poll() }.
// poll() resolves to a partial, source-scoped metrics snapshot. In production, poll()
// is where the Genesys / Amazon Connect / Salesforce SDK or REST call would live —
// the agent core never knows or cares which vendor it's talking to.
// =====================================================================================

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// -- Mock state each adapter mutates independently, as if reading from a real backend --
const mockState = {
  sla: 93,
  aht: 235,
  volume: 118,
  abandon: 3,
  sentiment: 0.32,
};

function jitterMockState() {
  const surge = Math.random() < 0.14 ? 1 : 0;
  mockState.volume = clamp(mockState.volume + (Math.random() - 0.45) * 14 + surge * 35, 50, 260);
  mockState.sla = clamp(mockState.sla + (Math.random() - 0.5) * 2 - (surge ? 6 : 0), 70, 99);
  mockState.abandon = clamp(mockState.abandon + (Math.random() - 0.5) * 0.9 + (surge ? 2.4 : 0), 0.5, 14);
  mockState.aht = clamp(mockState.aht + (Math.random() - 0.5) * 15 + surge * 40, 170, 420);
  mockState.sentiment = clamp(mockState.sentiment + (Math.random() - 0.5) * 0.07 - (surge ? 0.18 : 0), -0.6, 0.75);
}

// GenesysAdapter — production version would call the Genesys Cloud Analytics/Queues API
const GenesysAdapter = {
  id: "genesys",
  label: "Genesys PureCloud",
  color: COLORS.teal,
  status: "connected", // mocked but wired end-to-end
  async poll() {
    await new Promise((r) => setTimeout(r, 60 + Math.random() * 80));
    return { source: "genesys", timestamp: new Date().toISOString(), metrics: { sla: mockState.sla, aht: mockState.aht } };
  },
};

// AmazonConnectAdapter — production version would call Connect's real-time metrics API
const ConnectAdapter = {
  id: "connect",
  label: "Amazon Connect",
  color: COLORS.amber,
  status: "connected",
  async poll() {
    await new Promise((r) => setTimeout(r, 60 + Math.random() * 80));
    return { source: "connect", timestamp: new Date().toISOString(), metrics: { volume: mockState.volume, abandon: mockState.abandon } };
  },
};

// SalesforceAdapter — production version would pull case sentiment via Service Cloud / Einstein
const SalesforceAdapter = {
  id: "sfdc",
  label: "Salesforce Cases",
  color: COLORS.violet,
  status: "connected",
  async poll() {
    await new Promise((r) => setTimeout(r, 60 + Math.random() * 80));
    return { source: "sfdc", timestamp: new Date().toISOString(), metrics: { sentiment: mockState.sentiment } };
  },
};

// Placeholder adapters shown as "available" to make the plug-in story concrete
const AVAILABLE_ADAPTERS = [
  { id: "nice", label: "NICE inContact", color: "#6E8CFF", status: "available" },
  { id: "zendesk", label: "Zendesk Talk", color: "#7DDA9C", status: "available" },
];

const ACTIVE_ADAPTERS = [GenesysAdapter, ConnectAdapter, SalesforceAdapter];

// =====================================================================================
// MODULE: NORMALIZATION
// Merges partial, source-scoped snapshots into one unified metric point per tick —
// this is the layer that removes "multiple data sources, no single picture."
// =====================================================================================
function mergeSnapshots(partials) {
  const merged = {};
  for (const p of partials) Object.assign(merged, p.metrics);
  return merged;
}

// =====================================================================================
// MODULE: METRIC DEFINITIONS + RULE ENGINE (the agent's EVALUATE step)
// =====================================================================================
const METRIC_DEFS = [
  { key: "sla", label: "SLA Adherence", unit: "%", source: "genesys", decimals: 1, threshold: { op: "lt", warn: 88, critical: 82 }, good: "high" },
  { key: "abandon", label: "Abandonment Rate", unit: "%", source: "connect", decimals: 1, threshold: { op: "gt", warn: 5, critical: 8 }, good: "low" },
  { key: "aht", label: "Avg Handle Time", unit: "s", source: "genesys", decimals: 0, threshold: { op: "gt", warn: 300, critical: 360 }, good: "low" },
  { key: "volume", label: "Interaction Volume", unit: "/15m", source: "connect", decimals: 0, threshold: null, good: null },
  { key: "sentiment", label: "Sentiment Score", unit: "", source: "sfdc", decimals: 2, threshold: { op: "lt", warn: -0.05, critical: -0.25 }, good: "high" },
];
const HISTORY_LEN = 24;

function seedHistory() {
  const out = { sla: [], abandon: [], aht: [], volume: [], sentiment: [] };
  for (let i = 0; i < HISTORY_LEN; i++) {
    jitterMockState();
    out.sla.push(mockState.sla);
    out.abandon.push(mockState.abandon);
    out.aht.push(mockState.aht);
    out.volume.push(mockState.volume);
    out.sentiment.push(mockState.sentiment);
  }
  return out;
}

function evalSeverity(def, value) {
  if (!def.threshold || value == null) return "normal";
  const { op, warn, critical } = def.threshold;
  if (op === "gt") {
    if (value >= critical) return "critical";
    if (value >= warn) return "warn";
  } else {
    if (value <= critical) return "critical";
    if (value <= warn) return "warn";
  }
  return "normal";
}
function fmt(value, decimals) {
  return value.toFixed(decimals);
}
function severityColor(sev) {
  if (sev === "critical") return COLORS.coral;
  if (sev === "warn") return COLORS.amber;
  return COLORS.teal;
}

// =====================================================================================
// MODULE: AGENT TOOLS
// Real Claude tool-use — the model decides when it needs more context and calls these;
// they execute locally against in-memory history rather than hitting the network again.
// =====================================================================================
const TOOL_DEFS = [
  {
    name: "get_metric_trend",
    description: "Return the last N readings for a given metric so trend direction and volatility can be assessed.",
    input_schema: {
      type: "object",
      properties: {
        metric: { type: "string", enum: METRIC_DEFS.map((d) => d.key) },
        points: { type: "integer", description: "How many recent readings to return, default 8" },
      },
      required: ["metric"],
    },
  },
  {
    name: "get_active_alerts",
    description: "Return any currently active threshold alerts across all metrics.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_connected_sources",
    description: "Return the data sources currently connected to the agent and what each contributes.",
    input_schema: { type: "object", properties: {} },
  },
];

function makeToolExecutor(historyRef, alertsRef) {
  return function executeTool(name, input) {
    if (name === "get_metric_trend") {
      const def = METRIC_DEFS.find((d) => d.key === input.metric);
      const n = input.points || 8;
      const series = historyRef.current[input.metric] || [];
      const slice = series.slice(-n);
      return JSON.stringify({ metric: input.metric, unit: def?.unit, values: slice.map((v) => Number(fmt(v, def?.decimals ?? 2))) });
    }
    if (name === "get_active_alerts") {
      return JSON.stringify({ alerts: alertsRef.current });
    }
    if (name === "list_connected_sources") {
      return JSON.stringify({
        connected: ACTIVE_ADAPTERS.map((a) => ({ id: a.id, label: a.label, metrics: Object.keys(mockState).filter(() => true) })),
        available: AVAILABLE_ADAPTERS.map((a) => a.label),
      });
    }
    return JSON.stringify({ error: "unknown tool" });
  };
}

async function callClaudeRaw(messages, tools) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, messages, ...(tools ? { tools } : {}) }),
  });
  return res.json();
}

// The agentic loop: call Claude, execute any requested tools locally, feed results back,
// repeat until Claude returns a final text answer (or a turn cap is hit).
async function runAgentTurn(userPrompt, executeTool, onTrace) {
  let messages = [{ role: "user", content: userPrompt }];
  for (let turn = 0; turn < 4; turn++) {
    const data = await callClaudeRaw(messages, TOOL_DEFS);
    const blocks = data.content || [];
    const toolUses = blocks.filter((b) => b.type === "tool_use");
    if (toolUses.length === 0) {
      return blocks.map((b) => (b.type === "text" ? b.text : "")).join("\n").trim();
    }
    onTrace && onTrace(toolUses.map((t) => `${t.name}(${JSON.stringify(t.input)})`).join(", "));
    messages = [
      ...messages,
      { role: "assistant", content: blocks },
      {
        role: "user",
        content: toolUses.map((t) => ({
          type: "tool_result",
          tool_use_id: t.id,
          content: executeTool(t.name, t.input),
        })),
      },
    ];
  }
  return "Reached tool-call limit without a final answer.";
}

// =====================================================================================
// UI ATOMS
// =====================================================================================
function LivePulse() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: COLORS.teal, animation: "pulseDot 1.8s ease-out infinite" }} />
      <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.12em", color: COLORS.teal, textTransform: "uppercase" }}>Live</span>
    </div>
  );
}
function SourceBadge({ source }) {
  const s = ACTIVE_ADAPTERS.find((x) => x.id === source);
  if (!s) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: FONT_MONO, fontSize: 10, color: COLORS.mist, border: `1px solid ${COLORS.steel}`, borderRadius: 999, padding: "2px 8px" }}>
      <span style={{ width: 5, height: 5, borderRadius: 999, background: s.color }} />
      {s.label}
    </span>
  );
}
function MetricCard({ def, history, persona }) {
  const series = history[def.key];
  const value = series[series.length - 1];
  const prevValue = series[series.length - 2] ?? value;
  const delta = value - prevValue;
  const sev = evalSeverity(def, value);
  const sparkData = series.map((v, i) => ({ i, v }));
  const up = delta > 0.01;
  const down = delta < -0.01;
  const deltaGood = def.good === "high" ? up : def.good === "low" ? down : null;
  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${sev === "normal" ? COLORS.steel : severityColor(sev)}`, borderRadius: 10, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10, minWidth: 0, transition: "border-color 0.4s ease" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: COLORS.mist, marginBottom: 4 }}>{def.label}</div>
          <SourceBadge source={def.source} />
        </div>
        {sev !== "normal" && <AlertTriangle size={16} color={severityColor(sev)} />}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontFamily: FONT_MONO, fontSize: 30, color: COLORS.paper, fontWeight: 500 }}>
          {fmt(value, def.decimals)}
          <span style={{ fontSize: 15, color: COLORS.paperDim }}>{def.unit}</span>
        </span>
        {(up || down) && (
          <span style={{ display: "flex", alignItems: "center", gap: 2, fontFamily: FONT_MONO, fontSize: 11, color: deltaGood === true ? COLORS.teal : deltaGood === false ? COLORS.coral : COLORS.mist }}>
            {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {fmt(Math.abs(delta), def.decimals)}
          </span>
        )}
      </div>
      {persona === "ops" && (
        <div style={{ height: 36, marginTop: -4 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparkData}>
              <Line type="monotone" dataKey="v" stroke={sev === "normal" ? COLORS.tealDim : severityColor(sev)} strokeWidth={1.75} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
function AlertBanner({ alert, onDismiss }) {
  if (!alert) return null;
  const color = severityColor(alert.severity);
  return (
    <div role="alert" style={{ position: "fixed", top: 18, left: "50%", transform: "translateX(-50%)", zIndex: 50, background: COLORS.panelAlt, border: `1px solid ${color}`, borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 8px 30px rgba(0,0,0,0.45)", animation: "slideDown 0.35s ease", maxWidth: "min(92vw, 560px)" }}>
      <AlertTriangle size={18} color={color} style={{ flexShrink: 0 }} />
      <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.paper }}>
        <strong style={{ color }}>{alert.severity === "critical" ? "Critical threshold" : "Warning threshold"}</strong> — {alert.message}
        <div style={{ fontSize: 10.5, color: COLORS.mist, marginTop: 3, fontFamily: FONT_MONO }}>Production build routes this to SMS / email via Twilio &amp; SendGrid</div>
      </div>
      <button onClick={onDismiss} aria-label="Dismiss alert" style={{ background: "transparent", border: "none", color: COLORS.mist, cursor: "pointer", flexShrink: 0 }}>
        <X size={16} />
      </button>
    </div>
  );
}
function AgentLog({ entries, open, onToggle }) {
  const stageColor = { OBSERVE: COLORS.mist, EVALUATE: COLORS.violet, DECIDE: COLORS.amber, ACT: COLORS.teal };
  return (
    <div style={{ marginTop: 14 }}>
      <button className="sig-btn" onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: COLORS.mist, fontSize: 12, fontFamily: FONT_BODY, cursor: "pointer", padding: "4px 0" }}>
        <Terminal size={13} />
        Agent activity log
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && (
        <div style={{ marginTop: 8, background: COLORS.panelAlt, border: `1px solid ${COLORS.steel}`, borderRadius: 10, padding: "10px 14px", maxHeight: 190, overflowY: "auto", fontFamily: FONT_MONO, fontSize: 11 }}>
          {entries.length === 0 && <div style={{ color: COLORS.mist }}>Waiting for first agent cycle…</div>}
          {entries.map((e, i) => (
            <div key={i} style={{ display: "flex", gap: 8, padding: "3px 0", borderBottom: i < entries.length - 1 ? `1px solid ${COLORS.steel}` : "none" }}>
              <span style={{ color: COLORS.mist, flexShrink: 0 }}>{e.time}</span>
              <span style={{ color: stageColor[e.stage], flexShrink: 0, width: 62 }}>{e.stage}</span>
              <span style={{ color: COLORS.paperDim }}>{e.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =====================================================================================
// APP
// =====================================================================================
export default function App() {
  const [history, setHistory] = useState(seedHistory);
  const [persona, setPersona] = useState("ops");
  const [alert, setAlert] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [narrative, setNarrative] = useState(
    "Agent is initializing. It will observe all connected sources, merge them into one picture, and only call the model when a threshold or routine cadence actually warrants it."
  );
  const [narrativeTs, setNarrativeTs] = useState(null);
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [autonomyOn, setAutonomyOn] = useState(true);
  const [showThresholdPanel, setShowThresholdPanel] = useState(false);
  const [showLog, setShowLog] = useState(true);
  const [logEntries, setLogEntries] = useState([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  const historyRef = useRef(history);
  historyRef.current = history;
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;
  const alertTimerRef = useRef(null);
  const chatEndRef = useRef(null);
  const tickRef = useRef(0);
  const cooldownRef = useRef(0);
  const executeTool = useCallback(makeToolExecutor(historyRef, alertsRef), []);

  function pushLog(stage, detail) {
    setLogEntries((cur) => [...cur.slice(-40), { time: new Date().toLocaleTimeString(), stage, detail }]);
  }

  const buildSnapshotText = useCallback(() => {
    const h = historyRef.current;
    return METRIC_DEFS.map((def) => {
      const v = h[def.key][h[def.key].length - 1];
      const prev = h[def.key][h[def.key].length - 2] ?? v;
      return `${def.label}: ${fmt(v, def.decimals)}${def.unit} (prev: ${fmt(prev, def.decimals)}${def.unit})`;
    }).join("\n");
  }, []);

  const runNarrative = useCallback(
    async (reason) => {
      setNarrativeLoading(true);
      pushLog("ACT", `invoking model — reason: ${reason}`);
      try {
        const snapshot = buildSnapshotText();
        const personaLine =
          persona === "exec"
            ? "Audience is a senior executive: 2 short sentences, business-impact framed, no jargon."
            : "Audience is a contact center operations manager: 2-3 sentences, specific, operationally actionable.";
        const prompt = `You are the reasoning core of "Signal", an agent that unifies live data from Genesys PureCloud, Amazon Connect, and Salesforce Cases into one contact center picture. Current unified snapshot:\n\n${snapshot}\n\nTrigger reason: ${reason}.\n${personaLine} You have tools available to pull longer trend history or check active alerts if the snapshot alone isn't enough to explain what's happening — use them if useful. Point out correlations across metrics. No markdown, plain prose only.`;
        const text = await runAgentTurn(prompt, executeTool, (trace) => pushLog("ACT", `tool call — ${trace}`));
        setNarrative(text);
        setNarrativeTs(new Date());
      } catch (e) {
        setNarrative("Couldn't generate an insight right now — try again shortly.");
      } finally {
        setNarrativeLoading(false);
      }
    },
    [buildSnapshotText, executeTool, persona]
  );

  // ---- The agent loop: OBSERVE -> (merge) -> EVALUATE -> DECIDE -> ACT ----
  useEffect(() => {
    const id = setInterval(async () => {
      tickRef.current += 1;
      cooldownRef.current = Math.max(0, cooldownRef.current - 1);

      const partials = await Promise.all(ACTIVE_ADAPTERS.map((a) => a.poll()));
      pushLog("OBSERVE", `polled ${partials.map((p) => p.source).join(", ")}`);
      jitterMockState();
      const merged = mergeSnapshots(partials);

      setHistory((prev) => {
        const next = {};
        for (const key of Object.keys(prev)) {
          const v = merged[key] ?? prev[key][prev[key].length - 1];
          next[key] = [...prev[key].slice(1), v];
        }
        return next;
      });

      let worstSeverity = "normal";
      let worstDef = null;
      let worstVal = null;
      for (const def of METRIC_DEFS) {
        const v = merged[def.key];
        if (v == null) continue;
        const sev = evalSeverity(def, v);
        if (sev === "critical" || (sev === "warn" && worstSeverity === "normal")) {
          worstSeverity = sev;
          worstDef = def;
          worstVal = v;
        }
      }
      pushLog("EVALUATE", worstDef ? `${worstDef.label} = ${fmt(worstVal, worstDef.decimals)}${worstDef.unit} → ${worstSeverity}` : "all metrics within normal range");

      if (!autonomyOn) return;

      if (worstSeverity !== "normal" && cooldownRef.current === 0) {
        pushLog("DECIDE", `escalate — ${worstSeverity} severity, cooldown clear`);
        cooldownRef.current = 5;
        const newAlert = { severity: worstSeverity, message: `${worstDef.label} is at ${fmt(worstVal, worstDef.decimals)}${worstDef.unit}.`, key: `${worstDef.key}-${Date.now()}` };
        setAlert(newAlert);
        setAlerts((cur) => [...cur.slice(-9), newAlert]);
        clearTimeout(alertTimerRef.current);
        alertTimerRef.current = setTimeout(() => setAlert(null), 6000);
        runNarrative(`threshold escalation on ${worstDef.label}`);
      } else if (tickRef.current % 5 === 0) {
        pushLog("DECIDE", "routine cadence reached — refresh narrative");
        runNarrative("routine cadence");
      } else {
        pushLog("DECIDE", "no action — within normal range, not yet due for routine update");
      }
    }, 3200);
    return () => clearInterval(id);
  }, [autonomyOn, runNarrative]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatOpen]);

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    const newMessages = [...chatMessages, { role: "user", content: text }];
    setChatMessages(newMessages);
    setChatInput("");
    setChatLoading(true);
    try {
      const snapshot = buildSnapshotText();
      const prompt = `You are the reasoning core of "Signal", a contact center insights agent unifying Genesys PureCloud, Amazon Connect, and Salesforce Cases. Current snapshot:\n\n${snapshot}\n\nConversation so far:\n${newMessages.map((m) => `${m.role}: ${m.content}`).join("\n")}\n\nAnswer the latest question conversationally in 2-4 sentences. Use tools if you need trend history or alert history beyond the snapshot. No markdown.`;
      const reply = await runAgentTurn(prompt, executeTool, (trace) => pushLog("ACT", `chat tool call — ${trace}`));
      setChatMessages((cur) => [...cur, { role: "assistant", content: reply }]);
    } catch (e) {
      setChatMessages((cur) => [...cur, { role: "assistant", content: "Something went wrong reaching the model — try again." }]);
    } finally {
      setChatLoading(false);
    }
  }

  const execMetrics = METRIC_DEFS.filter((d) => ["sla", "abandon", "sentiment"].includes(d.key));
  const visibleMetrics = persona === "exec" ? execMetrics : METRIC_DEFS;

  return (
    <div style={{ minHeight: "100vh", background: COLORS.ink, fontFamily: FONT_BODY, color: COLORS.paper, padding: "0 0 60px" }}>
      <style>{`
        @keyframes pulseDot { 0% { box-shadow: 0 0 0 0 rgba(45,217,196,0.55);} 70% { box-shadow: 0 0 0 9px rgba(45,217,196,0);} 100% { box-shadow: 0 0 0 0 rgba(45,217,196,0);} }
        @keyframes slideDown { from { opacity: 0; transform: translate(-50%, -12px);} to { opacity: 1; transform: translate(-50%, 0);} }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
        .sig-btn { transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease; }
        input:focus, button:focus-visible { outline: 2px solid ${COLORS.teal}; outline-offset: 2px; }
      `}</style>

      <AlertBanner alert={alert} onDismiss={() => setAlert(null)} />

      <div style={{ borderBottom: `1px solid ${COLORS.steel}`, padding: "20px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: `linear-gradient(135deg, ${COLORS.teal}, ${COLORS.tealDim})`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Radio size={17} color={COLORS.ink} />
          </div>
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.1 }}>Signal</div>
            <div style={{ fontSize: 11.5, color: COLORS.mist }}>Contact Center Insights Agent</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <LivePulse />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: COLORS.mist, cursor: "pointer" }}>
            <input type="checkbox" checked={autonomyOn} onChange={(e) => setAutonomyOn(e.target.checked)} style={{ accentColor: COLORS.teal }} />
            Autonomous monitoring
          </label>
          <div style={{ display: "flex", background: COLORS.panel, border: `1px solid ${COLORS.steel}`, borderRadius: 999, padding: 3 }}>
            {["ops", "exec"].map((p) => (
              <button key={p} className="sig-btn" onClick={() => setPersona(p)} style={{ border: "none", borderRadius: 999, padding: "6px 14px", fontSize: 12, fontFamily: FONT_BODY, cursor: "pointer", background: persona === p ? COLORS.teal : "transparent", color: persona === p ? COLORS.ink : COLORS.mist, fontWeight: persona === p ? 600 : 400 }}>
                {p === "ops" ? "Ops Manager" : "Executive"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: "26px 28px 0", maxWidth: 1180, margin: "0 auto" }}>
        {/* Adapter / plug-in strip */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
          {ACTIVE_ADAPTERS.map((a) => (
            <span key={a.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: FONT_MONO, fontSize: 10.5, color: COLORS.paperDim, border: `1px solid ${COLORS.steel}`, borderRadius: 999, padding: "4px 10px", background: COLORS.panel }}>
              <Plug size={11} color={a.color} />
              {a.label} <span style={{ color: COLORS.teal }}>· connected</span>
            </span>
          ))}
          {AVAILABLE_ADAPTERS.map((a) => (
            <span key={a.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: FONT_MONO, fontSize: 10.5, color: COLORS.mist, border: `1px dashed ${COLORS.steel}`, borderRadius: 999, padding: "4px 10px" }}>
              <Plug size={11} color={COLORS.mist} />
              {a.label} <span>· plug in credentials to connect</span>
            </span>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: `repeat(${persona === "exec" ? 3 : 5}, minmax(0,1fr))`, gap: 14 }}>
          {visibleMetrics.map((def) => (
            <MetricCard key={def.key} def={def} history={history} persona={persona} />
          ))}
        </div>

        {persona === "ops" && (
          <div style={{ marginTop: 14 }}>
            <button className="sig-btn" onClick={() => setShowThresholdPanel((s) => !s)} style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: COLORS.mist, fontSize: 12, fontFamily: FONT_BODY, cursor: "pointer", padding: "4px 0" }}>
              <Settings2 size={13} />
              Alert thresholds
              {showThresholdPanel ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {showThresholdPanel && (
              <div style={{ marginTop: 8, background: COLORS.panel, border: `1px solid ${COLORS.steel}`, borderRadius: 10, padding: "14px 16px", display: "flex", gap: 22, flexWrap: "wrap", fontFamily: FONT_MONO, fontSize: 11.5, color: COLORS.paperDim }}>
                {METRIC_DEFS.filter((d) => d.threshold).map((d) => (
                  <div key={d.key}>
                    <div style={{ color: COLORS.mist, marginBottom: 2 }}>{d.label}</div>
                    <div>
                      warn <span style={{ color: COLORS.amber }}>{d.threshold.warn}{d.unit}</span> · critical <span style={{ color: COLORS.coral }}>{d.threshold.critical}{d.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <AgentLog entries={logEntries} open={showLog} onToggle={() => setShowLog((s) => !s)} />
          </div>
        )}

        <div style={{ marginTop: 22, background: `linear-gradient(160deg, ${COLORS.panel}, ${COLORS.panelAlt})`, border: `1px solid ${COLORS.steel}`, borderRadius: 12, padding: "20px 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={15} color={COLORS.teal} />
              <span style={{ fontFamily: FONT_DISPLAY, fontSize: 14.5, fontWeight: 600 }}>Agent Insight</span>
              {narrativeTs && <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: COLORS.mist }}>updated {narrativeTs.toLocaleTimeString()}</span>}
            </div>
            <button className="sig-btn" onClick={() => runNarrative("manual refresh")} disabled={narrativeLoading} style={{ background: COLORS.teal, color: COLORS.ink, border: "none", borderRadius: 7, padding: "6px 12px", fontSize: 11.5, fontWeight: 600, cursor: narrativeLoading ? "default" : "pointer", opacity: narrativeLoading ? 0.6 : 1 }}>
              {narrativeLoading ? "Thinking…" : "Refresh insight"}
            </button>
          </div>
          <p style={{ fontSize: persona === "exec" ? 16 : 14, lineHeight: 1.55, color: COLORS.paper, margin: 0 }}>{narrative}</p>
        </div>

        <div style={{ textAlign: "center", marginTop: 26, fontSize: 10.5, color: COLORS.mist, fontFamily: FONT_MONO }}>
          Mock adapters simulate live vendor APIs — swap in real Genesys / Amazon Connect / Salesforce credentials without changing the agent core
        </div>
      </div>

      <div style={{ position: "fixed", right: 20, bottom: 20, zIndex: 40 }}>
        {chatOpen ? (
          <div style={{ width: 340, maxHeight: 460, background: COLORS.panel, border: `1px solid ${COLORS.steel}`, borderRadius: 12, display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.5)", overflow: "hidden" }}>
            <div style={{ padding: "12px 14px", borderBottom: `1px solid ${COLORS.steel}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 600 }}>Ask the agent</span>
              <button onClick={() => setChatOpen(false)} aria-label="Close chat" style={{ background: "transparent", border: "none", color: COLORS.mist, cursor: "pointer" }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10, minHeight: 160 }}>
              {chatMessages.length === 0 && <div style={{ fontSize: 12, color: COLORS.mist }}>Try: "Why is abandonment rising?" — it may call a tool to pull the trend before answering.</div>}
              {chatMessages.map((m, i) => (
                <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%", background: m.role === "user" ? COLORS.tealDim : COLORS.panelAlt, color: COLORS.paper, borderRadius: 10, padding: "8px 11px", fontSize: 12.5, lineHeight: 1.4 }}>
                  {m.content}
                </div>
              ))}
              {chatLoading && <div style={{ fontSize: 12, color: COLORS.mist }}>Thinking…</div>}
              <div ref={chatEndRef} />
            </div>
            <div style={{ display: "flex", borderTop: `1px solid ${COLORS.steel}`, padding: 8, gap: 6 }}>
              <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendChat()} placeholder="Ask a question…" style={{ flex: 1, background: COLORS.panelAlt, border: `1px solid ${COLORS.steel}`, borderRadius: 7, padding: "7px 10px", color: COLORS.paper, fontSize: 12.5, fontFamily: FONT_BODY }} />
              <button onClick={sendChat} disabled={chatLoading} aria-label="Send" style={{ background: COLORS.teal, border: "none", borderRadius: 7, width: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: chatLoading ? "default" : "pointer", opacity: chatLoading ? 0.6 : 1 }}>
                <Send size={14} color={COLORS.ink} />
              </button>
            </div>
          </div>
        ) : (
          <button className="sig-btn" onClick={() => setChatOpen(true)} style={{ background: COLORS.teal, border: "none", borderRadius: 999, padding: "12px 18px", display: "flex", alignItems: "center", gap: 8, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13, color: COLORS.ink, cursor: "pointer", boxShadow: "0 10px 30px rgba(45,217,196,0.25)" }}>
            <Sparkles size={15} />
            Ask the agent
          </button>
        )}
      </div>
    </div>
  );
}
