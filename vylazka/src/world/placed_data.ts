/**
 * Вещи партнёра, которые стоят в игре. Партнёр ставит их сам в конструкторе (tools/constructor; его слова:
 * «Это просто конструктор, где можно перетащить вещь в пространство и поставить»). Записи лежат в файлах JSON рядом
 * (world/partner/): их пишет конструктор на компьютере партнёра (квиз 18.11: «Программа на MacBook» — `npm run constructor`,
 * в игру — `npm run constructor:push`), а то, что сохранено на странице конструктора в Claude, переносит сюда основная
 * модель. Каждая запись проверяется тестом (tests/partner_data.test.ts: placedProblems, removedProblems). Своих расстановок
 * основная модель сюда не добавляет.
 *
 * Передвинутые вещи игры — записи с полем moves; убранные — REMOVED.
 */
import type { PlacedSpec, RemovedSpec } from './placed';
import THINGS from './partner/things.json';
import GONE from './partner/removed.json';

export const PLACED: readonly PlacedSpec[] = THINGS as unknown as PlacedSpec[];
export const REMOVED: readonly RemovedSpec[] = GONE as unknown as RemovedSpec[];
