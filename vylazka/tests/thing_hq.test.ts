import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MEMORY_KINDS, THING_HQ } from '../src/world/thing_hq_meta';
import { decodeThingHq } from '../src/world/thing_hq';
import { ALL_PROPS } from '../src/world/props_all';
import { MEMORY_THINGS } from '../src/systems/session';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'things');
/** Бюджеты подробной вещи (docs/vylazka/things_hq.md, §3): треугольники, сторона карт и вес трёх файлов. */
const MAX_TRIS = 40000;
const MAX_TEX = 1024;
const MAX_BYTES = 700 * 1024;

describe('подробные вещи памяти', () => {
  it('опись видов совпадает с вещами цепочек сессии, и каждая есть в реестре реквизита', () => {
    const fromChains = new Set(Object.values(MEMORY_THINGS).filter((k) => (MEMORY_KINDS as readonly string[]).includes(k)));
    for (const k of MEMORY_KINDS) {
      expect(k in ALL_PROPS, k).toBe(true);
      expect(fromChains.has(k), `${k} нет ни в одной цепочке`).toBe(true);
    }
  });

  it('подробная модель есть только у вещей памяти', () => {
    for (const k of Object.keys(THING_HQ)) expect((MEMORY_KINDS as readonly string[]).includes(k), k).toBe(true);
  });

  for (const [kind, meta] of Object.entries(THING_HQ)) {
    it(`${kind}: файлы на месте, сетка разбирается и сходится с описью и бюджетом`, () => {
      const files = ['.bin', '_c.webp', '_n.webp'].map((e) => join(DIR, meta.file + e));
      for (const f of files) expect(existsSync(f), f).toBe(true);
      expect(files.reduce((n, f) => n + statSync(f).size, 0)).toBeLessThanOrEqual(MAX_BYTES);
      const raw = readFileSync(files[0]!);
      const mesh = decodeThingHq(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);
      expect(mesh.index.length / 3).toBe(meta.tris);
      expect(mesh.position.length / 3).toBe(meta.verts);
      expect(meta.tris).toBeLessThanOrEqual(MAX_TRIS);
      expect(meta.tex).toBeLessThanOrEqual(MAX_TEX);
      // Начало координат — середина основания, как у болванки игры: вещь стоит на полу и не уезжает вбок.
      expect(Math.abs(meta.min[1])).toBeLessThan(0.002);
      expect(Math.abs(meta.min[0] + meta.max[0])).toBeLessThan(0.004);
      expect(Math.abs(meta.min[2] + meta.max[2])).toBeLessThan(0.004);
      // Наибольший размер — того же порядка, что у болванки: преграда и радиус взгляда остаются её.
      const spec = ALL_PROPS[kind]!;
      const big = Math.max(meta.max[0] - meta.min[0], meta.max[1] - meta.min[1], meta.max[2] - meta.min[2]);
      const was = Math.max(spec.w, spec.h, spec.d);
      expect(big).toBeGreaterThan(was * 0.6);
      expect(big).toBeLessThan(was * 1.5);
      // Нормали единичные, развёртка в листе.
      for (let i = 0; i < mesh.normal.length; i += 3) expect(Math.hypot(mesh.normal[i]!, mesh.normal[i + 1]!, mesh.normal[i + 2]!)).toBeCloseTo(1, 3);
      for (const u of mesh.uv) {
        expect(u).toBeGreaterThanOrEqual(-0.001);
        expect(u).toBeLessThanOrEqual(1.001);
      }
      expect(meta.credit.length).toBeGreaterThan(10);
    });
  }

  it('обрезанный файл и чужой файл не разбираются молча', () => {
    expect(() => decodeThingHq(new ArrayBuffer(64))).toThrow();
    const raw = readFileSync(join(DIR, `${Object.values(THING_HQ)[0]!.file}.bin`));
    expect(() => decodeThingHq(raw.buffer.slice(raw.byteOffset, raw.byteOffset + 200) as ArrayBuffer)).toThrow();
  });
});
