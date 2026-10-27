// Impostazioni dell'app con valori predefiniti, salvate in IndexedDB
// (con copia in localStorage per applicare subito il tema all'avvio).
import { get, put } from "./db.js";

export const DEFAULTS = {
  theme: "vesuvio",
  controls: { opacity: 0.8, scale: 1, dpad: "slide", haptics: true, labels: true },
  turbo: { mode: "toggle", ratio: 3, mute: true },
  autosave: {
    intervalSec: 30,
    warmupSec: 15,
    keepAuto: 12,
    checkpointEveryMin: 10,
    keepCheckpoints: 12,
    keepSessions: 10,
    keepPreRestore: 6,
    keepSaves: 30,
  },
  watchdog: { hardSec: 8, softSec: 60, softMinInputs: 4 },
  view: { nds: "both", ndsLandscape: "both" },
  showSpeed: true,
  keyboard: {
    ArrowUp: "UP", ArrowDown: "DOWN", ArrowLeft: "LEFT", ArrowRight: "RIGHT",
    KeyX: "A", KeyZ: "B", KeyS: "X", KeyA: "Y", KeyQ: "L", KeyW: "R",
    Enter: "START", ShiftRight: "SELECT", Backspace: "SELECT",
  },
  hotkeys: { Space: "turbo", F2: "quicksave", F4: "quickload", Escape: "menu", KeyP: "pause" },
};

let cache = null;

function merge(base, over) {
  if (!over || typeof over !== "object") return structuredClone(base);
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object") out[k] = merge(base[k], v);
    else out[k] = v;
  }
  return out;
}

export async function loadSettings() {
  if (cache) return cache;
  let stored = null;
  try { stored = (await get("settings", "app"))?.value; } catch (_) { stored = null; }
  cache = merge(DEFAULTS, stored);
  return cache;
}

export function settingsSync() {
  return cache || merge(DEFAULTS, readLocal());
}

function readLocal() {
  try { return JSON.parse(localStorage.getItem("vesuvio.settings") || "null"); } catch (_) { return null; }
}

export async function saveSettings(patch) {
  const cur = await loadSettings();
  cache = merge(cur, patch);
  await put("settings", { key: "app", value: cache });
  try { localStorage.setItem("vesuvio.settings", JSON.stringify(cache)); } catch (_) { /* quota */ }
  return cache;
}

export async function getValue(key, fallback = null) {
  try { return (await get("settings", key))?.value ?? fallback; } catch (_) { return fallback; }
}

export async function setValue(key, value) {
  await put("settings", { key, value });
}
