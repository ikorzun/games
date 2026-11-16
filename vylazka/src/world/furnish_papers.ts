/**
 * Бумага и чемоданы поверх обычной обстановки (слова партнёра: «Используй для локаций… решай сам что
 * переделать в 3д, а что оставить плоским на стене или в рамке или на потолке»).
 *
 * Что куда — решение основной модели:
 *   — убежище: в жилой комнате вросшего дома — стена лиц, в прихожей — три портрета в рамах, над
 *     кроватью — лица на потолке (их видит тот, кто лежит), в архиве — деньги, которые ничего не стоят,
 *     в кладовой — штабель чемоданов (сюда приходили с вещами); у входа — домофон, похожий на лицо;
 *   — офис: в кабинете — акции в рамах, в картотеке — щит с купюрами, в переговорной — городские деньги
 *     в раме: всё, что здесь висит, — бывшие ценности;
 *   — жёлтые комнаты: один-единственный портрет на весь уровень — та же женщина, что в раме в убежище;
 *   — зал ожидания: в кладовой — стена чемоданов до потолка (чужие вещи, за которыми не вернулись), в
 *     зале — карта страны, которой больше нет: туда билет и не выписать. Больше ничего: вещей в зале
 *     почти нет, и так должно остаться (docs/vylazka/station.md).
 *
 * Без повторов (слова партнёра: «чтобы не видно было стыков и дублирования паттернов»): один и тот же
 * лист в одном мире целиком дважды не висит. Лица в рамах — намеренная рифма: большой портрет — из
 * толпы на стене, две маленькие карточки — с листа над кроватью (если спальня на уровне есть); их узнаёшь.
 *
 * Делается в два приёма. Щиту нужна голая стена, а после обычной обстановки свободных участков почти
 * не остаётся, поэтому участок под лист резервируется заранее — до мебели (reservePapers). Сами предметы
 * строятся последним проходом (furnishPapers): их объекты получают номера после всех прежних, и то, какие
 * вещи уровня стёрты на каком круге, от новых предметов не меняется. Сид у них свой — от сида уровня и
 * номера помещения; общий ГСЧ помещения не тратится.
 */
import { hash01 } from '../core/rng';
import type { RoomType, WorldKind } from '../gen/layout';
import type { RoomCtx, Slot } from './furnish';
import { ALL_PROPS } from './props_all';

interface Rule {
  types: readonly RoomType[];
  prop: string;
  /** Сколько таких на уровень. */
  max: number;
  /** wall — на участок стены; bed — под потолок над приметой помещения (кроватью). */
  mode: 'wall' | 'bed';
  /** Участок стены резервируется до обстановки помещения: предмету нужна голая стена. */
  reserve?: boolean;
}

const RULES: Record<WorldKind, readonly Rule[]> = {
  shelter: [
    { types: ['living'], prop: 'faces_wall', max: 1, mode: 'wall', reserve: true },
    { types: ['hallway'], prop: 'frames_faces', max: 1, mode: 'wall', reserve: true },
    { types: ['bedroom'], prop: 'ceil_faces', max: 1, mode: 'bed' },
    { types: ['archive'], prop: 'money_wall', max: 1, mode: 'wall', reserve: true },
    { types: ['storage'], prop: 'st_luggage_stack', max: 1, mode: 'wall' },
    // Своя обманка убежища: домофон, похожий на лицо, — в прихожей дома (props_found.ts). Не у входа в
    // убежище: там он висел в шаге от точки появления и рядом с карточкой «please use only when necessary».
    { types: ['hallway'], prop: 'intercom_face', max: 1, mode: 'wall' },
  ],
  office: [
    { types: ['manager'], prop: 'frames_bonds', max: 1, mode: 'wall', reserve: true },
    { types: ['files'], prop: 'money_board', max: 1, mode: 'wall', reserve: true },
    { types: ['meeting'], prop: 'notgeld_frame', max: 1, mode: 'wall', reserve: true },
  ],
  yellow: [{ types: ['hall', 'department', 'cubicles', 'meeting', 'manager', 'reception'], prop: 'frame_face_big', max: 1, mode: 'wall' }],
  station: [
    { types: ['storage'], prop: 'st_luggage_wall', max: 1, mode: 'wall', reserve: true },
    { types: ['concourse'], prop: 'map_board', max: 1, mode: 'wall', reserve: true },
  ],
};

/** Сколько предметов каждого правила ещё можно поставить на уровне. Одно на уровень, общее для всех помещений. */
export interface PaperState {
  world: WorldKind;
  left: number[];
}

export function newPaperState(world: WorldKind): PaperState {
  return { world, left: RULES[world].map((r) => r.max) };
}

/** Участок, отведённый под предмет до обстановки помещения. */
export interface PaperHold {
  rule: number;
  slot: Slot;
}

type Box = { min: readonly [number, number, number]; max: readonly [number, number, number] };

/** Габариты предмета на участке стены, в мире. */
function boxAt(s: Slot, w: number, d: number, h: number, y: number): Box {
  const a = s.xf.pt(-w / 2, y, 0);
  const b = s.xf.pt(w / 2, y + h, d);
  return { min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])], max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])] };
}

const overlaps = (a: Box, b: Box, pad = 0.02): boolean => a.min[0] < b.max[0] - pad && a.max[0] > b.min[0] + pad && a.min[1] < b.max[1] - pad && a.max[1] > b.min[1] + pad && a.min[2] < b.max[2] - pad && a.max[2] > b.min[2] + pad;

/** Торцевая стена клетки: у клетки ровно одна сторона без стены (дверь или проход), и участок — напротив неё. */
function farEnd(ctx: RoomCtx, s: Slot): boolean {
  const dirs = new Set(ctx.slots.filter((k) => k.cx === s.cx && k.cz === s.cz).map((k) => k.dir));
  const open = [0, 1, 2, 3].filter((d) => !dirs.has(d));
  return open.length === 1 && s.dir === (open[0]! + 2) % 4;
}

/** Свободные участки, куда предмет встаёт: глубокому — туда, где рядом нет двери, или к торцевой стене. */
function candidates(ctx: RoomCtx, name: string, salt: number): Slot[] {
  const p = ALL_PROPS[name];
  if (!p) return [];
  // Участок выбирается сидом уровня и помещения, а не общим ГСЧ.
  const rank = (s: Slot): number => hash01(s.cx * 131 + s.cz * 17 + s.dir, ctx.room.id * 7 + salt, ctx.seed ^ 0x9a9e);
  return ctx.slots.filter((s) => !s.used && !s.hazard && (p.d <= 0.6 || s.deep || farEnd(ctx, s))).sort((a, b) => rank(a) - rank(b));
}

const seedOf = (ctx: RoomCtx, salt: number): number => Math.floor(hash01(ctx.room.id, salt, ctx.seed ^ 0x51ce) * 1e6);

function build(ctx: RoomCtx, name: string, s: Slot, salt: number): void {
  const p = ALL_PROPS[name]!;
  p.build(s.xf.child(0, p.mount === 'wall' ? (p.y ?? 1.2) : 0, 0), seedOf(ctx, salt));
}

/**
 * До обстановки помещения: отвести участки стен под предметы, которым нужна голая стена. Глубокому
 * предмету — торцевая стена, если она есть (напротив двери он не мешает проходу). Мебель потом встанет
 * на остальные участки. Помещению без общего счёта (вариант комнаты) ничего не отводится.
 */
export function reservePapers(ctx: RoomCtx): void {
  const state = ctx.paperState;
  if (!state) return;
  RULES[state.world].forEach((rule, k) => {
    if (!rule.reserve || rule.mode !== 'wall' || state.left[k]! <= 0 || !rule.types.includes(ctx.room.type)) return;
    const list = candidates(ctx, rule.prop, k);
    const s = list.find((c) => farEnd(ctx, c)) ?? list[0];
    if (!s) return;
    s.used = true;
    state.left[k]! -= 1;
    (ctx.papers ??= []).push({ rule: k, slot: s });
  });
}

/** Поставить предмет на участок стены, оставшийся свободным после обстановки, где он ни во что не упирается. */
function onWall(ctx: RoomCtx, name: string, salt: number): boolean {
  const p = ALL_PROPS[name];
  if (!p) return false;
  const y = p.mount === 'wall' ? (p.y ?? 1.2) : 0;
  const taken = ctx.cells[0]?.xf.mb.log?.list ?? [];
  const s = candidates(ctx, name, salt).find((c) => {
    const box = boxAt(c, p.w, p.d, p.h, y);
    return !taken.some((o) => overlaps(box, o));
  });
  if (s) {
    s.used = true;
    build(ctx, name, s, salt);
    return true;
  }
  // Маленькой вещи на стене (домофон) хватает места сбоку от того, что там уже висит или стоит: у входа
  // голых стен обычно не остаётся. Мимо предметов и мимо листов на стене (табличек, карточки от руки).
  if (p.mount !== 'wall' || p.w > 0.45) return false;
  const rank = (k: Slot): number => hash01(k.cx * 131 + k.cz * 17 + k.dir, ctx.room.id * 7 + salt, ctx.seed ^ 0x9a9f);
  const sheets = ctx.cells.flatMap((c) => c.xf.mb.sheets);
  for (const k of ctx.slots.filter((q) => !q.hazard).sort((a, b) => rank(a) - rank(b))) {
    for (const x of [-1.0, 1.0, -0.55, 0.55]) {
      const at = k.xf.child(x, 0, 0);
      const box = boxAt({ ...k, xf: at }, p.w + 0.1, p.d + 0.05, p.h + 0.1, y - 0.05);
      if (taken.some((o) => overlaps(box, o, 0))) continue;
      const mid = at.pt(0, y + p.h / 2, 0);
      if (sheets.some((m) => Math.hypot(m.at[0] - mid[0], m.at[1] - mid[1], m.at[2] - mid[2]) < 0.5)) continue;
      p.build(at.child(0, y, 0), seedOf(ctx, salt));
      return true;
    }
  }
  return false;
}

/** Повесить под потолок над приметой помещения — кроватью. Под открытым небом потолка нет. */
function overBed(ctx: RoomCtx, name: string, salt: number): boolean {
  const p = ALL_PROPS[name];
  const c = ctx.cells[0];
  if (!p || !c || ctx.sky) return false;
  const mark = ctx.landmarks.find((l) => l.room === ctx.room.id && l.tier === ctx.room.tier);
  // Клетки помещений стоят без поворота; примета задана в мире — сдвиг считается от середины клетки.
  const dx = mark && c.xf.rot === 0 ? mark.x - c.xf.ox : 0;
  const dz = mark && c.xf.rot === 0 ? mark.z - c.xf.oz : 0;
  // Предмет реестра лежит от z = 0 до z = d: сдвиг на полглубины ставит его середину над приметой.
  p.build(c.xf.child(dx, ctx.h, dz - p.d / 2), seedOf(ctx, salt));
  return true;
}

/**
 * Последний проход: построить предметы на отведённых участках и расставить остальное — туда, где после
 * обстановки осталось место. rooms — обставленные помещения в порядке уровня. Возвращает, сколько чего
 * поставлено (имя предмета → число).
 */
export function furnishPapers(state: PaperState, rooms: readonly { ctx: RoomCtx }[]): Record<string, number> {
  const placed: Record<string, number> = {};
  const count = (name: string): void => {
    placed[name] = (placed[name] ?? 0) + 1;
  };
  const rules = RULES[state.world];
  for (const { ctx } of rooms) {
    for (const h of ctx.papers ?? []) {
      const rule = rules[h.rule]!;
      build(ctx, rule.prop, h.slot, h.rule);
      count(rule.prop);
    }
  }
  rules.forEach((rule, k) => {
    if (rule.reserve) return;
    for (const { ctx } of rooms) {
      if (state.left[k]! <= 0) break;
      if (!rule.types.includes(ctx.room.type)) continue;
      if (rule.mode === 'wall' ? onWall(ctx, rule.prop, k) : overBed(ctx, rule.prop, k)) {
        state.left[k]! -= 1;
        count(rule.prop);
      }
    }
  });
  return placed;
}
