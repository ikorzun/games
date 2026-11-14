/**
 * Точки на поверхностях: из них рендер собирает мир, как 3D-скан собирает сцену из сплатов.
 *
 * У каждой точки есть место на поверхности (где она стоит, когда поверхность «собрана») и свои
 * случайные числа (куда и как она отлетает, когда взгляд ушёл). Здесь точки только сеются: чистый TS,
 * без three.js, одинаково от запуска к запуску — уровень собирается и в тестах, и в Worker.
 *
 * Точки ложатся ровно, но без рисунка — «синим шумом»: соседи держат дистанцию, а рядов и клеток нет.
 * Случайный посев даёт сгустки и дыры (на стене это читается как шум), решётка — заметные ряды.
 * Синий шум берётся из плитки: 4096 точек в квадрате, расставленных так, что каждая следующая встаёт
 * в самое свободное место. Плитка замощает плоскость стены в мировых координатах, поэтому рисунок
 * точек на стене один и не зависит от того, из каких треугольников она собрана и как разрезана.
 *
 * «Очередь» точки (rank, 0…1) — её номер в плитке. Чем он меньше, тем раньше точка появляется: любая
 * доля плотности — это начало плитки, то есть тоже ровное покрытие. Поэтому облако одинаково
 * аккуратно и вдали (редкое), и вблизи (плотное).
 *
 * Очередь делится на слои (STRATA слоёв равной плотности). Далёкой поверхности хватает первого слоя,
 * ближняя досевается по слою за кадр; каждый слой считается сам по себе, без пересчёта остальных.
 *
 * Сетка помещения режется на клетки (splitCells): у каждой клетки своё облако, и сколько слоёв ей
 * нужно, решается по расстоянию до неё, а не до всего помещения. Иначе в большой комнате видеокарта
 * получала бы дальнюю стену в ту же плотность, что и ближнюю, и две трети точек отбрасывала.
 */
import type { Vec3 } from '../core/types';
import type { MeshData } from './kit';
import { MAT } from './materials';

/** На сколько слоёв делится полная плотность. */
export const STRATA = 8;

/** Точек в плитке синего шума. */
const TILE = 4096;
/** Ячеек по стороне плитки в указателе точек одного слоя (в ячейке — около двух точек). */
const BINS = 16;

/** Плитка синего шума: точки в единичном квадрате (края сшиты) в порядке появления и указатель по слоям. */
interface Tile {
  x: Float32Array;
  y: Float32Array;
  /** Для слоя k и ячейки b: её точки — items[start[k·(BINS²+1)+b] … start[k·(BINS²+1)+b+1]). */
  start: Uint32Array;
  items: Uint16Array;
}

let tileCache: Tile | null = null;

/**
 * Собрать плитку: каждая следующая точка — лучшая из нескольких случайных проб, та, что дальше всех от
 * уже стоящих (Mitchell). Любое начало такого ряда покрывает квадрат ровно. Квадрат замкнут в тор:
 * плитки стыкуются без шва. Считается один раз, одинаково на любом устройстве.
 */
function blueTile(): Tile {
  if (tileCache) return tileCache;
  const x = new Float32Array(TILE);
  const y = new Float32Array(TILE);
  let state = 0x2f6e2b1;
  const rnd = () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
  // Сетка для поиска ближайшей точки: в ячейке — список её точек.
  const G = 64;
  const head = new Int32Array(G * G).fill(-1);
  const next = new Int32Array(TILE).fill(-1);
  const torus = (d: number) => {
    const a = Math.abs(d);
    return a > 0.5 ? 1 - a : a;
  };
  /** Квадрат расстояния до ближайшей из первых count точек. */
  const nearest = (cx: number, cy: number, count: number): number => {
    let best = Infinity;
    if (count < 64) {
      for (let i = 0; i < count; i++) {
        const dx = torus(x[i]! - cx);
        const dy = torus(y[i]! - cy);
        const d = dx * dx + dy * dy;
        if (d < best) best = d;
      }
      return best;
    }
    const gx = Math.min(G - 1, Math.floor(cx * G));
    const gy = Math.min(G - 1, Math.floor(cy * G));
    for (let r = 0; r <= G / 2; r++) {
      for (let dy = -r; dy <= r; dy++) {
        const edge = dy === -r || dy === r;
        for (let dx = -r; dx <= r; dx += edge ? 1 : 2 * r || 1) {
          let i = head[(((gy + dy) % G) + G) % G * G + ((((gx + dx) % G) + G) % G)]!;
          while (i >= 0) {
            const ex = torus(x[i]! - cx);
            const ey = torus(y[i]! - cy);
            const d = ex * ex + ey * ey;
            if (d < best) best = d;
            i = next[i]!;
          }
        }
      }
      // Дальше кольца r точки не ближе r ячеек: если найденная ближе — она и есть ближайшая.
      const reach = r / G;
      if (best <= reach * reach) break;
    }
    return best;
  };
  for (let i = 0; i < TILE; i++) {
    let bx = rnd();
    let by = rnd();
    if (i > 0) {
      let best = nearest(bx, by, i);
      for (let t = 1; t < 24; t++) {
        const cx = rnd();
        const cy = rnd();
        const d = nearest(cx, cy, i);
        if (d > best) {
          best = d;
          bx = cx;
          by = cy;
        }
      }
    }
    x[i] = bx;
    y[i] = by;
    const cell = Math.min(G - 1, Math.floor(by * G)) * G + Math.min(G - 1, Math.floor(bx * G));
    next[i] = head[cell]!;
    head[cell] = i;
  }
  // Указатель: точки каждого слоя по ячейкам BINS × BINS.
  const per = BINS * BINS + 1;
  const start = new Uint32Array(STRATA * per);
  const items = new Uint16Array(TILE);
  const binOf = (i: number) => Math.min(BINS - 1, Math.floor(y[i]! * BINS)) * BINS + Math.min(BINS - 1, Math.floor(x[i]! * BINS));
  const layerOf = (i: number) => Math.floor((i * STRATA) / TILE);
  for (let i = 0; i < TILE; i++) start[layerOf(i) * per + binOf(i) + 1]! += 1;
  let total = 0;
  for (let k = 0; k < STRATA; k++) {
    start[k * per] = total;
    for (let b = 0; b < BINS * BINS; b++) {
      const n = start[k * per + b + 1]!;
      start[k * per + b + 1] = start[k * per + b]! + n;
    }
    total = start[k * per + BINS * BINS]!;
  }
  const fill = new Uint32Array(STRATA * per);
  for (let i = 0; i < TILE; i++) {
    const slot = layerOf(i) * per + binOf(i);
    items[start[slot]! + fill[slot]!] = i;
    fill[slot]! += 1;
  }
  tileCache = { x, y, start, items };
  return tileCache;
}

/** Откуда сеять: треугольники одной клетки сетки с накопленной площадью. */
export interface PointSource {
  /**
   * Вершины треугольников, по три номера на треугольник. Номер меньше base — вершина самой сетки;
   * больше — вершина куска, отрезанного границей клетки (лежит в extraPos / extraNrm под номером − base).
   */
  tri: Uint32Array;
  /** Вся площадь клетки, м². */
  area: number;
  /** Вершины сетки (общие с ней, не копия). */
  position: Float32Array;
  normal: Float32Array;
  base: number;
  extraPos: Float32Array;
  extraNrm: Float32Array;
  /** Габариты того, что лежит в клетке. */
  min: Vec3;
  max: Vec3;
}

export interface PointBuffers {
  position: Float32Array;
  /** xyz — нормаль поверхности (−127…127), w — запас. */
  nrm: Int8Array;
  /** x — очередь (0…255: кто появляется раньше), yzw — случайные числа точки. */
  seed: Uint8Array;
}

/** Перемешивание трёх целых в одно: случайные числа точки не зависят от порядка посева. */
function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x165667b1, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Площадь треугольника по шести числам вершин (x, y, z подряд). */
function triArea(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): number {
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

/** Сборщик одной клетки. */
interface CellBuilder {
  tri: number[];
  area: number;
  pos: number[];
  nrm: number[];
  min: [number, number, number];
  max: [number, number, number];
}

/** Многоугольник при отсечении: до 8 вершин по 6 чисел (место и нормаль). */
const polyA = new Float64Array(8 * 6);
const polyB = new Float64Array(8 * 6);

/**
 * Отсечь многоугольник полуплоскостью: оставить часть, где координата axis (0 — x, 2 — z) не меньше
 * (keepAbove) или не больше границы. Возвращает число вершин результата в dst.
 */
function clipPoly(src: Float64Array, n: number, dst: Float64Array, axis: number, bound: number, keepAbove: boolean): number {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const a = i * 6;
    const b = ((i + 1) % n) * 6;
    const da = keepAbove ? src[a + axis]! - bound : bound - src[a + axis]!;
    const db = keepAbove ? src[b + axis]! - bound : bound - src[b + axis]!;
    if (da >= 0) {
      for (let k = 0; k < 6; k++) dst[m * 6 + k] = src[a + k]!;
      m += 1;
    }
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      for (let k = 0; k < 6; k++) dst[m * 6 + k] = src[a + k]! + (src[b + k]! - src[a + k]!) * t;
      m += 1;
    }
  }
  return m;
}

/**
 * Подготовить сетку к посеву: разрезать на клетки не крупнее size метров (по x и z; по высоте клетка —
 * вся сетка) и собрать для каждой список треугольников. Треугольник, который пересекает границу
 * клетки, режется по ней: каждой клетке достаётся её кусок. Пустые клетки не возвращаются.
 *
 * Светящееся (небо над лугом, абажуры, экраны, обводка выхода) точек не получает: оно видно само.
 */
export function splitCells(mesh: MeshData, size: number): PointSource[] {
  const { position: p, normal: nm, index, mat } = mesh;
  const count = index.length / 3;
  const base = p.length / 3;
  const use = new Uint8Array(count);
  let minx = Infinity;
  let minz = Infinity;
  let maxx = -Infinity;
  let maxz = -Infinity;
  let any = false;
  for (let t = 0; t < count; t++) {
    const a = index[t * 3]! * 3;
    if (Math.round(mat[index[t * 3]!]!) === MAT.glow) continue;
    const b = index[t * 3 + 1]! * 3;
    const c = index[t * 3 + 2]! * 3;
    if (!(triArea(p[a]!, p[a + 1]!, p[a + 2]!, p[b]!, p[b + 1]!, p[b + 2]!, p[c]!, p[c + 1]!, p[c + 2]!) > 1e-9)) continue;
    use[t] = 1;
    any = true;
    minx = Math.min(minx, p[a]!, p[b]!, p[c]!);
    maxx = Math.max(maxx, p[a]!, p[b]!, p[c]!);
    minz = Math.min(minz, p[a + 2]!, p[b + 2]!, p[c + 2]!);
    maxz = Math.max(maxz, p[a + 2]!, p[b + 2]!, p[c + 2]!);
  }
  if (!any) return [];
  const parts = (len: number) => (Number.isFinite(size) && size > 0 ? Math.max(1, Math.ceil(len / size - 1e-6)) : 1);
  const nx = parts(maxx - minx);
  const nz = parts(maxz - minz);
  const wx = (maxx - minx) / nx || 1;
  const wz = (maxz - minz) / nz || 1;
  const cells: (CellBuilder | undefined)[] = new Array(nx * nz);
  const cell = (ix: number, iz: number): CellBuilder => {
    let c = cells[iz * nx + ix];
    if (!c) {
      c = { tri: [], area: 0, pos: [], nrm: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      cells[iz * nx + ix] = c;
    }
    return c;
  };
  const grow = (c: CellBuilder, x: number, y: number, z: number) => {
    if (x < c.min[0]) c.min[0] = x;
    if (y < c.min[1]) c.min[1] = y;
    if (z < c.min[2]) c.min[2] = z;
    if (x > c.max[0]) c.max[0] = x;
    if (y > c.max[1]) c.max[1] = y;
    if (z > c.max[2]) c.max[2] = z;
  };
  const clampI = (v: number, n: number) => (v < 0 ? 0 : v > n - 1 ? n - 1 : v);
  for (let t = 0; t < count; t++) {
    if (!use[t]) continue;
    const i0 = index[t * 3]!;
    const i1 = index[t * 3 + 1]!;
    const i2 = index[t * 3 + 2]!;
    const a = i0 * 3;
    const b = i1 * 3;
    const c = i2 * 3;
    const tminx = Math.min(p[a]!, p[b]!, p[c]!);
    const tmaxx = Math.max(p[a]!, p[b]!, p[c]!);
    const tminz = Math.min(p[a + 2]!, p[b + 2]!, p[c + 2]!);
    const tmaxz = Math.max(p[a + 2]!, p[b + 2]!, p[c + 2]!);
    const ix0 = clampI(Math.floor((tminx - minx) / wx), nx);
    const ix1 = Math.max(ix0, clampI(Math.floor((tmaxx - minx) / wx - 1e-7), nx));
    const iz0 = clampI(Math.floor((tminz - minz) / wz), nz);
    const iz1 = Math.max(iz0, clampI(Math.floor((tmaxz - minz) / wz - 1e-7), nz));
    if (ix0 === ix1 && iz0 === iz1) {
      // Треугольник целиком в одной клетке: берётся как есть, вершины остаются общими с сеткой.
      const cb = cell(ix0, iz0);
      cb.tri.push(i0, i1, i2);
      cb.area += triArea(p[a]!, p[a + 1]!, p[a + 2]!, p[b]!, p[b + 1]!, p[b + 2]!, p[c]!, p[c + 1]!, p[c + 2]!);
      grow(cb, p[a]!, p[a + 1]!, p[a + 2]!);
      grow(cb, p[b]!, p[b + 1]!, p[b + 2]!);
      grow(cb, p[c]!, p[c + 1]!, p[c + 2]!);
      continue;
    }
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let k = 0; k < 3; k++) {
          const v = index[t * 3 + k]! * 3;
          polyA[k * 6] = p[v]!;
          polyA[k * 6 + 1] = p[v + 1]!;
          polyA[k * 6 + 2] = p[v + 2]!;
          polyA[k * 6 + 3] = nm[v]!;
          polyA[k * 6 + 4] = nm[v + 1]!;
          polyA[k * 6 + 5] = nm[v + 2]!;
        }
        // Крайним клеткам внешняя граница не нужна: всё, что за ней, и так их.
        let n = 3;
        let cur = polyA;
        let other = polyB;
        const cut = (axis: number, bound: number, above: boolean) => {
          n = clipPoly(cur, n, other, axis, bound, above);
          const s = cur;
          cur = other;
          other = s;
        };
        if (ix > 0) cut(0, minx + ix * wx, true);
        if (n >= 3 && ix < nx - 1) cut(0, minx + (ix + 1) * wx, false);
        if (n >= 3 && iz > 0) cut(2, minz + iz * wz, true);
        if (n >= 3 && iz < nz - 1) cut(2, minz + (iz + 1) * wz, false);
        if (n < 3) continue;
        for (let k = 1; k < n - 1; k++) {
          const o = [0, k * 6, (k + 1) * 6] as const;
          const area = triArea(cur[o[0]]!, cur[o[0] + 1]!, cur[o[0] + 2]!, cur[o[1]]!, cur[o[1] + 1]!, cur[o[1] + 2]!, cur[o[2]]!, cur[o[2] + 1]!, cur[o[2] + 2]!);
          if (!(area > 1e-9)) continue;
          const cb = cell(ix, iz);
          const first = base + cb.pos.length / 3;
          for (const q of o) {
            cb.pos.push(cur[q]!, cur[q + 1]!, cur[q + 2]!);
            cb.nrm.push(cur[q + 3]!, cur[q + 4]!, cur[q + 5]!);
            grow(cb, cur[q]!, cur[q + 1]!, cur[q + 2]!);
          }
          cb.tri.push(first, first + 1, first + 2);
          cb.area += area;
        }
      }
    }
  }
  const out: PointSource[] = [];
  for (const cb of cells) {
    if (!cb || cb.tri.length === 0) continue;
    out.push({ tri: Uint32Array.from(cb.tri), area: cb.area, position: p, normal: nm, base, extraPos: Float32Array.from(cb.pos), extraNrm: Float32Array.from(cb.nrm), min: cb.min, max: cb.max });
  }
  return out;
}

/** Вся сетка одной клеткой (вещи, мелкие сетки). У сетки без поверхности площадь — ноль. */
export function pointSource(mesh: MeshData): PointSource {
  return (
    splitCells(mesh, Infinity)[0] ?? {
      tri: new Uint32Array(0),
      area: 0,
      position: mesh.position,
      normal: mesh.normal,
      base: mesh.position.length / 3,
      extraPos: new Float32Array(0),
      extraNrm: new Float32Array(0),
      min: [0, 0, 0],
      max: [0, 0, 0],
    }
  );
}

/** Сколько точек ожидается в одном слое при такой полной плотности (точек на м²); дробное. */
export function stratumCount(src: PointSource, density: number): number {
  return Math.max(0, (src.area * density) / STRATA);
}

/**
 * Сколько места отвести под один слой. Точное число точек слоя заранее неизвестно (сколько точек
 * плитки попадёт в каждый треугольник, видно только при посеве), поэтому место берётся с запасом.
 */
export function stratumRoom(src: PointSource, density: number): number {
  const expected = stratumCount(src, density);
  if (expected <= 0) return 0;
  return Math.ceil(expected * 1.04 + 3 * Math.sqrt(src.tri.length / 3) + 16);
}

/**
 * Посеять один слой в буферы, начиная с точки номер offset. Возвращает, сколько точек записано.
 *
 * Плоскость треугольника замощается плиткой синего шума в мировых координатах (берутся две оси, к
 * которым плоскость ближе всего; сдвиг плитки свой у каждой плоскости), и треугольнику достаются
 * точки плитки, попавшие внутрь него. Слою — его восьмая часть плитки. Размер плитки подобран так,
 * чтобы на квадратный метр поверхности пришлось density точек.
 *
 * Если место в буферах кончилось, посев останавливается: недостача — доли процента в хвосте слоя.
 */
export function fillStratum(src: PointSource, stratum: number, density: number, seed: number, out: PointBuffers, offset: number): number {
  const room = out.position.length / 3;
  if (!(density > 0) || src.area <= 0 || offset >= room) return 0;
  const { position: mp, normal: mn, extraPos: ep, extraNrm: en, base } = src;
  const tile = blueTile();
  const index = stratum * (BINS * BINS + 1);
  const count = src.tri.length / 3;
  let n = offset;
  for (let i = 0; i < count; i++) {
    // Три вершины: место и нормаль каждой — из сетки или из кусков клетки.
    let va = src.tri[i * 3]!;
    let vb = src.tri[i * 3 + 1]!;
    let vc = src.tri[i * 3 + 2]!;
    const pa = va < base ? mp : ep;
    const pb = vb < base ? mp : ep;
    const pc = vc < base ? mp : ep;
    const na = va < base ? mn : en;
    const nb = vb < base ? mn : en;
    const nc = vc < base ? mn : en;
    va = (va < base ? va : va - base) * 3;
    vb = (vb < base ? vb : vb - base) * 3;
    vc = (vc < base ? vc : vc - base) * 3;
    const ax = pa[va]!;
    const ay = pa[va + 1]!;
    const az = pa[va + 2]!;
    const bx = pb[vb]!;
    const by = pb[vb + 1]!;
    const bz = pb[vb + 2]!;
    const cx = pc[vc]!;
    const cy = pc[vc + 1]!;
    const cz = pc[vc + 2]!;
    // Нормаль плоскости и ось, к которой она ближе всего: вдоль этой оси плитка проецируется на треугольник.
    const gx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const gy = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const gz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const len = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (!(len > 1e-12)) continue;
    const mx = Math.abs(gx);
    const my = Math.abs(gy);
    const mz = Math.abs(gz);
    const axis = mx >= my && mx >= mz ? 0 : my >= mz ? 1 : 2;
    const lean = (axis === 0 ? mx : axis === 1 ? my : mz) / len;
    // Сторона плитки, м. Наклонной грани плитка нужна мельче: на проекции точек должно быть больше.
    const side = Math.sqrt((TILE * lean) / density);
    // Свой сдвиг плитки у каждой плоскости: у двух сторон тонкой доски рисунок разный.
    const depth = Math.round(((gx * ax + gy * ay + gz * az) / len) * 1000);
    const plane = hash(depth | 0, axis + ((axis === 0 ? gx : axis === 1 ? gy : gz) < 0 ? 3 : 0), 0x51f15e);
    const ou = (plane & 0xffff) / 65536;
    const ov = (plane >>> 16) / 65536;
    // Треугольник в координатах плитки.
    const au = (axis === 0 ? az : ax) / side + ou;
    const av = (axis === 1 ? az : ay) / side + ov;
    const bu = (axis === 0 ? bz : bx) / side + ou;
    const bv = (axis === 1 ? bz : by) / side + ov;
    const cu = (axis === 0 ? cz : cx) / side + ou;
    const cv = (axis === 1 ? cz : cy) / side + ov;
    const twice = (bu - au) * (cv - av) - (bv - av) * (cu - au);
    if (!(Math.abs(twice) > 1e-14)) continue;
    const u0 = Math.floor(Math.min(au, bu, cu) * BINS);
    const u1 = Math.floor(Math.max(au, bu, cu) * BINS);
    const v0 = Math.floor(Math.min(av, bv, cv) * BINS);
    const v1 = Math.floor(Math.max(av, bv, cv) * BINS);
    for (let qv = v0; qv <= v1; qv++) {
      const tv = Math.floor(qv / BINS);
      const row = (qv - tv * BINS) * BINS;
      for (let qu = u0; qu <= u1; qu++) {
        const tu = Math.floor(qu / BINS);
        const bin = index + row + (qu - tu * BINS);
        for (let k = tile.start[bin]!; k < tile.start[bin + 1]!; k++) {
          const q = tile.items[k]!;
          const u = tu + tile.x[q]!;
          const v = tv + tile.y[q]!;
          // Веса вершин: точка внутри, если все три неотрицательны.
          const wb = ((u - au) * (cv - av) - (v - av) * (cu - au)) / twice;
          const wc = ((bu - au) * (v - av) - (bv - av) * (u - au)) / twice;
          const wa = 1 - wb - wc;
          if (wa < 0 || wb < 0 || wc < 0) continue;
          if (n >= room) return n - offset;
          out.position[n * 3] = ax * wa + bx * wb + cx * wc;
          out.position[n * 3 + 1] = ay * wa + by * wb + cy * wc;
          out.position[n * 3 + 2] = az * wa + bz * wb + cz * wc;
          let nx = na[va]! * wa + nb[vb]! * wb + nc[vc]! * wc;
          let ny = na[va + 1]! * wa + nb[vb + 1]! * wb + nc[vc + 1]! * wc;
          let nz = na[va + 2]! * wa + nb[vb + 2]! * wb + nc[vc + 2]! * wc;
          const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          nx /= l;
          ny /= l;
          nz /= l;
          out.nrm[n * 4] = Math.round(nx * 127);
          out.nrm[n * 4 + 1] = Math.round(ny * 127);
          out.nrm[n * 4 + 2] = Math.round(nz * 127);
          out.nrm[n * 4 + 3] = 0;
          // Случайные числа точки — от её места в замощении, а не от треугольника.
          const r = hash(seed ^ plane, q + TILE * (tu & 0x3ff), tv);
          out.seed[n * 4] = (q * 256) / TILE;
          out.seed[n * 4 + 1] = r & 255;
          out.seed[n * 4 + 2] = (r >>> 8) & 255;
          out.seed[n * 4 + 3] = (r >>> 16) & 255;
          n += 1;
        }
      }
    }
  }
  return n - offset;
}

/** Буферы под столько точек. */
export function pointBuffers(capacity: number): PointBuffers {
  return { position: new Float32Array(capacity * 3), nrm: new Int8Array(capacity * 4), seed: new Uint8Array(capacity * 4) };
}
