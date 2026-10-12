/**
 * Интерфейсы презентационного слоя. Интерпретатор отдаёт события (EngineEvent), Director
 * превращает их в вызовы этих портов. Реализации — DOM/PixiJS (stage.ts, audio.ts, ui/*) и
 * заглушки в тестах, поэтому весь порядок действий проверяется без браузера.
 */
import type { EngineEvent, FxKind, SpriteView, StageFilter, TransitionKind, ViewState } from '../core/types';

export type AudioEventPayload = Extract<EngineEvent, { t: 'audio' }>;
export type CaptionEventPayload = Extract<EngineEvent, { t: 'caption' }>;

/** Сцена: всё, что рисуется под текстовым окном. Все переходы — CSS-анимации оболочки. */
export interface IStage {
  /** Мгновенно выставить кадр целиком (загрузка сейва, откат). Снимает удержание чёрного. */
  setView(view: ViewState): void;
  /** Обычный переход между сценами: гашение → смена кадра → проявление. */
  changeScene(view: ViewState, transition: TransitionKind, instant: boolean): Promise<void>;
  /**
   * Первая половина перехода на границе блока перед рекламой: старый кадр гаснет в чёрный и
   * чёрный экран УДЕРЖИВАЕТСЯ, пока не вызван revealFromBlack().
   */
  fadeToBlackAndHold(transition: TransitionKind, instant: boolean): Promise<void>;
  /** Вторая половина: под чёрным выставить новую сцену и проявить её. */
  revealFromBlack(view: ViewState, transition: TransitionKind, instant: boolean): Promise<void>;
  showSprite(sprite: SpriteView, existing: boolean, transition: TransitionKind, instant: boolean): void;
  hideSprite(who: string, transition: TransitionKind, instant: boolean): void;
  changeBackground(bg: string, filter: StageFilter | null, transition: TransitionKind, instant: boolean): Promise<void>;
  showCg(cg: string, transition: TransitionKind, instant: boolean): Promise<void>;
  hideCg(transition: TransitionKind, instant: boolean): Promise<void>;
  /** Кадр покрытия поверх фона и спрайтов (null — убрать, остаются фон и спрайты). */
  showShot(shot: string | null, transition: TransitionKind, instant: boolean): Promise<void>;
  setSpeaker(who: string | null): void;
  /** Эффект fx на ms миллисекунд; резолвится по окончании. */
  playFx(fx: FxKind, ms: number, intensity: number, instant: boolean): Promise<void>;
}

export interface IAudioSink {
  handle(ev: AudioEventPayload): void;
  /** После загрузки/отката: привести звук в соответствие с кадром (что должно играть сейчас). */
  sync(music: string | null, ambient: string | null): void;
}

export interface ICaptionSink {
  /** Неблокирующий титр поверх сцены (date_stamp / location / lower_third). */
  show(ev: CaptionEventPayload): void;
  clear(): void;
}

export interface IToastSink {
  archive(item: string): void;
}
