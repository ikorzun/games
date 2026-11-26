import { describe, expect, it } from 'vitest';
import { HUSH, Hush } from '../src/systems/hush';
import type { HushInput } from '../src/systems/hush';

/**
 * Тишина как знак (Z-19, приём 2; systems/hush.ts): за полторы-две секунды до явления звук места проседает почти в ноль; один раз
 * за сон — такая же тишина без неё.
 */
const DT = 1 / 60;

/** Прогнать тишину по сценарию: glimpseAt — когда явление (часы сна), appearAt — когда оно на самом деле случилось. */
function run(h: Hush, from: number, to: number, inp: (t: number) => Partial<HushInput>): number[] {
  const out: number[] = [];
  for (let t = from; t < to; t += DT) out.push(h.update({ time: t, dt: DT, glimpseIn: Infinity, appeared: false, calm: true, ...inp(t) }));
  return out;
}

describe('тишина перед явлением', () => {
  it('звук проседает за lead секунд до явления, к явлению почти в нуле; после — держится и возвращается за release', () => {
    const h = new Hush(0.5);
    const at = 12;
    let appearedOnce = false;
    const levels = run(h, 0, 20, (t) => {
      const appeared = !appearedOnce && t >= at;
      if (appeared) appearedOnce = true;
      return { glimpseIn: appearedOnce ? 40 : at - t, appeared };
    });
    const level = (t: number): number => levels[Math.round(t / DT)]!;
    // Задолго до явления — тихо не становится.
    expect(level(at - HUSH.lead - 0.5)).toBe(0);
    // Подъём начинается за lead секунд.
    expect(level(at - HUSH.lead / 2)).toBeGreaterThan(0.2);
    expect(level(at - 0.05)).toBeGreaterThan(0.9);
    // Явление: тишина держится ещё holdAfter.
    expect(level(at + HUSH.holdAfter * 0.8)).toBeGreaterThan(0.99);
    // Потом звук возвращается — плавно, не скачком.
    const back = level(at + HUSH.holdAfter + HUSH.release / 2);
    expect(back).toBeGreaterThan(0.2);
    expect(back).toBeLessThan(0.8);
    expect(level(at + HUSH.holdAfter + HUSH.release + 0.2)).toBe(0);
  });

  it('явление откладывается (не нашлось места, повтор через пару секунд) — тишина не дольше maxWait и не накатывает снова', () => {
    const h = new Hush(0.5);
    // Явление всё время «через полторы-две секунды»: режиссёр переносит его каждые 2 с.
    const levels = run(h, 0, 20, (t) => ({ glimpseIn: 2 - (t % 2) }));
    const loudAfter = levels.slice(Math.round((HUSH.maxWait + HUSH.release + 0.5) / DT));
    expect(Math.max(...loudAfter)).toBe(0);
    // Пока ждала — была.
    expect(Math.max(...levels)).toBeGreaterThan(0.9);
  });
});

describe('ложная тишина', () => {
  it('одна за сон: после первого явления, в покое — та же тишина без неё; больше не повторяется', () => {
    const h = new Hush(0);
    // Первое явление на 12-й секунде, следующих не назначено.
    let shown = false;
    const levels = run(h, 0, 260, (t) => {
      const appeared = !shown && t >= 12;
      if (appeared) shown = true;
      return { glimpseIn: shown ? Infinity : 12 - t, appeared };
    });
    // Отрезки тишины (уровень > 0.5): первый — явление, второй — ложная.
    let runs = 0;
    let prev = false;
    for (const l of levels) {
      const on = l > 0.5;
      if (on && !prev) runs++;
      prev = on;
    }
    expect(runs).toBe(2);
    expect(h.falseSpent).toBe(true);
    // Ложная — не раньше falseAfter после явления.
    const first = levels.findIndex((l, i) => i * DT > 20 && l > 0.5) * DT;
    expect(first).toBeGreaterThanOrEqual(12 + HUSH.falseAfter);
  });

  it('без покоя ложной тишины нет: Осыпь охотится — тишина ждёт; явление скоро — тоже', () => {
    const h = new Hush(0);
    let shown = false;
    const busy = run(h, 0, 200, (t) => {
      const appeared = !shown && t >= 12;
      if (appeared) shown = true;
      return { glimpseIn: shown ? Infinity : 12 - t, appeared, calm: t < 20 };
    });
    expect(Math.max(...busy.slice(Math.round(25 / DT)))).toBe(0);
    expect(h.falseSpent).toBe(false);
    const h2 = new Hush(0);
    shown = false;
    const soon = run(h2, 0, 200, (t) => {
      const appeared = !shown && t >= 12;
      if (appeared) shown = true;
      // Следующее явление всё время «через 10 секунд» — ближе falseClear.
      return { glimpseIn: shown ? 10 : 12 - t, appeared };
    });
    expect(Math.max(...soon.slice(Math.round(25 / DT)))).toBe(0);
    expect(h2.falseSpent).toBe(false);
  });
});
