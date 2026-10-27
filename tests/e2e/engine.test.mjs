// Il motore, senza interfaccia: avvio, input, touch, stati, turbo, per ogni core.
import { test } from "node:test";
import assert from "node:assert/strict";
import { launch } from "./helpers.mjs";

async function bootHarness(core, rom, opts = {}) {
  const t = await launch({ viewport: { width: 256, height: 384 } });
  await t.page.goto(`${t.base}tests/e2e/harness.html?core=${core}&rom=${rom}&opts=${encodeURIComponent(JSON.stringify(opts))}`);
  await t.page.waitForFunction(() => window.READY);
  await t.page.evaluate(() => T.boot());
  await t.page.waitForTimeout(1500);
  await t.page.evaluate(() => {
    window.px = async (x, y) => {
      const png = await E.screenshot();
      const bmp = await createImageBitmap(new Blob([png]));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext("2d");
      g.drawImage(bmp, 0, 0);
      return Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3));
    };
    window.probe = (b3 = 0x54) => {
      const s = E.saveState();
      for (let i = 0; i + 24 <= s.length; i += 4) {
        if (s[i] === 0x56 && s[i + 1] === 0x53 && s[i + 2] === 0x56 && s[i + 3] === b3) {
          const dv = new DataView(s.buffer, i);
          if (b3 === 0x37) { const n = dv.getUint32(16, true); if (n < 0x40000000) return { ext: dv.getUint32(4, true), x: dv.getUint32(8, true), y: dv.getUint32(12, true), n }; }
          else { const c = dv.getUint32(4, true); if (c < 0x1000000) return c; }
        }
      }
      return null;
    };
  });
  return t;
}

const fps = (page, ms = 2500) => page.evaluate((ms) => E.measureFps(ms), ms);

for (const core of ["melonds", "desmume2015", "desmume"]) {
  test(`DS ${core}: avvio, tasti, touch e ripristino dello stato`, async () => {
    const opts = core === "melonds" ? { melonds_touch_mode: "Touch" } : { desmume_pointer_type: "touch" };
    const t = await bootHarness(core, "../fixtures/vesuvio-test.nds", opts);
    const { page } = t;
    try {
      assert.ok((await fps(page, 1500)) > 10, "il core produce fotogrammi");
      // A e B cambiano il colore dello schermo superiore
      await page.evaluate(() => E.setInput(8, 1)); await page.waitForTimeout(250);
      const green = await page.evaluate(() => px(10, 10));
      await page.evaluate(() => E.setInput(8, 0));
      assert.ok(green[1] > 200 && green[0] < 40, "A -> verde " + green);
      await page.evaluate(() => E.setInput(9, 1)); await page.waitForTimeout(250);
      const xs = await page.evaluate(() => probe(0x37));
      await page.evaluate(() => E.setInput(9, 0));
      assert.equal(xs.ext & 1, 0, "X letto dall'ARM7");
      // touch: coordinate assolute sullo schermo inferiore (canvas 256x384 a scala 1)
      await page.mouse.move(64, 192 + 48); await page.mouse.down(); await page.waitForTimeout(250);
      const t1 = await page.evaluate(() => probe(0x37));
      await page.mouse.move(200, 192 + 150); await page.waitForTimeout(250);
      const t2 = await page.evaluate(() => probe(0x37));
      await page.mouse.up(); await page.waitForTimeout(250);
      const t3 = await page.evaluate(() => probe(0x37));
      assert.equal(t1.ext & 0x40, 0, "penna appoggiata");
      assert.ok(Math.abs(t1.x / 16 - 64) <= 2 && Math.abs(t1.y / 16 - 48) <= 2, `tocco 1 a (${t1.x / 16}, ${t1.y / 16})`);
      assert.ok(Math.abs(t2.x / 16 - 200) <= 2 && Math.abs(t2.y / 16 - 150) <= 2, `trascinamento a (${t2.x / 16}, ${t2.y / 16})`);
      assert.ok(t3.ext & 0x40, "penna sollevata");
      // stato: salva, lascia correre, ricarica -> il contatore del gioco torna indietro
      const r = await page.evaluate(async () => {
        const s = E.saveState();
        const c0 = probe();
        await new Promise((r) => setTimeout(r, 1500));
        const c1 = probe();
        const ok = await E.loadState(s);
        const c2 = probe();
        return { c0, c1, c2, ok };
      });
      assert.ok(r.ok, "stato applicato");
      assert.ok(r.c1 > r.c0 + 5, "il gioco avanza");
      assert.ok(r.c2 >= r.c0 && r.c2 <= r.c0 + 6, `dopo il ripristino il contatore torna a ${r.c0} (letto ${r.c2})`);
      // caricare uno stato mentre e' in pausa funziona e lascia in pausa
      const p = await page.evaluate(async () => {
        const s = E.saveState(); const c0 = probe();
        await new Promise((r) => setTimeout(r, 1000));
        E.pause(); const ok = await E.loadState(s); const c1 = probe(); const f0 = E.frame;
        await new Promise((r) => setTimeout(r, 400)); const f1 = E.frame; E.resume();
        return { c0, c1, ok, stillPaused: f1 === f0 };
      });
      assert.ok(p.ok && p.stillPaused && p.c1 <= p.c0 + 6, "ripristino in pausa " + JSON.stringify(p));
      assert.deepEqual(t.errors, []);
    } finally {
      await t.close();
    }
  });
}

test("GBA mGBA: avvio, tasti, salvataggio interno e turbo reale", async () => {
  const t = await bootHarness("mgba", "../fixtures/vesuvio-test.gba");
  const { page } = t;
  try {
    const normal = await fps(page);
    assert.ok(normal > 50 && normal < 66, "velocità normale ~60 fps: " + normal);
    await page.evaluate(() => E.setInput(0, 1)); await page.waitForTimeout(250);
    const blue = await page.evaluate(() => px(10, 10));
    await page.evaluate(() => E.setInput(0, 0));
    assert.ok(blue[2] > 200 && blue[1] < 40, "B -> blu " + blue);
    // START: la ROM scrive in SRAM; il .sav letto dal core deve contenerlo
    await page.evaluate(() => E.setInput(3, 1)); await page.waitForTimeout(300); await page.evaluate(() => E.setInput(3, 0));
    const sav = await page.evaluate(() => Array.from(E.readSave().slice(0, 4)));
    assert.equal(sav[0], 0x56, "firma nel .sav");
    assert.ok(sav[1] + sav[2] * 256 > 0, "contatore nel .sav");
    // turbo x2: la velocità misurata deve davvero salire
    await page.evaluate(() => E.setFastForward(true, 2)); await page.waitForTimeout(300);
    const ff2 = await fps(page);
    await page.evaluate(() => E.setFastForward(false)); await page.waitForTimeout(300);
    const back = await fps(page, 1500);
    assert.ok(ff2 / normal > 1.6, `turbo ×2 reale: ×${(ff2 / normal).toFixed(2)}`);
    assert.ok(back < 66, "spento il turbo torna normale: " + back);
    console.log(`  mGBA: normale ${normal.toFixed(1)} fps, turbo ×2 → ${ff2.toFixed(1)} fps`);
    assert.deepEqual(t.errors, []);
  } finally {
    await t.close();
  }
});
