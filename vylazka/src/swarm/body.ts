/**
 * Осыпь (в коде — рой): тело. Сотня прядей, у каждой две цели — место в осадке (на полу и по стенам
 * вокруг центра) и место в собранной фигуре (столб с «головой»). Сцепление 0..1 смешивает цели;
 * пряди тянутся к ним пружиной и вьются. Здесь только позиции голов и направления — сами точки
 * вдоль пряди расставляет вершинный шейдер (ENTITY_VERT). Случайность визуальная, на сохранение не влияет.
 *
 * Фигура растёт вместе с сессией (growth 0..1): пока ничего не вспомнено, это низкая широкая куча;
 * чем больше вспомнено, тем она выше и стройнее, а «голова» появляется только у выросшей.
 */
import type { Vec3 } from '../core/types';

export const MAX_WORMS = 96;

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class SwarmBody {
  /** Головы червей: xyz подряд. */
  readonly heads = new Float32Array(MAX_WORMS * 3);
  /** Направления движения (единичные). */
  readonly dirs = new Float32Array(MAX_WORMS * 3);
  /** Зерно и длина каждого червя. */
  readonly params = new Float32Array(MAX_WORMS * 2);
  private readonly vel = new Float32Array(MAX_WORMS * 3);
  /** Место в рассеянном рое: смещение от центра. */
  private readonly spread = new Float32Array(MAX_WORMS * 3);
  /** Место в фигуре: высота, угол и радиус на столбе. */
  private readonly figure = new Float32Array(MAX_WORMS * 3);
  private time = 0;
  private placed = false;

  constructor(seed = 7) {
    const rnd = lcg(seed);
    for (let i = 0; i < MAX_WORMS; i++) {
      // Рассеянный рой: пятно на полу, часть червей — на стенах коридора по бокам.
      const onWall = rnd() < 0.3;
      const ang = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 2.4;
      this.spread[i * 3] = onWall ? (rnd() < 0.5 ? -1.25 : 1.25) : Math.cos(ang) * Math.min(r, 1.2);
      this.spread[i * 3 + 1] = onWall ? 0.2 + rnd() * 1.6 : 0.04 + rnd() * 0.05;
      this.spread[i * 3 + 2] = Math.sin(ang) * r;
      // Фигура: столб в рост выше человека, плотнее к верху, с утолщением «головы».
      const h = Math.pow(rnd(), 0.8) * 2.25;
      const head = h > 1.85 ? 0.1 : 0;
      this.figure[i * 3] = h;
      this.figure[i * 3 + 1] = rnd() * Math.PI * 2;
      this.figure[i * 3 + 2] = 0.1 + rnd() * (0.16 + head) + (h < 0.5 ? 0.12 : 0);
      this.params[i * 2] = rnd();
      this.params[i * 2 + 1] = 0.35 + rnd() * 0.45;
      this.dirs[i * 3 + 1] = 1;
    }
  }

  /** Мгновенно поставить всех червей на места (появление, телепорт). */
  snap(center: Vec3, cohesion: number): void {
    this.placed = false;
    this.update(0, center, cohesion, null);
  }

  /** Высота фигуры при таком росте, м: от кучи по пояс до столба выше человека. */
  static height(growth: number): number {
    return 2.25 * (0.45 + 0.55 * Math.max(0, Math.min(1, growth)));
  }

  /**
   * Шаг. center — центр роя на полу; cohesion — сцепление; lunge — точка, к которой рой бросается
   * целиком (объектив камеры в момент поимки) или null; growth — насколько фигура выросла (0..1).
   */
  update(dt: number, center: Vec3, cohesion: number, lunge: Vec3 | null, growth = 1): void {
    this.time += dt;
    const t = this.time;
    const c = Math.max(0, Math.min(1, cohesion));
    const g = Math.max(0, Math.min(1, growth));
    // Невыросшая фигура ниже и шире; «голова» — утолщение наверху — только у выросшей.
    const tall = 0.45 + 0.55 * g;
    const wide = 1 + (1 - g) * 0.7;
    for (let i = 0; i < MAX_WORMS; i++) {
      const seed = this.params[i * 2]!;
      const j = i * 3;
      // Цель в рассеянном рое: ползёт по своему пятну.
      const wob = t * (0.5 + seed) + seed * 20;
      const sx = this.spread[j]! + Math.sin(wob) * 0.25;
      const sy = this.spread[j + 1]!;
      const sz = this.spread[j + 2]! + Math.cos(wob * 0.8) * 0.25;
      // Цель в фигуре: черви вьются вокруг столба и медленно текут по высоте.
      const h = (this.figure[j]! + t * 0.12 * (seed - 0.5) + 2.25) % 2.25;
      const ang = this.figure[j + 1]! + t * (0.7 + seed * 1.3) * (i % 2 === 0 ? 1 : -1);
      const head = h > 1.85 ? 0.1 * (1 - g) : 0;
      const rad = (this.figure[j + 2]! - head) * wide * (1 + 0.25 * Math.sin(t * 2.1 + seed * 9));
      const fx = Math.cos(ang) * rad;
      const fy = h * tall + 0.05;
      const fz = Math.sin(ang) * rad;
      let tx = center[0] + sx + (fx - sx) * c;
      let ty = center[1] + sy + (fy - sy) * c;
      let tz = center[2] + sz + (fz - sz) * c;
      if (lunge) {
        tx = lunge[0] + (seed - 0.5) * 0.3;
        ty = lunge[1] + (this.params[i * 2 + 1]! - 0.55) * 0.3;
        tz = lunge[2] + ((i % 7) / 7 - 0.5) * 0.3;
      }
      if (!this.placed || dt <= 0) {
        this.heads[j] = tx;
        this.heads[j + 1] = ty;
        this.heads[j + 2] = tz;
        this.vel[j] = this.vel[j + 1] = this.vel[j + 2] = 0;
        continue;
      }
      // Пружина к цели с затуханием: черви не телепортируются, а доползают.
      const k = lunge ? 60 : 22;
      const damp = Math.exp(-dt * (lunge ? 5 : 7));
      for (let a = 0; a < 3; a++) {
        const target = a === 0 ? tx : a === 1 ? ty : tz;
        this.vel[j + a] = (this.vel[j + a]! + (target - this.heads[j + a]!) * k * dt) * damp;
        this.heads[j + a] = this.heads[j + a]! + this.vel[j + a]! * dt;
      }
      const sp = Math.hypot(this.vel[j]!, this.vel[j + 1]!, this.vel[j + 2]!);
      if (sp > 0.05) {
        // Направление сглаживается: червь не дёргается, когда почти стоит.
        const m = Math.min(1, dt * 8);
        for (let a = 0; a < 3; a++) this.dirs[j + a] = this.dirs[j + a]! + (this.vel[j + a]! / sp - this.dirs[j + a]!) * m;
        const dl = Math.hypot(this.dirs[j]!, this.dirs[j + 1]!, this.dirs[j + 2]!) || 1;
        for (let a = 0; a < 3; a++) this.dirs[j + a] = this.dirs[j + a]! / dl;
      }
    }
    this.placed = true;
  }
}
