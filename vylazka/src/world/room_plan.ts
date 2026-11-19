/**
 * Разметка помещения для расстановки (партнёр 19.11, 14:33: «вернись к расстановке мебели и расставь её по-новому и логично,
 * с учётом лучших практик создания игровых уровней»). Что раскладка знает о комнате, кроме участков стен: где проходы, через
 * какой из них в комнату входят первым (главный вход — ближайший к началу сна по ходу, а не по прямой), какая стена смотрит на
 * вход, какая стоит боком, и какой участок — в створе входа: его видно с порога первым. Правила раскладки
 * (docs/vylazka/design.md, §31):
 *   - назначение комнаты читается с порога: главная вещь — напротив входа, лучше в створе;
 *   - перед проходами и между ними пусто, комната не режется мебелью на части (world/flow.ts);
 *   - вещи стоят группами по делу: диван лицом к телевизору, тумбочка у изголовья, плита рядом с мойкой.
 */
import { DX, DZ } from '../gen/layout';
import type { RoomCtx, Slot } from './furnish';
import { CELL, DOOR_W, WALL_T } from './shell';

/** Внутренняя грань стены от середины клетки, м. */
export const FACE = CELL / 2 - WALL_T / 2;

/** Что на стороне клетки: глухая стена, дверь, открытое ребро в соседнее помещение, своя же клетка. */
export type Side = 'wall' | 'door' | 'open' | 'inner';

/** Проход помещения. */
export interface Door {
  cx: number;
  cz: number;
  /** Сторона клетки: 0 — +x, 1 — +z, 2 — −x, 3 — −z. */
  dir: number;
  kind: 'door' | 'open';
  /** Середина проёма на внутренней грани стены (мир). */
  x: number;
  z: number;
  /** Ширина проёма, м: дверь — 1,1; открытое ребро — во всю клетку. */
  w: number;
  /** Сколько клеток от начала сна до клетки за проёмом (Infinity — неизвестно). */
  dist: number;
}

/** Роль участка стены относительно входа: напротив, сбоку, на стене входа. */
export type Role = 'far' | 'side' | 'near';

export interface RoomPlan {
  doors: Door[];
  /** Главный вход: ближний к началу сна проход; null — проходов нет. */
  entry: Door | null;
  role(s: Slot): Role;
  /** Участок напротив входа, в его створе: первое, что видно с порога. */
  framed(s: Slot): boolean;
  /** От середины участка до середины входа, м (входа нет — 0). */
  toEntry(s: Slot): number;
  /** Участок на стене напротив, смотрящий на этот (ближайший через комнату). */
  opposite(s: Slot): Slot | undefined;
  /** Соседний участок той же стены: сторона −1 — к локальному −x слота, +1 — к +x. */
  beside(s: Slot, side: -1 | 1): Slot | undefined;
}

/** Плоскость стены участка (x — у стен ±x, z — у стен ±z) и координата вдоль неё. */
const plane = (s: { dir: number; xf: { ox: number; oz: number } }): number => (s.dir % 2 === 0 ? s.xf.ox : s.xf.oz);
const along = (s: { dir: number; xf: { ox: number; oz: number } }): number => (s.dir % 2 === 0 ? s.xf.oz : s.xf.ox);

const plans = new WeakMap<RoomCtx, RoomPlan>();

/** Разметка помещения (одна на обстановку). */
export function planOf(ctx: RoomCtx): RoomPlan {
  const had = plans.get(ctx);
  if (had) return had;
  const doors = doorsOf(ctx);
  // В помещении, где начинается сон, вход — ближний к началу проход (выход из него): от него и считаются роли стен — лестница
  // наверх встаёт напротив.
  const entry = doors.slice().sort((a, b) => a.dist - b.dist || a.cx - b.cx || a.cz - b.cz || a.dir - b.dir)[0] ?? null;
  const ePlane = entry ? (entry.dir % 2 === 0 ? entry.x : entry.z) : 0;
  const eAlong = entry ? (entry.dir % 2 === 0 ? entry.z : entry.x) : 0;
  const role = (s: Slot): Role => {
    if (!entry) return 'side';
    if (s.dir === entry.dir && Math.abs(plane(s) - ePlane) < 0.5) return 'near';
    if (s.dir === (entry.dir + 2) % 4) return 'far';
    return 'side';
  };
  const plan: RoomPlan = {
    doors,
    entry,
    role,
    framed: (s) => entry !== null && role(s) === 'far' && Math.abs(along(s) - eAlong) <= CELL / 2 - 0.01,
    toEntry: (s) => (entry ? Math.hypot(s.xf.ox - entry.x, s.xf.oz - entry.z) : 0),
    opposite: (s) => {
      const back = (s.dir + 2) % 4;
      // Нормаль участка в комнату — против стороны клетки.
      const nx = -DX[s.dir]!;
      const nz = -DZ[s.dir]!;
      let best: Slot | undefined;
      let bestD = Infinity;
      for (const t of ctx.slots) {
        if (t.dir !== back || Math.abs(along(t) - along(s)) > 0.5) continue;
        const d = (t.xf.ox - s.xf.ox) * nx + (t.xf.oz - s.xf.oz) * nz;
        if (d > 0.5 && d < bestD) {
          bestD = d;
          best = t;
        }
      }
      return best;
    },
    beside: (s, side) => {
      const ax = s.xf.pt(1, 0, 0);
      const ux = ax[0] - s.xf.ox;
      const uz = ax[2] - s.xf.oz;
      return ctx.slots.find((t) => t !== s && t.dir === s.dir && Math.abs(plane(t) - plane(s)) < 0.5 && Math.abs((t.xf.ox - s.xf.ox) * ux + (t.xf.oz - s.xf.oz) * uz - side * CELL) < 0.5);
    },
  };
  plans.set(ctx, plan);
  return plan;
}

/** Проходы помещения по сторонам клеток (CellInfo.sides). */
export function doorsOf(ctx: RoomCtx): Door[] {
  const out: Door[] = [];
  for (const c of ctx.cells) {
    const sides = c.sides;
    if (!sides) continue;
    for (let d = 0; d < 4; d++) {
      const k = sides[d];
      if (k !== 'door' && k !== 'open') continue;
      out.push({
        cx: c.cx,
        cz: c.cz,
        dir: d,
        kind: k,
        x: c.xf.ox + DX[d]! * FACE,
        z: c.xf.oz + DZ[d]! * FACE,
        w: k === 'door' ? DOOR_W : CELL - WALL_T,
        dist: ctx.dist?.(c.cx + DX[d]!, c.cz + DZ[d]!) ?? Infinity,
      });
    }
  }
  return out;
}
