/**
 * Детектор тряски: «насколько энергично игрок сейчас трясёт фонарь», 0..1.
 * Три источника складываются в один уровень:
 *   - движение указателя (мышь на ПК, палец по кнопке фонаря на телефоне): считаются развороты
 *     направления с достаточным размахом — медленный поворот камеры тряской не считается;
 *   - акселерометр телефона (необязательное усиление, включается только если события реально идут);
 *   - отдельные импульсы (клавиша F — «стукнуть ладонью», тап по кнопке).
 * Чистая логика над сэмплами: проверяется на синтетических сигналах.
 */
import { clamp01 } from '../core/math';

export interface ShakeParams {
  /** Затухание уровня: за это время остаётся 1/e. */
  decayTau: number;
  /** Разворот засчитывается, если предыдущий ход был не раньше этого времени назад, с. */
  strokeWindow: number;
  /** Вклад одного полного размаха в уровень. */
  strokeGain: number;
  /** Порог ускорения без гравитации, м/с²: ниже — ходьба и дрожь рук. */
  accelFloor: number;
  /** Диапазон ускорения над порогом, дающий полный вклад. */
  accelSpan: number;
  /** Скорость набора уровня от акселерометра, 1/с при полном вкладе. */
  accelGain: number;
}

export const DEFAULT_SHAKE: ShakeParams = {
  decayTau: 0.32,
  strokeWindow: 0.45,
  strokeGain: 0.3,
  accelFloor: 7,
  accelSpan: 14,
  accelGain: 5,
};

/** Размах хода в пикселях CSS: меньше min — шум, ref и больше — полный вклад. */
export interface MotionScale {
  min: number;
  ref: number;
}

export const MOUSE_SCALE: MotionScale = { min: 16, ref: 70 };
export const TOUCH_SCALE: MotionScale = { min: 9, ref: 40 };

interface AxisState {
  dir: number;
  run: number;
  sinceStroke: number;
}

export class ShakeMeter {
  /** Текущая энергичность тряски, 0..1. */
  level = 0;
  /** Сколько ходов засчитано всего (для звука дребезга и вибрации). */
  strokes = 0;

  private readonly axes: [AxisState, AxisState] = [
    { dir: 0, run: 0, sinceStroke: 99 },
    { dir: 0, run: 0, sinceStroke: 99 },
  ];
  /** Медленная оценка гравитации — для устройств, которые отдают только ускорение вместе с ней. */
  private gravity: [number, number, number] | null = null;

  constructor(private readonly params: ShakeParams = DEFAULT_SHAKE) {}

  /** Смещение указателя с прошлого события, пиксели CSS. */
  pushMotion(dx: number, dy: number, scale: MotionScale = MOUSE_SCALE): void {
    this.pushAxis(this.axes[0], dx, scale);
    this.pushAxis(this.axes[1], dy, scale);
  }

  private pushAxis(a: AxisState, d: number, scale: MotionScale): void {
    if (d === 0) return;
    const dir = d > 0 ? 1 : -1;
    if (dir === a.dir || a.dir === 0) {
      a.dir = dir;
      a.run += Math.abs(d);
      return;
    }
    // Разворот: засчитываем предыдущий ход, если он был достаточно размашистым и недавним.
    if (a.run >= scale.min && a.sinceStroke <= this.params.strokeWindow) {
      const amp = clamp01((a.run - scale.min) / (scale.ref - scale.min));
      this.level = clamp01(this.level + this.params.strokeGain * (0.35 + 0.65 * amp));
      this.strokes += 1;
    }
    if (a.run >= scale.min) a.sinceStroke = 0;
    a.dir = dir;
    a.run = Math.abs(d);
  }

  /**
   * Сэмпл акселерометра, м/с². withGravity — если устройство отдаёт только ускорение с гравитацией:
   * тогда она вычитается медленным фильтром. dt — время с прошлого сэмпла.
   */
  pushAccel(ax: number, ay: number, az: number, dt: number, withGravity = false): void {
    let x = ax;
    let y = ay;
    let z = az;
    if (withGravity) {
      if (!this.gravity) this.gravity = [ax, ay, az];
      const k = 1 - Math.exp(-dt / 0.6);
      const g = this.gravity;
      g[0] += (ax - g[0]) * k;
      g[1] += (ay - g[1]) * k;
      g[2] += (az - g[2]) * k;
      x -= g[0];
      y -= g[1];
      z -= g[2];
    }
    const m = Math.hypot(x, y, z);
    const over = clamp01((m - this.params.accelFloor) / this.params.accelSpan);
    if (over > 0) this.level = clamp01(this.level + over * this.params.accelGain * dt);
  }

  /** Разовый толчок (клавиша, тап): strength 0..1. */
  pushImpulse(strength: number): void {
    this.level = clamp01(this.level + strength);
    this.strokes += 1;
  }

  /** Шаг времени: уровень затухает. Возвращает текущий уровень. */
  update(dt: number): number {
    this.level *= Math.exp(-dt / this.params.decayTau);
    if (this.level < 1e-4) this.level = 0;
    for (const a of this.axes) a.sinceStroke += dt;
    return this.level;
  }

  reset(): void {
    this.level = 0;
    for (const a of this.axes) {
      a.dir = 0;
      a.run = 0;
      a.sinceStroke = 99;
    }
    this.gravity = null;
  }
}
