// Genera le icone PNG dall'SVG usando Chromium (Playwright).
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = createRequire("/opt/node-tools/")("playwright"); }
const svg = await readFile(new URL("../assets/icon.svg", import.meta.url), "utf8");
const browser = await pw.chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad] of [["icon-180.png", 180, 0], ["icon-192.png", 192, 0], ["icon-512.png", 512, 0], ["icon-maskable-512.png", 512, 0.12]]) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - pad * 2));
  await page.setContent(`<html><body style="margin:0;background:${pad ? "#1b2247" : "transparent"};display:grid;place-items:center;width:${size}px;height:${size}px">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</body></html>`);
  const buf = await page.screenshot({ omitBackground: !pad, clip: { x: 0, y: 0, width: size, height: size } });
  await writeFile(new URL("../assets/" + name, import.meta.url), buf);
  console.log("scritto", name);
}
await browser.close();
