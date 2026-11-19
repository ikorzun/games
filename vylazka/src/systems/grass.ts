/**
 * Трава: где лежат плитки (world/grass.ts) и какие из них отдать рендеру в этом кадре. Плитки ставит место — луг
 * (world/pocket_meadow.ts) или помещение уровня, где трава проросла сквозь пол (world/level_build.ts, grassRoom); здесь только
 * ближние первыми, без выделения памяти в кадре. Отсечение по кадру и подробность по расстоянию — у рендера (setGrass).
 *
 * Чистый TS.
 */
import type { Vec3 } from '../core/types';

/** Чисел на плитку в списке для рендера: x, y, z, поворот вокруг вертикали, размер поперёк, размер по высоте, форма. */
export const GRASS_STRIDE = 7;
/**
 * Сколько ближних плиток отдавать рендеру (предел в кадре по качеству — у рендера) и дальше скольких метров травы не видно. Луг —
 * круг в 30 м, и трава на нём тянется до края, а не обрывается кругом у глаза (куратор, противоречие 349): у горизонта плитка —
 * каждая девятая травинка (world/grass.ts), и вся она обходится дешевле прежних восемнадцати метров.
 */
export const GRASS_SHOWN = 3000;
export const GRASS_FAR = 30;
/** Сколько вытоптанных кругов держит трава места (render/shaders.ts, GRASS; level_build.ts, grassClear). */
export const GRASS_CLEAR = 16;

export interface GrassSite {
  /** Середина плитки на полу (корни травинок), м. */
  pos: Vec3;
  /** Поворот вокруг вертикали, рад. */
  rot: number;
  /** Размер поперёк (1 — плитка 1 × 1 м) и по высоте (1 — трава своего вида). */
  s: number;
  h: number;
  /** Форма сетки: world/grass.ts, grassForm. */
  form: number;
}

/** Пересортировать, когда глаз ушёл дальше этого от прошлой сортировки, м. */
const RESORT = 0.6;

/** Вытоптанный круг: x, пол, z, радиус, м. */
export type GrassClearing = [number, number, number, number];

/** Где лежит трава: прямоугольник плиток (с запасом на свес травинок) и пол под ней. */
export interface GrassField {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  floor: number;
}

export class Grass {
  readonly sites: readonly GrassSite[];
  readonly field: GrassField | null;
  private readonly order: number[];
  private readonly dist: Float32Array;
  private sortedAt: Vec3 | null = null;

  constructor(sites: readonly GrassSite[]) {
    this.sites = sites;
    this.order = sites.map((_, i) => i);
    this.dist = new Float32Array(sites.length);
    if (sites.length === 0) this.field = null;
    else {
      const f: GrassField = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, floor: Infinity };
      for (const s of sites) {
        const r = 0.5 * s.s + 0.4;
        f.minX = Math.min(f.minX, s.pos[0] - r);
        f.maxX = Math.max(f.maxX, s.pos[0] + r);
        f.minZ = Math.min(f.minZ, s.pos[2] - r);
        f.maxZ = Math.max(f.maxZ, s.pos[2] + r);
        f.floor = Math.min(f.floor, s.pos[1]);
      }
      this.field = f;
    }
  }

  /**
   * Вытоптанные круги сейчас (render: шейдер травы, GRASS): сперва вокруг вещей, что лежат на полу этой травы (вещь примяла её
   * собой — кругом в свой размер), потом у дверей места (doors, world/level_build.ts, grassClear). Не больше GRASS_CLEAR — в out;
   * возвращает, сколько записано. Трава не прячет ключи на полу (куратор, противоречие 346), а заросшим остаётся весь пол, где
   * ничего не лежит.
   */
  clearings(items: Iterable<{ pos: Vec3; radius: number }>, doors: readonly GrassClearing[], out: GrassClearing[]): number {
    const f = this.field;
    let n = 0;
    if (f) {
      for (const it of items) {
        if (n >= GRASS_CLEAR) break;
        const [x, y, z] = it.pos;
        if (x < f.minX || x > f.maxX || z < f.minZ || z > f.maxZ || y < f.floor - 0.3 || y > f.floor + 0.55) continue;
        out[n++] = [x, f.floor, z, Math.min(1.2, 0.62 + 1.2 * it.radius)];
      }
    }
    for (const d of doors) {
      if (n >= GRASS_CLEAR) break;
      out[n++] = [d[0], d[1], d[2], d[3]];
    }
    out.length = n;
    return n;
  }

  /** Ближайшие к глазу плитки не дальше far, не больше max — в out по GRASS_STRIDE чисел. Возвращает, сколько записано. */
  visible(eye: Vec3, max: number, out: Float32Array, far = Infinity): number {
    const n = this.sites.length;
    const last = this.sortedAt;
    if (!last || Math.hypot(eye[0] - last[0], eye[1] - last[1], eye[2] - last[2]) > RESORT) {
      for (let i = 0; i < n; i++) {
        const p = this.sites[i]!.pos;
        this.dist[i] = Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
      }
      this.order.sort((a, b) => this.dist[a]! - this.dist[b]!);
      this.sortedAt = [eye[0], eye[1], eye[2]];
    }
    const S = GRASS_STRIDE;
    const room = Math.min(max, Math.floor(out.length / S));
    let k = 0;
    for (let j = 0; j < n && k < room; j++) {
      const s = this.sites[this.order[j]!]!;
      const p = s.pos;
      if (Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]) > far + 1) break;
      const o = k * S;
      out[o] = p[0];
      out[o + 1] = p[1];
      out[o + 2] = p[2];
      out[o + 3] = s.rot;
      out[o + 4] = s.s;
      out[o + 5] = s.h;
      out[o + 6] = s.form;
      k++;
    }
    return k;
  }
}
