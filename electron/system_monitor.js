"use strict";

const os = require("os");

function readCpuTotals() {
  const cpus = os.cpus() || [];
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const t = cpu.times || {};
    const cIdle = Number(t.idle) || 0;
    const cTotal =
      cIdle +
      (Number(t.user) || 0) +
      (Number(t.nice) || 0) +
      (Number(t.sys) || 0) +
      (Number(t.irq) || 0);
    idle += cIdle;
    total += cTotal;
  }
  return { idle, total };
}

class SystemMonitor {
  constructor(getIdleSeconds = () => 0, clock = () => Date.now() / 1000) {
    this.getIdleSeconds = getIdleSeconds;
    this.clock = clock;
    this.prevCpu = readCpuTotals();
    this.cpuHistory = [];
    this.cpuPercent = 0;
    this.ramPercent = 0;
    this.continuousActiveSeconds = 0;
    this.eyeActiveSeconds = 0;
    this.stretchActiveSeconds = 0;
    this.idleSeconds = 0;
    this.idleState = "active"; // active | paused | eye_rested | reset | off_hours
    this.lastSampleAt = this.clock();
    this.lastAlertAt = 0;
  }

  sample({
    pauseSeconds = 60,
    resetSeconds = 180,
    eyeIdleResetSeconds = 25,
    inWorkWindow = true,
  } = {}) {
    const now = this.clock();
    const dt = Math.max(0, Math.min(30, now - this.lastSampleAt));
    this.lastSampleAt = now;

    // CPU delta
    const curCpu = readCpuTotals();
    const dTotal = curCpu.total - this.prevCpu.total;
    const dIdle = curCpu.idle - this.prevCpu.idle;
    this.prevCpu = curCpu;

    if (dTotal > 0) {
      const pct = Math.max(0, Math.min(100, Math.round(((dTotal - dIdle) / dTotal) * 100)));
      this.cpuHistory.push(pct);
      if (this.cpuHistory.length > 4) this.cpuHistory.shift();
      const sum = this.cpuHistory.reduce((a, b) => a + b, 0);
      this.cpuPercent = Math.round(sum / this.cpuHistory.length);
    }

    // RAM usage
    const totalMem = os.totalmem() || 1;
    const freeMem = os.freemem() || 0;
    this.ramPercent = Math.max(0, Math.min(100, Math.round(((totalMem - freeMem) / totalMem) * 100)));

    let idleSec = 0;
    try {
      idleSec = Math.max(0, Number(this.getIdleSeconds()) || 0);
    } catch {
      idleSec = 0;
    }
    this.idleSeconds = idleSec;

    if (!inWorkWindow) {
      this.continuousActiveSeconds = 0;
      this.eyeActiveSeconds = 0;
      this.stretchActiveSeconds = 0;
      this.idleState = "off_hours";
      return this.getStats();
    }

    const pSec = Math.max(15, Number(pauseSeconds) || 60);
    const rSec = Math.max(pSec + 15, Number(resetSeconds) || 180);
    const eyeResetSec = Math.max(10, Math.min(pSec, Number(eyeIdleResetSeconds) || 25));

    // Per-break ergonomic idle logic:
    // - Away >= resetSeconds (e.g. 3m): resets all break timers
    // - Micro-pause >= eyeIdleResetSeconds (e.g. 25s): natural glance away rests eyes (resets eye timer) & pauses longer timers
    // - Pause >= pauseSeconds (e.g. 60s): pauses Stretch & Stand timers
    if (idleSec >= rSec) {
      this.continuousActiveSeconds = 0;
      this.eyeActiveSeconds = 0;
      this.stretchActiveSeconds = 0;
      this.idleState = "reset";
    } else if (idleSec >= pSec) {
      this.eyeActiveSeconds = 0;
      this.idleState = "paused";
    } else if (idleSec >= eyeResetSec) {
      this.eyeActiveSeconds = 0;
      this.idleState = "eye_rested";
    } else {
      this.continuousActiveSeconds += dt;
      this.eyeActiveSeconds += dt;
      this.stretchActiveSeconds += dt;
      this.idleState = "active";
    }

    return this.getStats();
  }

  resetActiveTime() {
    this.continuousActiveSeconds = 0;
  }

  resetEyeTime() {
    this.eyeActiveSeconds = 0;
  }

  resetStretchTime() {
    this.stretchActiveSeconds = 0;
    this.eyeActiveSeconds = 0;
  }

  resetStandAndAllBreaks() {
    this.continuousActiveSeconds = 0;
    this.stretchActiveSeconds = 0;
    this.eyeActiveSeconds = 0;
  }

  shouldTriggerAlert({
    enabled = true,
    activeLimitMinutes = 90,
    cpuThreshold = 85,
    cooldownSeconds = 1800,
  } = {}) {
    if (!enabled) return null;
    const now = this.clock();
    if (this.lastAlertAt > 0 && now - this.lastAlertAt < cooldownSeconds) {
      return null;
    }
    const activeMins = this.continuousActiveSeconds / 60;
    if (activeMins >= Math.max(15, activeLimitMinutes)) {
      this.lastAlertAt = now;
      return "active_time";
    }
    if (
      this.cpuHistory.length >= 3 &&
      this.cpuPercent >= Math.max(50, cpuThreshold)
    ) {
      this.lastAlertAt = now;
      return "high_load";
    }
    return null;
  }

  getStats() {
    return {
      cpuPercent: this.cpuPercent,
      ramPercent: this.ramPercent,
      continuousActiveMinutes: Math.floor(this.continuousActiveSeconds / 60),
      continuousActiveSeconds: Math.round(this.continuousActiveSeconds),
      eyeActiveMinutes: Math.floor(this.eyeActiveSeconds / 60),
      eyeActiveSeconds: Math.round(this.eyeActiveSeconds),
      stretchActiveMinutes: Math.floor(this.stretchActiveSeconds / 60),
      stretchActiveSeconds: Math.round(this.stretchActiveSeconds),
      idleSeconds: Math.round(this.idleSeconds),
      idleState: this.idleState,
    };
  }
}

module.exports = { SystemMonitor };
