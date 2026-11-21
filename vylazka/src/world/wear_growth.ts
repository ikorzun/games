/**
 * Своё стирание мест — то, что нарастает с кругами (docs/vylazka/plan.md, §4, шаг 6; снимки партнёра
 * «Разрешения на все картинки есть»; что взято и почему — решения основной модели):
 *
 *   — убежище — рубец: стык стены с потолком зарастает тёмной неровной массой, и в углах она сползает
 *     вниз. Нарастает фронтом от одного места — технической части убежища, — а не везде сразу.
 *     Грибы — знак Осыпи — растут у пола, рубец — сверху: их не спутать;
 *   — зал ожидания — коконы: на щите из тёмных досок в кассе и буфете гроздья белых коконов, с каждым
 *     кругом больше. Ожидание, которое затянулось. На первом круге щит пуст: коконы потом появляются
 *     на знакомом месте.
 *
 * Это часть места, а не вещи: объектами они не становятся (их не растворить касанием). Но и не стены:
 * общее стирание (стены в кружево, потолок прочь) их не берёт — что наросло, держится до конца петли и
 * к последним кругам остаётся тем, что от места видно дольше всего (номер вершин GROWTH_OBJ).
 * Строятся последним проходом сборки уровня и своим сидом: обстановка от них не сдвигается ни на
 * первом круге, ни на пятом. Берётся мысль снимков, а не копия работ.
 */
import { hash01, hash2 } from '../core/rng';
import type { Vec3 } from '../core/types';
import type { GenRoom, WorldKind } from '../gen/layout';
import type { RoomCtx, Slot } from './furnish';
import { MAT } from './materials';
import { GROWTH_OBJ } from './objects';
import type { Xf } from './props';
import { rng } from './props_more';
import { CELL } from './shell';

const smooth = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Построить как своё стирание места: не вещь и не архитектура (GROWTH_OBJ) — общее стирание стен и потолка его не берёт. */
function asGrowth<T>(xf: Xf, build: () => T): T {
  const keep = xf.mb.obj;
  xf.mb.obj = GROWTH_OBJ;
  try {
    return build();
  } finally {
    xf.mb.obj = keep;
  }
}

// ───────────────────────────── коконы ─────────────────────────────

// Доски различаются тоном: швов поверх нет (ступенька в пару миллиметров рисует на точках светлый контур).
const PLANK: readonly Vec3[] = [
  [0.46, 0.3, 0.21],
  [0.27, 0.16, 0.11],
  [0.54, 0.35, 0.24],
  [0.34, 0.21, 0.15],
  [0.4, 0.26, 0.19],
];
// Не чисто белый: в светлом зале белое «пересвечивается» и кокон становится плоским пятном.
const COCOON: Vec3 = [0.8, 0.78, 0.73];

/** Щит: ширина и наибольшая высота, м. */
export const COCOON_PANEL = { w: 2.4, h: 2.2 } as const;

/** Сколько коконов на щите при стёртости wear: на первом круге ни одного, к пятому — сотня с лишним. */
export function cocoonCount(wear: number): number {
  return Math.round(150 * smooth(0.1, 0.75, wear));
}

/**
 * Один кокон: веретено из двух усечённых конусов, приподнятое над доской и чуть наклонённое. Белая
 * эмаль даёт шёлковый блеск: на тёмном дереве кокон читается вещью, а не пятном. x, y — середина,
 * z — поверхность доски.
 */
function cocoon(xf: Xf, x: number, y: number, z: number, len: number, r: number, lean: number, shade: number): void {
  const half = len / 2;
  const top = xf.child(x, y, z + r * 1.1, 0);
  // Наклон — сдвигом верхней половины: конусы у Xf стоят по осям.
  const dx = Math.sin(lean) * half;
  const tint: Vec3 = [COCOON[0] * shade, COCOON[1] * shade, COCOON[2] * shade];
  // Низ кокона в тени доски и соседей: AO не даёт ему стать плоским белым пятном.
  top.cyl([0, -half, 0], 'y', half, r * 0.35, MAT.enamel, { tint, radiusEnd: r, segments: 7, caps: true, ao: 0.6 });
  top.cyl([dx, 0, 0], 'y', half, r, MAT.enamel, { tint, radiusEnd: r * 0.3, segments: 7, caps: true, ao: 0.85 });
}

/**
 * Щит из тёмных досок (2,4 м шириной, высотой до 2,2 м) и коконы на нём. Низ щита — y = 0, спина — z = 0.
 * Доски и места гроздей — от сида, поэтому круг за кругом гроздья растут там же: новый круг добавляет
 * коконы к прежним, а не раскладывает их заново. Возвращает, сколько коконов на щите.
 */
export function cocoonPanel(xf: Xf, seed: number, wear: number, height: number = COCOON_PANEL.h): number {
  return asGrowth(xf, () => buildPanel(xf, seed, wear, height));
}

function buildPanel(xf: Xf, seed: number, wear: number, height: number): number {
  const r = rng(seed);
  const W = COCOON_PANEL.w;
  const H = Math.min(COCOON_PANEL.h, height);
  // Доски встык и одной толщины: щель насквозь показала бы светлую стену, а ступенька между досками
  // рисует на точках светлый контур. Соседние доски — разного тона.
  const T = 0.022;
  const boards = 9;
  const bw = W / boards;
  for (let i = 0; i < boards; i++) {
    const x0 = -W / 2 + i * bw;
    const tint = PLANK[(i * 2 + Math.floor(r() * 2)) % PLANK.length]!;
    xf.box([x0, 0, 0], [x0 + bw, H, T], MAT.wood, { tint, skip: ['nz'], aoBottom: 0.7 });
  }
  const n = cocoonCount(wear);
  let made = 0;
  // Гроздья: место грозди случайное, в грозди 4–18 коконов вплотную, вразнобой по наклону. Порядок
  // раскладки от круга не зависит — растёт только то, сколько из неё уже выросло.
  while (made < n) {
    const gx = -W / 2 + 0.18 + r() * (W - 0.36);
    const gy = 0.4 + r() * (H - 0.7);
    const k = 4 + Math.floor(r() * r() * 15);
    for (let j = 0; j < k; j++) {
      const a = r() * Math.PI * 2;
      const d = j === 0 ? 0 : 0.035 * Math.sqrt(j) * (0.8 + 0.4 * r());
      const len = 0.12 + 0.07 * r();
      const rad = 0.02 + 0.008 * r();
      const lean = (r() - 0.5) * 0.9;
      const jitter = r();
      if (made >= n) continue;
      // По возрасту: что выросло раньше, то серее; последние на этом круге — самые белые.
      const shade = (0.6 + 0.38 * (made / Math.max(1, n - 1))) * (0.92 + 0.08 * jitter);
      cocoon(xf, gx + Math.cos(a) * d, gy + Math.sin(a) * d * 1.4, T + 0.002, len, rad, lean, shade);
      made += 1;
    }
  }
  return made;
}

// ───────────────────────────── рубец ─────────────────────────────

// Серо-бурая масса, как на снимке, не чёрная: под фонарём должен читаться рельеф. Оттенок множится на
// цвет грязи (он сам тёмный, а рельеф у него самый глубокий из материалов) — поэтому множители больше единицы.
const SCAR_DARK: Vec3 = [1.05, 1.0, 0.9];
const SCAR_LIGHT: Vec3 = [1.7, 1.6, 1.4];

/**
 * Насколько зарос стык в точке, 0..1: фронт идёт от места origin и с кругами уходит всё дальше.
 * dist — расстояние от origin в клетках, wear — стёртость места. На первом круге — ноль везде.
 */
export function scarCover(dist: number, wear: number): number {
  // К концу петли фронт забирает примерно половину убежища, а не всё: рубец растёт от одного места.
  const reach = 20 * smooth(0.05, 0.9, wear);
  if (reach <= 0) return 0;
  return Math.max(0, Math.min(1, (reach - dist) / 4));
}

/** Где начинается рубец и как далеко точка мира от его начала (в клетках). */
export interface ScarField {
  origin: Vec3;
  seed: number;
  wear: number;
}

const coverAt = (f: ScarField, p: Vec3): number => scarCover((Math.abs(p[0] - f.origin[0]) + Math.abs(p[2] - f.origin[2]) + 2 * Math.abs(p[1] - f.origin[1])) / CELL, f.wear);

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/**
 * Ком массы: сплюснутый эллипсоид с неровной поверхностью (каждая вершина — своё расстояние от
 * середины). Большей частью он уходит в стену и потолок; наружу торчит наплыв. key — для шершавости.
 */
function lump(xf: Xf, c: Vec3, rad: Vec3, key: number, seed: number, tint: Vec3): number {
  const SEG = 5;
  const RINGS = 3;
  const mb = xf.mb;
  const ring: number[][] = [];
  const vert = (u: number, v: number, k: number): number => {
    const j = 0.72 + 0.56 * hash01(key * 31 + k, 0x1c, seed);
    const d: Vec3 = [Math.cos(u), Math.sin(u) * Math.cos(v), Math.sin(u) * Math.sin(v)];
    const p: Vec3 = [c[0] + rad[0] * d[0] * j, c[1] + rad[1] * d[1] * j, c[2] + rad[2] * d[2] * j];
    const n = norm([d[0] / rad[0], d[1] / rad[1], d[2] / rad[2]]);
    return mb.vertex(xf.pt(p[0], p[1], p[2]), xf.dir(n[0], n[1], n[2]), MAT.dirt, tint, 0.55 + 0.45 * Math.max(0, n[2]));
  };
  const a = vert(0, 0, 0);
  const b = vert(Math.PI, 0, 1);
  for (let i = 1; i <= RINGS; i++) {
    const row: number[] = [];
    for (let k = 0; k < SEG; k++) row.push(vert((i / (RINGS + 1)) * Math.PI, (k / SEG) * Math.PI * 2, 2 + i * SEG + k));
    ring.push(row);
  }
  // Обход: лицом наружу (u — от полюса a к полюсу b вдоль x, v — вокруг оси x).
  for (let k = 0; k < SEG; k++) {
    const k1 = (k + 1) % SEG;
    mb.tri(a, ring[0]![k]!, ring[0]![k1]!);
    mb.tri(b, ring[RINGS - 1]![k1]!, ring[RINGS - 1]![k]!);
    for (let i = 0; i + 1 < RINGS; i++) {
      mb.tri(ring[i]![k]!, ring[i + 1]![k]!, ring[i + 1]![k1]!);
      mb.tri(ring[i]![k]!, ring[i + 1]![k1]!, ring[i]![k1]!);
    }
  }
  return SEG * 2 + SEG * 2 * (RINGS - 1);
}

/** Шаг сетки комьев вдоль стыка, м. */
const LUMP_STEP = 0.36;

export interface ScarLump {
  /** Середина кома в координатах участка. */
  at: Vec3;
  rad: Vec3;
  key: number;
  tint: Vec3;
  /** Мировая координата вдоль стены (для проверок стыка). */
  s: number;
}

/**
 * Где на участке стены комья рубца. Комья стоят по общей мировой сетке вдоль стены (шаг LUMP_STEP с
 * разбросом): у соседних участков одной стены сетка та же, и каждый ком достаётся ровно одному из них —
 * на границе участков нет ни двойных комьев, ни дыры. Противоположные стены — разные линии, разный шум.
 */
export function scarLumps(s: Pick<Slot, 'xf' | 'cornerL' | 'cornerR'>, h: number, field: ScarField): ScarLump[] {
  const xf = s.xf;
  const x0 = s.cornerL ? -(CELL / 2 - 0.15) : -CELL / 2;
  const x1 = s.cornerR ? CELL / 2 - 0.15 : CELL / 2;
  const o = xf.pt(0, h, 0);
  const ax = sub(xf.pt(1, h, 0), o);
  const alongX = Math.abs(ax[0]) > 0.5;
  const sign = alongX ? Math.sign(ax[0]) : Math.sign(ax[2]);
  const s0 = alongX ? o[0] : o[2];
  // Линия стены: по ней выбирается шум (своя у каждой стены).
  const line = Math.round((alongX ? o[2] : o[0]) * 10) * 7 + Math.round(o[1] * 10);
  const sa = Math.min(s0 + sign * x0, s0 + sign * x1);
  const sb = Math.max(s0 + sign * x0, s0 + sign * x1);
  const out: ScarLump[] = [];
  for (let k = Math.floor(sa / LUMP_STEP) - 1; k <= Math.ceil(sb / LUMP_STEP) + 1; k++) {
    const key = k * 977 + line * 7;
    // Разброс почти во весь шаг: комья не ложатся бусами.
    const sk = (k + 0.5 + (hash01(key, 0x2c, field.seed ^ 0x5d0) - 0.5) * 0.9) * LUMP_STEP;
    // Половина открыта: ком на самой границе достаётся одному участку.
    if (sk < sa || sk >= sb) continue;
    const x = (sk - s0) * sign;
    if (x < x0 + 0.04 || x > x1 - 0.04) continue;
    const cov = coverAt(field, xf.pt(x, h, 0));
    const hx = hash01(key, 0x2a, field.seed ^ 0x5d0);
    const size = 0.5 + 0.5 * hash01(key, 0x2b, field.seed ^ 0x5d0);
    // Пятнами: стык по полтора метра то зарос, то чист; ближе к началу фронта — гуще.
    const patch = hash01(Math.floor(sk / 1.5), line, field.seed ^ 0x5d1) < 0.3 + 0.45 * cov;
    if (!patch || cov <= 0.08 || hx >= 0.3 + 0.65 * cov) continue;
    const q = cov * size;
    const rad: Vec3 = [0.1 + 0.18 * q, 0.05 + 0.14 * q * (0.6 + 0.8 * hx), 0.04 + 0.12 * q];
    out.push({ at: [x, h - rad[1] * 0.25, rad[2] * 0.2], rad, key, tint: hx < 0.35 ? SCAR_LIGHT : SCAR_DARK, s: sk });
  }
  return out;
}

/**
 * Рубец на участке стены (слот: начало — середина стены у пола, x вдоль стены, +z в комнату):
 * наплывы-комья в стыке с потолком на высоте h. Сколько их и какие — от того, как далеко фронт (field),
 * и от мировой координаты вдоль стены: соседние участки одной стены не повторяют друг друга, и
 * противоположные стены тоже. В углу на конце +x, где заросло больше чем наполовину, масса сползает
 * вниз комьями. Возвращает число треугольников (0 — здесь пока чисто).
 *
 * Сплошного валика под комьями нет: он читался ровным карнизом, а комья, сомкнувшись, и так дают массу.
 */
export function scarAlong(s: Pick<Slot, 'xf' | 'cornerL' | 'cornerR'>, h: number, field: ScarField): number {
  return asGrowth(s.xf, () => buildScar(s, h, field));
}

function buildScar(s: Pick<Slot, 'xf' | 'cornerL' | 'cornerR'>, h: number, field: ScarField): number {
  const xf = s.xf;
  // Участок — грань стены между углами (±1,35 от середины клетки). Где угла нет, стена идёт дальше в
  // соседнюю клетку: рубец тянется до границы клетки (±1,5) и встречает соседний участок в той же точке.
  const x0 = s.cornerL ? -(CELL / 2 - 0.15) : -CELL / 2;
  const x1 = s.cornerR ? CELL / 2 - 0.15 : CELL / 2;
  if (Math.max(coverAt(field, xf.pt(x0, h, 0)), coverAt(field, xf.pt(x1, h, 0))) <= 0.02) return 0;
  let tris = 0;

  // Наплывы: комья разного размера вдоль стыка — по ним рубец и читается массой, а не карнизом.
  for (const l of scarLumps(s, h, field)) tris += lump(xf, l.at, l.rad, l.key, field.seed, l.tint);

  // В углу (конец +x): масса сползает вниз по стыку двух стен комьями, всё мельче — не в каждом углу,
  // а примерно в половине. Каждый угол достаётся одному участку.
  const cov = coverAt(field, xf.pt(x1, h, 0));
  const corner = xf.pt(x1, h, 0);
  const ck = Math.round(corner[0] * 10) * 131 + Math.round(corner[2] * 10);
  if (s.cornerR && cov > 0.45 && hash01(ck, 0x2f, field.seed ^ 0x5ce) < 0.55) {
    const X = x1;
    // Потёк — не столб во всю высоту: от трети до двух третей стены.
    const len = (h - 0.35) * smooth(0.45, 1, cov) * (0.3 + 0.4 * hash01(ck, 0x2d, field.seed ^ 0x5ce));
    let y = h - 0.05;
    let i = 0;
    while (y > h - len) {
      const u = (h - y) / Math.max(0.01, len);
      const q = hash01(ck + i, 0x2e, field.seed ^ 0x5cf);
      const r = (0.05 + 0.1 * q) * (1 - 0.7 * u) * (0.6 + 0.4 * cov);
      const rad: Vec3 = [r, r * (1.6 + 0.9 * q), r];
      tris += lump(xf, [X - r * 0.35, y - rad[1] * 0.5, r * 0.35], rad, ck + i, field.seed, q < 0.35 ? SCAR_LIGHT : SCAR_DARK);
      y -= rad[1] * (1.1 + 0.5 * q);
      i += 1;
    }
  }
  return tris;
}

// ───────────────────────────── проход по уровню ─────────────────────────────

/** Техническая часть убежища: отсюда идёт рубец. */
const SCAR_FROM: ReadonlySet<string> = new Set(['fvu', 'diesel', 'tanks', 'switchboard']);
/** Где в зале ожидания щит с коконами: на тёмном дереве кассы и буфета. */
const COCOON_ROOMS: ReadonlySet<string> = new Set(['tickets', 'buffet']);
/** Запасные помещения для щита, если в кассе и буфете стены заняты. */
const COCOON_SPARE = ['storage', 'lockers', 'corridor'] as const;

/** Участок стены: середина у пола и нормаль в помещение (для кадров и отладки). */
export interface WallMark {
  at: Vec3;
  n: Vec3;
  /** Точка, на которую стоит смотреть (у рубца — верх угла). */
  look?: Vec3;
}

export interface GrowthStats {
  /** Треугольников рубца на уровне. */
  scar: number;
  /** Щитов и коконов на них. */
  panels: number;
  cocoons: number;
  /** Где щиты. */
  panelsAt?: WallMark[];
  /** Угол, ближайший к началу рубца, где масса уже сползла вниз (если сползла). */
  scarAt?: WallMark;
}

const markOf = (s: Slot): WallMark => {
  const o = s.xf.pt(0, 0, 0);
  return { at: o, n: sub(s.xf.pt(0, 0, 1), o) };
};

/**
 * Последний проход сборки уровня: своё стирание места. Слоты, на которые встал щит, помечаются
 * занятыми (туда вещь уже не вернётся «в другом месте»); щит стоит на любом круге, растут только коконы.
 */
export function growWear(world: WorldKind, seed: number, wear: number, rooms: readonly { room: GenRoom; ctx: RoomCtx }[], start: { cx: number; cz: number }): GrowthStats {
  const stats: GrowthStats = { scar: 0, panels: 0, cocoons: 0 };
  if (world === 'station') {
    // Щит — на свободном участке стены кассы и буфета; если там всё занято — в кладовой, у ячеек или в
    // переходе к перрону (по порядку), чтобы на уровне он был хотя бы один.
    const pickSlot = (ctx: RoomCtx): Slot | undefined => ctx.slots.filter((k) => !k.used && !k.hazard).sort((a, b) => a.cx - b.cx || a.cz - b.cz || a.dir - b.dir)[0];
    const place = (room: GenRoom, ctx: RoomCtx): boolean => {
      const s = pickSlot(ctx);
      if (!s) return false;
      s.used = true;
      stats.panels += 1;
      (stats.panelsAt ??= []).push(markOf(s));
      stats.cocoons += cocoonPanel(s.xf, hash2(seed, room.id, 0xc0c0), wear, ctx.h - 0.4);
      return true;
    };
    for (const { room, ctx } of rooms) if (COCOON_ROOMS.has(room.type)) place(room, ctx);
    for (const type of COCOON_SPARE) {
      if (stats.panels > 0) break;
      for (const { room, ctx } of rooms) if (room.type === type && place(room, ctx)) break;
    }
    return stats;
  }
  if (world !== 'shelter' || scarCover(0, wear) <= 0) return stats;
  // Начало фронта: середина технического помещения (выбор — по сиду); нет такого — самое дальнее от начала.
  const tech = rooms.filter((r) => SCAR_FROM.has(r.room.type)).sort((a, b) => a.room.id - b.room.id);
  const far = (r: GenRoom): number => Math.min(...r.cells.map(([x, z]) => Math.abs(x - start.cx) + Math.abs(z - start.cz)));
  const from = tech.length > 0 ? tech[Math.floor(hash01(seed & 0xffff, 0x5c, seed ^ 0x5ca7) * tech.length)]! : rooms.slice().sort((a, b) => far(b.room) - far(a.room) || a.room.id - b.room.id)[0];
  if (!from) return stats;
  const cs = from.ctx.cells;
  const origin: Vec3 = [cs.reduce((v, c) => v + c.xf.ox, 0) / cs.length, cs[0]!.xf.oy, cs.reduce((v, c) => v + c.xf.oz, 0) / cs.length];
  const field: ScarField = { origin, seed, wear };
  let best = Infinity;
  for (const { ctx } of rooms) {
    // Под небом потолка нет — и стыка нет.
    if (ctx.sky) continue;
    for (const s of ctx.slots) {
      stats.scar += scarAlong(s, ctx.h, field);
      const end = s.xf.pt(CELL / 2 - 0.15, ctx.h, 0);
      const d = Math.abs(end[0] - origin[0]) + Math.abs(end[2] - origin[2]) + 2 * Math.abs(end[1] - origin[1]);
      if (s.cornerR && coverAt(field, end) > 0.9 && d < best) {
        best = d;
        stats.scarAt = { ...markOf(s), look: end };
      }
    }
  }
  return stats;
}
