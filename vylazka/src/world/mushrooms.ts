/**
 * Гроздь грибов: то, чем прорастает место рядом с Осыпью (systems/spores.ts). Одна сетка на все
 * места — рендер ставит её много раз, каждый раз со своим поворотом и размером.
 *
 * Грибы бледные, на тонких ножках, кучкой из одной точки, как опята: шляпки цвета кости, пластинки
 * темнее, ножки почти белые. Они неестественно высоки — самый высокий 34 см при размере 1 (в углу
 * гроздь ещё в полтора раза крупнее): знак должен читаться с края луча, а не под ногами.
 */
import type { Vec3 } from '../core/types';
import { MeshBuilder } from './kit';
import type { MeshData } from './kit';
import { MAT } from './materials';

const CAP: Vec3 = [1.18, 1.1, 0.96];
const GILL: Vec3 = [0.5, 0.44, 0.38];
const STEM: Vec3 = [1.3, 1.26, 1.16];

/** Один гриб: ножка от base до top (наклонная), шляпка-конус над ней. */
function mushroom(mb: MeshBuilder, base: Vec3, top: Vec3, capR: number, capH: number, tone: number): void {
  const SEG = 6;
  const stemR = Math.max(0.004, capR * 0.2);
  const ring = (c: Vec3, r: number): Vec3[] => Array.from({ length: SEG }, (_, i) => [c[0] + Math.cos((i / SEG) * Math.PI * 2) * r, c[1], c[2] + Math.sin((i / SEG) * Math.PI * 2) * r] as Vec3);
  const tint = (t: Vec3): Vec3 => [t[0] * tone, t[1] * tone, t[2] * tone];
  const a = ring(base, stemR * 1.25);
  const b = ring(top, stemR);
  for (let i = 0; i < SEG; i++) {
    const j = (i + 1) % SEG;
    const n: Vec3 = [Math.cos(((i + 0.5) / SEG) * Math.PI * 2), 0, Math.sin(((i + 0.5) / SEG) * Math.PI * 2)];
    mb.quadFacing(a[i]!, a[j]!, b[j]!, b[i]!, n, MAT.paper, tint(STEM), [0.6, 0.6, 1, 1]);
  }
  // Шляпка: край чуть ниже верха ножки, макушка — над ней.
  const rim = ring([top[0], top[1] - capH * 0.15, top[2]], capR);
  const peak: Vec3 = [top[0], top[1] + capH, top[2]];
  for (let i = 0; i < SEG; i++) {
    const j = (i + 1) % SEG;
    const m = ((i + 0.5) / SEG) * Math.PI * 2;
    // Скат шляпки и пластинки под ней (лицом вниз, темнее).
    mb.quadFacing(rim[i]!, rim[j]!, peak, peak, [Math.cos(m) * 0.6, 0.8, Math.sin(m) * 0.6], MAT.plaster, tint(CAP));
    mb.quadFacing(rim[j]!, rim[i]!, b[i]!, b[j]!, [Math.cos(m) * 0.2, -0.98, Math.sin(m) * 0.2], MAT.paper, tint(GILL));
  }
}

/** Гроздь из шести грибов разной высоты вокруг начала координат; низ — y = 0. */
export function mushroomCluster(): MeshData {
  const mb = new MeshBuilder();
  // [угол, вынос основания, наклон, высота, радиус шляпки, тон]
  const set: readonly (readonly [number, number, number, number, number, number])[] = [
    [0.3, 0.02, 0.05, 0.34, 0.06, 1.0],
    [1.5, 0.05, 0.11, 0.23, 0.05, 0.94],
    [2.6, 0.04, 0.09, 0.28, 0.055, 1.04],
    [3.7, 0.08, 0.16, 0.15, 0.04, 0.9],
    [4.6, 0.035, 0.12, 0.19, 0.046, 0.98],
    [5.5, 0.09, 0.18, 0.1, 0.032, 0.86],
  ];
  for (const [ang, off, lean, h, r, tone] of set) {
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    mushroom(mb, [dx * off, 0, dz * off], [dx * (off + lean), h, dz * (off + lean)], r, r * 0.75, tone);
  }
  return mb.build();
}
