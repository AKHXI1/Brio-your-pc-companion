"use strict";

function safeEvalArithmetic(raw) {
  const expr = String(raw || "").trim();
  if (!expr || expr.length > 64) return null;
  if (!/^[0-9+\-*/%().\s]+$/.test(expr)) return null;
  if (!/[+\-*/%]/.test(expr)) return null;

  // Tokenize numbers and operators without eval/Function
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if ("+-*/%()".includes(ch)) {
      tokens.push(ch);
      i += 1;
      continue;
    }
    const numMatch = /^(?:\d+\.?\d*|\.\d+)/.exec(expr.slice(i));
    if (!numMatch) return null;
    tokens.push(Number(numMatch[0]));
    i += numMatch[0].length;
  }
  if (!tokens.length) return null;

  let pos = 0;
  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];

  function parseExpr() {
    let val = parseTerm();
    if (val === null) return null;
    while (peek() === "+" || peek() === "-") {
      const op = consume();
      const rhs = parseTerm();
      if (rhs === null) return null;
      val = op === "+" ? val + rhs : val - rhs;
    }
    return val;
  }

  function parseTerm() {
    let val = parseFactor();
    if (val === null) return null;
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = consume();
      const rhs = parseFactor();
      if (rhs === null) return null;
      if ((op === "/" || op === "%") && rhs === 0) return null;
      val = op === "*" ? val * rhs : op === "/" ? val / rhs : val % rhs;
    }
    return val;
  }

  function parseFactor() {
    const tok = peek();
    if (tok === "+") {
      consume();
      return parseFactor();
    }
    if (tok === "-") {
      consume();
      const v = parseFactor();
      return v === null ? null : -v;
    }
    if (tok === "(") {
      consume();
      const inner = parseExpr();
      if (inner === null || consume() !== ")") return null;
      return inner;
    }
    if (typeof tok === "number" && Number.isFinite(tok)) {
      consume();
      return tok;
    }
    return null;
  }

  const out = parseExpr();
  if (out === null || pos !== tokens.length || !Number.isFinite(out)) return null;
  const rounded = Math.round(out * 1000000) / 1000000;
  return {
    expr,
    value: rounded,
    formatted: Number.isInteger(rounded) ? rounded.toLocaleString() : String(rounded),
  };
}

const COMMAND_CATALOG = [
  { key: "drink", label: "💧 Log Water (+1 Glass)", hint: "drink or drink 500" },
  { key: "work", label: "▶ Start Work Timer", hint: "work" },
  { key: "break", label: "☕ Take Break", hint: "break" },
  { key: "end", label: "⏹ End Work Session", hint: "end" },
  { key: "sticky", label: "📌 Toggle Sticky Notes Board", hint: "sticky" },
  { key: "breath", label: "🌊 Start 1-Min Calm Breathing", hint: "breath" },
  { key: "eye", label: "👀 Trigger 20s Eye Break", hint: "eye" },
  { key: "stretch", label: "🏃 Trigger Desk Stretch", hint: "stretch" },
  { key: "pomo", label: "🍅 Toggle Pomodoro Timer", hint: "pomo" },
  { key: "dnd", label: "🌙 Mute / DND (1 Hour)", hint: "dnd or dnd 30" },
  { key: "eod", label: "📋 Show End-of-Day Recap", hint: "eod" },
  { key: "bed", label: "😴 Preview Sleep Guard", hint: "bed" },
  { key: "pose", label: "😎 Trigger Mohanlal Pose", hint: "pose" },
  { key: "settings", label: "⚙ Open Brio Settings", hint: "settings" },
];

function parseQuickCommand(rawInput) {
  const trimmed = String(rawInput || "").trim();
  if (!trimmed) {
    return {
      kind: "suggestions",
      items: COMMAND_CATALOG.slice(0, 7),
    };
  }

  const mathRes = safeEvalArithmetic(trimmed);
  if (mathRes) {
    return {
      kind: "math",
      expr: mathRes.expr,
      value: mathRes.value,
      formatted: mathRes.formatted,
      label: `🧮 = ${mathRes.formatted}`,
      hint: "Press Enter to copy answer",
    };
  }

  const lower = trimmed.toLowerCase();

  const drinkMatch = /^(?:drink|water|sip)(?:\s+(\d{2,4})(?:\s*ml)?)?$/.exec(lower);
  if (drinkMatch) {
    const ml = drinkMatch[1] ? Math.max(50, Math.min(2000, Number(drinkMatch[1]))) : 0;
    return {
      kind: "drink",
      ml,
      label: ml > 0 ? `💧 Log ${ml}ml Water` : "💧 Log +1 Glass Water",
      hint: "Logs hydration for today",
    };
  }

  if (/^(?:start\s+work|work|clock\s*in)$/.test(lower)) {
    return { kind: "work_session", mode: "working", label: "▶ Start Work Timer", hint: "Begins active work tracking" };
  }
  if (/^(?:take\s+break|break)$/.test(lower)) {
    return { kind: "work_session", mode: "break", label: "☕ Switch to Break Mode", hint: "Pauses work & water alerts" };
  }
  if (/^(?:end|end\s+work|off|clock\s*out)$/.test(lower)) {
    return { kind: "work_session", mode: "off", label: "⏹ End Work Session", hint: "Sets work session to Off" };
  }
  if (/^(?:breath|breathe|breathing)$/.test(lower)) {
    return { kind: "breathing", label: "🌊 Start 1-Min Calm Breathing", hint: "1-minute box breathing guide" };
  }
  if (/^(?:eye|eye\s*break)$/.test(lower)) {
    return { kind: "test_reminder", reminderKind: "eye", label: "👀 Trigger 20s Eye Break", hint: "20-20-20 eye rest" };
  }
  if (/^(?:stretch)$/.test(lower)) {
    return { kind: "test_reminder", reminderKind: "stretch", label: "🏃 Trigger Desk Stretch", hint: "20s posture stretch" };
  }
  if (/^(?:pomo|pomodoro)$/.test(lower)) {
    return { kind: "toggle_pomodoro", label: "🍅 Toggle Pomodoro Timer", hint: "Starts or stops focus timer" };
  }
  const dndMatch = /^(?:dnd|mute)(?:\s+(\d{1,3})(?:\s*(?:m|min|mins|minutes?))?)?$/.exec(lower);
  if (dndMatch) {
    const mins = dndMatch[1] !== undefined ? Math.max(0, Math.min(480, Number(dndMatch[1]))) : 60;
    return {
      kind: "dnd",
      minutes: mins,
      label: mins === 0 ? "☀ Unmute / End DND" : `🌙 Mute / DND for ${mins}m`,
      hint: mins === 0 ? "Resumes hydration & break reminders" : "Silences reminders temporarily",
    };
  }
  if (/^(?:sticky|notes|note)$/.test(lower)) {
    return { kind: "toggle_sticky", label: "📌 Toggle Sticky Notes Board", hint: "Show/hide floating sticky board" };
  }
  if (/^(?:settings|prefs|config)$/.test(lower)) {
    return { kind: "open_settings", label: "⚙ Open Brio Settings", hint: "Configure timers, schedule & themes" };
  }
  if (/^(?:eod|recap|summary)$/.test(lower)) {
    return { kind: "eod_recap", label: "📋 Show End-of-Day Wrap-Up", hint: "Today's glasses, work & streak" };
  }
  if (/^(?:bed|sleep|bedtime)$/.test(lower)) {
    return { kind: "sleep_preview", label: "😴 Preview Sleep Guard", hint: "Trigger bedtime wind-down check" };
  }
  if (/^(?:pose|meesha)$/.test(lower)) {
    return { kind: "pose", label: "😎 Mohanlal Signature Pose", hint: "Triggers pose & quote" };
  }

  // Timed sticky note pattern e.g. "water in stove 5m" or "call mom in 10 min"
  const timedNoteMatch = /^(.+?)(?:\s+in)?\s+(\d{1,3})\s*(?:m|min|mins|minutes?)$/i.exec(trimmed);
  if (timedNoteMatch) {
    const text = timedNoteMatch[1].trim().slice(0, 140);
    const mins = Math.max(1, Math.min(240, Number(timedNoteMatch[2])));
    if (text) {
      return {
        kind: "sticky_note",
        text,
        minutes: mins,
        label: `📌 Pin "${text}" with ${mins}m timer`,
        hint: "Alerts via Mohanlal when timer finishes",
      };
    }
  }

  // Prefix filter hints for partial command typing alongside fallback sticky pin
  const matching = COMMAND_CATALOG.filter((c) => c.key.startsWith(lower) || c.hint.includes(lower));
  return {
    kind: "sticky_note",
    text: trimmed.slice(0, 140),
    minutes: 0,
    label: `📌 Pin Sticky Note: "${trimmed.slice(0, 60)}"`,
    hint: "Press Enter to pin (or add e.g. 5m for a timer)",
    suggestions: matching.slice(0, 4),
  };
}

module.exports = {
  COMMAND_CATALOG,
  safeEvalArithmetic,
  parseQuickCommand,
};
