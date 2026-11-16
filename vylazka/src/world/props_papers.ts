/**
 * Бумага в помещениях: щиты с листами, листы в рамах и лист на потолке (world/papers.ts).
 *
 * Правила те же, что у остального реквизита: предмет описан в своих координатах (метры, y вверх);
 * wall — спина в z = 0, y в реестре — высота низа; ceiling — растёт вниз от y = 0 и, как всё в реестре,
 * лежит от z = 0 до z = d (ставят его со сдвигом на полглубины — world/furnish_papers.ts).
 *
 * Что плоское, а что объёмное, решает основная модель (слова партнёра: «решай сам что переделать в 3д,
 * а что оставить плоским на стене или в рамке или на потолке»). Здесь всё плоское по своей природе:
 * фотография, купюра, акция, карта. Объёмной сделана только оправа — щит из фанеры, рама, кнопки.
 * Надписей и имён от себя не добавляется.
 *
 * Размер — настоящий или близкий к нему: увеличенный в несколько раз лист читается фотообоями. Одно
 * исключение сделано нарочно — лист над кроватью (ceil_faces): карточки там впятеро больше настоящих,
 * как всё, на что смотришь лёжа и долго.
 *
 * Вся случайность — из сида предмета.
 */
import type { Vec3 } from '../core/types';
import { MAT } from './materials';
import { paperHeight, PAPERS } from './papers';
import type { Xf } from './props';
import { rng } from './props_more';
import type { PropSpec } from './props_more';

const PLY: Vec3 = [0.78, 0.66, 0.5];
const PLY_DK: Vec3 = [0.5, 0.42, 0.33];
const FRAME_DK: Vec3 = [0.42, 0.3, 0.22];
const FRAME_BLACK: Vec3 = [0.22, 0.2, 0.2];
const FRAME_GILT: Vec3 = [1.15, 0.95, 0.55];
const PIN: Vec3 = [0.9, 0.9, 0.95];
/** Лист под рамой чуть темнее, чем на открытом щите. */
const UNDER: Vec3 = [0.93, 0.92, 0.9];

/** Толщина щита, зазор листа над ним и поле фанеры вокруг листа, м. */
const BOARD_T = 0.018;
const GAP = 0.004;
const RIM = 0.012;

/** Щит в ряду: какой лист, какой ширины и на какой высоте его низ над низом предмета. */
interface BoardSpec {
  id: string;
  w: number;
  y?: number;
}

/**
 * Щит: лист фанеры на стене, на нём — лист бумаги во весь щит, по углам кнопки. Низ щита — y,
 * середина — x.
 */
function board(xf: Xf, id: string, x: number, w: number, y = 0): void {
  const h = paperHeight(PAPERS[id]!, w);
  xf.box([x - w / 2 - RIM, y, 0], [x + w / 2 + RIM, y + h + 2 * RIM, BOARD_T], MAT.wood, { tint: PLY, skip: ['nz'], aoBottom: 0.8 });
  xf.paper(id, x, y + RIM, w, [1, 1, 1], BOARD_T + GAP);
  for (const [px, py] of [[-1, 0], [1, 0], [-1, 1], [1, 1]] as const) {
    const cx = x + px * (w / 2 - 0.03);
    const cy = y + RIM + (py === 0 ? 0.03 : h - 0.03);
    xf.box([cx - 0.006, cy - 0.006, BOARD_T + GAP], [cx + 0.006, cy + 0.006, BOARD_T + GAP + 0.004], MAT.steel, { tint: PIN, skip: ['nz'] });
  }
}

/** Щиты в ряд посередине участка стены: у каждого свой лист, своя ширина и своя высота. */
function boards(xf: Xf, items: readonly BoardSpec[], gap = RIM): void {
  const total = items.reduce((a, it) => a + it.w + 2 * RIM, 0) + gap * (items.length - 1);
  let x = -total / 2;
  for (const it of items) {
    board(xf, it.id, x + RIM + it.w / 2, it.w, it.y ?? 0);
    x += it.w + 2 * RIM + gap;
  }
}

/** Ширина планки рамы, м: у позолоченной она шире. */
const railOf = (style: number): number => (style === 2 ? 0.045 : 0.03);

/**
 * Лист в раме: четыре планки, под ними лист. Низ рамы — y = 0, середина — x. style: 0 — тёмное дерево,
 * 1 — чёрная, 2 — позолота.
 */
function framed(xf: Xf, id: string, x: number, w: number, style = 0): void {
  const h = paperHeight(PAPERS[id]!, w);
  const b = railOf(style);
  const d = 0.026;
  const tint = style === 2 ? FRAME_GILT : style === 1 ? FRAME_BLACK : FRAME_DK;
  const mat = style === 2 ? MAT.brass : MAT.wood;
  const x0 = x - w / 2 - b;
  const x1 = x + w / 2 + b;
  // Задник и лист; планки рамы перекрывают края листа.
  xf.box([x0 + 0.004, 0.004, 0], [x1 - 0.004, h + 2 * b - 0.004, 0.008], MAT.cardboard, { tint: PLY_DK, skip: ['nz'] });
  xf.paper(id, x, b, w, UNDER, 0.008 + GAP);
  xf.box([x0, 0, 0], [x1, b, d], mat, { tint, skip: ['nz'], bevel: 0.004 });
  xf.box([x0, h + b, 0], [x1, h + 2 * b, d], mat, { tint, skip: ['nz'], bevel: 0.004 });
  xf.box([x0, b, 0], [x0 + b, h + b, d], mat, { tint, skip: ['nz', 'py', 'ny'] });
  xf.box([x1 - b, b, 0], [x1, h + b, d], mat, { tint, skip: ['nz', 'py', 'ny'] });
}

/**
 * Несколько рам в ряд на одном участке стены. Середины — на одной высоте: на половине самой высокой
 * рамы, так что она стоит на y = 0, а остальные висят вокруг той же линии с разбросом в пару
 * сантиметров (вешали на глаз). Просветы между рамами разные.
 */
function frameRow(xf: Xf, seed: number, ids: readonly string[], styles: readonly number[]): void {
  const r = rng(seed);
  const frames = ids.map((id, i) => {
    const style = styles[i % styles.length]!;
    const w = PAPERS[id]!.width;
    const b = railOf(style);
    return { id, style, w: w + 2 * b, h: paperHeight(PAPERS[id]!, w) + 2 * b, inner: w };
  });
  const gaps = frames.map(() => 0.1 + 0.12 * r());
  const total = frames.reduce((a, f) => a + f.w, 0) + gaps.slice(1).reduce((a, g) => a + g, 0);
  const tall = Math.max(...frames.map((f) => f.h));
  let x = -total / 2;
  frames.forEach((f, i) => {
    if (i > 0) x += gaps[i]!;
    const jitter = f.h < tall ? (r() - 0.5) * 0.05 : 0;
    const y = Math.min(Math.max(0, (tall - f.h) / 2 + jitter), tall - f.h);
    framed(xf.child(0, y, 0), f.id, x + f.w / 2, f.inner, f.style);
    x += f.w;
  });
}

/** Перемешать список сидом и взять первые n. */
function pick<T>(seed: number, items: readonly T[], n: number): T[] {
  const r = rng(seed);
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a.slice(0, n);
}

/** Акции с ленты, кроме высокой с купонным листом: она в ряду рам всегда посередине. */
const BONDS_LOW = ['bond_b', 'bond_c', 'bond_d', 'bond_e'] as const;

const FACE_BIG = PAPERS.face_big!;

export const PAPER_PROPS: Record<string, PropSpec> = {
  faces_wall: {
    w: 2.4,
    d: 0.03,
    h: 2.45,
    mount: 'wall',
    y: 0.1,
    ru: 'стена лиц: большой щит мелких карточек в настоящую величину и рядом, на уровне глаз, щит поменьше — кабинетные портреты',
    build: (xf, seed) => {
      const big: BoardSpec = { id: 'faces_a', w: PAPERS.faces_a!.width };
      const mid: BoardSpec = { id: 'faces_b', w: PAPERS.faces_b!.width, y: 0.52 };
      boards(xf, seed % 2 === 0 ? [big, mid] : [mid, big], 0.14);
    },
  },
  money_board: {
    w: 0.6,
    d: 0.03,
    h: 0.95,
    mount: 'wall',
    y: 0.95,
    ru: 'щит с купюрами и облигациями стран, которых больше нет',
    build: (xf) => boards(xf, [{ id: 'money', w: PAPERS.money!.width }]),
  },
  money_wall: {
    w: 1.05,
    d: 0.03,
    h: 1.55,
    mount: 'wall',
    y: 0.65,
    ru: 'щит с купюрами и рядом лента акций',
    build: (xf, seed) => {
      const money: BoardSpec = { id: 'money', w: PAPERS.money!.width, y: 0.3 };
      const bonds: BoardSpec = { id: 'bonds', w: PAPERS.bonds!.width };
      boards(xf, seed % 2 === 0 ? [money, bonds] : [bonds, money], 0.1);
    },
  },
  notgeld_frame: {
    w: 0.5,
    d: 0.03,
    h: 0.62,
    mount: 'wall',
    y: 1.1,
    ru: 'в чёрной раме: городские деньги времён, когда деньги печатал каждый город',
    build: (xf) => framed(xf, 'notgeld', 0, PAPERS.notgeld!.width, 1),
  },
  map_board: {
    w: 1.6,
    d: 0.03,
    h: 2.2,
    mount: 'wall',
    y: 0.3,
    ru: 'щит с картой страны, которой больше нет',
    build: (xf) => boards(xf, [{ id: 'map_union', w: PAPERS.map_union!.width }]),
  },
  frames_faces: {
    w: 1.6,
    d: 0.03,
    h: 0.95,
    mount: 'wall',
    y: 1.05,
    ru: 'три портрета в рамах: большой посередине, по бокам две маленькие карточки — старуха и двое детей',
    build: (xf, seed) => frameRow(xf, seed, seed % 2 === 0 ? ['face_round', 'face_big', 'face_pair'] : ['face_pair', 'face_big', 'face_round'], [0, 2, 0]),
  },
  frames_bonds: {
    w: 1.8,
    d: 0.03,
    h: 0.56,
    mount: 'wall',
    y: 1.14,
    ru: 'три акции в чёрных рамах: высокая с купонным листом посередине',
    build: (xf, seed) => {
      const [a, b] = pick(seed, BONDS_LOW, 2);
      frameRow(xf, seed, [a!, 'bond_a', b!], [1]);
    },
  },
  frame_face_big: {
    w: FACE_BIG.width + 0.09,
    d: 0.03,
    h: paperHeight(FACE_BIG) + 0.09,
    mount: 'wall',
    y: 1.0,
    ru: `в раме: ${FACE_BIG.ru}`,
    build: (xf, seed) => framed(xf, 'face_big', 0, FACE_BIG.width, seed % 3 === 0 ? 2 : 0),
  },
  ceil_faces: {
    w: 1.1,
    d: 2.4,
    h: 0.02,
    mount: 'ceiling',
    ru: 'лица на потолке: лист крупных карточек над кроватью — нарочно больше настоящих',
    build: (xf) => xf.paperCeil('faces_c', 0, -0.006, 1.2, PAPERS.faces_c!.width),
  },
};
