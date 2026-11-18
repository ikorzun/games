/**
 * Мебель игры — моделями полки Sand3D (world/furniture.ts; партнёр 18.11: «замени всю мебель на новую самостоятельно»).
 * Здесь модели подключены (как в игре после загрузки куска): проверяется то, что видит игрок, а не серые коробки.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types';
import { generateLayout } from '../src/gen/layout';
import type { WorldKind } from '../src/gen/layout';
import { ColliderSet } from '../src/world/colliders';
import { FURNITURE_FROM, furnished, jitter, pickOf, recordS3, s3Bounds, s3Put, s3Size, S3_BED, S3_SEAT, S3_SHELVES, S3_TOP } from '../src/world/furniture';
import { MeshBuilder } from '../src/world/kit';
import type { MeshData } from '../src/world/kit';
import { buildLevel, cellToWorld, tierFloor } from '../src/world/level_build';
import { CELL } from '../src/world/shell';
import { decodeModel, registerModels } from '../src/world/models';
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
    for (const [name, y] of [...Object.entries(S3_TOP), ...Object.entries(S3_SEAT), ...Object.entries(S3_BED)]) {
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

  it('скамья вокзала: высота сиденья для места вещи — от той скамьи, что поставит сид', () => {
    for (let s = 0; s < 40; s++) {
      expect(benchSeat('st_seats', s)).toBe(S3_SEAT[pickOf(WALL_BENCHES, s)]);
      expect(benchSeat('st_seats_double', s)).toBe(S3_SEAT.s3_bench_wood);
    }
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
      expect(max[2], `${name}/${seed} z`).toBeLessThan(z0 + p.d + tol);
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
      for (const s of l.spots.filter((k) => k.kind !== 'floor')) {
        // Луч вниз от места: ближайшая грань под ним (смотрящая вверх).
        let best = Infinity;
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
        expect(best, `${w}: место ${s.kind} ${s.x.toFixed(2)}, ${s.y.toFixed(3)}, ${s.z.toFixed(2)}`).toBeLessThan(0.03);
        checked++;
      }
      expect(checked, w).toBeGreaterThan(0);
    }
  });
});
