import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import { DRESS_TABLES } from '../src/world/dress';
import { buildLevel } from '../src/world/level_build';
import { MAT } from '../src/world/materials';
import { PROPS } from '../src/world/props_more';
import { SIGN } from '../src/world/signs';

describe('дозаполнение помещений', () => {
  it('все надписи из таблиц существуют в атласе', () => {
    for (const list of Object.values(DRESS_TABLES.SIGNS)) {
      for (const [id] of list!) if (id !== 'poster') expect(SIGN[id], id).toBeDefined();
    }
  });

  it('все предметы из таблиц есть в реестре и годятся по способу крепления', () => {
    const missing: string[] = [];
    for (const list of Object.values(DRESS_TABLES.FLOOR)) {
      for (const [name] of list!) {
        const p = PROPS[name];
        if (!p) missing.push(name);
        else expect(p.mount, name).not.toBe('ceiling');
      }
    }
    for (const list of [DRESS_TABLES.CEILING, ...Object.values(DRESS_TABLES.ALONG)]) {
      for (const [name] of list!) {
        const p = PROPS[name];
        if (!p) missing.push(name);
        else expect(p.mount, name).toBe('ceiling');
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it('уровень с надписями: листы знаков есть, шахта лестницы остаётся голой, сборка повторяема', () => {
    const a = buildLevel(generateLayout(20041113, 3));
    const b = buildLevel(generateLayout(20041113, 3));
    let signs = 0;
    for (let i = 0; i < a.chunks.length; i++) {
      const m = a.chunks[i]!.mesh;
      expect(m.position).toEqual(b.chunks[i]!.mesh.position);
      for (const v of m.mat) if (v === MAT.print || v === MAT.stencil) signs += 1;
    }
    // Четыре вершины на знак: у дверей, на стенах, на гермодверях.
    expect(signs / 4).toBeGreaterThan(40);
    expect(a.colliders.boxes.length).toBe(b.colliders.boxes.length);
  });
});
