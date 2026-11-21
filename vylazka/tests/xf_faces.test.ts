/**
 * Пропуск граней коробки у повёрнутого предмета. Предмет называет грань в своих осях («спина — nz»),
 * а коробка в сетке строится уже в осях мира: без пересчёта у предмета, повёрнутого к другой стене,
 * пропадала не спина, а бок или лицо. Тесты реквизита собирают предметы без поворота и этого не видят.
 */
import { describe, expect, it } from 'vitest';
import { ColliderSet } from '../src/world/colliders';
import { MeshBuilder } from '../src/world/kit';
import type { Face } from '../src/world/kit';
import { MAT } from '../src/world/materials';
import { Xf } from '../src/world/props';

const ROTS = [0, 1, 2, 3] as const;
const FACES: Record<Face, [number, number, number]> = { px: [1, 0, 0], nx: [-1, 0, 0], py: [0, 1, 0], ny: [0, -1, 0], pz: [0, 0, 1], nz: [0, 0, -1] };

/** Нормали граней коробки в мире (по одной на грань), как ключи "x,y,z". */
function faceNormals(rot: 0 | 1 | 2 | 3, skip: Face[]): Set<string> {
  const mb = new MeshBuilder();
  new Xf(mb, new ColliderSet(), 3, 0, -2, rot).box([-0.4, 0, 0], [0.6, 1, 0.3], MAT.wood, { skip });
  const m = mb.build();
  const out = new Set<string>();
  for (let i = 0; i < m.normal.length; i += 3) out.add([0, 1, 2].map((k) => Math.round(m.normal[i + k]!)).join(','));
  return out;
}

/** Направление оси предмета в мире: туда смотрит его грань после поворота. */
function turned(rot: 0 | 1 | 2 | 3, n: [number, number, number]): string {
  const xf = new Xf(new MeshBuilder(), new ColliderSet(), 0, 0, 0, rot);
  const o = xf.pt(0, 0, 0);
  const p = xf.pt(n[0], n[1], n[2]);
  return [0, 1, 2].map((k) => Math.round(p[k]! - o[k]!)).join(',');
}

describe('Xf.box: пропуск граней считается в осях предмета', () => {
  it.each(ROTS)('поворот %i: без пропусков у коробки шесть граней', (rot) => {
    expect(faceNormals(rot, []).size).toBe(6);
  });

  for (const rot of ROTS) {
    for (const face of Object.keys(FACES) as Face[]) {
      it(`поворот ${rot}: пропущена грань ${face} предмета — нет именно её, остальные пять на месте`, () => {
        const normals = faceNormals(rot, [face]);
        expect(normals.size).toBe(5);
        expect(normals.has(turned(rot, FACES[face]))).toBe(false);
        for (const other of Object.keys(FACES) as Face[]) if (other !== face) expect(normals.has(turned(rot, FACES[other])), `${other}`).toBe(true);
      });
    }
  }

  it.each(ROTS)('поворот %i: спина и низ пропущены вместе — как у шкафа у стены', (rot) => {
    const normals = faceNormals(rot, ['nz', 'ny']);
    expect(normals.size).toBe(4);
    expect(normals.has(turned(rot, FACES.nz))).toBe(false);
    expect(normals.has(turned(rot, FACES.ny))).toBe(false);
    expect(normals.has(turned(rot, FACES.pz))).toBe(true);
  });
});
