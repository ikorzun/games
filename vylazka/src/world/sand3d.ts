/**
 * Полка Sand3D в игре (партнёр 17.11, 23:30: «давай заменять вещи»; 18.11, 09:41: «замени всю мебель на новую
 * самостоятельно»). Настоящая мебель из каталога Sand3D (scripts/import_sand3d.py): опись (sand3d_meta.ts) лёгкая и входит
 * в основную сборку, а сами модели (sand3d_data.ts, около мегабайта) — отдельный кусок. Из них собрана вся мебель игры
 * (world/furniture.ts), поэтому кусок качается сразу при старте, параллельно со шрифтом и сохранением (app.ts), и первая
 * сборка места его дожидается. Конструктор (tools/constructor) берёт модели сразу, без этого загрузчика.
 */
import { hasModel, registerModels } from './models';
import { SAND3D_META } from './sand3d_meta';

let loading: Promise<boolean> | null = null;
/** Строки авторства моделей (как в каталоге, без изменений) — для титров; приходят вместе с моделями. */
let credits: readonly string[] = [];

/** Строки авторства для титров игры (CC BY 4.0 требует назвать авторов); пусто, пока кусок не пришёл. */
export function sand3dCredits(): readonly string[] {
  return credits;
}

/** Модели полки уже подключены (кусок пришёл). */
export function sand3dLoaded(): boolean {
  const first = Object.keys(SAND3D_META)[0];
  return first !== undefined && hasModel(first);
}

/**
 * Подгрузить модели полки (один раз; повторный вызов отдаёт тот же ответ). true — пришли; false — кусок не
 * загрузился (сеть): вещи полки тогда стоят серыми коробками своего габарита, преграда та же, игра не падает.
 */
export function loadSand3d(): Promise<boolean> {
  loading ??= import('./sand3d_data').then(
    (m) => {
      registerModels(m.SAND3D_DATA);
      credits = m.SAND3D_CREDITS.map((c) => c.attribution);
      return true;
    },
    (e: unknown) => {
      console.warn('[sand3d] модели полки не загрузились:', e);
      return false;
    },
  );
  return loading;
}
