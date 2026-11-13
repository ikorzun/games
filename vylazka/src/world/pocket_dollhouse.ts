/**
 * Кукольный домик: игрок ростом с куклу внутри игрушечного дома. Три комнаты в ряд, передней стены
 * нет (разрез), всё из гладкого цветного пластика — чуть великовато и слишком правильное. Снаружи,
 * за открытой стороной, — огромная тёмная комната: доски пола, великанские ножки стула и кровати,
 * одна тёплая лампа. Домик стоит на полу в чьей-то комнате.
 *
 * Направление: открытая сторона — в −z (куда смотрит игрок при yaw 0), задняя стена — в +z.
 */
import type { Vec3 } from '../core/types';
import { ColliderSet } from './colliders';
import { MeshBuilder } from './kit';
import { MAT } from './materials';
import { Xf } from './props';
import type { PocketBuilder, PocketSpace } from './pockets';

const T = 0.12; // толщина стен
const W = 3.2; // ширина и глубина комнаты
const H = 2.6; // потолок
const PITCH = W + T;
const ZB = -W / 2; // край пола у открытой стороны
const ZF = W / 2; // внутренняя грань задней стены
const XE = (3 * W + 2 * T) / 2 + T; // внешняя грань боковых стен
const DOOR_Z0 = -0.2; // проём между комнатами по z
const DOOR_Z1 = 0.8;
const DOOR_H = 2.1;

const PINK: Vec3 = [1.45, 0.82, 0.95];
const MINT: Vec3 = [0.8, 1.4, 1.05];
const YELLOW: Vec3 = [1.5, 1.35, 0.7];
const ROOMS: Vec3[] = [PINK, MINT, YELLOW];
const RX = [-PITCH, 0, PITCH];

/** Детерминированный разброс. */
function lcg(seed: number): () => number {
  let s = Math.imul(seed ^ 0x7f4a7c15, 0x9e3779b1) >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const mul = (t: Vec3, k: number): Vec3 => [t[0] * k, t[1] * k, t[2] * k];

/** Кукла: голова, тело, руки, ноги, лица нет. Сидит (seated) или лежит лицом вниз вдоль z. */
function doll(xf: Xf, seated: boolean, dress: Vec3): void {
  const skin: Vec3 = [1.5, 1.15, 0.95];
  const o = { bevel: 0.02 };
  if (seated) {
    // Сидит на сиденье высотой 0.5, лицом в +z.
    xf.box([-0.17, 0.5, -0.1], [0.17, 1.0, 0.1], MAT.enamel, { tint: dress, ...o }); // тело
    xf.box([-0.12, 1.0, -0.02], [0.12, 1.05, 0.02], MAT.enamel, { tint: skin }); // шея
    xf.box([-0.14, 1.05, -0.13], [0.14, 1.33, 0.13], MAT.enamel, { tint: skin, bevel: 0.05 }); // голова
    xf.box([-0.25, 0.62, -0.06], [-0.17, 0.98, 0.06], MAT.enamel, { tint: skin, ...o }); // руки
    xf.box([0.17, 0.62, -0.06], [0.25, 0.98, 0.06], MAT.enamel, { tint: skin, ...o });
    for (const sx of [-1, 1]) {
      xf.box([sx * 0.09 - 0.07, 0.5, 0.0], [sx * 0.09 + 0.07, 0.62, 0.5], MAT.enamel, { tint: dress, ...o }); // бёдра
      xf.box([sx * 0.09 - 0.065, 0.0, 0.43], [sx * 0.09 + 0.065, 0.5, 0.55], MAT.enamel, { tint: skin, ...o }); // голени
    }
  } else {
    // Лежит лицом вниз, головой в −z; начало — на полу.
    xf.box([-0.17, 0.0, -0.1], [0.17, 0.2, 0.5], MAT.enamel, { tint: dress, ...o });
    xf.box([-0.14, 0.0, -0.4], [0.14, 0.28, -0.12], MAT.enamel, { tint: skin, bevel: 0.05 });
    xf.box([-0.3, 0.0, -0.05], [-0.18, 0.1, 0.4], MAT.enamel, { tint: skin, ...o });
    xf.box([0.18, 0.0, -0.05], [0.3, 0.1, 0.4], MAT.enamel, { tint: skin, ...o });
    for (const sx of [-1, 1]) xf.box([sx * 0.09 - 0.07, 0.0, 0.5], [sx * 0.09 + 0.07, 0.14, 1.05], MAT.enamel, { tint: skin, ...o });
  }
}

/** Стул: сиденье на высоте 0.5, спинка сзади (z = −0.22), лицом в +z. */
function chair(xf: Xf, tint: Vec3): void {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) xf.box([sx * 0.2 - 0.04, 0, sz * 0.2 - 0.04], [sx * 0.2 + 0.04, 0.5, sz * 0.2 + 0.04], MAT.enamel, { tint, bevel: 0.01 });
  }
  xf.box([-0.25, 0.46, -0.25], [0.25, 0.52, 0.25], MAT.enamel, { tint, bevel: 0.02 });
  xf.box([-0.25, 0.52, -0.26], [0.25, 1.1, -0.2], MAT.enamel, { tint, bevel: 0.02 });
  xf.collider([-0.26, 0, -0.27], [0.26, 0.52, 0.26]);
}

export const buildDollhouse: PocketBuilder = (seed, origin): PocketSpace => {
  const [ox, oy, oz] = origin;
  const rnd = lcg(seed);
  const mb = new MeshBuilder();
  const cs = new ColliderSet();
  const house = new Xf(mb, cs, ox, oy, oz);
  const at = (x: number, y: number, z: number): Vec3 => [ox + x, oy + y, oz + z];
  const cream: Vec3 = [1.5, 1.45, 1.3];
  const base = 0.3; // подставка дома

  // Подставка и пол: низ дома на полу большой комнаты (y = −base).
  house.solid([-XE, -base, ZB - T], [XE, 0, ZF + T], MAT.enamel, { tint: cream, bevel: 0.02 });
  for (let r = 0; r < 3; r++) {
    const cx = RX[r]!;
    if (r === 1) {
      // Шахматная плитка 8×8.
      const n = 8;
      const c = W / n;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const x = cx - W / 2 + i * c;
          const z = ZB + j * c;
          const dark = (i + j) % 2 === 0;
          mb.quad(at(x, 0.003, z + c), at(x + c, 0.003, z + c), at(x + c, 0.003, z), at(x, 0.003, z), MAT.tileFloor, dark ? [0.45, 0.6, 0.55] : [1.6, 1.7, 1.55]);
        }
      }
    } else {
      // Светлые дощечки пола, раскладка вдоль z.
      const n = 8;
      const c = W / n;
      for (let i = 0; i < n; i++) {
        const k = 1.25 + rnd() * 0.3;
        mb.quad(at(cx - W / 2 + i * c + 0.012, 0.003, ZF), at(cx - W / 2 + (i + 1) * c - 0.012, 0.003, ZF), at(cx - W / 2 + (i + 1) * c - 0.012, 0.003, ZB), at(cx - W / 2 + i * c + 0.012, 0.003, ZB), MAT.floor, [1.35 * k, 1.15 * k, 0.8 * k]);
      }
    }
  }

  // Стены: задняя — по комнатам, боковые и перегородки с проёмами.
  for (let r = 0; r < 3; r++) {
    const cx = RX[r]!;
    house.solid([cx - W / 2, 0, ZF], [cx + W / 2, H, ZF + T], MAT.enamel, { tint: ROOMS[r]! });
    // Литьевые швы: тонкие рёбра по стене.
    house.box([cx - 0.01, 0.0, ZF - 0.012], [cx + 0.01, H, ZF], MAT.enamel, { tint: mul(ROOMS[r]!, 0.8) });
    house.box([cx - W / 2, 1.1, ZF - 0.012], [cx + W / 2, 1.12, ZF], MAT.enamel, { tint: mul(ROOMS[r]!, 0.8) });
  }
  // Углы между задними стенами (под перегородками).
  for (const sx of [-1, 1]) {
    house.solid([sx * (PITCH / 2) - T / 2, 0, ZF], [sx * (PITCH / 2) + T / 2, H, ZF + T], MAT.enamel, { tint: cream });
  }
  // Внешние боковые стены.
  for (const sx of [-1, 1]) {
    const x0 = sx > 0 ? XE - T : -XE;
    house.solid([x0, 0, ZB], [x0 + T, H, ZF + T], MAT.enamel, { tint: ROOMS[sx > 0 ? 2 : 0]! });
  }
  // Перегородки: половинки цвета соседних комнат, проём без двери.
  for (const sx of [-1, 1]) {
    const xc = sx * (PITCH / 2);
    const left = ROOMS[sx > 0 ? 1 : 0]!;
    const right = ROOMS[sx > 0 ? 2 : 1]!;
    for (const [z0, z1, y0, y1] of [
      [ZB, DOOR_Z0, 0, H],
      [DOOR_Z1, ZF, 0, H],
      [DOOR_Z0, DOOR_Z1, DOOR_H, H],
    ] as const) {
      house.box([xc - T / 2, y0, z0], [xc, y1, z1], MAT.enamel, { tint: left });
      house.box([xc, y0, z0], [xc + T / 2, y1, z1], MAT.enamel, { tint: right });
      house.collider([xc - T / 2, y0, z0], [xc + T / 2, y1, z1]);
    }
    // Литьевой шов по косяку проёма.
    house.box([xc - T / 2 - 0.012, 0, DOOR_Z0 - 0.02], [xc + T / 2 + 0.012, DOOR_H + 0.02, DOOR_Z0], MAT.enamel, { tint: cream });
    house.box([xc - T / 2 - 0.012, 0, DOOR_Z1], [xc + T / 2 + 0.012, DOOR_H + 0.02, DOOR_Z1 + 0.02], MAT.enamel, { tint: cream });
  }
  // Потолок.
  house.box([-XE, H, ZB - T], [XE, H + T, ZF + T], MAT.enamel, { tint: cream, bevel: 0.02 });
  // Бортик у открытой стороны и невидимая преграда выше роста.
  house.box([-XE, 0, ZB - T], [XE, T, ZB], MAT.enamel, { tint: [1.6, 0.9, 0.95], bevel: 0.03 });
  house.collider([-XE, 0, ZB - T], [XE, 3, ZB]);

  // Левая комната: розовая спальня.
  const bed = house.child(-4.7, 0, 0.7, 0);
  bed.solid([-0.12, 0, -0.35], [1.75, 0.35, 0.85], MAT.enamel, { tint: [1.5, 1.2, 0.5], bevel: 0.03 });
  bed.box([-0.05, 0.35, -0.3], [1.7, 0.55, 0.8], MAT.enamel, { tint: [1.7, 1.7, 1.75], bevel: 0.05 });
  bed.box([0.0, 0.55, -0.22], [0.5, 0.7, 0.72], MAT.enamel, { tint: [1.8, 1.5, 1.6], bevel: 0.06 }); // подушка
  bed.box([-0.2, 0.35, -0.35], [-0.12, 1.1, 0.85], MAT.enamel, { tint: [1.5, 1.2, 0.5], bevel: 0.02 });
  house.solid([-2.85, 0, 1.0], [-2.05, 2.0, 1.55], MAT.enamel, { tint: [1.5, 1.2, 0.5], bevel: 0.03 }); // шкаф
  house.box([-2.46, 0.1, 1.0 - 0.012], [-2.44, 1.9, 1.0], MAT.enamel, { tint: [0.9, 0.7, 0.3] });
  house.box([-2.52, 1.0, 0.99], [-2.48, 1.2, 1.0], MAT.brass);
  house.box([-2.42, 1.0, 0.99], [-2.38, 1.2, 1.0], MAT.brass);
  doll(house.child(-PITCH - 0.3, 0, -0.9, 0), false, [0.5, 0.8, 1.6]);

  // Средняя комната: стол, два стула, плита.
  house.solid([-0.15, 0.7, 0.55], [0.75, 0.78, 1.25], MAT.enamel, { tint: [1.5, 1.15, 0.6], bevel: 0.02 });
  for (const sx of [0, 1]) {
    for (const sz of [0, 1]) house.solid([-0.12 + sx * 0.82, 0, 0.58 + sz * 0.6], [-0.03 + sx * 0.82, 0.7, 0.67 + sz * 0.6], MAT.enamel, { tint: [1.5, 1.15, 0.6] });
  }
  const chA = house.child(-0.72, 0, 0.9, 1);
  chair(chA, [1.5, 0.7, 0.8]);
  doll(chA, true, [1.6, 0.6, 0.9]);
  chair(house.child(1.35, 0, 0.9, 3), [1.5, 0.7, 0.8]);
  house.solid([-1.58, 0, 0.95], [-1.02, 0.85, 1.55], MAT.enamel, { tint: [1.7, 1.7, 1.7], bevel: 0.03 });
  for (const [sx, sz] of [
    [-1.42, 1.15],
    [-1.2, 1.15],
    [-1.42, 1.38],
    [-1.2, 1.38],
  ] as const) {
    house.cyl([sx, 0.85, sz], 'y', 0.015, 0.1, MAT.castIron, { segments: 8 });
  }
  house.box([-1.5, 0.3, 0.93], [-1.1, 0.7, 0.95], MAT.glass, { tint: [1.5, 1.5, 1.5] });

  // Правая комната: ванная.
  house.solid([PITCH - 0.5, 0, 0.75], [PITCH + 1.5, 0.65, 1.55], MAT.enamel, { tint: [1.8, 1.8, 1.9], bevel: 0.05 });
  house.box([PITCH - 0.4, 0.55, 0.85], [PITCH + 1.4, 0.68, 1.45], MAT.glass, { tint: [0.9, 1.4, 1.7] }); // вода
  house.box([PITCH + 1.35, 0.65, 1.35], [PITCH + 1.45, 1.1, 1.45], MAT.brass); // кран
  house.box([PITCH + 1.3, 1.05, 1.1], [PITCH + 1.4, 1.12, 1.45], MAT.brass);
  house.solid([PITCH - 1.5, 0, 1.15], [PITCH - 1.0, 0.8, 1.55], MAT.enamel, { tint: [1.8, 1.8, 1.9], bevel: 0.04 }); // раковина-тумба

  // Снаружи: огромная тёмная комната. Пол дома — на уровне −base.
  const floorY = -base;
  const dark: Vec3 = [0.3, 0.2, 0.15];
  mb.box(at(-60, floorY - 0.5, -90), at(60, floorY - 0.02, 50), MAT.wood, { tint: [0.1, 0.07, 0.06], skip: ['ny', 'px', 'nx', 'pz', 'nz'] });
  for (let i = 0; i < 40; i++) {
    const x0 = -50 + i * 2.5;
    let z = -85 + rnd() * 6;
    while (z < 45) {
      const len = 6 + rnd() * 6;
      const z1 = Math.min(45, z + len);
      const k = 0.7 + rnd() * 0.6;
      mb.quad(at(x0 + 0.03, floorY, z1), at(x0 + 2.47, floorY, z1), at(x0 + 2.47, floorY, z), at(x0 + 0.03, floorY, z), MAT.wood, [dark[0] * k, dark[1] * k, dark[2] * k]);
      z = z1 + 0.04;
    }
  }
  const leg: Vec3 = [0.5, 0.33, 0.22];
  const giant = (x0: number, z0: number, s: number, h: number, t: Vec3): void => {
    mb.box(at(x0, floorY, z0), at(x0 + s, floorY + h, z0 + s), MAT.wood, { tint: t, skip: ['ny'] });
  };
  // Стул: четыре ножки и сиденье.
  for (const [x, z, h] of [
    [-13, -30, 12],
    [-6, -30, 12],
    [-13, -23, 9],
    [-6, -23, 9],
  ] as const) {
    giant(x, z, 1.2, h, leg);
  }
  mb.box(at(-13.4, floorY + 9, -30.4), at(-4.8, floorY + 10.2, -22.1), MAT.wood, { tint: [0.45, 0.3, 0.2], skip: ['ny'] });
  // Кровать: четыре ножки (две видны целиком) и рама.
  for (const [x, z] of [
    [12, -38],
    [26, -38],
    [12, -26],
    [26, -26],
  ] as const) {
    giant(x, z, 1.5, 8, [0.42, 0.3, 0.24]);
  }
  mb.box(at(11.5, floorY + 8, -38.5), at(28, floorY + 9.5, -24.5), MAT.wood, { tint: [0.4, 0.28, 0.22], skip: ['ny'] });
  // Тёплая лампа: торшер — подставка, стержень, абажур из свечения.
  const lx = 0;
  const lz = -42;
  mb.cylinder(at(lx, floorY, lz), 'y', 0.6, 2.4, MAT.bakelite, { segments: 10, radiusEnd: 1.8 });
  mb.cylinder(at(lx, floorY, lz), 'y', 12, 0.3, MAT.bakelite, { segments: 8, caps: false });
  mb.cylinder(at(lx, floorY + 10, lz), 'y', 6, 3.2, MAT.glow, { segments: 12, radiusEnd: 4.4, caps: false, tint: [180.1, 141.6, 42.8] });

  const spots: Vec3[] = [
    [-PITCH + 0.6, 0, -0.5],
    [-2.4, 0, 0.0],
    [-0.5, 0, -0.9],
    [0.9, 0, -0.4],
    [PITCH - 0.3, 0, -0.6],
    [PITCH + 0.7, 0, 0.1],
  ].map(([x, y, z]): Vec3 => [ox + x!, oy + y!, oz + z!]);
  return {
    kind: 'dollhouse',
    meshes: [mb.build()],
    colliders: cs.boxes.map((b) => ({ ...b })),
    spawn: { pos: [ox, oy, oz], yaw: 0 },
    env: { ambient: [0.34, 0.3, 0.27], fog: [0.03, 0.02, 0.03], fogDensity: 0.02, light: 0.7, decay: 0, haze: 0.004 },
    center: [ox, oy, oz],
    radius: 40,
    anchors: [[ox - 0.72, oy + 1.19, oz + 0.9]],
    spots,
  };
};
