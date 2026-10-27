// Icone SVG in linea (tratto, 24x24).
const P = {
  menu: "M4 6h16M4 12h16M4 18h16",
  pause: "M8 5v14M16 5v14",
  play: "M7 4.5v15l12-7.5z",
  turbo: "M4 5l8 7-8 7zM12 5l8 7-8 7z",
  save: "M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6",
  load: "M4 7h6l2 2h8v10H4zM12 12v5M9.5 14.5 12 17l2.5-2.5",
  screens: "M6 3h12v8H6zM6 13h12v8H6z",
  top: "M6 3h12v8H6z",
  bottom: "M6 13h12v8H6z",
  volume: "M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11",
  mute: "M4 9v6h4l5 4V5L8 9zM16 9l5 6M21 9l-5 6",
  settings: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7.6 7.6 0 0 1-2 1.2L14.8 21h-4l-.3-2.4a7.6 7.6 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7.7 7.7 0 0 1 0-2.4L4.6 9.9l2-3.4 1.9.7a7.6 7.6 0 0 1 2-1.2L10.8 3h4l.3 2.4a7.6 7.6 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7.7 7.7 0 0 1 0 2.4z",
  close: "M6 6l12 12M18 6 6 18",
  home: "M4 11 12 4l8 7M6 10v10h12V10",
  restart: "M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5",
  info: "M12 8h.01M11 12h1v5h1M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  warning: "M12 4 2.5 20h19zM12 10v4M12 17h.01",
  check: "M5 12.5l4.5 4.5L19 7.5",
  trash: "M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  pin: "M9 4h6l-1 5 3 3H7l3-3zM12 15v5",
  share: "M12 15V4M8 8l4-4 4 4M6 12v8h12v-8",
  download: "M12 4v11M8 11l4 4 4-4M5 20h14",
  upload: "M12 20V9M8 13l4-4 4 4M5 4h14",
  gamepad: "M7 8h10a4 4 0 0 1 4 4v1a4 4 0 0 1-7 2.6h-4A4 4 0 0 1 3 13v-1a4 4 0 0 1 4-4zM7.5 11v3M6 12.5h3M15.5 12h.01M17.5 13.5h.01",
  chart: "M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6",
  plus: "M12 5v14M5 12h14",
  library: "M5 4h4v16H5zM10 4h4v16h-4zM15.5 5l3.5-1 3 15.5-3.5 1z",
  chevron: "M9 6l6 6-6 6",
  back: "M15 6l-6 6 6 6",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  shield: "M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
  swap: "M7 7h11l-3-3M17 17H6l3 3",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  palette: "M12 3a9 9 0 1 0 0 18c1 0 1.5-.7 1.5-1.5 0-.9-.8-1.3-.8-2.2 0-.8.7-1.3 1.5-1.3H17a4 4 0 0 0 4-4c0-5-4-9-9-9zM7.5 11.5h.01M9.5 7.5h.01M14.5 7.5h.01",
};

export function icon(name, cls = "") {
  const d = P[name] || P.info;
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}

export function iconEl(name, cls = "") {
  const t = document.createElement("template");
  t.innerHTML = icon(name, cls);
  return t.content.firstChild;
}
