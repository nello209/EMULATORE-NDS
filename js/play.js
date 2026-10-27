// Schermata di gioco.
import { Engine, CORES, BUTTON } from "./engine.js";
import { Session } from "./session.js";
import { TouchPad, KeyboardInput, GamepadInput } from "./controls.js";
import * as store from "./store.js";
import { loadSettings, saveSettings } from "./settings.js";
import { applyTheme } from "./themes.js";
import { icon, iconEl } from "./icons.js";
import { h, $, toast, formatWhen, formatDuration, formatBytes, shareOrDownload, safeFileName, sleep } from "./util.js";
import { openSheet, closeAllSheets, sheetOpen, confirmDialog, stateCard, emptyState, segmented, toggle, slider, section, menuButton, blobUrl, kindLabel } from "./ui.js";
import { tipsFor } from "./rominfo.js";

const params = new URLSearchParams(location.search);
const root = $("#game");
const stage = $("#stage");
const screensEl = $("#screens");
const canvas = $("#canvas");
const overlay = $("#overlay");
const overlayCard = $("#overlay-card");
const freezeEl = $("#freeze");

let settings, game, engine, session, pad, keyboard;
let paused = false;
let view = "both";
const TURBO_RATIOS = [1.5, 2, 3, 4, 6, 0];

const turboLabel = (r) => (r === 0 ? "Max" : "×" + r);

window.vesuvio = {};

function setOverlay(text, { spinner = true } = {}) {
  overlay.hidden = false;
  overlayCard.innerHTML = "";
  overlayCard.append(spinner ? h("div.spinner") : null, h("p", text));
}

function hideOverlay() {
  overlay.hidden = true;
}

function fatal(title, message, actions = []) {
  overlay.hidden = false;
  overlayCard.innerHTML = "";
  overlayCard.append(
    h("div.overlay-icon.danger", iconEl("warning")),
    h("h2", title),
    h("p", message),
    h("div.row.center", ...actions, h("a.btn.ghost", { href: "./" }, iconEl("home"), "Libreria")));
}

// ------------------------------------------------------------------ avvio

async function boot() {
  settings = await loadSettings();
  applyTheme(settings.theme);
  $("#btn-menu").innerHTML = icon("menu");
  $("#btn-save").innerHTML = icon("save");
  $("#btn-pause").innerHTML = icon("pause");
  $("#btn-turbo").insertAdjacentHTML("afterbegin", icon("turbo"));

  const id = params.get("id");
  game = id ? await store.getGame(id) : null;
  if (!game) return fatal("Gioco non trovato", "Torna alla libreria e scegli un gioco.");
  document.title = game.title + " · Vesuvio";
  $("#title").textContent = game.title;
  root.dataset.system = game.system === "gbc" ? "gb" : game.system;

  const sysCores = game.system === "nds" ? ["melonds", "desmume2015", "desmume"] : ["mgba"];
  let coreId = params.get("core") || game.core || sysCores[0];
  if (!sysCores.includes(coreId)) coreId = sysCores[0];

  setOverlay("Leggo la ROM dal dispositivo…");
  let rom;
  try {
    rom = await store.getRom(game.id);
  } catch (e) {
    return fatal("ROM non disponibile", e.message);
  }

  engine = new Engine({ canvas, coreId });
  engine.ffRatio = settings.turbo.ratio;
  engine.muteOnTurbo = settings.turbo.mute;
  window.vesuvio.engine = engine;
  try {
    await engine.load((t) => setOverlay(t));
  } catch (e) {
    return fatal("Il motore non si è avviato", String(e.message || e), [h("button.btn.primary", { onclick: () => location.reload() }, iconEl("restart"), "Riprova")]);
  }

  // stato da cui ripartire
  const want = params.get("state") || "best";
  let startState = null;
  if (want === "best") startState = await store.bestContinueState(game.id, coreId);
  else if (want !== "none") {
    startState = await store.getStateMeta(want);
    if (startState && startState.coreId && startState.coreId !== coreId) startState = null;
  }
  // Il .sav si passa solo a motori con lo stesso formato (melonDS .sav, DeSmuME .dsv, mGBA .srm).
  const fmt = CORES[coreId].saveExt;
  const sav = (await store.listSaves(game.id)).find((s) => !s.coreId || CORES[s.coreId]?.saveExt === fmt) || null;
  const savData = sav ? await store.getSaveData(sav.id) : null;

  layout();
  await waitForTap(startState, sav);

  setOverlay("Avvio il gioco…");
  const prefs = (game.prefs && game.prefs[coreId]) || {};
  try {
    engine.start({ rom, romName: game.fileName, save: savData, coreOptions: prefs.options || {} });
  } catch (e) {
    return fatal("Il gioco non si è avviato", String(e.message || e));
  }
  session = new Session({ engine, game, settings });
  window.vesuvio.session = session;
  let fromState = null;
  if (startState) {
    try {
      fromState = await store.getStateData(startState.id);
    } catch (e) {
      toast("Stato non leggibile, avvio dal salvataggio del gioco: " + e.message, { kind: "warn", ms: 5000 });
    }
  }
  await session.begin({ fromState });
  wireSession();
  setupInputs();
  hideOverlay();
  updateBar();
  if (startState && fromState && session.loadedFromState) toast("Ripreso da: " + kindLabel(startState) + " · " + formatWhen(startState.createdAt));
  else if (fromState) toast("Lo stato scelto non è stato applicato dal motore: il gioco parte dal suo salvataggio interno.", { kind: "warn", ms: 7000 });
  showTipsOnce();
  window.vesuvio.ready = true;
}

function waitForTap(startState, sav) {
  return new Promise((resolve) => {
    overlay.hidden = false;
    overlayCard.innerHTML = "";
    const go = () => resolve();
    const iconImg = game.icon ? h("img.game-icon.big", { src: blobUrl(game.icon), alt: "" }) : null;
    let from;
    if (startState) {
      from = h("div.resume-from",
        startState.thumb ? h("img", { src: blobUrl(startState.thumb), alt: "" }) : null,
        h("div", h("strong", "Riprendi da"), h("span", kindLabel(startState) + " · " + formatWhen(startState.createdAt)),
          startState.playSec ? h("small", "Tempo di gioco " + formatDuration(startState.playSec)) : null));
    } else {
      from = h("p.muted", sav ? "Si parte dal salvataggio del gioco (" + formatWhen(sav.createdAt) + ")." : "Nuova partita: nessun salvataggio trovato.");
    }
    const btn = h("button.btn.primary.big", { id: "tap-to-play", onclick: go }, iconEl("play"), "Gioca");
    overlayCard.append(iconImg, h("h2", game.title), from, btn,
      h("p.muted.small", "Il tocco serve anche ad attivare l'audio su iPhone e iPad."));
    btn.focus();
  });
}

// ------------------------------------------------------------------ layout

function contentSize() {
  if (game.system === "nds") return { w: 256, h: view === "both" ? 384 : 192, full: 384 };
  if (game.system === "gba") return { w: 240, h: 160, full: 160 };
  return { w: 160, h: 144, full: 144 };
}

function layout() {
  if (!game || !settings) return;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const landscape = W > H * 1.05;
  root.dataset.orient = landscape ? "landscape" : "portrait";
  if (game.system === "nds") view = landscape ? settings.view.ndsLandscape : settings.view.nds;
  else view = "both";
  root.dataset.view = view;
  const c = contentSize();
  const k = settings.controls.scale || 1;
  if (landscape) {
    const side = Math.min(380, Math.max(200 * Math.min(1, k), (W - (H * c.w) / c.h) / 2));
    root.style.setProperty("--side", Math.round(side) + "px");
  } else {
    const padH = Math.min(340, Math.max(220, H * 0.33)) * k;
    root.style.setProperty("--pad-h", Math.round(padH) + "px");
  }
  const cs = getComputedStyle(stage);
  const availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  let scale = Math.min(availW / c.w, availH / c.h);
  // scala intera quando ci si avvicina: pixel piu' nitidi
  const int = Math.floor(scale);
  if (int >= 2 && scale - int < 0.12) scale = int;
  scale = Math.max(0.5, scale);
  screensEl.style.width = Math.round(c.w * scale) + "px";
  screensEl.style.height = Math.round(c.h * scale) + "px";
  canvas.style.width = Math.round(c.w * scale) + "px";
  canvas.style.height = Math.round(c.full * scale) + "px";
  canvas.style.transform = view === "bottom" ? `translateY(${-Math.round(192 * scale)}px)` : "";
  const vb = $("#btn-view");
  vb.hidden = game.system !== "nds";
  vb.innerHTML = icon(view === "both" ? "screens" : view === "top" ? "top" : "bottom");
  vb.setAttribute("aria-label", "Schermi: " + viewName(view));
}

const viewName = (v) => ({ both: "entrambi", top: "solo gioco", bottom: "solo touch" }[v]);

async function setView(v) {
  const landscape = root.dataset.orient === "landscape";
  settings = await saveSettings({ view: landscape ? { ndsLandscape: v } : { nds: v } });
  layout();
  toast("Schermi: " + viewName(v));
}

window.addEventListener("resize", () => layout());
window.addEventListener("orientationchange", () => setTimeout(layout, 250));
new ResizeObserver(() => layout()).observe(stage);

// ------------------------------------------------------------------ input

function press(name, pressed) {
  if (!engine || !engine.started) return;
  const idx = BUTTON[name];
  if (idx === undefined) return;
  if (pressed) {
    session && session.noteInput();
    engine.resumeAudio();
  }
  engine.setInput(idx, pressed ? 1 : 0);
}

function action(name, pressed) {
  if (name === "turbo") {
    if (settings.turbo.mode === "hold") setTurbo(pressed);
    else if (pressed) setTurbo(!engine.fastForward);
  } else if (!pressed) {
    return;
  } else if (name === "quicksave") quickSave();
  else if (name === "quickload") quickLoad();
  else if (name === "menu") (sheetOpen() ? closeAllSheets() : openMenu());
  else if (name === "pause") togglePause();
}

function setupInputs() {
  pad = new TouchPad($("#pad"), { system: game.system, settings: settings.controls, onButton: press, onAction: action });
  window.vesuvio.pad = pad;
  keyboard = new KeyboardInput({ map: settings.keyboard, hotkeys: settings.hotkeys, onButton: press, onAction: action });
  new GamepadInput({
    onButton: press,
    onAction: action,
    onConnect: (gp, on) => toast(on ? "Controller collegato: " + gp.id.slice(0, 40) : "Controller scollegato"),
  });
  // il canvas e' il touch screen del DS: un tocco riattiva anche l'audio
  canvas.addEventListener("pointerdown", () => { engine.resumeAudio(); session && session.noteInput(); });

  const turboBtn = $("#btn-turbo");
  let holdTimer = 0, longPressed = false;
  turboBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    longPressed = false;
    if (settings.turbo.mode === "hold") return setTurbo(true);
    holdTimer = setTimeout(() => { longPressed = true; openTurboSheet(); }, 550);
  });
  const endTurbo = (e) => {
    clearTimeout(holdTimer);
    if (settings.turbo.mode === "hold") return setTurbo(false);
    if (e.type === "pointerup" && !longPressed) setTurbo(!engine.fastForward);
  };
  turboBtn.addEventListener("pointerup", endTurbo);
  turboBtn.addEventListener("pointercancel", endTurbo);
  turboBtn.addEventListener("contextmenu", (e) => e.preventDefault());

  $("#btn-menu").onclick = () => openMenu();
  $("#btn-pause").onclick = () => togglePause();
  $("#btn-view").onclick = () => setView(view === "both" ? "top" : view === "top" ? "bottom" : "both");
  const saveBtn = $("#btn-save");
  let saveTimer = 0, saveLong = false;
  saveBtn.addEventListener("pointerdown", () => { saveLong = false; saveTimer = setTimeout(() => { saveLong = true; openStates(); }, 550); });
  saveBtn.addEventListener("pointerup", () => { clearTimeout(saveTimer); if (!saveLong) quickSave(); });
  saveBtn.addEventListener("pointercancel", () => clearTimeout(saveTimer));
  saveBtn.addEventListener("contextmenu", (e) => e.preventDefault());
}

function setTurbo(on, ratio = settings.turbo.ratio) {
  if (!engine) return;
  engine.setFastForward(on, ratio);
  updateBar();
}

function updateBar() {
  const t = $("#btn-turbo");
  t.classList.toggle("on", !!engine?.fastForward);
  t.querySelector(".turbo-x").textContent = turboLabel(settings.turbo.ratio);
  $("#btn-pause").innerHTML = icon(paused ? "play" : "pause");
  $("#btn-pause").setAttribute("aria-label", paused ? "Riprendi" : "Pausa");
  root.classList.toggle("paused", paused);
}

function togglePause(force) {
  paused = force !== undefined ? force : !paused;
  if (paused) engine.pause();
  else engine.resume();
  updateBar();
}

async function quickSave() {
  if (!session) return;
  try {
    const rec = await session.manualSave();
    toast("Salvato · " + new Date(rec.createdAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }), { kind: "ok" });
  } catch (e) {
    toast("Salvataggio non riuscito: " + e.message, { kind: "error", ms: 5000 });
  }
}

async function quickLoad() {
  const list = (await store.listStates(game.id)).filter((s) => s.kind === "manual" && s.coreId === engine.coreId);
  if (!list.length) return toast("Nessun salvataggio manuale");
  await restoreState(list[0]);
}

// ------------------------------------------------------------------ sessione

function wireSession() {
  const sp = $("#speed");
  sp.hidden = !settings.showSpeed;
  session.addEventListener("speed", (e) => {
    const d = e.detail;
    if (sp.hidden) return;
    const r = d.ratio;
    sp.textContent = d.turbo ? `×${r.toFixed(1)}${d.target ? " / " + d.target : " max"}` : `×${r.toFixed(2)}`;
    sp.classList.toggle("slow", !d.turbo && r < 0.9);
    sp.classList.toggle("turbo", d.turbo);
  });
  session.addEventListener("freeze", (e) => showFreeze(e.detail));
  session.addEventListener("freeze-cleared", () => { freezeEl.hidden = true; });
  session.addEventListener("sav", () => toast("Salvataggio del gioco registrato", { kind: "ok" }));
}

async function showFreeze(f) {
  const best = await store.bestContinueState(game.id, engine.coreId);
  const tips = tipsFor(game.info || {}).filter((t) => t.id === "cgear");
  const actions = h("div.row.wrap",
    best ? h("button.btn.primary", { onclick: () => restoreState(best) }, iconEl("restart"), "Torna allo stato sano più recente") : null,
    h("button.btn", { onclick: () => openStates() }, iconEl("load"), "Scegli uno stato"),
    h("button.btn", { onclick: () => exportSav() }, iconEl("download"), "Esporta .sav"),
    f.type === "soft" ? h("button.btn.ghost", { onclick: () => session.clearFreeze() }, iconEl("check"), "Il gioco funziona") : h("button.btn.ghost", { onclick: () => location.reload() }, iconEl("restart"), "Ricarica"),
  );
  freezeEl.innerHTML = "";
  freezeEl.dataset.type = f.type;
  freezeEl.append(
    h("div.freeze-head", iconEl("warning"), h("strong", f.type === "soft" ? "Il gioco sembra bloccato" : "Il motore si è fermato")),
    h("p", f.type === "soft"
      ? "L'immagine non cambia da molto tempo anche se premi i tasti. Ho sospeso i salvataggi automatici e la pulizia dei vecchi stati, così nessun salvataggio buono viene toccato."
      : "Il motore ha smesso di produrre fotogrammi. Salvataggi automatici e pulizia sono sospesi: i tuoi stati precedenti sono al sicuro."),
    best ? h("div.resume-from.small", best.thumb ? h("img", { src: blobUrl(best.thumb), alt: "" }) : null, h("div", h("strong", "Ultimo stato sano"), h("span", kindLabel(best) + " · " + formatWhen(best.createdAt)))) : null,
    tips.length ? h("p.tip", iconEl("info"), tips[0].text) : null,
    h("p.muted.small", "Dettaglio tecnico: " + f.detail),
    actions);
  freezeEl.hidden = false;
}

async function restoreState(meta) {
  closeAllSheets();
  try {
    setOverlay("Carico lo stato…");
    const { backup } = await session.restore(meta.id);
    hideOverlay();
    freezeEl.hidden = true;
    if (paused) togglePause(false);
    toast("Stato caricato" + (backup ? " · copia di sicurezza creata" : ""), { kind: "ok" });
  } catch (e) {
    hideOverlay();
    toast(e.message, { kind: "error", ms: 6000 });
  }
}

async function exportSav() {
  const data = engine.readSave();
  let bytes = data && data.length ? data : null;
  if (!bytes) {
    const last = await store.latestSave(game.id);
    if (last) bytes = await store.getSaveData(last.id);
  }
  if (!bytes) return toast("Il gioco non ha ancora scritto un salvataggio interno");
  await shareOrDownload(bytes, safeFileName(game.title) + ".sav");
}

async function exitToLibrary() {
  setOverlay("Salvo e torno alla libreria…");
  try { await session?.end(); } catch (_) { /* usciamo comunque */ }
  location.href = "./";
}

// ------------------------------------------------------------------ menu

function withPause(open) {
  const wasPaused = paused;
  if (!wasPaused && engine?.started) togglePause(true);
  return open(() => { if (!wasPaused && !sheetOpen()) togglePause(false); });
}

function openMenu() {
  if (!session) return;
  withPause((onClose) => {
    const s = openSheet({
      title: game.title,
      onClose,
      content: [
        h("div.menu-grid",
          menuButton("play", "Riprendi", () => s.close(), { cls: "primary" }),
          menuButton("save", "Salva ora", async () => { s.close(); await quickSave(); }),
          menuButton("load", "Carica stato", () => openStates()),
          menuButton("turbo", "Velocità", () => openTurboSheet()),
          menuButton("gamepad", "Schermo e controlli", () => openControlsSheet()),
          menuButton("chart", "Diagnostica", () => openDiagnostics()),
          menuButton("download", "Esporta .sav", () => exportSav(), { hint: "salvataggio del gioco" }),
          menuButton("restart", "Riavvia gioco", async () => {
            if (await confirmDialog("Il gioco ripartirà dal suo ultimo salvataggio interno. Prima faccio uno stato di sicurezza.", { ok: "Riavvia" })) {
              try { await session.storeState(engine.saveState(), "prerestore", {}, { label: "Prima del riavvio" }); } catch (_) { /* nessuno */ }
              engine.reset();
              session.markLoaded();
              closeAllSheets();
            }
          }),
          menuButton("home", "Libreria", () => exitToLibrary()),
        ),
        volumeRow(),
        tipsBlock(),
      ],
    });
  });
}

function volumeRow() {
  const mute = toggle("Audio disattivato", engine.muted, (v) => engine.setMuted(v));
  const vol = slider("Volume", { min: 0, max: 1, step: 0.05, value: engine.volume, format: (v) => Math.round(v * 100) + "%" }, (v) => engine.setVolume(v));
  return section("Audio", vol, mute);
}

function tipsBlock() {
  const tips = tipsFor(game.info || {});
  if (!tips.length) return null;
  return section("Consigli per questo gioco", ...tips.map((t) => h("div.tip-card", h("strong", t.title), h("p", t.text))));
}

async function showTipsOnce() {
  const tips = tipsFor(game.info || {});
  const t = tips.find((x) => x.id === "cgear");
  if (!t) return;
  const key = "tip-cgear-" + game.id;
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, "1");
  setTimeout(() => toast("Consiglio: quando il gioco chiede di attivare il C-Gear, rispondi «No». Dettagli nel menu.", { ms: 7000 }), 1500);
}

async function openStates() {
  const list = await store.listStates(game.id);
  const best = await store.bestContinueState(game.id, engine.coreId);
  const compatible = list.filter((s) => !s.coreId || s.coreId === engine.coreId);
  const other = list.length - compatible.length;
  const groups = [
    ["Salvati da te", (s) => s.kind === "manual"],
    ["Automatici", (s) => s.kind === "auto" || s.kind === "session"],
    ["Checkpoint", (s) => s.kind === "checkpoint"],
    ["Copie di sicurezza", (s) => s.kind === "prerestore"],
    ["Importati", (s) => s.kind === "import"],
    ["Diagnostica", (s) => s.kind === "diagnostic"],
  ];
  const content = [];
  if (!compatible.length) content.push(emptyState("Nessuno stato per questo motore. Usa «Salva ora» per crearne uno."));
  for (const [title, f] of groups) {
    const items = compatible.filter(f);
    if (!items.length) continue;
    content.push(section(title, h("div.state-grid", items.map((s) => stateCard(s, {
      current: best && s.id === best.id,
      onClick: async (st) => {
        const warn = st.health?.suspect ? "\n\nAttenzione: questo stato è stato creato durante un possibile blocco." : "";
        if (await confirmDialog(`Caricare lo stato «${kindLabel(st)}» di ${formatWhen(st.createdAt)}? La partita attuale verrà prima copiata tra le copie di sicurezza.${warn}`, { ok: "Carica", detail: st.thumb ? h("img.confirm-thumb", { src: blobUrl(st.thumb), alt: "" }) : null })) restoreState(st);
      },
    })))));
  }
  if (other) content.push(h("p.muted.small", `${other} stati appartengono a un altro motore e non sono mostrati.`));
  withPause((onClose) => openSheet({ title: "Carica uno stato", content, onClose, wide: true }));
}

function openTurboSheet() {
  const t = settings.turbo;
  const res = h("p.muted", "Il turbo accelera tutto il sistema emulato (processore, animazioni, dialoghi, musica) fino a dove il dispositivo regge. La velocità reale è mostrata in alto.");
  const bench = h("button.btn", { onclick: async () => {
    bench.disabled = true;
    bench.textContent = "Misuro… (3 s)";
    if (paused) togglePause(false);
    const r = await session.benchmark(3000);
    bench.disabled = false;
    bench.textContent = "Misura di nuovo";
    res.textContent = `Velocità normale: ×${r.normalRatio} · Turbo massimo su questo dispositivo, in questa scena: ×${r.maxRatio}. ` +
      (r.maxRatio < 1.3 ? "Il dispositivo è quasi al limite: il turbo darà poco. Prova a chiudere altre app o, per il DS, il motore DeSmuME 2015 con salto fotogrammi." : "Puoi scegliere un turbo fino a circa ×" + Math.max(1.5, Math.floor(r.maxRatio * 2) / 2) + ".");
  } }, iconEl("chart"), "Misura il turbo massimo");
  withPause((onClose) => openSheet({
    title: "Velocità",
    onClose,
    content: [
      section("Velocità del turbo", segmented(TURBO_RATIOS.map((r) => ({ value: r, label: turboLabel(r) })), t.ratio, async (v) => {
        settings = await saveSettings({ turbo: { ratio: v } });
        engine.ffRatio = v;
        if (engine.fastForward) engine.setFastForward(true, v);
        updateBar();
      }, { name: "Velocità turbo" })),
      section("Pulsante turbo", segmented([{ value: "toggle", label: "Tocca: acceso/spento" }, { value: "hold", label: "Tieni premuto" }], t.mode, async (v) => {
        settings = await saveSettings({ turbo: { mode: v } });
        if (v === "hold") setTurbo(false);
      }, { name: "Modalità turbo" }),
      toggle("Silenzia l'audio durante il turbo", t.mute, async (v) => {
        settings = await saveSettings({ turbo: { mute: v } });
        engine.muteOnTurbo = v;
        engine.setVolume(engine.volume);
      }, "Durante l'accelerazione l'audio tende a gracchiare"),
      toggle("Mostra la velocità reale", settings.showSpeed, async (v) => {
        settings = await saveSettings({ showSpeed: v });
        $("#speed").hidden = !v;
      })),
      section("Prestazioni", res, bench),
    ],
  }));
}

function openControlsSheet() {
  const c = settings.controls;
  const apply = async (patch) => {
    settings = await saveSettings({ controls: patch });
    pad.setSettings(settings.controls);
  };
  const content = [];
  if (game.system === "nds") {
    content.push(section("Schermi del DS", segmented([
      { value: "both", label: "Entrambi", icon: "screens" },
      { value: "top", label: "Solo gioco", icon: "top" },
      { value: "bottom", label: "Solo touch", icon: "bottom" },
    ], view, (v) => setView(v), { name: "Schermi" }), h("p.muted.small", "Vale per l'orientamento attuale (verticale o orizzontale): puoi avere una scelta diversa per ciascuno.")));
  }
  content.push(section("Croce direzionale",
    segmented([{ value: "slide", label: "Scorrevole" }, { value: "stick", label: "Analogico" }], c.dpad, (v) => apply({ dpad: v }), { name: "Croce" }),
    h("p.muted.small", "Scorrevole: trascina il dito tra le direzioni senza alzarlo. Le diagonali sono strette per non sbagliare passo.")));
  content.push(section("Aspetto",
    slider("Trasparenza", { min: 0.25, max: 1, step: 0.05, value: c.opacity, format: (v) => Math.round(v * 100) + "%" }, (v, done) => { $("#pad").style.setProperty("--pad-opacity", v); if (done) apply({ opacity: v }); }),
    slider("Dimensione", { min: 0.75, max: 1.3, step: 0.05, value: c.scale, format: (v) => Math.round(v * 100) + "%" }, (v, done) => { $("#pad").style.setProperty("--pad-scale", v); if (done) apply({ scale: v }).then(layout); }),
    toggle("Mostra le lettere sui tasti", c.labels, (v) => apply({ labels: v })),
    toggle("Vibrazione (solo Android)", c.haptics, (v) => apply({ haptics: v }))));
  content.push(section("Motore", engineInfo()));
  withPause((onClose) => openSheet({ title: "Schermo e controlli", content, onClose }));
}

function engineInfo() {
  const core = CORES[engine.coreId];
  const rows = [h("p", h("strong", core.label), " — ", core.desc)];
  if (engine.coreId.startsWith("desmume")) {
    const cur = (game.prefs && game.prefs[engine.coreId] && game.prefs[engine.coreId].options && game.prefs[engine.coreId].options.desmume_frameskip) || "0";
    rows.push(section("Salto fotogrammi", segmented(["0", "1", "2", "3"].map((v) => ({ value: v, label: v === "0" ? "No" : v })), cur, async (v) => {
      engine.setOption("desmume_frameskip", v);
      game = await store.updateGame(game.id, (g) => ({ ...g, prefs: { ...(g.prefs || {}), [engine.coreId]: { options: { ...((g.prefs || {})[engine.coreId]?.options || {}), desmume_frameskip: v } } } }));
      toast("Salto fotogrammi: " + (v === "0" ? "disattivato" : v));
    }, { name: "Salto fotogrammi" }), h("p.muted.small", "Disegna meno fotogrammi per alleggerire i dispositivi lenti. Il gioco resta alla stessa velocità.")));
  }
  rows.push(h("p.muted.small", "Per cambiare motore torna alla libreria e apri la scheda del gioco. Gli stati funzionano solo con il motore che li ha creati."));
  return rows;
}

async function openDiagnostics() {
  const events = await store.listEvents(game.id, 400);
  const perf = events.filter((e) => e.type === "perf" && e.detail.session === session.id).reverse();
  const saves = events.filter((e) => e.type === "autosave" && e.detail.session === session.id);
  const info = await store.storageInfo();
  const rows = [
    ["Motore", CORES[engine.coreId].label + (engine.coreVersion ? " " + engine.coreVersion : "")],
    ["Velocità attuale", "×" + session.speed.ratio.toFixed(2) + (engine.fastForward ? " (turbo " + turboLabel(engine.ffRatio) + ")" : "")],
    ["Tempo di gioco in questa sessione", formatDuration(session.runSec)],
    ["Fotogrammi emulati", engine.frame.toLocaleString("it-IT")],
    ["Salvataggi automatici", session.frozen ? "sospesi (blocco: " + session.frozen.type + ")" : "attivi ogni " + settings.autosave.intervalSec + " s"],
    ["Ultimo salvataggio automatico", saves[0] ? formatWhen(saves[0].ts) + " · " + saves[0].detail.totalMs + " ms · " + formatBytes(saves[0].detail.stored) : "—"],
    ["Spazio usato", info.usage != null ? formatBytes(info.usage) + (info.quota ? " di " + formatBytes(info.quota) : "") : "—"],
    ["Archivio persistente", info.persisted == null ? "non supportato" : info.persisted ? "sì" : "no"],
    ["Isolamento / thread", self.crossOriginIsolated ? "sì" : "no"],
  ];
  const table = h("table.kv", rows.map(([k, v]) => h("tr", h("th", k), h("td", v))));
  const chart = perfChart(perf);
  const exportBtn = h("button.btn", { onclick: async () => {
    const all = await store.listEvents(game.id, 3000);
    const report = { app: "Vesuvio", createdAt: new Date().toISOString(), game: { title: game.title, code: game.info?.gameCode, sha1: game.id }, core: engine.coreId, coreVersion: engine.coreVersion, ua: navigator.userAgent, events: all };
    await shareOrDownload(JSON.stringify(report, null, 1), "vesuvio-diagnostica-" + Date.now() + ".json", "application/json");
  } }, iconEl("share"), "Esporta rapporto diagnostico");
  withPause((onClose) => openSheet({
    title: "Diagnostica",
    onClose,
    content: [
      table,
      section("Velocità minuto per minuto (questa sessione)", chart || h("p.muted", "Il primo campione arriva dopo un minuto di gioco.")),
      h("p.muted.small", "Il rapporto contiene solo dati tecnici (velocità, salvataggi, blocchi, modello del browser): niente ROM e niente salvataggi. Serve per capire, con dati veri, se e quando il gioco rallenta."),
      exportBtn,
    ],
  }));
}

function perfChart(perf) {
  if (!perf.length) return null;
  const w = 300, hgt = 90, pad = 4;
  const max = Math.max(1.2, ...perf.map((p) => p.detail.avgRatio));
  const x = (i) => pad + (i * (w - 2 * pad)) / Math.max(1, perf.length - 1);
  const y = (v) => hgt - pad - (v / max) * (hgt - 2 * pad);
  const line = perf.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.detail.avgRatio).toFixed(1)}`).join(" ");
  const ref = y(1);
  const svg = `<svg viewBox="0 0 ${w} ${hgt}" class="perf-chart" role="img" aria-label="Velocità media per minuto"><line x1="0" x2="${w}" y1="${ref}" y2="${ref}" class="ref"/><path d="${line}" class="line"/></svg>`;
  const t = document.createElement("div");
  t.innerHTML = svg + `<p class="muted small">Linea tratteggiata = velocità normale (×1). Minimo registrato: ×${Math.min(...perf.map((p) => p.detail.minRatio)).toFixed(2)}.</p>`;
  return t;
}

boot().catch((e) => {
  console.error(e);
  fatal("Errore inatteso", String(e && (e.message || e)));
});
