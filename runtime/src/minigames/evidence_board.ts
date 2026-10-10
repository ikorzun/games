/**
 * Доска улик (evidence_board) — настоящая механика пока не реализована: файл-заглушка возвращает grey-box.
 * Реализация заменяет содержимое ЭТОГО файла (экспорт `createEvidenceBoard` обязателен), registry.ts не трогать.
 */
import { GreyBoxMinigame } from './grey_box';
import type { IMinigame } from './types';

export const TYPE = 'evidence_board' as const;

export function createEvidenceBoard(): IMinigame {
  return new GreyBoxMinigame(TYPE);
}
