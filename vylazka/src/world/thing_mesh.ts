/**
 * Сетка «вещи»: предмет из реестра реквизита, собранный вокруг начала координат, чтобы его можно
 * было ставить куда угодно, растить и рассыпать отдельно от стен.
 */
import { MeshBuilder } from './kit';
import type { MeshData } from './kit';
import { MAT } from './materials';
import { Xf } from './props';
import { PROPS } from './props_more';
import type { PropSpec } from './props_more';

let registry: Record<string, PropSpec> = PROPS;

/** Подключить полный реестр (убежище + дом). */
export function setThingRegistry(all: Record<string, PropSpec>): void {
  registry = all;
}

export interface ThingMesh {
  mesh: MeshData;
  /** Габариты: ширина, глубина, высота, м. */
  w: number;
  d: number;
  h: number;
  /** Радиус для проверки взгляда. */
  radius: number;
}

export function hasThing(kind: string): boolean {
  return kind in registry;
}

/** Собрать вещь. Незнакомое имя даёт белый кубик-болванку: игра не падает, а вещь всё равно можно найти. */
export function thingMesh(kind: string, seed: number): ThingMesh {
  const spec = registry[kind];
  const mb = new MeshBuilder();
  if (!spec) {
    mb.box([-0.13, 0, -0.13], [0.13, 0.26, 0.13], MAT.enamel, { tint: [0.9, 0.9, 0.9], bevel: 0.02 });
    return { mesh: mb.build(), w: 0.26, d: 0.26, h: 0.26, radius: 0.22 };
  }
  // У напольного и настенного спина лежит в плоскости z = 0: сдвигаем, чтобы центр был в начале координат.
  const z0 = spec.mount === 'free' ? 0 : -spec.d / 2;
  const y0 = spec.mount === 'ceiling' ? spec.h : 0;
  spec.build(new Xf(mb, null, 0, y0, z0, 0), seed);
  return { mesh: mb.build(), w: spec.w, d: spec.d, h: spec.h, radius: Math.max(0.22, (Math.hypot(spec.w, spec.d, spec.h) / 2) * 0.7) };
}
