/**
 * Пресеты показа (`block.presentation`): фильтр сцены, раскладка текста, поведение камеры.
 * Таблица, а не код сцен: художник и сценарист меняют режим блоком
 * (docs/architecture/03-visual-language.md §2, 06 §5).
 */
import type { Presentation, StageFilter, ViewState } from '../core/types';

/** Как показывать текст: окно внизу, субтитры по центру или не показывать окно вовсе. */
export type TextLayout = 'window' | 'subtitle' | 'none';
export type CameraMode = 'static' | 'ken_burns';

export interface PresentationPreset {
  /** Фильтр по умолчанию, если сцена не задала `stage.filter`. */
  filter: StageFilter;
  text: TextLayout;
  /** Показывать имя говорящего в окне (в talking_head его заменяет lower_third). */
  speakerName: boolean;
  camera: CameraMode;
  /** Боковая панель «папка дела» (procedural) — пока не реализована, флаг для будущей панели. */
  casePanel: boolean;
  /**
   * Дрожание ручной камеры (камкордер, stage/camcorder.ts): 1 — ручная съёмка реконструкции,
   * 0 — штатив (хроника, заставка, карта, документ, суд). Решение владельца 2026-10-10.
   */
  handheld: number;
  /** «Оператор поправил кадр» при входе в сцену (быстрый сдвиг, иногда неожиданный ракурс). */
  reframe: boolean;
  /** Камкордерный HUD: красная точка и REC в углу кадра (только в реконструкции). */
  recHud: boolean;
}

export const PRESETS: Readonly<Record<Presentation, PresentationPreset>> = {
  title: { filter: 'none', text: 'none', speakerName: false, camera: 'static', casePanel: false, handheld: 0, reframe: false, recHud: false },
  reconstruction: { filter: 'vhs', text: 'window', speakerName: true, camera: 'static', casePanel: false, handheld: 1, reframe: true, recHud: true },
  chronicle: { filter: 'archive_photo', text: 'subtitle', speakerName: false, camera: 'ken_burns', casePanel: false, handheld: 0, reframe: false, recHud: false },
  talking_head: { filter: 'vhs', text: 'window', speakerName: false, camera: 'static', casePanel: false, handheld: 0.25, reframe: false, recHud: false },
  procedural: { filter: 'none', text: 'window', speakerName: true, camera: 'static', casePanel: true, handheld: 0.5, reframe: true, recHud: false },
  map: { filter: 'sepia', text: 'window', speakerName: true, camera: 'static', casePanel: false, handheld: 0, reframe: false, recHud: false },
  courtroom: { filter: 'desaturated', text: 'subtitle', speakerName: false, camera: 'static', casePanel: false, handheld: 0, reframe: false, recHud: false },
  montage: { filter: 'archive_photo', text: 'subtitle', speakerName: false, camera: 'static', casePanel: false, handheld: 0.5, reframe: false, recHud: false },
  document: { filter: 'none', text: 'none', speakerName: false, camera: 'static', casePanel: false, handheld: 0, reframe: false, recHud: false },
};

export function presetOf(presentation: Presentation): PresentationPreset {
  return PRESETS[presentation];
}

/** Фильтр кадра: явный `stage.filter` сцены, иначе умолчание пресета. */
export function effectiveFilter(view: Pick<ViewState, 'filter' | 'presentation'>): StageFilter {
  return view.filter ?? PRESETS[view.presentation].filter;
}
