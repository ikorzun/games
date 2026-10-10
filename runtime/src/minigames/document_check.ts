/**
 * Сверка документов (document_check) — настоящая механика пока не реализована: файл-заглушка возвращает grey-box.
 * Реализация заменяет содержимое ЭТОГО файла (экспорт `createDocumentCheck` обязателен), registry.ts не трогать.
 */
import { GreyBoxMinigame } from './grey_box';
import type { IMinigame } from './types';

export const TYPE = 'document_check' as const;

export function createDocumentCheck(): IMinigame {
  return new GreyBoxMinigame(TYPE);
}
