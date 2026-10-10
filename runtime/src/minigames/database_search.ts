/**
 * Поиск по картотеке (database_search) — настоящая механика пока не реализована: файл-заглушка возвращает grey-box.
 * Реализация заменяет содержимое ЭТОГО файла (экспорт `createDatabaseSearch` обязателен), registry.ts не трогать.
 */
import { GreyBoxMinigame } from './grey_box';
import type { IMinigame } from './types';

export const TYPE = 'database_search' as const;

export function createDatabaseSearch(): IMinigame {
  return new GreyBoxMinigame(TYPE);
}
