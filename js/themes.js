// Palette dell'interfaccia: valgono sia per la libreria sia per lo schermo di gioco.
export const THEMES = {
  vesuvio: { name: "Vesuvio", desc: "Notte sul golfo, lava arancione", bg: "#0f1220", surface: "#181c2e", surface2: "#22283f", text: "#f2f3f8", muted: "#9aa2c0", accent: "#ff6b2c", accent2: "#ffb547", btn: "#2a3150", btnText: "#ffffff", danger: "#ff4d6d", ok: "#3ddc97" },
  napoli: { name: "Napoli", desc: "Azzurro e bianco", bg: "#06213a", surface: "#0b3156", surface2: "#124271", text: "#ffffff", muted: "#a9c8e6", accent: "#12a0d7", accent2: "#ffffff", btn: "#1565a8", btnText: "#ffffff", danger: "#ff5d73", ok: "#5be3a8" },
  unova: { name: "Unima", desc: "Bianco e nero, come Pokémon Nero/Bianco", bg: "#0b0b0d", surface: "#17171b", surface2: "#232329", text: "#f5f5f5", muted: "#a3a3ad", accent: "#e8e8e8", accent2: "#7b7b86", btn: "#2b2b31", btnText: "#ffffff", danger: "#ff5a5a", ok: "#7ee0a1" },
  viola: { name: "Ametista", desc: "Viola e nero", bg: "#100a18", surface: "#1b1128", surface2: "#2a1a3e", text: "#f6efff", muted: "#b9a6d6", accent: "#a45cff", accent2: "#e06bff", btn: "#33204d", btnText: "#ffffff", danger: "#ff5b8a", ok: "#55e6a5" },
  smeraldo: { name: "Smeraldo", desc: "Verde e nero", bg: "#07120d", surface: "#0d1e16", surface2: "#143023", text: "#eefff6", muted: "#97c4ad", accent: "#2ee59d", accent2: "#b7f171", btn: "#173a2a", btnText: "#ffffff", danger: "#ff6767", ok: "#2ee59d" },
  kanto: { name: "Poké Ball", desc: "Rosso, bianco e antracite", bg: "#151517", surface: "#202024", surface2: "#2c2c32", text: "#ffffff", muted: "#b5b5bd", accent: "#e3350d", accent2: "#ffffff", btn: "#38383f", btnText: "#ffffff", danger: "#ff6a4d", ok: "#59d98e" },
  cielo: { name: "Cielo", desc: "Azzurro con pulsanti arancioni", bg: "#0a1a2a", surface: "#10283f", surface2: "#183a59", text: "#f1f8ff", muted: "#9cc0dd", accent: "#ff8a1f", accent2: "#5cc8ff", btn: "#1f4c74", btnText: "#ffffff", danger: "#ff5d5d", ok: "#4fe0a0" },
  carta: { name: "Carta", desc: "Tema chiaro", bg: "#f3f1ec", surface: "#ffffff", surface2: "#e9e5dc", text: "#1d1b18", muted: "#6b665d", accent: "#d9480f", accent2: "#1c7ed6", btn: "#2b2a28", btnText: "#ffffff", danger: "#c92a2a", ok: "#2b8a3e" },
};

export function applyTheme(id) {
  const t = THEMES[id] || THEMES.vesuvio;
  const r = document.documentElement.style;
  r.setProperty("--bg", t.bg);
  r.setProperty("--surface", t.surface);
  r.setProperty("--surface-2", t.surface2);
  r.setProperty("--text", t.text);
  r.setProperty("--muted", t.muted);
  r.setProperty("--accent", t.accent);
  r.setProperty("--accent-2", t.accent2);
  r.setProperty("--btn", t.btn);
  r.setProperty("--btn-text", t.btnText);
  r.setProperty("--danger", t.danger);
  r.setProperty("--ok", t.ok);
  document.documentElement.dataset.theme = id in THEMES ? id : "vesuvio";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t.bg);
}
