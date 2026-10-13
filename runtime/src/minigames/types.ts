/**
 * Контракт мини-игр (docs/architecture/06-engine-and-pipeline.md §5, 04-minigames.md §5).
 * Тип реализуется один раз; эпизод задаёт только `config` по schemas/minigames/<type>.schema.json.
 * Результат маппится в outcomes эпизода; `skipped` — в skip.skip_counts_as (это делает интерпретатор).
 */
import type { Container } from 'pixi.js';
import type { Params } from '../core/i18n';
import type { Episode, Lang, MinigameDef, MinigameResult, Value } from '../core/types';

export type MinigameConfig = Record<string, unknown>;

export interface GameContext {
  episode: Episode;
  def: MinigameDef;
  lang: Lang;
  /** Локализация: lang → en → ru → [key]. */
  t(key: string, params?: Params): string;
  /** Переменные эпизода для `requires` (интерпретатор отдаёт актуальный снимок при каждом вызове). */
  vars(): Readonly<Record<string, Value>>;
  /** Настройки доступности: таймеры выкл., режим «только история»; графика — для картинок мини-игры. */
  settings: { timers: boolean; storyOnly: boolean; graphics?: 'real' | 'memory' };
  /** Бриф шага minigame (intro_key), если задан. */
  introKey: string | null;
  /** Rewarded-реклама ради подсказки (skip.hint_rewarded_ad); undefined — платформа не поддерживает. */
  showRewarded?: () => Promise<boolean>;
  /** Телеметрия: minigame_* и произвольные события. */
  track(event: string, data?: Record<string, string | number | boolean>): void;
  /** Попросить автосейв после «хода» (найденная точка, проведённая связь): поворот экрана и реклама не сбросят прогресс. */
  autosave(): void;
  /** Подписка на смену языка (перерисовать подписи). Возвращает отписку. */
  onLanguageChange(cb: () => void): () => void;
}

export interface IMinigame {
  /**
   * root — контейнер PixiJS поверх сцены (для мини-игр с графикой), dom — DOM-контейнер экрана
   * мини-игры (текст и кнопки: DOM, не canvas).
   */
  mount(root: Container, dom: HTMLElement, cfg: MinigameConfig, ctx: GameContext): void;
  /** Реклама, уход вкладки в фон (Bridge PAUSE_STATE_CHANGED): остановить таймеры. */
  pause(): void;
  resume(): void;
  /** Состояние для автосейва внутри мини-игры. */
  serialize(): unknown;
  restore(state: unknown): void;
  /** Назначается рантаймом до mount(); мини-игра вызывает ровно один раз. */
  onResult: (result: MinigameResult) => void;
  destroy(): void;
}

export type MinigameFactory = () => IMinigame;
