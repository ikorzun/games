/**
 * Вещи из снимков партнёра «в копилку объектов и окружения» (слова партнёра; решения о том, что куда, —
 * основной модели: docs/vylazka/plan.md, §4, шаг 6). Сделаны заново из геометрии по снимку как по
 * образцу; надписей, имён и марок нет.
 *
 * Правила реестра те же, что везде: wall — спина в z = 0, y в реестре — высота низа; floor — пол y = 0.
 * Вся случайность — из сида предмета.
 */
import type { Vec3 } from '../core/types';
import { MAT } from './materials';
import type { Xf } from './props';
import { rng } from './props_more';
import type { PropSpec } from './props_more';

/** Светлая шершавая панель, тёмные кнопки, латунь табличек, чернота щелей. */
const PANEL: Vec3 = [1.08, 1.05, 0.98];
const PANEL_RIM: Vec3 = [0.92, 0.9, 0.85];
const BUTTON: Vec3 = [0.16, 0.15, 0.15];
const BUTTON_RING: Vec3 = [0.78, 0.76, 0.72];
const PLATE: Vec3 = [0.34, 0.3, 0.24];
const HOLE: Vec3 = [0.05, 0.05, 0.05];

/**
 * Домофон, похожий на лицо: квадратная панель в стене, две круглые кнопки — глаза, две узкие щели по
 * бокам, решётка динамика — рот, над кнопками две пустые таблички — брови. Висит в прихожей, а не у
 * входа: у входа он оказывался рядом с карточкой «please use only when necessary» и делал её
 * обращённой к кому-то. Своя обманка убежища:
 * в месте, где лица на карточках вблизи расплываются, это единственное лицо, которое вблизи не
 * расплывается, — потому что это не лицо (снимок партнёра, 15.11). Неподвижный, без пугалки.
 */
function intercomFace(xf: Xf, seed: number): void {
  const r = rng(seed);
  const tilt = (r() - 0.5) * 0.006;
  const W = 0.27;
  const H = 0.3;
  const T = 0.028;
  // Панель с бортиком: шершавый светлый камень (штукатурка), чуть утоплена рамка.
  xf.box([-W / 2 - 0.01, -0.01, 0], [W / 2 + 0.01, H + 0.01, 0.012], MAT.plaster, { tint: PANEL_RIM, skip: ['nz'] });
  xf.box([-W / 2, 0, 0.012], [W / 2, H, T], MAT.plaster, { tint: PANEL, skip: ['nz'], bevel: 0.004 });
  const z = T;
  // Брови: две пустые латунные таблички.
  for (const s of [-1, 1]) {
    const cx = s * 0.055;
    xf.box([cx - 0.045, H - 0.06 + tilt * s, z], [cx + 0.045, H - 0.042 + tilt * s, z + 0.003], MAT.brass, { tint: PLATE, skip: ['nz'] });
  }
  // Глаза: светлое кольцо и тёмная кнопка. Без зрачков: со зрачками это нарисованная рожица, а не
  // домофон, в котором вдруг увидел лицо (критика куратора, пачка 21).
  for (const s of [-1, 1]) {
    const cx = s * 0.055;
    const cy = H - 0.115;
    xf.cyl([cx, cy, z], 'z', 0.003, 0.03, MAT.plaster, { tint: BUTTON_RING, segments: 18 });
    xf.cyl([cx, cy, z + 0.003], 'z', 0.006, 0.022, MAT.rubber, { tint: BUTTON, segments: 18 });
  }
  // Щёки: две узкие тёмные щели почти во всю высоту.
  for (const s of [-1, 1]) {
    const cx = s * (W / 2 - 0.028);
    xf.box([cx - 0.008, 0.035, z - 0.002], [cx + 0.008, H - 0.04, z + 0.0005], MAT.rubber, { tint: HOLE, skip: ['nz'] });
  }
  // Рот: решётка динамика — светлая рамка, тёмное поле и ряды круглых отверстий (точек).
  const mw = 0.064;
  const mh = 0.1;
  const my = 0.035;
  xf.box([-mw / 2 - 0.006, my - 0.006, z], [mw / 2 + 0.006, my + mh + 0.006, z + 0.002], MAT.plaster, { tint: PANEL_RIM, skip: ['nz'] });
  xf.box([-mw / 2, my, z + 0.002], [mw / 2, my + mh, z + 0.003], MAT.plaster, { tint: [0.86, 0.84, 0.8], skip: ['nz'] });
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 10; j++) {
      const hx = -mw / 2 + 0.008 + i * ((mw - 0.016) / 5);
      const hy = my + 0.008 + j * ((mh - 0.016) / 9);
      xf.box([hx - 0.0028, hy - 0.0028, z + 0.003], [hx + 0.0028, hy + 0.0028, z + 0.0034], MAT.rubber, { tint: HOLE, skip: ['nz'] });
    }
  }
}

export const FOUND_PROPS: Record<string, PropSpec> = {
  intercom_face: { w: 0.31, d: 0.04, h: 0.32, mount: 'wall', y: 1.32, ru: 'домофон, похожий на лицо: кнопки-глаза, решётка-рот, пустые таблички-брови', build: (xf, seed) => intercomFace(xf, seed) },
};
