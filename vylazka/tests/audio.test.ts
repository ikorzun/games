import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allSoundFiles, AudioEngine, FULL_RATE, SOUNDS, spatialize, unloadable } from '../src/audio/engine';
import { GameAudio, LOAD_FIRST, loadFirst, PLACE_TONE, TRACE_SAND, WAKE_FIRST, WAKING } from '../src/audio/game_audio';
import type { AudioWorld, SoundSink } from '../src/audio/game_audio';
import type { Vec3 } from '../src/core/types';
import type { StepEvents } from '../src/game';
import manifest from '../audio/manifest.json';

/** Заглушка движка: записывает, что игра просила сыграть. Незнакомый id — ошибка, как в настоящем. */
class Recorder implements SoundSink {
  readonly plays: { id: string; pos?: Vec3; volume?: number }[] = [];
  readonly loops = new Map<string, number>();
  /** Откуда слышна петля (нет — «в голове»). */
  readonly loopAt = new Map<string, Vec3 | undefined>();
  private readonly ids = new Set(SOUNDS.map((s) => s.id));
  play(id: string, opts: { pos?: Vec3; volume?: number } = {}): void {
    if (!this.ids.has(id)) throw new Error(`нет такого звука: ${id}`);
    this.plays.push({ id, ...opts });
  }
  loop(id: string, gain: number, pos?: Vec3): void {
    if (!this.ids.has(id)) throw new Error(`нет такого звука: ${id}`);
    this.loops.set(id, gain);
    this.loopAt.set(id, pos);
  }
  stopLoops(keep?: string): void {
    for (const id of [...this.loops.keys()]) if (id !== keep) this.loops.delete(id);
  }
  setListener(): void {}
  ids_(): string[] {
    return this.plays.map((p) => p.id);
  }
}

const quiet = (): StepEvents => ({ lightFailed: false, lightRevived: false, lightToggled: false, lightCharged: false, crank: -1, spark: false, strokes: 0, fellOut: false, session: [], fear: [], dream: [] });

function world(over: Partial<AudioWorld> = {}): AudioWorld & { steps: number } {
  const w = {
    steps: 0,
    light: { state: 'on' },
    swarm: null,
    session: { inWater: false, inGas: false, panic: 0, hold: 0 } as NonNullable<AudioWorld['session']>,
    where: 'main',
    body: { y: 0, vx: 0, vz: 0 },
    swarmNear: 0,
    staticLevel: 0,
    listener: () => ({ pos: [0, 1.4, 0] as Vec3, yaw: 0 }),
    consumeFootstep(): boolean {
      if (this.steps <= 0) return false;
      this.steps -= 1;
      return true;
    },
    ...over,
  };
  return w;
}

describe('манифест звуков', () => {
  it('id — латиницей, без повторов; у каждого звука есть описание для генерации и русская пометка', () => {
    const ids = new Set<string>();
    for (const s of manifest.sounds) {
      expect(s.id).toMatch(/^[a-z0-9_]+$/);
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      expect(s.variants).toBeGreaterThanOrEqual(1);
      expect(s.seconds).toBeGreaterThan(0);
      expect(s.volume).toBeGreaterThan(0);
      expect(s.volume).toBeLessThanOrEqual(1);
      // Инструкция модели — по-английски, пометка для людей — по-русски.
      expect(s.prompt).toMatch(/^[\x20-\x7e]{20,}$/);
      expect(s.ru).toMatch(/[а-яё]/i);
      if (s.loop) {
        expect(s.variants).toBe(1);
        // Стык петли задан и короче 40 % файла: нарастание и спад прохода не встречаются.
        const xfade = (s as { xfade?: number }).xfade ?? 0;
        expect(xfade).toBeGreaterThan(0);
        expect(xfade).toBeLessThan(s.seconds * 0.4);
      } else expect('xfade' in s).toBe(false);
    }
    expect(allSoundFiles().length).toBe(manifest.sounds.reduce((n, s) => n + s.variants, 0));
  });

  it('каждый звук из манифеста где-то играется: лишнего не генерируем', () => {
    // Звуки игры — в game_audio.ts; разовые звуки сюжета (палата, у кровати) играет сам сюжет.
    const code = readFileSync(new URL('../src/audio/game_audio.ts', import.meta.url), 'utf8') + readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8') + readFileSync(new URL('../src/ui/koma_flow.ts', import.meta.url), 'utf8');
    const unused = manifest.sounds.map((s) => s.id).filter((id) => !code.includes(`'${id}'`) && !(id.startsWith('scare_') && code.includes('`scare_${')));
    expect(unused).toEqual([]);
  });
});

describe('звук в пространстве', () => {
  it('справа — в правом ухе, слева — в левом, прямо и сзади — по центру', () => {
    const me: Vec3 = [0, 1.4, 0];
    // Взгляд при yaw = 0 — вдоль −Z, право — +X.
    expect(spatialize(me, 0, [3, 1.4, 0]).pan).toBeGreaterThan(0.7);
    expect(spatialize(me, 0, [-3, 1.4, 0]).pan).toBeLessThan(-0.7);
    expect(Math.abs(spatialize(me, 0, [0, 1.4, -3]).pan)).toBeLessThan(1e-6);
    expect(Math.abs(spatialize(me, 0, [0, 1.4, 3]).pan)).toBeLessThan(1e-6);
    // Повернулись налево на четверть оборота: то, что было впереди, теперь справа.
    expect(spatialize(me, Math.PI / 2, [0, 1.4, -3]).pan).toBeGreaterThan(0.7);
  });

  it('дальше — тише и глуше', () => {
    const me: Vec3 = [0, 0, 0];
    const near = spatialize(me, 0, [0, 0, -2]);
    const far = spatialize(me, 0, [0, 0, -20]);
    expect(near.gain).toBeGreaterThan(0.8);
    expect(far.gain).toBeLessThan(0.1);
    expect(near.muffle).toBe(0);
    expect(far.muffle).toBeGreaterThan(0.8);
  });
});

describe('движок без браузера и без файлов', () => {
  it('молчит и не падает, пока звук не разблокирован; незнакомый id — ошибка', () => {
    const e = new AudioEngine('./audio/', []);
    e.preload(['hatch']);
    e.play('ui_click');
    e.play('hatch', { late: 3 });
    e.loop('amb_bunker', 1);
    e.stopLoops();
    expect(e.status().state).toBe('locked');
    expect(e.status().asked).toEqual({ ui_click: 1, hatch: 1 });
    expect(e.status().played).toEqual({});
    expect(() => e.play('no_such_sound')).toThrow();
  });
});

/** Браузерный звук без браузера: контекст запускается не в миг нажатия (так в Safari и на iOS), файлы приходят по сети. */
function fakeAudio(opts: { startMs: number; network?: 'instant' | 'never' }) {
  const param = () => ({ value: 0, setTargetAtTime() {}, cancelScheduledValues() {}, setValueAtTime() {}, setValueCurveAtTime() {} });
  const node = () => ({ connect() {}, disconnect() {} });
  const decode = (_d: ArrayBuffer, ok: (b: unknown) => void): void => ok({ duration: 1 });
  class Ctx {
    state = 'suspended';
    currentTime = 0;
    destination = node();
    onstatechange: (() => void) | null = null;
    resume(): Promise<void> {
      return new Promise((ok) =>
        setTimeout(() => {
          this.state = 'running';
          this.onstatechange?.();
          ok();
        }, opts.startMs),
      );
    }
    suspend(): Promise<void> {
      this.state = 'suspended';
      return Promise.resolve();
    }
    createGain = () => ({ ...node(), gain: param() });
    createBufferSource = () => ({ ...node(), buffer: null, playbackRate: param(), onended: null, start() {}, stop() {} });
    createBiquadFilter = () => ({ ...node(), type: '', frequency: param() });
    createStereoPanner = () => ({ ...node(), pan: param() });
    decodeAudioData = decode;
  }
  class Offline {
    decodeAudioData = decode;
  }
  vi.stubGlobal('window', { AudioContext: Ctx, OfflineAudioContext: Offline });
  vi.stubGlobal('fetch', (): Promise<unknown> =>
    opts.network === 'never' ? new Promise(() => undefined) : Promise.resolve({ ok: true, headers: { get: () => 'audio/mpeg' }, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
  );
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('звук с первого нажатия (партнёр 17.11: «почему-то звук не срабатывает сразу»)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('звук, попрошенный, пока контекст ещё запускается, звучит, как только он пошёл, — а не пропадает', async () => {
    fakeAudio({ startMs: 30 });
    const e = new AudioEngine('./audio/', ['ui_start_1.mp3', 'hatch_1.mp3', 'ui_click_1.mp3']);
    e.preload(['ui_start', 'hatch']);
    await wait(5);
    expect(e.status().loaded).toBe(3);
    e.unlock();
    expect(e.status().state).toBe('suspended');
    e.play('ui_start', { late: 2 });
    e.play('hatch', { late: 4 });
    e.play('ui_click');
    expect(e.status().played).toEqual({});
    await wait(60);
    expect(e.status().state).toBe('running');
    expect(e.status().played).toEqual({ ui_start: 1, hatch: 1, ui_click: 1 });
  });

  it('опоздавший звук не звучит: щелчок ждёт меньше полсекунды, люк — свои четыре', async () => {
    fakeAudio({ startMs: 600 });
    const e = new AudioEngine('./audio/', ['hatch_1.mp3', 'ui_click_1.mp3']);
    e.preload([]);
    await wait(5);
    e.unlock();
    e.play('ui_click');
    e.play('hatch', { late: 4 });
    await wait(700);
    expect(e.status().state).toBe('running');
    expect(e.status().played).toEqual({ hatch: 1 });
  });

  it('на паузе звук не копится: попрошенное на паузе не звучит и после неё', async () => {
    fakeAudio({ startMs: 20 });
    const e = new AudioEngine('./audio/', ['flash_click_1.mp3']);
    e.preload([]);
    await wait(5);
    e.setPaused(true);
    e.unlock();
    e.play('flash_click');
    e.setPaused(false);
    await wait(60);
    expect(e.status().state).toBe('running');
    expect(e.status().played).toEqual({});
  });

  it('загрузка начинается с гула своего места и звука прихода; гул чужих мест — позже', () => {
    for (const world of ['shelter', 'office', 'yellow', 'station']) {
      const order = loadFirst(world);
      const tone = order.indexOf(PLACE_TONE[world]!);
      expect(tone).toBe(1);
      for (const other of Object.values(PLACE_TONE)) if (other !== PLACE_TONE[world]) expect(order.indexOf(other)).toBeGreaterThan(order.indexOf('voices_murmur'));
      // Всё, что раньше грузилось первым, по-прежнему в начале — просто в другом порядке.
      for (const id of LOAD_FIRST) expect(order).toContain(id);
      expect(new Set(order).size).toBe(order.length);
    }
    expect(loadFirst('shelter').slice(0, 3)).toEqual(['ui_start', 'amb_bunker', 'hatch']);
    expect(loadFirst('office').slice(0, 3)).toEqual(['ui_start', 'amb_office', 'lift']);
    expect(loadFirst('station').slice(0, 3)).toEqual(['ui_start', 'amb_station', 'still_tone']);
  });

  it('первые файлы грузятся по два (гул места не делит канал с мелочью), потом по шесть; место следующей сцены — вперёд очереди', async () => {
    fakeAudio({ startMs: 5, network: 'never' });
    const e = new AudioEngine('./audio/', allSoundFiles());
    e.preload(loadFirst('station'));
    let q = e.queued();
    // В пути двое: нажатие и гул зала; ровный тон ждёт первым.
    expect(q).not.toContain('ui_start_1.mp3');
    expect(q).not.toContain('amb_station_1.mp3');
    expect(q[0]).toBe('still_tone_1.mp3');
    expect(q.indexOf('amb_bunker_1.mp3')).toBeGreaterThan(q.indexOf('voices_murmur_1.mp3'));
    e.want(['amb_office', 'lift']);
    q = e.queued();
    expect(q.slice(0, 2)).toEqual(['amb_office_1.mp3', 'lift_1.mp3']);
    expect(q.filter((f) => f === 'amb_office_1.mp3')).toHaveLength(1);
  });

  it('когда первые четыре файла пришли, грузится по шесть разом', async () => {
    fakeAudio({ startMs: 5 });
    let open = 0;
    let most = 0;
    const waiting: (() => void)[] = [];
    vi.stubGlobal('fetch', () => {
      open += 1;
      most = Math.max(most, open);
      return new Promise((ok) =>
        waiting.push(() => {
          open -= 1;
          ok({ ok: true, headers: { get: () => 'audio/mpeg' }, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
        }),
      );
    });
    const e = new AudioEngine('./audio/', allSoundFiles());
    e.preload(loadFirst('shelter'));
    expect(open).toBe(2);
    // Отпускаем по одному: пока первые четыре не пришли, разом не больше двух.
    for (let i = 0; i < 4; i++) {
      waiting.shift()!();
      await wait(1);
      if (i < 3) expect(open).toBeLessThanOrEqual(2);
    }
    expect(open).toBe(6);
    expect(most).toBe(6);
  });
});

/**
 * Звук без браузера, но с памятью: декодер помнит свою частоту, файл несёт своё имя в байтах (копия байтов — тоже),
 * часы страницы и часы звука идут по команде теста.
 */
function fakeMemoryAudio() {
  const clock = { t: 1000 };
  vi.stubGlobal('performance', { now: () => clock.t });
  const param = () => ({ value: 0, setTargetAtTime() {}, cancelScheduledValues() {}, setValueAtTime() {}, setValueCurveAtTime() {} });
  const node = () => ({ connect() {}, disconnect() {} });
  const decoded: { file: string; rate: number }[] = [];
  const fetched: string[] = [];
  const nameOf = (d: ArrayBuffer): string => new TextDecoder().decode(d);
  const buffer = (rate: number) => ({ duration: 30, length: 30 * rate, numberOfChannels: 1, sampleRate: rate });
  class Ctx {
    state = 'running';
    destination = node();
    onstatechange: (() => void) | null = null;
    get currentTime(): number {
      return clock.t / 1000;
    }
    resume(): Promise<void> {
      return Promise.resolve();
    }
    suspend(): Promise<void> {
      return Promise.resolve();
    }
    createGain = () => ({ ...node(), gain: param() });
    createBufferSource = () => ({ ...node(), buffer: null, playbackRate: param(), onended: null, start() {}, stop() {} });
    createBiquadFilter = () => ({ ...node(), type: '', frequency: param() });
    createStereoPanner = () => ({ ...node(), pan: param() });
    decodeAudioData(d: ArrayBuffer, ok: (b: unknown) => void): void {
      decoded.push({ file: nameOf(d), rate: 48000 });
      ok(buffer(48000));
    }
  }
  class Offline {
    constructor(
      _channels: number,
      _length: number,
      readonly rate: number,
    ) {}
    decodeAudioData(d: ArrayBuffer, ok: (b: unknown) => void): void {
      decoded.push({ file: nameOf(d), rate: this.rate });
      ok(buffer(this.rate));
    }
  }
  vi.stubGlobal('window', { AudioContext: Ctx, OfflineAudioContext: Offline });
  vi.stubGlobal('fetch', (url: string): Promise<unknown> => {
    fetched.push(url);
    const name = url.slice(url.lastIndexOf('/') + 1);
    return Promise.resolve({ ok: true, headers: { get: () => 'audio/mpeg' }, arrayBuffer: () => Promise.resolve(new TextEncoder().encode(name).buffer) });
  });
  const times = (file: string): { fetched: number; decoded: number } => ({ fetched: fetched.filter((u) => u.endsWith(`/${file}`)).length, decoded: decoded.filter((d) => d.file === file).length });
  return { clock, decoded, fetched, times };
}

describe('звук и память телефона (критика куратора 237: весь звук в памяти — около 90 МБ)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('глухие гулы разбираются в 22 кГц, остальное — в 44,1; и после разблокировки — не в частоте контекста (на iOS 48 кГц)', async () => {
    const c = fakeMemoryAudio();
    const light = SOUNDS.filter((s) => s.rate === 22050).map((s) => s.id);
    expect(light.sort()).toEqual(['amb_bunker', 'amb_deep', 'amb_station', 'amb_yellow', 'voices_murmur']);
    // У шипящих петель и записей партнёра верха есть (замер 17.11) — им полная частота.
    for (const id of ['amb_office', 'amb_meadow', 'amb_void', 'still_tone', 'gas_hiss', 'wake_street', 'wake_pass', 'music_menu']) expect(SOUNDS.find((s) => s.id === id)!.rate).toBeUndefined();
    const e = new AudioEngine('./audio/', ['ui_start_1.mp3', 'amb_bunker_1.mp3', 'hatch_1.mp3', 'ui_click_1.mp3']);
    // Без загрузки заранее: всё разбирается уже после нажатия, когда есть контекст.
    e.unlock();
    e.want(['amb_bunker']);
    await wait(5);
    expect(c.decoded).toContainEqual({ file: 'amb_bunker_1.mp3', rate: 22050 });
    expect(c.decoded).toContainEqual({ file: 'hatch_1.mp3', rate: 44100 });
    expect(c.decoded.some((d) => d.rate === 48000)).toBe(false);
  });

  it('большая петля приходит и ждёт сжатой, пока не нужна; нужна — разобрана; полминуты тишины — выгружена; снова нужна — разобрана из тех же байтов, без новой загрузки', async () => {
    const c = fakeMemoryAudio();
    const e = new AudioEngine('./audio/', ['ui_start_1.mp3', 'amb_bunker_1.mp3', 'hatch_1.mp3', 'ui_click_1.mp3', 'amb_office_1.mp3', 'music_menu_1.mp3']);
    e.preload(loadFirst('shelter'));
    await wait(5);
    // Пришло всё; гул своего места разобран сразу, гул чужого и музыка меню — лежат сжатыми.
    expect(e.status().loaded).toBe(6);
    expect(e.status().resident).toEqual(['amb_bunker']);
    e.unlock();
    // Меню: музыка нужна — разбирается и со следующего кадра звучит.
    e.loop('music_menu', 1);
    await wait(5);
    e.loop('music_menu', 1);
    expect(e.status().loops).toContain('music_menu');
    expect(e.status().resident).toContain('music_menu');
    // Сон начался: музыка стихла и остановилась, гул убежища звучит.
    for (let i = 0; i < 4; i++) {
      c.clock.t += 500;
      e.loop('music_menu', 0);
      e.loop('amb_bunker', 1);
    }
    expect(e.status().loops).not.toContain('music_menu');
    // Через полминуты тишины музыка выгружена; гул убежища звучит — он на месте.
    for (let i = 0; i < 32; i++) {
      c.clock.t += 1000;
      e.loop('music_menu', 0);
      e.loop('amb_bunker', 1);
    }
    expect(e.status().resident).toEqual(['amb_bunker']);
    expect(e.status().loops).toContain('amb_bunker');
    // Снова меню: музыка разбирается из тех же байтов — второй раз разобрана, но загружена один раз.
    e.loop('music_menu', 1);
    await wait(5);
    e.loop('music_menu', 1);
    expect(e.status().loops).toContain('music_menu');
    expect(c.times('music_menu_1.mp3')).toEqual({ fetched: 1, decoded: 2 });
    expect(c.times('amb_bunker_1.mp3')).toEqual({ fetched: 1, decoded: 1 });
  });

  it('слышимое — по цели: стихшая петля сразу уходит из audible, а из loops — только когда отзвучит по часам звука (CI 9a1a6da)', async () => {
    const c = fakeMemoryAudio();
    const e = new AudioEngine('./audio/', ['ui_start_1.mp3', 'amb_bunker_1.mp3', 'hatch_1.mp3', 'ui_click_1.mp3']);
    e.preload(loadFirst('shelter'));
    await wait(5);
    e.unlock();
    e.loop('amb_bunker', 1);
    expect(e.status().audible).toEqual(['amb_bunker']);
    // Карман: гул стих — его не слышно сразу, хотя узел ещё доигрывает спад.
    e.loop('amb_bunker', 0);
    expect(e.status().audible).toEqual([]);
    expect(e.status().loops).toEqual(['amb_bunker']);
    // Часы звука стоят (загруженная машина): узел так и висит, слышимого по-прежнему нет.
    for (let i = 0; i < 5; i++) e.loop('amb_bunker', 0);
    expect(e.status().loops).toEqual(['amb_bunker']);
    expect(e.status().audible).toEqual([]);
    // Часы пошли — петля отзвучала и остановлена.
    c.clock.t += 2000;
    e.loop('amb_bunker', 0);
    expect(e.status().loops).toEqual([]);
    // Вернулись — снова слышно.
    e.loop('amb_bunker', 1);
    expect(e.status().audible).toEqual(['amb_bunker']);
  });

  it('гул места следующей сцены (want) разбирается заранее и держится минуту; не понадобился — выгружен', async () => {
    const c = fakeMemoryAudio();
    const e = new AudioEngine('./audio/', ['ui_start_1.mp3', 'amb_bunker_1.mp3', 'hatch_1.mp3', 'ui_click_1.mp3', 'amb_office_1.mp3']);
    e.preload(loadFirst('shelter'));
    await wait(5);
    e.unlock();
    expect(e.status().resident).toEqual(['amb_bunker']);
    e.want(loadFirst('office').slice(0, 4));
    await wait(5);
    expect(e.status().resident).toEqual(['amb_bunker', 'amb_office']);
    // Сцена в офисе так и не пришла: через минуту с лишним офисный гул выгружен, свой — звучит и на месте.
    for (let i = 0; i < 62; i++) {
      c.clock.t += 1000;
      e.loop('amb_bunker', 1);
      e.loop('amb_office', 0);
    }
    expect(e.status().resident).toEqual(['amb_bunker']);
    expect(c.times('amb_office_1.mp3')).toEqual({ fetched: 1, decoded: 1 });
  });

  it('памяти под звук — около половины прежнего: большие петли сжаты, глухие гулы — в половинной частоте', () => {
    // По манифесту: сколько МБ разобранного звука держит игра в сцене убежища (гул убежища и глубины, разговор за
    // стеной) против прежнего «всё разобрано в 44,1 кГц». Длины — номинальные, из манифеста.
    const mb = (s: (typeof SOUNDS)[number], rate: number): number => (s.seconds * s.variants * rate * 4 * (s.id === 'music_menu' ? 2 : 1)) / 1048576;
    const before = SOUNDS.reduce((n, s) => n + mb(s, 44100), 0);
    const inShelter = new Set(['amb_bunker', 'amb_deep', 'voices_murmur']);
    const after = SOUNDS.reduce((n, s) => n + (!unloadable(s) || inShelter.has(s.id) ? mb(s, s.rate ?? FULL_RATE) : 0), 0);
    expect(after).toBeLessThan(before * 0.55);
  });

  it('звучащая петля не выгружается, сколько бы ни звучала', async () => {
    const c = fakeMemoryAudio();
    const e = new AudioEngine('./audio/', ['amb_office_1.mp3']);
    e.unlock();
    await wait(5);
    e.loop('amb_office', 1);
    await wait(5);
    for (let i = 0; i < 200; i++) {
      c.clock.t += 1000;
      e.loop('amb_office', 1);
    }
    expect(e.status().loops).toEqual(['amb_office']);
    expect(e.status().resident).toEqual(['amb_office']);
  });
});

describe('привязка звуков к игре', () => {
  it('фонарь: щелчок, отказ, дребезг при тряске, искра, оживление', () => {
    const r = new Recorder();
    const a = new GameAudio(r);
    a.setScene('play');
    const w = world({ light: { state: 'dead' } });
    a.onStep({ ...quiet(), lightToggled: true }, w);
    a.onStep({ ...quiet(), lightFailed: true }, w);
    a.onStep({ ...quiet(), strokes: 2 }, w);
    // Второй рывок в тот же миг не гремит: не чаще восьми раз в секунду.
    a.onStep({ ...quiet(), strokes: 1 }, w);
    a.frame(w, 0.2, true);
    a.onStep({ ...quiet(), strokes: 1, spark: true }, w);
    a.onStep({ ...quiet(), lightRevived: true }, w);
    expect(r.ids_()).toEqual(['flash_click', 'flash_die', 'flash_rattle', 'flash_spark', 'flash_rattle', 'flash_click']);
  });

  it('нажатие по заглохшему фонарю — стук (брякнули батарейки), а не щелчок выключателя (17.11 12:15)', () => {
    const r = new Recorder();
    const a = new GameAudio(r);
    a.setScene('play');
    const w = world({ light: { state: 'dead' } });
    a.onStep({ ...quiet(), lightKnock: true }, w);
    expect(r.ids_()).toEqual(['flash_rattle']);
  });

  it('в светлом месте фонаря нет — нет и его звуков: ни щелчка, ни тряски, ни треска (партнёр 24.11)', () => {
    const r = new Recorder();
    const a = new GameAudio(r);
    a.setScene('play');
    const w = world({ hasLight: false });
    a.onStep({ ...quiet(), lightToggled: true, lightKnock: true, lightFailed: true, lightRevived: true, spark: true, crank: 0.5, lightCharged: true, strokes: 3 }, w);
    expect(r.ids_()).toEqual([]);
  });

  it('события сессии, сна и страха находят свой звук', () => {
    const r = new Recorder();
    const a = new GameAudio(r);
    a.setScene('play');
    const w = world({ swarm: { pos: [5, 0, 0], active: true, cohesion: 1 } });
    const memory = { def: { id: 'kettle', thing: 'kettle' }, index: 0, state: 'active', spot: null };
    const plan = (cause: string, style: string, to: string): unknown => ({ cause, style, to });
    const ev = quiet();
    ev.session = [
      { type: 'reveal', memory },
      { type: 'recall', memory },
      { type: 'forgot', memory },
      { type: 'all-done' },
      { type: 'collapse', spec: { id: 'c', tier: 0, center: [1, 0, 1], boxes: [] } },
      { type: 'gas-enter' },
      { type: 'cough' },
      { type: 'fall' },
      { type: 'faint' },
    ] as unknown as StepEvents['session'];
    ev.dream = [
      { type: 'jump', plan: plan('light', 'cut', 'elsewhere'), phase: 'start' },
      { type: 'jump', plan: plan('light', 'cut', 'elsewhere'), phase: 'switch' },
      { type: 'jump', plan: plan('gaze', 'whiteout', 'void'), phase: 'start' },
      { type: 'jump', plan: plan('gaze', 'whiteout', 'void'), phase: 'switch' },
      { type: 'touch', name: 'locker', what: 'gone', first: true },
      { type: 'touch', name: 'locker', what: 'back', how: 'same' },
      { type: 'limbo' },
      { type: 'begin' },
      { type: 'sonar' },
    ] as unknown as StepEvents['dream'];
    ev.fear = [
      { type: 'scare', id: 'steps', pos: [0, 0, 4] },
      { type: 'scare', id: 'knock', pos: [3, 0, 0] },
      { type: 'scare', id: 'radio' },
      { type: 'scare', id: 'flicker' },
      { type: 'scare', id: 'signs' },
      { type: 'swarm', what: 'cohered' },
      { type: 'swarm', what: 'scattered' },
      { type: 'swarm', what: 'caught' },
      { type: 'swarm', what: 'release' },
    ];
    a.onStep(ev, w);
    expect(r.ids_()).toEqual(['camera_hold', 'camera_beep', 'collapse', 'cough', 'fall', 'flash_spark', 'whiteout', 'dissolve', 'assemble', 'ui_report', 'wake_street', 'hatch', 'sonar_ping', 'scare_steps', 'scare_knock', 'scare_radio', 'flash_spark', 'swarm_cohere', 'swarm_scatter', 'swarm_catch']);
    // Пинг сонара — от самого игрока, не из мира.
    expect(r.plays.find((p) => p.id === 'sonar_ping')!.pos).toBeUndefined();
    // Рывок слышно только в момент смены места, а не в начале ухода: одна искра (вторая — мигание фонаря).
    // Выбеливание слышно с самого начала — оно нарастает; искры у него нет.
    expect(r.plays.filter((p) => p.id === 'flash_spark').length).toBe(2);
    expect(r.plays.filter((p) => p.id === 'whiteout').length).toBe(1);
    // Стук слышен из мира, рация — «на груди».
    expect(r.plays.find((p) => p.id === 'scare_knock')!.pos).toEqual([3, 0, 0]);
    expect(r.plays.find((p) => p.id === 'scare_radio')!.pos).toBeUndefined();
    expect(r.plays.find((p) => p.id === 'swarm_cohere')!.pos).toEqual([5, 0, 0]);
  });

  it('шаги — по тому, что под ногами: бетон и вода в убежище, ковролин в офисе и жёлтых комнатах, трава на лугу и в помещении, где она проросла; в белом нигде и в лимбо их не слышно', () => {
    const r = new Recorder();
    const a = new GameAudio(r);
    a.setScene('play');
    const w = world();
    const stepIn = (over: Partial<AudioWorld>): void => {
      Object.assign(w, { where: 'main', world: 'shelter', pocket: null, onGrass: false }, over);
      w.steps = 1;
      a.frame(w, 0.016, true);
    };
    stepIn({});
    w.session!.inWater = true;
    stepIn({});
    w.session!.inWater = false;
    stepIn({ world: 'office' });
    stepIn({ world: 'yellow' });
    stepIn({ where: 'pocket', pocket: { kind: 'meadow' } });
    stepIn({ where: 'pocket', pocket: { kind: 'void' } });
    stepIn({ where: 'pocket', pocket: { kind: 'dollhouse' } });
    stepIn({ where: 'limbo', pocket: { kind: 'void' } });
    stepIn({ onGrass: true });
    stepIn({ world: 'office', onGrass: true });
    expect(r.ids_().filter((id) => id.startsWith('step_'))).toEqual(['step_concrete', 'step_water', 'step_carpet', 'step_carpet', 'step_grass', 'step_grass', 'step_grass']);
    // Шаг, которого не слышно, не копится: следующий в убежище — один.
    stepIn({});
    expect(r.ids_().filter((id) => id.startsWith('step_')).length).toBe(8);
  });

  it('трава шуршит, пока тянется к свету (партнёр 20.11): громкость — сколько её движется, звук — оттуда, где она движется; в помещении места и на лугу, но не в белом нигде и не в лимбо', () => {
    const r = new Recorder();
    const a = new GameAudio(r);
    a.setScene('play');
    const at: Vec3 = [3, 0.3, -4];
    const w = world({ grassRustle: { gain: 0.7, at } });
    const heard = (over: Partial<AudioWorld>): number => {
      Object.assign(w, over);
      a.frame(w, 0.016, true);
      return r.loops.get('grass_rustle') ?? -1;
    };
    expect(heard({})).toBeCloseTo(0.7, 5);
    expect(r.loopAt.get('grass_rustle')).toEqual(at);
    expect(heard({ where: 'pocket', pocket: { kind: 'meadow' } })).toBeCloseTo(0.7, 5);
    expect(heard({ where: 'pocket', pocket: { kind: 'void' } })).toBe(0);
    expect(heard({ where: 'limbo', pocket: null })).toBe(0);
    expect(heard({ where: 'main', grassRustle: { gain: 0, at } })).toBe(0);
    expect(heard({ grassRustle: null })).toBe(0);
    // Шорох не спорит с песком Осыпи: рядом с ней молчит, в сильной панике почти молчит.
    expect(heard({ grassRustle: { gain: 0.7, at }, swarmNear: 0.6 })).toBe(0);
    const scared = heard({ swarmNear: 0, session: { inWater: false, inGas: false, panic: 0.9, hold: 0 } });
    expect(scared).toBeGreaterThan(0);
    expect(scared).toBeLessThan(0.7 * 0.3);
    // Ветер луга приседает под шорохом и возвращается, когда трава улеглась.
    Object.assign(w, { session: { inWater: false, inGas: false, panic: 0, hold: 0 } });
    heard({ where: 'pocket', pocket: { kind: 'meadow' }, grassRustle: { gain: 0.8, at } });
    const ducked = r.loops.get('amb_meadow')!;
    expect(ducked).toBeLessThan(0.8);
    expect(ducked).toBeGreaterThan(0.5);
    heard({ grassRustle: { gain: 0, at } });
    expect(r.loops.get('amb_meadow')).toBe(1);
  });

  it('начало вылазки: в убежище закрывается люк, в офисе и жёлтых комнатах привозит лифт; новая сессия начинается так же', () => {
    for (const [place, id] of [['shelter', 'hatch'], ['office', 'lift'], ['yellow', 'lift']] as const) {
      const r = new Recorder();
      const a = new GameAudio(r);
      a.setScene('play');
      a.sortieStart(false, place);
      expect(r.ids_(), place).toEqual(['ui_start', id]);
      const ev = quiet();
      ev.dream = [{ type: 'begin' }] as unknown as StepEvents['dream'];
      a.onStep(ev, world({ world: place }));
      expect(r.ids_().at(-1), place).toBe(id);
    }
    // Продолжение записи: люк и лифт уже позади.
    const r = new Recorder();
    new GameAudio(r).sortieStart(true, 'office');
    expect(r.ids_()).toEqual(['ui_start']);
  });

  it('у каждого места свой тон: убежище, офис, жёлтые комнаты, луг, белое нигде', () => {
    const r = new Recorder();
    const a = new GameAudio(r);
    a.setScene('play');
    const w = world();
    const tones = ['amb_bunker', 'amb_deep', 'amb_office', 'amb_yellow', 'amb_meadow', 'amb_void'];
    const heard = (over: Partial<AudioWorld>): string[] => {
      Object.assign(w, { where: 'main', world: 'shelter', pocket: null }, over);
      a.frame(w, 0.016, true);
      return tones.filter((id) => (r.loops.get(id) ?? 0) > 0);
    };
    expect(heard({})).toEqual(['amb_bunker']);
    expect(heard({ world: 'office' })).toEqual(['amb_office']);
    expect(heard({ world: 'yellow' })).toEqual(['amb_yellow']);
    expect(heard({ world: 'office', where: 'pocket', pocket: { kind: 'meadow' } })).toEqual(['amb_meadow']);
    expect(heard({ world: 'office', where: 'pocket', pocket: { kind: 'void' } })).toEqual(['amb_void']);
    expect(heard({ world: 'yellow', where: 'pocket', pocket: { kind: 'dollhouse' } })).toEqual(['amb_void']);
    expect(heard({ where: 'limbo', pocket: { kind: 'void' } })).toEqual(['amb_void']);
    // Вернулись — тон мира вернулся.
    expect(heard({ world: 'yellow' })).toEqual(['amb_yellow']);
  });

  it('искомая вещь зовёт: ровный тон из её места, пока она есть; в зале ожидания тон — прежний «стой», без места (плейтест 19.11)', () => {
    const r = new Recorder();
    const a = new GameAudio(r);
    a.setScene('play');
    const w = world({ world: 'shelter' });
    a.frame(w, 0.016, true);
    expect(r.loops.get('still_tone')).toBe(0);
    Object.assign(w, { memoryCall: [6, 0.4, -3] as Vec3 });
    a.frame(w, 0.016, true);
    expect(r.loops.get('still_tone')!).toBeGreaterThan(0.3);
    // В кармане и в лимбо вещь осталась в месте — её не слышно.
    Object.assign(w, { where: 'pocket', pocket: { kind: 'meadow' } });
    a.frame(w, 0.016, true);
    expect(r.loops.get('still_tone')).toBe(0);
    // Зал ожидания: тон значит «стой» — на ходу его нет, и зов вещи его не включает.
    Object.assign(w, { where: 'main', pocket: null, world: 'station', flow: { f: 1, strain: 0, train: 0, trains: 0 } });
    a.frame(w, 0.016, true);
    expect(r.loops.get('still_tone')).toBe(0);
  });

  it('следы людей: пока спокойно, за стеной тихо разговаривают; чем ближе Осыпь и сильнее паника — тем тише разговор и громче шёпот', () => {
    const r = new Recorder();
    const a = new GameAudio(r);
    a.setScene('play');
    const w = world();
    a.frame(w, 0.016, true);
    const murmur = r.loops.get('voices_murmur')!;
    expect(murmur).toBeGreaterThan(0.3);
    expect(r.loops.get('voices_whisper')).toBe(0);
    // В офисе людей больше, в жёлтых комнатах почти никого.
    Object.assign(w, { world: 'office' });
    a.frame(w, 0.016, true);
    expect(r.loops.get('voices_murmur')!).toBeGreaterThan(murmur);
    Object.assign(w, { world: 'yellow' });
    a.frame(w, 0.016, true);
    expect(r.loops.get('voices_murmur')!).toBeLessThan(murmur);
    expect(r.loops.get('voices_murmur')!).toBeGreaterThan(0);
    // Осыпь рядом: разговор смолк, слышен шёпот.
    w.swarmNear = 0.5;
    a.frame(w, 0.016, true);
    expect(r.loops.get('voices_murmur')).toBe(0);
    expect(r.loops.get('voices_whisper')!).toBeGreaterThan(0.5);
    // Паника без Осыпи — то же самое.
    w.swarmNear = 0;
    w.session!.panic = 0.9;
    a.frame(w, 0.016, true);
    expect(r.loops.get('voices_murmur')).toBe(0);
    expect(r.loops.get('voices_whisper')!).toBeGreaterThan(0.3);
    // В карманном пространстве и в лимбо за стеной никого.
    w.session!.panic = 0;
    for (const where of ['pocket', 'limbo']) {
      w.where = where;
      a.frame(w, 0.016, true);
      expect(r.loops.get('voices_murmur'), where).toBe(0);
      expect(r.loops.get('voices_whisper'), where).toBe(0);
    }
  });

  it('смех, напев, оклик, чужой телефон: изредка, издалека и по месту; при Осыпи и в белом нигде — тишина', () => {
    const VOICE = ['voices_laugh', 'voices_giggle', 'voices_hum', 'voices_call', 'phone_far'];
    const run = (over: Partial<AudioWorld>, seconds: number): { id: string; pos?: Vec3 }[] => {
      const r = new Recorder();
      const a = new GameAudio(r);
      a.setScene('play');
      a.sortieStart(true);
      const w = world(over);
      for (let t = 0; t < seconds; t += 0.25) a.frame(w, 0.25, true);
      return r.plays.filter((p) => VOICE.includes(p.id));
    };
    // Пять минут в убежище: от шести до двадцати пяти раз — не чаще раза в двенадцать секунд.
    const home = run({}, 300);
    expect(home.length).toBeGreaterThanOrEqual(6);
    expect(home.length).toBeLessThanOrEqual(25);
    // Первые восемнадцать секунд — ничего.
    expect(run({}, 17)).toHaveLength(0);
    // Издалека: семь–двенадцать метров от слушателя, у каждого своя сторона.
    for (const p of home) {
      const d = Math.hypot(p.pos![0], p.pos![2]);
      expect(d).toBeGreaterThanOrEqual(6.9);
      expect(d).toBeLessThanOrEqual(12.1);
    }
    expect(new Set(home.map((p) => p.id)).size).toBeGreaterThanOrEqual(3);
    // По месту: телефон звонит в офисе и в жёлтых комнатах, но не в убежище; на лугу — смех и напев.
    expect(home.some((p) => p.id === 'phone_far')).toBe(false);
    const office = run({ world: 'office' }, 600);
    expect(office.some((p) => p.id === 'phone_far')).toBe(true);
    expect(office.some((p) => p.id === 'voices_giggle')).toBe(false);
    const meadow = run({ world: 'office', where: 'pocket', pocket: { kind: 'meadow' } }, 600);
    expect(meadow.length).toBeGreaterThan(0);
    expect(meadow.every((p) => ['voices_laugh', 'voices_giggle', 'voices_hum'].includes(p.id))).toBe(true);
    // В жёлтых комнатах — реже, чем в офисе.
    expect(run({ world: 'yellow' }, 600).length).toBeLessThan(office.length);
    // Осыпь рядом или паника — никого не слышно; в белом нигде и в лимбо людей нет.
    expect(run({ swarmNear: 0.5 }, 300)).toHaveLength(0);
    expect(run({ where: 'pocket', pocket: { kind: 'void' } }, 300)).toHaveLength(0);
    expect(run({ where: 'limbo', pocket: { kind: 'void' } }, 300)).toHaveLength(0);
    // В меню и на паузе их тоже нет.
    const r = new Recorder();
    const a = new GameAudio(r);
    a.setScene('play');
    const w = world();
    for (let t = 0; t < 300; t += 0.25) a.frame(w, 0.25, false);
    expect(r.plays.filter((p) => VOICE.includes(p.id))).toHaveLength(0);
  });

  it('явь — записи партнёра: изредка, издалека и по очереди; в стёртом месте чаще; в лимбо — каждый раз; при Осыпи, в кармане и на паузе — нет', () => {
    const run = (over: Partial<AudioWorld>, seconds: number, active = true): { id: string; pos?: Vec3 }[] => {
      const r = new Recorder();
      const a = new GameAudio(r);
      a.setScene('play');
      a.sortieStart(true);
      const w = world(over);
      for (let t = 0; t < seconds; t += 0.25) a.frame(w, 0.25, active);
      return r.plays.filter((p) => WAKING.includes(p.id));
    };
    expect(run({}, WAKE_FIRST - 1)).toHaveLength(0);
    // Десять минут в целом месте: три-четыре раза, обе записи, из-за стены.
    const whole = run({}, 600);
    expect(whole.length).toBeGreaterThanOrEqual(3);
    expect(whole.length).toBeLessThanOrEqual(4);
    expect(new Set(whole.map((p) => p.id)).size).toBe(2);
    for (const p of whole) expect(Math.hypot(p.pos![0], p.pos![2])).toBeGreaterThan(10);
    // В стёртом месте людей не слышно, а явь — чаще: сон истончился.
    expect(run({ decay: { voices: 0 } }, 600).length).toBeGreaterThan(whole.length);
    // Осыпь рядом, карман, пауза — тишина.
    expect(run({ swarmNear: 0.5 }, 600)).toHaveLength(0);
    expect(run({ where: 'pocket', pocket: { kind: 'meadow' } }, 600)).toHaveLength(0);
    expect(run({}, 600, false)).toHaveLength(0);
    // Лимбо — граница пробуждения: каждый раз, по очереди.
    const r = new Recorder();
    const a = new GameAudio(r);
    a.setScene('play');
    const w = world({ where: 'limbo', pocket: { kind: 'void' } });
    const limbo = (): StepEvents => ({ ...quiet(), dream: [{ type: 'limbo' }] as StepEvents['dream'] });
    a.onStep(limbo(), w);
    a.onStep(limbo(), w);
    expect(r.ids_().filter((id) => WAKING.includes(id))).toEqual(['wake_street', 'wake_pass']);
  });

  it('петли следуют за состоянием: глубина, паника, газ, рой, помехи', () => {
    const r = new Recorder();
    const a = new GameAudio(r);
    a.setScene('play');
    const w = world();
    a.frame(w, 0.016, true);
    expect(r.loops.get('amb_bunker')).toBe(1);
    expect(r.loops.get('amb_deep')).toBe(0);
    expect(r.loops.get('breath_calm')).toBe(1);
    expect(r.loops.get('breath_panic')).toBe(0);
    expect(r.loops.get('heartbeat')).toBe(0);
    expect(r.loops.get('swarm_loop')).toBe(0);
    expect(r.loops.get('music_menu')).toBe(0);

    w.body.y = -9;
    w.session!.panic = 0.9;
    w.session!.inGas = true;
    w.swarm = { pos: [4, -9, 0], active: true, cohesion: 1 };
    w.swarmNear = 0.5;
    w.staticLevel = 0.4;
    a.frame(w, 0.016, true);
    expect(r.loops.get('amb_deep')).toBe(1);
    expect(r.loops.get('amb_bunker')).toBeCloseTo(0.3);
    expect(r.loops.get('breath_calm')).toBe(0);
    expect(r.loops.get('breath_panic')).toBe(1);
    expect(r.loops.get('heartbeat')).toBe(1);
    expect(r.loops.get('gas_hiss')).toBe(1);
    expect(r.loops.get('swarm_loop')).toBe(1);
    expect(r.loops.get('signal_static')).toBeGreaterThan(0.5);
  });

  it('Осыпь-примета (ступени 1–2): тела нет, но её песок слышен — громче, чем рассеянная Осыпь рядом; глушит его расстояние', () => {
    const r = new Recorder();
    const a = new GameAudio(r);
    a.setScene('play');
    const w = world();
    w.swarm = { pos: [14, 0, 0], active: true, cohesion: 0, mode: 'trace' };
    a.frame(w, 0.016, true);
    expect(r.loops.get('swarm_loop')).toBe(TRACE_SAND);
    expect(TRACE_SAND).toBeGreaterThan(0.55);
    w.swarm = { pos: [14, 0, 0], active: true, cohesion: 0, mode: 'roam' };
    a.frame(w, 0.016, true);
    expect(r.loops.get('swarm_loop')).toBeCloseTo(0.55);
  });

  it('лимбо и карман: гул убежища, дыхание, газ и рой стихают, помехи остаются', () => {
    const r = new Recorder();
    const a = new GameAudio(r);
    a.setScene('play');
    const w = world({ swarm: { pos: [1, 0, 0], active: true, cohesion: 1 }, staticLevel: 1 });
    w.session!.inGas = true;
    a.frame(w, 0.016, true);
    expect(r.loops.get('amb_bunker')).toBe(1);
    for (const where of ['limbo', 'pocket']) {
      w.where = where;
      a.frame(w, 0.016, true);
      for (const id of ['amb_bunker', 'amb_deep', 'breath_calm', 'breath_panic', 'heartbeat', 'gas_hiss', 'swarm_loop']) expect(r.loops.get(id), `${where}: ${id}`).toBe(0);
      expect(r.loops.get('signal_static')).toBe(1);
      // Вместо гула убежища — тон пустоты.
      expect(r.loops.get('amb_void'), where).toBe(1);
    }
    // Вернулись в убежище — гул вернулся.
    w.where = 'main';
    a.frame(w, 0.016, true);
    expect(r.loops.get('amb_bunker')).toBe(1);
  });

  it('в меню играет музыка, петли сессии оборваны; в сессии музыки нет', () => {
    const r = new Recorder();
    const a = new GameAudio(r);
    a.setScene('play');
    a.frame(world(), 0.016, true);
    a.setScene('menu');
    a.frame(world(), 0.016, false);
    expect([...r.loops.keys()]).toEqual(['music_menu']);
    expect(r.loops.get('music_menu')).toBe(1);
    a.setScene('play');
    a.frame(world(), 0.016, true);
    expect(r.loops.get('music_menu')).toBe(0);
  });

  it('взгляд на вещь воспоминания: звук наведения один раз за удержание; вне убежища — нет', () => {
    const r = new Recorder();
    const a = new GameAudio(r);
    a.setScene('play');
    const w = world();
    w.session!.hold = 0.2;
    a.frame(w, 0.016, true);
    w.session!.hold = 0.5;
    a.frame(w, 0.016, true);
    w.session!.hold = 0;
    a.frame(w, 0.016, true);
    w.session!.hold = 0.1;
    a.frame(w, 0.016, true);
    expect(r.ids_().filter((id) => id === 'camera_hold').length).toBe(2);
    w.session!.hold = 0;
    a.frame(w, 0.016, true);
    w.where = 'limbo';
    w.session!.hold = 0.3;
    a.frame(w, 0.016, true);
    expect(r.ids_().filter((id) => id === 'camera_hold').length).toBe(2);
  });

  it('капли падают сами, редко и не в меню', () => {
    const r = new Recorder();
    const a = new GameAudio(r);
    a.setScene('play');
    a.sortieStart(true);
    const w = world();
    for (let i = 0; i < 60 * 60; i++) a.frame(w, 1 / 60, true);
    const drips = r.plays.filter((p) => p.id === 'drip');
    expect(drips.length).toBeGreaterThanOrEqual(4);
    expect(drips.length).toBeLessThanOrEqual(14);
    for (const d of drips) expect(Math.hypot(d.pos![0], d.pos![2])).toBeGreaterThan(0.9);
  });
});

describe('проверка архива: звук — весь набор или ничего', () => {
  const makeDist = async (files: string[]): Promise<string> => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'vz-dist-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>t</title>');
    mkdirSync(join(dir, 'audio'), { recursive: true });
    for (const f of files) writeFileSync(join(dir, 'audio', f), 'x');
    return dir;
  };
  const check = async (dir: string, opts: Record<string, unknown> = {}): Promise<{ problems: string[]; warnings: string[] }> => {
    // Скрипт сборки — обычный .mjs без типов: берём его как есть.
    const mod = (await import('../scripts/check_dist.mjs' as string)) as { checkDist(dir: string, opts?: Record<string, unknown>): { problems: string[]; warnings: string[] } };
    // Здесь проверяется только звук: листы-картинки (плакаты) и картинки экранов у этой сборки-пустышки не спрашиваем.
    return mod.checkDist(dir, { sheets: [], screens: [], papers: [], ...opts });
  };

  it('звука нет — предупреждение, а в строгом режиме ошибка', async () => {
    const dir = await makeDist([]);
    const soft = await check(dir, { requireAudio: false });
    expect(soft.problems).toEqual([]);
    expect(soft.warnings.some((w) => w.includes('звука в сборке нет'))).toBe(true);
    expect((await check(dir, { requireAudio: true })).problems.some((p) => p.includes('звука в сборке нет'))).toBe(true);
  });

  it('полный набор проходит, неполный — ошибка с именами потерянных файлов, лишний файл — предупреждение', async () => {
    const all = allSoundFiles();
    const full = await check(await makeDist(all), { requireAudio: true });
    expect(full.problems).toEqual([]);
    expect(full.warnings).toEqual([]);

    const part = await check(await makeDist(all.filter((f) => f !== 'hatch_1.mp3' && f !== 'drip_3.mp3')));
    expect(part.problems.length).toBe(1);
    expect(part.problems[0]).toContain('нет 2 из');
    expect(part.problems[0]).toContain('hatch_1.mp3');
    expect(part.problems[0]).toContain('drip_3.mp3');

    const extra = await check(await makeDist([...all, 'old_take_1.mp3']), { requireAudio: true });
    expect(extra.problems).toEqual([]);
    expect(extra.warnings.some((w) => w.includes('old_take_1.mp3'))).toBe(true);
  });
});
