"use strict";

const { execFile } = require("child_process");
const https = require("https");

const MEETING_RE =
  /zoom(\.exe|\s+meeting|\s+workplace)?|microsoft\s*teams|teams\.exe|google\s*meet|meet\.google|webex|discord.*voice|slack.*huddle|skype/i;
const CODING_RE =
  /visual\s*studio\s*code|code\.exe|cursor|pycharm|intellij|webstorm|android\s*studio|rider|devenv|windows\s*terminal|powershell|cmd\.exe|sublime|neovim|antigravity/i;
const VIDEO_RE =
  /youtube|netflix|prime\s*video|hotstar|jiohotstar|vlc|media\s*player|spotify|twitch|disney\+/i;

function classifyForegroundApp(title = "", processName = "") {
  const combined = `${String(title || "")} ${String(processName || "")}`.trim();
  if (!combined) return "other";
  if (MEETING_RE.test(combined)) return "meeting";
  if (CODING_RE.test(combined)) return "coding";
  if (VIDEO_RE.test(combined)) return "video";
  return "other";
}

const ACTIVE_WIN_PS = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class SipMateWinInfo {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
$h = [SipMateWinInfo]::GetForegroundWindow()
if ($h -eq [IntPtr]::Zero) { "{}"; exit }
$sb = New-Object System.Text.StringBuilder 256
[void][SipMateWinInfo]::GetWindowText($h, $sb, 256)
$wpid = 0
[void][SipMateWinInfo]::GetWindowThreadProcessId($h, [ref]$wpid)
if ($wpid -eq __OWN_PID__) { "{}"; exit }
$pname = ""
try { $pname = (Get-Process -Id $wpid -ErrorAction SilentlyContinue).ProcessName } catch {}
@{ title = $sb.ToString(); processName = $pname } | ConvertTo-Json -Compress
`.trim();

function getActiveWindowContext(ownPid = process.pid) {
  if (process.platform !== "win32") {
    return Promise.resolve({ title: "", processName: "", category: "other" });
  }
  const safeOwnPid = Math.max(0, Math.round(Number(ownPid) || 0));
  const script = ACTIVE_WIN_PS.replace("__OWN_PID__", String(safeOwnPid));
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
      { timeout: 1500, windowsHide: true },
      (err, stdout) => {
        if (err) {
          resolve({ title: "", processName: "", category: "other" });
          return;
        }
        try {
          const parsed = JSON.parse(String(stdout || "{}").trim() || "{}");
          const title = String(parsed.title || "");
          const processName = String(parsed.processName || "");
          resolve({
            title,
            processName,
            category: classifyForegroundApp(title, processName),
          });
        } catch {
          resolve({ title: "", processName: "", category: "other" });
        }
      }
    );
  });
}

function httpsGetJson(url, timeoutMs = 4500) {
  return new Promise((resolve) => {
    const req = https.get(
      url,
      {
        headers: { "User-Agent": "SipMate/2.0 (hydration-companion)" },
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(null);
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function fetchWeatherTemperature() {
  const geo = await httpsGetJson("https://ipapi.co/json/", 4000);
  if (!geo || !Number.isFinite(Number(geo.latitude)) || !Number.isFinite(Number(geo.longitude))) {
    return null;
  }
  const lat = Number(geo.latitude);
  const lon = Number(geo.longitude);
  const wx = await httpsGetJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`,
    4500
  );
  const tempRaw = wx && wx.current_weather ? Number(wx.current_weather.temperature) : NaN;
  if (!Number.isFinite(tempRaw)) return null;
  const tempC = Math.round(tempRaw);
  return {
    tempC,
    city: String(geo.city || ""),
    isHot: tempC >= 31,
    fetchedAt: Date.now(),
  };
}

function summarizeWeeklyStats(recentDaysList = [], dailyGoal = 8, glassMl = 250, dailyGoalMl = 0) {
  const days = Array.isArray(recentDaysList) ? recentDaysList : [];
  const safeGoal = Math.max(1, Math.round(Number(dailyGoal) || 8));
  const safeMl = Math.max(50, Math.round(Number(glassMl) || 250));
  const safeGoalMl = Math.max(0, Math.round(Number(dailyGoalMl) || 0));
  let totalGlasses = 0;
  let totalMl = 0;
  let goalsHitDays = 0;
  let bestCount = 0;
  let bestMl = 0;
  for (const d of days) {
    const cnt = Math.max(0, Math.round(Number(d && d.count) || 0));
    const dayMlRaw = Number(d && d.ml);
    const dayMl = Number.isFinite(dayMlRaw) && dayMlRaw >= 0 ? Math.round(dayMlRaw) : cnt * safeMl;
    totalGlasses += cnt;
    totalMl += dayMl;
    const hit = safeGoalMl > 0 && dayMl > 0 ? dayMl >= safeGoalMl : cnt >= safeGoal;
    if (hit) goalsHitDays += 1;
    if (cnt > bestCount) bestCount = cnt;
    if (dayMl > bestMl) bestMl = dayMl;
  }
  const avgGlasses = days.length > 0 ? Math.round((totalGlasses / days.length) * 10) / 10 : 0;
  const avgLiters = days.length > 0 ? Math.round((totalMl / days.length / 1000) * 100) / 100 : 0;
  return {
    totalGlasses,
    totalMl,
    totalLiters: Math.round((totalMl / 1000) * 100) / 100,
    goalsHitDays,
    bestCount,
    bestMl,
    avgGlasses,
    avgLiters,
  };
}

function getLightingPeriod(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  const h = d.getHours();
  if (h >= 6 && h < 11) return "morning";
  if (h >= 11 && h < 17) return "day";
  if (h >= 17 && h < 20) return "evening";
  return "night";
}

function getBatteryStatus() {
  if (process.platform !== "win32") {
    return Promise.resolve({ hasBattery: false, percent: 100, isCharging: true });
  }
  const ps =
    '$b = Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1; if (-not $b) { \'{"hasBattery":false,"percent":100,"isCharging":true}\' } else { @{ hasBattery = $true; percent = [int]$b.EstimatedChargeRemaining; isCharging = ($b.BatteryStatus -eq 2 -or $b.BatteryStatus -eq 6 -or $b.BatteryStatus -eq 7 -or $b.BatteryStatus -eq 8 -or $b.BatteryStatus -eq 9) } | ConvertTo-Json -Compress }';
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", ps],
      { timeout: 1800, windowsHide: true },
      (err, stdout) => {
        if (err) {
          resolve({ hasBattery: false, percent: 100, isCharging: true });
          return;
        }
        try {
          const parsed = JSON.parse(String(stdout || "{}").trim() || "{}");
          resolve({
            hasBattery: Boolean(parsed.hasBattery),
            percent: Math.max(0, Math.min(100, Math.round(Number(parsed.percent) || 100))),
            isCharging: Boolean(parsed.isCharging),
          });
        } catch {
          resolve({ hasBattery: false, percent: 100, isCharging: true });
        }
      }
    );
  });
}

function detectSpecialOccasion(birthdayMmDd = "", now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  const mmdd = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (birthdayMmDd && birthdayMmDd === mmdd) {
    return "birthday";
  }
  const table = {
    "01-01": "new_year",
    "01-26": "republic_day",
    "04-14": "vishu",
    "08-15": "independence_day",
    "11-01": "kerala_piravi",
    "12-25": "christmas",
  };
  return table[mmdd] || "";
}

module.exports = {
  classifyForegroundApp,
  getActiveWindowContext,
  fetchWeatherTemperature,
  summarizeWeeklyStats,
  getLightingPeriod,
  getBatteryStatus,
  detectSpecialOccasion,
};
