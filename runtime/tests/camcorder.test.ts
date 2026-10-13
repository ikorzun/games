/**
 * Камкордер, ядро (src/stage/camcorder.ts): ручная камера, «оператор поправил кадр», помехи, разрыв кадра,
 * стоп-кадр, зерно, моторный зум. Всё детерминировано: ГСЧ и время — аргументы, браузер не нужен.
 * Числа в тестах — решение владельца 2026-10-10 (сдвиг ≤ 1,2 %, поворот ≤ 0,5°, масштаб 1,00–1,03;
 * помехи раз в 20–45 с на 150–500 мс; vhs_heavy — раз в 6–12 с; зерно ≤ 5 %).
 */
import { describe, expect, it } from 'vitest';
import {
  ANGLE_SHARE,
  burstAt,
  CameraScheduler,
  coverScale,
  fillGrain,
  fitTransform,
  grainAlphaMax,
  HEAVY_STRENGTH,
  IDLE_FRAME,
  LEVELS,
  makeBurst,
  makeReframe,
  signalFor,
  VIRTUAL_LINES,
  vhsUniforms,
  virtualLines,
  makeTear,
  MAX_DT,
  mulberry32,
  REFRAME_SCALE_MAX,
  reframeAt,
  SHAKE,
  tearAt,
  ZOOM_AMOUNT,
  ZOOM_HUNT_PX,
  zoomCurve,
  zoomKeyframes,
  UNREST_RAMP,
} from '../src/stage/camcorder';
import type { CamFrame, CameraContext, CameraFx } from '../src/stage/camcorder';
import { PRESETS } from '../src/stage/presets';

const RECON: CameraContext = { handheld: PRESETS.reconstruction.handheld, reframe: PRESETS.reconstruction.reframe, filter: 'vhs' };
const HEAVY: CameraContext = { ...RECON, filter: 'vhs_heavy' };

/** Прогнать планировщик `ms` миллисекунд шагом `dt` и собрать кадры. */
function run(s: CameraScheduler, ms: number, dt = 16, from = 0): CamFrame[] {
  const out: CamFrame[] = [];
  for (let t = from; t <= from + ms; t += dt) out.push(s.step(t));
  return out;
}

function make(seed: number, ctx: CameraContext = RECON, level: CameraFx = 'low', aspect = 16 / 9): CameraScheduler {
  const s = new CameraScheduler({ rng: mulberry32(seed), level, aspect });
  s.setContext(ctx);
  return s;
}

const MIN = 60_000;

describe('ГСЧ', () => {
  it('mulberry32 воспроизводим и лежит в [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(new Set(xs).size).toBeGreaterThan(990);
    expect(mulberry32(43)()).not.toBe(mulberry32(42)());
  });
});

describe('числа владельца зафиксированы', () => {
  it('слабо (по умолчанию): сдвиг 1,2 %, поворот 0,5°, масштаб до 1,03; помехи 20–45 с на 150–500 мс; vhs_heavy 6–12 с', () => {
    expect(SHAKE.shiftPct).toBe(1.2);
    expect(SHAKE.rotDeg).toBe(0.5);
    expect(SHAKE.scaleMax).toBe(1.03);
    expect(LEVELS.low.scaleMax).toBe(1.03);
    expect(LEVELS.low.amp).toBe(1);
    expect(LEVELS.low.burstGap).toEqual([20_000, 45_000]);
    expect(LEVELS.low.burstMs).toEqual([150, 500]);
    expect(LEVELS.low.heavyGap).toEqual([6_000, 12_000]);
    expect(HEAVY_STRENGTH).toBeGreaterThan(1); // «чуть сильнее»
    expect(HEAVY_STRENGTH).toBeLessThanOrEqual(1.5);
  });

  it('интенсивность по режиму показа: reconstruction 1, procedural и montage 0,5, talking_head 0,25, остальные — штатив', () => {
    const h = Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, v.handheld]));
    expect(h).toEqual({
      reconstruction: 1,
      procedural: 0.5,
      montage: 0.5,
      talking_head: 0.25,
      chronicle: 0,
      title: 0,
      map: 0,
      document: 0,
      courtroom: 0,
    });
  });

  it('«оператор поправил кадр» — только reconstruction и procedural; HUD записи — только reconstruction', () => {
    const rf = Object.entries(PRESETS).filter(([, v]) => v.reframe).map(([k]) => k).sort();
    expect(rf).toEqual(['procedural', 'reconstruction']);
    const hud = Object.entries(PRESETS).filter(([, v]) => v.recHud).map(([k]) => k);
    expect(hud).toEqual(['reconstruction']);
  });
});

describe('кроп стабилизатора', () => {
  it('без движения масштаб 1; сдвиг и поворот требуют ровно столько масштаба, чтобы края не показывались', () => {
    expect(coverScale(0, 0, 0, 16 / 9)).toBe(1);
    // сдвиг на 1,2 % по обеим осям: с каждой стороны открылось бы 1,2 % → масштаб ≥ 1 + 2 × 0,012
    expect(coverScale(1.2, 1.2, 0, 16 / 9)).toBeCloseTo(1.024, 3);
    // поворот 0,5° на широком кадре: углы «качаются» по вертикали на W/2·sinθ
    expect(coverScale(0, 0, 0.5, 16 / 9)).toBeGreaterThan(1.014);
    expect(coverScale(0, 0, 0.5, 16 / 9)).toBeLessThan(1.02);
    // знак смещения не важен
    expect(coverScale(-1.2, -1.2, 0, 16 / 9)).toBeCloseTo(coverScale(1.2, 1.2, 0, 16 / 9), 6);
  });

  it('fitTransform: масштаб не больше предела, кадр всегда закрыт; слишком большое движение уменьшается пропорционально', () => {
    const fit = fitTransform(1.2, 1.2, 0.5, 16 / 9, 1.002, 1.03);
    expect(fit.scale).toBeLessThanOrEqual(1.03 + 1e-9);
    expect(coverScale(fit.tx, fit.ty, fit.rot, 16 / 9)).toBeLessThanOrEqual(fit.scale + 1e-9);
    expect(Math.abs(fit.tx)).toBeLessThan(1.2); // пришлось уменьшить
    // небольшое движение не трогаем
    const small = fitTransform(0.3, -0.2, 0.1, 16 / 9, 1, 1.03);
    expect([small.tx, small.ty, small.rot]).toEqual([0.3, -0.2, 0.1]);
  });
});

describe('дрожание не постоянное: эпизоды «беспокойства» оператора', () => {
  it('слабо: в покое ≤ 15 % предела, эпизоды раз в 14–32 с по 1,2–2,6 с (+ вход и выход по 1,2 с); сильно — чаще и дольше', () => {
    expect(LEVELS.low.restAmp).toBe(0.15);
    expect(LEVELS.low.unrestGap).toEqual([14_000, 32_000]);
    expect(LEVELS.low.unrestMs).toEqual([1_200, 2_600]);
    expect(LEVELS.high.restAmp).toBe(0.35);
    expect(LEVELS.high.unrestGap).toEqual([6_000, 14_000]);
    expect(LEVELS.high.unrestMs).toEqual([2_000, 4_000]);
    expect(UNREST_RAMP).toBe(1200);
    for (const seed of [2, 11, 23]) {
      const s = make(seed);
      const frames = run(s, 10 * MIN, 33);
      // число эпизодов за 10 минут — из интервалов 14–32 с плюс сам эпизод ≤ 5 с
      expect(s.unrestLog.length).toBeGreaterThanOrEqual(10 * MIN / (32_000 + 5_000) - 1);
      expect(s.unrestLog.length).toBeLessThanOrEqual(10 * MIN / 14_000 + 1);
      // вне эпизодов (с запасом на вход и выход) кадр почти неподвижен: ≤ 15 % предела дрожания
      const calmLimit = SHAKE.shiftPct * LEVELS.low.restAmp + 1e-6;
      let calm = 0;
      let seen = 0;
      frames.forEach((f, i) => {
        const t = i * 33;
        const inside = s.unrestLog.some((t0) => t >= t0 - 40 && t <= t0 + 2 * UNREST_RAMP + LEVELS.low.unrestMs[1] + 40);
        if (f.burst || inside) return;
        seen++;
        if (Math.abs(f.tx) <= calmLimit && Math.abs(f.ty) <= calmLimit) calm++;
      });
      expect(seen).toBeGreaterThan(frames.length * 0.6); // покой — большую часть времени
      expect(calm).toBe(seen);
      // а в эпизодах дрожание доходит до полной амплитуды
      const peak = Math.max(...frames.filter((f) => !f.burst).map((f) => Math.abs(f.tx)));
      expect(peak).toBeGreaterThan(SHAKE.shiftPct * 0.5);
    }
    const strong = make(2, RECON, 'high');
    run(strong, 10 * MIN, 33);
    expect(strong.unrestLog.length).toBeGreaterThan(make(2).unrestLog.length);
  });

  it('огибающая входит и выходит плавно: между соседними кадрами нет скачков и при «сильно»', () => {
    const s = make(9, RECON, 'high');
    const frames = run(s, 3 * MIN, 16);
    let jump = 0;
    for (let i = 1; i < frames.length; i++) {
      if (frames[i]!.burst || frames[i - 1]!.burst) continue;
      jump = Math.max(jump, Math.abs(frames[i]!.tx - frames[i - 1]!.tx), Math.abs(frames[i]!.ty - frames[i - 1]!.ty));
    }
    expect(s.unrestLog.length).toBeGreaterThan(5);
    expect(jump).toBeLessThan(0.08); // % кадра за 16 мс (амплитуда ×1,6)
  });
});

describe('ручная камера (слабо)', () => {
  it('за 20 минут сдвиг ≤ 1,2 %, поворот ≤ 0,5°, масштаб 1,00–1,03, кадр всегда закрыт — на широком и на портретном кадре', () => {
    for (const aspect of [16 / 9, 390 / 473, 2]) {
      for (const seed of [1, 7, 99]) {
        const s = make(seed, RECON, 'low', aspect);
        let peakTx = 0;
        let peakRot = 0;
        let minScale = 9;
        let maxScale = 0;
        for (const f of run(s, 20 * MIN, 33)) {
          if (f.burst) continue; // на время всплеска добавляется дрожание помехи (проверяется ниже)
          peakTx = Math.max(peakTx, Math.abs(f.tx), Math.abs(f.ty));
          peakRot = Math.max(peakRot, Math.abs(f.rot));
          minScale = Math.min(minScale, f.scale);
          maxScale = Math.max(maxScale, f.scale);
          expect(coverScale(f.tx, f.ty, f.rot, aspect)).toBeLessThanOrEqual(f.scale + 1e-6);
        }
        expect(peakTx).toBeLessThanOrEqual(SHAKE.shiftPct + 1e-9);
        expect(peakRot).toBeLessThanOrEqual(SHAKE.rotDeg + 1e-9);
        expect(minScale).toBeGreaterThanOrEqual(1);
        expect(maxScale).toBeLessThanOrEqual(1.03 + 1e-9);
        // дрожание живое, а не нулевое: заметный сдвиг и поворот случаются
        expect(peakTx).toBeGreaterThan(0.4);
        expect(peakRot).toBeGreaterThan(0.1);
      }
    }
  });

  it('движение медленное и непрерывное: между соседними кадрами нет скачков', () => {
    const s = make(5);
    const frames = run(s, 60_000, 16);
    let jump = 0;
    for (let i = 1; i < frames.length; i++) {
      if (frames[i]!.burst || frames[i - 1]!.burst) continue; // рывок помехи проверяется отдельно
      jump = Math.max(jump, Math.abs(frames[i]!.tx - frames[i - 1]!.tx), Math.abs(frames[i]!.ty - frames[i - 1]!.ty));
    }
    expect(jump).toBeLessThan(0.05); // % кадра за 16 мс
  });

  it('сила по режимам: procedural и montage вдвое тише, talking_head вчетверо; штатив стоит неподвижно', () => {
    const peak = (handheld: number): number => {
      const s = make(3, { handheld, reframe: false, filter: 'none' });
      return Math.max(...run(s, 10 * MIN, 33).filter((f) => !f.burst).map((f) => Math.abs(f.tx)));
    };
    const full = peak(1);
    expect(peak(0.5)).toBeLessThanOrEqual(0.6 + 1e-9);
    expect(peak(0.5)).toBeLessThan(full);
    expect(peak(0.25)).toBeLessThanOrEqual(0.3 + 1e-9);
    // штатив: единичная трансформация на всех кадрах
    const still = make(3, { handheld: 0, reframe: false, filter: 'none' });
    for (const f of run(still, 5 * MIN, 50).filter((f) => !f.burst)) {
      expect([f.tx, f.ty, f.rot, f.scale]).toEqual([0, 0, 0, 1]);
    }
  });

  it('«сильно» заметнее «слабо», но края тоже закрыты, а масштаб не больше 1,05', () => {
    const peakOf = (level: CameraFx): number => {
      const s = make(11, RECON, level);
      let peak = 0;
      for (const f of run(s, 10 * MIN, 33)) {
        if (f.burst) continue;
        peak = Math.max(peak, Math.abs(f.tx));
        expect(f.scale).toBeLessThanOrEqual(LEVELS.high.scaleMax + 1e-9);
        expect(coverScale(f.tx, f.ty, f.rot, 16 / 9)).toBeLessThanOrEqual(f.scale + 1e-6);
      }
      return peak;
    };
    expect(peakOf('high')).toBeGreaterThan(peakOf('low'));
  });

  it('выкл: единичная трансформация, помех нет, кадр помечен как выключенный', () => {
    const s = make(1, RECON, 'off');
    for (const f of run(s, 10 * MIN, 100)) expect(f).toEqual(IDLE_FRAME);
    expect(s.burstLog).toEqual([]);
    expect(IDLE_FRAME.on).toBe(false);
  });

  it('детерминированность: то же зерно и те же времена — те же кадры; другое зерно — другие', () => {
    const a = run(make(77), 30_000, 16);
    const b = run(make(77), 30_000, 16);
    expect(a).toEqual(b);
    expect(run(make(78), 30_000, 16)).not.toEqual(a);
  });

  it('после паузы платформы часы не прыгают: шаг ограничен MAX_DT, всплеск не вылетает сразу', () => {
    const s = make(2);
    s.step(0);
    s.step(10_000);
    expect(s.time).toBeLessThanOrEqual(MAX_DT);
    s.step(10_000 + 5 * MIN); // «свернули вкладку на 5 минут»
    expect(s.time).toBeLessThanOrEqual(2 * MAX_DT);
    expect(s.burstLog).toEqual([]);
  });
});

describe('«оператор поправил кадр»', () => {
  const sample = (n: number, strength = 1) => {
    const rng = mulberry32(2026);
    return Array.from({ length: n }, () => makeReframe(rng, 0, strength));
  };

  it('обычная поправка: сдвиг 2–4 %, наклон до 1°, 300–500 мс; «неожиданный ракурс» — поворот 1,2–2°, оседание 2–3 с', () => {
    const all = sample(5000);
    const normal = all.filter((r) => !r.angle);
    const angle = all.filter((r) => r.angle);
    expect(normal.length + angle.length).toBe(5000);
    for (const r of normal) {
      const mag = Math.hypot(r.dx, r.dy / 0.7);
      expect(mag).toBeGreaterThanOrEqual(2 - 1e-6);
      expect(mag).toBeLessThanOrEqual(4 + 1e-6);
      expect(r.dur).toBeGreaterThanOrEqual(300);
      expect(r.dur).toBeLessThanOrEqual(500);
      expect(Math.abs(r.drot)).toBeLessThanOrEqual(1 + 1e-9);
    }
    for (const r of angle) {
      expect(Math.abs(r.drot)).toBeGreaterThanOrEqual(1.2 - 1e-9);
      expect(Math.abs(r.drot)).toBeLessThanOrEqual(2 + 1e-9);
      expect(r.dur).toBeGreaterThanOrEqual(2000);
      expect(r.dur).toBeLessThanOrEqual(3000);
    }
    // ~25 % случаев — неожиданный ракурс
    expect(ANGLE_SHARE).toBe(0.25);
    const share = angle.length / all.length;
    expect(share).toBeGreaterThan(0.22);
    expect(share).toBeLessThan(0.28);
  });

  it('ease-out: поправка быстро сходит на нет и заканчивается ровно к концу', () => {
    const r = makeReframe(mulberry32(1), 1000, 1);
    const start = reframeAt(r, 1000)!;
    expect(Math.abs(start.dx)).toBeCloseTo(Math.abs(r.dx), 6);
    const mid = reframeAt(r, 1000 + r.dur / 2)!;
    expect(Math.abs(mid.dx)).toBeLessThan(Math.abs(r.dx) * 0.2); // за половину времени ушло больше 80 %
    let prev = Infinity;
    for (let u = 0; u < 1; u += 0.05) {
      const o = reframeAt(r, 1000 + u * r.dur)!;
      expect(Math.abs(o.dx)).toBeLessThanOrEqual(prev + 1e-12);
      prev = Math.abs(o.dx);
    }
    expect(reframeAt(r, 1000 + r.dur)).toBeNull();
  });

  it('вход в сцену reconstruction / procedural запускает поправку: кадр заметно смещён и масштабирован, потом оседает', () => {
    const s = make(8);
    run(s, 1000);
    const calm = s.step(1016);
    s.enterScene();
    const kick = s.step(1032);
    // сразу после входа смещение заметно больше предела спокойного дрожания
    const shift = Math.max(Math.abs(kick.tx), Math.abs(kick.ty), Math.abs(kick.rot));
    expect(shift).toBeGreaterThan(SHAKE.shiftPct * 0.9);
    expect(kick.scale).toBeGreaterThan(calm.scale);
    expect(kick.scale).toBeLessThanOrEqual(REFRAME_SCALE_MAX + 1e-9);
    expect(coverScale(kick.tx, kick.ty, kick.rot, 16 / 9)).toBeLessThanOrEqual(kick.scale + 1e-6);
    // через 3,2 секунды (дольше любого оседания) — снова спокойное дрожание в пределах слабого уровня
    const after = run(s, 3300, 16, 1048).slice(-20);
    for (const f of after) {
      expect(Math.abs(f.tx)).toBeLessThanOrEqual(SHAKE.shiftPct + 1e-9);
      expect(f.scale).toBeLessThanOrEqual(1.03 + 1e-9);
    }
  });

  it('в режимах без поправки (хроника, суд, карта …) и при выключенных эффектах вход в сцену ничего не двигает', () => {
    const still = make(4, { handheld: 0, reframe: false, filter: 'none' });
    still.step(0);
    still.enterScene();
    expect(still.step(16)).toMatchObject({ tx: 0, ty: 0, rot: 0, scale: 1 });
    const talking = make(4, { handheld: PRESETS.talking_head.handheld, reframe: false, filter: 'vhs' });
    talking.step(0);
    talking.enterScene();
    expect(Math.abs(talking.step(16).tx)).toBeLessThanOrEqual(0.3 + 1e-9);
    const off = make(4, RECON, 'off');
    off.step(0);
    off.enterScene();
    expect(off.step(16)).toEqual(IDLE_FRAME);
  });
});

describe('помехи: всплески', () => {
  /** Начала и длительности всплесков за `ms` модельного времени. */
  const bursts = (s: CameraScheduler, ms: number): Array<{ start: number; dur: number }> => {
    const out: Array<{ start: number; end: number }> = [];
    let open: { start: number; end: number } | null = null;
    for (let t = 0; t <= ms; t += 16) {
      const f = s.step(t);
      if (f.burst && !open) {
        open = { start: s.time, end: s.time };
        out.push(open);
      }
      if (f.burst && open) open.end = s.time;
      if (!f.burst) open = null;
    }
    return out.map((b) => ({ start: b.start, dur: b.end - b.start }));
  };

  it('слабо: раз в 20–45 с, всплеск 150–500 мс', () => {
    for (const seed of [1, 2, 3, 4]) {
      const s = make(seed);
      const found = bursts(s, 60 * MIN);
      expect(found.length).toBeGreaterThan(60 * MIN / 45_000 - 2);
      expect(found.length).toBeLessThan(60 * MIN / 20_000 + 2);
      const starts = s.burstLog;
      for (let i = 1; i < starts.length; i++) {
        const gap = starts[i]! - starts[i - 1]!;
        expect(gap).toBeGreaterThanOrEqual(20_000 - 1e-6);
        expect(gap).toBeLessThanOrEqual(45_000 + 1e-6);
      }
      // первый всплеск не раньше 20 с после включения
      expect(starts[0]!).toBeGreaterThanOrEqual(20_000);
      for (const b of found) {
        expect(b.dur).toBeGreaterThanOrEqual(150 - 34); // шаг 16 мс: на каждом краю теряется до одного шага
        expect(b.dur).toBeLessThanOrEqual(500 + 1);
      }
    }
  });

  it('помехи редкие: в среднем меньше 2 % времени', () => {
    const s = make(9);
    const frames = run(s, 30 * MIN, 16);
    const share = frames.filter((f) => f.burst).length / frames.length;
    expect(share).toBeLessThan(0.02);
    expect(share).toBeGreaterThan(0);
  });

  it('vhs_heavy: раз в 6–12 с и чуть сильнее', () => {
    const heavy = make(5, HEAVY);
    bursts(heavy, 30 * MIN);
    for (let i = 1; i < heavy.burstLog.length; i++) {
      const gap = heavy.burstLog[i]! - heavy.burstLog[i - 1]!;
      expect(gap).toBeGreaterThanOrEqual(6_000 - 1e-6);
      expect(gap).toBeLessThanOrEqual(12_000 + 1e-6);
    }
    expect(heavy.burstLog.length).toBeGreaterThan(30 * MIN / 12_000 - 2);
    // «чуть сильнее»: сила одного и того же всплеска выше в heavy
    const p = LEVELS.low;
    const normal = makeBurst(mulberry32(1), 0, p, false);
    const stronger = makeBurst(mulberry32(1), 0, p, true);
    expect(stronger.strength).toBeCloseTo(normal.strength * HEAVY_STRENGTH, 9);
  });

  it('сменa фильтра на vhs_heavy и обратно перестраивает ритм помех', () => {
    const s = make(6, RECON);
    s.step(0);
    s.setContext(HEAVY);
    const heavyLog = s.burstLog;
    run(s, 60_000, 16, 16);
    expect(heavyLog.length).toBeGreaterThan(3); // за минуту — не меньше 4 всплесков по 6–12 с
    expect(s.burstLog.length).toBe(heavyLog.length);
  });

  it('кадр всплеска: полоса трекинга ползёт вниз, мерцание яркости в пределах ±1, хроматический сдвиг мал, «снег» ≤ 1', () => {
    const b = makeBurst(mulberry32(3), 1000, LEVELS.low, false);
    let prevY = -1;
    let sawFlicker = false;
    for (let t = 1000; t < 1000 + b.dur; t += 8) {
      const f = burstAt(b, t)!;
      expect(f.bandY).toBeGreaterThanOrEqual(prevY);
      prevY = f.bandY;
      expect(Math.abs(f.flicker)).toBeLessThanOrEqual(1);
      expect(f.chroma).toBeGreaterThanOrEqual(0);
      expect(f.chroma).toBeLessThan(0.01);
      expect(f.snow).toBeLessThanOrEqual(1);
      expect(f.envelope).toBeGreaterThanOrEqual(0);
      expect(f.envelope).toBeLessThanOrEqual(1);
      expect(Math.abs(f.jitter)).toBeLessThan(0.4);
      if (Math.abs(f.flicker) > 0.05) sawFlicker = true;
    }
    expect(sawFlicker).toBe(true);
    expect(burstAt(b, 999)).toBeNull();
    expect(burstAt(b, 1000 + b.dur)).toBeNull();
  });

  it('во время всплеска дрожание картинки добавляет рывок, но край остаётся закрыт', () => {
    const s = make(12);
    s.burstNow();
    for (const f of run(s, 600, 8, 0)) {
      if (!f.burst) continue;
      expect(coverScale(f.tx, f.ty, f.rot, 16 / 9)).toBeLessThanOrEqual(f.scale + 1e-6);
      expect(f.scale).toBeLessThanOrEqual(1.03 + 1e-9);
    }
  });

  it('стоп-кадр: помехи не стартуют, пока кадр заморожен', () => {
    const s = make(13);
    s.setFrozen(true);
    const frames = run(s, 5 * MIN, 50);
    expect(frames.every((f) => f.burst === null && f.frozen)).toBe(true);
    s.setFrozen(false);
    run(s, 2 * MIN, 50, 5 * MIN + 50);
    expect(s.burstLog.length).toBeGreaterThan(0);
  });
});

describe('разрыв кадра (fx vhs_glitch)', () => {
  it('3–6 рывков по 50–90 мс; амплитуда ограничена; в конце кадр возвращается к норме', () => {
    for (const ms of [200, 600, 1500]) {
      const jolts = makeTear(mulberry32(4), 0, ms);
      expect(jolts.length).toBeGreaterThanOrEqual(3);
      expect(jolts.length).toBeLessThanOrEqual(6);
      for (const j of jolts) {
        expect(j.dur).toBeGreaterThanOrEqual(50);
        expect(j.dur).toBeLessThanOrEqual(90);
        expect(Math.abs(j.dy)).toBeLessThanOrEqual(7);
        expect(Math.abs(j.dx)).toBeLessThanOrEqual(2.5);
        expect(j.t0).toBeGreaterThanOrEqual(0);
        expect(j.t0 + j.dur).toBeLessThanOrEqual(ms + 90);
      }
    }
  });

  it('планировщик: во время glitch кадр содержит tear и сдвиг, после — чисто', () => {
    const s = make(14);
    run(s, 500, 16);
    s.glitch(600);
    const during = run(s, 700, 8, 520);
    const torn = during.filter((f) => f.tear);
    expect(torn.length).toBeGreaterThan(3);
    for (const f of torn) {
      expect(f.tear!.snow).toBe(1);
      expect(Math.abs(f.ty)).toBeLessThanOrEqual(SHAKE.shiftPct + 7 + 1e-6);
    }
    const tail = run(s, 600, 16, 1300).slice(-5);
    expect(tail.every((f) => f.tear === null)).toBe(true);
    expect(tearAt([], 0)).toBeNull();
  });

  it('при выключенных эффектах разрыв кадра планировщик не рисует', () => {
    const s = make(15, RECON, 'off');
    s.glitch(600);
    expect(run(s, 700, 16).every((f) => f.tear === null)).toBe(true);
  });
});

describe('стоп-кадр (freeze_frame)', () => {
  it('замораживает дрожание: трансформация постоянна, пока кадр заморожен, и продолжается после', () => {
    const s = make(16);
    run(s, 3000, 16);
    s.setFrozen(true);
    const frozen = run(s, 2000, 16, 3016).filter((f) => !f.burst);
    const ref = frozen[0]!;
    expect(frozen.every((f) => f.tx === ref.tx && f.ty === ref.ty && f.rot === ref.rot && f.scale === ref.scale && f.frozen)).toBe(true);
    s.setFrozen(false);
    const moving = run(s, 2000, 16, 5032).filter((f) => !f.burst);
    expect(new Set(moving.map((f) => f.tx)).size).toBeGreaterThan(10);
  });

  it('заморозка останавливает и поправку оператора', () => {
    const s = make(17);
    s.step(0);
    s.enterScene();
    s.step(16);
    s.setFrozen(true);
    const a = s.step(40);
    const b = s.step(900);
    expect([a.tx, a.ty, a.rot]).toEqual([b.tx, b.ty, b.rot]);
  });
});

describe('зерно', () => {
  it('непрозрачность зерна не больше 5 % при уровне «слабо» (и каждый пиксель — не выше максимума уровня)', () => {
    expect(LEVELS.low.grain).toBeLessThanOrEqual(0.05);
    expect(grainAlphaMax('low')).toBeLessThanOrEqual(Math.floor(0.05 * 255));
    expect(grainAlphaMax('off')).toBe(0);
    expect(grainAlphaMax('high')).toBeGreaterThan(grainAlphaMax('low'));
    const buf = new Uint8ClampedArray(256 * 144 * 4);
    fillGrain(buf, mulberry32(1), grainAlphaMax('low'));
    let maxA = 0;
    let lights = 0;
    for (let i = 0; i < buf.length; i += 4) {
      maxA = Math.max(maxA, buf[i + 3]!);
      if (buf[i] === 255) lights += 1;
      expect(buf[i]).toBe(buf[i + 1]);
      expect(buf[i]).toBe(buf[i + 2]);
    }
    expect(maxA).toBeLessThanOrEqual(grainAlphaMax('low'));
    expect(maxA).toBeGreaterThan(grainAlphaMax('low') - 3); // распределение дотягивает до максимума
    expect(lights / (buf.length / 4)).toBeGreaterThan(0.45); // светлые и тёмные точки поровну
    expect(lights / (buf.length / 4)).toBeLessThan(0.55);
  });
});

describe('моторный зум (fx zoom_in)', () => {
  const target = 1 + ZOOM_AMOUNT;

  it('1,00 → 1,12 за заданное время, с небольшим перелётом и «поиском фокуса» 0 → 1 px → 0', () => {
    expect(ZOOM_AMOUNT).toBe(0.12);
    expect(ZOOM_HUNT_PX).toBe(1);
    expect(zoomCurve(0, target)).toEqual({ scale: 1, blur: 0 });
    const end = zoomCurve(1, target);
    expect(end.scale).toBeCloseTo(target, 9);
    expect(end.blur).toBeCloseTo(0, 9);
    let maxScale = 0;
    let maxBlur = 0;
    let blurAt = 0;
    for (let u = 0; u <= 1; u += 0.005) {
      const s = zoomCurve(u, target);
      expect(s.scale).toBeGreaterThanOrEqual(1);
      if (s.scale > maxScale) maxScale = s.scale;
      if (s.blur > maxBlur) {
        maxBlur = s.blur;
        blurAt = u;
      }
    }
    expect(maxScale).toBeGreaterThan(target); // перелёт
    expect(maxScale).toBeLessThan(target + 0.02); // небольшой
    expect(maxBlur).toBeCloseTo(ZOOM_HUNT_PX, 1);
    expect(blurAt).toBeGreaterThan(0.6); // фокус ищется в конце движения
    expect(zoomCurve(0.3, target).blur).toBe(0);
  });

  it('без перелёта и размытия, когда эффекты камеры выключены: гладкий монотонный зум', () => {
    let prev = 0;
    for (let u = 0; u <= 1; u += 0.01) {
      const s = zoomCurve(u, target, false);
      expect(s.blur).toBe(0);
      expect(s.scale).toBeGreaterThanOrEqual(prev);
      expect(s.scale).toBeLessThanOrEqual(target + 1e-9);
      prev = s.scale;
    }
  });

  it('ключевые кадры для Web Animations: от 1 до цели, смещения по возрастанию', () => {
    const kf = zoomKeyframes(target, true, 20);
    expect(kf).toHaveLength(21);
    expect(kf[0]).toMatchObject({ offset: 0, transform: 'scale(1.0000)', filter: 'none' });
    expect(kf[20]!.transform).toBe(`scale(${target.toFixed(4)})`);
    expect(kf.some((k) => k.filter.startsWith('blur('))).toBe(true);
    for (let i = 1; i < kf.length; i++) expect(kf[i]!.offset).toBeGreaterThan(kf[i - 1]!.offset);
    expect(zoomKeyframes(target, false).every((k) => k.filter === 'none')).toBe(true);
  });
});

describe('камкордер: искажения записи (шейдер vhs_filter.ts)', () => {
  it('профиль сигнала: «выкл» — нет, «сильно» сильнее «слабо» по всем искажениям', () => {
    expect(signalFor('off', false)).toBeNull();
    const low = signalFor('low', false)!;
    const high = signalFor('high', false)!;
    for (const k of ['lumaSmear', 'ringing', 'chromaBleed', 'chromaDelay', 'lumaNoise', 'chromaNoise', 'snow', 'dropout', 'jitter', 'edgeWave', 'headSwitch', 'chromaPhase'] as const) {
      expect(high[k], k).toBeGreaterThan(low[k]);
    }
    expect(high.saturation).toBeLessThan(low.saturation); // запись сильнее теряет цвет
    expect(low.crawl).toBe(0); // на «слабо» цвет в яркость не просачивается
    expect(low.interlace).toBe(0); // и строк чересстрочности нет (муар на хронике с Ken Burns)
  });

  it('«слабо» бережёт картинку: яркость почти не размыта, шум и снег редкие', () => {
    const low = signalFor('low', false)!;
    expect(low.lumaSmear).toBeLessThanOrEqual(1);
    expect(low.lumaNoise).toBeLessThanOrEqual(0.04);
    expect(low.snow).toBeLessThanOrEqual(0.002);
    expect(low.dropout).toBeLessThanOrEqual(0.002);
  });

  it('vhs_heavy: лента «старше» — шум, снег, выпадения и дрожание строк × HEAVY_STRENGTH, строки чересстрочности есть', () => {
    const base = signalFor('low', false)!;
    const heavy = signalFor('low', true)!;
    for (const k of ['lumaNoise', 'chromaNoise', 'snow', 'dropout', 'jitter', 'edgeWave'] as const) {
      expect(heavy[k], k).toBeCloseTo(base[k] * HEAVY_STRENGTH, 9);
    }
    expect(heavy.lumaSmear).toBe(base.lumaSmear); // мягче картинка не становится
    expect(heavy.interlace).toBeGreaterThan(0);
  });

  it('виртуальные строки: не тоньше двух пикселей (без муара на телефоне), от 120 до 480', () => {
    expect(virtualLines(1080)).toBe(480);
    expect(virtualLines(720)).toBe(360);
    expect(virtualLines(438)).toBe(219); // телефон: картинка 16:9 по ширине, разрешение 2
    expect(virtualLines(100)).toBe(120);
    expect(virtualLines(4000)).toBe(VIRTUAL_LINES);
  });

  it('униформы кадра: камера в долях кадра и радианах, номер кадра и время свёрнуты, помехи и шов — из кадра планировщика', () => {
    const s = new CameraScheduler({ rng: mulberry32(3), level: 'low' });
    s.setContext({ handheld: 1, reframe: true, filter: 'vhs' });
    s.burstNow();
    const f = s.step(0);
    const u = vhsUniforms({ frame: { ...f, tx: 1.5, ty: -0.5, rot: 0.5, scale: 1.02 }, signal: signalFor('low', false)!, timeMs: 1_234_567, frameNo: 5000, heightPx: 720, yDown: true });
    expect(u.uCam[0]).toBeCloseTo(0.015, 9);
    expect(u.uCam[1]).toBeCloseTo(-0.005, 9);
    expect(u.uCam[2]).toBeCloseTo((0.5 * Math.PI) / 180, 9);
    expect(u.uCam[3]).toBeCloseTo(1.02, 9);
    expect(u.uClock[0]).toBeLessThan(600); // время свёрнуто: mediump не теряет точность за долгую сессию
    expect(u.uClock[1]).toBeLessThan(1009);
    expect(u.uClock[2]).toBe(360);
    expect(u.uClock[3]).toBe(1);
    expect(u.uBurst[0]).toBeGreaterThanOrEqual(0); // всплеск идёт: сила — огибающая × сила
    expect(u.uBurst[2]).toBeGreaterThan(0); // высота полосы трекинга
    const idle = vhsUniforms({ frame: IDLE_FRAME, signal: signalFor('high', false)!, timeMs: 0, frameNo: 0, heightPx: 1080, yDown: false });
    expect(idle.uBurst).toEqual([0, 0, 0, 0]);
    expect(idle.uTear).toEqual([0, 0, 0, 0]);
    expect(idle.uClock[3]).toBe(-1);
  });
});
