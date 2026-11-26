"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const api = {
  getState: () => ipcRenderer.invoke("wb:get-state"),
  drink: () => ipcRenderer.invoke("wb:drink"),
  confirmReminder: () => ipcRenderer.invoke("wb:confirm-reminder"),
  drinkWithSize: (ml) => ipcRenderer.invoke("wb:drink-size", ml),
  setGlassMl: (ml) => ipcRenderer.invoke("wb:set-glass-ml", ml),
  triggerPose: () => ipcRenderer.invoke("wb:trigger-pose"),
  triggerHop: () => ipcRenderer.invoke("wb:hop"),
  selectWelcomeMood: (mood) => ipcRenderer.invoke("wb:welcome-mood", mood),
  showStickyNote: () => ipcRenderer.invoke("wb:show-sticky"),
  toggleStickyBoard: () => ipcRenderer.invoke("wb:toggle-sticky"),
  closeStickyBoard: () => ipcRenderer.invoke("wb:close-sticky"),
  saveStickyNote: (note) => ipcRenderer.invoke("wb:save-sticky", note),
  saveStickyNotes: (notes) => ipcRenderer.invoke("wb:save-sticky-notes", notes),
  setStickyPin: (alwaysOnTop) => ipcRenderer.invoke("wb:set-sticky-pin", alwaysOnTop),
  triggerHabit: (title) => ipcRenderer.invoke("wb:trigger-habit", title),
  triggerEodRecap: () => ipcRenderer.invoke("wb:trigger-eod-recap"),
  previewBedtime: () => ipcRenderer.invoke("wb:preview-bedtime"),
  previewPaletteCommand: (input) => ipcRenderer.invoke("wb:preview-palette", input),
  runPaletteCommand: (input) => ipcRenderer.invoke("wb:run-palette", input),
  closePalette: () => ipcRenderer.invoke("wb:close-palette"),
  setWorkSession: (mode) => ipcRenderer.invoke("wb:set-work-session", mode),
  undoDrink: () => ipcRenderer.invoke("wb:undo-drink"),
  snooze: () => ipcRenderer.invoke("wb:snooze"),
  replyReminder: (actionKey) => ipcRenderer.invoke("wb:reply-reminder", actionKey),
  engagePeek: () => ipcRenderer.invoke("wb:engage-peek"),
  dismissReminder: () => ipcRenderer.invoke("wb:dismiss-reminder"),
  togglePause: () => ipcRenderer.invoke("wb:toggle-pause"),
  toggleDnd: (minutes) => ipcRenderer.invoke("wb:toggle-dnd", minutes),
  testReminder: (kind) => ipcRenderer.invoke("wb:test-reminder", kind),
  startCountdown: (seconds) => ipcRenderer.invoke("wb:start-countdown", seconds),
  startBreathing: () => ipcRenderer.invoke("wb:start-breathing"),
  triggerWeeklyReport: () => ipcRenderer.invoke("wb:trigger-weekly-report"),
  resetStats: () => ipcRenderer.invoke("wb:reset-stats"),
  togglePomodoro: () => ipcRenderer.invoke("wb:toggle-pomodoro"),
  checkUpdate: () => ipcRenderer.invoke("wb:check-update"),
  installUpdate: () => ipcRenderer.invoke("wb:install-update"),
  activateProDemo: () => ipcRenderer.invoke("wb:activate-pro-demo"),
  openDashboard: () => ipcRenderer.invoke("wb:open-dashboard"),
  closeDashboard: () => ipcRenderer.invoke("wb:close-dashboard"),
  openSettings: () => ipcRenderer.invoke("wb:open-settings"),
  closeSettings: () => ipcRenderer.invoke("wb:close-settings"),
  saveConfig: (cfg) => ipcRenderer.invoke("wb:save-config", cfg),
  pickGlbFile: () => ipcRenderer.invoke("wb:pick-glb"),
  showContextMenu: () => ipcRenderer.invoke("wb:context-menu"),
  reportAvailableClips: (clips) => ipcRenderer.send("wb:clips", clips),
  dragStart: (screenX, screenY) => ipcRenderer.send("wb:drag-start", { screenX, screenY }),
  dragMove: (screenX, screenY) => ipcRenderer.send("wb:drag-move", { screenX, screenY }),
  dragEnd: () => ipcRenderer.send("wb:drag-end"),
  setGhostPassThrough: (ignore) => ipcRenderer.send("wb:ghost-pass", Boolean(ignore)),
  quit: () => ipcRenderer.invoke("wb:quit"),

  onStateUpdate: (cb) => {
    const listener = (_evt, data) => cb(data);
    ipcRenderer.on("wb:state", listener);
    return () => ipcRenderer.removeListener("wb:state", listener);
  },
  onLookUpdate: (cb) => {
    const listener = (_evt, data) => cb(data);
    ipcRenderer.on("wb:look", listener);
    return () => ipcRenderer.removeListener("wb:look", listener);
  },
};

contextBridge.exposeInMainWorld("brio", api);
contextBridge.exposeInMainWorld("sipMate", api);
contextBridge.exposeInMainWorld("waterBuddy", api);
