/**
 * Нагрудная камера и рука с фонарём. Игрок ведёт ЛУЧ (aim) — быстро и без задержки; корпус с камерой
 * догоняет пружиной, поэтому луч гуляет по кадру: узнаваемый вид съёмки с бодикама.
 * Плюс шаговая качка, дыхание, дрожь рук (растёт с паникой) и болтанка при тряске фонаря.
 * Чистая математика без three.js; случайность здесь только визуальная, на сейв не влияет.
 */
import { angleDelta, approach, clamp, clamp01 } from '../core/math';
import type { Vec3 } from '../core/types';

export interface RigParams {
  /** Высота камеры над ступнями (грудь), м. */
  chestHeight: number;
  /** За сколько корпус догоняет луч, с. */
  followTau: number;
  /** Наибольшее опережение луча относительно камеры, рад. */
  maxLeadYaw: number;
  maxLeadPitch: number;
  /**
   * Рука с фонарём относительно камеры: вправо, вверх, вперёд, м. Фонарь держат у пояса: свет снизу
   * даёт длинные тени, уходящие вверх по стенам, и они заметно смещены относительно камеры.
   */
  hand: Vec3;
  /** Шагов на метр пути. */
  stepsPerMeter: number;
}

export const DEFAULT_RIG: RigParams = {
  chestHeight: 1.42,
  followTau: 0.13,
  maxLeadYaw: 0.4,
  maxLeadPitch: 0.27,
  hand: [0.27, -0.42, 0.18],
  stepsPerMeter: 0.72,
};

export interface RigInput {
  /** Позиция ступней (уже сглаженная между шагами симуляции). */
  x: number;
  y: number;
  z: number;
  aimYaw: number;
  aimPitch: number;
  /** Горизонтальная скорость, м/с. */
  speed: number;
  onGround: boolean;
  /** 0..1. */
  panic: number;
  /** 0..1: уровень тряски фонаря. */
  shake: number;
}

export interface RigOutput {
  camPos: Vec3;
  camYaw: number;
  camPitch: number;
  camRoll: number;
  lightPos: Vec3;
  /** Нормированное направление луча в мире. */
  lightDir: Vec3;
  /** Игрок сделал шаг в этом кадре (для звука). */
  footstep: boolean;
}

/** Несколько несоизмеримых синусов: плавный «ручной» шум в [-1, 1] без памяти. */
function wobble(t: number, seed: number): number {
  return (Math.sin(t * 1.13 + seed) + 0.6 * Math.sin(t * 2.71 + seed * 1.7) + 0.35 * Math.sin(t * 5.3 + seed * 2.9)) / 1.95;
}

/** Направление по рысканию и тангажу: yaw 0 смотрит вдоль -Z, положительный yaw — влево (как в three.js). */
export function dirFromAngles(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

export class CameraRig {
  camYaw = 0;
  camPitch = 0;
  private camY = 0;
  private time = 0;
  private stepPhase = 0;
  private bobAmp = 0;
  private started = false;

  constructor(private readonly params: RigParams = DEFAULT_RIG) {}

  /** Мгновенно поставить камеру по лучу (старт, телепорт). */
  snap(input: RigInput): void {
    this.camYaw = input.aimYaw;
    this.camPitch = input.aimPitch;
    this.camY = input.y;
    this.started = true;
  }

  /** Сдвинуть сглаженную высоту вместе с игроком (телепорт без рывка кадра). */
  shift(dy: number): void {
    this.camY += dy;
  }

  update(input: RigInput, dt: number): RigOutput {
    const p = this.params;
    if (!this.started) this.snap(input);
    this.time += dt;
    const t = this.time;

    // Корпус догоняет луч; дальше предела луч тянет камеру за собой сразу.
    this.camYaw += angleDelta(this.camYaw, input.aimYaw) * (1 - Math.exp(-dt / p.followTau));
    const leadYaw = angleDelta(this.camYaw, input.aimYaw);
    if (Math.abs(leadYaw) > p.maxLeadYaw) this.camYaw = input.aimYaw - Math.sign(leadYaw) * p.maxLeadYaw;
    this.camPitch = approach(this.camPitch, input.aimPitch, p.followTau, dt);
    this.camPitch = clamp(this.camPitch, input.aimPitch - p.maxLeadPitch, input.aimPitch + p.maxLeadPitch);

    // Ступеньки не дёргают кадр: высота сглаживается.
    this.camY = Math.abs(input.y - this.camY) > 1.2 ? input.y : approach(this.camY, input.y, 0.07, dt);

    // Шаговая качка.
    const moving = input.onGround ? clamp01(input.speed / 2.2) : 0;
    this.bobAmp = approach(this.bobAmp, moving, 0.15, dt);
    const before = Math.floor(this.stepPhase);
    this.stepPhase += input.speed * dt * p.stepsPerMeter * (input.onGround ? 1 : 0);
    const footstep = Math.floor(this.stepPhase) !== before && moving > 0.2;
    const ph = this.stepPhase * Math.PI * 2;
    const runK = clamp01((input.speed - 2.4) / 2);
    const bobY = -Math.abs(Math.sin(ph * 0.5)) * (0.028 + 0.03 * runK) * this.bobAmp;
    const sway = Math.sin(ph * 0.5) * (0.022 + 0.02 * runK) * this.bobAmp;

    // Дыхание и дрожь: спокойные в покое, частые и крупные в панике.
    const breathRate = 1.5 + 3.2 * input.panic;
    const breath = Math.sin(t * breathRate);
    const tremor = 0.004 + 0.02 * input.panic;
    const shakeK = input.shake;

    const camYaw = this.camYaw + sway * 0.9 + wobble(t * 0.9, 1.3) * tremor + wobble(t * 23, 4.1) * 0.035 * shakeK;
    const camPitch = this.camPitch + breath * (0.004 + 0.01 * input.panic) + wobble(t * 1.1, 2.7) * tremor + wobble(t * 27, 7.7) * 0.03 * shakeK;
    const camRoll = sway * 0.55 + wobble(t * 0.7, 5.9) * tremor * 0.8 + wobble(t * 19, 9.3) * 0.045 * shakeK;

    // Позиция камеры: грудь, с боковым смещением при шаге.
    const rightX = Math.cos(this.camYaw);
    const rightZ = -Math.sin(this.camYaw);
    const camPos: Vec3 = [input.x + rightX * sway * 0.9, this.camY + p.chestHeight + bobY + breath * 0.004, input.z + rightZ * sway * 0.9];

    // Рука: привязана к лучу, слегка отстаёт и дрожит; при тряске болтается сильно.
    const handYaw = input.aimYaw + wobble(t * 1.7, 11.1) * (0.006 + 0.03 * input.panic) + wobble(t * 31, 3.3) * 0.2 * shakeK;
    const handPitch = input.aimPitch + wobble(t * 1.9, 13.7) * (0.006 + 0.03 * input.panic) + wobble(t * 29, 6.1) * 0.16 * shakeK + sway * 0.25;
    const fwd = dirFromAngles(input.aimYaw, 0);
    const aimRightX = Math.cos(input.aimYaw);
    const aimRightZ = -Math.sin(input.aimYaw);
    const handBob = Math.sin(ph) * 0.012 * this.bobAmp + wobble(t * 25, 8.8) * 0.05 * shakeK;
    const lightPos: Vec3 = [
      camPos[0] + aimRightX * p.hand[0] + fwd[0] * p.hand[2],
      camPos[1] + p.hand[1] + handBob,
      camPos[2] + aimRightZ * p.hand[0] + fwd[2] * p.hand[2],
    ];

    return { camPos, camYaw, camPitch, camRoll, lightPos, lightDir: dirFromAngles(handYaw, handPitch), footstep };
  }
}
