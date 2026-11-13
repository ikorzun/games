/**
 * Фонарь: заряд, случайные отказы контакта и оживление тряской. Чистый автомат без three.js.
 *
 *   on ──(отказ: сначала предупреждающее мерцание)──▶ dead ──(тряска набрала нужное)──▶ on
 *   on ◀──(кнопка)──▶ off
 *
 * Отказы чаще при низком заряде, в сырости, в панике и особенно рядом с роем: частое мерцание
 * и есть предупреждение игроку. Тряска шумит — об этом сообщает событие rattle.
 */
import { clamp01, smoothstep } from '../core/math';
import type { Rng } from '../core/rng';

export type LightState = 'on' | 'off' | 'dead';

export interface FlashlightConfig {
  /** Средний интервал между отказами в спокойных условиях, с. */
  meanFailInterval: number;
  /** После оживления отказ невозможен столько секунд. */
  graceAfterRevive: number;
  /** Первый отказ принудительно через столько секунд работы (0 — нет). Нужен обучению и техническому срезу. */
  firstFailAt: number;
  /** Сколько секунд энергичной тряски нужно, от и до. */
  reviveNeed: [number, number];
  /** За сколько секунд горения садится полный заряд. */
  drainSeconds: number;
}

export const DEFAULT_FLASHLIGHT: FlashlightConfig = {
  meanFailInterval: 80,
  graceAfterRevive: 14,
  firstFailAt: 0,
  reviveNeed: [0.6, 1.5],
  drainSeconds: 540,
};

export interface FlashlightEnv {
  /** 0..1. */
  panic: number;
  /** 0..1: сырость вокруг (затопленный участок). */
  wet: number;
  /** 0..1: близость роя. */
  swarm: number;
  /** 0..1: уровень тряски из ShakeMeter. */
  shake: number;
}

export const CALM_ENV: FlashlightEnv = { panic: 0, wet: 0, swarm: 0, shake: 0 };

export interface FlashlightEvents {
  failed: boolean;
  revived: boolean;
  /** Короткая вспышка-искра при тряске заглохшего фонаря. */
  spark: boolean;
  clicked: boolean;
  /** Громкость дребезга за шаг, 0..1 (шум, который слышит рой). */
  rattle: number;
}

export class Flashlight {
  state: LightState = 'on';
  /** Заряд батарейки, 0..1. */
  charge = 1;
  /** Итоговая яркость с мерцанием, 0..~1.2: подаётся в шейдер. */
  intensity = 1;
  /** Прогресс оживления, 0..1 (для подсказки на экране). */
  reviveProgress = 0;
  /** Фонарь разобран (идёт замена батарейки): света нет, время не идёт. */
  suspended = false;

  private sinceRevive = 0;
  private litTime = 0;
  private firstFailDone = false;
  /** > 0 — идёт предупреждающее мерцание перед отказом. */
  private dying = 0;
  private forced = false;
  private need = 1;
  private work = 0;
  private sparkLeft = 0;
  /** > 0 — нестабильное мерцание сразу после оживления. */
  private unstable = 0;
  private flickerValue = 1;
  private flickerHold = 0;

  constructor(
    private readonly rng: Rng,
    private readonly cfg: FlashlightConfig = DEFAULT_FLASHLIGHT,
  ) {}

  /** Кнопка фонаря. У заглохшего фонаря кнопка света не даёт (но щелчок слышен). */
  toggle(): void {
    if (this.state === 'on') this.state = 'off';
    else if (this.state === 'off') {
      this.state = this.charge > 0 ? 'on' : 'dead';
      if (this.state === 'dead') this.beginDead();
    }
  }

  /** Вставить свежую батарейку: полный заряд, фонарь горит. */
  replaceBattery(): void {
    this.charge = 1;
    this.state = 'on';
    this.dying = 0;
    this.sinceRevive = 0;
    this.unstable = 0.35;
    this.reviveProgress = 0;
  }

  /** Заставить фонарь мигать заданное время, не гася его (пугалка). */
  stutter(seconds: number): void {
    if (this.state === 'on') this.unstable = Math.max(this.unstable, seconds);
  }

  /** Батарейка села: тряска не поможет, нужна замена. */
  get empty(): boolean {
    return this.charge <= 0;
  }

  /** Принудительный отказ (отладка, сценарные события). */
  forceFail(): void {
    if (this.state !== 'on') return;
    this.dying = 0;
    this.beginDead();
    // Об отказе сообщит следующий шаг: звук и вибрация у принудительного отказа те же, что у случайного.
    this.forced = true;
  }

  private beginDead(): void {
    this.state = 'dead';
    this.work = 0;
    this.reviveProgress = 0;
    const [lo, hi] = this.cfg.reviveNeed;
    this.need = lo + (hi - lo) * this.rng();
  }

  /** Вероятность отказа в секунду при данных условиях. */
  hazard(env: FlashlightEnv): number {
    const low = 1 - clamp01(this.charge);
    return (1 / this.cfg.meanFailInterval) * (1 + 2.5 * low * low) * (1 + 2 * env.wet) * (1 + 1.5 * env.panic) * (1 + 6 * env.swarm);
  }

  update(dt: number, env: FlashlightEnv = CALM_ENV): FlashlightEvents {
    const ev: FlashlightEvents = { failed: false, revived: false, spark: false, clicked: false, rattle: 0 };
    if (this.suspended) {
      this.intensity = 0;
      return ev;
    }
    this.sinceRevive += dt;
    if (this.forced) {
      this.forced = false;
      ev.failed = true;
    }

    if (this.state === 'on') {
      this.litTime += dt;
      this.charge = Math.max(0, this.charge - dt / this.cfg.drainSeconds);
      if (this.charge <= 0) {
        this.beginDead();
        ev.failed = true;
      } else if (this.dying > 0) {
        this.dying -= dt;
        if (this.dying <= 0) {
          this.beginDead();
          ev.failed = true;
        }
      } else {
        // Принудительный первый отказ (обучение) передышку не ждёт; случайные — только после неё.
        const forced = !this.firstFailDone && this.cfg.firstFailAt > 0 && this.litTime >= this.cfg.firstFailAt;
        const random = this.sinceRevive >= this.cfg.graceAfterRevive && this.rng() < this.hazard(env) * dt;
        if (forced || random) {
          this.firstFailDone = true;
          this.dying = 0.5 + this.rng() * 0.9;
        }
      }
    } else if (this.state === 'dead') {
      if (env.shake > 0.05) {
        ev.rattle = env.shake;
        // Вялая тряска почти не помогает: вклад растёт быстрее уровня.
        this.work += Math.pow(env.shake, 1.3) * dt;
        if (this.sparkLeft <= 0 && this.rng() < env.shake * 9 * dt) {
          this.sparkLeft = 0.04 + this.rng() * 0.07;
          ev.spark = true;
        }
      }
      this.reviveProgress = clamp01(this.work / this.need);
      if (this.work >= this.need && this.charge > 0) {
        this.state = 'on';
        this.sinceRevive = 0;
        this.unstable = 0.5;
        this.reviveProgress = 0;
        ev.revived = true;
      }
    }

    this.updateIntensity(dt, env);
    return ev;
  }

  private updateIntensity(dt: number, env: FlashlightEnv): void {
    this.sparkLeft = Math.max(0, this.sparkLeft - dt);
    this.unstable = Math.max(0, this.unstable - dt);
    if (this.state === 'off') {
      this.intensity = 0;
      return;
    }
    if (this.state === 'dead') {
      this.intensity = this.sparkLeft > 0 ? 0.25 + 0.5 * this.rng() : 0;
      return;
    }
    // Садящаяся батарейка: свет тускнеет на последней четверти заряда.
    const base = 0.3 + 0.7 * smoothstep(0, 0.25, this.charge);
    // Мерцание: ступенчатый шум, удерживаемый несколько сотых секунды. Перед отказом и после оживления — сильное.
    this.flickerHold -= dt;
    if (this.flickerHold <= 0) {
      const strong = this.dying > 0 || this.unstable > 0;
      const depth = strong ? 0.85 : 0.04 + 0.5 * env.swarm + 0.12 * env.panic;
      const chance = strong ? 0.55 : 0.08 + 0.5 * env.swarm;
      this.flickerValue = this.rng() < chance ? 1 - depth * this.rng() : 1;
      this.flickerHold = 0.02 + this.rng() * (strong ? 0.07 : 0.12);
    }
    this.intensity = base * this.flickerValue;
  }
}
