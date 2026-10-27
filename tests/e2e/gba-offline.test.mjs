// GBA nell'app (versioni del .sav, turbo, layout) e funzionamento offline.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, addRom, gameIds, startGame, GBA_ROM, ROM } from "./helpers.mjs";

let t, page, base, romId;
const wait = (ms) => page.waitForTimeout(ms);
async function until(fn, ms = 30000, what = "condizione") {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await wait(400);
  }
  throw new Error("Timeout in attesa di: " + what);
}
const saves = () => page.evaluate(async (id) => (await import("./js/store.js")).listSaves(id), romId);
const pressPad = async (name, ms = 250) => {
  const b = await page.locator(`#pad [data-btn="${name}"]`).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await wait(ms);
  await page.mouse.up();
};

before(async () => {
  t = await launch({ viewport: { width: 844, height: 390 } });
  ({ page, base } = t);
  await page.goto(base);
  await page.waitForFunction(() => window.vesuvioHome?.ready);
});
after(async () => { if (t) await t.close(); });

test("GBA: import, avvio in orizzontale, controlli dentro lo schermo", async () => {
  await addRom(page, GBA_ROM);
  [romId] = await gameIds(page);
  await startGame(page, base, romId);
  assert.equal(await page.getAttribute("#game", "data-orient"), "landscape");
  assert.equal(await page.locator('#pad [data-btn="X"]').count(), 0, "niente X/Y sul GBA");
  const vw = 844, vh = 390;
  for (const sel of ['[data-btn="A"]', '[data-btn="B"]', '[data-btn="L"]', '[data-btn="R"]', '[data-btn="START"]', '[data-btn="SELECT"]', ".dpad", "#btn-turbo", "#btn-menu"]) {
    const b = await page.locator(sel).first().boundingBox();
    assert.ok(b && b.x >= 0 && b.y >= 0 && b.x + b.width <= vw && b.y + b.height <= vh, `${sel} dentro lo schermo: ${JSON.stringify(b)}`);
  }
  const scr = await page.locator("#screens").boundingBox();
  for (const sel of ['[data-btn="A"]', ".dpad"]) {
    const b = await page.locator(sel).first().boundingBox();
    const overlap = b.x < scr.x + scr.width && b.x + b.width > scr.x && b.y < scr.y + scr.height && b.y + b.height > scr.y;
    assert.ok(!overlap, `${sel} non copre lo schermo di gioco`);
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), vw, "nessuno scorrimento orizzontale");
});

test("GBA: ogni salvataggio fatto dal gioco diventa una nuova versione del .sav (le vecchie restano)", async () => {
  await pressPad("START");
  const v1 = await until(async () => (await saves())[0], 20000, "prima versione .sav");
  await wait(1500);
  await pressPad("START");
  await until(async () => (await saves()).length >= 2, 20000, "seconda versione .sav");
  const list = await saves();
  const data = await page.evaluate(async (ids) => {
    const store = await import("./js/store.js");
    return Promise.all(ids.map(async (id) => Array.from((await store.getSaveData(id)).slice(0, 4))));
  }, list.map((s) => s.id));
  assert.equal(data[0][0], 0x56);
  assert.equal(data[1][0], 0x56);
  const n = (d) => d[1] | (d[2] << 8) | (d[3] << 16);
  assert.ok(n(data[0]) > n(data[1]), "la versione più recente ha il contatore più alto");
  assert.equal(list[1].id, v1.id, "la prima versione è ancora lì");
});

test("turbo: il pulsante accelera davvero e la velocità reale è mostrata", async () => {
  await page.click("#btn-turbo");
  assert.equal(await page.evaluate(() => window.vesuvio.engine.fastForward), true);
  await wait(4000);
  const r = await page.evaluate(() => window.vesuvio.session.speed.ratio);
  const chip = await page.textContent("#speed");
  await page.click("#btn-turbo");
  assert.ok(r > 1.8, "velocità reale con turbo ×3: ×" + r.toFixed(2));
  assert.match(chip, /×\d/);
  await wait(3000);
  const back = await page.evaluate(() => window.vesuvio.session.speed.ratio);
  assert.ok(back < 1.15, "spento il turbo: ×" + back.toFixed(2));
});

test("offline: dopo la prima apertura l'app e i motori funzionano senza rete", async () => {
  await page.goto(base);
  await page.waitForFunction(() => window.vesuvioHome?.ready);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // la pagina ora è controllata dal service worker
  await page.waitForFunction(() => window.vesuvioHome?.ready && navigator.serviceWorker.controller);
  // apre una volta il gioco per mettere in cache il motore
  await startGame(page, base, romId);
  await page.context().setOffline(true);
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.vesuvioHome?.ready, null, { timeout: 15000 });
    assert.ok((await page.textContent("#games")).includes("Vesuvio"));
    await startGame(page, base, romId);
    const f0 = await page.evaluate(() => window.vesuvio.engine.frame);
    await wait(1000);
    assert.ok((await page.evaluate(() => window.vesuvio.engine.frame)) > f0 + 20, "il gioco gira offline");
  } finally {
    await page.context().setOffline(false);
  }
});

test("nessun errore JavaScript", () => {
  assert.deepEqual(t.errors, []);
});
