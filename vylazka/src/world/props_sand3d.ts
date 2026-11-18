/**
 * Мебель полки Sand3D как реквизит (имена s3_*): размеры — из описи (sand3d_meta.ts) с округлением вверх до
 * сантиметра, координаты — как в props_home.ts: пол y = 0; у стены спина в z = 0 и лицо в +z (ящики, дверцы, сиденья
 * смотрят в комнату, кровати и нары — длинной стороной вдоль стены), посреди пола — середина в начале координат.
 * Модель кладётся с материалом каждой детали; пока кусок с моделями не пришёл (world/sand3d.ts) — серой коробкой
 * габарита, чтобы и тогда было видно, что там стоит, и обойти её можно было так же.
 *
 * В обстановку игры сами по себе эти вещи не встают: их ставит и ими заменяет вещи игры партнёр — в конструкторе
 * (квиз 18.11: «Полка в конструкторе, меняешь ты»).
 */
import { MAT } from './materials';
import { hasModel, placeModel } from './models';
import type { PropSpec } from './props_more';
import { SAND3D_META } from './sand3d_meta';
import type { Sand3dMeta } from './sand3d_meta';

/** Вверх до сантиметра (с запасом на шум плавающей запятой). */
const cm = (v: number): number => Math.ceil(v * 100 - 1e-6) / 100;

function spec(name: string, m: Sand3dMeta): PropSpec {
  const free = m.mount === 'free';
  const w = cm(Math.max(-m.min[0], m.max[0]) * 2);
  const h = cm(m.max[1]);
  const d = free ? cm(Math.max(-m.min[2], m.max[2]) * 2) : cm(m.max[2]);
  const z0 = free ? -d / 2 : 0;
  const z1 = free ? d / 2 : d;
  return {
    w,
    d,
    h,
    mount: m.mount,
    ru: m.ru,
    build(xf) {
      if (hasModel(name)) placeModel(xf, name);
      else xf.box([-w / 2, 0, z0], [w / 2, h, z1], MAT.paper);
      // Преграда — весь габарит вещи (как у готовых моделей KayKit).
      xf.collider([-w / 2, 0, z0], [w / 2, h, z1]);
    },
  };
}

export const SAND3D_PROPS: Record<string, PropSpec> = Object.fromEntries(Object.entries(SAND3D_META).map(([name, m]) => [name, spec(name, m)]));
