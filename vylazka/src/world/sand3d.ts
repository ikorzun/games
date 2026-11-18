/**
 * Полка Sand3D в игре (партнёр 17.11, 23:30: «давай заменять вещи»; квиз 18.11: «Полка в конструкторе, меняешь ты»).
 * Настоящая мебель из каталога Sand3D (scripts/import_sand3d.py): опись (sand3d_meta.ts) лёгкая и входит в основную
 * сборку, а сами модели (sand3d_data.ts, около мегабайта) — отдельный кусок, который грузится, только когда вещь полки
 * нужна странице: её поставил партнёр (world/placed_data.ts) или её смотрят в витрине. Пока полку не трогали, игра не
 * качает её вовсе. Конструктор (tools/constructor) берёт модели сразу, без этого загрузчика.
 */
import { hasModel, registerModels } from './models';
import { SAND3D_META } from './sand3d_meta';

/** Вещь полки Sand3D? */
export const isSand3d = (name: string): boolean => Object.prototype.hasOwnProperty.call(SAND3D_META, name);

let loading: Promise<boolean> | null = null;

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
      return true;
    },
    (e: unknown) => {
      console.warn('[sand3d] модели полки не загрузились:', e);
      return false;
    },
  );
  return loading;
}

/** Нужна ли полка: есть ли среди имён вещь полки. */
export function needsSand3d(names: Iterable<string>): boolean {
  for (const n of names) if (isSand3d(n)) return true;
  return false;
}
