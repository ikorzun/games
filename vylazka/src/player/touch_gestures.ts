/**
 * Жесты тач-управления: что значит каждое касание. Чистая логика без DOM — экран только передаёт
 * сюда касания и время (ui/touch_controls.ts).
 *
 * Правило одно на весь экран: коснулся и отпустил — шаг вперёд; держишь палец на месте — идёшь
 * вперёд, пока держишь; ведёшь пальцем — в левой половине это стик ходьбы (в любую сторону, до упора —
 * бег), в правой — луч. Идти и вести луч можно одним пальцем: удержание началось — палец ведёт луч,
 * а ходьба продолжается, пока он не отпущен.
 */

/** Сколько держать палец на месте, чтобы пойти, мс. */
export const HOLD_MS = 180;
/** Касание короче этого и без движения — тап, мс. */
export const TAP_MS = 260;
/** Сколько длится шаг по тапу, мс (около двух метров шагом). */
export const TAP_WALK_MS = 850;
/** Палец «на месте», пока не ушёл дальше этого, пиксели. */
export const SLOP = 12;
/** Радиус стика, пиксели; дальше ручка не идёт. */
export const STICK_R = 54;
/** Сколько радиан поворота на пиксель ведения. */
export const LOOK_SENS = 0.0052;

export type TouchRole = 'stick' | 'look';

interface Touch {
  role: TouchRole;
  x0: number;
  y0: number;
  x: number;
  y: number;
  t0: number;
  /** Палец ушёл с места раньше, чем удержание распозналось: это ведение, а не ходьба. */
  dragged: boolean;
  /** Удержание распознано: идём вперёд, пока палец не отпущен. */
  walk: boolean;
}

export interface GestureFrame {
  moveX: number;
  moveZ: number;
  run: boolean;
  lookYaw: number;
  lookPitch: number;
  /** Идём вперёд по тапу или удержанию (а не по стику). */
  walking: boolean;
  /** Стик под пальцем: где он появился и куда отведена ручка (пиксели); null — стика нет. */
  stick: { x: number; y: number; dx: number; dy: number } | null;
  /** Где держит палец тот, кто идёт удержанием в правой половине (для отметки на экране); null — никто. */
  hold: { x: number; y: number } | null;
}

export class TouchGestures {
  private readonly touches = new Map<number, Touch>();
  private lookYaw = 0;
  private lookPitch = 0;
  private tapUntil = -1;

  /** Касание началось. left — в левой половине экрана. Возвращает роль касания. */
  down(id: number, x: number, y: number, t: number, left: boolean): TouchRole {
    const hasStick = [...this.touches.values()].some((p) => p.role === 'stick');
    const role: TouchRole = left && !hasStick ? 'stick' : 'look';
    this.touches.set(id, { role, x0: x, y0: y, x, y, t0: t, dragged: false, walk: false });
    return role;
  }

  /** Удержание распознаётся по времени: палец на месте дольше HOLD_MS. */
  private settle(p: Touch, t: number): void {
    if (!p.dragged && !p.walk && t - p.t0 >= HOLD_MS) p.walk = true;
  }

  move(id: number, x: number, y: number, t: number): void {
    const p = this.touches.get(id);
    if (!p) return;
    // Сначала — не успело ли удержание начаться до этого движения.
    this.settle(p, t);
    const dx = x - p.x;
    const dy = y - p.y;
    p.x = x;
    p.y = y;
    const off = Math.hypot(x - p.x0, y - p.y0);
    if (p.role === 'look') {
      this.lookYaw -= dx * LOOK_SENS;
      this.lookPitch -= dy * LOOK_SENS;
      if (!p.walk && off > SLOP) p.dragged = true;
    } else if (off > SLOP) {
      // Стик отвели: дальше им и ходят, удержание кончилось.
      p.dragged = true;
      p.walk = false;
    }
  }

  up(id: number, t: number): void {
    const p = this.touches.get(id);
    if (!p) return;
    this.touches.delete(id);
    if (!p.dragged && !p.walk && t - p.t0 < TAP_MS) this.tapUntil = t + TAP_WALK_MS;
  }

  /** Что получилось к моменту t. Накопленный поворот отдаётся один раз. */
  poll(t: number): GestureFrame {
    const f: GestureFrame = { moveX: 0, moveZ: 0, run: false, lookYaw: this.lookYaw, lookPitch: this.lookPitch, walking: false, stick: null, hold: null };
    this.lookYaw = 0;
    this.lookPitch = 0;
    let forward = t < this.tapUntil;
    for (const p of this.touches.values()) {
      this.settle(p, t);
      if (p.role === 'stick') {
        let sx = p.x - p.x0;
        let sy = p.y - p.y0;
        const len = Math.hypot(sx, sy);
        if (len > STICK_R) {
          sx *= STICK_R / len;
          sy *= STICK_R / len;
        }
        f.stick = { x: p.x0, y: p.y0, dx: sx, dy: sy };
        const k = Math.min(1, len / STICK_R);
        // Мёртвая зона в центре; стик, отведённый до упора, — бег.
        if (p.dragged && k > 0.14) {
          f.moveX = sx / STICK_R;
          f.moveZ = -sy / STICK_R;
          f.run = k > 0.93;
        } else if (p.walk) forward = true;
      } else if (p.walk) {
        forward = true;
        f.hold = { x: p.x0, y: p.y0 };
      }
    }
    // Стик, если им ведут, главнее: вперёд по тапу или удержанию идём, только когда он молчит.
    if (forward && f.moveX === 0 && f.moveZ === 0) {
      f.moveZ = 1;
      f.walking = true;
    }
    return f;
  }

  release(): void {
    this.touches.clear();
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.tapUntil = -1;
  }
}
