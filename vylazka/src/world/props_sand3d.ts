/**
 * Мебель полки Sand3D как реквизит (имена s3_*): размеры — из описи (sand3d_meta.ts) с округлением вверх до
 * сантиметра, координаты — как в props_home.ts: пол y = 0; у стены спина в z = 0 и лицо в +z (ящики, дверцы, сиденья
 * смотрят в комнату, кровати и нары — длинной стороной вдоль стены), посреди пола — середина в начале координат.
 * Модель кладётся с материалом каждой детали; пока кусок с моделями не пришёл (world/sand3d.ts) — серой коробкой
 * габарита, чтобы и тогда было видно, что там стоит, и обойти её можно было так же.
 *
 * Под своими именами эти вещи ставят партнёр (конструктором) и комнаты убежища (world/furnish.ts: нары, шкафчики, стеллажи,
 * столы — объекты уровня, сид от места). В остальных местах мебель с 18.11 строится ими же, но под прежними именами
 * (world/furniture.ts; партнёр: «замени всю мебель на новую самостоятельно»): диван игры остаётся «sofa», записи партнёра
 * находят его по-прежнему, а выглядит он диваном полки.
 */
import { jitter, openOf, s3Parts, s3Put, s3Reach, s3Size } from './furniture';
import type { PropSpec } from './props_more';
import { SAND3D_META } from './sand3d_meta';

/**
 * Что под своим именем стоит закрытым, хотя ящик есть: рабочий стол стоит посреди комнаты с табуретками вокруг, и выдвинутый
 * ящик упирался бы в табурет.
 */
const SHUT_HERE = new Set(['s3_table_work']);

/**
 * Вещь полки под своим именем; тон чуть гуляет от сида — три шкафчика бок о бок не одного оттиска. Дверцы и ящики открыты
 * по сиду (партнёр 18.11, 12:32: «открой дверцы и ящики у шкафов»); габарит — закрытой вещи, вылет открытых частей — reach.
 */
function spec(name: string, ru: string): PropSpec {
  const opens = s3Parts(name).length > 0 && !SHUT_HERE.has(name);
  const g = s3Size(name);
  return {
    w: g.w,
    d: g.d,
    h: g.h,
    mount: g.mount,
    ru,
    ...(opens ? { reach: s3Reach(name) } : {}),
    build: (xf, seed) => {
      const open = opens ? openOf(name, seed) : undefined;
      s3Put(xf, name, { tint: jitter(seed, 0.05), ...(open ? { open } : {}) });
    },
  };
}

export const SAND3D_PROPS: Record<string, PropSpec> = Object.fromEntries(Object.entries(SAND3D_META).map(([name, m]) => [name, spec(name, m.ru)]));
