import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import type { WorldKind } from '../src/gen/layout';
import { ColliderSet } from '../src/world/colliders';
import { MeshBuilder } from '../src/world/kit';
import { buildLevel } from '../src/world/level_build';
import { MAT } from '../src/world/materials';
import { Xf } from '../src/world/props';
import { poster } from '../src/world/props_bunker';
import { BRUSH, digitRect, HAND, NOTE_ID, packSigns, POSTERS, ROOM_LABEL, SHEETS, SIGN, SIGN_LIST, SIGNS_SIZE } from '../src/world/signs';

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

describe('карточка от руки «please use only when necessary»', () => {
  const SEEDS = [1, 5, 7, 42, 808, 4242, 9001, 31337, 20041113, 123456789, ...Array.from({ length: 20 }, (_, i) => (i * 7919 + 101) >>> 0)];
  const WORLDS: readonly WorldKind[] = ['shelter', 'office', 'yellow'];

  it('карточка лежит в атласе: три строки по-английски, и у каждой буквы есть штрихи от руки', () => {
    const c = SIGN[NOTE_ID]!;
    expect(c).toBeDefined();
    expect(c.kind).toBe('card');
    // Не перевод и не надпись места: это голос самой сессии, поэтому по-английски в любом языке игры.
    expect(c.lines).toEqual(['PLEASE USE', 'ONLY WHEN', 'NECESSARY']);
    for (const line of c.lines) {
      for (const letter of line) {
        if (letter === ' ') continue;
        const strokes = HAND[letter];
        expect(strokes, `буква ${letter}`).toBeDefined();
        expect(strokes!.length).toBeGreaterThan(0);
        for (const st of strokes!) {
          expect(st.length).toBeGreaterThanOrEqual(2);
          for (const [x, y] of st) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(1);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(1);
          }
        }
      }
    }
    // Карточка — маленькая вещь: с ладонь, а не плакат.
    expect(c.w).toBeGreaterThan(0.2);
    expect(c.w).toBeLessThan(0.45);
  });

  it('на уровне каждого мира — ровно одна: в соседнем с началом помещении, не в самом начале; на высоте глаз, лицом от стены', () => {
    for (const world of WORLDS) {
      for (const seed of SEEDS) {
        const l = buildLevel(generateLayout(seed, 2, world));
        const notes = l.notes ?? [];
        expect(notes, `${world} ${seed}`).toHaveLength(1);
        const m = notes[0]!;
        expect(m.id).toBe(NOTE_ID);
        // Смотрит горизонтально.
        expect(Math.hypot(m.n[0], m.n[2])).toBeCloseTo(1, 5);
        expect(m.n[1]).toBeCloseTo(0, 5);
        const rooms = l.layout!.rooms;
        const startRoom = rooms[l.layout!.entranceRoom]!;
        const floor = -startRoom.tier * 4.5;
        expect(m.at[1] - floor, `${world} ${seed}: высота`).toBeGreaterThan(1.3);
        expect(m.at[1] - floor, `${world} ${seed}: высота`).toBeLessThan(1.65);
        // Помещение карточки — по клетке, в которую она смотрит.
        const cx = Math.round((m.at[0] + m.n[0] * 0.6) / 3) + 8;
        const cz = Math.round((m.at[2] + m.n[2] * 0.6) / 3) + 8;
        const room = rooms.find((r) => r.tier === startRoom.tier && r.cells.some(([x, z]) => x === cx && z === cz));
        expect(room, `${world} ${seed}: карточка вне помещений`).toBeDefined();
        expect(room!.id, `${world} ${seed}: карточка в самом начале`).not.toBe(startRoom.id);
        // Рядом: не дальше двух клеток от клетки начала.
        const [sx, sz] = startRoom.cells[0]!;
        const d = Math.min(...room!.cells.map(([x, z]) => Math.abs(x - sx) + Math.abs(z - sz)));
        expect(d, `${world} ${seed}: далеко от начала`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('карточку ничто не закрывает: перед ней нет мебели, на неё не налезают другие надписи, и вернуться на её место вещи некуда', () => {
    const c = SIGN[NOTE_ID]!;
    const hw = c.w / 2;
    const hh = (c.w * c.ph) / c.pw / 2;
    for (const world of WORLDS) {
      for (const seed of SEEDS) {
        const l = buildLevel(generateLayout(seed, 2, world));
        const m = l.notes![0]!;
        const tx = Math.abs(m.n[2]);
        const tz = Math.abs(m.n[0]);
        // 1. Перед карточкой (на 60 см от стены) не стоит ни один предмет обстановки.
        const lo = [Math.min(m.at[0] - tx * hw, m.at[0] + m.n[0] * 0.6), m.at[1] - hh, Math.min(m.at[2] - tz * hw, m.at[2] + m.n[2] * 0.6)];
        const hi = [Math.max(m.at[0] + tx * hw, m.at[0] + m.n[0] * 0.6), m.at[1] + hh, Math.max(m.at[2] + tz * hw, m.at[2] + m.n[2] * 0.6)];
        const before = l.objects!.filter((o) => o.min[0] < hi[0]! && o.max[0] > lo[0]! && o.min[1] < hi[1]! && o.max[1] > lo[1]! && o.min[2] < hi[2]! && o.max[2] > lo[2]!);
        expect(before.map((o) => o.name), `${world} ${seed}: карточку закрывает мебель`).toEqual([]);
        // 2. Другие листы и трафареты на её прямоугольник не заходят (свой лист узнаём по клетке атласа).
        const a0 = [m.at[0] - tx * hw - tz * 0.03, m.at[1] - hh, m.at[2] - tz * hw - tx * 0.03];
        const a1 = [m.at[0] + tx * hw + tz * 0.03, m.at[1] + hh, m.at[2] + tz * hw + tx * 0.03];
        let own = 0;
        let other = 0;
        for (const ch of l.chunks) {
          const g = ch.mesh;
          for (let t = 0; t < g.index.length; t += 3) {
            const v = [g.index[t]!, g.index[t + 1]!, g.index[t + 2]!];
            const mat = g.mat[v[0]!]!;
            if (mat !== MAT.stencil && mat !== MAT.print) continue;
            let hit = true;
            for (let k = 0; k < 3; k++) {
              const ps = v.map((i) => g.position[i * 3 + k]!);
              if (Math.min(...ps) > a1[k]! || Math.max(...ps) < a0[k]!) hit = false;
            }
            if (!hit) continue;
            const us = v.map((i) => g.uv[i * 2]!);
            const vs = v.map((i) => g.uv[i * 2 + 1]!);
            const mine = Math.min(...us) >= c.u0 - 1e-4 && Math.max(...us) <= c.u1 + 1e-4 && Math.min(...vs) >= c.v0 - 1e-4 && Math.max(...vs) <= c.v1 + 1e-4;
            if (mine) own += 1;
            else other += 1;
          }
        }
        expect(own, `${world} ${seed}: лист карточки в сетке уровня`).toBe(2);
        expect(other, `${world} ${seed}: на карточку налезает другая надпись`).toBe(0);
        // 3. Свободных мест для вернувшихся вещей у её стены нет.
        const under = (l.freeSlots ?? []).filter((f) => Math.abs(f.at[0] - m.at[0]) < 1.2 && Math.abs(f.at[2] - m.at[2]) < 1.2 && Math.abs(f.at[1] - (m.at[1] - hh - 1.34)) < 0.5);
        const facing = under.filter((f) => {
          const fx = f.rot === 1 ? 1 : f.rot === 3 ? -1 : 0;
          const fz = f.rot === 0 ? 1 : f.rot === 2 ? -1 : 0;
          return Math.abs(fx - m.n[0]) < 0.01 && Math.abs(fz - m.n[2]) < 0.01;
        });
        expect(facing, `${world} ${seed}: под карточкой числится свободное место`).toEqual([]);
      }
    }
  }, 60000);

  it('один сид — карточка на одном и том же месте', () => {
    for (const world of WORLDS) {
      const a = buildLevel(generateLayout(808, 2, world)).notes!;
      const b = buildLevel(generateLayout(808, 2, world)).notes!;
      expect(a).toEqual(b);
    }
  });
});
