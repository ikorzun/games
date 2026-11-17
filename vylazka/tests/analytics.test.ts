import { describe, expect, it } from 'vitest';
import { Analytics, ANALYTICS_EVENTS, LIFECYCLE_MESSAGES } from '../src/analytics/events';
import { BUILD_VERSION } from '../src/core/build';
import type { PlayContext } from '../src/analytics/events';
import { PERF, PerfWindow } from '../src/analytics/perf';
import type { StepEvents } from '../src/game';
import { WORLD_KINDS } from '../src/gen/layout';
import { Lifecycle } from '../src/lifecycle';
import { AdBreaks, ADS, LIMBO_BEAT_MS, LIMBO_PLACEMENT } from '../src/platform/ads';
import type { TrackData } from '../src/platform/types';
import { ALL_MEMORIES } from '../src/systems/session';

type Call = [string, TrackData | undefined];
type Step = Pick<StepEvents, 'session' | 'fear' | 'dream'>;

/** Поддельная площадка: записывает всё, что ушло через track. */
function rig(over: Partial<PlayContext> = {}) {
  const calls: Call[] = [];
  const lifecycle = new Lifecycle();
  let now = 0;
  const ctx: PlayContext = { world: 'station', laps: 2, stage: 1, n: 3, scenes: false, test: false, quality: 'high', settings: { sound: true, lang: 'auto', sens: 1, bright: 1, flash: 'full', place: 'shelter' }, ...over };
  const a = new Analytics({ track: (e, d) => void calls.push([e, d]) }, lifecycle, () => ctx, () => now);
  return {
    a,
    calls,
    ctx,
    lifecycle,
    at: (ms: number) => void (now = ms),
    names: () => calls.map((c) => c[0]),
    last: (name: string) => [...calls].reverse().find((c) => c[0] === name)?.[1],
  };
}

type Mem = Extract<StepEvents['session'][number], { type: 'recall' }>['memory'];

const step = (p: Partial<Step>): Step => ({ session: [], fear: [], dream: [], ...p });
const memory = (id: string, tier = 1): Mem => ({ def: { id, thing: id }, index: 0, state: 'done', spot: { tier } }) as unknown as Mem;
const jump = (cause: string, to: string): StepEvents['dream'][number] => ({ type: 'jump', phase: 'switch', plan: { cause, style: 'cut', to } }) as StepEvents['dream'][number];

describe('аналитика Playgama: план событий через поддельную площадку', () => {
  it('сессия: lifecycle-сообщения площадки с местом и номером, progression_* со ступенью и кругом', () => {
    const r = rig();
    r.a.ready();
    r.at(1000);
    r.a.sessionStarted();
    expect(r.calls[0]).toEqual(['level_started', { world: 'station', level: 3 }]);
    expect(r.calls[1]).toEqual(['progression_started', { step_id: 'station', step_index: 3, stage: 1, lap: 3, mode: 'loop' }]);
    r.at(1000 + 7 * 60_000);
    r.a.sessionCompleted();
    expect(r.last('level_completed')).toEqual({ world: 'station', level: 3 });
    expect(r.last('progression_completed')).toEqual({ step_id: 'station', step_index: 3, stage: 1, lap: 3, mode: 'loop', duration_s: 420, memories: 0, caught: 0, jumps: 0, pockets: 0 });
    // Сессии нет — нет и событий шага.
    r.a.onStep(step({ fear: [{ type: 'swarm', what: 'caught' }] }));
    expect(r.names().filter((n) => n === 'caught')).toEqual([]);
  });

  it('шаг: вспомненное по порядку, поимка, скачки без смены сессий и поимки, дела в карманах', () => {
    const r = rig();
    r.a.sessionStarted();
    const id = ALL_MEMORIES[0]!.id;
    r.at(65_400);
    r.a.onStep(step({ session: [{ type: 'recall', memory: memory(id, 2) }, { type: 'reveal', memory: memory('x') }] }));
    expect(r.last('memory_recalled')).toEqual({ memory_id: id, tier: 2, k: 1, world: 'station', lap: 3, stage: 1, t_s: 65 });
    r.a.onStep(step({ fear: [{ type: 'swarm', what: 'caught' }, { type: 'swarm', what: 'cohered' }] }));
    expect(r.last('caught')).toEqual({ world: 'station', lap: 3, stage: 1, k: 1, t_s: 65 });
    r.a.onStep(
      step({
        dream: [
          jump('gaze', 'dollhouse'),
          jump('return', 'elsewhere'),
          jump('caught', 'elsewhere'),
          jump('end', 'limbo'),
          { type: 'jump', phase: 'start', plan: { cause: 'dark', style: 'cut', to: 'void' } } as StepEvents['dream'][number],
          { type: 'pocket', kind: 'dollhouse', what: 'enter' },
          { type: 'pocket', kind: 'dollhouse', what: 'map', memory: id, room: 'kitchen', tier: 1 },
        ],
      }),
    );
    expect(r.calls.filter((c) => c[0] === 'jump').map((c) => c[1])).toEqual([
      { cause: 'gaze', to: 'dollhouse', world: 'station' },
      { cause: 'return', to: 'elsewhere', world: 'station' },
    ]);
    expect(r.calls.filter((c) => c[0] === 'pocket_used').map((c) => c[1])).toEqual([{ kind: 'dollhouse', what: 'map' }]);
    r.a.sessionCompleted();
    expect(r.last('progression_completed')).toMatchObject({ memories: 1, caught: 1, jumps: 2, pockets: 1 });
  });

  it('пауза: level_paused один раз на паузу, level_resumed после; время паузы в длительность не входит', () => {
    const r = rig();
    r.a.sessionStarted();
    r.at(10_000);
    r.lifecycle.set('user', true);
    r.lifecycle.set('hidden', true);
    r.at(70_000);
    r.lifecycle.set('hidden', false);
    r.lifecycle.set('user', false);
    expect(r.names().filter((n) => n === 'level_paused' || n === 'level_resumed')).toEqual(['level_paused', 'level_resumed']);
    r.at(100_000);
    r.a.sessionCompleted();
    expect(r.last('progression_completed')).toMatchObject({ duration_s: 40 });
    // Вне сессии пауза площадке не сообщается.
    r.lifecycle.set('user', true);
    expect(r.names().filter((n) => n === 'level_paused')).toHaveLength(1);
  });

  it('сессия, начатая на паузе заставки: лишнего level_resumed нет', () => {
    const r = rig();
    r.lifecycle.set('user', true);
    r.a.sessionStarted();
    r.lifecycle.set('user', false);
    expect(r.names()).not.toContain('level_resumed');
  });

  it('первое нажатие — один раз и только после game_ready; время — с шагом 100 мс', () => {
    const r = rig();
    r.a.input('mouse');
    expect(r.calls).toEqual([]);
    r.at(2000);
    r.a.ready();
    r.at(5432);
    r.a.input('touch');
    r.a.input('key');
    expect(r.calls).toEqual([['first_input', { ms: 3400, input: 'touch' }]]);
  });

  it('настройки: события только о том, что игрок поменял после game_ready; качество — с пометкой «само»', () => {
    const r = rig();
    r.a.saved();
    r.a.qualityChanged('ultra', true);
    expect(r.calls).toEqual([]);
    r.a.ready();
    r.a.saved();
    expect(r.calls).toEqual([]);
    r.ctx.settings = { ...r.ctx.settings, sound: false, lang: 'ru' };
    r.a.saved();
    expect(r.calls).toEqual([
      ['settings_changed', { setting: 'sound', value: false }],
      ['settings_changed', { setting: 'lang', value: 'ru' }],
    ]);
    r.a.saved();
    expect(r.calls).toHaveLength(2);
    r.a.qualityChanged('high', false);
    r.a.qualityChanged('med', true);
    r.a.qualityChanged('med', true);
    expect(r.calls.slice(2)).toEqual([['settings_changed', { setting: 'quality', value: 'med', auto: true }]]);
  });

  it('просмотр без сессии (?level=…) не шлёт событий сессии; номер сессии и круг ограничены 99', () => {
    const t = rig({ test: true });
    t.a.sessionStarted();
    t.a.placeErased();
    expect(t.calls).toEqual([]);
    const r = rig({ n: 1234, laps: 400 });
    r.a.sessionStarted();
    expect(r.calls[0]).toEqual(['level_started', { world: 'station', level: 99 }]);
    expect(r.calls[1]![1]).toMatchObject({ step_index: 99, lap: 99 });
  });

  it('миг, подсказки, WebGL: свои события; потеря контекста — ещё и счётчик в сводке кадров', () => {
    const r = rig();
    r.a.placeErased();
    expect(r.last('place_erased')).toEqual({ world: 'station', laps: 2, n: 3 });
    r.a.hint('dark');
    expect(r.names()).not.toContain('hint_shown');
    r.a.sessionStarted();
    r.at(46_000);
    r.a.hint('dark');
    expect(r.last('hint_shown')).toEqual({ id: 'dark', world: 'station', t_s: 46 });
    r.a.webgl('lost');
    r.a.webgl('restored');
    expect(r.calls.filter((c) => c[0] === 'webgl_status').map((c) => c[1])).toEqual([{ status: 'lost' }, { status: 'restored' }]);
    // 15 с игры — досрочная сводка в конце сессии; в ней одна потеря контекста.
    let t = 46_000;
    for (let i = 0; i <= 900; i++) r.a.frame((t += 1000 / 60));
    r.at(t);
    r.a.sessionCompleted();
    expect(r.last('performance_sample')).toMatchObject({ webgl_context_loss_count: 1, quality: 'high', build_version: BUILD_VERSION, target_fps: 60 });
    expect(r.last('performance_sample')!.window_ms).toBeGreaterThan(14_000);
  });

  it('все события — из плана: имена известны, значения — числа, флаги и короткие слова; ни сида, ни текста', () => {
    const r = rig();
    r.a.ready();
    r.a.input('key');
    r.a.sessionStarted();
    r.a.onStep(step({ session: [{ type: 'recall', memory: memory(ALL_MEMORIES[1]!.id) }], fear: [{ type: 'swarm', what: 'caught' }], dream: [jump('thin', 'void'), { type: 'pocket', kind: 'void', what: 'next' }] }));
    r.a.hint('swarm');
    r.ctx.settings = { ...r.ctx.settings, flash: 'reduced' };
    r.a.saved();
    r.a.placeErased();
    r.a.webgl('lost');
    r.a.sessionCompleted();
    const known = new Set<string>([...ANALYTICS_EVENTS, ...LIFECYCLE_MESSAGES]);
    expect(r.calls.length).toBeGreaterThan(10);
    for (const [name, data] of r.calls) {
      expect(known.has(name), name).toBe(true);
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      for (const [k, v] of Object.entries(data ?? {})) {
        expect(k).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(k).not.toMatch(/seed|name|user|player|url|message|stack/);
        expect(['string', 'number', 'boolean']).toContain(typeof v);
        if (typeof v === 'string') expect(v, `${name}.${k}`).toMatch(/^[a-z0-9_.+-]{1,40}$/);
      }
      if (data && 'world' in data) expect(WORLD_KINDS as readonly string[]).toContain(data.world);
    }
  });
});

describe('сводка кадров performance_sample', () => {
  const run = (w: PerfWindow, from: number, ms: number, dt: number, playing = true): { t: number; samples: Record<string, number>[] } => {
    const samples: Record<string, number>[] = [];
    let t = from;
    for (const end = from + ms; t < end; ) {
      t += dt;
      const s = w.frame(t, playing);
      if (s) samples.push(s);
    }
    return { t, samples };
  };

  it('ровные 60 к/с: одна сводка за 30 с игры, все поля контракта', () => {
    const w = new PerfWindow();
    const { samples } = run(w, 0, 30_100, 1000 / 60);
    expect(samples).toHaveLength(1);
    const s = samples[0]!;
    expect(Object.keys(s).sort()).toEqual(
      [
        'target_fps',
        'window_ms',
        'active_ms',
        'frame_count',
        'fps_avg',
        'fps_p10',
        'frame_time_p50_ms',
        'frame_time_p95_ms',
        'frame_time_p99_ms',
        'frame_time_max_ms',
        'frames_over_50ms',
        'frames_over_100ms',
        'frames_over_250ms',
        'frames_over_500ms',
        'frames_over_1000ms',
        'js_error_count',
        'unhandled_rejection_count',
        'webgl_context_loss_count',
      ].sort(),
    );
    expect(s.target_fps).toBe(PERF.targetFps);
    expect(s.active_ms).toBeGreaterThanOrEqual(PERF.windowMs);
    expect(s.fps_avg).toBeCloseTo(60, 0);
    expect(s.fps_p10).toBeCloseTo(60, 0);
    expect(s.frame_time_p50_ms).toBeCloseTo(16.7, 1);
    expect(s.frames_over_50ms).toBe(0);
  });

  it('пауза и скрытая вкладка не становятся «замёрзшим кадром»: в active_ms их нет, в window_ms есть', () => {
    const w = new PerfWindow();
    let { t } = run(w, 0, 10_000, 20);
    t += 60_000; // вкладка в фоне минуту: кадров нет вовсе
    w.gap();
    ({ t } = run(w, t, 5_000, 20, false)); // пауза: кадры идут, игры нет
    const { samples } = run(w, t, 20_100, 20);
    expect(samples).toHaveLength(1);
    const s = samples[0]!;
    expect(s.frames_over_1000ms).toBe(0);
    expect(s.frame_time_max_ms).toBeCloseTo(20, 5);
    expect(s.active_ms).toBeLessThan(31_000);
    expect(s.window_ms).toBeGreaterThan(90_000);
  });

  it('долгие кадры считаются строго по порогам (ровно 50 мс — не долгий); счётчики ошибок — за окно', () => {
    const w = new PerfWindow();
    let t = 0;
    w.frame(t, true);
    for (const dt of [16, 50, 51, 120, 300, 600, 1200]) w.frame((t += dt), true);
    w.count('js_error_count');
    w.count('js_error_count');
    w.count('unhandled_rejection_count');
    ({ t } = run(w, t, 12_000, 16));
    const a = w.flush(t)!;
    expect(a).not.toBeNull();
    expect([a.frames_over_50ms, a.frames_over_100ms, a.frames_over_250ms, a.frames_over_500ms, a.frames_over_1000ms]).toEqual([5, 4, 3, 2, 1]);
    expect(a.frame_time_max_ms).toBe(1200);
    expect([a.js_error_count, a.unhandled_rejection_count, a.webgl_context_loss_count]).toEqual([2, 1, 0]);
    ({ t } = run(w, t, 12_000, 16));
    const b = w.flush(t)!;
    expect([b.js_error_count, b.unhandled_rejection_count, b.frames_over_50ms]).toEqual([0, 0, 0]);
  });

  it('конец сессии: короче 10 с игры сводка не уходит, а копится дальше', () => {
    const w = new PerfWindow();
    const { t } = run(w, 0, 6_000, 16);
    expect(w.flush(t)).toBeNull();
    expect(w.activeMs).toBeGreaterThan(5_000);
    const { t: t2 } = run(w, t + 1000, 6_000, 16);
    expect(w.flush(t2)).not.toBeNull();
  });
});

describe('крючок рекламы в лимбо (рекламы нет по решению партнёра)', () => {
  const fake = (supported: boolean) => {
    const asked: (string | undefined)[] = [];
    return {
      asked,
      platform: {
        capabilities: { interstitial: supported, rewarded: false },
        showInterstitial: (placement?: string) => {
          asked.push(placement);
          return Promise.resolve(true);
        },
      },
    };
  };

  it('выключено: реклама не просится нигде, лимбо идёт как без крючка', () => {
    expect(ADS.interstitial).toBe(false);
    const f = fake(true);
    expect(new AdBreaks(f.platform).limbo()).toBeNull();
    expect(new AdBreaks(f.platform).limbo(3200)).toBeNull();
    expect(f.asked).toEqual([]);
  });

  it('включённый крючок: площадка без рекламы — null; иначе одна просьба с местом limbo, после мига и паузы', async () => {
    const waits: number[] = [];
    const wait = (ms: number): Promise<void> => {
      waits.push(ms);
      return Promise.resolve();
    };
    const none = fake(false);
    expect(new AdBreaks(none.platform, { interstitial: true }, wait).limbo()).toBeNull();
    const f = fake(true);
    await new AdBreaks(f.platform, { interstitial: true }, wait).limbo(3200);
    expect(f.asked).toEqual([LIMBO_PLACEMENT]);
    expect(waits).toEqual([3200 + LIMBO_BEAT_MS]);
    // Ошибка площадки — не ошибка игры: лимбо всё равно отпускает.
    const broken = { capabilities: { interstitial: true, rewarded: false }, showInterstitial: () => Promise.reject(new Error('нет рекламы')) };
    await expect(new AdBreaks(broken, { interstitial: true }, wait).limbo()).resolves.toBeUndefined();
  });
});
