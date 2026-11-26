const { execFile } = require("child_process");

const PS_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class SipMateFg {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int pquns);
}
"@
$hwnd = [SipMateFg]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { "0"; exit }
$sb = New-Object System.Text.StringBuilder 256
[void][SipMateFg]::GetClassName($hwnd, $sb, 256)
$cls = $sb.ToString()
if ($cls -in @("Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow")) { "0"; exit }
$wpid = 0
[void][SipMateFg]::GetWindowThreadProcessId($hwnd, [ref]$wpid)
if ($wpid -eq __OWN_PID__) { "0"; exit }
$rect = New-Object SipMateFg+RECT
if (-not [SipMateFg]::GetWindowRect($hwnd, [ref]$rect)) { "0"; exit }
$zoomed = if ([SipMateFg]::IsZoomed($hwnd)) { 1 } else { 0 }
$quns = 0
[void][SipMateFg]::SHQueryUserNotificationState([ref]$quns)
Add-Type -AssemblyName System.Windows.Forms
$screen = [System.Windows.Forms.Screen]::FromHandle($hwnd).Bounds
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
"$wpid|$zoomed|$quns|$w|$h|$($rect.Left)|$($rect.Top)|$($screen.Width)|$($screen.Height)|$($screen.Left)|$($screen.Top)"
`.trim();

/**
 * Distinguishes true fullscreen apps (F11 video, 3D games, presentations)
 * from normal maximized desktop windows on auto-hide taskbars.
 *
 * QUNS values (Win32 SHQueryUserNotificationState):
 *   3 = QUNS_RUNNING_D3D_FULL_SCREEN, 4 = QUNS_PRESENTATION_MODE
 */
function classifyWindowFullscreen({
  pid = 0,
  ownPid = 0,
  isZoomed = false,
  quns = 0,
  width = 0,
  height = 0,
  left = 0,
  top = 0,
  screenWidth = 0,
  screenHeight = 0,
  screenLeft = 0,
  screenTop = 0,
} = {}) {
  if (!pid || pid === ownPid) return false;
  if (quns === 3 || quns === 4) return true;
  if (screenWidth <= 0 || screenHeight <= 0) return false;
  const coversScreen =
    width >= screenWidth - 2 &&
    height >= screenHeight - 2 &&
    left <= screenLeft + 2 &&
    top <= screenTop + 2;
  if (!coversScreen) return false;
  // Normal maximized work windows (VS Code, Antigravity, Chrome, etc.) have WS_MAXIMIZE (IsZoomed=true)
  // even when Windows Auto-Hide Taskbar lets them span 100% of display Bounds.
  if (isZoomed) return false;
  return true;
}

function isFullscreenAppActive(ownPid = process.pid) {
  if (process.platform !== "win32") return Promise.resolve(false);
  const safeOwnPid = Math.max(0, Math.round(Number(ownPid) || 0));
  const script = PS_SCRIPT.replace("__OWN_PID__", String(safeOwnPid));
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
      { timeout: 1800, windowsHide: true },
      (err, stdout) => {
        if (err) {
          resolve(false);
          return;
        }
        const out = String(stdout || "").trim();
        if (!out || out === "0") {
          resolve(false);
          return;
        }
        const parts = out.split("|").map((v) => Number(v));
        if (parts.length < 11 || parts.some((n) => !Number.isFinite(n))) {
          resolve(false);
          return;
        }
        const [pid, zoomed, quns, width, height, left, top, screenWidth, screenHeight, screenLeft, screenTop] = parts;
        resolve(
          classifyWindowFullscreen({
            pid,
            ownPid: safeOwnPid,
            isZoomed: zoomed === 1,
            quns,
            width,
            height,
            left,
            top,
            screenWidth,
            screenHeight,
            screenLeft,
            screenTop,
          })
        );
      }
    );
  });
}

module.exports = { isFullscreenAppActive, classifyWindowFullscreen };
