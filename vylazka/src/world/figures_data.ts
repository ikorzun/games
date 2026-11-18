/**
 * Фигуры партнёра, которые стоят в игре. Партнёр гнёт и ставит их сам в конструкторе (tools/constructor;
 * его слова: «Не расставляй фигуры, я сам это сделаю»), инструмент сохраняет их в свою базу, а основная
 * модель переносит сохранённое сюда, проверив figureProblems (world/figures.ts). Своих фигур основная
 * модель сюда не добавляет.
 *
 * Убрать фигуру можно в конструкторе (кнопка «Удалить» у сохранённой): при следующем переносе она уйдёт и отсюда.
 * Посмотреть, как фигура живёт в игре, можно отладкой: __vz.figure(…) (debug/debug.ts).
 */
import type { FigureSpec } from './figures';

/**
 * Перенесено 18.11 из базы конструктора: фигуры партнёра 17.11, 21:34–21:38 — деревянная в углу кухни убежища и дымная,
 * висящая на полметра над полом посреди архива.
 */
export const FIGURES: readonly FigureSpec[] = [
  {"id": "fig_mwl7mr8r2", "material": "wood", "name": "Фигура 1", "offset": [0.48, 0.44], "pose": {"armL": {"bend": 10, "fwd": 4, "out": 7}, "armR": {"bend": 12, "fwd": 2, "out": 7}, "head": {"pitch": 4, "yaw": 0}, "legL": {"bend": 0, "fwd": 1, "out": 3}, "legR": {"bend": 2, "fwd": -1, "out": 3}, "pelvis": {"pitch": 0}, "spine": 2}, "rule": {"anchor": "corner", "count": 1, "facing": "room", "lift": 0, "rooms": ["kitchen"], "worlds": ["shelter"]}, "yaw": 165},
  {"id": "fig_mwl7nub64", "material": "smoke", "name": "Фигура 2", "offset": [1.27, 0.56], "pose": {"armL": {"bend": 57.69313720624109, "fwd": -33.67803739996751, "out": 46.72123843513347}, "armR": {"bend": 2.1997510974842953, "fwd": 57.77190758185437, "out": 175}, "head": {"pitch": 14.0364354450166, "yaw": 85}, "legL": {"bend": 55.99059241770986, "fwd": 17.597327299127457, "out": 7.241916336813661}, "legR": {"bend": 2, "fwd": -1, "out": 3}, "pelvis": {"pitch": 0}, "spine": 85, "twist": 0}, "rule": {"anchor": "middle", "count": 1, "facing": "room", "lift": 0.5, "rooms": ["archive"], "worlds": ["shelter"]}, "yaw": 7},
];
