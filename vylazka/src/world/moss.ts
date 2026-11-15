/**
 * Мох слоями (shell texturing). Ворс не лепится по ворсинке: горбик повторён несколькими слоями, каждый
 * чуть дальше наружу, и в каждом слое шейдер оставляет только те ворсинки, что до него дотянулись
 * (render/shaders.ts, vShell). Издали это мягкая кочка, вблизи — щётка.
 *
 * Приём дорог по площади точек кадра — слоёв девять, — поэтому мох растёт только кочками в ладонь-две
 * и только у воды: там, где убежище сырее всего. Это первое из «зарослей»: то, что проросло сквозь
 * место, а не вещь места — коснуться его нельзя, оно не рассыпается.
 *
 * В канале качания у вершин слоя стоит его уровень со знаком минус (ветер такие вершины не трогает):
 * 0 — основание, 1 — кончики.
 */
import { mulberry32 } from '../core/rng';
import type { Vec3 } from '../core/types';
import { MAT } from './materials';
import type { Xf } from './props';

/** Сколько слоёв у кочки и на сколько ворс выше основания, м. */
export const MOSS_SHELLS = 9;
export const MOSS_PILE = 0.034;

const RINGS = 3;
const SEG = 8;

/** Кочка мха на полу: начало — её середина на полу; r — радиус, м. */
export function mossCushion(xf: Xf, seed: number, r = 0.22): void {
  const rnd = mulberry32(seed >>> 0);
  const h = r * (0.34 + rnd() * 0.16);
  const squash = 0.75 + rnd() * 0.5;
  const turn = rnd() * Math.PI * 2;
  // Точки горбика: кольца от края к макушке, край неровный.
  const pts: { p: Vec3; n: Vec3 }[] = [];
  for (let i = 0; i < RINGS; i++) {
    const t = i / RINGS;
    const rr = r * Math.cos((t * Math.PI) / 2);
    const y = h * Math.sin((t * Math.PI) / 2);
    for (let j = 0; j < SEG; j++) {
      const a = turn + (j / SEG) * Math.PI * 2;
      const k = rr * (i === 0 ? 0.8 + rnd() * 0.4 : 0.92 + rnd() * 0.16);
      const x = Math.cos(a) * k;
      const z = Math.sin(a) * k * squash;
      const nl = Math.hypot(x / r, (y / h) * 1.4 + 0.25, z / (r * squash)) || 1;
      pts.push({ p: [x, y, z], n: [x / r / nl, ((y / h) * 1.4 + 0.25) / nl, z / (r * squash) / nl] });
    }
  }
  pts.push({ p: [0, h, 0], n: [0, 1, 0] });
  const top = pts.length - 1;
  const mb = xf.mb;
  const keep = mb.swayValue;
  for (let s = 0; s <= MOSS_SHELLS; s++) {
    const level = s / MOSS_SHELLS;
    // Основание — сплошное и тёмное; слои светлеют к кончикам.
    const tint: Vec3 = [0.16 + 0.26 * level, 0.22 + 0.36 * level, 0.1 + 0.1 * level];
    mb.swayValue = s === 0 ? null : -level;
    const ids = pts.map(({ p, n }) => {
      const q = xf.pt(p[0] + n[0] * MOSS_PILE * level, p[1] + n[1] * MOSS_PILE * level, p[2] + n[2] * MOSS_PILE * level);
      const wn = xf.dir(n[0], n[1], n[2]);
      return mb.vertex(q, wn, s === 0 ? MAT.dirt : MAT.canvas, tint, 0.45 + 0.55 * level);
    });
    for (let i = 0; i < RINGS; i++) {
      for (let j = 0; j < SEG; j++) {
        const a = i * SEG + j;
        const b = i * SEG + ((j + 1) % SEG);
        if (i + 1 < RINGS) {
          const c = (i + 1) * SEG + j;
          const d = (i + 1) * SEG + ((j + 1) % SEG);
          mb.tri(ids[a]!, ids[c]!, ids[d]!);
          mb.tri(ids[a]!, ids[d]!, ids[b]!);
        } else mb.tri(ids[a]!, ids[top]!, ids[b]!);
      }
    }
  }
  mb.swayValue = keep;
}
