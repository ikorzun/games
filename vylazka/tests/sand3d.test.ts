import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ColliderSet } from '../src/world/colliders';
import { MeshBuilder } from '../src/world/kit';
import type { MeshData } from '../src/world/kit';
import { MAT, MAT_DEFS } from '../src/world/materials';
import { decodeModel, hasModel } from '../src/world/models';
import { ALL_PROPS, PROP_SETS } from '../src/world/props_all';
import { Xf } from '../src/world/props';
import type { PropSpec } from '../src/world/props_more';
import { SAND3D_PROPS } from '../src/world/props_sand3d';
import { loadSand3d, sand3dCredits, sand3dLoaded } from '../src/world/sand3d';
import { SAND3D_CREDITS, SAND3D_DATA } from '../src/world/sand3d_data';
import { SAND3D_META } from '../src/world/sand3d_meta';

const names = Object.keys(SAND3D_META);
/** Бюджет куска с моделями, байт: около 30 КБ на вещь — сорок вещей с запасом. */
const BUDGET = 1600 * 1024;
/** Треугольников на вещь — не больше (каталог отдаёт до 60 тыс., игре хватает тысячи-двух; комод с ручками — 3,3 тыс.). */
const MAX_TRIS = 3500;

/**
 * Номера материалов, которые импорт (scripts/import_sand3d.py, MAT_ID) пишет в данные: имя → номер. Если в
 * materials.ts номера сдвинутся, вещи полки молча легли бы не на те маткапы — этот список ловит расхождение.
 */
const IMPORT_MAT: Record<string, number> = {
  concrete: 0, steel: 5, rubber: 7, wood: 8, enamel: 9, brass: 10, paper: 15, metalGrey: 21, bakelite: 23, glass: 24, leather: 25, veneer: 35, upholstery: 36,
};

function build(p: PropSpec): { mesh: MeshData; col: ColliderSet } {
  const mb = new MeshBuilder();
  const col = new ColliderSet();
  p.build(new Xf(mb, col, 0, 0, 0, 0), 1000);
  return { mesh: mb.build(), col };
}

describe('полка Sand3D: пока модели не пришли', () => {
  // Этот блок идёт первым: модуль моделей ещё не подгружен.
  it('модели не подключены, вещь стоит коробкой своего габарита с той же преградой', () => {
    expect(sand3dLoaded()).toBe(false);
    const name = 's3_desk_green';
    expect(hasModel(name)).toBe(false);
    const p = SAND3D_PROPS[name]!;
    const { mesh, col } = build(p);
    expect(mesh.position.length / 3).toBeGreaterThan(0);
    expect(mesh.position.length / 3).toBeLessThanOrEqual(24);
    // Коробка — закрытой вещи: открывать у неё нечего, преграда одна.
    expect(col.boxes.length).toBe(1);
    const b = col.boxes[0]!;
    expect(b.maxX - b.minX).toBeCloseTo(p.w, 5);
    expect(b.maxZ - b.minZ).toBeCloseTo(p.d, 5);
  });
});

describe('полка Sand3D: опись и авторство', () => {
  it('вещей 30–60, имена s3_*, у каждой записи описи есть модель и наоборот', () => {
    expect(names.length).toBeGreaterThanOrEqual(30);
    expect(names.length).toBeLessThanOrEqual(60);
    for (const n of names) expect(n, n).toMatch(/^s3_[a-z0-9_]+$/);
    expect(Object.keys(SAND3D_DATA).sort()).toEqual([...names].sort());
    for (const n of names) {
      const m = SAND3D_META[n]!;
      const r = SAND3D_DATA[n]!;
      expect([r.v, r.t, r.min, r.max], n).toEqual([m.v, m.t, m.min, m.max]);
    }
  });

  it('у каждой вещи — строка авторства каталога и свободная лицензия (CC-BY-4.0 и свободнее, без некоммерческих)', () => {
    expect(SAND3D_CREDITS.map((c) => c.name).sort()).toEqual([...names].sort());
    expect(new Set(SAND3D_CREDITS.map((c) => c.id)).size).toBe(names.length);
    for (const c of SAND3D_CREDITS) {
      expect(c.license, c.name).toBe('CC-BY-4.0');
      expect(['CC-BY-4.0', 'CC0-1.0', 'CC0', 'Apache-2.0'], c.name).toContain(c.source);
      expect(c.attribution.length, c.name).toBeGreaterThan(20);
      expect(c.attribution, c.name).not.toMatch(/\bNC\b|NonCommercial|\bSA\b|ShareAlike/i);
    }
  });

  it('титры моделей лежат в сборке (public/credits_sand3d.txt) со строкой каждой вещи', () => {
    const txt = readFileSync(new URL('../public/credits_sand3d.txt', import.meta.url), 'utf8');
    expect(txt).toMatch(/CC BY 4\.0/);
    for (const c of SAND3D_CREDITS) expect(txt, c.name).toContain(c.attribution);
  });

  it('кусок с моделями укладывается в бюджет; опись лёгкая и без адресов (она в основном коде игры, ссылок там нет)', () => {
    expect(readFileSync(new URL('../src/world/sand3d_data.ts', import.meta.url)).length).toBeLessThan(BUDGET);
    const meta = readFileSync(new URL('../src/world/sand3d_meta.ts', import.meta.url), 'utf8');
    expect(meta.length).toBeLessThan(20 * 1024);
    expect(meta).not.toMatch(/https?:|www\./);
  });

  it('вещи полки — в реестре реквизита одним набором, имена ни с чем не совпадают', () => {
    expect(PROP_SETS.SAND3D_PROPS).toBe(SAND3D_PROPS);
    for (const n of names) expect(ALL_PROPS[n], n).toBeDefined();
  });

  it('проверка сборки: кусок с моделями полки — данные, а не ядро; основной код — ядро', async () => {
    const mod = (await import('../scripts/check_dist.mjs' as string)) as { checkDist(dir: string, opts?: Record<string, unknown>): { problems: string[]; stats: { coreBytes: number; assetBytes: number } } };
    const dist = mkdtempSync(join(tmpdir(), 'vz-sand3d-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>t</title>');
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'assets', 'index-AbC123.js'), 'x'.repeat(1000));
    writeFileSync(join(dist, 'assets', 'sand3d_data-XyZ_78.js'), 'x'.repeat(5000));
    const r = mod.checkDist(dist, { sheets: [], screens: [], papers: [], coreBudget: 3000 });
    expect(r.stats.coreBytes).toBeLessThan(3000);
    expect(r.stats.assetBytes).toBeGreaterThanOrEqual(5000);
    expect(r.problems.filter((p) => p.includes('ядро'))).toEqual([]);
    writeFileSync(join(dist, 'assets', 'other-XyZ_78.js'), 'x'.repeat(5000));
    expect(mod.checkDist(dist, { sheets: [], screens: [], papers: [], coreBudget: 3000 }).problems.filter((p) => p.includes('ядро')).length).toBe(1);
  });

  it('номера материалов импорта совпадают с materials.ts', () => {
    for (const [name, id] of Object.entries(IMPORT_MAT)) expect((MAT as Record<string, number>)[name], name).toBe(id);
  });
});

describe('полка Sand3D: размеры и постановка', () => {
  it('размеры как у настоящей мебели: от 0,3 до 2,5 м в плане, до 2,1 м в высоту', () => {
    for (const n of names) {
      const p = SAND3D_PROPS[n]!;
      expect(p.w, n).toBeGreaterThan(0.25);
      expect(p.w, n).toBeLessThan(2.5);
      expect(p.d, n).toBeGreaterThan(0.25);
      expect(p.d, n).toBeLessThan(2.5);
      expect(p.h, n).toBeGreaterThan(0.4);
      expect(p.h, n).toBeLessThan(2.1);
    }
  });

  it('кровати, нары и кроватка — длинной стороной вдоль стены, как кровати игры', () => {
    for (const n of ['s3_bunk_black', 's3_bunk_mattress', 's3_bed_iron_white', 's3_bed_iron_green', 's3_crib']) {
      const p = SAND3D_PROPS[n]!;
      expect(p.w, n).toBeGreaterThan(p.d * 1.4);
    }
    // Те, с кем их меняют, лежат так же.
    for (const n of ['bed_home', 'bed_frame', 'bunk_triple', 'crib']) expect(ALL_PROPS[n]!.w, n).toBeGreaterThan(ALL_PROPS[n]!.d);
  });

  it('у стены — спина в z = 0, посреди пола — середина в начале координат; стоят на полу', () => {
    for (const n of names) {
      const m = SAND3D_META[n]!;
      expect(m.min[1], n).toBe(0);
      if (m.mount === 'floor') expect(m.min[2], n).toBe(0);
      else expect(m.min[2] + m.max[2], n).toBeCloseTo(0, 3);
      expect(m.min[0] + m.max[0], n).toBeCloseTo(0, 3);
    }
  });
});

describe('полка Sand3D: модели пришли', () => {
  it('загрузка подключает все модели, повторная — тот же ответ', async () => {
    expect(sand3dCredits()).toEqual([]);
    expect(await loadSand3d()).toBe(true);
    expect(await loadSand3d()).toBe(true);
    expect(sand3dLoaded()).toBe(true);
    for (const n of names) expect(hasModel(n), n).toBe(true);
    // Титры игры: строка авторства каждой вещи — как в каталоге, без изменений (CC BY 4.0 требует назвать авторов).
    expect(sand3dCredits()).toEqual(SAND3D_CREDITS.map((c) => c.attribution));
    expect(sand3dCredits()).toHaveLength(names.length);
  });

  it.each(names)('%s: разбирается, сетка в бюджете, материалы — свои у деталей и существуют', (name) => {
    const r = SAND3D_DATA[name]!;
    const m = decodeModel(name);
    expect(m.position.length).toBe(r.v * 3);
    expect(m.index.length).toBe(r.t * 3);
    expect(r.t).toBeGreaterThan(20);
    expect(r.t).toBeLessThanOrEqual(MAX_TRIS);
    expect(m.mat?.length).toBe(r.v);
    const known = new Set(Object.values(IMPORT_MAT));
    for (const id of new Set(m.mat)) {
      expect(known.has(id), `${name}: материал ${id}`).toBe(true);
      expect(MAT_DEFS[id], `${name}: материал ${id}`).toBeDefined();
    }
    for (let t = 0; t < m.index.length; t += 3) {
      const [a, b, c] = [m.index[t]!, m.index[t + 1]!, m.index[t + 2]!];
      expect(a < r.v && b < r.v && c < r.v).toBe(true);
    }
  });

  it.each(names)('%s: грани смотрят туда же, куда нормали (обход не вывернут)', (name) => {
    const m = decodeModel(name);
    let agree = 0;
    let total = 0;
    for (let t = 0; t < m.index.length; t += 3) {
      const [a, b, c] = [m.index[t]! * 3, m.index[t + 1]! * 3, m.index[t + 2]! * 3];
      const e1 = [m.position[b]! - m.position[a]!, m.position[b + 1]! - m.position[a + 1]!, m.position[b + 2]! - m.position[a + 2]!];
      const e2 = [m.position[c]! - m.position[a]!, m.position[c + 1]! - m.position[a + 1]!, m.position[c + 2]! - m.position[a + 2]!];
      const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      const area = Math.hypot(n[0]!, n[1]!, n[2]!);
      if (area < 1e-7) continue;
      let dot = 0;
      for (const v of [a, b, c]) for (let k = 0; k < 3; k++) dot += n[k]! * m.normal[v + k]!;
      total += area;
      if (dot > 0) agree += area;
    }
    expect(agree / total).toBeGreaterThan(0.9);
  });

  it('вещь кладётся с материалом каждой детали: у стола с сукном — дерево, сталь, латунь и кожа', () => {
    const name = 's3_desk_green';
    const { mesh, col } = build(SAND3D_PROPS[name]!);
    const m = decodeModel(name);
    expect(mesh.position.length / 3).toBe(m.position.length / 3);
    const used = new Set(Array.from(mesh.mat, (v) => Math.round(v)));
    for (const id of [MAT.wood, MAT.steel, MAT.brass, MAT.leather]) expect(used.has(id), String(id)).toBe(true);
    for (let i = 0; i < m.mat!.length; i++) expect(Math.round(mesh.mat[i]!)).toBe(m.mat![i]);
    // Преграда корпуса и по одной у каждого выдвинутого ящика.
    expect(col.boxes.length).toBeGreaterThanOrEqual(1);
  });

  it('вещь не выходит за свой габарит в реестре', () => {
    for (const n of names) {
      const p = SAND3D_PROPS[n]!;
      const { mesh } = build(p);
      const z0 = p.mount === 'free' ? -p.d / 2 : 0;
      for (let i = 0; i < mesh.position.length; i += 3) {
        expect(Math.abs(mesh.position[i]!), n).toBeLessThanOrEqual(p.w / 2 + 1e-3);
        expect(mesh.position[i + 1]!, n).toBeGreaterThanOrEqual(-1e-3);
        expect(mesh.position[i + 1]!, n).toBeLessThanOrEqual(p.h + 1e-3);
        expect(mesh.position[i + 2]!, n).toBeGreaterThanOrEqual(z0 - 1e-3);
        expect(mesh.position[i + 2]!, n).toBeLessThanOrEqual(z0 + p.d + (p.reach ?? 0) + 1e-3);
      }
    }
  });
});
