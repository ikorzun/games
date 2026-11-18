/**
 * Вещи, которые ставит партнёр (слова партнёра: «мне нужен очень простой редактор расстановки объектов по
 * локациям из этой библиотеки. С пониманием игры, ограничений… совмести с редактором и расстановкой
 * манекенов. Это просто конструктор, где можно перетащить вещь в пространство и поставить»). Инструмент —
 * tools/constructor: партнёр перетаскивает вещь с полки в настоящее помещение места, а здесь лежит то, что
 * из этого сохраняется, и проверка, годится ли оно игре.
 *
 * Как у фигур (world/figures.ts), сохраняется правило, а не точка: план места строится из сида, и точка на
 * одном плане ничего не значит на другом. Правило то же самое — в каких местах и помещениях, у какого края,
 * лицом куда, на какой высоте, сколько, — и тот же сдвиг от края: x вдоль стены, z от стены в комнату.
 * Своё у вещи — что это за вещь (имя в реестре ALL_PROPS: собранная кодом, готовая модель, позже — вещь
 * Sand3D) и доворот четвертями: обстановка игры стоит только по сторонам света, коробки и преграды у неё
 * прямые (world/props.ts, Xf), поэтому вещь поворачивается на 90°, а не на любой угол.
 *
 * Вещи, которые поставила сама игра, партнёр тоже двигает и убирает (его слова, 17.11, 19:15: «текущую расстановку
 * мебели я тоже должен уметь двигать и удалять»). План места каждый раз новый, поэтому и здесь хранится правило: какая
 * вещь игры (имя и номер среди таких же в помещении — GameThing), в каких местах и помещениях; у передвинутой — ещё и
 * правило, где она встанет (moves в PlacedSpec), у убранной — ничего (RemovedSpec).
 *
 * Чистый TS: читают игра, инструмент и тесты.
 */
import type { FigureRule } from './figures';
import { FIGURE_ANCHORS, FIGURE_FACINGS, FIGURE_WORLDS, ID_RE } from './figures';
import type { FigureAnchor, FigureFacing } from './figures';
import type { PropSpec } from './props_more';
import type { WorldKind } from '../gen/layout';
import { SLOT_RE } from './variants';

/** Правило места у вещи — то же, что у фигуры. */
export type PlaceRule = FigureRule;

/** Вещь игры в помещении: какая и которая по счёту среди таких же в этом помещении — в порядке сборки, с нуля. */
export interface GameThing {
  thing: string;
  nth: number;
}

/**
 * Номер вещи игры в помещении: с нуля, не больше 31 — столько одинаковых вещей в одном помещении не бывает. Номер считает
 * сборка уровня (world/level_build.ts): все вещи этого имени в помещении по порядку, в том числе заменённые, убранные и
 * передвинутые, — поэтому номера устойчивы.
 */
export const GAME_NTH: readonly [number, number] = [0, 31];

/**
 * Дверцы и ящики вещи партнёра (квиз 18.11: «Как выпадет + переключатель»): закрыто всё или открыто всё. Поля нет — как
 * выпадет: как у вещей игры в этом помещении (из одних комнат уходили второпях, другие прибраны; world/furniture.ts, openOf),
 * у каждой копии по-своему.
 */
export type PlacedOpen = 'shut' | 'open';
export const PLACED_OPEN: readonly PlacedOpen[] = ['shut', 'open'];

export interface PlacedSpec {
  /** Имя-ключ: [a-z0-9_], уникальное. */
  id: string;
  /** Подпись партнёра — как он сам назвал расстановку. */
  name: string;
  /** Какая вещь: имя в реестре ALL_PROPS (world/props_all.ts). */
  prop: string;
  rule: PlaceRule;
  /** Доворот после правила «лицом куда», четвертями по часовой: 0–3. */
  turn: 0 | 1 | 2 | 3;
  /** Сдвиг от точки правила, м: x — вбок вдоль стены, z — от стены в комнату. */
  offset: [number, number];
  /**
   * Вместо какой вещи игры (имя в ALL_PROPS; квиз 17.11: «Заменять» — «в этой кухне вместо дивана игры — мой»).
   * Тогда край, сдвиг и поворот правила не нужны: вещь встаёт туда, где игра поставила бы заменяемую, и так же
   * повёрнута — в помещениях правила, не больше count на место.
   */
  replaces?: string;
  /**
   * Заменять везде, где эта вещь игры стоит (куратор, пачка 41, противоречие 239: на уровне офиса около двадцати шкафов для
   * бумаг, а замена «здесь» берёт 1–3 на место): во всех помещениях всех мест, каждую, без счёта и без варианта — места,
   * помещения и count правила тогда не действуют. Только у замены (replaces). Замена «здесь» той же вещи игры важнее: в своих
   * помещениях ставит своё, остальные такие вещи берёт «везде».
   */
  everywhere?: boolean;
  /**
   * Передвинутая вещь игры (партнёр 17.11, 19:15: «текущую расстановку мебели я тоже должен уметь двигать и удалять»). В каждом
   * помещении правила, где игра ставит эту вещь (nth-ю такую), она встаёт не там, а по правилу этой записи — край, лицом куда,
   * высота, сдвиг, поворот — в том же помещении, одна. Не нашлось места по правилу — стоит, где поставила игра. prop === moves.thing;
   * rule.count для передвинутой не действует.
   */
  moves?: GameThing;
  /**
   * Где в помещении партнёр её поставил: доли рамки помещения по x и z (0…1; placed_place.ts, roomNear). Из краёв правила
   * игра берёт ближайший к этой доле: в том же помещении — тот самый, куда отпустили, в помещении другой формы — тот, что у
   * того же его края. Нет — край по жребию (агент конструктора, 17.11: иначе передвинутая вещь вставала не у той стены).
   */
  near?: [number, number];
  /**
   * Вариант расстановки (world/variants.ts; квиз 17.11, ночь: «Свой вариант на каждую»): «тип.номер» помещения конструктора,
   * где запись сделана. В игре действует только в помещениях, которым выпал этот вариант; нет — везде.
   */
  slot?: string;
  /**
   * Дверцы и ящики (PlacedOpen): закрыто или открыто всё; нет поля — как выпадет. У замены и передвинутой — так же. Открытой
   * вещи место ищется с вылетом дверец (PropSpec.reach): распахнутая не перекроет проход и не войдёт в соседа.
   */
  open?: PlacedOpen;
  /** Кто и когда сохранил (из инструмента). */
  at?: string;
}

/** Убранная вещь игры (партнёр 17.11, 19:15): в помещениях правила игра эту вещь (nth-ю такую) не ставит. */
export interface RemovedSpec {
  /** Имя-ключ: [a-z0-9_], уникальное. */
  id: string;
  /** Подпись партнёра, 1–80 знаков. */
  name: string;
  what: GameThing;
  /** Места: непусто, из FIGURE_WORLDS. */
  worlds: WorldKind[];
  /** Типы помещений; пусто — любые. */
  rooms: string[];
  /** Вариант расстановки (как у PlacedSpec.slot). */
  slot?: string;
  /** Кто и когда сохранил (из инструмента). */
  at?: string;
}

/** Запас по ширине и глубине, м: заменяющая вещь может быть чуть крупнее заменяемой, но не врастать в соседей. */
export const SWAP_SLACK = 0.3;

/** Годится ли вещь to на место вещи from: опоры совместимы (настенная — на стену), по размеру — с запасом. */
export function swapFits(from: PropSpec, to: PropSpec): boolean {
  const wall = (p: PropSpec): boolean => p.mount === 'wall';
  if (wall(from) !== wall(to) || from.mount === 'ceiling' || to.mount === 'ceiling') return false;
  return to.w <= from.w + SWAP_SLACK && to.d <= from.d + SWAP_SLACK;
}

/** Сколько одинаковых вещей по одному правилу на месте. */
export const PLACED_COUNT: readonly [number, number] = [1, 3];
/** Высота над полом, м: у настенной вещи — её низ; у остальных 0 — стоит, больше — висит в воздухе. */
export const PLACED_LIFT: readonly [number, number] = [0, 2.6];
/** Сдвиг от точки правила, м, по каждой оси. */
export const PLACED_OFFSET: readonly [number, number] = [-3, 3];

/**
 * Какие вещи можно ставить руками. Не ставятся: подвесные (их место — потолок, и висят они по своим законам),
 * то, что держит место на себе (FIXED в props_all.ts: порог, двери лифта, гора, колонна), листы бумаги и
 * картинки на щитах (их раскладывает furnish_papers.ts по своей сетке) и сами манекены — для них свой
 * режим инструмента с позой.
 */
export function placeable(name: string, p: PropSpec, fixed: ReadonlySet<string>): boolean {
  if (p.mount === 'ceiling' || fixed.has(name)) return false;
  if (name.startsWith('paper_') || name.startsWith('figure_') || name.startsWith('mannequin')) return false;
  return true;
}

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const within = (x: unknown, [a, b]: readonly [number, number]): boolean => num(x) && x >= a - 1e-6 && x <= b + 1e-6;
const nthOk = (x: unknown): boolean => Number.isInteger(x) && (x as number) >= GAME_NTH[0] && (x as number) <= GAME_NTH[1];
const asRecord = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null);

/**
 * Расстановка годится для игры: ключ, подпись, вещь из реестра, правило и сдвиг в пределах. Возвращает
 * список бед по-русски (пусто — годится). props — реестр, по которому проверяется имя вещи.
 */
export function placedProblems(x: unknown, props: Readonly<Record<string, PropSpec>>, fixed: ReadonlySet<string> = new Set()): string[] {
  const bad: string[] = [];
  if (!x || typeof x !== 'object') return ['не объект'];
  const f = x as Record<string, unknown>;
  if (typeof f.id !== 'string' || !ID_RE.test(f.id)) bad.push('ключ: только a–z, 0–9 и _');
  if (typeof f.name !== 'string' || f.name.trim().length === 0 || f.name.length > 80) bad.push('имя: от 1 до 80 знаков');
  const p = typeof f.prop === 'string' ? props[f.prop] : undefined;
  if (!p) bad.push('вещь: такой нет в игре');
  else if (!placeable(f.prop as string, p, fixed)) bad.push('вещь: эту руками не ставят');
  if (!Number.isInteger(f.turn) || (f.turn as number) < 0 || (f.turn as number) > 3) bad.push('поворот: четвертями, 0–3');
  if (f.replaces !== undefined) {
    const from = typeof f.replaces === 'string' ? props[f.replaces] : undefined;
    if (!from) bad.push('замена: такой вещи игры нет');
    else if (fixed.has(f.replaces as string) || from.mount === 'ceiling') bad.push('замена: эту вещь игры не заменяют');
    else if (p && !swapFits(from, p)) bad.push('замена: не встанет на её место (опора или размер)');
  }
  if (f.everywhere !== undefined) {
    if (typeof f.everywhere !== 'boolean') bad.push('везде: да или нет');
    else if (f.everywhere && f.replaces === undefined) bad.push('везде — только у замены вещи игры');
  }
  if (f.moves !== undefined) {
    const m = asRecord(f.moves);
    if (!m) bad.push('передвинутая: какая вещь игры');
    else {
      const t = typeof m.thing === 'string' ? props[m.thing] : undefined;
      if (!t) bad.push('передвинутая: такой вещи игры нет');
      else if (!placeable(m.thing as string, t, fixed)) bad.push('передвинутая: эту вещь игры руками не двигают');
      if (m.thing !== f.prop) bad.push('передвинутая: вещь должна быть та же, что двигают');
      if (!nthOk(m.nth)) bad.push('передвинутая: номер вещи в помещении — целое от 0 до 31');
    }
    if (f.replaces !== undefined) bad.push('передвинутая не заменяет: одно из двух');
  }
  const near = f.near as unknown;
  if (near !== undefined && !(Array.isArray(near) && near.length === 2 && near.every((v) => within(v, [0, 1])))) bad.push('где в помещении: две доли от 0 до 1');
  if (f.slot !== undefined && !(typeof f.slot === 'string' && SLOT_RE.test(f.slot))) bad.push('вариант: «тип.номер»');
  if (f.open !== undefined && !PLACED_OPEN.includes(f.open as PlacedOpen)) bad.push('дверцы: как выпадет, закрыто или открыто');
  const off = f.offset as unknown;
  if (!Array.isArray(off) || off.length !== 2 || !off.every((v) => within(v, PLACED_OFFSET))) bad.push('сдвиг: не дальше 3 м от края');
  const r = f.rule as Record<string, unknown> | undefined;
  if (!r) bad.push('правило места');
  else {
    if (!Array.isArray(r.worlds) || r.worlds.length === 0 || !r.worlds.every((w) => FIGURE_WORLDS.includes(w as WorldKind))) bad.push('места');
    if (!Array.isArray(r.rooms) || !r.rooms.every((t) => typeof t === 'string' && /^[a-z_]+$/.test(t))) bad.push('помещения');
    if (!FIGURE_ANCHORS.includes(r.anchor as FigureAnchor)) bad.push('у чего стоит');
    if (!FIGURE_FACINGS.includes(r.facing as FigureFacing)) bad.push('куда смотрит');
    if (!within(r.lift, PLACED_LIFT)) bad.push('высота: от 0 до 2,6 м');
    if (!Number.isInteger(r.count) || (r.count as number) < PLACED_COUNT[0] || (r.count as number) > PLACED_COUNT[1]) bad.push('сколько: 1–3');
  }
  return bad;
}

/**
 * Убранная вещь игры годится для игры: ключ, подпись, вещь из реестра — та, что сборка ставит сама (не держит место на себе
 * и не висит под потолком: таких хук сборки не видит, world/props_all.ts), номер в помещении, места и помещения. Возвращает
 * список бед по-русски (пусто — годится).
 */
export function removedProblems(x: unknown, props: Readonly<Record<string, PropSpec>>, fixed: ReadonlySet<string> = new Set()): string[] {
  const bad: string[] = [];
  const f = asRecord(x);
  if (!f) return ['не объект'];
  if (typeof f.id !== 'string' || !ID_RE.test(f.id)) bad.push('ключ: только a–z, 0–9 и _');
  if (typeof f.name !== 'string' || f.name.trim().length === 0 || f.name.length > 80) bad.push('имя: от 1 до 80 знаков');
  const w = asRecord(f.what);
  if (!w) bad.push('какая вещь игры');
  else {
    const p = typeof w.thing === 'string' ? props[w.thing] : undefined;
    if (!p) bad.push('вещь: такой нет в игре');
    else if (fixed.has(w.thing as string) || p.mount === 'ceiling') bad.push('вещь: эту из игры не убирают');
    if (!nthOk(w.nth)) bad.push('номер вещи в помещении: целое от 0 до 31');
  }
  if (!Array.isArray(f.worlds) || f.worlds.length === 0 || !f.worlds.every((v) => FIGURE_WORLDS.includes(v as WorldKind))) bad.push('места');
  if (!Array.isArray(f.rooms) || !f.rooms.every((t) => typeof t === 'string' && /^[a-z_]+$/.test(t))) bad.push('помещения');
  if (f.slot !== undefined && !(typeof f.slot === 'string' && SLOT_RE.test(f.slot))) bad.push('вариант: «тип.номер»');
  return bad;
}
