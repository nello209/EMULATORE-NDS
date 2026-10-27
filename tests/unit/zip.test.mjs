import { test } from "node:test";
import assert from "node:assert/strict";
import { makeZip, readZip, crc32, isZip } from "../../js/zip.js";

test("crc32 di riferimento", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("zip: scrittura e rilettura", async () => {
  const big = new Uint8Array(200000).map((_, i) => (i * 7) & 255);
  const blob = makeZip([{ name: "a.txt", data: "ciao" }, { name: "cartella/b.bin", data: big }]);
  const u8 = new Uint8Array(await blob.arrayBuffer());
  assert.ok(isZip(u8));
  const entries = readZip(u8);
  assert.deepEqual(entries.map((e) => e.name), ["a.txt", "cartella/b.bin"]);
  assert.equal(new TextDecoder().decode(await entries[0].read()), "ciao");
  assert.deepEqual(await entries[1].read(), big);
});

test("zip danneggiato: errore invece di dati sbagliati", async () => {
  const u8 = new Uint8Array(await makeZip([{ name: "x.bin", data: new Uint8Array([1, 2, 3, 4]) }]).arrayBuffer());
  u8[30 + 5] ^= 0xff; // byte dentro i dati del file
  await assert.rejects(readZip(u8)[0].read(), /danneggiato/);
});
