import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allSoundFiles, AudioEngine, SOUNDS, spatialize } from '../src/audio/engine';
import { GameAudio } from '../src/audio/game_audio';
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

const quiet = (): StepEvents => ({ lightFailed: false, lightRevived: false, lightToggled: false, spark: false, strokes: 0, fellOut: false, sortie: [], fear: [] });

function world(over: Partial<AudioWorld> = {}): AudioWorld & { steps: number } {
  const w = {
    steps: 0,
    light: { state: 'on' },
    swarm: null,
    sortie: { outcome: null, inWater: false, inGas: false, panic: 0, hold: 0, target: null },
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
    e.play('pickup');
    e.play('hatch', { late: 3 });
    e.loop('amb_bunker', 1);
    e.stopLoops();
    expect(e.status().state).toBe('locked');
    expect(e.status().asked).toEqual({ pickup: 1, hatch: 1 });
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

  it('события вылазки и страха находят свой звук', () => {
    const r = new Recorder();
    const a = new GameAudio(r);
    a.setScene('play');
    const w = world({ swarm: { pos: [5, 0, 0], active: true, cohesion: 1 } });
    const item = { id: 1, type: 'find', find: 'journal', x: 0, y: 0, z: 0, tier: 0 };
    const ev = quiet();
    ev.sortie = [
      { type: 'picked', item },
      { type: 'objective', objective: { id: 0, type: 'shoot', tier: 0 } },
      { type: 'swap-start' },
      { type: 'swap-done' },
      { type: 'collapse', spec: { id: 'c', tier: 0, center: [1, 0, 1], boxes: [] } },
      { type: 'cough' },
      { type: 'hurt', amount: 40 },
      { type: 'ended', outcome: 'escaped' },
    ] as unknown as StepEvents['sortie'];
    ev.fear = [
      { type: 'scare', id: 'bang', pos: [10, 0, 0] },
      { type: 'scare', id: 'slam', pos: [10, 0, 0] },
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
    expect(r.ids_()).toEqual(['pickup', 'camera_beep', 'battery_swap', 'flash_click', 'collapse', 'cough', 'fall', 'ladder', 'scare_bang', 'scare_slam', 'scare_steps', 'scare_knock', 'scare_radio', 'flash_spark', 'swarm_cohere', 'swarm_scatter', 'swarm_catch']);
    // Удары и стук слышны из мира, рация — «на груди».
    expect(r.plays.find((p) => p.id === 'scare_bang')!.pos).toEqual([10, 0, 0]);
    expect(r.plays.find((p) => p.id === 'scare_radio')!.pos).toBeUndefined();
    expect(r.plays.find((p) => p.id === 'swarm_cohere')!.pos).toEqual([5, 0, 0]);
  });

  it('шаги: по бетону и по воде; после конца вылазки шагов нет', () => {
    const r = new Recorder();
    const a = new GameAudio(r);
    a.setScene('play');
    const w = world();
    w.steps = 1;
    a.frame(w, 0.016, true);
    w.sortie!.inWater = true;
    w.steps = 1;
    a.frame(w, 0.016, true);
    w.sortie!.outcome = 'caught';
    w.steps = 1;
    a.frame(w, 0.016, true);
    expect(r.ids_()).toEqual(['step_concrete', 'step_water']);
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
    w.sortie!.panic = 0.9;
    w.sortie!.inGas = true;
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

  it('запись кончилась — мир стихает, помехи остаются', () => {
    const r = new Recorder();
    const a = new GameAudio(r);
    a.setScene('play');
    const w = world({ swarm: { pos: [1, 0, 0], active: true, cohesion: 1 }, staticLevel: 1 });
    w.sortie!.outcome = 'caught';
    w.sortie!.inGas = true;
    a.frame(w, 0.016, true);
    for (const id of ['amb_bunker', 'amb_deep', 'breath_calm', 'breath_panic', 'heartbeat', 'gas_hiss', 'swarm_loop']) expect(r.loops.get(id)).toBe(0);
    expect(r.loops.get('signal_static')).toBe(1);
  });

  it('в меню играет музыка, петли вылазки оборваны; в вылазке музыки нет', () => {
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

  it('съёмка приметы: звук наведения один раз за удержание', () => {
    const r = new Recorder();
    const a = new GameAudio(r);
    a.setScene('play');
    const w = world();
    w.sortie!.target = { kind: 'shoot' };
    w.sortie!.hold = 0.2;
    a.frame(w, 0.016, true);
    w.sortie!.hold = 0.5;
    a.frame(w, 0.016, true);
    w.sortie!.hold = 0;
    a.frame(w, 0.016, true);
    w.sortie!.hold = 0.1;
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
