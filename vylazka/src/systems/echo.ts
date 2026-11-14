/**
 * Эхо — второй способ видеть. Свет показывает место таким, какое оно есть; эхо показывает только,
 * что оно есть. От шага игрока, от щелчка фонаря и от Осыпи расходится волна; там, где её фронт
 * идёт по стенам и полу, на мгновение проступают кромки и линии равного расстояния — без цвета
 * и без подробностей. По волнам Осыпи слышно, где она: фронт приходит с её стороны, даже из-за спины.
 *
 * Здесь — только учёт волн (чистая логика). Рисует их один полноэкранный проход по карте глубины
 * (render/shaders.ts, ECHO_FRAG): волна — это точка в мире и радиус.
 */
import type { Vec3 } from '../core/types';

/** Род волны: от шага игрока, от Осыпи, от искомой вещи. Цвет у каждого свой. */
export const ECHO_STEP = 0;
export const ECHO_DRIFT = 1;
export const ECHO_THING = 2;
export type EchoKind = typeof ECHO_STEP | typeof ECHO_DRIFT | typeof ECHO_THING;

/** Сколько волн живёт разом (столько же ждёт шейдер). */
export const ECHO_MAX = 6;
/** Чисел на волну в упаковке для шейдера: x, y, z, радиус, сила, хвост, род, запас. */
export const ECHO_STRIDE = 8;

export interface EchoConfig {
  /** Скорость фронта, м/с. */
  speed: number;
  /** Докуда доходит волна каждого рода, м (сильная — дальше). */
  range: readonly [number, number, number];
  /** Длина светящегося хвоста за фронтом, м. */
  tail: number;
  /** Сколько волн шагов живёт разом: остальные места — для Осыпи и вещи. */
  steps: number;
}

/** Фронт идёт вдвое быстрее бега — за волной успеваешь следить; шаг слышно на 15 м, Осыпь — на 22. */
export const DEFAULT_ECHO: EchoConfig = { speed: 9, range: [15, 22, 24], tail: 2.0, steps: 3 };

interface Pulse {
  pos: Vec3;
  age: number;
  kind: EchoKind;
  strength: number;
}

export class Echo {
  /** Упаковка для шейдера: ECHO_MAX волн по ECHO_STRIDE чисел; у пустых мест сила — ноль. */
  readonly data = new Float32Array(ECHO_MAX * ECHO_STRIDE);
  private readonly pulses: Pulse[] = [];

  constructor(readonly cfg: EchoConfig = DEFAULT_ECHO) {}

  /** Сколько волн сейчас живо. */
  get count(): number {
    return this.pulses.length;
  }

  /** Докуда дойдёт волна этого рода и силы, м. */
  reach(kind: EchoKind, strength: number): number {
    return this.cfg.range[kind]! * (0.55 + 0.45 * Math.min(1, strength));
  }

  /**
   * Пустить волну. strength 0..1 — громкость источника (шаг — около половины, бег — единица).
   * Места заняты — уходит самая старая волна того же рода (у шагов свой предел), иначе самая старая вообще.
   */
  emit(pos: Vec3, kind: EchoKind, strength = 1): void {
    if (strength <= 0) return;
    const same = this.pulses.filter((p) => p.kind === kind);
    const limit = kind === ECHO_STEP ? this.cfg.steps : ECHO_MAX - this.cfg.steps;
    if (same.length >= limit) this.drop(same);
    else if (this.pulses.length >= ECHO_MAX) this.drop(this.pulses);
    this.pulses.push({ pos: [pos[0], pos[1], pos[2]], age: 0, kind, strength: Math.min(1, strength) });
  }

  private drop(from: readonly Pulse[]): void {
    let oldest = from[0]!;
    for (const p of from) if (p.age > oldest.age) oldest = p;
    this.pulses.splice(this.pulses.indexOf(oldest), 1);
  }

  /** Забыть все волны (другое место, новая сессия). */
  clear(): void {
    this.pulses.length = 0;
    this.data.fill(0);
  }

  /** Состарить волны на dt и упаковать их для шейдера. gain — общая сила эха (в свете оно слабее). */
  update(dt: number, gain = 1): void {
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i]!;
      p.age += dt;
      if (p.age * this.cfg.speed >= this.reach(p.kind, p.strength)) this.pulses.splice(i, 1);
    }
    const d = this.data;
    d.fill(0);
    this.pulses.forEach((p, i) => {
      const o = i * ECHO_STRIDE;
      const radius = p.age * this.cfg.speed;
      // К концу пути волна гаснет: последняя треть — плавно в ноль.
      const left = 1 - radius / this.reach(p.kind, p.strength);
      const fade = Math.min(1, left * 3);
      d[o] = p.pos[0];
      d[o + 1] = p.pos[1];
      d[o + 2] = p.pos[2];
      d[o + 3] = radius;
      d[o + 4] = (0.45 + 0.55 * p.strength) * fade * gain;
      d[o + 5] = this.cfg.tail;
      d[o + 6] = p.kind;
    });
  }

  /** Снимок для отладки и тестов: где волны и какого они радиуса. */
  snapshot(): { kind: EchoKind; pos: Vec3; radius: number; amp: number }[] {
    return this.pulses.map((p, i) => ({ kind: p.kind, pos: [...p.pos] as Vec3, radius: p.age * this.cfg.speed, amp: this.data[i * ECHO_STRIDE + 4]! }));
  }
}

/**
 * Призрак Осыпи. Когда она за спиной, впереди рисуется её отражение — как в зеркале, стоящем поперёк
 * взгляда (само отражение делает шейдер тела, ENTITY_VERT). Здесь — только мера «за спиной».
 */
/** Насколько точка «за спиной», 0..1: 0 — в поле зрения, 1 — сбоку-сзади и дальше. half — половина поля зрения, рад. */
export function behindness(cam: Vec3, yaw: number, p: Vec3, half: number): number {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const dx = p[0] - cam[0];
  const dz = p[2] - cam[2];
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-3) return 0;
  const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / dist)));
  // От края поля зрения до «сбоку и чуть назад» призрак проступает плавно.
  return Math.max(0, Math.min(1, (ang - half) / 0.5));
}
