import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCode, parseCht, encodeForCore } from "../../js/cheats.js";

test("melonDS: i blocchi da 0x80000000 in su diventano negativi, gli altri restano uguali", () => {
  assert.equal(encodeForCore("D2000000 00000000+02100044 9ABCDEF0", "melonds"), "-2E000000 00000000+02100044 -65432110");
  assert.equal(encodeForCore("D2000000 00000000", "desmume2015"), "D2000000 00000000");
});

test("codici Action Replay: righe, spazi e minuscole vengono normalizzati", () => {
  const r = normalizeCode("02100040 12345678\n  02100044  9abcdef0 ");
  assert.equal(r.code, "02100040 12345678+02100044 9ABCDEF0");
  assert.equal(r.lines.length, 2);
  assert.equal(normalizeCode("0210004012345678").code, "02100040 12345678");
});

test("codici sbagliati: errore chiaro invece di un trucco che non fa niente", () => {
  assert.throws(() => normalizeCode("02100040 1234567"), /non è un blocco valido/);
  assert.throws(() => normalizeCode("02100040"), /dispari/);
  assert.throws(() => normalizeCode(""), /incolla/);
});

test("file .cht di RetroArch", () => {
  const list = parseCht('cheats = 2\ncheat0_desc = "Soldi"\ncheat0_code = "02000000 0000FFFF"\ncheat0_enable = true\ncheat1_desc = "Altro"\ncheat1_code = "02000004 00000001"\ncheat1_enable = false\n');
  assert.deepEqual(list, [
    { name: "Soldi", code: "02000000 0000FFFF", enabled: true },
    { name: "Altro", code: "02000004 00000001", enabled: false },
  ]);
});
