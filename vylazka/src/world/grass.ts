/**
 * Трава (партнёр 19.11, 21:31: «И трава нужна красивая на лугу и иногда на весь пол в некоторые помещения»; «Комнаты должны
 * удивлять, завораживать и порой шокировать»). Здесь — сетка плитки травы: квадрат 1 × 1 м, середина в начале координат, корни
 * на y = 0. Плитки ставит рендер копиями одной сетки по полу (render/renderer.ts, setGrass), где и какие — systems/grass.ts.
 *
 * Травинка — изогнутый клин в три колена: у корня шире и темнее, к кончику светлее и тоньше, гнётся в свою сторону. Вес качания
 * растёт к кончику квадратом (world/kit.ts, sway: bend) — ветер шейдера и шаги героя (WIND_GLSL, uPush) гнут кончики, корень
 * стоит. Травинки разложены по плитке сеткой с разбросом: плитки сходятся без швов и проплешин, а трёх видов плиток хватает,
 * чтобы узор не читался (правило партнёра «без стыков и повторов»; поворот и размер у каждой плитки свои).
 *
 * Дальняя сетка — те же травинки, но не все: каждая третья, на тех же местах и того же наклона, одним треугольником. Так при смене
 * подробности трава не «перепрыгивает»: ближние травинки просто дорастают между дальними (приём из обзора быстрой травы —
 * docs/vylazka/_research/flora_grass.md, раздел A). У горизонта — каждая девятая, шире: луг тянется до края, а не обрывается
 * кругом (куратор, противоречие 349).
 *
 * Три вида: луговая — сочная, с соломой по кончикам; комнатная — бледная, жёлто-зелёная, выросшая без солнца (трава, которая
 * пробилась сквозь пол, — не газон); газон жёлтых комнат — пугающе ровный, короткий и ярко-зелёный, как ковёр.
 */
import { mulberry32 } from '../core/rng';
import type { Vec3 } from '../core/types';
import { MeshBuilder } from './kit';
import type { MeshData } from './kit';
import { MAT } from './materials';

/** Сторона плитки, м. */
export const GRASS_TILE = 1;
/** Видов плитки на каждый вид травы. */
export const GRASS_VARIANTS = 3;
export type GrassKind = 'meadow' | 'pale' | 'lawn';
export const GRASS_KINDS: readonly GrassKind[] = ['meadow', 'pale', 'lawn'];
/** Номер формы для рендера: вид травы × вариант плитки. */
export const grassForm = (kind: GrassKind, variant: number): number => GRASS_KINDS.indexOf(kind) * GRASS_VARIANTS + (variant % GRASS_VARIANTS);
export const GRASS_FORMS = GRASS_KINDS.length * GRASS_VARIANTS;

/** Какая часть травинок остаётся у дальней сетки и у самой дальней. */
const FAR_EVERY = 3;
const HORIZON_EVERY = 9;
/** Подробность плитки: 0 — ближняя, 1 — дальняя, 2 — у горизонта (луг дотягивается до края, а не обрывается кругом). */
export type GrassLod = 0 | 1 | 2;
export const GRASS_LODS = 3;

interface Look {
  /** Корень и кончик (тон бумаги/ткани мира: 1 — как есть). */
  root: Vec3;
  tip: Vec3;
  /** Солома по кончикам: доля травинок и её цвет. */
  straw: number;
  strawTip: Vec3;
  /** Высота травинки, м: от и до; ширина у корня, м. */
  h: readonly [number, number];
  w: readonly [number, number];
  /** Насколько травинки клонятся: доля высоты, на которую уходит кончик. */
  lean: readonly [number, number];
  /** Сетка раскладки травинок в плитке: столбцы × строки. */
  grid: readonly [number, number];
  /** Колена травинки у ближней плитки (доли высоты); нет — три: короткому газону хватает двух. */
  rows?: readonly number[];
  /** Нормаль травинки — как у земли (вверх): короткий газон освещён ровно, как подстриженный, а не тёмными иглами. */
  flat?: boolean;
  /**
   * Не качается и не расступается (вес качания — ноль): газон жёлтых комнат ложный, у ложного нет времени (куратор, связка «Газон
   * вместо травы», 345). Ветер и шаги (WIND_GLSL) двигают кончик на сантиметры — короткую травинку они бы растянули в нитку.
   */
  still?: boolean;
}

// Тона — под материал ткани (MAT.canvas), как у земли луга (world/pocket_meadow.ts, gcol): у неё середина — [0,8; 1,45; 0,45].
// Травинка шире настоящей (2–4 см у корня) и клонится дугой: в кадре бодикама 960 × 540 тонкая прямая травинка — меньше
// пикселя, а сверху её не видно совсем (кадры 19.11: «редкие тёмные штрихи», а не пол из травы).
// Комнатная — гуще и шире луговой: её смотрят сверху и вблизи, в луче фонаря, и между редкими травинками читался паркет, а не
// заросший пол (кадры 19.11, ночь). Луг смотрят вдаль, там густоту даёт сама перспектива.
// Газон жёлтых комнат (квиз партнёра, ночь на 20.11: «Идеальный газон, изредка») — наоборот, слишком правильный: короткий, ровный,
// густой, одного яркого цвета, травинки почти не клонятся и не желтеют — как ковёр, которого не касалась нога.
const LOOKS: Record<GrassKind, Look> = {
  meadow: { root: [0.55, 0.98, 0.3], tip: [1.12, 1.85, 0.58], straw: 0.16, strawTip: [1.7, 1.5, 0.7], h: [0.18, 0.46], w: [0.011, 0.02], lean: [0.2, 0.7], grid: [12, 11] },
  pale: { root: [0.72, 0.82, 0.42], tip: [1.42, 1.58, 0.86], straw: 0.3, strawTip: [1.62, 1.5, 0.95], h: [0.2, 0.5], w: [0.015, 0.027], lean: [0.25, 0.8], grid: [15, 14] },
  lawn: { root: [0.5, 1.2, 0.35], tip: [0.95, 2.0, 0.55], straw: 0, strawTip: [0.95, 2.0, 0.55], h: [0.062, 0.074], w: [0.016, 0.024], lean: [0.04, 0.12], grid: [18, 18], rows: [0, 0.5], flat: true, still: true },
};

const cache = new Map<string, MeshData>();

/**
 * Сетка плитки: вид травы kind, вариант (0..GRASS_VARIANTS−1), подробность lod (0 — ближняя, 1 — дальняя, 2 — у горизонта).
 * Одна и та же для одинаковых аргументов (кэш): рендер ставит её копиями.
 *
 * У каждой вершины травинки uv — её корень в плитке (x, z): по нему шейдер решает травинку целиком — вытоптанный круг у места
 * вещи (render/shaders.ts, GRASS) и стёртый пол под корнем.
 */
export function grassTile(kind: GrassKind, variant: number, lod: GrassLod): MeshData {
  const key = `${kind}:${variant}:${lod}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const look = LOOKS[kind];
  const rnd = mulberry32((0x9a55 + variant * 7919 + (kind === 'pale' ? 104729 : kind === 'lawn' ? 224737 : 0)) >>> 0);
  const span = (r: readonly [number, number]): number => r[0] + (r[1] - r[0]) * rnd();
  const mb = new MeshBuilder();
  const [cols, rows] = look.grid;
  let k = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++, k++) {
      // Каждая травинка тянет одни и те же случайные числа и в ближней, и в дальней сетке: место и наклон у них общие.
      const x = ((i + 0.15 + rnd() * 0.7) / cols - 0.5) * GRASS_TILE;
      const z = ((j + 0.15 + rnd() * 0.7) / rows - 0.5) * GRASS_TILE;
      const lawn = kind === 'lawn';
      // У газона рост и тон почти одни: он подстрижен, а не вырос.
      const h = span(look.h) * (lawn ? 0.98 + 0.04 * rnd() * rnd() : 0.75 + 0.5 * rnd() * rnd());
      const w = span(look.w);
      const face = rnd() * Math.PI * 2;
      const dir = rnd() * Math.PI * 2;
      const lean = span(look.lean);
      const straw = rnd() < look.straw;
      const shade = lawn ? 0.97 + rnd() * 0.06 : 0.82 + rnd() * 0.3;
      // Дальняя — каждая третья травинка, у горизонта — каждая девятая (из тех же третьих): смена подробности не прыгает.
      if (lod === 1 && k % FAR_EVERY !== 0) continue;
      if (lod === 2 && k % HORIZON_EVERY !== 0) continue;
      blade(mb, x, z, h, lod === 0 ? w : lod === 1 ? w * 1.6 : w * 2.4, face, dir, lean, look, straw, shade, lod);
    }
  }
  // Газон лежит на зелёной подложке: между короткими травинками видна не ткань пола, а дёрн — издали газон читается ровной
  // зелёной гладью (кадры 20.11, ночь: без подложки — тёмные точки по ковролину). Плитки газона стоят встык, без нахлёста.
  if (kind === 'lawn') lawnBase(mb, look);
  // У комнатной — «матрас» примятой травы: квадрат плитки над полом своим материалом (GRASS_PRESS_MAT). Шейдер рисует его только
  // внутри силуэта лежавшего, край — по пикселю (render/shaders.ts, bodySd): между примятыми травинками не виден паркет, и
  // контур следа резкий (партнёр 20.11: «Сделай контур следа чётче»). Без следа квадрат весь отбрасывается.
  if (kind === 'pale') pressMat(mb, look);
  const data = mb.build();
  cache.set(key, data);
  return data;
}

/**
 * Материал «матраса» примятой травы под следом лежавшего (у комнатной травы): по нему шейдер узнаёт квадрат и рисует его только
 * внутри силуэта. Земля — матовая, как свалявшаяся трава; цвет даёт тон вершин.
 */
export const GRASS_PRESS_MAT = MAT.dirt;
/** Высота «матраса» над корнями плитки, м: корни комнатной травы на сантиметр ниже пола, матрас — на 6 мм выше пола. */
export const GRASS_PRESS_Y = 0.016;

/** «Матрас»: квадрат плитки над полом, тон сухой примятой травы; uv каждой вершины — она сама (шейдер решает его по пикселю). */
function pressMat(mb: MeshBuilder, look: Look): void {
  const h = GRASS_TILE / 2;
  const y = GRASS_PRESS_Y;
  const n: Vec3 = [0, 1, 0];
  const t: Vec3 = [(look.tip[0] + look.strawTip[0]) * 0.42, (look.tip[1] + look.strawTip[1]) * 0.42, (look.tip[2] + look.strawTip[2]) * 0.42];
  const v = ([x, z]: readonly [number, number]): number => mb.vertexUv([x, y, z], n, GRASS_PRESS_MAT, t, 0.9, [x, z]);
  const a = v([-h, -h]);
  const b = v([h, -h]);
  const c = v([h, h]);
  const d = v([-h, h]);
  mb.tri(a, c, b);
  mb.tri(a, d, c);
}

/** Подложка газона: квадрат плитки чуть над полом, тёмно-зелёный; uv каждой вершины — она сама (корень — на месте). */
function lawnBase(mb: MeshBuilder, look: Look): void {
  const h = GRASS_TILE / 2;
  const y = 0.003;
  const n: Vec3 = [0, 1, 0];
  const t: Vec3 = [look.root[0] * 0.78, look.root[1] * 0.85, look.root[2] * 0.78];
  const v = ([x, z]: readonly [number, number]): number => mb.vertexUv([x, y, z], n, MAT.canvas, t, 0.85, [x, z]);
  const a = v([-h, -h]);
  const b = v([h, -h]);
  const c = v([h, h]);
  const d = v([-h, h]);
  mb.tri(a, c, b);
  mb.tri(a, d, c);
}

/**
 * Одна травинка: корень в (x, 0, z), лицо повёрнуто на face, кончик клонится в сторону dir на lean высоты (дугой: у корня почти
 * прямо, к кончику — сильнее). Видна с обеих сторон; нормаль — между лицом и «вверх», чтобы свет лёг мягко и изнанка не чернела.
 */
function blade(mb: MeshBuilder, x: number, z: number, h: number, w: number, face: number, dir: number, lean: number, look: Look, straw: boolean, shade: number, lod: GrassLod): void {
  const ux = Math.cos(face);
  const uz = Math.sin(face);
  const dx = Math.cos(dir);
  const dz = Math.sin(dir);
  const rows = lod === 0 ? (look.rows ?? [0, 0.38, 0.72]) : [0];
  const tipT = 1;
  const at = (t: number): Vec3 => {
    const off = lean * h * t * t;
    return [x + dx * off, h * t * (1 - 0.18 * lean * t), z + dz * off];
  };
  const n0: Vec3 = look.flat ? [0, 1, 0] : norm([uz * 0.55, 1, -ux * 0.55]);
  const tint = (t: number): Vec3 => {
    const tip = straw && t > 0.6 ? look.strawTip : look.tip;
    const k = Math.min(1, t * 1.15);
    return [(look.root[0] + (tip[0] - look.root[0]) * k) * shade, (look.root[1] + (tip[1] - look.root[1]) * k) * shade, (look.root[2] + (tip[2] - look.root[2]) * k) * shade];
  };
  mb.sway = look.still ? null : { from: 0, span: h, gain: 1, bend: true };
  const root: [number, number] = [x, z];
  const ids: [number, number][] = rows.map((t) => {
    const c = at(t);
    const half = w * Math.pow(1 - t, 0.8);
    const ao = 0.72 + 0.28 * t;
    return [mb.vertexUv([c[0] - ux * half, c[1], c[2] - uz * half], n0, MAT.canvas, tint(t), ao, root), mb.vertexUv([c[0] + ux * half, c[1], c[2] + uz * half], n0, MAT.canvas, tint(t), ao, root)];
  });
  const tip = mb.vertexUv(at(tipT), n0, MAT.canvas, tint(1), 1, root);
  mb.sway = null;
  // Обе стороны одними и теми же вершинами: обход в обе стороны.
  const two = (a: number, b: number, c: number): void => {
    mb.tri(a, b, c);
    mb.tri(a, c, b);
  };
  for (let r = 0; r + 1 < ids.length; r++) {
    const [a0, a1] = ids[r]!;
    const [b0, b1] = ids[r + 1]!;
    two(a0, a1, b1);
    two(a0, b1, b0);
  }
  const [l0, l1] = ids[ids.length - 1]!;
  two(l0, l1, tip);
}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Треугольников в плитке (для бюджета и проверок). */
export const grassTris = (kind: GrassKind, variant: number, lod: GrassLod): number => grassTile(kind, variant, lod).index.length / 3;
