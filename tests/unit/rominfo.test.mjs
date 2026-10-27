import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyzeRom, detectSystem, tipsFor, extractRomFromZip } from "../../js/rominfo.js";
import { makeZip } from "../../js/zip.js";

const nds = new Uint8Array(await readFile(new URL("../fixtures/vesuvio-test.nds", import.meta.url)));
const gba = new Uint8Array(await readFile(new URL("../fixtures/vesuvio-test.gba", import.meta.url)));

test("ROM DS: intestazione, CRC e titolo italiano dal banner", async () => {
  const i = await analyzeRom("x.nds", nds);
  assert.equal(i.system, "nds");
  assert.equal(i.gameCode, "VSVT");
  assert.equal(i.headerCrcOk, true);
  assert.equal(i.titles.it, "Vesuvio Test\nROM di prova\nVesuvio");
  assert.equal(i.title, "Vesuvio Test — ROM di prova");
});

test("ROM GBA: intestazione", async () => {
  const i = await analyzeRom("x.gba", gba);
  assert.equal(i.system, "gba");
  assert.equal(i.gameCode, "VSVG");
  assert.equal(i.headerCrcOk, true);
});

test("riconoscimento dei Pokémon dal codice gioco", async () => {
  const fake = nds.slice();
  fake.set(new TextEncoder().encode("IRAI"), 0x0c); // Bianco, Italia
  const i = await analyzeRom("x.nds", fake);
  assert.equal(i.title, "Pokémon Versione Bianca");
  assert.equal(i.region, "Italia");
  assert.equal(i.pokemon.gen, 5);
  assert.ok(tipsFor(i).some((t) => t.id === "cgear"));
});

test("sistema dall'estensione o dal contenuto", () => {
  assert.equal(detectSystem("a.GBA", null), "gba");
  assert.equal(detectSystem("senza-estensione", gba), "gba");
  assert.equal(detectSystem("a.gbc", null), "gbc");
});

test("ROM dentro uno zip", async () => {
  const zip = new Uint8Array(await makeZip([{ name: "leggimi.txt", data: "x" }, { name: "giochi/test.nds", data: nds }]).arrayBuffer());
  const r = await extractRomFromZip(zip);
  assert.equal(r.name, "test.nds");
  assert.deepEqual(r.data, nds);
});
