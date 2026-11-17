/**
 * Фигуры людей, которые ставит партнёр (его слова: «Фигуры людей ставит партнёр; ему нужен простой
 * инструмент»; «Да, инструмент ок, но я сам хочу руками трогать»). Фигура — шарнирный манекен
 * (world/props_people.ts) в позе, которую партнёр выгнул руками в конструкторе (tools/constructor), из своего
 * материала и с правилом места: в каких местах и помещениях, у чего, лицом куда, на какой высоте.
 *
 * Правило, а не точка в мире: план места строится из сида, и точка на одном плане ничего не значит на
 * другом. Игра ставит фигуру туда, где правило выполняется (это следующий шаг; здесь — только данные и их
 * проверка). Расстановка должна тревожить — «неестественные места и позы» (слова партнёра), поэтому у
 * правила есть «в воздухе» и «спиной в комнату».
 *
 * Материалы ведут себя по-своему (слова партнёра): дымная фигура висит в воздухе и рассеивается при
 * подходе; волосатая растворяется по анатомии — «от рук к телу».
 *
 * Чистый TS: читают игра, инструмент и тесты.
 */
import type { WorldKind } from '../gen/layout';
import type { Pose } from './props_people';

export const FIGURE_MATERIALS = ['wood', 'smoke', 'hair', 'stone', 'metal', 'coal', 'skin', 'plastic'] as const;
export type FigureMaterial = (typeof FIGURE_MATERIALS)[number];

/** У чего стоит фигура: в углу, у стены, посреди помещения, в дверном проёме, под потолком. */
export const FIGURE_ANCHORS = ['corner', 'wall', 'middle', 'door', 'ceiling'] as const;
export type FigureAnchor = (typeof FIGURE_ANCHORS)[number];

/** Куда она смотрит: в стену, в комнату, на дверь, туда, откуда придёт игрок. */
export const FIGURE_FACINGS = ['wall', 'room', 'door', 'player'] as const;
export type FigureFacing = (typeof FIGURE_FACINGS)[number];

export const FIGURE_WORLDS: readonly WorldKind[] = ['shelter', 'office', 'yellow', 'station'];

export interface FigureRule {
  /** В каких местах. */
  worlds: WorldKind[];
  /** Типы помещений (gen/layout RoomType); пусто — любые. */
  rooms: string[];
  anchor: FigureAnchor;
  facing: FigureFacing;
  /** На сколько поднят над полом, м: 0 — стоит (сидит) как в позе; больше — висит в воздухе. */
  lift: number;
  /** Сколько таких в одном месте, 1–3. */
  count: number;
}

export interface FigureSpec {
  /** Имя-ключ: [a-z0-9_], уникальное. */
  id: string;
  /** Подпись партнёра — как он сам назвал фигуру. */
  name: string;
  pose: Pose;
  material: FigureMaterial;
  rule: FigureRule;
  /** Доворот вокруг вертикали после правила «лицом куда», град. */
  yaw: number;
  /** Сдвиг от точки правила, м: x — вбок вдоль стены, z — от стены в комнату. */
  offset: [number, number];
  /**
   * Где в помещении её поставили — доли рамки помещения по x и z (0…1), как у вещей (PlacedSpec.near): игра берёт край,
   * ближайший к этой точке, а не любой по жребию; в помещении другой формы — у того же его края (партнёр 17.11:
   * «конструктор должен запоминать размещённые или передвинутые объекты для каждой комнаты»).
   */
  near?: [number, number];
  /** Кто и когда сохранил (из инструмента). */
  at?: string;
}

/** Пределы суставов: инструмент держит позу в них, проверка — тоже. */
export const LIMITS = {
  armFwd: [-80, 185],
  armOut: [-45, 175],
  armBend: [0, 150],
  armTwist: [-90, 90],
  legFwd: [-60, 140],
  legOut: [-25, 85],
  legBend: [0, 155],
  legTwist: [-60, 60],
  spine: [-35, 85],
  twist: [-70, 70],
  headPitch: [-55, 65],
  headYaw: [-85, 85],
  headRoll: [-40, 40],
  pelvisPitch: [-40, 60],
  pelvisRoll: [-35, 35],
  pelvisYaw: [-180, 180],
} as const satisfies Record<string, readonly [number, number]>;

export const ID_RE = /^[a-z0-9_]{1,40}$/;

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const within = (x: unknown, [a, b]: readonly [number, number]): boolean => num(x) && x >= a - 1e-6 && x <= b + 1e-6;

function limbOk(l: unknown, arm: boolean): boolean {
  if (!l || typeof l !== 'object') return false;
  const o = l as Record<string, unknown>;
  const lim = arm ? [LIMITS.armFwd, LIMITS.armOut, LIMITS.armBend, LIMITS.armTwist] : [LIMITS.legFwd, LIMITS.legOut, LIMITS.legBend, LIMITS.legTwist];
  return within(o.fwd, lim[0]!) && within(o.out, lim[1]!) && within(o.bend, lim[2]!) && (o.twist === undefined || within(o.twist, lim[3]!));
}

/** Поза в пределах суставов и с конечными числами. */
export function poseOk(p: unknown): p is Pose {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  const pel = o.pelvis as Record<string, unknown> | undefined;
  const head = o.head as Record<string, unknown> | undefined;
  if (!pel || !head) return false;
  if (!within(pel.pitch, LIMITS.pelvisPitch)) return false;
  if (pel.roll !== undefined && !within(pel.roll, LIMITS.pelvisRoll)) return false;
  if (pel.yaw !== undefined && !within(pel.yaw, LIMITS.pelvisYaw)) return false;
  if (pel.y !== undefined && !within(pel.y, [0, 3])) return false;
  if (pel.z !== undefined && !within(pel.z, [-1, 1])) return false;
  if (pel.back !== undefined && !within(pel.back, [-1, 1])) return false;
  if (!within(o.spine, LIMITS.spine) || (o.twist !== undefined && !within(o.twist, LIMITS.twist))) return false;
  if (!within(head.pitch, LIMITS.headPitch) || !within(head.yaw, LIMITS.headYaw) || (head.roll !== undefined && !within(head.roll, LIMITS.headRoll))) return false;
  if (o.footL !== undefined && !within(o.footL, [-40, 60])) return false;
  if (o.footR !== undefined && !within(o.footR, [-40, 60])) return false;
  return limbOk(o.armL, true) && limbOk(o.armR, true) && limbOk(o.legL, false) && limbOk(o.legR, false);
}

/** Фигура годится для игры: ключ, материал, правило и поза в пределах. Возвращает список бед (пусто — годится). */
export function figureProblems(x: unknown): string[] {
  const bad: string[] = [];
  if (!x || typeof x !== 'object') return ['не объект'];
  const f = x as Record<string, unknown>;
  if (typeof f.id !== 'string' || !ID_RE.test(f.id)) bad.push('ключ: только a–z, 0–9 и _');
  if (typeof f.name !== 'string' || f.name.trim().length === 0 || f.name.length > 80) bad.push('имя: от 1 до 80 знаков');
  if (!FIGURE_MATERIALS.includes(f.material as FigureMaterial)) bad.push('материал');
  if (!poseOk(f.pose)) bad.push('поза вне пределов суставов');
  if (!num(f.yaw) || Math.abs(f.yaw) > 360) bad.push('поворот');
  const off = f.offset as unknown;
  if (!Array.isArray(off) || off.length !== 2 || !off.every((v) => within(v, [-3, 3]))) bad.push('сдвиг');
  const near = f.near as unknown;
  if (near !== undefined && (!Array.isArray(near) || near.length !== 2 || !near.every((v) => within(v, [0, 1])))) bad.push('где в помещении: две доли от 0 до 1');
  const r = f.rule as Record<string, unknown> | undefined;
  if (!r) bad.push('правило места');
  else {
    if (!Array.isArray(r.worlds) || r.worlds.length === 0 || !r.worlds.every((w) => FIGURE_WORLDS.includes(w as WorldKind))) bad.push('места');
    if (!Array.isArray(r.rooms) || !r.rooms.every((t) => typeof t === 'string' && /^[a-z_]+$/.test(t))) bad.push('помещения');
    if (!FIGURE_ANCHORS.includes(r.anchor as FigureAnchor)) bad.push('у чего стоит');
    if (!FIGURE_FACINGS.includes(r.facing as FigureFacing)) bad.push('куда смотрит');
    if (!within(r.lift, [0, 2.6])) bad.push('высота: от 0 до 2,6 м');
    if (!Number.isInteger(r.count) || (r.count as number) < 1 || (r.count as number) > 3) bad.push('сколько: 1–3');
  }
  return bad;
}

/** Ограничить число отрезком. */
export const clampTo = (x: number, [a, b]: readonly [number, number]): number => Math.max(a, Math.min(b, x));
