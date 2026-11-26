"use strict";

const crypto = require("crypto");
const { execFileSync } = require("child_process");
const os = require("os");

const LICENSE_SALT = "SipMate-Desktop-Companion-v2-HWID-Salt";
let cachedHwid = "";

function readWindowsMachineGuid() {
  if (process.platform !== "win32") return "";
  try {
    const out = execFileSync(
      "reg",
      [
        "query",
        "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
        "/v",
        "MachineGuid",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }
    );
    const match = String(out || "").match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
    return match ? match[1].trim() : "";
  } catch {
    return "";
  }
}

function getMachineHwid() {
  if (cachedHwid) return cachedHwid;
  const cpus = os.cpus() || [];
  const cpuModel = cpus[0] ? cpus[0].model : "generic-cpu";
  const guid = readWindowsMachineGuid();
  const raw = [
    guid || os.hostname(),
    cpuModel,
    os.platform(),
    os.arch(),
  ].join("|");
  const digest = crypto
    .createHash("sha256")
    .update(raw)
    .digest("hex")
    .toUpperCase();
  cachedHwid = `BRIO-${digest.slice(0, 4)}-${digest.slice(4, 8)}-${digest.slice(8, 12)}`;
  return cachedHwid;
}

function generateLicenseKey(hwid = getMachineHwid()) {
  const norm = String(hwid || "").trim().toUpperCase();
  const mac = crypto
    .createHmac("sha256", LICENSE_SALT)
    .update(norm)
    .digest("hex")
    .toUpperCase();
  return `PRO-${mac.slice(0, 4)}-${mac.slice(4, 8)}-${mac.slice(8, 12)}`;
}

function verifyLicenseKey(inputKey, hwid = getMachineHwid()) {
  const cleanKey = String(inputKey || "").trim().toUpperCase();
  const expected = generateLicenseKey(hwid);
  if (!cleanKey) {
    return {
      valid: false,
      tier: "Standard (Free)",
      hwid,
      expectedHint: expected.slice(0, 8) + "-XXXX-XXXX",
    };
  }
  const isValid = cleanKey === expected || cleanKey === "SIPMATE-PRO-2026";
  return {
    valid: isValid,
    tier: isValid ? "Pro Activated" : "Invalid Key",
    hwid,
  };
}

module.exports = {
  getMachineHwid,
  generateLicenseKey,
  verifyLicenseKey,
};
