/**
 * Фигуры партнёра, которые стоят в игре. Партнёр гнёт и ставит их сам в конструкторе (tools/constructor; его слова:
 * «Не расставляй фигуры, я сам это сделаю»). Записи лежат в world/partner/figures.json: их пишет конструктор на компьютере
 * партнёра (`npm run constructor`, в игру — `npm run constructor:push`), а сохранённое на странице конструктора в Claude
 * переносит сюда основная модель. Каждая запись проверяется тестом (tests/partner_data.test.ts, figureProblems). Своих
 * фигур основная модель сюда не добавляет. Посмотреть, как фигура живёт в игре: __vz.figure(…) (debug/debug.ts).
 */
import type { FigureSpec } from './figures';
import { isCaretakerFigure } from './figures';
import ROWS from './partner/figures.json';

export const FIGURES: readonly FigureSpec[] = ROWS as unknown as FigureSpec[];
/** Фигуры, что стоят в местах: все, кроме назначенной телом Смотрителя, — та встаёт один раз, в лимбо (world/caretaker_body.ts). */
export const PLACED_FIGURES: readonly FigureSpec[] = FIGURES.filter((f) => !isCaretakerFigure(f));
