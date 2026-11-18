/**
 * Мебель полки Sand3D как реквизит (имена s3_*): размеры — из описи (sand3d_meta.ts) с округлением вверх до
 * сантиметра, координаты — как в props_home.ts: пол y = 0; у стены спина в z = 0 и лицо в +z (ящики, дверцы, сиденья
 * смотрят в комнату, кровати и нары — длинной стороной вдоль стены), посреди пола — середина в начале координат.
 * Модель кладётся с материалом каждой детали; пока кусок с моделями не пришёл (world/sand3d.ts) — серой коробкой
 * габарита, чтобы и тогда было видно, что там стоит, и обойти её можно было так же.
 *
 * Под своими именами в обстановку игры эти вещи не встают: их ставит партнёр конструктором. Но мебель игры с 18.11 строится
 * ими же (world/furniture.ts; партнёр: «замени всю мебель на новую самостоятельно») — диван игры остаётся «sofa», а выглядит
 * диваном полки.
 */
import { jitter, s3Put, s3Size } from './furniture';
import type { PropSpec } from './props_more';
import { SAND3D_META } from './sand3d_meta';

/** Вещь полки под своим именем; тон чуть гуляет от сида — три шкафчика бок о бок не одного оттиска. */
function spec(name: string, ru: string): PropSpec {
  const g = s3Size(name);
  return { w: g.w, d: g.d, h: g.h, mount: g.mount, ru, build: (xf, seed) => s3Put(xf, name, { tint: jitter(seed, 0.05) }) };
}

export const SAND3D_PROPS: Record<string, PropSpec> = Object.fromEntries(Object.entries(SAND3D_META).map(([name, m]) => [name, spec(name, m.ru)]));
