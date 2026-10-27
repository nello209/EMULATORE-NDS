// Utilita' comuni ai test end-to-end (Playwright + Chromium).
import { createRequire } from "node:module";
import { startServer } from "../../tools/serve.mjs";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = createRequire("/opt/node-tools/")("playwright"); }
export const { chromium } = pw;

export const ROM = new URL("../fixtures/vesuvio-test.nds", import.meta.url).pathname;
export const GBA_ROM = new URL("../fixtures/vesuvio-test.gba", import.meta.url).pathname;

export async function launch({ port = 8100 + Math.floor(Math.random() * 800), viewport = { width: 390, height: 844 }, hasTouch = true, isMobile = false } = {}) {
  const server = await startServer(port, false);
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
  const context = await browser.newContext({ viewport, hasTouch, isMobile, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => { if (!/Wake Lock/.test(e.message)) errors.push(e.message); });
  const base = `http://127.0.0.1:${port}/`;
  return {
    server, browser, context, page, errors, base,
    async close() { await browser.close(); server.close(); },
  };
}

/** Aggiunge una ROM dalla libreria tramite il selettore file. */
export async function addRom(page, path) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#btn-add")]);
  await chooser.setFiles(path);
  await page.waitForSelector(".sheet-wrap.open .game-head", { timeout: 15000 });
}

export async function gameIds(page) {
  return page.evaluate(async () => (await window.vesuvioHome.store.listGames()).map((g) => g.id));
}

/** Avvia il gioco e aspetta che la sessione sia pronta. */
export async function startGame(page, base, id, state = "best", extra = "") {
  await page.goto(`${base}play.html?id=${id}&state=${state}${extra}`);
  await page.waitForSelector("#tap-to-play", { timeout: 30000 });
  await page.click("#tap-to-play");
  await page.waitForFunction(() => window.vesuvio && window.vesuvio.ready, null, { timeout: 30000 });
}

/** Legge dal savestate i dati scritti dalla ROM di test (firma VSVT / VSV7). */
export async function romProbe(page) {
  return page.evaluate(() => {
    const e = window.vesuvio.engine;
    const wasRunning = e.running;
    if (wasRunning) e.pause();
    const s = e.saveState();
    if (wasRunning) e.resume();
    const find = (b3, pick) => {
      for (let i = 0; i + 24 <= s.length; i += 4) {
        if (s[i] === 0x56 && s[i + 1] === 0x53 && s[i + 2] === 0x56 && s[i + 3] === b3) {
          const v = pick(new DataView(s.buffer, i));
          if (v) return v;
        }
      }
      return null;
    };
    const arm9 = find(0x54, (dv) => { const c = dv.getUint32(4, true); return c < 0x1000000 ? { counter: c } : null; });
    const arm7 = find(0x37, (dv) => { const n = dv.getUint32(16, true); return n < 0x40000000 ? { ext: dv.getUint32(4, true), x: dv.getUint32(8, true), y: dv.getUint32(12, true), n } : null; });
    return { ...arm9, ...arm7 };
  });
}

/** Colore di un pixel del fotogramma del core. */
export async function corePixel(page, x, y) {
  return page.evaluate(async ([x, y]) => {
    const png = await window.vesuvio.engine.screenshot();
    if (!png) return null;
    const bmp = await createImageBitmap(new Blob([png]));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext("2d");
    g.drawImage(bmp, 0, 0);
    return Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3));
  }, [x, y]);
}
