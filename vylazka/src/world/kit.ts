/**
 * Сборщик геометрии мира из примитивов. Чистый TS без three.js: работает в Worker и в тестах.
 * Вершина несёт: позицию, нормаль, тон (rgb) с запечённым AO (a), номер материала в атласе matcap
 * и uv для грязи — плоскость проекции выбирается здесь по главной оси нормали (одна выборка в шейдере).
 * Обход вершин — против часовой стрелки, если смотреть с лицевой стороны.
 */
import type { Vec3 } from '../core/types';

export interface MeshData {
  position: Float32Array;
  normal: Float32Array;
  /** rgb — тон, a — AO (1 — открыто, 0 — глухой угол). */
  color: Float32Array;
  /** Номер материала в атласе matcap (один на треугольник, задублирован в вершинах). */
  mat: Float32Array;
  uv: Float32Array;
  index: Uint32Array;
}

export const WHITE: Vec3 = [1, 1, 1];

export interface BoxOpts {
  tint?: Vec3;
  /** Общий множитель AO (0..1). */
  ao?: number;
  /** AO нижних вершин: имитация контактной тени у пола. */
  aoBottom?: number;
  /** Фаска рёбер, м. 0 — без фаски. */
  bevel?: number;
  /** Грани, которые не строить: 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz'. */
  skip?: readonly Face[];
}

export type Face = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
export type Axis = 'x' | 'y' | 'z';

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 1, 0];
}

/** uv для грязи: метры в плоскости, перпендикулярной главной оси нормали. */
export function planarUv(p: Vec3, n: Vec3): [number, number] {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  if (ay >= ax && ay >= az) return [p[0], p[2]];
  if (ax >= az) return [p[2], p[1]];
  return [p[0], p[1]];
}

export class MeshBuilder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly col: number[] = [];
  private readonly mats: number[] = [];
  private readonly uvs: number[] = [];
  private readonly idx: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  /** Низкоуровневая вершина; возвращает её индекс. */
  vertex(p: Vec3, n: Vec3, mat: number, tint: Vec3 = WHITE, ao = 1): number {
    const i = this.pos.length / 3;
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.col.push(tint[0], tint[1], tint[2], ao);
    this.mats.push(mat);
    const uv = planarUv(p, n);
    this.uvs.push(uv[0], uv[1]);
    return i;
  }

  /**
   * Четырёхугольник с явными uv (надписи и плакаты: uv указывает в атлас, а не в мир).
   * Обход p0→p1→p2→p3 — против часовой с лица.
   */
  quadUv(p: readonly [Vec3, Vec3, Vec3, Vec3], uv: readonly [number, number, number, number], mat: number, tint: Vec3 = WHITE, ao = 1): void {
    const n = normalize(cross(sub(p[1], p[0]), sub(p[3], p[0])));
    const [u0, v0, u1, v1] = uv;
    const corners: readonly [number, number][] = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ];
    const first = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      const q = p[i]!;
      this.pos.push(q[0], q[1], q[2]);
      this.nrm.push(n[0], n[1], n[2]);
      this.col.push(tint[0], tint[1], tint[2], ao);
      this.mats.push(mat);
      this.uvs.push(corners[i]![0], corners[i]![1]);
    }
    this.idx.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /** Плоский четырёхугольник p0→p1→p2→p3 (против часовой с лица). ao — одно число или по вершинам. */
  quad(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, mat: number, tint: Vec3 = WHITE, ao: number | readonly [number, number, number, number] = 1): void {
    const n = normalize(cross(sub(p1, p0), sub(p3, p0)));
    const a = typeof ao === 'number' ? ([ao, ao, ao, ao] as const) : ao;
    const i0 = this.vertex(p0, n, mat, tint, a[0]);
    const i1 = this.vertex(p1, n, mat, tint, a[1]);
    const i2 = this.vertex(p2, n, mat, tint, a[2]);
    const i3 = this.vertex(p3, n, mat, tint, a[3]);
    this.idx.push(i0, i1, i2, i0, i2, i3);
  }

  /** Четырёхугольник, лицо которого смотрит в сторону outward (порядок вершин исправляется сам). */
  quadFacing(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, outward: Vec3, mat: number, tint: Vec3 = WHITE, ao: number | readonly [number, number, number, number] = 1): void {
    const n = cross(sub(p1, p0), sub(p3, p0));
    if (dot(n, outward) >= 0) this.quad(p0, p1, p2, p3, mat, tint, ao);
    else {
      const a = typeof ao === 'number' ? ao : ([ao[0], ao[3], ao[2], ao[1]] as const);
      this.quad(p0, p3, p2, p1, mat, tint, a);
    }
  }

  private triFacing(p0: Vec3, p1: Vec3, p2: Vec3, outward: Vec3, mat: number, tint: Vec3, ao: number): void {
    let n = normalize(cross(sub(p1, p0), sub(p2, p0)));
    let b = p1;
    let c = p2;
    if (dot(n, outward) < 0) {
      n = [-n[0], -n[1], -n[2]];
      b = p2;
      c = p1;
    }
    const i0 = this.vertex(p0, n, mat, tint, ao);
    const i1 = this.vertex(b, n, mat, tint, ao);
    const i2 = this.vertex(c, n, mat, tint, ao);
    this.idx.push(i0, i1, i2);
  }

  /** Параллелепипед по двум углам; с фаской — срезанные рёбра и углы (ловят блик, дают «игрушечную» детальность). */
  box(min: Vec3, max: Vec3, mat: number, opts: BoxOpts = {}): void {
    const tint = opts.tint ?? WHITE;
    const ao = opts.ao ?? 1;
    const aoB = ao * (opts.aoBottom ?? 1);
    const skip = opts.skip ?? [];
    const c: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const h: Vec3 = [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2];
    const b = Math.max(0, Math.min(opts.bevel ?? 0, Math.min(h[0], h[1], h[2]) * 0.9));
    const aoAt = (y: number): number => (y < c[1] ? aoB : ao);
    const faceName = (axis: number, s: number): Face => ((s > 0 ? 'p' : 'n') + 'xyz'[axis]) as Face;

    // Шесть граней (с фаской — ужатые на b по двум другим осям).
    for (let axis = 0; axis < 3; axis++) {
      const u = (axis + 1) % 3;
      const v = (axis + 2) % 3;
      for (const s of [1, -1]) {
        if (skip.includes(faceName(axis, s))) continue;
        const mk = (su: number, sv: number): Vec3 => {
          const p: Vec3 = [0, 0, 0];
          p[axis] = c[axis]! + s * h[axis]!;
          p[u] = c[u]! + su * (h[u]! - b);
          p[v] = c[v]! + sv * (h[v]! - b);
          return p;
        };
        const p0 = mk(-1, -1);
        const p1 = mk(1, -1);
        const p2 = mk(1, 1);
        const p3 = mk(-1, 1);
        const out: Vec3 = [0, 0, 0];
        out[axis] = s;
        this.quadFacing(p0, p1, p2, p3, out, mat, tint, [aoAt(p0[1]), aoAt(p1[1]), aoAt(p2[1]), aoAt(p3[1])]);
      }
    }
    if (b <= 0) return;

    // Двенадцать фасок рёбер: ребро между гранями (a, sa) и (bx, sb), тянется вдоль третьей оси w.
    for (let a = 0; a < 3; a++) {
      const bx = (a + 1) % 3;
      const w = (a + 2) % 3;
      for (const sa of [1, -1]) {
        for (const sb of [1, -1]) {
          if (skip.includes(faceName(a, sa)) && skip.includes(faceName(bx, sb))) continue;
          const mk = (onA: boolean, sw: number): Vec3 => {
            const p: Vec3 = [0, 0, 0];
            p[a] = c[a]! + sa * (onA ? h[a]! : h[a]! - b);
            p[bx] = c[bx]! + sb * (onA ? h[bx]! - b : h[bx]!);
            p[w] = c[w]! + sw * (h[w]! - b);
            return p;
          };
          const p0 = mk(true, -1);
          const p1 = mk(true, 1);
          const p2 = mk(false, 1);
          const p3 = mk(false, -1);
          const out: Vec3 = [0, 0, 0];
          out[a] = sa;
          out[bx] = sb;
          this.quadFacing(p0, p1, p2, p3, out, mat, tint, [aoAt(p0[1]), aoAt(p1[1]), aoAt(p2[1]), aoAt(p3[1])]);
        }
      }
    }
    // Восемь срезанных углов.
    for (const sx of [1, -1]) {
      for (const sy of [1, -1]) {
        for (const sz of [1, -1]) {
          const p0: Vec3 = [c[0] + sx * h[0], c[1] + sy * (h[1] - b), c[2] + sz * (h[2] - b)];
          const p1: Vec3 = [c[0] + sx * (h[0] - b), c[1] + sy * h[1], c[2] + sz * (h[2] - b)];
          const p2: Vec3 = [c[0] + sx * (h[0] - b), c[1] + sy * (h[1] - b), c[2] + sz * h[2]];
          this.triFacing(p0, p1, p2, [sx, sy, sz], mat, tint, sy < 0 ? aoB : ao);
        }
      }
    }
  }

  /**
   * Цилиндр вдоль оси: base — центр нижнего (по оси) торца. Нормали боковой поверхности сглажены —
   * трубы под matcap выглядят круглыми даже при 8 гранях.
   */
  cylinder(base: Vec3, axis: Axis, length: number, radius: number, mat: number, opts: { tint?: Vec3; ao?: number; segments?: number; caps?: boolean; radiusEnd?: number } = {}): void {
    const tint = opts.tint ?? WHITE;
    const ao = opts.ao ?? 1;
    const seg = Math.max(3, opts.segments ?? 8);
    const r1 = opts.radiusEnd ?? radius;
    const a = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const u = (a + 1) % 3;
    const v = (a + 2) % 3;
    const ring = (t: number, r: number): { p: Vec3[]; n: Vec3[] } => {
      const p: Vec3[] = [];
      const n: Vec3[] = [];
      for (let i = 0; i < seg; i++) {
        const ang = (i / seg) * Math.PI * 2;
        const cu = Math.cos(ang);
        const sv = Math.sin(ang);
        const pt: Vec3 = [base[0], base[1], base[2]];
        pt[a] = pt[a]! + t;
        pt[u] = pt[u]! + cu * r;
        pt[v] = pt[v]! + sv * r;
        const nn: Vec3 = [0, 0, 0];
        nn[u] = cu;
        nn[v] = sv;
        p.push(pt);
        n.push(nn);
      }
      return { p, n };
    };
    const lo = ring(0, radius);
    const hi = ring(length, r1);
    const iLo = lo.p.map((p, i) => this.vertex(p, lo.n[i]!, mat, tint, ao));
    const iHi = hi.p.map((p, i) => this.vertex(p, hi.n[i]!, mat, tint, ao));
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      // u × v = ось, поэтому обход lo[i] → lo[j] → hi[j] смотрит наружу.
      this.idx.push(iLo[i]!, iLo[j]!, iHi[j]!, iLo[i]!, iHi[j]!, iHi[i]!);
    }
    if (opts.caps === false) return;
    for (const [pts, s, t] of [
      [lo.p, -1, 0],
      [hi.p, 1, length],
    ] as const) {
      const nn: Vec3 = [0, 0, 0];
      nn[a] = s;
      const center: Vec3 = [base[0], base[1], base[2]];
      center[a] = center[a]! + t;
      const ic = this.vertex(center, nn, mat, tint, ao);
      const ir = pts.map((p) => this.vertex(p, nn, mat, tint, ao));
      for (let i = 0; i < seg; i++) {
        const j = (i + 1) % seg;
        if (s > 0) this.idx.push(ic, ir[i]!, ir[j]!);
        else this.idx.push(ic, ir[j]!, ir[i]!);
      }
    }
  }

  build(): MeshData {
    return {
      position: new Float32Array(this.pos),
      normal: new Float32Array(this.nrm),
      color: new Float32Array(this.col),
      mat: new Float32Array(this.mats),
      uv: new Float32Array(this.uvs),
      index: new Uint32Array(this.idx),
    };
  }
}
