/**
 * Обратный отсчёт мини-игры (общий для evidence_board и interrogation_press).
 *
 * Считает по часам (Date.now), а не по числу тиков: лаг не «растягивает» время. Один тик не
 * списывает больше MAX_STEP_MS — если страницу заморозили без pause() (вкладка в фоне, сон
 * устройства), игрок не теряет время, которого не видел. pause()/resume() замораживают остаток;
 * остаток отдаётся для автосейва (serialize) и возвращается через setRemaining (restore).
 */

/** Максимум, который может списать один тик. */
export const MAX_STEP_MS = 1000;

export class Countdown {
  private left: number;
  private last = 0;
  private handle: ReturnType<typeof setInterval> | null = null;
  private expired = false;

  constructor(
    totalMs: number,
    private readonly onExpire: () => void,
    private readonly onTick: (leftMs: number) => void = () => undefined,
    private readonly stepMs = 200,
  ) {
    this.left = Math.max(0, Math.floor(totalMs));
  }

  get running(): boolean {
    return this.handle !== null;
  }

  /** Время вышло (onExpire уже вызван). */
  get done(): boolean {
    return this.expired;
  }

  /** Остаток в мс на сейчас (для работающего таймера — с учётом прошедшего с последнего тика). */
  get remainingMs(): number {
    return this.handle === null ? this.left : Math.max(0, this.left - this.sinceLast());
  }

  /** Подменить остаток (restore из сейва). Не запускает и не останавливает таймер. */
  setRemaining(ms: number): void {
    this.left = Math.max(0, Math.floor(ms));
    this.last = Date.now();
    if (this.left > 0) this.expired = false;
  }

  start(): void {
    if (this.handle !== null || this.expired) return;
    this.last = Date.now();
    this.handle = setInterval(() => this.tick(), this.stepMs);
  }

  pause(): void {
    if (this.handle === null) return;
    this.left = this.remainingMs;
    clearInterval(this.handle);
    this.handle = null;
  }

  /** Остановить насовсем: onExpire не вызовется. */
  stop(): void {
    this.pause();
    this.expired = true;
  }

  private sinceLast(): number {
    return Math.min(Math.max(Date.now() - this.last, 0), MAX_STEP_MS);
  }

  private tick(): void {
    const now = Date.now();
    this.left = Math.max(0, this.left - Math.min(Math.max(now - this.last, 0), MAX_STEP_MS));
    this.last = now;
    this.onTick(this.left);
    if (this.left > 0) return;
    if (this.handle !== null) clearInterval(this.handle);
    this.handle = null;
    this.expired = true;
    this.onExpire();
  }
}

/** «м:сс» для подписи оставшегося времени (округление вверх: 0:00 только когда время вышло). */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
