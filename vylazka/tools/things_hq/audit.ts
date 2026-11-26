/**
 * Аудит вещей памяти: сколько треугольников и вершин у каждой из 16 моделей, какие материалы и откуда она.
 * Запуск: npx vite-node tools/things_hq/audit.ts  (печатает таблицу Markdown).
 */
import { ALL_PROPS } from '../../src/world/props_all';
import { setThingRegistry, thingMesh, thingSpec } from '../../src/world/thing_mesh';
import { MAT_DEFS } from '../../src/world/materials';
import { registerModels } from '../../src/world/models';
import { SAND3D_DATA } from '../../src/world/sand3d_data';
import { MEMORY_KINDS } from '../../src/world/thing_hq_meta';

registerModels(SAND3D_DATA);
setThingRegistry(ALL_PROPS);
let total = 0;
console.log('| модель | габарит, м | треугольников | вершин | материалы |');
console.log('|---|---|---|---|---|');
for (const kind of MEMORY_KINDS) {
  const tm = thingMesh(kind, 7);
  const tris = tm.mesh.index.length / 3;
  total += tris;
  const mats = new Map<number, number>();
  for (let i = 0; i < tm.mesh.index.length; i += 3) {
    const m = Math.round(tm.mesh.mat[tm.mesh.index[i]!]!);
    mats.set(m, (mats.get(m) ?? 0) + 1);
  }
  const names = [...mats.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => MAT_DEFS[m]?.name ?? String(m));
  const s = thingSpec(kind)!;
  console.log(`| \`${kind}\` | ${s.w} × ${s.h} × ${s.d} | ${tris} | ${tm.mesh.position.length / 3} | ${names.join(', ')} |`);
}
console.log(`\nвсего: ${total}`);
