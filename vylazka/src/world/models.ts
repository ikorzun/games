/**
 * Готовые модели в игре: разбор записей из models_data.ts и укладка в сетку реквизита.
 * Модель уже в метрах и в координатах реквизита (пол y = 0, спина z = 0 — см. scripts/import_models.py).
 * Работает и в браузере, и в node (vitest): base64 читаем через atob.
 *
 * Кроме встроенных (KayKit, models_data.ts) — подгружаемые: полка Sand3D лежит отдельным куском сборки и
 * подключается registerModels, когда загрузится (world/sand3d.ts). У её записей ещё и материал на каждую вершину
 * (mat): дерево сиденья ложится на маткап дерева, сталь ножек — на сталь, обивка — на обивку.
 */
import type { Vec3 } from '../core/types';
import { MAT, MAT_DEFS, hexToLinear } from './materials';
import type { Xf } from './props';
import { MODEL_DATA } from './models_data';
import type { ModelRecord } from './models_data';

/**
 * Шарнир подвижной детали модели полки (scripts/import_sand3d.py): дверца — поворот вокруг оси a через точку o на угол до
 * hi, рад (знак — в какую сторону открывается); ящик — сдвиг вдоль a на путь до hi, м. Координаты — модели, как у вершин.
 */
export interface JointRec {
  k: 'r' | 'p';
  o: readonly [number, number, number];
  a: readonly [number, number, number];
  hi: number;
  w: 'door' | 'drawer';
}

/**
 * Запись модели; у вещей полки Sand3D ещё и материал игры на каждую вершину (mat: uint8, base64), а у вещей с дверцами и
 * ящиками — номер подвижной детали на вершину (part: uint8, 0 — неподвижная) и шарниры деталей (jt).
 */
export type AnyModelRecord = ModelRecord & { mat?: string; part?: string; jt?: readonly JointRec[] };

export interface DecodedModel {
  /** Позиции, м, по три числа на вершину. */
  position: Float32Array;
  /** Единичные нормали. */
  normal: Float32Array;
  /** Цвет вершины в линейном пространстве, 0…1, по три числа. */
  color: Float32Array;
  index: Uint16Array;
  /** Материал игры на вершину (номера world/materials.ts); нет — один материал на всю модель. */
  mat?: Uint8Array;
  /** Подвижная деталь вершины (1… — номер шарнира в joints, 0 — неподвижная) и шарниры: дверцы и ящики. */
  part?: Uint8Array;
  joints?: readonly JointRec[];
  min: Vec3;
  max: Vec3;
}

export interface PlaceOpts {
  /** Материал (по умолчанию бумага: ровная матовая основа, цвет даёт оттенок вершины). */
  mat?: number;
  /** Дополнительный множитель оттенка. */
  tint?: Vec3;
  /** Равномерный масштаб относительно начала координат реквизита. */
  scale?: number;
  /**
   * Опрокинуть назад, на спину (поворот на четверть вокруг оси x): верх вещи ложится к z = 0, низ уходит в +z, лицо
   * смотрит вверх — стул лежит на спинке, стол — набок, ножками в комнату. После поворота габарит такой: x — прежний,
   * y — от 0 до прежней глубины, z — от 0 до прежней высоты (вещь сдвигается так, чтобы лечь на пол у начала координат).
   */
  tip?: boolean;
  /**
   * Доворот вокруг вертикали на малый угол, радианы (после опрокидывания и масштаба, вокруг начала координат вещи): вещи в
   * ряду стоят чуть вразнобой, как расставленные руками, а не отпечатанные (куратор, «Ряд сбит, а не отпечатан»).
   */
  yaw?: number;
  /**
   * Насколько открыта каждая дверца и выдвинут каждый ящик (по порядку шарниров модели), от 0 — закрыто до 1 — до предела,
   * записанного импортом (партнёр 18.11, 12:32: «открой дверцы и ящики у шкафов»). Деталь двигается до опрокидывания,
   * масштаба и доворота — как часть самой вещи.
   */
  open?: readonly number[];
}

/** Габарит сдвинутой детали в координатах вещи (после опрокидывания, масштаба и доворота): [низ, верх]. */
export type MovedPart = [Vec3, Vec3];

/** Матрица поворота на угол th вокруг единичной оси a (правый винт), по строкам. */
function rodrigues(a: readonly [number, number, number], th: number): number[] {
  const c = Math.cos(th);
  const s = Math.sin(th);
  const t = 1 - c;
  const [x, y, z] = a;
  return [c + x * x * t, x * y * t - z * s, x * z * t + y * s, y * x * t + z * s, c + y * y * t, y * z * t - x * s, z * x * t - y * s, z * y * t + x * s, c + z * z * t];
}

const cache = new Map<string, DecodedModel>();
/** Подгруженные записи (полка Sand3D): имя → запись. */
const loaded = new Map<string, AnyModelRecord>();

/** Подключить подгруженные модели (кусок сборки пришёл): с этого момента их можно класть по имени. */
export function registerModels(records: Readonly<Record<string, AnyModelRecord>>): void {
  for (const [name, r] of Object.entries(records)) loaded.set(name, r);
}

/** Есть ли модель с таким именем — встроенная или уже подгруженная. */
export function hasModel(name: string): boolean {
  return name in MODEL_DATA || loaded.has(name);
}

function recordOf(name: string): AnyModelRecord {
  const r = MODEL_DATA[name] ?? loaded.get(name);
  if (!r) throw new Error(`нет такой модели: ${name}`);
  return r;
}
/** Таблица sRGB (0…255) → линейный, чтобы не считать степень на каждую вершину. */
const LIN = new Float32Array(256).map((_, i) => {
  const s = i / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
});

function bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Модель из данных; разбирается один раз. */
export function decodeModel(name: string): DecodedModel {
  const hit = cache.get(name);
  if (hit) return hit;
  const m = decodeRecord(recordOf(name));
  cache.set(name, m);
  return m;
}

/** Разобрать запись модели (формат models_data.ts): её же пишет лепка (tools/sculpt). */
export function decodeRecord(r: AnyModelRecord): DecodedModel {
  const pos = bytes(r.pos);
  const nrm = bytes(r.nrm);
  const col = bytes(r.col);
  const idx = bytes(r.idx);
  const pq = new Uint16Array(pos.buffer, pos.byteOffset, pos.length >> 1);
  const iq = new Uint16Array(idx.buffer, idx.byteOffset, idx.length >> 1);
  const nv = r.v;
  const position = new Float32Array(nv * 3);
  const normal = new Float32Array(nv * 3);
  const color = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    for (let k = 0; k < 3; k++) {
      position[i * 3 + k] = r.min[k]! + (pq[i * 3 + k]! / 65535) * (r.max[k]! - r.min[k]!);
      // int8: байты 128…255 — отрицательные.
      const s = nrm[i * 3 + k]!;
      normal[i * 3 + k] = (s > 127 ? s - 256 : s) / 127;
      color[i * 3 + k] = LIN[col[i * 3 + k]!]!;
    }
    const l = Math.hypot(normal[i * 3]!, normal[i * 3 + 1]!, normal[i * 3 + 2]!) || 1;
    normal[i * 3] = normal[i * 3]! / l;
    normal[i * 3 + 1] = normal[i * 3 + 1]! / l;
    normal[i * 3 + 2] = normal[i * 3 + 2]! / l;
  }
  const out: DecodedModel = { position, normal, color, index: new Uint16Array(iq), min: [...r.min], max: [...r.max] };
  if (r.mat !== undefined) {
    const mat = bytes(r.mat);
    if (mat.length !== nv) throw new Error(`материалов ${mat.length} на ${nv} вершин`);
    out.mat = mat;
  }
  if (r.part !== undefined && r.jt !== undefined) {
    const part = bytes(r.part);
    if (part.length !== nv) throw new Error(`деталей ${part.length} на ${nv} вершин`);
    out.part = part;
    out.joints = r.jt;
  }
  return out;
}

/** Габарит модели (min/max в координатах реквизита, м). */
export function modelBounds(name: string): { min: Vec3; max: Vec3 } {
  const r = recordOf(name);
  return { min: [...r.min], max: [...r.max] };
}

/** Поворот нормали на столько же четвертей оборота, что и у Xf.pt: (x, z) → (z, −x), (−x, −z), (−z, x). */
function rotNormal(n: Vec3, rot: number): Vec3 {
  if (rot === 1) return [n[2], n[1], -n[0]];
  if (rot === 2) return [-n[0], n[1], -n[2]];
  if (rot === 3) return [-n[2], n[1], n[0]];
  return n;
}

/** Цвет материала в линейном пространстве — основа, на которую делится цвет вершины. */
const BASE = new Map<number, Vec3>();
function baseOf(mat: number): Vec3 {
  let b = BASE.get(mat);
  if (!b) {
    b = hexToLinear(MAT_DEFS[mat]!.color);
    BASE.set(mat, b);
  }
  return b;
}

/**
 * Кладёт модель в сетку xf.mb. Оттенок подобран так, чтобы на выбранном материале вышел собственный цвет модели.
 * Материал — opts.mat на всю модель; не задан — свой у каждой вершины (полка Sand3D) или бумага.
 * Возвращает габариты сдвинутых деталей (открытых дверец и выдвинутых ящиков) — для их преград.
 */
export function placeModel(xf: Xf, name: string, opts: PlaceOpts = {}): MovedPart[] {
  const m = decodeModel(name);
  const one = opts.mat ?? (m.mat ? null : MAT.paper);
  const extra = opts.tint ?? [1, 1, 1];
  const s = opts.scale ?? 1;
  const first = xf.mb.vertexCount;
  const n = m.position.length / 3;
  // Опрокинутая: (x, y, z) → (x, z − zmin, ymax − y) — поворот, а не отражение, поэтому обход треугольников прежний.
  const tip = opts.tip === true;
  const z0 = m.min[2];
  const y1 = m.max[1];
  const cy = Math.cos(opts.yaw ?? 0);
  const sy = Math.sin(opts.yaw ?? 0);
  // Открытые дверцы и выдвинутые ящики: поворот (r) вокруг оси через o или сдвиг (d) — по шарниру детали.
  const moves: Array<{ r: number[] | null; o: readonly number[]; d: Vec3 } | null> = [];
  if (m.joints && m.part && opts.open) {
    m.joints.forEach((j, k) => {
      const t = Math.max(0, Math.min(1, opts.open![k] ?? 0));
      if (t <= 0) moves.push(null);
      else if (j.k === 'p') moves.push({ r: null, o: j.o, d: [j.a[0] * j.hi * t, j.a[1] * j.hi * t, j.a[2] * j.hi * t] });
      else moves.push({ r: rodrigues(j.a, j.hi * t), o: j.o, d: [0, 0, 0] });
    });
  }
  const boxes: MovedPart[] = moves.map(() => [
    [Infinity, Infinity, Infinity],
    [-Infinity, -Infinity, -Infinity],
  ]);
  for (let i = 0; i < n; i++) {
    let x = m.position[i * 3]!;
    let y = m.position[i * 3 + 1]!;
    let z = m.position[i * 3 + 2]!;
    let nx0 = m.normal[i * 3]!;
    let ny0 = m.normal[i * 3 + 1]!;
    let nz0 = m.normal[i * 3 + 2]!;
    const pi = m.part ? m.part[i]! : 0;
    const mv = pi > 0 ? (moves[pi - 1] ?? null) : null;
    if (mv) {
      if (mv.r) {
        const r = mv.r;
        const dx = x - mv.o[0]!;
        const dy = y - mv.o[1]!;
        const dz = z - mv.o[2]!;
        x = mv.o[0]! + r[0]! * dx + r[1]! * dy + r[2]! * dz;
        y = mv.o[1]! + r[3]! * dx + r[4]! * dy + r[5]! * dz;
        z = mv.o[2]! + r[6]! * dx + r[7]! * dy + r[8]! * dz;
        const a = nx0;
        const b = ny0;
        const c = nz0;
        nx0 = r[0]! * a + r[1]! * b + r[2]! * c;
        ny0 = r[3]! * a + r[4]! * b + r[5]! * c;
        nz0 = r[6]! * a + r[7]! * b + r[8]! * c;
      } else {
        x += mv.d[0];
        y += mv.d[1];
        z += mv.d[2];
      }
    }
    // Опрокидывание, масштаб, затем доворот: (x, z) → (x·cos − z·sin, x·sin + z·cos).
    const px = x * s;
    const py = tip ? (z - z0) * s : y * s;
    const pz = tip ? (y1 - y) * s : z * s;
    const ix = px * cy - pz * sy;
    const iz = px * sy + pz * cy;
    const p = xf.pt(ix, py, iz);
    if (mv) {
      const bb = boxes[pi - 1]!;
      bb[0][0] = Math.min(bb[0][0], ix);
      bb[0][1] = Math.min(bb[0][1], py);
      bb[0][2] = Math.min(bb[0][2], iz);
      bb[1][0] = Math.max(bb[1][0], ix);
      bb[1][1] = Math.max(bb[1][1], py);
      bb[1][2] = Math.max(bb[1][2], iz);
    }
    const nx = nx0;
    const ny = tip ? nz0 : ny0;
    const nz = tip ? -ny0 : nz0;
    const nn = rotNormal([nx * cy - nz * sy, ny, nx * sy + nz * cy], xf.rot);
    const mat = one ?? m.mat![i]!;
    const base = baseOf(mat);
    const tint: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) tint[k] = Math.min(2.6, Math.max(0.05, m.color[i * 3 + k]! / base[k]!)) * extra[k]!;
    xf.mb.vertex(p, nn, mat, tint, 1);
  }
  for (let i = 0; i < m.index.length; i += 3) xf.mb.tri(first + m.index[i]!, first + m.index[i + 1]!, first + m.index[i + 2]!);
  return boxes.filter((b, k) => moves[k] !== null && b[0][0] <= b[1][0]);
}
