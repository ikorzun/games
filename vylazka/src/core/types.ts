/** Общие типы ядра. */

/** Языки интерфейса. ru — источник, en — обязательный; es/pt добавятся после заморозки текста. */
export const LANGS = ['ru', 'en'] as const;
export type Lang = (typeof LANGS)[number];

export type Vec3 = [number, number, number];
