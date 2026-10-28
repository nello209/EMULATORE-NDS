#!/usr/bin/env python3
"""Genera una ROM homebrew NDS minimale per i test automatici.

Non contiene codice o dati Nintendo: e' scritta da zero con un mini-assemblatore
ARM. Comportamento:
  - schermo superiore: gradiente animato (rosso = x + fotogramma, verde = y)
  - tenendo premuto A: schermo superiore verde
  - tenendo premuto B: schermo superiore blu
  - premendo SELECT: il "gioco" si blocca su schermo nero (l'emulatore continua a
    girare): serve a verificare il rilevamento dei blocchi "morbidi"
  - tenendo premuto X / Y: giallo / azzurro; toccando lo schermo inferiore: bianco
  - schermo inferiore: blu scuro fisso
  - l'ARM7 legge X/Y e il touch screen via SPI e li scrive in RAM a 0x02100010
    (firma "VSV7", EXTKEYIN, X grezzo, Y grezzo, contatore)
  - in RAM a 0x02100000 c'e' la firma "VSVT" seguita dal contatore dei fotogrammi
    del gioco (32 bit): i test lo cercano dentro i savestate

Uso: python3 tools/make_test_rom.py   (scrive anche tests/fixtures/vesuvio-test.gba)
"""
import struct
import sys

COND = {"al": 0xE, "eq": 0x0, "ne": 0x1}


def rot_imm(value):
    for rot in range(16):
        v = ((value << (2 * rot)) | (value >> (32 - 2 * rot))) & 0xFFFFFFFF
        if v < 256:
            return (rot << 8) | v
    raise ValueError("immediato non codificabile: %#x" % value)


class Asm:
    def __init__(self, base):
        self.base = base
        self.items = []  # (kind, args)
        self.labels = {}
        self.literals = []

    def here(self):
        return self.base + 4 * len(self.items)

    def label(self, name):
        self.labels[name] = self.here()

    def emit(self, fn):
        self.items.append(fn)

    # data processing
    def dp(self, op, rd, rn, imm=None, rm=None, lsl=0, s=False, cond="al", lsr=0):
        def enc(addr):
            w = COND[cond] << 28 | op << 21 | (1 << 20 if s else 0) | rn << 16 | rd << 12
            if imm is not None:
                w |= 1 << 25 | rot_imm(imm)
            else:
                w |= ((lsr << 7) | (1 << 5) | rm) if lsr else ((lsl << 7) | rm)
            return w
        self.emit(enc)

    def mov(self, rd, imm, cond="al"): self.dp(13, rd, 0, imm=imm, cond=cond)
    def add(self, rd, rn, imm): self.dp(4, rd, rn, imm=imm)
    def subs(self, rd, rn, imm): self.dp(2, rd, rn, imm=imm, s=True)
    def and_(self, rd, rn, imm, cond="al"): self.dp(0, rd, rn, imm=imm, cond=cond)
    def orr_lsl(self, rd, rn, rm, sh): self.dp(12, rd, rn, rm=rm, lsl=sh)
    def mov_lsr(self, rd, rm, sh): self.dp(13, rd, 0, rm=rm, lsr=sh)
    def cmp(self, rn, imm): self.dp(10, 0, rn, imm=imm, s=True)
    def tst(self, rn, imm): self.dp(8, 0, rn, imm=imm, s=True)

    def mem(self, load, rd, rn, off=0, byte=False, post=False, cond="al"):
        def enc(addr):
            p = 0 if post else 1
            u = 1 if off >= 0 else 0
            return (COND[cond] << 28 | 1 << 26 | p << 24 | u << 23 | (1 << 22 if byte else 0)
                    | (1 << 20 if load else 0) | rn << 16 | rd << 12 | abs(off))
        self.emit(enc)

    def memh(self, load, rd, rn, off=0):
        def enc(addr):
            return (0xE << 28 | 1 << 24 | 1 << 23 | 1 << 22 | (1 << 20 if load else 0) | rn << 16
                    | rd << 12 | ((off >> 4) & 0xF) << 8 | 0xB << 4 | (off & 0xF))
        self.emit(enc)

    def ldr_lit(self, rd, value, cond="al"):
        idx = len(self.literals)
        self.literals.append(value)

        def enc(addr):
            target = self.pool_addr + 4 * idx
            off = target - (addr + 8)
            assert 0 <= off < 4096
            return COND[cond] << 28 | 1 << 26 | 1 << 24 | 1 << 23 | 1 << 20 | 15 << 16 | rd << 12 | off
        self.emit(enc)

    def b(self, name, cond="al"):
        def enc(addr):
            off = (self.labels[name] - (addr + 8)) >> 2
            return COND[cond] << 28 | 0b101 << 25 | (off & 0xFFFFFF)
        self.emit(enc)

    def assemble(self):
        self.pool_addr = self.here()
        out = b""
        for i, fn in enumerate(self.items):
            out += struct.pack("<I", fn(self.base + 4 * i))
        for v in self.literals:
            out += struct.pack("<I", v)
        return out


def arm9_program():
    a = Asm(0x02000000)
    a.ldr_lit(0, 0x04000304); a.ldr_lit(1, 0x8203); a.mem(False, 1, 0)        # POWCNT1
    a.ldr_lit(0, 0x04000000); a.ldr_lit(1, 0x00020000); a.mem(False, 1, 0)    # DISPCNT A: VRAM
    a.ldr_lit(0, 0x04000240); a.mov(1, 0x80); a.mem(False, 1, 0, byte=True)   # VRAMCNT_A
    a.ldr_lit(0, 0x04001000); a.ldr_lit(1, 0x00010000); a.mem(False, 1, 0)    # DISPCNT B
    a.ldr_lit(0, 0x05000400); a.ldr_lit(1, 0x2800); a.memh(False, 1, 0)       # backdrop B
    a.mov(4, 0)
    a.ldr_lit(5, 0x02100000)
    a.ldr_lit(1, 0x54565356); a.mem(False, 1, 5)        # firma "VSVT" seguita dal contatore
    a.add(5, 5, 4)
    a.label("loop")
    a.ldr_lit(0, 0x04000006)
    a.label("wait1")
    a.memh(True, 1, 0); a.cmp(1, 192); a.b("wait1", "ne")
    a.add(4, 4, 1)
    a.mem(False, 4, 5)                                   # contatore in RAM
    a.ldr_lit(0, 0x04000130); a.memh(True, 1, 0)         # KEYINPUT (0 = premuto)
    a.tst(1, 4); a.b("hang", "eq")                       # SELECT
    a.and_(2, 4, 31)
    a.mov(9, 0)                                          # r9 = 1 se un tasto forza un colore pieno
    a.tst(1, 1); a.ldr_lit(2, 0x03E0, cond="eq"); a.mov(9, 1, cond="eq")   # A -> verde
    a.tst(1, 2); a.ldr_lit(2, 0x7C00, cond="eq"); a.mov(9, 1, cond="eq")   # B -> blu
    a.ldr_lit(0, 0x02100014); a.memh(True, 1, 0)         # EXTKEYIN copiato dall'ARM7
    a.tst(1, 1); a.ldr_lit(2, 0x03FF, cond="eq"); a.mov(9, 1, cond="eq")   # X -> giallo
    a.tst(1, 2); a.ldr_lit(2, 0x7FE0, cond="eq"); a.mov(9, 1, cond="eq")   # Y -> azzurro
    a.tst(1, 0x40); a.ldr_lit(2, 0x7FFF, cond="eq"); a.mov(9, 1, cond="eq")  # penna -> bianco
    a.ldr_lit(0, 0x06800000)
    a.cmp(9, 0); a.b("gradient", "eq")
    a.orr_lsl(2, 2, 2, 16)
    a.ldr_lit(3, 24576)
    a.label("fill")
    a.mem(False, 2, 0, off=4, post=True); a.subs(3, 3, 1); a.b("fill", "ne")
    a.b("filled")
    # nessun tasto: gradiente animato (rosso = x + tempo, verde = y)
    a.label("gradient")
    a.mov(7, 0)
    a.label("gfill")
    a.mov_lsr(6, 7, 2); a.dp(4, 6, 6, rm=4); a.and_(6, 6, 31)
    a.mov_lsr(8, 7, 9); a.and_(8, 8, 31); a.orr_lsl(6, 6, 8, 5)
    a.dp(12, 6, 6, imm=0x3000)
    a.orr_lsl(6, 6, 6, 16)
    a.mem(False, 6, 0, off=4, post=True)
    a.add(7, 7, 1); a.cmp(7, 0x6000); a.b("gfill", "ne")
    a.label("filled")
    a.ldr_lit(0, 0x04000006)
    a.label("wait2")
    a.memh(True, 1, 0); a.cmp(1, 192); a.b("wait2", "eq")
    a.b("loop")
    a.label("hang")
    a.mov(2, 0); a.ldr_lit(0, 0x06800000); a.ldr_lit(3, 24576)
    a.label("hfill")
    a.mem(False, 2, 0, off=4, post=True); a.subs(3, 3, 1); a.b("hfill", "ne")
    a.label("forever")
    a.b("forever")
    return a.assemble()


def arm7_program():
    """Legge tasti X/Y e touch screen (via SPI) e li scrive in RAM condivisa:
    0x02100010 firma "VSV7", +4 EXTKEYIN, +8 X grezzo, +12 Y grezzo, +16 contatore."""
    a = Asm(0x02380000)
    n = [0]

    def wait_spi():
        n[0] += 1
        lab = "spi%d" % n[0]
        a.label(lab)
        a.memh(True, 3, 2); a.tst(3, 0x80); a.b(lab, "ne")

    def tsc(cmd, off):
        wait_spi()
        a.ldr_lit(3, 0x8A01); a.memh(False, 3, 2)          # SPI on, touchscreen, CS tenuto
        a.mov(3, cmd); a.memh(False, 3, 2, 2)
        wait_spi()
        a.mov(3, 0); a.memh(False, 3, 2, 2)
        wait_spi()
        a.memh(True, 4, 2, 2)                             # byte alto
        a.ldr_lit(3, 0x8201); a.memh(False, 3, 2)          # CS rilasciato
        a.mov(3, 0); a.memh(False, 3, 2, 2)
        wait_spi()
        a.memh(True, 3, 2, 2)                             # byte basso
        a.and_(3, 3, 0xFF)
        a.and_(4, 4, 0xFF)
        a.orr_lsl(3, 3, 4, 8)
        a.mov_lsr(3, 3, 3)
        a.mem(False, 3, 5, off)

    a.ldr_lit(5, 0x02100010)
    a.ldr_lit(1, 0x37565356); a.mem(False, 1, 5)          # "VSV7"
    a.ldr_lit(2, 0x040001C0)
    a.mov(6, 0)
    a.label("loop")
    a.ldr_lit(0, 0x04000136); a.memh(True, 1, 0); a.mem(False, 1, 5, 4)
    tsc(0xD1, 8)
    tsc(0x91, 12)
    a.add(6, 6, 1); a.mem(False, 6, 5, 16)
    a.b("loop")
    return a.assemble()


def crc16(data, crc=0xFFFF):
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


def bgr555(r, g, b):
    return (r >> 3) | (g >> 3) << 5 | (b >> 3) << 10


def banner():
    # icona 32x32 4bpp: un vulcano stilizzato
    pal = [0, bgr555(30, 30, 40), bgr555(200, 60, 30), bgr555(250, 160, 40), bgr555(120, 90, 80), bgr555(240, 240, 250)]
    pix = [[0] * 32 for _ in range(32)]
    for y in range(32):
        for x in range(32):
            if y >= 12 and abs(x - 16) <= (y - 12) * 0.8 + 3:
                pix[y][x] = 4
            if y < 14 and abs(x - 16) <= 3 and (x + y) % 3:
                pix[y][x] = 3 if y > 6 else 2
            if (x - 16) ** 2 + (y - 5) ** 2 < 9:
                pix[y][x] = 5
    bitmap = bytearray()
    for ty in range(4):
        for tx in range(4):
            for y in range(8):
                for x in range(0, 8, 2):
                    p0 = pix[ty * 8 + y][tx * 8 + x]
                    p1 = pix[ty * 8 + y][tx * 8 + x + 1]
                    bitmap.append(p0 | p1 << 4)
    palette = b"".join(struct.pack("<H", c) for c in pal + [0] * (16 - len(pal)))
    titles = {
        0: "Vesuvio Test\nROM homebrew\nVesuvio",
        1: "Vesuvio Test\nHomebrew ROM\nVesuvio",
        4: "Vesuvio Test\nROM di prova\nVesuvio",
    }
    body = bytes(bitmap) + palette
    for lang in range(6):
        t = titles.get(lang, titles[1]).encode("utf-16-le")
        body += t + b"\0" * (256 - len(t))
    data = struct.pack("<HH", 1, crc16(body)) + b"\0" * 28 + body
    assert len(data) == 0x840
    return data


def build():
    arm9 = arm9_program()
    arm7 = arm7_program()
    arm9_off, arm7_off, banner_off = 0x8000, 0x9000, 0xA000
    rom = bytearray(0xC000)
    h = bytearray(0x200)
    h[0:12] = b"VESUVIOTEST\0"
    h[0x0C:0x10] = b"VSVT"
    h[0x10:0x12] = b"00"
    struct.pack_into("<IIII", h, 0x20, arm9_off, 0x02000000, 0x02000000, len(arm9))
    struct.pack_into("<IIII", h, 0x30, arm7_off, 0x02380000, 0x02380000, len(arm7))
    struct.pack_into("<II", h, 0x60, 0x00586000, 0x001808F8)
    struct.pack_into("<I", h, 0x68, banner_off)
    struct.pack_into("<I", h, 0x80, len(rom))
    struct.pack_into("<I", h, 0x84, 0x4000)
    struct.pack_into("<H", h, 0x15C, 0xCF56)
    struct.pack_into("<H", h, 0x15E, crc16(h[:0x15E]))
    rom[0:0x200] = h
    rom[arm9_off:arm9_off + len(arm9)] = arm9
    rom[arm7_off:arm7_off + len(arm7)] = arm7
    b = banner()
    rom[banner_off:banner_off + len(b)] = b
    return bytes(rom)


def build_gba():
    """ROM GBA minimale: colore per fotogramma, verde con A, blu con B; con START
    scrive in SRAM "V" + contatore (24 bit), cosi' si puo' testare il .sav.
    In EWRAM a 0x02000000: firma "VSVG" seguita dal contatore dei fotogrammi."""
    a = Asm(0x080000C0)
    a.ldr_lit(0, 0x04000000); a.ldr_lit(1, 0x0403); a.memh(False, 1, 0)      # modo 3, BG2
    a.mov(4, 0)
    a.ldr_lit(5, 0x02000000)
    a.ldr_lit(1, 0x47565356); a.mem(False, 1, 5)
    a.add(5, 5, 4)
    a.label("loop")
    a.ldr_lit(0, 0x04000006)
    a.label("w1")
    a.memh(True, 1, 0); a.cmp(1, 160); a.b("w1", "ne")
    a.add(4, 4, 1); a.mem(False, 4, 5)
    a.ldr_lit(0, 0x04000130); a.memh(True, 1, 0)
    a.and_(2, 4, 31)
    a.tst(1, 1); a.ldr_lit(2, 0x03E0, cond="eq")
    a.tst(1, 2); a.ldr_lit(2, 0x7C00, cond="eq")
    a.tst(1, 8); a.b("nosave", "ne")                     # START: scrive il contatore in SRAM
    a.ldr_lit(0, 0x0E000000)
    a.mov(6, 0x56); a.mem(False, 6, 0, byte=True)        # "V"
    a.mem(False, 4, 0, 1, byte=True)
    a.mov_lsr(6, 4, 8); a.mem(False, 6, 0, 2, byte=True)
    a.mov_lsr(6, 4, 16); a.mem(False, 6, 0, 3, byte=True)
    a.ldr_lit(2, 0x7FFF)                                 # bianco mentre salva
    a.label("nosave")
    a.orr_lsl(2, 2, 2, 16)
    a.ldr_lit(0, 0x06000000); a.ldr_lit(3, 19200)
    a.label("fill")
    a.mem(False, 2, 0, off=4, post=True); a.subs(3, 3, 1); a.b("fill", "ne")
    a.ldr_lit(0, 0x04000006)
    a.label("w2")
    a.memh(True, 1, 0); a.cmp(1, 160); a.b("w2", "eq")
    a.b("loop")
    code = a.assemble()
    h = bytearray(0xC0)
    struct.pack_into("<I", h, 0, 0xEA00002E)  # b 0x080000C0
    h[0xA0:0xAC] = b"VESUVIOTEST\0"
    h[0xAC:0xB0] = b"VSVG"
    h[0xB0:0xB2] = b"00"
    h[0xB2] = 0x96
    chk = (-(sum(h[0xA0:0xBD]) + 0x19)) & 0xFF
    h[0xBD] = chk
    rom = bytes(h) + code + b"SRAM_V113\0\0\0"
    return rom + b"\0" * (0x8000 - len(rom))


if __name__ == "__main__":
    for out, fn in (("tests/fixtures/vesuvio-test.nds", build), ("tests/fixtures/vesuvio-test.gba", build_gba)):
        with open(out, "wb") as f:
            f.write(fn())
        print("scritto", out)
