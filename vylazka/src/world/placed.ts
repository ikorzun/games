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
 * Чистый TS: читают игра, инструмент и тесты.
 */
import type { FigureRule } from './figures';
import { FIGURE_ANCHORS, FIGURE_FACINGS, FIGURE_WORLDS, ID_RE } from './figures';
import type { FigureAnchor, FigureFacing } from './figures';
import type { PropSpec } from './props_more';
import type { WorldKind } from '../gen/layout';

/** Правило места у вещи — то же, что у фигуры. */
export type PlaceRule = FigureRule;

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
