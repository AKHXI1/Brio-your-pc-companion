"use strict";

const { execFileSync, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const electronBin = require("electron");
const projectRoot = path.resolve(__dirname, "..");
const pidLockFile = path.join(os.tmpdir(), "brio-companion.pid");

function stopExistingBrioInstances() {
  let stoppedAny = false;
  try {
    if (fs.existsSync(pidLockFile)) {
      const oldPid = Number(fs.readFileSync(pidLockFile, "utf8").trim());
      if (Number.isFinite(oldPid) && oldPid > 0) {
        try {
          process.kill(oldPid);
          stoppedAny = true;
        } catch {
          // Process already exited
        }
      }
    }
  } catch {
    // ignore
  }

  if (process.platform === "win32") {
    for (const img of ["Brio.exe", "SipMate.exe"]) {
      try {
        execFileSync("taskkill.exe", ["/F", "/IM", img, "/T"], {
          windowsHide: true,
          stdio: "ignore",
          timeout: 2000,
        });
        stoppedAny = true;
      } catch {
        // Not running
      }
    }
    try {
      const escapedBin = path.resolve(electronBin).replace(/'/g, "''");
      const psCmd =
        `Get-Process -Name electron -ErrorAction SilentlyContinue | ` +
        `Where-Object { $_.Path -eq '${escapedBin}' } | ` +
        `Stop-Process -Force -ErrorAction SilentlyContinue`;
      execFileSync("powershell.exe", ["-NoProfile", "-Command", psCmd], {
        windowsHide: true,
        stdio: "ignore",
        timeout: 4500,
      });
    } catch {
      // Non-fatal cleanup
    }
  }

  if (stoppedAny) {
    const until = Date.now() + 250;
    while (Date.now() < until) {
      // short wait for file handles to release
    }
  }
}

stopExistingBrioInstances();

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBin, [projectRoot, ...process.argv.slice(2)], {
  env,
  stdio: "inherit",
  detached: false,
});

child.on("exit", (code) => {
  process.exit(code || 0);
});
