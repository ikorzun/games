import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import type { WorldKind } from '../src/gen/layout';
import type { LevelObject } from '../src/world/objects';
import { WORLD_FRAG } from '../src/render/shaders';
import { ColliderSet } from '../src/world/colliders';
import { MeshBuilder } from '../src/world/kit';
import type { MeshData } from '../src/world/kit';
import { buildLevel } from '../src/world/level_build';
import { MAT } from '../src/world/materials';
import { PAPERS, PAPER_FACES, PAPER_H, PAPER_LAYERS, PAPER_LIST, PAPER_U0, PAPER_W, paperHeight, paperUv } from '../src/world/papers';
import { Xf } from '../src/world/props';
import { LUGGAGE_PROPS } from '../src/world/props_luggage';
import { PAPER_PROPS } from '../src/world/props_papers';

/** Допуск по габариту, м: 3 см. */
const TOL = 0.03;
const SEEDS = [0, 1, 7, 1000];
type Rank = 1 | 2 | 3;

const PAPERS_DIR = join(__dirname, '..', 'assets', 'papers');

function mesh(fn: (xf: Xf) => void): MeshData {
  const mb = new MeshBuilder();
  fn(new Xf(mb, new ColliderSet(), 0, 0, 0, 0));
  return mb.build();
}

/** Листы бумаги в сетке: по четыре вершины подряд на лист, берём левый нижний угол uv. */
function sheets(m: MeshData): { u: number; v: number }[] {
  const out: { u: number; v: number }[] = [];
  const verts: number[] = [];
  for (let i = 0; i < m.mat.length; i++) if (m.mat[i] === MAT.print && m.uv[i * 2]! >= PAPER_U0) verts.push(i);
  for (let k = 0; k + 3 < verts.length; k += 4) {
    const us = [0, 1, 2, 3].map((j) => m.uv[verts[k + j]! * 2]!);
    const vs = [0, 1, 2, 3].map((j) => m.uv[verts[k + j]! * 2 + 1]!);
    out.push({ u: Math.min(...us), v: Math.min(...vs) });
  }
  return out;
}

function bounds(m: MeshData): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.position.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = m.position[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return { min, max };
}

describe('данные листов', () => {
  it('id уникальны и состоят из [a-z0-9_]', () => {
    const ids = PAPER_LIST.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(/^[a-z0-9_]+$/);
    expect(Object.keys(PAPERS).sort()).toEqual([...ids].sort());
  });

  it('у каждого листа есть слой; прямоугольник внутри слоя, не вырожден; ширина на стене положительна', () => {
    for (const p of PAPER_LIST) {
      expect(PAPER_LAYERS as readonly string[], `${p.id}: слой`).toContain(p.layer);
      expect(p.w, `${p.id}: w`).toBeGreaterThan(0);
      expect(p.h, `${p.id}: h`).toBeGreaterThan(0);
      expect(p.x, `${p.id}: x`).toBeGreaterThanOrEqual(0);
      expect(p.y, `${p.id}: y`).toBeGreaterThanOrEqual(0);
      expect(p.x + p.w, `${p.id}: правый край`).toBeLessThanOrEqual(PAPER_W);
      expect(p.y + p.h, `${p.id}: нижний край`).toBeLessThanOrEqual(PAPER_H);
      expect(p.width, `${p.id}: ширина на стене`).toBeGreaterThan(0);
      expect(paperHeight(p), `${p.id}: высота на стене`).toBeGreaterThan(0);
      expect(p.ru.trim().length, `${p.id}: описание`).toBeGreaterThan(2);
    }
  });

  it('для каждого слоя есть файл assets/papers/<id>.webp, лишних .webp нет', () => {
    for (const l of PAPER_LAYERS) expect(existsSync(join(PAPERS_DIR, `${l}.webp`)), `нет файла ${l}.webp`).toBe(true);
    const files = readdirSync(PAPERS_DIR)
      .filter((f) => f.endsWith('.webp'))
      .map((f) => f.slice(0, -'.webp'.length))
      .sort();
    expect(files).toEqual([...PAPER_LAYERS].sort());
  });

  it('каждый слой используется хотя бы одним листом, целиком или частью', () => {
    for (const l of PAPER_LAYERS) expect(PAPER_LIST.some((p) => p.layer === l), l).toBe(true);
  });

  it('портреты — первые PAPER_FACES слоёв, и только они: шейдер узнаёт их по номеру слоя', () => {
    PAPER_LAYERS.forEach((l, i) => expect(l.startsWith('faces_'), l).toBe(i < PAPER_FACES));
    for (const p of PAPER_LIST) expect(p.kind === 'faces' || p.kind === 'face', p.id).toBe(PAPER_LAYERS.indexOf(p.layer) < PAPER_FACES);
  });

  it('у слоёв портретов в файле есть альфа-канал (маска лиц), у остальных его нет', () => {
    // Заголовок WebP: RIFF…WEBP, затем блок VP8X с флагами; бит 0x10 — «есть альфа». Без VP8X альфы нет.
    for (const l of PAPER_LAYERS) {
      const buf = readFileSync(join(PAPERS_DIR, `${l}.webp`));
      expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
      expect(buf.toString('ascii', 8, 12)).toBe('WEBP');
      const alpha = buf.toString('ascii', 12, 16) === 'VP8X' && (buf[20]! & 0x10) !== 0;
      expect(alpha, l).toBe(l.startsWith('faces_'));
    }
  });

  it('ширина на стене — настоящая или близкая: купюры, акции и карточки — не фотообои', () => {
    // Крупными остаются стена мелких карточек, щит кабинетных портретов, карта, большой студийный портрет
    // и лист над кроватью — он увеличен нарочно. Остальное: лист с купюрами не шире 55 см, акция и
    // карточка в раме — не шире 40 см.
    const big = new Set(['faces_a', 'faces_b', 'faces_c', 'map_union', 'face_big']);
    for (const p of PAPER_LIST) {
      if (big.has(p.id)) continue;
      expect(p.width, p.id).toBeLessThanOrEqual(p.kind === 'money' ? 0.55 : 0.4);
    }
  });
});

describe('uv листов', () => {
  it('углы упорядочены, u в полосе своего слоя, v в (0, 1)', () => {
    for (const p of PAPER_LIST) {
      const uv = paperUv(p.id);
      expect(uv.layer, `${p.id}: номер слоя`).toBe(PAPER_LAYERS.indexOf(p.layer));
      expect(uv.u0, `${p.id}: u0 < u1`).toBeLessThan(uv.u1);
      expect(uv.v0, `${p.id}: v0 < v1`).toBeLessThan(uv.v1);
      const lo = PAPER_U0 + uv.layer;
      for (const u of [uv.u0, uv.u1]) {
        expect(u, `${p.id}: u`).toBeGreaterThan(lo);
        expect(u, `${p.id}: u`).toBeLessThan(lo + 1);
      }
      for (const v of [uv.v0, uv.v1]) {
        expect(v, `${p.id}: v`).toBeGreaterThan(0);
        expect(v, `${p.id}: v`).toBeLessThan(1);
      }
    }
  });

  it('неизвестный лист — ошибка', () => {
    expect(() => paperUv('нет_такого')).toThrow();
  });

  it('листы-части одного слоя, что висят отдельно в рамах, не пересекаются прямоугольниками', () => {
    const parts = PAPER_LIST.filter((p) => p.kind === 'face' || p.kind === 'bond');
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i]!;
        const b = parts[j]!;
        if (a.layer !== b.layer) continue;
        const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(dx > 0 && dy > 0, `${a.id} и ${b.id} пересекаются в слое ${a.layer}`).toBe(false);
      }
    }
  });
});

describe('Xf.paper и Xf.paperCeil', () => {
  const id = 'face_big';
  const p = PAPERS[id]!;
  const uv = paperUv(id);
  const normals = (m: MeshData): number[][] => [0, 1, 2, 3].map((i) => [m.normal[i * 3]!, m.normal[i * 3 + 1]!, m.normal[i * 3 + 2]!]);
  const uvs = (m: MeshData): number[][] => [0, 1, 2, 3].map((i) => [m.uv[i * 2]!, m.uv[i * 2 + 1]!]);

  it('лист на стене: четыре вершины, два треугольника, MAT.print, нормаль +z, габариты по ширине и высоте', () => {
    const w = 0.8;
    const mb = new MeshBuilder();
    new Xf(mb, new ColliderSet(), 0, 0, 0, 0).paper(id, 0, 0.5, w);
    const m = mb.build();
    expect(m.position.length / 3).toBe(4);
    expect(m.index.length / 3).toBe(2);
    expect(mb.triangleCount).toBe(2);
    expect(Array.from(m.mat).every((v) => v === MAT.print)).toBe(true);
    for (const n of normals(m)) {
      expect(n[0]).toBeCloseTo(0, 6);
      expect(n[1]).toBeCloseTo(0, 6);
      expect(n[2]).toBeCloseTo(1, 6);
    }
    const b = bounds(m);
    expect(b.max[0]! - b.min[0]!).toBeCloseTo(w, 6);
    expect(b.max[1]! - b.min[1]!).toBeCloseTo(paperHeight(p, w), 6);
    expect(b.min[1]).toBeCloseTo(0.5, 6);
    // Ширина по умолчанию — ширина листа.
    const d = bounds(mesh((xf) => xf.paper(id, 0, 0)));
    expect(d.max[0]! - d.min[0]!).toBeCloseTo(p.width, 6);
  });

  it('лист на стене: uv вершин — углы paperUv', () => {
    const m = mesh((xf) => xf.paper(id, 0, 0, 0.8));
    const us = new Set(uvs(m).map((q) => q[0]!.toFixed(5)));
    const vs = new Set(uvs(m).map((q) => q[1]!.toFixed(5)));
    expect([...us].sort()).toEqual([uv.u0, uv.u1].map((v) => v.toFixed(5)).sort());
    expect([...vs].sort()).toEqual([uv.v0, uv.v1].map((v) => v.toFixed(5)).sort());
    // Верх листа — большое v: у верхних вершин (y больше) v = v1.
    for (let i = 0; i < 4; i++) {
      const top = m.position[i * 3 + 1]! > 0.01;
      expect(m.uv[i * 2 + 1]!).toBeCloseTo(top ? uv.v1 : uv.v0, 6);
    }
  });

  it('лист на потолке: четыре вершины, два треугольника, MAT.print, нормаль вниз, uv — углы paperUv', () => {
    const w = 1.2;
    const mb = new MeshBuilder();
    new Xf(mb, new ColliderSet(), 0, 0, 0, 0).paperCeil(id, 0, 2.5, 1, w);
    const m = mb.build();
    expect(m.position.length / 3).toBe(4);
    expect(mb.triangleCount).toBe(2);
    expect(Array.from(m.mat).every((v) => v === MAT.print)).toBe(true);
    for (const n of normals(m)) {
      expect(n[0]).toBeCloseTo(0, 6);
      expect(n[1]).toBeCloseTo(-1, 6);
      expect(n[2]).toBeCloseTo(0, 6);
    }
    const b = bounds(m);
    expect(b.min[1]).toBeCloseTo(2.5, 6);
    expect(b.max[1]).toBeCloseTo(2.5, 6);
    expect(b.max[0]! - b.min[0]!).toBeCloseTo(w, 6);
    expect(b.max[2]! - b.min[2]!).toBeCloseTo(paperHeight(p, w), 6);
    const us = new Set(uvs(m).map((q) => q[0]!.toFixed(5)));
    const vs = new Set(uvs(m).map((q) => q[1]!.toFixed(5)));
    expect([...us].sort()).toEqual([uv.u0, uv.u1].map((v) => v.toFixed(5)).sort());
    expect([...vs].sort()).toEqual([uv.v0, uv.v1].map((v) => v.toFixed(5)).sort());
  });

  it('неизвестный лист — ошибка', () => {
    expect(() => mesh((xf) => xf.paper('нет_такого', 0, 0))).toThrow();
    expect(() => mesh((xf) => xf.paperCeil('нет_такого', 0, 0, 0))).toThrow();
  });
});

describe('реестр бумаги', () => {
  it('в реестре только то, что где-то стоит: щиты, ряды рам, рама с портретом и лист над кроватью', () => {
    const names = Object.keys(PAPER_PROPS);
    expect(names.sort()).toEqual(['ceil_faces', 'faces_wall', 'frame_face_big', 'frames_bonds', 'frames_faces', 'map_board', 'money_board', 'money_wall', 'notgeld_frame']);
    for (const n of names) expect(n, n).toMatch(/^[a-z0-9_]+$/);
  });
});

describe.each(Object.entries(PAPER_PROPS))('предмет %s', (_name, p) => {
  const build = (seed: number): MeshData => mesh((xf) => p.build(xf, seed));

  it('собирается, нет NaN, индексы целы', () => {
    for (const seed of SEEDS) {
      const m = build(seed);
      expect(m.index.length, `сид ${seed}`).toBeGreaterThan(0);
      expect(m.index.length % 3).toBe(0);
      const verts = m.position.length / 3;
      expect(m.index.every((i) => i < verts)).toBe(true);
      for (const arr of [m.position, m.normal, m.color, m.uv]) expect(arr.every((v) => Number.isFinite(v)), `сид ${seed}`).toBe(true);
    }
  });

  it('габариты в пределах заявленных w, d, h (допуск 3 см)', () => {
    for (const seed of SEEDS) {
      const { min, max } = bounds(build(seed));
      expect(min[0]!, `сид ${seed}: x min`).toBeGreaterThanOrEqual(-p.w / 2 - TOL);
      expect(max[0]!, `сид ${seed}: x max`).toBeLessThanOrEqual(p.w / 2 + TOL);
      expect(min[2]!, `сид ${seed}: z min`).toBeGreaterThanOrEqual(-TOL);
      expect(max[2]!, `сид ${seed}: z max`).toBeLessThanOrEqual(p.d + TOL);
      if (p.mount === 'ceiling') {
        expect(min[1]!, `сид ${seed}: y min`).toBeGreaterThanOrEqual(-p.h - TOL);
        expect(max[1]!, `сид ${seed}: y max`).toBeLessThanOrEqual(TOL);
      } else {
        expect(min[1]!, `сид ${seed}: y min`).toBeGreaterThanOrEqual(-TOL);
        expect(max[1]!, `сид ${seed}: y max`).toBeLessThanOrEqual(p.h + TOL);
      }
    }
  });

  it('есть вершины с MAT.print и u не меньше PAPER_U0', () => {
    for (const seed of SEEDS) {
      const m = build(seed);
      let n = 0;
      for (let i = 0; i < m.mat.length; i++) if (m.mat[i] === MAT.print && m.uv[i * 2]! >= PAPER_U0) n++;
      expect(n, `сид ${seed}`).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('состав предметов', () => {
  const layersOf = (m: MeshData): Set<number> => new Set(sheets(m).map((s) => Math.floor(s.u)));
  const keyOf = (s: { u: number; v: number }): string => `${s.u.toFixed(4)},${s.v.toFixed(4)}`;

  it('стена лиц — два разных листа портретов разной ширины; лист над кроватью — третий', () => {
    for (const seed of [0, 1, 2, 3, 7, 42, 1000, 20041113]) {
      const wall = layersOf(mesh((xf) => PAPER_PROPS.faces_wall!.build(xf, seed)));
      const ceil = layersOf(mesh((xf) => PAPER_PROPS.ceil_faces!.build(xf, seed)));
      expect(wall.size, `сид ${seed}`).toBe(2);
      expect(ceil.size, `сид ${seed}`).toBe(1);
      const all = new Set([...wall, ...ceil]);
      expect(all.size, `сид ${seed}: три разных листа`).toBe(3);
      for (const l of all) expect(PAPER_LAYERS[l - PAPER_U0]!, `сид ${seed}`).toMatch(/^faces_/);
    }
  });

  it('стена лиц: щиты разной высоты и на разной высоте — не два одинаковых прямоугольника встык', () => {
    const m = mesh((xf) => PAPER_PROPS.faces_wall!.build(xf, 0));
    const quads: { w: number; h: number; y: number }[] = [];
    const verts: number[] = [];
    for (let i = 0; i < m.mat.length; i++) if (m.mat[i] === MAT.print && m.uv[i * 2]! >= PAPER_U0) verts.push(i);
    for (let k = 0; k + 3 < verts.length; k += 4) {
      const xs = [0, 1, 2, 3].map((j) => m.position[verts[k + j]! * 3]!);
      const ys = [0, 1, 2, 3].map((j) => m.position[verts[k + j]! * 3 + 1]!);
      quads.push({ w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), y: Math.min(...ys) });
    }
    expect(quads.length).toBe(2);
    expect(Math.abs(quads[0]!.w - quads[1]!.w)).toBeGreaterThan(0.3);
    expect(Math.abs(quads[0]!.h - quads[1]!.h)).toBeGreaterThan(0.5);
    expect(Math.abs(quads[0]!.y - quads[1]!.y)).toBeGreaterThan(0.3);
  });

  it('frames_bonds: три разные акции с ленты, высокая с купонным листом — посередине', () => {
    const strip = PAPER_U0 + PAPER_LAYERS.indexOf('bonds');
    const tall = paperUv('bond_a');
    for (const seed of [0, 1, 2, 3, 7, 42, 1000, 20041113]) {
      const s3 = sheets(mesh((xf) => PAPER_PROPS.frames_bonds!.build(xf, seed)));
      expect(s3.length, `сид ${seed}`).toBe(3);
      expect(new Set(s3.map(keyOf)).size, `сид ${seed}`).toBe(3);
      for (const q of s3) expect(Math.floor(q.u), `сид ${seed}`).toBe(strip);
      expect(s3[1]!.u, `сид ${seed}`).toBeCloseTo(tall.u0, 5);
      expect(s3[1]!.v, `сид ${seed}`).toBeCloseTo(tall.v0, 5);
    }
  });

  it('money_wall не показывает один и тот же лист дважды', () => {
    for (const seed of [0, 1, 2, 3, 7, 42, 1000]) {
      const s = sheets(mesh((xf) => PAPER_PROPS.money_wall!.build(xf, seed)));
      expect(s.length, `сид ${seed}`).toBe(2);
      expect(new Set(s.map(keyOf)).size, `сид ${seed}`).toBe(2);
    }
  });
});

describe('расстановка по мирам', () => {
  const WORLDS: WorldKind[] = ['shelter', 'office', 'yellow', 'station'];
  const LEVEL_SEEDS = [20041113, 7, 1234];
  const RANKS: Rank[] = [1, 3];
  const NAMES = new Set([...Object.keys(PAPER_PROPS), ...Object.keys(LUGGAGE_PROPS)]);

  type Level = Omit<ReturnType<typeof buildLevel>, 'objects'> & { objects: LevelObject[] };
  const built = (seed: number, rank: Rank, world: WorldKind): Level => {
    const b = buildLevel(generateLayout(seed, rank, world));
    return { ...b, objects: b.objects ?? [] };
  };
  const cache = new Map<string, Level>();
  const level = (world: WorldKind, seed: number, rank: Rank): Level => {
    const k = `${world}/${seed}/${rank}`;
    let l = cache.get(k);
    if (!l) {
      l = built(seed, rank, world);
      cache.set(k, l);
    }
    return l;
  };
  const count = (l: Level, name: string): number => l.objects.filter((o) => o.name === name).length;

  const cases: [WorldKind, number, Rank][] = [];
  for (const w of WORLDS) for (const s of LEVEL_SEEDS) for (const r of RANKS) cases.push([w, s, r]);

  const wanted: Record<WorldKind, Record<string, [number, number]>> = {
    shelter: { faces_wall: [1, 1], frames_faces: [1, 1], money_wall: [0, 1], st_luggage_stack: [0, 1], map_board: [0, 0], st_luggage_wall: [0, 0] },
    office: { frames_bonds: [1, 1], money_board: [1, 1], notgeld_frame: [0, 1], money_wall: [0, 0] },
    yellow: { frame_face_big: [1, 1] },
    // В зале вещей почти нет: стена чемоданов в кладовой и одна карта — и больше ничего из этой пачки.
    station: { st_luggage_wall: [1, 1], map_board: [1, 1], st_luggage_stack: [0, 0], money_wall: [0, 0], money_board: [0, 0], notgeld_frame: [0, 0] },
  } as Record<WorldKind, Record<string, [number, number]>>;

  it.each(cases)('%s, сид %i, ранг %i: числа предметов', (world, seed, rank) => {
    const l = level(world, seed, rank);
    for (const [name, [lo, hi]] of Object.entries(wanted[world])) {
      const n = count(l, name);
      expect(n, `${name}: ${n}`).toBeGreaterThanOrEqual(lo);
      expect(n, `${name}: ${n}`).toBeLessThanOrEqual(hi);
    }
  });

  /** Листы, что висят целиком (не вырезки в рамах): по uv левого нижнего угла. */
  const WHOLE = PAPER_LIST.filter((p) => p.kind === 'faces' || p.kind === 'money' || p.kind === 'map').filter((p) => p.id !== 'map_lines');
  const wholeSheets = (l: Level): string[] => {
    const out: string[] = [];
    for (const c of l.chunks) {
      for (const q of sheets(c.mesh)) {
        const hit = WHOLE.find((p) => {
          const uv = paperUv(p.id);
          return Math.abs(uv.u0 - q.u) < 1e-4 && Math.abs(uv.v0 - q.v) < 1e-4;
        });
        if (hit) out.push(hit.id);
      }
    }
    return out;
  };

  it.each(cases)('%s, сид %i, ранг %i: один и тот же лист целиком не висит в мире дважды', (world, seed, rank) => {
    const list = wholeSheets(level(world, seed, rank));
    // В жёлтых комнатах целых листов нет: там одна вырезка в раме.
    if (world !== 'yellow') expect(list.length, 'листы на уровне есть').toBeGreaterThan(0);
    const twice = list.filter((id, i) => list.indexOf(id) !== i);
    expect(twice).toEqual([]);
  });

  it.each(LEVEL_SEEDS.flatMap((s) => RANKS.map((r) => [s, r] as const)))('убежище, сид %i, ранг %i: на стене лиц — два листа портретов, третий — только над кроватью', (seed, rank) => {
    const faces = wholeSheets(level('shelter', seed, rank)).filter((id) => id.startsWith('faces_'));
    expect(new Set(faces).size).toBe(faces.length);
    expect(faces).toContain('faces_a');
    expect(faces).toContain('faces_b');
    // Спальня есть не на каждом плане: без неё крупных карточек на уровне нет вовсе.
    expect(faces.length).toBeGreaterThanOrEqual(2);
  });

  /** Пары (предмет бумаги или багажа, другой объект), что пересекаются объёмом с запасом 2 см. */
  const overlapPairs = (l: Level): [LevelObject, LevelObject][] => {
    const pad = 0.02;
    const out: [LevelObject, LevelObject][] = [];
    for (const o of l.objects) {
      if (!NAMES.has(o.name)) continue;
      for (const q of l.objects) {
        if (q === o) continue;
        if (o.min[0] < q.max[0] - pad && o.max[0] > q.min[0] + pad && o.min[1] < q.max[1] - pad && o.max[1] > q.min[1] + pad && o.min[2] < q.max[2] - pad && o.max[2] > q.min[2] + pad) out.push([o, q]);
      }
    }
    return out;
  };

  it.each(cases)('%s, сид %i, ранг %i: предметы бумаги и багажа не пересекаются объёмом ни с одним другим объектом', (world, seed, rank) => {
    const bad = overlapPairs(level(world, seed, rank));
    expect(bad.map(([o, q]) => `${o.name} #${o.id} x ${q.name} #${q.id}`)).toEqual([]);
  });

  it.each(cases)('%s, сид %i, ранг %i: тот же сид — те же объекты на тех же местах', (world, seed, rank) => {
    const a = level(world, seed, rank);
    const b = built(seed, rank, world);
    const brief = (l: Level) => l.objects.map((o) => ({ name: o.name, min: o.min, max: o.max }));
    expect(brief(b)).toEqual(brief(a));
  });

  it.each(LEVEL_SEEDS.flatMap((s) => RANKS.map((r) => [s, r] as const)))('зал ожидания, сид %i, ранг %i: стена чемоданов в кладовой, без одиночных чемоданов', (seed, rank) => {
    const layout = generateLayout(seed, rank, 'station');
    const l = level('station', seed, rank);
    const roomOf = (o: { min: readonly number[]; max: readonly number[] }): number => {
      const x = (o.min[0]! + o.max[0]!) / 2;
      const z = (o.min[2]! + o.max[2]!) / 2;
      let best = l.nav[0]!;
      let bd = Infinity;
      for (const n of l.nav) {
        const d = (n.x - x) ** 2 + (n.z - z) ** 2;
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
      return best.room;
    };
    const walls = l.objects.filter((o) => o.name === 'st_luggage_wall');
    expect(walls.length).toBe(1);
    const room = roomOf(walls[0]!);
    expect(layout.rooms.find((r) => r.id === room)!.type).toBe('storage');
    const cases = l.objects.filter((o) => o.name === 'st_suitcase' && roomOf(o) === room);
    expect(cases.length, 'одиночных чемоданов в кладовой').toBe(0);
  });
});

describe('шейдер знает про бумагу', () => {
  it('uPapers и проверка vUv.x >= 2.0; PAPER_U0 === 2', () => {
    expect(WORLD_FRAG).toContain('uPapers');
    expect(WORLD_FRAG).toContain('vUv.x >= 2.0');
    expect(PAPER_U0).toBe(2);
  });

  it('лица не сохраняются: у слоёв портретов (номер меньше PAPER_FACES) резкость зависит от расстояния и от маски в альфе', () => {
    // Граница в шейдере — половина между последним слоем портретов и первым прочим.
    expect(WORLD_FRAG).toContain(`lay < ${(PAPER_FACES - 0.5).toFixed(1)}`);
    expect(WORLD_FRAG).toMatch(/nearP = 1\.0 - smoothstep\([0-9.]+, [0-9.]+, length\(vPosV\)\)/);
    expect(WORLD_FRAG).toContain('soft.a');
  });
});
