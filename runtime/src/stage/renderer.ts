/**
 * Рендерер плейсхолдеров сцены. Две реализации: PixiJS (основная, WebGL) и DOM
 * (резерв, если WebGL недоступен). Оболочка Stage (stage.ts) не зависит от того, чем рисуется кадр.
 */
import type { ViolenceMode } from '../core/settings';
import type { SpriteView, TransitionKind, ViewState } from '../core/types';

export interface ISceneRenderer {
  readonly kind: 'pixi' | 'dom';
  mount(host: HTMLElement): Promise<void>;
  /** Нарисовать кадр целиком (фон, спрайты, CG, говорящий). */
  setView(view: ViewState): void;
  setBackground(bg: string): void;
  setCg(cg: string | null): void;
  showSprite(sprite: SpriteView, existing: boolean, transition: TransitionKind): void;
  hideSprite(who: string, transition: TransitionKind): void;
  setSpeaker(who: string | null): void;
  setViolenceMode(mode: ViolenceMode): void;
  /** Корневой контейнер PixiJS для мини-игр (IMinigame.mount.root); у DOM-рендерера его нет. */
  readonly minigameRoot?: unknown;
  /** Показать/скрыть слой мини-игр. */
  setMinigameActive?(active: boolean): void;
  destroy(): void;
}

/** Доли ширины сцены, на которых стоят центры спрайтов (для offscreen-позиций не используется). */
export const POSITION_X: Readonly<Record<SpriteView['position'], number>> = {
  left: 0.22,
  center: 0.5,
  right: 0.78,
  offscreen_left: -0.3,
  offscreen_right: 1.3,
};

/**
 * Контракт позиций `offscreen_left` / `offscreen_right`: это голос за кадром (например, раненый
 * Сайко звонит из больницы). Спрайт с такой позицией на сцене НЕ рисуется — ни плейсхолдер,
 * ни реальный арт, — но запись остаётся в `view.sprites`, а имя говорящего и реплика
 * показываются интерфейсом как обычно. Любой рендерер обязан пропускать такие спрайты.
 * Говорящий за кадром не затемняет тех, кто на сцене: подсвечивать некого.
 */
export function isOffscreen(position: SpriteView['position']): boolean {
  return position === 'offscreen_left' || position === 'offscreen_right';
}
