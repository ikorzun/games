/**
 * Белая комната (партнёр 21.11, 19:06: «абсолютно белая яркая комната с висящим металической цепью в форме знака
 * бесконечности, задевая который камеру игрока перекручивает и весь мир становится широкоугольными на 5 секунд»;
 * design.md, §37).
 *
 * Помещение не обставляется: ни мебели, ни бумаги, ни наклеек, ни мест для вещей — пустота. Белым и светящимся его делает
 * шейдер мира по коробке помещения (render: uWhiteBox), а не материал стен: так комната светится и из тёмного коридора, а
 * стены остаются стенами для всего прочего (проходы, стирание по кругам, коллайдеры).
 *
 * Посередине на уровне глаз парит цепь знаком бесконечности (лемниската Бернулли) из стальных звеньев — без цепочки к
 * потолку (партнёр 24.11: «Цепи висят знаком бесконечность по центру комнаты без вертикальной цепи, парят»); комната —
 * квадрат в две-три клетки стороной. Каждое второе звено повёрнуто на четверть оборота вокруг оси цепи, как в настоящей цепи. Цепь висит у потолка
 * (HANG_OBJ): это не вещь сна — касание её не растворяет, она уходит вместе с потолком. Качается на сквозняке, низ сильнее
 * верха. Что делает касание — game.ts (warp): камеру перекручивает, мир становится широкоугольным.
 */
import type { Vec3 } from '../core/types';
import { DX, DZ } from '../gen/layout';
import type { RoomCtx } from './furnish';
import type { MeshBuilder } from './kit';
import { MAT } from './materials';
import { hanging } from './objects';
import { CELL } from './shell';

export interface WhiteRoom {
  room: number;
  tier: number;
  /** Коробка помещения по полу, м: minX, minZ, maxX, maxZ. */
  box: [number, number, number, number];
  /** Пол и потолок, м. */
  y: [number, number];
  /** Середина прохода, через который входят (к нему смотрит лицо знака), м: x, z. Нет прохода — нет поля. */
  door?: [number, number];
  chain: WhiteChain;
}

export interface WhiteChain {
  /** Перекрестье знака — середина цепи, м. */
  at: Vec3;
  /** Куда смотрит лицо знака (единичный вектор в плоскости пола): к проходу, откуда в комнату входят. */
  face: [number, number];
  /** Полуширина знака, м. */
  a: number;
  /** Потолок над знаком, м (цепочки к нему больше нет). */
  top: number;
}

/**
 * Размеры цепи, м: a — полуширина знака (знак 2,1 м в ширину и 0,74 в высоту — под комнату 6 × 6 м), height — перекрестье над полом (на уровне
 * глаз: камера стоит в 1,42 м над полом), pitch — шаг звеньев, rx и ry — полуоси звена по середине проволоки, wire —
 * толщина проволоки (радиус).
 */
export const CHAIN = { a: 1.05, height: 1.46, pitch: 0.046, rx: 0.026, ry: 0.013, wire: 0.0058 } as const;

/** Сегменты звена: вокруг кольца и вокруг проволоки. Звено — 64 треугольника (цепь целиком — около 7,7 тысячи). */
const RING_SEG = 8;
const WIRE_SEG = 4;

/** Точка лемнискаты Бернулли с полушириной a: x — вдоль знака, y — вверх; t ∈ [0, 2π). В t = π/2 и 3π/2 — перекрестье. */
export function lemniscate(t: number, a: number): [number, number] {
  const s = Math.sin(t);
  const c = Math.cos(t);
  const d = 1 + s * s;
  return [(a * c) / d, (a * s * c) / d];
}

/** Оси знака в мире: u — вдоль знака, v — вверх, w — лицо. */
function axes(c: WhiteChain): { u: Vec3; v: Vec3; w: Vec3 } {
  const [fx, fz] = c.face;
  return { u: [fz, 0, -fx], v: [0, 1, 0], w: [fx, 0, fz] };
}

/** Точки знака в мире равномерно по длине (шаг step): середины звеньев и касательные в них. */
export function chainLoop(c: WhiteChain, step: number = CHAIN.pitch): { p: Vec3; t: Vec3 }[] {
  const { u, v } = axes(c);
  const N = 2048;
  const pts: [number, number][] = [];
  for (let i = 0; i <= N; i++) pts.push(lemniscate((i / N) * Math.PI * 2, c.a));
  const len: number[] = [0];
  for (let i = 1; i <= N; i++) len.push(len[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  const total = len[N]!;
  const n = Math.max(8, Math.round(total / step));
  const out: { p: Vec3; t: Vec3 }[] = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const want = (k / n) * total;
    while (j < N && len[j]! < want) j++;
    const f = (want - len[j - 1]!) / Math.max(1e-9, len[j]! - len[j - 1]!);
    const x = pts[j - 1]![0] + (pts[j]![0] - pts[j - 1]![0]) * f;
    const y = pts[j - 1]![1] + (pts[j]![1] - pts[j - 1]![1]) * f;
    const dx = pts[j]![0] - pts[j - 1]![0];
    const dy = pts[j]![1] - pts[j - 1]![1];
    const dl = Math.hypot(dx, dy) || 1;
    out.push({
      p: [c.at[0] + u[0] * x + v[0] * y, c.at[1] + v[1] * y, c.at[2] + u[2] * x + v[2] * y],
      t: [(u[0] * dx + v[0] * dy) / dl, (u[1] * dx + v[1] * dy) / dl, (u[2] * dx + v[2] * dy) / dl],
    });
  }
  return out;
}

/**
 * Касается ли тело игрока цепи: цилиндр тела (ось — (x, z), от ног feet до головы head) и проволока ближе радиуса тела.
 * Дёшево: знак — сотня точек.
 */
export function touchesChain(c: WhiteChain, x: number, feet: number, z: number, radius: number, head = feet + 1.75): boolean {
  const r = radius + CHAIN.rx;
  // Знак целиком дальше, чем его полуширина плюс тело, — не касается.
  if (Math.hypot(x - c.at[0], z - c.at[2]) > c.a + r) return false;
  for (const q of loopProbe(c)) {
    if (q[1] < feet || q[1] > head) continue;
    if (Math.hypot(q[0] - x, q[2] - z) < r) return true;
  }
  return false;
}

const probes = new WeakMap<WhiteChain, Vec3[]>();
function loopProbe(c: WhiteChain): Vec3[] {
  let p = probes.get(c);
  if (!p) {
    p = chainLoop(c, 0.04).map((q) => q.p);
    probes.set(c, p);
  }
  return p;
}

/** Звено: эллиптический тор с серединой c, длинной осью e1 (вдоль цепи) и второй осью e2 (плоскость кольца). */
function link(mb: MeshBuilder, c: Vec3, e1: Vec3, e2: Vec3, tint: Vec3): void {
  const n: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const { rx, ry, wire } = CHAIN;
  const first = mb.vertexCount;
  for (let i = 0; i < RING_SEG; i++) {
    const a = (i / RING_SEG) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // Наружная нормаль эллипса в плоскости кольца.
    const nx = ry * ca;
    const ny = rx * sa;
    const nl = Math.hypot(nx, ny) || 1;
    const out: Vec3 = [(e1[0] * nx + e2[0] * ny) / nl, (e1[1] * nx + e2[1] * ny) / nl, (e1[2] * nx + e2[2] * ny) / nl];
    const mid: Vec3 = [c[0] + e1[0] * rx * ca + e2[0] * ry * sa, c[1] + e1[1] * rx * ca + e2[1] * ry * sa, c[2] + e1[2] * rx * ca + e2[2] * ry * sa];
    for (let j = 0; j < WIRE_SEG; j++) {
      const b = (j / WIRE_SEG) * Math.PI * 2;
      const cb = Math.cos(b);
      const sb = Math.sin(b);
      const nn: Vec3 = [out[0] * cb + n[0] * sb, out[1] * cb + n[1] * sb, out[2] * cb + n[2] * sb];
      mb.vertex([mid[0] + nn[0] * wire, mid[1] + nn[1] * wire, mid[2] + nn[2] * wire], nn, MAT.steel, tint, 1);
    }
  }
  for (let i = 0; i < RING_SEG; i++) {
    const i1 = (i + 1) % RING_SEG;
    for (let j = 0; j < WIRE_SEG; j++) {
      const j1 = (j + 1) % WIRE_SEG;
      const a = first + i * WIRE_SEG + j;
      const b = first + i1 * WIRE_SEG + j;
      const cc = first + i1 * WIRE_SEG + j1;
      const d = first + i * WIRE_SEG + j1;
      mb.tri(a, b, cc);
      mb.tri(a, cc, d);
    }
  }
}

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Собрать цепь: один знак, без цепочки к потолку — он парит (партнёр 24.11). Возвращает число звеньев. */
export function buildChain(mb: MeshBuilder, c: WhiteChain): number {
  const { w } = axes(c);
  const tint: Vec3 = [0.86, 0.87, 0.9];
  let count = 0;
  const loop = chainLoop(c);
  loop.forEach((q, k) => {
    // Чётные звенья лежат в плоскости знака, нечётные — поперёк неё.
    const inPlane = norm(cross(w, q.t));
    link(mb, q.p, q.t, k % 2 === 0 ? inPlane : w, tint);
    count++;
  });
  return count;
}

/**
 * Обставить белую комнату: занять все участки стен (больше туда никто ничего не ставит — ни бумагу, ни наклейки) и
 * повесить цепь. Мест для вещей нет. Лицо знака — к проходу, ближайшему к началу сна по ходу (ctx.dist): с него в
 * комнату обычно и входят.
 */
export function furnishWhite(ctx: RoomCtx): WhiteRoom | null {
  if (ctx.cells.length === 0) return null;
  for (const s of ctx.slots) s.used = true;
  const xs = ctx.cells.map((c) => c.xf.ox);
  const zs = ctx.cells.map((c) => c.xf.oz);
  const floor = ctx.cells[0]!.xf.oy;
  const box: [number, number, number, number] = [Math.min(...xs) - CELL / 2, Math.min(...zs) - CELL / 2, Math.max(...xs) + CELL / 2, Math.max(...zs) + CELL / 2];
  const cx = (box[0] + box[2]) / 2;
  const cz = (box[1] + box[3]) / 2;
  // Проход, с которого входят: клетка с проходом, ближайшая к началу сна; сторона — та, где проход.
  let best: { d: number; at: [number, number] } | null = null;
  for (const c of ctx.cells) {
    (c.sides ?? []).forEach((side, d) => {
      if (side !== 'door' && side !== 'open') return;
      const dist = ctx.dist ? ctx.dist(c.cx + DX[d]!, c.cz + DZ[d]!) : 0;
      const at: [number, number] = [c.xf.ox + DX[d]! * (CELL / 2), c.xf.oz + DZ[d]! * (CELL / 2)];
      if (!best || dist < best.d) best = { d: dist, at };
    });
  }
  let face: [number, number] = [0, 1];
  const door = best as { d: number; at: [number, number] } | null;
  if (door) {
    const dx = door.at[0] - cx;
    const dz = door.at[1] - cz;
    // Лицо — по главной оси к проходу: знак стоит ровно, а не наискось.
    face = Math.abs(dx) > Math.abs(dz) ? [Math.sign(dx), 0] : [0, Math.sign(dz) || 1];
  }
  const chain: WhiteChain = { at: [cx, floor + CHAIN.height, cz], face, a: CHAIN.a, top: floor + ctx.h };
  const xf = ctx.cells[0]!.xf;
  const mb = xf.mb;
  const sway = mb.sway;
  // Знак парит посреди комнаты, ни на чём не вися: весь он едва заметно плывёт, низ чуть сильнее верха.
  mb.sway = { from: chain.at[1] + 0.9, span: -1.6, gain: 0.3 };
  try {
    hanging(xf, () => buildChain(mb, chain));
  } finally {
    mb.sway = sway;
  }
  return { room: ctx.room.id, tier: ctx.room.tier, box, y: [floor, floor + ctx.h], ...(door ? { door: door.at } : {}), chain };
}
