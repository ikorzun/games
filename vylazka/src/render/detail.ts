/**
 * Фактуры поверхностей: стопка тайловых текстур, запечённых на CPU. По слою на род поверхности —
 * бетон в следах опалубки, побелка, масляная краска, ржавчина, дерево, ткань, плитка, кирпич…
 * Материал мира ссылается на слой (world/materials.ts), шейдер берёт из него одну выборку.
 *
 * Каналы: R — высота (рельеф под лучом фонаря), G — пестрота цвета (128 — без изменений),
 * B — гладкость (1 — чистая глянцевая поверхность, 0 — пора, шов, грязь), A — запас.
 */
import { clamp01 } from '../core/math';
import { hash01 } from '../core/rng';
import { at, atCell, cellField, fbmField, sstep } from './noise';

export const DETAIL = {
  concrete: 0,
  plaster: 1,
  paint: 2,
  rust: 3,
  metal: 4,
  wood: 5,
  fabric: 6,
  tile: 7,
  floor: 8,
  plastic: 9,
  paper: 10,
  brick: 11,
  dirt: 12,
  lagging: 13,
  zinc: 14,
  smooth: 15,
  /** Чешуйки краски: R — случайное число чешуйки, G — расстояние до её края, B — второе случайное число. */
  flakes: 16,
} as const;

export const DETAIL_LAYERS = 17;

type Texel = [number, number, number, number];

export interface DetailStack {
  /** RGBA, слой за слоем; строка 0 — нижняя. */
  data: Uint8Array;
  size: number;
  layers: number;
}

export function bakeDetail(size = 256, seed = 11): DetailStack {
  const N = size;
  const lo = fbmField(N, 3, 3, 4, seed);
  const mid = fbmField(N, 12, 12, 4, seed + 1);
  const hi = fbmField(N, 48, 48, 2, seed + 2);
  // Волокна: вдоль U (меняются по v) и вдоль V (меняются по u).
  const grainU = fbmField(N, 2, 64, 2, seed + 3);
  const grainV = fbmField(N, 64, 2, 2, seed + 4);
  const cs = cellField(N, 24, seed + 5);
  const cl = cellField(N, 7, seed + 6);
  const TAU = Math.PI * 2;
  // Трещины: линии уровня плавного шума — длинные, извилистые, не замкнутые в соты.
  const crackA = fbmField(N, 2, 2, 3, seed + 7);
  const crackB = fbmField(N, 3, 3, 2, seed + 8);
  const crackLine = (x: number, y: number, width: number): number => {
    const a = 1 - sstep(0, width, Math.abs(at(crackA, x, y) - 0.5));
    const b = 1 - sstep(0, width * 0.7, Math.abs(at(crackB, x, y) - 0.47));
    // Каждая трещина видна не на всём протяжении.
    return Math.max(a * sstep(0.45, 0.6, at(lo, x, y, 1, 1, 90, 17)), b * sstep(0.55, 0.7, at(lo, x, y, 1, 1, 23, 140)));
  };

  const layers: ((x: number, y: number) => Texel)[] = [];

  // 0. Бетон в следах дощатой опалубки: полосы досок, швы между ними, поры и раковины.
  layers[DETAIL.concrete] = (x, y) => {
    const boards = 8;
    const fv = (y / N) * boards;
    const band = Math.floor(fv);
    const t = fv - band;
    const rnd = hash01(band, 3, seed);
    const seam = 1 - sstep(0.0, 0.07, Math.min(t, 1 - t));
    const grain = at(grainU, x, y);
    const pore = sstep(0.7, 0.78, at(hi, x, y)) * sstep(0.35, 0.6, at(mid, x, y, 1, 1, 37, 91));
    const cavity = crackLine(x, y, 0.012);
    // Отверстия от стяжек опалубки: ряд круглых гнёзд через две доски.
    const tu = (x / N) * 4;
    const tie = band % 2 === 0 ? sstep(0.05, 0.03, Math.hypot((tu - Math.floor(tu) - 0.5) / 4, (t - 0.5) / boards)) : 0;
    const h = 0.55 + (rnd - 0.5) * 0.22 + (grain - 0.5) * 0.16 + (at(mid, x, y) - 0.5) * 0.12 - seam * 0.35 - pore * 0.4 - cavity * 0.5 - tie * 0.6;
    const a = 0.5 + (rnd - 0.5) * 0.1 + (at(lo, x, y) - 0.5) * 0.22 + (at(mid, x, y) - 0.5) * 0.16 - seam * 0.14 - pore * 0.22 - cavity * 0.3 - tie * 0.3;
    return [h, a, 0.22 - pore * 0.2, seam];
  };

  // 1. Побелка по штукатурке: мазки кисти, местами слой отстал и осыпался.
  layers[DETAIL.plaster] = (x, y) => {
    const stroke = at(grainU, x, y) * 0.6 + at(grainV, x, y, 1, 1, 40, 0) * 0.4;
    const m = at(lo, x, y, 2, 2, 71, 13) * 0.65 + at(mid, x, y) * 0.35;
    const flake = sstep(0.585, 0.6, m);
    const rim = sstep(0.55, 0.585, m) * (1 - flake);
    const h = 0.62 + (stroke - 0.5) * 0.14 + (at(hi, x, y) - 0.5) * 0.08 + rim * 0.1 - flake * 0.42;
    const a = 0.52 + (at(lo, x, y) - 0.5) * 0.14 + (stroke - 0.5) * 0.06 - flake * 0.16 - rim * 0.05;
    return [h, a, 0.1, flake];
  };

  // 2. Масляная краска: «апельсиновая корка», редкие пузыри, потёртости.
  layers[DETAIL.paint] = (x, y) => {
    const peel = at(hi, x, y);
    const blister = sstep(0.16, 0.05, atCell(cs.near, N, x, y)) * sstep(0.84, 0.9, atCell(cs.id, N, x, y));
    const scuff = sstep(0.62, 0.72, at(mid, x, y, 1, 1, 19, 77)) * sstep(0.5, 0.7, at(lo, x, y, 2, 2));
    const run = at(grainV, x, y);
    const h = 0.5 + (peel - 0.5) * 0.1 + blister * 0.45 + (run - 0.5) * 0.06 - scuff * 0.08;
    const a = 0.5 + (at(lo, x, y) - 0.5) * 0.14 + (run - 0.5) * 0.06 - scuff * 0.1;
    return [h, a, 0.9 - scuff * 0.55 - blister * 0.2, blister];
  };

  // 3. Ржавчина: язвы и чешуя.
  layers[DETAIL.rust] = (x, y) => {
    const scale = sstep(0.0, 0.12, atCell(cs.edge, N, x, y));
    const id = atCell(cs.id, N, x, y);
    const h = 0.25 + at(mid, x, y) * 0.3 + at(hi, x, y) * 0.2 + scale * (0.1 + id * 0.25);
    const a = 0.5 + (at(lo, x, y) - 0.5) * 0.5 + (at(hi, x, y) - 0.5) * 0.25 + (id - 0.5) * 0.2 - (1 - scale) * 0.2;
    return [h, a, 0.08, 1 - scale];
  };

  // 4. Крашеный или голый металл: царапины вдоль и поперёк, пологие вмятины.
  layers[DETAIL.metal] = (x, y) => {
    const s1 = sstep(0.8, 0.84, at(grainU, x, y, 1, 2, 5, 9));
    const s2 = sstep(0.83, 0.86, at(grainV, x, y, 2, 1, 31, 3));
    const sc = Math.max(s1, s2);
    const dent = at(lo, x, y, 2, 2, 3, 40);
    const h = 0.5 + (dent - 0.5) * 0.25 + (at(hi, x, y) - 0.5) * 0.05 - sc * 0.3;
    const a = 0.5 + (at(mid, x, y) - 0.5) * 0.1 - sc * 0.08;
    return [h, a, 0.85 - sc * 0.6 - sstep(0.6, 0.8, at(mid, x, y, 1, 1, 60, 60)) * 0.25, sc];
  };

  // 5. Дерево: волокна вдоль U, доски со щелями, редкие сучки.
  layers[DETAIL.wood] = (x, y) => {
    const planks = 8;
    const fv = (y / N) * planks;
    const band = Math.floor(fv);
    const t = fv - band;
    const rnd = hash01(band, 9, seed);
    const gap = 1 - sstep(0.0, 0.05, Math.min(t, 1 - t));
    const gr = at(grainU, x, y, 1, 1, Math.floor(rnd * 97), band * 31);
    const knot = sstep(0.14, 0.04, atCell(cl.near, N, x, y)) * sstep(0.7, 0.8, atCell(cl.id, N, x, y));
    const h = 0.5 + (gr - 0.5) * 0.4 - gap * 0.5 - knot * 0.2;
    const a = 0.5 + (gr - 0.5) * 0.34 + (rnd - 0.5) * 0.16 - gap * 0.3 - knot * 0.3 + (at(lo, x, y) - 0.5) * 0.1;
    return [h, a, 0.3 - gap * 0.2, gap];
  };

  // 6. Ткань: переплетение нитей и ворс.
  layers[DETAIL.fabric] = (x, y) => {
    const u = (x / N) * TAU * 48;
    const v = (y / N) * TAU * 48;
    const weave = Math.sin(u) * Math.sin(v) * 0.5 + 0.5;
    const h = 0.4 + weave * 0.35 + (at(hi, x, y) - 0.5) * 0.15;
    const a = 0.5 + (weave - 0.5) * 0.12 + (at(mid, x, y) - 0.5) * 0.14 + (at(lo, x, y) - 0.5) * 0.12;
    return [h, a, 0.04, weave];
  };

  // 7. Керамическая плитка: 8×8 на тайл, затирка в швах, сколы и трещины на некоторых.
  layers[DETAIL.tile] = (x, y) => {
    const n = 8;
    const fu = (x / N) * n;
    const fv = (y / N) * n;
    const iu = Math.floor(fu);
    const iv = Math.floor(fv);
    const du = Math.min(fu - iu, 1 - (fu - iu));
    const dv = Math.min(fv - iv, 1 - (fv - iv));
    const d = Math.min(du, dv);
    const grout = 1 - sstep(0.03, 0.055, d);
    const rnd = hash01(iu, iv, seed + 7);
    const chipped = rnd > 0.82 ? sstep(0.3, 0.12, Math.hypot(du, dv) + (at(hi, x, y) - 0.5) * 0.1) : 0;
    const crack = rnd < 0.2 ? crackLine(x, y, 0.014) : 0;
    const body = 0.72 + sstep(0.0, 0.2, d) * 0.06 + (rnd - 0.5) * 0.05;
    const h = body * (1 - grout) + 0.3 * grout - chipped * 0.3 - crack * 0.25;
    const a = 0.5 + (rnd - 0.5) * 0.12 - grout * 0.22 - chipped * 0.2 - crack * 0.25 + (at(lo, x, y) - 0.5) * 0.06;
    return [h, a, clamp01(0.97 - grout * 0.85 - chipped * 0.7 - crack * 0.5), grout];
  };

  // 8. Бетонный пол: стяжка с щебнем, трещины, затёртые пятна.
  layers[DETAIL.floor] = (x, y) => {
    const pebble = sstep(0.28, 0.1, atCell(cs.near, N, x, y)) * sstep(0.55, 0.75, atCell(cs.id, N, x, y));
    const crack = crackLine(x, y, 0.014);
    const worn = at(lo, x, y, 2, 2, 9, 9);
    const h = 0.45 + (at(mid, x, y) - 0.5) * 0.3 + pebble * 0.22 + (at(hi, x, y) - 0.5) * 0.1 - crack * 0.5;
    const a = 0.5 + (worn - 0.5) * 0.3 + (at(mid, x, y, 1, 1, 7, 3) - 0.5) * 0.18 + pebble * 0.07 - crack * 0.32;
    return [h, a, clamp01(0.2 + (worn - 0.5) * 0.5 - crack * 0.2), crack];
  };

  // 9. Пластик, резина, кожзам: мелкая шагрень.
  layers[DETAIL.plastic] = (x, y) => {
    const h = 0.5 + (at(hi, x, y) - 0.5) * 0.3;
    const a = 0.5 + (at(mid, x, y) - 0.5) * 0.1;
    return [h, a, 0.7 - sstep(0.6, 0.8, at(mid, x, y, 1, 1, 33, 8)) * 0.3, 0];
  };

  // 10. Бумага и картон: волокна, заломы, рыжие пятна.
  layers[DETAIL.paper] = (x, y) => {
    const crease = sstep(0.02, 0.0, atCell(cl.edge, N, x, y));
    const fox = sstep(0.74, 0.82, at(mid, x, y, 1, 1, 14, 66));
    const h = 0.5 + (at(grainU, x, y) - 0.5) * 0.12 + (at(hi, x, y) - 0.5) * 0.1 - crease * 0.3;
    const a = 0.52 + (at(lo, x, y) - 0.5) * 0.16 - fox * 0.16 - crease * 0.1;
    return [h, a, 0.05, crease];
  };

  // 11. Кирпичная кладка: 4 кирпича × 12 рядов на тайл, перевязка в полкирпича, шов раствора.
  layers[DETAIL.brick] = (x, y) => {
    const rows = 12;
    const cols = 4;
    const fv = (y / N) * rows;
    const row = Math.floor(fv);
    const fu = (x / N) * cols + (row % 2) * 0.5;
    const col = Math.floor(fu);
    const du = Math.min(fu - col, 1 - (fu - col)) / cols;
    const dv = Math.min(fv - row, 1 - (fv - row)) / rows;
    const d = Math.min(du, dv);
    const mortar = 1 - sstep(0.004, 0.009, d);
    const rnd = hash01(col % cols, row, seed + 21);
    const worn = at(hi, x, y);
    const face = 0.62 + (rnd - 0.5) * 0.2 + (worn - 0.5) * 0.16 + (at(mid, x, y) - 0.5) * 0.14;
    const h = face * (1 - mortar) + (0.22 + (worn - 0.5) * 0.1) * mortar;
    const a = (0.5 + (rnd - 0.5) * 0.3 + (at(mid, x, y) - 0.5) * 0.14) * (1 - mortar) + 0.72 * mortar;
    return [h, a, 0.1, mortar];
  };

  // 12. Земля, щебень, обломки.
  layers[DETAIL.dirt] = (x, y) => {
    const stone = sstep(0.4, 0.1, atCell(cs.near, N, x, y));
    const id = atCell(cs.id, N, x, y);
    const h = 0.2 + at(lo, x, y) * 0.25 + at(mid, x, y) * 0.2 + stone * (0.15 + id * 0.3);
    const a = 0.5 + (at(mid, x, y) - 0.5) * 0.3 + (id - 0.5) * 0.3 * stone + (at(hi, x, y) - 0.5) * 0.15;
    return [h, a, 0.05, stone];
  };

  // 13. Обмотка труб: витки ткани с нахлёстом, пропитанные и растрескавшиеся.
  layers[DETAIL.lagging] = (x, y) => {
    const wraps = 6;
    const fu = (x / N) * wraps + (y / N) * 0.5;
    const t = fu - Math.floor(fu);
    const lap = sstep(0.0, 0.08, t);
    const crack = sstep(0.03, 0.0, atCell(cs.edge, N, x, y)) * sstep(0.5, 0.7, at(lo, x, y, 2, 2));
    const h = 0.4 + (1 - t) * 0.25 * lap + (at(hi, x, y) - 0.5) * 0.14 - (1 - lap) * 0.3 - crack * 0.3;
    const a = 0.5 + (at(lo, x, y) - 0.5) * 0.24 + (at(mid, x, y) - 0.5) * 0.12 - (1 - lap) * 0.2 - crack * 0.2;
    return [h, a, 0.08, 1 - lap];
  };

  // 14. Оцинковка: кристаллы цинка — плоские лоскуты разной яркости.
  layers[DETAIL.zinc] = (x, y) => {
    const id = atCell(cs.id, N, x, y);
    const edge = sstep(0.0, 0.04, atCell(cs.edge, N, x, y));
    const h = 0.5 + (id - 0.5) * 0.08 + (at(lo, x, y, 2, 2) - 0.5) * 0.2;
    const a = 0.5 + (id - 0.5) * 0.3 * edge + (at(lo, x, y) - 0.5) * 0.1;
    return [h, a, 0.75 - sstep(0.6, 0.8, at(mid, x, y)) * 0.4, id];
  };

  // 15. Гладкое: эмаль, стекло — едва заметные царапины и пыль.
  layers[DETAIL.smooth] = (x, y) => {
    const sc = sstep(0.86, 0.88, at(grainU, x, y, 1, 1, 77, 5));
    const speck = sstep(0.78, 0.84, at(hi, x, y));
    const h = 0.5 - sc * 0.15 + speck * 0.05;
    const a = 0.5 + (at(lo, x, y) - 0.5) * 0.06 - speck * 0.06;
    return [h, a, 0.97 - sc * 0.5 - speck * 0.35, speck];
  };

  // 16. Чешуйки: лоскуты, на которые трескается краска перед тем как отвалиться.
  const fk = cellField(N, 12, seed + 9);
  layers[DETAIL.flakes] = (x, y) => [atCell(fk.id, N, x, y), atCell(fk.edge, N, x, y) * 1.6, hash01(Math.floor(atCell(fk.id, N, x, y) * 4096), 5, seed), atCell(fk.near, N, x, y)];

  const data = new Uint8Array(N * N * 4 * DETAIL_LAYERS);
  for (let l = 0; l < DETAIL_LAYERS; l++) {
    const fn = layers[l]!;
    const base = l * N * N * 4;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const t = fn(x, y);
        const o = base + (y * N + x) * 4;
        data[o] = Math.round(clamp01(t[0]) * 255);
        data[o + 1] = Math.round(clamp01(t[1]) * 255);
        data[o + 2] = Math.round(clamp01(t[2]) * 255);
        data[o + 3] = Math.round(clamp01(t[3]) * 255);
      }
    }
  }
  return { data, size: N, layers: DETAIL_LAYERS };
}
