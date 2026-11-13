/**
 * Обжитость и запустение: после основной обстановки помещение дозаполняется тем, что осталось
 * от людей и от времени. Свободные участки стен получают предметы по роду помещения, стены —
 * трафареты, таблички и плакаты, потолок — провисшие кабели и натёки, пол — бумаги и мусор.
 * Чем глубже ярус, тем больше хлама и тем чаще надписи от руки.
 *
 * Предметы берутся из реестра PROPS по именам; незнакомое имя просто пропускается.
 */
import type { Vec3 } from '../core/types';
import type { RoomType } from '../gen/layout';
import type { RoomCtx, Slot } from './furnish';
import { MAT } from './materials';
import { poster } from './props_bunker';
import { PROPS } from './props_more';
import { BRUSH } from './signs';

type Weighted = readonly (readonly [string, number])[];

/** Что ставят на пол у свободной стены. */
const FLOOR: Partial<Record<RoomType, Weighted>> = {
  corridor: [['debris_heap', 3], ['bottles', 2], ['canisters', 1], ['boots_helmet', 2], ['gasmask_pile', 2], ['board_stack', 2], ['brick_pile', 1], ['ladder_lean', 1], ['stretcher', 1], ['water_drum', 1], ['barrel_stack', 1], ['kerosene_lamp', 1], ['fire_shield', 2], ['coat_hooks', 1]],
  dorm: [['bunk_triple', 4], ['bed_frame', 3], ['coat_hooks', 3], ['gasmask_crate', 2], ['canteen_set', 2], ['boots_helmet', 2], ['overturned_table', 1], ['water_drum', 2], ['kerosene_lamp', 2], ['gasmask_pile', 1]],
  command: [['typewriter_desk', 3], ['field_phone', 3], ['dosimeter_case', 2], ['canteen_set', 1], ['coat_hooks', 1], ['overturned_table', 1], ['kerosene_lamp', 1]],
  medical: [['med_stretcher_bed', 4], ['stretcher', 3], ['washstand', 2], ['bottles', 2], ['water_drum', 1]],
  storage: [['gasmask_crate', 4], ['mesh_partition', 2], ['barrel_stack', 2], ['canisters', 2], ['brick_pile', 1], ['board_stack', 2], ['debris_heap', 2], ['ladder_lean', 1], ['gasmask_pile', 2]],
  washroom: [['squat_toilet', 4], ['shower_stub', 3], ['washstand', 3], ['hand_pump', 1], ['bottles', 1]],
  fvu: [['filter_stack', 4], ['hand_fan', 3], ['hermo_valve', 3], ['blast_valve', 2], ['u_gauge', 2], ['air_cylinders', 2]],
  diesel: [['battery_rack', 3], ['air_cylinders', 3], ['canisters', 3], ['oil_tray', 2], ['barrel_stack', 2], ['fire_shield', 3], ['knife_switch', 2]],
  tanks: [['hand_pump', 3], ['water_drum', 2], ['ladder_lean', 2], ['u_gauge', 2], ['canisters', 1]],
  switchboard: [['transformer', 3], ['knife_switch', 4], ['fuse_board', 4], ['battery_rack', 2], ['fire_shield', 1]],
  archive: [['typewriter_desk', 2], ['debris_heap', 2], ['overturned_table', 2], ['board_stack', 1], ['kerosene_lamp', 1]],
  airlock: [['coat_hooks', 3], ['fire_shield', 2], ['boots_helmet', 2], ['gasmask_pile', 1]],
  entrance: [['coat_hooks', 2], ['fire_shield', 2], ['boots_helmet', 1]],
  collapsed: [['debris_heap', 4], ['brick_pile', 2], ['board_stack', 2]],
};

/** Что висит на свободной стене на уровне глаз: трафарет, табличка или плакат. */
const SIGNS: Partial<Record<RoomType, Weighted>> = {
  corridor: [['poster', 4], ['no_smoking', 2], ['quiet', 1], ['pl_shelter', 1], ['pl_fire', 2], ['exit', 1], ['save_water', 1], ['scheme', 1], ['pl_rules', 1]],
  dorm: [['poster', 3], ['pl_rules', 3], ['quiet', 2], ['no_smoking', 2], ['calendar', 1]],
  command: [['scheme', 3], ['calendar', 2], ['clock', 2], ['post1', 2], ['poster', 1]],
  medical: [['sym_cross', 3], ['poster', 2], ['pl_drink', 1]],
  storage: [['no_smoking', 2], ['pl_fire', 2], ['pl_fireext', 1]],
  washroom: [['save_water', 3], ['pl_drink', 1]],
  fvu: [['pl_modes', 4], ['air', 2], ['no_smoking', 1], ['pl_gas', 1]],
  diesel: [['fuel', 2], ['pl_fireext', 2], ['no_smoking', 3], ['sym_bolt', 2], ['pl_voltage', 1]],
  tanks: [['pl_drink', 3], ['water', 3], ['save_water', 2]],
  switchboard: [['pl_voltage', 4], ['pl_nopower', 3], ['sym_bolt', 3]],
  archive: [['no_smoking', 2], ['pl_fire', 2], ['calendar', 1]],
  airlock: [['attention', 2], ['pl_shelter', 3], ['poster', 2], ['sym_rad', 1]],
  entrance: [['pl_shelter', 3], ['exit', 3], ['poster', 1]],
};

/** Что свисает с потолка посреди клетки. */
const CEILING: Weighted = [['hanging_cables', 4], ['broken_lamp', 2], ['stalactites', 3]];
/** Что идёт под потолком вдоль стены. */
const ALONG: Partial<Record<RoomType, Weighted>> = {
  corridor: [['duct_run', 3], ['cable_tray', 3]],
  fvu: [['duct_run', 5]],
  diesel: [['cable_tray', 2], ['duct_run', 2]],
  switchboard: [['cable_tray', 5]],
  dorm: [['duct_run', 1]],
  storage: [['cable_tray', 1]],
};

/** Таблицы выбора — наружу для теста: каждое имя должно существовать. */
export const DRESS_TABLES = { FLOOR, SIGNS, CEILING, ALONG } as const;

const RED: Vec3 = [0.6, 0.11, 0.08];
const BLACK: Vec3 = [0.09, 0.09, 0.09];
const CHALK: Vec3 = [0.85, 0.84, 0.8];

function pick(list: Weighted, r: number): string {
  let total = 0;
  for (const [, w] of list) total += w;
  let t = r * total;
  for (const [name, w] of list) {
    t -= w;
    if (t <= 0) return name;
  }
  return list[list.length - 1]![0];
}

/** Сдвиг предмета шириной w вдоль слота так, чтобы он не упёрся в угол, с небольшим разбросом. */
function along(s: Slot, w: number, depth: number, r: number): number {
  const lo = -1.35 + (s.cornerL ? depth + 0.05 : 0) + w / 2;
  const hi = 1.35 - (s.cornerR ? depth + 0.05 : 0) - w / 2;
  if (lo > hi) return 0;
  return lo + (hi - lo) * r;
}

export function dressRoom(ctx: RoomCtx): void {
  const type = ctx.room.type;
  const tier = ctx.room.tier;
  // Шахта лестницы остаётся голой: на её стенах не должно быть ничего, что выдаст высоту.
  if (type === 'stairwell') return;
  const rnd = ctx.rng;
  const corridor = type === 'corridor';
  const floorList = FLOOR[type];
  const signList = SIGNS[type];
  const alongList = ALONG[type];
  const dark = tier === 2;

  for (const s of ctx.slots) {
    const seed = Math.floor(rnd() * 1e6);
    const rPlace = rnd();
    const rPick = rnd();
    const rX = rnd();
    const rSign = rnd();
    const rSignPick = rnd();
    const rAlong = rnd();
    let wallTaken = s.used;

    // 1. Свободная стена: предмет на пол или на стену. Выбираем только из того, что сюда влезает:
    // в комнате у глухой стены можно поставить и глубокое, в коридоре — лишь то, что не мешает пройти.
    if (!s.used && !s.hazard && floorList && rPlace < (corridor ? 0.36 + 0.1 * tier : 0.75)) {
      const maxDepth = s.deep ? 1.25 : 0.6;
      // Рядом с приметой, которую игроку предстоит снять на камеру, — только низкое: высокий предмет
      // у соседней стены мог бы заслонить её со всех точек, откуда она видна.
      const o = s.xf.pt(0, 0, 0);
      const nearMark = ctx.landmarks.some((m) => m.room === ctx.room.id && Math.hypot(m.x - o[0], m.z - o[2]) < 3.2);
      const fitting = floorList.filter(([name]) => {
        const p = PROPS[name];
        return p !== undefined && p.mount !== 'ceiling' && p.w <= 2.6 && (p.mount === 'wall' || p.d <= maxDepth) && (!nearMark || p.mount === 'wall' || p.h <= 1.0);
      });
      if (fitting.length > 0) {
        const p = PROPS[pick(fitting, rPick)]!;
        const x = along(s, p.w, p.d, corridor ? rX : 0.5 + (rX - 0.5) * 0.3);
        // Отдельно стоящий предмет описан от своего центра: придвигаем его спиной к стене.
        p.build(s.xf.child(x, p.mount === 'wall' ? (p.y ?? 1.2) : 0, p.mount === 'free' ? p.d / 2 + 0.03 : 0), seed);
        s.used = true;
        // Низкое или узкое оставляет стену над собой свободной для надписи.
        wallTaken = p.mount === 'wall' || p.h > 1.3;
      }
    }

    // 2. Надпись: на свободной стене — на уровне глаз, над мебелью — маленькая под потолком.
    if (signList && rSign < (wallTaken ? 0.22 : 0.5)) {
      const id = pick(signList, rSignPick);
      const x = (rX - 0.5) * (wallTaken ? 1.6 : 1.2);
      if (id === 'poster') {
        if (!wallTaken) poster(s.xf.child(x, 1.72, 0), 0.62, 0.82, seed);
      } else {
        const stencilInk = type === 'storage' || type === 'collapsed' || dark ? CHALK : seed % 3 === 0 ? BLACK : RED;
        const printed = id.startsWith('pl_') || id.startsWith('sym_') || id === 'scheme' || id === 'calendar' || id === 'clock';
        s.xf.sign(id, x, wallTaken ? 2.24 : printed ? 1.55 : 1.6, wallTaken ? 0.36 : undefined, printed ? [1, 1, 1] : stencilInk);
      }
    } else if (!wallTaken && tier > 0 && rSign > 1 - 0.07 * tier * (corridor ? 1.6 : 1)) {
      // Внизу на стенах появляются надписи тех, кто был здесь после.
      const id = rSignPick < 0.2 ? 'tally' : BRUSH[Math.floor(rSignPick * BRUSH.length) % BRUSH.length]!;
      s.xf.sign(id, (rX - 0.5) * 0.8, 1.2 + rPick * 0.5, undefined, rSignPick < 0.5 ? [0.5, 0.07, 0.05] : CHALK);
    }

    // 3. Под потолком вдоль стены: воздуховод или кабельный лоток (не над провалами — там и так тесно).
    if (alongList && !s.hazard && rAlong < (corridor ? 0.16 : 0.3)) {
      const p = PROPS[pick(alongList, rnd())];
      // Свисающий конец кабеля тонкий и не мешает пройти; сам короб должен остаться выше головы.
      if (p && p.mount === 'ceiling' && p.h <= 1.0) p.build(s.xf.child(0, ctx.h, 0), seed);
    }
  }

  // 4. Балки: в прямом коридоре через каждую клетку поперёк идёт ригель — потолок давит ниже.
  if (corridor) {
    const byCell = new Map<string, Slot[]>();
    for (const s of ctx.slots) {
      const k = `${s.cx},${s.cz}`;
      const list = byCell.get(k);
      if (list) list.push(s);
      else byCell.set(k, [s]);
    }
    for (const list of byCell.values()) {
      // Ровно две стены друг напротив друга — прямой участок.
      if (list.length !== 2 || (list[0]!.dir + 2) % 4 !== list[1]!.dir) continue;
      const s = list[0]!.dir < list[1]!.dir ? list[0]! : list[1]!;
      const tone = 0.62 - 0.08 * tier;
      s.xf.box([-1.33, ctx.h - 0.24, -0.02], [-1.07, ctx.h + 0.01, 2.72], MAT.concrete, { tint: [tone, tone, tone * 0.97], bevel: 0.02 });
    }
  }

  // 5. Посреди клетки: с потолка свисает, на полу лежит. Ничто из этого не мешает пройти.
  for (const c of ctx.cells) {
    const seed = Math.floor(rnd() * 1e6);
    const r = rnd();
    const rp = rnd();
    const ox = (rnd() - 0.5) * 1.5;
    const oz = (rnd() - 0.5) * 1.5;
    if (r < 0.1 + 0.09 * tier) {
      const p = PROPS[pick(CEILING, rp)];
      // Сдвиг от центра: там может висеть лампа.
      // В стороне от середины клетки: там ходят, и там может висеть лампа.
      if (p && p.mount === 'ceiling') p.build(c.xf.child(ox > 0 ? 0.95 : -0.95, ctx.h, oz * 0.5 - p.d / 2, ox > 0 ? 1 : 3), seed);
    }
    const papers = PROPS.papers;
    if (papers && papers.mount === 'free' && (type === 'archive' || type === 'command' ? r > 0.45 : r > 0.93 - 0.03 * tier)) papers.build(c.xf.child(ox * 0.5, 0, oz * 0.5), seed);
  }
}
