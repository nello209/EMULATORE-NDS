// Sessione di gioco: salvataggi automatici "con controllo di salute",
// versioni del .sav, sorveglianza dei blocchi, misura della velocita' reale.
//
// Principi:
//  1. Nessun salvataggio automatico durante l'avvio o subito dopo un ripristino
//     (periodo di riscaldamento): evita stati "vuoti" catturati al boot.
//  2. Nessun salvataggio automatico se il giocatore non ha toccato nulla dal
//     precedente: restare fermi non fa scorrere via gli stati buoni.
//  3. Appena si sospetta un blocco: stop ai salvataggi automatici, stop alle
//     cancellazioni automatiche, stati recenti marcati "sospetti".
//  4. Ogni stato ha la sua miniatura: si sceglie a colpo d'occhio quello giusto.

import * as store from "./store.js";
import { fnv1a, uid } from "./util.js";

const NATIVE_FPS = { nds: 59.8261, gba: 59.7275, gbc: 59.7275, gb: 59.7275 };

export class Session extends EventTarget {
  constructor({ engine, game, settings }) {
    super();
    this.engine = engine;
    this.game = game;
    this.settings = settings;
    this.id = uid();
    this.startedAt = Date.now();
    this.nativeFps = NATIVE_FPS[game.system] || 60;
    this.runSec = 0; // secondi di gioco effettivo in questa sessione
    this.sinceLoadSec = 0;
    this.frameAtLoad = 0;
    this.inputsSinceSave = 0;
    this.inputsSinceScreenChange = 0;
    this.lastAutosaveAt = 0;
    this.lastAutosaveFrame = 0;
    this.lastCheckpointAt = 0;
    this.lastFrame = 0;
    this.lastFrameChangeAt = performance.now();
    this.lastScreenHash = null;
    this.lastScreenChangeAt = performance.now();
    this.frozen = null;
    this.busy = false;
    this.speed = { fps: 0, ratio: 0 };
    this.minuteStats = { frames: 0, sec: 0, minRatio: Infinity };
    this.sessionStateId = null;
    this.lastSaveHash = null;
    this.timers = [];
    this.paused = false;
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get warm() {
    const a = this.settings.autosave;
    return this.sinceLoadSec >= a.warmupSec && this.engine.frame - this.frameAtLoad >= 300;
  }

  get visible() {
    return document.visibilityState === "visible";
  }

  async begin({ fromState = null } = {}) {
    const e = this.engine;
    e.addEventListener("crash", (ev) => this.freeze("crash", ev.detail.reason + ": " + ev.detail.detail));
    // al cambio di turbo la media della velocita' riparte da zero: l'indicatore si aggiorna subito
    e.addEventListener("turbo", () => { this.speed.fps = 0; this.skipSpeedTick = true; });
    const last = await store.latestSave(this.game.id);
    this.lastSaveHash = last ? last.hash : null;
    this.loadedFromState = false;
    if (fromState) {
      try {
        this.loadedFromState = await e.loadState(fromState);
      } catch (err) {
        store.logEvent(this.game.id, "restore-error", { msg: String(err && err.message) });
      }
    }
    this.markLoaded();
    this.lastFrame = e.frame;
    this.lastCheckpointAt = Date.now();
    this.timers.push(setInterval(() => this.tick(), 1000));
    this.timers.push(setInterval(() => this.watchScreen(), 5000));
    this.timers.push(setInterval(() => this.checkSave(), 10000));
    document.addEventListener("visibilitychange", () => this.onVisibility());
    window.addEventListener("pagehide", () => this.onVisibility());
    window.addEventListener("error", (ev) => {
      const msg = String(ev.message || ev.error || "");
      if (/RuntimeError|wasm|unreachable|memory access out of bounds/i.test(msg)) this.freeze("crash", msg);
    });
    window.addEventListener("unhandledrejection", (ev) => {
      const msg = String(ev.reason && (ev.reason.message || ev.reason));
      if (/RuntimeError|unreachable|memory access out of bounds/i.test(msg)) this.freeze("crash", msg);
    });
    store.logEvent(this.game.id, "session-start", {
      session: this.id, core: e.coreId, coreVersion: e.coreVersion, ua: navigator.userAgent,
      screen: `${screen.width}x${screen.height}@${devicePixelRatio}`, standalone: matchMedia("(display-mode: standalone)").matches,
    });
  }

  /** Da chiamare dopo l'avvio o dopo il caricamento di uno stato. */
  markLoaded() {
    this.sinceLoadSec = 0;
    this.frameAtLoad = this.engine.frame;
    this.lastAutosaveFrame = this.engine.frame;
    this.inputsSinceSave = 0;
    this.lastFrameChangeAt = performance.now();
    this.lastScreenChangeAt = performance.now();
    this.inputsSinceScreenChange = 0;
  }

  noteInput() {
    this.inputsSinceSave++;
    this.inputsSinceScreenChange++;
  }

  tick() {
    const e = this.engine;
    const now = performance.now();
    const f = e.frame;
    const active = e.running && this.visible && !e.crashed;
    if (active) {
      this.runSec++;
      this.sinceLoadSec++;
      const df = f - this.lastFrame;
      if (this.skipSpeedTick) this.skipSpeedTick = false; // secondo "misto" tra due velocita'
      else this.speed.fps = this.speed.fps ? this.speed.fps * 0.5 + df * 0.5 : df;
      this.speed.ratio = this.speed.fps / this.nativeFps;
      this.minuteStats.frames += df;
      this.minuteStats.sec++;
      this.minuteStats.minRatio = Math.min(this.minuteStats.minRatio, df / this.nativeFps);
      if (this.minuteStats.sec >= 60) this.flushMinute();
      if (df > 0) this.lastFrameChangeAt = now;
      else if (!this.frozen && now - this.lastFrameChangeAt > this.settings.watchdog.hardSec * 1000) {
        this.freeze("hard", `Nessun fotogramma da ${Math.round((now - this.lastFrameChangeAt) / 1000)} s`);
      }
      this.emit("speed", { ...this.speed, turbo: e.fastForward, target: e.fastForward ? e.ffRatio : 1 });
    } else {
      this.lastFrameChangeAt = now;
    }
    this.lastFrame = f;
    if (active && !this.frozen && Date.now() - this.lastAutosaveAt >= this.settings.autosave.intervalSec * 1000) {
      this.autosave("timer");
    }
  }

  flushMinute() {
    const m = this.minuteStats;
    const info = { session: this.id, runMin: Math.round(this.runSec / 60), avgRatio: +(m.frames / m.sec / this.nativeFps).toFixed(3), minRatio: +m.minRatio.toFixed(3), turbo: this.engine.fastForward };
    if (performance.memory) info.heapMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
    store.logEvent(this.game.id, "perf", info);
    this.emit("perf", info);
    this.minuteStats = { frames: 0, sec: 0, minRatio: Infinity };
  }

  /** Il gioco gira ma l'immagine non cambia da molto, nonostante i comandi: blocco "morbido". */
  async watchScreen() {
    const e = this.engine;
    if (!e.running || !this.visible || this.frozen || this.busy) return;
    const png = await e.screenshot(1500);
    if (!png) return;
    const hsh = fnv1a(png);
    this.lastThumb = png;
    const now = performance.now();
    if (hsh !== this.lastScreenHash) {
      this.lastScreenHash = hsh;
      this.lastScreenChangeAt = now;
      this.inputsSinceScreenChange = 0;
      return;
    }
    const w = this.settings.watchdog;
    if (now - this.lastScreenChangeAt >= w.softSec * 1000 && this.inputsSinceScreenChange >= w.softMinInputs) {
      this.freeze("soft", `Immagine identica da ${Math.round((now - this.lastScreenChangeAt) / 1000)} s nonostante ${this.inputsSinceScreenChange} comandi`);
    }
  }

  async freeze(type, detail) {
    if (this.frozen) return;
    this.frozen = { type, detail, at: Date.now() };
    store.suspendPruning(true);
    const since = Date.now() - Math.max(60, this.settings.watchdog.softSec + 10) * 1000;
    const n = await store.markSuspect(this.game.id, type === "soft" ? since : Date.now() - 20000, type);
    store.logEvent(this.game.id, "freeze", { session: this.id, type, detail, suspectMarked: n, runSec: this.runSec, frame: this.engine.frame });
    this.emit("freeze", { ...this.frozen, suspectMarked: n });
    if (type === "soft" && this.engine.running) {
      // conserva una copia dello stato bloccato per l'analisi (mai usata per "Continua")
      try {
        const data = this.engine.saveState();
        await this.storeState(data, "diagnostic", { suspect: true, reason: "soft-freeze" }, { label: "Gioco bloccato: copia per analisi" });
      } catch (_) { /* il motore potrebbe essere inutilizzabile */ }
    }
  }

  /** L'utente conferma che il gioco funziona: si riprende a salvare. */
  clearFreeze() {
    if (!this.frozen) return;
    store.logEvent(this.game.id, "freeze-cleared", { session: this.id, type: this.frozen.type });
    this.frozen = null;
    store.suspendPruning(false);
    this.lastScreenChangeAt = performance.now();
    this.lastFrameChangeAt = performance.now();
    this.inputsSinceScreenChange = 0;
    this.emit("freeze-cleared");
  }

  async thumbnail() {
    const png = (await this.engine.screenshot(1500)) || this.lastThumb;
    return png ? new Blob([png], { type: "image/png" }) : null;
  }

  async storeState(data, kind, health = {}, extra = {}) {
    const thumb = extra.thumb !== undefined ? extra.thumb : await this.thumbnail();
    const rec = await store.addState(data, {
      romId: this.game.id,
      kind,
      coreId: this.engine.coreId,
      coreVersion: this.engine.coreVersion,
      frame: this.engine.frame,
      framesSinceLoad: this.engine.frame - this.frameAtLoad,
      sessionId: this.id,
      sessionSec: this.runSec,
      playSec: (this.game.playSec || 0) + this.runSec,
      health: { suspect: false, warm: this.warm, ...health },
      label: extra.label || "",
      thumb,
    });
    this.emit("saved", rec);
    return rec;
  }

  /** Salvataggio automatico. Restituisce lo stato salvato o il motivo per cui e' stato saltato. */
  async autosave(reason = "timer") {
    const e = this.engine;
    this.lastAutosaveAt = Date.now();
    if (this.busy) return { skipped: "occupato" };
    if (this.frozen) return { skipped: "blocco in corso" };
    if (!e.running || e.crashed) return { skipped: "in pausa" };
    if (!this.warm) return { skipped: "avvio in corso" };
    if (this.inputsSinceSave === 0) return { skipped: "nessun comando dall'ultimo salvataggio" };
    if (e.frame - this.lastAutosaveFrame < 300) return { skipped: "il gioco non è avanzato" };
    this.busy = true;
    try {
      const t0 = performance.now();
      const thumb = await this.thumbnail();
      const data = e.saveState();
      const tState = performance.now() - t0;
      const checkpoint = Date.now() - this.lastCheckpointAt >= this.settings.autosave.checkpointEveryMin * 60000;
      const rec = await this.storeState(data, checkpoint ? "checkpoint" : "auto", {}, { thumb });
      if (checkpoint) this.lastCheckpointAt = Date.now();
      this.lastAutosaveFrame = e.frame;
      this.inputsSinceSave = 0;
      store.logEvent(this.game.id, "autosave", { session: this.id, kind: rec.kind, reason, stateMs: Math.round(tState), totalMs: Math.round(performance.now() - t0), size: rec.size, stored: rec.storedSize });
      await this.persistPlayTime();
      return rec;
    } catch (err) {
      store.logEvent(this.game.id, "autosave-error", { session: this.id, msg: String(err && err.message) });
      return { skipped: "errore: " + (err && err.message) };
    } finally {
      this.busy = false;
    }
  }

  /** Stato "fine sessione": uno per sessione, aggiornato quando l'app va in secondo piano. */
  async sessionSave() {
    const e = this.engine;
    if (this.busy || this.frozen || !e.started || e.crashed || !this.warm || this.inputsSinceSave === 0) return null;
    this.busy = true;
    try {
      const data = e.saveState();
      const rec = await this.storeState(data, "session", {}, { thumb: this.lastThumb ? new Blob([this.lastThumb], { type: "image/png" }) : null });
      if (this.sessionStateId) await store.deleteState(this.sessionStateId);
      this.sessionStateId = rec.id;
      this.inputsSinceSave = 0;
      this.lastAutosaveFrame = e.frame;
      return rec;
    } catch (_) {
      return null;
    } finally {
      this.busy = false;
    }
  }

  async manualSave(label = "") {
    const data = this.engine.saveState();
    const rec = await this.storeState(data, "manual", {}, { label });
    this.inputsSinceSave = 0;
    this.lastAutosaveFrame = this.engine.frame;
    store.logEvent(this.game.id, "manual-save", { session: this.id, id: rec.id });
    await this.checkSave();
    return rec;
  }

  /** Carica uno stato, facendo prima una copia di sicurezza della partita corrente. */
  async restore(stateId) {
    const meta = await store.getStateMeta(stateId);
    if (!meta) throw new Error("Stato non trovato");
    if (meta.coreId && meta.coreId !== this.engine.coreId) {
      throw new Error(`Questo stato è del motore ${meta.coreId}: cambia motore dalla scheda del gioco o usa il .sav`);
    }
    const data = await store.getStateData(stateId);
    let backup = null;
    if (this.warm && !this.frozen && this.engine.started && !this.engine.crashed) {
      try {
        backup = await this.storeState(this.engine.saveState(), "prerestore", {}, { label: "Prima di caricare lo stato del " + new Date(meta.createdAt).toLocaleString("it-IT") });
      } catch (_) { backup = null; }
    }
    this.busy = true;
    try {
      const ok = await this.engine.loadState(data);
      if (!ok) throw new Error("Il motore non ha applicato lo stato");
    } finally {
      this.busy = false;
    }
    if (this.frozen) this.clearFreeze();
    this.markLoaded();
    store.logEvent(this.game.id, "restore", { session: this.id, id: stateId, kind: meta.kind, backup: backup && backup.id });
    return { meta, backup };
  }

  /** Controlla se il gioco ha scritto un nuovo salvataggio interno e ne conserva la versione. */
  async checkSave() {
    const e = this.engine;
    if (!e.started || e.crashed) return null;
    const data = e.readSave();
    if (!data || !data.length) return null;
    const hsh = fnv1a(data);
    if (hsh === this.lastSavFnv) return null;
    this.lastSavFnv = hsh;
    const rec = await store.addSaveVersion(this.game.id, data, { kind: "auto", coreId: e.coreId });
    if (rec) {
      this.emit("sav", rec);
      store.logEvent(this.game.id, "sav-version", { session: this.id, size: rec.size, hash: rec.hash.slice(0, 12) });
    }
    return rec;
  }

  async persistPlayTime() {
    const add = this.runSec - (this._persistedRunSec || 0);
    if (add <= 0) return;
    this._persistedRunSec = this.runSec;
    try {
      const g = await store.updateGame(this.game.id, (g) => ({ ...g, playSec: (g.playSec || 0) + add, lastPlayedAt: Date.now(), core: this.engine.coreId }));
      this.game.playSec = g.playSec - this.runSec;
    } catch (_) { /* non critico */ }
  }

  async onVisibility() {
    if (!this.visible) {
      this.engine.releaseAllInputs();
      await this.checkSave();
      await this.sessionSave();
      await this.persistPlayTime();
    } else {
      this.lastFrameChangeAt = performance.now();
      this.engine.resumeAudio();
      if (this.engine.fastForward) this.engine.setFastForward(true, this.engine.ffRatio);
    }
  }

  async end() {
    await this.checkSave();
    await this.sessionSave();
    await this.persistPlayTime();
    this.flushMinute();
    store.logEvent(this.game.id, "session-end", { session: this.id, runSec: this.runSec });
    for (const t of this.timers) clearInterval(t);
  }

  /** Misura quanto puo' accelerare il dispositivo (turbo illimitato per qualche secondo). */
  async benchmark(ms = 3000) {
    const e = this.engine;
    const prev = { on: e.fastForward, ratio: e.ffRatio };
    const normal = await e.measureFps(1500);
    e.setFastForward(true, 0);
    await new Promise((r) => setTimeout(r, 300));
    const max = await e.measureFps(ms);
    e.setFastForward(prev.on, prev.ratio);
    const res = { normalRatio: +(normal / this.nativeFps).toFixed(2), maxRatio: +(max / this.nativeFps).toFixed(2) };
    store.logEvent(this.game.id, "benchmark", { session: this.id, ...res });
    return res;
  }
}
