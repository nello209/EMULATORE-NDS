// Palette dell'interfaccia: valgono sia per la libreria sia per lo schermo di gioco.
export const THEMES = {
  vesuvio: { name: "Vesuvio", desc: "Notte sul golfo, lava arancione", bg: "#0f1220", surface: "#181c2e", surface2: "#22283f", text: "#f2f3f8", muted: "#9aa2c0", accent: "#ff6b2c", accent2: "#ffb547", btn: "#2a3150", btnText: "#ffffff", danger: "#ff4d6d", ok: "#3ddc97" },
  ghiaccio: { name: "Ghiaccio", desc: "Azzurro ghiaccio su blu notte", bg: "#07101b", surface: "#0f2133", surface2: "#163049", text: "#eef8ff", muted: "#9db8cc", accent: "#6fd8ff", accent2: "#ffb070", btn: "#1b3955", btnText: "#ffffff", danger: "#ff5d73", ok: "#5be3a8", glow: ["#6fd8ff", "#2f6fff"], faces: ["#ffb070", "#e98a52", "#4aa8d8", "#4aa8d8"] },
  napoli: { name: "Napoli", desc: "Azzurro e bianco", bg: "#06213a", surface: "#0b3156", surface2: "#124271", text: "#ffffff", muted: "#a9c8e6", accent: "#12a0d7", accent2: "#ffffff", btn: "#1565a8", btnText: "#ffffff", danger: "#ff5d73", ok: "#5be3a8" },
  unova: { name: "Unima", desc: "Bianco e nero, come Pokémon Nero/Bianco", bg: "#0b0b0d", surface: "#17171b", surface2: "#232329", text: "#f5f5f5", muted: "#a3a3ad", accent: "#e8e8e8", accent2: "#7b7b86", btn: "#2b2b31", btnText: "#ffffff", danger: "#ff5a5a", ok: "#7ee0a1" },
  viola: { name: "Ametista", desc: "Viola e nero", bg: "#100a18", surface: "#1b1128", surface2: "#2a1a3e", text: "#f6efff", muted: "#b9a6d6", accent: "#a45cff", accent2: "#e06bff", btn: "#33204d", btnText: "#ffffff", danger: "#ff5b8a", ok: "#55e6a5" },
  smeraldo: { name: "Smeraldo", desc: "Verde e nero", bg: "#07120d", surface: "#0d1e16", surface2: "#143023", text: "#eefff6", muted: "#97c4ad", accent: "#2ee59d", accent2: "#b7f171", btn: "#173a2a", btnText: "#ffffff", danger: "#ff6767", ok: "#2ee59d" },
  kanto: { name: "Poké Ball", desc: "Rosso, bianco e antracite", bg: "#151517", surface: "#202024", surface2: "#2c2c32", text: "#ffffff", muted: "#b5b5bd", accent: "#e3350d", accent2: "#ffffff", btn: "#38383f", btnText: "#ffffff", danger: "#ff6a4d", ok: "#59d98e" },
  cielo: { name: "Cielo", desc: "Azzurro con pulsanti arancioni", bg: "#0a1a2a", surface: "#10283f", surface2: "#183a59", text: "#f1f8ff", muted: "#9cc0dd", accent: "#ff8a1f", accent2: "#5cc8ff", btn: "#1f4c74", btnText: "#ffffff", danger: "#ff5d5d", ok: "#4fe0a0" },
  tramonto: { name: "Tramonto", desc: "Viola, arancio e oro", bg: "#1a0f2e", surface: "#26173f", surface2: "#34205a", text: "#fff5ec", muted: "#c9a9d6", accent: "#ff7a45", accent2: "#ffd23f", btn: "#3b2563", btnText: "#ffffff", danger: "#ff4d6d", ok: "#5be3a8", glow: ["#ff7a45", "#8a3ffc"], faces: ["#ff7a45", "#ffd23f", "#b388ff", "#ff5fa2"] },
  aurora: { name: "Aurora", desc: "Verde acqua e viola", bg: "#061a1f", surface: "#0b2a31", surface2: "#123b44", text: "#ecfffb", muted: "#93c9c2", accent: "#31f2c1", accent2: "#b06bff", btn: "#15444d", btnText: "#ffffff", danger: "#ff6b81", ok: "#31f2c1", glow: ["#31f2c1", "#b06bff"], faces: ["#31f2c1", "#b06bff", "#4fc3ff", "#c6ff6b"] },
  arcade: { name: "Neon Arcade", desc: "Fucsia, ciano, giallo e verde", bg: "#0a0a14", surface: "#14142a", surface2: "#1f1f3d", text: "#f4f4ff", muted: "#a0a0d0", accent: "#ff2e88", accent2: "#00e5ff", btn: "#25254a", btnText: "#ffffff", danger: "#ff4d6d", ok: "#7cff4f", glow: ["#ff2e88", "#00e5ff"], faces: ["#ff2e88", "#ffd400", "#00e5ff", "#7cff4f"] },
  carta: { name: "Carta", desc: "Tema chiaro", bg: "#f3f1ec", surface: "#ffffff", surface2: "#e9e5dc", text: "#1d1b18", muted: "#6b665d", accent: "#d9480f", accent2: "#1c7ed6", btn: "#2b2a28", btnText: "#ffffff", danger: "#c92a2a", ok: "#2b8a3e" },
};

// Colori classici dei tasti (A rosso, B giallo, X blu, Y verde).
export const CLASSIC_FACES = ["#e5403a", "#f2b600", "#3a6fe5", "#2fae55"];

function hexToRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(hex, other, t) {
  const a = hexToRgb(hex), b = hexToRgb(other);
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Tema "Personalizzato" costruito dai 4 colori scelti dall'utente. */
export function customTheme(c = {}) {
  const bg = c.bg || "#120d24";
  const light = luminance(bg) > 0.5;
  const toward = light ? "#000000" : "#ffffff";
  return {
    name: "Personalizzato", desc: "I tuoi colori", bg,
    surface: mix(bg, toward, 0.06), surface2: mix(bg, toward, 0.13),
    text: light ? "#1d1b18" : "#f6f6fb", muted: light ? "#5f5a66" : mix("#ffffff", bg, 0.38),
    accent: c.accent || "#ff4fa3", accent2: c.accent2 || "#41e0ff", btn: c.btn || mix(bg, toward, 0.2),
    btnText: luminance(c.btn || bg) > 0.55 ? "#111111" : "#ffffff", danger: "#ff4d6d", ok: "#3ddc97",
    glow: [c.accent || "#ff4fa3", c.accent2 || "#41e0ff"],
    faces: [c.accent || "#ff4fa3", c.accent2 || "#41e0ff", c.btn || mix(bg, toward, 0.2), c.btn || mix(bg, toward, 0.2)],
    light,
  };
}

export function applyTheme(id, custom = null) {
  const t = id === "custom" ? customTheme(custom || {}) : THEMES[id] || THEMES.vesuvio;
  const r = document.documentElement.style;
  const set = (k, v) => r.setProperty(k, v);
  set("--bg", t.bg);
  set("--surface", t.surface);
  set("--surface-2", t.surface2);
  set("--text", t.text);
  set("--muted", t.muted);
  set("--accent", t.accent);
  set("--accent-2", t.accent2);
  set("--btn", t.btn);
  set("--btn-text", t.btnText);
  set("--danger", t.danger);
  set("--ok", t.ok);
  set("--on-accent", luminance(t.accent) > 0.45 ? "#07131c" : "#ffffff");
  set("--on-accent-2", luminance(t.accent2) > 0.45 ? "#07131c" : "#ffffff");
  const glow = t.glow || [t.accent, t.accent2];
  set("--glow-1", glow[0]);
  set("--glow-2", glow[1]);
  const faces = t.faces || [t.accent, t.btn, t.btn, t.btn];
  ["a", "b", "x", "y"].forEach((k, i) => set("--face-" + k, faces[i]));
  ["a", "b", "x", "y"].forEach((k, i) => set("--classic-" + k, CLASSIC_FACES[i]));
  document.documentElement.dataset.theme = id === "custom" || id in THEMES ? id : "vesuvio";
  document.documentElement.style.colorScheme = t.light || id === "carta" ? "light" : "dark";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t.bg);
}
