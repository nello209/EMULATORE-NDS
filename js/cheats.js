// Trucchi (cheat): codici Action Replay per il DS, codici per GBA/GB.
// Verificato con la ROM di test: melonDS e DeSmuME 2015 applicano i codici
// Action Replay (anche su piu' righe, unite con "+"); DeSmuME recente no.

export const CHEAT_SUPPORT = {
  melonds: "ok",
  desmume2015: "ok",
  desmume: "no",
  mgba: "unverified",
};

/**
 * Normalizza un codice scritto o incollato dall'utente.
 * DS: coppie di blocchi esadecimali da 8 cifre ("XXXXXXXX YYYYYYYY") -> unite con "+".
 * Restituisce { code, lines } o lancia un errore leggibile.
 */
export function normalizeCode(text, system = "nds") {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Scrivi o incolla il codice");
  if (system === "nds") {
    const cleaned = raw.toUpperCase().replace(/[^0-9A-F\s+:,;]/g, " ");
    const words = cleaned.match(/[0-9A-F]+/g) || [];
    const bad = words.find((w) => w.length !== 8 && w.length !== 16);
    if (bad) throw new Error(`«${bad}» non è un blocco valido: un codice Action Replay è fatto di coppie di 8 cifre esadecimali (0-9, A-F)`);
    const blocks = words.flatMap((w) => (w.length === 16 ? [w.slice(0, 8), w.slice(8)] : [w]));
    if (blocks.length % 2) throw new Error("Il codice ha un numero dispari di blocchi: ne manca uno");
    const lines = [];
    for (let i = 0; i < blocks.length; i += 2) lines.push(blocks[i] + " " + blocks[i + 1]);
    return { code: lines.join("+"), lines };
  }
  const lines = raw.split(/[\r\n+]+/).map((l) => l.trim()).filter(Boolean);
  return { code: lines.join("+"), lines };
}

/**
 * Adatta il codice al motore. Il core melonDS legge ogni blocco con una
 * conversione con segno a 32 bit: i valori da 0x80000000 in su (es. il
 * terminatore "D2000000") venivano troncati a 0x7FFFFFFF, rompendo il codice.
 * Scritti come numero negativo ("-2E000000" = 0xD2000000) arrivano esatti
 * (verificato nei test).
 */
export function encodeForCore(code, coreId) {
  if (coreId !== "melonds") return code;
  return code.replace(/[0-9A-Fa-f]{8}/g, (w) => {
    const v = parseInt(w, 16);
    return v >= 0x80000000 ? "-" + (0x100000000 - v).toString(16).toUpperCase() : w;
  });
}

/** Legge un file di trucchi RetroArch (.cht). */
export function parseCht(text) {
  const map = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m) map[m[1]] = m[2];
  }
  const n = parseInt(map.cheats || "0", 10);
  const out = [];
  for (let i = 0; i < n; i++) {
    const code = map[`cheat${i}_code`];
    if (!code) continue;
    out.push({ name: map[`cheat${i}_desc`] || `Trucco ${i + 1}`, code: code.trim(), enabled: map[`cheat${i}_enable`] === "true" });
  }
  return out;
}
