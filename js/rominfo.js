// Riconoscimento delle ROM: legge intestazioni NDS/GBA/GB, icona e titoli del
// banner DS, e individua i giochi Pokémon noti (con consigli specifici).

import { readZip } from "./zip.js";

export const SYSTEMS = {
  nds: { label: "Nintendo DS", short: "DS", exts: ["nds"], cores: ["melonds", "desmume2015", "desmume"] },
  gba: { label: "Game Boy Advance", short: "GBA", exts: ["gba"], cores: ["mgba"] },
  gbc: { label: "Game Boy Color", short: "GBC", exts: ["gbc"], cores: ["mgba"] },
  gb: { label: "Game Boy", short: "GB", exts: ["gb"], cores: ["mgba"] },
};

export const ROM_EXTS = Object.values(SYSTEMS).flatMap((s) => s.exts);

const REGION = {
  J: "Giappone", E: "USA", P: "Europa", D: "Germania", F: "Francia", I: "Italia", S: "Spagna",
  K: "Corea", O: "Internazionale", U: "Australia", X: "Europa", Y: "Europa", C: "Cina", H: "Paesi Bassi",
};

// Prime tre lettere del codice gioco -> titolo italiano. Chiave "gen5" = Nero/Bianco e seguiti.
const POKEMON = {
  ADA: { it: "Pokémon Versione Diamante", gen: 4 },
  APA: { it: "Pokémon Versione Perla", gen: 4 },
  CPU: { it: "Pokémon Versione Platino", gen: 4 },
  IPK: { it: "Pokémon Versione Oro HeartGold", gen: 4 },
  IPG: { it: "Pokémon Versione Argento SoulSilver", gen: 4 },
  IRB: { it: "Pokémon Versione Nera", gen: 5 },
  IRA: { it: "Pokémon Versione Bianca", gen: 5 },
  IRE: { it: "Pokémon Versione Nera 2", gen: 5 },
  IRD: { it: "Pokémon Versione Bianca 2", gen: 5 },
  AXV: { it: "Pokémon Versione Rubino", gen: 3 },
  AXP: { it: "Pokémon Versione Zaffiro", gen: 3 },
  BPE: { it: "Pokémon Versione Smeraldo", gen: 3 },
  BPR: { it: "Pokémon Versione Rosso Fuoco", gen: 3 },
  BPG: { it: "Pokémon Versione Verde Foglia", gen: 3 },
};

const GB_POKEMON = [
  [/^POKEMON RED/, "Pokémon Versione Rossa"],
  [/^POKEMON BLUE/, "Pokémon Versione Blu"],
  [/^POKEMON YELLOW/, "Pokémon Versione Gialla"],
  [/^POKEMON_GLD|^POKEMON GOLD/, "Pokémon Versione Oro"],
  [/^POKEMON_SLV|^POKEMON SILVER/, "Pokémon Versione Argento"],
  [/^PM_CRYSTAL/, "Pokémon Versione Cristallo"],
];

const ascii = (u8, start, len) =>
  Array.from(u8.subarray(start, start + len)).map((c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : "")).join("").trim();

function utf16(u8, start, bytes) {
  let out = "";
  for (let i = 0; i < bytes; i += 2) {
    const c = u8[start + i] | (u8[start + i + 1] << 8);
    if (!c) break;
    out += String.fromCharCode(c);
  }
  return out;
}

function crc16(u8, start, end) {
  let crc = 0xffff;
  for (let i = start; i < end; i++) {
    crc ^= u8[i];
    for (let b = 0; b < 8; b++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

/** Icona DS 32x32 (4bpp a tasselli) -> PNG Blob. */
async function ndsIcon(u8, off) {
  if (typeof OffscreenCanvas === "undefined" && typeof document === "undefined") return null;
  const pal = [];
  for (let i = 0; i < 16; i++) {
    const c = u8[off + 0x220 + i * 2] | (u8[off + 0x221 + i * 2] << 8);
    pal.push([(c & 31) << 3, ((c >> 5) & 31) << 3, ((c >> 10) & 31) << 3, i === 0 ? 0 : 255]);
  }
  const img = new ImageData(32, 32);
  for (let ty = 0; ty < 4; ty++)
    for (let tx = 0; tx < 4; tx++)
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const byte = u8[off + 0x20 + (ty * 4 + tx) * 32 + y * 4 + (x >> 1)];
          const idx = x & 1 ? byte >> 4 : byte & 15;
          const p = ((ty * 8 + y) * 32 + tx * 8 + x) * 4;
          img.data.set(pal[idx], p);
        }
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(32, 32) : Object.assign(document.createElement("canvas"), { width: 32, height: 32 });
  canvas.getContext("2d").putImageData(img, 0, 0);
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: "image/png" });
  return new Promise((r) => canvas.toBlob(r, "image/png"));
}

function parseNDS(u8) {
  const info = {
    system: "nds",
    headerTitle: ascii(u8, 0, 12),
    gameCode: ascii(u8, 0x0c, 4),
    maker: ascii(u8, 0x10, 2),
    revision: u8[0x1e],
    headerCrcOk: crc16(u8, 0, 0x15e) === (u8[0x15e] | (u8[0x15f] << 8)),
  };
  const bannerOff = u8[0x68] | (u8[0x69] << 8) | (u8[0x6a] << 16) | (u8[0x6b] << 24);
  if (bannerOff && bannerOff + 0x840 <= u8.length) {
    info.bannerOff = bannerOff;
    const langs = ["ja", "en", "fr", "de", "it", "es"];
    info.titles = {};
    langs.forEach((l, i) => {
      info.titles[l] = utf16(u8, bannerOff + 0x240 + i * 0x100, 0x100);
    });
  }
  return info;
}

function parseGBA(u8) {
  return {
    system: "gba",
    headerTitle: ascii(u8, 0xa0, 12),
    gameCode: ascii(u8, 0xac, 4),
    maker: ascii(u8, 0xb0, 2),
    revision: u8[0xbc],
    headerCrcOk: u8[0xb2] === 0x96,
  };
}

function parseGB(u8) {
  const cgb = u8[0x143];
  return {
    system: cgb === 0x80 || cgb === 0xc0 ? "gbc" : "gb",
    headerTitle: ascii(u8, 0x134, cgb & 0x80 ? 11 : 16),
    gameCode: cgb & 0x80 ? ascii(u8, 0x13f, 4) : "",
    maker: "",
    revision: u8[0x14c],
    headerCrcOk: true,
  };
}

export function detectSystem(fileName, u8) {
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  for (const [id, s] of Object.entries(SYSTEMS)) if (s.exts.includes(ext)) return id;
  if (u8 && u8.length > 0x200) {
    if (u8[0xb2] === 0x96) return "gba";
    if (u8[0x104] === 0xce && u8[0x105] === 0xed) return u8[0x143] & 0x80 ? "gbc" : "gb";
    if (u8.length >= 0x4000 && (u8[0x12] === 0 || u8[0x12] === 2 || u8[0x12] === 3)) return "nds";
  }
  return null;
}

/** Analizza una ROM e restituisce informazioni leggibili. */
export async function analyzeRom(fileName, u8) {
  const system = detectSystem(fileName, u8);
  if (!system) throw new Error("Formato non riconosciuto. Usa un file .nds, .gba, .gbc o .gb");
  let info;
  if (system === "nds") info = parseNDS(u8);
  else if (system === "gba") info = parseGBA(u8);
  else info = parseGB(u8);
  info.system = info.system || system;
  const code3 = (info.gameCode || "").slice(0, 3);
  const regionLetter = (info.gameCode || "")[3];
  info.region = REGION[regionLetter] || null;
  let known = POKEMON[code3];
  if (!known && (info.system === "gb" || info.system === "gbc")) {
    const m = GB_POKEMON.find(([re]) => re.test(info.headerTitle));
    if (m) known = { it: m[1], gen: info.system === "gb" ? 1 : 2 };
  }
  if (known) {
    info.pokemon = { gen: known.gen, code: code3 };
    info.title = known.it;
  } else if (info.titles) {
    const t = info.titles.it || info.titles.en || "";
    info.title = t.split("\n").slice(0, 2).join(" — ") || info.headerTitle;
  } else {
    info.title = prettify(info.headerTitle) || fileName.replace(/\.[^.]+$/, "");
  }
  if (info.system === "nds" && info.bannerOff) {
    try { info.icon = await ndsIcon(u8, info.bannerOff); } catch (_) { info.icon = null; }
  }
  info.tips = tipsFor(info);
  return info;
}

function prettify(s) {
  if (!s) return "";
  return s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function tipsFor(info) {
  const tips = [];
  if (info.pokemon && info.pokemon.gen === 5) {
    tips.push({
      id: "cgear",
      title: "C-Gear e Wi-Fi",
      text: "Quando il gioco chiede se attivare il C-Gear, rispondi «No». Il C-Gear usa il Wi-Fi del DS, che in un emulatore web non può collegarsi a nessuno. Secondo le segnalazioni, rispondere «No» ha permesso di superare la ruota panoramica di Sciroccopoli. Se l'hai già acceso, spegnilo toccando il pulsante di accensione sul C-Gear (schermo in basso).",
    });
    tips.push({
      id: "save-before",
      title: "Prima delle scene a rischio",
      text: "Salva anche dal menu del gioco (Menu → Salva) prima di eventi lunghi: il salvataggio interno .sav è il formato più portabile tra emulatori e non dipende dalla versione del motore.",
    });
  }
  if (info.pokemon) {
    tips.push({
      id: "text-speed",
      title: "Dialoghi più rapidi",
      text: "Nelle Opzioni del gioco imposta «Velocità testo: Veloce». Insieme al turbo rende i dialoghi molto più rapidi.",
    });
  }
  return tips;
}

/** Estrae la prima ROM supportata da un archivio .zip. */
export async function extractRomFromZip(u8) {
  for (const entry of readZip(u8)) {
    const ext = entry.name.split(".").pop().toLowerCase();
    if (ROM_EXTS.includes(ext)) return { name: entry.name.split("/").pop(), data: await entry.read() };
  }
  throw new Error("Nell'archivio non c'è nessuna ROM .nds/.gba/.gbc/.gb");
}
