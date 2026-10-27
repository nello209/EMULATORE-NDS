// Motore di Vesuvio: carica un core libretro compilato in WebAssembly (build di
// EmulatorJS 4.2.3) e lo pilota direttamente, senza l'interfaccia di EmulatorJS.
// Un solo core per pagina: per cambiare gioco si ricarica la pagina, cosi' la
// memoria del core viene liberata davvero.

export const BUTTON = Object.freeze({
  B: 0, Y: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7,
  A: 8, X: 9, L: 10, R: 11, L2: 12, R2: 13, L3: 14, R3: 15,
});

export const CORES = {
  melonds: {
    system: "nds", file: "melonds_libretro", label: "melonDS", saveExt: "sav",
    desc: "Il più compatibile. Consigliato per Pokémon.",
    // "Touch" = coordinate assolute: il punto toccato e' sempre quello giusto.
    // ("Mouse", il predefinito, usa spostamenti relativi e puo' sfasarsi.)
    options: { melonds_touch_mode: "Touch", melonds_boot_directly: "enabled", melonds_language: "Italian", melonds_audio_interpolation: "None", melonds_screen_layout: "Top/Bottom", melonds_screen_gap: "0" },
  },
  desmume2015: {
    system: "nds", file: "desmume2015_libretro", label: "DeSmuME 2015", saveExt: "dsv",
    desc: "Alternativa: permette di saltare fotogrammi sui dispositivi lenti.",
    options: { desmume_pointer_type: "touch", desmume_firmware_language: "Italian", desmume_screens_layout: "top/bottom", desmume_screens_gap: "0", desmume_frameskip: "0", desmume_pointer_colour: "white" },
  },
  desmume: {
    system: "nds", file: "desmume_libretro", label: "DeSmuME (recente)", saveExt: "dsv",
    desc: "Più preciso ma più pesante.",
    options: { desmume_pointer_type: "touch", desmume_firmware_language: "Italian", desmume_screens_layout: "top/bottom", desmume_screens_gap: "0", desmume_frameskip: "0" },
  },
  mgba: {
    system: "gba", file: "mgba_libretro", label: "mGBA", saveExt: "srm",
    desc: "Game Boy, Game Boy Color e Game Boy Advance.",
    options: { mgba_skip_bios: "ON", mgba_sgb_borders: "OFF", mgba_color_correction: "OFF" },
  },
};

const RA_CFG_BASE = {
  autosave_interval: 0, // i salvataggi li gestisce Vesuvio
  screenshot_directory: "/",
  block_sram_overwrite: false,
  video_gpu_screenshot: false,
  audio_latency: 96,
  video_vsync: true,
  video_smooth: false,
  fastforward_ratio: 3.0,
  fastforward_frameskip: true,
  savefile_directory: "/saves",
  sort_savefiles_enable: false,
  sort_savefiles_by_content_enable: false,
  sort_savestates_enable: false,
  savestate_directory: "/states",
  savestate_thumbnail_enable: false,
  menu_driver: "null",
  video_font_enable: false,
  input_autodetect_enable: false,
  pause_nonactive: false,
};

function cfgLine(k, v) {
  return typeof v === "number" || typeof v === "boolean" ? `${k} = ${v}\n` : `${k} = "${v}"\n`;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Correzione del touch sugli schermi ad alta densita' (iPhone, iPad, quasi tutti
 * i telefoni). Il frontend RetroArch di questi core moltiplica le coordinate del
 * dito per devicePixelRatio, ma disegna e calcola l'area di gioco in pixel CSS:
 * con densita' 2 o 3 il tocco finiva nel punto sbagliato (verificato nei test).
 * Correggiamo il codice di collegamento del core al caricamento, facendogli usare
 * sempre pixel CSS (densita' 1): funziona allo stesso modo in ogni browser.
 * Il browser poi ingrandisce il canvas in modo nitido.
 */
export function patchCoreGlue(js) {
  const before = js;
  js = js.split("entry.devicePixelContentBoxSize").join("false");
  js = js.split("window.devicePixelRatio").join("1");
  return { js, patched: js !== before };
}

function loadScriptText(js) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
    const s = document.createElement("script");
    s.src = url;
    s.onload = () => { URL.revokeObjectURL(url); resolve(); };
    s.onerror = () => reject(new Error("Impossibile avviare il codice del motore"));
    document.head.appendChild(s);
  });
}

export class Engine extends EventTarget {
  constructor({ canvas, coreId, basePath = "cores/" }) {
    super();
    if (!CORES[coreId]) throw new Error("Core sconosciuto: " + coreId);
    this.canvas = canvas;
    this.coreId = coreId;
    this.core = CORES[coreId];
    this.basePath = basePath;
    this.Module = null;
    this.running = false;
    this.started = false;
    this.crashed = null;
    this.fastForward = false;
    this.ffRatio = 3;
    this.muteOnTurbo = true;
    this.volume = 1;
    this.muted = false;
    this.inputState = new Map();
    this.coreOptions = {};
    this.coreVersion = "";
    this._restoreSeq = 0;
  }

  get dir() {
    return this.basePath + this.coreId + "/";
  }

  async load(onProgress = () => {}) {
    onProgress("Preparo il motore " + this.core.label + "…");
    const jsUrl = new URL(this.dir + this.core.file + ".js", location.href).href;
    const wasmUrl = new URL(this.dir + this.core.file + ".wasm", location.href).href;
    try {
      this.coreVersion = (await (await fetch(this.dir + "build.json")).json()).version || "";
    } catch (_) { /* facoltativo */ }
    if (typeof window.EJS_Runtime !== "function") {
      const res = await fetch(jsUrl);
      if (!res.ok) throw new Error("Impossibile scaricare il motore (" + res.status + ")");
      const { js, patched } = patchCoreGlue(await res.text());
      if (!patched) this._log("err", "Correzione del touch non applicata: codice del core inatteso");
      this.gluePatched = patched;
      await loadScriptText(js);
    }
    const self = this;
    onProgress("Avvio il motore " + this.core.label + "…");
    this.Module = await window.EJS_Runtime({
      noInitialRun: true,
      arguments: [],
      preRun: [],
      postRun: [],
      canvas: this.canvas,
      parent: this.canvas.parentElement,
      callbacks: {
        setupCoreSettingFile(path) {
          self._coreOptPath = path;
          self._writeCoreOptions();
        },
      },
      print: (m) => this._log("out", m),
      printErr: (m) => this._log("err", m),
      locateFile: (name) => (name.endsWith(".wasm") ? wasmUrl : new URL(this.dir + name, location.href).href),
      getSavExt: () => "." + this.core.saveExt,
      onAbort: (what) => this._crash("abort", what),
    });
    const M = this.Module;
    const w = (name, ret, args) => M.cwrap(name, ret, args);
    this.fn = {
      restart: w("system_restart", "", []),
      saveStateInfo: w("save_state_info", "string", []),
      loadState: w("load_state", "number", ["string", "number"]),
      screenshot: w("cmd_take_screenshot", "", []),
      simulateInput: w("simulate_input", "null", ["number", "number", "number"]),
      toggleMainLoop: w("toggleMainLoop", "null", ["number"]),
      getCoreOptions: w("get_core_options", "string", []),
      setVariable: w("ejs_set_variable", "null", ["string", "string"]),
      saveFilePath: w("save_file_path", "string", []),
      saveSaveFiles: w("cmd_savefiles", "", []),
      refreshSaveFiles: w("refresh_save_files", "null", []),
      toggleFastForward: w("toggle_fastforward", "null", ["number"]),
      setFFRatio: w("set_ff_ratio", "null", ["number"]),
      frameCount: w("get_current_frame_count", "number", []),
      setKeyboardEnabled: w("ejs_set_keyboard_enabled", "null", ["number"]),
    };
    this.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this._crash("webgl", "Contesto grafico perso");
    });
    return this;
  }

  _crash(reason, detail) {
    if (this.crashed) return;
    this.crashed = { reason, detail: String(detail || ""), at: Date.now() };
    this.running = false;
    this._emit("crash", this.crashed);
  }

  _log(kind, msg) {
    this._emit("log", { kind, msg: String(msg) });
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _mkdirp(path) {
    const FS = this.Module.FS;
    let cur = "";
    for (const part of path.split("/").filter(Boolean)) {
      cur += "/" + part;
      try { FS.mkdir(cur); } catch (_) { /* esiste */ }
    }
  }

  _writeFile(path, data) {
    this._mkdirp(path.substring(0, path.lastIndexOf("/")) || "/");
    this.Module.FS.writeFile(path, data);
  }

  _writeCoreOptions() {
    if (!this._coreOptPath) return;
    let out = "";
    for (const [k, v] of Object.entries(this.coreOptions)) out += `${k} = "${v}"\n`;
    this._writeFile(this._coreOptPath, out);
  }

  /**
   * Avvia il gioco.
   * @param {object} p
   * @param {Uint8Array} p.rom
   * @param {string} p.romName nome file con estensione
   * @param {Uint8Array} [p.save] salvataggio interno (.sav/.srm) da usare
   * @param {object} [p.coreOptions] opzioni del core (si aggiungono a quelle predefinite)
   * @param {object} [p.retroarch] opzioni aggiuntive per retroarch.cfg
   */
  start({ rom, romName, save = null, coreOptions = {}, retroarch = {} }) {
    const M = this.Module;
    this.coreOptions = { ...this.core.options, ...coreOptions };
    let cfg = "";
    for (const [k, v] of Object.entries({ ...RA_CFG_BASE, ...retroarch })) cfg += cfgLine(k, v);
    this._writeFile("/home/web_user/.config/retroarch/retroarch.cfg", cfg);
    this._mkdirp("/saves");
    this._mkdirp("/states");
    const ext = (romName.split(".").pop() || "bin").toLowerCase();
    this.romPath = "/game." + ext;
    this._writeFile(this.romPath, rom);
    if (save && save.length) this._writeFile("/saves/game." + this.core.saveExt, save);
    M.callMain([this.romPath]);
    M.resumeMainLoop();
    this.fn.setKeyboardEnabled(0);
    this.running = true;
    this.started = true;
    this.startedAt = performance.now();
    this._applyVolume();
    this._emit("start", {});
  }

  get frame() {
    if (!this.started || this.crashed) return 0;
    try {
      return this.fn.frameCount();
    } catch (e) {
      this._crash("wasm", e && e.message);
      return 0;
    }
  }

  pause() {
    if (!this.started || !this.running) return;
    this.fn.toggleMainLoop(0);
    this.running = false;
    this._emit("pause", {});
  }

  resume() {
    if (!this.started || this.running || this.crashed) return;
    this.fn.toggleMainLoop(1);
    this.running = true;
    // Dopo una pausa il core reimposta il limite di velocita': riapplichiamo il turbo.
    if (this.fastForward) this._applyFastForward();
    this.resumeAudio();
    this._emit("resume", {});
  }

  reset() {
    this.fn.restart();
  }

  /** Stato completo dell'emulatore (savestate). */
  saveState() {
    const info = this.fn.saveStateInfo().split("|");
    if (info[2] !== "1") throw new Error("Salvataggio dello stato fallito: " + info[0]);
    const size = parseInt(info[0], 10);
    const ptr = parseInt(info[1], 10);
    if (!(size > 0)) throw new Error("Stato vuoto");
    return this.Module.HEAPU8.slice(ptr, ptr + size);
  }

  /**
   * Carica uno stato. Il core lo applica al fotogramma successivo del ciclo
   * principale, quindi aspettiamo che il ciclo giri almeno due volte. Se il gioco
   * era in pausa, lo facciamo girare un istante e lo rimettiamo in pausa.
   */
  async loadState(data) {
    const FS = this.Module.FS;
    const name = "restore-" + ++this._restoreSeq + ".state";
    FS.writeFile("/" + name, data);
    const wasPaused = !this.running;
    const f0 = this.frame;
    this.fn.loadState(name, 0);
    if (wasPaused) this.fn.toggleMainLoop(1);
    const t0 = performance.now();
    while (this.frame < f0 + 2 && performance.now() - t0 < 3000) await wait(16);
    if (wasPaused) this.fn.toggleMainLoop(0);
    try { FS.unlink("/" + name); } catch (_) { /* gia' rimosso */ }
    if (this.fastForward && !wasPaused) this._applyFastForward();
    this._emit("stateloaded", {});
    return this.frame >= f0 + 2;
  }

  get saveFilePath() {
    return this.fn.saveFilePath();
  }

  /** Salvataggio interno del gioco (.sav): lo scrive il gioco quando salvi dal suo menu. */
  readSave() {
    this.fn.saveSaveFiles();
    const p = this.saveFilePath;
    try {
      if (!p || !this.Module.FS.analyzePath(p).exists) return null;
      return this.Module.FS.readFile(p);
    } catch (_) {
      return null;
    }
  }

  /** Sostituisce il salvataggio interno. Va seguito da un riavvio del gioco. */
  writeSave(data) {
    this._writeFile(this.saveFilePath, data);
    this.fn.refreshSaveFiles();
  }

  /** Fotogramma del core in PNG (indipendente dal canvas WebGL). Funziona solo mentre gira. */
  async screenshot(timeoutMs = 2000) {
    if (!this.running) return null;
    const FS = this.Module.FS;
    try { FS.unlink("/screenshot.png"); } catch (_) { /* nessuno */ }
    this.fn.screenshot();
    const t0 = performance.now();
    let lastSize = -1;
    while (performance.now() - t0 < timeoutMs) {
      await wait(16);
      try {
        const st = FS.stat("/screenshot.png");
        if (st.size > 0 && st.size === lastSize) {
          const data = FS.readFile("/screenshot.png");
          FS.unlink("/screenshot.png");
          return data;
        }
        lastSize = st.size;
      } catch (_) { /* non ancora pronto */ }
    }
    return null;
  }

  setInput(index, value) {
    if (!this.started || this.crashed) return;
    if ((this.inputState.get(index) || 0) === value) return;
    this.inputState.set(index, value);
    this.fn.simulateInput(0, index, value);
    if (value) this.lastInputAt = performance.now();
  }

  releaseAllInputs() {
    for (const [index, v] of this.inputState) if (v) this.fn.simulateInput(0, index, 0);
    this.inputState.clear();
  }

  _applyFastForward() {
    // Il core legge il nuovo rapporto solo quando il fast-forward viene riattivato:
    // lo spegniamo, impostiamo il rapporto e lo riaccendiamo al fotogramma dopo.
    this.fn.toggleFastForward(0);
    this.fn.setFFRatio(this.ffRatio);
    if (this.fastForward) {
      requestAnimationFrame(() => {
        if (this.fastForward && this.running) this.fn.toggleFastForward(1);
      });
    }
    this._applyVolume();
  }

  /** ratio: 0 = il massimo che il dispositivo riesce a dare */
  setFastForward(on, ratio = this.ffRatio) {
    this.fastForward = !!on;
    this.ffRatio = ratio;
    if (this.started) this._applyFastForward();
    this._emit("turbo", { on: this.fastForward, ratio });
  }

  setVolume(v) {
    this.volume = v;
    this._applyVolume();
  }

  setMuted(m) {
    this.muted = !!m;
    this._applyVolume();
  }

  _applyVolume() {
    const v = this.muted || (this.fastForward && this.muteOnTurbo) ? 0 : this.volume;
    const AL = this.Module && this.Module.AL;
    if (AL && AL.currentCtx && AL.currentCtx.sources) {
      for (const src of Object.values(AL.currentCtx.sources)) src.gain.gain.value = v;
    }
  }

  get audioContext() {
    const AL = this.Module && this.Module.AL;
    return (AL && AL.currentCtx && AL.currentCtx.audioCtx) || null;
  }

  resumeAudio() {
    const ctx = this.audioContext;
    if (ctx && ctx.state !== "running") ctx.resume().catch(() => {});
    this._applyVolume();
  }

  setOption(key, value) {
    this.coreOptions[key] = value;
    if (this.started) this.fn.setVariable(key, String(value));
  }

  listCoreOptions() {
    try {
      return this.fn.getCoreOptions();
    } catch (_) {
      return "";
    }
  }

  /** Misura i fotogrammi al secondo emulati in una finestra di tempo. */
  async measureFps(ms = 2000) {
    const f0 = this.frame;
    const t0 = performance.now();
    await wait(ms);
    return (this.frame - f0) / ((performance.now() - t0) / 1000);
  }
}
