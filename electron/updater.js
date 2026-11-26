"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const https = require("https");
const http = require("http");
const os = require("os");
const path = require("path");

function parseSemver(v) {
  const clean = String(v || "")
    .trim()
    .replace(/^v/i, "");
  const parts = clean.split(".").map((n) => parseInt(n, 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function isNewerVersion(latest, current) {
  const [la, lb, lc] = parseSemver(latest);
  const [ca, cb, cc] = parseSemver(current);
  if (la !== ca) return la > ca;
  if (lb !== cb) return lb > cb;
  return lc > cc;
}

function fetchJson(urlStr, redirectsLeft = 4) {
  return new Promise((resolve, reject) => {
    if (!urlStr || !/^https?:\/\//i.test(urlStr)) {
      reject(new Error("Invalid update URL"));
      return;
    }
    const client = urlStr.startsWith("https") ? https : http;
    const req = client.get(
      urlStr,
      {
        headers: { "User-Agent": "Brio-OTA-Updater/1.0" },
        timeout: 6500,
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          res.resume();
          let nextUrl = res.headers.location;
          try {
            nextUrl = new URL(res.headers.location, urlStr).href;
          } catch {
            // keep raw location
          }
          fetchJson(nextUrl, redirectsLeft - 1)
            .then(resolve)
            .catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
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
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("Update check timed out"));
    });
  });
}

async function checkForUpdate(currentVersion = "1.0.0", updateUrl = "") {
  const cleanUrl = String(updateUrl || "").trim();
  if (!cleanUrl) {
    return {
      checked: true,
      updateAvailable: false,
      currentVersion,
      latestVersion: currentVersion,
      downloadUrl: "",
      releaseNotes: "Up to date (no remote OTA endpoint configured).",
    };
  }
  try {
    const data = await fetchJson(cleanUrl);
    // Support both version.json ({ version, url, notes }) and GitHub Releases API ({ tag_name, assets, body })
    const latestVersion = String(data.version || data.tag_name || currentVersion).replace(/^v/i, "");
    let downloadUrl = String(data.url || data.downloadUrl || "").trim();
    if (!downloadUrl && Array.isArray(data.assets)) {
      const exeAsset = data.assets.find(
        (a) => a && typeof a.browser_download_url === "string" && /\.exe$/i.test(a.browser_download_url)
      );
      if (exeAsset) downloadUrl = exeAsset.browser_download_url;
    }
    const releaseNotes = String(data.notes || data.body || "").trim();
    const updateAvailable = isNewerVersion(latestVersion, currentVersion);
    return {
      checked: true,
      updateAvailable,
      currentVersion,
      latestVersion,
      downloadUrl,
      releaseNotes,
    };
  } catch (err) {
    return {
      checked: false,
      updateAvailable: false,
      currentVersion,
      latestVersion: currentVersion,
      downloadUrl: "",
      error: err && err.message ? err.message : "Update check failed",
    };
  }
}

function downloadFile(urlStr, destFile, redirectsLeft = 4) {
  return new Promise((resolve, reject) => {
    if (!urlStr || !/^https?:\/\//i.test(urlStr)) {
      reject(new Error("Invalid installer URL"));
      return;
    }
    const client = urlStr.startsWith("https") ? https : http;
    const req = client.get(
      urlStr,
      { headers: { "User-Agent": "Brio-OTA-Updater/1.0" }, timeout: 60000 },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          res.resume();
          let nextUrl = res.headers.location;
          try {
            nextUrl = new URL(res.headers.location, urlStr).href;
          } catch {
            // keep raw location
          }
          downloadFile(nextUrl, destFile, redirectsLeft - 1)
            .then(resolve)
            .catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const out = fs.createWriteStream(destFile);
        const failAndCleanup = (err) => {
          out.destroy();
          fs.unlink(destFile, () => {});
          reject(err);
        };
        res.on("error", failAndCleanup);
        out.on("error", failAndCleanup);
        out.on("finish", () => {
          out.close(() => resolve(destFile));
        });
        res.pipe(out);
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("Installer download timed out"));
    });
  });
}

async function downloadAndLaunchUpdate(downloadUrl, onBeforeQuit = () => {}) {
  const destFile = path.join(os.tmpdir(), `Brio-Update-${Date.now()}.exe`);
  await downloadFile(downloadUrl, destFile);
  const child = spawn(destFile, [], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  onBeforeQuit();
  return destFile;
}

module.exports = {
  parseSemver,
  isNewerVersion,
  checkForUpdate,
  downloadAndLaunchUpdate,
};
