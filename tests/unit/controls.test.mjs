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

test("i settori cardinali sono larghi (±30°): un pollice un po' storto non fa diagonali", () => {
  const a = (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  assert.deepEqual(dpadDirections(...a(25)), ["RIGHT"]);
  assert.deepEqual(dpadDirections(...a(-28)), ["RIGHT"]);
  assert.deepEqual(dpadDirections(...a(115)), ["DOWN"]);
});

test("diagonali nei settori stretti", () => {
  const a = (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
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
