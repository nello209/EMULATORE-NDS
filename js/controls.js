// Controlli touch, tastiera e gamepad.
//
// Croce direzionale "scorrevole": un'unica area; la direzione dipende da dove
// si trova il dito rispetto al centro, quindi si puo' trascinare senza alzarlo.
// Le diagonali hanno settori stretti (30°) per evitare passi storti nei giochi
// a griglia come Pokémon. Pulsanti A/B/X/Y: il dito puo' scorrere da uno
// all'altro. Ogni dito e' tracciato separatamente (multi-touch).

import { BUTTON } from "./engine.js";
import { h } from "./util.js";

const DIRS = ["RIGHT", "DOWN", "LEFT", "UP"];

/** Direzioni premute dato un vettore (dx, dy) normalizzato sul raggio. */
export function dpadDirections(dx, dy, dead = 0.22) {
  const dist = Math.hypot(dx, dy);
  if (dist < dead) return [];
  let ang = (Math.atan2(dy, dx) * 180) / Math.PI; // 0 = destra, 90 = giu'
  if (ang < 0) ang += 360;
  const sector = Math.round(ang / 90) % 4;
  const off = ang - sector * 90;
  const offN = ((off + 540) % 360) - 180;
  const main = DIRS[sector];
  if (Math.abs(offN) <= 30) return [main];
  // tra 30° e 45° dal cardinale: diagonale
  const other = DIRS[(sector + (offN > 0 ? 1 : 3)) % 4];
  return [main, other];
}

const LAYOUTS = {
  nds: { face: ["X", "A", "B", "Y"], shoulders: true, extra: true },
  gba: { face: ["A", "B"], shoulders: true, extra: true },
  gb: { face: ["A", "B"], shoulders: false, extra: true },
};

export class TouchPad {
  /**
   * @param {HTMLElement} root contenitore
   * @param {(btn: string, pressed: boolean) => void} onButton
   */
  constructor(root, { system = "nds", onButton, onAction = () => {}, settings }) {
    this.root = root;
    this.onButton = onButton;
    this.onAction = onAction;
    this.system = system === "gbc" ? "gb" : system;
    this.settings = settings;
    this.pressed = new Map(); // nome pulsante -> numero di dita che lo premono
    this.pointers = new Map(); // pointerId -> { zone, buttons:Set }
    this.build();
  }

  build() {
    const lay = LAYOUTS[this.system] || LAYOUTS.nds;
    const s = this.settings;
    this.root.innerHTML = "";
    this.root.classList.add("pad");
    this.root.dataset.system = this.system;
    this.root.dataset.dpad = s.dpad;
    this.root.style.setProperty("--pad-opacity", s.opacity);
    this.root.style.setProperty("--pad-scale", s.scale);
    this.root.classList.toggle("no-labels", !s.labels);

    const btn = (name, cls = "") => h("div.btn." + ("b-" + name.toLowerCase()) + (cls ? "." + cls : ""), { dataset: { btn: name }, "aria-label": name }, h("span", name === "SELECT" ? "Select" : name === "START" ? "Start" : name));

    this.dpad = h("div.dpad", { dataset: { zone: "dpad" } },
      h("div.dpad-cross", h("i.up"), h("i.right"), h("i.down"), h("i.left"), h("i.center")),
      h("div.stick-base", h("div.stick-knob")));
    this.face = h("div.face.n" + lay.face.length, { dataset: { zone: "face" } }, lay.face.map((b) => btn(b, "face-btn")));
    const left = h("div.pad-side.left", lay.shoulders ? btn("L", "shoulder") : null, this.dpad);
    const right = h("div.pad-side.right", lay.shoulders ? btn("R", "shoulder") : null, this.face);
    const mid = h("div.pad-mid", btn("SELECT", "small"), btn("START", "small"));
    this.root.append(left, mid, right);

    const opts = { passive: false };
    this.root.addEventListener("pointerdown", (e) => this.down(e), opts);
    this.root.addEventListener("pointermove", (e) => this.move(e), opts);
    this.root.addEventListener("pointerup", (e) => this.up(e), opts);
    this.root.addEventListener("pointercancel", (e) => this.up(e), opts);
    this.root.addEventListener("lostpointercapture", (e) => this.up(e));
    this.root.addEventListener("contextmenu", (e) => e.preventDefault());
    // iOS: impedisce zoom con doppio tocco e la lente di ingrandimento
    this.root.addEventListener("touchstart", (e) => e.preventDefault(), opts);
  }

  setSettings(settings) {
    this.releaseAll();
    this.settings = settings;
    this.build();
  }

  zoneAt(target) {
    const z = target.closest("[data-zone]");
    if (z) return z.dataset.zone;
    const b = target.closest("[data-btn]");
    return b ? "btn:" + b.dataset.btn : null;
  }

  down(e) {
    e.preventDefault();
    const zone = this.zoneAt(e.target);
    if (!zone) return;
    try { this.root.setPointerCapture(e.pointerId); } catch (_) { /* puntatore gia' rilasciato */ }
    const st = { zone, buttons: new Set() };
    if (zone === "dpad") {
      const r = this.dpad.getBoundingClientRect();
      st.cx = r.left + r.width / 2;
      st.cy = r.top + r.height / 2;
      st.r = r.width / 2;
    }
    this.pointers.set(e.pointerId, st);
    this.update(e, st);
  }

  move(e) {
    const st = this.pointers.get(e.pointerId);
    if (!st) return;
    e.preventDefault();
    this.update(e, st);
  }

  up(e) {
    const st = this.pointers.get(e.pointerId);
    if (!st) return;
    this.setButtons(st, new Set());
    this.pointers.delete(e.pointerId);
    if (st.zone === "dpad") this.dpad.style.removeProperty("--kx"), this.dpad.style.removeProperty("--ky");
  }

  update(e, st) {
    let next = new Set();
    if (st.zone === "dpad") {
      const dx = (e.clientX - st.cx) / st.r;
      const dy = (e.clientY - st.cy) / st.r;
      for (const d of dpadDirections(dx, dy)) next.add(d);
      const k = Math.min(1, Math.hypot(dx, dy));
      const a = Math.atan2(dy, dx);
      this.dpad.style.setProperty("--kx", (Math.cos(a) * k * 0.45).toFixed(3));
      this.dpad.style.setProperty("--ky", (Math.sin(a) * k * 0.45).toFixed(3));
    } else if (st.zone === "face") {
      let best = null;
      let bestD = Infinity;
      for (const b of this.face.querySelectorAll("[data-btn]")) {
        const r = b.getBoundingClientRect();
        const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) / (r.width / 2);
        if (d < bestD) { bestD = d; best = b.dataset.btn; }
      }
      if (best && bestD < 1.6) next.add(best);
    } else if (st.zone.startsWith("btn:")) {
      const name = st.zone.slice(4);
      const el = this.root.querySelector(`[data-btn="${name}"]`);
      const r = el.getBoundingClientRect();
      const m = 18;
      if (e.type === "pointerdown" || (e.clientX > r.left - m && e.clientX < r.right + m && e.clientY > r.top - m && e.clientY < r.bottom + m)) next.add(name);
    }
    this.setButtons(st, next);
  }

  setButtons(st, next) {
    for (const b of st.buttons) if (!next.has(b)) this.release(b);
    for (const b of next) if (!st.buttons.has(b)) this.press(b);
    st.buttons = next;
  }

  press(name) {
    const n = (this.pressed.get(name) || 0) + 1;
    this.pressed.set(name, n);
    if (n === 1) {
      this.onButton(name, true);
      this.mark(name, true);
      if (this.settings.haptics && navigator.vibrate) navigator.vibrate(8);
    }
  }

  release(name) {
    const n = (this.pressed.get(name) || 0) - 1;
    if (n <= 0) {
      this.pressed.delete(name);
      this.onButton(name, false);
      this.mark(name, false);
    } else this.pressed.set(name, n);
  }

  mark(name, on) {
    if (DIRS.includes(name)) this.dpad.classList.toggle("p-" + name.toLowerCase(), on);
    else this.root.querySelectorAll(`[data-btn="${name}"]`).forEach((el) => el.classList.toggle("pressed", on));
  }

  releaseAll() {
    for (const st of this.pointers.values()) this.setButtons(st, new Set());
    this.pointers.clear();
  }
}

/** Tastiera fisica (PC, iPad con tastiera). */
export class KeyboardInput {
  constructor({ map, hotkeys, onButton, onAction }) {
    this.map = map;
    this.hotkeys = hotkeys;
    this.onButton = onButton;
    this.onAction = onAction;
    this.enabled = true;
    this.down = new Set();
    this._kd = (e) => this.handle(e, true);
    this._ku = (e) => this.handle(e, false);
    window.addEventListener("keydown", this._kd);
    window.addEventListener("keyup", this._ku);
    window.addEventListener("blur", () => this.releaseAll());
  }

  handle(e, pressed) {
    if (!this.enabled) return;
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const btn = this.map[e.code];
    if (btn) {
      e.preventDefault();
      if (pressed === this.down.has(e.code)) return;
      if (pressed) this.down.add(e.code);
      else this.down.delete(e.code);
      this.onButton(btn, pressed);
      return;
    }
    const act = this.hotkeys[e.code];
    if (act && !e.repeat) {
      e.preventDefault();
      this.onAction(act, pressed);
    }
  }

  releaseAll() {
    for (const code of this.down) this.onButton(this.map[code], false);
    this.down.clear();
  }
}

// Mappatura "standard" dei gamepad (Xbox/PlayStation/MFi) -> pulsanti DS.
// Sui pad Nintendo-style A e B sono invertiti fisicamente: usiamo la posizione.
const PAD_MAP = { 0: "B", 1: "A", 2: "Y", 3: "X", 4: "L", 5: "R", 6: "L", 7: "R", 8: "SELECT", 9: "START", 12: "UP", 13: "DOWN", 14: "LEFT", 15: "RIGHT" };

export class GamepadInput {
  constructor({ onButton, onAction, onConnect = () => {} }) {
    this.onButton = onButton;
    this.onAction = onAction;
    this.onConnect = onConnect;
    this.state = new Map();
    this.raf = 0;
    window.addEventListener("gamepadconnected", (e) => { this.onConnect(e.gamepad, true); this.loop(); });
    window.addEventListener("gamepaddisconnected", (e) => { this.onConnect(e.gamepad, false); this.releaseAll(); });
  }

  loop() {
    if (this.raf) return;
    const tick = () => {
      this.raf = 0;
      const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
      if (!pads.length) return;
      const now = new Map();
      for (const gp of pads) {
        gp.buttons.forEach((b, i) => {
          const name = PAD_MAP[i];
          if (name && (b.pressed || b.value > 0.5)) now.set(name, true);
          if (i === 16 && b.pressed) now.set("@menu", true);
        });
        const [ax, ay] = gp.axes;
        if (ax !== undefined) {
          if (ax < -0.5) now.set("LEFT", true);
          if (ax > 0.5) now.set("RIGHT", true);
          if (ay < -0.5) now.set("UP", true);
          if (ay > 0.5) now.set("DOWN", true);
        }
      }
      for (const [name] of now) if (!this.state.has(name)) this.emit(name, true);
      for (const [name] of this.state) if (!now.has(name)) this.emit(name, false);
      this.state = now;
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  emit(name, pressed) {
    if (name === "@menu") { if (pressed) this.onAction("menu", true); return; }
    this.onButton(name, pressed);
  }

  releaseAll() {
    for (const [name] of this.state) this.emit(name, false);
    this.state.clear();
  }
}

export function buttonIndex(name) {
  return BUTTON[name];
}
