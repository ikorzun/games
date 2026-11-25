/**
 * Красная комната забвения (партнёр 24.11: «кукольный домик нужно убрать – он выбивается стилем и не понятно зачем я там.
 * Замени кукольный домик другой комнатой в бесконечном пространстве, пусть это будет комната, где все по центру стоит
 * греческая фигура символа забвения. Комната полностью красного цвета, фигура мрамор»).
 *
 * Бесконечная красная плоскость в красной дымке; посреди неё — квадратная комната: красные стены, пол и потолок, в каждой
 * стене высокий проём. В середине, под квадратным окном в потолке, на круглом постаменте стоит мраморная Лета: фигура в
 * хитоне со складками, под покрывалом, с опущенной головой, в руках — чаша. Лица нет: покрывало закрывает его целиком.
 *
 * Зачем сюда попадают: Лета помнит, что забыто. Посмотрел на неё вблизи — узнал, где лежит искомая вещь (то же, что делал
 * макет кукольного домика, строкой). Выход — проём в дальней стене, за фигурой; его обводка — белая, а не красная.
 *
 * Вид кармана в коде по-прежнему зовётся 'dollhouse' (сохранения, аналитика, ключи строк): как у шляпы, сменился вид, а не имя.
 * Направление: игрок появляется снаружи, с −z, лицом к комнате (в +z).
 */
import type { Vec3 } from '../core/types';
import { ColliderSet } from './colliders';
import { MeshBuilder } from './kit';
import { MAT } from './materials';
import { Xf } from './props';
import { lathe } from './props_real';
import { tube } from './props_seating';
import type { MeshData } from './kit';
import { letheStatue } from './lethe_statue';
import type { PocketBuilder, PocketSpace } from './pockets';

/** Комната: полуширина, высота, толщина стен, полуширина и высота проёма, полуширина окна в потолке, м. */
export const LETHE = { half: 5, h: 5.2, wall: 0.4, gapHalf: 1.3, gapH: 3.6, eye: 1.5, plinth: 0.5, figure: 2.02 } as const;

const RED: Vec3 = [1.5, 0.1, 0.08];
const RED_DK: Vec3 = [1.05, 0.06, 0.05];
// Оттенки поверх материала «мрамор» (world/materials.ts): у него свой шар блеска и своя фактура с прожилками.
const MARBLE: Vec3 = [1.14, 1.13, 1.1];
const MARBLE_SH: Vec3 = [0.98, 0.97, 0.94];

const sh = (c: Vec3, k: number): Vec3 => [c[0] * k, c[1] * k, c[2] * k];

/** Мраморная Лета на постаменте; начало координат — середина постамента на полу. Лицом в −z (к входящему). */
function statue(xf: Xf): void {
  const mb = xf.mb;
  const y0 = LETHE.plinth;
  // Постамент: две ступени.
  lathe(xf, 0, 0, [[0.78, 0], [0.78, 0.16], [0.6, 0.18], [0.6, y0 - 0.03], [0.56, y0], [0.0005, y0]], 40, MAT.marble, () => MARBLE_SH);
  // Тело в хитоне: складки глубже к подолу, выше пояса сходят на нет. Потом сплющено по z — человек, а не колонна.
  const from = mb.vertexCount;
  const folds = (th: number, t: number): number => 1 + 0.06 * Math.pow(Math.max(0, 1 - t * 1.25), 1.1) * Math.cos(th * 17 + 1.4 * Math.sin(th * 3)) + 0.012 * Math.cos(th * 5 + 0.7);
  const body: [number, number][] = [[0.3, 0], [0.315, 0.03], [0.29, 0.22], [0.25, 0.6], [0.225, 0.95], [0.21, 1.08], [0.18, 1.22], [0.19, 1.34], [0.215, 1.45], [0.22, 1.54], [0.17, 1.62], [0.075, 1.67], [0.066, 1.74]];
  lathe(xf, 0, 0, body.map(([r, y]): [number, number] => [r, y0 + y]), 56, MAT.marble, (t, th) => sh(MARBLE, 0.62 + 0.38 * Math.min(1, Math.max(0, (folds(th, t) - 0.955) / 0.09))), folds, (t) => 0.82 + 0.18 * t);
  const o = xf.pt(0, 0, 0);
  mb.transformFrom(from, mb.sheets.length, (p) => [p[0], p[1], o[2] + (p[2] - o[2]) * 0.72], (n) => {
    const l = Math.hypot(n[0], n[1], n[2] / 0.72) || 1;
    return [n[0] / l, n[1] / l, n[2] / 0.72 / l];
  });
  // Голова под покрывалом: покрывало закрывает лицо и спадает на плечи. Всё вместе наклонено вперёд — голова опущена.
  const hf = mb.vertexCount;
  const hy = y0 + 1.86;
  const head: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI;
    head.push([Math.max(0.0005, 0.108 * Math.sin(a)), hy - 0.13 * Math.cos(a)]);
  }
  lathe(xf, 0, 0, head, 24, MAT.marble, () => MARBLE_SH);
  const veilFold = (th: number, t: number): number => 1 + 0.045 * t * Math.cos(th * 9 + 0.6 * Math.sin(th * 2));
  const veil: [number, number][] = [[0.0005, 0.155], [0.07, 0.143], [0.118, 0.09], [0.132, 0.0], [0.128, -0.1], [0.15, -0.2], [0.21, -0.33], [0.25, -0.48], [0.262, -0.66]];
  lathe(xf, 0, 0, veil.map(([r, y]): [number, number] => [r, hy + y]), 40, MAT.marble, (t, th) => sh(MARBLE, 0.66 + 0.34 * Math.min(1, Math.max(0, (veilFold(th, t) - 0.96) / 0.08))), veilFold, (t) => 1 - 0.15 * t);
  const neck = xf.pt(0, y0 + 1.68, 0);
  const tilt = 0.24;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const fwd = xf.dir(0, 0, -1);
  // Поворот вокруг горизонтальной оси через шею: верх уходит вперёд (к −z фигуры).
  const rot = (v: Vec3): Vec3 => {
    const f = v[0] * fwd[0] + v[2] * fwd[2];
    const side: Vec3 = [v[0] - f * fwd[0], 0, v[2] - f * fwd[2]];
    const f2 = f * ct + v[1] * st;
    const y2 = v[1] * ct - f * st;
    return [side[0] + f2 * fwd[0], y2, side[2] + f2 * fwd[2]];
  };
  mb.transformFrom(hf, mb.sheets.length, (p) => {
    const r = rot([p[0] - neck[0], p[1] - neck[1], p[2] - neck[2]]);
    return [neck[0] + r[0], neck[1] + r[1], neck[2] + r[2]];
  }, rot);
  // Руки: от локтей под покрывалом к чаше перед грудью.
  for (const sx of [-1, 1]) {
    tube(xf, [[sx * 0.21, y0 + 1.3, -0.02], [sx * 0.2, y0 + 1.14, -0.12], [sx * 0.1, y0 + 1.1, -0.27]], 0.042, MAT.marble, MARBLE, 10);
  }
  // Чаша (фиала): плоская, тёмная внутри.
  const by = y0 + 1.1;
  lathe(xf, 0, -0.3, [[0.03, by], [0.1, by + 0.012], [0.135, by + 0.05], [0.14, by + 0.062], [0.13, by + 0.058], [0.09, by + 0.03], [0.0005, by + 0.022]], 28, MAT.marble, (t) => (t > 0.55 ? [0.5, 0.48, 0.46] : MARBLE));
  xf.collider([-0.78, 0, -0.78], [0.78, y0 + LETHE.figure, 0.78]);
}

/** Высота круглого постамента под сканом, м: у коры своё ступенчатое подножие, высокий постамент сделал бы её колонной. */
const SCAN_PLINTH = 0.26;

/**
 * Скан коры (world/lethe_statue.ts) на низком круглом постаменте посреди комнаты — отдельной сеткой: своя сетка у скана уже
 * собрана, в MeshBuilder её не перекладываем. Лицом в −z, к входящему.
 */
function scanStatue(xf: Xf, scan: MeshData, ox: number, oy: number, oz: number): MeshData {
  lathe(xf, 0, 0, [[0.62, 0], [0.62, SCAN_PLINTH - 0.04], [0.58, SCAN_PLINTH], [0.0005, SCAN_PLINTH]], 40, MAT.marble, () => MARBLE_SH);
  xf.collider([-0.62, 0, -0.62], [0.62, SCAN_PLINTH + 2.05, 0.62]);
  const position = new Float32Array(scan.position.length);
  for (let i = 0; i < position.length; i += 3) {
    position[i] = ox + scan.position[i]!;
    position[i + 1] = oy + SCAN_PLINTH + scan.position[i + 1]!;
    position[i + 2] = oz + scan.position[i + 2]!;
  }
  return { ...scan, position };
}

export const buildLethe: PocketBuilder = (_seed: number, origin: Vec3): PocketSpace => {
  const [ox, oy, oz] = origin;
  const mb = new MeshBuilder();
  const cs = new ColliderSet();
  const xf = new Xf(mb, cs, ox, oy, oz);
  const { half: R, h: H, wall: T, gapHalf: G, gapH: GH, eye: E } = LETHE;
  // Бесконечный красный пол.
  const FAR = 70;
  mb.box([ox - FAR, oy - 0.5, oz - FAR], [ox + FAR, oy, oz + FAR], MAT.plaster, { tint: RED, skip: ['ny', 'px', 'nx', 'pz', 'nz'] });
  cs.addBox(ox - FAR, oy - 0.5, oz - FAR, ox + FAR, oy, oz + FAR);
  // Стены: в каждой — высокий проём посередине. Над проёмом — перемычка без преграды.
  for (const rot of [0, 1, 2, 3] as const) {
    const w = new Xf(mb, cs, ox, oy, oz, rot);
    w.solid([-R - T, 0, R], [-G, H, R + T], MAT.plaster, { tint: RED });
    w.solid([G, 0, R], [R + T, H, R + T], MAT.plaster, { tint: RED });
    w.box([-G, GH, R], [G, H, R + T], MAT.plaster, { tint: RED });
  }
  // Потолок с квадратным окном над фигурой: четыре плиты вокруг него.
  xf.box([-R - T, H, -R - T], [R + T, H + T, -E], MAT.plaster, { tint: RED_DK });
  xf.box([-R - T, H, E], [R + T, H + T, R + T], MAT.plaster, { tint: RED_DK });
  xf.box([-R - T, H, -E], [-E, H + T, E], MAT.plaster, { tint: RED_DK });
  xf.box([E, H, -E], [R + T, H + T, E], MAT.plaster, { tint: RED_DK });
  // Фигура: скан коры, если он уже пришёл (квиз 24.11, ночь: «Готовая модель»), иначе — собранная программой.
  const scan = letheStatue();
  const figure = scan ? scanStatue(xf, scan, ox, oy, oz) : null;
  if (!figure) statue(xf);
  // Выход — в проёме дальней стены, за фигурой (красную обводку добавит buildPocket).
  const exit: Vec3 = [ox, oy, oz + R + T / 2];
  const spots: Vec3[] = [
    [-2.6, 0, -2.4],
    [2.7, 0, -2.2],
    [-3.0, 0, 2.3],
    [2.9, 0, 2.6],
    [-2.2, 0, -8.5],
    [2.4, 0, -9.2],
  ].map(([x, y, z]): Vec3 => [ox + x!, oy + y!, oz + z!]);
  return {
    kind: 'dollhouse',
    meshes: figure ? [mb.build(), figure] : [mb.build()],
    colliders: cs.boxes.map((b) => ({ ...b })),
    // Снаружи, в двенадцати метрах от комнаты: сначала видно пространство и комнату в нём, потом — фигуру в проёме.
    spawn: { pos: [ox, oy, oz - R - 12], yaw: Math.PI, pitch: 0 },
    // Красный рассеянный свет и красная даль; сверху — белый свет: в комнату он попадает только через окно, на фигуру.
    env: { ambient: [0.2, 0.022, 0.018], fog: [0.2, 0.004, 0.003], fogDensity: 0.028, light: 0.6, decay: -0.5, haze: 0.002, plain: true, scan: [9, 30], key: { dir: [0.05, 0.985, -0.16], color: [1.25, 1.2, 1.12], reach: 8 } },
    center: [ox, oy, oz],
    radius: 44,
    spots,
    exit,
    // Обводка выхода — белым: красная в красной комнате не видна.
    exitGlow: [150, 150, 160],
    // Точка — перед фигурой, у чаши, снаружи её преграды: луч взгляда до неё ничем не закрыт.
    focus: [ox, oy + LETHE.plinth + 1.3, oz - 0.9],
  };
};
