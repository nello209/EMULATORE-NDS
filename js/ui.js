// Componenti d'interfaccia condivisi: fogli a scomparsa, conferme, schede degli stati.
import { h, formatWhen, formatDate, formatDuration, formatBytes } from "./util.js";
import { iconEl } from "./icons.js";
import { KIND } from "./store.js";

let sheetStack = [];

export function openSheet({ title, content, onClose, wide = false, className = "" }) {
  const close = () => {
    if (!wrap.isConnected) return;
    wrap.classList.remove("open");
    sheetStack = sheetStack.filter((s) => s !== api);
    setTimeout(() => wrap.remove(), 200);
    if (onClose) onClose();
  };
  const body = h("div.sheet-body");
  const head = h("div.sheet-head", h("h2", title), h("button.icon-btn.ghost", { "aria-label": "Chiudi", onclick: close }, iconEl("close")));
  const panel = h("div.sheet" + (wide ? ".wide" : "") + (className ? "." + className : ""), { role: "dialog", "aria-modal": "true", "aria-label": title }, head, body);
  const wrap = h("div.sheet-wrap", { onclick: (e) => { if (e.target === wrap) close(); } }, panel);
  const setContent = (c) => { body.innerHTML = ""; body.append(...[].concat(c).filter(Boolean)); };
  setContent(content);
  document.body.append(wrap);
  requestAnimationFrame(() => wrap.classList.add("open"));
  const api = { close, setContent, body, panel };
  sheetStack.push(api);
  return api;
}

export function closeAllSheets() {
  for (const s of [...sheetStack]) s.close();
}

export function sheetOpen() {
  return sheetStack.length > 0;
}

export function confirmDialog(message, { title = "Conferma", ok = "OK", cancel = "Annulla", danger = false, detail = null } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; s.close(); resolve(v); };
    const s = openSheet({
      title,
      className: "dialog",
      onClose: () => { if (!done) { done = true; resolve(false); } },
      content: [
        h("p.dialog-msg", message),
        detail,
        h("div.row.end",
          cancel ? h("button.btn.ghost", { onclick: () => finish(false) }, cancel) : null,
          h("button.btn" + (danger ? ".danger" : ".primary"), { onclick: () => finish(true) }, ok)),
      ],
    });
  });
}

export function alertDialog(message, { title = "Attenzione", ok = "Ho capito" } = {}) {
  return confirmDialog(message, { title, ok, cancel: null });
}

const objectUrls = new WeakMap();
export function blobUrl(blob) {
  if (!blob) return null;
  let u = objectUrls.get(blob);
  if (!u) { u = URL.createObjectURL(blob); objectUrls.set(blob, u); }
  return u;
}

export function kindLabel(s) {
  if (s.kind === "import" && s.originalKind) return "Importato · " + (KIND[s.originalKind]?.label || s.originalKind);
  return KIND[s.kind]?.label || s.kind;
}

/** Scheda di uno stato con miniatura. */
export function stateCard(s, { onClick, actions = [], current = false } = {}) {
  const thumb = s.thumb ? h("img", { src: blobUrl(s.thumb), alt: "", loading: "lazy", decoding: "async" }) : h("div.no-thumb", iconEl("gamepad"));
  const badges = [];
  if (s.health?.suspect) badges.push(h("span.badge.warn", "sospetto"));
  if (s.pinned) badges.push(h("span.badge", iconEl("pin"), "protetto"));
  if (current) badges.push(h("span.badge.ok", "consigliato"));
  const card = h("div.state-card" + (s.health?.suspect ? ".suspect" : "") + (current ? ".current" : ""), {
    tabindex: onClick ? 0 : null,
    role: onClick ? "button" : null,
    onclick: onClick ? () => onClick(s) : null,
    onkeydown: onClick ? (e) => { if (e.key === "Enter") onClick(s); } : null,
    title: formatDate(s.createdAt),
  },
  h("div.thumb", thumb),
  h("div.state-info",
    h("div.state-kind", kindLabel(s), ...badges),
    h("div.state-when", formatWhen(s.createdAt)),
    h("div.state-meta", [s.playSec ? "⏱ " + formatDuration(s.playSec) : null, s.label || null, formatBytes(s.size)].filter(Boolean).join(" · "))),
  actions.length ? h("div.state-actions", actions) : null);
  return card;
}

export function emptyState(text, iconName = "info") {
  return h("div.empty", iconEl(iconName), h("p", text));
}

export function segmented(options, value, onChange, { name = "" } = {}) {
  const wrap = h("div.segmented", { role: "radiogroup", "aria-label": name });
  for (const o of options) {
    const b = h("button" + (o.value === value ? ".on" : ""), {
      role: "radio",
      "aria-checked": String(o.value === value),
      onclick: () => {
        wrap.querySelectorAll("button").forEach((x) => { x.classList.remove("on"); x.setAttribute("aria-checked", "false"); });
        b.classList.add("on");
        b.setAttribute("aria-checked", "true");
        onChange(o.value);
      },
    }, o.icon ? iconEl(o.icon) : null, o.label);
    wrap.append(b);
  }
  return wrap;
}

export function toggle(label, checked, onChange, hint = "") {
  const input = h("input", { type: "checkbox", checked, onchange: () => onChange(input.checked) });
  return h("label.toggle", h("span.toggle-text", h("span", label), hint ? h("small", hint) : null), input, h("span.switch"));
}

export function slider(label, { min, max, step, value, format = (v) => v }, onChange) {
  const out = h("span.slider-val", format(value));
  const input = h("input", { type: "range", min, max, step, value, oninput: () => { out.textContent = format(+input.value); onChange(+input.value, false); }, onchange: () => onChange(+input.value, true) });
  return h("label.slider", h("span.slider-label", label, out), input);
}

export function section(title, ...children) {
  return h("section.menu-section", title ? h("h3", title) : null, ...children);
}

export function menuButton(iconName, label, onClick, { hint = "", cls = "" } = {}) {
  return h("button.menu-btn" + (cls ? "." + cls : ""), { onclick: onClick }, iconEl(iconName), h("span.menu-btn-text", h("span", label), hint ? h("small", hint) : null));
}
