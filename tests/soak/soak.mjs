// Test di lunga durata: una sessione continua con turbo al massimo, input
// periodici e salvataggi automatici frequenti. Misura nel tempo velocita',
// memoria JS, durata dei salvataggi, numero di stati e spazio occupato.
// Uso: node tests/soak/soak.mjs [minuti=10] [core=melonds] [file-json-risultati]
import { launch, addRom, gameIds, startGame, ROM, GBA_ROM } from "../e2e/helpers.mjs";
import { writeFile } from "node:fs/promises";

const minutes = Number(process.argv[2] || 10);
const core = process.argv[3] || "melonds";
const outFile = process.argv[4] || null;
const t = await launch({ viewport: { width: 390, height: 844 } });
const { page, base } = t;
await page.goto(base);
await page.waitForFunction(() => window.vesuvioHome?.ready);
await page.evaluate(async () => { const s = await import("./js/settings.js"); await s.saveSettings({ autosave: { intervalSec: 10, warmupSec: 5, keepAuto: 12, checkpointEveryMin: 2, keepCheckpoints: 6 }, turbo: { ratio: 0 } }); });
await addRom(page, core === "mgba" ? GBA_ROM : ROM);
const [id] = await gameIds(page);
await startGame(page, base, id, "best", "&core=" + core);
await page.evaluate(() => window.vesuvio.engine.setFastForward(true, 0));
const samples = [];
const t0 = Date.now();
let lastFrame = await page.evaluate(() => window.vesuvio.engine.frame);
let lastT = Date.now();
while (Date.now() - t0 < minutes * 60000) {
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => { const e = window.vesuvio.engine; e.setInput(4, 1); window.vesuvio.session.noteInput(); setTimeout(() => e.setInput(4, 0), 120); });
    await page.waitForTimeout(5000);
  }
  const s = await page.evaluate(async (id) => {
    const store = await import("./js/store.js");
    const ev = await store.listEvents(id, 50);
    const lastSave = ev.find((e) => e.type === "autosave");
    const st = await store.listStates(id);
    const est = await navigator.storage.estimate();
    return {
      frame: window.vesuvio.engine.frame,
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      wasmMB: Math.round(window.vesuvio.engine.Module.HEAPU8.length / 1048576),
      states: st.length,
      kinds: st.reduce((a, x) => ((a[x.kind] = (a[x.kind] || 0) + 1), a), {}),
      saveMs: lastSave ? lastSave.detail.totalMs : null,
      storageMB: Math.round(est.usage / 1048576),
      frozen: window.vesuvio.session.frozen,
    };
  }, id);
  const now = Date.now();
  s.min = +((now - t0) / 60000).toFixed(1);
  s.fps = +((s.frame - lastFrame) / ((now - lastT) / 1000)).toFixed(1);
  s.ratio = +(s.fps / (core === "mgba" ? 59.73 : 59.83)).toFixed(2);
  lastFrame = s.frame; lastT = now;
  samples.push(s);
  console.log(JSON.stringify(s));
}
const q = Math.max(1, Math.floor(samples.length / 4));
const avg = (a) => a.reduce((x, y) => x + y.ratio, 0) / a.length;
const first = avg(samples.slice(0, q)), last = avg(samples.slice(-q));
const result = {
  core, minutes, emulatedFrames: samples.at(-1).frame, emulatedMinutes: +(samples.at(-1).frame / 59.83 / 60).toFixed(1),
  firstQuarterRatio: +first.toFixed(2), lastQuarterRatio: +last.toFixed(2),
  heapStartMB: samples[0].heapMB, heapEndMB: samples.at(-1).heapMB, heapMaxMB: Math.max(...samples.map((s) => s.heapMB || 0)),
  maxStates: Math.max(...samples.map((s) => s.states)), maxSaveMs: Math.max(...samples.map((s) => s.saveMs || 0)),
  storageEndMB: samples.at(-1).storageMB, freezes: samples.filter((s) => s.frozen).length, jsErrors: t.errors,
  verdict: {},
};
result.verdict.speedStable = last >= first * 0.85;
result.verdict.memoryBounded = (result.heapEndMB - result.heapStartMB) < 60;
result.verdict.statesBounded = samples.at(-1).states <= 12 + 6 + 2;
result.verdict.noFreezes = result.freezes === 0;
console.log("RISULTATO", JSON.stringify(result, null, 2));
if (outFile) await writeFile(outFile, JSON.stringify({ result, samples }, null, 2));
await t.close();
process.exit(Object.values(result.verdict).every(Boolean) && !t.errors.length ? 0 : 1);
