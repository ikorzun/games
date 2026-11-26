/**
 * Грибы. Слова партнёра (15.11): «Монстр это тревога внутри и сожаление игрока. Когда он появляется,
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
import { FORMS, speciesIndex } from '../world/mushrooms';

/**
 * Какие грибы где растут (виды — по ядовитым грибам, world/mushrooms.ts). В углах — знак приближения, и у каждого места свой:
 * в сыром убежище — пучки на гнилой древесине, бледные поганки, нитяные коноцибе и светящийся омфалот; в стерильном офисе —
 * белые поганки и белые воронки; в жёлтых комнатах — серно-жёлтые пучки. На полу вокруг Осыпи — одно на все места: она не
 * житель места, а тревога, и прорастает странным — красными «пальцами», «мозгом» строчка, мухоморами, сатанинским грибом.
 */
export const CORNER_FLORA: Readonly<Record<string, readonly string[]>> = {
  shelter: ['sulphur_tuft', 'death_cap', 'deadly_conocybe', 'jack_o_lantern'],
  office: ['destroying_angel', 'fools_funnel', 'deadly_conocybe'],
  yellow: ['sulphur_tuft', 'fools_funnel', 'destroying_angel'],
  station: ['death_cap', 'jack_o_lantern', 'fly_agaric', 'sulphur_tuft'],
};
export const FIELD_FLORA: readonly string[] = ['fire_coral', 'false_morel', 'fly_agaric', 'satan_bolete', 'death_cap', 'deadly_conocybe'];
/** Чисел на место в списке для рендера: x, y, z, поворот, размер, род (0 — угол, 1 — пол), форма грозди. */
export const SPORE_STRIDE = 7;

/**
 * Чем место служит знаку (куратор, пачка 51, противоречие 321): голова — гроздь в самом углу, знак «она идёт оттуда», видна
 * издалека и одна держит след; спутники пятна (step — пара 1 или 2) и подножия стен прорастают, только когда она ближе, —
 * пятно растёт к ней, а не стоит полосой вдоль всех стен; поле — пол вокруг неё самой.
 */
export type SporeRole = 'head' | 'patch' | 'foot' | 'field';

export interface SporeSite {
  pos: Vec3;
  /** Угол (знак) или пол вокруг (поле). */
  kind: 'corner' | 'floor';
  role: SporeRole;
  /** Пара спутников пятна (1, 2); у остальных 0. */
  step: number;
  /** Насколько выросло, 0..1. */
  grow: number;
  /** След: ниже этого угол уже не оседает (она здесь была). */
  trace: number;
  /** Поворот и размер грозди — свои у каждого места. */
  yaw: number;
  size: number;
  /** Узел графа, которому принадлежит место. */
  node: number;
  /** Форма грозди: вид × FORMS + вариант (world/mushrooms.ts). */
  form: number;
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
  /** Сколько гроздей в пятне у угла (первая — в самом углу, остальные — вдоль двух стен) и у подножия одной стены. */
  perCorner: number;
  perWall: number;
}

/**
 * Грибов вчетверо с лишним гуще (партнёр 19.11: «нужно увеличить плотность грибов минимум в 4 раза»): у угла — пятно из пяти
 * гроздей вместо одной; у подножия — каждая стена и по две грозди (было: половина стен по одной, вчетверо меньше); на полу
 * вокруг Осыпи — двадцать пять мест на клетку (было пять). Всего мест — в 4,8–4,9 раза больше (design.md, §33).
 * Спутники пятна и подножия прорастают ближе к ней, чем голова угла: lag — доля роста головы, с которой они начинают.
 */
export const PATCH_LAG = { pair: 0.2, foot: 0.5 } as const;
export const DEFAULT_SPORES: SporesConfig = { cell: 3, inset: 0.24, cornerRange: 11, regretReach: 1.6, fieldRange: 3.4, fieldTime: 1.4, cornerTime: 3.5, fadeTime: 22, trace: 0.3, perCell: 25, wallShare: 1, perCorner: 5, perWall: 2 };

/** Что известно об Осыпи в этом шаге. */
export interface SporeSource {
  pos: Vec3;
  /** Она в мире (не спит). */
  active: boolean;
  /** Насколько она собрана в фигуру, 0..1, и охотится ли. */
  cohesion: number;
  hunting: boolean;
  /** Примета без тела (ступени 1–2): след в углу остаётся, только где она прошла вплотную, — не по всему месту. */
  faint?: boolean;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * Места для грибов по графу уровня. Угол есть там, где у клетки нет соседа ни по одной, ни по другой
 * оси (значит, там сходятся две стены). Места на полу — несколько в каждой клетке, вразброс.
 */
export function sporeSites(nav: readonly NavNode[], seed: number, cfg: SporesConfig = DEFAULT_SPORES, place = 'shelter'): SporeSite[] {
  const corners = CORNER_FLORA[place] ?? CORNER_FLORA.shelter!;
  // Вид — один на углы клетки и два на её пол (пятна, а не салат); вариант грозди — у каждого места свой.
  const pick = (list: readonly string[], h: number): number => speciesIndex(list[Math.min(list.length - 1, Math.floor(h * list.length))]!);
  const form = (species: number, h: number): number => species * FORMS + Math.min(FORMS - 1, Math.floor(h * FORMS));
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
    const cornerSp = pick(corners, hash01(n.id, 0x5c, seed ^ 0x5b0e5));
    const fieldSp = [pick(FIELD_FLORA, hash01(n.id, 0x5d, seed ^ 0x5b0e5)), pick(FIELD_FLORA, hash01(n.id, 0x5e, seed ^ 0x5b0e5))] as const;
    let k = 0;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        k += 1;
        if (open(sx, 0) || open(0, sz)) continue;
        const h = hash01(n.id * 7 + k, 0x51, seed ^ 0x5b0e5);
        const cx = n.x + sx * (half - cfg.inset);
        const cz = n.z + sz * (half - cfg.inset);
        const headForm = form(cornerSp, hash01(n.id * 37 + k, 0x53, seed));
        out.push({ pos: [cx, n.y, cz], kind: 'corner', role: 'head', step: 0, grow: 0, trace: 0, yaw: h * Math.PI * 2, size: 0.75 + 0.5 * hash01(n.id * 11 + k, 0x52, seed), node: n.id, form: headForm });
        // Пятно: ещё несколько гроздей поменьше — вдоль двух стен угла, прижавшись к ним: по очереди то к одной, то к другой
        // (с какой начать — жребий угла, чтобы углы не повторяли друг друга), каждая следующая пара — дальше от угла и мельче.
        const flip = hash01(n.id * 71 + k, 0x57, seed ^ 0x5b0e5) < 0.5;
        for (let j = 1; j < cfg.perCorner; j++) {
          const q = hash01(n.id * 53 + k * 7 + j, 0x54, seed ^ 0x5b0e5);
          const step = Math.floor((j - 1) / 2);
          const d = 0.42 + 0.44 * step + 0.14 * q;
          const alongX = (j % 2 === 1) !== flip;
          out.push({
            pos: [alongX ? cx - sx * d : cx, n.y, alongX ? cz : cz - sz * d],
            kind: 'corner',
            role: 'patch',
            step: step + 1,
            grow: 0,
            trace: 0,
            yaw: hash01(n.id * 59 + k * 7 + j, 0x55, seed) * Math.PI * 2,
            size: (0.45 + 0.4 * q) * (1 - 0.15 * step),
            node: n.id,
            // Первый в паре — другой вариант грозди, чем у головы: пятно не из пяти одинаковых (куратор, пачка 51, 326).
            form: j % 2 === 1 ? headForm - (headForm % FORMS) + ((headForm % FORMS) + 1) % FORMS : form(cornerSp, hash01(n.id * 61 + k * 7 + j, 0x56, seed)),
          });
        }
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
      const off = half - cfg.inset * 0.75;
      // Вдоль стены — по своей доле её длины каждая гроздь: не слипаются.
      for (let j = 0; j < cfg.perWall; j++) {
        const along = ((j + hash01(n.id * 29 + w * 5 + j, 0x72, seed ^ 0x5b0e5)) / cfg.perWall - 0.5) * (cfg.cell - 0.9);
        out.push({ pos: [n.x + dx * off + (dx === 0 ? along : 0), n.y, n.z + dz * off + (dz === 0 ? along : 0)], kind: 'corner', role: 'foot', step: 0, grow: 0, trace: 0, yaw: hash01(n.id * 67 + w * 5 + j, 0x75, seed) * 40, size: 0.55 + 0.45 * hash01(n.id * 31 + w * 5 + j, 0x73, seed), node: n.id, form: form(cornerSp, hash01(n.id * 41 + w * 5 + j, 0x74, seed)) });
      }
    }
    // Пол: места по сетке с разбросом (в каждой ячейке сетки — одно, где угодно в её пределах) — ковром, а не кучками и проплешинами.
    const g = Math.ceil(Math.sqrt(cfg.perCell));
    for (let i = 0; i < cfg.perCell; i++) {
      const a = hash01(n.id * 13 + i, 0x61, seed ^ 0x5b0e5);
      const b = hash01(n.id * 17 + i, 0x62, seed ^ 0x5b0e5);
      const c = hash01(n.id * 19 + i, 0x63, seed ^ 0x5b0e5);
      const sp = fieldSp[hash01(n.id * 43 + i, 0x64, seed) < 0.5 ? 0 : 1]!;
      const u = ((i % g) + a) / g;
      const v = (Math.floor(i / g) + b) / Math.ceil(cfg.perCell / g);
      out.push({ pos: [n.x + (u - 0.5) * (cfg.cell - 0.7), n.y, n.z + (v - 0.5) * (cfg.cell - 0.7)], kind: 'floor', role: 'field', step: 0, grow: 0, trace: 0, yaw: c * Math.PI * 2, size: 0.55 + 0.6 * c, node: n.id, form: form(sp, hash01(n.id * 47 + i, 0x65, seed)) });
    }
  }
  return out;
}

export class Spores {
  readonly sites: SporeSite[];
  private readonly near: number[] = [];
  private dist: Float32Array;

  constructor(
    nav: readonly NavNode[],
    seed: number,
    readonly cfg: SporesConfig = DEFAULT_SPORES,
    place = 'shelter',
  ) {
    this.sites = sporeSites(nav, seed, cfg, place);
    this.dist = new Float32Array(this.sites.length);
    this.nav = nav;
  }

  private readonly nav: readonly NavNode[];

  /**
   * Места внутри твёрдых вещей (куратор, пачка 51, противоречие 322: места грибов считаются по графу клеток и мебели не знают —
   * в зале ожидания голова угла сидела внутри вещи в 29 % углов). blocked(x, z, y) — стоит ли там вещь на полу. Голова угла
   * отступает к середине клетки, пока не выйдет из вещи (не дальше метра): знак остаётся у её подножия; прочие места внутри
   * вещей отбрасываются. Один раз на уровень. Возвращает, сколько мест отброшено.
   */
  settle(blocked: (x: number, z: number, y: number) => boolean): number {
    const keep: SporeSite[] = [];
    for (const s of this.sites) {
      if (!blocked(s.pos[0], s.pos[2], s.pos[1])) {
        keep.push(s);
        continue;
      }
      if (s.role !== 'head') continue;
      const n = this.nav[s.node]!;
      const dx = n.x - s.pos[0];
      const dz = n.z - s.pos[2];
      const l = Math.hypot(dx, dz) || 1;
      for (let k = 1; k <= 7; k++) {
        const x = s.pos[0] + (dx / l) * 0.15 * k;
        const z = s.pos[2] + (dz / l) * 0.15 * k;
        if (blocked(x, z, s.pos[1])) continue;
        s.pos = [x, s.pos[1], z];
        keep.push(s);
        break;
      }
    }
    const dropped = this.sites.length - keep.length;
    this.sites.length = 0;
    this.sites.push(...keep);
    this.dist = new Float32Array(this.sites.length);
    return dropped;
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
        // Ярусы разнесены на 4,5 м: с другого яруса она не «чуется». Мест тысячи: дальше своего круга расстояние не считается.
        const reach = s.kind === 'corner' ? cornerRange : fieldRange;
        const dx = s.pos[0] - src.pos[0];
        const dz = s.pos[2] - src.pos[2];
        const far = Math.abs(s.pos[1] - src.pos[1]) > 2 || Math.abs(dx) > reach || Math.abs(dz) > reach;
        if (far && s.grow === 0 && s.trace === 0) continue;
        const d = far ? Infinity : Math.hypot(dx, dz);
        if (s.kind === 'corner') {
          // Знак приближения: от нуля на краю слышимости до полного роста вплотную. Голова угла — первой; спутники пятна и
          // подножия — позже, когда она ближе: издалека знак — угол, вблизи прорастает всё.
          if (d < cornerRange) {
            const t = clamp01(1 - d / cornerRange) ** 0.7;
            const lag = s.role === 'head' ? 0 : s.role === 'patch' ? PATCH_LAG.pair * s.step : PATCH_LAG.foot;
            target = lag > 0 ? clamp01((t - lag) / (1 - lag)) : t;
          }
          // След держит только голова угла: «она здесь была» — угол, а не полоса вдоль всех стен.
          if (s.role === 'head') {
            if (d < 2.5) s.trace = Math.max(s.trace, c.trace);
            else if (d < cornerRange * 0.5 && !src.faint) s.trace = Math.max(s.trace, c.trace * 0.5);
          }
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
   * Что рисовать: до max ближайших к точке from проросших мест (сначала головы углов, потом остальные — каждые от ближнего),
   * по SPORE_STRIDE чисел на место — x, y, z, поворот, размер (уже с ростом), род (0 — угол, 1 — пол), форма грозди. Возвращает
   * число мест, записанных в out.
   */
  visible(from: Vec3, max: number, out: Float32Array): number {
    // Мест теперь тысячи: без новых объектов на каждый кадр — номера и расстояния в своих массивах.
    const near = this.near;
    const dist = this.dist;
    near.length = 0;
    for (let i = 0; i < this.sites.length; i++) {
      const s = this.sites[i]!;
      if (s.grow <= 0.03 || Math.abs(s.pos[1] - from[1]) > 3) continue;
      const d = Math.hypot(s.pos[0] - from[0], s.pos[2] - from[2]);
      if (d < 26) {
        // Головы углов — вперёд всех (их немного): под пределом качества густое поле у ног не должно вытеснить дальний знак
        // «она идёт оттуда» (куратор, пачка 51).
        dist[i] = s.role === 'head' ? d - 1000 : d;
        near.push(i);
      }
    }
    near.sort((a, b) => dist[a]! - dist[b]!);
    const S = SPORE_STRIDE;
    const n = Math.min(max, near.length, Math.floor(out.length / S));
    for (let i = 0; i < n; i++) {
      const s = this.sites[near[i]!]!;
      out[i * S] = s.pos[0];
      out[i * S + 1] = s.pos[1];
      out[i * S + 2] = s.pos[2];
      out[i * S + 3] = s.yaw;
      // Гриб выходит из пола не «увеличиваясь», а вырастая: сначала быстро, под конец медленно.
      out[i * S + 4] = s.size * (1 - (1 - s.grow) ** 2);
      out[i * S + 5] = s.kind === 'corner' ? 0 : 1;
      out[i * S + 6] = s.form;
    }
    return n;
  }
}
