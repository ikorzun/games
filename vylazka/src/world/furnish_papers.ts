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
 * Больной сон (партнёр 19.11: «нужно больше странных и жутких изображений на стенах или обрывки бумаг на полу, все связать
 * историей больного сна и тревоги»; история — design.md, §34): снимки на кнопке по стенам и обрывки на полу, во всех местах —
 * убежище до пяти снимков и трёх обрывков, офис до четырёх и трёх, жёлтые комнаты два и один (они пусты нарочно), зал ожидания
 * один снимок и без обрывков (вещей там почти нет; снимка билета там нет — билет там ищут). Каждый снимок и обрывок — на
 * уровне не больше раза: колода тасуется сидом уровня, порядок помещений тоже, чтобы
 * всё не досталось первым помещениям от входа. Обрывок ложится только туда, где на полу ничего не стоит.
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
import type { Aabb } from './colliders';
import type { RoomCtx, Slot } from './furnish';
import { hanging } from './objects';
import { DREAM_PRINTS, DREAM_SCRAPS } from './papers';
import { ALL_PROPS } from './props_all';
import type { PropSpec } from './props_more';

interface Rule {
  types: readonly RoomType[];
  /** Предмет реестра; у правила с колодой — только имя для счёта, сам предмет берётся из колоды. */
  prop: string;
  /** Сколько таких на уровень. */
  max: number;
  /** wall — на участок стены; bed — под потолок над приметой помещения (кроватью); floor — на пол у свободной стены. */
  mode: 'wall' | 'bed' | 'floor';
  /** Колода: снимки больного сна или обрывки — каждый на уровне не больше одного раза (без повторов). */
  deck?: 'dream' | 'scrap';
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
    { types: ['medical', 'bedroom', 'living', 'kitchen', 'hallway', 'dorm', 'command', 'corridor', 'nursery'], prop: 'dream_print', max: 5, mode: 'wall', deck: 'dream' },
    { types: ['corridor', 'hallway', 'living', 'bedroom', 'dorm', 'medical', 'kitchen', 'archive'], prop: 'dream_scrap', max: 3, mode: 'floor', deck: 'scrap' },
  ],
  office: [
    { types: ['manager'], prop: 'frames_bonds', max: 1, mode: 'wall', reserve: true },
    { types: ['files'], prop: 'money_board', max: 1, mode: 'wall', reserve: true },
    { types: ['meeting'], prop: 'notgeld_frame', max: 1, mode: 'wall', reserve: true },
    { types: ['cubicles', 'department', 'breakroom', 'manager', 'files', 'meeting', 'reception', 'copyroom', 'corridor'], prop: 'dream_print', max: 4, mode: 'wall', deck: 'dream' },
    { types: ['corridor', 'cubicles', 'department', 'breakroom', 'files', 'copyroom'], prop: 'dream_scrap', max: 3, mode: 'floor', deck: 'scrap' },
  ],
  yellow: [
    { types: ['hall', 'department', 'cubicles', 'meeting', 'manager', 'reception'], prop: 'frame_face_big', max: 1, mode: 'wall' },
    // Жёлтые комнаты пусты нарочно: снимок один-два и обрывок.
    { types: ['hall', 'department', 'cubicles', 'meeting', 'manager', 'reception'], prop: 'dream_print', max: 2, mode: 'wall', deck: 'dream' },
    { types: ['hall', 'department', 'cubicles', 'corridor'], prop: 'dream_scrap', max: 1, mode: 'floor', deck: 'scrap' },
  ],
  station: [
    { types: ['storage'], prop: 'st_luggage_wall', max: 1, mode: 'wall', reserve: true },
    { types: ['concourse'], prop: 'map_board', max: 1, mode: 'wall', reserve: true },
    // Вещей в зале почти нет, и так должно остаться (docs/vylazka/station.md; куратор, пачка 52, противоречие 334): один снимок
    // на уровень — в кассе, у камер хранения, в буфете, в вестибюле или на перроне; обрывков на полу здесь нет.
    { types: ['tickets', 'lockers', 'buffet', 'vestibule', 'platform'], prop: 'dream_print', max: 1, mode: 'wall', deck: 'dream' },
  ],
};

/** Сколько предметов каждого правила ещё можно поставить на уровне. Одно на уровень, общее для всех помещений. */
export interface PaperState {
  world: WorldKind;
  left: number[];
  /** Колоды снимков и обрывков, перемешанные сидом уровня: что сверху — то и встанет следующим. */
  decks: { dream: string[]; scrap: string[] };
}

export function newPaperState(world: WorldKind, seed = 0): PaperState {
  const shuffle = (ids: readonly string[], salt: number): string[] => {
    const key = (id: string): number => hash01(idHash(id), salt, seed);
    return [...ids].sort((a, b) => key(a) - key(b) || (a < b ? -1 : 1));
  };
  // Снимок билета — не в зале ожидания: там билет ищут как вещь памяти, и снимок рядом с ней читался бы подсказкой (334).
  const prints = DREAM_PRINTS.map((d) => d[0]).filter((id) => !(world === 'station' && id === 'dream_ticket'));
  return { world, left: RULES[world].map((r) => r.max), decks: { dream: shuffle(prints, 0x51), scrap: shuffle(DREAM_SCRAPS.map((d) => d[0]), 0x52) } };
}

/** Число из имени (FNV-1a): колода тасуется по имени листа, а не по его месту в списке. */
function idHash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return h;
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

/** Построить предмет на участке s; false — не встал (врастал в соседнюю вещь, world/clearance.ts). */
function build(ctx: RoomCtx, name: string, s: Slot, salt: number): boolean {
  const p = ALL_PROPS[name]!;
  return p.build(s.xf.child(0, p.mount === 'wall' ? (p.y ?? 1.2) : 0, 0), seedOf(ctx, salt)) !== false;
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
    // Место держится тенью (партнёр 18.11: мебель не врастает в соседнюю): мелочь у соседней стены в него не встанет.
    const p = ALL_PROPS[rule.prop];
    if (p && s.xf.col) s.xf.col.shadows.push({ box: footprint(s, p), name: rule.prop, key: holdKey(ctx, k) });
  });
}

const roomRank = (ctx: RoomCtx, salt: number): number => hash01(ctx.room.id, salt * 13 + 5, ctx.seed ^ 0x77d1);

/** Ключ тени отведённого места. */
const holdKey = (ctx: RoomCtx, rule: number): string => `paper:${ctx.room.id}:${rule}`;

/** Коробка вещи реестра на участке стены s — там, где её построит build (у стены — спиной к ней, настенная — на своей высоте). */
function footprint(s: Slot, p: PropSpec): Aabb {
  const y = p.mount === 'wall' ? (p.y ?? 1.2) : 0;
  const z0 = p.mount === 'free' ? -p.d / 2 : 0;
  const a = s.xf.pt(-p.w / 2, y, z0);
  const b = s.xf.pt(p.w / 2, y + p.h, z0 + p.d);
  return { minX: Math.min(a[0], b[0]), minY: a[1], minZ: Math.min(a[2], b[2]), maxX: Math.max(a[0], b[0]), maxY: b[1], maxZ: Math.max(a[2], b[2]) };
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
  if (s && build(ctx, name, s, salt)) {
    s.used = true;
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
      if (p.build(at.child(0, y, 0), seedOf(ctx, salt)) === false) continue;
      return true;
    }
  }
  return false;
}

/**
 * Обрывок на пол: перед участком стены, в 15–55 см от неё (предмет сам отступает ещё на 20 см и ложится, как упал), и только
 * там, где на полу ничего не стоит: под шкафом или в ножках стола его не видно. Опасные клетки — мимо.
 */
function onFloor(ctx: RoomCtx, name: string, salt: number): boolean {
  const p = ALL_PROPS[name];
  if (!p) return false;
  const taken = ctx.cells[0]?.xf.mb.log?.list ?? [];
  const rank = (k: Slot): number => hash01(k.cx * 131 + k.cz * 17 + k.dir, ctx.room.id * 7 + salt, ctx.seed ^ 0x5c4a);
  for (const s of ctx.slots.filter((k) => !k.hazard).sort((a, b) => rank(a) - rank(b))) {
    const u = hash01(s.cx * 31 + s.cz, salt, ctx.seed ^ 0x5c4b);
    for (const along of [(u - 0.5) * 1.6, (0.5 - u) * 1.2, 0]) {
      const at = s.xf.child(along, 0, 0.15 + hash01(s.cx + s.dir * 7, salt, ctx.seed ^ 0x5c4c) * 0.4);
      // Обрывок поворачивается как угодно: под ним круг в 40 см у пола.
      if (taken.some((o) => overlaps(boxAt({ ...s, xf: at }, 0.4, 0.4, 0.05, 0), o, 0))) continue;
      if (p.build(at, seedOf(ctx, salt)) !== false) return true;
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
  const seed = seedOf(ctx, salt);
  hanging(c.xf, () => p.build(c.xf.child(dx, ctx.h, dz - p.d / 2), seed));
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
      // Тень отведённого места — прочь: теперь на нём встаёт сама вещь.
      const col = h.slot.xf.col;
      if (col) {
        const key = holdKey(ctx, h.rule);
        for (let i = col.shadows.length - 1; i >= 0; i--) if (col.shadows[i]!.key === key) col.shadows.splice(i, 1);
      }
      if (build(ctx, rule.prop, h.slot, h.rule)) count(rule.prop);
    }
  }
  rules.forEach((rule, k) => {
    if (rule.reserve) return;
    // Снимки и обрывки — по всему уровню, а не в первых помещениях от входа: порядок помещений тасуется сидом уровня.
    const order = rule.deck ? [...rooms].sort((a, b) => roomRank(a.ctx, k) - roomRank(b.ctx, k)) : rooms;
    for (const { ctx } of order) {
      if (state.left[k]! <= 0) break;
      if (!rule.types.includes(ctx.room.type)) continue;
      // Колода: сверху — следующий снимок; не встал — возвращается наверх и ждёт другого помещения.
      const deck = rule.deck ? state.decks[rule.deck] : null;
      const name = deck ? deck[deck.length - 1] : rule.prop;
      if (!name) break;
      const ok = rule.mode === 'wall' ? onWall(ctx, name, k) : rule.mode === 'floor' ? onFloor(ctx, name, k) : overBed(ctx, name, k);
      if (ok) {
        if (deck) deck.pop();
        state.left[k]! -= 1;
        count(name);
      }
    }
  });
  return placed;
}
