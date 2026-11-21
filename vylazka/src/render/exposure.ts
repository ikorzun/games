/**
 * Автоэкспозиция камеры, посчитанная аналитически (без чтения пикселей): по яркости пятна фонаря
 * на ближайших преградах. Смотришь вдаль или фонарь погас — камера «тянет» усиление, растёт зерно;
 * близкая стена — усиление падает. Темнеет быстро, светлеет медленно, как у настоящего сенсора.
 */
import { approach, clamp } from '../core/math';

export interface ExposureParams {
  minGain: number;
  /** Предел усиления при горящем фонаре: выше — кадр превращается в серую пелену. */
  maxGainLit: number;
  /** Предел в полной темноте: камера «тянет» картинку, зерно растёт. */
  maxGain: number;
  /** Расстояние до стены, при котором усиление равно 1. */
  refDist: number;
  tauDown: number;
  tauUp: number;
}

export const DEFAULT_EXPOSURE: ExposureParams = { minGain: 0.8, maxGainLit: 2.1, maxGain: 5.5, refDist: 3.2, tauDown: 0.16, tauUp: 1.1 };

/** Затухание света фонаря с расстоянием (та же формула, что в шейдере). */
export const beamAtten = (d: number): number => 1 / (1 + 0.07 * d * d);

export class AutoExposure {
  gain = 1.6;

  constructor(private readonly p: ExposureParams = DEFAULT_EXPOSURE) {}

  /**
   * Целевое усиление. sceneLum — яркость самого светлого освещённого места в кадре
   * (яркость фонаря × затухание до преграды), lightIntensity — яркость фонаря.
   */
  target(sceneLum: number, lightIntensity: number): number {
    const ref = beamAtten(this.p.refDist);
    const lit = clamp(lightIntensity * 3, 0, 1);
    const max = this.p.maxGain + (this.p.maxGainLit - this.p.maxGain) * lit;
    return clamp(ref / Math.max(sceneLum, 1e-3), this.p.minGain, max);
  }

  update(dt: number, sceneLum: number, lightIntensity: number): number {
    const t = this.target(sceneLum, lightIntensity);
    this.gain = approach(this.gain, t, t < this.gain ? this.p.tauDown : this.p.tauUp, dt);
    return this.gain;
  }

  /** Шум сенсора растёт вместе с усилением. */
  noise(): number {
    return 0.009 + 0.013 * (this.gain - 1);
  }
}
