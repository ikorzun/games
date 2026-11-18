/**
 * Мебель игры — моделями полки Sand3D (партнёр 18.11, 09:41: «замени всю мебель на новую самостоятельно»).
 *
 * Вещь игры остаётся собой по имени и опоре: диван так и зовётся «sofa», записи партнёра (замены, перестановки, «убрана»,
 * world/placed.ts) находят его, как раньше. Меняется вид: вместо коробок — модель полки (scripts/import_sand3d.py), у
 * нескольких вещей — на выбор из двух-трёх моделей, какую взять, решает сид. Составные вещи (стол с табуреткой, кабинка,
 * переговорная, стеллаж с папками) собираются из моделей полки и прежних мелочей: клеёнка, тарелка, машинка, терминал,
 * книги и папки на полках — они и делают вещь узнаваемой.
 *
 * Пока кусок с моделями не пришёл (world/sand3d.ts) или не пришёл вовсе, на месте модели — серая коробка её габарита с той
 * же преградой: раскладка, преграды и места для вещей от этого не меняются.
 *
 * Здесь же — что знают о моделях полки те, кто кладёт на них вещи: высота столешницы, сиденья и полки шкафа (сняты с самих
 * моделей; tests/furniture.test.ts сверяет их с данными, чтобы новая модель не оставила машинку висеть в воздухе).
 */
import { hash2 } from '../core/rng';
import type { Vec3 } from '../core/types';
import { MAT } from './materials';
import { hasModel, placeModel } from './models';
import type { Xf } from './props';
import type { PropSpec } from './props_more';
import { SAND3D_META } from './sand3d_meta';

export type S3Mount = 'floor' | 'free';

/** Вверх до сантиметра (с запасом на шум плавающей запятой). */
const cm = (v: number): number => Math.ceil(v * 100 - 1e-6) / 100;

/** Габарит модели полки, округлённый вверх до сантиметра: у стены — x ±w/2, z от 0 до d; посреди — x ±w/2, z ±d/2. */
export interface S3Size {
  w: number;
  d: number;
  h: number;
  mount: S3Mount;
}

export function s3Size(name: string): S3Size {
  const m = SAND3D_META[name];
  if (!m) throw new Error(`нет такой вещи полки: ${name}`);
  const free = m.mount === 'free';
  return {
    w: cm(Math.max(-m.min[0], m.max[0]) * 2),
    d: free ? cm(Math.max(-m.min[2], m.max[2]) * 2) : cm(m.max[2]),
    h: cm(m.max[1]),
    mount: m.mount,
  };
}

export interface S3Opts {
  /** Множитель оттенка (разброс тона, см. jitter). */
  tint?: Vec3;
  /** Опрокинута на спину (models.ts, PlaceOpts.tip): x — прежний, y от 0 до d, z от 0 до h. */
  tip?: boolean;
  /**
   * Доворот вокруг вертикали, радианы: вещь стоит чуть вразнобой (куратор, «Ряд сбит, а не отпечатан»). У стены (спина в
   * z = 0) вещь при этом отодвигается ровно настолько, чтобы задние углы остались перед стеной.
   */
  yaw?: number;
  /** Преграда во весь габарит (по умолчанию есть). */
  collide?: boolean;
}

/** Охват прямоугольника x0…x1 × z0…z1 после поворота на yaw вокруг начала координат: [x0, x1, z0, z1]. */
function turned(x0: number, x1: number, z0: number, z1: number, yaw: number): [number, number, number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const out: [number, number, number, number] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const x of [x0, x1]) {
    for (const z of [z0, z1]) {
      const rx = x * c - z * s;
      const rz = x * s + z * c;
      out[0] = Math.min(out[0], rx);
      out[1] = Math.max(out[1], rx);
      out[2] = Math.min(out[2], rz);
      out[3] = Math.max(out[3], rz);
    }
  }
  return out;
}

/** На сколько отодвинуть от стены довёрнутую вещь с этим габаритом (спина в z = 0), чтобы задние углы остались перед стеной. */
function wallGap(lo: Vec3, hi: Vec3, yaw: number): number {
  return yaw !== 0 && lo[2] === 0 ? Math.max(0, -turned(lo[0], hi[0], lo[2], hi[2], yaw)[2]) : 0;
}

/** Габарит модели в точке xf (в координатах вещи) — с учётом опоры, опрокидывания и доворота. */
export function s3Bounds(name: string, tip = false, yaw = 0): [Vec3, Vec3] {
  const g = s3Size(name);
  const z0 = !tip && g.mount === 'free' ? -g.d / 2 : 0;
  const lo: Vec3 = [-g.w / 2, 0, z0];
  const hi: Vec3 = [g.w / 2, tip ? g.d : g.h, tip ? g.h : z0 + g.d];
  if (yaw === 0) return [lo, hi];
  const dz = wallGap(lo, hi, yaw);
  const [a, b, e, f] = turned(lo[0], hi[0], lo[2], hi[2], yaw);
  return [[a, 0, e + dz], [b, hi[1], f + dz]];
}

/** Запись поставленных моделей (для проверки описи FURNITURE_FROM): пока идёт recordS3 — сюда попадает каждое имя. */
let record: Set<string> | null = null;

/** Выполнить body и вернуть, какие модели полки он поставил. */
export function recordS3(body: () => void): Set<string> {
  const prev = record;
  const names = new Set<string>();
  record = names;
  try {
    body();
  } finally {
    record = prev;
  }
  return names;
}

/**
 * Модель полки в точке xf; опора — своя у модели (у стены — спина в z = 0, посреди — середина в начале координат).
 * Пока модели нет — серая коробка габарита: видно, что там стоит, и обходится она так же.
 */
export function s3Put(xf: Xf, name: string, opts: S3Opts = {}): void {
  record?.add(name);
  const yaw = opts.yaw ?? 0;
  const [lo, hi] = s3Bounds(name, opts.tip, yaw);
  // Довёрнутая у стены — отодвинута на столько же, на сколько сдвинут её габарит.
  const [l0, h0] = s3Bounds(name, opts.tip);
  const dz = wallGap(l0, h0, yaw);
  const at = dz > 0 ? xf.child(0, 0, dz) : xf;
  if (hasModel(name)) placeModel(at, name, { ...(opts.tint ? { tint: opts.tint } : {}), ...(opts.tip ? { tip: true } : {}), ...(yaw !== 0 ? { yaw } : {}) });
  else xf.box(lo, hi, MAT.paper, opts.tint ? { tint: opts.tint } : {});
  if (opts.collide !== false) xf.collider(lo, hi);
}

/** Модель полки на месте вещи с опорой mount: у стены — спиной к z = 0, посреди — серединой в начале координат. */
export function s3As(xf: Xf, name: string, mount: S3Mount, opts: S3Opts = {}): void {
  const g = s3Size(name);
  const dz = g.mount === mount ? 0 : mount === 'floor' ? g.d / 2 : -g.d / 2;
  s3Put(dz === 0 ? xf : xf.child(0, 0, dz), name, opts);
}

/** Вариант по сиду: у одного сида — всегда один и тот же; salt разводит выборы внутри одной вещи. */
export function pickOf<T>(list: readonly T[], seed: number, salt = 0): T {
  return list[hash2(seed, salt, 0x53d3) % list.length]!;
}

/**
 * Разброс тона на экземпляр: ряд одинаковых шкафов не выглядит штампом (слова партнёра: «не видно было стыков и
 * дублирования паттернов, иначе выглядит дешево»). Светлее-темнее на ±amount и чуть теплее или холоднее.
 */
export function jitter(seed: number, amount = 0.07, salt = 0): Vec3 {
  const k = 1 + (hash2(seed, salt, 0x71e) / 4294967296 - 0.5) * 2 * amount;
  const warm = (hash2(seed, salt, 0x3c9) / 4294967296 - 0.5) * amount * 0.6;
  return [k * (1 + warm), k, k * (1 - warm)];
}

/** Охват нескольких моделей полки (габарит вещи, у которой вид — одна из них). */
export function spanOf(names: readonly string[]): { w: number; d: number; h: number } {
  const sizes = names.map(s3Size);
  return { w: Math.max(...sizes.map((g) => g.w)), d: Math.max(...sizes.map((g) => g.d)), h: Math.max(...sizes.map((g) => g.h)) };
}

/** Как стоит экземпляр: доворот до ±turn радиан и отступ от стены до pull метров — по сиду. */
export interface Stance {
  turn?: number;
  pull?: number;
}

/** Доворот экземпляра по сиду: от −turn до +turn. */
export const turnOf = (seed: number, turn: number, salt = 0): number => (hash2(seed, salt, 0x7a3) / 4294967296 - 0.5) * 2 * turn;

/**
 * Вещь игры, которую строит модель полки: опора и имя — прежние, вид — одна из моделей variants (решает сид), с разбросом
 * тона. stance — как стоит экземпляр: чуть довёрнут, чуть отодвинут от стены, чтобы ряд одинаковых вещей был сбит, а не
 * отпечатан. Габарит — охват всех вариантов при крайнем довороте и отступе.
 */
export function furnished(mount: S3Mount, variants: readonly string[], ru: string, stance: Stance = {}): PropSpec {
  const turn = stance.turn ?? 0;
  const pull = mount === 'floor' ? (stance.pull ?? 0) : 0;
  const span = spanOf(variants);
  // Охват при крайнем довороте: прямоугольник w × d, повёрнутый на turn.
  const w = turn ? Math.max(...variants.map((v) => s3Bounds(v, false, turn)).map(([lo, hi]) => hi[0] - lo[0])) : span.w;
  const d = turn ? Math.max(...variants.map((v) => s3Bounds(v, false, turn)).map(([lo, hi]) => hi[2] - lo[2])) : span.d;
  return {
    w: cm(w),
    d: cm(d + pull),
    h: span.h,
    mount,
    ru,
    build(xf, seed) {
      const z = pull ? (hash2(seed, 0x5e, 0x91) / 4294967296) * pull : 0;
      s3As(z ? xf.child(0, 0, z) : xf, pickOf(variants, seed), mount, { tint: jitter(seed), ...(turn ? { yaw: turnOf(seed, turn) } : {}) });
    },
  };
}

/**
 * Из каких моделей полки собрана мебель игры (вещь игры → модели; для конструктора партнёра и описи). Сверяется тестом с
 * тем, что вещь на самом деле ставит (recordS3), — опись не отстанет от кода.
 */
export const FURNITURE_FROM: Readonly<Record<string, readonly string[]>> = {
  sofa: ['s3_sofa_olive', 's3_sofa_grey'],
  armchair: ['s3_armchair_round', 's3_armchair_sixties'],
  kitchen_table: ['s3_table_kitchen', 's3_stool_wood'],
  wardrobe: ['s3_wardrobe_plain', 's3_wardrobe_grey'],
  bookshelf: ['s3_bookcase_dark', 's3_etagere'],
  bed_home: ['s3_bed_iron_green'],
  coat_rack: ['s3_coat_stand'],
  desk_pc: ['s3_desk_simple'],
  crib: ['s3_crib'],
  office_desk: ['s3_desk_office_grey', 's3_desk_office'],
  office_chair: ['s3_chair_office'],
  desk_island: ['s3_desk_office_grey', 's3_desk_office', 's3_chair_office'],
  cubicle: ['s3_desk_office_grey', 's3_desk_office', 's3_chair_office'],
  filing_cabinet: ['s3_filing_cabinet'],
  meeting_table: ['s3_table_meeting', 's3_chair_office'],
  binder_shelf: ['s3_bookcase_office', 's3_rack_metal'],
  bunk_triple: ['s3_bunk_black', 's3_bunk_mattress'],
  bed_frame: ['s3_bed_iron_white', 's3_bed_iron_green'],
  typewriter_desk: ['s3_desk_simple', 's3_chair_ladder', 's3_chair_carved'],
  canteen_set: ['s3_stool_wood'],
  dosimeter_case: ['s3_stool_wood'],
  med_stretcher_bed: ['s3_bed_iron_white'],
  overturned_table: ['s3_table_work', 's3_chair_ladder', 's3_chair_carved'],
  st_seats: ['s3_bench_wood', 's3_bench_blue', 's3_bench_cast'],
  st_seats_double: ['s3_bench_wood', 's3_bench_blue'],
};

/** Высота столешницы (или крышки), м: на неё ставится машинка, терминал, тарелка, лампа. */
export const S3_TOP: Readonly<Record<string, number>> = {
  s3_table_kitchen: 0.736,
  s3_table_work: 0.8,
  s3_desk_green: 0.786,
  s3_desk_simple: 0.748,
  s3_desk_office: 0.75,
  s3_desk_office_grey: 0.765,
  s3_table_meeting: 0.78,
  s3_stool_wood: 0.434,
  s3_nightstand: 0.6,
};

/** Высота сиденья, м: на неё кладутся записка, стакан, пальто. */
export const S3_SEAT: Readonly<Record<string, number>> = {
  s3_bench_wood: 0.45,
  s3_bench_blue: 0.47,
  s3_bench_cast: 0.4,
  s3_chair_office: 0.48,
  s3_chair_ladder: 0.42,
  s3_chair_carved: 0.42,
};

/** Высота лежанки (матрас, одеяло; у нар — нижний ярус), м: на неё кладут вещь. */
export const S3_BED: Readonly<Record<string, number>> = {
  s3_bunk_black: 0.56,
  s3_bunk_mattress: 0.45,
  s3_bed_iron_white: 0.52,
  s3_bed_iron_green: 0.74,
};

/** Полка шкафа или стеллажа: доска (верх) на высоте y, до следующей доски — clear; свободно по x0…x1 и z0…z1. */
export interface Shelf {
  y: number;
  clear: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const row = (x0: number, x1: number, z0: number, z1: number, ...levels: Array<[number, number]>): Shelf[] => levels.map(([y, clear]) => ({ y, clear, x0, x1, z0, z1 }));

/**
 * Полки шкафов и стеллажей полки Sand3D (с моделей: верх доски и низ следующей). У металлического стеллажа двух досок не
 * хватает — там ящики ниже и выше, чем у соседних пролётов.
 */
export const S3_SHELVES: Readonly<Record<string, readonly Shelf[]>> = {
  s3_bookcase_dark: row(-0.49, 0.49, 0.06, 0.37, [0.09, 0.23], [0.35, 0.31], [0.69, 0.3], [1.02, 0.3], [1.35, 0.35]),
  s3_etagere: row(-0.46, 0.46, 0.03, 0.33, [0.14, 0.37], [0.93, 0.41], [1.36, 0.33]),
  s3_bookcase_office: row(-0.53, 0.53, 0.04, 0.43, [0.21, 0.27], [0.53, 0.32], [0.93, 0.3], [1.29, 0.33], [1.66, 0.25]),
  s3_rack_metal: [
    ...row(-0.63, 0.13, 0.03, 0.49, [0.08, 0.21], [0.3, 0.39]),
    ...row(0.19, 0.63, 0.03, 0.49, [0.08, 0.61]),
    ...row(-0.63, -0.22, 0.03, 0.49, [0.7, 0.36], [1.07, 0.37]),
    ...row(-0.16, 0.63, 0.03, 0.49, [0.7, 0.74]),
    ...row(-0.63, 0.63, 0.03, 0.49, [1.45, 0.21], [1.68, 0.3]),
  ],
};

/** Что стоит на полках: пёстрые книги, папки-корешки, ящики и коробки, кипы бумаг. */
export type ShelfLoad = 'books' | 'binders' | 'boxes' | 'papers';

const SPINES: ReadonlyArray<readonly [number, Vec3]> = [
  [MAT.paintRed, [1.3, 1.1, 1.1]],
  [MAT.paintBlue, [1.2, 1.3, 1.5]],
  [MAT.paintGreen, [1.2, 1.4, 1.3]],
  [MAT.paintOchre, [1.5, 1.3, 0.9]],
  [MAT.paper, [1.4, 1.35, 1.1]],
  [MAT.bakelite, [1.5, 1.5, 1.5]],
];
const BINDERS: ReadonlyArray<readonly [number, Vec3]> = [
  [MAT.cardboard, [0.8, 0.8, 0.82]],
  [MAT.paintBlue, [0.55, 0.7, 1.05]],
  [MAT.paper, [1.2, 1.15, 0.95]],
  [MAT.paintRed, [1.0, 0.55, 0.5]],
];

/** Простой детерминированный разброс для мелочей на полках (на геймплей не влияет). */
function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Свободный промежуток на полке: там ляжет вещь воспоминания (furnish.ts кладёт туда место для неё). */
export interface ShelfHole {
  /** Номер полки в списке. */
  shelf: number;
  x0: number;
  x1: number;
}

/** Корешок к корешку вдоль полки; лишнее место в конце пролёта — пусто, промежуток hole — тоже. */
function spineRow(xf: Xf, s: Shelf, rnd: () => number, width: () => number, height: () => number, depth: number, look: () => readonly [number, Vec3], gap: number, back: boolean, hole: readonly [number, number] | null): void {
  const end = s.x1 - (rnd() < 0.35 ? rnd() * (s.x1 - s.x0) * 0.45 : 0);
  let x = s.x0;
  while (x < end) {
    if (rnd() < gap) {
      x += 0.04 + rnd() * 0.1;
      continue;
    }
    const w = width();
    if (hole && x + w > hole[0] && x < hole[1]) {
      x = hole[1];
      continue;
    }
    if (x + w > end) break;
    const h = Math.min(height(), s.clear - 0.02);
    const [m, t] = look();
    const z1 = s.z1 - rnd() * 0.02;
    xf.box([x, s.y, Math.max(s.z0, z1 - depth)], [x + w, s.y + h, z1], m, { tint: t, skip: back ? ['ny', 'nz'] : ['ny'] });
    x += w + 0.003;
  }
}

/** Стопка лёжа (кипа бумаги, книги плашмя): листы разной ширины, чуть вразнобой. */
function flatStack(xf: Xf, x: number, s: Shelf, rnd: () => number, n: number, look: () => readonly [number, Vec3]): number {
  const w = 0.2 + rnd() * 0.08;
  let y = s.y;
  for (let i = 0; i < n && y < s.y + s.clear - 0.06; i++) {
    const h = 0.025 + rnd() * 0.03;
    const ox = (rnd() - 0.5) * 0.02;
    const [m, t] = look();
    xf.box([x + ox, y, s.z1 - 0.26], [x + ox + w, y + h, s.z1 - 0.02], m, { tint: t, skip: ['ny'] });
    y += h;
  }
  return w;
}

/**
 * Разложить по полкам: books — пёстрые корешки разной высоты, местами стопка плашмя; binders — папки одной высоты в
 * четыре цвета с пропусками (где низко — архивные коробки); boxes — ящики и тюки (кладовая убежища); papers — кипы
 * бумаги и папки (архив). back: у полки есть задняя стенка — задние грани не строятся; hole — промежуток, который
 * остаётся пустым.
 */
export function fillShelves(xf: Xf, shelves: readonly Shelf[], load: ShelfLoad, seed: number, opts: { back?: boolean; hole?: ShelfHole } = {}): void {
  const rnd = lcg(seed);
  const back = opts.back !== false;
  const of = <T>(list: readonly T[]): (() => T) => () => list[Math.floor(rnd() * list.length)]!;
  shelves.forEach((s, i) => {
    const hole = opts.hole?.shelf === i ? ([opts.hole.x0, opts.hole.x1] as const) : null;
    const clear = (x: number, w: number): boolean => !hole || x + w <= hole[0] || x >= hole[1];
    if (load === 'books') {
      if (s.clear < 0.2 || rnd() < 0.12) {
        // Низкий пролёт (или так легло): книги стопками плашмя.
        let x = s.x0 + rnd() * 0.1;
        while (x < s.x1 - 0.3) {
          if (!clear(x, 0.3)) {
            x = hole![1];
            continue;
          }
          x += flatStack(xf, x, s, rnd, 3 + Math.floor(rnd() * 4), of(SPINES)) + 0.08 + rnd() * 0.15;
        }
      } else spineRow(xf, s, rnd, () => 0.03 + rnd() * 0.05, () => 0.17 + rnd() * 0.13, 0.2 + rnd() * 0.04, of(SPINES), 0.03, back, hole);
    } else if (load === 'binders') {
      if (s.clear < 0.31) {
        // Архивные коробки торцом вперёд.
        let x = s.x0;
        while (x < s.x1 - 0.12) {
          const w = 0.1 + rnd() * 0.04;
          if (rnd() < 0.8 && clear(x, w)) xf.box([x, s.y, s.z1 - 0.34], [x + w, s.y + Math.min(0.26, s.clear - 0.03), s.z1 - 0.01], MAT.cardboard, { tint: [0.95, 0.88, 0.72], skip: back ? ['ny', 'nz'] : ['ny'] });
          x += w + 0.01;
        }
      } else spineRow(xf, s, rnd, () => 0.045 + rnd() * 0.012, () => 0.29 + rnd() * 0.04, 0.29, of(BINDERS), 0.12, back, hole);
    } else if (load === 'papers') {
      spineRow(xf, s, rnd, () => 0.05 + rnd() * 0.07, () => 0.26 + rnd() * 0.1, 0.27, () => {
        const g = 0.7 + rnd() * 0.3;
        return [MAT.paper, [g, g * (0.85 + rnd() * 0.15), g * 0.8]] as const;
      }, 0.1, back, hole);
    } else {
      let x = s.x0 + 0.02;
      while (x < s.x1 - 0.18) {
        const bw = Math.min(0.2 + rnd() * 0.25, s.x1 - x);
        if (rnd() < 0.72 && clear(x, bw)) {
          const bh = Math.min(0.12 + rnd() * 0.22, s.clear - 0.03);
          const bd = Math.min(0.25 + rnd() * 0.12, s.z1 - s.z0);
          const g = 0.7 + rnd() * 0.3;
          xf.box([x, s.y, s.z1 - bd], [x + bw, s.y + bh, s.z1], rnd() < 0.6 ? MAT.wood : MAT.canvas, { bevel: 0.008, tint: [g, g, g] });
        }
        x += bw + 0.03 + rnd() * 0.05;
      }
    }
  });
}
