// Funzioni di supporto condivise.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Crea un elemento: h("button.primary", { onclick }, "Testo", figlio...) */
export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split(".");
  const el = document.createElement(name || "div");
  if (classes.length) el.className = classes.join(" ");
  if (attrs == null || typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs)) {
    children.unshift(attrs);
    attrs = {};
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "style" && typeof v === "object") {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith("--")) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    }
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha1Hex(data) {
  const buf = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hash veloce non crittografico (FNV-1a 32 bit) per confronti frequenti. */
export function fnv1a(data) {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

async function streamThrough(data, stream) {
  const blob = data instanceof Blob ? data : new Blob([data]);
  return new Uint8Array(await new Response(blob.stream().pipeThrough(stream)).arrayBuffer());
}

export const canCompress = typeof CompressionStream === "function";

export async function gzip(data) {
  return streamThrough(data, new CompressionStream("gzip"));
}

export async function gunzip(data) {
  return streamThrough(data, new DecompressionStream("gzip"));
}

export async function inflateRaw(data) {
  return streamThrough(data, new DecompressionStream("deflate-raw"));
}

export function formatBytes(n) {
  if (n == null) return "—";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

export function formatDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  if (hh) return `${hh} h ${mm} min`;
  if (mm) return `${mm} min`;
  return `${sec} s`;
}

const rtf = typeof Intl !== "undefined" && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat("it", { numeric: "auto" }) : null;

export function formatWhen(ts) {
  if (!ts) return "mai";
  const diff = (ts - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (rtf) {
    if (abs < 45) return "adesso";
    if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
    if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), "day");
  }
  return new Date(ts).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function formatDate(ts) {
  return new Date(ts).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

let toastTimer = null;
export function toast(msg, { kind = "info", ms = 2600 } = {}) {
  let el = document.getElementById("toast");
  if (!el) {
    el = h("div", { id: "toast", role: "status", "aria-live": "polite" });
    document.body.append(el);
  }
  el.textContent = msg;
  el.dataset.kind = kind;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

/** Scarica o condivide un file. Su iPhone/iPad apre il foglio di condivisione (AirDrop, File, iCloud...). */
export async function shareOrDownload(data, fileName, mime = "application/octet-stream", { preferShare = true } = {}) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  if (preferShare && navigator.canShare) {
    try {
      const file = new File([blob], fileName, { type: mime });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: fileName });
        return "shared";
      }
    } catch (e) {
      if (e && e.name === "AbortError") return "cancelled";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return "downloaded";
}

export function pickFile(accept = "", multiple = false) {
  // Su iPhone/iPad un filtro con estensioni sconosciute a iOS (.nds, .state, .sav...)
  // rende i file non selezionabili: li accettiamo tutti e controlliamo dopo.
  if (isIOS()) accept = "";
  return new Promise((resolve) => {
    const input = h("input", { type: "file", accept, multiple, style: { display: "none" } });
    input.addEventListener("change", () => {
      resolve(Array.from(input.files || []));
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

export function safeFileName(s) {
  return String(s || "gioco").replace(/[\\/:*?"<>|\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "gioco";
}

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

export function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
