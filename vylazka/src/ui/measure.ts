/**
 * Замер из настроек («Замер 30 с»): партнёр играет на iPhone в странице claude.ai и не может дописать к адресу `?fps=1` или
 * `#fps`. Пункт в списке настроек закрывает список и пускает игру дальше; 30 с настоящей игры (пауза не в счёт) игра собирает
 * время кадров, потом ~20 с в углу HUD, где строка счётчика кадров, стоит итог: средняя частота, «1 % худших», качество,
 * размер кадра, вызовы отрисовки и треугольники. Итог пишется и в консоль; последний помнится до перезагрузки — под подписью
 * пункта. Никуда не сохраняется (на Playgama мимо Bridge игра ничего не пишет, пункт 3.2.1).
 *
 * Здесь — чистая часть: счёт по списку времён кадров и сам счётчик. Склейка с игрой — в app.ts (measureTick, measureText).
 */

/** Сколько секунд игры мерить и сколько секунд показывать итог. */
export const MEASURE = { span: 30, show: 20 } as const;

/**
 * Кадр длиннее этого, мс, — не заминка игры, а остановка страницы (вкладку прятали, телефон гасил экран): в замер не идёт.
 * Заминки в секунду-другую (сборка шейдера на входе в новое место) — идут: их партнёр и видит. Порог с запасом: в программном
 * рендере контейнера кадр «высокого» идёт 2–4 с, и при пороге 2 с замер там не кончался.
 */
const GAP_MS = 5000;

export interface FrameStats {
  /** Кадров в замере. */
  frames: number;
  /** Сколько секунд они заняли. */
  seconds: number;
  /** Средняя частота: кадров за секунду замера. */
  avg: number;
  /** «1 % худших»: частота, если бы все кадры были как самый медленный процент (не меньше одного кадра). */
  low1: number;
}

/** Средняя частота и «1 % худших» по временам кадров, мс. Пустой список — нули. */
export function frameStats(ms: readonly number[]): FrameStats {
  const list = ms.filter((x) => x > 0 && Number.isFinite(x));
  const n = list.length;
  if (n === 0) return { frames: 0, seconds: 0, avg: 0, low1: 0 };
  const sum = list.reduce((a, b) => a + b, 0);
  const slow = list.sort((a, b) => b - a).slice(0, Math.max(1, Math.ceil(n * 0.01)));
  const slowMs = slow.reduce((a, b) => a + b, 0) / slow.length;
  return { frames: n, seconds: sum / 1000, avg: (n * 1000) / sum, low1: 1000 / slowMs };
}

/** Итог замера: частоты и средняя нагрузка кадра за время замера. */
export interface MeasureResult extends FrameStats {
  /** Вызовов отрисовки на кадр, в среднем. */
  calls: number;
  /** Треугольников на кадр, в среднем. */
  triangles: number;
}

/** Счётчик замера: start — пошёл; frame — кадр игры; load — нагрузка кадра (раз в полсекунды хватает). */
export class FrameMeter {
  private ms: number[] = [];
  private total = 0;
  private on = false;
  private calls = 0;
  private tris = 0;
  private loads = 0;

  constructor(readonly span: number = MEASURE.span) {}

  /** Идёт ли замер. */
  get running(): boolean {
    return this.on;
  }

  /** Сколько секунд замера осталось. */
  get left(): number {
    return Math.max(0, this.span - this.total / 1000);
  }

  /** Начать заново (идущий замер начинается сначала). */
  start(): void {
    this.ms = [];
    this.total = 0;
    this.calls = 0;
    this.tris = 0;
    this.loads = 0;
    this.on = true;
  }

  /** Нагрузка кадра: вызовы отрисовки и треугольники. */
  load(calls: number, triangles: number): void {
    if (!this.on) return;
    this.calls += calls;
    this.tris += triangles;
    this.loads += 1;
  }

  /** Кадр игры длиной ms. Набралось span секунд — замер кончился: итог (один раз), иначе null. */
  frame(ms: number): MeasureResult | null {
    if (!this.on || !(ms > 0) || ms > GAP_MS) return null;
    this.ms.push(ms);
    this.total += ms;
    if (this.total < this.span * 1000) return null;
    this.on = false;
    const k = Math.max(1, this.loads);
    return { ...frameStats(this.ms), calls: this.calls / k, triangles: this.tris / k };
  }
}
