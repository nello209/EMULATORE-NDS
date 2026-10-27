// L'app completa con la ROM di test DS: libreria, salvataggi, ripristino,
// rilevamento dei blocchi, controlli touch e touch screen su schermo scalato.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, addRom, gameIds, startGame, romProbe, corePixel, ROM } from "./helpers.mjs";

let t, page, base, romId;
const wait = (ms) => page.waitForTimeout(ms);
const states = () => page.evaluate(async (id) => (await import("./js/store.js")).listStates(id).then((l) => l.map(({ thumb, ...s }) => ({ ...s, hasThumb: !!thumb, thumbType: thumb && thumb.type }))), romId);
const session = (fn, arg) => page.evaluate(fn, arg);
async function until(fn, ms = 30000, what = "condizione") {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await wait(400);
  }
  throw new Error("Timeout in attesa di: " + what);
}

before(async () => {
  t = await launch({ viewport: { width: 390, height: 844 } });
  page = t.page;
  base = t.base;
  await page.goto(base);
  await page.waitForFunction(() => window.vesuvioHome?.ready);
  // tempi brevi per il test (in uso reale: 30 s, 15 s, 60 s, 8 s)
  await page.evaluate(async () => {
    const s = await import("./js/settings.js");
    await s.saveSettings({ autosave: { intervalSec: 4, warmupSec: 3 }, watchdog: { softSec: 8, softMinInputs: 3, hardSec: 4 } });
  });
});

after(async () => {
  if (t) await t.close();
});

test("importa la ROM e la riconosce (titolo italiano e icona dal banner)", async () => {
  await addRom(page, ROM);
  const head = await page.textContent(".sheet-wrap.open .game-head");
  assert.match(head, /Nintendo DS/);
  assert.match(head, /VSVT/);
  [romId] = await gameIds(page);
  const g = await page.evaluate(async (id) => { const g = await (await import("./js/store.js")).getGame(id); return { title: g.title, icon: g.icon && g.icon.type }; }, romId);
  assert.equal(g.title, "Vesuvio Test — ROM di prova");
  assert.equal(g.icon, "image/png");
});

test("avvio: nessun salvataggio automatico durante il riscaldamento o senza comandi", async () => {
  await startGame(page, base, romId);
  const early = await session(() => window.vesuvio.session.autosave("test"));
  assert.equal(early.skipped, "avvio in corso");
  await page.waitForFunction(() => window.vesuvio.session.warm, null, { timeout: 30000 });
  const idle = await session(() => window.vesuvio.session.autosave("test"));
  assert.equal(idle.skipped, "nessun comando dall'ultimo salvataggio");
  assert.equal((await states()).length, 0, "nessuno stato creato a gioco fermo");
});

test("i pulsanti touch arrivano al gioco (A = verde) e il salvataggio automatico parte con miniatura", async () => {
  const a = await page.locator('#pad [data-btn="A"]').boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await wait(300);
  const px = await corePixel(page, 10, 10);
  await page.mouse.up();
  assert.ok(px[1] > 200 && px[0] < 40, "schermo verde con A premuto: " + px);
  await session(() => window.vesuvio.session.noteInput());
  const auto = await until(async () => (await states()).find((s) => s.kind === "auto"), 30000, "autosalvataggio");
  assert.equal(auto.thumbType, "image/png");
  assert.equal(auto.coreId, "melonds");
  assert.ok(auto.framesSinceLoad >= 300, "stato catturato a gioco avviato, non al boot");
  assert.equal(auto.health.suspect, false);
});

test("croce scorrevole: trascinando il dito si passa da una direzione all'altra; multi-touch con A", async () => {
  const d = await page.locator("#pad .dpad").boundingBox();
  const cx = d.x + d.width / 2, cy = d.y + d.height / 2, r = d.width / 2;
  const a = await page.locator('#pad [data-btn="A"]').boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: p[2] ?? i })) });
  const input = () => page.evaluate(() => Object.fromEntries(window.vesuvio.engine.inputState));
  await touch("touchStart", [[cx + r * 0.8, cy, 1]]);
  await wait(100);
  let s = await input();
  assert.equal(s[7], 1, "destra");
  await touch("touchMove", [[cx, cy + r * 0.8, 1]]);
  await wait(100);
  s = await input();
  assert.equal(s[7], 0, "destra rilasciata");
  assert.equal(s[5], 1, "giù");
  await touch("touchMove", [[cx, cy + r * 0.8, 1], [a.x + a.width / 2, a.y + a.height / 2, 2]]);
  await touch("touchStart", [[cx, cy + r * 0.8, 1], [a.x + a.width / 2, a.y + a.height / 2, 2]]);
  await wait(100);
  s = await input();
  assert.equal(s[5], 1, "giù ancora premuto");
  assert.equal(s[8], 1, "A premuto insieme");
  await touch("touchEnd", []);
  await wait(100);
  s = await input();
  assert.ok(!s[5] && !s[8] && !s[7], "tutto rilasciato");
});

test("touch screen DS sul canvas ingrandito: il punto toccato è quello giusto (anche in vista «solo touch»)", async () => {
  const cdp = await page.context().newCDPSession(page);
  const tapProbe = async (fx, fy) => {
    const c = await page.locator("#canvas").boundingBox();
    const scr = await page.locator("#screens").boundingBox();
    const view = await page.getAttribute("#game", "data-view");
    // punto sullo schermo inferiore (fx, fy in 0..1)
    const top = view === "bottom" ? scr.y : c.y + c.height / 2;
    const x = c.x + fx * c.width;
    const y = top + fy * (c.height / 2);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await wait(250);
    const p = await romProbe(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await wait(150);
    return { x: p.x / 16, y: p.y / 16, pen: !(p.ext & 0x40) };
  };
  let p = await tapProbe(0.25, 0.5);
  assert.ok(p.pen && Math.abs(p.x - 64) <= 3 && Math.abs(p.y - 96) <= 3, "vista entrambi: " + JSON.stringify(p));
  p = await tapProbe(0.9, 0.1);
  assert.ok(p.pen && Math.abs(p.x - 230.4) <= 3 && Math.abs(p.y - 19.2) <= 3, "angolo: " + JSON.stringify(p));
  await page.click("#btn-view"); // solo gioco
  await page.click("#btn-view"); // solo touch
  await wait(400);
  assert.equal(await page.getAttribute("#game", "data-view"), "bottom");
  p = await tapProbe(0.5, 0.5);
  assert.ok(p.pen && Math.abs(p.x - 128) <= 3 && Math.abs(p.y - 96) <= 3, "vista solo touch: " + JSON.stringify(p));
  await page.click("#btn-view"); // entrambi
  await wait(300);
});

test("salvataggio manuale e ripristino: il gioco torna esattamente lì, con copia di sicurezza", async () => {
  const cClick = (await romProbe(page)).counter;
  await page.click("#btn-save");
  const manual = await until(async () => (await states()).find((s) => s.kind === "manual"), 10000, "salvataggio manuale");
  const c0 = (await romProbe(page)).counter;
  await wait(2500);
  await session(() => window.vesuvio.session.noteInput());
  const c1 = (await romProbe(page)).counter;
  assert.ok(c1 > c0 + 10);
  const r = await session((id) => window.vesuvio.session.restore(id).then((x) => ({ backup: !!x.backup })), manual.id);
  const c2 = (await romProbe(page)).counter;
  assert.ok(c2 >= cClick - 2 && c2 <= c0 + 2, `contatore dopo il ripristino ${c2}: atteso tra ${cClick} (tocco) e ${c0}`);
  assert.equal(r.backup, true);
  assert.ok((await states()).some((s) => s.kind === "prerestore"), "copia di sicurezza della partita prima del ripristino");
  const after = await session(() => window.vesuvio.session.autosave("test"));
  assert.equal(after.skipped, "avvio in corso", "niente autosalvataggi subito dopo un ripristino");
});

test("blocco «morbido» (il gioco si pianta su schermo nero ma l'emulatore gira): rilevato, autosalvataggi sospesi, stati buoni intatti", async () => {
  await page.waitForFunction(() => window.vesuvio.session.warm, null, { timeout: 30000 });
  // un autosalvataggio buono prima del blocco
  await session(() => window.vesuvio.session.noteInput());
  const good = await session(() => window.vesuvio.session.autosave("test").then((r) => r.id || r.skipped));
  assert.ok(good && good.length > 20, "autosalvataggio buono: " + good);
  const before = await states();
  // SELECT: la ROM entra in un ciclo infinito su schermo nero
  await page.evaluate(() => { window.vesuvio.engine.setInput(2, 1); });
  await wait(300);
  await page.evaluate(() => { window.vesuvio.engine.setInput(2, 0); });
  assert.deepEqual(await corePixel(page, 10, 10), [0, 0, 0]);
  const f0 = await page.evaluate(() => window.vesuvio.engine.frame);
  // il giocatore preme tasti senza effetto
  const a = await page.locator('#pad [data-btn="A"]').boundingBox();
  for (let i = 0; i < 14 && !(await page.isVisible("#freeze")); i++) {
    await page.mouse.click(a.x + a.width / 2, a.y + a.height / 2);
    await wait(1000);
  }
  await page.waitForSelector("#freeze:not([hidden])", { timeout: 20000 });
  assert.equal(await page.getAttribute("#freeze", "data-type"), "soft");
  assert.ok((await page.evaluate(() => window.vesuvio.engine.frame)) > f0 + 100, "l'emulatore girava: un controllo sui soli fotogrammi non l'avrebbe visto");
  const skip = await session(() => window.vesuvio.session.autosave("test"));
  assert.equal(skip.skipped, "blocco in corso");
  const now = await states();
  const goodNow = now.find((s) => s.id === good);
  assert.ok(goodNow, "lo stato buono non è stato cancellato");
  assert.ok(now.some((s) => s.kind === "diagnostic" && s.health.suspect), "copia del gioco bloccato per l'analisi");
  const best = await page.evaluate(async (id) => (await (await import("./js/store.js")).bestContinueState(id, "melonds")), romId);
  assert.equal(best.health.suspect, false, "«Continua» non propone stati sospetti");
  assert.ok(now.length >= before.length);
});

test("dal blocco si torna allo stato sano con un tocco", async () => {
  await page.click("#freeze .btn.primary");
  await page.waitForSelector("#freeze", { state: "hidden", timeout: 10000 });
  await wait(600);
  const px = await corePixel(page, 10, 10);
  assert.ok(px[0] > 0 || px[1] > 0 || px[2] > 0, "di nuovo immagine viva: " + px);
  const c0 = (await romProbe(page)).counter;
  await wait(800);
  assert.ok((await romProbe(page)).counter > c0, "il gioco riparte");
  assert.equal(await page.evaluate(() => window.vesuvio.session.frozen), null);
});

test("motore fermo (nessun fotogramma): rilevato come arresto", async () => {
  await page.evaluate(() => window.vesuvio.engine.fn.toggleMainLoop(0)); // arresto "a sorpresa"
  await page.waitForSelector("#freeze:not([hidden])", { timeout: 15000 });
  assert.equal(await page.getAttribute("#freeze", "data-type"), "hard");
  await page.evaluate(() => window.vesuvio.engine.fn.toggleMainLoop(1));
});

test("«Continua» dopo una ricarica riparte dallo stato sano più recente", async () => {
  const best = await page.evaluate(async (id) => (await (await import("./js/store.js")).bestContinueState(id, "melonds")), romId);
  await startGame(page, base, romId, "best");
  const c = (await romProbe(page)).counter;
  assert.ok(c > 50, "non riparte da zero: " + c);
  assert.ok(best && !best.health.suspect);
});

test("backup .zip: esporta e reimporta senza duplicati né perdite", async () => {
  await page.goto(base);
  await page.waitForFunction(() => window.vesuvioHome?.ready);
  const r = await page.evaluate(async (id) => {
    const store = await import("./js/store.js");
    const before = await store.listStates(id);
    const blob = await store.exportPackage(id);
    const u8 = new Uint8Array(await blob.arrayBuffer());
    const again = await store.importPackage(u8, { expectRomId: id });
    for (const s of before) await store.deleteState(s.id);
    const restored = await store.importPackage(u8, { expectRomId: id });
    const after = await store.listStates(id);
    const data = await store.getStateData(after[0].id);
    return { before: before.length, again, restored, after: after.length, kinds: after.map((s) => s.kind), size: data.length };
  }, romId);
  assert.equal(r.again.states, 0, "reimportare lo stesso backup non duplica");
  assert.equal(r.restored.states, r.before);
  assert.equal(r.after, r.before);
  assert.ok(r.kinds.every((k) => k === "import"), "gli stati importati restano separati e non vengono usati da soli");
  assert.ok(r.size > 1000000);
});

test("nessun errore JavaScript durante tutto il percorso", () => {
  assert.deepEqual(t.errors, []);
});
