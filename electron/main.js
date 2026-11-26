"use strict";

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  powerMonitor,
  screen,
} = require("electron");
const { execFileSync, spawn } = require("child_process");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const {
  BREAK_DEFAULTS,
  DEFAULT_GLB_PATH,
  HydrationTimer,
  PROJECT_ROOT,
  StateStore,
  addBreak,
  addGlass,
  addWorkBreakSeconds,
  clampConfig,
  computeStreakDays,
  ensureToday,
  evaluateWorkSchedule,
  formatDurationCompact,
  isPastBedtime,
  migrateUserDataDir,
  pickRandomScreenX,
  recentDays,
  resetProgressState,
  resolveDailyHydrationGoal,
  resolveDrinkAction,
  evaluateWakeRecovery,
} = require("./store");
const { parseQuickCommand } = require("./command_parser");
const { buildStartupCommand, isStartupEnabled, setStartupEnabled } = require("./startup");
const {
  buildWelcomeGreeting,
  computeEffectiveIntervalMinutes,
  formatDisplayUsername,
  formatWeeklyReportMessage,
  getDialogPack,
  getTimeOfDayContext,
  pickContextualReminderQuote,
} = require("./dialogs");
const {
  detectSpecialOccasion,
  fetchWeatherTemperature,
  getActiveWindowContext,
  getBatteryStatus,
  getLightingPeriod,
  summarizeWeeklyStats,
} = require("./context_awareness");
const { isFullscreenAppActive } = require("./fullscreen");
const { SystemMonitor } = require("./system_monitor");
const { generateLicenseKey, getMachineHwid, verifyLicenseKey } = require("./license");
const { checkForUpdate, downloadAndLaunchUpdate } = require("./updater");

const BASE_COMP_W = 220;
const BASE_GL_H = 264;
const PILL_AREA_H = 0;
const TOP_CLIP_H = 26;
const BUBBLE_AREA_H = 194;
const REM_W = 286;
const REM_H = 148;

function getCompanionSize() {
  const s = config ? Math.max(0.5, Math.min(2.0, Number(config.character_scale) || 1.0)) : 1.0;
  const glW = Math.round(BASE_COMP_W * s);
  const glH = Math.round(BASE_GL_H * s);
  return {
    w: Math.max(372, glW),
    h: glH + TOP_CLIP_H + BUBBLE_AREA_H + PILL_AREA_H,
    glW,
    glH,
  };
}

let winRgnWorker = null;

function getHwndNumber(win) {
  if (!win || win.isDestroyed()) return 0;
  try {
    const buf = win.getNativeWindowHandle();
    return buf.length === 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
  } catch {
    return 0;
  }
}

function ensureWinRegionWorker() {
  if (process.platform !== "win32") return null;
  if (winRgnWorker && !winRgnWorker.killed) return winRgnWorker;
  try {
    const psCode = [
      'Add-Type @"',
      "using System;",
      "using System.Runtime.InteropServices;",
      "public class WinRgnClip {",
      '  [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int x1, int y1, int x2, int y2);',
      '  [DllImport("user32.dll")] public static extern int SetWindowRgn(IntPtr hWnd, IntPtr hRgn, bool bRedraw);',
      "}",
      '"@',
      "while (($line = [Console]::In.ReadLine()) -ne $null) {",
      '  $p = $line.Trim().Split(" ")',
      "  if ($p.Length -ge 4) {",
      "    $h = [IntPtr]([int64]$p[0])",
      "    $top = [int]$p[1]; $w = [int]$p[2]; $ht = [int]$p[3]",
      "    $rgn = [WinRgnClip]::CreateRectRgn(0, $top, $w, $ht)",
      "    [WinRgnClip]::SetWindowRgn($h, $rgn, $true) | Out-Null",
      "  }",
      "}",
    ].join("\n");
    winRgnWorker = spawn("powershell.exe", ["-NoProfile", "-Command", psCode], {
      windowsHide: true,
      stdio: ["pipe", "ignore", "ignore"],
    });
    winRgnWorker.on("error", () => {
      winRgnWorker = null;
    });
    winRgnWorker.on("exit", () => {
      winRgnWorker = null;
    });
  } catch {
    winRgnWorker = null;
  }
  return winRgnWorker;
}

function applyWindowTopClip(win, topClip = TOP_CLIP_H, syncFirst = false) {
  if (process.platform !== "win32" || !win || win.isDestroyed()) return;
  const hwnd = getHwndNumber(win);
  if (!hwnd) return;
  const bounds = win.getBounds();
  let sf = 1;
  try {
    const disp = screen.getDisplayMatching(bounds);
    if (disp && Number.isFinite(disp.scaleFactor) && disp.scaleFactor > 0) {
      sf = disp.scaleFactor;
    }
  } catch {
    sf = 1;
  }
  const topPx = Math.max(0, Math.round(topClip * sf));
  const widthPx = Math.max(100, Math.round((toInt(bounds.width, 372) + 32) * sf));
  const heightPx = Math.max(100, Math.round((toInt(bounds.height, 484) + 32) * sf));

  if (syncFirst) {
    try {
      const cmd = `Add-Type -MemberDefinition '[DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int a,int b,int c,int d); [DllImport("user32.dll")] public static extern int SetWindowRgn(IntPtr h,IntPtr r,bool b);' -Name R -Namespace W; [W.R]::SetWindowRgn([IntPtr]${hwnd}, [W.R]::CreateRectRgn(0, ${topPx}, ${widthPx}, ${heightPx}), $true) | Out-Null`;
      execFileSync("powershell.exe", ["-NoProfile", "-Command", cmd], {
        windowsHide: true,
        stdio: "ignore",
        timeout: 2500,
      });
    } catch {
      // Fall back to warm worker
    }
  }

  const worker = ensureWinRegionWorker();
  if (worker && worker.stdin && !worker.stdin.destroyed) {
    try {
      worker.stdin.write(`${hwnd} ${topPx} ${widthPx} ${heightPx}\n`);
    } catch {
      // ignore pipe write error
    }
  }
}

const PID_LOCK_FILE = path.join(os.tmpdir(), "brio-companion.pid");

// Prevent Chromium from falling back to CPU software WebGL (SwiftShader) on hybrid GPUs
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("ignore-gpu-blocklist");

if (!app.isPackaged) {
  app.setPath("userData", path.join(app.getPath("appData"), "brio-dev"));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log("Brio is already running — focusing existing instance.");
  app.exit(0);
} else {
  // Prevent cross-mode duplicate (e.g. packaged Brio.exe auto-starting while dev npm start is alive)
  try {
    if (fs.existsSync(PID_LOCK_FILE)) {
      const prevPid = Number(fs.readFileSync(PID_LOCK_FILE, "utf8").trim());
      if (Number.isFinite(prevPid) && prevPid > 0 && prevPid !== process.pid) {
        let alive = false;
        try {
          process.kill(prevPid, 0);
          alive = true;
        } catch {
          alive = false;
        }
        if (alive && app.isPackaged) {
          console.log("Another Brio instance is already active — exiting duplicate.");
          app.exit(0);
        }
      }
    }
    fs.writeFileSync(PID_LOCK_FILE, String(process.pid), "utf8");
  } catch {
    // Non-fatal lockfile write
  }
}

let store;
let config;
let state;
let timer;

let companionWin = null;
let reminderWin = null;
let dashboardWin = null;
let settingsWin = null;
let stickyWin = null;
let paletteWin = null;
let isQuitting = false;
let tray = null;

let availableClips = [];
let celebrateUntil = 0;
let poseUntil = 0;
let poseKind = "meesha";
let poseMessage = "";
let poseIndex = 0;
let welcomeActive = false;
let welcomeAutoDismissAt = 0;
let weatherCache = null;
let lastAppCategory = "other";
let breathingActive = false;
let activeHabitTitle = "";
let firedHabitsToday = new Set();
let firedHabitsDate = "";
let lastWorkSaveAt = 0;
let lastScheduledBreakObj = null;
let firedBreakNoticeKeys = new Set();
let firedBreakNoticeDate = "";
let autoPausedByBreak = false;
let lastBatteryCheckAt = 0;
let lastBedtimeAlertAt = 0;
let lastBatteryAlertAt = 0;
let lastBatteryAlertKind = "";
let peekUntil = 0;
let nextEntrySide = "right"; // alternates right <-> left each reminder
let activeEntrySide = "right";
let walkInTargetX = null;
let walkOutActive = false;
let walkOutDir = 1; // +1 exits right, -1 exits left
let pendingWalkOutDir = 1;
let turnHoldUntil = 0;
let pendingCelebrateDurationMs = 0;
let reactionKind = "thumbsup";
let reactionMessage = "";
let isMilestoneReaction = false;
let drinkStage = 0; // 0 = idle, 1 = sipping glass, 2 = post-drink hero reaction
let drinkStage1Until = 0;
let stage2ReactionKind = "thumbsup";
let stage2ReactionMsg = "";
let refusalStreak = 0; // 0 = clean, 1 = polite ok, 2 = doubtful ("Are you sure?"), 3 = angry ("DRINK IT!")
let reminderMood = "normal"; // normal | doubt | angry | tired
let reminderKind = "water"; // water | eye | stretch | stand | pomodoro | system | habit | sticky
let countdownEndsAt = 0;
let eyeNextAt = Date.now() + 20 * 60000;
let stretchNextAt = Date.now() + 45 * 60000;
let standNextAt = Date.now() + 90 * 60000;
let visitQueue = [];
let lastVisitEndedAt = 0;
let focusPeekPending = null;
let focusPeekDeferCount = 0;
let pomodoroPhase = "work"; // work | break
let pomodoroEndsAt = 0;
let sysMonitor = null;
let lastSysSampleAt = 0;
let otaStatus = {
  checked: false,
  updateAvailable: false,
  currentVersion: "1.0.0",
  latestVersion: "1.0.0",
  downloadUrl: "",
  releaseNotes: "",
};
let reminderQuote = "Take a sip!";
let reminderShownAt = 0;
let reminderActiveWaitMs = 0;
let lastLoopTickAt = Date.now();
let lastCursorPoint = null;
let lastCursorMovedAt = Date.now();
let reNudged = false;
let lookX = 0;
let lookY = 0;
let activeGlbOverride = "";
let fullscreenCheckPending = false;
let fullscreenCheckStartedAt = 0;
let fullscreenDeferred = false;
let systemSuspended = false;
let screenLocked = false;
let awayStartedAt = 0;
let lastUnlockedAt = Date.now();
let wakeRecoveryTimer = null;
let lastLockPollAt = 0;

function getEffectiveIdleSeconds(now = Date.now()) {
  try {
    const cur = screen.getCursorScreenPoint();
    if (
      !lastCursorPoint ||
      Math.abs(cur.x - lastCursorPoint.x) >= 2 ||
      Math.abs(cur.y - lastCursorPoint.y) >= 2
    ) {
      lastCursorPoint = { x: cur.x, y: cur.y };
      lastCursorMovedAt = now;
    }
  } catch {
    // ignore cursor query errors
  }
  const cursorIdleSec = Math.max(0, (now - lastCursorMovedAt) / 1000);
  let osIdleSec = cursorIdleSec;
  try {
    const raw = Number(powerMonitor.getSystemIdleTime());
    if (Number.isFinite(raw) && raw >= 0) {
      osIdleSec = raw;
    }
  } catch {
    // fallback to cursorIdleSec
  }
  return Math.min(osIdleSec, cursorIdleSec);
}

// Walking state
let posX = 0;
let posY = 0;
let walkDir = 1; // +1 right, -1 left
let motionMode = "walk"; // walk | idle
let phaseEndsAt = Date.now() + 8000;
let lastWalkTick = Date.now();
let isDragging = false;
let dragOffset = { x: 0, y: 0 };
let posVy = 0;
let isAirborne = false;
let jumpCelebrationUntil = 0;
let autoHideTaskbarShown = false;
let taskbarRevealUntil = 0;
let lastTaskbarGroundY = null;

function toInt(val, fallback = 0) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  const r = Math.round(n);
  return r === 0 ? 0 : r;
}

let lastAppliedCompX = null;
let lastAppliedCompY = null;
let walkOutStartedAt = 0;
let lastTickBroadcastKey = "";

function safeSetPosition(win, x, y) {
  if (!win || win.isDestroyed()) return;
  const ix = toInt(x);
  const iy = toInt(y);
  if (win === companionWin) {
    if (ix === lastAppliedCompX && iy === lastAppliedCompY) return;
    lastAppliedCompX = ix;
    lastAppliedCompY = iy;
  }
  win.setPosition(ix, iy);
}

function safeSetBounds(win, bounds) {
  if (!win || win.isDestroyed()) return;
  const ix = toInt(bounds.x);
  const iy = toInt(bounds.y);
  if (win === companionWin) {
    lastAppliedCompX = ix;
    lastAppliedCompY = iy;
  }
  win.setBounds({
    x: ix,
    y: iy,
    width: Math.max(1, toInt(bounds.width, 100)),
    height: Math.max(1, toInt(bounds.height, 100)),
  });
  if (win === companionWin) {
    applyWindowTopClip(companionWin, TOP_CLIP_H, false);
  }
}

function getWorkArea() {
  return screen.getPrimaryDisplay().workArea;
}

function getTaskbarFloorBottom() {
  const disp = screen.getPrimaryDisplay();
  const bounds = disp.bounds;
  const wa = disp.workArea;
  // Standard docked taskbar: workArea ends cleanly above display bottom
  if (wa.y + wa.height < bounds.y + bounds.height - 4) {
    return wa.y + wa.height;
  }
  // Auto-hide taskbar: hidden sits at display bottom, revealed hops up ~48px
  return autoHideTaskbarShown ? bounds.y + bounds.height - 48 : bounds.y + bounds.height;
}

function getGroundY(compH) {
  return toInt(getTaskbarFloorBottom() - compH + 4);
}

function updateTaskbarAutoHideState(now = Date.now()) {
  try {
    const disp = screen.getPrimaryDisplay();
    const bounds = disp.bounds;
    const wa = disp.workArea;
    if (wa.y + wa.height < bounds.y + bounds.height - 4) {
      autoHideTaskbarShown = false;
      return;
    }
    const cur = screen.getCursorScreenPoint();
    const bottomY = bounds.y + bounds.height;
    if (cur.y >= bottomY - 10) {
      autoHideTaskbarShown = true;
      taskbarRevealUntil = now + 1000;
    } else if (autoHideTaskbarShown && cur.y >= bottomY - 56) {
      taskbarRevealUntil = now + 1000;
    } else if (autoHideTaskbarShown && now >= taskbarRevealUntil) {
      autoHideTaskbarShown = false;
    }
  } catch {
    // ignore cursor read failure
  }
}

function clampWindowPos(x, y, w, h) {
  const size = w && h ? { w, h } : getCompanionSize();
  const wa = getWorkArea();
  const minX = wa.x + 8;
  const maxX = Math.max(minX, wa.x + wa.width - size.w - 8);
  const groundY = getGroundY(size.h);
  const nx = Number.isFinite(Number(x)) ? Number(x) : maxX - 16;
  const ny = Number.isFinite(Number(y)) ? Number(y) : groundY;
  return {
    x: toInt(Math.max(minX, Math.min(nx, maxX))),
    y: toInt(Math.max(wa.y - TOP_CLIP_H, Math.min(ny, groundY))),
  };
}

function getAssetPath(...parts) {
  return app.isPackaged
    ? path.join(process.resourcesPath, "assets", ...parts)
    : path.join(PROJECT_ROOT, "assets", ...parts);
}

function getDataDir() {
  // Dedicated folder outside Electron's userData (%APPDATA%\brio) so NSIS reinstall/uninstall never touches user data
  return path.join(app.getPath("appData"), "BrioData");
}

function getActiveGlbKey() {
  return activeGlbOverride || config.glb_path || "";
}

function resolveGlbPath(overrideKey) {
  const key = overrideKey !== undefined ? overrideKey : getActiveGlbKey();
  if (key === "droppy") {
    const droppy = getAssetPath("water_buddy.glb");
    if (fs.existsSync(droppy)) return droppy;
  }
  if (key && key !== "mohanlal" && fs.existsSync(key)) {
    return key;
  }
  const mohanlal = getAssetPath("mohanlal.glb");
  if (fs.existsSync(mohanlal)) return mohanlal;
  const bundled = getAssetPath("water_buddy.glb");
  return fs.existsSync(bundled) ? bundled : DEFAULT_GLB_PATH;
}

function findRosterItem(key) {
  const target = String(key || "").trim().toLowerCase();
  if (!target || !Array.isArray(config.roster)) return null;
  return config.roster.find((item) => String(item.glb_path || "").trim().toLowerCase() === target) || null;
}

function getCurrentPack() {
  const key = getActiveGlbKey();
  return getDialogPack(key, config.language, resolveGlbPath(key), config.user_gender);
}

function isDndActive() {
  return Boolean(config && config.dnd_until && Date.now() < config.dnd_until);
}

function pickRandomCharacterForReminder() {
  if (!config.random_character) {
    activeGlbOverride = "";
    return;
  }
  const pool = ["mohanlal", "droppy"];
  for (const item of config.roster || []) {
    if (item && item.glb_path && fs.existsSync(item.glb_path)) {
      pool.push(item.glb_path);
    }
  }
  const unique = [...new Set(pool)];
  if (unique.length === 0) {
    activeGlbOverride = "";
    return;
  }
  activeGlbOverride = unique[Math.floor(Math.random() * unique.length)];
}

function getEffectiveAnimationState() {
  const now = Date.now();
  if (walkOutActive) {
    return {
      animKind: "walk",
      facingAngle: walkOutDir * Math.PI * 0.42,
      message: "",
      peekLean: 0,
    };
  }
  if (now < peekUntil) {
    const leanDir = activeEntrySide === "left" ? -1 : 1;
    return {
      animKind: "peek",
      facingAngle: activeEntrySide === "left" ? 0.24 : -0.24,
      message: "",
      peekLean: leanDir * 0.11,
    };
  }
  if (walkInTargetX !== null) {
    const enterDir = activeEntrySide === "left" ? 1 : -1;
    return {
      animKind: "walk",
      facingAngle: enterDir * Math.PI * 0.42,
      message: "",
      peekLean: 0,
    };
  }
  if (now < celebrateUntil) {
    return {
      animKind: reactionKind,
      facingAngle: 0,
      message: reactionMessage,
      peekLean: 0,
    };
  }
  if (now < jumpCelebrationUntil && walkInTargetX === null) {
    return {
      animKind: "happy",
      facingAngle: 0,
      message: now < poseUntil ? poseMessage : "",
      peekLean: 0,
    };
  }
  if (now < poseUntil) {
    return {
      animKind: poseKind,
      facingAngle: 0,
      message: poseMessage,
      peekLean: 0,
    };
  }
  if (welcomeActive) {
    return {
      animKind: "remind",
      facingAngle: 0,
      message: "",
      peekLean: 0,
    };
  }
  if (timer.status === "reminding") {
    let kind = "remind";
    if (reminderMood === "angry") kind = "angry";
    else if (reminderMood === "doubt") kind = "doubt";
    else if (reminderMood === "tired") kind = "tired";
    else if (
      reminderKind === "stretch" ||
      reminderKind === "stand" ||
      (countdownEndsAt > now && (reminderKind === "stretch" || reminderKind === "stand" || reminderKind === "system"))
    ) {
      kind = "stretch";
    }
    return {
      animKind: kind,
      facingAngle: 0,
      message: "",
      peekLean: 0,
    };
  }
  const hasModalOpen =
    (dashboardWin && !dashboardWin.isDestroyed()) ||
    (settingsWin && !settingsWin.isDestroyed());
  if (
    !config.walk_enabled ||
    isDragging ||
    hasModalOpen ||
    timer.status === "paused" ||
    motionMode === "idle"
  ) {
    return {
      animKind: "idle",
      facingAngle: 0,
      message: "",
      peekLean: 0,
    };
  }
  return {
    animKind: "walk",
    facingAngle: walkDir * Math.PI * 0.42,
    message: "",
    peekLean: 0,
  };
}

function buildPayload() {
  const { animKind, facingAngle, message, peekLean } = getEffectiveAnimationState();
  const glbKey = getActiveGlbKey();
  const glbPath = resolveGlbPath(glbKey);
  const pack = getCurrentPack();
  const dndActive = isDndActive();
  const dndMinutesLeft = dndActive
    ? Math.max(1, Math.ceil((config.dnd_until - Date.now()) / 60000))
    : 0;
  const now = Date.now();
  const curDate = new Date(now);
  const countdownSec =
    countdownEndsAt > now ? Math.max(1, Math.ceil((countdownEndsAt - now) / 1000)) : 0;
  const pomoRemSec =
    config.pomodoro_enabled && pomodoroEndsAt > now
      ? Math.max(0, Math.ceil((pomodoroEndsAt - now) / 1000))
      : 0;
  const hydGoal = resolveDailyHydrationGoal(config);
  const recent7 = recentDays(state, 7, curDate, config.glass_ml);
  const weeklySummary = summarizeWeeklyStats(recent7, hydGoal.goalGlasses, config.glass_ml, hydGoal.goalMl);
  const streakDays = computeStreakDays(state, hydGoal.goalGlasses, curDate, hydGoal.goalMl);
  const todCtx = getTimeOfDayContext(curDate);
  const mlToday = Math.max(0, Math.round(Number(state.ml_today) || 0));
  const showSunglasses = Boolean(
    config.always_sunglasses || mlToday >= hydGoal.goalMl
  );
  const showChayaCup = Boolean(
    todCtx === "chaya_break" &&
    animKind !== "celebrate" &&
    ["remind", "idle", "meesha", "peek"].includes(animKind)
  );
  let breathingInfo = null;
  if (breathingActive && countdownSec > 0) {
    const cycleSec = (60 - Math.min(60, countdownSec)) % 16;
    const phase =
      cycleSec < 4 ? "inhale" : cycleSec < 8 ? "hold1" : cycleSec < 12 ? "exhale" : "hold2";
    const phaseLabel =
      phase === "inhale" ? "Inhale..." : phase === "exhale" ? "Exhale..." : "Hold...";
    breathingInfo = {
      active: true,
      phase,
      phaseLabel,
      phaseSecLeft: 4 - (cycleSec % 4),
    };
  }
  return {
    config: {
      ...config,
      start_on_boot: isStartupEnabled() || config.start_on_boot,
    },
    state: {
      ...state,
      streakDays,
      mlToday,
      litersToday: Number((mlToday / 1000).toFixed(2)),
      goalMl: hydGoal.goalMl,
      goalLiters: hydGoal.goalLiters,
      goalGlasses: hydGoal.goalGlasses,
      isAutoGoal: hydGoal.isAuto,
      pctToday: Math.min(100, Math.round((mlToday / Math.max(1, hydGoal.goalMl)) * 100)),
      workTimeFormatted: formatDurationCompact(state.work_seconds_today || 0),
      breakTimeFormatted: formatDurationCompact(state.break_seconds_today || 0),
      recent_days: recent7,
      weeklySummary,
    },
    workSchedule: (() => {
      const sched = evaluateWorkSchedule(config, state.work_session_mode || "off", curDate);
      const idleSecNow = getEffectiveIdleSeconds(now);
      const pSec = Math.max(15, Number(config.idle_pause_seconds) || 60);
      return {
        ...sched,
        sessionMode: state.work_session_mode || "off",
        activityPaused:
          state.work_session_mode === "working" &&
          Boolean(config.smart_idle_enabled) &&
          idleSecNow >= pSec,
      };
    })(),
    weather: weatherCache,
    timer: {
      status: timer.status,
      remainingSeconds: Math.round(timer.remainingSeconds),
      formatted: timer.formatRemaining(),
      idleState: timer.idleState || "active",
      idleSeconds: Math.round(timer.idleSeconds || 0),
      dndActive,
      dndMinutesLeft,
      fullscreenDeferred,
    },
    system: sysMonitor
      ? sysMonitor.getStats()
      : { cpuPercent: 0, ramPercent: 0, continuousActiveMinutes: 0, continuousActiveSeconds: 0 },
    pomodoro: {
      enabled: Boolean(config.pomodoro_enabled),
      phase: pomodoroPhase,
      remainingSeconds: pomoRemSec,
    },
    license: verifyLicenseKey(config.license_key),
    breakDefaults: BREAK_DEFAULTS,
    appLogoUrl: pathToFileURL(getAssetPath("tray_icon.png")).href,
    ota: otaStatus,
    glb: {
      key: glbKey || "mohanlal",
      path: glbPath,
      url: pathToFileURL(glbPath).href,
      isCustom: Boolean(glbKey && !["droppy", "mohanlal"].includes(glbKey) && fs.existsSync(glbKey)),
      availableClips,
    },
    motion: {
      animKind,
      facingAngle,
      walkDir,
      isDragging,
      message,
      isMilestone: isMilestoneReaction,
      peekLean,
      lookX,
      lookY,
      reminderMood,
      reminderKind,
      queuedMoreCount: visitQueue.length,
      countdownSec,
      refusalStreak,
      reminderTitle:
        reminderMood === "angry"
          ? pack.refuse3Title
          : reminderMood === "doubt"
            ? pack.refuse2Title
            : pack.title,
      laterButtonLabel:
        reminderMood === "angry"
          ? pack.laterAngryLabel
          : reminderMood === "doubt"
            ? pack.laterDoubtLabel
            : pack.laterLabel,
      reminderQuote,
      eyeBreakTip: config.eye_break_enabled ? pack.eyeBreak : "",
      peekText: pack.peek,
      isFocusPeek: Boolean(focusPeekPending),
      focusPeekText: focusPeekPending
        ? ["eye", "stretch", "stand"].includes(focusPeekPending.kind)
          ? pack.focusPeekBreak || "Quick break? 👀"
          : pack.focusPeekWater || "Busy? 💧"
        : "",
      replyLines: pack.replyLines || {},
      hoverLines: pack.hovers,
      pillNormal: pack.pillNormal,
      pillDue: pack.pillDue,
      pillDoubt: pack.pillDoubt,
      pillAngry: pack.pillAngry,
      pillPaused: pack.pillPaused,
      pillDnd: pack.pillDnd,
      isReNudge: reNudged,
      showSunglasses,
      showChayaCup,
      lightingPeriod: getLightingPeriod(curDate),
      breathing: breathingInfo,
      weatherTempC: weatherCache ? weatherCache.tempC : null,
      showBubble: Boolean(
        focusPeekPending ||
        (reminderBubbleVisible &&
          (timer.status === "reminding" || welcomeActive) &&
          Date.now() >= peekUntil &&
          walkInTargetX === null) ||
        message
      ),
    },
  };
}

function broadcastState() {
  const payload = buildPayload();
  for (const win of [companionWin, reminderWin, dashboardWin, settingsWin, stickyWin, paletteWin]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send("wb:state", payload);
    }
  }
  updateTrayTooltip();
}

function updateTrayTooltip() {
  if (!tray) return;
  const rem = isDndActive()
    ? `DND (${Math.max(1, Math.ceil((config.dnd_until - Date.now()) / 60000))}m)`
    : timer.status === "paused"
      ? "Paused"
      : timer.idleState === "reset"
        ? `On Break (Reset ${timer.formatRemaining()})`
        : timer.idleState === "paused"
          ? `Idle Paused (${timer.formatRemaining()})`
          : timer.formatRemaining();
  const hydGoal = resolveDailyHydrationGoal(config);
  const mlToday = Math.max(0, Math.round(Number(state.ml_today) || 0));
  tray.setToolTip(
    `Brio • ${rem} • ${(mlToday / 1000).toFixed(2)} / ${hydGoal.goalLiters.toFixed(2)} L`
  );
}

let reminderBubbleVisible = false;

function createCompanionWindow() {
  ensureWinRegionWorker();
  const { w: compW, h: compH } = getCompanionSize();
  const wa = getWorkArea();
  const defaultX = wa.x + wa.width - compW - 20;
  const defaultY = getGroundY(compH);
  // Always anchor initial vertical position cleanly on the taskbar/floor
  const startY =
    config.window_y !== null && config.window_y <= defaultY + 8
      ? config.window_y
      : defaultY;
  const startPos = clampWindowPos(
    config.window_x !== null ? config.window_x : defaultX,
    startY,
    compW,
    compH
  );
  posX = startPos.x;
  posY = startPos.y;

  companionWin = new BrowserWindow({
    width: compW,
    height: compH,
    x: posX,
    y: posY,
    show: false,
    transparent: true,
    frame: false,
    thickFrame: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // Immediately clip off top 26px (classic 22px caption region) before showing window
  applyWindowTopClip(companionWin, TOP_CLIP_H, true);
  companionWin.on("page-title-updated", (e) => e.preventDefault());
  companionWin.on("show", () => applyWindowTopClip(companionWin, TOP_CLIP_H, false));
  companionWin.on("resize", () => applyWindowTopClip(companionWin, TOP_CLIP_H, false));
  companionWin.setAlwaysOnTop(true, "screen-saver");
  companionWin.loadFile(path.join(__dirname, "companion.html"));
  companionWin.webContents.on("did-finish-load", () => {
    applyWindowTopClip(companionWin, TOP_CLIP_H, false);
    applyGhostMode();
    broadcastState();
  });

  applyGhostMode();
  applyVisibilityMode();
}

function applyGhostMode(forceIgnore = null) {
  if (!companionWin || companionWin.isDestroyed()) return;
  if (!config || !config.ghost_mode_enabled) {
    companionWin.setIgnoreMouseEvents(false);
    return;
  }
  const shouldIgnore = forceIgnore === null ? true : Boolean(forceIgnore);
  companionWin.setIgnoreMouseEvents(shouldIgnore, { forward: true });
}

function applyCompanionScaleBounds(prevH) {
  if (!companionWin || companionWin.isDestroyed()) return;
  const { w: compW, h: compH } = getCompanionSize();
  const bottomY = posY + (prevH || compH);
  const clamped = clampWindowPos(posX, bottomY - compH, compW, compH);
  posX = clamped.x;
  posY = clamped.y;

  safeSetBounds(companionWin, {
    x: posX,
    y: posY,
    width: toInt(compW, 372),
    height: toInt(compH, BASE_GL_H + TOP_CLIP_H + BUBBLE_AREA_H),
  });
}

function applyVisibilityMode() {
  if (!companionWin || companionWin.isDestroyed()) return;
  const shouldShow =
    !config.popup_only_mode ||
    timer.status === "reminding" ||
    welcomeActive ||
    Boolean(focusPeekPending) ||
    walkInTargetX !== null ||
    pendingCelebrateDurationMs > 0 ||
    Date.now() < celebrateUntil ||
    Date.now() < poseUntil ||
    Date.now() < peekUntil ||
    walkOutActive;
  if (!shouldShow) {
    walkInTargetX = null;
    if (companionWin.isVisible()) {
      companionWin.hide();
    }
  } else if (!companionWin.isVisible()) {
    applyWindowTopClip(companionWin, TOP_CLIP_H, false);
    companionWin.showInactive();
    companionWin.setAlwaysOnTop(true, "screen-saver");
    if (typeof companionWin.moveTop === "function") companionWin.moveTop();
  } else if (timer.status === "reminding" || welcomeActive || Date.now() < celebrateUntil) {
    companionWin.setAlwaysOnTop(true, "screen-saver");
    if (typeof companionWin.moveTop === "function") companionWin.moveTop();
  }
}

function positionPopoverNearCompanion(win, width, height) {
  const { w: compW, h: compH } = getCompanionSize();
  const wa = getWorkArea();
  const anchorX = walkInTargetX !== null ? walkInTargetX : posX;
  const preferLeft = anchorX + compW / 2 > wa.x + wa.width / 2;
  let x = preferLeft ? anchorX - width - 8 : anchorX + compW + 8;
  let y = posY + compH - height - 10;
  x = Math.max(wa.x + 12, Math.min(x, wa.x + wa.width - width - 12));
  y = Math.max(wa.y + 12, Math.min(y, wa.y + wa.height - height - 12));
  safeSetBounds(win, { x, y, width, height });
}

function positionPopoverAboveCompanion(win, width, height) {
  positionPopoverNearCompanion(win, width, height);
}

function showReminderWindow() {
  reminderBubbleVisible = true;
  if (reminderWin && !reminderWin.isDestroyed()) {
    reminderWin.destroy();
    reminderWin = null;
  }
  broadcastState();
}

function closeReminderWindow() {
  reminderBubbleVisible = false;
  if (reminderWin && !reminderWin.isDestroyed()) {
    reminderWin.destroy();
  }
  reminderWin = null;
  broadcastState();
}

function toggleDashboardWindow() {
  if (dashboardWin && !dashboardWin.isDestroyed()) {
    dashboardWin.destroy();
    dashboardWin = null;
    broadcastState();
    return;
  }
  closeDashboardWindow();
  dashboardWin = new BrowserWindow({
    width: 296,
    height: 356,
    title: "",
    transparent: true,
    frame: false,
    thickFrame: false,
    hasShadow: false,
    roundedCorners: false,
    backgroundMaterial: "none",
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  dashboardWin.setMenuBarVisibility(false);
  dashboardWin.on("page-title-updated", (e) => e.preventDefault());
  positionPopoverNearCompanion(dashboardWin, 296, 356);
  dashboardWin.setAlwaysOnTop(true, "screen-saver");
  dashboardWin.loadFile(path.join(__dirname, "dashboard.html"));
  dashboardWin.webContents.on("did-finish-load", () => {
    if (dashboardWin && !dashboardWin.isDestroyed()) {
      dashboardWin.setTitle("");
    }
    broadcastState();
  });
  dashboardWin.on("closed", () => {
    dashboardWin = null;
    broadcastState();
  });
  broadcastState();
}

function closeDashboardWindow() {
  if (dashboardWin && !dashboardWin.isDestroyed()) {
    dashboardWin.destroy();
  }
  dashboardWin = null;
}

function getThemeWindowChrome(themeKey) {
  switch (themeKey) {
    case "nordic_mist":
      return { bg: "#EEF3F9", overlay: "#EEF3F9", sym: "#0F172A" };
    case "kochi_noir":
      return { bg: "#100C09", overlay: "#100C09", sym: "#FEF3C7" };
    case "cyber_mint":
      return { bg: "#070A18", overlay: "#070A18", sym: "#F1F5F9" };
    default:
      return { bg: "#070B14", overlay: "#070B14", sym: "#F8FAFC" };
  }
}

function openSettingsWindow() {
  closeDashboardWindow();
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  const iconPath = getAssetPath("tray_icon.png");
  const chrome = getThemeWindowChrome(config && config.ui_theme);
  settingsWin = new BrowserWindow({
    width: 820,
    height: 620,
    minWidth: 700,
    minHeight: 500,
    title: "Brio — Settings",
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: chrome.bg,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: chrome.overlay,
      symbolColor: chrome.sym,
      height: 34,
    },
    resizable: true,
    alwaysOnTop: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  settingsWin.loadFile(path.join(__dirname, "settings.html"));
  settingsWin.webContents.on("did-finish-load", broadcastState);
  settingsWin.on("closed", () => {
    settingsWin = null;
    broadcastState();
  });
  broadcastState();
}

function openStickyWindow() {
  if (stickyWin && !stickyWin.isDestroyed()) {
    if (stickyWin.isMinimized()) stickyWin.restore();
    stickyWin.show();
    stickyWin.focus();
    return;
  }
  const wa = getWorkArea();
  const stW = 316;
  const stH = 380;
  const defX = wa.x + wa.width - stW - 28;
  const defY = wa.y + 42;
  const startX =
    config.sticky_x !== null && Number.isFinite(Number(config.sticky_x))
      ? Math.max(wa.x, Math.min(Number(config.sticky_x), wa.x + wa.width - 140))
      : defX;
  const startY =
    config.sticky_y !== null && Number.isFinite(Number(config.sticky_y))
      ? Math.max(wa.y, Math.min(Number(config.sticky_y), wa.y + wa.height - 140))
      : defY;

  stickyWin = new BrowserWindow({
    width: stW,
    height: stH,
    minWidth: 270,
    minHeight: 240,
    x: toInt(startX),
    y: toInt(startY),
    title: "Brio — Sticky Notes",
    transparent: true,
    frame: false,
    thickFrame: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: config.sticky_always_on_top !== false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  stickyWin.setMenuBarVisibility(false);
  if (config.sticky_always_on_top !== false) {
    stickyWin.setAlwaysOnTop(true, "screen-saver");
  }
  stickyWin.loadFile(path.join(__dirname, "sticky.html"));
  stickyWin.webContents.on("did-finish-load", broadcastState);
  stickyWin.on("moved", () => {
    if (!stickyWin || stickyWin.isDestroyed()) return;
    const b = stickyWin.getBounds();
    config = store.save({ ...config, sticky_x: toInt(b.x), sticky_y: toInt(b.y) }, state);
  });
  stickyWin.on("closed", () => {
    stickyWin = null;
    if (!isQuitting && config.sticky_open) {
      config = store.save({ ...config, sticky_open: false }, state);
    }
    broadcastState();
  });
  if (!config.sticky_open) {
    config = store.save({ ...config, sticky_open: true }, state);
  }
  broadcastState();
}

function closeStickyWindow() {
  config = store.save({ ...config, sticky_open: false }, state);
  if (stickyWin && !stickyWin.isDestroyed()) {
    stickyWin.close();
  } else {
    stickyWin = null;
    broadcastState();
  }
}

function toggleStickyWindow() {
  if (stickyWin && !stickyWin.isDestroyed() && stickyWin.isVisible()) {
    closeStickyWindow();
  } else {
    openStickyWindow();
  }
}

function closePaletteWindow() {
  if (paletteWin && !paletteWin.isDestroyed()) {
    paletteWin.hide();
  }
}

function openPaletteWindow() {
  const wa = getWorkArea();
  const pw = 540;
  const ph = 328;
  const px = toInt(wa.x + Math.round((wa.width - pw) / 2));
  const py = toInt(wa.y + Math.round(wa.height * 0.18));

  if (paletteWin && !paletteWin.isDestroyed()) {
    paletteWin.setBounds({ x: px, y: py, width: pw, height: ph });
    paletteWin.show();
    paletteWin.focus();
    broadcastState();
    return;
  }

  paletteWin = new BrowserWindow({
    width: pw,
    height: ph,
    x: px,
    y: py,
    title: "Brio — Quick Command",
    transparent: true,
    frame: false,
    thickFrame: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  paletteWin.setMenuBarVisibility(false);
  paletteWin.setAlwaysOnTop(true, "screen-saver");
  paletteWin.loadFile(path.join(__dirname, "palette.html"));
  paletteWin.webContents.on("did-finish-load", broadcastState);
  paletteWin.on("blur", () => {
    closePaletteWindow();
  });
  paletteWin.on("closed", () => {
    paletteWin = null;
  });
}

function togglePaletteWindow() {
  if (paletteWin && !paletteWin.isDestroyed() && paletteWin.isVisible()) {
    closePaletteWindow();
  } else {
    openPaletteWindow();
  }
}

function createTray() {
  const iconPath = getAssetPath(
    process.platform === "win32" ? "app_icon.ico" : "tray_icon.png"
  );
  let img = nativeImage.createEmpty();
  if (fs.existsSync(iconPath)) {
    img = nativeImage.createFromPath(iconPath);
    if (process.platform !== "win32") {
      img = img.resize({ width: 16, height: 16 });
    }
  }
  tray = new Tray(img);
  tray.on("click", () => {
    if (config.popup_only_mode) {
      openSettingsWindow();
    } else {
      toggleDashboardWindow();
    }
  });
  tray.on("right-click", () => {
    tray.popUpContextMenu(buildMenu());
  });
  updateTrayTooltip();
}

function buildMenu() {
  const dndOn = isDndActive();
  const curMl = config ? config.glass_ml : 250;
  return Menu.buildFromTemplate([
    {
      label: `💧 Drank Water (${curMl}ml)`,
      click: () => handleDrink(),
    },
    {
      label: "💧 Quick Sip Size",
      submenu: [
        {
          label: `☕ 150ml Chaya Glass${curMl === 150 ? " ✓" : ""}`,
          click: () => handleDrink(150),
        },
        {
          label: `💧 250ml Standard Glass${curMl === 250 ? " ✓" : ""}`,
          click: () => handleDrink(250),
        },
        {
          label: `🍶 500ml Water Bottle${curMl === 500 ? " ✓" : ""}`,
          click: () => handleDrink(500),
        },
      ],
    },
    {
      label: "😎 Signature Pose (Meesha Twist)",
      click: () => handleTriggerPose(),
    },
    {
      label: "🌊 1-Min Calm Breathing",
      click: () => handleStartBreathing(),
    },
    {
      label: "💼 Work & Break Session",
      submenu: [
        {
          label: `▶ Start Work (${formatDurationCompact(state.work_seconds_today || 0)})${state.work_session_mode === "working" ? " ✓" : ""}`,
          click: () => handleSetWorkSession("working"),
        },
        {
          label: `☕ Take Break (${formatDurationCompact(state.break_seconds_today || 0)})${state.work_session_mode === "break" ? " ✓" : ""}`,
          click: () => handleSetWorkSession("break"),
        },
        {
          label: `⏹ End Work / Off${state.work_session_mode === "off" ? " ✓" : ""}`,
          click: () => handleSetWorkSession("off"),
        },
      ],
    },
    {
      label: "⚡ Quick Command Bar (Ctrl+Shift+Space)",
      click: () => togglePaletteWindow(),
    },
    {
      label: "📌 Sticky Notes Board (Ctrl+Shift+N)",
      click: () => toggleStickyWindow(),
    },
    {
      label: "👀 20-20-20 Eye Break (20s Timer)",
      click: () => handleTriggerReminder("eye"),
    },
    {
      label: "🏃 Posture & Desk Stretch",
      click: () => handleTriggerReminder("stretch"),
    },
    {
      label: config.pomodoro_enabled
        ? `🍅 Stop Pomodoro (${pomodoroPhase.toUpperCase()})`
        : `🍅 Start Pomodoro (${config.pomodoro_work_minutes}m / ${config.pomodoro_break_minutes}m)`,
      click: () => handleTogglePomodoro(),
    },
    {
      label: `⏳ Defer / Later (${config.snooze_minutes} min)`,
      click: () => handleSnooze(),
    },
    {
      label: timer.status === "paused" ? "▶ Resume Timer" : "⏸ Pause Timer",
      click: () => handleTogglePause(),
    },
    {
      label: dndOn ? "☀ End Do Not Disturb" : "🌙 Do Not Disturb (1 Hour)",
      click: () => handleSetDnd(dndOn ? 0 : 60),
    },
    {
      label: "🔔 Test Water Reminder",
      click: () => handleTriggerReminder("water"),
    },
    { type: "separator" },
    {
      label: "🎭 Add / Load Custom .glb Character...",
      click: async () => {
        const picked = await pickGlbFile();
        if (picked) {
          addOrSelectRosterCharacter(picked);
        }
      },
    },
    {
      label: "⚙ Settings & Character Roster",
      click: () => openSettingsWindow(),
    },
    { type: "separator" },
    {
      label: "✕ Quit Brio",
      click: () => quitApp(),
    },
  ]);
}

function addOrSelectRosterCharacter(pickedPath) {
  const baseName = path.basename(pickedPath, path.extname(pickedPath)) || "Custom 3D";
  const exists = (config.roster || []).find(
    (r) => String(r.glb_path || "").toLowerCase() === pickedPath.toLowerCase()
  );
  const nextRoster = exists
    ? config.roster
    : [
      ...(config.roster || []),
      {
        id: "char_" + Date.now().toString(36),
        name: baseName.replace(/[_-]+/g, " "),
        glb_path: pickedPath,
      },
    ];
  activeGlbOverride = "";
  config = store.save({ ...config, glb_path: pickedPath, roster: nextRoster }, state);
  broadcastState();
}

function getEffectiveUsername() {
  if (config && typeof config.user_name === "string" && config.user_name.trim()) {
    return formatDisplayUsername(config.user_name);
  }
  try {
    const u = os.userInfo();
    if (u && u.username) return formatDisplayUsername(u.username);
  } catch {
    // fallback to env
  }
  return formatDisplayUsername(process.env.USERNAME || process.env.USER || "Friend");
}

function startCompanionEntrance({ withPeek = false, peekMs = 900 } = {}) {
  const { w: compW, h: compH } = getCompanionSize();
  const wa = getWorkArea();
  activeEntrySide = nextEntrySide;
  nextEntrySide = nextEntrySide === "right" ? "left" : "right";
  const targetX = pickRandomScreenX({
    waX: wa.x,
    waWidth: wa.width,
    compW,
    margin: 12,
    preferredSide: activeEntrySide,
  });
  pendingWalkOutDir = targetX + compW / 2 < wa.x + wa.width / 2 ? -1 : 1;
  posY = getGroundY(compH);
  posVy = 0;
  isAirborne = false;

  if (config.walk_enabled) {
    walkOutActive = false;
    walkInTargetX = targetX;
    if (withPeek) {
      // Keep the entire character + dialog bubble 100% inside the screen edge when peeking
      posX =
        activeEntrySide === "left"
          ? wa.x + 12
          : Math.max(wa.x + 12, wa.x + wa.width - compW - 12);
      peekUntil = Date.now() + Math.max(400, Number(peekMs) || 900);
      turnHoldUntil = 0;
    } else {
      posX = activeEntrySide === "left" ? wa.x - compW - 10 : wa.x + wa.width + 10;
      peekUntil = 0;
      turnHoldUntil = Date.now() + 180;
    }
  } else {
    walkOutActive = false;
    walkInTargetX = null;
    peekUntil = 0;
    turnHoldUntil = 0;
    posX = targetX;
  }

  if (companionWin && !companionWin.isDestroyed()) {
    safeSetPosition(companionWin, posX, posY);
    companionWin.showInactive();
    companionWin.setAlwaysOnTop(true, "screen-saver");
  }
  return activeEntrySide;
}

function triggerWalkToast({ kind = "thumbsup", message = "", durationMs = 4500, milestone = false } = {}) {
  if (!message) return;
  welcomeActive = false;
  welcomeAutoDismissAt = 0;
  breathingActive = false;
  walkOutActive = false;
  drinkStage = 0;
  reactionKind = kind;
  reactionMessage = message;
  isMilestoneReaction = Boolean(milestone);

  const needsWalkIn =
    config.walk_enabled &&
    (config.popup_only_mode || !companionWin || !companionWin.isVisible());
  if (needsWalkIn) {
    celebrateUntil = 0;
    pendingCelebrateDurationMs = durationMs;
    startCompanionEntrance({ withPeek: false });
  } else {
    pendingCelebrateDurationMs = 0;
    celebrateUntil = Date.now() + durationMs;
    pendingWalkOutDir = activeEntrySide === "left" ? 1 : -1;
    if (config.popup_only_mode) {
      startCompanionEntrance({ withPeek: false });
    }
    showReminderWindow();
  }
  applyVisibilityMode();
  broadcastState();
}

function handleTriggerWelcome() {
  if (timer.status === "reminding") return;
  const pack = getCurrentPack();
  welcomeActive = true;
  welcomeAutoDismissAt = Date.now() + 9800;
  celebrateUntil = 0;
  pendingCelebrateDurationMs = 0;
  drinkStage = 0;
  drinkStage1Until = 0;
  countdownEndsAt = 0;
  reminderKind = "welcome";
  reminderMood = "normal";
  walkOutActive = false;
  reactionMessage = "";
  const occ = detectSpecialOccasion(config.birthday_mmdd, new Date());
  const todayStr = state.current_date || "";
  if (occ && pack.specialWishes && pack.specialWishes[occ] && config.last_special_wish_date !== todayStr) {
    config = store.save({ ...config, last_special_wish_date: todayStr }, state);
    isMilestoneReaction = true;
    reminderQuote = pack.specialWishes[occ].replace(/\{name\}/g, getEffectiveUsername());
  } else {
    isMilestoneReaction = false;
    reminderQuote = buildWelcomeGreeting(pack, getEffectiveUsername());
  }

  if (config.popup_only_mode && companionWin && !companionWin.isDestroyed()) {
    startCompanionEntrance({ withPeek: true });
  } else {
    peekUntil = 0;
  }
  if (peekUntil === 0 && walkInTargetX === null) {
    showReminderWindow();
  }
  broadcastState();
}

function handleCompleteWelcome(responded = true) {
  if (!welcomeActive) return;
  welcomeActive = false;
  welcomeAutoDismissAt = 0;
  walkInTargetX = null;
  peekUntil = 0;
  reminderKind = "water";
  reminderMood = "normal";
  const pack = getCurrentPack();
  if (responded) {
    reactionKind = "salute";
    reactionMessage = pack.welcomeReply || "🙌 സവാരി ഗിരി ഗിരി!";
    isMilestoneReaction = false;
    pendingWalkOutDir = activeEntrySide === "left" ? 1 : -1;
    celebrateUntil = Date.now() + 2200;
    showReminderWindow();
  } else {
    closeReminderWindow();
    if (config.popup_only_mode && config.walk_enabled) {
      walkOutDir = activeEntrySide === "left" ? -1 : 1;
      walkOutStartedAt = Date.now();
      turnHoldUntil = Date.now() + 230;
      walkOutActive = true;
    }
  }
  applyVisibilityMode();
  broadcastState();
}

function handleWelcomeMood(mood = "fresh") {
  welcomeActive = false;
  welcomeAutoDismissAt = 0;
  walkInTargetX = null;
  peekUntil = 0;
  const pack = getCurrentPack();
  if (mood === "stressed") {
    handleStartBreathing(pack.moodStressedPrompt);
    return;
  }
  if (mood === "sleepy") {
    handleTriggerReminder("stretch");
    reminderQuote = pack.moodSleepyPrompt || pack.stretchPrompt;
    broadcastState();
    return;
  }
  // Default: "fresh" -> proud Salute & celebrate
  reminderKind = "water";
  reminderMood = "normal";
  reactionKind = "salute";
  reactionMessage = pack.moodFreshReply || pack.welcomeReply;
  isMilestoneReaction = false;
  pendingWalkOutDir = activeEntrySide === "left" ? 1 : -1;
  celebrateUntil = Date.now() + 2400;
  showReminderWindow();
  applyVisibilityMode();
  broadcastState();
}

function handleTriggerHabit(title = "") {
  const habitName = String(title || activeHabitTitle || "Quick Check").trim();
  if (!habitName) return;
  if (isVisitBusy()) {
    enqueueVisitItem({ kind: "habit", habitTitle: habitName });
    return;
  }
  activeHabitTitle = habitName;
  welcomeActive = false;
  welcomeAutoDismissAt = 0;
  breathingActive = false;
  celebrateUntil = 0;
  pendingCelebrateDurationMs = 0;
  walkOutActive = false;
  const pack = getCurrentPack();
  const tpl = pack.habitReminderTemplate || "⏰ Quick reminder: {habit}!";
  reminderKind = "habit";
  reminderMood = "normal";
  reminderQuote = tpl.replace(/\{habit\}/g, habitName);
  timer.triggerNow();
  reminderShownAt = Date.now();
  reminderActiveWaitMs = 0;
  if (config.popup_only_mode || !companionWin || !companionWin.isVisible()) {
    startCompanionEntrance({ withPeek: false });
  }
  closeDashboardWindow();
  if (walkInTargetX === null) {
    showReminderWindow();
  }
  applyVisibilityMode();
  broadcastState();
}

function handleTriggerStickyAlert(noteText) {
  const cleanNote = String(noteText || "").trim();
  if (!cleanNote) return;
  openStickyWindow();
  if (isVisitBusy()) {
    enqueueVisitItem({ kind: "sticky", customQuote: cleanNote });
    return;
  }
  const pack = getCurrentPack();
  const tpl = pack.habitReminderTemplate || "⏰ Reminder: {habit}!";
  triggerWalkToast({
    kind: "angry",
    message: `📌 ${tpl.replace(/\{habit\}/g, cleanNote)}`,
    durationMs: 7000,
    milestone: false,
  });
}

function getBreakDurationSeconds(kind) {
  if (kind === "eye") return Math.max(10, Number(config.eye_break_duration_seconds) || 20);
  if (kind === "stretch") return Math.max(15, Number(config.stretch_duration_seconds) || 30);
  if (kind === "stand") return Math.max(30, Number(config.stand_break_duration_seconds) || 120);
  return 20;
}

function isVisitBusy(now = Date.now()) {
  return Boolean(
    timer.status === "reminding" ||
    welcomeActive ||
    Boolean(focusPeekPending) ||
    celebrateUntil > now ||
    pendingCelebrateDurationMs > 0 ||
    walkInTargetX !== null
  );
}

function enqueueVisitItem(item = {}) {
  const kind = item.kind || "water";
  if (timer.status === "reminding" && reminderKind === kind && kind !== "habit" && kind !== "sticky") {
    return true;
  }
  if (
    visitQueue.some(
      (q) =>
        q.kind === kind &&
        (kind !== "habit" || q.habitTitle === item.habitTitle) &&
        (kind !== "sticky" || q.customQuote === item.customQuote)
    )
  ) {
    return true;
  }
  // Larger ergonomic break subsumes smaller ones in the waiting queue
  if (kind === "stand") {
    visitQueue = visitQueue.filter((q) => q.kind !== "eye" && q.kind !== "stretch");
  } else if (kind === "stretch") {
    visitQueue = visitQueue.filter((q) => q.kind !== "eye");
  }
  visitQueue.push(item);
  broadcastState();
  return true;
}

function applyReminderContent(kind, subReason = "", appCategory = "other", item = {}) {
  const pack = getCurrentPack();
  const nowMs = Date.now();
  celebrateUntil = 0;
  pendingCelebrateDurationMs = 0;
  drinkStage = 0;
  drinkStage1Until = 0;
  countdownEndsAt = 0;
  reminderKind = ["water", "eye", "stretch", "stand", "pomodoro", "system", "habit", "sticky"].includes(kind)
    ? kind
    : "water";
  walkOutActive = false;
  reactionMessage = "";
  isMilestoneReaction = false;
  reNudged = false;
  reminderShownAt = nowMs;
  reminderActiveWaitMs = 0;

  if (reminderKind === "eye") {
    reminderMood = "normal";
    reminderQuote = pack.eyeBreakPrompt;
    eyeNextAt = nowMs + (config.eye_break_interval_minutes || 20) * 60000;
    if (sysMonitor) sysMonitor.resetEyeTime();
  } else if (reminderKind === "stretch") {
    reminderMood = "normal";
    reminderQuote = pack.stretchPrompt;
    stretchNextAt = nowMs + (config.stretch_interval_minutes || 45) * 60000;
    eyeNextAt = nowMs + (config.eye_break_interval_minutes || 20) * 60000;
    if (sysMonitor) sysMonitor.resetStretchTime();
  } else if (reminderKind === "stand") {
    reminderMood = "normal";
    const mins = config.stand_break_interval_minutes || 90;
    const sec = getBreakDurationSeconds("stand");
    const durLabel = sec >= 60 ? `${Math.round(sec / 60)}m` : `${sec}s`;
    const tpl =
      pack.standBreakPrompt ||
      pack.systemLongActivePrompt ||
      "🚶 {mins}+ mins sitting! Ready for a {dur} stand & walk break?";
    reminderQuote = tpl.replace(/\{mins\}/g, String(mins)).replace(/\{dur\}/g, durLabel);
    standNextAt = nowMs + mins * 60000;
    stretchNextAt = nowMs + (config.stretch_interval_minutes || 45) * 60000;
    eyeNextAt = nowMs + (config.eye_break_interval_minutes || 20) * 60000;
    if (sysMonitor) sysMonitor.resetStandAndAllBreaks();
  } else if (reminderKind === "pomodoro") {
    reminderMood = "normal";
    reminderQuote =
      pomodoroPhase === "break" ? pack.pomodoroBreakPrompt : pack.pomodoroWorkPrompt;
  } else if (reminderKind === "system") {
    reminderMood = "normal";
    reminderQuote =
      subReason === "high_load" ? pack.systemHighLoadPrompt : pack.systemLongActivePrompt;
  } else if (reminderKind === "habit") {
    reminderMood = "normal";
    activeHabitTitle = String(item.habitTitle || activeHabitTitle || "Quick Check").trim();
    const tpl = pack.habitReminderTemplate || "⏰ Quick reminder: {habit}!";
    reminderQuote = tpl.replace(/\{habit\}/g, activeHabitTitle);
  } else if (reminderKind === "sticky") {
    reminderMood = "urgent";
    const noteTxt = String(item.customQuote || "").trim();
    const tpl = pack.habitReminderTemplate || "⏰ Reminder: {habit}!";
    reminderQuote = `📌 ${tpl.replace(/\{habit\}/g, noteTxt)}`;
  } else if (refusalStreak === 1) {
    reminderMood = "doubt";
    reminderQuote = pack.refuse2Quote;
  } else if (refusalStreak >= 2) {
    reminderMood = "angry";
    reminderQuote = pack.refuse3Quote;
  } else {
    reminderMood = "normal";
    const activeMins = sysMonitor ? sysMonitor.getStats().continuousActiveMinutes : 0;
    reminderQuote = pickContextualReminderQuote(pack, {
      now: new Date(),
      continuousActiveMinutes: activeMins,
      weatherTempC: config.weather_boost_enabled && weatherCache ? weatherCache.tempC : null,
      appCategory: config.app_awareness_enabled ? appCategory : "other",
    });
  }
}

function popNextVisitItem() {
  if (!visitQueue.length) return false;
  const next = visitQueue.shift();
  welcomeActive = false;
  welcomeAutoDismissAt = 0;
  breathingActive = false;
  fullscreenDeferred = false;
  walkInTargetX = null;
  peekUntil = 0;
  walkOutActive = false;
  timer.triggerNow();
  applyReminderContent(next.kind, next.subReason || "", next.appCategory || "other", next);
  closeDashboardWindow();
  showReminderWindow();
  applyVisibilityMode();
  broadcastState();
  return true;
}

function shouldUseDeepFocusPeek(kind, forceImmediate, appCategory) {
  if (forceImmediate) return false;
  if (!config || config.deep_focus_peek_enabled === false) return false;
  if (!config.popup_only_mode || !config.walk_enabled) return false;
  if (!["water", "eye", "stretch", "stand"].includes(kind)) return false;
  if (Date.now() - lastUnlockedAt < 3 * 60000) return false;
  if (focusPeekDeferCount >= 1) return false;
  const activeSec = sysMonitor ? sysMonitor.continuousActiveSeconds : 0;
  const deepFocused = appCategory === "coding" || activeSec >= 15 * 60;
  if (!deepFocused) return false;
  return getEffectiveIdleSeconds(Date.now()) < 3;
}

function enterReminderFromFocusPeek() {
  const pending = focusPeekPending;
  if (!pending) return;
  focusPeekPending = null;
  peekUntil = 0;
  turnHoldUntil = Date.now() + 180;
  welcomeActive = false;
  welcomeAutoDismissAt = 0;
  breathingActive = false;
  fullscreenDeferred = false;
  timer.triggerNow();
  applyReminderContent(pending.kind, pending.subReason || "", pending.appCategory || "other");
  closeDashboardWindow();
  if (walkInTargetX === null) {
    showReminderWindow();
  }
  applyVisibilityMode();
  broadcastState();
}

function retreatFromFocusPeek() {
  const pending = focusPeekPending;
  if (!pending) return;
  focusPeekPending = null;
  focusPeekDeferCount += 1;
  peekUntil = 0;
  walkInTargetX = null;
  const nowMs = Date.now();
  lastVisitEndedAt = nowMs;
  if (pending.kind === "water") {
    timer.status = "running";
    timer.remainingSeconds = 300;
    timer.lastTick = timer.clock();
  } else if (sysMonitor) {
    if (pending.kind === "eye") {
      sysMonitor.eyeActiveSeconds = Math.max(0, ((config.eye_break_interval_minutes || 20) - 5) * 60);
    } else if (pending.kind === "stretch") {
      sysMonitor.stretchActiveSeconds = Math.max(0, ((config.stretch_interval_minutes || 45) - 5) * 60);
    } else if (pending.kind === "stand") {
      sysMonitor.continuousActiveSeconds = Math.max(0, ((config.stand_break_interval_minutes || 90) - 5) * 60);
    }
  }
  walkOutDir = activeEntrySide === "left" ? -1 : 1;
  walkOutStartedAt = nowMs;
  turnHoldUntil = nowMs + 180;
  walkOutActive = true;
  broadcastState();
}

function handleEngagePeek() {
  if (!focusPeekPending) return;
  focusPeekPending.engaged = true;
  enterReminderFromFocusPeek();
}

function handleTriggerReminder(kind = "water", subReason = "", appCategory = "other", forceImmediate = false) {
  if (!forceImmediate && isVisitBusy()) {
    enqueueVisitItem({ kind, subReason, appCategory });
    return;
  }
  if (shouldUseDeepFocusPeek(kind, forceImmediate, appCategory)) {
    const nowMs = Date.now();
    focusPeekPending = {
      kind,
      subReason,
      appCategory,
      startedAt: nowMs,
      until: nowMs + 4000,
      engaged: false,
    };
    pickRandomCharacterForReminder();
    if (kind === "water") {
      timer.status = "running";
      timer.remainingSeconds = Math.max(timer.remainingSeconds, 30);
    }
    startCompanionEntrance({ withPeek: true, peekMs: 4000 });
    closeDashboardWindow();
    applyVisibilityMode();
    broadcastState();
    return;
  }
  focusPeekPending = null;
  welcomeActive = false;
  welcomeAutoDismissAt = 0;
  breathingActive = false;
  fullscreenDeferred = false;
  pickRandomCharacterForReminder();
  timer.triggerNow();
  applyReminderContent(kind, subReason, appCategory);

  if (config.popup_only_mode && companionWin && !companionWin.isDestroyed()) {
    startCompanionEntrance({ withPeek: true });
  } else {
    peekUntil = 0;
  }
  closeDashboardWindow();
  if (peekUntil === 0 && walkInTargetX === null) {
    showReminderWindow();
  }
  broadcastState();
}

function handleStartCountdown(seconds = 20) {
  const dur = Math.max(5, Math.min(300, Math.round(Number(seconds) || 20)));
  const pack = getCurrentPack();
  breathingActive = false;
  if (reminderKind === "water") {
    reminderKind = "eye";
    reminderQuote = pack.eyeBreakPrompt;
  }
  reminderMood = "normal";
  countdownEndsAt = Date.now() + dur * 1000;
  if (!reminderWin || reminderWin.isDestroyed()) {
    showReminderWindow();
  }
  broadcastState();
}

function handleStartBreathing(customQuote = "") {
  welcomeActive = false;
  welcomeAutoDismissAt = 0;
  celebrateUntil = 0;
  pendingCelebrateDurationMs = 0;
  walkOutActive = false;
  breathingActive = true;
  reminderKind = "breathing";
  reminderMood = "normal";
  const pack = getCurrentPack();
  reminderQuote = customQuote || pack.breathingPrompt || "🌊 Follow the glowing ring — inhale, hold, exhale...";
  timer.triggerNow();
  countdownEndsAt = Date.now() + 60000;
  if (config.popup_only_mode || !companionWin || !companionWin.isVisible()) {
    startCompanionEntrance({ withPeek: false });
  }
  if (walkInTargetX === null) {
    showReminderWindow();
  }
  applyVisibilityMode();
  broadcastState();
}

function handleSetWorkSession(mode = "off", showReaction = true) {
  const cleanMode = ["working", "break", "off"].includes(mode) ? mode : "off";
  ensureToday(state);
  const prevMode = state.work_session_mode || "off";
  state.work_session_mode = cleanMode;
  autoPausedByBreak = false;
  store.save(config, state);
  lastWorkSaveAt = Date.now();

  if (showReaction && prevMode !== cleanMode) {
    const pack = getCurrentPack();
    const msg =
      cleanMode === "working"
        ? pack.workStartReply || "💪 Work timer started!"
        : cleanMode === "break"
          ? pack.breakStartReply || "☕ Break mode on!"
          : pack.workEndReply || "🌙 Work session ended!";
    const kind =
      cleanMode === "working" ? "thumbsup" : cleanMode === "break" ? "happy" : "salute";
    triggerWalkToast({ kind, message: msg, durationMs: 2600, milestone: false });
    return;
  }
  broadcastState();
}

function handleTriggerScheduledBreakNotice(phase, brk) {
  if (!brk) return;
  const pack = getCurrentPack();
  const tpl =
    phase === "start"
      ? pack.scheduledBreakStartTemplate || "🍽 Time for {title} ({start}–{end})!"
      : pack.scheduledBreakEndTemplate || "⏰ {title} ended! Ready to resume?";
  const msg = tpl
    .replace(/\{title\}/g, brk.title)
    .replace(/\{start\}/g, brk.startHHMM)
    .replace(/\{end\}/g, brk.endHHMM);
  triggerWalkToast({
    kind: phase === "start" ? "happy" : "thumbsup",
    message: msg,
    durationMs: 5000,
    milestone: false,
  });
}

function handleTriggerEodRecap(isManual = true) {
  if (!isManual && (timer.status === "reminding" || welcomeActive || Date.now() < celebrateUntil)) {
    return;
  }
  const todayIso = state.current_date || "";
  if (todayIso) {
    config = store.save({ ...config, last_eod_recap_date: todayIso }, state);
  }
  const pack = getCurrentPack();
  const hydGoal = resolveDailyHydrationGoal(config);
  const streak = computeStreakDays(state, hydGoal.goalGlasses, new Date(), hydGoal.goalMl);
  const mlToday = Math.max(0, Math.round(Number(state.ml_today) || 0));
  const hydrationLabel = `${state.glasses_today || 0} (${(mlToday / 1000).toFixed(2)}/${hydGoal.goalLiters.toFixed(2)}L)`;
  const workStr = formatDurationCompact(state.work_seconds_today || 0);
  const breakStr = formatDurationCompact(state.break_seconds_today || 0);
  const tpl =
    pack.eodRecapTemplate ||
    "🌙 Wrap-up: {glasses} glasses • 💼 {workTime} work • ☕ {breakTime} break • 🔥 {streak}d!";
  const msg = tpl
    .replace(/\{glasses\}/g, hydrationLabel)
    .replace(/\{breaks\}/g, String(state.breaks_today || 0))
    .replace(/\{workTime\}/g, workStr)
    .replace(/\{breakTime\}/g, breakStr)
    .replace(/\{streak\}/g, String(streak));
  triggerWalkToast({ kind: "salute", message: msg, durationMs: 5200, milestone: true });
}

function handleTriggerBedtimeAlert(nowDate = new Date()) {
  const pack = getCurrentPack();
  const hhmm = `${String(nowDate.getHours()).padStart(2, "0")}:${String(nowDate.getMinutes()).padStart(2, "0")}`;
  const tpl =
    pack.bedtimeTemplate ||
    "🌙 It's {time} already, boss! Close the screen for tonight and get some real sleep!";
  triggerWalkToast({
    kind: "tired",
    message: tpl.replace(/\{time\}/g, hhmm),
    durationMs: 6200,
    milestone: false,
  });
}

function executePaletteCommand(rawInput) {
  const parsed = parseQuickCommand(rawInput);
  closePaletteWindow();
  if (!parsed || parsed.kind === "suggestions") return parsed;

  switch (parsed.kind) {
    case "math":
      try {
        clipboard.writeText(String(parsed.value));
      } catch {
        // ignore clipboard errors
      }
      triggerWalkToast({
        kind: "thumbsup",
        message: `🧮 Copied: ${parsed.expr} = ${parsed.formatted}`,
        durationMs: 2800,
        milestone: false,
      });
      break;
    case "drink":
      handleDrink(parsed.ml > 0 ? parsed.ml : undefined);
      break;
    case "work_session":
      handleSetWorkSession(parsed.mode, true);
      break;
    case "breathing":
      handleStartBreathing();
      break;
    case "test_reminder":
      handleTriggerReminder(parsed.reminderKind || "water");
      break;
    case "toggle_pomodoro":
      handleTogglePomodoro();
      break;
    case "dnd":
      handleSetDnd(parsed.minutes !== undefined ? parsed.minutes : 60);
      break;
    case "toggle_sticky":
      toggleStickyWindow();
      break;
    case "open_settings":
      openSettingsWindow();
      break;
    case "eod_recap":
      handleTriggerEodRecap(true);
      break;
    case "sleep_preview":
      handleTriggerBedtimeAlert(new Date());
      break;
    case "pose":
      handleTriggerPose();
      break;
    case "sticky_note": {
      const existing = Array.isArray(config.sticky_notes) ? config.sticky_notes : [];
      const timerEndsAt = parsed.minutes > 0 ? Date.now() + parsed.minutes * 60000 : 0;
      const nextNotes = [
        {
          id: "note_" + Date.now().toString(36),
          text: parsed.text,
          done: false,
          timerEndsAt,
          alertFired: false,
        },
        ...existing,
      ].slice(0, 20);
      config = store.save({ ...config, sticky_notes: nextNotes }, state);
      openStickyWindow();
      triggerWalkToast({
        kind: "thumbsup",
        message: parsed.minutes > 0
          ? `📌 Pinned "${parsed.text}" (${parsed.minutes}m timer)!`
          : `📌 Pinned "${parsed.text}"!`,
        durationMs: 3200,
        milestone: false,
      });
      break;
    }
    default:
      break;
  }
  return parsed;
}

function handleTriggerBatteryAlert(kind, pct) {
  if (timer.status === "reminding" || welcomeActive || Date.now() < celebrateUntil) return;
  const pack = getCurrentPack();
  const tpl =
    kind === "low"
      ? pack.batteryLowTemplate || "🔌 Battery is low ({pct}%)! Plug in charger!"
      : pack.batteryFullTemplate || "🔋 Battery is 100% full! You can unplug!";
  triggerWalkToast({
    kind: kind === "low" ? "angry" : "thumbsup",
    message: tpl.replace(/\{pct\}/g, String(pct)),
    durationMs: 4500,
    milestone: false,
  });
}

function handleTriggerWeeklyReport(isManual = true) {
  if (!isManual && (timer.status === "reminding" || welcomeActive || Date.now() < celebrateUntil)) {
    return;
  }
  const hydGoal = resolveDailyHydrationGoal(config);
  const recent7 = recentDays(state, 7, new Date(), config.glass_ml);
  const summary = summarizeWeeklyStats(recent7, hydGoal.goalGlasses, config.glass_ml, hydGoal.goalMl);
  const pack = getCurrentPack();
  const msg = formatWeeklyReportMessage(pack, summary);
  const todayIso = recent7[recent7.length - 1] ? recent7[recent7.length - 1].date : "";
  if (todayIso) {
    config = store.save({ ...config, last_weekly_report_date: todayIso }, state);
  }
  triggerWalkToast({ kind: "salute", message: msg, durationMs: 5500, milestone: true });
}

function handleCompleteBreak() {
  const wasBreathing = breathingActive;
  const completedKind = reminderKind;
  const wasHabit = completedKind === "habit";
  const wasSticky = completedKind === "sticky";
  breathingActive = false;
  reminderKind = "water";
  walkInTargetX = null;
  walkOutActive = false;
  peekUntil = 0;
  countdownEndsAt = 0;
  reNudged = false;
  refusalStreak = 0;
  focusPeekDeferCount = 0;
  reminderMood = "normal";
  if (sysMonitor) {
    if (completedKind === "eye") sysMonitor.resetEyeTime();
    else if (completedKind === "stretch") sysMonitor.resetStretchTime();
    else if (completedKind === "stand" || completedKind === "system") sysMonitor.resetStandAndAllBreaks();
    else sysMonitor.resetActiveTime();
  }
  const pack = getCurrentPack();
  if (!wasSticky) {
    addBreak(state);
  }
  timer.status = "running";
  timer.remainingSeconds = Math.max(timer.remainingSeconds, 30);
  timer.lastTick = timer.clock();

  drinkStage = 0;
  drinkStage1Until = 0;
  reactionKind = wasHabit || wasSticky ? "thumbsup" : "happy";
  isMilestoneReaction = false;
  reactionMessage = wasHabit
    ? (pack.habitDoneReply || pack.breakDoneMsg)
    : wasSticky
      ? (pack.dismiss || "✓ Got it!")
      : wasBreathing
        ? (pack.breathingDoneMsg || "😌 Calm & refreshed!")
        : pack.breakDoneMsg;
  celebrateUntil = Date.now() + (visitQueue.length > 0 ? 1100 : 2300);
  pendingWalkOutDir = activeEntrySide === "left" ? 1 : -1;

  store.save(config, state);
  showReminderWindow();
  applyVisibilityMode();
  broadcastState();
}

function handleTogglePomodoro() {
  const nextEnabled = !config.pomodoro_enabled;
  pomodoroPhase = "work";
  pomodoroEndsAt = nextEnabled
    ? Date.now() + config.pomodoro_work_minutes * 60000
    : 0;
  config = store.save({ ...config, pomodoro_enabled: nextEnabled }, state);
  broadcastState();
}

function handleTriggerPose() {
  if (Date.now() < celebrateUntil || pendingCelebrateDurationMs > 0) return;
  const pack = getCurrentPack();
  const list =
    Array.isArray(pack.poseLines) && pack.poseLines.length > 0
      ? pack.poseLines
      : [{ kind: "meesha", msg: "😎 സവാരി ഗിരി ഗിരി!" }];
  const choice = list[poseIndex % list.length];
  poseIndex += 1;
  if (config.popup_only_mode && (!companionWin || !companionWin.isVisible())) {
    triggerWalkToast({
      kind: choice.kind || "meesha",
      message: choice.msg,
      durationMs: 2400,
      milestone: false,
    });
    return;
  }
  poseKind = choice.kind || "meesha";
  poseMessage = choice.msg;
  poseUntil = Date.now() + 2400;
  isMilestoneReaction = false;
  applyVisibilityMode();
  broadcastState();
}

function handleTriggerHop() {
  if (!companionWin || companionWin.isDestroyed()) return;
  const nowMs = Date.now();
  posVy = -390;
  isAirborne = true;
  jumpCelebrationUntil = nowMs + 580;
  if (timer.status !== "reminding" && nowMs >= celebrateUntil) {
    const pack = getCurrentPack();
    const list =
      Array.isArray(pack.poseLines) && pack.poseLines.length > 0
        ? pack.poseLines
        : [{ kind: "happy", msg: "🙌 സവാരി ഗിരി ഗിരി!" }];
    const choice = list[poseIndex % list.length];
    poseIndex += 1;
    poseKind = "happy";
    poseMessage = choice.msg;
    poseUntil = nowMs + 2000;
    isMilestoneReaction = false;
  }
  applyVisibilityMode();
  broadcastState();
}

function handleSetGlassMl(ml) {
  const cleanMl = Math.max(50, Math.min(2000, Math.round(Number(ml) || 250)));
  config = store.save({ ...config, glass_ml: cleanMl }, state);
  broadcastState();
}

async function dispatchSmartWaterReminder() {
  if (systemSuspended || screenLocked) {
    timer.status = "running";
    timer.remainingSeconds = Math.max(timer.remainingSeconds, 8);
    timer.lastTick = timer.clock();
    return;
  }
  if (fullscreenCheckPending) {
    if (Date.now() - fullscreenCheckStartedAt < 6000) return;
    fullscreenCheckPending = false;
  }
  fullscreenCheckPending = true;
  fullscreenCheckStartedAt = Date.now();
  try {
    if (config.dnd_fullscreen) {
      const isFs = await isFullscreenAppActive(process.pid);
      if (isFs) {
        fullscreenDeferred = true;
        timer.status = "running";
        timer.remainingSeconds = 30;
        broadcastState();
        return;
      }
      fullscreenDeferred = false;
    } else {
      fullscreenDeferred = false;
    }
    let appCat = "other";
    if (config.app_awareness_enabled) {
      const ctx = await getActiveWindowContext(process.pid);
      appCat = ctx.category || "other";
      lastAppCategory = appCat;
      if (appCat === "meeting") {
        // Defer silently during live Teams/Zoom/Meet calls
        timer.status = "running";
        timer.remainingSeconds = 120;
        broadcastState();
        return;
      }
    }
    handleTriggerReminder("water", "", appCat);
  } catch {
    handleTriggerReminder("water", "", "other");
  } finally {
    fullscreenCheckPending = false;
  }
}

function syncGlobalHotkeys() {
  try {
    globalShortcut.unregisterAll();
    if (!config || config.hotkeys_enabled === false) return;
    globalShortcut.register("CommandOrControl+Shift+D", () => {
      handleDrink();
    });
    globalShortcut.register("CommandOrControl+Shift+M", () => {
      if (timer.status === "reminding" || welcomeActive) {
        handleTriggerPose();
      } else {
        handleTriggerReminder("water");
      }
    });
    globalShortcut.register("CommandOrControl+Shift+N", () => {
      toggleStickyWindow();
    });
    globalShortcut.register("CommandOrControl+Shift+Space", () => {
      togglePaletteWindow();
    });
  } catch {
    // ignore hotkey conflicts
  }
}

function refreshWeatherCache() {
  if (!config || config.weather_boost_enabled === false) return;
  fetchWeatherTemperature()
    .then((wx) => {
      if (wx) {
        weatherCache = wx;
        broadcastState();
      }
    })
    .catch(() => { });
}

function handleConfirmReminder() {
  const action = resolveDrinkAction({
    explicitWaterLog: false,
    inDrinkCooldown: Date.now() < celebrateUntil && drinkStage > 0,
    welcomeActive,
    reminderKind,
    countdownEndsAt,
  });
  if (action === "cooldown_skip") return;
  if (action === "welcome_fresh") {
    handleWelcomeMood("fresh");
    return;
  }
  if (action === "dismiss_sticky") {
    handleDismissReminder();
    return;
  }
  if (action === "start_break_countdown") {
    handleStartCountdown(getBreakDurationSeconds(reminderKind));
    return;
  }
  if (action === "complete_break") {
    handleCompleteBreak();
    return;
  }
  handleDrink();
}

function handleDrink(customMl) {
  const action = resolveDrinkAction({
    explicitWaterLog: true,
    inDrinkCooldown: Date.now() < celebrateUntil && drinkStage > 0,
    welcomeActive,
    reminderKind,
    countdownEndsAt,
  });
  if (action === "cooldown_skip") return;

  welcomeActive = false;
  welcomeAutoDismissAt = 0;
  breathingActive = false;
  focusPeekPending = null;
  reminderKind = "water";

  const usedMl =
    Number(customMl) >= 50
      ? Math.max(50, Math.min(2000, Math.round(Number(customMl))))
      : config.glass_ml;
  if (Number(customMl) >= 50) {
    config = store.save(
      { ...config, glass_ml: usedMl },
      state
    );
  }

  walkInTargetX = null;
  walkOutActive = false;
  peekUntil = 0;
  poseUntil = 0;
  poseMessage = "";
  countdownEndsAt = 0;
  reNudged = false;
  reminderActiveWaitMs = 0;
  reminderShownAt = 0;
  refusalStreak = 0;
  focusPeekDeferCount = 0;
  reminderMood = "normal";
  const activeMinsBeforeReset = sysMonitor ? sysMonitor.getStats().continuousActiveMinutes : 0;
  if (sysMonitor) sysMonitor.resetActiveTime();
  const pack = getCurrentPack();
  const prevMl = Math.max(0, Math.round(Number(state.ml_today) || 0));
  addGlass(state, 1, new Date(), usedMl);
  const newMl = Math.max(0, Math.round(Number(state.ml_today) || 0));
  const hydGoal = resolveDailyHydrationGoal(config);
  const goalMl = hydGoal.goalMl;
  const halfMl = Math.round(goalMl * 0.5);
  const hit100 = prevMl < goalMl && newMl >= goalMl;
  const hit50 = !hit100 && goalMl >= 1000 && prevMl < halfMl && newMl >= halfMl;
  const effectiveInterval = computeEffectiveIntervalMinutes(
    config.interval_minutes,
    activeMinsBeforeReset
  );
  timer.updateIntervals(effectiveInterval, config.snooze_minutes);
  timer.markDrank();

  if (hit100) {
    stage2ReactionKind = "salute";
    stage2ReactionMsg = pack.milestone100;
    isMilestoneReaction = true;
  } else if (hit50) {
    stage2ReactionKind = "salute";
    stage2ReactionMsg = pack.milestone50;
    isMilestoneReaction = true;
  } else {
    const choice = pack.reactions[Math.floor(Math.random() * pack.reactions.length)];
    stage2ReactionKind = choice.kind === "celebrate" ? "happy" : choice.kind;
    stage2ReactionMsg = choice.msg;
    isMilestoneReaction = false;
  }

  // Stage 1: Always sip & drain the water glass first, then Stage 2 reaction!
  drinkStage = 1;
  reactionKind = "celebrate";
  reactionMessage = pack.drinking || "💧 Sipping...";
  const now = Date.now();
  drinkStage1Until = now + 2050;
  celebrateUntil = now + 4150;
  pendingWalkOutDir = activeEntrySide === "left" ? 1 : -1;

  store.save(config, state);
  showReminderWindow();
  applyVisibilityMode();
  broadcastState();
}

function handleUndoDrink() {
  addGlass(state, -1, new Date(), config.glass_ml);
  store.save(config, state);
  broadcastState();
}

function applyReminderDeferral(delayMinutes = 5, customMessage = "", bumpRefusal = false) {
  if (Date.now() < celebrateUntil) return;
  const delayMins = Math.max(1, Math.min(60, Math.round(Number(delayMinutes) || 5)));
  walkInTargetX = null;
  walkOutActive = false;
  peekUntil = 0;
  countdownEndsAt = 0;
  drinkStage = 0;
  drinkStage1Until = 0;
  reNudged = false;
  reminderActiveWaitMs = 0;
  reminderShownAt = 0;
  const pack = getCurrentPack();

  const prevStreak = refusalStreak;
  const prevKind = reminderKind;
  if (prevKind === "water") {
    if (bumpRefusal) {
      refusalStreak = prevStreak === 0 ? 1 : prevStreak === 1 ? 2 : 0;
    }
    timer.status = "snoozed";
    timer.remainingSeconds = delayMins * 60;
    timer.lastTick = timer.clock();
  } else {
    // Snoozing/deferring a break preserves the water timer countdown
    timer.status = "running";
    timer.remainingSeconds = Math.max(timer.remainingSeconds, 30);
    timer.lastTick = timer.clock();
    if (sysMonitor) {
      if (prevKind === "eye") {
        sysMonitor.eyeActiveSeconds = Math.max(0, ((config.eye_break_interval_minutes || 20) - delayMins) * 60);
      } else if (prevKind === "stretch") {
        sysMonitor.stretchActiveSeconds = Math.max(0, ((config.stretch_interval_minutes || 45) - delayMins) * 60);
      } else if (prevKind === "stand" || prevKind === "system") {
        sysMonitor.continuousActiveSeconds = Math.max(0, ((config.stand_break_interval_minutes || 90) - delayMins) * 60);
      }
    }
  }
  reminderMood = "normal";
  reminderKind = "water";
  reactionKind = "shrug";
  reactionMessage = customMessage || (prevStreak === 0 ? pack.refuse1 : pack.snooze);
  isMilestoneReaction = false;
  pendingWalkOutDir = activeEntrySide === "left" ? -1 : 1;
  celebrateUntil = Date.now() + (visitQueue.length > 0 ? 900 : 1450);
  showReminderWindow();
  applyVisibilityMode();
  broadcastState();
}

function handleSnooze() {
  applyReminderDeferral(config.snooze_minutes || 5, "", true);
}

function handleReplyReminder(actionKey = "") {
  if (Date.now() < celebrateUntil) return;
  const pack = getCurrentPack();
  const rLines = pack.replyLines || {};
  const key = String(actionKey || "").trim().toLowerCase();

  if (key === "just_had") {
    handleDrink();
    if (drinkStage === 1) {
      stage2ReactionMsg = rLines.justHad || stage2ReactionMsg;
    }
    return;
  }
  if (key === "already_rested") {
    handleCompleteBreak(20);
    if (rLines.alreadyRested) {
      reactionMessage = rLines.alreadyRested;
      broadcastState();
    }
    return;
  }
  if (key === "skip") {
    applyReminderDeferral(config.snooze_minutes || 10, rLines.skipBreak || pack.dismiss, false);
    return;
  }
  if (key === "deep_focus") {
    focusPeekDeferCount = 0;
    applyReminderDeferral(20, rLines.deepFocus || pack.snooze, false);
    return;
  }
  if (key.startsWith("snooze:")) {
    const mins = Math.max(1, Math.min(60, Math.round(Number(key.split(":")[1]) || 5)));
    const msgMap = { 5: rLines.snooze5, 15: rLines.snooze15, 30: rLines.snooze30 };
    applyReminderDeferral(mins, msgMap[mins] || pack.snooze, false);
    return;
  }
  handleSnooze();
}

function handleDismissReminder() {
  if (Date.now() < celebrateUntil) return;
  if (welcomeActive || reminderKind === "welcome") {
    handleCompleteWelcome(false);
    return;
  }
  const prevKind = reminderKind;
  walkInTargetX = null;
  walkOutActive = false;
  peekUntil = 0;
  countdownEndsAt = 0;
  drinkStage = 0;
  drinkStage1Until = 0;
  reminderMood = "normal";
  reminderKind = "water";
  reNudged = false;
  reminderActiveWaitMs = 0;
  reminderShownAt = 0;
  const pack = getCurrentPack();
  if (prevKind === "water") {
    timer.markDrank();
  } else {
    timer.status = "running";
    timer.remainingSeconds = Math.max(timer.remainingSeconds, 30);
    timer.lastTick = timer.clock();
    if (sysMonitor) {
      if (prevKind === "eye") sysMonitor.resetEyeTime();
      else if (prevKind === "stretch") sysMonitor.resetStretchTime();
      else if (prevKind === "stand" || prevKind === "system") sysMonitor.resetStandAndAllBreaks();
    }
  }
  reactionKind = "shrug";
  reactionMessage = pack.dismiss;
  isMilestoneReaction = false;
  pendingWalkOutDir = activeEntrySide === "left" ? -1 : 1;
  celebrateUntil = Date.now() + (visitQueue.length > 0 ? 750 : 1150);
  showReminderWindow();
  applyVisibilityMode();
  broadcastState();
}

function handleAutoBreakReset() {
  walkInTargetX = null;
  walkOutActive = false;
  peekUntil = 0;
  countdownEndsAt = 0;
  drinkStage = 0;
  drinkStage1Until = 0;
  reminderMood = "normal";
  reminderKind = "water";
  visitQueue = [];
  reNudged = false;
  reminderActiveWaitMs = 0;
  refusalStreak = 0;
  reactionMessage = "";
  isMilestoneReaction = false;
  timer.markDrank();
  timer.idleState = "reset";
  eyeNextAt = Date.now() + (config.eye_break_interval_minutes || 20) * 60000;
  stretchNextAt = Date.now() + (config.stretch_interval_minutes || 45) * 60000;
  standNextAt = Date.now() + (config.stand_break_interval_minutes || 90) * 60000;
  if (sysMonitor) {
    sysMonitor.resetStandAndAllBreaks();
  }
  closeReminderWindow();
  applyVisibilityMode();
  broadcastState();
}

function handleTogglePause() {
  timer.togglePause();
  broadcastState();
}

function handleSetDnd(minutes) {
  const mins = Math.max(0, Math.round(Number(minutes) || 0));
  const until = mins > 0 ? Date.now() + mins * 60000 : 0;
  config = store.save({ ...config, dnd_until: until }, state);
  if (until > 0) {
    visitQueue = [];
    if (timer.status === "reminding") {
      closeReminderWindow();
      timer.snooze();
      applyVisibilityMode();
    }
  }
  broadcastState();
}

async function pickGlbFile() {
  const parentWin =
    settingsWin && !settingsWin.isDestroyed() ? settingsWin : companionWin;
  const res = await dialog.showOpenDialog(parentWin, {
    title: "Select 3D Character (.glb / .gltf)",
    filters: [
      { name: "3D Models (GLB / GLTF)", extensions: ["glb", "gltf"] },
      { name: "All Files", extensions: ["*"] },
    ],
    properties: ["openFile"],
  });
  if (res.canceled || !res.filePaths.length) return "";
  return res.filePaths[0];
}

let lastCursorBroadcast = 0;

function scheduleWakeRecovery(explicitAwayMs = 0) {
  if (systemSuspended || screenLocked) return;
  const now = Date.now();
  const computedAwayMs = explicitAwayMs > 0
    ? explicitAwayMs
    : awayStartedAt > 0
      ? Math.max(0, now - awayStartedAt)
      : 0;
  awayStartedAt = 0;
  lastUnlockedAt = now;
  lastLoopTickAt = now;
  if (wakeRecoveryTimer) {
    clearTimeout(wakeRecoveryTimer);
  }
  wakeRecoveryTimer = setTimeout(() => {
    wakeRecoveryTimer = null;
    if (systemSuspended || screenLocked) return;
    fullscreenDeferred = false;
    fullscreenCheckPending = false;
    focusPeekDeferCount = 0;
    const action = evaluateWakeRecovery({
      awayMs: computedAwayMs,
      timerStatus: timer ? timer.status : "running",
      remainingSeconds: timer ? timer.remainingSeconds : 0,
      intervalMinutes: config ? config.interval_minutes : 20,
    });
    if (action === "re_present") {
      walkInTargetX = null;
      walkOutActive = false;
      peekUntil = 0;
      focusPeekPending = null;
      if (config.popup_only_mode || !companionWin || !companionWin.isVisible()) {
        startCompanionEntrance({ withPeek: false });
      }
      showReminderWindow();
      applyVisibilityMode();
      broadcastState();
    } else if (action === "prompt_soon" && timer) {
      timer.status = "running";
      timer.remainingSeconds = 8;
      timer.lastTick = timer.clock();
      broadcastState();
    } else if (timer) {
      timer.lastTick = timer.clock();
    }
  }, 1500);
}

function startLoops() {
  // Timer & stage transition loop (250ms)
  setInterval(() => {
    if (ensureToday(state)) {
      store.save(config, state);
    }
    const now = Date.now();
    const rawGapMs = Math.max(0, now - lastLoopTickAt);
    const loopDtMs = Math.max(0, Math.min(2000, rawGapMs));
    lastLoopTickAt = now;

    if (now - lastLockPollAt >= 2000) {
      lastLockPollAt = now;
      try {
        const lockedNow = powerMonitor.getSystemIdleState(1) === "locked";
        if (lockedNow && !screenLocked) {
          screenLocked = true;
          if (!awayStartedAt) awayStartedAt = now;
        } else if (!lockedNow && screenLocked) {
          screenLocked = false;
          scheduleWakeRecovery();
        }
      } catch {
        // ignore idle state poll failures
      }
    }

    // Modern Standby (S0) sleep can pause timers without firing suspend/resume events
    if (rawGapMs >= 90000 && !systemSuspended && !screenLocked) {
      scheduleWakeRecovery(rawGapMs);
    }

    if (systemSuspended || screenLocked) {
      if (!awayStartedAt) awayStartedAt = now;
      if (timer) timer.lastTick = timer.clock();
      return;
    }
    const idleSeconds = getEffectiveIdleSeconds(now);
    const pauseSec = Math.max(15, Number(config.idle_pause_seconds) || 60);
    const resetSec = Math.max(pauseSec + 15, (Number(config.idle_reset_minutes) || 3) * 60);

    if (config.dnd_until > 0 && now >= config.dnd_until) {
      config = store.save({ ...config, dnd_until: 0 }, state);
    }
    if (welcomeActive && welcomeAutoDismissAt > 0 && now >= welcomeAutoDismissAt) {
      handleCompleteWelcome(false);
      return;
    }
    if (poseUntil > 0 && now >= poseUntil) {
      poseUntil = 0;
      poseMessage = "";
      if (config.popup_only_mode && timer.status !== "reminding" && celebrateUntil === 0 && !walkOutActive) {
        applyVisibilityMode();
      }
      broadcastState();
    }
    if (drinkStage === 1 && drinkStage1Until > 0 && now >= drinkStage1Until) {
      drinkStage = 2;
      drinkStage1Until = 0;
      reactionKind = stage2ReactionKind;
      reactionMessage = stage2ReactionMsg;
      broadcastState();
    }
    if (celebrateUntil > 0 && now >= celebrateUntil) {
      celebrateUntil = 0;
      drinkStage = 0;
      drinkStage1Until = 0;
      reactionMessage = "";
      isMilestoneReaction = false;
      if (visitQueue.length > 0) {
        popNextVisitItem();
        return;
      }
      lastVisitEndedAt = now;
      closeReminderWindow();
      if (config.popup_only_mode && config.walk_enabled) {
        walkOutDir = pendingWalkOutDir;
        walkOutStartedAt = now;
        turnHoldUntil = now + 230;
        walkOutActive = true;
        broadcastState();
      } else {
        activeGlbOverride = "";
        applyVisibilityMode();
      }
    }

    if (countdownEndsAt > 0 && now >= countdownEndsAt) {
      handleCompleteBreak(20);
      return;
    }

    if (
      timer.status === "reminding" &&
      countdownEndsAt === 0 &&
      walkInTargetX === null &&
      now >= peekUntil
    ) {
      // Only auto-reset non-water break reminders (Eye/Stretch/System) if user walked away;
      // Water reminders always stay waiting on screen until the user clicks Drank or Not now.
      if (reminderKind !== "water" && config.smart_idle_enabled && idleSeconds >= resetSec) {
        handleAutoBreakReset();
        return;
      }
      // Only accumulate reminder wait time while user is actively at PC
      if (!config.smart_idle_enabled || idleSeconds < pauseSec) {
        reminderActiveWaitMs += loopDtMs;
      }
    }

    // Gentle 60s re-nudge if normal reminder is still ignored while actively working
    if (
      timer.status === "reminding" &&
      reminderMood === "normal" &&
      !reNudged &&
      countdownEndsAt === 0 &&
      walkInTargetX === null &&
      now >= peekUntil &&
      reminderShownAt > 0 &&
      reminderActiveWaitMs >= 60000
    ) {
      reNudged = true;
      reminderQuote = getCurrentPack().nudge;
      const stepDir = activeEntrySide === "left" ? 1 : -1;
      const nudged = clampWindowPos(posX + stepDir * 85, posY);
      posX = nudged.x;
      if (companionWin && !companionWin.isDestroyed()) {
        safeSetPosition(companionWin, posX, posY);
      }
      if (reminderWin && !reminderWin.isDestroyed()) {
        positionPopoverAboveCompanion(reminderWin, REM_W, REM_H);
      }
    }

    // STARVE / TIRED state after 105s of ignoring reminder while actively working
    if (
      timer.status === "reminding" &&
      reminderMood === "normal" &&
      countdownEndsAt === 0 &&
      walkInTargetX === null &&
      now >= peekUntil &&
      reminderShownAt > 0 &&
      reminderActiveWaitMs >= 105000
    ) {
      reminderMood = "tired";
      reminderQuote = getCurrentPack().starvePrompt;
    }

    // Work & Break Time Tracker (manual Start Work / Break mode with Activity Guard)
    const curDateObj = new Date(now);
    const todayKey = state.current_date || "";
    const workSched = evaluateWorkSchedule(config, state.work_session_mode || "off", curDateObj);
    const activityPaused =
      state.work_session_mode === "working" &&
      Boolean(config.smart_idle_enabled) &&
      idleSeconds >= pauseSec;
    if (state.work_session_mode === "working" || state.work_session_mode === "break") {
      addWorkBreakSeconds(state, state.work_session_mode, loopDtMs / 1000, activityPaused, curDateObj);
      if (now - lastWorkSaveAt >= 15000) {
        lastWorkSaveAt = now;
        store.save(config, state);
      }
    }

    // Scheduled Work Break Window transitions (Lunch, Tea, etc.)
    if (firedBreakNoticeDate !== todayKey) {
      firedBreakNoticeDate = todayKey;
      firedBreakNoticeKeys = new Set();
    }
    const curBrk = workSched.activeScheduledBreak;
    if (curBrk && (!lastScheduledBreakObj || lastScheduledBreakObj.id !== curBrk.id)) {
      lastScheduledBreakObj = curBrk;
      const startKey = `start:${curBrk.id}`;
      if (state.work_session_mode === "working") {
        state.work_session_mode = "break";
        autoPausedByBreak = true;
        store.save(config, state);
      }
      if (!firedBreakNoticeKeys.has(startKey) && timer.status === "running" && !welcomeActive) {
        firedBreakNoticeKeys.add(startKey);
        handleTriggerScheduledBreakNotice("start", curBrk);
      }
    } else if (!curBrk && lastScheduledBreakObj) {
      const endedBrk = lastScheduledBreakObj;
      lastScheduledBreakObj = null;
      const endKey = `end:${endedBrk.id}`;
      if (autoPausedByBreak || (config.work_schedule_enabled && workSched.inShiftWindow)) {
        state.work_session_mode = "working";
        autoPausedByBreak = false;
        store.save(config, state);
      }
      if (!firedBreakNoticeKeys.has(endKey) && timer.status === "running" && !welcomeActive) {
        firedBreakNoticeKeys.add(endKey);
        handleTriggerScheduledBreakNotice("end", endedBrk);
      }
    }

    if (isDndActive() || !workSched.remindersAllowed) {
      if (timer.status === "running" || timer.status === "snoozed") {
        timer.remainingSeconds = Math.max(timer.remainingSeconds, 5);
      }
      broadcastState();
      return;
    }

    // Custom Daily Habit & Medicine Schedule Check
    if (firedHabitsDate !== todayKey) {
      firedHabitsDate = todayKey;
      firedHabitsToday = new Set();
    }
    if (
      Array.isArray(config.custom_habits) &&
      config.custom_habits.length > 0 &&
      timer.status === "running" &&
      !welcomeActive &&
      celebrateUntil === 0 &&
      !walkOutActive
    ) {
      const hhmm = `${String(curDateObj.getHours()).padStart(2, "0")}:${String(curDateObj.getMinutes()).padStart(2, "0")}`;
      for (const h of config.custom_habits) {
        if (h && h.enabled && h.timeHHMM === hhmm && !firedHabitsToday.has(h.id)) {
          firedHabitsToday.add(h.id);
          handleTriggerHabit(h.title);
          return;
        }
      }
    }

    // Sticky Note Countdown Alert check (independent of water timer)
    if (Array.isArray(config.sticky_notes) && config.sticky_notes.length > 0) {
      let triggeredNoteText = "";
      let changedNotes = false;
      const updatedNotes = config.sticky_notes.map((n) => {
        if (!triggeredNoteText && !n.done && n.timerEndsAt > 0 && now >= n.timerEndsAt && !n.alertFired) {
          triggeredNoteText = n.text;
          changedNotes = true;
          return { ...n, alertFired: true };
        }
        return n;
      });
      if (changedNotes) {
        config = store.save({ ...config, sticky_notes: updatedNotes }, state);
        handleTriggerStickyAlert(triggeredNoteText);
      }
    }

    // Periodic 5s system resource monitor + Pomodoro + Categorized Ergonomic Breaks (Work Hours + Continuous Work Only)
    if (sysMonitor && now - lastSysSampleAt >= 5000) {
      lastSysSampleAt = now;
      const eyeResetSec = Math.max(10, Math.min(pauseSec, Number(config.eye_idle_reset_seconds) || 25));
      sysMonitor.sample({
        pauseSeconds: pauseSec,
        resetSeconds: resetSec,
        eyeIdleResetSeconds: eyeResetSec,
        inWorkWindow: workSched.breakRemindersAllowed,
      });

      const gapMs = Math.max(0, Number(config.min_visit_gap_minutes) || 0) * 60000;
      const visitGapOk = isVisitBusy(now) || lastVisitEndedAt === 0 || now - lastVisitEndedAt >= gapMs;
      const activeForBreak = !config.smart_idle_enabled || idleSeconds < eyeResetSec;
      const canRunAutoBreaks =
        workSched.breakRemindersAllowed &&
        activeForBreak &&
        visitGapOk &&
        !welcomeActive &&
        !walkOutActive &&
        !fullscreenCheckPending &&
        (timer.status === "running" || timer.status === "reminding");

      if (canRunAutoBreaks) {
        if (
          timer.status === "running" &&
          now >= celebrateUntil &&
          config.pomodoro_enabled &&
          pomodoroEndsAt > 0 &&
          now >= pomodoroEndsAt
        ) {
          pomodoroPhase = pomodoroPhase === "work" ? "break" : "work";
          const nextMins =
            pomodoroPhase === "work"
              ? config.pomodoro_work_minutes
              : config.pomodoro_break_minutes;
          pomodoroEndsAt = now + nextMins * 60000;
          handleTriggerReminder("pomodoro");
          return;
        }

        const standMins = Math.max(15, Number(config.stand_break_interval_minutes) || 90);
        const standDue = config.smart_idle_enabled
          ? sysMonitor.continuousActiveSeconds >= standMins * 60
          : now >= standNextAt;
        if (config.stand_break_enabled !== false && standDue) {
          standNextAt = now + standMins * 60000;
          stretchNextAt = now + (config.stretch_interval_minutes || 45) * 60000;
          eyeNextAt = now + (config.eye_break_interval_minutes || 20) * 60000;
          sysMonitor.resetStandAndAllBreaks();
          handleTriggerReminder("stand");
          return;
        }

        const stretchMins = Math.max(10, Number(config.stretch_interval_minutes) || 45);
        const stretchDue = config.smart_idle_enabled
          ? sysMonitor.stretchActiveSeconds >= stretchMins * 60
          : now >= stretchNextAt;
        if (config.stretch_enabled && stretchDue) {
          stretchNextAt = now + stretchMins * 60000;
          eyeNextAt = now + (config.eye_break_interval_minutes || 20) * 60000;
          sysMonitor.resetStretchTime();
          handleTriggerReminder("stretch");
          return;
        }

        const eyeMins = Math.max(5, Number(config.eye_break_interval_minutes) || 20);
        const eyeDue = config.smart_idle_enabled
          ? sysMonitor.eyeActiveSeconds >= eyeMins * 60
          : now >= eyeNextAt;
        if (config.eye_break_enabled && eyeDue) {
          eyeNextAt = now + eyeMins * 60000;
          sysMonitor.resetEyeTime();
          handleTriggerReminder("eye");
          return;
        }

        // Hardware CPU alert check (active sitting break is handled cleanly above via "stand")
        const sysAlert =
          timer.status === "running" && now >= celebrateUntil
            ? sysMonitor.shouldTriggerAlert({
              enabled: config.system_monitor_enabled,
              activeLimitMinutes: 99999,
              cpuThreshold: config.cpu_alert_threshold,
            })
            : null;
        if (sysAlert) {
          handleTriggerReminder("system", sysAlert);
          return;
        }
      }
    }

    // Battery Health Watchdog (checks every 60s when enabled on laptops)
    if (
      config.battery_alerts_enabled &&
      now - lastBatteryCheckAt >= 60000 &&
      timer.status === "running" &&
      !welcomeActive &&
      celebrateUntil === 0 &&
      !walkOutActive
    ) {
      lastBatteryCheckAt = now;
      getBatteryStatus()
        .then((bat) => {
          if (!bat || !bat.hasBattery) return;
          const cooldownPassed = Date.now() - lastBatteryAlertAt >= 25 * 60000;
          if (!bat.isCharging && bat.percent <= 20 && (lastBatteryAlertKind !== "low" || cooldownPassed)) {
            lastBatteryAlertAt = Date.now();
            lastBatteryAlertKind = "low";
            handleTriggerBatteryAlert("low", bat.percent);
          } else if (bat.isCharging && bat.percent >= 100 && (lastBatteryAlertKind !== "full" || cooldownPassed)) {
            lastBatteryAlertAt = Date.now();
            lastBatteryAlertKind = "full";
            handleTriggerBatteryAlert("full", bat.percent);
          }
        })
        .catch(() => { });
    }

    // End-of-Day Wind-Down Recap check (once per day at eod_recap_time)
    const dNow = new Date(now);
    const todayDateStr = state.current_date || "";
    if (
      config.eod_recap_enabled &&
      todayDateStr &&
      config.last_eod_recap_date !== todayDateStr &&
      timer.status === "running" &&
      !welcomeActive &&
      celebrateUntil === 0 &&
      !walkOutActive
    ) {
      const curHm = `${String(dNow.getHours()).padStart(2, "0")}:${String(dNow.getMinutes()).padStart(2, "0")}`;
      if (curHm >= (config.eod_recap_time || "19:00")) {
        handleTriggerEodRecap(false);
        return;
      }
    }

    // Sunday evening Weekly Report Card check (once per Sunday after 6:00 PM)
    if (
      dNow.getDay() === 0 &&
      dNow.getHours() >= 18 &&
      todayDateStr &&
      config.last_weekly_report_date !== todayDateStr &&
      timer.status === "running" &&
      !welcomeActive &&
      celebrateUntil === 0 &&
      !walkOutActive
    ) {
      handleTriggerWeeklyReport(false);
      return;
    }

    // Night-Owl Sleep Guard (nudges every 30m while active past bedtime)
    if (
      config.bedtime_enabled &&
      isPastBedtime(config.bedtime_hhmm, dNow) &&
      (!config.smart_idle_enabled || idleSeconds < pauseSec) &&
      timer.status === "running" &&
      !welcomeActive &&
      celebrateUntil === 0 &&
      pendingCelebrateDurationMs === 0 &&
      !walkOutActive &&
      now - lastBedtimeAlertAt >= 30 * 60000
    ) {
      lastBedtimeAlertAt = now;
      handleTriggerBedtimeAlert(dNow);
      return;
    }

    // Drinking water timer always runs on schedule regardless of mouse idle/break state
    const triggered = timer.tick();
    if (triggered && !fullscreenCheckPending) {
      lastTickBroadcastKey = "";
      dispatchSmartWaterReminder();
    } else {
      const ws = evaluateWorkSchedule(config, state.work_session_mode || "off", dNow);
      const dndLeft = isDndActive() ? Math.max(1, Math.ceil((config.dnd_until - now) / 60000)) : 0;
      const pomoLeft =
        config.pomodoro_enabled && pomodoroEndsAt > now
          ? Math.ceil((pomodoroEndsAt - now) / 60000)
          : 0;
      const liveUiOpen =
        (dashboardWin && !dashboardWin.isDestroyed()) ||
        (settingsWin && !settingsWin.isDestroyed());
      const cpuKey = liveUiOpen && sysMonitor ? Math.round(sysMonitor.getStats().cpuPercent || 0) : 0;
      const tickKey = `${timer.status}|${timer.formatRemaining()}|${fullscreenDeferred}|${timer.idleState}|${dndLeft}|${pomoLeft}|${cpuKey}|${state.work_session_mode}|${formatDurationCompact(state.work_seconds_today)}|${formatDurationCompact(state.break_seconds_today)}|${ws.remindersAllowed}`;
      if (tickKey !== lastTickBroadcastKey) {
        lastTickBroadcastKey = tickKey;
        broadcastState();
      }
    }
  }, 250);

  let lastWalkPerfMs = performance.now();
  // Smooth 90Hz (~11ms) desktop walking & cursor look-at loop
  setInterval(() => {
    const now = Date.now();
    const nowPerf = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (nowPerf - lastWalkPerfMs) / 1000));
    lastWalkPerfMs = nowPerf;
    lastWalkTick = now;

    if (!companionWin || companionWin.isDestroyed() || !companionWin.isVisible()) {
      return;
    }

    const { w: compW, h: compH } = getCompanionSize();
    updateTaskbarAutoHideState(now);
    const groundY = getGroundY(compH);
    if (lastTaskbarGroundY !== null && groundY < lastTaskbarGroundY - 12 && !isDragging) {
      // Auto-hide taskbar popped up underneath: playfully hop onto the top of the taskbar!
      posVy = -410;
      isAirborne = true;
      jumpCelebrationUntil = now + 540;
      broadcastState();
    }
    lastTaskbarGroundY = groundY;

    if (!isDragging && (isAirborne || Math.abs(posY - groundY) > 1.5)) {
      posVy += 1950 * dt;
      posY += posVy * dt;
      if (posY >= groundY) {
        if (posVy > 220) {
          posY = groundY;
          posVy = -posVy * 0.24;
        } else {
          posY = groundY;
          posVy = 0;
          isAirborne = false;
        }
      }
      safeSetPosition(companionWin, posX, posY);
      if (reminderWin && !reminderWin.isDestroyed()) {
        positionPopoverAboveCompanion(reminderWin, REM_W, REM_H);
      }
    }

    // Smooth ~45Hz cursor look-at update while visible and facing front
    if (now - lastCursorBroadcast >= 22 && walkInTargetX === null && !walkOutActive) {
      lastCursorBroadcast = now;
      const cur = screen.getCursorScreenPoint();
      const cx = posX + compW * 0.5;
      const cy = posY + compH * 0.25;
      const nx = Math.max(-1, Math.min(1, (cur.x - cx) / 420));
      const ny = Math.max(-1, Math.min(1, (cur.y - cy) / 360));
      if (Math.abs(nx - lookX) > 0.015 || Math.abs(ny - lookY) > 0.015) {
        lookX = nx;
        lookY = ny;
        companionWin.webContents.send("wb:look", { lookX, lookY });
      }
    }

    // Phase 1: Peek from screen edge before stepping out (with Deep-Focus smart check)
    if (peekUntil > 0) {
      if (focusPeekPending) {
        const idleSecNow = getEffectiveIdleSeconds(now);
        if (focusPeekPending.engaged || (idleSecNow >= 2 && now - focusPeekPending.startedAt >= 1200)) {
          enterReminderFromFocusPeek();
          return;
        }
        if (now >= peekUntil) {
          retreatFromFocusPeek();
          return;
        }
      } else if (now >= peekUntil) {
        peekUntil = 0;
        turnHoldUntil = now + 180;
        broadcastState();
      }
      return;
    }

    // Phase 2: Walk-in entrance to reminder stop position (turn first, then walk)
    if (walkInTargetX !== null && !isDragging) {
      if (now < turnHoldUntil) return;
      const enterDir = activeEntrySide === "left" ? 1 : -1;
      const baseSpeed = Math.max(config.walk_speed * 2.5, 225);
      const remDist = Math.abs(walkInTargetX - posX);
      const easeOut = Math.min(1, Math.max(0.32, remDist / 90));
      posX += enterDir * baseSpeed * easeOut * dt;
      const arrived =
        (enterDir === 1 && posX >= walkInTargetX) ||
        (enterDir === -1 && posX <= walkInTargetX);
      if (arrived) {
        posX = walkInTargetX;
        walkInTargetX = null;
        if (pendingCelebrateDurationMs > 0) {
          celebrateUntil = now + pendingCelebrateDurationMs;
          pendingCelebrateDurationMs = 0;
          showReminderWindow();
        } else if (timer.status === "reminding" || welcomeActive) {
          showReminderWindow();
        }
        broadcastState();
      }
      safeSetPosition(companionWin, posX, posY);
      return;
    }

    // Phase 3: Walk-out exit (turn toward exit first, then walk off-screen)
    if (walkOutActive && !isDragging) {
      if (now < turnHoldUntil) return;
      const wa = getWorkArea();
      const baseExitSpeed = Math.max(config.walk_speed * 2.8, 255);
      const moveStartAt = Math.max(walkOutStartedAt, turnHoldUntil);
      const elapsedOut = Math.max(0, now - moveStartAt);
      const easeIn = Math.min(1, 0.38 + 0.62 * (elapsedOut / 320));
      posX += walkOutDir * baseExitSpeed * easeIn * dt;
      const exited =
        (walkOutDir === 1 && posX >= wa.x + wa.width + 16) ||
        (walkOutDir === -1 && posX <= wa.x - compW - 16);
      if (exited) {
        walkOutActive = false;
        activeGlbOverride = "";
        applyVisibilityMode();
        posX = wa.x + wa.width - compW - 36;
        if (!config.popup_only_mode) {
          safeSetPosition(companionWin, posX, posY);
        }
        broadcastState();
        return;
      }
      safeSetPosition(companionWin, posX, posY);
      return;
    }

    const hasModalOpen =
      (dashboardWin && !dashboardWin.isDestroyed()) ||
      (settingsWin && !settingsWin.isDestroyed());
    const canWalk =
      config.walk_enabled &&
      !isDragging &&
      !hasModalOpen &&
      timer.status !== "reminding" &&
      timer.status !== "paused" &&
      now >= celebrateUntil;

    if (!canWalk) return;

    if (now >= phaseEndsAt) {
      if (motionMode === "walk") {
        motionMode = "idle";
        phaseEndsAt = now + 2600 + Math.random() * 2800;
      } else {
        motionMode = "walk";
        if (Math.random() < 0.35) {
          walkDir *= -1;
        }
        turnHoldUntil = now + 220;
        phaseEndsAt = now + 5500 + Math.random() * 6500;
      }
      broadcastState();
      return;
    }

    if (motionMode === "walk") {
      if (now < turnHoldUntil) return;
      const wa = getWorkArea();
      const minX = wa.x + 12;
      const maxX = Math.max(minX, wa.x + wa.width - compW - 12);
      posX += walkDir * config.walk_speed * dt;
      if (posX <= minX) {
        posX = minX;
        walkDir = 1;
        turnHoldUntil = now + 220;
        broadcastState();
      } else if (posX >= maxX) {
        posX = maxX;
        walkDir = -1;
        turnHoldUntil = now + 220;
        broadcastState();
      }
      safeSetPosition(companionWin, posX, posY);
    }
  }, 11);
}

function quitApp() {
  isQuitting = true;
  try {
    globalShortcut.unregisterAll();
  } catch {
    // ignore
  }
  if (winRgnWorker && !winRgnWorker.killed) {
    try {
      winRgnWorker.kill();
    } catch {
      // ignore
    }
    winRgnWorker = null;
  }
  config.window_x = toInt(posX);
  config.window_y = toInt(posY);
  store.save(config, state);
  try {
    if (fs.existsSync(PID_LOCK_FILE)) {
      const recorded = fs.readFileSync(PID_LOCK_FILE, "utf8").trim();
      if (recorded === String(process.pid)) {
        fs.unlinkSync(PID_LOCK_FILE);
      }
    }
  } catch {
    // ignore cleanup error
  }
  app.quit();
}

function registerIpc() {
  ipcMain.handle("wb:get-state", () => buildPayload());
  ipcMain.handle("wb:drink", () => {
    handleDrink();
    return buildPayload();
  });
  ipcMain.handle("wb:confirm-reminder", () => {
    handleConfirmReminder();
    return buildPayload();
  });
  ipcMain.handle("wb:drink-size", (_evt, ml) => {
    handleDrink(ml);
    return buildPayload();
  });
  ipcMain.handle("wb:set-glass-ml", (_evt, ml) => {
    handleSetGlassMl(ml);
    return buildPayload();
  });
  ipcMain.handle("wb:trigger-pose", () => {
    handleTriggerPose();
    return buildPayload();
  });
  ipcMain.handle("wb:hop", () => {
    handleTriggerHop();
    return buildPayload();
  });
  ipcMain.handle("wb:welcome-mood", (_evt, mood) => {
    handleWelcomeMood(mood);
    return buildPayload();
  });
  ipcMain.handle("wb:show-sticky", () => {
    openStickyWindow();
    return buildPayload();
  });
  ipcMain.handle("wb:toggle-sticky", () => {
    toggleStickyWindow();
    return buildPayload();
  });
  ipcMain.handle("wb:close-sticky", () => {
    closeStickyWindow();
    return buildPayload();
  });
  ipcMain.handle("wb:save-sticky-notes", (_evt, nextNotes) => {
    config = store.save({ ...config, sticky_notes: Array.isArray(nextNotes) ? nextNotes : [] }, state);
    broadcastState();
    return buildPayload();
  });
  ipcMain.handle("wb:set-sticky-pin", (_evt, alwaysOnTop) => {
    const pinned = Boolean(alwaysOnTop);
    config = store.save({ ...config, sticky_always_on_top: pinned }, state);
    if (stickyWin && !stickyWin.isDestroyed()) {
      stickyWin.setAlwaysOnTop(pinned, pinned ? "screen-saver" : "normal");
    }
    broadcastState();
    return buildPayload();
  });
  ipcMain.handle("wb:save-sticky", (_evt, note) => {
    const cleanNote = String(note || "").trim().slice(0, 140);
    if (cleanNote) {
      const existing = Array.isArray(config.sticky_notes) ? config.sticky_notes : [];
      const nextNotes = [
        {
          id: "note_" + Date.now().toString(36),
          text: cleanNote,
          done: false,
          timerEndsAt: 0,
          alertFired: false,
        },
        ...existing,
      ].slice(0, 20);
      config = store.save({ ...config, sticky_notes: nextNotes }, state);
    }
    openStickyWindow();
    broadcastState();
    return buildPayload();
  });
  ipcMain.handle("wb:trigger-eod-recap", () => {
    handleTriggerEodRecap(true);
    return buildPayload();
  });
  ipcMain.handle("wb:preview-bedtime", () => {
    handleTriggerBedtimeAlert(new Date());
    return buildPayload();
  });
  ipcMain.handle("wb:preview-palette", (_evt, input) => parseQuickCommand(input));
  ipcMain.handle("wb:run-palette", (_evt, input) => executePaletteCommand(input));
  ipcMain.handle("wb:close-palette", () => {
    closePaletteWindow();
  });
  ipcMain.handle("wb:set-work-session", (_evt, mode) => {
    handleSetWorkSession(mode, true);
    return buildPayload();
  });
  ipcMain.handle("wb:trigger-habit", (_evt, title) => {
    handleTriggerHabit(title);
    return buildPayload();
  });
  ipcMain.handle("wb:undo-drink", () => {
    handleUndoDrink();
    return buildPayload();
  });
  ipcMain.handle("wb:snooze", () => {
    handleSnooze();
    return buildPayload();
  });
  ipcMain.handle("wb:reply-reminder", (_evt, actionKey) => {
    handleReplyReminder(actionKey);
    return buildPayload();
  });
  ipcMain.handle("wb:engage-peek", () => {
    handleEngagePeek();
    return buildPayload();
  });
  ipcMain.handle("wb:dismiss-reminder", () => {
    handleDismissReminder();
    return buildPayload();
  });
  ipcMain.handle("wb:toggle-pause", () => {
    handleTogglePause();
    return buildPayload();
  });
  ipcMain.handle("wb:toggle-dnd", (_evt, minutes) => {
    handleSetDnd(minutes);
    return buildPayload();
  });
  ipcMain.handle("wb:test-reminder", (_evt, kind) => {
    handleTriggerReminder(kind || "water", "", "other", true);
    return buildPayload();
  });
  ipcMain.handle("wb:start-countdown", (_evt, seconds) => {
    handleStartCountdown(seconds || 20);
    return buildPayload();
  });
  ipcMain.handle("wb:start-breathing", () => {
    handleStartBreathing();
    return buildPayload();
  });
  ipcMain.handle("wb:trigger-weekly-report", () => {
    handleTriggerWeeklyReport(true);
    return buildPayload();
  });
  ipcMain.handle("wb:reset-stats", () => {
    resetProgressState(state);
    refusalStreak = 0;
    config = store.save({ ...config, last_weekly_report_date: "" }, state);
    broadcastState();
    return buildPayload();
  });
  ipcMain.handle("wb:toggle-pomodoro", () => {
    handleTogglePomodoro();
    return buildPayload();
  });
  ipcMain.handle("wb:check-update", async () => {
    otaStatus = await checkForUpdate(app.getVersion(), config.ota_update_url);
    broadcastState();
    return otaStatus;
  });
  ipcMain.handle("wb:install-update", async () => {
    if (otaStatus && otaStatus.downloadUrl) {
      try {
        await downloadAndLaunchUpdate(otaStatus.downloadUrl, () => quitApp());
        return { ok: true };
      } catch (err) {
        const msg = err && err.message ? err.message : "Failed to download update.";
        otaStatus = { ...otaStatus, error: msg };
        broadcastState();
        return { ok: false, error: msg };
      }
    }
    return { ok: false, error: "No update download URL available." };
  });
  ipcMain.handle("wb:activate-pro-demo", () => {
    const key = generateLicenseKey(getMachineHwid());
    config = store.save({ ...config, license_key: key }, state);
    broadcastState();
    return buildPayload();
  });
  ipcMain.handle("wb:open-dashboard", () => {
    toggleDashboardWindow();
  });
  ipcMain.handle("wb:close-dashboard", () => {
    closeDashboardWindow();
    broadcastState();
  });
  ipcMain.handle("wb:open-settings", () => {
    openSettingsWindow();
  });
  ipcMain.handle("wb:close-settings", () => {
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
  });
  ipcMain.handle("wb:pick-glb", () => pickGlbFile());
  ipcMain.handle("wb:context-menu", () => {
    if (companionWin && !companionWin.isDestroyed()) {
      buildMenu().popup({ window: companionWin });
    }
  });
  ipcMain.handle("wb:save-config", (_evt, nextCfg) => {
    const { h: prevH } = getCompanionSize();
    const prevPomoEnabled = Boolean(config && config.pomodoro_enabled);
    activeGlbOverride = "";
    const clean = clampConfig({
      ...config,
      ...nextCfg,
      window_x: toInt(posX),
      window_y: toInt(posY),
    });
    if (clean.pomodoro_enabled && (!prevPomoEnabled || pomodoroEndsAt === 0)) {
      pomodoroPhase = "work";
      pomodoroEndsAt = Date.now() + clean.pomodoro_work_minutes * 60000;
    } else if (!clean.pomodoro_enabled) {
      pomodoroPhase = "work";
      pomodoroEndsAt = 0;
    } else if (clean.pomodoro_enabled && pomodoroEndsAt > 0) {
      const maxPhaseMs =
        (pomodoroPhase === "break" ? clean.pomodoro_break_minutes : clean.pomodoro_work_minutes) * 60000;
      pomodoroEndsAt = Math.min(pomodoroEndsAt, Date.now() + maxPhaseMs);
    }
    if (clean.start_on_boot !== isStartupEnabled()) {
      setStartupEnabled(
        clean.start_on_boot,
        PROJECT_ROOT,
        process.execPath,
        app.isPackaged
      );
    }
    config = store.save(clean, state);
    if (stickyWin && !stickyWin.isDestroyed()) {
      const pinned = config.sticky_always_on_top !== false;
      stickyWin.setAlwaysOnTop(pinned, pinned ? "screen-saver" : "normal");
    }
    if (settingsWin && !settingsWin.isDestroyed()) {
      const chrome = getThemeWindowChrome(config.ui_theme);
      settingsWin.setBackgroundColor(chrome.bg);
      if (typeof settingsWin.setTitleBarOverlay === "function") {
        try {
          settingsWin.setTitleBarOverlay({
            color: chrome.overlay,
            symbolColor: chrome.sym,
            height: 34,
          });
        } catch {
          // Non-Windows or unsupported overlay fallback
        }
      }
    }
    applyCompanionScaleBounds(prevH);
    config = store.save({ ...config, window_x: toInt(posX), window_y: toInt(posY) }, state);
    timer.updateIntervals(config.interval_minutes, config.snooze_minutes);
    syncGlobalHotkeys();
    if (config.weather_boost_enabled && !weatherCache) {
      refreshWeatherCache();
    }
    applyVisibilityMode();
    applyGhostMode();
    if (reminderWin && !reminderWin.isDestroyed()) {
      positionPopoverAboveCompanion(reminderWin, REM_W, REM_H);
    }
    broadcastState();
    return buildPayload();
  });
  ipcMain.handle("wb:quit", () => quitApp());

  ipcMain.on("wb:ghost-pass", (_evt, ignore) => {
    applyGhostMode(Boolean(ignore));
  });

  ipcMain.on("wb:clips", (_evt, clips) => {
    availableClips = Array.isArray(clips) ? clips : [];
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.webContents.send("wb:state", buildPayload());
    }
  });

  ipcMain.on("wb:drag-start", (_evt, { screenX, screenY }) => {
    isDragging = true;
    peekUntil = 0;
    walkInTargetX = null;
    walkOutActive = false;
    turnHoldUntil = 0;
    pendingCelebrateDurationMs = 0;
    const sx = Number.isFinite(Number(screenX)) ? Number(screenX) : posX;
    const sy = Number.isFinite(Number(screenY)) ? Number(screenY) : posY;
    dragOffset = { x: sx - posX, y: sy - posY };
    closeDashboardWindow();
    broadcastState();
  });

  ipcMain.on("wb:drag-move", (_evt, { screenX, screenY }) => {
    if (!isDragging || !companionWin || companionWin.isDestroyed()) return;
    if (!Number.isFinite(Number(screenX)) || !Number.isFinite(Number(screenY))) return;
    const clamped = clampWindowPos(Number(screenX) - dragOffset.x, Number(screenY) - dragOffset.y);
    posX = clamped.x;
    posY = clamped.y;
    safeSetPosition(companionWin, posX, posY);
    if (reminderWin && !reminderWin.isDestroyed()) {
      positionPopoverAboveCompanion(reminderWin, REM_W, REM_H);
    }
  });

  ipcMain.on("wb:drag-end", () => {
    isDragging = false;
    const { h: compH } = getCompanionSize();
    const groundY = getGroundY(compH);
    if (posY < groundY - 2) {
      isAirborne = true;
      posVy = 0;
    } else {
      posY = groundY;
      posVy = 0;
      isAirborne = false;
    }
    config.window_x = toInt(posX);
    config.window_y = toInt(groundY);
    store.save(config, state);
    broadcastState();
  });
}

function migrateLegacyUserData(targetDir) {
  try {
    const appDataDir = app.getPath("appData");
    migrateUserDataDir(targetDir, [
      path.join(appDataDir, "brio", "data"),
      path.join(appDataDir, "brio-dev", "data"),
      path.join(PROJECT_ROOT, "data"),
      path.join(appDataDir, "sipmate", "data"),
      path.join(appDataDir, "SipMate", "data"),
      path.join(appDataDir, "water-buddy", "data"),
      path.join(appDataDir, "Water Buddy", "data"),
    ]);
  } catch {
    // Non-fatal migration check
  }
}

app.whenReady().then(() => {
  const dataDir = getDataDir();
  migrateLegacyUserData(dataDir);
  store = new StateStore(dataDir);
  const loaded = store.load();
  config = loaded.config;
  state = loaded.state;
  timer = new HydrationTimer(config.interval_minutes, config.snooze_minutes);
  sysMonitor = new SystemMonitor(() => {
    try {
      return powerMonitor.getSystemIdleTime();
    } catch {
      return 0;
    }
  });
  stretchNextAt = Date.now() + config.stretch_interval_minutes * 60000;
  if (config.pomodoro_enabled) {
    pomodoroPhase = "work";
    pomodoroEndsAt = Date.now() + config.pomodoro_work_minutes * 60000;
  }
  const expectedStartupCmd = buildStartupCommand(PROJECT_ROOT, process.execPath, app.isPackaged);
  if (config.start_on_boot && !isStartupEnabled(expectedStartupCmd)) {
    setStartupEnabled(true, PROJECT_ROOT, process.execPath, app.isPackaged);
  }

  registerIpc();
  createTray();
  createCompanionWindow();
  startLoops();
  syncGlobalHotkeys();

  powerMonitor.on("suspend", () => {
    systemSuspended = true;
    if (!awayStartedAt) awayStartedAt = Date.now();
    if (timer) timer.lastTick = timer.clock();
  });
  powerMonitor.on("lock-screen", () => {
    screenLocked = true;
    if (!awayStartedAt) awayStartedAt = Date.now();
    if (timer) timer.lastTick = timer.clock();
  });
  powerMonitor.on("resume", () => {
    systemSuspended = false;
    try {
      screenLocked = powerMonitor.getSystemIdleState(1) === "locked";
    } catch {
      screenLocked = false;
    }
    if (!screenLocked) {
      scheduleWakeRecovery();
    }
  });
  powerMonitor.on("unlock-screen", () => {
    screenLocked = false;
    systemSuspended = false;
    scheduleWakeRecovery();
  });

  setTimeout(() => {
    refreshWeatherCache();
  }, 4000);
  setInterval(refreshWeatherCache, 2 * 60 * 60 * 1000);

  setTimeout(() => {
    checkForUpdate(app.getVersion(), config.ota_update_url)
      .then((res) => {
        otaStatus = res;
        broadcastState();
      })
      .catch(() => { });
  }, 6000);

  if (config.sticky_open) {
    openStickyWindow();
  }
  if (process.argv.includes("--settings")) {
    openSettingsWindow();
  }
  if (process.argv.includes("--trigger")) {
    setTimeout(() => handleTriggerReminder("water"), 600);
  } else if (config.welcome_on_start !== false) {
    setTimeout(() => handleTriggerWelcome(), 750);
  }
});

app.on("second-instance", (_evt, argv) => {
  if ((Array.isArray(argv) && argv.includes("--settings")) || config.popup_only_mode) {
    openSettingsWindow();
    return;
  }
  if (companionWin && !companionWin.isDestroyed()) {
    companionWin.showInactive();
    toggleDashboardWindow();
  }
});

app.on("window-all-closed", (e) => {
  e.preventDefault();
});
