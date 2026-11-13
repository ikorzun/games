/**
 * «Скорлупа» уровня: из клеток 3×3 м строятся пол, потолок, стены толщиной 0,3 м с дверными
 * проёмами и коллайдеры. Стены стоят на границах клеток: панель между столбиками в узлах сетки,
 * как из деталей конструктора. Покраска двухцветная по высоте — масляная краска снизу, побелка
 * сверху, тёмная «филёнка» между ними; AO запекается в вершины (углы, плинтус, потолок).
 * Чистый TS: ту же функцию вызывает генератор и тесты.
 */
import { smoothstep } from '../core/math';
import type { Vec3 } from '../core/types';
import type { ColliderSet } from './colliders';
import type { MeshBuilder } from './kit';
import { MAT } from './materials';

/** Размер клетки, м. */
export const CELL = 3;
/** Толщина стены, м. */
export const WALL_T = 0.3;
export const DOOR_W = 1.1;
export const DOOR_H = 2.05;

export interface WallStyle {
  lower: number;
  upper: number;
  stripe: number;
  floor: number;
  ceil: number;
  lowerTint: Vec3;
  upperTint: Vec3;
  floorTint: Vec3;
  ceilTint: Vec3;
  /** Высота покраски от пола, м. */
  paintHeight: number;
}

export const STYLE_CORRIDOR: WallStyle = {
  lower: MAT.paintGreen,
  upper: MAT.plaster,
  stripe: MAT.metalGreen,
  floor: MAT.concrete,
  ceil: MAT.plaster,
  lowerTint: [1, 1, 1],
  upperTint: [0.92, 0.9, 0.84],
  floorTint: [0.8, 0.8, 0.8],
  ceilTint: [0.8, 0.78, 0.72],
  paintHeight: 1.5,
};

export const STYLE_ROOM: WallStyle = {
  ...STYLE_CORRIDOR,
  lower: MAT.paintBlue,
  stripe: MAT.rubber,
  upperTint: [0.88, 0.87, 0.82],
  paintHeight: 1.35,
};

export interface ShellCell {
  cx: number;
  cz: number;
  floorY: number;
  ceilY: number;
  /** Клетки одного помещения открыты друг другу; между разными — стена (или дверь). */
  room: number;
  style: WallStyle;
  /** Пол не строить (провал, лестничная клетка со своими ступенями). */
  noFloor?: boolean;
  noCeil?: boolean;
}

export type EdgeKind = 'wall' | 'open' | 'door' | 'none';

/** Направления: 0 — +x (восток), 1 — +z (юг), 2 — −x (запад), 3 — −z (север). */
export const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

const cellKey = (cx: number, cz: number): string => `${cx},${cz}`;

export class Shell {
  readonly cells = new Map<string, ShellCell>();
  /** Канонические ключи рёбер с дверью: «cx,cz,dir», dir — 0 (восток) или 1 (юг). */
  private readonly doors = new Set<string>();
  /** Рёбра, открытые явно: проход без двери между разными помещениями (лестничная клетка и коридор). */
  private readonly opens = new Set<string>();

  add(cell: ShellCell): void {
    this.cells.set(cellKey(cell.cx, cell.cz), cell);
  }

  get(cx: number, cz: number): ShellCell | undefined {
    return this.cells.get(cellKey(cx, cz));
  }

  private edgeKey(cx: number, cz: number, dir: number): string {
    if (dir === 2) return `${cx - 1},${cz},0`;
    if (dir === 3) return `${cx},${cz - 1},1`;
    return `${cx},${cz},${dir}`;
  }

  setDoor(cx: number, cz: number, dir: number): void {
    this.doors.add(this.edgeKey(cx, cz, dir));
  }

  setOpen(cx: number, cz: number, dir: number): void {
    this.opens.add(this.edgeKey(cx, cz, dir));
  }

  /** Что на ребре клетки (cx, cz) в сторону dir. Клетка может не существовать — тогда смотрим с другой стороны. */
  edge(cx: number, cz: number, dir: number): EdgeKind {
    const a = this.get(cx, cz);
    const d = DIRS[dir]!;
    const b = this.get(cx + d[0], cz + d[1]);
    if (!a && !b) return 'none';
    if (!a || !b) return 'wall';
    const key = this.edgeKey(cx, cz, dir);
    if (this.doors.has(key)) return 'door';
    if (this.opens.has(key)) return 'open';
    return a.room === b.room ? 'open' : 'wall';
  }
}

const isSolid = (k: EdgeKind): boolean => k === 'wall' || k === 'door';

/** AO стены по высоте: темнее у пола и под потолком. */
function wallAo(y: number, f: number, h: number): number {
  const low = 0.5 + 0.5 * smoothstep(0, 0.3, y - f);
  const high = 0.62 + 0.38 * smoothstep(0, 0.3, h - y);
  return Math.min(low, high);
}

/**
 * Вертикальная грань стены от точки a до точки b (в плане), обращённая по нормали (nx, nz).
 * Режется на полосы покраски по высоте и на три участка по длине (тень во внутренних углах).
 */
function wallFace(
  mb: MeshBuilder,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  nx: number,
  nz: number,
  cell: ShellCell,
  yFrom: number,
  yTo: number,
  aoA: number,
  aoB: number,
): void {
  const st = cell.style;
  const f = cell.floorY;
  const h = cell.ceilY;
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 1e-4 || yTo - yFrom < 1e-4) return;
  const paint = f + st.paintHeight;
  const ys = [f, f + 0.3, paint, paint + 0.03, h - 0.3, h].filter((y) => y > yFrom + 1e-4 && y < yTo - 1e-4);
  const rows = [yFrom, ...ys, yTo];
  const corner = Math.min(0.4, len / 2);
  const ts = len > 0.9 ? [0, corner / len, 1 - corner / len, 1] : [0, 1];
  const aoT = (t: number): number => (t <= 1e-6 ? aoA : t >= 1 - 1e-6 ? aoB : 1);
  const out: Vec3 = [nx, 0, nz];
  for (let r = 0; r < rows.length - 1; r++) {
    const y0 = rows[r]!;
    const y1 = rows[r + 1]!;
    const mid = (y0 + y1) / 2;
    const lower = mid < paint;
    const stripe = !lower && mid < paint + 0.03;
    const mat = lower ? st.lower : stripe ? st.stripe : st.upper;
    const tint = lower || stripe ? st.lowerTint : st.upperTint;
    for (let s = 0; s < ts.length - 1; s++) {
      const t0 = ts[s]!;
      const t1 = ts[s + 1]!;
      const x0 = ax + (bx - ax) * t0;
      const z0 = az + (bz - az) * t0;
      const x1 = ax + (bx - ax) * t1;
      const z1 = az + (bz - az) * t1;
      const a0 = wallAo(y0, f, h);
      const a1 = wallAo(y1, f, h);
      mb.quadFacing([x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], out, mat, tint, [a0 * aoT(t0), a0 * aoT(t1), a1 * aoT(t1), a1 * aoT(t0)]);
    }
  }
}

/** Пол или потолок клетки сеткой 4×4 с затенением у стен. */
function slab(mb: MeshBuilder, shell: Shell, c: ShellCell, y: number, up: boolean): void {
  const N = 4;
  const x0 = c.cx * CELL - CELL / 2;
  const z0 = c.cz * CELL - CELL / 2;
  const step = CELL / N;
  const solid = [0, 1, 2, 3].map((d) => isSolid(shell.edge(c.cx, c.cz, d)));
  const ao = (i: number, j: number): number => {
    let d = Infinity;
    if (solid[0]) d = Math.min(d, (N - i) * step);
    if (solid[2]) d = Math.min(d, i * step);
    if (solid[1]) d = Math.min(d, (N - j) * step);
    if (solid[3]) d = Math.min(d, j * step);
    return 0.5 + 0.5 * smoothstep(WALL_T / 2, 0.9, d);
  };
  const mat = up ? c.style.floor : c.style.ceil;
  const tint = up ? c.style.floorTint : c.style.ceilTint;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const p00: Vec3 = [x0 + i * step, y, z0 + j * step];
      const p10: Vec3 = [x0 + (i + 1) * step, y, z0 + j * step];
      const p11: Vec3 = [x0 + (i + 1) * step, y, z0 + (j + 1) * step];
      const p01: Vec3 = [x0 + i * step, y, z0 + (j + 1) * step];
      const a: [number, number, number, number] = [ao(i, j), ao(i + 1, j), ao(i + 1, j + 1), ao(i, j + 1)];
      mb.quadFacing(p00, p10, p11, p01, [0, up ? 1 : -1, 0], mat, tint, a);
    }
  }
}

/**
 * Построить геометрию и коллайдеры скорлупы. target — один сборщик на всё или функция, которая
 * по клетке отдаёт сборщик её чанка (комната рисуется одним вызовом и отсекается целиком).
 */
export function buildShell(shell: Shell, target: MeshBuilder | ((cell: ShellCell) => MeshBuilder), col: ColliderSet): void {
  const H = CELL / 2;
  const T = WALL_T / 2;
  const pick = typeof target === 'function' ? target : (): MeshBuilder => target;

  for (const c of shell.cells.values()) {
    const mb = pick(c);
    const x0 = c.cx * CELL - H;
    const x1 = c.cx * CELL + H;
    const z0 = c.cz * CELL - H;
    const z1 = c.cz * CELL + H;

    if (!c.noFloor) {
      slab(mb, shell, c, c.floorY, true);
      col.addBox(x0, c.floorY - 1.5, z0, x1, c.floorY, z1);
    }
    if (!c.noCeil) slab(mb, shell, c, c.ceilY, false);

    for (let dir = 0; dir < 4; dir++) {
      const kind = shell.edge(c.cx, c.cz, dir);
      const d = DIRS[dir]!;
      const other = shell.get(c.cx + d[0], c.cz + d[1]);

      // Перепады пола и потолка между открытыми клетками: вертикальные «подступёнки».
      if (kind === 'open' && other) {
        const along = dir === 0 || dir === 2;
        const bx = dir === 0 ? x1 : dir === 2 ? x0 : 0;
        const bz = dir === 1 ? z1 : dir === 3 ? z0 : 0;
        const p = (t: number, y: number): Vec3 => (along ? [bx, y, z0 + (z1 - z0) * t] : [x0 + (x1 - x0) * t, y, bz]);
        if (other.floorY < c.floorY - 1e-4) mb.quadFacing(p(0, other.floorY), p(1, other.floorY), p(1, c.floorY), p(0, c.floorY), [d[0], 0, d[1]], MAT.concrete, c.style.floorTint, [0.5, 0.5, 0.9, 0.9]);
        if (other.ceilY > c.ceilY + 1e-4) mb.quadFacing(p(0, c.ceilY), p(1, c.ceilY), p(1, other.ceilY), p(0, other.ceilY), [d[0], 0, d[1]], c.style.ceil, c.style.ceilTint, [0.9, 0.9, 0.6, 0.6]);
        continue;
      }
      if (!isSolid(kind)) continue;

      // Геометрия ребра: концы P0 → P1 вдоль касательной, грань сдвинута на полтолщины внутрь клетки.
      const alongZ = dir === 0 || dir === 2;
      const nx = -d[0];
      const nz = -d[1];
      const line = dir === 0 ? x1 : dir === 2 ? x0 : dir === 1 ? z1 : z0;
      const face = line + (alongZ ? nx : nz) * T;
      const s0 = (alongZ ? z0 : x0) + T;
      const s1 = (alongZ ? z1 : x1) - T;
      const pt = (s: number): [number, number] => (alongZ ? [face, s] : [s, face]);
      // Внутренний угол на конце: у клетки есть стена и на перпендикулярной стороне.
      const endDirs = alongZ ? [3, 1] : [2, 0];
      const ao0 = isSolid(shell.edge(c.cx, c.cz, endDirs[0]!)) ? 0.55 : 1;
      const ao1 = isSolid(shell.edge(c.cx, c.cz, endDirs[1]!)) ? 0.55 : 1;
      const f = c.floorY;
      const h = c.ceilY;

      if (kind === 'wall') {
        const a = pt(s0);
        const b = pt(s1);
        wallFace(mb, a[0], a[1], b[0], b[1], nx, nz, c, f, h, ao0, ao1);
      } else {
        // Дверь: два простенка, перемычка над проёмом, откосы и низ перемычки.
        const mid = (s0 + s1) / 2;
        const d0 = mid - DOOR_W / 2;
        const d1 = mid + DOOR_W / 2;
        const top = f + DOOR_H;
        const a = pt(s0);
        const l = pt(d0);
        const r = pt(d1);
        const b = pt(s1);
        wallFace(mb, a[0], a[1], l[0], l[1], nx, nz, c, f, h, ao0, 0.8);
        wallFace(mb, r[0], r[1], b[0], b[1], nx, nz, c, f, h, 0.8, ao1);
        wallFace(mb, l[0], l[1], r[0], r[1], nx, nz, c, top, h, 0.9, 0.9);
        // Откосы и низ перемычки строит только одна из двух клеток (у второй они бы совпали).
        if (!other || dir < 2) {
          const back = line - (alongZ ? nx : nz) * T;
          const q = (s: number, depth: number): [number, number] => (alongZ ? [depth, s] : [s, depth]);
          const jamb = (s: number, sign: number): void => {
            const p0 = q(s, face);
            const p1 = q(s, back);
            const out: Vec3 = alongZ ? [0, 0, sign] : [sign, 0, 0];
            mb.quadFacing([p0[0], f, p0[1]], [p1[0], f, p1[1]], [p1[0], top, p1[1]], [p0[0], top, p0[1]], out, MAT.concrete, [0.8, 0.8, 0.8], [0.6, 0.6, 0.8, 0.8]);
          };
          jamb(d0, 1);
          jamb(d1, -1);
          const u0 = q(d0, face);
          const u1 = q(d1, face);
          const u2 = q(d1, back);
          const u3 = q(d0, back);
          mb.quadFacing([u0[0], top, u0[1]], [u1[0], top, u1[1]], [u2[0], top, u2[1]], [u3[0], top, u3[1]], [0, -1, 0], MAT.concrete, [0.8, 0.8, 0.8], 0.7);
        }
      }

      // Коллайдеры — один раз на ребро (у стены между двумя клетками их строит клетка с меньшим направлением).
      if (other && dir >= 2) continue;
      // Вверх без запаса: стена нижней части лестничной шахты кончается ровно на уровне пола верхнего
      // яруса, и выступ над ним стал бы невидимым бортиком на кромке лестницы.
      const lo = Math.min(f, other ? other.floorY : f) - 0.5;
      const hi = Math.max(h, other ? other.ceilY : h);
      const e0 = (alongZ ? z0 : x0) - T;
      const e1 = (alongZ ? z1 : x1) + T;
      const box = (a0: number, a1: number, y0: number, y1: number): void => {
        if (alongZ) col.addBox(line - T, y0, a0, line + T, y1, a1);
        else col.addBox(a0, y0, line - T, a1, y1, line + T);
      };
      if (kind === 'wall') box(e0, e1, lo, hi);
      else {
        const mid = (s0 + s1) / 2;
        box(e0, mid - DOOR_W / 2, lo, hi);
        box(mid + DOOR_W / 2, e1, lo, hi);
        box(mid - DOOR_W / 2, mid + DOOR_W / 2, f + DOOR_H, hi);
      }
    }
  }

  // Столбики в узлах сетки: видимые грани — там, где мимо узла идёт открытый проход.
  const seen = new Set<string>();
  for (const c of shell.cells.values()) {
    for (const [ox, oz] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      const vx = c.cx + ox;
      const vz = c.cz + oz;
      const k = cellKey(vx, vz);
      if (seen.has(k)) continue;
      seen.add(k);
      // Четыре ребра из узла: на запад и восток — между северным и южным рядом, на север и юг — между западным и восточным.
      const west = shell.edge(vx - 1, vz - 1, 1);
      const east = shell.edge(vx, vz - 1, 1);
      const north = shell.edge(vx - 1, vz - 1, 0);
      const south = shell.edge(vx - 1, vz, 0);
      if (![west, east, north, south].some(isSolid)) continue;
      const px = vx * CELL - H;
      const pz = vz * CELL - H;
      const faceOf = (open: boolean, a: ShellCell | undefined, nx: number, nz: number): void => {
        if (!open || !a) return;
        const mb = pick(a);
        const x = px + nx * T;
        const z = pz + nz * T;
        // Грань столбика шириной в толщину стены, перпендикулярная нормали.
        wallFace(mb, x - nz * T, z - nx * T, x + nz * T, z + nx * T, nx, nz, a, a.floorY, a.ceilY, 0.85, 0.85);
      };
      faceOf(west === 'open', shell.get(vx - 1, vz - 1), -1, 0);
      faceOf(east === 'open', shell.get(vx, vz - 1), 1, 0);
      faceOf(north === 'open', shell.get(vx - 1, vz - 1), 0, -1);
      faceOf(south === 'open', shell.get(vx - 1, vz), 0, 1);
    }
  }
}
