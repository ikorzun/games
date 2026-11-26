/**
 * Поиск граней, лежащих в одной плоскости и смотрящих в одну сторону: две такие грани спорят за один
 * пиксель, и на экране это место рябит полосами (слова партнёра: «всегда рябит по периметру внутри
 * дверных проёмов»). Буфер глубины игры (24 бита, ближняя плоскость 5 см) в пределах луча различает
 * поверхности, разнесённые на десятые доли миллиметра, поэтому стопки листов и пятен с шагом 0,16–0,2 мм
 * сюда не попадают; попадает только точное совпадение плоскостей.
 *
 * Поиск не знает, видна ли грань: задние стенки вещей у стены и днища на полу тоже считаются. Поэтому
 * тесты спрашивают не «нет ли наложений вообще», а про конкретные места — проёмы, лестницы.
 */
import type { MeshData } from '../src/world/kit';

export interface Overlap {
  /** Точка внутри общего участка. */
  at: [number, number, number];
  n: [number, number, number];
  /** Площадь общего участка, м². */
  area: number;
  mats: [number, number];
  tints: [number, number];
  objs: [number, number];
}

interface Tri {
  p: [number, number, number][];
  n: [number, number, number];
  d: number;
  mat: number;
  tint: number;
  obj: number;
  /** Номер исходной сетки — чтобы отличать «грань и её соседа по той же плите» от настоящего наложения. */
  src: number;
}

type P2 = [number, number];

/** Отсечь выпуклый многоугольник полуплоскостью слева от ребра a → b. */
function clip(poly: P2[], a: P2, b: P2): P2[] {
  const out: P2[] = [];
  const side = (p: P2): number => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]!;
    const nxt = poly[(i + 1) % poly.length]!;
    const sc = side(cur);
    const sn = side(nxt);
    if (sc >= 0) out.push(cur);
    if (sc >= 0 !== sn >= 0) {
      const t = sc / (sc - sn);
      out.push([cur[0] + (nxt[0] - cur[0]) * t, cur[1] + (nxt[1] - cur[1]) * t]);
    }
  }
  return out;
}

const area2 = (poly: P2[]): number => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    s += a[0] * b[1] - a[1] * b[0];
  }
  return s / 2;
};

/**
 * Наложения граней в наборе сеток. `gap` — на сколько метров могут расходиться плоскости, чтобы всё
 * ещё считаться одной; `minArea` — меньшие общие участки не считаются (стык встык, касание кромкой).
 * `within` — ограничить поиск областью (min, max): проверять только грани, задевающие её.
 */
export function coplanarOverlaps(meshes: readonly MeshData[], opts: { gap?: number; minArea?: number; within?: [[number, number, number], [number, number, number]] } = {}): Overlap[] {
  const gap = opts.gap ?? 0.00005;
  const minArea = opts.minArea ?? 0.002;
  const box = opts.within;
  const tris: Tri[] = [];
  meshes.forEach((m, src) => {
    const P = m.position;
    for (let i = 0; i < m.index.length; i += 3) {
      const ia = m.index[i]!;
      const ib = m.index[i + 1]!;
      const ic = m.index[i + 2]!;
      const a: [number, number, number] = [P[ia * 3]!, P[ia * 3 + 1]!, P[ia * 3 + 2]!];
      const b: [number, number, number] = [P[ib * 3]!, P[ib * 3 + 1]!, P[ib * 3 + 2]!];
      const c: [number, number, number] = [P[ic * 3]!, P[ic * 3 + 1]!, P[ic * 3 + 2]!];
      if (box) {
        const lo = [Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]), Math.min(a[2], b[2], c[2])];
        const hi = [Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1]), Math.max(a[2], b[2], c[2])];
        if (hi[0]! < box[0][0] || lo[0]! > box[1][0] || hi[1]! < box[0][1] || lo[1]! > box[1][1] || hi[2]! < box[0][2] || lo[2]! > box[1][2]) continue;
      }
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const vx = c[0] - a[0];
      const vy = c[1] - a[1];
      const vz = c[2] - a[2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-7) continue;
      nx /= len;
      ny /= len;
      nz /= len;
      tris.push({ p: [a, b, c], n: [nx, ny, nz], d: nx * a[0] + ny * a[1] + nz * a[2], mat: m.mat[ia]!, tint: Math.round(m.color[ia * 4]! * 50) * 10000 + Math.round(m.color[ia * 4 + 1]! * 50) * 100 + Math.round(m.color[ia * 4 + 2]! * 50), obj: m.obj ? m.obj[ia]! : 0, src });
    }
  });
  // Корзины по направлению нормали (до 0,5°), внутри — по порядку вдоль неё.
  const buckets = new Map<string, Tri[]>();
  for (const t of tris) {
    const key = `${Math.round(t.n[0] * 120)},${Math.round(t.n[1] * 120)},${Math.round(t.n[2] * 120)}`;
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(t);
  }
  const found: Overlap[] = [];
  for (const list of buckets.values()) {
    list.sort((x, y) => x.d - y.d);
    for (let i = 0; i < list.length; i++) {
      const A = list[i]!;
      // Оси плоскости.
      const n = A.n;
      const ax: [number, number, number] = Math.abs(n[1]) < 0.9 ? [n[2], 0, -n[0]] : [1, 0, 0];
      const al = Math.hypot(ax[0], ax[1], ax[2]);
      const u: [number, number, number] = [ax[0] / al, ax[1] / al, ax[2] / al];
      const v: [number, number, number] = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
      const to2 = (p: [number, number, number]): P2 => [p[0] * u[0] + p[1] * u[1] + p[2] * u[2], p[0] * v[0] + p[1] * v[1] + p[2] * v[2]];
      let a2 = A.p.map(to2);
      if (area2(a2) < 0) a2 = [a2[0]!, a2[2]!, a2[1]!];
      for (let j = i + 1; j < list.length; j++) {
        const B = list[j]!;
        if (B.d - A.d > gap) break;
        if (A.n[0] * B.n[0] + A.n[1] * B.n[1] + A.n[2] * B.n[2] < 0.9999) continue;
        // Одинаковые по виду грани одной сетки спорить могут, но этого не видно.
        if (A.mat === B.mat && A.tint === B.tint) continue;
        const b2 = B.p.map(to2);
        let poly: P2[] = b2;
        for (let k = 0; k < 3 && poly.length > 0; k++) poly = clip(poly, a2[k]!, a2[(k + 1) % 3]!);
        if (poly.length < 3) continue;
        const ar = Math.abs(area2(poly));
        if (ar < minArea) continue;
        let cx = 0;
        let cy = 0;
        for (const q of poly) {
          cx += q[0] / poly.length;
          cy += q[1] / poly.length;
        }
        const at: [number, number, number] = [u[0] * cx + v[0] * cy + n[0] * A.d, u[1] * cx + v[1] * cy + n[1] * A.d, u[2] * cx + v[2] * cy + n[2] * A.d];
        found.push({ at, n: [n[0], n[1], n[2]], area: ar, mats: [A.mat, B.mat], tints: [A.tint, B.tint], objs: [A.obj, B.obj] });
      }
    }
  }
  return found;
}
