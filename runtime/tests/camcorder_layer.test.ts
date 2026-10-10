// @vitest-environment jsdom
/**
 * Камкордер, DOM-часть (src/stage/camcorder_layer.ts): цикл rAF, одна CSS-трансформация обёртки кадра,
 * один canvas зерна и помех (12–15 к/с), классы HUD, пауза, скрытая вкладка, prefers-reduced-motion.
 * Время, rAF, ГСЧ и 2D-контекст подменены — браузер не нужен.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { grainAlphaMax, mulberry32 } from '../src/stage/camcorder';
import type { CameraFx } from '../src/stage/camcorder';
import { CamcorderLayer, NOISE_FPS, OVERLAY_WIDTH, PERF, STEP_FPS } from '../src/stage/camcorder_layer';
import type { DegradeInfo, Overlay2D } from '../src/stage/camcorder_layer';

class FakeCtx implements Overlay2D {
  fillStyle: string | CanvasGradient | CanvasPattern = '';
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  readonly fills: Array<{ style: string; x: number; y: number; w: number; h: number }> = [];
  readonly images: ImageData[] = [];
  puts = 0;
  clears = 0;
  fillRect(x: number, y: number, w: number, h: number): void {
    this.fills.push({ style: String(this.fillStyle), x, y, w, h });
  }
  clearRect(): void {
    this.clears += 1;
  }
  putImageData(): void {
    this.puts += 1;
  }
  createImageData(w: number, h: number): ImageData {
    const img = { data: new Uint8ClampedArray(w * h * 4), width: w, height: h } as ImageData;
    this.images.push(img);
    return img;
  }
}

const rigs: CamcorderLayer[] = [];

interface RigInit {
  level?: CameraFx;
  reduced?: boolean;
  /** По умолчанию в тестах кадр дрожания обновляется на каждый кадр rAF (без ограничения 30 Гц). */
  stepFps?: number;
  /** По умолчанию самозащита выключена: тесты крутят цикл на нереальных частотах. */
  adaptive?: boolean;
  onDegrade?: (i: DegradeInfo) => void;
}

function rig(init: RigInit = {}) {
  const stage = document.createElement('div');
  stage.className = 'vn-stage';
  const hand = document.createElement('div');
  const canvas = document.createElement('canvas');
  stage.append(hand, canvas);
  document.body.appendChild(stage);
  let next = 1;
  let pending: Array<{ id: number; cb: (ts: number) => void }> = [];
  const state = { reduced: init.reduced ?? false, hidden: false };
  const listeners: Array<() => void> = [];
  const ctx = new FakeCtx();
  const layer = new CamcorderLayer({
    stage,
    hand,
    canvas,
    rng: mulberry32(5),
    raf: (cb) => {
      const id = next++;
      pending.push({ id, cb });
      return id;
    },
    caf: (id) => {
      pending = pending.filter((p) => p.id !== id);
    },
    reducedMotion: () => state.reduced,
    onReducedMotionChange: (cb) => {
      listeners.push(cb);
      return () => undefined;
    },
    isHidden: () => state.hidden,
    context: ctx,
    stepFps: init.stepFps ?? Number.POSITIVE_INFINITY,
    adaptive: init.adaptive ?? false,
    ...(init.onDegrade ? { onDegrade: init.onDegrade } : {}),
  });
  rigs.push(layer);
  if (init.level) layer.setLevel(init.level);
  /** Выполнить кадры анимации: время ts, мс. */
  const tick = (ts: number): void => {
    const batch = pending;
    pending = [];
    for (const p of batch) p.cb(ts);
  };
  /** Прогнать `ms` модельных мс шагом 16. */
  const run = (ms: number, from = 0): void => {
    for (let t = from; t <= from + ms; t += 16) tick(t);
  };
  return { layer, stage, hand, canvas, ctx, state, listeners, tick, run, queued: () => pending.length };
}

afterEach(() => {
  for (const l of rigs.splice(0)) l.destroy();
  document.body.replaceChildren();
});

describe('CamcorderLayer: цикл', () => {
  it('без сцены цикл не идёт; когда сцена на экране и эффекты включены — идёт, а трансформация ложится на обёртку кадра', () => {
    const r = rig();
    expect(r.layer.running).toBe(false);
    expect(r.queued()).toBe(0);
    r.layer.setContext('reconstruction', 'vhs');
    expect(r.layer.running).toBe(false); // сцены ещё нет
    r.layer.setActive(true);
    expect(r.layer.running).toBe(true);
    expect(r.queued()).toBe(1);
    r.run(500);
    expect(r.hand.style.transform).toMatch(/^translate3d\(-?[\d.]+%, -?[\d.]+%, 0\) rotate\(-?[\d.]+deg\) scale\(1\.\d+\)$/);
    expect(r.queued()).toBe(1); // следующий кадр уже запрошен
    expect(r.layer.lastFrame?.on).toBe(true);
  });

  it('трансформация только на обёртке: ни сцена, ни холст помех не получают transform; в режиме «штатив» — единичная', () => {
    const r = rig();
    r.layer.setContext('chronicle', 'archive_photo'); // хроника: штатив
    r.layer.setActive(true);
    r.run(300);
    expect(r.hand.style.transform).toMatch(/translate3d\(0.000%, 0.000%, 0\) rotate\(0.000deg\) scale\(1.0000\)/);
    expect(r.stage.style.transform).toBe('');
    expect(r.canvas.style.transform).toBe('');
  });

  it('«выкл»: цикл не запускается вообще, класс cam-on снят, трансформации и оверлея нет', () => {
    const r = rig({ level: 'off' });
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setActive(true);
    expect(r.layer.running).toBe(false);
    expect(r.queued()).toBe(0);
    expect(r.stage.classList.contains('cam-on')).toBe(false);
    expect(r.stage.classList.contains('cam-rec')).toBe(false);
    expect(r.stage.dataset.cam).toBe('off');
    expect(r.hand.style.transform).toBe('');
  });

  it('выключение посреди игры снимает цикл и очищает трансформацию; включение возвращает', () => {
    const r = rig();
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setActive(true);
    r.run(200);
    expect(r.hand.style.transform).not.toBe('');
    r.layer.setLevel('off');
    expect(r.layer.running).toBe(false);
    expect(r.hand.style.transform).toBe('');
    r.layer.setLevel('high');
    expect(r.layer.running).toBe(true);
    expect(r.stage.dataset.cam).toBe('high');
  });

  it('prefers-reduced-motion принудительно выключает эффекты, даже если выбрано «сильно»; смена настройки ОС подхватывается', () => {
    const r = rig({ level: 'high', reduced: true });
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setActive(true);
    expect(r.layer.effectiveLevel).toBe('off');
    expect(r.layer.reducedMotion).toBe(true);
    expect(r.layer.running).toBe(false);
    expect(r.stage.classList.contains('cam-on')).toBe(false);
    // игрок убрал «уменьшение движения» в системе
    r.state.reduced = false;
    for (const cb of r.listeners) cb();
    expect(r.layer.effectiveLevel).toBe('high');
    expect(r.layer.running).toBe(true);
  });

  it('пауза платформы и скрытая вкладка останавливают цикл, возврат — запускает; кадр не сбрасывается', () => {
    const r = rig();
    r.layer.setContext('procedural', 'none');
    r.layer.setActive(true);
    r.run(300);
    const before = r.hand.style.transform;
    r.layer.setPaused(true);
    expect(r.layer.running).toBe(false);
    expect(r.queued()).toBe(0);
    expect(r.hand.style.transform).toBe(before); // «замер» на месте
    r.layer.setPaused(false);
    expect(r.layer.running).toBe(true);
    r.state.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(r.layer.running).toBe(false);
    r.state.hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(r.layer.running).toBe(true);
  });

  it('мини-игра (setSuspended): цикл стоит, обёртка без трансформации — интерфейс не трясётся; после неё всё возвращается', () => {
    const r = rig();
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setActive(true);
    r.run(300);
    expect(r.hand.style.transform).not.toBe('');
    r.layer.setSuspended(true);
    expect(r.layer.running).toBe(false);
    expect(r.hand.style.transform).toBe('');
    r.layer.setSuspended(false);
    expect(r.layer.running).toBe(true);
  });

  it('destroy снимает цикл и трансформацию', () => {
    const r = rig();
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setActive(true);
    r.run(100);
    r.layer.destroy();
    expect(r.layer.running).toBe(false);
    expect(r.hand.style.transform).toBe('');
  });
});

describe('CamcorderLayer: HUD записи', () => {
  it('cam-rec (REC и точка) только в reconstruction при включённых эффектах', () => {
    const r = rig();
    r.layer.setActive(true);
    for (const [p, filter, rec] of [
      ['reconstruction', 'vhs', true],
      ['procedural', 'none', false],
      ['chronicle', 'archive_photo', false],
      ['talking_head', 'vhs', false],
      ['courtroom', 'desaturated', false],
      ['reconstruction', 'vhs_heavy', true],
    ] as const) {
      r.layer.setContext(p, filter);
      expect(r.stage.classList.contains('cam-rec'), `${p}/${filter}`).toBe(rec);
    }
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setLevel('off');
    expect(r.stage.classList.contains('cam-rec')).toBe(false);
    r.layer.setLevel('low');
    expect(r.stage.classList.contains('cam-rec')).toBe(true);
  });

  it('виньетка и интерлейс настраиваются CSS-переменными уровня', () => {
    const r = rig();
    expect(r.stage.style.getPropertyValue('--cam-vignette')).toBe('0.28');
    expect(Number(r.stage.style.getPropertyValue('--cam-interlace'))).toBeGreaterThan(0);
    r.layer.setLevel('off');
    expect(r.stage.style.getPropertyValue('--cam-vignette')).toBe('0');
    expect(r.stage.style.getPropertyValue('--cam-interlace')).toBe('0');
  });
});

describe('CamcorderLayer: canvas зерна и помех', () => {
  it('размер оверлея низкий (≈ 256 px по ширине) и подстраивается под пропорции кадра', () => {
    const r = rig();
    expect(OVERLAY_WIDTH).toBe(256);
    expect(r.canvas.width).toBe(256);
    expect(r.canvas.height).toBe(144);
  });

  it('оверлей перерисовывается 12–15 раз в секунду, а не на каждый кадр анимации', () => {
    expect(NOISE_FPS).toBeGreaterThanOrEqual(12);
    expect(NOISE_FPS).toBeLessThanOrEqual(15);
    const r = rig();
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setActive(true);
    r.ctx.puts = 0;
    r.run(1000, 1000); // 1 с при 60 к/с
    expect(r.ctx.puts).toBeGreaterThanOrEqual(11);
    expect(r.ctx.puts).toBeLessThanOrEqual(15);
  });

  it('зерно: непрозрачность каждого пикселя ≤ 5 % (alpha ≤ 13/255) при «слабо»; «сильно» — больше; «выкл» — зерна нет', () => {
    const r = rig();
    const maxAlpha = (imgs: ImageData[]): number => {
      let m = 0;
      for (const img of imgs) for (let k = 3; k < img.data.length; k += 4) m = Math.max(m, img.data[k]!);
      return m;
    };
    const low = maxAlpha(r.ctx.images);
    expect(r.ctx.images.length).toBeGreaterThanOrEqual(4); // несколько заранее посчитанных кадров зерна
    expect(low).toBeLessThanOrEqual(13);
    expect(low).toBeLessThanOrEqual(grainAlphaMax('low'));
    r.ctx.images.length = 0;
    r.layer.setLevel('high');
    expect(maxAlpha(r.ctx.images)).toBeGreaterThan(low);
    r.ctx.images.length = 0;
    r.layer.setLevel('off');
    expect(r.ctx.images).toHaveLength(0);
  });

  it('всплеск помех рисуется на оверлее: полоса трекинга, мерцание, хроматические штрихи; класс cam-burst на время всплеска', () => {
    const r = rig();
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setActive(true);
    r.run(200);
    r.ctx.fills.length = 0;
    r.layer.force('burst');
    r.run(120, 216);
    expect(r.stage.classList.contains('cam-burst')).toBe(true);
    const styles = r.ctx.fills.map((f) => f.style);
    expect(styles.some((s) => s.startsWith('rgba(255,255,255,'))).toBe(true); // кромка полосы
    expect(styles.some((s) => s.startsWith('rgba(255,40,70,'))).toBe(true); // красный штрих
    expect(styles.some((s) => s.startsWith('rgba(40,210,255,'))).toBe(true); // голубой штрих
    expect(r.ctx.fills.some((f) => f.w === OVERLAY_WIDTH && f.h <= 40 && f.h >= 3)).toBe(true); // полоса на всю ширину
    r.run(800, 400); // всплеск (≤ 500 мс) закончился
    expect(r.stage.classList.contains('cam-burst')).toBe(false);
  });

  it('в спокойные кадры помех на оверлее нет (только зерно)', () => {
    const r = rig();
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setActive(true);
    r.run(500);
    r.ctx.fills.length = 0;
    r.run(300, 516);
    expect(r.ctx.fills).toHaveLength(0);
  });

  it('разрыв кадра: рисует Камкордер (true), шумовые полосы на шве и открывшемся крае; при выключенных эффектах — false (нужен CSS)', () => {
    const off = rig({ level: 'off' });
    expect(off.layer.glitch(500)).toBe(false);
    const r = rig();
    expect(r.layer.glitch(500)).toBe(false); // цикл ещё не идёт
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setActive(true);
    r.run(100);
    expect(r.layer.glitch(500)).toBe(true);
    r.ctx.fills.length = 0;
    r.run(700, 116);
    expect(r.ctx.fills.some((f) => f.style.startsWith('rgba(0,0,0,0.85') && f.w === OVERLAY_WIDTH)).toBe(true); // чёрная полоса открывшегося края
    expect(r.ctx.fills.length).toBeGreaterThan(20); // шум на шве
  });

  it('стоп-кадр: трансформация не меняется, пока заморожено', () => {
    const r = rig();
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setActive(true);
    r.run(400);
    r.layer.freeze(true);
    r.run(60, 416);
    const t = r.hand.style.transform;
    r.run(1500, 480);
    expect(r.hand.style.transform).toBe(t);
    r.layer.freeze(false);
    r.run(1500, 2000);
    expect(r.hand.style.transform).not.toBe(t);
  });

  it('поправка оператора при входе в сцену заметно смещает кадр, затем кадр оседает', () => {
    const r = rig();
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setActive(true);
    r.run(500);
    r.layer.enterScene();
    r.tick(532);
    const kicked = r.layer.lastFrame!;
    expect(Math.max(Math.abs(kicked.tx), Math.abs(kicked.ty), Math.abs(kicked.rot))).toBeGreaterThan(1);
    r.run(3500, 548);
    const settled = r.layer.lastFrame!;
    expect(Math.abs(settled.tx)).toBeLessThanOrEqual(1.2 + 1e-9);
    expect(settled.scale).toBeLessThanOrEqual(1.03 + 1e-9);
  });
});

describe('CamcorderLayer: частота обновления кадра дрожания (30 Гц)', () => {
  /** Сколько раз за `ms` модельных мс планировщик сделал шаг при rAF с периодом `period`. */
  function stepsOver(period: number, ms: number, jitter = 0): number {
    const r = rig({ stepFps: STEP_FPS });
    const spy = vi.spyOn(r.layer.scheduler, 'step');
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setActive(true);
    let t = 100;
    for (let i = 0; t < 100 + ms; i++) {
      r.tick(t);
      t += period + (jitter && i % 2 ? jitter : -jitter);
    }
    return spy.mock.calls.length;
  }

  it('константа — 30 к/с: камкордер снимает 25–30 к/с, а не 60', () => {
    expect(STEP_FPS).toBe(30);
  });

  it('на дисплее 60 Гц обновляется каждый второй кадр (≈ 30 в секунду), на 120 Гц — каждый четвёртый', () => {
    expect(stepsOver(1000 / 60, 2000)).toBeGreaterThanOrEqual(58);
    expect(stepsOver(1000 / 60, 2000)).toBeLessThanOrEqual(62);
    expect(stepsOver(1000 / 120, 2000)).toBeGreaterThanOrEqual(58);
    expect(stepsOver(1000 / 120, 2000)).toBeLessThanOrEqual(62);
  });

  it('неровный ритм rAF (16 / 17,4 мс) ритм обновлений не ломает: шаги идут через кадр, без «двойных» и пропущенных', () => {
    const n = stepsOver(16.7, 3000, 0.7);
    expect(n).toBeGreaterThanOrEqual(88);
    expect(n).toBeLessThanOrEqual(92);
  });

  it('если браузер и так медленнее 30 к/с (20 или 24 к/с), шаг делается на каждом кадре — ничего не теряется', () => {
    expect(stepsOver(50, 2000)).toBeGreaterThanOrEqual(39);
    expect(stepsOver(1000 / 24, 2000)).toBeGreaterThanOrEqual(47);
  });

  it('первый кадр после запуска цикла рисуется сразу; трансформация и оверлей обновляются на одних и тех же кадрах', () => {
    const r = rig({ stepFps: STEP_FPS });
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setActive(true);
    r.tick(1000);
    expect(r.layer.lastFrame).not.toBeNull();
    expect(r.hand.style.transform).not.toBe('');
    const puts = r.ctx.puts;
    r.tick(1016); // пропущенный кадр: ничего не меняется
    expect(r.ctx.puts).toBe(puts);
    const f = r.layer.lastFrame;
    r.tick(1033);
    expect(r.layer.lastFrame).not.toBe(f);
  });

  it('после паузы и возобновления цикла первый кадр тоже рисуется сразу', () => {
    const r = rig({ stepFps: STEP_FPS });
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setActive(true);
    r.tick(1000);
    r.layer.setPaused(true);
    r.layer.setPaused(false);
    const f = r.layer.lastFrame;
    r.tick(1005); // всего 5 мс после предыдущего шага, но цикл новый
    expect(r.layer.lastFrame).not.toBe(f);
  });
});

describe('CamcorderLayer: зерно и помехи при обновлении кадра 30 Гц', () => {
  /** Перерисовок оверлея в секунду при rAF с периодом `period` (и неровностью `jitter`) на настоящем ограничении 30 Гц. */
  function putsPerSecond(period: number, jitter = 0): number {
    const r = rig({ stepFps: STEP_FPS });
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setActive(true);
    r.ctx.puts = 0;
    let t = 1000;
    for (let i = 0; t < 11_000; i++) {
      r.tick(t);
      t += period + (jitter && i % 2 ? jitter : -jitter);
    }
    return r.ctx.puts / 10;
  }

  it('оверлей рисуется на каждом втором шаге — 15 к/с, а не 10: укладывается в 12–15 на дисплеях 60 Гц, 120 Гц и 30 Гц', () => {
    for (const [name, period, jitter] of [['60 Гц', 1000 / 60, 0], ['60 Гц с неровным ритмом', 16.7, 1.5], ['120 Гц', 1000 / 120, 0], ['30 Гц', 1000 / 30, 0]] as const) {
      const fps = putsPerSecond(period, jitter);
      expect(fps, name).toBeGreaterThanOrEqual(NOISE_FPS - 1);
      expect(fps, name).toBeLessThanOrEqual(15.2);
    }
  });

  it('на медленном браузере (25 к/с) оверлей рисуется не реже 12 раз в секунду', () => {
    expect(putsPerSecond(40)).toBeGreaterThanOrEqual(12);
  });
});

describe('CamcorderLayer: самозащита от слабого устройства', () => {
  /** Крутит цикл с периодом `period` мс от `from` до `to`. */
  const frames = (r: ReturnType<typeof rig>, period: number, from: number, to: number): number => {
    let t = from;
    for (; t <= to; t += period) r.tick(t);
    return t;
  };

  it('пороги: прогрев 2,5 с, окно 4 с, медленным считается интервал дольше 50 мс (< 20 к/с)', () => {
    expect(PERF.warmupMs).toBe(2500);
    expect(PERF.windowMs).toBe(4000);
    expect(PERF.slowMs).toBe(50);
    expect(1000 / PERF.slowMs).toBe(20);
  });

  it('стабильные 60 к/с, 30 к/с и «плохие» 25 к/с (40 мс) эффекты не выключают', () => {
    for (const period of [16.7, 33.3, 40]) {
      const r = rig({ adaptive: true, stepFps: STEP_FPS });
      r.layer.setContext('reconstruction', 'vhs');
      r.layer.setActive(true);
      frames(r, period, 0, 30_000);
      expect(r.layer.degradedByPerformance, `${period} мс`).toBe(false);
      expect(r.layer.effectiveLevel).toBe('low');
      expect(r.layer.running).toBe(true);
    }
  });

  it('стабильно ≈ 12 к/с (80 мс): после прогрева и окна эффекты выключаются, цикл стоит, кадр без трансформации, об этом сообщается один раз', () => {
    const seen: DegradeInfo[] = [];
    const r = rig({ adaptive: true, onDegrade: (i) => seen.push(i) });
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setActive(true);
    frames(r, 80, 0, PERF.warmupMs + PERF.windowMs - 200);
    expect(r.layer.degradedByPerformance).toBe(false); // окно ещё не набралось
    frames(r, 80, PERF.warmupMs + PERF.windowMs - 200, PERF.warmupMs + PERF.windowMs + 800);
    expect(r.layer.degradedByPerformance).toBe(true);
    expect(r.layer.effectiveLevel).toBe('off');
    expect(r.layer.running).toBe(false);
    expect(r.queued()).toBe(0);
    expect(r.hand.style.transform).toBe('');
    expect(r.stage.classList.contains('cam-on')).toBe(false);
    expect(r.stage.classList.contains('cam-rec')).toBe(false);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.fps).toBeGreaterThan(11);
    expect(seen[0]!.fps).toBeLessThan(14);
    expect(seen[0]!.avgMs).toBeGreaterThan(75);
  });

  it('по умолчанию сообщение — одна строка console.info (не warn и не error)', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = rig({ adaptive: true });
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setActive(true);
    frames(r, 90, 0, 9000);
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]![0])).toMatch(/^\[camcorder\] \d+ к\/с: эффекты камеры выключены/);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    info.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });

  it('прогрев: медленные кадры в первые 2,5 с (загрузка текстур) не считаются', () => {
    const r = rig({ adaptive: true });
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setActive(true);
    const t = frames(r, 120, 0, PERF.warmupMs - 100); // тормозит только при входе
    frames(r, 16.7, t, t + 20_000);
    expect(r.layer.degradedByPerformance).toBe(false);
  });

  it('разовый длинный кадр (сборка мусора, сон вкладки) весит не больше hitchMs и защиту не включает', () => {
    const r = rig({ adaptive: true });
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setActive(true);
    let t = frames(r, 16.7, 0, 6000);
    for (let i = 0; i < 5; i++) {
      t += 2500; // кадр вне вкладки
      r.tick(t);
      t = frames(r, 16.7, t + 16.7, t + 8000);
    }
    expect(r.layer.degradedByPerformance).toBe(false);
  });

  it('скрытая вкладка: после возврата измерение начинается заново (огромный интервал не засчитывается)', () => {
    const r = rig({ adaptive: true });
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setActive(true);
    const t = frames(r, 16.7, 0, 8000);
    r.state.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(r.layer.running).toBe(false);
    r.state.hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(r.layer.running).toBe(true);
    frames(r, 16.7, t + 600_000, t + 600_000 + 12_000);
    expect(r.layer.degradedByPerformance).toBe(false);
  });

  it('adaptive: false (автоматизация, тесты) — защита не срабатывает даже на 5 к/с', () => {
    const r = rig({ adaptive: false });
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setActive(true);
    frames(r, 200, 0, 30_000);
    expect(r.layer.degradedByPerformance).toBe(false);
    expect(r.layer.running).toBe(true);
  });

  it('по умолчанию (опция не задана) защита включена, а под navigator.webdriver — выключена', () => {
    const build = (): CamcorderLayer => {
      const stage = document.createElement('div');
      const hand = document.createElement('div');
      const canvas = document.createElement('canvas');
      let pending: Array<(ts: number) => void> = [];
      const layer = new CamcorderLayer({
        stage,
        hand,
        canvas,
        rng: mulberry32(1),
        raf: (cb) => (pending.push(cb), pending.length),
        caf: () => undefined,
        reducedMotion: () => false,
        isHidden: () => false,
        context: new FakeCtx(),
        onDegrade: () => undefined,
      });
      rigs.push(layer);
      layer.setContext('reconstruction', 'vhs');
      layer.setActive(true);
      for (let t = 0; t < 10_000; t += 100) {
        const batch = pending;
        pending = [];
        for (const cb of batch) cb(t);
      }
      return layer;
    };
    expect(build().degradedByPerformance).toBe(true);
    Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => true });
    try {
      expect(build().degradedByPerformance).toBe(false);
    } finally {
      delete (navigator as unknown as Record<string, unknown>).webdriver;
    }
  });

  it('выбор игрока не теряется: пока защита держит «выкл», setLevel с прежним уровнем её не снимает, смена уровня или явный выбор — снимает', () => {
    const r = rig({ adaptive: true, onDegrade: () => undefined });
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setActive(true);
    frames(r, 100, 0, 9000);
    expect(r.layer.degradedByPerformance).toBe(true);
    r.layer.setLevel('low'); // любая правка настроек вызывает это повторно
    expect(r.layer.degradedByPerformance).toBe(true);
    expect(r.layer.running).toBe(false);
    r.layer.setLevel('low', true); // игрок сам нажал «Слабо»
    expect(r.layer.degradedByPerformance).toBe(false);
    expect(r.layer.effectiveLevel).toBe('low');
    expect(r.layer.running).toBe(true);
    // и снова защита, потом другой уровень
    frames(r, 100, 20_000, 29_000);
    expect(r.layer.degradedByPerformance).toBe(true);
    r.layer.setLevel('high');
    expect(r.layer.degradedByPerformance).toBe(false);
    expect(r.layer.effectiveLevel).toBe('high');
  });

  it('после снятия защиты измерение идёт заново: прогрев и окно отсчитываются от нового запуска цикла', () => {
    const r = rig({ adaptive: true, onDegrade: () => undefined });
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setActive(true);
    frames(r, 100, 0, 9000);
    expect(r.layer.degradedByPerformance).toBe(true);
    r.layer.setLevel('low', true);
    // всё то же устройство, но кадры теперь быстрые
    frames(r, 16.7, 100_000, 130_000);
    expect(r.layer.degradedByPerformance).toBe(false);
  });

  it('prefers-reduced-motion имеет приоритет и не зависит от защиты: цикл не запускается вовсе', () => {
    const r = rig({ adaptive: true, reduced: true });
    r.layer.setContext('reconstruction', 'vhs');
    r.layer.setActive(true);
    expect(r.layer.running).toBe(false);
    expect(r.layer.degradedByPerformance).toBe(false);
  });
});

describe('CamcorderLayer: без 2D-контекста', () => {
  it('нет контекста (старый WebView): помех и зерна нет, но дрожание кадра работает и ошибок нет', () => {
    const stage = document.createElement('div');
    const hand = document.createElement('div');
    const canvas = document.createElement('canvas');
    const loop: { cb: ((ts: number) => void) | null } = { cb: null };
    const layer = new CamcorderLayer({ stage, hand, canvas, rng: mulberry32(1), raf: (f) => ((loop.cb = f), 1), caf: () => undefined, reducedMotion: () => false, isHidden: () => false, context: null });
    layer.setContext('reconstruction', 'vhs');
    layer.setActive(true);
    for (let t = 0; t < 400; t += 16) loop.cb?.(t);
    expect(hand.style.transform).not.toBe('');
    layer.force('burst');
    expect(() => loop.cb?.(500)).not.toThrow();
    layer.destroy();
  });

  it('getContext бросает исключение — слой просто работает без оверлея', () => {
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockImplementation(() => {
      throw new Error('нет 2d');
    });
    expect(() => new CamcorderLayer({ stage: document.createElement('div'), hand: document.createElement('div'), canvas, rng: mulberry32(1), raf: () => 1, caf: () => undefined, reducedMotion: () => false, isHidden: () => false })).not.toThrow();
  });
});
