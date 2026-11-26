import { beforeAll, describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import type { WorldKind } from '../src/gen/layout';
import { birdMesh } from '../src/world/bird';
import { figureMesh } from '../src/world/figure_mesh';
import { FIGURE_MATERIALS } from '../src/world/figures';
import type { MeshData } from '../src/world/kit';
import { MeshBuilder } from '../src/world/kit';
import { buildLevel } from '../src/world/level_build';
import { MAT } from '../src/world/materials';
import { FORMS, SPECIES, mushroomForm } from '../src/world/mushrooms';
import { buildPocket, POCKET_KINDS } from '../src/world/pockets';
import { ALL_PROPS } from '../src/world/props_all';
import { POSES } from '../src/world/props_people';
import { setThingRegistry, thingMesh } from '../src/world/thing_mesh';

// У каждой вершины — все каналы, ровно по одному значению, и индексы не выходят за вершины.
// Safari (iPhone) проверяет это перед каждым вызовом отрисовки и, если какого-то канала не хватает
// хоть на одну вершину, не рисует сетку целиком; Chrome молча подставляет нули. Так на телефоне
// партнёра пропадал весь зал ожидания и половина комнат убежища: плакаты и надписи (quadUv) не клали
// значение качания на ветру, и массив качания выходил короче вершин.
function problems(m: MeshData): string[] {
  const n = m.position.length / 3;
  const bad: string[] = [];
  if (!Number.isInteger(n)) bad.push(`позиций ${m.position.length} — не кратно 3`);
  if (m.normal.length !== n * 3) bad.push(`нормалей ${m.normal.length / 3} на ${n}`);
  if (m.color.length !== n * 4) bad.push(`цвета ${m.color.length / 4} на ${n}`);
  if (m.mat.length !== n) bad.push(`материала ${m.mat.length} на ${n}`);
  if (m.uv.length !== n * 2) bad.push(`uv ${m.uv.length / 2} на ${n}`);
  if (m.obj && m.obj.length !== n) bad.push(`номера предмета ${m.obj.length} на ${n}`);
  if (m.sway && m.sway.length !== n) bad.push(`качания ${m.sway.length} на ${n}`);
  if (m.index.length % 3 !== 0) bad.push(`индексов ${m.index.length} — не кратно 3`);
  let max = -1;
  for (const i of m.index) if (i > max) max = i;
  if (max >= n) bad.push(`индекс ${max} при ${n} вершинах`);
  return bad;
}

beforeAll(() => setThingRegistry(ALL_PROPS));

describe('каналы вершин сходятся с числом вершин', () => {
  it('плакат в качающейся вещи: у его вершин есть качание, как у всех', () => {
    const mb = new MeshBuilder();
    mb.sway = { from: 0, span: -1, gain: 1 };
    mb.box([0, -1, 0], [0.2, 0, 0.2], MAT.enamel);
    mb.quadUv(
      [
        [0, -0.8, 0.21],
        [0.2, -0.8, 0.21],
        [0.2, -0.2, 0.21],
        [0, -0.2, 0.21],
      ],
      [0, 0, 1, 1],
      MAT.paper,
    );
    mb.sway = null;
    const d = mb.build();
    expect(problems(d)).toEqual([]);
    expect(d.sway).toBeDefined();
    // Нижний край листа висит ниже верхнего — качается сильнее.
    const n = d.position.length / 3;
    expect(d.sway![n - 4]!).toBeGreaterThan(d.sway![n - 1]!);
  });

  for (const world of ['shelter', 'office', 'yellow', 'station'] as WorldKind[]) {
    it(`все помещения: ${world}`, () => {
      for (const seed of [20041113, 2, 7, 11]) {
        for (const rank of [1, 3] as const) {
          for (const wear of [0, 0.6]) {
            const level = buildLevel(generateLayout(seed, rank, world), { wear });
            level.chunks.forEach((c, k) => {
              expect(problems(c.mesh), `${world} сид ${seed} ранг ${rank} стёртость ${wear} кусок ${k}`).toEqual([]);
              if (c.slides) expect(problems(c.slides), `${world} сид ${seed} кусок ${k}: проекции`).toEqual([]);
            });
          }
        }
      }
    });
  }

  it('карманные пространства', () => {
    for (const kind of POCKET_KINDS) {
      for (const seed of [7, 11, 2004]) {
        buildPocket(kind, seed, [100, 0, 100]).meshes.forEach((m, k) => expect(problems(m), `${kind} сид ${seed} сетка ${k}`).toEqual([]));
      }
    }
  });

  it('вещи, грибы, птица, фигуры', () => {
    for (const kind of Object.keys(ALL_PROPS)) expect(problems(thingMesh(kind, 5).mesh), kind).toEqual([]);
    for (let f = 0; f < SPECIES.length * FORMS; f++) expect(problems(mushroomForm(f)), `гриб, форма ${f}`).toEqual([]);
    expect(problems(birdMesh())).toEqual([]);
    for (const material of FIGURE_MATERIALS) {
      for (const pose of Object.keys(POSES) as (keyof typeof POSES)[]) {
        figureMesh(POSES[pose], material, 3).pieces.forEach((p) => expect(problems(p.data), `${material} ${pose} ${p.part}`).toEqual([]));
      }
    }
  });
});
