/**
 * Тихий слой архитектуры — точки по рёбрам и углам (вариант A из docs/vylazka/levels.md; слова партнёра:
 * «Тихий слой, это точки по ребрам и углам, иногда пробегает сонар, чтобы игрок понимал хоть какой-то план»).
 *
 * Стены, пол и потолок могут быть не собраны: темно, не туда смотрит взгляд, место стёрто. Но план
 * держится: у каждой стены точками отмечены низ и верх, у поворота — угол от пола до потолка, у двери —
 * откосы и перемычка. Рёбра берутся из той же разметки клеток, по которой строятся стены (world/shell.ts),
 * поэтому совпадают с ними до сантиметра и не дают нового шва. Точки чуть отступают от грани внутрь
 * помещения, чтобы стена не закрывала их собой.
 *
 * Точки — неровным пунктиром: шаг с разбросом и пропуски по сиду. Ровная строчка через каждые 11 см
 * читалась бы как чертёж и повторялась бы по всем стенам (слова партнёра о стыках и повторах).
 */
import { hash01 } from '../core/rng';
import { CELL, DIRS, DOOR_H, DOOR_W, Shell, WALL_T } from './shell';
import type { EdgeKind } from './shell';

/** Чем отмечена точка: низ стены, верх стены, угол, дверной проём. По виду рендер может их различать. */
export const EDGE_FLOOR = 0;
export const EDGE_CEIL = 1;
export const EDGE_CORNER = 2;
export const EDGE_DOOR = 3;

/** Точки тихого слоя: x, y, z подряд; ярус и вид — по одному числу на точку. */
export interface EdgePoints {
  pos: Float32Array;
  tier: Uint8Array;
  kind: Uint8Array;
  count: number;
}

/** Средний шаг пунктира, м, и доля пропусков. */
export const EDGE_STEP = 0.07;
const EDGE_SKIP = 0.15;
/** Насколько точка отступает от грани внутрь помещения и от пола и потолка, м. */
const INSET = 0.03;

const isSolid = (k: EdgeKind): boolean => k === 'wall' || k === 'door';

/** Набирает точки нескольких ярусов в одни массивы. */
export class EdgeBuilder {
  private readonly p: number[] = [];
  private readonly t: number[] = [];
  private readonly k: number[] = [];
  private n = 0;

  constructor(private readonly seed: number) {}

  /** Пунктир по отрезку a → b. */
  line(ax: number, ay: number, az: number, bx: number, by: number, bz: number, tier: number, kind: number): void {
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    if (len < 1e-3) return;
    const steps = Math.max(1, Math.round(len / EDGE_STEP));
    for (let i = 0; i <= steps; i++) {
      // Сид — по самому месту точки: одна и та же стена в каждом прохождении отмечена одинаково.
      const qx = Math.round((ax + ((bx - ax) * i) / steps) * 50);
      const qz = Math.round((az + ((bz - az) * i) / steps) * 50);
      const qy = Math.round((ay + ((by - ay) * i) / steps) * 50);
      const h = hash01(qx * 7 + qy * 131, qz * 13 - qy * 17, this.seed ^ 0x3d93);
      if (h < EDGE_SKIP) continue;
      const jitter = (hash01(qx, qz + qy * 29, this.seed ^ 0x51ab) - 0.5) * 0.6;
      const f = Math.max(0, Math.min(1, (i + jitter) / steps));
      this.p.push(ax + (bx - ax) * f, ay + (by - ay) * f, az + (bz - az) * f);
      this.t.push(tier);
      this.k.push(kind);
      this.n += 1;
    }
  }

  /** Рёбра одного яруса по разметке клеток. */
  addShell(shell: Shell, tier: number): void {
    const H = CELL / 2;
    const T = WALL_T / 2;
    for (const c of shell.cells.values()) {
      const x0 = c.cx * CELL - H;
      const x1 = c.cx * CELL + H;
      const z0 = c.cz * CELL - H;
      const z1 = c.cz * CELL + H;
      const f = c.floorY + INSET;
      const h = c.ceilY - INSET;
      for (let dir = 0; dir < 4; dir++) {
        const kind = shell.edge(c.cx, c.cz, dir);
        if (!isSolid(kind)) continue;
        const d = DIRS[dir]!;
        const alongZ = dir === 0 || dir === 2;
        const nx = -d[0];
        const nz = -d[1];
        const line = dir === 0 ? x1 : dir === 2 ? x0 : dir === 1 ? z1 : z0;
        // Грань стены и точки чуть внутри помещения от неё.
        const face = line + (alongZ ? nx : nz) * (T + INSET);
        const s0 = (alongZ ? z0 : x0) + T + INSET;
        const s1 = (alongZ ? z1 : x1) - T - INSET;
        const at = (s: number): [number, number] => (alongZ ? [face, s] : [s, face]);
        const seg = (sa: number, sb: number, y: number, k: number): void => {
          const a = at(sa);
          const b = at(sb);
          this.line(a[0], y, a[1], b[0], y, b[1], tier, k);
        };
        const post = (s: number, ya: number, yb: number, k: number): void => {
          const a = at(s);
          this.line(a[0], ya, a[1], a[0], yb, a[1], tier, k);
        };
        if (kind === 'wall') seg(s0, s1, f, EDGE_FLOOR);
        else {
          // Дверь: низ стены по обе стороны проёма, откосы, перемычка.
          const mid = (s0 + s1) / 2;
          const d0 = mid - DOOR_W / 2 - INSET;
          const d1 = mid + DOOR_W / 2 + INSET;
          const top = c.floorY + DOOR_H + INSET;
          seg(s0, d0, f, EDGE_FLOOR);
          seg(d1, s1, f, EDGE_FLOOR);
          post(d0, f, top, EDGE_DOOR);
          post(d1, f, top, EDGE_DOOR);
          seg(d0, d1, top, EDGE_DOOR);
        }
        seg(s0, s1, h, EDGE_CEIL);
        // Углы на концах: поворот стены внутрь клетки (перпендикулярная стена той же клетки) или конец
        // стены (соседняя клетка вдоль неё такой стены не продолжает) — от пола до потолка.
        const ends = alongZ ? ([3, 1] as const) : ([2, 0] as const);
        for (let e = 0; e < 2; e++) {
          const side = ends[e]!;
          const inner = isSolid(shell.edge(c.cx, c.cz, side));
          const sd = DIRS[side]!;
          const next = shell.get(c.cx + sd[0], c.cz + sd[1]);
          const goesOn = next !== undefined && isSolid(shell.edge(next.cx, next.cz, dir));
          if (inner || !goesOn) post(e === 0 ? s0 : s1, f, h, EDGE_CORNER);
        }
      }
    }
  }

  build(): EdgePoints {
    return { pos: new Float32Array(this.p), tier: new Uint8Array(this.t), kind: new Uint8Array(this.k), count: this.n };
  }
}
