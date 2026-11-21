/**
 * Ядро лепки (слова партнёра: «Своя лепка в браузере… Ограничения можно встроить прямо в редактор… Мне для
 * MacBook давай делать»). Чистый TS без three.js: сетка, кисти, луч по сетке, измельчение и выгрузка в
 * запись готовой модели игры (world/models_data.ts) — тот же формат, что у моделей из наборов и сканов.
 *
 * Сетка — одна замкнутая поверхность ровной плотности (шар, куб, цилиндр, измельчённые до нужного числа
 * треугольников); кисти двигают её вершины. Динамической топологии нет: ровная сетка проще и для игры —
 * её упрощают при выгрузке до бюджета (simplify — снаружи: в браузере это meshoptimizer).
 *
 * Свои координаты — метры игры: пол y = 0, человек — 1,75 м.
 */

export type V3 = [number, number, number];

export interface SculptMesh {
  /** Позиции, м (3 на вершину). */
  pos: Float32Array;
  /** Единичные нормали. */
  nrm: Float32Array;
  /** Цвет вершины, линейный 0..1 (краска кисти «Краска»). */
  col: Float32Array;
  /** Треугольники (3 индекса). */
  idx: Uint32Array;
  /** Соседи вершины по рёбрам (CSR): adj[adjStart[i] .. adjStart[i+1]). */
  adjStart: Uint32Array;
  adj: Uint32Array;
  /** Треугольники вершины (CSR). */
  vfStart: Uint32Array;
  vf: Uint32Array;
}

export const vcount = (m: SculptMesh): number => m.pos.length / 3;
export const tcount = (m: SculptMesh): number => m.idx.length / 3;

/** Сетка из позиций и треугольников: соседи, нормали, цвет. */
export function makeMesh(pos: Float32Array, idx: Uint32Array, col?: Float32Array, base: V3 = [0.8, 0.78, 0.72]): SculptMesh {
  const n = pos.length / 3;
  const m: SculptMesh = { pos, nrm: new Float32Array(n * 3), col: col ?? new Float32Array(n * 3), idx, adjStart: new Uint32Array(0), adj: new Uint32Array(0), vfStart: new Uint32Array(0), vf: new Uint32Array(0) };
  if (!col) for (let i = 0; i < n; i++) m.col.set(base, i * 3);
  linkMesh(m);
  computeNormals(m);
  return m;
}

/** Соседи по рёбрам и треугольники каждой вершины. */
export function linkMesh(m: SculptMesh): void {
  const n = vcount(m);
  const t = tcount(m);
  const vfCount = new Uint32Array(n + 1);
  for (let i = 0; i < t * 3; i++) vfCount[m.idx[i]! + 1]! += 1;
  for (let i = 0; i < n; i++) vfCount[i + 1]! += vfCount[i]!;
  m.vfStart = vfCount.slice();
  m.vf = new Uint32Array(t * 3);
  const fill = vfCount.slice();
  for (let f = 0; f < t; f++) for (let k = 0; k < 3; k++) m.vf[fill[m.idx[f * 3 + k]!]!++] = f;
  // Соседи: из треугольников вершины, без повторов.
  const starts = new Uint32Array(n + 1);
  const lists: number[] = [];
  const seen = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    starts[i] = lists.length;
    for (let j = m.vfStart[i]!; j < m.vfStart[i + 1]!; j++) {
      const f = m.vf[j]!;
      for (let k = 0; k < 3; k++) {
        const v = m.idx[f * 3 + k]!;
        if (v !== i && seen[v] !== i) {
          seen[v] = i;
          lists.push(v);
        }
      }
    }
  }
  starts[n] = lists.length;
  m.adjStart = starts;
  m.adj = Uint32Array.from(lists);
}

function faceNormal(m: SculptMesh, f: number, out: V3): void {
  const p = m.pos;
  const a = m.idx[f * 3]! * 3;
  const b = m.idx[f * 3 + 1]! * 3;
  const c = m.idx[f * 3 + 2]! * 3;
  const ux = p[b]! - p[a]!;
  const uy = p[b + 1]! - p[a + 1]!;
  const uz = p[b + 2]! - p[a + 2]!;
  const vx = p[c]! - p[a]!;
  const vy = p[c + 1]! - p[a + 1]!;
  const vz = p[c + 2]! - p[a + 2]!;
  // Площадь в весе: крупный треугольник влияет на нормаль вершины больше.
  out[0] = uy * vz - uz * vy;
  out[1] = uz * vx - ux * vz;
  out[2] = ux * vy - uy * vx;
}

const tmp: V3 = [0, 0, 0];

/** Нормаль одной вершины по её треугольникам. */
function vertexNormal(m: SculptMesh, i: number): void {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let j = m.vfStart[i]!; j < m.vfStart[i + 1]!; j++) {
    faceNormal(m, m.vf[j]!, tmp);
    x += tmp[0];
    y += tmp[1];
    z += tmp[2];
  }
  const l = Math.hypot(x, y, z) || 1;
  m.nrm[i * 3] = x / l;
  m.nrm[i * 3 + 1] = y / l;
  m.nrm[i * 3 + 2] = z / l;
}

export function computeNormals(m: SculptMesh, only?: Iterable<number>): void {
  if (only) {
    for (const i of only) vertexNormal(m, i);
    return;
  }
  for (let i = 0; i < vcount(m); i++) vertexNormal(m, i);
}

// ───────────────────────────── заготовки ─────────────────────────────

/** Икосаэдр, измельчённый level раз (каждый раз ×4 треугольника) и натянутый на шар. */
export function sphere(level: number, r = 0.3, c: V3 = [0, 0.3, 0]): SculptMesh {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts: V3[] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  let faces: number[] = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  for (let s = 0; s < level; s++) ({ verts, faces } = split(verts, faces));
  const pos = new Float32Array(verts.length * 3);
  verts.forEach((v, i) => {
    const l = Math.hypot(v[0], v[1], v[2]);
    pos.set([c[0] + (v[0] / l) * r, c[1] + (v[1] / l) * r, c[2] + (v[2] / l) * r], i * 3);
  });
  return makeMesh(pos, Uint32Array.from(faces));
}

/** Куб со скруглением: решётка n×n на грань, натянутая на «подушку» (без острых рёбер — кисти их не любят). */
export function box(n: number, size: V3 = [0.5, 0.5, 0.5], round = 0.25): SculptMesh {
  const verts: V3[] = [];
  const key = new Map<string, number>();
  const faces: number[] = [];
  const at = (p: V3): number => {
    const k = p.map((v) => Math.round(v * 1e5)).join(',');
    let i = key.get(k);
    if (i === undefined) {
      i = verts.length;
      verts.push(p);
      key.set(k, i);
    }
    return i;
  };
  // Шесть граней куба [-1, 1]³: ось, знак; обход против часовой снаружи.
  const sides: [number, number][] = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
  for (const [ax, sg] of sides) {
    const u = (ax + 1) % 3;
    const v = (ax + 2) % 3;
    const grid: number[][] = [];
    for (let i = 0; i <= n; i++) {
      grid.push([]);
      for (let j = 0; j <= n; j++) {
        const p: V3 = [0, 0, 0];
        p[ax] = sg;
        p[u] = -1 + (2 * i) / n;
        p[v] = -1 + (2 * j) / n;
        grid[i]!.push(at(p));
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const a = grid[i]![j]!;
        const b = grid[i + 1]![j]!;
        const c = grid[i + 1]![j + 1]!;
        const d = grid[i]![j + 1]!;
        if (sg > 0) faces.push(a, b, c, a, c, d);
        else faces.push(a, c, b, a, d, c);
      }
    }
  }
  const pos = new Float32Array(verts.length * 3);
  let low = Infinity;
  verts.forEach((p, i) => {
    // Подушка: точка куба тянется к шару настолько, насколько велико скругление.
    const l = Math.hypot(p[0], p[1], p[2]);
    const q: V3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) q[k] = (p[k]! * (1 - round) + (p[k]! / l) * Math.SQRT2 * round) * 0.5 * size[k]!;
    pos.set(q, i * 3);
    low = Math.min(low, q[1]);
  });
  // На пол.
  for (let i = 1; i < pos.length; i += 3) pos[i] = pos[i]! - low;
  return makeMesh(pos, Uint32Array.from(faces));
}

/** Каждый треугольник — на четыре; новые вершины — середины рёбер. */
function split(verts: V3[], faces: number[]): { verts: V3[]; faces: number[] } {
  const out = verts.slice();
  const mid = new Map<string, number>();
  const m = (a: number, b: number): number => {
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    let i = mid.get(k);
    if (i === undefined) {
      i = out.length;
      const p = out[a]!;
      const q = out[b]!;
      out.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]);
      mid.set(k, i);
    }
    return i;
  };
  const nf: number[] = [];
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f]!;
    const b = faces[f + 1]!;
    const c = faces[f + 2]!;
    const ab = m(a, b);
    const bc = m(b, c);
    const ca = m(c, a);
    nf.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  return { verts: out, faces: nf };
}

/**
 * Подробнее: каждый треугольник — на четыре (×4 треугольника), новые вершины на серединах рёбер, затем
 * одно мягкое сглаживание только новых вершин — форма не теряется, ступенек нет. Цвет — среднее концов.
 */
export function subdivide(m: SculptMesh): SculptMesh {
  const n = vcount(m);
  const verts: V3[] = [];
  for (let i = 0; i < n; i++) verts.push([m.pos[i * 3]!, m.pos[i * 3 + 1]!, m.pos[i * 3 + 2]!]);
  const { verts: out, faces } = split(verts, Array.from(m.idx));
  const pos = new Float32Array(out.length * 3);
  out.forEach((p, i) => pos.set(p, i * 3));
  const col = new Float32Array(out.length * 3);
  col.set(m.col.subarray(0, n * 3));
  const r = makeMesh(pos, Uint32Array.from(faces), col);
  // Цвет новых вершин и лёгкое сглаживание: среднее старых соседей.
  for (let i = n; i < out.length; i++) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let k = 0;
    let px = 0;
    let py = 0;
    let pz = 0;
    for (let j = r.adjStart[i]!; j < r.adjStart[i + 1]!; j++) {
      const v = r.adj[j]!;
      px += r.pos[v * 3]!;
      py += r.pos[v * 3 + 1]!;
      pz += r.pos[v * 3 + 2]!;
      if (v < n) {
        cx += m.col[v * 3]!;
        cy += m.col[v * 3 + 1]!;
        cz += m.col[v * 3 + 2]!;
        k++;
      }
    }
    const deg = r.adjStart[i + 1]! - r.adjStart[i]!;
    if (k > 0) r.col.set([cx / k, cy / k, cz / k], i * 3);
    if (deg > 0) {
      const w = 0.25;
      r.pos[i * 3] = r.pos[i * 3]! * (1 - w) + (px / deg) * w;
      r.pos[i * 3 + 1] = r.pos[i * 3 + 1]! * (1 - w) + (py / deg) * w;
      r.pos[i * 3 + 2] = r.pos[i * 3 + 2]! * (1 - w) + (pz / deg) * w;
    }
  }
  computeNormals(r);
  return r;
}

// ───────────────────────────── луч ─────────────────────────────

export interface Hit {
  t: number;
  p: V3;
  n: V3;
  face: number;
}

/** Луч по сетке (Мёллер — Трумбор, перебором: на сотне тысяч треугольников это миллисекунды). */
export function raycast(m: SculptMesh, o: V3, d: V3): Hit | null {
  const p = m.pos;
  const idx = m.idx;
  let best = Infinity;
  let face = -1;
  for (let f = 0; f < idx.length; f += 3) {
    const a = idx[f]! * 3;
    const b = idx[f + 1]! * 3;
    const c = idx[f + 2]! * 3;
    const e1x = p[b]! - p[a]!;
    const e1y = p[b + 1]! - p[a + 1]!;
    const e1z = p[b + 2]! - p[a + 2]!;
    const e2x = p[c]! - p[a]!;
    const e2y = p[c + 1]! - p[a + 1]!;
    const e2z = p[c + 2]! - p[a + 2]!;
    const hx = d[1] * e2z - d[2] * e2y;
    const hy = d[2] * e2x - d[0] * e2z;
    const hz = d[0] * e2y - d[1] * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (det < 1e-12) continue; // только лицевые
    const inv = 1 / det;
    const sx = o[0] - p[a]!;
    const sy = o[1] - p[a + 1]!;
    const sz = o[2] - p[a + 2]!;
    const u = (sx * hx + sy * hy + sz * hz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t > 1e-6 && t < best) {
      best = t;
      face = f / 3;
    }
  }
  if (face < 0) return null;
  const n: V3 = [0, 0, 0];
  faceNormal(m, face, n);
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return { t: best, p: [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best], n: [n[0] / l, n[1] / l, n[2] / l], face };
}

// ───────────────────────────── кисти ─────────────────────────────

export const BRUSHES = ['draw', 'inflate', 'smooth', 'flatten', 'pinch', 'grab', 'paint'] as const;
export type Brush = (typeof BRUSHES)[number];

export interface Stamp {
  brush: Brush;
  /** Точка касания и нормаль поверхности в ней. */
  at: V3;
  n: V3;
  /** Радиус кисти, м; сила 0..1. */
  radius: number;
  strength: number;
  /** ⌥: вдавить вместо выдавить, сдуть вместо надуть, развести вместо свести. */
  invert: boolean;
  /** Краска (линейный цвет). */
  color?: V3;
}

/** Спад кисти к краю: 1 в середине, 0 на краю, гладко (как у SculptGL). */
export const falloff = (d: number, r: number): number => {
  if (d >= r) return 0;
  const x = 1 - (d * d) / (r * r);
  return x * x * x;
};

/** Вершины в радиусе кисти и их вес (перебором — для ровной сетки до сотни тысяч вершин это дёшево). */
export function gather(m: SculptMesh, at: V3, r: number): { ids: Uint32Array; w: Float32Array } {
  const ids: number[] = [];
  const ws: number[] = [];
  const p = m.pos;
  const r2 = r * r;
  for (let i = 0; i < p.length / 3; i++) {
    const dx = p[i * 3]! - at[0];
    const dy = p[i * 3 + 1]! - at[1];
    const dz = p[i * 3 + 2]! - at[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < r2) {
      ids.push(i);
      ws.push(falloff(Math.sqrt(d2), r));
    }
  }
  return { ids: Uint32Array.from(ids), w: Float32Array.from(ws) };
}

const mirror = (v: V3): V3 => [-v[0], v[1], v[2]];

/**
 * Один мазок кисти. sym — зеркально по x (лепка симметричная, как у SculptGL по умолчанию). Возвращает
 * затронутые вершины (по ним пересчитываются нормали).
 */
export function stamp(m: SculptMesh, s: Stamp, sym: boolean): Set<number> {
  const touched = new Set<number>();
  apply(m, s, touched);
  // Зеркальный мазок — только если кисть не на самой оси (иначе оба мазка лягут в одно место дважды).
  if (sym && Math.abs(s.at[0]) > s.radius * 0.15) apply(m, { ...s, at: mirror(s.at), n: mirror(s.n) }, touched);
  const ring = new Set<number>(touched);
  for (const i of touched) for (let j = m.adjStart[i]!; j < m.adjStart[i + 1]!; j++) ring.add(m.adj[j]!);
  computeNormals(m, ring);
  return ring;
}

function apply(m: SculptMesh, s: Stamp, touched: Set<number>): void {
  const { ids, w } = gather(m, s.at, s.radius);
  if (ids.length === 0) return;
  const p = m.pos;
  const nn = m.nrm;
  const sign = s.invert ? -1 : 1;
  // Нормаль и середина участка: по ним «рисовать», «плющить» и «щипать».
  let ax = 0;
  let ay = 0;
  let az = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let ws = 0;
  for (let k = 0; k < ids.length; k++) {
    const i = ids[k]!;
    const wk = w[k]!;
    ax += nn[i * 3]! * wk;
    ay += nn[i * 3 + 1]! * wk;
    az += nn[i * 3 + 2]! * wk;
    cx += p[i * 3]! * wk;
    cy += p[i * 3 + 1]! * wk;
    cz += p[i * 3 + 2]! * wk;
    ws += wk;
  }
  const al = Math.hypot(ax, ay, az) || 1;
  ax /= al;
  ay /= al;
  az /= al;
  if (ws > 0) {
    cx /= ws;
    cy /= ws;
    cz /= ws;
  }
  // Шаг мазка — доля радиуса: мазок крупной кистью двигает больше.
  const step = s.radius * s.strength;
  if (s.brush === 'smooth') {
    const old = new Float32Array(ids.length * 3);
    for (let k = 0; k < ids.length; k++) {
      const i = ids[k]!;
      let x = 0;
      let y = 0;
      let z = 0;
      const a = m.adjStart[i]!;
      const b = m.adjStart[i + 1]!;
      for (let j = a; j < b; j++) {
        const v = m.adj[j]!;
        x += p[v * 3]!;
        y += p[v * 3 + 1]!;
        z += p[v * 3 + 2]!;
      }
      const deg = Math.max(1, b - a);
      old[k * 3] = x / deg;
      old[k * 3 + 1] = y / deg;
      old[k * 3 + 2] = z / deg;
    }
    for (let k = 0; k < ids.length; k++) {
      const i = ids[k]!;
      const t = Math.min(1, w[k]! * s.strength * 1.6);
      for (let c = 0; c < 3; c++) p[i * 3 + c] = p[i * 3 + c]! + (old[k * 3 + c]! - p[i * 3 + c]!) * t;
      touched.add(i);
    }
    return;
  }
  for (let k = 0; k < ids.length; k++) {
    const i = ids[k]!;
    const wk = w[k]!;
    const o = i * 3;
    if (s.brush === 'draw') {
      const h = sign * step * 0.12 * wk;
      p[o] = p[o]! + ax * h;
      p[o + 1] = p[o + 1]! + ay * h;
      p[o + 2] = p[o + 2]! + az * h;
    } else if (s.brush === 'inflate') {
      const h = sign * step * 0.08 * wk;
      p[o] = p[o]! + nn[o]! * h;
      p[o + 1] = p[o + 1]! + nn[o + 1]! * h;
      p[o + 2] = p[o + 2]! + nn[o + 2]! * h;
    } else if (s.brush === 'flatten') {
      const d = (p[o]! - cx) * ax + (p[o + 1]! - cy) * ay + (p[o + 2]! - cz) * az;
      const h = -d * Math.min(1, wk * s.strength * 1.2);
      p[o] = p[o]! + ax * h;
      p[o + 1] = p[o + 1]! + ay * h;
      p[o + 2] = p[o + 2]! + az * h;
    } else if (s.brush === 'pinch') {
      // К середине мазка вдоль поверхности (складка); с ⌥ — от неё.
      let dx = s.at[0] - p[o]!;
      let dy = s.at[1] - p[o + 1]!;
      let dz = s.at[2] - p[o + 2]!;
      const dn = dx * ax + dy * ay + dz * az;
      dx -= ax * dn;
      dy -= ay * dn;
      dz -= az * dn;
      const h = sign * Math.min(0.5, wk * s.strength * 0.35);
      p[o] = p[o]! + dx * h;
      p[o + 1] = p[o + 1]! + dy * h;
      p[o + 2] = p[o + 2]! + dz * h;
    } else if (s.brush === 'paint') {
      const c = s.color ?? [1, 1, 1];
      const t = Math.min(1, wk * s.strength * 1.5);
      for (let q = 0; q < 3; q++) m.col[o + q] = m.col[o + q]! + (c[q]! - m.col[o + q]!) * t;
      continue;
    }
    touched.add(i);
  }
}

/** Захват для кисти «Двигать»: вершины и веса на начало мазка (и зеркальные, если лепка симметричная). */
export interface Grab {
  ids: Uint32Array;
  w: Float32Array;
  /** Зеркальная часть: сдвиг по x у неё обратный. */
  mirrored: Uint8Array;
  start: Float32Array;
}

export function grabStart(m: SculptMesh, at: V3, r: number, sym: boolean): Grab {
  const a = gather(m, at, r);
  const ids: number[] = Array.from(a.ids);
  const w: number[] = Array.from(a.w);
  const mir: number[] = ids.map(() => 0);
  if (sym && Math.abs(at[0]) > r * 0.15) {
    const b = gather(m, mirror(at), r);
    const have = new Set(ids);
    b.ids.forEach((i, k) => {
      if (have.has(i)) return;
      ids.push(i);
      w.push(b.w[k]!);
      mir.push(1);
    });
  }
  const start = new Float32Array(ids.length * 3);
  ids.forEach((i, k) => start.set(m.pos.subarray(i * 3, i * 3 + 3), k * 3));
  return { ids: Uint32Array.from(ids), w: Float32Array.from(w), mirrored: Uint8Array.from(mir), start };
}

/** Сдвинуть захваченное на delta (от начала мазка). Возвращает вершины для пересчёта нормалей. */
export function grabMove(m: SculptMesh, g: Grab, delta: V3): Set<number> {
  const ring = new Set<number>();
  for (let k = 0; k < g.ids.length; k++) {
    const i = g.ids[k]!;
    const wk = g.w[k]!;
    const sx = g.mirrored[k] ? -delta[0] : delta[0];
    m.pos[i * 3] = g.start[k * 3]! + sx * wk;
    m.pos[i * 3 + 1] = g.start[k * 3 + 1]! + delta[1] * wk;
    m.pos[i * 3 + 2] = g.start[k * 3 + 2]! + delta[2] * wk;
    ring.add(i);
    for (let j = m.adjStart[i]!; j < m.adjStart[i + 1]!; j++) ring.add(m.adj[j]!);
  }
  computeNormals(m, ring);
  return ring;
}

// ───────────────────────────── ограничения игры ─────────────────────────────

/** Бюджеты треугольников модели в игре (docs/vylazka/modeling.md: модели и сканы — 3–8 тысяч). */
export const BUDGETS = { small: 1500, thing: 4000, big: 8000 } as const;
export type Budget = keyof typeof BUDGETS;
/** Потолок обычного помещения и клетка плана, м: вещь выше или шире в помещение не встанет. */
export const ROOM_H = 2.6;
export const ROOM_W = 3;
/** Индексы модели в игре — 16 бит. */
export const MAX_VERTS = 65535;

/** Как вещь крепится в мире: стоит на полу, висит на стене (спина в z = 0), под потолком (верх в y = 0), свободно. */
export type Mount = 'floor' | 'wall' | 'ceiling' | 'free';

function boundsOf(m: SculptMesh, ids: readonly number[]): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const i of ids) {
    for (let k = 0; k < 3; k++) {
      const v = m.pos[i * 3 + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return { min, max };
}

export function bounds(m: SculptMesh): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = m.pos[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return { min, max };
}

/** Что не так с вещью для игры (пусто — всё годится). */
export function problems(m: SculptMesh, mount: Mount): string[] {
  const { min, max } = bounds(m);
  const out: string[] = [];
  const h = max[1] - min[1];
  if (h > ROOM_H - 0.05) out.push(`выше потолка: ${h.toFixed(2)} м при потолке ${ROOM_H} м`);
  if (max[0] - min[0] > ROOM_W - 0.3 || max[2] - min[2] > ROOM_W - 0.3) out.push(`шире клетки плана: ${(max[0] - min[0]).toFixed(2)} × ${(max[2] - min[2]).toFixed(2)} м при ${ROOM_W} м`);
  if (mount === 'floor' && min[1] > 0.02) out.push(`висит над полом на ${Math.round(min[1] * 100)} см — при выгрузке встанет на пол`);
  if (mount === 'floor' && min[1] < -0.02) out.push(`уходит под пол на ${Math.round(-min[1] * 100)} см — при выгрузке поднимется на пол`);
  if (h < 0.03) out.push('слишком плоская или мелкая: меньше 3 см в игре не видно');
  return out;
}

/** Сдвиг к началу координат реквизита по креплению (как в scripts/import_models.py и world/models.ts). */
export function mountOffset(m: SculptMesh, mount: Mount, only?: readonly number[]): V3 {
  const { min, max } = only ? boundsOf(m, only) : bounds(m);
  const cx = (min[0] + max[0]) / 2;
  const cz = (min[2] + max[2]) / 2;
  if (mount === 'floor') return [-cx, -min[1], -cz];
  if (mount === 'wall') return [-cx, -min[1], -min[2]];
  if (mount === 'ceiling') return [-cx, -max[1], -cz];
  return [-cx, -(min[1] + max[1]) / 2, -cz];
}

/** Запись модели игры (world/models_data.ts, ModelRecord). */
export interface ModelRecord {
  v: number;
  t: number;
  min: [number, number, number];
  max: [number, number, number];
  pos: string;
  nrm: string;
  col: string;
  idx: string;
}

/** Упрощение снаружи (meshoptimizer в браузере): индексы → меньше индексов; позиции — для формы. */
export type Simplify = (idx: Uint32Array, pos: Float32Array, targetIndexCount: number) => Uint32Array;

const b64 = (u8: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};

const srgb8 = (v: number): number => {
  const c = v <= 0 ? 0 : v >= 1 ? 1 : v;
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
};

/**
 * Выгрузить в запись модели игры: упростить до бюджета, выкинуть неиспользуемые вершины, поставить по
 * креплению, сжать (позиции — 16 бит по габариту, нормали — 8 бит, цвет — sRGB 8 бит, индексы — 16 бит).
 */
export function toRecord(m: SculptMesh, mount: Mount, maxTris: number, simplify?: Simplify): { record: ModelRecord; tris: number; verts: number } {
  let idx = m.idx;
  if (tcount(m) > maxTris && simplify) idx = simplify(m.idx, m.pos, maxTris * 3);
  // Только вершины, которые остались в треугольниках.
  const remap = new Int32Array(vcount(m)).fill(-1);
  const order: number[] = [];
  for (const i of idx) if (remap[i] === -1) remap[i] = order.push(i) - 1;
  if (order.length > MAX_VERTS) throw new Error(`вершин ${order.length} — больше ${MAX_VERTS}`);
  // Ставим по тому, что осталось после упрощения: габарит считается по нему.
  const off = mountOffset(m, mount, order);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const i of order) {
    for (let k = 0; k < 3; k++) {
      const v = m.pos[i * 3 + k]! + off[k]!;
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  const nv = order.length;
  const pq = new Uint16Array(nv * 3);
  const nq = new Int8Array(nv * 3);
  const cq = new Uint8Array(nv * 3);
  order.forEach((i, j) => {
    for (let k = 0; k < 3; k++) {
      const span = max[k] - min[k] || 1;
      pq[j * 3 + k] = Math.round(((m.pos[i * 3 + k]! + off[k]! - min[k]) / span) * 65535);
      nq[j * 3 + k] = Math.round(Math.max(-1, Math.min(1, m.nrm[i * 3 + k]!)) * 127);
      cq[j * 3 + k] = srgb8(m.col[i * 3 + k]!);
    }
  });
  const iq = new Uint16Array(idx.length);
  for (let k = 0; k < idx.length; k++) iq[k] = remap[idx[k]!]!;
  const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;
  return {
    record: {
      v: nv,
      t: idx.length / 3,
      min: [r4(min[0]), r4(min[1]), r4(min[2])],
      max: [r4(max[0]), r4(max[1]), r4(max[2])],
      pos: b64(new Uint8Array(pq.buffer)),
      nrm: b64(new Uint8Array(nq.buffer)),
      col: b64(cq),
      idx: b64(new Uint8Array(iq.buffer)),
    },
    tris: idx.length / 3,
    verts: nv,
  };
}

// ───────────────────────────── сохранение работы ─────────────────────────────

/** Работа целиком (вся плотность сетки, краска): чтобы вернуться к ней и лепить дальше. */
export interface WorkFile {
  v: 1;
  pos: string;
  col: string;
  idx: string;
}

export function saveWork(m: SculptMesh): WorkFile {
  const cq = new Uint8Array(m.col.length);
  for (let i = 0; i < m.col.length; i++) cq[i] = srgb8(m.col[i]!);
  return { v: 1, pos: b64(new Uint8Array(m.pos.buffer.slice(m.pos.byteOffset, m.pos.byteOffset + m.pos.byteLength))), col: b64(cq), idx: b64(new Uint8Array(m.idx.buffer.slice(m.idx.byteOffset, m.idx.byteOffset + m.idx.byteLength))) };
}

const unb64 = (s: string): Uint8Array => {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};

const lin = (s8: number): number => {
  const s = s8 / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

export function loadWork(w: WorkFile): SculptMesh {
  const pos = new Float32Array(unb64(w.pos).buffer);
  const idx = new Uint32Array(unb64(w.idx).buffer);
  const cq = unb64(w.col);
  const col = new Float32Array(cq.length);
  for (let i = 0; i < cq.length; i++) col[i] = lin(cq[i]!);
  return makeMesh(pos, idx, col);
}
