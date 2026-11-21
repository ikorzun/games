/**
 * Мебель игры — моделями полки Sand3D (world/furniture.ts; партнёр 18.11: «замени всю мебель на новую самостоятельно»).
 * Здесь модели подключены (как в игре после загрузки куска): проверяется то, что видит игрок, а не серые коробки.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types';
import { generateLayout } from '../src/gen/layout';
import type { WorldKind } from '../src/gen/layout';
import { ColliderSet } from '../src/world/colliders';
import { FURNITURE_FROM, furnished, jitter, openOf, pickOf, recordS3, s3Bounds, s3Parts, s3Put, s3Reach, s3Size, S3_BED, S3_SEAT, S3_SHELVES, S3_TOP, S3_WORKTOP, withOpenMode } from '../src/world/furniture';
import { BURIED, roomOpenness } from '../src/world/furnish';
import type { BuiltLevel } from '../src/world/level';
import type { LevelObject } from '../src/world/objects';
import { PLACED_OPEN } from '../src/world/placed';
import type { PlacedOpen, PlacedSpec } from '../src/world/placed';
import { placedSeed, reachOf, roomDoors, throatBox, worldBox } from '../src/world/placed_place';
import type { PlacedSpot } from '../src/world/placed_place';
import { MeshBuilder } from '../src/world/kit';
import type { MeshData } from '../src/world/kit';
import { buildLevel, cellToWorld, tierFloor } from '../src/world/level_build';
import { CELL } from '../src/world/shell';
import { decodeModel, placeModel, registerModels } from '../src/world/models';
import { Xf } from '../src/world/props';
import { ALL_PROPS } from '../src/world/props_all';
import type { PropSpec } from '../src/world/props_more';
import { benchSeat, WALL_BENCHES } from '../src/world/props_station';
import { SAND3D_DATA } from '../src/world/sand3d_data';
import { SAND3D_META } from '../src/world/sand3d_meta';

beforeAll(() => registerModels(SAND3D_DATA));

/** Вещи игры, которые с 18.11 строятся моделями полки (простые и составные). */
const REFURNISHED = Object.keys(FURNITURE_FROM);

function build(p: PropSpec, seed: number, rot: 0 | 1 | 2 | 3 = 0): { mesh: MeshData; col: ColliderSet; tris: number } {
  const mb = new MeshBuilder();
  const col = new ColliderSet();
  p.build(new Xf(mb, col, 0, 0, 0, rot), seed);
  return { mesh: mb.build(), col, tris: mb.triangleCount };
}

function bounds(m: MeshData): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.position.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, m.position[i + k]!);
      max[k] = Math.max(max[k]!, m.position[i + k]!);
    }
  }
  return { min, max };
}

/** Площадь поверхностей модели, смотрящих вверх, на высоте y ± tol (м²) — в пределах x0…x1 (если заданы). */
function upArea(name: string, y: number, tol = 0.012, x0 = -Infinity, x1 = Infinity): number {
  const m = decodeModel(name);
  const p = m.position;
  let area = 0;
  for (let t = 0; t < m.index.length; t += 3) {
    const [a, b, c] = [m.index[t]! * 3, m.index[t + 1]! * 3, m.index[t + 2]! * 3];
    const u: Vec3 = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!];
    const v: Vec3 = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
    const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len === 0 || n[1] / len < 0.92) continue;
    const cy = (p[a + 1]! + p[b + 1]! + p[c + 1]!) / 3;
    // Доска часто — два больших треугольника во всю ширину: годится треугольник, захватывающий отрезок x0…x1.
    const lo = Math.min(p[a]!, p[b]!, p[c]!);
    const hi = Math.max(p[a]!, p[b]!, p[c]!);
    if (Math.abs(cy - y) <= tol && hi > x0 && lo < x1) area += len / 2;
  }
  return area;
}

describe('мебель полки: что знают о моделях те, кто на них кладёт', () => {
  it('столешницы, сиденья и лежанки — настоящие поверхности моделей (машинка и записка не висят в воздухе)', () => {
    for (const [name, y] of [...Object.entries(S3_TOP), ...Object.entries(S3_WORKTOP), ...Object.entries(S3_SEAT), ...Object.entries(S3_BED)]) {
      expect(name in SAND3D_META, name).toBe(true);
      expect(upArea(name, y), `${name} на ${y}`).toBeGreaterThan(0.1);
    }
  });

  it('полки шкафов и стеллажей — доски моделей; пролёт до следующей доски не меньше заявленного', () => {
    for (const [name, shelves] of Object.entries(S3_SHELVES)) {
      const g = s3Size(name);
      const topmost = Math.max(...shelves.map((s) => s.y));
      for (const s of shelves) {
        expect(upArea(name, s.y, 0.015, s.x0, s.x1), `${name}: полка ${s.y}`).toBeGreaterThan(0.05);
        expect(s.x0).toBeGreaterThanOrEqual(-g.w / 2);
        expect(s.x1).toBeLessThanOrEqual(g.w / 2);
        expect(s.z1).toBeLessThanOrEqual(g.d);
        // Пролёт кончается доской выше; верхняя полка стеллажа открыта — на ней можно и выше стоек.
        if (s.y < topmost) expect(s.y + s.clear, `${name}: полка ${s.y}`).toBeLessThanOrEqual(g.h + 0.01);
        expect(upArea(name, s.y + s.clear + 0.03, 0.03, s.x0, s.x1) === 0 || s.y + s.clear <= g.h, `${name}: над полкой ${s.y}`).toBe(true);
      }
    }
  });

  it('опрокинутая модель ложится на пол у начала координат: габарит — (w, d, h) вместо (w, h, d)', () => {
    for (const name of ['s3_chair_ladder', 's3_table_work', 's3_stool_wood']) {
      const mb = new MeshBuilder();
      s3Put(new Xf(mb, null, 0, 0, 0), name, { tip: true });
      const b = bounds(mb.build());
      const [lo, hi] = s3Bounds(name, true);
      for (let k = 0; k < 3; k++) {
        expect(b.min[k]!, `${name} min ${k}`).toBeGreaterThan(lo[k]! - 0.01);
        expect(b.max[k]!, `${name} max ${k}`).toBeLessThan(hi[k]! + 0.01);
      }
      expect(b.min[1]!).toBeCloseTo(0, 2);
      expect(b.min[2]!).toBeCloseTo(0, 2);
    }
  });

  it('варианты: жребий по сиду постоянен и за сотню сидов выпадает каждый; тон гуляет, но немного', () => {
    const list = ['a', 'b', 'c'] as const;
    const seen = new Set<string>();
    for (let s = 0; s < 100; s++) {
      expect(pickOf(list, s)).toBe(pickOf(list, s));
      seen.add(pickOf(list, s));
      const t = jitter(s);
      for (const v of t) expect(Math.abs(v - 1)).toBeLessThan(0.1);
    }
    expect(seen.size).toBe(3);
    const spec = furnished('floor', ['s3_sofa_olive', 's3_sofa_grey'], 'диван');
    expect(spec.w).toBe(Math.max(s3Size('s3_sofa_olive').w, s3Size('s3_sofa_grey').w));
  });

  it('скамья вокзала: высота сиденья для места вещи — от той скамьи, что поставит сид; в рядах изредка чужая скамья', () => {
    const rows = new Set<number>();
    for (let s = 0; s < 200; s++) {
      expect(benchSeat('st_seats', s)).toBe(S3_SEAT[pickOf(WALL_BENCHES, s)]);
      rows.add(benchSeat('st_seats_double', s));
    }
    expect([...rows].sort()).toEqual([S3_SEAT.s3_bench_wood!, S3_SEAT.s3_bench_blue!].sort());
  });
});

describe.each(REFURNISHED.map((n) => [n] as const))('%s — моделью полки', (name) => {
  const p = ALL_PROPS[name]!;

  it('строится из моделей полки: треугольников больше, чем у коробок, всё конечно, есть преграда', () => {
    for (const seed of [1, 2, 3, 77, 1000]) {
      const b = build(p, seed);
      expect(b.tris, `сид ${seed}`).toBeGreaterThan(100);
      expect(b.tris, `сид ${seed}`).toBeLessThan(25000);
      for (const arr of [b.mesh.position, b.mesh.normal, b.mesh.color]) expect(arr.every((v) => Number.isFinite(v))).toBe(true);
      expect(b.col.boxes.length, `сид ${seed}`).toBeGreaterThan(0);
    }
  });

  it('ставит ровно те модели полки, что записаны в описи FURNITURE_FROM (за сотню сидов — каждую)', () => {
    const used = new Set<string>();
    for (let seed = 0; seed < 100; seed++) for (const n of recordS3(() => build(p, seed))) used.add(n);
    expect([...used].sort()).toEqual([...FURNITURE_FROM[name]!].sort());
  });

  it('не вылезает за свой габарит (по нему вещь ставится к стене и обходится)', () => {
    const tol = 0.035;
    for (const seed of [1, 2, 3, 77, 1000]) {
      const { min, max } = bounds(build(p, seed).mesh);
      const z0 = p.mount === 'free' ? -p.d / 2 : 0;
      expect(min[0], `${name}/${seed} x`).toBeGreaterThan(-p.w / 2 - tol);
      expect(max[0], `${name}/${seed} x`).toBeLessThan(p.w / 2 + tol);
      expect(min[1], `${name}/${seed} y`).toBeGreaterThan(-tol);
      expect(max[1], `${name}/${seed} y`).toBeLessThan(p.h + tol);
      expect(min[2], `${name}/${seed} z`).toBeGreaterThan(z0 - tol);
      expect(max[2], `${name}/${seed} z`).toBeLessThan(z0 + p.d + (p.reach ?? 0) + tol);
    }
  });
});

describe('места с мебелью полки собираются', () => {
  const WORLDS: readonly WorldKind[] = ['shelter', 'office', 'yellow', 'station'];
  const levels = new Map<WorldKind, ReturnType<typeof buildLevel>>();
  const level = (w: WorldKind): ReturnType<typeof buildLevel> => {
    let l = levels.get(w);
    if (!l) levels.set(w, (l = buildLevel(generateLayout(20041113, 2, w), { wear: 0, figures: [], placed: [] })));
    return l;
  };

  it.each(WORLDS)('%s: геометрия конечна, треугольников в меру, мебель — предметы уровня', (w) => {
    const l = level(w);
    let tris = 0;
    for (const ch of l.chunks) {
      tris += ch.mesh.index.length / 3;
      expect(ch.mesh.position.every((v) => Number.isFinite(v))).toBe(true);
      expect(ch.mesh.index.length / 3).toBeLessThan(60000);
    }
    expect(tris).toBeLessThan(900000);
    const names = new Set((l.objects ?? []).map((o) => o.name));
    const furniture = REFURNISHED.filter((n) => names.has(n)).length + [...names].filter((n) => n.startsWith('s3_')).length;
    expect(furniture, `${w}: мебели полки на уровне`).toBeGreaterThan(0);
  });

  it('мебель не выходит за стены своего помещения: все четыре угла вещи — в клетках того же помещения', () => {
    for (const w of WORLDS) {
      const l = level(w);
      const layout = l.layout!;
      const roomAt = new Map<string, number>();
      for (const r of layout.rooms) for (const [cx, cz] of r.cells) roomAt.set(`${r.tier}:${cx}:${cz}`, r.id);
      const cellOf = (v: number): number => Math.round(v / CELL - cellToWorld(0) / CELL);
      let checked = 0;
      for (const o of l.objects ?? []) {
        const tier = [0, 1, 2].find((t) => Math.abs(tierFloor(t) - o.at[1]) < 0.3);
        if (tier === undefined) continue;
        const room = roomAt.get(`${tier}:${cellOf(o.at[0])}:${cellOf(o.at[2])}`);
        if (room === undefined) continue;
        const e = 0.05;
        for (const [x, z] of [[o.min[0] + e, o.min[2] + e], [o.max[0] - e, o.min[2] + e], [o.min[0] + e, o.max[2] - e], [o.max[0] - e, o.max[2] - e]] as const) {
          expect(roomAt.get(`${tier}:${cellOf(x)}:${cellOf(z)}`), `${w}: ${o.name} в помещении ${room}, угол ${x.toFixed(2)}, ${z.toFixed(2)}`).toBe(room);
        }
        checked++;
      }
      expect(checked, w).toBeGreaterThan(20);
    }
  });

  it('вещь на столе, скамье или полке лежит на поверхности: под местом в пределах 3 см — грань, смотрящая вверх', () => {
    for (const w of WORLDS) {
      const l = level(w);
      const boxes = l.chunks.map((ch) => bounds(ch.mesh));
      let checked = 0;
      for (const s0 of l.spots.filter((k) => k.kind !== 'floor')) {
        // Луч вниз от места и от четырёх точек в 4 см вокруг (вещь шире щели между рейками скамьи): ближайшая грань под ним.
        let best = Infinity;
        for (const [ox, oz] of [[0, 0], [0.04, 0], [-0.04, 0], [0, 0.04], [0, -0.04]] as const) {
        const s = { ...s0, x: s0.x + ox, z: s0.z + oz };
        l.chunks.forEach((ch, ci) => {
          const b = boxes[ci]!;
          if (s.x < b.min[0] || s.x > b.max[0] || s.z < b.min[2] || s.z > b.max[2]) return;
          const m = ch.mesh;
          const P = m.position;
          for (let t = 0; t < m.index.length; t += 3) {
            const a = m.index[t]! * 3;
            const bb = m.index[t + 1]! * 3;
            const c = m.index[t + 2]! * 3;
            const ax = P[a]!, az = P[a + 2]!, bx = P[bb]!, bz = P[bb + 2]!, cx = P[c]!, cz = P[c + 2]!;
            const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
            if (Math.abs(d) < 1e-12) continue;
            const l1 = ((bz - cz) * (s.x - cx) + (cx - bx) * (s.z - cz)) / d;
            const l2 = ((cz - az) * (s.x - cx) + (ax - cx) * (s.z - cz)) / d;
            const l3 = 1 - l1 - l2;
            if (l1 < 0 || l2 < 0 || l3 < 0) continue;
            const y = l1 * P[a + 1]! + l2 * P[bb + 1]! + l3 * P[c + 1]!;
            const gap = s.y - y;
            if (gap > -0.012 && gap < best) best = gap;
          }
        });
        }
        expect(best, `${w}: место ${s0.kind} ${s0.x.toFixed(2)}, ${s0.y.toFixed(3)}, ${s0.z.toFixed(2)}`).toBeLessThan(0.03);
        checked++;
      }
      expect(checked, w).toBeGreaterThan(0);
    }
  });
});

/** Модель полки сама по себе (без вещи игры), с дверцами и ящиками, открытыми на долю open. */
function modelMesh(name: string, open?: readonly number[]): MeshData {
  const mb = new MeshBuilder();
  placeModel(new Xf(mb, null, 0, 0, 0), name, open ? { open } : {});
  return mb.build();
}

describe('дверцы и ящики (партнёр 18.11, 12:32: «открой дверцы и ящики у шкафов»)', () => {
  const jointed = Object.keys(SAND3D_META).filter((n) => s3Parts(n).length > 0);

  it('у шкафов, картотеки, столов с тумбой, мини-кухни и сейфа есть подвижные детали; у каждой — свой шарнир и свои вершины', () => {
    for (const n of ['s3_wardrobe_plain', 's3_filing_cabinet', 's3_locker_olive', 's3_cabinet_medical', 's3_desk_office', 's3_desk_green', 's3_kitchenette', 's3_safe_old']) {
      expect(s3Parts(n).length, n).toBeGreaterThan(0);
    }
    for (const n of jointed) {
      const m = decodeModel(n);
      expect(m.joints?.length, n).toBe(s3Parts(n).length);
      expect(m.part?.length, n).toBe(m.position.length / 3);
      for (let k = 1; k <= m.joints!.length; k++) expect(m.part!.includes(k), `${n}: деталь ${k}`).toBe(true);
    }
  });

  it('закрыто — та же сетка, что и без открытия; открыто до предела — детали сдвинулись, всё в габарите «открыто» описи, перед стеной и над полом', () => {
    for (const n of jointed) {
      const plain = modelMesh(n);
      expect(Array.from(modelMesh(n, s3Parts(n).map(() => 0)).position), n).toEqual(Array.from(plain.position));
      const open = modelMesh(n, s3Parts(n).map(() => 1));
      const o = SAND3D_META[n]!.open!;
      let moved = 0;
      for (let i = 0; i < open.position.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          expect(open.position[i + k]!, `${n} ${k}`).toBeGreaterThanOrEqual(o.min[k]! - 1e-3);
          expect(open.position[i + k]!, `${n} ${k}`).toBeLessThanOrEqual(o.max[k]! + 1e-3);
        }
        const d = Math.hypot(open.position[i]! - plain.position[i]!, open.position[i + 1]! - plain.position[i + 1]!, open.position[i + 2]! - plain.position[i + 2]!);
        if (d > 0.03) moved += 1;
      }
      expect(moved, n).toBeGreaterThan(0);
      expect(o.min[1], n).toBeGreaterThanOrEqual(-1e-3);
      if (SAND3D_META[n]!.mount === 'floor') expect(o.min[2], n).toBeGreaterThanOrEqual(-1e-3);
    }
  });

  it('открытое выходит вперёд не дальше 0,35 м (платяной шкаф — 0,55) и не шире корпуса', () => {
    for (const n of jointed) {
      expect(s3Reach(n), n).toBeLessThanOrEqual(n === 's3_wardrobe_plain' ? 0.56 : 0.36);
      expect(s3Size(n, true).w, n).toBe(s3Size(n).w);
    }
  });

  it('у открытой детали своя преграда — от пола до её верха; у закрытой вещи преграда одна', () => {
    for (const n of jointed) {
      const one = new ColliderSet();
      s3Put(new Xf(new MeshBuilder(), one, 0, 0, 0), n);
      expect(one.boxes.length, n).toBe(1);
      const col = new ColliderSet();
      s3Put(new Xf(new MeshBuilder(), col, 0, 0, 0), n, { open: s3Parts(n).map(() => 1) });
      expect(col.boxes.length, n).toBe(1 + s3Parts(n).length);
      for (const b of col.boxes) expect(b.minY, n).toBeCloseTo(0, 5);
    }
  });

  it('по сиду: у трёх из четырёх что-то открыто, доли от 0 до 1; у одного сида — одно и то же', () => {
    const N = 400;
    let some = 0;
    for (let seed = 0; seed < N; seed++) {
      const o = openOf('s3_filing_cabinet', seed);
      expect(openOf('s3_filing_cabinet', seed)).toEqual(o);
      if (!o) continue;
      some += 1;
      for (const v of o) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(o.some((v) => v > 0)).toBe(true);
    }
    expect(some / N).toBeGreaterThan(0.65);
    expect(some / N).toBeLessThan(0.85);
    expect(openOf('s3_sofa_grey', 1)).toBeUndefined();
  });

  it('вещи игры открываются: шкаф, картотека, офисный стол, мини-кухня; вылет — в reach, раскладка — по закрытому габариту', () => {
    for (const name of ['wardrobe', 'filing_cabinet', 'office_desk', 'kitchenette', 's3_locker_olive', 's3_cabinet_medical', 's3_desk_green']) {
      const p = ALL_PROPS[name]!;
      expect(p.reach ?? 0, name).toBeGreaterThan(0.1);
      let opened = 0;
      for (let seed = 0; seed < 40; seed++) {
        const col = new ColliderSet();
        p.build(new Xf(new MeshBuilder(), col, 0, 0, 0), seed);
        const base = recordS3(() => p.build(new Xf(new MeshBuilder(), new ColliderSet(), 0, 0, 0), seed));
        if (base.size > 0 && col.boxes.length > 1 + (name === 'kitchenette' ? 0 : 0)) opened += 1;
      }
      expect(opened, name).toBeGreaterThan(5);
    }
  });
});

describe('как оставили помещение: открытость — от комнаты, а не от вещи', () => {
  it('прибранная комната — всё закрыто; брошенная — открыто почти всё; без комнаты — три из четырёх', async () => {
    const { withOpenness } = await import('../src/world/furniture');
    const share = (k: number): number => {
      let some = 0;
      for (let seed = 0; seed < 400; seed++) if (openOf('s3_filing_cabinet', seed)) some += 1;
      return some / 400 + k * 0;
    };
    expect(withOpenness(0, () => share(0))).toBe(0);
    expect(withOpenness(0.95, () => share(0))).toBeGreaterThan(0.9);
    expect(share(0)).toBeGreaterThan(0.65);
    expect(share(0)).toBeLessThan(0.85);
  });

  it('в жёлтых комнатах закрыто всё, в офисе и убежище есть и открытое, и закрытое', () => {
    for (const w of ['yellow', 'office', 'shelter'] as const) {
      let opened = 0;
      let shut = 0;
      for (const seed of [11, 42, 7]) {
        const lvl = buildLevel(generateLayout(seed, 1, w), { wear: 0, figures: [] });
        // Преград у вещи: закрытая — одна (корпус), у открытой — ещё по одной на дверцу или ящик.
        const boxes = new Map<number, number>();
        for (const b of lvl.colliders.boxes) if (b.owner) boxes.set(b.owner, (boxes.get(b.owner) ?? 0) + 1);
        for (const o of lvl.objects ?? []) {
          if (!ALL_PROPS[o.name]?.reach || o.flat) continue;
          if ((boxes.get(o.id) ?? 0) > 1) opened += 1;
          else shut += 1;
        }
      }
      if (w === 'yellow') expect(opened, w).toBe(0);
      else {
        expect(opened, w).toBeGreaterThan(0);
        expect(shut, w).toBeGreaterThan(0);
      }
    }
  });
});

describe('дверцы у вещей партнёра (квиз 18.11: «как выпадет» + переключатель)', () => {
  const ID = 'pl_cab';
  const CAB = 's3_filing_cabinet';
  const cab = (open?: PlacedOpen, over: Partial<PlacedSpec> = {}): PlacedSpec => ({
    id: ID,
    name: 'картотека у стены',
    prop: 'filing_cabinet',
    rule: { worlds: ['office'], rooms: [], anchor: 'wall', facing: 'room', lift: 0, count: 1 },
    turn: 0,
    offset: [0, -0.25],
    ...(open ? { open } : {}),
    ...over,
  });
  const level = (placed: PlacedSpec[], seed: number): BuiltLevel => buildLevel(generateLayout(seed, 2, 'office'), { wear: 0, figures: [], placed, removed: [], keepPlaceWorld: true });
  /** Преград у объекта: закрытая вещь — одна (корпус), у открытой — ещё по одной на выдвинутый ящик. */
  const boxesOf = (lvl: BuiltLevel, id: number): number => lvl.colliders.boxes.filter((b) => b.owner === id).length;
  const objAt = (lvl: BuiltLevel, s: PlacedSpot): LevelObject | undefined => lvl.objects?.find((o) => o.name === s.prop && Math.hypot(o.at[0] - s.at[0], o.at[2] - s.at[2]) < 0.01);

  it('доля 1 — открыто всё, доля 0 — закрыто всё; переключатель записи сильнее доли помещения', async () => {
    const { withOpenness } = await import('../src/world/furniture');
    for (const n of ['s3_wardrobe_plain', CAB, 's3_kitchenette', 's3_desk_office']) {
      for (let seed = 0; seed < 40; seed++) {
        const all = withOpenness(1, () => openOf(n, seed));
        expect(all?.length, n).toBe(s3Parts(n).length);
        expect(all!.every((v) => v >= 0.4 && v <= 1), n).toBe(true);
        expect(withOpenness(0, () => openOf(n, seed)), n).toBeUndefined();
        expect(withOpenness(0, () => withOpenMode('open', () => openOf(n, seed)))).toEqual(all);
        expect(withOpenness(0.95, () => withOpenMode('shut', () => openOf(n, seed)))).toBeUndefined();
        expect(withOpenMode(undefined, () => openOf(n, seed), 0)).toBeUndefined();
      }
    }
  });

  it('закрыто — одна преграда; открыто — все ящики выдвинуты и не выходят из коробки, по которой ей искалось место', () => {
    const p = ALL_PROPS.filing_cabinet!;
    let n = 0;
    for (const seed of [20041113, 7, 42, 1234]) {
      const shut = level([cab('shut')], seed);
      const open = level([cab('open')], seed);
      const s0 = shut.placed?.[0];
      const s1 = open.placed?.[0];
      if (!s0 || !s1) continue;
      n += 1;
      expect(boxesOf(shut, objAt(shut, s0)!.id), `${seed}`).toBe(1);
      const o = objAt(open, s1)!;
      expect(boxesOf(open, o.id), `${seed}`).toBe(1 + s3Parts(CAB).length);
      const box = worldBox(p, s1.at, s1.rot, reachOf(p, 'open'));
      expect(o.min[0]).toBeGreaterThan(box.minX - 0.02);
      expect(o.max[0]).toBeLessThan(box.maxX + 0.02);
      expect(o.min[2]).toBeGreaterThan(box.minZ - 0.02);
      expect(o.max[2]).toBeLessThan(box.maxZ + 0.02);
    }
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it('как выпадет — как у вещей игры в том же помещении: прибранное — закрыто, брошенное — открыто; где тесно — закрыто', () => {
    const shares = new Set<number>();
    let n = 0;
    for (const seed of [20041113, 7, 42, 1234, 5, 11, 99, 2024, 31, 77]) {
      const lvl = level([cab()], seed);
      const s = lvl.placed?.[0];
      if (!s) continue;
      n += 1;
      const share = roomOpenness('office', lvl.layout!.seed, s.room);
      shares.add(share);
      expect(s.open === undefined || s.open === 'shut').toBe(true);
      const want = s.open === 'shut' ? undefined : withOpenMode(undefined, () => openOf(CAB, placedSeed(lvl.layout!.seed, 0, ID)), share);
      expect(boxesOf(lvl, objAt(lvl, s)!.id) > 1, `${seed}: доля ${share}`).toBe(want !== undefined);
    }
    expect(n).toBeGreaterThanOrEqual(8);
    expect(shares.size, 'помещения оставлены по-разному').toBeGreaterThan(1);
  });

  it('открытые ящики вещи партнёра не заходят в горло двери и не выходят за коробку, по которой ей искалось место', () => {
    const p = ALL_PROPS.filing_cabinet!;
    let opened = 0;
    for (const open of [undefined, 'open'] as const) {
      for (const seed of [20041113, 7, 42, 1234, 5, 11, 99, 2024]) {
        const lvl = level([cab(open, { rule: { worlds: ['office'], rooms: [], anchor: 'wall', facing: 'room', lift: 0, count: 3 } })], seed);
        const w = lvl.placeWorld!;
        for (const s of lvl.placed ?? []) {
          const o = objAt(lvl, s)!;
          if (boxesOf(lvl, o.id) === 1) continue;
          opened += 1;
          const room = lvl.layout!.rooms[s.room]!;
          const box = worldBox(p, s.at, s.rot, p.reach);
          expect(o.min[0] > box.minX - 0.02 && o.max[0] < box.maxX + 0.02 && o.min[2] > box.minZ - 0.02 && o.max[2] < box.maxZ + 0.02, `${seed}`).toBe(true);
          for (const d of roomDoors(room, w)) {
            const t = throatBox(d, s.at[1]);
            const inside = o.min[0] < t.maxX - 0.02 && o.max[0] > t.minX + 0.02 && o.min[2] < t.maxZ - 0.02 && o.max[2] > t.minZ + 0.02;
            expect(inside, `${seed}: ${JSON.stringify(s)}`).toBe(false);
          }
        }
      }
    }
    expect(opened).toBeGreaterThan(5);
  });

  it('замена «везде» и передвинутая слушаются переключателя', () => {
    for (const open of PLACED_OPEN) {
      const lvl = level([cab(open, { id: 'pl_swap', replaces: 'filing_cabinet', everywhere: true })], 7);
      const cabs = (lvl.objects ?? []).filter((o) => o.name === 'filing_cabinet' && !o.flat);
      expect(cabs.length, open).toBeGreaterThan(2);
      for (const o of cabs) expect(boxesOf(lvl, o.id) > 1, open).toBe(open === 'open');
      const moved = level([cab(open, { id: 'pl_move', moves: { thing: 'filing_cabinet', nth: 0 } })], 7);
      const spots = (moved.placed ?? []).filter((s) => s.moved);
      expect(spots.length, open).toBeGreaterThan(0);
      for (const s of spots) expect(boxesOf(moved, objAt(moved, s)!.id) > 1, open).toBe(open === 'open');
    }
  });
});

describe('вещь не лежит внутри преграды (CI 18.11: фотография на нижней койке нар)', () => {
  it('у нар и кроватей сплошное — только до лежанки, выше — спинки у торцов; вещь на нижней койке видна спереди', () => {
    for (const [name, bed] of Object.entries(S3_BED)) {
      const col = new ColliderSet();
      s3Put(new Xf(new MeshBuilder(), col, 0, 0, 0), name);
      const g = s3Size(name);
      expect(col.boxes.length, name).toBe(3);
      for (const b of col.boxes) expect(b.minY, name).toBeCloseTo(0, 5);
      expect(Math.min(...col.boxes.map((b) => b.maxY)), name).toBeCloseTo(bed, 5);
      expect(Math.max(...col.boxes.map((b) => b.maxY)), name).toBeCloseTo(g.h, 5);
      // Глаз стоящего в двух метрах перед кроватью — до вещи на лежанке (середина глубины, чуть выше матраса) ничего нет.
      const to: Vec3 = [0.3, bed + 0.2, 0.42];
      const eye: Vec3 = [0.1, 1.55, g.d + 2];
      const d = Math.hypot(to[0] - eye[0], to[1] - eye[1], to[2] - eye[2]);
      const hit = col.raycast(eye[0], eye[1], eye[2], (to[0] - eye[0]) / d, (to[1] - eye[1]) / d, (to[2] - eye[2]) / d, d);
      expect(hit, name).toBeGreaterThan(d - 0.05);
    }
  });

  it('места для вещей во всех четырёх местах: на полу — вне преград, на сиденье, полке, стойке — не глубже края коробки', () => {
    for (const w of ['shelter', 'office', 'yellow', 'station'] as const) {
      for (const seed of [20041113, 7, 42]) {
        const lvl = buildLevel(generateLayout(seed, 2, w), { wear: 0, figures: [] });
        expect(lvl.spots.length, w).toBeGreaterThan(10);
        for (const s of lvl.spots) {
          const y = s.y + 0.06;
          for (const b of lvl.colliders.boxes) {
            if (b.off || b.gone || y <= b.minY || y >= b.maxY) continue;
            const depth = Math.min(s.x - b.minX, b.maxX - s.x, s.z - b.minZ, b.maxZ - s.z);
            expect(depth, `${w} ${seed}: ${s.kind} ${[s.x, s.y, s.z].map((v) => v.toFixed(2)).join(', ')}`).toBeLessThanOrEqual(s.kind === 'floor' ? 0 : BURIED);
          }
        }
      }
    }
  });
});

