/**
 * Сиденья «как в жизни», а не кубиками (слова партнёра: «Не нравится игрушечный стул, давай поменяем на более
 * реальный»). Стул из гнутой фанеры на трубе, сделанный здесь, с 18.11 заменён стулом полки Sand3D (партнёр: «замени всю
 * мебель на новую самостоятельно»; world/furniture.ts); остались его помощники — ими собраны вещи props_real.ts.
 *
 * tube — гнутая труба по ломаной (углы скругляются), panel — тонкая гнутая плита со скруглёнными углами (сиденье, спинка,
 * столешница).
 *
 * Координаты как у всего реквизита у стены: спинка у стены (z ≈ 0), сиденье смотрит в комнату (+z),
 * x — вдоль стены, пол — y = 0. Вся случайность — из сида.
 */
import type { Vec3 } from '../core/types';
import type { Xf } from './props';
import type { PropSpec } from './props_more';
import { furnished } from './furniture';

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Ломаная со скруглёнными углами: в каждом внутреннем угле — дуга радиуса bend (кривая Безье по углу). */
export function bendPath(points: readonly Vec3[], bend: number, steps = 3): Vec3[] {
  if (points.length < 3) return points.slice();
  const out: Vec3[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    const d = Math.min(bend, len(sub(a, b)) / 2, len(sub(c, b)) / 2);
    const t1 = add(b, mul(norm(sub(a, b)), d));
    const t2 = add(b, mul(norm(sub(c, b)), d));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const u = 1 - t;
      out.push([u * u * t1[0] + 2 * u * t * b[0] + t * t * t2[0], u * u * t1[1] + 2 * u * t * b[1] + t * t * t2[1], u * u * t1[2] + 2 * u * t * b[2] + t * t * t2[2]]);
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

/**
 * Труба радиуса r по ломаной path (в координатах xf). Кольца ведутся параллельным переносом, поэтому на
 * изгибах труба не перекручивается. Концы закрыты заглушками.
 */
export function tube(xf: Xf, path: readonly Vec3[], r: number, mat: number, tint: Vec3, seg = 7): void {
  const mb = xf.mb;
  const n = path.length;
  if (n < 2) return;
  const tan = path.map((_, i) => norm(sub(path[Math.min(n - 1, i + 1)]!, path[Math.max(0, i - 1)]!)));
  // Начальная нормаль — любая, поперёк первой касательной.
  let nrm = norm(cross(tan[0]!, Math.abs(tan[0]![1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const rings: number[][] = [];
  for (let i = 0; i < n; i++) {
    const t = tan[i]!;
    nrm = norm(sub(nrm, mul(t, dot(nrm, t))));
    const bin = cross(t, nrm);
    const ring: number[] = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const dir = add(mul(nrm, Math.cos(a)), mul(bin, Math.sin(a)));
      const p = add(path[i]!, mul(dir, r));
      ring.push(mb.vertex(xf.pt(p[0], p[1], p[2]), xf.dir(dir[0], dir[1], dir[2]), mat, tint, 1));
    }
    rings.push(ring);
  }
  // Обход лицом наружу: (вдоль, вокруг) против часовой, если смотреть снаружи.
  for (let i = 0; i + 1 < n; i++) {
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      mb.tri(rings[i]![k]!, rings[i]![k1]!, rings[i + 1]![k1]!);
      mb.tri(rings[i]![k]!, rings[i + 1]![k1]!, rings[i + 1]![k]!);
    }
  }
  for (const [end, sign] of [[0, -1], [n - 1, 1]] as const) {
    const t = mul(tan[end]!, sign);
    const c = mb.vertex(xf.pt(path[end]![0], path[end]![1], path[end]![2]), xf.dir(t[0], t[1], t[2]), mat, tint, 0.8);
    const ring = rings[end]!;
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      if (sign < 0) mb.tri(c, ring[k1]!, ring[k]!);
      else mb.tri(c, ring[k]!, ring[k1]!);
    }
  }
}

/**
 * Тонкая гнутая плита со скруглёнными углами. Контур — суперэллипс с полуосями a, b (степень 5: почти
 * прямоугольник со скруглёнными углами); place(s, t) переводит точку контура (s ∈ [−a, a], t ∈ [−b, b])
 * в координаты xf — так плита получает изгиб. Толщина — по нормали вниз от лица. Лицо смотрит туда,
 * куда указывает up (в координатах xf, приблизительно).
 */
export function panel(xf: Xf, a: number, b: number, thick: number, place: (s: number, t: number) => Vec3, up: Vec3, mat: number, tint: Vec3, edgeTint?: Vec3): void {
  const mb = xf.mb;
  const RINGS = 4;
  const SEG = 20;
  const E = 5;
  const pt = (rho: number, th: number): [number, number] => {
    const c = Math.cos(th);
    const s = Math.sin(th);
    return [a * rho * Math.sign(c) * Math.abs(c) ** (2 / E), b * rho * Math.sign(s) * Math.abs(s) ** (2 / E)];
  };
  const normalAt = (s: number, t: number): Vec3 => {
    const h = 0.004;
    const n = norm(cross(sub(place(s + h, t), place(s - h, t)), sub(place(s, t + h), place(s, t - h))));
    return dot(n, up) >= 0 ? n : mul(n, -1);
  };
  // Лицо и изнанка: середина и кольца к краю.
  const face = (side: 1 | -1): number[][] => {
    const rows: number[][] = [];
    for (let i = 0; i <= RINGS; i++) {
      const rho = i / RINGS;
      const row: number[] = [];
      for (let k = 0; k < (i === 0 ? 1 : SEG); k++) {
        const [s, t] = pt(rho, (k / SEG) * Math.PI * 2);
        const n = normalAt(s, t);
        const p = add(place(s, t), side > 0 ? [0, 0, 0] : mul(n, -thick));
        const nn = mul(n, side);
        row.push(mb.vertex(xf.pt(p[0], p[1], p[2]), xf.dir(nn[0], nn[1], nn[2]), mat, tint, side > 0 ? 1 : 0.7));
      }
      rows.push(row);
    }
    return rows;
  };
  const emit = (rows: number[][], flip: boolean): void => {
    const tri = (p: number, q: number, r: number): void => (flip ? mb.tri(p, r, q) : mb.tri(p, q, r));
    for (let k = 0; k < SEG; k++) tri(rows[0]![0]!, rows[1]![k]!, rows[1]![(k + 1) % SEG]!);
    for (let i = 1; i < RINGS; i++) {
      for (let k = 0; k < SEG; k++) {
        const k1 = (k + 1) % SEG;
        tri(rows[i]![k]!, rows[i + 1]![k]!, rows[i + 1]![k1]!);
        tri(rows[i]![k]!, rows[i + 1]![k1]!, rows[i]![k1]!);
      }
    }
  };
  // Порядок обхода проверяется по первой грани: лицо должно смотреть по up.
  const top = face(1);
  const [s0, t0] = pt(1, 0);
  const [s1, t1] = pt(1, (1 / SEG) * Math.PI * 2);
  const c0 = place(0, 0);
  const g = cross(sub(place(s0, t0), c0), sub(place(s1, t1), c0));
  const ccw = dot(g, up) > 0;
  emit(top, !ccw);
  emit(face(-1), ccw);
  // Кромка: полоса между лицом и изнанкой по контуру — другого тона (торец фанеры светлее).
  const et = edgeTint ?? tint;
  for (let k = 0; k < SEG; k++) {
    const th0 = (k / SEG) * Math.PI * 2;
    const th1 = ((k + 1) / SEG) * Math.PI * 2;
    const [sa, ta] = pt(1, th0);
    const [sb, tb] = pt(1, th1);
    const pa = place(sa, ta);
    const pb = place(sb, tb);
    const na = normalAt(sa, ta);
    const nb = normalAt(sb, tb);
    const qa = add(pa, mul(na, -thick));
    const qb = add(pb, mul(nb, -thick));
    const out = norm(sub(add(pa, pb), mul(c0, 2)));
    mb.quadFacing(xf.pt(pa[0], pa[1], pa[2]), xf.pt(pb[0], pb[1], pb[2]), xf.pt(qb[0], qb[1], qb[2]), xf.pt(qa[0], qa[1], qa[2]), xf.dir(out[0], out[1], out[2]), mat, et, 0.85);
  }
}

// ───────────────────────────── стул ─────────────────────────────

/**
 * Стул игры с 18.11 — модель полки Sand3D (world/furniture.ts; партнёр: «замени всю мебель на новую самостоятельно»):
 * деревянный с перекладинами в спинке или с резной спинкой и мягким сиденьем. Труба и гнутая плита остались другим вещам.
 */
export const SEATING_PROPS: Record<string, PropSpec> = {
  chair_bent: furnished('floor', ['s3_chair_ladder', 's3_chair_carved'], 'стул: деревянный с перекладинами или с резной спинкой'),
};
