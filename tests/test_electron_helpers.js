"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const {
  BREAK_DEFAULTS,
  DEFAULT_GLB_PATH,
  HydrationTimer,
  StateStore,
  addBreak,
  addGlass,
  addWorkBreakSeconds,
  calculateRecommendedHydrationMl,
  clampConfig,
  computeStreakDays,
  ensureToday,
  evaluateWakeRecovery,
  evaluateWorkSchedule,
  formatDurationCompact,
  isPastBedtime,
  migrateUserDataDir,
  pickRandomScreenX,
  recentDays,
  resetProgressState,
  resolveDailyHydrationGoal,
  resolveDrinkAction,
} = require("../electron/store");
const { parseQuickCommand } = require("../electron/command_parser");
const { classifyWindowFullscreen } = require("../electron/fullscreen");
const { buildStartupCommand } = require("../electron/startup");
const {
  adaptDialogForGender,
  buildWelcomeGreeting,
  computeEffectiveIntervalMinutes,
  formatDisplayUsername,
  formatWeeklyReportMessage,
  getDialogPack,
  getTimeOfDayContext,
  isMohanlalCharacter,
  pickContextualReminderQuote,
} = require("../electron/dialogs");
const {
  classifyForegroundApp,
  detectSpecialOccasion,
  getLightingPeriod,
  summarizeWeeklyStats,
} = require("../electron/context_awareness");
const { SystemMonitor } = require("../electron/system_monitor");
const { generateLicenseKey, getMachineHwid, verifyLicenseKey } = require("../electron/license");
const { isNewerVersion, parseSemver } = require("../electron/updater");

function run() {
  // 1. Default & Droppy GLB structure verification
  assert(fs.existsSync(DEFAULT_GLB_PATH), "DEFAULT_GLB_PATH must exist");
  const defaultBuf = fs.readFileSync(DEFAULT_GLB_PATH);
  assert.strictEqual(defaultBuf.readUInt32LE(0), 0x46546c67, "GLB magic must be glTF");
  assert.strictEqual(defaultBuf.readUInt32LE(4), 2, "GLB version must be 2");
  const mJsonLen = defaultBuf.readUInt32LE(12);
  const mGltf = JSON.parse(defaultBuf.slice(20, 20 + mJsonLen).toString("utf-8"));
  const mAnims = (mGltf.animations || []).map((a) => a.name);
  for (const requiredClip of [
    "Walk",
    "Idle",
    "Remind",
    "Celebrate",
    "ThumbsUp",
    "Happy",
    "Salute",
    "Shrug",
    "Doubt",
    "Angry",
    "Stretch",
    "Tired",
    "Meesha",
  ]) {
    assert(mAnims.includes(requiredClip), `Mohanlal GLB must include ${requiredClip}`);
  }

  const droppyPath = path.join(__dirname, "..", "assets", "water_buddy.glb");
  assert(fs.existsSync(droppyPath), "assets/water_buddy.glb must exist");
  const buf = fs.readFileSync(droppyPath);
  assert.strictEqual(buf.readUInt32LE(0), 0x46546c67, "GLB magic must be glTF");
  assert.strictEqual(buf.readUInt32LE(4), 2, "GLB version must be 2");
  const jsonLen = buf.readUInt32LE(12);
  assert.strictEqual(buf.readUInt32LE(16), 0x4e4f534a, "Chunk 0 must be JSON");
  const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf-8"));
  const animNames = (gltf.animations || []).map((a) => a.name);
  assert.deepStrictEqual(animNames, ["Walk", "Idle", "Remind", "Celebrate"]);

  // 2. Config clamping & new SipMate fields
  const cfg = clampConfig({
    interval_minutes: 0,
    walk_speed: 500,
    character_scale: 5.0,
    glb_path: "  C:\\models\\buddy.glb  ",
    language: "ENGLISH",
    random_character: true,
    eye_break_enabled: false,
    dnd_fullscreen: false,
    roster: [
      { id: "c1", name: "Buddy", glb_path: "C:\\models\\buddy.glb", voice_path: "" },
      { id: "c2", name: "Dup", glb_path: "c:\\models\\buddy.glb", voice_path: "" },
    ],
  });
  assert.strictEqual(cfg.interval_minutes, 1);
  assert.strictEqual(cfg.walk_speed, 220);
  assert.strictEqual(cfg.character_scale, 2.0);
  assert.strictEqual(cfg.glb_path, "C:\\models\\buddy.glb");
  assert.strictEqual(cfg.popup_only_mode, true);
  assert.strictEqual(cfg.language, "english");
  assert.strictEqual(cfg.random_character, true);
  assert.strictEqual(cfg.eye_break_enabled, false);
  assert.strictEqual(cfg.dnd_fullscreen, false);
  assert.strictEqual(cfg.roster.length, 1);

  // 3. Daily rollover + recentDays
  const day2 = new Date();
  const day1 = new Date(day2);
  day1.setDate(day1.getDate() - 1);
  const iso1 = `${day1.getFullYear()}-${String(day1.getMonth() + 1).padStart(2, "0")}-${String(day1.getDate()).padStart(2, "0")}`;
  const st = { current_date: iso1, glasses_today: 4, history: {} };
  assert.strictEqual(ensureToday(st, day2), true);
  assert.strictEqual(st.glasses_today, 0);
  assert.strictEqual(st.history[iso1], 4);
  addGlass(st, 2, day2);
  const rec = recentDays(st, 3, day2);
  assert.strictEqual(rec.length, 3);
  assert.strictEqual(rec[1].count, 4);
  assert.strictEqual(rec[2].count, 2);

  // 4. StateStore round-trip
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sipmate-test-"));
  try {
    const store = new StateStore(tmpDir);
    store.save({ ...cfg, walk_enabled: false }, st);
    const loaded = store.load();
    assert.strictEqual(loaded.config.walk_enabled, false);
    assert.strictEqual(loaded.config.language, "english");
    assert.strictEqual(loaded.config.roster.length, 1);
    assert.strictEqual(loaded.state.glasses_today, 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // 5. HydrationTimer transitions
  let fakeNow = 100;
  const timer = new HydrationTimer(20, 5, () => fakeNow);
  assert.strictEqual(timer.formatRemaining(), "20:00");
  fakeNow += 1200;
  assert.strictEqual(timer.tick(), true);
  assert.strictEqual(timer.status, "reminding");
  timer.snooze();
  assert.strictEqual(timer.status, "snoozed");
  assert.strictEqual(timer.formatRemaining(), "05:00");
  fakeNow += 300;
  assert.strictEqual(timer.tick(), true);
  timer.markDrank();
  assert.strictEqual(timer.status, "running");

  // 6. Startup command builder
  const cmd = buildStartupCommand("D:\\self made projects\\drink water", "C:\\electron.exe");
  assert.strictEqual(cmd, '"C:\\electron.exe" "D:\\self made projects\\drink water"');

  // 7. Character dialog isolation + sidecar JSON & voice auto-loading
  assert.strictEqual(isMohanlalCharacter(""), true);
  assert.strictEqual(isMohanlalCharacter("mohanlal"), true);
  assert.strictEqual(isMohanlalCharacter("C:\\avatars\\mohanlal.glb"), true);
  assert.strictEqual(isMohanlalCharacter("droppy"), false);
  assert.strictEqual(isMohanlalCharacter("C:\\avatars\\robot.glb"), false);

  const mlPunch = getDialogPack("", "malayalam");
  const mlStd = getDialogPack("droppy", "malayalam");
  const enStd = getDialogPack("droppy", "english");
  assert(
    mlPunch.reminders.some((q) => q.includes("സവാരി ഗിരി ഗിരി")),
    "Mohanlal Malayalam pack must contain Mohanlal Malayalam punchline"
  );
  assert(
    !mlStd.reminders.some((q) => q.includes("സവാരി ഗിരി ഗിരി")),
    "Non-Mohanlal Malayalam pack must NOT contain Mohanlal punchlines"
  );
  assert(
    /[\u0D00-\u0D7F]/.test(mlPunch.reminders[0]) && /[\u0D00-\u0D7F]/.test(mlStd.reminders[0]),
    "Malayalam packs must use native Malayalam Unicode script"
  );
  assert.strictEqual(enStd.title, "Time to Hydrate");
  assert.strictEqual(enStd.reminders.some((q) => /[\u0D00-\u0D7F]/.test(q)), false);

  const sidecarDir = fs.mkdtempSync(path.join(os.tmpdir(), "sipmate-sidecar-"));
  try {
    const customGlb = path.join(sidecarDir, "hero.glb");
    const sidecarJson = path.join(sidecarDir, "hero.dialogs.json");
    const sidecarMp3 = path.join(sidecarDir, "hero.mp3");
    fs.writeFileSync(customGlb, "glb");
    fs.writeFileSync(sidecarMp3, "mp3");
    fs.writeFileSync(
      sidecarJson,
      JSON.stringify({
        english: { title: "Hero Hydration", reminders: ["Hero says drink water!"] },
        malayalam: { reminders: ["Hero: Vellam kudi!"] },
      })
    );
    const customEn = getDialogPack(customGlb, "english", customGlb);
    const customMl = getDialogPack(customGlb, "malayalam", customGlb);
    assert.strictEqual(customEn.title, "Hero Hydration");
    assert.deepStrictEqual(customEn.reminders, ["Hero says drink water!"]);
    assert.deepStrictEqual(customMl.reminders, ["Hero: Vellam kudi!"]);
  } finally {
    fs.rmSync(sidecarDir, { recursive: true, force: true });
  }

  // 8. Break counter daily tracking (no XP/level gamification)
  const breakState = { current_date: iso1, glasses_today: 0, breaks_today: 0, history: {} };
  const breaksCount = addBreak(breakState, day2);
  assert.strictEqual(breaksCount, 1);
  assert.strictEqual(breakState.breaks_today, 1);

  // 9. SystemMonitor continuous active time & alert triggers
  let fakeSysClock = 1000;
  let fakeIdleSec = 0;
  const sysMon = new SystemMonitor(() => fakeIdleSec, () => fakeSysClock);
  for (let i = 0; i < 65; i++) {
    fakeSysClock += 20; // +20s per sample = 1300s (~21.6m)
    sysMon.sample();
  }
  assert(sysMon.getStats().continuousActiveMinutes >= 21);
  assert.strictEqual(
    sysMon.shouldTriggerAlert({ enabled: true, activeLimitMinutes: 20, cpuThreshold: 99 }),
    "active_time"
  );
  fakeIdleSec = 400; // user idle >= 5m resets continuous active timer
  fakeSysClock += 10;
  sysMon.sample();
  assert.strictEqual(sysMon.getStats().continuousActiveSeconds, 0);

  // 10. HWID Device Licensing & OTA Semver comparator
  const hwid = getMachineHwid();
  assert(/^BRIO-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(hwid));
  const proKey = generateLicenseKey(hwid);
  assert.strictEqual(verifyLicenseKey(proKey, hwid).valid, true);
  assert.strictEqual(verifyLicenseKey("WRONG-KEY", hwid).valid, false);
  assert.deepStrictEqual(parseSemver("v2.1.4"), [2, 1, 4]);
  assert.strictEqual(isNewerVersion("2.1.0", "2.0.0"), true);
  assert.strictEqual(isNewerVersion("2.0.0", "2.0.0"), false);

  // 11. Smart Active-Work-Driven HydrationTimer (pause at 60s idle, reset to 20:00 at 180s idle)
  let workClock = 500;
  const workTimer = new HydrationTimer(20, 5, () => workClock);
  const idleOpts = { enabled: true, pauseSeconds: 60, resetSeconds: 180 };

  // 5 minutes of active work (idle = 5s) -> remaining drops from 1200s to 900s (15:00)
  workClock += 300;
  assert.strictEqual(workTimer.tick(5, idleOpts), false);
  assert.strictEqual(workTimer.remainingSeconds, 900);
  assert.strictEqual(workTimer.idleState, "active");

  // User stops moving mouse for 75s (60 <= idle < 180) -> timer freezes at 900s ("paused")
  workClock += 60;
  assert.strictEqual(workTimer.tick(75, idleOpts), false);
  assert.strictEqual(workTimer.remainingSeconds, 900);
  assert.strictEqual(workTimer.idleState, "paused");

  // User stays away for 190s (>= 180s) -> treated as real break, resets back to full 1200s (20:00)
  workClock += 120;
  assert.strictEqual(workTimer.tick(190, idleOpts), false);
  assert.strictEqual(workTimer.remainingSeconds, 1200);
  assert.strictEqual(workTimer.idleState, "reset");
  assert.strictEqual(workTimer.formatRemaining(), "20:00");

  // User returns and works continuously for 20 minutes -> triggers reminder
  workClock += 1200;
  assert.strictEqual(workTimer.tick(0, idleOpts), true);
  assert.strictEqual(workTimer.status, "reminding");

  // Verify SystemMonitor stretchActiveSeconds pauses at 60s and resets at 180s
  let smClock = 2000;
  let smIdle = 0;
  const sm2 = new SystemMonitor(() => smIdle, () => smClock);
  smClock += 25;
  sm2.sample({ pauseSeconds: 60, resetSeconds: 180 });
  assert.strictEqual(sm2.getStats().stretchActiveSeconds, 25);
  assert.strictEqual(sm2.getStats().idleState, "active");

  smIdle = 90; // paused
  smClock += 25;
  sm2.sample({ pauseSeconds: 60, resetSeconds: 180 });
  assert.strictEqual(sm2.getStats().stretchActiveSeconds, 25);
  assert.strictEqual(sm2.getStats().idleState, "paused");

  smIdle = 200; // reset
  smClock += 25;
  sm2.sample({ pauseSeconds: 60, resetSeconds: 180 });
  assert.strictEqual(sm2.getStats().stretchActiveSeconds, 0);
  assert.strictEqual(sm2.getStats().continuousActiveSeconds, 0);
  assert.strictEqual(sm2.getStats().idleState, "reset");

  // 12. Context-aware time-of-day, marathon interval boost, Malayalam ranks & Meesha pose pack
  assert.strictEqual(getTimeOfDayContext(new Date("2026-11-22T08:15:00")), "morning");
  assert.strictEqual(getTimeOfDayContext(new Date("2026-11-22T16:10:00")), "chaya_break");
  assert.strictEqual(getTimeOfDayContext(new Date("2026-11-22T23:45:00")), "late_night");
  assert.strictEqual(getTimeOfDayContext(new Date("2026-11-22T13:00:00")), "normal");

  const lateQuote = pickContextualReminderQuote(mlPunch, {
    now: new Date("2026-11-22T23:50:00"),
    continuousActiveMinutes: 10,
  });
  assert(
    mlPunch.lateNightReminders.includes(lateQuote),
    "Late-night context must pick from lateNightReminders"
  );
  const marathonQuote = pickContextualReminderQuote(mlPunch, {
    now: new Date("2026-11-22T13:00:00"),
    continuousActiveMinutes: 75,
  });
  assert(
    mlPunch.marathonReminders.includes(marathonQuote),
    "60+ min active session must pick from marathonReminders"
  );
  assert.strictEqual(computeEffectiveIntervalMinutes(20, 30), 20);
  assert.strictEqual(computeEffectiveIntervalMinutes(20, 70), 16);

  assert(
    Array.isArray(mlPunch.poseLines) && mlPunch.poseLines.some((p) => p.kind === "meesha"),
    "Mohanlal pack must include meesha pose lines"
  );

  // 13. Startup welcome greeting with formatted Windows username
  assert.strictEqual(formatDisplayUsername("akhil_kumar"), "Akhil Kumar");
  const mlWelcome = buildWelcomeGreeting(mlPunch, "akhil");
  assert(
    mlWelcome.includes("Akhil") && mlWelcome.includes("സുഖമാണോ"),
    "Malayalam welcome greeting must include formatted username and ask how you are"
  );
  const enWelcome = buildWelcomeGreeting(enStd, "akhil");
  assert(
    enWelcome.includes("Hi Akhil, how are you?"),
    "English welcome greeting must include 'Hi Akhil, how are you?'"
  );

  // 14. Gender addressing ('മോനേ' -> 'മോളേ') + habits & sticky note clamping
  assert.strictEqual(
    adaptDialogForGender("👋 ഹായ് Meera മോനേ, സുഖമാണോ?", "female"),
    "👋 ഹായ് Meera മോളേ, സുഖമാണോ?"
  );
  const femalePack = getDialogPack("", "malayalam", "", "female");
  assert(
    femalePack.welcomeTemplate.includes("മോളേ") && !femalePack.welcomeTemplate.includes("മോനേ"),
    "Female Malayalam pack must call her മോളേ"
  );
  assert(
    femalePack.reactions.some((r) => r.msg.includes("ചുണക്കുട്ടി")),
    "Female Malayalam reaction must use ചുണക്കുട്ടി"
  );
  const habCfg = clampConfig({
    user_gender: "FEMALE",
    sticky_note: "  Call Mom  ",
    custom_habits: [{ title: "Take Vitamins", timeHHMM: "9:05" }],
  });
  assert.strictEqual(habCfg.user_gender, "female");
  assert.strictEqual(habCfg.sticky_note, "Call Mom");
  assert.strictEqual(habCfg.custom_habits.length, 1);
  assert.strictEqual(habCfg.custom_habits[0].timeHHMM, "09:05");

  // 15. Context awareness, weather/coding quotes, lighting & weekly scorecard
  assert.strictEqual(classifyForegroundApp("Zoom Meeting", "Zoom.exe"), "meeting");
  assert.strictEqual(classifyForegroundApp("main.js - Visual Studio Code", "Code.exe"), "coding");
  assert.strictEqual(classifyForegroundApp("YouTube - Google Chrome", "chrome.exe"), "video");
  assert.strictEqual(classifyForegroundApp("Notepad", "notepad.exe"), "other");

  assert.strictEqual(getLightingPeriod(new Date("2026-11-22T08:00:00")), "morning");
  assert.strictEqual(getLightingPeriod(new Date("2026-11-22T14:00:00")), "day");
  assert.strictEqual(getLightingPeriod(new Date("2026-11-22T18:30:00")), "evening");
  assert.strictEqual(getLightingPeriod(new Date("2026-11-22T22:30:00")), "night");

  const hotQ = pickContextualReminderQuote(mlPunch, {
    weatherTempC: 34,
    rng: () => 0.1,
  });
  assert(hotQ.includes("34°C"), "Hot weather reminder must include temperature");

  const codeQ = pickContextualReminderQuote(mlPunch, {
    appCategory: "coding",
    rng: () => 0.1,
  });
  assert(
    mlPunch.codingReminders.includes(codeQ),
    "Coding context must pick from codingReminders"
  );

  const wkSummary = summarizeWeeklyStats(
    [{ count: 8 }, { count: 6 }, { count: 9 }, { count: 8 }, { count: 4 }, { count: 10 }, { count: 5 }],
    8,
    250
  );
  assert.strictEqual(wkSummary.totalGlasses, 50);
  assert.strictEqual(wkSummary.totalMl, 12500);
  assert.strictEqual(wkSummary.goalsHitDays, 4);
  const wkMsg = formatWeeklyReportMessage(mlPunch, wkSummary);
  assert(wkMsg.includes("50") && wkMsg.includes("4"), "Weekly message must show stats");

  const dirtyState = {
    current_date: "2026-11-22",
    glasses_today: 7,
    breaks_today: 5,
    history: { "2026-11-21": 6, "2026-11-22": 7 },
  };
  resetProgressState(dirtyState, new Date("2026-11-23T00:05:00"));
  assert.strictEqual(dirtyState.glasses_today, 0);
  assert.strictEqual(dirtyState.breaks_today, 0);
  assert.deepStrictEqual(dirtyState.history, {});
  assert.strictEqual(dirtyState.current_date, "2026-11-23");

  // 17. Consecutive streak, birthday/special occasions, battery/EOD config clamping
  const streakNow = new Date("2026-11-23T12:00:00");
  const streakState = {
    current_date: "2026-11-23",
    glasses_today: 8,
    breaks_today: 0,
    xp: 200,
    history: {
      "2026-11-20": 5,
      "2026-11-21": 8,
      "2026-11-22": 9,
    },
  };
  assert.strictEqual(computeStreakDays(streakState, 8, streakNow), 3);

  assert.strictEqual(detectSpecialOccasion("11-23", streakNow), "birthday");
  assert.strictEqual(detectSpecialOccasion("05-01", new Date("2026-04-14T10:00:00")), "vishu");
  assert.strictEqual(detectSpecialOccasion("05-01", new Date("2026-11-01T10:00:00")), "kerala_piravi");
  assert.strictEqual(detectSpecialOccasion("05-01", new Date("2026-07-10T10:00:00")), "");

  const newCfg = clampConfig({
    birthday_mmdd: "11-23",
    eod_recap_time: "9:5",
    battery_alerts_enabled: false,
  });
  assert.strictEqual(newCfg.birthday_mmdd, "11-23");
  assert.strictEqual(newCfg.eod_recap_time, "09:05");
  assert.strictEqual(newCfg.battery_alerts_enabled, false);

  const femBatPack = getDialogPack("", "malayalam", "", "female");
  assert(
    femBatPack.eodRecapTemplate.includes("മോളേ") && femBatPack.batteryLowTemplate.includes("മോളേ"),
    "Female adaptation must cover EOD recap and battery templates"
  );

  // 18. Aesthetic UI theme clamping & HTML inline script syntax check
  assert.strictEqual(clampConfig({}).ui_theme, "midnight_glass");
  assert.strictEqual(clampConfig({ ui_theme: "kochi_noir" }).ui_theme, "kochi_noir");
  assert.strictEqual(clampConfig({ ui_theme: "nordic_mist" }).ui_theme, "nordic_mist");
  assert.strictEqual(clampConfig({ ui_theme: "cyber_mint" }).ui_theme, "cyber_mint");
  assert.strictEqual(clampConfig({ ui_theme: "invalid_theme" }).ui_theme, "midnight_glass");

  for (const uiFile of ["electron/settings.html", "electron/dashboard.html", "electron/sticky.html", "electron/palette.html"]) {
    const htmlPath = path.join(__dirname, "..", uiFile);
    const html = fs.readFileSync(htmlPath, "utf8");
    const scripts = [...html.matchAll(/<script(?![^>]*type=)[^>]*>([\s\S]*?)<\/script>/g)];
    assert(scripts.length >= 1, `${uiFile} must contain an inline script`);
    scripts.forEach((m, idx) => {
      new vm.Script(m[1], { filename: `${uiFile}:script${idx}` });
    });
  }

  // 19. Floating Desktop Sticky Notes Board clamping & legacy note migration
  const migratedSticky = clampConfig({ sticky_note: "water in stove" });
  assert.strictEqual(migratedSticky.sticky_notes.length, 1);
  assert.strictEqual(migratedSticky.sticky_notes[0].text, "water in stove");
  assert.strictEqual(migratedSticky.sticky_always_on_top, true);
  assert.strictEqual(migratedSticky.sticky_open, false);

  const customSticky = clampConfig({
    sticky_notes: [
      { id: "n1", text: "water in stove", done: false, timerEndsAt: 1795469999000, alertFired: false },
      { id: "n2", text: "   ", done: false },
    ],
    sticky_open: true,
    sticky_always_on_top: false,
    sticky_x: 120.4,
    sticky_y: 80.7,
  });
  assert.strictEqual(customSticky.sticky_notes.length, 1);
  assert.strictEqual(customSticky.sticky_open, true);
  assert.strictEqual(customSticky.sticky_always_on_top, false);
  assert.strictEqual(customSticky.sticky_x, 120);
  assert.strictEqual(customSticky.sticky_y, 81);

  // 20. Work Time, Break Time, Shift Hours & Scheduled Breaks
  const wbState = {
    current_date: "2026-11-24",
    glasses_today: 2,
    breaks_today: 0,
    work_seconds_today: 0,
    break_seconds_today: 0,
    work_session_mode: "working",
    xp: 0,
    history: {},
    work_history: {},
  };
  const wbNow = new Date("2026-11-24T10:30:00");
  addWorkBreakSeconds(wbState, "working", 3600, false, wbNow);
  addWorkBreakSeconds(wbState, "working", 300, true, wbNow); // Activity Guard paused while idle
  addWorkBreakSeconds(wbState, "break", 900, false, wbNow);
  assert.strictEqual(wbState.work_seconds_today, 3600);
  assert.strictEqual(wbState.break_seconds_today, 900);
  assert.strictEqual(formatDurationCompact(wbState.work_seconds_today), "1h");
  assert.strictEqual(formatDurationCompact(2700), "45m");
  const wbDays = recentDays(wbState, 7, wbNow);
  assert.strictEqual(wbDays[wbDays.length - 1].workMinutes, 60);
  assert.strictEqual(wbDays[wbDays.length - 1].breakMinutes, 15);

  const shiftCfg = clampConfig({
    work_schedule_enabled: true,
    work_shift_start: "09:00",
    work_shift_end: "18:00",
    scheduled_breaks: [
      { id: "lunch", title: "Lunch", startHHMM: "13:00", endHHMM: "13:45", enabled: true },
    ],
  });
  // Inside shift, not in lunch
  assert.strictEqual(
    evaluateWorkSchedule(shiftCfg, "off", new Date("2026-11-24T10:30:00")).remindersAllowed,
    true
  );
  // Outside shift when "off" -> quieted
  assert.strictEqual(
    evaluateWorkSchedule(shiftCfg, "off", new Date("2026-11-24T20:00:00")).remindersAllowed,
    false
  );
  // Outside shift when manually clocked in ("working") -> allowed
  assert.strictEqual(
    evaluateWorkSchedule(shiftCfg, "working", new Date("2026-11-24T20:00:00")).remindersAllowed,
    true
  );
  // Inside scheduled Lunch break -> active break detected & reminders quieted
  const lunchEval = evaluateWorkSchedule(shiftCfg, "working", new Date("2026-11-24T13:15:00"));
  assert.strictEqual(lunchEval.activeScheduledBreak.title, "Lunch");
  assert.strictEqual(lunchEval.remindersAllowed, false);
  assert.strictEqual(clampConfig({}).ghost_mode_enabled, false);
  assert.strictEqual(clampConfig({ ghost_mode_enabled: true }).ghost_mode_enabled, true);

  // 21. Quick Command Palette parser (natural actions, timed notes, safe math)
  assert.strictEqual(parseQuickCommand("").kind, "suggestions");
  const mathCmd = parseQuickCommand("450 * 18");
  assert.strictEqual(mathCmd.kind, "math");
  assert.strictEqual(mathCmd.value, 8100);
  const timedSticky = parseQuickCommand("water in stove 5m");
  assert.strictEqual(timedSticky.kind, "sticky_note");
  assert.strictEqual(timedSticky.text, "water in stove");
  assert.strictEqual(timedSticky.minutes, 5);
  assert.strictEqual(parseQuickCommand("drink 500").ml, 500);
  assert.strictEqual(parseQuickCommand("work").mode, "working");
  assert.strictEqual(parseQuickCommand("break").mode, "break");
  assert.strictEqual(parseQuickCommand("dnd 30").minutes, 30);
  assert.strictEqual(parseQuickCommand("process.exit(1)").kind, "sticky_note");

  // 22. Night-Owl Sleep Guard (isPastBedtime & config clamping)
  const bedCfg = clampConfig({ bedtime_enabled: true, bedtime_hhmm: "23:30" });
  assert.strictEqual(bedCfg.bedtime_enabled, true);
  assert.strictEqual(bedCfg.bedtime_hhmm, "23:30");
  assert.strictEqual(isPastBedtime("23:30", new Date("2026-11-24T23:45:00")), true);
  assert.strictEqual(isPastBedtime("23:30", new Date("2026-11-24T01:15:00")), true);
  assert.strictEqual(isPastBedtime("23:30", new Date("2026-11-24T14:00:00")), false);

  // 23. Personalized Daily Hydration Goal Calculator (age, height, weight -> ml / L)
  assert.strictEqual(calculateRecommendedHydrationMl({ age: 26, heightCm: 170, weightKg: 70 }), 2450);
  assert.strictEqual(calculateRecommendedHydrationMl({ age: 15, heightCm: 170, weightKg: 50 }), 2000);
  assert.strictEqual(calculateRecommendedHydrationMl({ age: 62, heightCm: 170, weightKg: 70 }), 2100);
  assert.strictEqual(calculateRecommendedHydrationMl({ age: 25, heightCm: 240, weightKg: 200 }), 5000);
  assert.strictEqual(calculateRecommendedHydrationMl({ age: 25, heightCm: 90, weightKg: 20 }), 1500);

  const autoCfg = clampConfig({
    auto_hydration_goal: true,
    user_age: 28,
    user_height_cm: 180,
    user_weight_kg: 80,
    glass_ml: 250,
  });
  assert.strictEqual(autoCfg.daily_goal_ml, 2850);
  assert.strictEqual(autoCfg.daily_goal_glasses, 12);
  const resolvedAuto = resolveDailyHydrationGoal(autoCfg);
  assert.strictEqual(resolvedAuto.goalMl, 2850);
  assert.strictEqual(resolvedAuto.goalLiters, 2.85);
  assert.strictEqual(resolvedAuto.isAuto, true);

  const manualCfg = clampConfig({
    auto_hydration_goal: false,
    user_age: 28,
    user_height_cm: 180,
    user_weight_kg: 80,
    daily_goal_glasses: 6,
    glass_ml: 250,
  });
  const resolvedManual = resolveDailyHydrationGoal(manualCfg);
  assert.strictEqual(resolvedManual.goalMl, 1500);
  assert.strictEqual(resolvedManual.goalLiters, 1.5);
  assert.strictEqual(resolvedManual.isAuto, false);

  const mlTrackState = {
    current_date: "2026-11-24",
    glasses_today: 0,
    ml_today: 0,
    breaks_today: 0,
    xp: 0,
    history: {},
    ml_history: {},
  };
  const trackDay = new Date("2026-11-24T12:00:00");
  addGlass(mlTrackState, 1, trackDay, 150);
  addGlass(mlTrackState, 1, trackDay, 500);
  assert.strictEqual(mlTrackState.glasses_today, 2);
  assert.strictEqual(mlTrackState.ml_today, 650);
  assert.strictEqual(computeStreakDays(mlTrackState, 2, trackDay, 2000), 0);
  addGlass(mlTrackState, 1, trackDay, 1400);
  assert.strictEqual(mlTrackState.ml_today, 2050);
  assert.strictEqual(computeStreakDays(mlTrackState, 8, trackDay, 2000), 1);

  const mlRecent = recentDays(mlTrackState, 7, trackDay, 250);
  assert.strictEqual(mlRecent[mlRecent.length - 1].ml, 2050);
  const mlWeekly = summarizeWeeklyStats(mlRecent, 8, 250, 2000);
  assert.strictEqual(mlWeekly.totalMl, 2050);
  assert.strictEqual(mlWeekly.goalsHitDays, 1);

  // 24. Ergonomic break categories, work-hours break gating & smart eye-idle reset
  const defCfg = clampConfig({});
  assert.strictEqual(BREAK_DEFAULTS.eye_break_interval_minutes, 20);
  assert.strictEqual(BREAK_DEFAULTS.stretch_interval_minutes, 45);
  assert.strictEqual(BREAK_DEFAULTS.stand_break_interval_minutes, 90);
  assert.strictEqual(defCfg.eye_break_interval_minutes, 20);
  assert.strictEqual(defCfg.eye_break_duration_seconds, 20);
  assert.strictEqual(defCfg.stretch_interval_minutes, 45);
  assert.strictEqual(defCfg.stretch_duration_seconds, 30);
  assert.strictEqual(defCfg.stand_break_interval_minutes, 90);
  assert.strictEqual(defCfg.stand_break_duration_seconds, 120);
  assert.strictEqual(defCfg.eye_idle_reset_seconds, 25);
  assert.strictEqual(defCfg.min_visit_gap_minutes, 5);
  assert.strictEqual(defCfg.breaks_work_hours_only, true);

  // Outside working hours (even when work_schedule_enabled is false for water):
  // Water remains allowed, while Eye/Stretch/Stand breaks are paused!
  const breakGateCfg = clampConfig({
    work_schedule_enabled: false,
    breaks_work_hours_only: true,
    work_shift_start: "09:00",
    work_shift_end: "18:00",
  });
  const afterHoursEval = evaluateWorkSchedule(breakGateCfg, "off", new Date("2026-11-24T21:30:00"));
  assert.strictEqual(afterHoursEval.remindersAllowed, true);
  assert.strictEqual(afterHoursEval.breakRemindersAllowed, false);
  const overtimeEval = evaluateWorkSchedule(breakGateCfg, "working", new Date("2026-11-24T21:30:00"));
  assert.strictEqual(overtimeEval.breakRemindersAllowed, true);
  const workHoursEval = evaluateWorkSchedule(breakGateCfg, "off", new Date("2026-11-24T11:00:00"));
  assert.strictEqual(workHoursEval.breakRemindersAllowed, true);

  // Smart per-break idle reset & hierarchy:
  let brkClock = 2000;
  let brkIdle = 0;
  const brkMon = new SystemMonitor(() => brkIdle, () => brkClock);
  for (let i = 0; i < 6; i++) {
    brkClock += 20;
    brkMon.sample({ pauseSeconds: 60, resetSeconds: 180, eyeIdleResetSeconds: 25, inWorkWindow: true });
  }
  assert.strictEqual(brkMon.eyeActiveSeconds, 120);
  assert.strictEqual(brkMon.stretchActiveSeconds, 120);
  assert.strictEqual(brkMon.continuousActiveSeconds, 120);

  // 28s glance away resets Eye Rest timer naturally while preserving Stretch & Stand timers
  brkIdle = 28;
  brkClock += 10;
  brkMon.sample({ pauseSeconds: 60, resetSeconds: 180, eyeIdleResetSeconds: 25, inWorkWindow: true });
  assert.strictEqual(brkMon.idleState, "eye_rested");
  assert.strictEqual(brkMon.eyeActiveSeconds, 0);
  assert.strictEqual(brkMon.stretchActiveSeconds, 120);
  assert.strictEqual(brkMon.continuousActiveSeconds, 120);

  // Hierarchy: Stretch resets Stretch + Eye; Stand resets Stand + Stretch + Eye
  brkIdle = 0;
  brkClock += 20;
  brkMon.sample({ pauseSeconds: 60, resetSeconds: 180, eyeIdleResetSeconds: 25, inWorkWindow: true });
  assert.strictEqual(brkMon.eyeActiveSeconds, 20);
  brkMon.resetStretchTime();
  assert.strictEqual(brkMon.stretchActiveSeconds, 0);
  assert.strictEqual(brkMon.eyeActiveSeconds, 0);
  assert(brkMon.continuousActiveSeconds > 0);
  brkMon.resetStandAndAllBreaks();
  assert.strictEqual(brkMon.continuousActiveSeconds, 0);

  // Outside working hours: all break timers stay at 0
  brkClock += 20;
  brkMon.sample({ pauseSeconds: 60, resetSeconds: 180, eyeIdleResetSeconds: 25, inWorkWindow: false });
  assert.strictEqual(brkMon.idleState, "off_hours");
  assert.strictEqual(brkMon.eyeActiveSeconds, 0);

  // 25. Conversational natural reply packs & Deep-Focus Edge Peek defaults
  assert.strictEqual(defCfg.deep_focus_peek_enabled, true);
  assert.strictEqual(clampConfig({ deep_focus_peek_enabled: false }).deep_focus_peek_enabled, false);
  for (const [charPath, lang] of [
    ["", "malayalam"],
    ["", "english"],
    ["droppy", "malayalam"],
    ["droppy", "english"],
  ]) {
    const p = getDialogPack(charPath, lang);
    assert(p.replyLines && p.replyLines.snooze5 && p.replyLines.deepFocus && p.replyLines.justHad);
    assert(p.focusPeekWater && p.focusPeekBreak);
    assert(p.reminders.every((line) => line.length <= 55), `Prompt too wordy (${lang})`);
  }

  // 26. Random full-width screen position always stays 100% inside monitor bounds
  for (const r of [0.0, 0.15, 0.34, 0.5, 0.85, 0.999]) {
    const xL = pickRandomScreenX({
      waX: 0,
      waWidth: 1920,
      compW: 372,
      margin: 12,
      preferredSide: "left",
      rng: () => r,
    });
    const xR = pickRandomScreenX({
      waX: 0,
      waWidth: 1920,
      compW: 372,
      margin: 12,
      preferredSide: "right",
      rng: () => r,
    });
    assert(xL >= 12 && xL + 372 <= 1920 - 12, `Left entrance x=${xL} clipped`);
    assert(xR >= 12 && xR + 372 <= 1920 - 12, `Right entrance x=${xR} clipped`);
  }

  // 27. Jerry removed & Mohanlal 3D restored as default (plus legacy "jerry" config migration)
  assert.strictEqual(fs.existsSync(path.join(__dirname, "..", "assets", "jerry.glb")), false);
  assert.strictEqual(clampConfig({}).glb_path, "");
  assert.strictEqual(clampConfig({ glb_path: "jerry" }).glb_path, "");
  assert.strictEqual(isMohanlalCharacter(""), true);
  assert.strictEqual(isMohanlalCharacter("mohanlal"), true);
  assert.strictEqual(getDialogPack("", "english").title, "Brio");
  assert.strictEqual(getDialogPack("", "malayalam").peek, "ഡാ മോനേ...!");

  // 28. Fullscreen vs maximized work window detection (Auto-Hide Taskbar fix)
  // Normal maximized IDE/Browser spans full 1920x1080 with isZoomed=true & quns=5 -> NOT fullscreen
  assert.strictEqual(
    classifyWindowFullscreen({
      pid: 4242,
      ownPid: 1000,
      isZoomed: true,
      quns: 5,
      width: 1920,
      height: 1080,
      left: 0,
      top: 0,
      screenWidth: 1920,
      screenHeight: 1080,
      screenLeft: 0,
      screenTop: 0,
    }),
    false
  );
  // True F11 fullscreen video (isZoomed=false, covers 1920x1080) -> fullscreen true
  assert.strictEqual(
    classifyWindowFullscreen({
      pid: 4242,
      ownPid: 1000,
      isZoomed: false,
      quns: 5,
      width: 1920,
      height: 1080,
      left: 0,
      top: 0,
      screenWidth: 1920,
      screenHeight: 1080,
      screenLeft: 0,
      screenTop: 0,
    }),
    true
  );
  // Exclusive 3D game / PowerPoint presentation (quns=3 or 4) -> fullscreen true even if zoomed
  assert.strictEqual(classifyWindowFullscreen({ pid: 4242, ownPid: 1000, isZoomed: true, quns: 3 }), true);
  assert.strictEqual(classifyWindowFullscreen({ pid: 4242, ownPid: 1000, isZoomed: true, quns: 4 }), true);

  // 29. Explicit +1 Drink vs contextual companion bubble action & 4s cooldown
  // Explicit +1 Drink ALWAYS logs water even if welcome or stretch/eye/sticky reminder was active
  assert.strictEqual(
    resolveDrinkAction({ explicitWaterLog: true, welcomeActive: true, reminderKind: "stretch" }),
    "log_water"
  );
  assert.strictEqual(
    resolveDrinkAction({ explicitWaterLog: true, reminderKind: "sticky", countdownEndsAt: 0 }),
    "log_water"
  );
  // 4-second animation cooldown still blocks rapid duplicate clicks
  assert.strictEqual(
    resolveDrinkAction({ explicitWaterLog: true, inDrinkCooldown: true }),
    "cooldown_skip"
  );
  // Companion primary bubble button stays contextual for active non-water prompts
  assert.strictEqual(
    resolveDrinkAction({ explicitWaterLog: false, reminderKind: "stretch", countdownEndsAt: 0 }),
    "start_break_countdown"
  );
  assert.strictEqual(
    resolveDrinkAction({ explicitWaterLog: false, reminderKind: "eye", countdownEndsAt: Date.now() + 5000 }),
    "complete_break"
  );
  assert.strictEqual(
    resolveDrinkAction({ explicitWaterLog: false, welcomeActive: true, reminderKind: "welcome" }),
    "welcome_fresh"
  );
  assert.strictEqual(
    resolveDrinkAction({ explicitWaterLog: false, reminderKind: "water" }),
    "log_water"
  );

  // 30. Backup recovery & legacy/reinstall data preservation across directories
  const migRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brio-mig-"));
  try {
    const oldPkgDir = path.join(migRoot, "brio", "data");
    const devDir = path.join(migRoot, "dev-data");
    const persistentDir = path.join(migRoot, "BrioData");
    const todayIsoMig = new Date().toISOString().slice(0, 10);

    const oldStore = new StateStore(oldPkgDir);
    const oldCfg = clampConfig({ user_name: "akhil", user_weight_kg: 93, ui_theme: "kochi_noir" });
    const oldState = {
      current_date: todayIsoMig,
      glasses_today: 12,
      ml_today: 3000,
      breaks_today: 10,
      history: { "2026-11-23": 19, "2026-11-24": 10 },
      ml_history: { "2026-11-24": 2500 },
      work_history: { "2026-11-24": { workSec: 3600, breakSec: 300 } },
    };
    oldStore.save(oldCfg, oldState);
    assert(fs.existsSync(path.join(oldPkgDir, "state.backup.json")), "Backup file must be created on save");

    // Verify primary corruption automatically falls back to state.backup.json
    fs.writeFileSync(path.join(oldPkgDir, "state.json"), "{corrupted-json", "utf-8");
    const recoveredFromBak = oldStore.load();
    assert.strictEqual(recoveredFromBak.config.user_name, "akhil");
    assert.strictEqual(recoveredFromBak.state.glasses_today, 12);

    const devStore = new StateStore(devDir);
    devStore.save(clampConfig({ user_name: "" }), {
      current_date: todayIsoMig,
      glasses_today: 1,
      ml_today: 250,
      breaks_today: 0,
      history: { "2026-11-20": 7 },
    });

    const migRes = migrateUserDataDir(persistentDir, [oldPkgDir, devDir]);
    assert.strictEqual(migRes.migrated, true);
    const persistentLoaded = new StateStore(persistentDir).load();
    assert.strictEqual(persistentLoaded.config.user_name, "akhil");
    assert.strictEqual(persistentLoaded.config.ui_theme, "kochi_noir");
    assert.strictEqual(persistentLoaded.state.glasses_today, 12);
    assert.strictEqual(persistentLoaded.state.history["2026-11-23"], 19);
    assert.strictEqual(persistentLoaded.state.history["2026-11-20"], 7);

    // Calling migration again does not overwrite existing persistent data
    assert.strictEqual(migrateUserDataDir(persistentDir, [devDir]).migrated, false);
  } finally {
    fs.rmSync(migRoot, { recursive: true, force: true });
  }

  // 31. Sleep / Lock-screen wake recovery behavior
  assert.strictEqual(
    evaluateWakeRecovery({ awayMs: 6 * 3600000, timerStatus: "paused", remainingSeconds: 300, intervalMinutes: 20 }),
    "keep_paused"
  );
  assert.strictEqual(
    evaluateWakeRecovery({ awayMs: 300000, timerStatus: "reminding", remainingSeconds: 0, intervalMinutes: 20 }),
    "re_present"
  );
  assert.strictEqual(
    evaluateWakeRecovery({ awayMs: 25 * 60000, timerStatus: "running", remainingSeconds: 900, intervalMinutes: 20 }),
    "prompt_soon"
  );
  assert.strictEqual(
    evaluateWakeRecovery({ awayMs: 3 * 60000, timerStatus: "running", remainingSeconds: 700, intervalMinutes: 20 }),
    "resume_tick"
  );

  // 32. Command parser DND mins/0, arithmetic whitespace, female Malayalam peek & default packs
  const dndMins = parseQuickCommand("dnd 30 mins");
  assert.strictEqual(dndMins.kind, "dnd");
  assert.strictEqual(dndMins.minutes, 30);
  const dndZero = parseQuickCommand("mute 0");
  assert.strictEqual(dndZero.kind, "dnd");
  assert.strictEqual(dndZero.minutes, 0);
  const mathNewline = parseQuickCommand("12 +\n8");
  assert.strictEqual(mathNewline.kind, "math");
  assert.strictEqual(mathNewline.value, 20);

  const femalePack2 = getDialogPack("mohanlal", "malayalam", "", "female");
  assert.strictEqual(femalePack2.peek, "മോളേ...!");
  for (const lang of ["malayalam", "english"]) {
    const defPack = getDialogPack("droppy", lang);
    assert(defPack.specialWishes && defPack.specialWishes.birthday);
    assert(defPack.eodRecapTemplate && defPack.bedtimeTemplate && defPack.workStartReply);
  }
  const enMorn = pickContextualReminderQuote(getDialogPack("mohanlal", "english"), {
    now: new Date("2026-11-26T08:00:00"),
    continuousActiveMinutes: 5,
    rng: () => 0,
  });
  assert(!enMorn.includes("{temp}"), `Morning quote must not leak {temp}: ${enMorn}`);

  console.log("All Electron helper tests passed (32/32)");
}

run();
