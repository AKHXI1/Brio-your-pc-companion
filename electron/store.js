"use strict";

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_DATA_DIR = path.join(PROJECT_ROOT, "data");
const MOHANLAL_GLB_PATH = path.join(PROJECT_ROOT, "assets", "mohanlal.glb");
const DEFAULT_GLB_PATH = fs.existsSync(MOHANLAL_GLB_PATH)
  ? MOHANLAL_GLB_PATH
  : path.join(PROJECT_ROOT, "assets", "water_buddy.glb");

/** Medically & ergonomically recommended defaults for categorized break reminders. */
const BREAK_DEFAULTS = Object.freeze({
  breaks_work_hours_only: true,
  eye_break_enabled: true,
  eye_break_interval_minutes: 20,
  eye_break_duration_seconds: 20,
  stretch_enabled: true,
  stretch_interval_minutes: 45,
  stretch_duration_seconds: 30,
  stand_break_enabled: true,
  stand_break_interval_minutes: 90,
  stand_break_duration_seconds: 120,
  smart_idle_enabled: true,
  eye_idle_reset_seconds: 25,
  idle_pause_seconds: 60,
  idle_reset_minutes: 3,
  min_visit_gap_minutes: 5,
  deep_focus_peek_enabled: true,
});

function localDateIso(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function pickRandomScreenX({
  waX = 0,
  waWidth = 1920,
  compW = 372,
  margin = 12,
  preferredSide = null,
  rng = Math.random,
} = {}) {
  const pad = Math.max(0, Math.round(Number(margin) || 0));
  const minX = Math.round(waX + pad);
  const maxX = Math.max(minX, Math.round(waX + waWidth - compW - pad));
  const span = maxX - minX;
  if (span <= 12) return minX;
  const r = Math.max(0, Math.min(0.999999, Number(rng())));
  if (preferredSide && r < 0.35) {
    const edgeBand = Math.min(160, span * 0.28);
    const sub = Math.max(0, Math.min(0.999999, Number(rng())));
    if (preferredSide === "left") {
      return Math.round(minX + sub * edgeBand);
    }
    return Math.round(maxX - sub * edgeBand);
  }
  return Math.round(minX + r * span);
}

function defaultConfig() {
  return {
    interval_minutes: 20,
    snooze_minutes: 5,
    glass_ml: 250,
    daily_goal_glasses: 8,
    auto_hydration_goal: true,
    user_age: 26,
    user_height_cm: 170,
    user_weight_kg: 70,
    daily_goal_ml: 2450,
    welcome_on_start: true,
    user_name: "",
    user_gender: "male",
    ui_theme: "midnight_glass",
    birthday_mmdd: "",
    sticky_note: "",
    sticky_notes: [],
    sticky_open: false,
    sticky_always_on_top: true,
    sticky_x: null,
    sticky_y: null,
    custom_habits: [],
    battery_alerts_enabled: true,
    eod_recap_enabled: true,
    eod_recap_time: "19:00",
    last_eod_recap_date: "",
    bedtime_enabled: true,
    bedtime_hhmm: "23:30",
    last_special_wish_date: "",
    always_sunglasses: false,
    weather_boost_enabled: true,
    app_awareness_enabled: true,
    hotkeys_enabled: true,
    last_weekly_report_date: "",
    popup_only_mode: true,
    ghost_mode_enabled: false,
    start_on_boot: true,
    glb_path: "",
    walk_enabled: true,
    walk_speed: 65,
    character_scale: 1.0,
    walk_clip: "auto",
    idle_clip: "auto",
    remind_clip: "auto",
    celebrate_clip: "auto",
    window_x: null,
    window_y: null,
    language: "malayalam",
    random_character: false,
    eye_break_enabled: BREAK_DEFAULTS.eye_break_enabled,
    eye_break_interval_minutes: BREAK_DEFAULTS.eye_break_interval_minutes,
    eye_break_duration_seconds: BREAK_DEFAULTS.eye_break_duration_seconds,
    stretch_enabled: BREAK_DEFAULTS.stretch_enabled,
    stretch_interval_minutes: BREAK_DEFAULTS.stretch_interval_minutes,
    stretch_duration_seconds: BREAK_DEFAULTS.stretch_duration_seconds,
    stand_break_enabled: BREAK_DEFAULTS.stand_break_enabled,
    stand_break_interval_minutes: BREAK_DEFAULTS.stand_break_interval_minutes,
    stand_break_duration_seconds: BREAK_DEFAULTS.stand_break_duration_seconds,
    breaks_work_hours_only: BREAK_DEFAULTS.breaks_work_hours_only,
    min_visit_gap_minutes: BREAK_DEFAULTS.min_visit_gap_minutes,
    deep_focus_peek_enabled: BREAK_DEFAULTS.deep_focus_peek_enabled,
    pomodoro_enabled: false,
    pomodoro_work_minutes: 25,
    pomodoro_break_minutes: 5,
    work_schedule_enabled: false,
    work_shift_start: "09:00",
    work_shift_end: "18:00",
    scheduled_breaks: [
      { id: "brk_lunch", title: "Lunch Break", startHHMM: "13:00", endHHMM: "13:45", enabled: true },
      { id: "brk_tea", title: "Tea Break", startHHMM: "16:00", endHHMM: "16:15", enabled: true },
    ],
    system_monitor_enabled: true,
    continuous_active_limit_minutes: BREAK_DEFAULTS.stand_break_interval_minutes,
    cpu_alert_threshold: 85,
    smart_idle_enabled: BREAK_DEFAULTS.smart_idle_enabled,
    eye_idle_reset_seconds: BREAK_DEFAULTS.eye_idle_reset_seconds,
    idle_pause_seconds: BREAK_DEFAULTS.idle_pause_seconds,
    idle_reset_minutes: BREAK_DEFAULTS.idle_reset_minutes,
    ota_update_url: "",
    license_key: "",
    dnd_fullscreen: true,
    dnd_until: 0,
    roster: [],
  };
}

function sanitizeHhmm(raw, fallback = "09:00") {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(String(raw || "").trim());
  if (!m) return fallback;
  const hh = Math.max(0, Math.min(23, Number(m[1])));
  const mm = Math.max(0, Math.min(59, Number(m[2])));
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function sanitizeScheduledBreaks(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const title = typeof item.title === "string" ? item.title.trim().slice(0, 40) : "";
    if (!title) continue;
    const id =
      typeof item.id === "string" && item.id.trim()
        ? item.id.trim()
        : "brk_" + Math.random().toString(36).slice(2, 9);
    out.push({
      id,
      title,
      startHHMM: sanitizeHhmm(item.startHHMM, "13:00"),
      endHHMM: sanitizeHhmm(item.endHHMM, "13:30"),
      enabled: item.enabled !== undefined ? Boolean(item.enabled) : true,
    });
    if (out.length >= 10) break;
  }
  return out;
}

function sanitizeStickyNotes(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const text = typeof item.text === "string" ? item.text.trim().slice(0, 140) : "";
    if (!text) continue;
    const id =
      typeof item.id === "string" && item.id.trim()
        ? item.id.trim()
        : "note_" + Math.random().toString(36).slice(2, 9);
    const endsRaw = Number(item.timerEndsAt);
    const timerEndsAt = Number.isFinite(endsRaw) && endsRaw > 0 ? Math.round(endsRaw) : 0;
    out.push({
      id,
      text,
      done: Boolean(item.done),
      timerEndsAt,
      alertFired: Boolean(item.alertFired),
    });
    if (out.length >= 20) break;
  }
  return out;
}

function sanitizeCustomHabits(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const title = typeof item.title === "string" ? item.title.trim().slice(0, 48) : "";
    if (!title) continue;
    const rawTime = typeof item.timeHHMM === "string" ? item.timeHHMM.trim() : "";
    const m = /^(\d{1,2}):(\d{2})$/.exec(rawTime);
    const hh = m ? Math.max(0, Math.min(23, Number(m[1]))) : 12;
    const mm = m ? Math.max(0, Math.min(59, Number(m[2]))) : 0;
    const timeHHMM = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    const id =
      typeof item.id === "string" && item.id.trim()
        ? item.id.trim()
        : "hab_" + Math.random().toString(36).slice(2, 9);
    out.push({
      id,
      title,
      timeHHMM,
      enabled: item.enabled !== undefined ? Boolean(item.enabled) : true,
    });
    if (out.length >= 10) break;
  }
  return out;
}

function sanitizeRoster(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const glb = typeof item.glb_path === "string" ? item.glb_path.trim() : "";
    if (!glb) continue;
    const key = glb.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const id =
      typeof item.id === "string" && item.id.trim()
        ? item.id.trim()
        : "char_" + Math.random().toString(36).slice(2, 9);
    const name =
      typeof item.name === "string" && item.name.trim()
        ? item.name.trim().slice(0, 48)
        : "Character";
    out.push({ id, name, glb_path: glb });
  }
  return out;
}

function numOr(val, fallback) {
  const n = Number(val);
  return val !== null && val !== undefined && val !== "" && Number.isFinite(n)
    ? n
    : fallback;
}

function calculateRecommendedHydrationMl({
  age = 26,
  heightCm = 170,
  weightKg = 70,
} = {}) {
  const safeAge = Math.max(5, Math.min(110, Math.round(numOr(age, 26))));
  const safeHeight = Math.max(90, Math.min(240, numOr(heightCm, 170)));
  const safeWeight = Math.max(20, Math.min(250, numOr(weightKg, 70)));

  // Age-bracketed ml-per-kg standard clinical hydration ratio
  const mlPerKg =
    safeAge < 18 ? 40 : safeAge <= 30 ? 35 : safeAge <= 54 ? 33 : 30;
  const heightAdj = Math.max(-200, Math.min(300, (safeHeight - 170) * 4));
  const rawMl = safeWeight * mlPerKg + heightAdj;
  const roundedMl = Math.round(rawMl / 50) * 50;
  return Math.max(1500, Math.min(5000, roundedMl));
}

function resolveDailyHydrationGoal(cfg = {}) {
  const glassMl = Math.max(50, Math.min(2000, Math.round(numOr(cfg.glass_ml, 250))));
  const isAuto = cfg.auto_hydration_goal !== undefined ? Boolean(cfg.auto_hydration_goal) : true;
  if (isAuto) {
    const goalMl = calculateRecommendedHydrationMl({
      age: cfg.user_age,
      heightCm: cfg.user_height_cm,
      weightKg: cfg.user_weight_kg,
    });
    return {
      isAuto: true,
      goalMl,
      goalLiters: Math.round((goalMl / 1000) * 100) / 100,
      goalGlasses: Math.max(1, Math.ceil(goalMl / glassMl)),
    };
  }
  const manualGlasses = Math.max(1, Math.min(30, Math.round(numOr(cfg.daily_goal_glasses, 8))));
  const goalMl = manualGlasses * glassMl;
  return {
    isAuto: false,
    goalMl,
    goalLiters: Math.round((goalMl / 1000) * 100) / 100,
    goalGlasses: manualGlasses,
  };
}

function clampConfig(cfg) {
  const base = defaultConfig();
  const merged = { ...base, ...(cfg || {}) };
  merged.interval_minutes = Math.max(1, Math.min(240, Math.round(numOr(merged.interval_minutes, 20))));
  merged.snooze_minutes = Math.max(1, Math.min(60, Math.round(numOr(merged.snooze_minutes, 5))));
  merged.glass_ml = Math.max(50, Math.min(2000, Math.round(numOr(merged.glass_ml, 250))));
  merged.auto_hydration_goal =
    merged.auto_hydration_goal !== undefined ? Boolean(merged.auto_hydration_goal) : true;
  merged.user_age = Math.max(5, Math.min(110, Math.round(numOr(merged.user_age, 26))));
  merged.user_height_cm = Math.max(90, Math.min(240, Math.round(numOr(merged.user_height_cm, 170))));
  merged.user_weight_kg = Math.max(20, Math.min(250, Math.round(numOr(merged.user_weight_kg, 70))));
  const manualGoal = Math.max(1, Math.min(30, Math.round(numOr(merged.daily_goal_glasses, 8))));
  if (merged.auto_hydration_goal) {
    const calcMl = calculateRecommendedHydrationMl({
      age: merged.user_age,
      heightCm: merged.user_height_cm,
      weightKg: merged.user_weight_kg,
    });
    merged.daily_goal_ml = calcMl;
    merged.daily_goal_glasses = Math.max(1, Math.min(50, Math.ceil(calcMl / merged.glass_ml)));
  } else {
    merged.daily_goal_glasses = manualGoal;
    merged.daily_goal_ml = manualGoal * merged.glass_ml;
  }
  merged.welcome_on_start = merged.welcome_on_start !== undefined ? Boolean(merged.welcome_on_start) : true;
  merged.user_name = typeof merged.user_name === "string" ? merged.user_name.trim().slice(0, 32) : "";
  merged.user_gender =
    String(merged.user_gender || "").trim().toLowerCase() === "female" ? "female" : "male";
  const themeKey = String(merged.ui_theme || "").trim().toLowerCase();
  merged.ui_theme = ["midnight_glass", "kochi_noir", "nordic_mist", "cyber_mint"].includes(themeKey)
    ? themeKey
    : "midnight_glass";
  const bdayRaw = typeof merged.birthday_mmdd === "string" ? merged.birthday_mmdd.trim() : "";
  const bdayMatch = /^(\d{2})-(\d{2})$/.exec(bdayRaw);
  merged.birthday_mmdd =
    bdayMatch && Number(bdayMatch[1]) >= 1 && Number(bdayMatch[1]) <= 12 && Number(bdayMatch[2]) >= 1 && Number(bdayMatch[2]) <= 31
      ? `${bdayMatch[1]}-${bdayMatch[2]}`
      : "";
  const legacyNote = typeof merged.sticky_note === "string" ? merged.sticky_note.trim().slice(0, 120) : "";
  if (Array.isArray(merged.sticky_notes)) {
    merged.sticky_notes = sanitizeStickyNotes(merged.sticky_notes);
  } else {
    merged.sticky_notes = [];
  }
  if (merged.sticky_notes.length === 0 && legacyNote && cfg && !Array.isArray(cfg.sticky_notes)) {
    merged.sticky_notes = [
      { id: "note_migrated", text: legacyNote, done: false, timerEndsAt: 0, alertFired: false },
    ];
  }
  const firstActive = merged.sticky_notes.find((n) => !n.done) || merged.sticky_notes[0];
  merged.sticky_note = firstActive ? firstActive.text : "";
  merged.sticky_open = Boolean(merged.sticky_open);
  merged.sticky_always_on_top =
    merged.sticky_always_on_top !== undefined ? Boolean(merged.sticky_always_on_top) : true;
  const sx = Number.isFinite(merged.sticky_x) ? Math.round(merged.sticky_x) : null;
  const sy = Number.isFinite(merged.sticky_y) ? Math.round(merged.sticky_y) : null;
  merged.sticky_x = sx === 0 ? 0 : sx;
  merged.sticky_y = sy === 0 ? 0 : sy;
  merged.custom_habits = sanitizeCustomHabits(merged.custom_habits);
  merged.battery_alerts_enabled =
    merged.battery_alerts_enabled !== undefined ? Boolean(merged.battery_alerts_enabled) : true;
  merged.eod_recap_enabled =
    merged.eod_recap_enabled !== undefined ? Boolean(merged.eod_recap_enabled) : true;
  const eodM = /^(\d{1,2}):(\d{1,2})$/.exec(String(merged.eod_recap_time || "").trim());
  const eodH = eodM ? Math.max(0, Math.min(23, Number(eodM[1]))) : 19;
  const eodMin = eodM ? Math.max(0, Math.min(59, Number(eodM[2]))) : 0;
  merged.eod_recap_time = `${String(eodH).padStart(2, "0")}:${String(eodMin).padStart(2, "0")}`;
  merged.last_eod_recap_date =
    typeof merged.last_eod_recap_date === "string" ? merged.last_eod_recap_date.trim() : "";
  merged.bedtime_enabled =
    merged.bedtime_enabled !== undefined ? Boolean(merged.bedtime_enabled) : true;
  merged.bedtime_hhmm = sanitizeHhmm(merged.bedtime_hhmm, "23:30");
  merged.last_special_wish_date =
    typeof merged.last_special_wish_date === "string" ? merged.last_special_wish_date.trim() : "";
  merged.always_sunglasses = Boolean(merged.always_sunglasses);
  merged.weather_boost_enabled =
    merged.weather_boost_enabled !== undefined ? Boolean(merged.weather_boost_enabled) : true;
  merged.app_awareness_enabled =
    merged.app_awareness_enabled !== undefined ? Boolean(merged.app_awareness_enabled) : true;
  merged.hotkeys_enabled =
    merged.hotkeys_enabled !== undefined ? Boolean(merged.hotkeys_enabled) : true;
  merged.last_weekly_report_date =
    typeof merged.last_weekly_report_date === "string" ? merged.last_weekly_report_date.trim() : "";
  merged.popup_only_mode = Boolean(merged.popup_only_mode);
  merged.ghost_mode_enabled = Boolean(merged.ghost_mode_enabled);
  merged.start_on_boot = Boolean(merged.start_on_boot);
  const rawGlbPath = typeof merged.glb_path === "string" ? merged.glb_path.trim() : "";
  merged.glb_path = rawGlbPath.toLowerCase() === "jerry" ? "" : rawGlbPath;
  merged.walk_enabled = Boolean(merged.walk_enabled);
  merged.walk_speed = Math.max(20, Math.min(220, Math.round(numOr(merged.walk_speed, 65))));
  merged.character_scale = Math.max(0.5, Math.min(2.0, numOr(merged.character_scale, 1.0)));
  for (const k of ["walk_clip", "idle_clip", "remind_clip", "celebrate_clip"]) {
    merged[k] = typeof merged[k] === "string" && merged[k].trim() ? merged[k].trim() : "auto";
  }
  const wx = Number.isFinite(merged.window_x) ? Math.round(merged.window_x) : null;
  const wy = Number.isFinite(merged.window_y) ? Math.round(merged.window_y) : null;
  merged.window_x = wx === 0 ? 0 : wx;
  merged.window_y = wy === 0 ? 0 : wy;
  merged.language = String(merged.language || "").trim().toLowerCase() === "english" ? "english" : "malayalam";
  merged.random_character = Boolean(merged.random_character);
  merged.eye_break_enabled = merged.eye_break_enabled !== undefined ? Boolean(merged.eye_break_enabled) : true;
  merged.eye_break_interval_minutes = Math.max(
    5,
    Math.min(120, Math.round(numOr(merged.eye_break_interval_minutes, BREAK_DEFAULTS.eye_break_interval_minutes)))
  );
  merged.eye_break_duration_seconds = Math.max(
    10,
    Math.min(120, Math.round(numOr(merged.eye_break_duration_seconds, BREAK_DEFAULTS.eye_break_duration_seconds)))
  );
  merged.stretch_enabled = merged.stretch_enabled !== undefined ? Boolean(merged.stretch_enabled) : true;
  merged.stretch_interval_minutes = Math.max(
    10,
    Math.min(240, Math.round(numOr(merged.stretch_interval_minutes, BREAK_DEFAULTS.stretch_interval_minutes)))
  );
  merged.stretch_duration_seconds = Math.max(
    15,
    Math.min(180, Math.round(numOr(merged.stretch_duration_seconds, BREAK_DEFAULTS.stretch_duration_seconds)))
  );
  merged.stand_break_enabled = merged.stand_break_enabled !== undefined ? Boolean(merged.stand_break_enabled) : true;
  const rawStandMins =
    cfg && cfg.stand_break_interval_minutes !== undefined
      ? cfg.stand_break_interval_minutes
      : cfg && cfg.continuous_active_limit_minutes !== undefined
      ? cfg.continuous_active_limit_minutes
      : BREAK_DEFAULTS.stand_break_interval_minutes;
  merged.stand_break_interval_minutes = Math.max(
    15,
    Math.min(360, Math.round(numOr(rawStandMins, BREAK_DEFAULTS.stand_break_interval_minutes)))
  );
  merged.stand_break_duration_seconds = Math.max(
    30,
    Math.min(600, Math.round(numOr(merged.stand_break_duration_seconds, BREAK_DEFAULTS.stand_break_duration_seconds)))
  );
  merged.breaks_work_hours_only =
    merged.breaks_work_hours_only !== undefined ? Boolean(merged.breaks_work_hours_only) : true;
  merged.min_visit_gap_minutes = Math.max(
    0,
    Math.min(30, Math.round(numOr(merged.min_visit_gap_minutes, BREAK_DEFAULTS.min_visit_gap_minutes)))
  );
  merged.deep_focus_peek_enabled =
    merged.deep_focus_peek_enabled !== undefined ? Boolean(merged.deep_focus_peek_enabled) : true;
  merged.pomodoro_enabled = Boolean(merged.pomodoro_enabled);
  merged.pomodoro_work_minutes = Math.max(5, Math.min(120, Math.round(numOr(merged.pomodoro_work_minutes, 25))));
  merged.pomodoro_break_minutes = Math.max(1, Math.min(60, Math.round(numOr(merged.pomodoro_break_minutes, 5))));
  merged.work_schedule_enabled = Boolean(merged.work_schedule_enabled);
  merged.work_shift_start = sanitizeHhmm(merged.work_shift_start, "09:00");
  merged.work_shift_end = sanitizeHhmm(merged.work_shift_end, "18:00");
  merged.scheduled_breaks = Array.isArray(cfg && cfg.scheduled_breaks)
    ? sanitizeScheduledBreaks(cfg.scheduled_breaks)
    : sanitizeScheduledBreaks(base.scheduled_breaks);
  merged.system_monitor_enabled = merged.system_monitor_enabled !== undefined ? Boolean(merged.system_monitor_enabled) : true;
  merged.continuous_active_limit_minutes = merged.stand_break_interval_minutes;
  merged.cpu_alert_threshold = Math.max(50, Math.min(99, Math.round(numOr(merged.cpu_alert_threshold, 85))));
  merged.smart_idle_enabled = merged.smart_idle_enabled !== undefined ? Boolean(merged.smart_idle_enabled) : true;
  merged.eye_idle_reset_seconds = Math.max(
    10,
    Math.min(120, Math.round(numOr(merged.eye_idle_reset_seconds, BREAK_DEFAULTS.eye_idle_reset_seconds)))
  );
  merged.idle_pause_seconds = Math.max(15, Math.min(600, Math.round(numOr(merged.idle_pause_seconds, 60))));
  merged.idle_reset_minutes = Math.max(1, Math.min(60, Math.round(numOr(merged.idle_reset_minutes, 3))));
  merged.ota_update_url = typeof merged.ota_update_url === "string" ? merged.ota_update_url.trim() : "";
  merged.license_key = typeof merged.license_key === "string" ? merged.license_key.trim().toUpperCase() : "";
  merged.dnd_fullscreen = merged.dnd_fullscreen !== undefined ? Boolean(merged.dnd_fullscreen) : true;
  const dndUntil = Math.round(numOr(merged.dnd_until, 0));
  merged.dnd_until = dndUntil > 0 ? dndUntil : 0;
  merged.roster = sanitizeRoster(merged.roster);
  return merged;
}

function defaultState(now = new Date()) {
  return {
    current_date: localDateIso(now),
    glasses_today: 0,
    ml_today: 0,
    breaks_today: 0,
    work_seconds_today: 0,
    break_seconds_today: 0,
    work_session_mode: "off",
    history: {},
    ml_history: {},
    work_history: {},
  };
}

function ensureToday(state, now = new Date()) {
  const today = localDateIso(now);
  if (!state.work_history || typeof state.work_history !== "object") {
    state.work_history = {};
  }
  if (!state.ml_history || typeof state.ml_history !== "object") {
    state.ml_history = {};
  }
  if (state.current_date === today) {
    return false;
  }
  if (state.current_date) {
    state.history[state.current_date] = Math.max(0, Math.round(Number(state.glasses_today) || 0));
    state.ml_history[state.current_date] = Math.max(0, Math.round(Number(state.ml_today) || 0));
    state.work_history[state.current_date] = {
      workSec: Math.max(0, Math.round(Number(state.work_seconds_today) || 0)),
      breakSec: Math.max(0, Math.round(Number(state.break_seconds_today) || 0)),
    };
  }
  state.current_date = today;
  state.glasses_today = 0;
  state.ml_today = 0;
  state.breaks_today = 0;
  state.work_seconds_today = 0;
  state.break_seconds_today = 0;
  state.work_session_mode = "off";

  const cutoffDate = new Date(now);
  cutoffDate.setDate(cutoffDate.getDate() - 30);
  const cutoff = localDateIso(cutoffDate);
  const pruned = {};
  for (const [k, v] of Object.entries(state.history || {})) {
    if (k >= cutoff) {
      pruned[k] = Math.max(0, Math.round(Number(v) || 0));
    }
  }
  state.history = pruned;

  const prunedMl = {};
  for (const [k, v] of Object.entries(state.ml_history || {})) {
    if (k >= cutoff) {
      prunedMl[k] = Math.max(0, Math.round(Number(v) || 0));
    }
  }
  state.ml_history = prunedMl;

  const prunedWork = {};
  for (const [k, v] of Object.entries(state.work_history || {})) {
    if (k >= cutoff && v && typeof v === "object") {
      prunedWork[k] = {
        workSec: Math.max(0, Math.round(Number(v.workSec) || 0)),
        breakSec: Math.max(0, Math.round(Number(v.breakSec) || 0)),
      };
    }
  }
  state.work_history = prunedWork;
  return true;
}

function addGlass(state, delta = 1, now = new Date(), mlAmount = 250) {
  ensureToday(state, now);
  const safeDelta = Math.round(Number(delta) || 0);
  const safeMl = Math.max(50, Math.min(2000, Math.round(Number(mlAmount) || 250)));
  state.glasses_today = Math.max(0, Math.round((Number(state.glasses_today) || 0) + safeDelta));
  state.ml_today = Math.max(0, Math.round((Number(state.ml_today) || 0) + safeDelta * safeMl));
  state.history[state.current_date] = state.glasses_today;
  state.ml_history[state.current_date] = state.ml_today;
  return state.glasses_today;
}

function addBreak(state, now = new Date()) {
  ensureToday(state, now);
  state.breaks_today = Math.max(0, Math.round((Number(state.breaks_today) || 0) + 1));
  return state.breaks_today;
}

function addWorkBreakSeconds(state, mode, deltaSec = 0, activityPaused = false, now = new Date()) {
  ensureToday(state, now);
  const dt = Math.max(0, Number(deltaSec) || 0);
  if (dt <= 0) return;
  if (mode === "working" && !activityPaused) {
    state.work_seconds_today = Math.max(0, (Number(state.work_seconds_today) || 0) + dt);
  } else if (mode === "break") {
    state.break_seconds_today = Math.max(0, (Number(state.break_seconds_today) || 0) + dt);
  } else {
    return;
  }
  state.work_history[state.current_date] = {
    workSec: Math.max(0, Math.round(Number(state.work_seconds_today) || 0)),
    breakSec: Math.max(0, Math.round(Number(state.break_seconds_today) || 0)),
  };
}

function isHhmmInRange(hhmm, startHHMM, endHHMM) {
  if (startHHMM === endHHMM) return true;
  if (startHHMM < endHHMM) {
    return hhmm >= startHHMM && hhmm < endHHMM;
  }
  return hhmm >= startHHMM || hhmm < endHHMM;
}

function evaluateWorkSchedule(cfg = {}, sessionMode = "off", now = new Date()) {
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const shiftStart = sanitizeHhmm(cfg.work_shift_start, "09:00");
  const shiftEnd = sanitizeHhmm(cfg.work_shift_end, "18:00");
  const shiftEnabled = Boolean(cfg.work_schedule_enabled);
  const inConfiguredHours = isHhmmInRange(hhmm, shiftStart, shiftEnd);
  const inShiftWindow = shiftEnabled ? inConfiguredHours : true;
  const breaksWorkHoursOnly =
    cfg.breaks_work_hours_only !== undefined ? Boolean(cfg.breaks_work_hours_only) : true;
  const breaks = Array.isArray(cfg.scheduled_breaks) ? cfg.scheduled_breaks : [];
  const activeScheduledBreak =
    breaks.find((b) => b && b.enabled && isHhmmInRange(hhmm, b.startHHMM, b.endHHMM)) || null;

  let remindersAllowed = true;
  if (activeScheduledBreak || sessionMode === "break") {
    remindersAllowed = false;
  } else if (sessionMode === "working") {
    remindersAllowed = true;
  } else if (shiftEnabled && !inShiftWindow) {
    remindersAllowed = false;
  }

  let breakRemindersAllowed = true;
  if (activeScheduledBreak || sessionMode === "break") {
    breakRemindersAllowed = false;
  } else if (sessionMode === "working") {
    breakRemindersAllowed = true;
  } else if (breaksWorkHoursOnly && !inConfiguredHours) {
    breakRemindersAllowed = false;
  } else if (!breaksWorkHoursOnly) {
    breakRemindersAllowed = remindersAllowed;
  }

  return {
    hhmm,
    shiftEnabled,
    shiftStart,
    shiftEnd,
    inShiftWindow,
    inConfiguredHours,
    breaksWorkHoursOnly,
    activeScheduledBreak,
    remindersAllowed,
    breakRemindersAllowed,
  };
}

function isPastBedtime(bedtimeHHMM = "23:30", now = new Date()) {
  const clean = sanitizeHhmm(bedtimeHHMM, "23:30");
  const [bh, bm] = clean.split(":").map(Number);
  const bedMins = bh * 60 + bm;
  const curMins = now.getHours() * 60 + now.getMinutes();
  const sleepEndMins = 4 * 60 + 30; // Late-night window extends until 04:30 AM
  if (bedMins >= 18 * 60) {
    return curMins >= bedMins || curMins < sleepEndMins;
  }
  return curMins >= bedMins && curMins < Math.max(bedMins + 180, sleepEndMins);
}

function formatDurationCompact(seconds = 0) {
  const totalMins = Math.max(0, Math.floor((Number(seconds) || 0) / 60));
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hrs > 0) {
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  }
  return `${mins}m`;
}

function recentDays(state, days = 7, now = new Date(), defaultGlassMl = 250) {
  ensureToday(state, now);
  const fallbackGlassMl = Math.max(50, Math.round(Number(defaultGlassMl) || 250));
  const res = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const d = new Date(now);
    d.setDate(d.getDate() - offset);
    const iso = localDateIso(d);
    const label = offset === 0 ? "Today" : d.toLocaleDateString("en-US", { weekday: "short" });
    const isToday = iso === state.current_date;
    const count = isToday
      ? state.glasses_today
      : Math.max(0, Math.round(Number((state.history || {})[iso]) || 0));
    const storedMl = isToday
      ? state.ml_today
      : Number((state.ml_history || {})[iso]);
    const ml = Number.isFinite(storedMl) && storedMl > 0
      ? Math.round(storedMl)
      : count * fallbackGlassMl;
    const wh = (state.work_history || {})[iso] || {};
    const workSec = isToday
      ? Math.max(0, Math.round(Number(state.work_seconds_today) || 0))
      : Math.max(0, Math.round(Number(wh.workSec) || 0));
    const breakSec = isToday
      ? Math.max(0, Math.round(Number(state.break_seconds_today) || 0))
      : Math.max(0, Math.round(Number(wh.breakSec) || 0));
    res.push({
      date: iso,
      label,
      count,
      ml,
      liters: Math.round((ml / 1000) * 100) / 100,
      workMinutes: Math.round(workSec / 60),
      breakMinutes: Math.round(breakSec / 60),
    });
  }
  return res;
}

function computeStreakDays(state, dailyGoal = 8, now = new Date(), dailyGoalMl = 0) {
  ensureToday(state, now);
  const goal = Math.max(1, Math.round(Number(dailyGoal) || 8));
  const goalMl = Math.max(0, Math.round(Number(dailyGoalMl) || 0));
  let streak = 0;
  const todayCnt = Math.max(0, Math.round(Number(state.glasses_today) || 0));
  const todayMl = Math.max(0, Math.round(Number(state.ml_today) || 0));
  const todayMet = goalMl > 0 && todayMl > 0 ? todayMl >= goalMl : todayCnt >= goal;
  if (todayMet) {
    streak += 1;
  }
  const hist = state.history || {};
  const mlHist = state.ml_history || {};
  for (let offset = 1; offset <= 30; offset++) {
    const d = new Date(now);
    d.setDate(d.getDate() - offset);
    const iso = localDateIso(d);
    const cnt = Math.max(0, Math.round(Number(hist[iso]) || 0));
    const dayMl = Math.max(0, Math.round(Number(mlHist[iso]) || 0));
    const met = goalMl > 0 && dayMl > 0 ? dayMl >= goalMl : cnt >= goal;
    if (met) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

function resetProgressState(state, now = new Date()) {
  const fresh = defaultState(now);
  state.current_date = fresh.current_date;
  state.glasses_today = 0;
  state.ml_today = 0;
  state.breaks_today = 0;
  state.work_seconds_today = 0;
  state.break_seconds_today = 0;
  state.work_session_mode = "off";
  state.history = {};
  state.ml_history = {};
  state.work_history = {};
  return state;
}

class StateStore {
  constructor(dataDir = DEFAULT_DATA_DIR) {
    this.dataDir = dataDir;
    this.stateFile = path.join(this.dataDir, "state.json");
    this.backupFile = path.join(this.dataDir, "state.backup.json");
  }

  _parseRawFile(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (!raw || typeof raw !== "object") return null;
      const config = clampConfig(raw.config);
      let state = defaultState();
      if (raw.state && typeof raw.state === "object") {
        const modeRaw = String(raw.state.work_session_mode || "").trim().toLowerCase();
        const loadedGlasses = Math.max(0, Math.round(Number(raw.state.glasses_today) || 0));
        const rawMlToday = Number(raw.state.ml_today);
        const loadedMl =
          Number.isFinite(rawMlToday) && rawMlToday >= 0
            ? Math.round(rawMlToday)
            : loadedGlasses * config.glass_ml;
        state = {
          current_date: typeof raw.state.current_date === "string"
            ? raw.state.current_date
            : localDateIso(),
          glasses_today: loadedGlasses,
          ml_today: loadedMl,
          breaks_today: Math.max(0, Math.round(Number(raw.state.breaks_today) || 0)),
          work_seconds_today: Math.max(0, Number(raw.state.work_seconds_today) || 0),
          break_seconds_today: Math.max(0, Number(raw.state.break_seconds_today) || 0),
          work_session_mode: ["working", "break"].includes(modeRaw) ? modeRaw : "off",
          history: raw.state.history && typeof raw.state.history === "object"
            ? { ...raw.state.history }
            : {},
          ml_history: raw.state.ml_history && typeof raw.state.ml_history === "object"
            ? { ...raw.state.ml_history }
            : {},
          work_history: raw.state.work_history && typeof raw.state.work_history === "object"
            ? { ...raw.state.work_history }
            : {},
        };
      }
      return { config, state };
    } catch {
      return null;
    }
  }

  load() {
    const parsed = this._parseRawFile(this.stateFile) || this._parseRawFile(this.backupFile);
    if (!parsed) {
      return { config: defaultConfig(), state: defaultState() };
    }
    ensureToday(parsed.state);
    return parsed;
  }

  save(config, state) {
    const cleanCfg = clampConfig(config);
    ensureToday(state);
    fs.mkdirSync(this.dataDir, { recursive: true });
    const serialized = JSON.stringify({ config: cleanCfg, state }, null, 2);
    const tmp = `${this.stateFile}.tmp`;
    fs.writeFileSync(tmp, serialized, "utf-8");
    fs.renameSync(tmp, this.stateFile);
    try {
      const bakTmp = `${this.backupFile}.tmp`;
      fs.writeFileSync(bakTmp, serialized, "utf-8");
      fs.renameSync(bakTmp, this.backupFile);
    } catch {
      // Non-fatal backup write failure
    }
    return cleanCfg;
  }
}

function scoreStateCandidate(parsed, mtimeMs = 0) {
  if (!parsed || !parsed.state) return -1;
  const s = parsed.state;
  const c = parsed.config || {};
  const histDays = s.history && typeof s.history === "object" ? Object.keys(s.history).length : 0;
  const nameBonus = c.user_name ? 15 : 0;
  const profileBonus = c.user_age !== 26 || c.user_height_cm !== 170 || c.user_weight_kg !== 70 ? 15 : 0;
  return histDays * 100 + (Number(s.glasses_today) || 0) * 5 + (Number(s.breaks_today) || 0) * 2 + nameBonus + profileBonus + mtimeMs / 1e13;
}

/** Migrate richest user data from legacy/appData/dev directories into persistent targetDir once. */
function migrateUserDataDir(targetDir, candidateDirs = []) {
  const targetStateFile = path.join(targetDir, "state.json");
  const targetBackupFile = path.join(targetDir, "state.backup.json");
  if (fs.existsSync(targetStateFile) || fs.existsSync(targetBackupFile)) {
    return { migrated: false, sourceDir: "" };
  }

  const parsedCandidates = [];
  const normTarget = path.resolve(targetDir).toLowerCase();
  for (const dir of candidateDirs) {
    if (!dir) continue;
    const resolvedDir = path.resolve(dir);
    if (resolvedDir.toLowerCase() === normTarget || !fs.existsSync(resolvedDir)) continue;
    const probe = new StateStore(resolvedDir);
    const parsed = probe._parseRawFile(probe.stateFile) || probe._parseRawFile(probe.backupFile);
    if (!parsed) continue;
    let mtimeMs = 0;
    try {
      const statPath = fs.existsSync(probe.stateFile) ? probe.stateFile : probe.backupFile;
      mtimeMs = fs.statSync(statPath).mtimeMs || 0;
    } catch {
      mtimeMs = 0;
    }
    parsedCandidates.push({
      dir: resolvedDir,
      parsed,
      score: scoreStateCandidate(parsed, mtimeMs),
    });
  }

  if (parsedCandidates.length === 0) {
    return { migrated: false, sourceDir: "" };
  }

  parsedCandidates.sort((a, b) => b.score - a.score);
  const best = parsedCandidates[0];
  const mergedConfig = clampConfig(best.parsed.config);
  const mergedState = {
    ...best.parsed.state,
    history: { ...(best.parsed.state.history || {}) },
    ml_history: { ...(best.parsed.state.ml_history || {}) },
    work_history: { ...(best.parsed.state.work_history || {}) },
  };

  for (let i = 1; i < parsedCandidates.length; i++) {
    const other = parsedCandidates[i].parsed.state;
    if (!other) continue;
    for (const [k, v] of Object.entries(other.history || {})) {
      const num = Math.max(0, Math.round(Number(v) || 0));
      if (!mergedState.history[k] || num > mergedState.history[k]) {
        mergedState.history[k] = num;
      }
    }
    for (const [k, v] of Object.entries(other.ml_history || {})) {
      const num = Math.max(0, Math.round(Number(v) || 0));
      if (!mergedState.ml_history[k] || num > mergedState.ml_history[k]) {
        mergedState.ml_history[k] = num;
      }
    }
    for (const [k, v] of Object.entries(other.work_history || {})) {
      if (v && typeof v === "object" && !mergedState.work_history[k]) {
        mergedState.work_history[k] = {
          workSec: Math.max(0, Math.round(Number(v.workSec) || 0)),
          breakSec: Math.max(0, Math.round(Number(v.breakSec) || 0)),
        };
      }
    }
  }

  const destStore = new StateStore(targetDir);
  destStore.save(mergedConfig, mergedState);
  return { migrated: true, sourceDir: best.dir };
}

class HydrationTimer {
  constructor(intervalMinutes = 20, snoozeMinutes = 5, clock = () => Date.now() / 1000) {
    this.intervalMinutes = Math.max(1, intervalMinutes);
    this.snoozeMinutes = Math.max(1, snoozeMinutes);
    this.clock = clock;
    this.status = "running"; // running, reminding, snoozed, paused
    this.remainingSeconds = this.intervalMinutes * 60;
    this.lastTick = this.clock();
    this.idleState = "active"; // active | paused | reset
    this.idleSeconds = 0;
  }

  updateIntervals(intervalMinutes, snoozeMinutes) {
    this.intervalMinutes = Math.max(1, Number(intervalMinutes) || 20);
    this.snoozeMinutes = Math.max(1, Number(snoozeMinutes) || 5);
    if (this.status === "running") {
      this.remainingSeconds = Math.min(this.remainingSeconds, this.intervalMinutes * 60);
    }
  }

  tick(idleSeconds = 0, idleOpts = {}) {
    const now = this.clock();
    const dt = Math.max(0, now - this.lastTick);
    this.lastTick = now;
    this.idleSeconds = Math.max(0, Number(idleSeconds) || 0);

    const smartIdle = idleOpts && idleOpts.enabled !== undefined ? Boolean(idleOpts.enabled) : false;
    const pauseSec = Math.max(15, Number(idleOpts && idleOpts.pauseSeconds) || 60);
    const resetSec = Math.max(pauseSec + 15, Number(idleOpts && idleOpts.resetSeconds) || 180);

    if (this.status !== "running" && this.status !== "snoozed") {
      this.idleState = "active";
      return false;
    }

    if (smartIdle) {
      if (this.idleSeconds >= resetSec) {
        this.status = "running";
        this.remainingSeconds = this.intervalMinutes * 60;
        this.idleState = "reset";
        return false;
      }
      if (this.idleSeconds >= pauseSec) {
        this.idleState = "paused";
        return false;
      }
    }

    this.idleState = "active";
    this.remainingSeconds = Math.max(0, this.remainingSeconds - dt);
    if (this.remainingSeconds <= 0) {
      this.status = "reminding";
      this.remainingSeconds = 0;
      return true;
    }
    return false;
  }

  markDrank() {
    this.status = "running";
    this.remainingSeconds = this.intervalMinutes * 60;
    this.idleState = "active";
    this.lastTick = this.clock();
  }

  snooze() {
    this.status = "snoozed";
    this.remainingSeconds = this.snoozeMinutes * 60;
    this.idleState = "active";
    this.lastTick = this.clock();
  }

  togglePause() {
    this.lastTick = this.clock();
    if (this.status === "paused") {
      this.status = "running";
    } else if (this.status === "running" || this.status === "snoozed") {
      this.status = "paused";
    }
    return this.status;
  }

  triggerNow() {
    this.status = "reminding";
    this.remainingSeconds = 0;
    this.idleState = "active";
    this.lastTick = this.clock();
  }

  formatRemaining() {
    if (this.status === "reminding") return "Drink!";
    const total = Math.max(0, Math.round(this.remainingSeconds));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
}

/** Resolve whether an action should log water or handle an active non-water companion reminder. */
function resolveDrinkAction({
  explicitWaterLog = false,
  inDrinkCooldown = false,
  welcomeActive = false,
  reminderKind = "water",
  countdownEndsAt = 0,
} = {}) {
  if (inDrinkCooldown) return "cooldown_skip";
  if (!explicitWaterLog) {
    if (welcomeActive || reminderKind === "welcome") return "welcome_fresh";
    if (reminderKind === "sticky") return "dismiss_sticky";
    if (reminderKind !== "water") {
      if ((reminderKind === "eye" || reminderKind === "stretch" || reminderKind === "stand") && countdownEndsAt === 0) {
        return "start_break_countdown";
      }
      return "complete_break";
    }
  }
  return "log_water";
}

/** Decide how the water timer should recover after laptop sleep, hibernation, or screen lock. */
function evaluateWakeRecovery({
  awayMs = 0,
  timerStatus = "running",
  remainingSeconds = 0,
  intervalMinutes = 20,
} = {}) {
  if (timerStatus === "paused") return "keep_paused";
  if (timerStatus === "reminding") return "re_present";
  const intervalMs = Math.max(1, Number(intervalMinutes) || 20) * 60000;
  if (awayMs >= intervalMs || Number(remainingSeconds) <= 10) {
    return "prompt_soon";
  }
  return "resume_tick";
}

module.exports = {
  PROJECT_ROOT,
  DEFAULT_DATA_DIR,
  DEFAULT_GLB_PATH,
  BREAK_DEFAULTS,
  StateStore,
  HydrationTimer,
  defaultConfig,
  pickRandomScreenX,
  clampConfig,
  calculateRecommendedHydrationMl,
  resolveDailyHydrationGoal,
  defaultState,
  ensureToday,
  addGlass,
  addBreak,
  addWorkBreakSeconds,
  evaluateWorkSchedule,
  isPastBedtime,
  formatDurationCompact,
  recentDays,
  computeStreakDays,
  resetProgressState,
  resolveDrinkAction,
  evaluateWakeRecovery,
  migrateUserDataDir,
};
