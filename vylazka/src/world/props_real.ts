/**
 * Реалистичные замены вещам из набора KayKit (слова партнёра: «Точно нужно менять вещи из набора KayKit
 * на более реалистичные по типу стула. Подбери альтернативу и поставь рядом, я выберу что меняем, а что
 * оставим»). Образец — стул из гнутой фанеры (props_seating.ts): настоящие пропорции, тонкие детали,
 * материалы как в жизни. С 16.11 стоят на уровнях вместо всех вещей набора, что были в игре (слова
 * партнёра: «Меняй все вещи, я отметил пару, но нужна замена всех»).
 *
 * Координаты как у заменяемых вещей: у стены — спина в z = 0, пол y = 0; «посреди пола» (free) — середина
 * в начале координат; на стене — низ в y = 0 реквизита, спина в z = 0. Вся случайность — из сида.
 */
import type { Vec3 } from '../core/types';
import { MAT } from './materials';
import type { Xf } from './props';
import { rng } from './props_more';
import type { PropSpec } from './props_more';
import { bendPath, panel, tube } from './props_seating';

const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

/**
 * Тело вращения по профилю [радиус, высота] снизу вверх; ribs(θ, t) — множитель радиуса (рёбра кактуса,
 * неровность горшка), t — доля высоты 0..1. Верх и низ закрываются, если радиус там не ноль.
 */
function lathe(xf: Xf, cx: number, cz: number, profile: readonly [number, number][], seg: number, mat: number, tintAt: (t: number, th: number) => Vec3, ribs: (th: number, t: number) => number = () => 1, aoAt: (t: number) => number = () => 1): void {
  const mb = xf.mb;
  const n = profile.length;
  const rows: number[][] = [];
  for (let i = 0; i < n; i++) {
    const [r, y] = profile[i]!;
    const t = i / (n - 1);
    // Наклон образующей — для нормали.
    const [r0, y0] = profile[Math.max(0, i - 1)]!;
    const [r1, y1] = profile[Math.min(n - 1, i + 1)]!;
    const dr = r1 - r0;
    const dy = y1 - y0 || 1e-6;
    const row: number[] = [];
    for (let k = 0; k < seg; k++) {
      const th = (k / seg) * Math.PI * 2;
      const rr = r * ribs(th, t);
      const c = Math.cos(th);
      const s = Math.sin(th);
      const nl = Math.hypot(dy, dr) || 1;
      const nx = (c * dy) / nl;
      const nz = (s * dy) / nl;
      const ny = -dr / nl;
      row.push(mb.vertex(xf.pt(cx + c * rr, y, cz + s * rr), xf.dir(nx, ny, nz), mat, tintAt(t, th), aoAt(t)));
    }
    rows.push(row);
  }
  for (let i = 0; i + 1 < n; i++) {
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      mb.tri(rows[i]![k]!, rows[i + 1]![k1]!, rows[i]![k1]!);
      mb.tri(rows[i]![k]!, rows[i + 1]![k]!, rows[i + 1]![k1]!);
    }
  }
  for (const [i, up] of [[0, false], [n - 1, true]] as const) {
    const [r, y] = profile[i]!;
    if (r < 1e-4) continue;
    const c = mb.vertex(xf.pt(cx, y, cz), xf.dir(0, up ? 1 : -1, 0), mat, tintAt(i / (n - 1), 0), 1);
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      if (up) mb.tri(c, rows[i]![k1]!, rows[i]![k]!);
      else mb.tri(c, rows[i]![k]!, rows[i]![k1]!);
    }
  }
}

// ───────────────────────────── столик ─────────────────────────────

/** Столик из столовой или комнаты отдыха: столешница из пластика под дерево с тёмной кромкой, трубчатые ножки, как у стула. */
function cafeTable(xf: Xf, seed: number): void {
  const r = rng(seed);
  const top: Vec3 = r() < 0.5 ? [1.1, 1.0, 0.86] : [0.92, 0.88, 0.8];
  const frame: Vec3 = [0.24, 0.24, 0.25];
  const H = 0.72;
  const A = 0.34;
  const zc = 0.36;
  // Столешница: плита 22 мм со скруглёнными углами, кромка темнее.
  panel(xf, A, A, 0.022, (s, t) => [s, H, zc + t], [0, 1, 0], MAT.veneer, top, [0.25, 0.2, 0.17]);
  // Царга под столешницей — четыре трубы квадратом.
  const g = A - 0.06;
  tube(xf, [[-g, H - 0.045, zc - g], [g, H - 0.045, zc - g], [g, H - 0.045, zc + g], [-g, H - 0.045, zc + g], [-g, H - 0.045, zc - g]], 0.011, MAT.metalGrey, frame, 6);
  // Ножки: от углов царги вниз, чуть разведены наружу; подпятники.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * g;
      const z = zc + sz * g;
      tube(xf, bendPath([[x, H - 0.045, z], [x + sx * 0.012, 0.015, z + sz * 0.012]], 0.02), 0.012, MAT.metalGrey, frame, 8);
      xf.cyl([x + sx * 0.012, 0, z + sz * 0.012], 'y', 0.015, 0.016, MAT.rubber, { tint: [0.15, 0.15, 0.15], segments: 8 });
    }
  }
  xf.collider([-A, 0, zc - A], [A, H, zc + A]);
}

// ───────────────────────────── кресло ─────────────────────────────

/** Кресло для посетителей, как в кабинетах восьмидесятых: обивка на рамке, деревянные подлокотники на ножках. */
function visitorArmchair(xf: Xf, seed: number): void {
  const r = rng(seed);
  const CLOTH: readonly Vec3[] = [
    [0.86, 0.62, 0.42],
    [0.7, 0.86, 0.68],
    [0.72, 0.62, 0.86],
    [1.05, 0.82, 0.52],
  ];
  const cloth = CLOTH[Math.floor(r() * CLOTH.length)]!;
  const wood: Vec3 = [0.72, 0.58, 0.46];
  const W = 0.72;
  const D = 0.74;
  const half = W / 2;
  // Ножки: четыре деревянных, конусом.
  for (const sx of [-1, 1]) {
    for (const z of [0.06, D - 0.06]) xf.cyl([sx * (half - 0.05), 0, z], 'y', 0.16, 0.022, MAT.veneer, { tint: wood, radiusEnd: 0.016, segments: 10 });
  }
  // Рама сиденья и подушка.
  xf.box([-half + 0.06, 0.16, 0.06], [half - 0.06, 0.26, D - 0.04], MAT.upholstery, { tint: shade(cloth, 0.8), bevel: 0.015, aoBottom: 0.5 });
  xf.box([-half + 0.07, 0.26, 0.14], [half - 0.07, 0.4, D - 0.03], MAT.upholstery, { tint: cloth, bevel: 0.045 });
  // Спинка: подушка с наклоном — три ступени, чтобы наклон читался без поворота коробок.
  for (let i = 0; i < 3; i++) {
    const y0 = 0.36 + i * 0.15;
    const z0 = 0.05 - i * 0.025;
    xf.box([-half + 0.08, y0, z0], [half - 0.08, y0 + 0.17, z0 + 0.13], MAT.upholstery, { tint: shade(cloth, 0.97 - i * 0.02), bevel: 0.04 });
  }
  // Боковины под обивкой и деревянные подлокотники сверху, с закруглённым передним концом.
  for (const sx of [-1, 1]) {
    const x0 = sx > 0 ? half - 0.075 : -half;
    xf.box([x0, 0.16, 0.04], [x0 + 0.075, 0.54, D - 0.06], MAT.upholstery, { tint: shade(cloth, 0.9), bevel: 0.02 });
    const xa = sx * (half - 0.0375);
    xf.box([xa - 0.045, 0.54, 0.02], [xa + 0.045, 0.565, D - 0.08], MAT.veneer, { tint: wood, bevel: 0.008 });
    xf.cyl([xa, 0.54, D - 0.08], 'y', 0.025, 0.045, MAT.veneer, { tint: wood, segments: 14 });
  }
  xf.collider([-half, 0, 0], [half, 0.56, D]);
}

// ───────────────────────────── торшер ─────────────────────────────

/** Торшер: тяжёлое круглое основание, тонкая латунная стойка, тканевый абажур конусом, выключатель на шнуре. */
function floorLamp(xf: Xf, seed: number): void {
  const r = rng(seed);
  const shadeTint: Vec3 = r() < 0.5 ? [1.12, 1.02, 0.84] : [1.0, 0.86, 0.7];
  const cx = 0;
  const cz = 0.3;
  xf.cyl([cx, 0, cz], 'y', 0.022, 0.15, MAT.metalGrey, { tint: [0.18, 0.18, 0.19], segments: 24, radiusEnd: 0.14 });
  xf.cyl([cx, 0.022, cz], 'y', 0.02, 0.03, MAT.brass, { segments: 12, radiusEnd: 0.012 });
  tube(xf, [[cx, 0.04, cz], [cx, 1.42, cz]], 0.0085, MAT.brass, [1, 1, 1], 8);
  // Патрон и абажур: открытый конус ткани, изнутри светлее.
  xf.cyl([cx, 1.42, cz], 'y', 0.07, 0.022, MAT.bakelite, { segments: 10 });
  lathe(xf, cx, cz, [[0.24, 1.36], [0.235, 1.4], [0.2, 1.52], [0.165, 1.62], [0.16, 1.63]], 28, MAT.canvas, (t) => shade(shadeTint, 0.92 + 0.12 * t), (th) => 1 + 0.008 * Math.cos(th * 14));
  // Обод внизу абажура и шнур с выключателем.
  tube(xf, Array.from({ length: 29 }, (_, k) => [cx + Math.cos((k / 28) * Math.PI * 2) * 0.241, 1.36, cz + Math.sin((k / 28) * Math.PI * 2) * 0.241] as Vec3), 0.004, MAT.brass, [1, 1, 1], 5);
  tube(xf, bendPath([[cx + 0.01, 1.3, cz], [cx + 0.03, 1.0, cz + 0.01], [cx + 0.03, 0.92, cz + 0.01]], 0.05), 0.003, MAT.rubber, [0.9, 0.88, 0.84], 4);
  xf.cyl([cx + 0.03, 0.88, cz + 0.01], 'y', 0.04, 0.009, MAT.bakelite, { tint: [0.9, 0.88, 0.84], segments: 8 });
  xf.collider([cx - 0.15, 0, cz - 0.15], [cx + 0.15, 1.6, cz + 0.15]);
}

// ───────────────────────────── кактусы ─────────────────────────────

/** Пучок колючек — светлая точка в два треугольника, лицом от оси кактуса (дешевле коробочки в шесть раз). */
function spine(xf: Xf, cx: number, cz: number, th: number, rr: number, y: number, size: number): void {
  const c = Math.cos(th);
  const s = Math.sin(th);
  const p: Vec3 = [cx + c * rr, y, cz + s * rr];
  const t: Vec3 = [-s * size, 0, c * size];
  xf.mb.quadFacing(xf.pt(p[0] - t[0], p[1], p[2] - t[2]), xf.pt(p[0], p[1] - size, p[2]), xf.pt(p[0] + t[0], p[1], p[2] + t[2]), xf.pt(p[0], p[1] + size, p[2]), xf.dir(c, 0, s), MAT.paper, [1.1, 1.08, 0.95]);
}

const POT: Vec3 = [0.86, 0.5, 0.36];
const SOIL: Vec3 = [0.26, 0.2, 0.16];
const CACTUS: Vec3 = [0.42, 0.62, 0.36];

/** Глиняный горшок с бортиком и землёй. Середина дна — (cx, 0, cz). Возвращает высоту земли. */
function pot(xf: Xf, cx: number, cz: number, rTop: number, h: number, seed: number): number {
  const r = rng(seed);
  const tint = shade(POT, 0.9 + 0.2 * r());
  lathe(xf, cx, cz, [[rTop * 0.72, 0], [rTop * 0.76, 0.01], [rTop * 0.94, h * 0.82], [rTop * 0.95, h * 0.84], [rTop * 1.04, h * 0.85], [rTop * 1.04, h], [rTop * 0.94, h]], 24, MAT.cardboard, (t) => shade(tint, 0.85 + 0.2 * t));
  xf.cyl([cx, h - 0.02, cz], 'y', 0.004, rTop * 0.93, MAT.dirt, { tint: SOIL, segments: 24 });
  return h - 0.016;
}

/** Колонна кактуса с рёбрами: профиль от основания до скруглённой макушки. */
function column(xf: Xf, cx: number, cz: number, y0: number, h: number, rad: number, ribs: number, seed: number): void {
  const r = rng(seed);
  const tint = shade(CACTUS, 0.9 + 0.2 * r());
  const prof: [number, number][] = [];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    // Цилиндр, к макушке — полусфера.
    const top = t > 0.78 ? Math.sqrt(Math.max(0, 1 - ((t - 0.78) / 0.22) ** 2)) : 1;
    prof.push([rad * (0.92 + 0.08 * Math.sin(t * Math.PI)) * top, y0 + h * t]);
  }
  lathe(
    xf,
    cx,
    cz,
    prof,
    ribs * 3,
    MAT.leather,
    (t) => mix(shade(tint, 0.8), [0.6, 0.72, 0.5], t > 0.9 ? 0.4 : 0),
    (th) => 1 + 0.14 * Math.cos(th * ribs),
    () => 0.85,
  );
  // Колючки: светлые пучки по рёбрам.
  for (let k = 0; k < ribs; k++) {
    const th = (k / ribs) * Math.PI * 2;
    for (let y = y0 + 0.03; y < y0 + h * 0.85; y += 0.04 + 0.012 * r()) spine(xf, cx, cz, th, rad * 1.14 + 0.002, y, 0.003);
  }
}

/** Кактус-колонна с отростком в глиняном горшке — офисный, на полу у стены или в углу. */
function cactusColumn(xf: Xf, seed: number): void {
  const soil = pot(xf, 0, 0, 0.11, 0.17, seed);
  column(xf, 0, 0, soil, 0.38, 0.045, 8, seed + 1);
  // Отросток: короткая колонна сбоку, ниже основной.
  column(xf, 0.06, 0.01, soil + 0.13, 0.16, 0.026, 7, seed + 2);
  xf.cyl([0.035, soil + 0.13, 0.005], 'x', 0.03, 0.02, MAT.leather, { tint: shade(CACTUS, 0.85), segments: 8 });
  xf.collider([-0.12, 0, -0.12], [0.12, 0.55, 0.12]);
}

/** Маленький круглый кактус в горшочке — на столе приёмной или подоконнике. */
function cactusRound(xf: Xf, seed: number): void {
  const soil = pot(xf, 0, 0, 0.065, 0.1, seed);
  const prof: [number, number][] = [];
  const N = 9;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI;
    prof.push([Math.max(0.0005, Math.sin(a) * 0.055), soil - 0.005 + (1 - Math.cos(a)) * 0.05]);
  }
  lathe(xf, 0, 0, prof, 36, MAT.leather, () => shade(CACTUS, 1.05), (th) => 1 + 0.13 * Math.cos(th * 12), () => 0.9);
  // Пучки колючек по рёбрам — светлые точки.
  for (let k = 0; k < 12; k++) {
    const th = (k / 12) * Math.PI * 2;
    for (const a of [0.8, 1.4, 2.0]) spine(xf, 0, 0, th, Math.sin(a) * 0.055 * 1.13 + 0.002, soil - 0.005 + (1 - Math.cos(a)) * 0.05, 0.0028);
  }
}

// ───────────────────────────── картины ─────────────────────────────

/** Репродукция пейзажа в тонкой раме с паспарту: поле, лес, небо — красками по сетке, как у дешёвой печати. */
function framedPrint(xf: Xf, seed: number, W: number, H: number): void {
  const r = rng(seed);
  const frameTint: Vec3 = r() < 0.5 ? [0.62, 0.62, 0.64] : [0.45, 0.32, 0.22];
  const frameMat = frameTint[0] > 0.6 ? MAT.zinc : MAT.veneer;
  const F = 0.022;
  const D = 0.024;
  // Рама: четыре планки с фаской.
  xf.box([-W / 2, 0, 0], [W / 2, F, D], frameMat, { tint: frameTint, bevel: 0.004, skip: ['nz'] });
  xf.box([-W / 2, H - F, 0], [W / 2, H, D], frameMat, { tint: frameTint, bevel: 0.004, skip: ['nz'] });
  xf.box([-W / 2, F, 0], [-W / 2 + F, H - F, D], frameMat, { tint: frameTint, bevel: 0.004, skip: ['nz'] });
  xf.box([W / 2 - F, F, 0], [W / 2, H - F, D], frameMat, { tint: frameTint, bevel: 0.004, skip: ['nz'] });
  // Паспарту.
  const z = D - 0.008;
  xf.box([-W / 2 + F, F, 0], [W / 2 - F, H - F, z], MAT.paper, { tint: [1.15, 1.12, 1.05], skip: ['nz'] });
  // Картинка: сетка, цвет — по высоте и шуму.
  const m = 0.055 + F;
  const x0 = -W / 2 + m;
  const y0 = m;
  const pw = W - 2 * m;
  const ph = H - 2 * m;
  const NX = 16;
  const NY = Math.round((NX * ph) / pw);
  const horizon = 0.42 + 0.12 * r();
  const forest = horizon + 0.08 + 0.05 * r();
  const sky: Vec3 = [0.62, 0.78, 1.05];
  const field: Vec3 = r() < 0.5 ? [0.9, 0.82, 0.42] : [0.52, 0.72, 0.36];
  const woods: Vec3 = [0.22, 0.34, 0.24];
  const colAt = (u: number, v: number): Vec3 => {
    const wob = 0.025 * Math.sin(u * 17 + seed) + 0.015 * Math.sin(u * 41);
    if (v < horizon + wob * 0.5) {
      const path = Math.abs(u - 0.5 - (horizon - v) * 0.6) < 0.03 + (horizon - v) * 0.12 ? 1 : 0;
      return mix(shade(field, 0.75 + 0.35 * (v / horizon)), [0.82, 0.74, 0.6], path * 0.7);
    }
    if (v < forest + wob) return shade(woods, 0.8 + 0.4 * Math.abs(Math.sin(u * 60)));
    return mix(sky, [1.1, 1.05, 0.98], (v - forest) / (1 - forest) * 0.2 + 0.15 * Math.sin(u * 5 + v * 9) ** 2);
  };
  const mb = xf.mb;
  const ids: number[][] = [];
  const n = xf.dir(0, 0, 1);
  for (let j = 0; j <= NY; j++) {
    const row: number[] = [];
    for (let i = 0; i <= NX; i++) row.push(mb.vertex(xf.pt(x0 + (pw * i) / NX, y0 + (ph * j) / NY, z + 0.0012), n, MAT.paper, colAt(i / NX, j / NY), 1));
    ids.push(row);
  }
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      mb.tri(ids[j]![i]!, ids[j]![i + 1]!, ids[j + 1]![i + 1]!);
      mb.tri(ids[j]![i]!, ids[j + 1]![i + 1]!, ids[j + 1]![i]!);
    }
  }
}

// ───────────────────────────── ковёр ─────────────────────────────

/** Шерстяной ковёр с узором: тёмно-красное поле, медальон, кайма в три полосы, бахрома по коротким краям. */
function woolRug(xf: Xf, seed: number): void {
  const r = rng(seed);
  const W = 2.0;
  const D = 1.4;
  const T = 0.008;
  const field: Vec3 = r() < 0.6 ? [0.62, 0.14, 0.12] : [0.18, 0.22, 0.42];
  const border: Vec3 = [0.18, 0.12, 0.1];
  const ivory: Vec3 = [1.05, 0.95, 0.78];
  const colAt = (u: number, v: number): Vec3 => {
    const e = Math.min(u, 1 - u, v * (D / W), (1 - v) * (D / W));
    if (e < 0.025) return border;
    if (e < 0.04) return ivory;
    if (e < 0.075) return Math.sin((u + v) * 90) > 0.2 ? field : border;
    if (e < 0.085) return ivory;
    const dx = (u - 0.5) * W;
    const dz = (v - 0.5) * D;
    const rho = Math.abs(dx) / 0.5 + Math.abs(dz) / 0.32;
    if (rho < 0.25) return ivory;
    if (rho < 1) return Math.cos(rho * 12) > 0.4 ? border : shade(field, 1.15);
    return shade(field, 0.92 + 0.12 * Math.sin(u * 40) * Math.sin(v * 28));
  };
  const mb = xf.mb;
  const NX = 30;
  const NZ = 20;
  const n = xf.dir(0, 1, 0);
  const ids: number[][] = [];
  for (let j = 0; j <= NZ; j++) {
    const row: number[] = [];
    for (let i = 0; i <= NX; i++) row.push(mb.vertex(xf.pt(-W / 2 + (W * i) / NX, T, -D / 2 + (D * j) / NZ), n, MAT.carpet, colAt(i / NX, j / NZ), 1));
    ids.push(row);
  }
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      mb.tri(ids[j]![i]!, ids[j + 1]![i + 1]!, ids[j]![i + 1]!);
      mb.tri(ids[j]![i]!, ids[j + 1]![i]!, ids[j + 1]![i + 1]!);
    }
  }
  // Кромка толщиной в ворс.
  xf.box([-W / 2, 0, -D / 2], [W / 2, T - 0.0005, D / 2], MAT.carpet, { tint: border, skip: ['ny', 'py'] });
  // Бахрома по коротким сторонам: кисточки — плоские полоски на полу.
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 34; k++) {
      const z = -D / 2 + 0.02 + (k / 33) * (D - 0.04);
      const len = 0.05 + 0.02 * r();
      const x0 = sx * (W / 2);
      const x1 = x0 + sx * len;
      xf.mb.quadFacing(xf.pt(x0, 0.003, z - 0.004), xf.pt(x1, 0.002, z - 0.003), xf.pt(x1, 0.002, z + 0.003), xf.pt(x0, 0.003, z + 0.004), xf.dir(0, 1, 0), MAT.canvas, ivory);
    }
  }
}

export const REAL_PROPS: Record<string, PropSpec> = {
  table_cafe: { w: 0.7, d: 0.72, h: 0.74, mount: 'floor', ru: 'столик: пластик под дерево на трубчатых ножках', build: cafeTable },
  armchair_visitor: { w: 0.72, d: 0.74, h: 0.86, mount: 'floor', ru: 'кресло для посетителей: обивка, деревянные подлокотники', build: visitorArmchair },
  floor_lamp: { w: 0.48, d: 0.6, h: 1.64, mount: 'floor', ru: 'торшер: латунная стойка, тканевый абажур', build: floorLamp },
  cactus_column: { w: 0.24, d: 0.24, h: 0.56, mount: 'free', ru: 'кактус-колонна с отростком в глиняном горшке', build: cactusColumn },
  cactus_round: { w: 0.14, d: 0.14, h: 0.21, mount: 'free', ru: 'круглый кактус в горшочке', build: cactusRound },
  print_large: { w: 0.7, d: 0.025, h: 0.84, mount: 'wall', y: 1.4, ru: 'репродукция пейзажа в раме с паспарту, большая', build: (xf, seed) => framedPrint(xf, seed, 0.7, 0.84) },
  print_medium: { w: 0.48, d: 0.025, h: 0.62, mount: 'wall', y: 1.4, ru: 'репродукция пейзажа в раме с паспарту', build: (xf, seed) => framedPrint(xf, seed, 0.48, 0.62) },
  rug_wool: { w: 2.15, d: 1.4, h: 0.01, mount: 'free', ru: 'шерстяной ковёр с медальоном и бахромой', build: woolRug },
};

/** Пары «вещь из набора KayKit → реалистичная замена»: на уровнях стоит замена; опросник (tools/mebel) показывает обе. */
export const KAYKIT_SWAPS: readonly { from: string; to: string }[] = [
  { from: 'kk_chair_a', to: 'chair_bent' },
  { from: 'kk_table_small', to: 'table_cafe' },
  { from: 'kk_armchair', to: 'armchair_visitor' },
  { from: 'kk_lamp_standing', to: 'floor_lamp' },
  { from: 'kk_cactus', to: 'cactus_column' },
  { from: 'kk_cactus_small', to: 'cactus_round' },
  { from: 'kk_picture_large', to: 'print_large' },
  { from: 'kk_picture_medium', to: 'print_medium' },
  { from: 'kk_rug_rect', to: 'rug_wool' },
];
