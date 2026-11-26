// Набросок: рост грибницы (growth.ts) на настоящей комнате убежища и черновой программный рендер.
// Исследовательский код к docs/vylazka/growth.md — не часть игры, в сборку и проверки не входит.
// Запуск — в README.md рядом.
import { writeFileSync } from 'node:fs';
import { generateLayout } from '../../../../vylazka/src/gen/layout';
import { buildLevel } from '../../../../vylazka/src/world/level_build';
import { mulberry32 } from '../../../../vylazka/src/core/rng';
import { MAT_DEFS, DECAY, hexToLinear } from '../../../../vylazka/src/world/materials';
import { grow } from './growth';

// Куда писать сырые кадры и статистику: каталог из переменной OUT (по умолчанию — текущий).
const G = process.env.OUT ?? '.';
const env = (k: string, d: number): number => (process.env[k] ? Number(process.env[k]) : d);
const lv: any = buildLevel(generateLayout(20041113, 2, 'shelter'));
const ob = lv.objects.find((o: any) => o.id === 28);
const cx = (ob.min[0] + ob.max[0]) / 2, cz = (ob.min[2] + ob.max[2]) / 2, y0 = 0;
const chunk = lv.chunks.find((c: any) => c.mesh.obj && c.mesh.obj.includes(28));
const m = chunk.mesh;

// «Съедобность» по материалу: органика ≈ 1, краска/штукатурка 0.6, бетон 0.35, металл/стекло/пластик 0.1.
const SUB: Record<string, number> = { plaster: 0.6, stencil: 0.6, concrete: 0.35, floor: 0.35, brick: 0.35, ceil_tile: 0.35, dirt: 0.5, linoleum: 0.3, wet_concrete: 0.2 };
const subOf = (mat: number): number => { const d = MAT_DEFS[mat]!; if (d.decay === DECAY.organic || d.name === 'print') return 1; if (d.name.startsWith('paint') || d.name === 'wallpaper') return 0.6; return SUB[d.name] ?? 0.1; };
const albedo = MAT_DEFS.map((d) => hexToLinear(d.color));

// Посев точек по треугольникам в коробке ±4.5 м вокруг предмета.
const DENS = env('DENS', 900), step = 1 / Math.sqrt(DENS), rnd = mulberry32(777);
const P: number[] = [], Nn: number[] = [], C: number[] = [], S: number[] = [], A: number[] = [];
for (let t = 0; t < m.index.length; t += 3) {
  const [a, b, c] = [m.index[t], m.index[t + 1], m.index[t + 2]];
  const v = (i: number, k: number): number => m.position[3 * i + k];
  const gx = (v(a, 0) + v(b, 0) + v(c, 0)) / 3, gy = (v(a, 1) + v(b, 1) + v(c, 1)) / 3, gz = (v(a, 2) + v(b, 2) + v(c, 2)) / 3;
  if (Math.abs(gx - cx) > 4.5 || Math.abs(gz - cz) > 4.5 || gy < y0 - 0.05 || gy > y0 + 3) continue;
  const e1 = [v(b, 0) - v(a, 0), v(b, 1) - v(a, 1), v(b, 2) - v(a, 2)], e2 = [v(c, 0) - v(a, 0), v(c, 1) - v(a, 1), v(c, 2) - v(a, 2)];
  const area = 0.5 * Math.hypot(e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!);
  let cnt = Math.floor(area * DENS + rnd());
  const mat = Math.round(m.mat[a]); const al = albedo[mat]!, sb = subOf(mat);
  while (cnt-- > 0) {
    let u = rnd(), w = rnd(); if (u + w > 1) { u = 1 - u; w = 1 - w; } const o = 1 - u - w, ws = [o, u, w], vs = [a, b, c];
    let px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0, cr = 0, cg = 0, cb = 0, ao = 0;
    for (let q = 0; q < 3; q++) { const i = vs[q]!, k = ws[q]!; px += k * v(i, 0); py += k * v(i, 1); pz += k * v(i, 2); nx += k * m.normal[3 * i]; ny += k * m.normal[3 * i + 1]; nz += k * m.normal[3 * i + 2]; cr += k * m.color[4 * i]; cg += k * m.color[4 * i + 1]; cb += k * m.color[4 * i + 2]; ao += k * m.color[4 * i + 3]; }
    const l = Math.hypot(nx, ny, nz) || 1; P.push(px, py, pz); Nn.push(nx / l, ny / l, nz / l);
    const f = 0.3 + 0.7 * ao; C.push(al[0] * cr * f, al[1] * cg * f, al[2] * cb * f); S.push(sb); A.push(ao);
  }
}
const N = S.length, pos = Float32Array.from(P), nrm = Float32Array.from(Nn), col = Float32Array.from(C), sub = Float32Array.from(S);
console.log('points', N);

// Зародыши: три самых тёмных (по AO) места на полу, разнесённых по комнате, и один под тумбой.
const floorIdx: number[] = []; for (let i = 0; i < N; i++) if (nrm[3 * i + 1]! > 0.9 && pos[3 * i + 1]! < y0 + 0.04) floorIdx.push(i);
const inObj = (i: number, g: number): boolean => pos[3 * i]! > ob.min[0] - g && pos[3 * i]! < ob.max[0] + g && pos[3 * i + 2]! > ob.min[2] - g && pos[3 * i + 2]! < ob.max[2] + g;
const sorted = floorIdx.filter((i) => !inObj(i, 0.1)).sort((a, b) => A[a]! - A[b]!), seeds: number[] = [];
for (const i of sorted) { if (seeds.length >= 3) break; if (seeds.every((s) => Math.hypot(pos[3 * s]! - pos[3 * i]!, pos[3 * s + 2]! - pos[3 * i + 2]!) > 2)) seeds.push(i); }
let under = floorIdx.filter((i) => inObj(i, 0)); if (!under.length) under = floorIdx.slice().sort((a, b) => Math.hypot(pos[3 * a]! - cx, pos[3 * a + 2]! - cz) - Math.hypot(pos[3 * b]! - cx, pos[3 * b + 2]! - cz)).slice(0, 1);
seeds.push(under[0]!);
const params = { seed: 4242, step, T: env('T', 100), speed: env('SPEED', 0.03), branch: env('BRANCH', 0.05), maxTips: 300, slow: env('SLOW', 150), R0: 0.10, R1: 0.25, floorY: y0, mushRate: env('MUSH', 0.004), maxMush: 260 };
const res = grow(pos, nrm, sub, seeds, params);
console.log(res.stats);
const T = params.T;

// ---- Рендер ----
const W = 960, H = 540;
interface View { sx: Float32Array; sy: Float32Array; d: Float32Array; lit: Float32Array; sz: Uint8Array; ok: Uint8Array; proj: (x: number, y: number, z: number, o: number[]) => void; light: (x: number, y: number, z: number, nx: number, ny: number, nz: number, d: number) => number; size: (d: number, base: number) => number; bias: number; lineW: (d: number) => number; }
const mkView = (proj: View['proj'], light: View['light'], size: View['size'], bias: number, lineW: View['lineW'], flip: boolean): View => {
  const v: View = { sx: new Float32Array(N), sy: new Float32Array(N), d: new Float32Array(N), lit: new Float32Array(N), sz: new Uint8Array(N), ok: new Uint8Array(N), proj, light, size, bias, lineW };
  const o = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    proj(pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!, o);
    if (o[2]! <= 0.05 || (flip && nrm[3 * i + 1]! < -0.5)) continue;
    v.sx[i] = o[0]!; v.sy[i] = o[1]!; v.d[i] = o[2]!; v.ok[i] = 1; v.sz[i] = size(o[2]!, step);
    v.lit[i] = light(pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!, nrm[3 * i]!, nrm[3 * i + 1]!, nrm[3 * i + 2]!, o[2]!);
  }
  return v;
};
// Камера перед предметом.
const fr = [[0, 1], [1, 0], [0, -1], [-1, 0]][ob.rot]!;
const cam = [cx + fr[0]! * 3, 1.45, cz + fr[1]! * 3], tgt = [cx, 0.6, cz];
let f = [tgt[0]! - cam[0]!, tgt[1]! - cam[1]!, tgt[2]! - cam[2]!]; { const l = Math.hypot(...f); f = f.map((x) => x / l); }
const rt = (() => { const r = [f[1]! * 0 - f[2]! * 1, f[2]! * 0 - f[0]! * 0, f[0]! * 1 - f[1]! * 0]; const l = Math.hypot(...r); return r.map((x) => x / l); })();
const up = [rt[1]! * f[2]! - rt[2]! * f[1]!, rt[2]! * f[0]! - rt[0]! * f[2]!, rt[0]! * f[1]! - rt[1]! * f[0]!];
const FP = (W / 2) / Math.tan(40 * Math.PI / 180), sm = (a: number, b: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const camView = mkView((x, y, z, o) => { const dx = x - cam[0]!, dy = y - cam[1]!, dz = z - cam[2]!; const d = dx * f[0]! + dy * f[1]! + dz * f[2]!; o[2] = d; o[0] = W / 2 + FP * (dx * rt[0]! + dy * rt[1]! + dz * rt[2]!) / d; o[1] = H / 2 - FP * (dx * up[0]! + dy * up[1]! + dz * up[2]!) / d; },
  (x, y, z, nx, ny, nz) => { const dx = x - cam[0]!, dy = y - cam[1]!, dz = z - cam[2]!, l = Math.hypot(dx, dy, dz), ang = Math.acos((dx * f[0]! + dy * f[1]! + dz * f[2]!) / l) * 180 / Math.PI;
    return (sm(30, 14, ang) / (1 + 0.08 * l * l) + 0.035) * (0.55 + 0.45 * Math.max(0, -(dx * nx + dy * ny + dz * nz) / l)); },
  (d, base) => Math.max(1, Math.min(10, Math.round(base * FP / d * 2.2))), 0.03, (d) => (d < 2.6 ? 2 : 1), false);
// Вид сверху: масштаб по размаху точек.
let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let i = 0; i < N; i++) { x0 = Math.min(x0, pos[3 * i]!); x1 = Math.max(x1, pos[3 * i]!); z0 = Math.min(z0, pos[3 * i + 2]!); z1 = Math.max(z1, pos[3 * i + 2]!); }
const SC = Math.min((W - 20) / (x1 - x0), (H - 20) / (z1 - z0)), ox = W / 2 - SC * (x0 + x1) / 2, oz = H / 2 - SC * (z0 + z1) / 2;
const planView = mkView((x, y, z, o) => { o[0] = ox + SC * x; o[1] = oz + SC * z; o[2] = 5 - y; },
  (_x, _y, _z, _nx, ny) => 0.2 + 0.8 * Math.max(0, ny), (_d, base) => Math.max(2, Math.ceil(base * SC * 2)), 0.02, () => 2, true);

// Точки грибов: проекция для обоих видов.
const NM = res.mT.length;
const mkM = (v: View): { sx: Float32Array; sy: Float32Array; d: Float32Array; lit: Float32Array; sz: Uint8Array } => {
  const o = [0, 0, 0], r = { sx: new Float32Array(NM), sy: new Float32Array(NM), d: new Float32Array(NM), lit: new Float32Array(NM), sz: new Uint8Array(NM) };
  for (let i = 0; i < NM; i++) { const x = res.mPos[3 * i]!, y = res.mPos[3 * i + 1]!, z = res.mPos[3 * i + 2]!; v.proj(x, y, z, o); r.sx[i] = o[0]!; r.sy[i] = o[1]!; r.d[i] = o[2]!; r.sz[i] = Math.max(2, v.size(o[2]!, 0.03)); r.lit[i] = v.light(x, y, z, res.mNrm[3 * i]!, res.mNrm[3 * i + 1]!, res.mNrm[3 * i + 2]!, o[2]!); }
  return r;
};
const camM = mkM(camView), planM = mkM(planView);
const FELT = [0.6, 0.66, 0.52], THR = [0.95, 0.88, 0.72];
const EXP = env('EXP', 1.7), TH = env('TH', 1.5), PL = env('PL', 1.0);
function render(v: View, mv: ReturnType<typeof mkM>, t: number, plan: boolean): Uint8Array {
  const buf = new Float32Array(W * H * 3).fill(0.004), zb = new Float32Array(W * H).fill(1e9);
  const stamp = (x: number, y: number, s: number, d: number, r: number, g: number, b: number): void => {
    const h = s >> 1, xs = Math.round(x) - h, ys = Math.round(y) - h;
    for (let j = ys; j < ys + s; j++) { if (j < 0 || j >= H) continue; for (let i = xs; i < xs + s; i++) { if (i < 0 || i >= W) continue; const k = j * W + i; if (d < zb[k]!) { zb[k] = d; buf[3 * k] = r; buf[3 * k + 1] = g; buf[3 * k + 2] = b; } } }
  };
  for (let i = 0; i < N; i++) {
    if (!v.ok[i]) continue; let r = col[3 * i]!, g = col[3 * i + 1]!, b = col[3 * i + 2]!;
    const a = sm(0, 18, t - res.feltT[i]!) * 0.75; if (a > 0) { r += (FELT[0]! * 0.45 - r) * a; g += (FELT[1]! * 0.45 - g) * a; b += (FELT[2]! * 0.45 - b) * a; }
    const L = v.lit[i]! * (plan ? PL : 1); stamp(v.sx[i]!, v.sy[i]!, v.sz[i]!, v.d[i]!, r * L, g * L, b * L);
  }
  // нити: отрезки от родителя
  for (let i = 0; i < N; i++) {
    const pI = res.parent[i]!; if (pI < 0 || !(res.threadT[i]! <= t) || !v.ok[i] || !v.ok[pI]) continue;
    const dx = v.sx[i]! - v.sx[pI]!, dy = v.sy[i]! - v.sy[pI]!, n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))); if (n > 80) continue;
    const w = v.lineW(v.d[i]!), L = v.lit[i]! * TH * (plan ? 0.6 : 1);
    for (let q = 0; q <= n; q++) { const k = n ? q / n : 0; stamp(v.sx[pI]! + dx * k, v.sy[pI]! + dy * k, w, v.d[pI]! + (v.d[i]! - v.d[pI]!) * k - v.bias, THR[0]! * L, THR[1]! * L, THR[2]! * L); }
  }
  for (let i = 0; i < NM; i++) { if (!(res.mT[i]! <= t)) continue; const L = mv.lit[i]! * 1.0 * (plan ? 0.6 : 1); stamp(mv.sx[i]!, mv.sy[i]!, mv.sz[i]!, mv.d[i]! - v.bias * 2, res.mCol[3 * i]! * L, res.mCol[3 * i + 1]! * L, res.mCol[3 * i + 2]! * L); }
  // закрыть дыры посева: пустой пиксель, окружённый занятыми, берёт цвет соседа
  const hole: number[] = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const k = y * W + x; if (zb[k]! < 1e9) continue; let c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (zb[k + dy * W + dx]! < 1e9) c++; if (c >= 4) hole.push(k); }
  for (const k of hole) { let bz = 1e9, bk = -1; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const q = k + dy * W + dx; if (zb[q]! < bz) { bz = zb[q]!; bk = q; } } if (bk >= 0) { buf[3 * k] = buf[3 * bk]!; buf[3 * k + 1] = buf[3 * bk + 1]!; buf[3 * k + 2] = buf[3 * bk + 2]!; } }
  const out = new Uint8Array(W * H * 3); for (let i = 0; i < out.length; i++) out[i] = Math.round(255 * Math.pow(Math.min(1, buf[i]! * EXP), 1 / 2.2));
  return out;
}
const times = [0, 0.12, 0.25, 0.45, 0.7, 1.0];
writeFileSync(`${G}/view.rgb`, Buffer.concat(times.map((f0) => Buffer.from(render(camView, camM, f0 * T, false)))));
writeFileSync(`${G}/plan.rgb`, Buffer.concat(times.map((f0) => Buffer.from(render(planView, planM, f0 * T, true)))));
writeFileSync(`${G}/gif.rgb`, Buffer.concat(Array.from({ length: 36 }, (_, k) => Buffer.from(render(camView, camM, (k / 35) * T, false)))));
writeFileSync(`${G}/stats.json`, JSON.stringify({ params, seeds: seeds.map((s) => [...pos.slice(3 * s, 3 * s + 3)]), obj: ob, render: { EXP, TH, PL, W, H }, stats: res.stats }, null, 1));
