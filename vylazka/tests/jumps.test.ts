import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/core/rng';
import type { Rng } from '../src/core/rng';
import { DEFAULT_JUMPS, Jumps } from '../src/systems/jumps';
import type { JumpPlan } from '../src/systems/jumps';

const POCKETS = ['void', 'meadow', 'dollhouse'];

/** ГСЧ по сценарию: сначала отдаёт заданные числа, потом — rest. */
function script(values: number[], rest = 0.5): Rng {
  let i = 0;
  return () => (i < values.length ? values[i++]! : rest);
}

/** Игрок, прождавший до первого случайного скачка. */
function ready(rng: Rng): Jumps {
  const j = new Jumps(rng);
  j.update(DEFAULT_JUMPS.firstAfter);
  return j;
}

describe('скачки: когда', () => {
  it('до firstAfter случайных скачков нет, какие бы шансы ни выпали; потом есть', () => {
    const j = new Jumps(() => 0);
    expect(j.cooldown).toBe(DEFAULT_JUMPS.firstAfter);
    j.update(DEFAULT_JUMPS.firstAfter - 1);
    expect(j.onLightOn()).toBeNull();
    expect(j.onRevive()).toBeNull();
    expect(j.onThin()).toBeNull();
    expect(j.onDark(100, true, true)).toBeNull();
    expect(j.count).toBe(0);
    j.update(1);
    expect(j.cooldown).toBe(0);
    expect(j.onLightOn()).not.toBeNull();
    expect(j.count).toBe(1);
  });

  it('пауза между скачками: gapMin…gapMax; пока она идёт, повода нет; cooldown не уходит в минус', () => {
    const lo = ready(() => 0);
    expect(lo.onLightOn()).not.toBeNull();
    expect(lo.cooldown).toBe(DEFAULT_JUMPS.gapMin);
    const hi = ready(() => 0.9999);
    // 0,9999 не проходит шанс света, поэтому поводом служит обязательный по смыслу «тонкий» зал.
    expect(hi.onThin()).not.toBeNull();
    expect(hi.cooldown).toBeGreaterThan(DEFAULT_JUMPS.gapMax - 0.1);
    expect(hi.cooldown).toBeLessThanOrEqual(DEFAULT_JUMPS.gapMax);

    expect(lo.onLightOn()).toBeNull();
    expect(lo.onThin()).toBeNull();
    lo.update(DEFAULT_JUMPS.gapMin - 0.5);
    expect(lo.onRevive()).toBeNull();
    lo.update(0.5);
    expect(lo.onRevive()).not.toBeNull();
    lo.update(1e6);
    expect(lo.cooldown).toBe(0);
  });

  it('не больше maxPerSession случайных скачков за сессию', () => {
    const j = new Jumps(() => 0);
    let n = 0;
    for (let i = 0; i < 40; i++) {
      j.update(DEFAULT_JUMPS.gapMax + 1);
      if (j.onLightOn()) n += 1;
    }
    expect(n).toBe(DEFAULT_JUMPS.maxPerSession);
    expect(j.count).toBe(DEFAULT_JUMPS.maxPerSession);
    j.update(1e6);
    expect(j.onThin()).toBeNull();
    expect(j.onRevive()).toBeNull();
    expect(j.onDark(100, true, true)).toBeNull();
  });

  it('maxPerSession берётся из конфигурации', () => {
    const j = new Jumps(() => 0, { ...DEFAULT_JUMPS, firstAfter: 0, gapMin: 0, gapMax: 0, maxPerSession: 2 });
    expect([j.onThin(), j.onThin(), j.onThin()].map((p) => p !== null)).toEqual([true, true, false]);
  });

  it('обязательные скачки (провал, газ, рой) всегда есть и не тратят ни счётчик, ни паузу', () => {
    const j = new Jumps(() => 0.5);
    expect(j.cooldown).toBe(DEFAULT_JUMPS.firstAfter);
    for (const cause of ['fall', 'faint', 'caught'] as const) {
      const p = j.forced(cause);
      expect(p.cause).toBe(cause);
    }
    expect(j.count).toBe(0);
    expect(j.cooldown).toBe(DEFAULT_JUMPS.firstAfter);
    // Даже когда лимит исчерпан.
    const done = new Jumps(() => 0, { ...DEFAULT_JUMPS, firstAfter: 0, gapMin: 0, gapMax: 0, maxPerSession: 1 });
    done.onThin();
    expect(done.onThin()).toBeNull();
    expect(done.forced('fall').cause).toBe('fall');
    expect(done.count).toBe(1);
  });

  it('как выглядят обязательные: провал — выбеливание в карман, газ — рассыпание в карман, рой — затемнение в другое место убежища', () => {
    const j = new Jumps(mulberry32(1));
    const fall = j.forced('fall');
    expect(fall).toMatchObject({ style: 'whiteout' });
    expect(POCKETS).toContain(fall.to);
    const faint = j.forced('faint');
    expect(faint).toMatchObject({ style: 'dissolve' });
    expect(POCKETS).toContain(faint.to);
    expect(j.forced('caught')).toEqual({ cause: 'caught', style: 'blackout', to: 'elsewhere', dest: 'start' });
  });
});

describe('скачки: куда', () => {
  it('nextPocket не повторяет прошлое пространство и со временем выдаёт все три', () => {
    for (const seed of [1, 2, 3]) {
      const j = new Jumps(mulberry32(seed));
      let prev = '';
      const seen = new Set<string>();
      for (let i = 0; i < 300; i++) {
        const p = j.nextPocket();
        expect(POCKETS).toContain(p);
        expect(p).not.toBe(prev);
        prev = p;
        seen.add(p);
      }
      expect(seen.size).toBe(3);
    }
  });

  it('обязательные скачки тоже учитывают прошлое пространство: падение подряд — не в одно и то же', () => {
    const j = new Jumps(mulberry32(5));
    let prev = '';
    for (let i = 0; i < 100; i++) {
      const p = j.forced(i % 2 === 0 ? 'fall' : 'faint');
      expect(p.to).not.toBe(prev);
      prev = p.to;
    }
  });

  it('случайный скачок чаще в карман (7 из 10), иначе — в другое место убежища', () => {
    // Сценарий: шанс повода проходит (0), затем «куда»: 0,69 — карман, 0,7 — другое место.
    const pocket = ready(script([0, 0.69])).onLightOn()!;
    expect(POCKETS).toContain(pocket.to);
    const elsewhere = ready(script([0, 0.7])).onLightOn()!;
    expect(elsewhere.to).toBe('elsewhere');
    // Статистика на настоящем ГСЧ: примерно 70 % в карман.
    const rng = mulberry32(99);
    let pockets = 0;
    let all = 0;
    for (let i = 0; i < 2000; i++) {
      const j = new Jumps(rng, { ...DEFAULT_JUMPS, firstAfter: 0, lightChance: 1 });
      const p = j.onLightOn()!;
      all += 1;
      if (POCKETS.includes(p.to)) pockets += 1;
    }
    expect(pockets / all).toBeGreaterThan(0.65);
    expect(pockets / all).toBeLessThan(0.75);
  });

  it('«тонкое» помещение и выросшая вещь — всегда в карман (у вещи — в то, что ей назначено)', () => {
    for (let i = 0; i < 50; i++) {
      const j = ready(mulberry32(i));
      const p = j.onThin()!;
      expect(p).toMatchObject({ cause: 'thin', style: 'dissolve' });
      expect(POCKETS).toContain(p.to);
    }
    const j = new Jumps(mulberry32(3));
    expect(j.onEngulf('meadow')).toEqual({ cause: 'gaze', style: 'whiteout', to: 'meadow' });
    expect(POCKETS).toContain(j.onEngulf(null).to);
  });

  it('вещь, которая накрыла игрока, переносит всегда: и до firstAfter, и сверх лимита; но тратит паузу и счётчик', () => {
    const j = new Jumps(() => 0.5);
    expect(j.onEngulf('void').to).toBe('void');
    expect(j.count).toBe(1);
    expect(j.cooldown).toBeGreaterThanOrEqual(DEFAULT_JUMPS.gapMin);
    expect(j.onLightOn()).toBeNull();
    for (let i = 0; i < 10; i++) j.onEngulf(null);
    expect(j.onEngulf('dollhouse').to).toBe('dollhouse');
  });
});

describe('скачки: шансы поводов', () => {
  it('щёлкнул фонарём: проходит при rng < lightChance (0,3), не проходит при ≥', () => {
    expect(ready(script([0.29])).onLightOn()).toMatchObject({ cause: 'light', style: 'cut' });
    expect(ready(script([0.3])).onLightOn()).toBeNull();
    expect(ready(script([0.99])).onLightOn()).toBeNull();
    expect(ready(script([0])).onLightOn()).not.toBeNull();
  });

  it('фонарь ожил: проходит при rng < reviveChance (0,35)', () => {
    expect(ready(script([0.34])).onRevive()).toMatchObject({ cause: 'revive', style: 'cut' });
    expect(ready(script([0.35])).onRevive()).toBeNull();
  });

  it('частота на настоящем ГСЧ: свет ≈ 30 %, оживание ≈ 35 %', () => {
    const rng = mulberry32(2024);
    let light = 0;
    let revive = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const j = new Jumps(rng, { ...DEFAULT_JUMPS, firstAfter: 0 });
      if (j.onLightOn()) light += 1;
      const k = new Jumps(rng, { ...DEFAULT_JUMPS, firstAfter: 0 });
      if (k.onRevive()) revive += 1;
    }
    expect(light / N).toBeGreaterThan(0.27);
    expect(light / N).toBeLessThan(0.33);
    expect(revive / N).toBeGreaterThan(0.32);
    expect(revive / N).toBeLessThan(0.38);
  });

  it('промах шанса не тратит ни счётчик, ни паузу', () => {
    const j = ready(script([0.9]));
    expect(j.onLightOn()).toBeNull();
    expect(j.count).toBe(0);
    expect(j.cooldown).toBe(0);
  });

  it('темнота: скачок после darkIdle секунд полной темноты и неподвижности; любое движение или свет обнуляет отсчёт', () => {
    const j = ready(script([0.5, 0.5, 0.5]));
    const idle = DEFAULT_JUMPS.darkIdle;
    expect(j.onDark(idle - 1, true, true)).toBeNull();
    // Шагнул — отсчёт с нуля.
    expect(j.onDark(0.1, true, false)).toBeNull();
    expect(j.onDark(idle - 1, true, true)).toBeNull();
    // Включил свет — тоже с нуля.
    expect(j.onDark(0.1, false, true)).toBeNull();
    expect(j.onDark(idle - 1, true, true)).toBeNull();
    const p = j.onDark(1.01, true, true) as JumpPlan;
    expect(p).toMatchObject({ cause: 'dark', style: 'blackout' });
    expect(['elsewhere', ...POCKETS]).toContain(p.to);
    expect(j.count).toBe(1);
    // После скачка отсчёт тоже начинается заново.
    j.update(1e6);
    expect(j.onDark(idle - 1, true, true)).toBeNull();
  });

  it('обязательный скачок обнуляет отсчёт темноты', () => {
    const j = ready(() => 0.5);
    j.onDark(DEFAULT_JUMPS.darkIdle - 0.5, true, true);
    j.forced('caught');
    expect(j.onDark(1, true, true)).toBeNull();
  });
});
