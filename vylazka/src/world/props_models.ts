/**
 * Реквизит из готовых моделей (свободные наборы с itch.io, лицензия CC0): см. docs/vylazka/assets.md.
 * Модель переведена в формат игры заранее (scripts/import_models.py) и лежит в models_data.ts.
 * Габариты w/d/h берутся из самой модели с округлением вверх до сантиметра; координаты — как в props_home.ts.
 */
import { MODEL_DATA } from './models_data';
import { placeModel } from './models';
import type { PropSpec } from './props_more';

/** Вверх до сантиметра (с запасом на шум плавающей запятой). */
const cm = (v: number): number => Math.ceil(v * 100 - 1e-6) / 100;

interface Row {
  /** Имя в models_data.ts. */
  model: string;
  mount: PropSpec['mount'];
  /** Высота низа для настенного, м. */
  y?: number;
  /** Мешает ли пройти. */
  solid: boolean;
  ru: string;
}

const ROWS: Record<string, Row> = {
  kk_chair_a: { model: 'chair_a', mount: 'floor', solid: true, ru: 'стул с прямой спинкой, мягкое сиденье' },
  kk_chair_b: { model: 'chair_b', mount: 'floor', solid: true, ru: 'стул с планками в спинке' },
  kk_chair_c: { model: 'chair_c', mount: 'floor', solid: true, ru: 'стул с низкой спинкой' },
  kk_stool: { model: 'stool', mount: 'floor', solid: true, ru: 'табурет' },
  kk_armchair: { model: 'armchair', mount: 'floor', solid: true, ru: 'мягкое кресло' },
  kk_couch: { model: 'couch', mount: 'floor', solid: true, ru: 'диван' },
  kk_table_low: { model: 'table_low', mount: 'floor', solid: true, ru: 'низкий журнальный столик' },
  kk_table_medium: { model: 'table_medium', mount: 'floor', solid: true, ru: 'квадратный стол' },
  kk_table_long: { model: 'table_long', mount: 'floor', solid: true, ru: 'длинный обеденный стол' },
  kk_table_small: { model: 'table_small', mount: 'floor', solid: true, ru: 'маленький столик' },
  kk_cabinet_medium: { model: 'cabinet_medium', mount: 'floor', solid: true, ru: 'комод с ящиками' },
  kk_cabinet_small: { model: 'cabinet_small', mount: 'floor', solid: true, ru: 'тумба с дверцей' },
  kk_shelf_big: { model: 'shelf_big', mount: 'wall', y: 1.3, solid: false, ru: 'настенная полка' },
  kk_shelf_large: { model: 'shelf_large', mount: 'wall', y: 1.2, solid: false, ru: 'настенная полка с вещицами' },
  kk_lamp_standing: { model: 'lamp_standing', mount: 'floor', solid: true, ru: 'торшер' },
  kk_lamp_table: { model: 'lamp_table', mount: 'free', solid: false, ru: 'настольная лампа' },
  kk_cactus: { model: 'cactus', mount: 'free', solid: true, ru: 'кактус в горшке' },
  kk_cactus_small: { model: 'cactus_small', mount: 'free', solid: false, ru: 'маленький кактус в горшке' },
  kk_bed_single: { model: 'bed_single', mount: 'floor', solid: true, ru: 'односпальная кровать' },
  kk_bed_double: { model: 'bed_double', mount: 'floor', solid: true, ru: 'двуспальная кровать' },
  kk_picture_large: { model: 'picture_large', mount: 'wall', y: 1.4, solid: false, ru: 'большая картина в раме' },
  kk_picture_medium: { model: 'picture_medium', mount: 'wall', y: 1.4, solid: false, ru: 'картина в раме' },
  kk_picture_small: { model: 'picture_small', mount: 'wall', y: 1.45, solid: false, ru: 'маленькая картина в раме' },
  kk_rug_rect: { model: 'rug_rect', mount: 'free', solid: false, ru: 'прямоугольный коврик' },
  kk_rug_oval: { model: 'rug_oval', mount: 'free', solid: false, ru: 'овальный коврик' },
  kk_pillow: { model: 'pillow', mount: 'free', solid: false, ru: 'подушка' },
  kk_book_set: { model: 'book_set', mount: 'free', solid: false, ru: 'стопка книг' },
};

function spec(row: Row): PropSpec {
  const r = MODEL_DATA[row.model];
  if (!r) throw new Error(`нет модели ${row.model}`);
  const w = cm(Math.max(-r.min[0], r.max[0]) * 2);
  const h = cm(r.max[1]);
  const free = row.mount === 'free';
  const d = free ? cm(Math.max(-r.min[2], r.max[2]) * 2) : cm(r.max[2]);
  const out: PropSpec = {
    w,
    d,
    h,
    mount: row.mount,
    ru: row.ru,
    build(xf) {
      placeModel(xf, row.model);
      if (row.solid) {
        // Преграда — весь габарит модели.
        const z0 = free ? -d / 2 : 0;
        const z1 = free ? d / 2 : d;
        xf.collider([-w / 2, 0, z0], [w / 2, h, z1]);
      }
    },
  };
  if (row.y !== undefined) out.y = row.y;
  return out;
}

export const MODEL_PROPS: Record<string, PropSpec> = Object.fromEntries(Object.entries(ROWS).map(([k, row]) => [k, spec(row)]));
