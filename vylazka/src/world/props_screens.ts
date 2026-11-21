/**
 * Выставочные экраны как предметы: чёрная панель в тонкой рамке, которая светится картинкой
 * (world/screens.ts). Три вида: прислонённая к стене, стоящая отдельно на подставке и висящая на стене.
 *
 * Панель — вещество: рамка, изнанка и торцы идут в обычную сетку (под фонарём видны, мешают пройти).
 * Картинка — свет: уходит в сетку проекций (xf.sl) материалом «печать» с uv в атлас экранов; шейдер
 * мира (ветка SLIDE) рисует её светящейся. Свет фонаря экран не смывает — на стекле остаётся блик.
 * Там, где сетки проекций нет (витрина без неё, тесты), вместо картинки ставится ровное свечение.
 */
import type { Vec3 } from '../core/types';
import { MAT } from './materials';
import type { Xf } from './props';
import { beam, sheet, WHITE } from './props_more';
import type { PropSpec } from './props_more';
import { screenFor, screenUv } from './screens';

export type DisplayShape = 'lean' | 'stand' | 'wall';

const FRAME: Vec3 = [0.5, 0.5, 0.52];
const BACK: Vec3 = [0.7, 0.7, 0.72];
/** Ширина рамки вокруг картинки, м. */
const BEZEL = 0.016;

/** Размер картинки каждого вида (ширина × высота, м): по ним расставляющий код пишет метки. */
export const DISPLAY_SIZE: Readonly<Record<DisplayShape, readonly [number, number]>> = { lean: [1.14, 2.08], stand: [1.14, 2.02], wall: [1.7, 0.98] };

/**
 * Панель по трём осям: o — середина нижнего края изнанки, u — вправо, v — вверх вдоль панели,
 * n — наружу, к зрителю. w × l — размер, t — толщина. image — номер картинки в атласе экранов,
 * band — какую долю её высоты показывать (лежачий экран берёт полосу из середины).
 */
function panel(xf: Xf, o: Vec3, u: Vec3, v: Vec3, n: Vec3, w: number, l: number, t: number, image: number, band = 1): void {
  const at = (a: number, b: number, c: number): Vec3 => [o[0] + u[0] * a + v[0] * b + n[0] * c, o[1] + u[1] * a + v[1] * b + n[1] * c, o[2] + u[2] * a + v[2] * b + n[2] * c];
  const neg = (q: Vec3): Vec3 => [-q[0], -q[1], -q[2]];
  const hw = w / 2;
  // Изнанка и четыре торца.
  sheet(xf, at(-hw, 0, 0), at(hw, 0, 0), at(hw, l, 0), at(-hw, l, 0), neg(n), MAT.bakelite, BACK);
  sheet(xf, at(-hw, 0, 0), at(-hw, 0, t), at(-hw, l, t), at(-hw, l, 0), neg(u), MAT.bakelite, FRAME);
  sheet(xf, at(hw, 0, 0), at(hw, 0, t), at(hw, l, t), at(hw, l, 0), u, MAT.bakelite, FRAME);
  sheet(xf, at(-hw, l, 0), at(hw, l, 0), at(hw, l, t), at(-hw, l, t), v, MAT.bakelite, FRAME);
  sheet(xf, at(-hw, 0, 0), at(hw, 0, 0), at(hw, 0, t), at(-hw, 0, t), neg(v), MAT.bakelite, FRAME);
  // Рамка вокруг картинки: четыре полосы на лицевой стороне.
  const b = BEZEL;
  sheet(xf, at(-hw, 0, t), at(hw, 0, t), at(hw, b, t), at(-hw, b, t), n, MAT.bakelite, FRAME);
  sheet(xf, at(-hw, l - b, t), at(hw, l - b, t), at(hw, l, t), at(-hw, l, t), n, MAT.bakelite, FRAME);
  sheet(xf, at(-hw, b, t), at(-hw + b, b, t), at(-hw + b, l - b, t), at(-hw, l - b, t), n, MAT.bakelite, FRAME);
  sheet(xf, at(hw - b, b, t), at(hw, b, t), at(hw, l - b, t), at(hw - b, l - b, t), n, MAT.bakelite, FRAME);
  // Картинка — на волос впереди рамки.
  const z = t + 0.0015;
  const c0 = at(-hw + b, b, z);
  const c1 = at(hw - b, b, z);
  const c2 = at(hw - b, l - b, z);
  const c3 = at(-hw + b, l - b, z);
  const world = (q: Vec3): Vec3 => xf.pt(q[0], q[1], q[2]);
  if (xf.sl) {
    const r = screenUv(image, band);
    xf.sl.quadUv([world(c0), world(c1), world(c2), world(c3)], [r.u0, r.v0, r.u1, r.v1], MAT.print, WHITE, 1);
    // Под картинкой — чёрное стекло: погасший экран остаётся панелью, а не дырой в рамке. Материал
    // «свечение» с почти нулевым оттенком: точек скана на нём нет, и сам он ничего не излучает.
    sheet(xf, at(-hw + b, b, t), at(hw - b, b, t), at(hw - b, l - b, t), at(-hw + b, l - b, t), n, MAT.glow, [0.03, 0.03, 0.04]);
  } else sheet(xf, c0, c1, c2, c3, n, MAT.glow, [5, 6, 7]);
}

/**
 * Поставить экран. Начало координат — как у любого предмета: у прислонённого и настенного спина
 * в плоскости z = 0, у стоящего отдельно — середина подставки. image — номер картинки в атласе экранов.
 */
export function buildDisplay(xf: Xf, shape: DisplayShape, image: number): void {
  const [w, l] = DISPLAY_SIZE[shape];
  if (shape === 'lean') {
    // Низ стоит на полу в 44 см от стены, верх опирается на стену: наклон около двенадцати градусов.
    const t = 0.045;
    const foot = 0.44;
    const s = (foot - 0.02) / l;
    const c = Math.sqrt(1 - s * s);
    panel(xf, [0, 0, foot], [1, 0, 0], [0, c, -s], [0, s, c], w, l, t, image);
    // Шнур питания уходит по полу к стене.
    beam(xf, [w / 2 - 0.12, 0.012, foot - 0.02], [w / 2 + 0.05, 0.012, 0.06], 0.014, 0.012, MAT.rubber, [1.2, 1.2, 1.2]);
    xf.collider([-w / 2, 0, 0], [w / 2, l * c, foot + 0.07]);
  } else if (shape === 'stand') {
    const t = 0.05;
    xf.box([-0.36, 0, -0.2], [0.36, 0.035, 0.2], MAT.bakelite, { tint: FRAME, bevel: 0.008 });
    xf.box([-0.04, 0.035, -0.03], [0.04, 0.07, 0.03], MAT.bakelite, { tint: FRAME });
    panel(xf, [0, 0.07, -t / 2], [1, 0, 0], [0, 1, 0], [0, 0, 1], w, l, t, image);
    xf.collider([-w / 2, 0, -0.07], [w / 2, l + 0.07, 0.07]);
    xf.collider([-0.36, 0, -0.2], [0.36, 0.2, 0.2]);
  } else {
    // Лежачий экран на стене: картинка — полоса из середины вертикального кадра.
    const t = 0.05;
    const band = l / w / (640 / 384);
    xf.box([-0.2, l * 0.35, 0], [0.2, l * 0.65, 0.02], MAT.steel, { tint: [0.5, 0.5, 0.5] });
    panel(xf, [0, 0, 0.02], [1, 0, 0], [0, 1, 0], [0, 0, 1], w, l, t, image, band);
  }
}

const spec = (shape: DisplayShape, w: number, d: number, h: number, mount: PropSpec['mount'], ru: string, y?: number): PropSpec => ({
  w,
  d,
  h,
  mount,
  ru,
  ...(y !== undefined ? { y } : {}),
  // Сам по себе экран показывает любую картинку; какую именно в помещении — решает обстановка (buildDisplay).
  build: (xf, seed) => buildDisplay(xf, shape, screenFor(seed)),
});

export const SCREEN_PROPS: Record<string, PropSpec> = {
  display_lean: spec('lean', 1.2, 0.52, 2.06, 'floor', 'выставочный экран, прислонён к стене'),
  display_stand: spec('stand', 1.2, 0.42, 2.1, 'free', 'выставочный экран на подставке, стоит отдельно'),
  display_wall: spec('wall', 1.72, 0.08, 0.98, 'wall', 'лежачий экран на стене', 1.05),
};
