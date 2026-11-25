/**
 * Оранжерея внутри места (партнёр 19.11, 18:04: «нужна комната полностью с цветами, словно оранжерея или теплица»; квиз: «Теплица
 * внутри места (советую)»). Одно помещение уровня обставляется не мебелью, а цветами (world/level_build.ts, greenRoom):
 *  - убежище — подземная теплица: грядки гвоздик, хризантем и калл вдоль стен, над ними натриевые лампы оранжевого света;
 *    посередине — стол с рассадой и роза в рост человека (одна ботаническая ошибка на оранжерею — исследование, раздел «Главные
 *    выводы»: красота тревожит, когда в ней одна неправильная вещь);
 *  - офис — зимний сад: грядки зелени с геранью и фиалками, стеллажи с горшками, монстера в кадке, стол с рассадой;
 *  - зал ожидания — клумбы на перроне, вдоль стены вокзала между скамьями: тюльпаны и гвоздики, как продавали у поездов.
 *    Перрон при этом остаётся перроном (edge): скамьи, урны, указатели — как были, край у путей свободен.
 * Жёлтых комнат это не касается: они пусты нарочно.
 *
 * Вдоль стены — грядка, где хватает места и нет двери рядом (участок глубокий): длинная, 2,4 м, а у угла, где она не встаёт, —
 * короткая, 1,5 м; иначе стеллаж; не влезает и он — кадка или ничего. Посередине — только в клетках без прохода: проход вдоль помещения свободен. Над грядками, где есть потолок, —
 * подвесные ящики с традесканцией. Головки цветов — вещь рендера (systems/flowers.ts), сюда не попадают.
 */
import type { WorldKind } from '../gen/layout';
import type { CellInfo, RoomCtx, Slot } from './furnish';
import { floorSpots, landmark } from './furnish';
import { panels } from './furnish_office';
import { hanging } from './objects';
import { ALL_PROPS } from './props_all';
import type { Xf } from './props';
import type { Aabb } from './colliders';

/** Что ставить в оранжерее этого места. */
interface GreenPlan {
  bed: string;
  /** Клумба посреди пола — в клетках без прохода, где не встало ничего другого. */
  patch: string;
  table: string;
  /** Что посередине кроме стола, по очереди: роза, парник, кадка. */
  centre: readonly string[];
  /** Лампы над грядками — только под землёй. */
  lamps: boolean;
  /** У части стен вместо грядки — стеллаж (зимний сад). */
  racks: number;
  /** Не вся комната, а кромка: столько грядок вдоль свободных стен поверх обычной обстановки (зал ожидания). */
  edge?: number;
}

export const GREEN_PLAN: Readonly<Partial<Record<WorldKind, GreenPlan>>> = {
  shelter: { bed: 'gh_bed_mourn', patch: 'gh_patch_mourn', table: 'gh_table_mourn', centre: ['s3_rose_tall', 'gh_tub_monstera'], lamps: true, racks: 0.2 },
  office: { bed: 'gh_bed_green', patch: 'gh_patch_green', table: 'gh_table_green', centre: ['gh_tub_monstera', 's3_pergola'], lamps: false, racks: 0.25 },
  station: { bed: 'gh_bed_spring', patch: 'gh_patch_spring', table: 'gh_table_mourn', centre: [], lamps: false, racks: 0, edge: 6 },
};

/** Помещается ли вещь шириной w вдоль участка с углами (соседняя стена занята грядкой глубиной до 0,62 м). */
function fits(s: Slot, w: number): number | null {
  const lo = -1.35 + (s.cornerL ? 0.67 : 0) + w / 2;
  const hi = 1.35 - (s.cornerR ? 0.67 : 0) - w / 2;
  if (lo > hi) return null;
  return Math.max(lo, Math.min(hi, 0));
}

const seedOf = (ctx: RoomCtx): number => Math.floor(ctx.rng() * 1e6);

/** Поставить вещь реестра: напольную у стены — спиной к ней; свободную — в off от стены; подвесную — под потолок. */
function put(ctx: RoomCtx, name: string, xf: Xf, dx: number, off = 0.1): boolean {
  const p = ALL_PROPS[name];
  if (!p) return false;
  if (p.mount === 'ceiling') {
    if (ctx.sky) return false;
    return hanging(xf, () => p.build(xf.child(dx, ctx.h, off), seedOf(ctx))) !== false;
  }
  const z = p.mount === 'free' ? p.d / 2 + off : 0;
  return p.build(xf.child(dx, p.mount === 'wall' ? (p.y ?? 1.2) : 0, z), seedOf(ctx)) !== false;
}

/**
 * Вещь посреди клетки — там, где она не встаёт на дорожку перед грядками (FRONT в world/clearance.ts): сначала в середине, потом
 * со сдвигом от грядок к свободной стороне. Сдвиги сперва отбираются дёшево — квадратом полуширины half против дорожек и преград
 * (без сборки сетки: клумба — два десятка растений, и перебор сборкой замедлял уровень на две трети), собирается вещь только на
 * тех, где ей есть место. put — поставить со сдвигом (dx, dz), true — встала.
 */
const SHIFTS: readonly (readonly [number, number])[] = [[0, 0], ...[0.3, 0.5, 0.65].flatMap((d) => [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, d], [d, -d], [-d, -d]] as const)];
const SHIFT_TRIES = 4;
function shifted(c: CellInfo, half: number, put: (dx: number, dz: number) => boolean): boolean {
  const col = c.xf.col;
  const near: Aabb[] = [];
  let tries = 0;
  for (const [dx, dz] of SHIFTS) {
    if (col) {
      const [x, , z] = c.xf.pt(dx, 0, dz);
      const box = { minX: x - half, maxX: x + half, minY: 0.05, maxY: 1.2, minZ: z - half, maxZ: z + half };
      const hit = (b: Aabb): boolean => Math.min(box.maxX, b.maxX) - Math.max(box.minX, b.minX) > 0.05 && Math.min(box.maxZ, b.maxZ) - Math.max(box.minZ, b.minZ) > 0.05;
      if (col.keeps.some((k) => hit(k.box))) continue;
      let blocked = false;
      for (const b of col.query(box.minX, box.minZ, box.maxX, box.maxZ, near)) {
        if (b.ghost || b.cut || b.off || b.maxY < c.xf.oy + 0.05 || b.minY > c.xf.oy + 1.2) continue;
        if (hit(b)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
    }
    if (put(dx, dz)) return true;
    if (++tries >= SHIFT_TRIES) return false;
  }
  return false;
}

/** Обставить помещение оранжереей. false — у этого места оранжереи нет (жёлтые комнаты). */
export function furnishGreenhouse(ctx: RoomCtx): boolean {
  const plan = GREEN_PLAN[ctx.world];
  if (!plan) return false;
  // Офис светится только потолочными панелями — по одной на клетку в каждом помещении, и в зимнем саду тоже.
  if (plan.edge === undefined && (ctx.world === 'office' || ctx.world === 'yellow')) panels(ctx);
  // Участки стен — по сиду места, а не по ГСЧ помещения целиком: порядок не зависит от того, сколько чисел ушло раньше.
  const slots = ctx.slots.filter((s) => !s.hazard && !s.used);
  let k = 0;
  let beds = 0;
  /** Грядка на участке: длинная, а не встаёт — короткая. Где встала и какой длины; null — ни одна. */
  const bedOn = (s: Slot): { at: number; w: number } | null => {
    if (!s.deep) return null;
    for (const [name, w] of [[plan.bed, 2.4], [`${plan.bed}_s`, 1.5]] as const) {
      const at = fits(s, w);
      if (at !== null && put(ctx, name, s.xf, at)) return { at, w };
    }
    return null;
  };
  for (const s of slots) {
    if (plan.edge !== undefined) {
      // Кромка зала: только грядки, только на глубоких участках, не больше edge.
      if (beds >= plan.edge) break;
      if (bedOn(s)) {
        s.used = true;
        beds++;
      }
      continue;
    }
    const wantRack = ctx.rng() < plan.racks;
    const b = wantRack ? null : bedOn(s);
    let placed = false;
    if (b) {
      placed = true;
      // Над грядкой — подвесные ящики, под землёй ещё и лампы.
      if (plan.lamps) put(ctx, 'gh_lamp', s.xf, b.at, 0.06);
      if (k % 2 === 0) put(ctx, 'gh_hanging', s.xf, b.at + (ctx.rng() < 0.5 ? -1 : 1) * (b.w / 2 - 0.45), 0.05);
    } else {
      const rackAt = fits(s, 1.5);
      if (rackAt !== null && put(ctx, 'gh_rack', s.xf, rackAt)) placed = true;
      else if (put(ctx, 'gh_tub_monstera', s.xf, fits(s, 0.6) ?? 0, 0.08)) placed = true;
    }
    if (placed) s.used = true;
    k++;
  }
  // Посередине — только в помещении от трёх клеток и в клетках без прохода (ни двери, ни открытого ребра в соседнее):
  // стол, потом роза, парник или кадка — не больше двух; в маленькой оранжерее середина остаётся проходом.
  const taken = new Set<CellInfo>();
  if (plan.edge === undefined && ctx.cells.length >= 3) {
    const inner = ctx.cells.filter((c) => c.doors === 0).sort((a, b) => a.cx - b.cx || a.cz - b.cz);
    const centre = [plan.table, ...plan.centre];
    let i = 0;
    let stood = 0;
    for (const c of inner) {
      if (stood >= 2) break;
      while (i < centre.length) {
        const p = ALL_PROPS[centre[i++]!];
        if (!p) continue;
        if (shifted(c, 0.36, (dx, dz) => p.build(c.xf.child(dx, 0, dz, (i % 2) as 0 | 1), seedOf(ctx)) !== false)) {
          stood++;
          taken.add(c);
          break;
        }
      }
    }
  }
  // Клумбы посреди пола — во всех остальных клетках без прохода: «комната полностью с цветами», а проход идёт вокруг них и
  // через клетки с дверьми.
  if (plan.edge === undefined) {
    for (const c of ctx.cells) {
      if (c.doors > 0 || taken.has(c)) continue;
      const patch = ALL_PROPS[plan.patch];
      if (patch) shifted(c, 0.66, (dx, dz) => patch.build(c.xf.child(dx, 0, dz), seedOf(ctx)) !== false);
    }
  }
  // Места для вещей — на полу в проходе: вещь воспоминания может лежать и среди цветов (у перрона места — свои, от его обстановки).
  if (plan.edge === undefined) floorSpots(ctx, ctx.cells.length >= 4 ? 3 : 2);
  // Признак места для проверок и отладки: где оранжерея.
  if (ctx.cells[0]) landmark(ctx, 'greenhouse', ctx.cells[0].xf, 0, 1.0, 0);
  return true;
}
