/**
 * Сиденья, сделанные «как в жизни», а не кубиками (слова партнёра: «Не нравится игрушечный стул, давай
 * поменяем на более реальный»). Игрушечность шла от пропорций: толстые ножки, плоские доски, прямые
 * углы, яркий цвет. Здесь — тонкие трубы с гнутыми углами, выгнутая фанера толщиной в сантиметр,
 * скруглённые кромки и цвет настоящих материалов.
 *
 * Два помощника годятся и другим вещам: tube — гнутая труба по ломаной (углы скругляются), panel —
 * тонкая гнутая плита со скруглёнными углами (сиденье, спинка, столешница).
 *
 * Координаты как у всего реквизита у стены: спинка у стены (z ≈ 0), сиденье смотрит в комнату (+z),
 * x — вдоль стены, пол — y = 0. Вся случайность — из сида.
 */
import type { Vec3 } from '../core/types';
import { MAT } from './materials';
import type { Xf } from './props';
import { rng } from './props_more';
import type { PropSpec } from './props_more';

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

/** Шпон: от светлого медового до тёмного ореха. */
const VENEER: readonly Vec3[] = [
  [1.08, 0.98, 0.86],
  [0.95, 0.88, 0.8],
  [0.78, 0.7, 0.64],
  [0.62, 0.52, 0.46],
];
/** Труба: крашеная — почти чёрная, серая, тёмно-зелёная; изредка хромированная. */
const FRAME: readonly Vec3[] = [
  [0.22, 0.22, 0.23],
  [0.42, 0.43, 0.44],
  [0.26, 0.32, 0.28],
  [1.0, 1.0, 1.02],
];

const SEAT_Y = 0.445;

/**
 * Стул из гнутой фанеры на стальной трубе — такие стояли в каждой конторе, столовой и приёмной.
 * Бока — две гнутые трубы: передняя ножка уходит под сиденье и становится задней ножкой; от сиденья
 * вверх идут стойки спинки, чуть назад. Сиденье выгнуто ковшом, передний край скатан вниз; спинка
 * выгнута по спине. На ножках пластиковые подпятники.
 */
function bentChair(xf: Xf, seed: number): void {
  const r = rng(seed);
  const veneer = VENEER[Math.floor(r() * VENEER.length)]!;
  const frame = r() < 0.12 ? FRAME[3]! : FRAME[Math.floor(r() * 3)]!;
  const frameMat = frame === FRAME[3] ? MAT.steel : MAT.metalGrey;
  const edge: Vec3 = [veneer[0] * 1.35, veneer[1] * 1.3, veneer[2] * 1.2];
  const R = 0.0105;
  const half = 0.2;
  for (const sx of [-1, 1]) {
    const x = sx * half;
    // Бок: передняя ножка → под сиденьем назад → задняя ножка, чуть разведённая назад.
    tube(xf, bendPath([[x, 0.012, 0.47], [x, SEAT_Y - 0.03, 0.45], [x, SEAT_Y - 0.03, 0.07], [x * 1.02, 0.012, 0.02]], 0.05), R, frameMat, frame);
    // Стойка спинки: от рамы под сиденьем вверх, с наклоном назад.
    tube(xf, bendPath([[x * 0.98, SEAT_Y - 0.03, 0.12], [x * 0.98, SEAT_Y + 0.05, 0.08], [x * 0.96, 0.84, 0.035]], 0.06), R * 0.9, frameMat, frame);
    // Подпятники.
    for (const z of [0.47, 0.02]) xf.cyl([x * (z < 0.1 ? 1.02 : 1), 0, z], 'y', 0.014, R * 1.25, MAT.rubber, { tint: [0.18, 0.18, 0.18], segments: 8 });
  }
  // Поперечины: под сиденьем спереди и сзади, чтобы бока не разъезжались.
  for (const z of [0.42, 0.1]) tube(xf, [[-half, SEAT_Y - 0.035, z], [half, SEAT_Y - 0.035, z]], R * 0.8, frameMat, frame, 6);
  // Сиденье: ковш, передний край скатан вниз, к спинке чуть приподнят.
  const sa = 0.215;
  const sb = 0.205;
  const zc = 0.27;
  panel(
    xf,
    sa,
    sb,
    0.011,
    (s, t) => {
      const u = t / sb; // −1 — у спинки, +1 — передний край
      const dish = -0.012 * (1 - (s / sa) ** 2) * (1 - u * u);
      const roll = u > 0.55 ? -0.035 * ((u - 0.55) / 0.45) ** 2 : 0;
      const lift = u < -0.6 ? 0.012 * ((-u - 0.6) / 0.4) ** 2 : 0;
      return [s * (1 - 0.05 * (1 - u) * 0.5), SEAT_Y + dish + roll + lift, zc + t];
    },
    [0, 1, 0],
    MAT.veneer,
    veneer,
    edge,
  );
  // Спинка: гнутая по спине (края вперёд), с наклоном назад по стойкам.
  const ba = 0.205;
  const bb = 0.085;
  panel(
    xf,
    ba,
    bb,
    0.01,
    (s, t) => {
      const y = 0.72 + t;
      const z = 0.05 + 0.04 * (s / ba) ** 2 - (y - 0.72) * 0.18 + 0.012;
      return [s, y, z];
    },
    [0, 0, 1],
    MAT.veneer,
    veneer,
    edge,
  );
  // Преграда: сиденье и ножки (спинка выше колена — по ней не упираются).
  xf.collider([-0.22, 0, 0], [0.22, SEAT_Y + 0.02, 0.48]);
}

export const SEATING_PROPS: Record<string, PropSpec> = {
  chair_bent: { w: 0.46, d: 0.5, h: 0.86, mount: 'floor', ru: 'стул: гнутая фанера на стальной трубе', build: bentChair },
};
