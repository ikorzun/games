/**
 * Вид предметов на уровне: находки и батарейки собираются в одну маленькую геометрию на ярус
 * (один вызов отрисовки), которая пересобирается, когда предмет забрали.
 */
import { FINDS } from '../gen/populate';
import type { LevelItem } from '../gen/populate';
import { MeshBuilder } from './kit';
import type { MeshData } from './kit';
import { MAT } from './materials';
import { Xf } from './props';

const SHAPE = new Map(FINDS.map((f) => [f.id, f.shape]));

function drawItem(mb: MeshBuilder, it: LevelItem): void {
  // Поворот — от номера предмета: вещи лежат вразнобой, но всегда одинаково.
  const xf = new Xf(mb, null, it.x, it.y, it.z, (it.id % 4) as 0 | 1 | 2 | 3);
  if (it.type === 'battery') {
    // Две «плоские» батарейки, перемотанные изолентой.
    xf.box([-0.06, 0, -0.035], [0.06, 0.07, 0.035], MAT.paper, { bevel: 0.006, tint: [0.75, 0.3, 0.2] });
    xf.box([-0.065, 0.02, -0.04], [0.065, 0.05, 0.04], MAT.rubber, { tint: [0.4, 0.4, 0.45] });
    xf.box([-0.04, 0.07, -0.012], [-0.025, 0.085, 0.012], MAT.brass);
    xf.box([0.02, 0.07, -0.012], [0.045, 0.085, 0.012], MAT.brass);
    return;
  }
  const shape = SHAPE.get(it.find ?? '') ?? 'small';
  if (shape === 'paper') {
    xf.box([-0.11, 0, -0.15], [0.11, 0.022, 0.15], MAT.paper, { bevel: 0.004, tint: [0.75, 0.62, 0.4] });
    xf.box([-0.1, 0.022, -0.14], [0.1, 0.03, 0.14], MAT.paper, { tint: [1.05, 1.02, 0.9] });
    xf.box([-0.07, 0.03, -0.1], [0.05, 0.032, -0.085], MAT.rubber, { tint: [0.5, 0.5, 0.5] });
    xf.box([-0.07, 0.03, -0.06], [0.07, 0.032, -0.05], MAT.rubber, { tint: [0.5, 0.5, 0.5] });
  } else if (shape === 'bag') {
    xf.box([-0.12, 0, -0.08], [0.12, 0.2, 0.08], MAT.canvas, { bevel: 0.03, tint: [0.95, 0.95, 0.8] });
    xf.box([-0.12, 0.13, 0.08], [0.12, 0.2, 0.088], MAT.canvas, { tint: [0.75, 0.75, 0.62] });
    xf.box([-0.015, 0.11, 0.088], [0.015, 0.14, 0.098], MAT.brass);
  } else if (shape === 'device') {
    xf.box([-0.1, 0, -0.06], [0.1, 0.11, 0.06], MAT.metalGreen, { bevel: 0.012, tint: [1.2, 1.25, 1.15] });
    xf.cyl([-0.035, 0.11, 0], 'y', 0.012, 0.035, MAT.enamel, { segments: 10 });
    xf.cyl([0.055, 0.11, 0.01], 'y', 0.02, 0.013, MAT.rubber, { segments: 6 });
    xf.box([-0.1, 0.11, -0.06], [0.1, 0.118, -0.045], MAT.rubber, { tint: [0.4, 0.4, 0.4] });
  } else {
    xf.box([-0.04, 0, -0.03], [0.04, 0.03, 0.03], MAT.brass, { bevel: 0.006 });
    xf.cyl([0.045, 0.012, 0], 'y', 0.006, 0.022, MAT.steel, { segments: 8 });
  }
}

/** Геометрия оставшихся предметов яруса; null — на ярусе пусто. */
export function buildItemsMesh(items: readonly LevelItem[], tier: number, taken: ReadonlySet<number>): MeshData | null {
  const mb = new MeshBuilder();
  for (const it of items) if (it.tier === tier && !taken.has(it.id)) drawItem(mb, it);
  return mb.triangleCount > 0 ? mb.build() : null;
}
