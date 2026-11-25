/**
 * Оранжерея (партнёр 19.11, 18:04: «нужна комната полностью с цветами, словно оранжерея или теплица»; квиз: «Теплица внутри
 * места», «Цветы кодом, остальное из библиотеки»). Здесь — то, во что цветы посажены: грядки вдоль стен, стеллаж с горшками,
 * стол с рассадой, кадка с монстерой, подвесной ящик и лампы. Роза в рост человека и пергола — модели полки Sand3D (s3_*), сами
 * цветы и горшки — кодом (world/flowers.ts; горшки — ниже, pot: библиотечных в оранжерее сотня, и они слишком тяжелы). Стебли ложатся в сетку помещения, головки — отдельно (systems/flowers.ts).
 *
 * Что где растёт, решено по месту (основная модель): в убежище — гвоздики, хризантемы и каллы, цветы к праздникам и к
 * похоронам (подземная теплица под натриевыми лампами — оранжевый свет, как в теплицах того времени; розово-лиловые фитолампы
 * — свет нынешний и слишком «психоделичный», куратор, пачка 52, противоречие 337); в офисе — зимний сад: зелень, герань,
 * фиалки на стеллажах, монстера в кадке;
 * в зале ожидания — то, что продают у вокзала: тюльпаны и гвоздики вёдрами. Рамка — как у реквизита (world/props.ts): пол
 * y = 0, у стены спина в z = 0 и лицо в +z; посреди пола — середина в начале координат; под потолком — потолок в y = 0.
 */
import { MAT } from './materials';
import { plant } from './flowers';
import type { FlowerSpecies } from './flowers';
import type { Xf } from './props';
import { rng } from './props_more';
import type { PropSpec } from './props_more';

type Palette = readonly (readonly [FlowerSpecies, number])[];
/** Что растёт в грядке: вид и вес жребия. */
// С 19.11, 21:27 (партнёр: «Больше разных цветов и растений в оранжерею») — и пионы, лилии, маки, ромашки, ирисы, подсолнух.
// В подземной теплице — то, что несут к праздникам и к похоронам; у вокзала — весенние и полевые; в зимнем саду — зелень и одна
// ботаническая ошибка: подсолнух, которому нечего искать под потолочными лампами.
const PALETTES: Record<string, Palette> = {
  mourn: [['carnation', 4], ['chrysanthemum', 3], ['calla', 2], ['lily', 2], ['peony', 2], ['fern', 1]],
  spring: [['tulip', 4], ['carnation', 2], ['daisy', 2], ['poppy', 2], ['iris', 2], ['chrysanthemum', 1]],
  green: [['fern', 2], ['geranium', 3], ['chrysanthemum', 2], ['violet', 2], ['iris', 1], ['sunflower', 1]],
};
function pick(p: Palette, r: number): FlowerSpecies {
  const total = p.reduce((s, [, w]) => s + w, 0);
  let x = r * total;
  for (const [s, w] of p) {
    if (x < w) return s;
    x -= w;
  }
  return p[p.length - 1]![0];
}
/** Сколько растений вида помещается на метр грядки в ряд: пышная зелень — реже. */
const STEP: Partial<Record<FlowerSpecies, number>> = { fern: 0.55, geranium: 0.34, calla: 0.24, chrysanthemum: 0.22, carnation: 0.17, tulip: 0.15, violet: 0.2, peony: 0.27, lily: 0.22, poppy: 0.16, daisy: 0.13, iris: 0.2, sunflower: 0.42 };

const WOOD = [0.62, 0.5, 0.4] as const;
const SOIL = [0.55, 0.45, 0.36] as const;

/**
 * Грядка у стены: ящик из досок W × 0,62 м (длинная — 2,4 м, у угла — короткая, 1,5 м), в нём земля, в земле три ряда цветов из
 * палитры — от стены к проходу. Габарит в реестре глубже ящика (0,75 м; у грядки зелени — 1 м: папоротник в переднем ряду):
 * листья и головки нависают над проходом, преграда — только сам ящик.
 */
function bed(xf: Xf, seed: number, palette: Palette, W = 2.4): void {
  const r = rng(seed);
  const D = 0.62;
  const H = 0.42;
  const t = 0.035;
  const tint: [number, number, number] = [WOOD[0] * (0.9 + r() * 0.2), WOOD[1], WOOD[2]];
  xf.box([-W / 2, 0, 0], [W / 2, H, t], MAT.wood, { tint, bevel: 0.006, aoBottom: 0.6 });
  xf.box([-W / 2, 0, D - t], [W / 2, H, D], MAT.wood, { tint, bevel: 0.006, aoBottom: 0.6 });
  xf.box([-W / 2, 0, t], [-W / 2 + t, H, D - t], MAT.wood, { tint, bevel: 0.006, aoBottom: 0.6 });
  xf.box([W / 2 - t, 0, t], [W / 2, H, D - t], MAT.wood, { tint, bevel: 0.006, aoBottom: 0.6 });
  xf.box([-W / 2 + t, 0.02, t], [W / 2 - t, H - 0.05, D - t], MAT.dirt, { tint: [...SOIL], skip: ['ny'] });
  xf.collider([-W / 2, 0, 0], [W / 2, H, D]);
  // Ряды: у стены — высокие, к проходу — ниже (размер растения меньше).
  const soil = H - 0.05;
  const rows = [0.17, 0.33, 0.49];
  rows.forEach((z, ri) => {
    let x = -W / 2 + 0.12 + r() * 0.06;
    // Сажают куртинами: три-шесть одного вида подряд, потом другой — как на настоящей грядке, а не вперемешку.
    let s = pick(palette, r());
    let left = 3 + Math.floor(r() * 4);
    while (x < W / 2 - 0.1) {
      if (left-- <= 0) {
        s = pick(palette, r());
        left = 2 + Math.floor(r() * 4);
      }
      // Раскидистые — папоротник (до полуметра вокруг) и калла (листья на длинных черешках) — только в переднем ряду и не у
      // торцов: из заднего они проросли бы листьями в стену, у торца — свисали бы за ящик. Вместо них там — гвоздика или герань.
      const wide = s === 'fern' || s === 'calla';
      // Подсолнух в рост человека — только у стены: впереди он закрыл бы всю грядку.
      const sp = wide && (ri < 2 || Math.abs(x) > W / 2 - 0.5) ? (s === 'fern' ? 'geranium' : 'carnation') : s === 'sunflower' && ri > 0 ? 'geranium' : s;
      const step = STEP[sp] ?? 0.2;
      // Крупнее настоящих, как грибы: головка должна читаться с края луча, а грядка — быть зарослью, а не рядком.
      plant(xf, [x, soil, z + (r() - 0.5) * 0.06], sp, Math.floor(r() * 1e9), 1.6 - ri * 0.15 + (r() - 0.5) * 0.14, r() * 6.28);
      x += step * (0.75 + r() * 0.3);
    }
  });
}

/**
 * Клумба посреди пола: холмик земли около 1,4 м поперёк, на нём два-три десятка цветов куртинами. Обходится вокруг: преграда —
 * сам холмик с цветами по пояс.
 */
function patch(xf: Xf, seed: number, palette: Palette): void {
  const r = rng(seed);
  const R = 0.68;
  xf.box([-R, 0, -R], [R, 0.05, R], MAT.dirt, { tint: [...SOIL], bevel: 0.025, aoBottom: 0.7 });
  xf.box([-R * 0.7, 0.05, -R * 0.7], [R * 0.7, 0.1, R * 0.7], MAT.dirt, { tint: [SOIL[0] * 0.92, SOIL[1] * 0.92, SOIL[2] * 0.92], bevel: 0.03 });
  xf.collider([-R, 0, -R], [R, 0.9, R]);
  const n = 20 + Math.floor(r() * 8);
  let s = pick(palette, r());
  let left = 3 + Math.floor(r() * 4);
  for (let k = 0; k < n; k++) {
    if (left-- <= 0) {
      s = pick(palette, r());
      left = 3 + Math.floor(r() * 4);
    }
    // Подсолнечная спираль: ровно, без проплешин и кучек; раскидистые — только в середине.
    const rr = Math.sqrt((k + 0.5) / n) * (R - 0.12);
    const a = k * 2.39996 + r() * 0.3;
    const sp = (s === 'fern' || s === 'calla' || s === 'sunflower') && rr > R * 0.45 ? 'carnation' : s;
    const y = rr < R * 0.7 ? 0.1 : 0.05;
    plant(xf, [Math.cos(a) * rr, y, Math.sin(a) * rr], sp, Math.floor(r() * 1e9), 1.5 - (rr / R) * 0.4 + (r() - 0.5) * 0.14, r() * 6.28);
  }
}

/**
 * Горшок на месте (x, y, z) и растение в нём. Горшок — свой, кодом: усечённый конус с бортиком и землёй, 70 треугольников. Горшки
 * полки Sand3D (терракотовый и глиняный, ~400–470 треугольников) стоят на полке конструктора, но в оранжерее их сотня — это
 * 45 тысяч треугольников на одни горшки, больше, чем весь кусок помещения (основная модель, 19.11).
 */
const POTS = [
  // Терракота: выше и шире, бортик заметный.
  { h: 0.15, r0: 0.066, r1: 0.09, tint: [0.86, 0.46, 0.3] as const },
  // Глина посветлее и пониже, почти без бортика.
  { h: 0.125, r0: 0.062, r1: 0.08, tint: [0.7, 0.52, 0.4] as const },
] as const;
function pot(xf: Xf, x: number, y: number, z: number, kind: number, shade: number): number {
  const p = POTS[kind]!;
  const tint: [number, number, number] = [p.tint[0] * shade, p.tint[1] * shade, p.tint[2] * shade];
  const rim = kind === 0 ? 0.026 : 0.012;
  xf.cyl([x, y, z], 'y', p.h - rim, p.r0, MAT.plaster, { tint, segments: 9, caps: false, radiusEnd: p.r1 - 0.004, ao: 0.75 });
  xf.cyl([x, y + p.h - rim, z], 'y', rim, p.r1 + (kind === 0 ? 0.005 : 0.002), MAT.plaster, { tint, segments: 9, caps: false });
  // Земля чуть ниже края: диск крышкой.
  xf.cyl([x, y + p.h - 0.03, z], 'y', 0.012, p.r1 - 0.004, MAT.dirt, { tint: [SOIL[0] * 0.8, SOIL[1] * 0.8, SOIL[2] * 0.8], segments: 9, caps: true });
  return p.h - 0.018;
}
function potted(xf: Xf, x: number, y: number, z: number, species: FlowerSpecies, seed: number, size = 0.75): void {
  const r = rng(seed);
  const soil = pot(xf, x, y, z, r() < 0.6 ? 0 : 1, 0.9 + r() * 0.2);
  plant(xf, [x, y + soil, z], species, seed ^ 0x51, size, r() * 6.28);
}

/** Стеллаж: железная рама, три полки досок, на полках горшки. */
function rack(xf: Xf, seed: number): void {
  const r = rng(seed);
  const W = 1.5;
  const D = 0.45;
  const H = 1.62;
  const steel: [number, number, number] = [0.55, 0.57, 0.58];
  for (const x of [-W / 2, W / 2 - 0.03]) for (const z of [0.01, D - 0.03]) xf.box([x, 0, z], [x + 0.03, H, z + 0.02], MAT.steel, { tint: steel });
  const shelves = [0.12, 0.66, 1.2];
  for (const y of shelves) xf.box([-W / 2, y - 0.03, 0], [W / 2, y, D], MAT.wood, { tint: [...WOOD], bevel: 0.004 });
  xf.collider([-W / 2, 0, 0], [W / 2, H, D]);
  const kinds: FlowerSpecies[] = ['violet', 'geranium', 'tradescantia', 'violet', 'geranium', 'chrysanthemum'];
  shelves.forEach((y, si) => {
    const n = 4 + (r() < 0.5 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const x = -W / 2 + ((k + 0.5) / n) * W + (r() - 0.5) * 0.08;
      // Традесканция свисает на полметра — только с верхней полки: с нижней она ушла бы под пол.
      const pickK = kinds[Math.floor(r() * kinds.length)]!;
      const s = si === 2 && r() < 0.6 ? 'tradescantia' : pickK === 'tradescantia' && si < 2 ? 'violet' : pickK;
      potted(xf, x, y, D / 2 + (r() - 0.5) * 0.05, s, Math.floor(r() * 1e9), s === 'chrysanthemum' ? 0.75 : 1.0);
    }
  });
}

/** Стол с рассадой посреди: столешница на четырёх ногах, на ней горшки в два ряда. */
function table(xf: Xf, seed: number, palette: Palette): void {
  const r = rng(seed);
  const W = 1.6;
  const D = 0.75;
  const H = 0.78;
  const tint: [number, number, number] = [WOOD[0], WOOD[1] * 0.95, WOOD[2]];
  xf.box([-W / 2, H - 0.04, -D / 2], [W / 2, H, D / 2], MAT.wood, { tint, bevel: 0.006 });
  for (const x of [-W / 2 + 0.06, W / 2 - 0.1]) for (const z of [-D / 2 + 0.06, D / 2 - 0.1]) xf.box([x, 0, z], [x + 0.04, H - 0.04, z + 0.04], MAT.wood, { tint, aoBottom: 0.6 });
  xf.collider([-W / 2, 0, -D / 2], [W / 2, H, D / 2]);
  for (const z of [-0.18, 0.18]) {
    for (let k = 0; k < 4; k++) {
      const x = -W / 2 + ((k + 0.5) / 4) * W + (r() - 0.5) * 0.06;
      const s = pick(palette, r());
      potted(xf, x, H, z + (r() - 0.5) * 0.04, s === 'fern' ? 'geranium' : s, Math.floor(r() * 1e9), 0.85);
    }
  }
}

/** Кадка с монстерой: квадратный ящик из досок с обручами и большое растение. */
function tub(xf: Xf, seed: number): void {
  const R = 0.28;
  const H = 0.44;
  const t = 0.03;
  const tint: [number, number, number] = [WOOD[0] * 0.9, WOOD[1] * 0.9, WOOD[2] * 0.9];
  xf.box([-R, 0, -R], [R, H, -R + t], MAT.wood, { tint, bevel: 0.005, aoBottom: 0.55 });
  xf.box([-R, 0, R - t], [R, H, R], MAT.wood, { tint, bevel: 0.005, aoBottom: 0.55 });
  xf.box([-R, 0, -R + t], [-R + t, H, R - t], MAT.wood, { tint, bevel: 0.005, aoBottom: 0.55 });
  xf.box([R - t, 0, -R + t], [R, H, R - t], MAT.wood, { tint, bevel: 0.005, aoBottom: 0.55 });
  for (const y of [0.08, H - 0.1]) xf.box([-R - 0.006, y, -R - 0.006], [R + 0.006, y + 0.025, R + 0.006], MAT.rust, { tint: [0.7, 0.7, 0.7], skip: ['py', 'ny'] });
  xf.box([-R + t, 0.02, -R + t], [R - t, H - 0.05, R - t], MAT.dirt, { tint: [...SOIL], skip: ['ny'] });
  xf.collider([-R, 0, -R], [R, H, R]);
  plant(xf, [0, H - 0.05, 0], 'monstera', seed, 1.25, rng(seed)() * 6.28);
}

/** Подвесной ящик с традесканцией: четыре тросика от потолка (y = 0) к углам ящика, стебли свисают через край. */
function hangingTray(xf: Xf, seed: number): void {
  const drop = 0.62;
  const R = 0.17;
  const z = 0.25;
  const tint: [number, number, number] = [WOOD[0] * 0.85, WOOD[1] * 0.85, WOOD[2] * 0.85];
  // Ящик: дно и четыре борта.
  xf.box([-R, -drop - 0.12, z - R], [R, -drop - 0.1, z + R], MAT.wood, { tint });
  xf.box([-R, -drop - 0.12, z - R], [R, -drop, z - R + 0.02], MAT.wood, { tint });
  xf.box([-R, -drop - 0.12, z + R - 0.02], [R, -drop, z + R], MAT.wood, { tint });
  xf.box([-R, -drop - 0.12, z - R + 0.02], [-R + 0.02, -drop, z + R - 0.02], MAT.wood, { tint });
  xf.box([R - 0.02, -drop - 0.12, z - R + 0.02], [R, -drop, z + R - 0.02], MAT.wood, { tint });
  xf.box([-R + 0.02, -drop - 0.1, z - R + 0.02], [R - 0.02, -drop - 0.03, z + R - 0.02], MAT.dirt, { tint: [...SOIL], skip: ['ny'] });
  // Тросики — тонкие стойки от углов к потолку (прямые: повороты у коробок только четвертями).
  for (const [x, zz] of [[-R + 0.01, z - R + 0.01], [R - 0.01, z - R + 0.01], [-R + 0.01, z + R - 0.01], [R - 0.01, z + R - 0.01]] as const) {
    xf.box([x - 0.003, -drop, zz - 0.003], [x + 0.003, 0, zz + 0.003], MAT.steel, { tint: [0.5, 0.5, 0.52] });
  }
  plant(xf, [0, -drop - 0.03, z], 'tradescantia', seed ^ 0x3c, 1.1, rng(seed)() * 6.28);
}

/** Тон натриевого света: им светятся трубки и им же рендер красит то, что под лампой (render/renderer.ts, LAMP). */
export const SODIUM_GLOW: readonly [number, number, number] = [1.46, 0.66, 0.28];
/**
 * Во сколько раз ярче тона светятся сами трубки. У светящегося материала оттенок вершины больше 1,5 — это цвет, помноженный на
 * яркость (render/shaders.ts, glowBase); оттенок 1,46 шейдер читал фосфорной табличкой: бледно-зелёным и почти без свечения — в
 * темноте трубок не было видно вовсе (кадры 25.11). Теперь они светятся оранжевым сами, как контур выхода, и в темноте видны.
 */
const TUBE_GLOW = 20;

/**
 * Лампы теплицы: две трубки натриевого света — тёплого, оранжевого — на подвесах (подземная теплица в убежище). Середина трубок
 * уходит в список ламп сетки помещения (MeshBuilder.lamps): по нему рендер красит грядки и пол под лампой (design.md, §35).
 */
function lamps(xf: Xf, _seed: number): void {
  const glow: [number, number, number] = [SODIUM_GLOW[0] * TUBE_GLOW, SODIUM_GLOW[1] * TUBE_GLOW, SODIUM_GLOW[2] * TUBE_GLOW];
  for (const z of [0.12, 0.38]) {
    for (const x of [-0.52, 0.52]) xf.box([x - 0.004, -0.33, z - 0.004], [x + 0.004, 0, z + 0.004], MAT.steel, { tint: [0.4, 0.4, 0.42] });
    xf.box([-0.6, -0.36, z - 0.018], [0.6, -0.33, z + 0.018], MAT.glow, { tint: glow });
  }
  xf.mb.lamps?.push(xf.pt(0, -0.345, 0.25));
}

export const GREENHOUSE_PROPS: Record<string, PropSpec> = {
  gh_bed_mourn: { w: 2.4, d: 0.75, h: 1.75, mount: 'floor', ru: 'грядка: гвоздики, хризантемы, каллы — к праздникам и к похоронам', build: (xf, seed) => bed(xf, seed, PALETTES.mourn!) },
  gh_bed_spring: { w: 2.4, d: 0.75, h: 1.6, mount: 'floor', ru: 'грядка: тюльпаны и гвоздики, как вёдрами у вокзала', build: (xf, seed) => bed(xf, seed, PALETTES.spring!) },
  gh_bed_green: { w: 2.4, d: 1.0, h: 1.75, mount: 'floor', ru: 'грядка зимнего сада: папоротник, герань, хризантемы, фиалки', build: (xf, seed) => bed(xf, seed, PALETTES.green!) },
  // Короткие — у угла, где длинная не встаёт (соседняя стена тоже под грядкой): иначе вдоль стен стояли бы одни стеллажи.
  gh_bed_mourn_s: { w: 1.5, d: 0.75, h: 1.75, mount: 'floor', ru: 'короткая грядка: гвоздики, хризантемы, каллы', build: (xf, seed) => bed(xf, seed, PALETTES.mourn!, 1.5) },
  gh_bed_spring_s: { w: 1.5, d: 0.75, h: 1.6, mount: 'floor', ru: 'короткая грядка: тюльпаны и гвоздики', build: (xf, seed) => bed(xf, seed, PALETTES.spring!, 1.5) },
  gh_bed_green_s: { w: 1.5, d: 1.0, h: 1.75, mount: 'floor', ru: 'короткая грядка зимнего сада: папоротник, герань, хризантемы, фиалки', build: (xf, seed) => bed(xf, seed, PALETTES.green!, 1.5) },
  gh_rack: { w: 1.5, d: 0.45, h: 1.95, mount: 'floor', ru: 'стеллаж с горшками: фиалки, герань, традесканция', build: rack },
  gh_patch_mourn: { w: 1.6, d: 1.6, h: 1.35, mount: 'free', ru: 'клумба посреди пола: гвоздики, хризантемы, каллы', build: (xf, seed) => patch(xf, seed, PALETTES.mourn!) },
  gh_patch_spring: { w: 1.6, d: 1.6, h: 1.2, mount: 'free', ru: 'клумба посреди пола: тюльпаны и гвоздики', build: (xf, seed) => patch(xf, seed, PALETTES.spring!) },
  gh_patch_green: { w: 1.6, d: 1.6, h: 1.35, mount: 'free', ru: 'клумба посреди пола: зелень, герань, хризантемы', build: (xf, seed) => patch(xf, seed, PALETTES.green!) },
  gh_table_mourn: { w: 1.6, d: 0.75, h: 1.7, mount: 'free', ru: 'стол с рассадой: гвоздики, хризантемы', build: (xf, seed) => table(xf, seed, PALETTES.mourn!) },
  gh_table_green: { w: 1.6, d: 0.75, h: 1.7, mount: 'free', ru: 'стол с рассадой: герань, фиалки, хризантемы', build: (xf, seed) => table(xf, seed, PALETTES.green!) },
  gh_tub_monstera: { w: 1.6, d: 1.6, h: 1.7, mount: 'free', ru: 'кадка с монстерой', build: tub },
  gh_hanging: { w: 0.5, d: 0.5, h: 1.45, mount: 'ceiling', ru: 'подвесной ящик с традесканцией', build: hangingTray },
  gh_lamp: { w: 1.25, d: 0.5, h: 0.38, mount: 'ceiling', ru: 'лампы теплицы: оранжевый натриевый свет над грядками', build: lamps },
};
