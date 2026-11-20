/**
 * Трава: где лежат плитки (world/grass.ts) и какие из них отдать рендеру в этом кадре. Плитки ставит место — луг
 * (world/pocket_meadow.ts) или помещение уровня, где трава проросла сквозь пол (world/level_build.ts, grassRoom); здесь только
 * ближние первыми, без выделения памяти в кадре. Отсечение по кадру и подробность по расстоянию — у рендера (setGrass).
 *
 * Чистый TS.
 */
import type { Vec3 } from '../core/types';
import { GRASS_KINDS, GRASS_VARIANTS } from '../world/grass';

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
/**
 * Трава тянется к свету (партнёр 20.11: «Теперь сделай, чтобы трава тянулась к лучу»; design.md §36, «заворожить»): где на
 * траву лёг луч фонаря (в светлом месте — взгляд), она клонится к свету и чуть вытягивается. Не сразу: поворачивается за
 * rise секунд и отпускает дольше — за fall: проведёшь лучом по полю, и за ним остаётся медленно распрямляющийся след. Карта —
 * клетками по cell метров над всем полем травы; шейдер читает её по корню травинки (render/shaders.ts, uLean).
 */
export const LEAN = { cell: 0.5, rise: 0.7, fall: 2.4 } as const;

/** Свет, к которому тянется трава: откуда (фонарь или глаза), куда, косинус половины раствора конуса и дальность, м. */
export interface LeanLight {
  from: Vec3;
  dir: Vec3;
  cos: number;
  range: number;
}

/** Карта «насколько тянется» над полем травы: w × h клеток по cell метров от (minX, minZ), 0..255 — для текстуры. */
export interface LeanMap {
  data: Uint8Array;
  w: number;
  h: number;
  minX: number;
  minZ: number;
  cell: number;
}

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
  /**
   * Трава короткая — газон жёлтых комнат (world/grass.ts, lawn): по щиколотку вещь не прячется, и вокруг неё не вытаптывается
   * круг — только её след, в её размер. Газон остаётся нетронутым, как ковёр (квиз партнёра, ночь на 20.11).
   */
  short: boolean;
}

export class Grass {
  readonly sites: readonly GrassSite[];
  readonly field: GrassField | null;
  private readonly order: number[];
  private readonly dist: Float32Array;
  private sortedAt: Vec3 | null = null;

  /** Карта «тянется к свету» (LEAN); у газона её нет — он неподвижен. */
  readonly lean: LeanMap | null;
  private readonly leanF: Float32Array | null;
  /** Есть ли в карте хоть что-то (иначе без света её можно не обходить) и в каких клетках (i0, i1, j0, j1). */
  private leanAny = false;
  private readonly leanBox: [number, number, number, number] = [Number.MAX_SAFE_INTEGER, -1, Number.MAX_SAFE_INTEGER, -1];

  constructor(sites: readonly GrassSite[]) {
    this.sites = sites;
    this.order = sites.map((_, i) => i);
    this.dist = new Float32Array(sites.length);
    if (sites.length === 0) this.field = null;
    else {
      const lawn = GRASS_KINDS.indexOf('lawn');
      const f: GrassField = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, floor: Infinity, short: sites.every((s) => Math.floor(s.form / GRASS_VARIANTS) === lawn) };
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
    const f = this.field;
    if (f && !f.short) {
      const w = Math.max(1, Math.ceil((f.maxX - f.minX) / LEAN.cell));
      const h = Math.max(1, Math.ceil((f.maxZ - f.minZ) / LEAN.cell));
      this.lean = { data: new Uint8Array(w * h), w, h, minX: f.minX, minZ: f.minZ, cell: LEAN.cell };
      this.leanF = new Float32Array(w * h);
    } else {
      this.lean = null;
      this.leanF = null;
    }
  }

  /**
   * Трава тянется к свету (LEAN): клетки, на которые светит, за rise секунд доходят до 1, остальные за fall — до нуля. Свет — по
   * середине клетки на высоте травы; у края конуса — плавно. Без света и с пустой картой — ничего не делает. Возвращает, менялась
   * ли карта (рендеру — перезалить текстуру).
   */
  updateLean(light: LeanLight | null, dt: number): boolean {
    const m = this.lean;
    const v = this.leanF;
    const f = this.field;
    if (!m || !v || !f || dt <= 0 || (!light && !this.leanAny)) return false;
    const kIn = 1 - Math.exp(-dt / LEAN.rise);
    const kOut = 1 - Math.exp(-dt / LEAN.fall);
    const y = f.floor + 0.25;
    const cosIn = light ? 1 - (1 - light.cos) * 0.3 : 1;
    // Обходить не всё поле (на лугу — 120 × 120 клеток), а только то, куда достаёт свет, и то, что ещё не распрямилось.
    let i0 = this.leanBox[0];
    let i1 = this.leanBox[1];
    let j0 = this.leanBox[2];
    let j1 = this.leanBox[3];
    if (light) {
      i0 = Math.min(i0, Math.max(0, Math.floor((light.from[0] - light.range - m.minX) / m.cell)));
      i1 = Math.max(i1, Math.min(m.w - 1, Math.ceil((light.from[0] + light.range - m.minX) / m.cell)));
      j0 = Math.min(j0, Math.max(0, Math.floor((light.from[2] - light.range - m.minZ) / m.cell)));
      j1 = Math.max(j1, Math.min(m.h - 1, Math.ceil((light.from[2] + light.range - m.minZ) / m.cell)));
    }
    let changed = false;
    let bi0 = m.w;
    let bi1 = -1;
    let bj0 = m.h;
    let bj1 = -1;
    for (let j = Math.max(0, j0); j <= Math.min(m.h - 1, j1); j++) {
      const z = m.minZ + (j + 0.5) * m.cell;
      for (let i = Math.max(0, i0); i <= Math.min(m.w - 1, i1); i++) {
        const k = j * m.w + i;
        let target = 0;
        if (light) {
          const dx = m.minX + (i + 0.5) * m.cell - light.from[0];
          const dy = y - light.from[1];
          const dz = z - light.from[2];
          const dd = dx * dx + dy * dy + dz * dz;
          if (dd > 0.09 && dd < light.range * light.range) {
            const d = Math.sqrt(dd);
            const c = (dx * light.dir[0] + dy * light.dir[1] + dz * light.dir[2]) / d;
            if (c > light.cos) {
              const t = Math.min(1, (c - light.cos) / Math.max(1e-6, cosIn - light.cos));
              const far = Math.min(1, Math.max(0, (d - light.range * 0.6) / (light.range * 0.4)));
              target = t * t * (3 - 2 * t) * (1 - far * far * (3 - 2 * far));
            }
          }
        }
        const was = v[k]!;
        if (was === 0 && target === 0) continue;
        const now = was + (target - was) * (target > was ? kIn : kOut);
        const val = now < 0.002 && target === 0 ? 0 : now;
        v[k] = val;
        if (val > 0) {
          if (i < bi0) bi0 = i;
          if (i > bi1) bi1 = i;
          if (j < bj0) bj0 = j;
          if (j > bj1) bj1 = j;
        }
        const b = Math.round(val * 255);
        if (b !== m.data[k]) {
          m.data[k] = b;
          changed = true;
        }
      }
    }
    this.leanBox[0] = bi0;
    this.leanBox[1] = bi1;
    this.leanBox[2] = bj0;
    this.leanBox[3] = bj1;
    this.leanAny = bi1 >= 0;
    return changed;
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
        out[n++] = [x, f.floor, z, f.short ? Math.min(0.6, 0.1 + it.radius) : Math.min(1.2, 0.62 + 1.2 * it.radius)];
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
