// Screenshot di confronto dei temi nella schermata di gioco e nella libreria.
// Uso: node tools/theme-shots.mjs <cartella>
import { launch, addRom, gameIds, startGame, ROM } from "../tests/e2e/helpers.mjs";
const out = (process.argv[2] || "docs/img").replace(/\/$/, "") + "/";
const t = await launch({ viewport: { width: 390, height: 844 } });
const { page, base } = t;
const set = (patch) => page.evaluate(async (p) => { const s = await import("./js/settings.js"); await s.saveSettings(p); }, patch);
await page.goto(base);
await page.waitForFunction(() => window.vesuvioHome?.ready);
await addRom(page, ROM);
const [id] = await gameIds(page);
for (const [theme, extra] of [["vesuvio", {}], ["napoli", {}], ["arcade", {}], ["tramonto", {}], ["aurora", {}], ["custom", {}], ["unova", { controls: { colors: "classic" } }]]) {
  await set({ theme, controls: { colors: "theme" }, game: { immersive: false, fullscreen: false }, ...extra });
  await startGame(page, base, id, "none");
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}tema-${theme}.png` });
}
// modalità gioco (barra nascosta) + diagonale premuta
await set({ theme: "arcade", game: { immersive: true } });
await startGame(page, base, id, "none");
const d = await page.locator("#pad .dpad").boundingBox();
const cdp = await page.context().newCDPSession(page);
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: d.x + d.width * 0.85, y: d.y + d.height * 0.15 }] });
await page.waitForTimeout(200);
console.log("diagonale:", await page.evaluate(() => Object.fromEntries(window.vesuvio.engine.inputState)));
await page.screenshot({ path: `${out}modalita-gioco-diagonale.png` });
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await set({ theme: "tramonto", game: { immersive: false } });
await page.goto(base);
await page.waitForFunction(() => window.vesuvioHome?.ready);
await page.click("#btn-settings");
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}impostazioni-temi.png` });
console.log("errori:", t.errors);
await t.close();
