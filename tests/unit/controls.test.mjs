import { test } from "node:test";
import assert from "node:assert/strict";
import { dpadDirections } from "../../js/controls.js";

test("zona morta al centro della croce", () => {
  assert.deepEqual(dpadDirections(0.1, 0.1), []);
});

test("direzioni cardinali", () => {
  assert.deepEqual(dpadDirections(1, 0), ["RIGHT"]);
  assert.deepEqual(dpadDirections(0, 1), ["DOWN"]);
  assert.deepEqual(dpadDirections(-1, 0), ["LEFT"]);
  assert.deepEqual(dpadDirections(0, -1), ["UP"]);
});

const a = (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];

test("stile Xbox (predefinito): 8 settori uguali da 45°, diagonali facili da prendere", () => {
  assert.deepEqual(dpadDirections(...a(20)), ["RIGHT"]);
  assert.deepEqual(new Set(dpadDirections(...a(25))), new Set(["RIGHT", "DOWN"]));
  assert.deepEqual(new Set(dpadDirections(...a(65))), new Set(["RIGHT", "DOWN"]));
  assert.deepEqual(dpadDirections(...a(70)), ["DOWN"]);
  // ogni direzione copre esattamente 45°
  const counts = {};
  for (let d = 0; d < 360; d += 0.5) { const k = dpadDirections(...a(d)).sort().join("+"); counts[k] = (counts[k] || 0) + 0.5; }
  assert.equal(Object.keys(counts).length, 8);
  for (const v of Object.values(counts)) assert.ok(Math.abs(v - 45) <= 1, JSON.stringify(counts));
});

test("diagonali strette (opzione): settori cardinali da ±30°", () => {
  const n = { cardinalHalf: 30 };
  assert.deepEqual(dpadDirections(...a(25), n), ["RIGHT"]);
  assert.deepEqual(dpadDirections(...a(-28), n), ["RIGHT"]);
  assert.deepEqual(new Set(dpadDirections(...a(40), n)), new Set(["RIGHT", "DOWN"]));
});

test("le quattro diagonali", () => {
  assert.deepEqual(new Set(dpadDirections(...a(45))), new Set(["RIGHT", "DOWN"]));
  assert.deepEqual(new Set(dpadDirections(...a(-45))), new Set(["RIGHT", "UP"]));
  assert.deepEqual(new Set(dpadDirections(...a(225))), new Set(["LEFT", "UP"]));
  assert.deepEqual(new Set(dpadDirections(...a(135))), new Set(["LEFT", "DOWN"]));
});

test("trascinare il dito oltre il bordo mantiene la direzione", () => {
  assert.deepEqual(dpadDirections(3.5, 0.2), ["RIGHT"]);
});

import { readFile } from "node:fs/promises";
import { patchCoreGlue } from "../../js/engine.js";

test("la correzione del touch si applica al codice di tutti i core", async () => {
  for (const c of ["melonds/melonds", "desmume2015/desmume2015", "desmume/desmume", "mgba/mgba"]) {
    const js = await readFile(new URL(`../../cores/${c}_libretro.js`, import.meta.url), "utf8");
    const r = patchCoreGlue(js);
    assert.ok(r.patched, c);
    assert.ok(!r.js.includes("window.devicePixelRatio") && !r.js.includes("entry.devicePixelContentBoxSize"), c);
  }
});
