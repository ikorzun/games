/**
 * Кинематический контроллер игрока: вертикальный цилиндр против осевых коробок.
 * Без физического движка. Низкие препятствия (не выше stepHeight) перешагиваются — поэтому
 * лестницы собираются просто из ступенек-коробок. Прыжка нет; есть гравитация и падение в провалы.
 * Чистый TS: проверяется в vitest.
 */
import { approach } from '../core/math';
import type { Aabb, ColliderSet } from '../world/colliders';

export interface ControllerParams {
  radius: number;
  height: number;
  stepHeight: number;
  gravity: number;
  /** Время разгона и торможения, с (экспоненциальное приближение). */
  accelTau: number;
  /** Ниже этой высоты игрок считается упавшим в бездну. */
  killY: number;
}

export const DEFAULT_CONTROLLER: ControllerParams = {
  radius: 0.3,
  height: 1.75,
  stepHeight: 0.36,
  gravity: 19,
  accelTau: 0.09,
  killY: -60,
};

export interface PlayerBody {
  /** Позиция ступней. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
}

export interface StepResult {
  /** Скорость удара о землю при приземлении, м/с (0 — приземления не было). */
  landed: number;
  /** Игрок провалился ниже killY. */
  fellOut: boolean;
}

export function createBody(x: number, y: number, z: number): PlayerBody {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: true };
}

const scratch: Aabb[] = [];

/** Высота опоры под точкой: верх самой высокой коробки, на которую можно встать с высоты feetY. */
export function groundHeight(colliders: ColliderSet, x: number, z: number, feetY: number, params: ControllerParams): number {
  const r = params.radius * 0.55;
  colliders.query(x - r, z - r, x + r, z + r, scratch);
  let best = -Infinity;
  const limit = feetY + params.stepHeight + 1e-4;
  for (const b of scratch) {
    if (b.maxY > limit || b.maxY <= best) continue;
    // Круг уменьшенного радиуса против прямоугольника коробки.
    const cx = Math.max(b.minX, Math.min(x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    const dx = x - cx;
    const dz = z - cz;
    if (dx * dx + dz * dz <= r * r) best = b.maxY;
  }
  return best;
}

/** Вытолкнуть круг игрока из коробок, которые нельзя перешагнуть. Возвращает true, если было касание. */
function resolveWalls(body: PlayerBody, colliders: ColliderSet, params: ControllerParams): boolean {
  const r = params.radius;
  let touched = false;
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    colliders.query(body.x - r, body.z - r, body.x + r, body.z + r, scratch);
    for (const b of scratch) {
      // По вертикали: коробка ниже порога шага — это пол или ступенька; выше головы — не мешает.
      if (b.maxY <= body.y + params.stepHeight + 1e-4) continue;
      if (b.minY >= body.y + params.height) continue;
      const cx = Math.max(b.minX, Math.min(body.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(body.z, b.maxZ));
      const dx = body.x - cx;
      const dz = body.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      let nx: number;
      let nz: number;
      let push: number;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        nx = dx / d;
        nz = dz / d;
        push = r - d;
      } else {
        // Центр внутри коробки: выходим по оси наименьшего проникновения.
        const left = body.x - b.minX;
        const right = b.maxX - body.x;
        const back = body.z - b.minZ;
        const front = b.maxZ - body.z;
        const m = Math.min(left, right, back, front);
        nx = 0;
        nz = 0;
        if (m === left) nx = -1;
        else if (m === right) nx = 1;
        else if (m === back) nz = -1;
        else nz = 1;
        push = m + r;
      }
      body.x += nx * push;
      body.z += nz * push;
      // Гасим составляющую скорости в стену, вдоль стены — скользим.
      const vn = body.vx * nx + body.vz * nz;
      if (vn < 0) {
        body.vx -= vn * nx;
        body.vz -= vn * nz;
      }
      moved = true;
      touched = true;
    }
    if (!moved) break;
  }
  return touched;
}

/**
 * Один шаг симуляции. wishX/wishZ — желаемое направление в мире (длина 0..1), speed — м/с.
 */
export function stepPlayer(body: PlayerBody, wishX: number, wishZ: number, speed: number, dt: number, colliders: ColliderSet, params: ControllerParams = DEFAULT_CONTROLLER): StepResult {
  const result: StepResult = { landed: 0, fellOut: false };
  // В воздухе управление почти не действует: с уступа падают по инерции.
  const tau = body.onGround ? params.accelTau : params.accelTau * 6;
  body.vx = approach(body.vx, wishX * speed, tau, dt);
  body.vz = approach(body.vz, wishZ * speed, tau, dt);

  // Горизонталь — подшагами не длиннее половины радиуса, чтобы не проскочить тонкую стену.
  const dist = Math.hypot(body.vx, body.vz) * dt;
  const sub = Math.max(1, Math.ceil(dist / (params.radius * 0.5)));
  for (let i = 0; i < sub; i++) {
    body.x += (body.vx * dt) / sub;
    body.z += (body.vz * dt) / sub;
    resolveWalls(body, colliders, params);
  }

  // Вертикаль.
  const ground = groundHeight(colliders, body.x, body.z, body.y, params);
  if (body.onGround) {
    if (ground >= body.y - 1e-4) {
      body.y = ground; // шаг вверх на ступеньку (камера сглаживает сама)
      body.vy = 0;
    } else if (body.y - ground <= params.stepHeight) {
      body.y = ground; // шаг вниз без «полёта» — спуск по лестнице
      body.vy = 0;
    } else {
      body.onGround = false;
    }
  }
  if (!body.onGround) {
    body.vy -= params.gravity * dt;
    // Опору ищем от высоты ДО шага: иначе на большой скорости пол окажется «выше порога» и игрок пролетит сквозь него.
    const g = groundHeight(colliders, body.x, body.z, body.y, params);
    body.y += body.vy * dt;
    if (g > -Infinity && body.y <= g) {
      result.landed = -body.vy;
      body.y = g;
      body.vy = 0;
      body.onGround = true;
    }
  }
  if (body.y < params.killY) result.fellOut = true;
  return result;
}
