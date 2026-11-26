// Набросок: огромные бумажные цветы в комнате убежища. Исследовательский код к записи V-11
// в docs/vylazka/ideas.md — не часть игры, в сборку и проверки не входит. Запуск — в README.md рядом.
// Набросок: огромные бумажные цветы в комнате убежища (вне игры, проверка вида). Программный рендер с z-буфером.
import { writeFileSync } from 'node:fs';
import { generateLayout } from '../../../../vylazka/src/gen/layout';
import { buildLevel } from '../../../../vylazka/src/world/level_build';
import { mulberry32 } from '../../../../vylazka/src/core/rng';
import { MAT_DEFS, DECAY, hexToLinear } from '../../../../vylazka/src/world/materials';

const OUT = process.env.OUT ?? '.';
const env = (k: string, d: number): number => (process.env[k] ? Number(process.env[k]) : d);
const t0 = Date.now();
type V3 = [number, number, number];
const PI = Math.PI, TAU = 2 * Math.PI, D2R = PI / 180;
const sm = (a: number, b: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- Комната (как в исходнике, но коробка по комнате) ----------
const lv: any = buildLevel(generateLayout(20041113, 2, 'shelter'));
const chunk = lv.chunks.find((c: any) => c.mesh.obj && c.mesh.obj.includes(28));
const m = chunk.mesh;
const SUB_DECAY = DECAY; void SUB_DECAY;
const albedo = MAT_DEFS.map((d) => hexToLinear(d.color));
const DENS = env('DENS', 900), rstep = 1 / Math.sqrt(DENS), rnd = mulberry32(777);
const RP: number[] = [], RN: number[] = [], RC: number[] = [];
for (let t = 0; t < m.index.length; t += 3) {
  const [a, b, c] = [m.index[t], m.index[t + 1], m.index[t + 2]];
  const v = (i: number, k: number): number => m.position[3 * i + k];
  const gx = (v(a, 0) + v(b, 0) + v(c, 0)) / 3, gy = (v(a, 1) + v(b, 1) + v(c, 1)) / 3, gz = (v(a, 2) + v(b, 2) + v(c, 2)) / 3;
  if (gx < -4.4 || gx > 1.5 || gz < -16.5 || gz > -10.5 || gy < -0.05 || gy > 3) continue;
  const e1 = [v(b, 0) - v(a, 0), v(b, 1) - v(a, 1), v(b, 2) - v(a, 2)], e2 = [v(c, 0) - v(a, 0), v(c, 1) - v(a, 1), v(c, 2) - v(a, 2)];
  const area = 0.5 * Math.hypot(e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!);
  let cnt = Math.floor(area * DENS + rnd());
  const al = albedo[Math.round(m.mat[a])]!;
  while (cnt-- > 0) {
    let u = rnd(), w = rnd(); if (u + w > 1) { u = 1 - u; w = 1 - w; } const o = 1 - u - w, ws = [o, u, w], vs = [a, b, c];
    let px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0, cr = 0, cg = 0, cb = 0, ao = 0;
    for (let q = 0; q < 3; q++) { const i = vs[q]!, k = ws[q]!; px += k * v(i, 0); py += k * v(i, 1); pz += k * v(i, 2); nx += k * m.normal[3 * i]; ny += k * m.normal[3 * i + 1]; nz += k * m.normal[3 * i + 2]; cr += k * m.color[4 * i]; cg += k * m.color[4 * i + 1]; cb += k * m.color[4 * i + 2]; ao += k * m.color[4 * i + 3]; }
    const l = Math.hypot(nx, ny, nz) || 1; RP.push(px, py, pz); RN.push(nx / l, ny / l, nz / l);
    const f = 0.3 + 0.7 * ao; RC.push(al[0] * cr * f, al[1] * cg * f, al[2] * cb * f);
  }
}
const NR = RP.length / 3, rpos = Float32Array.from(RP), rnrm = Float32Array.from(RN), rcol = Float32Array.from(RC);
console.log('room points', NR);

// ---------- Утилиты ----------
const prng = mulberry32(31337);
const R01 = (): number => prng();
const hash = (x: number, y: number, z: number): number => { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177); h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
const noise3 = (x: number, y: number, z: number): number => { // значение-шум в [-1,1]
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = x - xi, fy = y - yi, fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number, c: number): number => hash(xi + a, yi + b, zi + c);
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  return 2 * l(l(l(h(0, 0, 0), h(1, 0, 0), sx), l(h(0, 1, 0), h(1, 1, 0), sx), sy), l(l(h(0, 0, 1), h(1, 0, 1), sx), l(h(0, 1, 1), h(1, 1, 1), sx), sy), sz) - 1;
};
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const len3 = (a: V3): number => Math.hypot(a[0], a[1], a[2]);

interface Xf { R: number[]; T: V3 }
const ident = (): Xf => ({ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], T: [0, 0, 0] });
const applyP = (X: Xf, p: V3): V3 => [X.R[0]! * p[0] + X.R[1]! * p[1] + X.R[2]! * p[2] + X.T[0], X.R[3]! * p[0] + X.R[4]! * p[1] + X.R[5]! * p[2] + X.T[1], X.R[6]! * p[0] + X.R[7]! * p[1] + X.R[8]! * p[2] + X.T[2]];
const applyN = (X: Xf, p: V3): V3 => [X.R[0]! * p[0] + X.R[1]! * p[1] + X.R[2]! * p[2], X.R[3]! * p[0] + X.R[4]! * p[1] + X.R[5]! * p[2], X.R[6]! * p[0] + X.R[7]! * p[1] + X.R[8]! * p[2]];
const comp = (A: Xf, B: Xf): Xf => { const r: number[] = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.push(A.R[3 * i]! * B.R[j]! + A.R[3 * i + 1]! * B.R[3 + j]! + A.R[3 * i + 2]! * B.R[6 + j]!); return { R: r, T: applyP(A, B.T) }; };
// система координат: локальная ось x → x, локальная z → z (ортогонализуется), y = z × x.
const frame = (x: V3, z: V3, T: V3): Xf => { const zz = norm(z); const xx = norm(sub(x, mul(zz, dot(x, zz)))); const yy = cross(zz, xx); return { R: [xx[0], yy[0], zz[0], xx[1], yy[1], zz[1], xx[2], yy[2], zz[2]], T }; };
// «лицом» вдоль dir, верх ≈ вверх мира, крен roll.
const facing = (dir: V3, T: V3, roll = 0): Xf => { const z = norm(dir); let x = norm(cross([0, 1, 0], z)); if (len3(cross([0, 1, 0], z)) < 1e-3) x = [1, 0, 0]; const c = Math.cos(roll), s = Math.sin(roll); const y = cross(z, x); return frame(add(mul(x, c), mul(y, s)), z, T); };

// ---------- Накопитель точек ----------
const STEP = env('STEP', 0.003);
let cap = 1 << 21, np = 0;
let bP = new Float32Array(cap * 3), bN = new Float32Array(cap * 3), bC = new Float32Array(cap * 3), bE = new Uint8Array(cap);
const grow = (): void => { cap *= 2; const f = (a: Float32Array, k: number): Float32Array => { const r = new Float32Array(cap * k); r.set(a); return r; }; bP = f(bP, 3); bN = f(bN, 3); bC = f(bC, 3); const e = new Uint8Array(cap); e.set(bE); bE = e; };
interface El { name: string; c: V3; r: number; i0: number; i1: number }
const els: El[] = []; let cur: El | null = null;
const beginEl = (name: string, c: V3, r: number): void => { cur = { name, c, r, i0: np, i1: np }; els.push(cur); };
const endEl = (): void => { cur!.i1 = np; cur = null; };
const OCH: V3 = [0.85, 0.56, 0.2], WHT: V3 = [0.93, 0.91, 0.86];
const CRUMPLE = env('CRUMPLE', 0.22);
function emit(p: V3, n: V3, t: number, tint: number): void {
  if (np >= cap) grow();
  // мятость: детерминированный шум в нормали (две октавы)
  const f1 = 22, f2 = 63;
  const g1: V3 = [noise3(p[0] * f1, p[1] * f1, p[2] * f1), noise3(p[0] * f1 + 17.3, p[1] * f1 + 5.1, p[2] * f1 + 9.7), noise3(p[0] * f1 + 3.9, p[1] * f1 + 31.7, p[2] * f1 + 11.3)];
  const g2: V3 = [noise3(p[0] * f2, p[1] * f2, p[2] * f2), noise3(p[0] * f2 + 7.7, p[1] * f2 + 1.3, p[2] * f2 + 5.9), noise3(p[0] * f2 + 2.1, p[1] * f2 + 8.3, p[2] * f2 + 4.4)];
  const nn = norm([n[0] + CRUMPLE * g1[0] + 0.4 * CRUMPLE * g2[0], n[1] + CRUMPLE * g1[1] + 0.4 * CRUMPLE * g2[1], n[2] + CRUMPLE * g1[2] + 0.4 * CRUMPLE * g2[2]]);
  const k = sm(0.25, 1.0, Math.max(0, Math.min(1, t + tint)));
  const nz = 1 + 0.05 * noise3(p[0] * 45, p[1] * 45, p[2] * 45);
  // складки/ворс: тёмные прожилки по шуму
  const fib = 1 - 0.07 * Math.abs(noise3(p[0] * 9, p[1] * 9, p[2] * 9));
  bP[3 * np] = p[0]; bP[3 * np + 1] = p[1]; bP[3 * np + 2] = p[2];
  bN[3 * np] = nn[0]; bN[3 * np + 1] = nn[1]; bN[3 * np + 2] = nn[2];
  for (let q = 0; q < 3; q++) bC[3 * np + q] = (OCH[q]! + (WHT[q]! - OCH[q]!) * k) * nz * fib;
  bE[np] = els.length; np++;
}
interface SurfOpt { mask?: (u: number, v: number) => boolean; minNv?: number; tint?: number; flip?: boolean }
// Поверхность fn(u,v) → точки с шагом ≈ STEP. tip(u,v) — «концовость» 0..1 (цвет).
function surf(fn: (u: number, v: number) => V3, u0: number, u1: number, v0: number, v1: number, tip: (u: number, v: number) => number, X: Xf, o: SurfOpt = {}): void {
  const lenAt = (fixed: number, a0: number, a1: number, alongU: boolean): number => { let L = 0, pr = alongU ? fn(a0, fixed) : fn(fixed, a0); for (let i = 1; i <= 14; i++) { const a = a0 + (a1 - a0) * i / 14; const q = alongU ? fn(a, fixed) : fn(fixed, a); L += len3(sub(q, pr)); pr = q; } return L; };
  const lu = Math.max(lenAt(v0, u0, u1, true), lenAt((v0 + v1) / 2, u0, u1, true), lenAt(v1, u0, u1, true));
  const nu = Math.max(2, Math.ceil(lu / STEP));
  for (let i = 0; i < nu; i++) {
    const u = u0 + (i + 0.5 + (R01() - 0.5) * 0.9) / nu * (u1 - u0);
    const lv = lenAt(u, v0, v1, false), nv = Math.max(o.minNv ?? 1, Math.ceil(lv / STEP));
    const du = (u1 - u0) / nu * 0.5, dv = (v1 - v0) / nv * 0.5;
    for (let j = 0; j < nv; j++) {
      const v = v0 + (j + 0.5 + (R01() - 0.5) * 0.9) / nv * (v1 - v0);
      if (o.mask && !o.mask(u, v)) continue;
      const p = fn(u, v);
      const pu = sub(fn(u + du, v), fn(u - du, v)), pv = sub(fn(u, v + dv), fn(u, v - dv));
      let n = cross(pu, pv); const ln = len3(n); if (!(ln > 1e-14) || !isFinite(p[0] + p[1] + p[2])) continue; n = mul(n, 1 / ln);
      emit(applyP(X, p), applyN(X, n), tip(u, v), (o.tint ?? 0) + 0.05 * (R01() - 0.5));
    }
  }
}
// Трубка по пути c(t), радиус rad(t)
function tube(c: (t: number) => V3, rad: (t: number) => number, X: Xf, tip: (t: number) => number, t0 = 0, t1 = 1): void {
  const fr = (t: number): [V3, V3, V3] => { const e = 1e-3; const T = norm(sub(c(Math.min(1, t + e)), c(Math.max(0, t - e)))); const h: V3 = Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; const N = norm(cross(h, T)); return [T, N, cross(T, N)]; };
  surf((t, f) => { const [, N, B] = fr(t); const r = rad(t); const p = c(t); return [p[0] + r * (Math.cos(f) * N[0] + Math.sin(f) * B[0]), p[1] + r * (Math.cos(f) * N[1] + Math.sin(f) * B[1]), p[2] + r * (Math.cos(f) * N[2] + Math.sin(f) * B[2])]; }, t0, t1, 0, TAU, (t) => tip(t), X, { minNv: 4 });
}
const bez = (a: V3, b: V3, c: V3, d: V3) => (t: number): V3 => { const s = 1 - t; return [s * s * s * a[0] + 3 * s * s * t * b[0] + 3 * s * t * t * c[0] + t * t * t * d[0], s * s * s * a[1] + 3 * s * s * t * b[1] + 3 * s * t * t * c[1] + t * t * t * d[1], s * s * s * a[2] + 3 * s * s * t * b[2] + 3 * s * t * t * c[2] + t * t * t * d[2]]; };

// Лист-лепесток в локальной раме: длина вдоль +x, лицо +z, ширина по y. Изгиб kap (кривизна), желобок gut, волна края wa/wf.
const petalFn = (L: number, wm: number, wprof: (s: number) => number, kap: number, gut: number, wa: number, wf: number, ph: number) => (s: number, v: number): V3 => {
  const W = wm * wprof(s), th = kap * s;
  const cx = Math.abs(kap) < 1e-4 ? L * s : L * Math.sin(th) / kap, cz = Math.abs(kap) < 1e-4 ? 0 : L * (1 - Math.cos(th)) / kap;
  const y = v * W * (1 + 0.07 * Math.sin(wf * TAU * s + ph));
  const d = gut * W * v * v + wa * Math.sin(wf * TAU * s + ph * 1.7) * Math.pow(Math.abs(v), 1.4);
  return [cx - Math.sin(th) * d, y, cz + Math.cos(th) * d];
};
// тело вращения вокруг оси z: r(s,θ), длина L
const revolve = (L: number, r: (s: number, th: number) => number) => (s: number, th: number): V3 => { const rr = r(s, th); return [rr * Math.cos(th), rr * Math.sin(th), L * s]; };

// ---------- 1. Гвоздика ----------
function carnation(X: Xf): void {
  const rings = [{ a: 0.07, w: 0.20, c: 62, z: 0.20, n: 20, A: 0.045 }, { a: 0.19, w: 0.21, c: 48, z: 0.13, n: 23, A: 0.05 }, { a: 0.33, w: 0.23, c: 34, z: 0.06, n: 26, A: 0.06 }, { a: 0.46, w: 0.25, c: 20, z: 0, n: 28, A: 0.07 }];
  rings.forEach((rg, k) => {
    const c = rg.c * D2R, ph = k * 1.7, teeth = rg.n * 3, seed = k * 91;
    const edge = (th: number): number => { const q = th / TAU * teeth, i = Math.floor(q), tri = Math.abs(q - i - 0.5) * 2; return 1 - 0.16 * tri - 0.05 * hash(i, seed, 3); };
    surf((th, v) => {
      const wave = rg.A * Math.pow(v, 1.3) * Math.sin(rg.n * th + ph) + 0.35 * rg.A * v * v * Math.sin(2 * rg.n * th + 1 + ph);
      const rad = rg.a + rg.w * v * Math.cos(c) - Math.sin(c) * wave;
      return [rad * Math.cos(th), rad * Math.sin(th), rg.z + rg.w * v * Math.sin(c) + Math.cos(c) * wave];
    }, 0, TAU, 0, 1, (_th, v) => v, X, { mask: (th, v) => v <= edge(th) });
  });
  // пучок тычинок
  for (let i = 0; i < 12; i++) {
    const az = R01() * TAU, pol = (6 + R01() * 30) * D2R, L = 0.22 + R01() * 0.1, bend = (R01() - 0.5) * 0.08;
    const d: V3 = [Math.sin(pol) * Math.cos(az), Math.sin(pol) * Math.sin(az), Math.cos(pol)], side: V3 = [-Math.sin(az), Math.cos(az), 0];
    tube((t) => add(add([0, 0, 0.1], mul(d, L * t)), mul(side, bend * t * t * 3)), (t) => 0.0035 * (1 - 0.3 * t), X, (t) => 0.4 + 0.5 * t);
  }
}
// ---------- 2. Георгин ----------
function dahlia(X: Xf): void {
  const rows = [{ n: 16, r0: 0.04, L: 0.42, phi: -18, kap: -0.7, z0: 0.0, wm: 0.048, off: 0 }, { n: 15, r0: 0.04, L: 0.34, phi: 14, kap: 0.2, z0: 0.05, wm: 0.046, off: 0.5 }, { n: 14, r0: 0.03, L: 0.27, phi: 48, kap: 0.9, z0: 0.1, wm: 0.042, off: 0.25 }];
  const wprof = (s: number): number => Math.pow(s, 0.45) * Math.pow(1 - s, 0.55) * 2.2;
  rows.forEach((rw, k) => {
    for (let i = 0; i < rw.n; i++) {
      const th = (i + rw.off) / rw.n * TAU + (R01() - 0.5) * 0.08, phi = (rw.phi + (R01() - 0.5) * 8) * D2R;
      const xa: V3 = [Math.cos(th) * Math.cos(phi), Math.sin(th) * Math.cos(phi), Math.sin(phi)], za: V3 = [-Math.cos(th) * Math.sin(phi), -Math.sin(th) * Math.sin(phi), Math.cos(phi)];
      const P = comp(X, frame(xa, za, [rw.r0 * Math.cos(th), rw.r0 * Math.sin(th), rw.z0]));
      surf(petalFn(rw.L, rw.wm, wprof, rw.kap, 0.9, 0.004, 3, i * 1.3 + k), 0.01, 0.999, -1, 1, (s) => 0.1 + 0.9 * s, P, { tint: (R01() - 0.5) * 0.1 });
    }
  });
}
// ---------- 3. Тюльпан-бутон (головой вниз) ----------
function tulip(B: V3, axis: V3, topY: number, yawOff: number): void {
  const L = 0.6, Rm = 0.17, a = norm(axis);
  const X = frame(norm(cross([0, 1, 0], a)), a, B); const Xr = comp(X, { R: [Math.cos(yawOff), -Math.sin(yawOff), 0, Math.sin(yawOff), Math.cos(yawOff), 0, 0, 0, 1], T: [0, 0, 0] });
  for (let i = 0; i < 6; i++) {
    const th0 = i * PI / 3;
    const gap = (s: number): number => (3 + 15 * s * s * s) * D2R;
    const span = (s: number): number => Math.max(0.02, (PI / 3 - gap(s)) * (1 - 0.75 * Math.pow(s, 9)));
    const r = (s: number): number => Rm * Math.pow(Math.max(0, Math.sin(PI * Math.pow(s, 0.8))), 0.85) + 0.06 * Math.pow(s, 6);
    surf((s, v) => { const th = th0 + PI / 6 + (v - 0.5) * span(s), rr = r(s); return [rr * Math.cos(th), rr * Math.sin(th), L * s]; }, 0.004, 1, 0, 1, (s) => 0.15 + 0.85 * s, Xr);
  }
  const top: V3 = [B[0] - 0.22, topY, B[2] + 0.05];
  tube(bez(B, add(B, mul(a, -0.3)), [top[0], topY - 0.25, top[2]], top), () => 0.011, ident(), (t) => 0.1 + 0.2 * t);
}
// ---------- 4. Физалис ----------
function physalis(X: Xf): void {
  const arc = (t: number): V3 => [-0.6 + 1.2 * t, 0.17 * Math.sin(PI * t), 0.05 * Math.sin(TAU * t)];
  tube(arc, () => 0.01, X, (t) => 0.2 + 0.2 * t);
  const spots: [number, number, number, number][] = [[0.14, 0.50, 0.14, 0.13], [0.38, 0.40, 0.18, 0.12], [0.64, 0.46, -0.1, 0.13], [0.87, 0.36, -0.15, 0.11]];
  for (const [t, L, tilt, Rm] of spots) {
    const p = arc(t), dn: V3 = norm([tilt, -1, tilt * 0.5]);
    const top = add(p, mul(dn, 0.07));
    tube((q) => add(p, mul(dn, 0.075 * q)), () => 0.0045, X, () => 0.25);
    const LX = comp(X, frame(norm(cross([0, 0, 1], dn)), dn, top));
    surf(revolve(L, (s, th) => Rm * Math.pow(Math.max(0, Math.sin(PI * Math.pow(s, 0.72))), 0.9) * (1 + 0.12 * Math.cos(5 * th))), 0.003, 0.999, 0, TAU, (s) => 0.1 + 0.8 * s, LX);
  }
}
// ---------- 5. Одуванчик ----------
function dandelion(X: Xf): void {
  const n = 150, ga = PI * (3 - Math.sqrt(5)), R = 0.4;
  for (let i = 0; i < n; i++) {
    const y = 1 - 2 * (i + 0.5) / n, rr = Math.sqrt(1 - y * y), th = i * ga;
    const d: V3 = [rr * Math.cos(th), y, rr * Math.sin(th)];
    if (y > 0.93) continue;
    const L1 = R - 0.045 + (R01() - 0.5) * 0.03;
    tube((t) => mul(d, 0.04 + (L1 - 0.04) * t), () => 0.0025, X, (t) => 0.55 + 0.3 * t);
    // зонтик из 6 усиков
    const e1 = norm(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), e2 = cross(d, e1), tipP = mul(d, L1);
    for (let k = 0; k < 6; k++) {
      const ph = k / 6 * TAU + i, dir = norm(add(mul(d, Math.cos(50 * D2R)), mul(add(mul(e1, Math.cos(ph)), mul(e2, Math.sin(ph))), Math.sin(50 * D2R))));
      tube((t) => add(tipP, mul(dir, 0.05 * t)), () => 0.0016, X, (t) => 0.8 + 0.2 * t, 0, 1);
    }
  }
  surf((s, th) => { const rr = 0.045 * Math.sin(PI * s); return [rr * Math.cos(th), 0.045 * Math.cos(PI * s), rr * Math.sin(th)]; }, 0.02, 0.98, 0, TAU, () => 0.1, X);
  tube((t) => [0, 0.2 + 0.5 * t, 0], () => 0.006, X, () => 0.2);
}
// ---------- 6. Розетка листьев ----------
function rosette(X: Xf): void {
  const wprof = (s: number): number => Math.pow(Math.max(0, Math.sin(PI * Math.pow(s, 0.72))), 0.9);
  for (let i = 0; i < 6; i++) {
    const th = i / 6 * TAU + (R01() - 0.5) * 0.25, phi = (i % 2 ? 38 : 8) * D2R, kap = i % 2 ? -0.5 : -0.9 + 0.2 * R01();
    const xa: V3 = [Math.cos(th) * Math.cos(phi), Math.sin(th) * Math.cos(phi), Math.sin(phi)], za: V3 = [-Math.cos(th) * Math.sin(phi), -Math.sin(th) * Math.sin(phi), Math.cos(phi)];
    const P = comp(X, frame(xa, za, [0.03 * Math.cos(th), 0.03 * Math.sin(th), 0]));
    const ph = R01() * 6, f = petalFn(0.7, 0.085, wprof, kap, 0.55, 0.012, 7, ph);
    surf(f, 0.02, 0.999, -1, 1, (s) => 0.1 + 0.85 * s, P, { tint: 0.04 });
    const cl = petalFn(0.7, 0.085, wprof, kap, 0, 0, 7, ph);
    tube((t) => { const p = cl(Math.max(0.02, t), 0); return [p[0], p[1], p[2] + 0.004]; }, (t) => 0.005 * (1 - 0.7 * t), P, (t) => 0.55 + 0.4 * t, 0, 0.96);
  }
}
// ---------- 7. Малый бутон ----------
function bud(B: V3, dir: V3, L: number, Rm: number, stemUp: number): void {
  const a = norm(dir), X = frame(norm(cross([0, 1, 0], a)), a, B);
  surf(revolve(L, (s, th) => Rm * Math.pow(Math.max(0, Math.sin(PI * s)), 0.75) * (1 + 0.1 * Math.cos(6 * th))), 0.003, 0.997, 0, TAU, (s) => 0.1 + 0.85 * s, X);
  const top: V3 = [B[0] - 0.08 * a[0], B[1] + stemUp, B[2] + 0.02];
  tube(bez(B, add(B, mul(a, -0.1)), [top[0], top[1] - 0.1, top[2]], top), () => 0.007, ident(), () => 0.2);
}

// ---------- Раскладка ----------
const camA = { pos: [-1.4, 1.35, -10.85] as V3, tgt: [-1.55, 1.45, -14.0] as V3, fov: 80 };
const camB = { pos: [-0.55, 0.55, -12.4] as V3, tgt: [-2.7, 1.95, -13.7] as V3, fov: 72 };
const toward = (from: V3, c: V3): V3 => norm(sub(c, from));
const items: { name: string; c: V3; r: number; make: () => void }[] = [];
const J = (a: V3): V3 => a;
items.push({ name: 'rosette', c: J([-3.5, 1.55, -12.95]), r: 0.75, make: () => rosette(facing(add(toward([-3.5, 1.55, -12.95], camA.pos), [0.25, 0.35, 0]), [-3.5, 1.55, -12.95], 0.4)) });
items.push({ name: 'bud1', c: J([-3.2, 2.2, -13.7]), r: 0.2, make: () => bud([-3.2, 2.2, -13.7], [0.2, -1, 0.1], 0.35, 0.095, 0.5) });
items.push({ name: 'tulip', c: J([-2.75, 1.95, -13.55]), r: 0.4, make: () => tulip([-2.75, 2.0, -13.55], [0.32, -0.93, 0.18], 2.62, 0.5) });
items.push({ name: 'physalis', c: J([-1.75, 2.05, -14.05]), r: 0.75, make: () => physalis(comp({ R: [Math.cos(0.35), 0, Math.sin(0.35), 0, 1, 0, -Math.sin(0.35), 0, Math.cos(0.35)], T: [-1.75, 2.1, -14.05] }, ident())) });
items.push({ name: 'bud2', c: J([-1.05, 2.4, -13.9]), r: 0.2, make: () => bud([-1.05, 2.3, -13.9], [-0.15, -1, 0.15], 0.32, 0.085, 0.4) });
items.push({ name: 'carnation', c: J([-0.7, 1.85, -14.55]), r: 0.7, make: () => carnation(facing(add(toward([-0.7, 1.85, -14.55], camA.pos), [-0.05, 0.25, 0]), [-0.7, 1.85, -14.55], 0.3)) });
items.push({ name: 'bud3', c: J([0.15, 1.55, -14.05]), r: 0.2, make: () => bud([0.15, 1.65, -14.05], [0.25, -1, 0.1], 0.34, 0.09, 0.9) });
items.push({ name: 'dandelion', c: J([0.4, 1.9, -15.0]), r: 0.42, make: () => dandelion({ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], T: [0.4, 1.95, -15.0] }) });
items.push({ name: 'dahlia', c: J([0.75, 2.3, -15.3]), r: 0.46, make: () => dahlia(facing(add(toward([0.75, 2.3, -15.3], camA.pos), [-0.25, -0.15, 0]), [0.75, 2.3, -15.3], -0.2)) });
items.push({ name: 'bud4', c: J([0.25, 2.5, -15.8]), r: 0.2, make: () => bud([0.25, 2.5, -15.8], [-0.2, -1, 0.1], 0.3, 0.08, 0.2) });

// ---------- Подвес ----------
const TH: number[] = [];
const spl: V3[] = [];
for (const it of items) {
  const el = els.length; void el;
  beginEl(it.name, it.c, it.r); it.make(); endEl();
}
console.log('paper points', np, 'sec', (Date.now() - t0) / 1000);
{
  const right: V3 = norm(cross(toward(camA.pos, camA.tgt), [0, 1, 0]));
  for (const e of els) {
    // верхние точки по трём-четырём «долям» вдоль взгляда вправо
    let umin = 1e9, umax = -1e9;
    for (let i = e.i0; i < e.i1; i++) { const u = bP[3 * i]! * right[0] + bP[3 * i + 1]! * right[1] + bP[3 * i + 2]! * right[2]; umin = Math.min(umin, u); umax = Math.max(umax, u); }
    const k = 2 + Math.floor(R01() * 3); const fr = k === 2 ? [0.3, 0.7] : k === 3 ? [0.2, 0.5, 0.8] : [0.12, 0.38, 0.62, 0.88];
    for (const f of fr) {
      const ut = umin + (umax - umin) * f; let best = -1, by = -1e9;
      for (let i = e.i0; i < e.i1; i++) { const u = bP[3 * i]! * right[0] + bP[3 * i + 1]! * right[1] + bP[3 * i + 2]! * right[2]; if (Math.abs(u - ut) < 0.05 && bP[3 * i + 1]! > by) { by = bP[3 * i + 1]!; best = i; } }
      if (best < 0) continue;
      const p: V3 = [bP[3 * best]!, bP[3 * best + 1]!, bP[3 * best + 2]!], top: V3 = [e.c[0] + (p[0] - e.c[0]) * 0.25, 3.0, e.c[2] + (p[2] - e.c[2]) * 0.25];
      const L = len3(sub(top, p)), n = Math.ceil(L / 0.003);
      for (let q = 0; q <= n; q++) { const t = q / n; TH.push(p[0] + (top[0] - p[0]) * t, p[1] + (top[1] - p[1]) * t, p[2] + (top[2] - p[2]) * t); }
    }
  }
}
const NT = TH.length / 3, tpos = Float32Array.from(TH);
console.log('thread points', NT);

// ---------- Свет и рендер ----------
const W = 1280, H = 720;
const LDIR = norm([-0.2, 1, -0.35]); // к источнику
const ROOM_MUL = env('ROOM', 0.35), EXP = env('EXP', 1.7), BG = 0.12, SPOT = env('SPOT', 0.9), LAN = env('LAN', 0.9);
// тени на полу: пятно под цветком, смещённое вдоль луча
const shadows = els.map((e) => ({ x: e.c[0] + 0.2 * e.c[1], z: e.c[2] + 0.35 * e.c[1], r: e.r * 1.15 }));
const roomShadow = new Float32Array(NR).fill(1);
for (let i = 0; i < NR; i++) if (rnrm[3 * i + 1]! > 0.9 && rpos[3 * i + 1]! < 0.05) {
  let f = 1; for (const s of shadows) { const d = Math.hypot(rpos[3 * i]! - s.x, rpos[3 * i + 2]! - s.z) / s.r; if (d < 1) f *= 1 - 0.5 * (1 - d) * (1 - d) * (3 - 2 * (1 - d)) ; }
  roomShadow[i] = f;
}
function renderView(cam: { pos: V3; tgt: V3; fov: number }): Uint8Array {
  const f = norm(sub(cam.tgt, cam.pos)), rt = norm(cross(f, [0, 1, 0])), up = cross(rt, f);
  const FP = (W / 2) / Math.tan(cam.fov / 2 * D2R);
  const buf = new Float32Array(W * H * 3).fill(0.004), zb = new Float32Array(W * H).fill(1e9);
  const stamp = (x: number, y: number, s: number, d: number, r: number, g: number, b: number): void => {
    const h = s >> 1, xs = Math.round(x) - h, ys = Math.round(y) - h;
    for (let j = ys; j < ys + s; j++) { if (j < 0 || j >= H) continue; for (let i = xs; i < xs + s; i++) { if (i < 0 || i >= W) continue; const k = j * W + i; if (d < zb[k]!) { zb[k] = d; buf[3 * k] = r; buf[3 * k + 1] = g; buf[3 * k + 2] = b; } } }
  };
  const proj = (x: number, y: number, z: number, o: number[]): void => { const dx = x - cam.pos[0], dy = y - cam.pos[1], dz = z - cam.pos[2]; const d = dx * f[0] + dy * f[1] + dz * f[2]; o[2] = d; o[0] = W / 2 + FP * (dx * rt[0] + dy * rt[1] + dz * rt[2]) / d; o[1] = H / 2 - FP * (dx * up[0] + dy * up[1] + dz * up[2]) / d; };
  const o = [0, 0, 0];
  // комната: тёмный фон (0.35 яркости)
  for (let i = 0; i < NR; i++) {
    const x = rpos[3 * i]!, y = rpos[3 * i + 1]!, z = rpos[3 * i + 2]!; proj(x, y, z, o); if (o[2]! <= 0.05) continue;
    const dx = x - cam.pos[0], dy = y - cam.pos[1], dz = z - cam.pos[2], l = Math.hypot(dx, dy, dz), nx = rnrm[3 * i]!, ny = rnrm[3 * i + 1]!, nz = rnrm[3 * i + 2]!;
    const ang = Math.acos((dx * f[0] + dy * f[1] + dz * f[2]) / l) * 180 / PI;
    const lan = (sm(60, 18, ang) / (1 + 0.08 * l * l) + 0.035) * (0.55 + 0.45 * Math.max(0, -(dx * nx + dy * ny + dz * nz) / l));
    const spot = 0.5 * Math.max(0, nx * LDIR[0] + ny * LDIR[1] + nz * LDIR[2]);
    const L = ROOM_MUL * (0.6 * lan + 0.04 + 0.5 * spot) * roomShadow[i]!;
    const sz = Math.max(1, Math.min(16, Math.round(rstep * FP / o[2]! * 3.2)));
    stamp(o[0]!, o[1]!, sz, o[2]!, rcol[3 * i]! * L, rcol[3 * i + 1]! * L, rcol[3 * i + 2]! * L);
  }
  // бумага
  for (let i = 0; i < np; i++) {
    const x = bP[3 * i]!, y = bP[3 * i + 1]!, z = bP[3 * i + 2]!; proj(x, y, z, o); if (o[2]! <= 0.05) continue;
    const nx = bN[3 * i]!, ny = bN[3 * i + 1]!, nz = bN[3 * i + 2]!;
    const dx = cam.pos[0] - x, dy = cam.pos[1] - y, dz = cam.pos[2] - z, l = Math.hypot(dx, dy, dz), vx = dx / l, vy = dy / l, vz = dz / l;
    const s = nx * LDIR[0] + ny * LDIR[1] + nz * LDIR[2], side = nx * vx + ny * vy + nz * vz;
    const ang = Math.acos(Math.max(-1, Math.min(1, -(vx * f[0] + vy * f[1] + vz * f[2])))) * 180 / PI;
    const lan = LAN * sm(60, 18, ang) / (1 + 0.04 * l * l) * Math.abs(side);
    const PM = env('PM', 0.42);
    const L = PM * (BG + SPOT * Math.abs(s) + (s * side < 0 ? 0.2 * (0.4 + 0.6 * Math.abs(s)) : 0) + lan);
    const sz = Math.max(1, Math.min(6, Math.ceil(STEP * FP / o[2]! * 1.1)));
    stamp(o[0]!, o[1]!, sz, o[2]!, bC[3 * i]! * L, bC[3 * i + 1]! * L, bC[3 * i + 2]! * L);
  }
  // нити
  for (let i = 0; i < NT; i++) {
    const x = tpos[3 * i]!, y = tpos[3 * i + 1]!, z = tpos[3 * i + 2]!; proj(x, y, z, o); if (o[2]! <= 0.05) continue;
    stamp(o[0]!, o[1]!, 1, o[2]! - 0.01, 0.2, 0.19, 0.16);
  }
  // закрыть дыры посева
  const hole: number[] = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const k = y * W + x; if (zb[k]! < 1e9) continue; let c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (zb[k + dy * W + dx]! < 1e9) c++; if (c >= 5) hole.push(k); }
  for (const k of hole) { let bz = 1e9, bk = -1; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const q = k + dy * W + dx; if (zb[q]! < bz) { bz = zb[q]!; bk = q; } } if (bk >= 0) { buf[3 * k] = buf[3 * bk]!; buf[3 * k + 1] = buf[3 * bk + 1]!; buf[3 * k + 2] = buf[3 * bk + 2]!; } }
  const out = new Uint8Array(W * H * 3); for (let i = 0; i < out.length; i++) out[i] = Math.round(255 * Math.pow(Math.min(1, buf[i]! * EXP), 1 / 2.2));
  return out;
}
const t1 = Date.now();
writeFileSync(`${OUT}/view_a.rgb`, Buffer.from(renderView(camA)));
writeFileSync(`${OUT}/view_b.rgb`, Buffer.from(renderView(camB)));
console.log('render sec', (Date.now() - t1) / 1000, 'total sec', (Date.now() - t0) / 1000);
writeFileSync(`${OUT}/stats.json`, JSON.stringify({ roomPoints: NR, paperPoints: np, threadPoints: NT, elements: els.map((e) => ({ name: e.name, points: e.i1 - e.i0 })) }, null, 1));
