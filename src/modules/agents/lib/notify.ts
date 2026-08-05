import { IS_MAC, IS_WINDOWS } from "@/lib/platform";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

// Platform-specific tokens: macOS resolves a system sound file by name (an
// unset sound means silent), Windows toasts require the literal "Default",
// Linux takes an XDG sound-theme name.
const SOUND = IS_MAC ? "Glass" : IS_WINDOWS ? "Default" : "message-new-instant";

let granted = false;

async function ensurePermission(): Promise<boolean> {
  // Cache only the positive result: a transient denial (e.g. the OS prompt
  // dismissed while unfocused) must not disable notifications for the session.
  if (granted) return true;
  let ok = await isPermissionGranted();
  if (!ok) ok = (await requestPermission()) === "granted";
  granted = ok;
  return ok;
}

export async function osNotify(title: string, body: string): Promise<void> {
  try {
    if (await ensurePermission())
      sendNotification({ title, body, sound: SOUND });
  } catch (e) {
    console.warn("[pide] os notification failed:", e);
  }
}
