import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allSoundFiles, AudioEngine, SOUNDS, spatialize } from '../src/audio/engine';
import { GameAudio, WAKE_FIRST, WAKING } from '../src/audio/game_audio';
import type { AudioWorld, SoundSink } from '../src/audio/game_audio';
import type { Vec3 } from '../src/core/types';
import type { StepEvents } from '../src/game';
import manifest from '../audio/manifest.json';

/** Заглушка движка: записывает, что игра просила сыграть. Незнакомый id — ошибка, как в настоящем. */
class Recorder implements SoundSink {
  readonly plays: { id: string; pos?: Vec3; volume?: number }[] = [];
  readonly loops = new Map<string, number>();
  private readonly ids = new Set(SOUNDS.map((s) => s.id));
  play(id: string, opts: { pos?: Vec3; volume?: number } = {}): void {
    if (!this.ids.has(id)) throw new Error(`нет такого звука: ${id}`);
    this.plays.push({ id, ...opts });
  }
  loop(id: string, gain: number): void {
    if (!this.ids.has(id)) throw new Error(`нет такого звука: ${id}`);
    this.loops.set(id, gain);
  }
  stopLoops(keep?: string): void {
    for (const id of [...this.loops.keys()]) if (id !== keep) this.loops.delete(id);
  }
  setListener(): void {}
  ids_(): string[] {
    return this.plays.map((p) => p.id);
  }
}

const quiet = (): StepEvents => ({ lightFailed: false, lightRevived: false, lightToggled: false, spark: false, strokes: 0, fellOut: false, session: [], fear: [], dream: [] });

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
    const code = readFileSync(new URL('../src/audio/game_audio.ts', import.meta.url), 'utf8') + readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
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

  it('шаги — по тому, что под ногами: бетон и вода в убежище, ковролин в офисе и жёлтых комнатах, трава на лугу; в белом нигде и в лимбо их не слышно', () => {
    const r = new Recorder();
    const a = new GameAudio(r);
    a.setScene('play');
    const w = world();
    const stepIn = (over: Partial<AudioWorld>): void => {
      Object.assign(w, { where: 'main', world: 'shelter', pocket: null }, over);
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
    expect(r.ids_().filter((id) => id.startsWith('step_'))).toEqual(['step_concrete', 'step_water', 'step_carpet', 'step_carpet', 'step_grass']);
    // Шаг, которого не слышно, не копится: следующий в убежище — один.
    stepIn({});
    expect(r.ids_().filter((id) => id.startsWith('step_')).length).toBe(6);
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
