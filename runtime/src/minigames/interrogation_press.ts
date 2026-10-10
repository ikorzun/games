/**
 * Допрос (interrogation_press) — настоящая механика пока не реализована: файл-заглушка возвращает grey-box.
 * Реализация заменяет содержимое ЭТОГО файла (экспорт `createInterrogationPress` обязателен), registry.ts не трогать.
 */
import { GreyBoxMinigame } from './grey_box';
import type { IMinigame } from './types';

export const TYPE = 'interrogation_press' as const;

export function createInterrogationPress(): IMinigame {
  return new GreyBoxMinigame(TYPE);
}
