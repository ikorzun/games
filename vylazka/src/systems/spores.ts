/**
 * Грибы. Слова владельца (15.11): «Монстр это тревога внутри и сожаление игрока. Когда он появляется,
 * все начинает прорастать грибами вокруг. Помимо этого, грибы могут появляться в углах как знак
 * пребывания монстра в мире или приближение».
 *
 * Мест, где может вырасти гриб, два рода:
 *  - углы: там, где сходятся две стены помещения. Здесь грибы — знак. Они проступают, когда Осыпь
 *    где-то рядом (за стеной, за поворотом — по прямой, а не по пути): чем она ближе, тем они выше.
 *    Ушла — они оседают, но не до конца: в углу, где она побывала, остаётся след;
 *  - пол вокруг неё самой: когда она собрана в фигуру или охотится, всё вокруг прорастает — быстро
 *    и густо. Ушла — эти грибы осыпаются.
 *
 * Тревога и сожаление — то, из чего она сделана: чем больше игрок стёр (regret, 0..1), тем дальше от
 * неё проступают знаки в углах и тем шире круг вокруг неё.
 *
 * Чистый TS: места считаются по навигационному графу уровня один раз, рост — каждый шаг; рендер
 * получает готовый список (render: setSpores).
 */
import { hash01 } from '../core/rng';
import type { Vec3 } from '../core/types';
import type { NavNode } from '../world/level';

export interface SporeSite {
  pos: Vec3;
  /** Угол (знак) или пол вокруг (поле). */
  kind: 'corner' | 'floor';
  /** Насколько выросло, 0..1. */
  grow: number;
  /** След: ниже этого угол уже не оседает (она здесь была). */
  trace: number;
  /** Поворот и размер грозди — свои у каждого места. */
  yaw: number;
  size: number;
  /** Узел графа, которому принадлежит место. */
  node: number;
}

export interface SporesConfig {
  /** Шаг клетки и отступ угла от стен, м. */
  cell: number;
  inset: number;
  /** С какого расстояния углы «чуют» Осыпь (по прямой), м; при полном сожалении — дальше во столько раз. */
  cornerRange: number;
  regretReach: number;
  /** Радиус поля вокруг собранной Осыпи, м. */
  fieldRange: number;
  /** За сколько секунд гриб вырастает в поле и в углу; за сколько оседает. */
  fieldTime: number;
  cornerTime: number;
  fadeTime: number;
  /** Какой след остаётся в углу, где она побывала вплотную. */
  trace: number;
  /** Сколько мест на полу в клетке. */
  perCell: number;
  /** У какой доли стен грибы растут и у подножия (а не только в углах). */
  wallShare: number;
}

export const DEFAULT_SPORES: SporesConfig = { cell: 3, inset: 0.24, cornerRange: 11, regretReach: 1.6, fieldRange: 3.4, fieldTime: 1.4, cornerTime: 3.5, fadeTime: 22, trace: 0.3, perCell: 5, wallShare: 0.5 };

/** Что известно об Осыпи в этом шаге. */
export interface SporeSource {
  pos: Vec3;
  /** Она в мире (не спит). */
  active: boolean;
  /** Насколько она собрана в фигуру, 0..1, и охотится ли. */
  cohesion: number;
  hunting: boolean;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * Места для грибов по графу уровня. Угол есть там, где у клетки нет соседа ни по одной, ни по другой
 * оси (значит, там сходятся две стены). Места на полу — несколько в каждой клетке, вразброс.
 */
export function sporeSites(nav: readonly NavNode[], seed: number, cfg: SporesConfig = DEFAULT_SPORES): SporeSite[] {
  const at = new Map<string, NavNode>();
  for (const n of nav) at.set(`${n.tier},${n.cx},${n.cz}`, n);
  const out: SporeSite[] = [];
  const half = cfg.cell / 2;
  for (const n of nav) {
    const open = (dx: number, dz: number): boolean => {
      const m = at.get(`${n.tier},${n.cx + dx},${n.cz + dz}`);
      return m !== undefined && n.links.includes(m.id) && Math.abs(m.y - n.y) < 0.3;
    };
    // На лестнице (узел не на уровне яруса) грибов нет.
    if (n.links.some((l) => Math.abs(nav[l]!.y - n.y) > 0.3)) continue;
    let k = 0;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        k += 1;
        if (open(sx, 0) || open(0, sz)) continue;
        const h = hash01(n.id * 7 + k, 0x51, seed ^ 0x5b0e5);
        out.push({ pos: [n.x + sx * (half - cfg.inset), n.y, n.z + sz * (half - cfg.inset)], kind: 'corner', grow: 0, trace: 0, yaw: h * Math.PI * 2, size: 0.75 + 0.5 * hash01(n.id * 11 + k, 0x52, seed), node: n.id });
      }
    }
    // Подножие стены — тоже угол (стена и пол): не у каждой стены, вразброс вдоль неё. Так знак виден
    // и в прямом коридоре, где настоящих углов нет.
    let w = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      w += 1;
      if (open(dx, dz)) continue;
      const h = hash01(n.id * 23 + w, 0x71, seed ^ 0x5b0e5);
      if (h > cfg.wallShare) continue;
      const along = (hash01(n.id * 29 + w, 0x72, seed ^ 0x5b0e5) - 0.5) * (cfg.cell - 0.9);
      const off = half - cfg.inset * 0.75;
      out.push({ pos: [n.x + dx * off + (dx === 0 ? along : 0), n.y, n.z + dz * off + (dz === 0 ? along : 0)], kind: 'corner', grow: 0, trace: 0, yaw: h * 40, size: 0.55 + 0.45 * hash01(n.id * 31 + w, 0x73, seed), node: n.id });
    }
    for (let i = 0; i < cfg.perCell; i++) {
      const a = hash01(n.id * 13 + i, 0x61, seed ^ 0x5b0e5);
      const b = hash01(n.id * 17 + i, 0x62, seed ^ 0x5b0e5);
      const c = hash01(n.id * 19 + i, 0x63, seed ^ 0x5b0e5);
      out.push({ pos: [n.x + (a - 0.5) * (cfg.cell - 0.7), n.y, n.z + (b - 0.5) * (cfg.cell - 0.7)], kind: 'floor', grow: 0, trace: 0, yaw: c * Math.PI * 2, size: 0.55 + 0.6 * c, node: n.id });
    }
  }
  return out;
}

export class Spores {
  readonly sites: SporeSite[];

  constructor(
    nav: readonly NavNode[],
    seed: number,
    readonly cfg: SporesConfig = DEFAULT_SPORES,
  ) {
    this.sites = sporeSites(nav, seed, cfg);
  }

  /**
   * Шаг. src — Осыпь (null — её нет в мире); regret — сожаление игрока 0..1: сколько он стёр.
   * Возвращает, сколько мест сейчас проросло заметно.
   */
  update(dt: number, src: SporeSource | null, regret: number): number {
    const c = this.cfg;
    const r = clamp01(regret);
    const cornerRange = c.cornerRange * (1 + (c.regretReach - 1) * r);
    const fieldRange = c.fieldRange * (1 + 0.5 * r);
    const present = src !== null && src.active;
    const formed = present && (src.hunting || src.cohesion > 0.35);
    let live = 0;
    for (const s of this.sites) {
      let target = 0;
      if (present) {
        // Ярусы разнесены на 4,5 м: с другого яруса она не «чуется».
        const dy = Math.abs(s.pos[1] - src.pos[1]);
        const d = dy > 2 ? Infinity : Math.hypot(s.pos[0] - src.pos[0], s.pos[2] - src.pos[2]);
        if (s.kind === 'corner') {
          // Знак приближения: от нуля на краю слышимости до полного роста вплотную.
          if (d < cornerRange) target = clamp01(1 - d / cornerRange) ** 0.7;
          if (d < 2.5) s.trace = Math.max(s.trace, c.trace);
          else if (d < cornerRange * 0.5) s.trace = Math.max(s.trace, c.trace * 0.5);
        } else if (formed && d < fieldRange) target = clamp01(1.15 - d / fieldRange);
      }
      target = Math.max(target, s.trace);
      if (target > s.grow) s.grow = Math.min(target, s.grow + dt / (s.kind === 'corner' ? c.cornerTime : c.fieldTime));
      else if (target < s.grow) s.grow = Math.max(target, s.grow - dt / (s.kind === 'corner' ? c.fadeTime : c.fadeTime * 0.25));
      if (s.grow > 0.03) live += 1;
    }
    return live;
  }

  /**
   * Что рисовать: до max ближайших к точке from проросших мест, по шесть чисел на место — x, y, z,
   * поворот, размер (уже с ростом), род (0 — угол, 1 — пол). Возвращает число мест, записанных в out.
   */
  visible(from: Vec3, max: number, out: Float32Array): number {
    const near: { s: SporeSite; d: number }[] = [];
    for (const s of this.sites) {
      if (s.grow <= 0.03 || Math.abs(s.pos[1] - from[1]) > 3) continue;
      const d = Math.hypot(s.pos[0] - from[0], s.pos[2] - from[2]);
      if (d < 26) near.push({ s, d });
    }
    near.sort((a, b) => a.d - b.d);
    const n = Math.min(max, near.length, Math.floor(out.length / 6));
    for (let i = 0; i < n; i++) {
      const s = near[i]!.s;
      out[i * 6] = s.pos[0];
      out[i * 6 + 1] = s.pos[1];
      out[i * 6 + 2] = s.pos[2];
      out[i * 6 + 3] = s.yaw;
      // Гриб выходит из пола не «увеличиваясь», а вырастая: сначала быстро, под конец медленно.
      out[i * 6 + 4] = s.size * (1 - (1 - s.grow) ** 2);
      out[i * 6 + 5] = s.kind === 'corner' ? 0 : 1;
    }
    return n;
  }
}
