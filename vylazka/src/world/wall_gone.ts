/**
 * Стёртое проходимо (ответ партнёра в квизе 17.11, вечер: «Пусто: можно пройти» — на поздних кругах сквозь
 * стёртую стену проходишь, места начинают сливаться, план разваливается).
 *
 * Видимое и проходимое должны совпасть, поэтому здесь — та же маска стирания стены, что в шейдере мира
 * (render/shaders.ts, SOFT_NOISE_GLSL: cellHash, softNoise, wallGoneAt), тем же целочисленным хешем, и по ней —
 * прорехи в преграде стены: отрезки вдоль стены, где она стёрта на всю высоту роста с обеих сторон и шире
 * тела игрока. Сплошные куски между прорехами остаются преградой.
 *
 * Открываются только стены между клетками уровня (у них есть соседняя клетка того же яруса и с тем же полом):
 * наружный край воспоминания держит — за ним пустота, куда нельзя уйти. Двери, лестничные шахты и провалы не
 * трогаются.
 *
 * Чистый TS: игра, тесты.
 */
import type { Aabb } from './colliders';

/** Случайное число клетки мира — тот же хеш, что cellHash в шейдере (uint-арифметика, одинаково на любом устройстве). */
export function cellHash(x: number, y: number, z: number): number {
  const qx = (Math.floor(x) + 32768) >>> 0;
  const qy = (Math.floor(y) + 32768) >>> 0;
  const qz = (Math.floor(z) + 32768) >>> 0;
  let n = (Math.imul(qx, 0x27d4eb2d) ^ Math.imul(qy, 0x165667b1) ^ Math.imul(qz, 0x9e3779b1)) >>> 0;
  n = (n ^ (n >>> 15)) >>> 0;
  n = Math.imul(n, 0x2c1b3c6d) >>> 0;
  n = (n ^ (n >>> 12)) >>> 0;
  n = Math.imul(n, 0x297a2d39) >>> 0;
  n = (n ^ (n >>> 15)) >>> 0;
  return (n & 0xffff) / 65535;
}

const fade = (t: number): number => t * t * (3 - 2 * t);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Плавный шум 0..1 — как softNoise в шейдере. */
export function softNoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const fz = fade(z - iz);
  const h = (dx: number, dy: number, dz: number): number => cellHash(ix + dx, iy + dy, iz + dz);
  const a = mix(mix(h(0, 0, 0), h(1, 0, 0), fx), mix(h(0, 1, 0), h(1, 1, 0), fx), fy);
  const b = mix(mix(h(0, 0, 1), h(1, 0, 1), fx), mix(h(0, 1, 1), h(1, 1, 1), fx), fy);
  return mix(a, b, fz);
}

/** Насколько стёрта стена в точке мира на высоте h над своим полом (amount — сила стирания стен, decay.walls). */
export function wallGoneAt(x: number, y: number, z: number, h: number, amount: number): number {
  if (amount <= 0) return 0;
  const n = softNoise(x * 0.9 + 3.1, y * 0.9 + 3.1, z * 0.9 + 3.1) * 0.65 + (1 - Math.min(1, Math.max(0, h / 2.7))) * 0.35;
  return Math.min(1, Math.max(0, (amount * 1.14 - 0.06 - n) / 0.08));
}

/** Стена между клетками, у которой может открыться прореха (метка на её преграде, world/colliders.ts). */
export interface WallCut {
  /** Стена идёт вдоль оси z (тогда line — её x); иначе — вдоль x (line — её z). */
  alongZ: boolean;
  line: number;
  /** Половина толщины стены, м. */
  t: number;
  /** Концы преграды вдоль стены, м (с углами). */
  a0: number;
  a1: number;
  /** Высоты преграды и пол клеток, м. */
  lo: number;
  hi: number;
  floor: number;
}

/** Высоты, на которых стена должна быть стёрта, чтобы пройти: от щиколоток до макушки, м над полом. */
const BODY: readonly number[] = [0.12, 0.5, 0.9, 1.3, 1.7, 1.92];
/** Шаг выборки вдоль стены и самая узкая прореха, в которую проходит тело, м. */
const STEP = 0.1;
export const MIN_GAP = 0.8;
/** Стёрто, если маска выше этого (в шейдере кромка — от 0 до 1 на 0,08 силы). */
const GONE = 0.5;

/**
 * Прорехи в стене при силе стирания amount: отрезки [s0, s1] вдоль стены, где она стёрта на всю высоту роста с
 * обеих сторон и не уже MIN_GAP. Углы (по толщине стены с каждого конца) не открываются никогда.
 */
export function wallGaps(c: WallCut, amount: number): [number, number][] {
  // Внизу стена стирается последней: пока у щиколоток не стёрто нигде, прорех нет (быстрый выход на ранних кругах).
  if (amount * 1.14 - 0.06 - GONE * 0.08 <= 0.35 * (1 - BODY[0]! / 2.7)) return [];
  const s0 = c.a0 + 2 * c.t;
  const s1 = c.a1 - 2 * c.t;
  const out: [number, number][] = [];
  let run = -1;
  const n = Math.max(0, Math.floor((s1 - s0) / STEP));
  for (let i = 0; i <= n; i++) {
    const s = s0 + i * STEP;
    let gone = true;
    for (const side of [-1, 1]) {
      const across = c.line + side * c.t;
      for (const h of BODY) {
        const x = c.alongZ ? across : s;
        const z = c.alongZ ? s : across;
        if (wallGoneAt(x, c.floor + h, z, h, amount) <= GONE) {
          gone = false;
          break;
        }
      }
      if (!gone) break;
    }
    if (gone && run < 0) run = s;
    if ((!gone || i === n) && run >= 0) {
      const end = gone ? s : s - STEP;
      if (end - run >= MIN_GAP) out.push([run, end]);
      run = -1;
    }
  }
  return out;
}

/** Сплошные куски стены между прорехами — то, что остаётся преградой. */
export function solidRuns(c: WallCut, gaps: readonly [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let at = c.a0;
  for (const [g0, g1] of gaps) {
    if (g0 > at) out.push([at, g0]);
    at = g1;
  }
  if (c.a1 > at) out.push([at, c.a1]);
  return out;
}

/** Что нужно от набора преград (world/colliders.ts, ColliderSet). */
interface CutTarget {
  readonly boxes: Aabb[];
  add(box: Aabb): number;
  setGroup(group: string, on: boolean): void;
}

/**
 * Прорехи на уровне: по силе стирания стен amount целые преграды стен с меткой cut заменяются сплошными кусками
 * между прорехами. Считается заново, только когда сила сдвинулась на шаг 0,02 (стирание растёт за сессию от касаний);
 * прежние куски выключаются, так что сила может и уменьшиться (новый уровень). Стены с группой (варианты комнат) не
 * трогаются.
 */
export class WallCuts {
  private step = -1;
  private group = '';
  private n = 0;
  /** Сколько стен сейчас с прорехами. */
  open = 0;

  apply(col: CutTarget, amount: number): number {
    const q = Math.floor(Math.max(0, amount) * 50) / 50;
    if (q === this.step) return this.open;
    this.step = q;
    if (this.group) col.setGroup(this.group, false);
    this.n += 1;
    const group = `wallcut:${this.n}`;
    let open = 0;
    const walls = col.boxes.filter((b) => b.cut !== undefined && b.group === undefined);
    for (const b of walls) {
      const c = b.cut!;
      const gaps = wallGaps(c, q);
      if (gaps.length === 0) {
        b.off = false;
        continue;
      }
      b.off = true;
      open += 1;
      for (const [r0, r1] of solidRuns(c, gaps)) {
        col.add(c.alongZ ? { minX: c.line - c.t, minY: c.lo, minZ: r0, maxX: c.line + c.t, maxY: c.hi, maxZ: r1, group } : { minX: r0, minY: c.lo, minZ: c.line - c.t, maxX: r1, maxY: c.hi, maxZ: c.line + c.t, group });
      }
    }
    this.group = group;
    this.open = open;
    return open;
  }
}
