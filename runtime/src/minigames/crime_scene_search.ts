/**
 * Осмотр места (crime_scene_search) — настоящая механика пока не реализована: файл-заглушка возвращает grey-box.
 * Реализация заменяет содержимое ЭТОГО файла (экспорт `createCrimeSceneSearch` обязателен), registry.ts не трогать.
 */
import { GreyBoxMinigame } from './grey_box';
import type { IMinigame } from './types';

export const TYPE = 'crime_scene_search' as const;

export function createCrimeSceneSearch(): IMinigame {
  return new GreyBoxMinigame(TYPE);
}
