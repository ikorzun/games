/**
 * Зелёный луг: «обои по умолчанию». День, синее небо, пологий холм вокруг; жутко тем, что слишком
 * чисто, тихо и горизонт близко. Посреди травы — вещи из дома: дверная коробка без двери, стул
 * спиной к игроку, фонарь, кровать, почтовые ящики.
 *
 * Направление: у игрока yaw 0 смотрит в −z, дверной проём — в 12 м впереди точки появления.
 */
import type { Vec3 } from '../core/types';
import { ColliderSet } from './colliders';
import { MeshBuilder } from './kit';
import { MAT } from './materials';
import { Xf } from './props';
import { beam, sheet } from './props_more';
import type { PocketBuilder, PocketSpace } from './pockets';

const R_WALK = 27;
const HALF = 48;
const CELLS = 48;

/** Детерминированный разброс. */
function lcg(seed: number): () => number {
  let s = Math.imul(seed ^ 0x2545f491, 0x9e3779b1) >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** Высота земли: ровно в круге ходьбы, дальше плавно вверх до +6 м. */
function groundY(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const s = smooth((r - 26) / 30);
  const bump = 0.7 * Math.sin(x * 0.13 + 1) * Math.sin(z * 0.11 + 2) + 0.4 * Math.sin((x + z) * 0.21);
  return 6 * s + bump * s;
}

export const buildMeadow: PocketBuilder = (seed, origin): PocketSpace => {
  const [ox, oy, oz] = origin;
  const rnd = lcg(seed);
  const mb = new MeshBuilder();
  const cs = new ColliderSet();
  const at = (x: number, y: number, z: number): Vec3 => [ox + x, oy + y, oz + z];

  // Земля: сетка 48×48, оттенок — зелёный с пятнами.
  const step = (2 * HALF) / CELLS;
  const hs: number[][] = [];
  for (let i = 0; i <= CELLS; i++) {
    const row: number[] = [];
    for (let j = 0; j <= CELLS; j++) row.push(groundY(-HALF + i * step, -HALF + j * step));
    hs.push(row);
  }
  for (let i = 0; i < CELLS; i++) {
    for (let j = 0; j < CELLS; j++) {
      const x0 = -HALF + i * step;
      const z0 = -HALF + j * step;
      const cx = x0 + step / 2;
      const cz = z0 + step / 2;
      const n = Math.sin(cx * 0.31) * Math.sin(cz * 0.27) + 0.6 * Math.sin(cx * 0.11 + cz * 0.17) + 0.3 * Math.sin(cx * 0.9 + cz * 0.7);
      const k = 0.9 + 0.17 * n;
      const tint: Vec3 = [0.85 * k, 1.5 * k, 0.5 * k];
      // Обход против часовой сверху: (x0,z0+step) → (x0+step,z0+step) → (x0+step,z0) → (x0,z0).
      mb.quadFacing(at(x0, hs[i]![j + 1]!, z0 + step), at(x0 + step, hs[i + 1]![j + 1]!, z0 + step), at(x0 + step, hs[i + 1]![j]!, z0), at(x0, hs[i]![j]!, z0), [0, 1, 0], MAT.canvas, tint, 1);
    }
  }
  cs.addBox(ox - R_WALK, oy - 0.5, oz - R_WALK, ox + R_WALK, oy, oz + R_WALK);

  // Небо: купол из свечения, градиент от бледного у горизонта к синему в зените.
  const RS = 45;
  const LAT = [-18, -4, 6, 16, 28, 42, 58, 74, 90];
  const LON = 24;
  const skyAt = (lat: number): Vec3 => {
    const t = smooth(Math.max(0, lat) / 80);
    // Цвет свечения задаётся напрямую: (яркость × цвет) / 0.0066.
    return [41.6 + (4.8 - 41.6) * t, 70.8 + (30.9 - 70.8) * t, 124.7 + (121.2 - 124.7) * t];
  };
  const dome = (lat: number, lon: number): Vec3 => {
    const a = (lat * Math.PI) / 180;
    const b = (lon / LON) * Math.PI * 2;
    return at(Math.cos(a) * Math.sin(b) * RS, Math.sin(a) * RS, -Math.cos(a) * Math.cos(b) * RS);
  };
  const inward = (p: Vec3): Vec3 => [ox - p[0], oy - p[1], oz - p[2]];
  for (let a = 0; a < LAT.length - 1; a++) {
    for (let l = 0; l < LON; l++) {
      const p0 = dome(LAT[a]!, l);
      const p1 = dome(LAT[a]!, l + 1);
      const p2 = dome(LAT[a + 1]!, l + 1);
      const p3 = dome(LAT[a + 1]!, l);
      const c: Vec3 = [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2, (p0[2] + p2[2]) / 2];
      const sa = skyAt(LAT[a]!);
      const sb = skyAt(LAT[a + 1]!);
      mb.quadFacing(p0, p1, p2, p3, inward(c), MAT.glow, [(sa[0] + sb[0]) / 2, (sa[1] + sb[1]) / 2, (sa[2] + sb[2]) / 2]);
    }
  }
  // Облака: плоские белые лепёшки из нескольких листов.
  const clouds: Array<[number, number, number, number]> = [
    [-14, 30, -26, 9],
    [16, 34, -20, 7],
    [24, 27, 10, 8],
    [-22, 32, 12, 7],
    [2, 38, 6, 6],
  ];
  const white: Vec3 = [128.2, 135.2, 136.1];
  for (const [cx, cy, cz, w] of clouds) {
    for (let k = 0; k < 3; k++) {
      const dx = (k - 1) * w * 0.55;
      const dz = (k === 1 ? 0.4 : -0.3) * w * 0.4;
      const hw = w * (k === 1 ? 0.7 : 0.45);
      const hd = hw * 0.5;
      const y = cy + k * 0.2;
      mb.quadFacing(at(cx + dx - hw, y, cz + dz - hd), at(cx + dx + hw, y, cz + dz - hd), at(cx + dx + hw, y, cz + dz + hd), at(cx + dx - hw, y, cz + dz + hd), [0, -1, 0], MAT.glow, white);
    }
  }

  // Трава и цветы у центра: два скрещённых листа на пучок.
  const tuft = (x: number, z: number, h: number, w: number, tint: Vec3): void => {
    const rot = rnd() * Math.PI;
    for (let k = 0; k < 2; k++) {
      const a = rot + (k * Math.PI) / 2;
      const dx = Math.cos(a) * w;
      const dz = Math.sin(a) * w;
      const lean = (rnd() - 0.5) * 0.12;
      const top: Vec3 = [x + lean + dx * 0.25, h, z + lean * 0.5 + dz * 0.25];
      const topB: Vec3 = [x + lean - dx * 0.25, h, z + lean * 0.5 - dz * 0.25];
      const a0 = at(x - dx, 0, z - dz);
      const a1 = at(x + dx, 0, z + dz);
      const a2 = at(top[0], top[1], top[2]);
      const a3 = at(topB[0], topB[1], topB[2]);
      const nx = -Math.sin(a);
      const nz = Math.cos(a);
      mb.quadFacing(a0, a1, a2, a3, [nx, 0, nz], MAT.canvas, tint, [0.45, 0.45, 1, 1]);
      mb.quadFacing(a0, a1, a2, a3, [-nx, 0, -nz], MAT.canvas, tint, [0.45, 0.45, 1, 1]);
    }
  };
  const keep = (x: number, z: number): boolean => Math.hypot(x, z) > 0.9;
  for (let i = 0; i < 280; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 1 + Math.sqrt(rnd()) * 17;
    const x = Math.sin(a) * r;
    const z = -Math.cos(a) * r;
    if (!keep(x, z)) continue;
    const k = 0.8 + rnd() * 0.5;
    tuft(x, z, 0.28 + rnd() * 0.3, 0.13 + rnd() * 0.06, [0.8 * k, 1.8 * k, 0.45 * k]);
  }
  for (let i = 0; i < 24; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 2 + Math.sqrt(rnd()) * 14;
    const x = Math.sin(a) * r;
    const z = -Math.cos(a) * r;
    if (!keep(x, z)) continue;
    const h = 0.25 + rnd() * 0.12;
    // Стебель — тонкая коробка; цветок — белая точка с жёлтой серединой.
    mb.box(at(x - 0.006, 0, z - 0.006), at(x + 0.006, h, z + 0.006), MAT.canvas, { tint: [0.4, 1.1, 0.35], skip: ['ny', 'py'] });
    mb.box(at(x - 0.04, h, z - 0.04), at(x + 0.04, h + 0.012, z + 0.04), MAT.plaster, { tint: [1.5, 1.5, 1.5], skip: ['ny'] });
    mb.box(at(x - 0.014, h + 0.012, z - 0.014), at(x + 0.014, h + 0.026, z + 0.014), MAT.paintOchre, { tint: [1.6, 1.4, 0.5], skip: ['ny'] });
  }

  // Дверная коробка без двери: в 12 м впереди; створка лежит рядом в траве.
  const white2: Vec3 = [1.25, 1.25, 1.22];
  const door = new Xf(mb, cs, ox, oy, oz - 12);
  door.solid([-0.6, 0, -0.07], [-0.46, 2.1, 0.07], MAT.plaster, { tint: white2, bevel: 0.01 });
  door.solid([0.46, 0, -0.07], [0.6, 2.1, 0.07], MAT.plaster, { tint: white2, bevel: 0.01 });
  door.box([-0.6, 2.0, -0.07], [0.6, 2.12, 0.07], MAT.plaster, { tint: white2, bevel: 0.01 });
  door.box([-0.46, 0, -0.025], [0.46, 0.015, 0.025], MAT.plaster, { tint: [0.9, 0.9, 0.88] });
  const leaf = new Xf(mb, null, ox + 2.3, oy, oz - 10.6, 1);
  leaf.box([-0.45, 0.02, -1.0], [0.45, 0.06, 1.0], MAT.wood, { tint: [1.5, 1.2, 0.9], bevel: 0.01 });
  leaf.box([0.2, 0.06, -0.55], [0.35, 0.09, -0.4], MAT.brass, { bevel: 0.01 }); // ручка

  // Стул спиной к игроку: сиденье смотрит в −z.
  const chair = new Xf(mb, cs, ox + 3, oy, oz - 5, 2);
  const cw: Vec3 = [1.3, 1.1, 0.8];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) chair.box([sx * 0.19 - 0.025, 0, sz * 0.19 - 0.025], [sx * 0.19 + 0.025, 0.45, sz * 0.19 + 0.025], MAT.wood, { tint: cw });
  }
  chair.box([-0.22, 0.45, -0.22], [0.22, 0.49, 0.22], MAT.wood, { tint: cw, bevel: 0.008 });
  chair.box([-0.2, 0.49, -0.225], [-0.17, 0.95, -0.195], MAT.wood, { tint: cw });
  chair.box([0.17, 0.49, -0.225], [0.2, 0.95, -0.195], MAT.wood, { tint: cw });
  for (const y of [0.62, 0.78, 0.92]) chair.box([-0.2, y, -0.22], [0.2, y + 0.06, -0.2], MAT.wood, { tint: cw });
  chair.collider([-0.24, 0, -0.24], [0.24, 0.95, 0.24]);

  // Уличный фонарь.
  const lamp = new Xf(mb, cs, ox - 7, oy, oz - 9);
  lamp.cyl([0, 0, 0], 'y', 0.35, 0.16, MAT.castIron, { segments: 8, radiusEnd: 0.1 });
  lamp.cyl([0, 0.3, 0], 'y', 4.0, 0.055, MAT.castIron, { segments: 8, caps: false });
  lamp.box([-0.02, 4.2, -0.02], [0.9, 4.28, 0.02], MAT.castIron);
  beam(lamp, [0, 3.5, 0], [0.6, 4.2, 0], 0.03, 0.03, MAT.castIron);
  lamp.box([0.7, 4.0, -0.14], [1.0, 4.04, 0.14], MAT.castIron);
  lamp.box([0.72, 4.04, -0.12], [0.98, 4.2, 0.12], MAT.glow, { tint: [138.5, 141.6, 49.9] });
  lamp.box([0.68, 4.2, -0.16], [1.02, 4.25, 0.16], MAT.castIron, { bevel: 0.01 });
  lamp.collider([-0.1, 0, -0.1], [0.1, 4.2, 0.1]);

  // Кровать с белым бельём, стоит на траве сбоку.
  const bed = new Xf(mb, cs, ox - 10, oy, oz + 4, 1);
  const bw: Vec3 = [1.2, 0.95, 0.7];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) bed.box([sx * 0.47 - 0.04, 0, sz * 0.97 - 0.04], [sx * 0.47 + 0.04, 0.3, sz * 0.97 + 0.04], MAT.wood, { tint: bw });
  }
  bed.box([-0.5, 0.26, -1.0], [0.5, 0.36, 1.0], MAT.wood, { tint: bw });
  bed.box([-0.5, 0.3, -1.04], [0.5, 1.0, -0.98], MAT.wood, { tint: bw, bevel: 0.01 });
  bed.box([-0.5, 0.3, 0.98], [0.5, 0.6, 1.04], MAT.wood, { tint: bw, bevel: 0.01 });
  const linen: Vec3 = [1.45, 1.45, 1.4];
  bed.box([-0.46, 0.36, -0.96], [0.46, 0.5, 0.94], MAT.canvas, { tint: [1.9, 1.9, 1.8], bevel: 0.03 });
  bed.box([-0.4, 0.5, -0.9], [0.4, 0.62, -0.5], MAT.plaster, { tint: linen, bevel: 0.05 });
  bed.box([-0.48, 0.5, -0.4], [0.48, 0.58, 0.96], MAT.plaster, { tint: linen, bevel: 0.03 });
  // Край одеяла свисает с одной стороны.
  sheet(bed, [0.48, 0.58, -0.3], [0.48, 0.58, 0.9], [0.51, 0.22, 0.9], [0.51, 0.22, -0.3], [1, 0, 0], MAT.plaster, linen);
  bed.collider([-0.52, 0, -1.05], [0.52, 1.0, 1.05]);

  // Ряд почтовых ящиков.
  for (let k = 0; k < 4; k++) {
    const mbx = new Xf(mb, cs, ox + 8 + k * 1.1, oy, oz - 9, 3);
    mbx.box([-0.04, 0, -0.04], [0.04, 1.05, 0.04], MAT.wood, { tint: [1.1, 0.9, 0.7] });
    mbx.box([-0.22, 1.05, -0.12], [0.22, 1.3, 0.12], MAT.metalGrey, { tint: [0.8 + 0.2 * k, 0.9, 1.4 - 0.2 * k], bevel: 0.02 });
    mbx.box([0.22, 1.2, -0.02], [0.25, 1.4, 0.02], MAT.paintRed, { tint: [1.4, 0.9, 0.8] });
    mbx.collider([-0.22, 0, -0.12], [0.22, 1.3, 0.12]);
  }

  const spotsXZ: Array<[number, number]> = [
    [6, 2],
    [-5, 5],
    [0, 8],
    [10, 6],
    [-12, -3],
    [-3, -14],
    [14, -2],
    [-4, 14],
  ];
  return {
    kind: 'meadow',
    meshes: [mb.build()],
    colliders: cs.boxes.map((b) => ({ ...b })),
    spawn: { pos: [ox, oy, oz], yaw: 0 },
    env: { ambient: [0.95, 1.0, 0.7], fog: [0.28, 0.46, 0.8], fogDensity: 0.006, light: 0.1, decay: 0, haze: 0 },
    center: [ox, oy, oz],
    radius: R_WALK,
    anchors: [[ox, oy + 1.2, oz - 12]],
    spots: spotsXZ.map(([x, z]): Vec3 => [ox + x, oy, oz + z]),
  };
};
