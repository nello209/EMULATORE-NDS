// Archivio di dominio: giochi, stati (savestate) e salvataggi interni (.sav).
//
// Regole di sicurezza:
//  - ogni tipo di stato ha la sua quota: gli automatici non possono mai
//    cancellare manuali, checkpoint, fine sessione o importati;
//  - gli stati "protetti" (pinned) non vengono mai cancellati in automatico;
//  - uno stato marcato "sospetto" (catturato durante un blocco) non viene mai
//    proposto come "Continua";
//  - i .sav sono versionati: una nuova versione si aggiunge, non sostituisce.

import { tx, get, getAll, getAllByIndex, put, request } from "./db.js";
import { uid, sha1Hex, fnv1a, gzip, gunzip, canCompress } from "./util.js";
import { analyzeRom, extractRomFromZip } from "./rominfo.js";
import { isZip, makeZip, readZip } from "./zip.js";
import { settingsSync } from "./settings.js";

export const KIND = {
  manual: { label: "Manuale", keep: null },
  auto: { label: "Automatico", keep: "keepAuto" },
  checkpoint: { label: "Checkpoint", keep: "keepCheckpoints" },
  session: { label: "Fine sessione", keep: "keepSessions" },
  prerestore: { label: "Prima di un ripristino", keep: "keepPreRestore" },
  import: { label: "Importato", keep: null },
  diagnostic: { label: "Diagnostica", keep: 5 },
};

export const CONTINUE_KINDS = ["manual", "auto", "checkpoint", "session", "prerestore"];

// ---------------------------------------------------------------- giochi

export async function addGameFromFile(file) {
  let name = file.name;
  let data = new Uint8Array(await file.arrayBuffer());
  if (isZip(data) || /\.zip$/i.test(name)) {
    const r = await extractRomFromZip(data);
    name = r.name;
    data = r.data;
  }
  return addGameFromBytes(name, data);
}

export async function addGameFromBytes(fileName, data) {
  const info = await analyzeRom(fileName, data);
  const id = await sha1Hex(data);
  const existing = await get("games", id);
  if (existing) return { game: existing, duplicate: true };
  const { icon, tips, ...rest } = info;
  const game = {
    id,
    fileName,
    size: data.length,
    system: info.system,
    title: info.title,
    info: rest,
    icon: icon || null,
    addedAt: Date.now(),
    lastPlayedAt: 0,
    playSec: 0,
    core: null,
  };
  await tx(["games", "romData"], "readwrite", (os) => {
    os.games.put(game);
    os.romData.put({ id, data: new Blob([data]) });
  });
  return { game, duplicate: false };
}

export async function listGames() {
  const games = await getAll("games");
  return games.sort((a, b) => (b.lastPlayedAt || b.addedAt) - (a.lastPlayedAt || a.addedAt));
}

export const getGame = (id) => get("games", id);

export async function updateGame(id, patch) {
  return tx("games", "readwrite", async (os) => {
    const g = await request(os.games.get(id));
    if (!g) throw new Error("Gioco non trovato");
    const next = typeof patch === "function" ? patch(g) : { ...g, ...patch };
    os.games.put(next);
    return next;
  });
}

export async function getRom(id) {
  const r = await get("romData", id);
  if (!r) throw new Error("ROM non trovata sul dispositivo: reimportala dalla libreria");
  return new Uint8Array(await r.data.arrayBuffer());
}

export async function deleteGame(id) {
  const states = await getAllByIndex("states", "romId", id);
  const saves = await getAllByIndex("saves", "romId", id);
  await tx(["games", "romData", "states", "stateData", "saves", "saveData"], "readwrite", (os) => {
    os.games.delete(id);
    os.romData.delete(id);
    for (const s of states) { os.states.delete(s.id); os.stateData.delete(s.id); }
    for (const s of saves) { os.saves.delete(s.id); os.saveData.delete(s.id); }
  });
}

// ---------------------------------------------------------------- stati

/**
 * Salva uno stato. data = savestate grezzo del core.
 * meta: { romId, kind, coreId, coreVersion, frame, sessionId, sessionSec, playSec, health, label, thumb }
 */
export async function addState(data, meta, { prune = true } = {}) {
  const t0 = performance.now();
  const id = meta.id || uid();
  let stored = data;
  let enc = "raw";
  if (canCompress && meta.compress !== false) {
    try {
      stored = await gzip(data);
      enc = "gzip";
    } catch (_) {
      stored = data;
      enc = "raw";
    }
  }
  const { compress, ...rest } = meta;
  const record = {
    health: { suspect: false },
    pinned: false,
    label: "",
    ...rest,
    id,
    createdAt: meta.createdAt || Date.now(),
    size: data.length,
    storedSize: stored.length,
    enc,
    checksum: fnv1a(data),
  };
  await tx(["states", "stateData"], "readwrite", (os) => {
    os.states.put(record);
    os.stateData.put({ id, data: new Blob([stored]) });
  });
  record.writeMs = Math.round(performance.now() - t0);
  if (prune) await pruneStates(record.romId, record.kind);
  return record;
}

export async function listStates(romId) {
  const all = await getAllByIndex("states", "romId", romId);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export const getStateMeta = (id) => get("states", id);

export async function getStateData(id) {
  const meta = await get("states", id);
  const rec = await get("stateData", id);
  if (!meta || !rec) throw new Error("Stato non trovato");
  let data = new Uint8Array(await rec.data.arrayBuffer());
  if (meta.enc === "gzip") data = await gunzip(data);
  if (meta.checksum && fnv1a(data) !== meta.checksum) throw new Error("Lo stato è danneggiato (checksum diverso)");
  return data;
}

export async function updateState(id, patch) {
  return tx("states", "readwrite", async (os) => {
    const s = await request(os.states.get(id));
    if (!s) return null;
    const next = typeof patch === "function" ? patch(s) : { ...s, ...patch };
    os.states.put(next);
    return next;
  });
}

export async function deleteState(id) {
  await tx(["states", "stateData"], "readwrite", (os) => {
    os.states.delete(id);
    os.stateData.delete(id);
  });
}

let pruningSuspended = false;
/** Durante un blocco sospendiamo ogni cancellazione automatica. */
export function suspendPruning(v) {
  pruningSuspended = !!v;
}

export async function pruneStates(romId, kind) {
  if (pruningSuspended) return 0;
  const def = KIND[kind];
  if (!def || def.keep == null) return 0;
  const keep = typeof def.keep === "number" ? def.keep : settingsSync().autosave[def.keep];
  if (!keep || keep < 1) return 0;
  const list = (await listStates(romId)).filter((s) => s.kind === kind && !s.pinned);
  const extra = list.slice(keep);
  for (const s of extra) await deleteState(s.id);
  return extra.length;
}

/** Lo stato migliore da cui continuare: il piu' recente non sospetto, dello stesso core. */
export async function bestContinueState(romId, coreId) {
  const list = await listStates(romId);
  return list.find((s) => CONTINUE_KINDS.includes(s.kind) && !s.health?.suspect && (!coreId || s.coreId === coreId)) || null;
}

/** Marca come sospetti gli stati creati dopo "since" (es. poco prima di un blocco). */
export async function markSuspect(romId, since, reason) {
  const list = await listStates(romId);
  let n = 0;
  for (const s of list) {
    if (s.createdAt >= since && s.kind !== "manual" && s.kind !== "import" && !s.health?.suspect) {
      await updateState(s.id, (x) => ({ ...x, health: { ...x.health, suspect: true, reason } }));
      n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------- salvataggi interni (.sav)

export async function listSaves(romId) {
  const all = await getAllByIndex("saves", "romId", romId);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function latestSave(romId) {
  return (await listSaves(romId))[0] || null;
}

export async function getSaveData(id) {
  const rec = await get("saveData", id);
  if (!rec) throw new Error("Salvataggio non trovato");
  return new Uint8Array(await rec.data.arrayBuffer());
}

function isBlank(data) {
  // Un .sav tutto 0xFF o tutto 0x00 e' "vuoto" (gioco mai salvato).
  const first = data[0];
  if (first !== 0 && first !== 0xff) return false;
  for (let i = 0; i < data.length; i++) if (data[i] !== first) return false;
  return true;
}

/**
 * Registra una versione del .sav se diversa dall'ultima.
 * Restituisce il record creato oppure null se identico/vuoto.
 */
export async function addSaveVersion(romId, data, { kind = "auto", coreId = "", note = "" } = {}) {
  if (!data || !data.length) return null;
  if (kind === "auto" && isBlank(data)) return null;
  const hash = await sha1Hex(data);
  const last = await latestSave(romId);
  if (last && last.hash === hash && kind === "auto") return null;
  const record = { id: uid(), romId, createdAt: Date.now(), size: data.length, hash, kind, coreId, note, pinned: false };
  await tx(["saves", "saveData"], "readwrite", (os) => {
    os.saves.put(record);
    os.saveData.put({ id: record.id, data: new Blob([data]) });
  });
  if (!pruningSuspended) {
    const keep = settingsSync().autosave.keepSaves || 30;
    const list = (await listSaves(romId)).filter((s) => !s.pinned);
    for (const s of list.slice(keep)) {
      await tx(["saves", "saveData"], "readwrite", (os) => { os.saves.delete(s.id); os.saveData.delete(s.id); });
    }
  }
  return record;
}

export async function updateSave(id, patch) {
  return tx("saves", "readwrite", async (os) => {
    const s = await request(os.saves.get(id));
    if (!s) return null;
    os.saves.put({ ...s, ...patch });
    return { ...s, ...patch };
  });
}

export async function deleteSave(id) {
  await tx(["saves", "saveData"], "readwrite", (os) => { os.saves.delete(id); os.saveData.delete(id); });
}

// ---------------------------------------------------------------- registro eventi

export async function logEvent(romId, type, detail = {}) {
  try {
    await put("events", { romId, ts: Date.now(), type, detail });
  } catch (_) { /* il registro non deve mai bloccare il gioco */ }
}

export async function listEvents(romId, limit = 300) {
  const all = romId ? await getAllByIndex("events", "romId", romId) : await getAll("events");
  return all.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

export async function pruneEvents(max = 3000) {
  const all = await getAll("events");
  if (all.length <= max) return;
  const old = all.sort((a, b) => a.ts - b.ts).slice(0, all.length - max);
  await tx("events", "readwrite", (os) => { for (const e of old) os.events.delete(e.id); });
}

// ---------------------------------------------------------------- pacchetti di esportazione

const PKG_VERSION = 1;

/** Pacchetto .zip con tutti i salvataggi di un gioco (non contiene la ROM). */
export async function exportPackage(romId, { stateIds = null, includeSaves = true } = {}) {
  const game = await getGame(romId);
  const states = (await listStates(romId)).filter((s) => !stateIds || stateIds.includes(s.id));
  const saves = includeSaves ? await listSaves(romId) : [];
  const entries = [];
  const manifest = {
    format: "vesuvio-backup",
    version: PKG_VERSION,
    exportedAt: new Date().toISOString(),
    game: { id: game.id, title: game.title, fileName: game.fileName, system: game.system, gameCode: game.info?.gameCode || "", playSec: game.playSec },
    states: [],
    saves: [],
  };
  for (const s of states) {
    const data = await getStateData(s.id);
    const { thumb, ...meta } = s;
    const base = `stati/${s.id}`;
    entries.push({ name: base + ".state", data, date: new Date(s.createdAt) });
    if (thumb) entries.push({ name: base + ".png", data: new Uint8Array(await thumb.arrayBuffer()), date: new Date(s.createdAt) });
    manifest.states.push({ ...meta, file: base + ".state", thumbFile: thumb ? base + ".png" : null });
  }
  for (const s of saves) {
    const data = await getSaveData(s.id);
    const file = `salvataggi/${s.id}.sav`;
    entries.push({ name: file, data, date: new Date(s.createdAt) });
    manifest.saves.push({ ...s, file });
  }
  entries.unshift({ name: "vesuvio.json", data: JSON.stringify(manifest, null, 2) });
  entries.push({
    name: "LEGGIMI.txt",
    data: "Backup creato con Vesuvio.\nContiene stati (.state) e salvataggi interni (.sav) di: " + game.title +
      "\nPer ripristinarlo: Vesuvio → scheda del gioco → Importa → scegli questo file.\nLa ROM non è inclusa.\n",
  });
  return makeZip(entries);
}

/** Importa un pacchetto. Restituisce { romId, states, saves, skipped } */
export async function importPackage(u8, { expectRomId = null } = {}) {
  const files = new Map(readZip(u8).map((e) => [e.name, e]));
  const mf = files.get("vesuvio.json");
  if (!mf) throw new Error("Non è un backup di Vesuvio (manca vesuvio.json)");
  const manifest = JSON.parse(new TextDecoder().decode(await mf.read()));
  if (manifest.format !== "vesuvio-backup") throw new Error("Formato backup sconosciuto");
  const romId = manifest.game.id;
  if (expectRomId && romId !== expectRomId) {
    throw new Error(`Questo backup è di «${manifest.game.title}», non del gioco selezionato`);
  }
  if (!(await getGame(romId))) throw new Error(`Prima importa la ROM di «${manifest.game.title}» (la ROM non è nel backup)`);
  const existingStates = new Set((await listStates(romId)).map((s) => s.checksum));
  const existingSaves = new Set((await listSaves(romId)).map((s) => s.hash));
  let states = 0, saves = 0, skipped = 0;
  for (const s of manifest.states) {
    const data = await files.get(s.file).read();
    if (existingStates.has(fnv1a(data))) { skipped++; continue; }
    const thumb = s.thumbFile && files.get(s.thumbFile) ? new Blob([await files.get(s.thumbFile).read()], { type: "image/png" }) : null;
    const { file, thumbFile, id, enc, storedSize, ...meta } = s;
    await addState(data, { ...meta, romId, kind: "import", originalKind: s.kind, thumb, importedAt: Date.now(), label: s.label || "" }, { prune: false });
    states++;
  }
  for (const s of manifest.saves.slice().reverse()) {
    const data = await files.get(s.file).read();
    if (existingSaves.has(await sha1Hex(data))) { skipped++; continue; }
    const rec = await addSaveVersion(romId, data, { kind: "import", coreId: s.coreId, note: "da backup del " + new Date(s.createdAt).toLocaleString("it-IT") });
    if (rec) {
      await updateSave(rec.id, { createdAt: s.createdAt, importedAt: Date.now() });
      saves++;
    }
  }
  return { romId, title: manifest.game.title, states, saves, skipped };
}

// ---------------------------------------------------------------- spazio

export async function storageInfo() {
  const out = { persisted: null, usage: null, quota: null };
  try {
    if (navigator.storage?.persisted) out.persisted = await navigator.storage.persisted();
    if (navigator.storage?.estimate) Object.assign(out, await navigator.storage.estimate());
  } catch (_) { /* non supportato */ }
  return out;
}

export async function requestPersist() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch (_) { /* non supportato */ }
  return false;
}
