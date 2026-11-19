/**
 * Цветы оранжереи: куда смотрит каждая головка и насколько она раскрыта (партнёр 19.11, 18:04: оранжерея; квиз:
 * «Поворачиваются за лучом»). Стебли и листья стоят в сетке помещения (world/flowers.ts, plant), а головки — здесь.
 *
 * Правило одно: цветок раскрывается и поворачивается к свету, а свет здесь — это герой. В тёмном месте свет — луч фонаря:
 * головки, на которые он упал, раскрываются и медленно поворачиваются к тому, кто светит (к фонарю, а не к пятну на стене —
 * как подсолнух к солнцу). В светлом месте фонаря нет — светит взгляд: цветы, на которые смотрят, поворачиваются к смотрящему.
 * Ушёл свет — головка не сразу, а через свою паузу (у каждой своя) закрывается и медленно возвращается в покой. Поворот
 * ограничен: стебель не гнётся дальше, чем гнулся бы настоящий.
 *
 * Чистый TS: состояние меняет update, рендер получает готовый список (render: setFlowers).
 */
import { hash01 } from '../core/rng';
import type { Vec3 } from '../core/types';
import type { Bloom } from '../world/flowers';

/** Чисел на головку в списке для рендера: x, y, z, кватернион (x, y, z, w), масштаб поперёк и вдоль оси, форма. */
export const FLOWER_STRIDE = 10;

export interface FlowerSite extends Bloom {
  /** Куда головка смотрит сейчас (единичный). */
  face: Vec3;
  /** Раскрыта: 0 — бутон, 1 — цветок. */
  open: number;
  /** Сколько секунд она уже в темноте и через сколько закроется. */
  dark: number;
  delay: number;
  /** Объект уровня, на котором растёт (грядка, горшок): растворился — головки нет. 0 — ни на чём. */
  obj: number;
}

export interface FlowerLight {
  /** Глаз героя: к нему поворачиваются. */
  eye: Vec3;
  /** Луч фонаря, если светит: откуда, куда (единичный), косинус половины раствора, дальность. */
  beam: { origin: Vec3; dir: Vec3; cos: number; range: number } | null;
  /** Взгляд — в светлых местах (фонаря нет): куда смотрит герой, раствор и дальность. */
  gaze: { dir: Vec3; cos: number; range: number } | null;
}

export const FLOWER_CFG = {
  /** Дальше этого от героя головки не считаются (замирают как есть), м. */
  reach: 14,
  /** Насколько головка может отклониться от покоя, рад (≈ 55°). */
  maxTurn: 0.96,
  /** Скорость поворота к свету и обратно, рад/с. */
  turnRate: 1.1,
  backRate: 0.3,
  /** Раскрыться и закрыться, с. */
  openTime: 0.8,
  closeTime: 3.0,
  /** Пауза перед тем, как закрыться в темноте, с: от и до (у каждой головки своя). */
  closeDelay: [0.5, 2.6] as const,
  /** Бутон: насколько сжата головка поперёк своей оси. */
  bud: 0.34,
};

type V = Vec3;
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function norm(v: V): V {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 1, 0];
}
/** Повернуть единичный a к единичному b не больше чем на angle (по дуге большого круга). */
export function turnToward(a: V, b: V, angle: number): V {
  const c = Math.max(-1, Math.min(1, dot(a, b)));
  const th = Math.acos(c);
  if (th <= angle || th < 1e-6) return b;
  // Ортогональная к a часть b — направление поворота.
  let w: V = [b[0] - a[0] * c, b[1] - a[1] * c, b[2] - a[2] * c];
  w = norm(w);
  const k = Math.cos(angle);
  const s = Math.sin(angle);
  return norm([a[0] * k + w[0] * s, a[1] * k + w[1] * s, a[2] * k + w[2] * s]);
}
/** Угол между единичными, рад. */
const angleOf = (a: V, b: V): number => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

export class Flowers {
  readonly sites: FlowerSite[];
  /** Порядок от ближнего (visible): заранее, без выделения памяти в кадре. */
  private readonly near: number[];
  private readonly dist: Float32Array;

  constructor(blooms: readonly (Bloom & { obj?: number })[], seed: number) {
    const [lo, hi] = FLOWER_CFG.closeDelay;
    this.sites = blooms.map((b, i) => ({ ...b, face: norm(b.dir), open: 0, dark: 0, delay: lo + (hi - lo) * hash01(i, 0x71c, seed), obj: b.obj ?? 0 }));
    this.near = this.sites.map((_, i) => i);
    this.dist = new Float32Array(this.sites.length);
  }

  /** Светит ли на головку свет героя. */
  static lit(p: V, light: FlowerLight): boolean {
    const b = light.beam;
    if (b) {
      const v: V = [p[0] - b.origin[0], p[1] - b.origin[1], p[2] - b.origin[2]];
      const d = Math.hypot(v[0], v[1], v[2]);
      if (d < b.range && d > 1e-6 && dot(v, b.dir) / d > b.cos) return true;
    }
    const g = light.gaze;
    if (g) {
      const v: V = [p[0] - light.eye[0], p[1] - light.eye[1], p[2] - light.eye[2]];
      const d = Math.hypot(v[0], v[1], v[2]);
      if (d < g.range && d > 1e-6 && dot(v, g.dir) / d > g.cos) return true;
    }
    return false;
  }

  /** Последний свет, с которым считался шаг (для проверок и отладки). */
  light: FlowerLight | null = null;
  /** Сколько головок было на свету в последнем шаге. */
  litCount = 0;

  /** Шаг: раскрыть и повернуть то, на что светят; закрыть и вернуть в покой остальное. light = null — света нет нигде. */
  update(dt: number, light: FlowerLight | null): void {
    this.light = light;
    if (dt <= 0) return;
    this.litCount = 0;
    const C = FLOWER_CFG;
    const eye = light?.eye;
    for (const s of this.sites) {
      if (eye && Math.hypot(s.pos[0] - eye[0], s.pos[1] - eye[1], s.pos[2] - eye[2]) > C.reach) continue;
      const on = light ? Flowers.lit(s.pos, light) : false;
      if (on) {
        this.litCount++;
        s.dark = 0;
        s.open = Math.min(1, s.open + dt / C.openTime);
        // К глазу, но не дальше, чем гнётся стебель.
        const want = turnToward(s.dir, norm([eye![0] - s.pos[0], eye![1] - s.pos[1], eye![2] - s.pos[2]]), C.maxTurn);
        s.face = turnToward(s.face, want, C.turnRate * dt);
      } else {
        s.dark += dt;
        if (s.dark > s.delay) s.open = Math.max(0, s.open - dt / C.closeTime);
        s.face = turnToward(s.face, s.dir, C.backRate * dt);
      }
      // Не дальше предела — даже если покой и свет по разные стороны.
      if (angleOf(s.dir, s.face) > C.maxTurn + 1e-4) s.face = turnToward(s.dir, s.face, C.maxTurn);
    }
  }

  /**
   * Ближайшие к глазу головки (не больше max) — в out по FLOWER_STRIDE чисел; gone(obj) — насколько растворился объект, на
   * котором растёт цветок (0..1): больше половины — головки нет. Возвращает, сколько записано.
   */
  visible(eye: V, max: number, out: Float32Array, gone?: (obj: number) => number): number {
    const n = this.sites.length;
    for (let i = 0; i < n; i++) {
      const p = this.sites[i]!.pos;
      this.dist[i] = Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
    }
    const order = this.near;
    order.sort((a, b) => this.dist[a]! - this.dist[b]!);
    const S = FLOWER_STRIDE;
    const room = Math.min(max, Math.floor(out.length / S));
    let k = 0;
    for (let j = 0; j < n && k < room; j++) {
      const s = this.sites[order[j]!]!;
      const g = s.obj && gone ? gone(s.obj) : 0;
      if (g > 0.5) continue;
      const q = quatOf(s.face, s.spin);
      const across = s.size * (FLOWER_CFG.bud + (1 - FLOWER_CFG.bud) * s.open) * (1 - g);
      const along = s.size * (1.08 - 0.08 * s.open) * (1 - g);
      const o = k * S;
      out[o] = s.pos[0];
      out[o + 1] = s.pos[1];
      out[o + 2] = s.pos[2];
      out[o + 3] = q[0];
      out[o + 4] = q[1];
      out[o + 5] = q[2];
      out[o + 6] = q[3];
      out[o + 7] = across;
      out[o + 8] = along;
      out[o + 9] = s.form;
      k++;
    }
    return k;
  }
}

/** Кватернион: ось +y головки — по face, и поворот spin вокруг своей оси (сначала spin вокруг +y, потом наклон). */
export function quatOf(face: V, spin: number): [number, number, number, number] {
  // Кратчайшая дуга от +y к face.
  const f = norm(face);
  const c = f[1];
  let ax: V = [f[2], 0, -f[0]];
  const l = Math.hypot(ax[0], ax[2]);
  let qa: [number, number, number, number];
  if (l < 1e-8) qa = c > 0 ? [0, 0, 0, 1] : [1, 0, 0, 0];
  else {
    ax = [ax[0] / l, 0, ax[2] / l];
    const th = Math.acos(Math.max(-1, Math.min(1, c)));
    const s = Math.sin(th / 2);
    qa = [ax[0] * s, 0, ax[2] * s, Math.cos(th / 2)];
  }
  // Поворот вокруг +y на spin — справа: сначала он, потом наклон.
  const qs: [number, number, number, number] = [0, Math.sin(spin / 2), 0, Math.cos(spin / 2)];
  return [
    qa[3] * qs[0] + qa[0] * qs[3] + qa[1] * qs[2] - qa[2] * qs[1],
    qa[3] * qs[1] - qa[0] * qs[2] + qa[1] * qs[3] + qa[2] * qs[0],
    qa[3] * qs[2] + qa[0] * qs[1] - qa[1] * qs[0] + qa[2] * qs[3],
    qa[3] * qs[3] - qa[0] * qs[0] - qa[1] * qs[1] - qa[2] * qs[2],
  ];
}
