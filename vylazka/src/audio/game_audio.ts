/**
 * Что и когда звучит: привязка звуков к событиям и состоянию игры. Движок (engine.ts) про игру
 * ничего не знает; здесь — ни одного вызова WebAudio.
 *
 * Разовые звуки приходят из событий шага симуляции, петли (эмбиент, дыхание, сердце, рой, помехи)
 * пересчитываются каждый кадр из состояния игры. Громкость петли — это и есть «слышно ли».
 */
import { clamp01 } from '../core/math';
import type { Vec3 } from '../core/types';
import type { StepEvents } from '../game';
import type { PlayOptions } from './engine';

/** Куда уходит звук: движок WebAudio в игре, записывающая заглушка в тестах. */
export interface SoundSink {
  play(id: string, opts?: PlayOptions): void;
  loop(id: string, gain: number, pos?: Vec3): void;
  stopLoops(keep?: string): void;
  setListener(pos: Vec3, yaw: number): void;
}

/** Что звуку нужно знать об игре (Game подходит как есть). */
export interface AudioWorld {
  light: { state: string };
  swarm: { pos: Vec3; active: boolean; cohesion: number } | null;
  session: { inWater: boolean; inGas: boolean; panic: number; hold: number } | null;
  /** Где игрок: в убежище, в карманном пространстве или в лимбо. */
  where: string;
  body: { y: number; vx: number; vz: number };
  swarmNear: number;
  staticLevel: number;
  listener(): { pos: Vec3; yaw: number };
  consumeFootstep(): boolean;
}

/** Экран приложения с точки зрения звука. */
export type AudioScene = 'silent' | 'menu' | 'play';

const MUSIC = 'music_menu';

/** Что грузить раньше остального: первые секунды вылазки и экран задания. */
export const LOAD_FIRST: readonly string[] = ['ui_click', 'ui_start', 'hatch', 'amb_bunker', 'breath_calm', 'step_concrete', 'flash_click', 'flash_die', 'flash_rattle', 'flash_spark', 'music_menu'];

export class GameAudio {
  private scene: AudioScene = 'silent';
  private rattleAt = 0;
  private dripAt = 6;
  private count = 0;
  private clock = 0;
  private holding = false;

  constructor(readonly engine: SoundSink) {}

  /** Небольшой разброс высоты тона, чтобы повторы не звучали одинаково. Свой счётчик, не Math.random. */
  private jitter(spread: number): number {
    this.count = (Math.imul(this.count, 1103515245) + 12345) >>> 0;
    return 1 + ((this.count >>> 8) / 16777216 - 0.5) * 2 * spread;
  }

  /** Звук интерфейса (нажатие в меню). */
  ui(id: 'ui_click' | 'ui_start' | 'ui_report'): void {
    this.engine.play(id);
  }

  /** Сменить экран: в меню играет музыка, в вылазке — только мир. */
  setScene(scene: AudioScene): void {
    if (scene === this.scene) return;
    this.scene = scene;
    if (scene !== 'play') this.engine.stopLoops(MUSIC);
  }

  /** Начало вылазки: над головой закрывается люк, камера пишет. */
  sortieStart(resumed: boolean): void {
    // Первое нажатие в игре — оно же старт: эти два звука готовы подождать свой файл.
    this.engine.play('ui_start', { late: 2 });
    if (!resumed) this.engine.play('hatch', { volume: 0.9, late: 4 });
    this.dripAt = 5;
    this.clock = 0;
  }

  /** События шага симуляции → разовые звуки. */
  onStep(ev: StepEvents, game: AudioWorld): void {
    const a = this.engine;
    if (ev.lightToggled) a.play('flash_click', { rate: this.jitter(0.04) });
    if (ev.lightFailed) a.play('flash_die');
    if (ev.lightRevived) a.play('flash_click', { rate: 1.12, volume: 1.1 });
    if (ev.spark) a.play('flash_spark', { rate: this.jitter(0.1) });
    // Тряска: батарейки гремят на каждый рывок, но не чаще восьми раз в секунду.
    if (ev.strokes > 0 && this.clock >= this.rattleAt) {
      this.rattleAt = this.clock + 0.12;
      a.play('flash_rattle', { rate: this.jitter(0.08), volume: game.light.state === 'dead' ? 1 : 0.6 });
    }

    for (const e of ev.session) {
      // Вспышка воспоминания — нарастающий тон камеры; «вспомнил» — её писк.
      if (e.type === 'reveal') a.play('camera_hold');
      else if (e.type === 'recall') a.play('camera_beep');
      else if (e.type === 'collapse') a.play('collapse', { pos: e.spec.center });
      else if (e.type === 'cough') a.play('cough', { rate: this.jitter(0.05) });
      else if (e.type === 'fall') a.play('fall');
    }
    for (const e of ev.dream) {
      // Скачок: искра в момент, когда место сменилось. Новая сессия начинается, как первая, — люком.
      if (e.type === 'jump' && e.phase === 'switch') a.play('flash_spark', { rate: 0.7, volume: 0.8 });
      else if (e.type === 'limbo') a.play('ui_report');
      else if (e.type === 'begin') a.play('hatch', { volume: 0.8 });
    }

    const swarmPos = game.swarm?.pos;
    for (const e of ev.fear) {
      if (e.type === 'scare') {
        // Мигание — искра в самом фонаре; у вспыхнувших надписей звука нет: тишина страшнее.
        if (e.id === 'flicker') a.play('flash_spark', { volume: 0.7 });
        else if (e.id !== 'signs') a.play(`scare_${e.id}`, e.pos ? { pos: e.pos, rate: this.jitter(0.06) } : {});
      } else if (e.what === 'cohered') a.play('swarm_cohere', swarmPos ? { pos: swarmPos } : {});
      else if (e.what === 'scattered') a.play('swarm_scatter', swarmPos ? { pos: swarmPos } : {});
      else if (e.what === 'caught') a.play('swarm_catch');
      else if (e.what === 'apparition') a.play('swarm_cohere', swarmPos ? { pos: swarmPos, volume: 0.45, rate: 0.85 } : { volume: 0.2 });
    }
  }

  /** Кадр: слушатель, шаги, петли. dt — реальное время кадра; active — идёт ли симуляция. */
  frame(game: AudioWorld, dt: number, active: boolean): void {
    const a = this.engine;
    if (this.scene === 'menu') {
      a.loop(MUSIC, 1);
      return;
    }
    a.loop(MUSIC, 0);
    if (this.scene !== 'play') return;

    const ears = game.listener();
    a.setListener(ears.pos, ears.yaw);
    const s = game.session;
    // В карманных пространствах и в лимбо убежища не слышно.
    const over = game.where !== 'main';
    const b = game.body;
    this.clock += dt;

    if (game.consumeFootstep() && active && !over) {
      const speed = Math.hypot(b.vx, b.vz);
      a.play(s?.inWater ? 'step_water' : 'step_concrete', { rate: this.jitter(0.07), volume: 0.55 + Math.min(0.45, speed / 9) });
    }

    // Игрок всматривается в искомую вещь: камера наводится.
    const holding = !over && (s?.hold ?? 0) > 0;
    if (holding && !this.holding) a.play('camera_hold');
    this.holding = holding;

    // Глубина 0…1: на нижних ярусах гул убежища сменяется давящим.
    const depth = clamp01(-b.y / 9);
    const panic = s?.panic ?? 0;
    const near = game.swarmNear;
    // Вне убежища его звуки стихают; помехи остаются.
    const live = over ? 0 : 1;
    a.loop('amb_bunker', live * (1 - depth * 0.7));
    a.loop('amb_deep', live * depth);
    a.loop('breath_calm', live * clamp01(1 - panic * 2.2));
    a.loop('breath_panic', live * clamp01((panic - 0.3) / 0.45));
    a.loop('heartbeat', live * clamp01(Math.max((panic - 0.35) / 0.5, near * 1.2)));
    a.loop('gas_hiss', s?.inGas ? live : 0);
    a.loop('signal_static', clamp01(game.staticLevel * 1.4));
    const sw = game.swarm;
    if (sw?.active && !over) a.loop('swarm_loop', 0.55 + 0.45 * sw.cohesion, sw.pos);
    else a.loop('swarm_loop', 0);

    // Капли: редкий одиночный звук откуда-то из темноты; глубже — чаще.
    if (active && !over && this.clock >= this.dripAt) {
      const k = this.jitter(0.5);
      this.dripAt = this.clock + (5 + 9 * (k - 0.5)) * (1 - depth * 0.4);
      const angle = this.jitter(0.5) * Math.PI * 4;
      const r = 4 + 6 * (this.jitter(0.5) - 0.5);
      const pos: Vec3 = [ears.pos[0] + Math.cos(angle) * r, ears.pos[1] - 1.2, ears.pos[2] + Math.sin(angle) * r];
      a.play('drip', { pos, rate: this.jitter(0.12) });
    }
  }
}
