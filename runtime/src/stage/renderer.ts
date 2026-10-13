/**
 * Рендерер кадра сцены: настоящие картинки из ассетов эпизода, а при отсутствии файла — плейсхолдер.
 * Две реализации: PixiJS (основная, WebGL) и DOM (резерв, если WebGL недоступен). Оболочка Stage
 * (stage.ts) не зависит от того, чем рисуется кадр.
 */
import type { CamFrame, SignalProfile } from './camcorder';
import type { ViolenceMode } from '../core/settings';
import type { SpriteView, TransitionKind, ViewState, SpriteFacing } from '../core/types';

/** Что нарисовано в слоте: картинка из файла, плейсхолдер (файла нет), сплошной цвет, идёт загрузка, слот пуст. */
export type SlotState = 'none' | 'loading' | 'image' | 'placeholder' | 'solid';

export interface SlotStates {
  bg: SlotState;
  /** id фона, который показывает слот (то, что передали в setBackground). */
  bgId: string;
  cg: SlotState;
  cgId: string | null;
  /** Кадр покрытия: image — показан вместо спрайтов; placeholder — файла нет, видны спрайты (запасной вариант). */
  shot: SlotState;
  shotId: string | null;
  /** Подсветка: на ком внимание и есть ли у него маска на этом кадре (image) — только у PixiJS. */
  focus?: { who: string | null; mask: SlotState };
  /** who → состояние спрайта (ушедшие и закадровые не входят). */
  sprites: Record<string, SlotState>;
}

export interface ISceneRenderer {
  readonly kind: 'pixi' | 'dom';
  mount(host: HTMLElement): Promise<void>;
  /** Нарисовать кадр целиком (фон, спрайты, CG, говорящий). */
  setView(view: ViewState): void;
  setBackground(bg: string): void;
  setCg(cg: string | null): void;
  /**
   * Кадр покрытия (assets.shots): показывается поверх фона вместо спрайтов, под CG. Пока картинка грузится —
   * прежний кадр; если файла нет — спрайты (запасной вариант 08 §4.9). null — убрать.
   */
  setShot(shot: string | null): void;
  showSprite(sprite: SpriteView, existing: boolean, transition: TransitionKind): void;
  hideSprite(who: string, transition: TransitionKind): void;
  setSpeaker(who: string | null): void;
  setViolenceMode(mode: ViolenceMode): void;
  /** Для QA и тестов (`__vn.slots()`): что сейчас нарисовано в слотах фона, CG и спрайтов. */
  slotStates?(): SlotStates;
  /** Корневой контейнер PixiJS для мини-игр (IMinigame.mount.root); у DOM-рендерера его нет. */
  readonly minigameRoot?: unknown;
  /** Показать/скрыть слой мини-игр. */
  setMinigameActive?(active: boolean): void;
  /**
   * Камкордер на видеокарте (PixiJS): движение камеры и искажения записи шейдером на всём кадре. false — не умеет
   * (DOM-рендерер, шейдер не собрался): камкордер двигает холст CSS-трансформацией и рисует помехи на своём холсте.
   */
  camera?(frame: CamFrame, signal: SignalProfile, timeMs: number): boolean;
  /** Снять камкордер с кадра. */
  cameraOff?(): void;
  /**
   * Настоящее растворение (PixiJS): снимок текущего кадра гаснет за ms поверх следующего. false — не умеет
   * (DOM-рендерер): Stage делает «нырок» в полутень.
   */
  crossfade?(ms: number): boolean;
  /**
   * На ком внимание (говорит или его ждут): по маске на кадре покрытия окружение гаснет, по краю силуэта — контровой
   * свет; смена — плавная. null или нет маски — без подсветки. Только PixiJS.
   */
  setFocus?(who: string | null): void;
  destroy(): void;
}

/**
 * Размер настоящих спрайтов: рост ≈ высота сцены (доля высоты кадра), но не шире этой доли ширины
 * (на узком портретном кадре три персонажа не вылезают за края). Плейсхолдеры остаются меньше.
 */
export const SPRITE_FIT = 0.96;
export const SPRITE_MAX_WIDTH = 0.46;
/** Прозрачность силуэта, который рантайм делает из обычного кадра (brightness(0) + opacity). */
export const SILHOUETTE_ALPHA = 0.85;

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

/**
 * Поворот к собеседнику (решение владельца 2026-10-11): когда на сцене двое и больше, стоящий слева смотрит
 * вправо, стоящий справа — влево (к центру); один персонаж остаётся как нарисован — к игроку. Спрайт
 * зеркалится, если его исходный поворот (`facing` набора) не совпадает с нужным; `front` не зеркалится.
 */
export function wantFlip(position: SpriteView['position'], facing: SpriteFacing, visibleCount: number): boolean {
  if (visibleCount < 2 || facing === 'front') return false;
  const toward = position === 'left' ? 'right' : position === 'right' ? 'left' : null;
  return toward !== null && toward !== facing;
}
