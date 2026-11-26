/**
 * Сводка производительности `performance_sample` (руководство Playgama по телеметрии, контракт события).
 * Кадры считаются в самой игре и только пока идёт игра: сессия, без паузы, вкладка видна. Раз в ~30 с игры
 * уходит одна сводка — не событие на кадр. Загрузка, заставка, лимбо, пауза и скрытая вкладка в окно не
 * входят, и промежуток после них не становится «замёрзшим кадром». Счётчики ошибок — за окно, не за всё время.
 * Чистая логика: время кадров приходит снаружи (analytics/events.ts), здесь только счёт.
 */

export const PERF = {
  /** Сколько игры собирать в одно окно, мс. */
  windowMs: 30_000,
  /** Остаток окна в конце сессии короче этого не отправляется, а копится дальше, мс. */
  minFlushMs: 10_000,
  /** Частота кадров, на которую рассчитана игра. */
  targetFps: 60,
  /** Пороги долгих кадров, мс. */
  over: [50, 100, 250, 500, 1000],
} as const;

/** Счётчики событий за окно. Сообщений, адресов и стеков нет — только сколько раз. */
export type PerfCounter = 'js_error_count' | 'unhandled_rejection_count' | 'webgl_context_loss_count';

export type PerfSample = Record<string, number>;

const COUNTERS: readonly PerfCounter[] = ['js_error_count', 'unhandled_rejection_count', 'webgl_context_loss_count'];
const r1 = (x: number): number => Math.round(x * 10) / 10;

export class PerfWindow {
  private times: number[] = [];
  private active = 0;
  /** Начало окна по часам страницы, мс (−1 — окно ещё не началось). */
  private start = -1;
  /** Прошлый кадр игры, мс (−1 — был перерыв: следующий кадр промежутка не считает). */
  private last = -1;
  private counters = new Map<PerfCounter, number>();

  /** Кадр. playing — идёт игра. Возвращает сводку, когда окно набрало windowMs игры. */
  frame(now: number, playing: boolean): PerfSample | null {
    if (!playing) {
      this.last = -1;
      return null;
    }
    if (this.start < 0) this.start = now;
    if (this.last >= 0 && now > this.last) {
      const dt = now - this.last;
      this.times.push(dt);
      this.active += dt;
    }
    this.last = now;
    return this.active >= PERF.windowMs ? this.take(now) : null;
  }

  /** Перерыв (пауза, скрытая вкладка): время до следующего кадра в окно не идёт. */
  gap(): void {
    this.last = -1;
  }

  count(what: PerfCounter): void {
    this.counters.set(what, (this.counters.get(what) ?? 0) + 1);
  }

  /** Конец сессии: отправить окно досрочно, если игры в нём набралось хотя бы minFlushMs. */
  flush(now: number): PerfSample | null {
    this.last = -1;
    return this.active >= PERF.minFlushMs ? this.take(now) : null;
  }

  /** Сколько игры уже в окне, мс (для проверок). */
  get activeMs(): number {
    return this.active;
  }

  private take(now: number): PerfSample {
    const t = this.times.sort((a, b) => a - b);
    const n = t.length;
    // Перцентиль по рангу: значение, ниже или равно которому доля p кадров.
    const q = (p: number): number => t[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))] ?? 0;
    const sample: PerfSample = {
      target_fps: PERF.targetFps,
      window_ms: Math.round(now - this.start),
      active_ms: Math.round(this.active),
      frame_count: n,
      fps_avg: r1((n * 1000) / this.active),
      // 10-й перцентиль частоты кадров — это 90-й перцентиль времени кадра.
      fps_p10: r1(1000 / q(0.9)),
      frame_time_p50_ms: r1(q(0.5)),
      frame_time_p95_ms: r1(q(0.95)),
      frame_time_p99_ms: r1(q(0.99)),
      frame_time_max_ms: r1(t[n - 1] ?? 0),
    };
    for (const ms of PERF.over) sample[`frames_over_${ms}ms`] = countAbove(t, ms);
    for (const c of COUNTERS) sample[c] = this.counters.get(c) ?? 0;
    this.times = [];
    this.active = 0;
    this.start = -1;
    this.counters.clear();
    return sample;
  }
}

/** Сколько значений отсортированного массива строго больше x. */
function countAbove(sorted: readonly number[], x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return sorted.length - lo;
}
