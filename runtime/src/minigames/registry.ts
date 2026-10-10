/** Реестр типов мини-игр: type из episode.minigames[*].type → фабрика реализации. */
import { GreyBoxMinigame } from './grey_box';
import type { IMinigame, MinigameFactory } from './types';

/** Типы с grey-box реализацией в вертикальном срезе (схемы конфигов — schemas/minigames/). */
export const GREY_BOX_TYPES = [
  'crime_scene_search',
  'document_check',
  'database_search',
  'evidence_board',
  'interrogation_press',
] as const;

const registry = new Map<string, MinigameFactory>();

export function registerMinigame(type: string, factory: MinigameFactory): void {
  registry.set(type, factory);
}

export function hasMinigame(type: string): boolean {
  return registry.has(type);
}

export function registeredTypes(): string[] {
  return [...registry.keys()].sort();
}

/**
 * Создать мини-игру по типу. Тип без реализации (deduction_fill, identikit, custom …) получает
 * grey-box: эпизод остаётся проходимым, а пропуск и исходы работают как у настоящих.
 */
export function createMinigame(type: string): IMinigame {
  const factory = registry.get(type);
  return factory ? factory() : new GreyBoxMinigame(type);
}

/** Зарегистрировать встроенные реализации. Вызывать один раз при старте. */
export function registerBuiltinMinigames(): void {
  for (const type of GREY_BOX_TYPES) registerMinigame(type, () => new GreyBoxMinigame(type));
}
