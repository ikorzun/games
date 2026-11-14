import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ColliderSet } from '../src/world/colliders';
import { MeshBuilder } from '../src/world/kit';
import { MAT } from '../src/world/materials';
import { Xf } from '../src/world/props';
import { poster } from '../src/world/props_bunker';
import { BRUSH, digitRect, packSigns, POSTERS, ROOM_LABEL, SHEETS, SIGN, SIGN_LIST, SIGNS_SIZE } from '../src/world/signs';

describe('атлас надписей', () => {
  it('знаки не пересекаются, лежат внутри атласа, имена не повторяются', () => {
    const ids = new Set<string>();
    for (const s of SIGN_LIST) {
      expect(s.id).toMatch(/^[a-z0-9_]+$/);
      expect(ids.has(s.id), s.id).toBe(false);
      ids.add(s.id);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.x + s.pw).toBeLessThanOrEqual(SIGNS_SIZE);
      expect(s.y + s.ph).toBeLessThanOrEqual(SIGNS_SIZE);
      expect(s.u1).toBeGreaterThan(s.u0);
      expect(s.v1).toBeGreaterThan(s.v0);
      expect(s.w).toBeGreaterThan(0.05);
    }
    for (let i = 0; i < SIGN_LIST.length; i++) {
      for (let j = i + 1; j < SIGN_LIST.length; j++) {
        const a = SIGN_LIST[i]!;
        const b = SIGN_LIST[j]!;
        const apart = a.x + a.pw <= b.x || b.x + b.pw <= a.x || a.y + a.ph <= b.y || b.y + b.ph <= a.y;
        expect(apart, `${a.id} × ${b.id}`).toBe(true);
      }
    }
  });

  it('переполнение атласа — ошибка, а не молча обрезанные надписи', () => {
    expect(() => packSigns([{ id: 'big', kind: 'poster', lines: [], pw: 600, ph: 600, w: 1 }, { id: 'big2', kind: 'poster', lines: [], pw: 600, ph: 600, w: 1 }], 1024)).toThrow();
  });

  it('у каждого рода помещения есть трафарет; плакаты и надписи от руки существуют', () => {
    for (const id of Object.values(ROOM_LABEL)) expect(SIGN[id], id).toBeDefined();
    for (const id of [...POSTERS, ...BRUSH, 'germo', 'dzg', 'arc', 'scheme', 'dial_a', 'dial_b', 'dial_c', 'attention', 'door_sector']) expect(SIGN[id], id).toBeDefined();
    // Надписи — русские: это часть места действия.
    expect(SIGN.germo!.lines[0]).toBe('ГЕРМОДВЕРЬ');
    const d = digitRect(7);
    expect(d.u0).toBeGreaterThan(SIGN.digits!.u0);
    expect(d.u1).toBeLessThanOrEqual(SIGN.digits!.u1);
  });

  it('знак на стене — лист с uv из атласа, лицом в комнату; трафарет и печать — разные материалы', () => {
    for (const rot of [0, 1, 2, 3] as const) {
      const mb = new MeshBuilder();
      new Xf(mb, new ColliderSet(), 0, 0, 0, rot).sign('germo', 0, 1.5, 0.6);
      const m = mb.build();
      expect(m.index.length).toBe(6);
      expect([...m.mat]).toEqual([MAT.stencil, MAT.stencil, MAT.stencil, MAT.stencil]);
      const s = SIGN.germo!;
      expect(Math.min(...m.uv.filter((_, i) => i % 2 === 0))).toBeCloseTo(s.u0, 5);
      expect(Math.max(...m.uv.filter((_, i) => i % 2 === 1))).toBeCloseTo(s.v1, 5);
      // Нормаль — по локальной +z, повёрнутой вместе с предметом.
      const want = new Xf(mb, null, 0, 0, 0, rot).pt(0, 0, 1);
      expect(m.normal[0]).toBeCloseTo(want[0], 5);
      expect(m.normal[2]).toBeCloseTo(want[2], 5);
    }
    const mb = new MeshBuilder();
    const xf = new Xf(mb, null, 0, 0, 0, 0);
    xf.sign('poster_mask', 0, 1.2);
    xf.floorSign('arc', 0, 0, 1);
    const m = mb.build();
    expect(m.mat[0]).toBe(MAT.print);
    expect(m.mat[4]).toBe(MAT.stencil);
    // Знак на полу смотрит вверх.
    expect(m.normal[4 * 3 + 1]).toBeCloseTo(1, 5);
    expect(() => xf.sign('no_such_sign', 0, 0)).toThrow();
  });
});

/** Размер картинки WebP с потерями (простой контейнер «VP8 »): ширина и высота лежат в заголовке кадра. */
function webpSize(file: string): { w: number; h: number } {
  const b = readFileSync(file);
  expect(b.toString('ascii', 0, 4), file).toBe('RIFF');
  expect(b.toString('ascii', 8, 16), file).toBe('WEBPVP8 ');
  return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
}

describe('плакаты и план убежища — настоящие листы-картинки', () => {
  const dir = fileURLToPath(new URL('../assets/posters/', import.meta.url));

  it('листы — это все плакаты и план убежища; плакат 2:3, план — тот же лист на боку', () => {
    expect([...SHEETS].sort()).toEqual([...POSTERS, 'scheme'].sort());
    expect(POSTERS.length).toBeGreaterThanOrEqual(9);
    for (const id of POSTERS) {
      const s = SIGN[id]!;
      expect(s.kind, id).toBe('poster');
      expect(s.pw / s.ph, id).toBeCloseTo(2 / 3, 5);
      // Лист 60×90: на стене он шириной 62 см.
      expect(s.w, id).toBeCloseTo(0.62, 5);
    }
    expect(SIGN.scheme!.kind).toBe('scheme');
    expect(SIGN.scheme!.pw / SIGN.scheme!.ph).toBeCloseTo(3 / 2, 5);
    // Кроме листов, картинок в атласе нет: остальное рисуется кодом.
    for (const s of SIGN_LIST) expect(SHEETS.includes(s.id), s.id).toBe(s.kind === 'poster' || s.kind === 'scheme');
  });

  it('у каждого листа есть файл для игры (512×768 или 768×512, не тяжелее 120 КБ) и полный исходник', () => {
    for (const id of SHEETS) {
      const file = `${dir}${id}.webp`;
      expect(existsSync(file), file).toBe(true);
      const { w, h } = webpSize(file);
      const s = SIGN[id]!;
      expect([w, h], id).toEqual(s.pw < s.ph ? [512, 768] : [768, 512]);
      expect(statSync(file).size, id).toBeLessThan(120 * 1024);
      // Исходник — тот же лист в полном размере: из него файл для игры можно собрать заново.
      const master = `${dir}master/${id}.webp`;
      expect(existsSync(master), master).toBe(true);
      const m = webpSize(master);
      expect(m.w / m.h, id).toBeCloseTo(w / h, 2);
      expect(Math.max(m.w, m.h), id).toBeGreaterThanOrEqual(1536);
    }
  });

  it('на рейках висят только листы-картинки: ни одной подделки под плакат, нарисованной кодом', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      const mb = new MeshBuilder();
      const used: string[] = [];
      const xf = new Xf(mb, new ColliderSet(), 0, 0, 0, 0);
      const sign = xf.sign.bind(xf);
      xf.sign = (id, ...rest) => {
        used.push(id);
        return sign(id, ...rest);
      };
      poster(xf, 0.62, 0.9, seed);
      expect(used.length, `seed ${seed}`).toBe(1);
      expect(SHEETS.includes(used[0]!), used[0]).toBe(true);
      seen.add(used[0]!);
    }
    // За шестьдесят мест под плакат встречаются все листы.
    expect([...seen].sort()).toEqual([...SHEETS].sort());
  });

  it('проверка сборки: без файла листа в архиве — ошибка с его именем, со всеми листами — чисто', async () => {
    // Скрипт сборки — обычный .mjs без типов: берём его как есть.
    const mod = (await import('../scripts/check_dist.mjs' as string)) as { checkDist(dir: string, opts?: Record<string, unknown>): { problems: string[] } };
    const dist = mkdtempSync(join(tmpdir(), 'vz-sheets-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>t</title>');
    mkdirSync(join(dist, 'assets'));
    for (const id of SHEETS.filter((x) => x !== 'poster_mask')) writeFileSync(join(dist, 'assets', `${id}-AbC123.webp`), 'x');
    const lost = mod.checkDist(dist).problems.filter((p) => p.includes('листов-картинок'));
    expect(lost.length).toBe(1);
    expect(lost[0]).toContain('poster_mask');
    expect(lost[0]).not.toContain('poster_alarm');
    writeFileSync(join(dist, 'assets', 'poster_mask-XyZ789.webp'), 'x');
    expect(mod.checkDist(dist).problems.filter((p) => p.includes('листов-картинок'))).toEqual([]);
  });
});
