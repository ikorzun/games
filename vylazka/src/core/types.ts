/** Общие типы ядра. */

/**
 * Языки интерфейса. en — источник (Untitled Session пишется сначала по-английски), ru — перевод, es — нейтральный
 * латиноамериканский (es-419, слова партнёра 21.11: «Добавь испанский язык в игру»); pt — позже.
 */
export const LANGS = ['ru', 'en', 'es'] as const;
export type Lang = (typeof LANGS)[number];

export type Vec3 = [number, number, number];
