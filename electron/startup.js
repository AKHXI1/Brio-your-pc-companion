"use strict";

const { execFileSync } = require("child_process");
const path = require("path");

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const VALUE_NAME = "Brio";
const LEGACY_NAMES = ["SipMate", "WaterBuddyReminder"];

function buildStartupCommand(projectRoot, electronExe = process.execPath, isPackaged = false) {
  const resolvedExe = path.resolve(electronExe);
  if (isPackaged) {
    return `"${resolvedExe}"`;
  }
  const resolvedRoot = path.resolve(projectRoot);
  return `"${resolvedExe}" "${resolvedRoot}"`;
}

function isStartupEnabled(expectedCmd = "") {
  if (process.platform !== "win32") return false;
  try {
    const out = execFileSync("reg", ["query", RUN_KEY, "/v", VALUE_NAME], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (!expectedCmd) return true;
    const match = /REG_(?:SZ|EXPAND_SZ)\s+(.+)/i.exec(String(out || ""));
    if (!match) return false;
    return match[1].trim().toLowerCase() === String(expectedCmd).trim().toLowerCase();
  } catch {
    return false;
  }
}

function setStartupEnabled(
  enabled,
  projectRoot,
  electronExe = process.execPath,
  isPackaged = false
) {
  if (process.platform !== "win32") return false;
  try {
    if (enabled) {
      const cmd = buildStartupCommand(projectRoot, electronExe, isPackaged);
      execFileSync(
        "reg",
        ["add", RUN_KEY, "/v", VALUE_NAME, "/t", "REG_SZ", "/d", cmd, "/f"],
        { stdio: "ignore", windowsHide: true }
      );
      for (const name of LEGACY_NAMES) {
        try {
          execFileSync(
            "reg",
            ["delete", RUN_KEY, "/v", name, "/f"],
            { stdio: "ignore", windowsHide: true }
          );
        } catch {
          // Legacy key not present
        }
      }
    } else {
      for (const name of [VALUE_NAME, ...LEGACY_NAMES]) {
        try {
          execFileSync(
            "reg",
            ["delete", RUN_KEY, "/v", name, "/f"],
            { stdio: "ignore", windowsHide: true }
          );
        } catch {
          // Already absent
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  buildStartupCommand,
  isStartupEnabled,
  setStartupEnabled,
};
