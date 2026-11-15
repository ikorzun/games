/**
 * Виды вещи по ступеням доверия (systems/illusions.ts): настоящая → картонка → проекция → кружево.
 * Слова владельца: «Вещи возвращаются на ступень хуже». Каждая ступень — сетка «вещи» вокруг того же
 * начала координат, что у thingMesh: её ставят ровно туда, где стояла прежняя.
 *
 *  - картонка — плоский снимок вещи, стоящий на месте её передней стороны (world/flat.ts): из
 *    вещества, под фонарём отсвечивает как объёмная, сбоку — лист;
 *  - проекция — тот же снимок, но из света и на стене позади: светится сама, а свет её смывает;
 *  - кружево — та же сетка, что у настоящей, но рисуются одни рёбра (это решает рендер).
 */
import type { Vec3 } from '../core/types';
import { bake, flatten, FLAT_EYE, FLAT_RATIO, frontOf, shapeOf, STANDEE_DIST, standee } from './flat';
import { MeshBuilder } from './kit';
import { MAT } from './materials';
import { Xf } from './props';
import { thingMesh, thingSpec } from './thing_mesh';
import type { ThingMesh } from './thing_mesh';

/** Из чего сделана ступень: из вещества, из света, из нитей (как ThingLook у рендера). */
export type FormLook = 'matter' | 'light' | 'lace';

export interface FormMesh extends ThingMesh {
  look: FormLook;
}

/** Насколько проекция отстоит от стены, м: ближе — рябит со стеной, дальше — видно, что висит в воздухе. */
const LIGHT_OFF = 0.012;

/**
 * Сетка вещи на ступени form (0 — настоящая, 1 — картонка, 2 — проекция, 3 — кружево).
 * lift — на какой высоте над полом стоит начало координат вещи (у настенной — высота подвеса): снимок
 * «сделан» с высоты нагрудной камеры игрока, и для вещи на стене объектив оказывается ниже.
 */
export function formMesh(kind: string, form: number, seed: number, lift = 0): FormMesh {
  const real = thingMesh(kind, seed);
  const spec = thingSpec(kind);
  if (!spec || form <= 0) return { ...real, look: 'matter' };
  if (form >= 3) return { ...real, look: 'lace' };
  const z0 = spec.mount === 'free' ? 0 : -spec.d / 2;
  const eyeY = FLAT_EYE - lift;
  if (form === 1) {
    const mb = new MeshBuilder();
    standee(new Xf(mb, null, 0, 0, z0, 0), spec, seed, eyeY);
    return { ...real, mesh: mb.build(), look: 'matter' };
  }
  // Проекция: снимок, как у картонки, но цвет вершины — готовая картинка (свет «лампы» уже в ней),
  // материал — свет, и лежит он на стене позади вещи.
  const src = shapeOf(spec, seed);
  const plane = frontOf(src);
  const { position, tris } = flatten(src, { eye: [0, eyeY, plane + STANDEE_DIST], plane, ratio: FLAT_RATIO });
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const used = new Set<number>();
  for (const t of tris) for (let k = 0; k < 3; k++) used.add(src.index[t * 3 + k]!);
  for (const i of used) {
    x0 = Math.min(x0, position[i * 3]!);
    x1 = Math.max(x1, position[i * 3]!);
    y0 = Math.min(y0, position[i * 3 + 1]!);
    y1 = Math.max(y1, position[i * 3 + 1]!);
  }
  const mb = new MeshBuilder();
  const remap = new Map<number, number>();
  const nrm: Vec3 = [0, 0, 1];
  const vert = (i: number): number => {
    let j = remap.get(i);
    if (j === undefined) {
      const x = position[i * 3]!;
      const y = position[i * 3 + 1]!;
      const col = bake(src.mat[i]!, [src.color[i * 4]!, src.color[i * 4 + 1]!, src.color[i * 4 + 2]!], [src.normal[i * 3]!, src.normal[i * 3 + 1]!, src.normal[i * 3 + 2]!], src.color[i * 4 + 3]!);
      j = mb.vertexUv([x, y, position[i * 3 + 2]! - plane + z0 + LIGHT_OFF + FLAT_RATIO * spec.d], nrm, MAT.glow, col, 1, [(x - x0) / Math.max(1e-3, x1 - x0), (y - y0) / Math.max(1e-3, y1 - y0)]);
      remap.set(i, j);
    }
    return j;
  };
  for (const t of tris) mb.tri(vert(src.index[t * 3]!), vert(src.index[t * 3 + 1]!), vert(src.index[t * 3 + 2]!));
  return { ...real, mesh: mb.build(), look: 'light' };
}
