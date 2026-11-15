// Набросок: комната убежища, нарисованная «кружевом» — нитью, без заливки, насквозь.
// Исследовательский код к docs/vylazka/untitled_session.md (§2, «Кружево») — не часть игры,
// в сборку и проверки не входит. Запуск — в README.md рядом.
// Кружевной набросок комнаты. Исследовательский код, не часть игры.
import { writeFileSync } from 'node:fs';
import { generateLayout } from '../../../../vylazka/src/gen/layout';
import { buildLevel } from '../../../../vylazka/src/world/level_build';
import { MAT_DEFS } from '../../../../vylazka/src/world/materials';

const L = process.env.L ?? '.';
const env = (k: string, d: number): number => (process.env[k] ? Number(process.env[k]) : d);
const T0 = Date.now();
const lv: any = buildLevel(generateLayout(20041113, 2, 'shelter'));
const ob = lv.objects.find((o: any) => o.id === 28);
const cx = (ob.min[0] + ob.max[0]) / 2, cz = (ob.min[2] + ob.max[2]) / 2;
const m = lv.chunks.find((c: any) => c.mesh.obj && c.mesh.obj.includes(28)).mesh;
const objName = new Map<number, string>(); for (const o of lv.objects) objName.set(o.id, o.name);
const matName = (i: number): string => MAT_DEFS[Math.round(m.mat[i])]!.name;

// ---------- хеш / шум ----------
const hh = (x: number, y: number, s: number): number => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
const sm5 = (t: number): number => t * t * (3 - 2 * t);
const vn = (x: number, y: number, s: number): number => { const ix = Math.floor(x), iy = Math.floor(y), fx = sm5(x - ix), fy = sm5(y - iy); const a = hh(ix, iy, s), b = hh(ix + 1, iy, s), c = hh(ix, iy + 1, s), d = hh(ix + 1, iy + 1, s); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; };
const fbm = (x: number, y: number, s: number): number => (vn(x, y, s) + 0.5 * vn(2.1 * x + 7, 2.1 * y + 3, s + 1) + 0.25 * vn(4.3 * x + 1, 4.3 * y + 9, s + 2)) / 1.75;
const smooth = (a: number, b: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- хранилище точек ----------
let cap = 1 << 20, NP = 0;
let PX = new Float32Array(cap), PY = new Float32Array(cap), PZ = new Float32Array(cap), PK = new Uint8Array(cap), PL = new Uint8Array(cap);
const grow = (): void => { cap *= 2; const f = (a: Float32Array): Float32Array => { const b = new Float32Array(cap); b.set(a); return b; }; PX = f(PX); PY = f(PY); PZ = f(PZ); const g = (a: Uint8Array): Uint8Array => { const b = new Uint8Array(cap); b.set(a); return b; }; PK = g(PK); PL = g(PL); };
const push = (x: number, y: number, z: number, kind: number, link: number): void => { if (NP >= cap) grow(); PX[NP] = x; PY[NP] = y; PZ[NP] = z; PK[NP] = kind; PL[NP] = link; NP++; };
const CORD = 0, WEFT = 1, STEP = env('STEP', 0.005);
// отрезок в мировых координатах
const wseg = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, kind: number): void => {
  const len = Math.hypot(bx - ax, by - ay, bz - az), n = Math.max(1, Math.ceil(len / STEP));
  for (let i = 0; i <= n; i++) { const t = i / n; push(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, kind, i > 0 ? 1 : 0); }
};

// ---------- грани ----------
interface Face { n: number[]; u: number[]; v: number[]; d: number; mat: number; obj: number; tri: number[]; tv: number[]; // tv: uv-треугольники
  U0: number; U1: number; V0: number; V1: number; area: number; g: Float64Array; cells: number[][]; gw: number; gh: number; cs: number; }
const faces = new Map<string, Face>();
const P = (i: number, k: number): number => m.position[3 * i + k];
const BOX = env('BOX', 4.5);
for (let t = 0; t < m.index.length; t += 3) {
  const a = m.index[t], b = m.index[t + 1], c = m.index[t + 2];
  const gx = (P(a, 0) + P(b, 0) + P(c, 0)) / 3, gy = (P(a, 1) + P(b, 1) + P(c, 1)) / 3, gz = (P(a, 2) + P(b, 2) + P(c, 2)) / 3;
  if (Math.abs(gx - cx) > BOX || Math.abs(gz - cz) > BOX || gy < -0.05 || gy > 4) continue;
  let nx = m.normal[3 * a] + m.normal[3 * b] + m.normal[3 * c], ny = m.normal[3 * a + 1] + m.normal[3 * b + 1] + m.normal[3 * c + 1], nz = m.normal[3 * a + 2] + m.normal[3 * b + 2] + m.normal[3 * c + 2];
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  const d = gx * nx + gy * ny + gz * nz, mat = Math.round(m.mat[a]), obj = m.obj ? m.obj[a] : 0;
  const key = `${Math.round(nx * 20)}|${Math.round(ny * 20)}|${Math.round(nz * 20)}|${Math.round(d * 100)}|${mat}|${obj}`;
  let f = faces.get(key);
  if (!f) { f = { n: [nx, ny, nz], u: [], v: [], d, mat, obj, tri: [], tv: [], U0: 0, U1: 0, V0: 0, V1: 0, area: 0, g: new Float64Array(0), cells: [], gw: 0, gh: 0, cs: 0.25 }; faces.set(key, f); }
  f.tri.push(a, b, c);
}
const cross = (a: number[], b: number[]): number[] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const nrm = (a: number[]): number[] => { const l = Math.hypot(a[0]!, a[1]!, a[2]!) || 1; return [a[0]! / l, a[1]! / l, a[2]! / l]; };
const faceList: Face[] = [];
for (const f of faces.values()) {
  const n = f.n; let up = [0, 1, 0]; if (Math.abs(n[1]!) > 0.95) up = [0, 0, 1];
  const dd = up[0]! * n[0]! + up[1]! * n[1]! + up[2]! * n[2]!;
  f.v = nrm([up[0]! - n[0]! * dd, up[1]! - n[1]! * dd, up[2]! - n[2]! * dd]); f.u = nrm(cross(f.v, n));
  const nt = f.tri.length / 3; f.g = new Float64Array(nt * 7); f.U0 = f.V0 = 1e9; f.U1 = f.V1 = -1e9; f.area = 0; const uv: number[] = [];
  for (let q = 0; q < nt; q++) {
    const co: number[] = [];
    for (let k = 0; k < 3; k++) { const i = f.tri[3 * q + k]!; const x = P(i, 0), y = P(i, 1), z = P(i, 2); const U = x * f.u[0]! + y * f.u[1]! + z * f.u[2]!, V = x * f.v[0]! + y * f.v[1]! + z * f.v[2]!; co.push(U, V); f.U0 = Math.min(f.U0, U); f.U1 = Math.max(f.U1, U); f.V0 = Math.min(f.V0, V); f.V1 = Math.max(f.V1, V); }
    uv.push(...co);
    const v0x = co[2]! - co[0]!, v0y = co[3]! - co[1]!, v1x = co[4]! - co[0]!, v1y = co[5]! - co[1]!, det = v0x * v1y - v1x * v0y;
    f.area += Math.abs(det) / 2; f.g.set([co[0]!, co[1]!, v0x, v0y, v1x, v1y, Math.abs(det) < 1e-12 ? 0 : 1 / det], q * 7);
  }
  f.tv = uv; f.gw = Math.max(1, Math.ceil((f.U1 - f.U0) / f.cs)); f.gh = Math.max(1, Math.ceil((f.V1 - f.V0) / f.cs)); f.cells = Array.from({ length: f.gw * f.gh }, () => []);
  for (let q = 0; q < nt; q++) {
    const xs = [uv[6 * q]!, uv[6 * q + 2]!, uv[6 * q + 4]!], ys = [uv[6 * q + 1]!, uv[6 * q + 3]!, uv[6 * q + 5]!];
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - f.U0) / f.cs)), i1 = Math.min(f.gw - 1, Math.floor((Math.max(...xs) - f.U0) / f.cs)), j0 = Math.max(0, Math.floor((Math.min(...ys) - f.V0) / f.cs)), j1 = Math.min(f.gh - 1, Math.floor((Math.max(...ys) - f.V0) / f.cs));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f.cells[j * f.gw + i]!.push(q);
  }
  faceList.push(f);
}
const EPS = 0.0005;
const inside = (f: Face, U: number, V: number): boolean => {
  const i = Math.floor((U - f.U0) / f.cs), j = Math.floor((V - f.V0) / f.cs); if (i < 0 || j < 0 || i >= f.gw || j >= f.gh) return false;
  const c = f.cells[j * f.gw + i]!, g = f.g;
  for (let q = 0; q < c.length; q++) { const o = c[q]! * 7, id = g[o + 6]!; if (!id) continue; const dx = U - g[o]!, dy = V - g[o + 1]!; const s = (dx * g[o + 5]! - g[o + 4]! * dy) * id, t = (g[o + 2]! * dy - dx * g[o + 3]!) * id; if (s >= -EPS && t >= -EPS && s + t <= 1 + EPS) return true; }
  return false;
};
const W3 = (f: Face, U: number, V: number, o: number): number[] => [f.u[0]! * U + f.v[0]! * V + f.n[0]! * (f.d + o), f.u[1]! * U + f.v[1]! * V + f.n[1]! * (f.d + o), f.u[2]! * U + f.v[2]! * V + f.n[2]! * (f.d + o)];
// линия в координатах грани с проверкой «внутри» и (необязательной) маской
const luv = (f: Face, u0: number, v0: number, u1: number, v1: number, kind: number, mask?: (U: number, V: number) => boolean, jit?: (t: number, U: number, V: number) => number[]): void => {
  const len = Math.hypot(u1 - u0, v1 - v0), n = Math.max(1, Math.ceil(len / STEP)); let prev = 0;
  for (let i = 0; i <= n; i++) { const t = i / n; let U = u0 + (u1 - u0) * t, V = v0 + (v1 - v0) * t; if (jit) { const j = jit(t, U, V); U += j[0]!; V += j[1]!; }
    const ok = inside(f, U, V) && (!mask || mask(U, V)); if (ok) { const w = W3(f, U, V, 0); push(w[0]!, w[1]!, w[2]!, kind, prev); } prev = ok ? 1 : 0; }
};

// ---------- СТЕНЫ, ПОЛ-ПЛАН ----------
const stat = { wallFaces: 0, keepFrac: [] as number[], objFaces: 0, carpets: 0, screens: 0, hang: 0 };
const SEAM = 0.08, BRK = 0.25, WEFT_W = env('WEFT_W', 0.012);
let wallIdx = 0;
for (const f of faceList) {
  if (f.obj !== 0 || Math.abs(f.n[1]!) >= 0.3 || f.area < 0.05) continue;
  stat.wallFaces++; const seed = 100 + wallIdx++;
  const H = f.V1 - f.V0, Wd = f.U1 - f.U0;
  // --- маска «объеденности»
  let keep: (U: number, V: number) => boolean = () => true;
  if (f.area >= 1.0) {
    const side = hh(seed, 1, 5) < 0.5 ? 1 : -1, ox = hh(seed, 2, 5) * 50, oy = hh(seed, 3, 5) * 50;
    const nh = 1 + Math.floor(hh(seed, 4, 5) * 2 + 0.5); const holes: number[][] = [];
    for (let h = 0; h < nh; h++) holes.push([f.U0 + Wd * (0.2 + 0.6 * hh(seed, 10 + h, 6)), f.V0 + H * (0.25 + 0.4 * hh(seed, 20 + h, 6)), 0.25 + 0.35 * hh(seed, 30 + h, 6)]);
    const score = (U: number, V: number): number => {
      const tt = H > 0 ? (V - f.V0) / H : 0, ss = side > 0 ? (U - f.U0) / Math.max(Wd, 0.01) : (f.U1 - U) / Math.max(Wd, 0.01);
      let s = fbm(U * 0.9 + ox, V * 0.9 + oy, seed) - 0.9 * Math.pow(Math.max(0, tt), 2.2) - 0.9 * Math.pow(Math.max(0, ss), 3);
      for (const h of holes) { const dist = Math.hypot(U - h[0]!, V - h[1]!) + 0.35 * (fbm(U * 2 + oy, V * 2 + ox, seed + 9) - 0.5); s -= 2.5 * smooth(h[2]! * 1.1, h[2]! * 0.55, dist); }
      return s;
    };
    const vals: number[] = [];
    for (let U = f.U0 + 0.01; U < f.U1; U += 0.03) for (let V = f.V0 + 0.01; V < f.V1; V += 0.03) if (inside(f, U, V)) vals.push(score(U, V));
    vals.sort((a, b) => a - b); const frac = 0.62 + 0.12 * hh(seed, 7, 7); stat.keepFrac.push(frac);
    const thr = vals.length ? vals[Math.floor(vals.length * (1 - frac))]! : -1e9;
    keep = (U, V) => score(U, V) > thr;
    // --- рваный край шнуром: грубая сетка -> тонкая только у границы
    const CS = 0.02, gw = Math.ceil(Wd / CS) + 1, gh = Math.ceil(H / CS) + 1; const cg = new Int8Array(gw * gh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const U = f.U0 + i * CS, V = f.V0 + j * CS; cg[j * gw + i] = inside(f, U, V) ? (keep(U, V) ? 1 : 0) : -1; }
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      let flag = false; for (let dj = -1; dj <= 1 && !flag; dj++) for (let di = -1; di <= 1; di++) { const a = cg[j * gw + i]!, jj = j + dj, ii = i + di; if (jj < 0 || ii < 0 || jj >= gh || ii >= gw) continue; const b = cg[jj * gw + ii]!; if ((a === 1 && b === 0) || (a === 0 && b === 1)) { flag = true; break; } }
      if (!flag) continue;
      for (let q = 0; q < 4; q++) for (let r = 0; r < 4; r++) {
        const U = f.U0 + i * CS + r * 0.005, V = f.V0 + j * CS + q * 0.005; if (!inside(f, U, V) || !keep(U, V)) continue;
        if (!inside(f, U + 0.005, V) || !inside(f, U - 0.005, V) || !inside(f, U, V + 0.005) || !inside(f, U, V - 0.005)) { /* край самой грани не рваный */ }
        const bnd = (inside(f, U + 0.005, V) && !keep(U + 0.005, V)) || (inside(f, U - 0.005, V) && !keep(U - 0.005, V)) || (inside(f, U, V + 0.005) && !keep(U, V + 0.005)) || (inside(f, U, V - 0.005) && !keep(U, V - 0.005));
        if (bnd) { const w = W3(f, U, V, 0); push(w[0]!, w[1]!, w[2]!, CORD, 0); }
      }
    }
    // --- нити подвеса с верхнего рваного края
    let U = f.U0 + 0.1 + 0.3 * hh(seed, 50, 8);
    while (U < f.U1 - 0.05) {
      for (let V = f.V1; V > f.V0; V -= 0.01) if (inside(f, U, V) && keep(U, V)) { const a = W3(f, U, V, 0); wseg(a[0]!, a[1]!, a[2]!, a[0]!, a[1]! + 2.5, a[2]!, 2); stat.hang++; break; }
      U += 0.35 + 0.15 * hh(Math.round(U * 100), seed, 9);
    }
  }
  // --- кладка
  const jitS = (k: number) => (_t: number, U: number): number[] => [0, (fbm(U * 7, k * 3.1, 77) - 0.5) * 0.011];
  for (let k = Math.ceil(f.V0 / SEAM); k * SEAM <= f.V1 + 1e-6; k++) luv(f, f.U0, k * SEAM, f.U1, k * SEAM, CORD, keep, jitS(k));
  for (let r = Math.floor(f.V0 / SEAM); r * SEAM < f.V1; r++) {
    const off = (r & 1) * 0.5 * BRK, vlo = r * SEAM, vhi = vlo + SEAM;
    for (let j = Math.floor((f.U0 - off) / BRK); j * BRK + off <= f.U1; j++) { const U = j * BRK + off; if (U < f.U0 - 1e-6) continue; luv(f, U, vlo, U, vhi, CORD, keep, (_t, _U, V) => [(fbm(V * 9, j * 1.7 + r, 78) - 0.5) * 0.011, 0]); }
  }
  for (let U = Math.ceil(f.U0 / WEFT_W) * WEFT_W; U <= f.U1; U += WEFT_W) luv(f, U, f.V0, U, f.V1, 3, keep);
  // --- план на полу: двойная линия у основания
  if (f.V0 < 0.4) for (const o of [0.035, 0.1]) {
    const len = Wd, n = Math.max(1, Math.ceil(len / STEP)); let prev = 0;
    for (let i = 0; i <= n; i++) { const U = f.U0 + len * i / n, ok = inside(f, U, f.V0 + 0.03); if (ok) { const w = W3(f, U, f.V0 + 0.03, o); push(w[0]!, 0.006, w[2]!, CORD, prev); } prev = ok ? 1 : 0; }
  }
}

// ---------- ПРЕДМЕТЫ ----------
const isScreen = (f: Face): boolean => f.obj === 28 && /glow|screen/.test(MAT_DEFS[f.mat]!.name);
for (const f of faceList) {
  if (f.obj === 0) continue; stat.objFaces++;
  const mn = MAT_DEFS[f.mat]!.name, on = objName.get(f.obj) ?? '';
  const horiz = Math.abs(f.n[1]!) > 0.5;
  // контур: рёбра, встречающиеся один раз
  const ek = new Map<string, number[]>(), cnt = new Map<string, number>(); const q3 = (i: number): string => `${Math.round(P(i, 0) * 2000)},${Math.round(P(i, 1) * 2000)},${Math.round(P(i, 2) * 2000)}`;
  for (let t = 0; t < f.tri.length; t += 3) for (let k = 0; k < 3; k++) { const a = f.tri[t + k]!, b = f.tri[t + (k + 1) % 3]!, ka = q3(a), kb = q3(b); const key = ka < kb ? ka + '|' + kb : kb + '|' + ka; cnt.set(key, (cnt.get(key) ?? 0) + 1); ek.set(key, [P(a, 0), P(a, 1), P(a, 2), P(b, 0), P(b, 1), P(b, 2)]); }
  for (const [k, c] of cnt) if (c === 1) { const e = ek.get(k)!; wseg(e[0]!, e[1]!, e[2]!, e[3]!, e[4]!, e[5]!, CORD); }
  if (f.area < 0.0004) continue;
  const onFloor = horiz && f.d * f.n[1]! < 0.06 && f.d * f.n[1]! > -0.06;
  const carpet = /carpet|rug/.test(mn) || on === 'rug';
  if (isScreen(f)) { // свинцовый переплёт
    stat.screens++; const S = 0.025 * Math.SQRT2;
    for (let c = Math.floor((f.U0 + f.V0) / S) * S; c <= f.U1 + f.V1; c += S) luv(f, f.U0, c - f.U0, f.U1, c - f.U1, CORD);
    for (let c = Math.floor((f.U0 - f.V1) / S) * S; c <= f.U1 - f.V0; c += S) luv(f, f.U0, f.U0 - c, f.U1, f.U1 - c, CORD);
    continue;
  }
  if (carpet && (onFloor || on === 'rug' || /carpet/.test(on))) { // кружевной орнамент: вложенные ромбы
    stat.carpets++; const cu = (f.U0 + f.U1) / 2, cv = (f.V0 + f.V1) / 2, R = (f.U1 - f.U0) / 2 + (f.V1 - f.V0) / 2;
    for (let r = 0.12; r <= R + 0.12; r += 0.12) {
      const k = Math.round(r / 0.12); const kind = k % 2 ? CORD : CORD;
      luv(f, cu - r, cv, cu, cv + r, kind); luv(f, cu, cv + r, cu + r, cv, kind); luv(f, cu + r, cv, cu, cv - r, kind); luv(f, cu, cv - r, cu - r, cv, kind);
    }
    const S = 0.04; for (let c = Math.floor((f.U0 + f.V0) / S) * S; c <= f.U1 + f.V1; c += S) luv(f, f.U0, c - f.U0, f.U1, c - f.U1, WEFT);
    continue;
  }
  if (!horiz) {
    for (let U = Math.ceil(f.U0 / 0.01) * 0.01; U <= f.U1; U += 0.01) luv(f, U, f.V0, U, f.V1, WEFT);
    const hn = (f.V1 - f.V0) > 0.4 ? 3 : 2; for (let k = 1; k <= hn; k++) { const V = f.V0 + (f.V1 - f.V0) * k / (hn + 1); luv(f, f.U0, V, f.U1, V, WEFT); }
  } else {
    const S = 0.05 * Math.SQRT2;
    for (let c = Math.floor((f.U0 + f.V0) / S) * S; c <= f.U1 + f.V1; c += S) luv(f, f.U0, c - f.U0, f.U1, c - f.U1, WEFT);
    for (let c = Math.floor((f.U0 - f.V1) / S) * S; c <= f.U1 - f.V0; c += S) luv(f, f.U0, f.U0 - c, f.U1, f.U1 - c, WEFT);
  }
}
const tBuild = (Date.now() - T0) / 1000;
console.log('points', NP, 'build s', tBuild.toFixed(1), JSON.stringify({ ...stat, keepFrac: stat.keepFrac.length }));
// сводка по стенам/полу для выбора вида B
const wallsInfo = faceList.filter((f) => f.obj === 0 && Math.abs(f.n[1]!) < 0.3 && f.area > 0.5).map((f) => ({ n: f.n.map((x) => +x.toFixed(2)), d: +f.d.toFixed(2), U: [+f.U0.toFixed(1), +f.U1.toFixed(1)], V: [+f.V0.toFixed(1), +f.V1.toFixed(1)], area: +f.area.toFixed(1) }));
if (process.env.DUMP) console.log(JSON.stringify(wallsInfo)), console.log(JSON.stringify(faceList.filter((f) => f.obj === 0 && f.n[1]! > 0.7).map((f) => [f.U0, f.U1, f.V0, f.V1, f.d].map((x) => +x.toFixed(1)))));

// ---------- РЕНДЕР ----------
const W = 1280, H = 720, FP = (W / 2) / Math.tan(40 * Math.PI / 180), KEXP = env('K', 2.2), CORDB = env('CORDB', 1.0), WEFTB = env('WEFTB', 0.3);
interface Cam { p: number[]; f: number[]; r: number[]; u: number[]; }
const mkCam = (p: number[], t: number[]): Cam => { const f = nrm([t[0]! - p[0]!, t[1]! - p[1]!, t[2]! - p[2]!]); const r = nrm([-f[2]!, 0, f[0]!]); const u = cross(r, f); return { p, f, r, u }; };
function render(cam: Cam): { out: Uint8Array; drawn: number } {
  const buf = new Float32Array(W * H);
  const add = (x: number, y: number, s: number, v: number): void => {
    if (s <= 1) { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi; for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const X = xi + dx, Y = yi + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; buf[Y * W + X]! += v * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy); } return; }
    const h = s / 2, x0 = Math.round(x - h), y0 = Math.round(y - h); for (let Y = y0; Y < y0 + s; Y++) { if (Y < 0 || Y >= H) continue; for (let X = x0; X < x0 + s; X++) { if (X < 0 || X >= W) continue; buf[Y * W + X]! += v; } }
  };
  let px = 0, py = 0, pd = 0, pok = false, drawn = 0;
  for (let i = 0; i < NP; i++) {
    const dx = PX[i]! - cam.p[0]!, dy = PY[i]! - cam.p[1]!, dz = PZ[i]! - cam.p[2]!, d = dx * cam.f[0]! + dy * cam.f[1]! + dz * cam.f[2]!;
    const link = PL[i]!; if (d < 0.1) { pok = false; continue; }
    const sx = W / 2 + FP * (dx * cam.r[0]! + dy * cam.r[1]! + dz * cam.r[2]!) / d, sy = H / 2 - FP * (dx * cam.u[0]! + dy * cam.u[1]! + dz * cam.u[2]!) / d;
    const cord = PK[i] === CORD, w = 0.25 + 0.75 / (1 + 0.05 * d * d), b = (cord ? CORDB : PK[i] === 2 ? 0.55 : PK[i] === 3 ? WEFTB * 0.7 : WEFTB) * w;
    const size = cord ? (d < 2.5 ? 3 : 2) : 1;
    const onScr = sx > -50 && sx < W + 50 && sy > -50 && sy < H + 50;
    if (link && pok) {
      const ddx = sx - px, ddy = sy - py, L = Math.hypot(ddx, ddy);
      if (L > 0 && L < 600 && (onScr || (px > -50 && px < W + 50 && py > -50 && py < H + 50))) { const n = Math.max(1, Math.ceil(L / 0.7)), a = b * (L / n) * (cord ? 1 : 1) / (cord ? 1 : 1); for (let q = 1; q <= n; q++) { const t = q / n; add(px + ddx * t, py + ddy * t, size, a / Math.max(1, size * 0.5)); } drawn++; }
    } else if (onScr) { const s2 = cord ? Math.max(size, Math.min(4, Math.round(STEP * FP / d * 1.1))) : 1; add(sx, sy, s2, b * 0.7); drawn++; }
    px = sx; py = sy; pd = d; pok = true;
  }
  void pd;
  const out = new Uint8Array(W * H * 3), bg = [9, 7, 6], col = [242, 239, 230];
  for (let i = 0; i < W * H; i++) { const t = 1 - Math.exp(-KEXP * buf[i]!); for (let c = 0; c < 3; c++) out[3 * i + c] = Math.round(bg[c]! + (col[c]! - bg[c]!) * t); }
  return { out, drawn };
}
// вид A
const fr = [[0, 1], [1, 0], [0, -1], [-1, 0]][ob.rot]!;
const camA = mkCam([cx + fr[0]! * 3, 1.45, cz + fr[1]! * 3], [cx, 0.6, cz]);
// вид B: из дальнего угла комнаты
const BX = env('BX', cx + fr[0]! * 3), BZ = env('BZ', cz + fr[1]! * 3), TX = env('TX', cx), TZ = env('TZ', cz);
const camB = mkCam([env('B_X', BX), 2.4, env('B_Z', BZ)], [env('T_X', TX), env('T_Y', 0.5), env('T_Z', TZ)]);
const t1 = Date.now();
const ra = render(camA); writeFileSync(`${L}/a.rgb`, ra.out);
const rb = render(camB); writeFileSync(`${L}/b.rgb`, rb.out);
console.log('render s', ((Date.now() - t1) / 1000).toFixed(1), 'segments/points drawn', ra.drawn, rb.drawn, 'total s', ((Date.now() - T0) / 1000).toFixed(1), 'cam A', camA.p, 'cam B', camB.p);
