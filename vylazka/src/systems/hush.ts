/**
 * Тишина как знак (Z-19, приём 2; куратор, пачка 55): за полторы-две секунды до явления Осыпи звук места проседает почти в ноль —
 * гул, разговор за стеной, далёкие голоса, — потом она. Один раз за сон, в мёртвом отрезке, — такая же тишина без неё: «тишина —
 * это она» выучено на первом явлении, и ложная тишина потом страшнее пугалки (пробел ожидания).
 *
 * От мига (K-12: обрыв записи, чернота, часы на нуле) тишина отличается — плавно и без черноты. Капли не молчат: совсем пустой
 * звук читался бы поломкой (S-06, «звук не срабатывает сразу»). Новых звуков нет — тишина делается из того, что уже звучит
 * (audio/game_audio.ts). Чистая логика: игра даёт время до явления и покой, звук берёт уровень.
 */

export const HUSH = {
  /** За сколько секунд до явления звук начинает проседать: к явлению он почти в нуле. */
  lead: 1.8,
  /** Сколько тишина держится после явления, прежде чем звук начнёт возвращаться, с. */
  holdAfter: 1.2,
  /** За сколько секунд звук возвращается. */
  release: 3.5,
  /**
   * Дольше этого тишина явления не ждёт, с: его не удалось поставить (игрок в тесной комнате — режиссёр пробует снова через
   * пару секунд). Иначе место молчало бы, пока Осыпи негде встать.
   */
  maxWait: 4,
  /** Ложная тишина — не раньше стольких секунд после первого явления, и ещё до falseSpread сверху. */
  falseAfter: 30,
  falseSpread: 60,
  /** Ложная тишина держится столько секунд, прежде чем звук начнёт возвращаться. */
  falseHold: 2.6,
  /** Ложной тишине нужен покой: ближайшее явление — не раньше чем через столько секунд. */
  falseClear: 15,
  /** И покой уже столько секунд: сразу после охоты тишина читалась бы её хвостом, а не знаком. */
  falseQuiet: 10,
  /** Не вышло (нет покоя) — следующая попытка через столько секунд. */
  falseRetry: 8,
} as const;

export interface HushInput {
  /** Часы сна, с. */
  time: number;
  dt: number;
  /** Сколько секунд до явления, которое режиссёр уже назначил; Infinity — не назначено или Осыпи сейчас не до него. */
  glimpseIn: number;
  /** Явление случилось в этом шаге. */
  appeared: boolean;
  /** Мёртвый отрезок: игрок в месте, не в скачке, Осыпь не охотится и не стоит фигурой. */
  calm: boolean;
}

/** Плавный подъём 0..1. */
const smooth = (x: number): number => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

export class Hush {
  /** Насколько звук места сейчас проседает, 0..1. */
  level = 0;
  /** Когда началось ожидание назначенного явления (часы сна); −1 — не ждём. */
  private waitFrom = -1;
  /** Ожидание этого явления уже истекло (maxWait): до самого явления — без тишины. */
  private spent = false;
  /** Сколько секунд тишина ещё держится после явления. */
  private after = 0;
  private falseAt = Infinity;
  /** Ложная тишина идёт столько секунд; −1 — не идёт. */
  private falseT = -1;
  private falseDone = false;
  /** Сколько секунд подряд длится покой. */
  private quietFor = 0;

  /** jitter — 0..1, разброс времени ложной тишины (из сида сна: ГСЧ игры не трогаем — от него зависят уровни). */
  constructor(private readonly jitter: number) {}

  /** Ложная тишина в этом сне уже была. */
  get falseSpent(): boolean {
    return this.falseDone;
  }

  update(inp: HushInput): number {
    const g = inp.glimpseIn;
    this.quietFor = inp.calm ? this.quietFor + inp.dt : 0;
    let want = 0;
    if (inp.appeared) {
      this.after = HUSH.holdAfter;
      this.waitFrom = -1;
      this.spent = false;
      if (!this.falseDone && this.falseAt === Infinity) this.falseAt = inp.time + HUSH.falseAfter + this.jitter * HUSH.falseSpread;
    }
    if (this.after > 0) {
      this.after -= inp.dt;
      want = 1;
    } else if (g <= HUSH.lead && !this.spent) {
      // Тишина растёт от начала ожидания: обычно оно начинается за lead секунд, и к явлению звук почти в нуле. Если явление
      // откладывается (не нашлось места), тишина держится — но не дольше maxWait.
      if (this.waitFrom < 0) this.waitFrom = inp.time;
      if (inp.time - this.waitFrom > HUSH.maxWait) {
        this.spent = true;
        this.waitFrom = -1;
      } else want = smooth((inp.time - this.waitFrom) / HUSH.lead);
    } else if (g > HUSH.lead + 2.5) {
      // Явление назначено заново и не скоро: ждём его с чистого листа. Повтор через пару секунд (не нашлось места) сюда не
      // попадает — иначе тишина накатывала бы каждые две секунды.
      this.waitFrom = -1;
      this.spent = false;
    }
    // Ложная тишина: один раз за сон, когда покой и явление не скоро.
    if (this.falseT >= 0) {
      this.falseT += inp.dt;
      if (this.falseT < HUSH.lead + HUSH.falseHold) want = Math.max(want, smooth(this.falseT / HUSH.lead));
      else this.falseT = -1;
      // Осыпь всё-таки пришла или игрок ушёл из места — ложная тишина кончается: дальше говорит настоящее.
      if (!inp.calm) this.falseT = -1;
    } else if (!this.falseDone && inp.time >= this.falseAt) {
      if (inp.calm && this.quietFor >= HUSH.falseQuiet && g > HUSH.falseClear) {
        this.falseT = 0;
        this.falseDone = true;
      } else this.falseAt = inp.time + HUSH.falseRetry;
    }
    if (want >= this.level) this.level = want;
    else this.level = Math.max(want, this.level - inp.dt / HUSH.release);
    return this.level;
  }
}
