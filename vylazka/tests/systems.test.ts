import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/core/rng';
import { STORAGE_PREFIX, WebPlainPlatform } from '../src/platform/web_plain';
import { Lifecycle } from '../src/lifecycle';
import { AutoExposure, beamAtten } from '../src/render/exposure';
import { bakeDetail, DETAIL, DETAIL_LAYERS } from '../src/render/detail';
import { bakeGrime } from '../src/render/grime';
import { ATLAS_COLS, ATLAS_ROWS, bakeMatcapAtlas } from '../src/render/matcap_atlas';
import { fineOf, gazeTall, internalSize, QUALITY, verticalFov } from '../src/render/renderer';
import { WORLD_FRAG } from '../src/render/shaders';
import { CALM_ENV, CRANK_NOISE, DEFAULT_FLASHLIGHT, Flashlight, LIGHT_LONGER, REVIVE_MIN } from '../src/systems/flashlight';
import type { FlashlightEvents } from '../src/systems/flashlight';
import { MIDNIGHT, recTimestamp, towardMidnight } from '../src/ui/hud';
import { DECAY, MAT, MAT_COUNT, MAT_DEFS } from '../src/world/materials';

const DT = 1 / 60;

describe('фонарь', () => {
  it('светит до отказа на 30 % дольше прежнего: промежуток между отказами, передышка и заряд ×1,3', () => {
    expect(LIGHT_LONGER).toBe(1.3);
    expect(DEFAULT_FLASHLIGHT.meanFailInterval).toBeCloseTo(104, 6);
    expect(DEFAULT_FLASHLIGHT.graceAfterRevive).toBeCloseTo(18.2, 6);
    expect(DEFAULT_FLASHLIGHT.drainSeconds).toBeCloseTo(702, 6);
  });

  it('трясти можно до полного истощения батарейки; севшая до нуля не оживает, пока не отдохнёт', () => {
    // Короткая батарейка и без случайных отказов: светит, садится, гаснет.
    const f = new Flashlight(mulberry32(5), { ...DEFAULT_FLASHLIGHT, meanFailInterval: 1e9, drainSeconds: 6 });
    let t = 0;
    while (f.state === 'on' && t < 10) {
      f.update(DT, CALM_ENV);
      t += DT;
    }
    expect(f.state).toBe('dead');
    expect(f.charge).toBeLessThan(REVIVE_MIN);
    // Энергичная тряска сразу после того, как села, не помогает: заряда нет.
    for (let i = 0; i < 60; i++) f.update(DT, { ...CALM_ENV, shake: 1 });
    expect(f.state).toBe('dead');
    // Батарейка отдыхает в темноте и набирает немного заряда; тряска снова оживляет фонарь.
    for (let i = 0; i < 60 * 30; i++) f.update(DT, CALM_ENV);
    expect(f.charge).toBeCloseTo(DEFAULT_FLASHLIGHT.rest, 3);
    let revived = false;
    for (let i = 0; i < 60 * 3 && !revived; i++) revived = f.update(DT, { ...CALM_ENV, shake: 1 }).revived;
    expect(revived).toBe(true);
    expect(f.state).toBe('on');
  });

  it('где светло и без фонаря, он сам не глохнет — ни случайно, ни первым отказом; в темноте обучающий отказ приходит', () => {
    // Отказы очень часты и первый — на пятой секунде: в светлом месте за минуту не случается ни одного.
    const f = new Flashlight(mulberry32(11), { ...DEFAULT_FLASHLIGHT, meanFailInterval: 2, graceAfterRevive: 0, firstFailAt: 5 });
    const bright = { ...CALM_ENV, needed: false };
    expect(f.hazard(bright)).toBe(0);
    for (let i = 0; i < 60 * 60; i++) expect(f.update(DT, bright).failed).toBe(false);
    expect(f.state).toBe('on');
    // Шагнул в темноту: обучающий отказ своё время уже отсчитал и приходит сразу (после мерцания-предупреждения).
    let failed = false;
    for (let i = 0; i < 60 * 2 && !failed; i++) failed = f.update(DT, CALM_ENV).failed;
    expect(failed).toBe(true);
    expect(f.state).toBe('dead');
  });

  it('садящаяся батарейка учащает отказы только на последней четверти заряда', () => {
    const f = new Flashlight(mulberry32(4));
    f.charge = 1;
    const full = f.hazard(CALM_ENV);
    f.charge = 0.3;
    expect(f.hazard(CALM_ENV)).toBeCloseTo(full, 9);
    f.charge = 0.1;
    expect(f.hazard(CALM_ENV)).toBeGreaterThan(full * 1.5);
  });

  it('севшая до нуля батарейка: тряска не оживляет и не искрит; отлежится — снова можно', () => {
    const f = new Flashlight(mulberry32(8), { ...DEFAULT_FLASHLIGHT, meanFailInterval: 1e9, drainSeconds: 2 });
    for (let i = 0; i < 60 * 3; i++) f.update(DT, CALM_ENV);
    expect(f.state).toBe('dead');
    expect(f.exhausted).toBe(true);
    let sparks = 0;
    for (let i = 0; i < 60 * 3; i++) if (f.update(DT, { ...CALM_ENV, shake: 1 }).spark) sparks += 1;
    expect(sparks).toBe(0);
    expect(f.state).toBe('dead');
    // Кнопка тоже не помогает, пока не отлежалась.
    f.toggle();
    expect(f.state).toBe('dead');
    for (let i = 0; i < 60 * 31; i++) f.update(DT, CALM_ENV);
    expect(f.exhausted).toBe(false);
  });

  it('пока в батарейке есть заряд, тряска оживает фонарь после каждого отказа', () => {
    const f = new Flashlight(mulberry32(9), { ...DEFAULT_FLASHLIGHT, meanFailInterval: 0.5, graceAfterRevive: 0.5, drainSeconds: 60 });
    let revives = 0;
    for (let i = 0; i < 60 * 50; i++) {
      const ev = f.update(DT, { ...CALM_ENV, shake: f.state === 'dead' ? 1 : 0 });
      if (ev.revived) revives += 1;
    }
    expect(revives).toBeGreaterThan(10);
  });

  it('вспомненная вещь заряжает батарейку полностью, не трогая состояние фонаря', () => {
    const f = new Flashlight(mulberry32(2), { ...DEFAULT_FLASHLIGHT, meanFailInterval: 1e9, drainSeconds: 10 });
    for (let i = 0; i < 60 * 5; i++) f.update(DT, CALM_ENV);
    expect(f.charge).toBeLessThan(0.6);
    f.toggle();
    expect(f.state).toBe('off');
    f.recharge();
    expect(f.charge).toBe(1);
    expect(f.state).toBe('off');
  });

  it('первый отказ приходит в заданное время: сначала мерцание, потом темнота', () => {
    const f = new Flashlight(mulberry32(1), { ...DEFAULT_FLASHLIGHT, firstFailAt: 5 });
    let failedAt = -1;
    let dipped = false;
    for (let i = 0; i < 600; i++) {
      const ev = f.update(DT, CALM_ENV);
      if (i * DT > 5 && f.state === 'on' && f.intensity < 0.6) dipped = true;
      if (ev.failed) {
        failedAt = i * DT;
        break;
      }
    }
    expect(failedAt).toBeGreaterThan(5.4);
    expect(failedAt).toBeLessThan(6.6);
    expect(dipped).toBe(true);
    expect(f.state).toBe('dead');
    f.update(DT, CALM_ENV);
    expect(f.intensity).toBe(0);
  });

  it('заглохший фонарь оживает только от тряски, вялая тряска помогает хуже', () => {
    const timeToRevive = (shake: number): number => {
      const f = new Flashlight(mulberry32(7));
      f.forceFail();
      for (let i = 0; i < 60 * 30; i++) if (f.update(DT, { ...CALM_ENV, shake }).revived) return i * DT;
      return Infinity;
    };
    expect(timeToRevive(0)).toBe(Infinity);
    const fast = timeToRevive(1);
    const slow = timeToRevive(0.4);
    expect(fast).toBeGreaterThanOrEqual(DEFAULT_FLASHLIGHT.reviveNeed[0] - 0.05);
    expect(fast).toBeLessThanOrEqual(DEFAULT_FLASHLIGHT.reviveNeed[1] + 0.05);
    expect(slow).toBeGreaterThan(fast * 2.5);
  });

  it('прогресс оживления растёт, искры и дребезг идут только при тряске', () => {
    const f = new Flashlight(mulberry32(3));
    f.forceFail();
    let sparks = 0;
    let rattle = 0;
    let last = 0;
    for (let i = 0; i < 30; i++) {
      const ev = f.update(DT, { ...CALM_ENV, shake: 0.8 });
      if (ev.spark) sparks += 1;
      rattle = Math.max(rattle, ev.rattle);
      expect(f.reviveProgress).toBeGreaterThanOrEqual(last);
      last = f.reviveProgress;
    }
    expect(rattle).toBeCloseTo(0.8);
    expect(sparks).toBeGreaterThan(0);
    const quiet = new Flashlight(mulberry32(3));
    quiet.forceFail();
    for (let i = 0; i < 120; i++) {
      const ev = quiet.update(DT, CALM_ENV);
      expect(ev.spark).toBe(false);
      expect(ev.rattle).toBe(0);
    }
  });

  it('после оживления есть передышка без отказов', () => {
    const f = new Flashlight(mulberry32(11), { ...DEFAULT_FLASHLIGHT, meanFailInterval: 0.01, graceAfterRevive: 8 });
    f.forceFail();
    while (f.state === 'dead') f.update(DT, { ...CALM_ENV, shake: 1 });
    let t = 0;
    while (f.state === 'on' && t < 30) {
      f.update(DT, CALM_ENV);
      t += DT;
    }
    expect(t).toBeGreaterThan(8);
    expect(t).toBeLessThan(11);
  });

  it('отказы чаще при низком заряде, в сырости, в панике и рядом с роем', () => {
    const f = new Flashlight(mulberry32(1));
    const base = f.hazard(CALM_ENV);
    expect(f.hazard({ ...CALM_ENV, wet: 1 })).toBeGreaterThan(base * 2.5);
    expect(f.hazard({ ...CALM_ENV, panic: 1 })).toBeGreaterThan(base * 2);
    expect(f.hazard({ ...CALM_ENV, swarm: 1 })).toBeGreaterThan(base * 6);
    // Садящаяся батарейка — только на последней четверти заряда (16.11: «+30 % до отказа» не тают с полной).
    f.charge = 0.1;
    expect(f.hazard(CALM_ENV)).toBeGreaterThan(base * 1.5);
    f.charge = 0.02;
    expect(f.hazard(CALM_ENV)).toBeGreaterThan(base * 2.5);
  });

  it('кнопка выключает и включает; у севшей батарейки свет не вернуть', () => {
    const f = new Flashlight(mulberry32(1));
    f.toggle();
    f.update(DT);
    expect(f.state).toBe('off');
    expect(f.intensity).toBe(0);
    f.toggle();
    f.update(DT);
    expect(f.state).toBe('on');
    expect(f.intensity).toBeGreaterThan(0.5);
    f.charge = 0.00001;
    const ev = f.update(DT);
    expect(ev.failed).toBe(true);
    for (let i = 0; i < 600; i++) f.update(DT, { ...CALM_ENV, shake: 1 });
    expect(f.state).toBe('dead');
  });

  describe('зарядка удержанием (телефон; слова партнёра 17.11 08:42)', () => {
    const QUIET = { ...DEFAULT_FLASHLIGHT, meanFailInterval: 1e9 };
    const RATE = DEFAULT_FLASHLIGHT.crankRate;
    /** Держать палец seconds секунд (on = false — палец убран); события и яркость каждого шага. */
    const hold = (f: Flashlight, seconds: number, on = true): { ev: FlashlightEvents; light: number }[] => {
      const out: { ev: FlashlightEvents; light: number }[] = [];
      f.crank(on);
      for (let i = 0; i < Math.round(seconds / DT); i++) {
        const ev = f.update(DT, CALM_ENV);
        out.push({ ev, light: f.intensity });
      }
      return out;
    };

    it('заглохший фонарь под пальцем заряжается; свет — только на полном, и сначала секундная вспышка', () => {
      const f = new Flashlight(mulberry32(3), QUIET);
      f.charge = 0.3;
      f.forceFail();
      f.update(DT);
      expect(f.state).toBe('dead');
      // Секунду держат: заряд растёт на crankRate, света нет, фонарь «заряжают».
      hold(f, 1);
      expect(f.charge).toBeCloseTo(0.3 + RATE, 2);
      expect(f.state).toBe('dead');
      expect(f.cranking).toBe(true);
      // Дошёл до полного: одна вспышка, фонарь горит, палец дальше ничего не делает.
      const run = hold(f, (1 - f.charge) / RATE + 0.1);
      const at = run.findIndex((x) => x.ev.charged);
      expect(at).toBeGreaterThan(0);
      expect(run.filter((x) => x.ev.charged)).toHaveLength(1);
      expect(run.filter((x) => x.ev.revived)).toHaveLength(1);
      expect(run.slice(0, at).every((x) => x.light < 0.8)).toBe(true);
      expect(f.state).toBe('on');
      expect(f.charge).toBeGreaterThan(0.999);
      expect(f.cranking).toBe(false);
      // Вспышка мягкая (партнёр 19.11; куратор, пачка 50: «мягко — значит медленно»): луч не прыгает, а набухает к середине
      // секунды до flashPeak и за секунду спадает к обычному.
      const after = hold(f, DEFAULT_FLASHLIGHT.flashTime + 0.1);
      const top = Math.max(...after.map((x) => x.light));
      expect(top).toBeGreaterThan(DEFAULT_FLASHLIGHT.flashPeak * 0.9);
      expect(after.findIndex((x) => x.light === top) * DT).toBeGreaterThan(0.3);
      expect(after.at(-1)!.light).toBeLessThan(1.05);
      expect(after.at(-1)!.light).toBeGreaterThan(0.85);
      expect(after.every((x) => !x.ev.charged)).toBe(true);
      // Ни набухание, ни спад — не рывок.
      for (let i = 1; i < after.length; i++) expect(Math.abs(after[i]!.light - after[i - 1]!.light)).toBeLessThan(0.06);
    });

    it('отпустил раньше — фонарь как был, а набранный заряд остался', () => {
      const f = new Flashlight(mulberry32(4), QUIET);
      f.charge = 0.2;
      f.forceFail();
      f.update(DT);
      hold(f, 0.8);
      hold(f, 0.5, false);
      expect(f.state).toBe('dead');
      expect(f.charge).toBeCloseTo(0.2 + 0.8 * RATE, 2);
      expect(f.cranking).toBe(false);
      // Новое нажатие продолжает с набранного.
      const run = hold(f, (1 - f.charge) / RATE + 0.1);
      expect(run.some((x) => x.ev.charged)).toBe(true);
      expect(f.state).toBe('on');
    });

    it('короткое касание ничего не включает и не выключает, даже с полной батарейкой', () => {
      const off = new Flashlight(mulberry32(5), QUIET);
      off.toggle();
      off.update(DT);
      expect(off.state).toBe('off');
      hold(off, DEFAULT_FLASHLIGHT.crankMin * 0.5);
      hold(off, 0.3, false);
      expect(off.state).toBe('off');
      const on = new Flashlight(mulberry32(6), QUIET);
      on.update(DT);
      hold(on, 0.2);
      hold(on, 0.3, false);
      expect(on.state).toBe('on');
    });

    it('погашенный фонарь зажигает зарядка: с полной батарейкой — через crankMin и тоже со вспышкой', () => {
      const f = new Flashlight(mulberry32(7), QUIET);
      f.toggle();
      f.update(DT);
      const run = hold(f, DEFAULT_FLASHLIGHT.crankMin + 0.1);
      const at = run.findIndex((x) => x.ev.charged);
      expect(at * DT).toBeGreaterThan(DEFAULT_FLASHLIGHT.crankMin - 2 * DT);
      expect(f.state).toBe('on');
      expect(run.some((x) => x.ev.revived)).toBe(false);
      const after = hold(f, DEFAULT_FLASHLIGHT.flashTime);
      expect(Math.max(...after.map((x) => x.light))).toBeGreaterThan(1.4);
    });

    it('горящий фонарь под пальцем не гаснет и подзаряжается; полный и горящий — касание ничего не делает', () => {
      const f = new Flashlight(mulberry32(8), QUIET);
      f.charge = 0.6;
      f.update(DT);
      const run = hold(f, (1 - 0.6) / RATE + 0.2);
      expect(run.every((x) => x.light > 0.5)).toBe(true);
      expect(run.filter((x) => x.ev.charged)).toHaveLength(1);
      expect(f.charge).toBeGreaterThan(0.999);
      hold(f, 0.2, false);
      // Полный и горящий: зарядить нечего — ни вспышки, ни шума.
      const again = hold(f, 1.5);
      expect(again.some((x) => x.ev.charged)).toBe(false);
      expect(f.cranking).toBe(false);
      expect(again.every((x) => x.ev.rattle === 0)).toBe(true);
    });

    it('фонарь заглох под лежащим пальцем — зарядка начинается снова, отпускать не нужно (нашёл куратор)', () => {
      const f = new Flashlight(mulberry32(13), QUIET);
      f.charge = 0.7;
      f.update(DT);
      // Держат: дозарядили до полного, вспышка; палец так и лежит.
      const first = hold(f, (1 - 0.7) / RATE + 0.2);
      expect(first.some((x) => x.ev.charged)).toBe(true);
      expect(f.cranking).toBe(false);
      // Отказ под пальцем: фонарь заглох, а палец всё ещё на кнопке.
      f.forceFail();
      f.update(DT);
      expect(f.state).toBe('dead');
      const again = hold(f, DEFAULT_FLASHLIGHT.crankMin + 0.2);
      expect(again.filter((x) => x.ev.charged)).toHaveLength(1);
      expect(again.some((x) => x.ev.revived)).toBe(true);
      expect(f.state).toBe('on');
    });

    it('севшей до нуля отлёживаться не нужно — её заряжают', () => {
      const f = new Flashlight(mulberry32(9), { ...QUIET, drainSeconds: 2 });
      for (let i = 0; i < 200 && f.state === 'on'; i++) f.update(DT);
      expect(f.exhausted).toBe(true);
      const run = hold(f, 1 / RATE + 0.2);
      expect(run.some((x) => x.ev.charged)).toBe(true);
      expect(f.state).toBe('on');
      expect(f.exhausted).toBe(false);
    });

    it('мерцание мягкое (партнёр 19.11; куратор, пачка 50): провалы не чаще трёх в секунду и без ступеней; искры — плавные и редкие', () => {
      // Перед отказом и после оживления мерцание самое глубокое: держим фонарь «нестабильным» и считаем провалы.
      const f = new Flashlight(mulberry32(21), { ...DEFAULT_FLASHLIGHT, meanFailInterval: 1e9 });
      f.update(DT);
      const light: number[] = [];
      for (let i = 0; i < Math.round(6 / DT); i++) {
        f.stutter(1);
        f.update(DT, { panic: 0, wet: 0, swarm: 0, shake: 0 });
        light.push(f.intensity);
      }
      let dips = 0;
      for (let i = 1; i < light.length; i++) if (light[i - 1]! >= 0.8 && light[i]! < 0.8) dips += 1;
      const step = Math.max(...light.slice(1).map((x, i) => Math.abs(x - light[i]!)));
      expect(dips / 6).toBeLessThanOrEqual(3);
      expect(dips).toBeGreaterThan(2);
      expect(step).toBeLessThan(0.3);
      // Искры заглохшего фонаря под пальцем: не чаще трёх в секунду, свет каждой набухает и гаснет.
      const g = new Flashlight(mulberry32(22), QUIET);
      g.charge = 0.1;
      g.forceFail();
      g.update(DT);
      // Пока не дозаряжен: дальше он загорится, и это уже вспышка заряда.
      const secs = Math.min(3, 0.8 / RATE);
      const run = hold(g, secs);
      expect(g.state).toBe('dead');
      const sparks = run.filter((x) => x.ev.spark).length;
      expect(sparks).toBeGreaterThan(0);
      expect(sparks / secs).toBeLessThanOrEqual(3);
      expect(Math.max(...run.map((x) => x.light))).toBeLessThanOrEqual(0.36);
      for (let i = 1; i < run.length; i++) expect(Math.abs(run[i]!.light - run[i - 1]!.light)).toBeLessThan(0.15);
    });

    it('зарядка трещит — её слышит Осыпь; не горящий фонарь под пальцем искрит; мерцание перед отказом обрывается', () => {
      const f = new Flashlight(mulberry32(10), QUIET);
      f.charge = 0.1;
      f.forceFail();
      f.update(DT);
      const run = hold(f, 1.5);
      expect(run.every((x) => x.ev.rattle === CRANK_NOISE)).toBe(true);
      expect(run.filter((x) => x.ev.spark).length).toBeGreaterThan(2);
      // Палец на кнопке во время предупреждающего мерцания: отказа не будет.
      const g = new Flashlight(mulberry32(12), { ...DEFAULT_FLASHLIGHT, meanFailInterval: 0.01, graceAfterRevive: 0 });
      let dying = false;
      for (let i = 0; i < 600 && !dying; i++) {
        g.update(DT);
        dying = g.state === 'on' && g.intensity < 0.6;
      }
      g.charge = 0.5;
      const kept = hold(g, 1.2);
      expect(kept.some((x) => x.ev.failed)).toBe(false);
    });
  });

  it('один сид — одна и та же история', () => {
    const play = (): string => {
      const f = new Flashlight(mulberry32(99), { ...DEFAULT_FLASHLIGHT, meanFailInterval: 5, graceAfterRevive: 1 });
      const log: number[] = [];
      for (let i = 0; i < 3000; i++) {
        const ev = f.update(DT, { ...CALM_ENV, shake: f.state === 'dead' ? 1 : 0 });
        if (ev.failed || ev.revived) log.push(i);
      }
      return log.join(',');
    };
    expect(play()).toBe(play());
    expect(play().split(',').length).toBeGreaterThan(4);
  });
});

describe('экспозиция', () => {
  it('близкая стена — усиление у нижней границы; даль при горящем фонаре — не выше «светлого» предела', () => {
    const e = new AutoExposure();
    expect(e.target(beamAtten(1), 1)).toBe(0.8);
    expect(e.target(beamAtten(25), 1)).toBe(2.1);
    expect(e.target(0, 0)).toBe(5.5);
  });

  it('темнеет быстро, светлеет медленно; шум растёт с усилением', () => {
    const e = new AutoExposure();
    e.gain = 1;
    for (let i = 0; i < 30; i++) e.update(DT, 0, 0);
    const up = e.gain - 1;
    const noiseDark = e.noise();
    e.gain = 5.5;
    for (let i = 0; i < 30; i++) e.update(DT, 1, 1);
    const down = 5.5 - e.gain;
    expect(down).toBeGreaterThan(up * 2);
    expect(noiseDark).toBeGreaterThan(new AutoExposure().noise() * 0.5);
  });
});

describe('запечённые текстуры', () => {
  const atlas = bakeMatcapAtlas(MAT_DEFS, 32);

  it('атлас детерминирован и нужного размера: 8×6 шаров', () => {
    expect(atlas.width).toBe(256);
    expect(atlas.height).toBe(192);
    expect(atlas.data.length).toBe(256 * 192 * 4);
    expect(bakeMatcapAtlas(MAT_DEFS, 32).data).toEqual(atlas.data);
    expect(MAT_DEFS.length).toBe(MAT_COUNT);
    expect(ATLAS_COLS * ATLAS_ROWS).toBeGreaterThanOrEqual(MAT_COUNT);
  });

  it('шар светлее в центре, чем у края; у гладкого материала блик ярче', () => {
    const at = (mat: number, px: number, py: number): number => {
      const o = ((Math.floor(mat / 8) * 32 + py) * 256 + (mat % 8) * 32 + px) * 4;
      return atlas.data[o]! + atlas.data[o + 1]! + atlas.data[o + 2]!;
    };
    for (let m = 0; m < MAT_COUNT; m++) expect(at(m, 16, 16), MAT_DEFS[m]!.name).toBeGreaterThan(at(m, 30, 16));
    // Эмаль бликует сильнее побелки, хотя альбедо у них близкое.
    expect(at(MAT.enamel, 16, 16) / at(MAT.enamel, 22, 16)).toBeGreaterThan(at(MAT.plaster, 16, 16) / at(MAT.plaster, 22, 16));
    // Стекло тёмное, но блик на нём — до белого.
    expect(at(MAT.glass, 16, 16)).toBeGreaterThan(600);
    expect(at(MAT.glass, 24, 16)).toBeLessThan(at(MAT.glass, 16, 16) / 3);
    expect(atlas.data.every((v, i) => i % 4 !== 3 || v === 255)).toBe(true);
  });

  it('у каждого материала есть слой фактуры, а проступающий материал существует', () => {
    for (const d of MAT_DEFS) {
      expect(d.layer, d.name).toBeGreaterThanOrEqual(0);
      expect(d.layer, d.name).toBeLessThan(DETAIL_LAYERS);
      expect(d.tile, d.name).toBeGreaterThan(0.1);
      expect(d.bump, d.name).toBeLessThanOrEqual(0.03);
      if (d.alt !== undefined) expect(MAT_DEFS[d.alt], d.name).toBeDefined();
      // Краска и металл без «изнанки» не могут ни облезть, ни заржаветь.
      if (d.decay === DECAY.paint || d.decay === DECAY.metal) expect(d.alt, d.name).toBeDefined();
    }
    // Номера слоёв в материалах и в стопке фактур — одни и те же.
    expect(MAT_DEFS[MAT.concrete]!.layer).toBe(DETAIL.concrete);
    expect(MAT_DEFS[MAT.paintGreen]!.layer).toBe(DETAIL.paint);
    expect(MAT_DEFS[MAT.brick]!.layer).toBe(DETAIL.brick);
    expect(MAT_DEFS[MAT.zinc]!.layer).toBe(DETAIL.zinc);
    expect(MAT_DEFS[MAT.tile]!.layer).toBe(DETAIL.tile);
  });

  it('у домашних материалов свой слой фактуры и свой шар в атласе', () => {
    const home = [
      [MAT.wallpaper, DETAIL.wallpaper],
      [MAT.parquet, DETAIL.parquet],
      [MAT.linoleum, DETAIL.linoleum],
      [MAT.veneer, DETAIL.veneer],
      [MAT.upholstery, DETAIL.upholstery],
    ] as const;
    expect(new Set(home.map(([, l]) => l)).size).toBe(home.length);
    const cell = 32;
    for (const [m, layer] of home) {
      expect(MAT_DEFS[m]!.layer, MAT_DEFS[m]!.name).toBe(layer);
      expect(m, MAT_DEFS[m]!.name).toBeLessThan(ATLAS_COLS * ATLAS_ROWS);
      // Шар записан: в его ячейке есть непустые пикселы (атлас — sRGB, чёрное — нули).
      let sum = 0;
      const x0 = (m % ATLAS_COLS) * cell;
      const y0 = Math.floor(m / ATLAS_COLS) * cell;
      for (let py = 0; py < cell; py++) for (let px = 0; px < cell; px++) sum += atlas.data[((y0 + py) * atlas.width + x0 + px) * 4]!;
      expect(sum, MAT_DEFS[m]!.name).toBeGreaterThan(cell * cell * 8);
    }
    // Обои обдираются до штукатурки, как краска.
    expect(MAT_DEFS[MAT.wallpaper]!.decay).toBe(DECAY.paint);
    expect(MAT_DEFS[MAT.wallpaper]!.alt).toBe(MAT.plaster);
  });

  it('фактуры детерминированы, бесшовны и не вырождаются в ровный серый', () => {
    const size = 64;
    const d = bakeDetail(size);
    expect(d.layers).toBe(DETAIL_LAYERS);
    expect(d.data.length).toBe(size * size * 4 * DETAIL_LAYERS);
    expect(bakeDetail(size).data).toEqual(d.data);
    for (let l = 0; l < DETAIL_LAYERS; l++) {
      const base = l * size * size * 4;
      let lo = 255;
      let hi = 0;
      let jump = 0;
      let inner = 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const h = d.data[base + (y * size + x) * 4]!;
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
        const left = d.data[base + (y * size) * 4]!;
        const right = d.data[base + (y * size + size - 1) * 4]!;
        jump += Math.abs(left - right);
        inner += Math.abs(left - d.data[base + (y * size + 1) * 4]!);
      }
      // Рельеф есть: высота гуляет хотя бы на десятую долю диапазона.
      expect(hi - lo, `слой ${l}`).toBeGreaterThan(25);
      // Шов на стыке повторов не грубее обычного перепада между соседними точками (с запасом).
      expect(jump, `слой ${l}`).toBeLessThanOrEqual(inner * 3 + size * 4);
    }
  });

  it('грязь тайлится: края совпадают с противоположными с точностью до шага шума', () => {
    const size = 64;
    const g = bakeGrime(size, 7);
    expect(bakeGrime(size, 7)).toEqual(g);
    let maxJump = 0;
    let maxInner = 0;
    for (let y = 0; y < size; y++) {
      const left = g[(y * size + 0) * 4]!;
      const right = g[(y * size + size - 1) * 4]!;
      const inner = g[(y * size + 1) * 4]!;
      maxJump = Math.max(maxJump, Math.abs(left - right));
      maxInner = Math.max(maxInner, Math.abs(left - inner));
    }
    expect(maxJump).toBeLessThanOrEqual(maxInner * 2 + 12);
  });
});

describe('рендер: чистые функции', () => {
  it('внутренний размер держит соотношение сторон, бюджет и чётность', () => {
    for (const [w, h] of [
      [1280, 720],
      [360, 640],
      [915, 412],
      [2560, 1440],
      [800, 800],
    ] as const) {
      for (const q of ['low', 'med', 'high', 'ultra'] as const) {
        const [iw, ih] = internalSize(w, h, QUALITY[q].pixels, 3);
        expect(iw % 2).toBe(0);
        expect(ih % 2).toBe(0);
        expect(iw * ih).toBeLessThanOrEqual(QUALITY[q].pixels * 1.02);
        expect(Math.abs(iw / ih - w / h)).toBeLessThan(0.02);
      }
    }
    // Маленький экран: не больше физических пикселей.
    expect(internalSize(320, 180, QUALITY.high.pixels, 1)).toEqual([320, 180]);
  });

  // Слова партнёра: «на десктопе при хорошем железе на уровне hight нужно сделать зерно в 2 раза меньше,
  // как и все растворяемые частицы. Условно, поднять визуал в 2 раза».
  it('мелкое зерно — то же высокое качество, только буфер вчетверо больше и тень вдвое подробнее', () => {
    const { pixels: up, shadow: us, fine: uf, ...ultra } = QUALITY.ultra;
    const { pixels: hp, shadow: hs, fine: hf, ...high } = QUALITY.high;
    expect(ultra).toEqual(high);
    expect(hf).toBe(1);
    expect(uf).toBe(2);
    expect(up).toBe(hp * uf * uf);
    expect(us).toBe(hs * 2);
    for (const q of ['low', 'med', 'high'] as const) expect(QUALITY[q].fine).toBe(1);
  });

  it('насколько мельче выйдет зерно, решает экран: мельче его пикселя не бывает', () => {
    // Обычным ступеням мелкость не положена ни на каком экране.
    for (const q of ['low', 'med', 'high'] as const) expect(fineOf(3840, 2160, QUALITY[q], 2)).toBe(1);
    const fine = (w: number, h: number, dpr = 1): number => fineOf(w, h, QUALITY.ultra, dpr);
    expect(fine(2560, 1440)).toBe(2);
    expect(fine(3840, 2160)).toBe(2);
    // Окно на экране двойной плотности: пикселей хватает, хотя в точках CSS оно небольшое.
    expect(fine(1401, 625, 2)).toBe(2);
    expect(fine(1920, 1080)).toBe(1.5);
    expect(fine(1600, 900)).toBe(1.25);
    // Экран не больше буфера обычного высокого качества: мельче делать нечего.
    expect(fine(1280, 720)).toBe(1);
    expect(fine(1366, 768)).toBe(1);
    for (const [w, h, dpr] of [
      [390, 844, 3],
      [915, 412, 2.6],
      [800, 800, 1],
      [3440, 1440, 1],
      [1512, 982, 2],
    ] as const) {
      const f = fine(w, h, dpr);
      expect(f).toBeGreaterThanOrEqual(1);
      expect(f).toBeLessThanOrEqual(2);
      // Шаг — четверть: плотность посева точек не меняется на каждое движение края окна.
      expect(Number.isInteger(f * 4)).toBe(true);
      // Буфер не больше экрана, а зерно мельче ровно настолько, насколько буфер выше обычного.
      const [iw, ih] = internalSize(w, h, QUALITY.ultra.pixels, dpr);
      const [, base] = internalSize(w, h, QUALITY.high.pixels, dpr);
      expect(iw).toBeLessThanOrEqual(Math.ceil(w * dpr) + 1);
      expect(ih).toBeLessThanOrEqual(Math.ceil(h * dpr) + 1);
      expect(Math.abs(f - ih / base)).toBeLessThanOrEqual(0.126);
    }
  });

  it('угол обзора: широкий в ландшафте, ограничен в портрете и квадрате', () => {
    expect(verticalFov(16 / 9)).toBeGreaterThan(70);
    expect(verticalFov(16 / 9)).toBeLessThan(76);
    expect(verticalFov(1)).toBe(96);
    expect(verticalFov(9 / 16)).toBe(96);
    expect(verticalFov(3)).toBe(62);
  });

  it('взгляд по форме кадра: низ высокого кадра — так же далеко от оси, как низ широкого; правило взгляда не пропадает', () => {
    const deg = (r: number): number => (r * 180) / Math.PI;
    expect(gazeTall(16 / 9)).toBeCloseTo(1, 6);
    expect(gazeTall(21 / 9)).toBe(1);
    const aspect = 390 / 844;
    const k = gazeTall(aspect);
    expect(k).toBeGreaterThan(0.6);
    expect(k).toBeLessThan(0.75);
    const halfV = (verticalFov(aspect) * Math.PI) / 360;
    const halfWideV = (verticalFov(16 / 9) * Math.PI) / 360;
    // Низ кадра после сжатия — там же, где низ широкого кадра (около 37°): пол под ногами собран, как на ПК.
    expect(deg(Math.atan(Math.tan(halfV) * k))).toBeCloseTo(deg(halfWideV), 3);
    // Но не ближе середины конуса (25°): край кадра в портрете собран не сплошь — правило взгляда видно.
    expect(deg(Math.atan(Math.tan(halfV) * k))).toBeGreaterThan(30);
  });

  it('пол держится дольше стен: в шейдере мира у пола дальше дальность сборки и меньше потеря на скользящем луче', () => {
    expect(WORLD_FRAG).toContain('float floorK = smoothstep(0.5, 0.9, up);');
    expect(WORLD_FRAG).toContain('vec2 rangeV = uScanRange * mix(1.0, 1.7, floorK);');
    expect(WORLD_FRAG).toContain('uGazeTall');
  });
});

describe('обвязка', () => {
  it('пауза складывается из причин', () => {
    const l = new Lifecycle();
    const log: boolean[] = [];
    l.onChange((p) => log.push(p));
    l.set('hidden', true);
    l.set('user', true);
    l.set('hidden', false);
    expect(l.paused).toBe(true);
    l.set('user', false);
    expect(l.paused).toBe(false);
    expect(log).toEqual([true, false]);
  });

  it('web-plain: пакетное сохранение и чтение, свой префикс, язык браузера', async () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) } as unknown as Storage;
    const p = new WebPlainPlatform({ storage, languages: ['de-DE', 'ru-RU'], simulateRewarded: false, coarsePointer: true });
    await p.save(['profile', 'settings'], [{ finds: 3 }, { q: 'low' }]);
    expect([...mem.keys()].every((k) => k.startsWith(STORAGE_PREFIX))).toBe(true);
    expect(STORAGE_PREFIX).toBe('vylazka:');
    expect(await p.load(['settings', 'nope', 'profile'])).toEqual([{ q: 'low' }, null, { finds: 3 }]);
    expect(p.language()).toBe('ru');
    expect(p.deviceType()).toBe('mobile');
    expect(await p.showRewarded()).toBe(false);
    const noStore = new WebPlainPlatform({ storage: null, languages: ['fr'], coarsePointer: false });
    await noStore.save(['a'], [1]);
    expect(await noStore.load(['a'])).toEqual([1]);
    expect(noStore.language()).toBe('en');
    expect(noStore.deviceType()).toBe('desktop');
  });

  it('время записи идёт от 23:41:07 и переходит через полночь', () => {
    expect(recTimestamp(0)).toBe('2004-11-13 23:41:07');
    expect(recTimestamp(59.9)).toBe('2004-11-13 23:42:06');
    expect(recTimestamp(20 * 60)).toBe('2004-11-14 00:01:07');
    expect(recTimestamp(MIDNIGHT)).toBe('2004-11-14 00:00:00');
  });

  it('на камере время подходит к мигу и само до него не доходит: последние две минуты тянутся всё дольше (квиз 17.11)', () => {
    // До последних двух минут — как есть.
    expect(towardMidnight(0)).toBe(0);
    expect(towardMidnight(MIDNIGHT - 121)).toBe(MIDNIGHT - 121);
    // Без скачка на сгибе и только вперёд.
    expect(towardMidnight(MIDNIGHT - 119.999)).toBeCloseTo(MIDNIGHT - 119.999, 2);
    let prev = -1;
    for (let x = MIDNIGHT - 300; x < MIDNIGHT + 7200; x += 7) {
      const y = towardMidnight(x);
      expect(y).toBeGreaterThanOrEqual(prev);
      expect(y).toBeLessThan(MIDNIGHT);
      prev = y;
    }
    // Через пять минут после «полуночи» часы ещё на 23:59:5x; через два часа — на 23:59:59.
    expect(recTimestamp(towardMidnight(MIDNIGHT + 300))).toMatch(/^2004-11-13 23:59:5\d$/);
    expect(recTimestamp(towardMidnight(MIDNIGHT + 7200))).toBe('2004-11-13 23:59:59');
    expect(recTimestamp(towardMidnight(MIDNIGHT + 1e7))).toBe('2004-11-13 23:59:59');
  });
});
