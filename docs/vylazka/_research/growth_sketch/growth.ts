/** Микродвижок роста грибницы по облаку точек. Чистый TS, без импортов. Один сид — один результат. */
export interface GrowthParams {
  seed: number; step: number; T: number; speed: number; branch: number; maxTips: number;
  slow: number; R0: number; R1: number; floorY: number; mushRate: number; maxMush: number;
}
export interface GrowthResult {
  threadT: Float32Array; feltT: Float32Array; parent: Int32Array;
  mPos: Float32Array; mNrm: Float32Array; mCol: Float32Array; mT: Float32Array;
  stats: Record<string, number>;
}
const K = 8;
function rng(seed: number): () => number { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Бинарная куча по ключу: пары (ключ, значение). */
class Heap {
  k: number[] = []; v: number[] = [];
  get size(): number { return this.k.length; }
  push(key: number, val: number): void {
    let i = this.k.length; this.k.push(key); this.v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (this.k[p]! <= key) break; this.k[i] = this.k[p]!; this.v[i] = this.v[p]!; i = p; }
    this.k[i] = key; this.v[i] = val;
  }
  pop(): [number, number] {
    const rk = this.k[0]!, rv = this.v[0]!; const lk = this.k.pop()!, lv = this.v.pop()!; const n = this.k.length;
    if (n > 0) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && this.k[c + 1]! < this.k[c]!) c++; if (this.k[c]! >= lk) break; this.k[i] = this.k[c]!; this.v[i] = this.v[c]!; i = c; } this.k[i] = lk; this.v[i] = lv; }
    return [rk, rv];
  }
}
/** Единичный вектор, повёрнутый вокруг оси n на угол a (Родригес; d ⟂ n почти всегда). */
function rot(d: number[], n: number[], a: number): number[] {
  const c = Math.cos(a), s = Math.sin(a), dn = d[0]! * n[0]! + d[1]! * n[1]! + d[2]! * n[2]!;
  const cx = n[1]! * d[2]! - n[2]! * d[1]!, cy = n[2]! * d[0]! - n[0]! * d[2]!, cz = n[0]! * d[1]! - n[1]! * d[0]!;
  return [d[0]! * c + cx * s + n[0]! * dn * (1 - c), d[1]! * c + cy * s + n[1]! * dn * (1 - c), d[2]! * c + cz * s + n[2]! * dn * (1 - c)];
}
export function grow(pos: Float32Array, nrm: Float32Array, sub: Float32Array, seeds: number[], p: GrowthParams): GrowthResult {
  const N = sub.length, rand = rng(p.seed), ms: Record<string, number> = {};
  let t0 = performance.now();
  // 1. Граф соседей: сетка с ячейкой r, до K ближайших, ребро только если нормали не противоположны.
  const r = 2.2 * p.step, r2 = r * r, inv = 1 / r;
  const HS = 1 << 20, head = new Int32Array(HS).fill(-1), nxt = new Int32Array(N);
  const cellOf = (x: number, y: number, z: number): number => ((Math.floor(x * inv) * 73856093) ^ (Math.floor(y * inv) * 19349663) ^ (Math.floor(z * inv) * 83492791)) & (HS - 1);
  for (let i = 0; i < N; i++) { const h = cellOf(pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!); nxt[i] = head[h]!; head[h] = i; }
  const nb = new Int32Array(N * K).fill(-1), nd = new Float32Array(N * K), deg = new Uint8Array(N);
  let edges = 0;
  const cj = new Int32Array(K), cd = new Float32Array(K);
  for (let i = 0; i < N; i++) {
    const x = pos[3 * i]!, y = pos[3 * i + 1]!, z = pos[3 * i + 2]!; let m = 0;
    const gx = Math.floor(x * inv), gy = Math.floor(y * inv), gz = Math.floor(z * inv);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (let j = head[(((gx + dx) * 73856093) ^ ((gy + dy) * 19349663) ^ ((gz + dz) * 83492791)) & (HS - 1)]!; j >= 0; j = nxt[j]!) {
        if (j === i) continue;
        const ex = pos[3 * j]! - x, ey = pos[3 * j + 1]! - y, ez = pos[3 * j + 2]! - z, d2 = ex * ex + ey * ey + ez * ez;
        if (d2 > r2 || nrm[3 * i]! * nrm[3 * j]! + nrm[3 * i + 1]! * nrm[3 * j + 1]! + nrm[3 * i + 2]! * nrm[3 * j + 2]! <= -0.2) continue;
        let q: number; if (m < K) q = m++; else if (d2 >= cd[K - 1]!) continue; else q = K - 1; // вставка с сохранением порядка
        while (q > 0 && cd[q - 1]! > d2) { cd[q] = cd[q - 1]!; cj[q] = cj[q - 1]!; q--; }
        cd[q] = d2; cj[q] = j;
      }
    }
    for (let q = 0; q < m; q++) { nb[i * K + q] = cj[q]!; nd[i * K + q] = Math.sqrt(cd[q]!); }
    deg[i] = m; edges += m;
  }
  ms.graph = performance.now() - t0; t0 = performance.now();
  // 2. Гифы: кончики идут фронтом по времени; приход в узел фиксирует thread[узел].
  const thread = new Float32Array(N).fill(Infinity), parent = new Int32Array(N).fill(-1);
  const tn: number[] = [], tdx: number[] = [], tdy: number[] = [], tdz: number[] = [], tt: number[] = [];
  const heap = new Heap(); let live = 0, born = 0, branches = 0;
  const addTip = (node: number, d: number[], t: number): void => { tn.push(node); tdx.push(d[0]!); tdy.push(d[1]!); tdz.push(d[2]!); tt.push(t); heap.push(t, tn.length - 1); live++; born++; };
  const tangent = (n: number[], a: number): number[] => { // случайное направление в касательной плоскости
    const u = Math.abs(n[1]!) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let ax = n[1]! * u[2]! - n[2]! * u[1]!, ay = n[2]! * u[0]! - n[0]! * u[2]!, az = n[0]! * u[1]! - n[1]! * u[0]!; const l = Math.hypot(ax, ay, az) || 1;
    return rot([ax / l, ay / l, az / l], n, a);
  };
  for (const s of seeds) { thread[s] = 0; const n = [nrm[3 * s]!, nrm[3 * s + 1]!, nrm[3 * s + 2]!]; for (let q = 0; q < 4; q++) addTip(s, tangent(n, rand() * 6.283), 0); }
  while (heap.size) {
    const [t, k] = heap.pop(); const i = tn[k]!;
    if (t > p.T) { live--; continue; }
    const px = pos[3 * i]!, py = pos[3 * i + 1]!, pz = pos[3 * i + 2]!; let best = -1, bs = -1e9, bdx = 0, bdy = 0, bdz = 0, bl = 0;
    for (let q = 0; q < deg[i]!; q++) {
      const j = nb[i * K + q]!; if (thread[j]! < Infinity) continue;
      const ex = (pos[3 * j]! - px) / nd[i * K + q]!, ey = (pos[3 * j + 1]! - py) / nd[i * K + q]!, ez = (pos[3 * j + 2]! - pz) / nd[i * K + q]!;
      const s = ex * tdx[k]! + ey * tdy[k]! + ez * tdz[k]! + 0.35 * rand() + 0.3 * sub[j]!;
      if (s > bs) { bs = s; best = j; bdx = ex; bdy = ey; bdz = ez; bl = nd[i * K + q]!; }
    }
    if (best < 0) { live--; continue; } // слияние: свободных соседей нет
    const nt = t + bl / (p.speed * (0.25 + 0.75 * sub[best]!));
    thread[best] = nt; parent[best] = i;
    const n2 = [nrm[3 * best]!, nrm[3 * best + 1]!, nrm[3 * best + 2]!];
    let dx = 0.7 * tdx[k]! + 0.3 * bdx, dy = 0.7 * tdy[k]! + 0.3 * bdy, dz = 0.7 * tdz[k]! + 0.3 * bdz;
    const dn = dx * n2[0]! + dy * n2[1]! + dz * n2[2]!; dx -= n2[0]! * dn; dy -= n2[1]! * dn; dz -= n2[2]! * dn; // в касательную плоскость
    const l = Math.hypot(dx, dy, dz) || 1; tn[k] = best; tdx[k] = dx / l; tdy[k] = dy / l; tdz[k] = dz / l; tt[k] = nt; heap.push(nt, k);
    if (live < p.maxTips && rand() < p.branch * sub[best]!) { // ветвление: поворот на 25–60° вокруг нормали
      const ang = (25 + 35 * rand()) * Math.PI / 180 * (rand() < 0.5 ? -1 : 1);
      addTip(best, rot([dx / l, dy / l, dz / l], n2, ang), nt); branches++;
    }
  }
  ms.hyphae = performance.now() - t0; t0 = performance.now();
  // 3. Налёт: Дейкстра с несколькими источниками по графу, радиус зависит от «съедобности».
  const felt = new Float32Array(N).fill(Infinity), dist = new Float32Array(N), fh = new Heap();
  for (let i = 0; i < N; i++) if (thread[i]! < Infinity) { felt[i] = thread[i]!; dist[i] = 0; fh.push(felt[i]!, i); }
  while (fh.size) {
    const [f, i] = fh.pop(); if (f > felt[i]!) continue;
    for (let q = 0; q < deg[i]!; q++) {
      const j = nb[i * K + q]!, dj = dist[i]! + nd[i * K + q]!;
      if (dj > p.R0 + (p.R1 - p.R0) * sub[j]!) continue;
      const fj = f + nd[i * K + q]! * p.slow;
      if (fj < felt[j]!) { felt[j] = fj; dist[j] = dj; fh.push(fj, j); }
    }
  }
  ms.felt = performance.now() - t0; t0 = performance.now();
  // 4. Плодовые тела: гроздья на нитях, чаще на горизонталях и у пола; грибы — тоже точки.
  const mp: number[] = [], mn: number[] = [], mc: number[] = [], mt: number[] = []; let mush = 0, clusters = 0;
  const stride = 2654435761 % N | 1; // обход узлов вперемешку, чтобы грибы не копились в начале облака
  for (let kk = 0; kk < N && mush < p.maxMush; kk++) {
    const i = Math.floor((kk * stride) % N);
    if (!(thread[i]! < p.T * 0.8)) continue;
    const ny = nrm[3 * i + 1]!, low = pos[3 * i + 1]! - p.floorY < 0.25 ? 2 : 1;
    if (rand() > p.mushRate * (0.2 + 0.8 * sub[i]!) * (ny > 0.7 ? 1 : 0.12) * low) continue;
    clusters++; const cnt = 3 + Math.floor(rand() * 5), hBase = 0.04 + 0.06 * rand();
    for (let c = 0; c < cnt && mush < p.maxMush; c++) {
      let b = i; for (let hop = 0; hop < 2; hop++) { const q = Math.floor(rand() * deg[b]!); const j = nb[b * K + q]!; if (j >= 0 && thread[j]! < Infinity) b = j; }
      const n = [nrm[3 * b]!, nrm[3 * b + 1]!, nrm[3 * b + 2]!], u = tangent(n, rand() * 6.283), v = [n[1]! * u[2]! - n[2]! * u[1]!, n[2]! * u[0]! - n[0]! * u[2]!, n[0]! * u[1]! - n[1]! * u[0]!];
      const h = Math.max(0.03, Math.min(0.12, hBase * (0.6 + 0.8 * rand()))), rs = h * 0.07, rc = h * (0.3 + 0.25 * rand()), bend = (rand() - 0.5) * h * 0.8;
      const t0m = thread[b]! + 4 + 12 * rand(), G = 8 + 8 * rand(); mush++;
      const put = (lx: number, ly: number, lz: number, nx: number, ny2: number, nz: number, col: number[], tm: number): void => { // локально: x,z — по u,v; y — вдоль нормали
        const bx = bend * ly * ly / h / h; // изгиб ножки
        mp.push(pos[3 * b]! + u[0]! * (lx + bx) + v[0]! * lz + n[0]! * ly, pos[3 * b + 1]! + u[1]! * (lx + bx) + v[1]! * lz + n[1]! * ly, pos[3 * b + 2]! + u[2]! * (lx + bx) + v[2]! * lz + n[2]! * ly);
        mn.push(u[0]! * nx + n[0]! * ny2 + v[0]! * nz, u[1]! * nx + n[1]! * ny2 + v[1]! * nz, u[2]! * nx + n[2]! * ny2 + v[2]! * nz);
        mc.push(col[0]!, col[1]!, col[2]!); mt.push(tm);
      };
      for (let l = 0; l < 7; l++) { const s = l / 6; for (let a = 0; a < 6; a++) { const an = a * Math.PI / 3 + l; put(rs * Math.cos(an), s * h, rs * Math.sin(an), Math.cos(an), 0, Math.sin(an), [0.9, 0.85, 0.74], t0m + s * G); } }
      const nrg = 7; for (let g = 0; g <= nrg; g++) { // купол: кольца по полярному углу
        const pa = g / nrg * 1.45, cnum = g === 0 ? 1 : Math.round(5 + g * 2.6);
        for (let a = 0; a < cnum; a++) { const an = a / cnum * 6.283 + g, sx = Math.sin(pa) * Math.cos(an), sz = Math.sin(pa) * Math.sin(an), sy = Math.cos(pa), dark = Math.max(0, 1 - g / 4);
          put(rc * sx, h + rc * 0.7 * sy, rc * sz, sx, sy, sz, [0.62 - 0.24 * dark, 0.43 - 0.18 * dark, 0.24 - 0.1 * dark], t0m + G + g / nrg * G * 0.8); }
      }
      for (let a = 0; a < 14; a++) { const an = a / 14 * 6.283; put(rc * 1.08 * Math.cos(an), h + rc * 0.7 * 0.1, rc * 1.08 * Math.sin(an), Math.cos(an), 0.1, Math.sin(an), [0.72, 0.55, 0.34], t0m + G + G * 0.8); } // кромка
    }
  }
  ms.mush = performance.now() - t0;
  let tn_ = 0, fn_ = 0; for (let i = 0; i < N; i++) { if (thread[i]! < Infinity) tn_++; if (felt[i]! < Infinity) fn_++; }
  return { threadT: thread, feltT: felt, parent, mPos: new Float32Array(mp), mNrm: new Float32Array(mn), mCol: new Float32Array(mc), mT: new Float32Array(mt),
    stats: { points: N, edges, msGraph: ms.graph!, msHyphae: ms.hyphae!, msFelt: ms.felt!, msMush: ms.mush!, threadNodes: tn_, feltNodes: fn_, tipsBorn: born, branches, mushrooms: mush, clusters, mushPoints: mp.length / 3 } };
}
