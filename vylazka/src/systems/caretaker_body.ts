/**
 * Тело Смотрителя: когда оно есть и как уходит (что это за фигура и где стоит — world/caretaker_body.ts).
 *
 * Есть оно один раз за игру: в лимбо, на сцене A4_E03 (ui/koma_flow.ts зовёт come, договорили — go). Дым собирается у стола,
 * и, пока игрок смотрит, рука по кругу разглаживает и выравнивает бирку. Договорили — дым рассеивается; подошёл ближе NEAR_M —
 * рассеивается тоже, как дымные фигуры мест (systems/figures.ts). Обратно не собирается: в отличие от фигур мест, тело — один
 * раз, второго не будет и после перезагрузки (сцена канона играется однажды).
 *
 * Чистая логика: игра (game.ts) ставит сетки и читает поля, тесты — состояние.
 */
import type { Vec3 } from '../core/types';
import { GESTURE_S } from '../world/caretaker_body';

/** none — ещё не было; coming — дым собирается; here — стоит и работает; going — рассеивается; gone — было и ушло. */
export type CaretakerState = 'none' | 'coming' | 'here' | 'going' | 'gone';

export const CARETAKER = {
  /** Ближе стольких метров (середина тела против груди игрока) — рассеивается. */
  near: 1.2,
  /** Дым собирается за столько секунд. */
  come: 1.6,
  /** Фигура рассеивается за столько секунд (как дымные фигуры мест, smokeGo); стол и бирка — следом, на delay позже. */
  go: 1.5,
  delay: 0.45,
} as const;

export class CaretakerBody {
  state: CaretakerState = 'none';
  /** Время в этом состоянии, с. */
  t = 0;
  /** Где стоит (подошвы) и поворот; середина тела в мире — от неё меряется «подошёл». */
  at: Vec3 = [0, 0, 0];
  yaw = 0;
  core: Vec3 = [0, 0, 0];
  /** Доля круга жеста 0…1: пока дым собирается или рассеивается, рука стоит. */
  u = 0;
  /** Распад фигуры и распад стола с биркой: 0 — на месте, 1 — ушли. */
  dissolve = 0;
  rest = 0;
  /** Почему ушло: договорили или подошли (для проверок и аналитики). */
  why: 'end' | 'near' | null = null;

  /** Есть в кадре (хоть отчасти). */
  get shown(): boolean {
    return this.state === 'coming' || this.state === 'here' || this.state === 'going';
  }

  /**
   * Встать: только в лимбо и только один раз. at — подошвы, yaw — поворот, core — середина тела в координатах фигуры.
   * false — не встало (не лимбо или тело уже было).
   */
  come(limbo: boolean, at: Vec3, yaw: number, core: Vec3): boolean {
    if (!limbo || this.state !== 'none') return false;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    this.at = at;
    this.yaw = yaw;
    this.core = [at[0] + core[0] * c + core[2] * s, at[1] + core[1], at[2] - core[0] * s + core[2] * c];
    this.state = 'coming';
    this.t = 0;
    this.u = 0;
    this.dissolve = 1;
    this.rest = 1;
    this.why = null;
    return true;
  }

  /** Сцена договорена: рассеяться. */
  go(why: 'end' | 'near' = 'end'): void {
    if (this.state !== 'coming' && this.state !== 'here') return;
    this.state = 'going';
    this.t = 0;
    this.why = why;
  }

  /** Лимбо кончилось, пока тело стояло: убрать сразу — в следующем месте его нет. */
  drop(): void {
    if (this.state === 'none' || this.state === 'gone') return;
    this.state = 'gone';
    this.t = 0;
    this.dissolve = 1;
    this.rest = 1;
  }

  /** Шаг: eye — глаза игрока. true — тело только что ушло совсем (сетки можно снимать). */
  update(dt: number, eye: Vec3): boolean {
    if (!this.shown) return false;
    this.t += dt;
    if (this.state === 'coming' || this.state === 'here') {
      const d = Math.hypot(this.core[0] - eye[0], this.core[1] - (eye[1] - 0.45), this.core[2] - eye[2]);
      if (d < CARETAKER.near) this.go('near');
    }
    if (this.state === 'coming') {
      this.dissolve = Math.max(0, 1 - this.t / CARETAKER.come);
      this.rest = this.dissolve;
      if (this.dissolve <= 0) {
        this.state = 'here';
        this.t = 0;
      }
    } else if (this.state === 'here') {
      this.u = (this.u + dt / GESTURE_S) % 1;
    } else if (this.state === 'going') {
      this.dissolve = Math.min(1, this.dissolve + dt / CARETAKER.go);
      if (this.t > CARETAKER.delay) this.rest = Math.min(1, this.rest + dt / CARETAKER.go);
      if (this.dissolve >= 1 && this.rest >= 1) {
        this.state = 'gone';
        this.t = 0;
        return true;
      }
    }
    return false;
  }
}
