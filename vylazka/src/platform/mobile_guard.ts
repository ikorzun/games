/**
 * Браузерная обвязка для телефона: то, что забирают у игры Safari и система, и то, что им надо разрешить.
 * Основа — исследование `docs/vylazka/_research/mobile_controls.md`; слова партнёра 17.11: «Защита от свайпа нужна»,
 * «Да, звук нужен», «Рекомендации по управлению добавь».
 *
 * - Свайп от края экрана на iPhone — «назад/вперёд» в Safari: игра уходит со страницы. Гасится только не-пассивным
 *   `touchstart` с `preventDefault()` у самого края; приём хрупкий (WebKit менял жест), проверять на устройстве.
 * - Щипок: Safari с iOS 10 не слушает `user-scalable=no`; `touch-action: none` есть в стилях, `gesturestart` гасится
 *   здесь — на всякий случай.
 * - Беззвучный режим iPhone глушит Web Audio; сессия «playback» играет, как плеер.
 * - Экран не гаснет, пока идёт игра (Screen Wake Lock): игрок может долго стоять в темноте и слушать.
 *
 * Всё необязательное: где браузер этого не умеет или запрещает (iframe порталов), игра работает как раньше.
 */

/** Ширина полосы у левого и правого края экрана, где начало касания браузеру не отдаётся, пиксели CSS. */
export const EDGE_GUARD = 24;

/** Касание у края экрана: его начало не отдаём браузеру (свайп «назад/вперёд» на iPhone). */
export function nearEdge(x: number, width: number, edge = EDGE_GUARD): boolean {
  return x < edge || x > width - edge;
}

/** Цель касания — кнопка или ссылка: у них касание не трогаем, иначе пропадёт нажатие (кнопка паузы стоит у края). */
function interactive(t: EventTarget | null): boolean {
  const el = t as Element | null;
  return !!el && typeof el.closest === 'function' && el.closest('button, a, input, label, [role="button"]') !== null;
}

/**
 * Поставить защиту касаний на документ: свайп от края и щипок. Возвращает снятие. Вызывать в тач-режиме; на
 * компьютере не нужна.
 */
export function guardTouch(doc: Document = document, width: () => number = () => window.innerWidth): () => void {
  const onStart = (e: TouchEvent): void => {
    if (!e.cancelable || interactive(e.target)) return;
    const w = width();
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (nearEdge(e.changedTouches[i]!.clientX, w)) {
        e.preventDefault();
        return;
      }
    }
  };
  const onGesture = (e: Event): void => {
    if (e.cancelable) e.preventDefault();
  };
  const opts: AddEventListenerOptions = { passive: false };
  doc.addEventListener('touchstart', onStart, opts);
  doc.addEventListener('gesturestart', onGesture, opts);
  doc.addEventListener('gesturechange', onGesture, opts);
  return () => {
    doc.removeEventListener('touchstart', onStart, opts);
    doc.removeEventListener('gesturestart', onGesture, opts);
    doc.removeEventListener('gesturechange', onGesture, opts);
  };
}

interface AudioSessionLike {
  type: string;
}

/**
 * Звук и в беззвучном режиме iPhone (слова партнёра 17.11: «Да, звук нужен»): сессия «playback», как у плеера.
 * Есть в Safari 16.4+ (по другим сведениям — 17); где её нет, ничего не меняется. Ставить до первого звука.
 * Возвращает, удалось ли.
 */
export function playThroughSilentSwitch(nav: Navigator = navigator): boolean {
  const s = (nav as Navigator & { audioSession?: AudioSessionLike }).audioSession;
  if (!s) return false;
  try {
    s.type = 'playback';
    return s.type === 'playback';
  } catch {
    return false;
  }
}

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
}

interface WakeLockApi {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

/**
 * Экран не гаснет, пока идёт игра. Звать `want(on)` сколько угодно часто — запрос уходит только при перемене.
 * Браузер сам отпускает замок, когда вкладка уходит в фон; при возврате он берётся снова (`visible()`).
 */
export class ScreenAwake {
  private sentinel: WakeLockSentinelLike | null = null;
  private wanted = false;
  private pending = false;
  /** Браузер отказал (нет API, запрещено в iframe): больше не просим до перезагрузки. */
  denied = false;

  constructor(
    private readonly api: WakeLockApi | null = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock ?? null,
    /** Видна ли страница: в фоне браузер отказывает законно — это не «запрещено навсегда». */
    private readonly isVisible: () => boolean = () => typeof document === 'undefined' || document.visibilityState === 'visible',
  ) {}

  get held(): boolean {
    return !!this.sentinel && !this.sentinel.released;
  }

  want(on: boolean): void {
    if (on === this.wanted && (on ? this.held || this.pending : true)) return;
    this.wanted = on;
    if (on) this.acquire();
    else this.drop();
  }

  /** Вкладка снова видна: замок, который браузер отпустил в фоне, берём заново. */
  visible(): void {
    if (this.wanted && !this.held) this.acquire();
  }

  private acquire(): void {
    if (!this.api || this.denied || this.pending || this.held) return;
    this.pending = true;
    this.api.request('screen').then(
      (s) => {
        this.pending = false;
        this.sentinel = s;
        // Пока ждали ответа, игру поставили на паузу — отпускаем сразу.
        if (!this.wanted) this.drop();
      },
      () => {
        this.pending = false;
        if (this.isVisible()) this.denied = true;
      },
    );
  }

  private drop(): void {
    const s = this.sentinel;
    this.sentinel = null;
    if (s && !s.released) void s.release().catch(() => undefined);
  }
}

/** Через сколько миллисекунд тишины применять новый размер на телефоне (адресная строка едет плавно). */
export const RESIZE_SETTLE_MS = 160;
