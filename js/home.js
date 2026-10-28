// Libreria: giochi, riquadro "Continua", scheda del gioco, impostazioni e guida.
import * as store from "./store.js";
import { CORES } from "./engine.js";
import { SYSTEMS, tipsFor, ROM_EXTS } from "./rominfo.js";
import { loadSettings, saveSettings, DEFAULTS } from "./settings.js";
import { THEMES, applyTheme, customTheme } from "./themes.js";
import { icon, iconEl } from "./icons.js";
import { h, $, toast, formatWhen, formatDuration, formatBytes, formatDate, pickFile, shareOrDownload, safeFileName, isIOS, isStandalone } from "./util.js";
import { openSheet, confirmDialog, alertDialog, stateCard, emptyState, segmented, toggle, slider, section, menuButton, blobUrl, kindLabel } from "./ui.js";
import { makeZip, isZip } from "./zip.js";

export const APP_VERSION = "1.1.0";

let settings;

const playUrl = (id, state = "best", core = null) => `play.html?id=${encodeURIComponent(id)}&state=${encodeURIComponent(state)}${core ? "&core=" + core : ""}`;

async function boot() {
  settings = await loadSettings();
  applyTheme(settings.theme, settings.customTheme);
  $("#btn-guide").innerHTML = icon("info");
  $("#btn-settings").innerHTML = icon("settings");
  $("#btn-add").innerHTML = icon("plus") + "<span>Aggiungi gioco</span>";
  $("#btn-add").onclick = addGames;
  $("#btn-settings").onclick = openSettings;
  $("#btn-guide").onclick = () => openGuide();
  setupDrop();
  installHint();
  await render();
  registerSW();
  store.pruneEvents().catch(() => {});
  window.vesuvioHome = { ready: true, render, store };
}

function registerSW() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  navigator.serviceWorker.register("sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w && w.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller) {
          toast("Nuova versione pronta: riapri l'app per usarla", { ms: 6000 });
        }
      });
    });
  }).catch(() => {});
}

function installHint() {
  if (isStandalone() || localStorage.getItem("vesuvio.hideInstall")) return;
  const el = $("#install-hint");
  const text = isIOS()
    ? "Per giocare a tutto schermo: tocca Condividi e poi «Aggiungi alla schermata Home». I salvataggi restano anche offline."
    : "Puoi installare Vesuvio come app: cerca «Installa» nel menu del browser.";
  el.className = "hint-card";
  el.append(iconEl("info"), h("p", text), h("button.icon-btn.ghost", { "aria-label": "Chiudi", onclick: () => { el.hidden = true; localStorage.setItem("vesuvio.hideInstall", "1"); } }, iconEl("close")));
  el.hidden = false;
}

// ------------------------------------------------------------------ libreria

async function render() {
  const games = await store.listGames();
  const grid = $("#games");
  grid.innerHTML = "";
  if (!games.length) grid.append(emptyState("Qui compariranno i tuoi giochi, con la loro icona originale.", "library"));
  for (const g of games) grid.append(gameCard(g));
  await renderContinue(games);
  renderFeatures();
  await renderFoot();
}

const DS_ART = `<svg class="ds-art" viewBox="0 0 96 96" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="20" y="8" width="56" height="38" rx="9"/><rect x="29" y="16" width="38" height="22" rx="4" fill="currentColor" fill-opacity=".85" stroke="none"/>
  <rect x="16" y="50" width="64" height="38" rx="10"/><rect x="36" y="58" width="24" height="22" rx="4"/>
  <path d="M25 69h8M29 65v8"/><circle cx="68" cy="66" r="2" fill="currentColor"/><circle cx="72" cy="72" r="2" fill="currentColor"/></svg>`;

function gameCard(g) {
  const sys = SYSTEMS[g.system];
  const art = g.icon ? h("img.game-icon", { src: blobUrl(g.icon), alt: "" }) : h("div.game-icon.placeholder", { dataset: { system: g.system } }, sys.short);
  return h("article.game-card", { dataset: { id: g.id } },
    h("button.game-open", { onclick: () => openGame(g.id), "aria-label": "Dettagli di " + g.title },
      art,
      h("div.game-text",
        h("h3", g.title),
        h("p.muted", [sys.short, g.info?.region, g.playSec ? formatDuration(g.playSec) : null].filter(Boolean).join(" · ")),
        h("p.muted.small", g.lastPlayedAt ? "Giocato " + formatWhen(g.lastPlayedAt) : "Mai avviato"))),
    h("a.play-fab", { href: playUrl(g.id), "aria-label": "Gioca a " + g.title }, iconEl("play")));
}

async function renderContinue(games) {
  const sec = $("#continue");
  sec.innerHTML = "";
  const g = games.find((x) => x.lastPlayedAt) || games[0];
  const screen = h("div.console-screen");
  if (!g) {
    screen.innerHTML = DS_ART;
    screen.append(
      h("p.eyebrow", "La prossima avventura ti aspetta"),
      h("h3", "Pronto a partire?"),
      h("p", "Aggiungi la tua copia di un gioco (.nds, .gba, .gbc, .gb o .zip). Il file resta solo su questo dispositivo."),
      h("button.btn.primary.big", { onclick: addGames }, iconEl("plus"), "Aggiungi gioco"));
    sec.append(h("div.console-top", h("strong", "Nessun gioco caricato"), h("span.led")), screen,
      h("div.console-strip", h("span", "Dual screen · touch"), h("span", "Offline pronto")));
    return;
  }
  const best = await store.bestContinueState(g.id, g.core || SYSTEMS[g.system].cores[0]);
  const shotImg = best?.thumb ? h("img", { src: blobUrl(best.thumb), alt: "Ultima schermata" }) : g.icon ? h("img", { src: blobUrl(g.icon), alt: "" }) : null;
  screen.append(
    h("div.shot" + (g.system === "nds" ? "" : ".gba"), shotImg),
    h("p.eyebrow", g.lastPlayedAt ? "Riprendi l'avventura" : "Pronto a giocare"),
    h("h3", g.title),
    h("p", best ? `${kindLabel(best)} · ${formatWhen(best.createdAt)}` : "Si parte dal salvataggio del gioco"),
    h("div.console-actions",
      h("a.btn.primary.big", { href: playUrl(g.id) }, iconEl("play"), best ? "Continua" : "Gioca"),
      h("button.btn", { onclick: () => openGame(g.id) }, iconEl("load"), "Salvataggi")));
  sec.append(
    h("div.console-top", h("strong", g.title), h("span.led")),
    screen,
    h("div.console-strip",
      h("span", best ? "Ultimo stato · " + formatWhen(best.createdAt) : SYSTEMS[g.system].label),
      h("span", g.playSec ? "⏱ " + formatDuration(g.playSec) : "Nuova partita")));
}

function renderFeatures() {
  const f = $("#features");
  if (f.childElementCount) return;
  const items = [
    ["shield", "Salvataggi a prova di errore", "Stati con miniatura solo mentre giochi, ogni versione del salvataggio del gioco conservata, copia di sicurezza prima di ogni ripristino."],
    ["warning", "Blocchi sotto controllo", "Se il gioco si pianta, anche con lo schermo nero, Vesuvio se ne accorge e protegge gli stati buoni."],
    ["turbo", "Turbo onesto", "Fino a ×6 o al massimo del dispositivo, con la velocità reale sempre visibile."],
    ["share", "La partita passa di mano", "Backup in un file: AirDrop, iCloud o WhatsApp. Nessun account, nessun accesso che scade."],
  ];
  for (const [ic, t, d] of items) f.append(h("div.card.feature", iconEl(ic), h("h3", t), h("p", d)));
}

async function renderFoot() {
  const info = await store.storageInfo();
  const foot = $("#foot");
  foot.innerHTML = "";
  const parts = [];
  if (info.usage != null) parts.push("Spazio usato: " + formatBytes(info.usage));
  foot.append(h("p.muted.small", parts.join(" · ")));
  if (info.persisted === false) {
    foot.append(h("button.btn.ghost.small", { onclick: async () => {
      const ok = await store.requestPersist();
      toast(ok ? "Fatto: il browser non cancellerà i salvataggi per fare spazio" : "Il browser non ha concesso la protezione. Su iPhone/iPad installa l'app sulla schermata Home.", { ms: 5000 });
      renderFoot();
    } }, iconEl("shield"), "Proteggi i salvataggi dalla pulizia del browser"));
  } else if (info.persisted) {
    foot.append(h("p.muted.small", iconEl("shield"), " Archivio protetto dalla pulizia automatica del browser"));
  }
  foot.append(h("p.muted.small", `Vesuvio ${APP_VERSION} · motori: melonDS, DeSmuME, mGBA (build EmulatorJS 4.2.3) · `, h("a", { href: "#", onclick: (e) => { e.preventDefault(); openCredits(); } }, "licenze e crediti")));
}

async function addGames() {
  const files = await pickFile(".nds,.gba,.gbc,.gb,.zip,application/zip,application/octet-stream", true);
  await importFiles(files);
}

async function importFiles(files) {
  let last = null;
  for (const f of files) {
    try {
      const head = new Uint8Array(await f.slice(0, 4).arrayBuffer());
      const ext = f.name.split(".").pop().toLowerCase();
      if (isZip(head) && !ROM_EXTS.includes(ext)) {
        // potrebbe essere un backup di Vesuvio oppure una ROM zippata
        const u8 = new Uint8Array(await f.arrayBuffer());
        try {
          const r = await store.importPackage(u8);
          toast(`Backup importato: ${r.states} stati e ${r.saves} salvataggi di «${r.title}»`, { kind: "ok", ms: 5000 });
          last = r.romId;
          continue;
        } catch (e) {
          if (!/vesuvio\.json/.test(e.message)) throw e;
        }
      }
      toast("Analizzo " + f.name + "…");
      const { game, duplicate } = await store.addGameFromFile(f);
      last = game.id;
      toast(duplicate ? `«${game.title}» è già nella libreria` : `Aggiunto: ${game.title}`, { kind: "ok" });
    } catch (e) {
      toast(f.name + ": " + e.message, { kind: "error", ms: 6000 });
    }
  }
  await render();
  if (last && files.length === 1) openGame(last);
  if (files.length) store.requestPersist().catch(() => {});
}

function setupDrop() {
  const drop = $("#drop");
  let depth = 0;
  window.addEventListener("dragenter", (e) => { e.preventDefault(); depth++; drop.hidden = false; });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; drop.hidden = true; } });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    drop.hidden = true;
    importFiles(Array.from(e.dataTransfer.files || []));
  });
}

// ------------------------------------------------------------------ scheda del gioco

async function openGame(id) {
  const g = await store.getGame(id);
  if (!g) return;
  const sheet = openSheet({ title: g.title, wide: true, content: h("div.spinner") });
  const refresh = async () => sheet.setContent(await gameSheetContent(id, refresh, sheet));
  await refresh();
}

async function gameSheetContent(id, refresh, sheet) {
  const g = await store.getGame(id);
  if (!g) { sheet.close(); return []; }
  const sys = SYSTEMS[g.system];
  const coreId = g.core && sys.cores.includes(g.core) ? g.core : sys.cores[0];
  const states = await store.listStates(id);
  const saves = await store.listSaves(id);
  const best = await store.bestContinueState(id, coreId);
  const info = g.info || {};

  const head = h("div.game-head",
    g.icon ? h("img.game-icon.big", { src: blobUrl(g.icon), alt: "" }) : h("div.game-icon.placeholder.big", sys.short),
    h("div",
      h("p.muted", [sys.label, info.region, info.gameCode ? "codice " + info.gameCode : null, info.revision != null ? "rev. " + info.revision : null].filter(Boolean).join(" · ")),
      info.pokemon ? h("p.ok-text", iconEl("check"), " Riconosciuto: ", g.title) : (info.titles?.it || info.titles?.en ? h("p.small", (info.titles.it || info.titles.en).replace(/\n/g, " · ")) : null),
      h("p.muted.small", `${formatBytes(g.size)} · SHA-1 ${g.id.slice(0, 12)}… · ${g.playSec ? formatDuration(g.playSec) + " di gioco" : "mai giocato"}`)));

  const play = h("div.row.wrap",
    h("a.btn.primary.big", { href: playUrl(id, "best") }, iconEl("play"), best ? "Continua" : "Gioca"),
    best ? h("a.btn", { href: playUrl(id, "none") }, iconEl("file"), "Avvia dal salvataggio del gioco") : null);

  const content = [head, play];
  if (best) {
    content.push(h("div.resume-from", best.thumb ? h("img", { src: blobUrl(best.thumb), alt: "" }) : null,
      h("div", h("strong", "«Continua» riparte da"), h("span", kindLabel(best) + " · " + formatDate(best.createdAt)), h("small", "È lo stato più recente non segnato come sospetto, per il motore " + CORES[coreId].label + "."))));
  }

  if (sys.cores.length > 1) {
    content.push(section("Motore",
      segmented(sys.cores.map((c) => ({ value: c, label: CORES[c].label })), coreId, async (v) => {
        await store.updateGame(id, { ...g, core: v });
        toast("Motore: " + CORES[v].label);
        refresh();
      }, { name: "Motore" }),
      h("p.muted.small", CORES[coreId].desc + " Gli stati funzionano solo con il motore che li ha creati; il salvataggio del gioco viene passato tra motori con lo stesso formato.")));
  }

  // stati
  const stateActions = (s) => [
    h("button.icon-btn.ghost", { "aria-label": s.pinned ? "Togli protezione" : "Proteggi", title: s.pinned ? "Togli protezione" : "Proteggi dalla pulizia automatica", onclick: async (e) => { e.stopPropagation(); await store.updateState(s.id, { pinned: !s.pinned }); refresh(); } }, iconEl("pin", s.pinned ? "on" : "")),
    h("button.icon-btn.ghost", { "aria-label": "Esporta", title: "Esporta questo stato", onclick: async (e) => { e.stopPropagation(); await shareOrDownload(await store.getStateData(s.id), `${safeFileName(g.title)} ${new Date(s.createdAt).toISOString().slice(0, 16).replace(/[T:]/g, "-")} ${s.coreId}.state`); } }, iconEl("share")),
    h("button.icon-btn.ghost", { "aria-label": "Elimina", title: "Elimina", onclick: async (e) => { e.stopPropagation(); if (await confirmDialog("Eliminare questo stato? Non si può annullare.", { ok: "Elimina", danger: true })) { await store.deleteState(s.id); refresh(); } } }, iconEl("trash")),
  ];
  const playable = states.filter((s) => s.coreId === coreId);
  const otherCore = states.length - playable.length;
  content.push(section(`Stati salvati (${states.length})`,
    playable.length ? h("div.state-grid", playable.slice(0, 60).map((s) => stateCard(s, {
      current: best && best.id === s.id,
      actions: stateActions(s),
      onClick: (st) => { location.href = playUrl(id, st.id, st.coreId); },
    }))) : emptyState("Nessuno stato per questo motore. Durante il gioco vengono creati in automatico ogni " + settings.autosave.intervalSec + " secondi, solo quando giochi davvero."),
    otherCore ? h("p.muted.small", `Altri ${otherCore} stati appartengono a un altro motore.`) : null));

  // salvataggi interni
  content.push(section(`Salvataggi del gioco (${saves.length})`,
    h("p.muted.small", "È il salvataggio fatto dal menu del gioco. Vesuvio ne conserva ogni versione diversa, con data e ora: anche se un salvataggio va storto, quelli prima restano."),
    saves.length ? h("ul.save-list", saves.slice(0, 40).map((s, i) => h("li",
      h("div", h("strong", formatDate(s.createdAt)), i === 0 ? h("span.badge.ok", "in uso") : null, s.kind === "import" ? h("span.badge", "importato") : null,
        h("small.muted", ` ${formatBytes(s.size)} · ${CORES[s.coreId]?.label || s.coreId || ""} · ${s.hash.slice(0, 8)}${s.note ? " · " + s.note : ""}`)),
      h("div.row",
        i > 0 ? h("button.btn.small", { onclick: async () => {
          if (!(await confirmDialog("Usare questa versione come salvataggio del gioco? Verrà aggiunta come versione più recente; le altre restano.", { ok: "Usa questa" }))) return;
          await store.addSaveVersion(id, await store.getSaveData(s.id), { kind: "restore", coreId: s.coreId, note: "ripristinata dalla versione del " + formatDate(s.createdAt) });
          toast("Fatto. Avvia «dal salvataggio del gioco» per usarla", { ms: 5000 });
          refresh();
        } }, "Usa questa") : null,
        h("button.icon-btn.ghost", { "aria-label": "Esporta", onclick: async () => shareOrDownload(await store.getSaveData(s.id), safeFileName(g.title) + "." + (CORES[s.coreId]?.saveExt || "sav")) }, iconEl("share")))))) : emptyState("Il gioco non ha ancora scritto un salvataggio interno.")));

  // import / export
  content.push(section("Backup e trasferimento",
    h("p.muted.small", "Per passare la partita su un altro dispositivo: esporta il backup, invialo (AirDrop, WhatsApp, iCloud Drive, e-mail…) e sull'altro dispositivo usa «Importa». Su iPhone e iPad il foglio di condivisione permette anche «Salva su File»."),
    h("div.row.wrap",
      h("button.btn", { onclick: async () => {
        const blob = await store.exportPackage(id);
        await shareOrDownload(blob, `${safeFileName(g.title)} - backup Vesuvio ${new Date().toISOString().slice(0, 10)}.zip`, "application/zip");
      } }, iconEl("share"), "Esporta backup completo"),
      h("button.btn", { onclick: () => importForGame(g, coreId, refresh) }, iconEl("upload"), "Importa…"))));

  const tips = tipsFor(info);
  if (tips.length) content.push(section("Consigli", ...tips.map((t) => h("div.tip-card", h("strong", t.title), h("p", t.text)))));

  content.push(section("",
    h("button.btn.danger.ghost", { onclick: async () => {
      const ok = await confirmDialog(`Eliminare «${g.title}» con tutti i suoi ${states.length} stati e ${saves.length} salvataggi? Consiglio: prima esporta il backup.`, { ok: "Elimina tutto", danger: true, title: "Elimina gioco" });
      if (!ok) return;
      await store.deleteGame(id);
      sheet.close();
      render();
    } }, iconEl("trash"), "Elimina il gioco da questo dispositivo")));
  return content;
}

async function importForGame(g, coreId, refresh) {
  const [f] = await pickFile(".zip,.state,.sav,.dsv,.srm,application/zip,application/octet-stream");
  if (!f) return;
  const ext = f.name.split(".").pop().toLowerCase();
  const u8 = new Uint8Array(await f.arrayBuffer());
  try {
    if (isZip(u8)) {
      const r = await store.importPackage(u8, { expectRomId: g.id });
      await alertDialog(`Importati ${r.states} stati e ${r.saves} salvataggi del gioco${r.skipped ? ` (${r.skipped} erano già presenti)` : ""}. Li trovi tra gli «Importati»: nessuno viene usato finché non lo scegli tu.`, { title: "Backup importato" });
    } else if (ext === "state") {
      const target = coreId;
      const ok = await confirmDialog(`Importare «${f.name}» come stato per il motore ${CORES[target].label}? Funziona solo se è stato creato con lo stesso motore (gli stati di EmulatorJS 4.2.3 usano la stessa build).`, { ok: "Importa" });
      if (!ok) return;
      await store.addState(u8, { romId: g.id, kind: "import", coreId: target, label: f.name, thumb: null, health: { suspect: false, imported: true } }, { prune: false });
      toast("Stato importato: lo trovi tra gli «Importati»", { kind: "ok" });
    } else if (["sav", "dsv", "srm"].includes(ext)) {
      const core = g.system === "nds" ? (ext === "dsv" ? "desmume2015" : "melonds") : "mgba";
      await store.addSaveVersion(g.id, u8, { kind: "import", coreId: core, note: "da " + f.name });
      const go = await confirmDialog("Salvataggio del gioco importato come versione più recente. Vuoi giocare subito partendo da questo salvataggio?", { ok: "Gioca ora", cancel: "Più tardi", title: "Salvataggio importato" });
      if (go) location.href = playUrl(g.id, "none", core);
    } else {
      throw new Error("Tipo di file non riconosciuto: usa .zip, .state, .sav, .dsv o .srm");
    }
  } catch (e) {
    await alertDialog(e.message, { title: "Importazione non riuscita" });
  }
  refresh();
}

// ------------------------------------------------------------------ impostazioni

function openSettings() {
  const s = openSheet({ title: "Impostazioni", wide: true, content: [] });
  const rerender = () => s.setContent(settingsContent(rerender));
  rerender();
}

function settingsContent(rerender) {
  const save = async (patch, re = false) => { settings = await saveSettings(patch); if (re) rerender(); };
  const all = [...Object.entries(THEMES), ["custom", customTheme(settings.customTheme)]];
  const themes = h("div.theme-grid", all.map(([id, t]) => h("button.theme-swatch" + (settings.theme === id ? ".on" : ""), {
    style: { "--sw-bg": t.bg, "--sw-surface": t.surface, "--sw-accent": t.accent, "--sw-accent2": t.accent2, "--sw-text": t.text, "--sw-4": (t.faces && t.faces[2]) || t.btn },
    onclick: async () => { applyTheme(id, settings.customTheme); await save({ theme: id }, true); },
    "aria-label": "Tema " + t.name,
  }, h("span.sw-preview", h("i"), h("i"), h("i"), h("i")), h("strong", t.name), h("small", t.desc))));
  const ct = settings.customTheme;
  const colorInput = (key, label) => h("label.color-field", h("input", {
    type: "color", value: ct[key],
    oninput: (e) => applyTheme("custom", { ...settings.customTheme, [key]: e.target.value }),
    onchange: async (e) => { await save({ customTheme: { [key]: e.target.value }, theme: "custom" }); applyTheme("custom", settings.customTheme); rerender(); },
  }), h("span", label));
  const customBox = h("div.custom-theme", h("p.muted.small", "Tema personalizzato: scegli i tuoi colori (si applica subito)."),
    h("div.color-row", colorInput("bg", "Sfondo"), colorInput("accent", "Colore principale"), colorInput("accent2", "Secondo colore"), colorInput("btn", "Tasti")));
  const a = settings.autosave;
  const w = settings.watchdog;
  const c = settings.controls;
  return [
    section("Tema", themes, customBox),
    section("Salvataggi automatici",
      h("p.muted.small", "Ogni intervallo, solo se stai giocando (niente salvataggi a gioco fermo, durante l'avvio o subito dopo un ripristino). Ogni " + a.checkpointEveryMin + " minuti uno diventa «checkpoint» e resta più a lungo."),
      segmented([15, 30, 60, 120].map((v) => ({ value: v, label: v < 60 ? v + " s" : v / 60 + " min" })), a.intervalSec, (v) => save({ autosave: { intervalSec: v } }), { name: "Intervallo" }),
      slider("Automatici da conservare", { min: 4, max: 40, step: 1, value: a.keepAuto, format: (v) => v + " (≈ " + Math.round((v * a.intervalSec) / 60) + " min)" }, (v, d) => d && save({ autosave: { keepAuto: v } })),
      slider("Checkpoint da conservare", { min: 4, max: 48, step: 1, value: a.keepCheckpoints, format: (v) => v + " (≈ " + formatDuration(v * a.checkpointEveryMin * 60) + ")" }, (v, d) => d && save({ autosave: { keepCheckpoints: v } })),
      h("p.muted.small", "I salvataggi manuali, gli importati e quelli protetti non vengono mai cancellati in automatico.")),
    section("Sorveglianza dei blocchi",
      h("p.muted.small", "Due controlli: il motore che smette di produrre fotogrammi, e il gioco che resta su un'immagine identica mentre premi i tasti (es. schermo nero). In entrambi i casi i salvataggi automatici si fermano e nessuno stato viene cancellato."),
      h("label.field", h("span", "Motore fermo da"), segmented([5, 8, 15].map((v) => ({ value: v, label: v + " s" })), w.hardSec, (v) => save({ watchdog: { hardSec: v } }), { name: "Motore fermo" })),
      h("label.field", h("span", "Immagine ferma da"), segmented([30, 60, 120, 99999].map((v) => ({ value: v, label: v > 9999 ? "Mai" : v + " s" })), w.softSec, (v) => save({ watchdog: { softSec: v } }), { name: "Immagine ferma" }))),
    section("Controlli touch",
      segmented([{ value: "slide", label: "Croce scorrevole" }, { value: "stick", label: "Analogico" }], c.dpad, (v) => save({ controls: { dpad: v } }), { name: "Croce" }),
      segmented([{ value: "xbox", label: "8 direzioni (come Xbox)" }, { value: "narrow", label: "Diagonali strette" }], c.diagonals || "xbox", (v) => save({ controls: { diagonals: v } }), { name: "Diagonali" }),
      segmented([{ value: "theme", label: "Tasti del tema" }, { value: "classic", label: "Classici" }, { value: "mono", label: "Tinta unita" }], c.colors || "theme", (v) => save({ controls: { colors: v } }), { name: "Colori tasti" }),
      slider("Trasparenza", { min: 0.25, max: 1, step: 0.05, value: c.opacity, format: (v) => Math.round(v * 100) + "%" }, (v, d) => d && save({ controls: { opacity: v } })),
      slider("Dimensione", { min: 0.75, max: 1.3, step: 0.05, value: c.scale, format: (v) => Math.round(v * 100) + "%" }, (v, d) => d && save({ controls: { scale: v } })),
      toggle("Lettere sui tasti", c.labels, (v) => save({ controls: { labels: v } })),
      toggle("Vibrazione (solo Android)", c.haptics, (v) => save({ controls: { haptics: v } }))),
    section("Modalità gioco",
      toggle("Nascondi la barra in alto durante il gioco", !!settings.game.immersive, (v) => save({ game: { immersive: v } }), "Solo gioco e controlli; il menu resta in un angolo"),
      toggle("Schermo intero all'avvio del gioco", !!settings.game.fullscreen, (v) => save({ game: { fullscreen: v } }), "Su iPhone si ottiene installando l'app sulla schermata Home")),
    section("Turbo",
      segmented([1.5, 2, 3, 4, 6, 0].map((v) => ({ value: v, label: v ? "×" + v : "Max" })), settings.turbo.ratio, (v) => save({ turbo: { ratio: v } }), { name: "Velocità" }),
      segmented([{ value: "toggle", label: "Tocca: acceso/spento" }, { value: "hold", label: "Tieni premuto" }], settings.turbo.mode, (v) => save({ turbo: { mode: v } }), { name: "Modalità" }),
      toggle("Silenzia l'audio durante il turbo", settings.turbo.mute, (v) => save({ turbo: { mute: v } })),
      toggle("Mostra la velocità reale durante il gioco", settings.showSpeed, (v) => save({ showSpeed: v }))),
    section("Tastiera", keyboardEditor(save, rerender)),
    section("Dati",
      h("div.row.wrap",
        h("button.btn", { onclick: exportAll }, iconEl("share"), "Backup di tutti i giochi"),
        h("button.btn.ghost", { onclick: async () => { if (await confirmDialog("Ripristinare le impostazioni predefinite? Giochi e salvataggi non vengono toccati.", { ok: "Ripristina" })) { await saveSettings(structuredClone(DEFAULTS)); location.reload(); } } }, iconEl("restart"), "Impostazioni predefinite"))),
  ];
}

const BTN_NAMES = ["UP", "DOWN", "LEFT", "RIGHT", "A", "B", "X", "Y", "L", "R", "START", "SELECT"];
const ACTIONS = { turbo: "Turbo", quicksave: "Salva ora", quickload: "Carica ultimo manuale", menu: "Menu", pause: "Pausa" };

function keyboardEditor(save, rerender) {
  const rows = [];
  const keyFor = (map, val) => Object.entries(map).filter(([, v]) => v === val).map(([k]) => k.replace(/^Key/, "").replace(/^Arrow/, "Freccia ")).join(", ") || "—";
  const listen = (onKey) => {
    toast("Premi il tasto da assegnare (Esc per annullare)", { ms: 4000 });
    const f = (e) => {
      e.preventDefault();
      window.removeEventListener("keydown", f, true);
      if (e.code !== "Escape") onKey(e.code);
    };
    window.addEventListener("keydown", f, true);
  };
  for (const b of BTN_NAMES) {
    rows.push(h("tr", h("th", b), h("td", keyFor(settings.keyboard, b)), h("td", h("button.btn.small", { onclick: () => listen(async (code) => {
      const map = Object.fromEntries(Object.entries(settings.keyboard).filter(([k, v]) => v !== b && k !== code));
      map[code] = b;
      settings = await saveSettings({ keyboard: null });
      await save({ keyboard: map }, true);
    }) }, "Cambia"))));
  }
  for (const [act, label] of Object.entries(ACTIONS)) {
    rows.push(h("tr", h("th", label), h("td", keyFor(settings.hotkeys, act)), h("td", h("button.btn.small", { onclick: () => listen(async (code) => {
      const map = Object.fromEntries(Object.entries(settings.hotkeys).filter(([k, v]) => v !== act && k !== code));
      map[code] = act;
      settings = await saveSettings({ hotkeys: null });
      await save({ hotkeys: map }, true);
    }) }, "Cambia"))));
  }
  return [h("p.muted.small", "Per PC e iPad con tastiera. I controller (Xbox, PlayStation, MFi) funzionano senza configurazione."), h("table.kv.keys", rows)];
}

async function exportAll() {
  const games = await store.listGames();
  if (!games.length) return toast("Nessun gioco");
  toast("Preparo il backup…");
  const entries = [];
  for (const g of games) {
    const blob = await store.exportPackage(g.id);
    entries.push({ name: safeFileName(g.title) + " - " + g.id.slice(0, 8) + ".zip", data: new Uint8Array(await blob.arrayBuffer()) });
  }
  entries.push({ name: "LEGGIMI.txt", data: "Ogni file .zip qui dentro è il backup di un gioco: importalo da Vesuvio → Aggiungi gioco (o trascinalo nella libreria). Le ROM non sono incluse.\n" });
  await shareOrDownload(makeZip(entries), `Vesuvio backup completo ${new Date().toISOString().slice(0, 10)}.zip`, "application/zip");
}

// ------------------------------------------------------------------ guida e crediti

function openGuide() {
  openSheet({
    title: "Guida rapida",
    wide: true,
    content: [
      section("Installare l'app",
        h("p", h("strong", "iPhone e iPad: "), "apri il sito con Safari, tocca Condividi ", iconEl("share"), " e poi «Aggiungi alla schermata Home». Si apre a tutto schermo e funziona anche offline."),
        h("p", h("strong", "Android: "), "con Chrome, menu ⋮ → «Installa app»."),
        h("p", h("strong", "PC e Mac: "), "con Chrome o Edge, icona di installazione nella barra degli indirizzi. Si gioca anche con tastiera o controller.")),
      section("I tuoi giochi",
        h("p", "Aggiungi le tue copie dei giochi (.nds, .gba, .gbc, .gb, anche dentro un .zip). Restano solo su questo dispositivo. Vesuvio riconosce il gioco e la versione e, per i DS, mostra l'icona originale.")),
      section("Salvataggi, in breve",
        h("ul",
          h("li", h("strong", "Stato: "), "una «fotografia» completa del momento esatto. Si crea con ", iconEl("save"), " (tieni premuto per l'elenco) e in automatico."),
          h("li", h("strong", "Salvataggio del gioco (.sav): "), "quello che fai dal menu del gioco. Vesuvio ne conserva ogni versione."),
          h("li", h("strong", "Continua "), "riparte dallo stato più recente che non è sospetto; tutti gli altri restano disponibili con la loro miniatura."),
          h("li", "Prima di caricare uno stato, Vesuvio copia la partita attuale tra le «copie di sicurezza»: non si perde mai la partita più recente."))),
      section("Passare la partita a un altro dispositivo",
        h("ol",
          h("li", "Scheda del gioco → «Esporta backup completo»."),
          h("li", "Invia il file (AirDrop, WhatsApp, iCloud Drive, e-mail…)."),
          h("li", "Sull'altro dispositivo: aggiungi la stessa ROM, poi «Importa…» e scegli il file.")),
        h("p.muted.small", "Non serve nessun account e non ci sono accessi che scadono.")),
      section("Turbo e velocità",
        h("p", "Il pulsante ", iconEl("turbo"), " accelera tutto il gioco. Tieni premuto per scegliere la velocità. In alto vedi la velocità reale: se il dispositivo non ce la fa, il numero lo dice chiaramente. Da «Velocità» puoi misurare il massimo del tuo dispositivo.")),
      section("Se qualcosa si blocca",
        h("p", "Vesuvio se ne accorge (motore fermo o immagine immobile mentre premi i tasti), sospende i salvataggi automatici e ti propone lo stato sano più recente. Da «Diagnostica» puoi esportare un rapporto tecnico.")),
      section("Tastiera (PC/iPad)",
        h("p.muted", "Frecce = croce · X = A · Z = B · S = X · A = Y · Q = L · W = R · Invio = Start · Backspace = Select · Spazio = turbo · F2 salva · F4 carica · Esc menu. Si cambiano dalle Impostazioni.")),
    ],
  });
}

function openCredits() {
  openSheet({
    title: "Licenze e crediti",
    content: [
      h("p", "Vesuvio è software libero (GPL-3.0). Usa i core compilati da EmulatorJS 4.2.3:"),
      h("ul",
        h("li", "melonDS — GPL-3.0"),
        h("li", "DeSmuME / DeSmuME 2015 — GPL-2.0"),
        h("li", "mGBA — MPL-2.0"),
        h("li", "RetroArch (frontend dei core) — GPL-3.0"),
        h("li", "EmulatorJS (build dei core per il web) — GPL-3.0")),
      h("p.muted.small", "Vesuvio non include giochi né BIOS. Usa solo copie dei giochi che possiedi. Pokémon è un marchio dei rispettivi proprietari; questo progetto non è affiliato a Nintendo, Game Freak o The Pokémon Company."),
    ],
  });
}

boot().catch((e) => {
  console.error(e);
  document.body.append(h("p.fatal", "Errore: " + (e.message || e)));
});
