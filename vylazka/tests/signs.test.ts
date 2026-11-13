import { describe, expect, it } from 'vitest';
import { ColliderSet } from '../src/world/colliders';
import { MeshBuilder } from '../src/world/kit';
import { MAT } from '../src/world/materials';
import { Xf } from '../src/world/props';
import { BRUSH, digitRect, packSigns, POSTERS, ROOM_LABEL, SIGN, SIGN_LIST, SIGNS_SIZE } from '../src/world/signs';

describe('атлас надписей', () => {
  it('знаки не пересекаются, лежат внутри атласа, имена не повторяются', () => {
    const ids = new Set<string>();
    for (const s of SIGN_LIST) {
      expect(s.id).toMatch(/^[a-z0-9_]+$/);
      expect(ids.has(s.id), s.id).toBe(false);
      ids.add(s.id);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.x + s.pw).toBeLessThanOrEqual(SIGNS_SIZE);
      expect(s.y + s.ph).toBeLessThanOrEqual(SIGNS_SIZE);
      expect(s.u1).toBeGreaterThan(s.u0);
      expect(s.v1).toBeGreaterThan(s.v0);
      expect(s.w).toBeGreaterThan(0.05);
    }
    for (let i = 0; i < SIGN_LIST.length; i++) {
      for (let j = i + 1; j < SIGN_LIST.length; j++) {
        const a = SIGN_LIST[i]!;
        const b = SIGN_LIST[j]!;
        const apart = a.x + a.pw <= b.x || b.x + b.pw <= a.x || a.y + a.ph <= b.y || b.y + b.ph <= a.y;
        expect(apart, `${a.id} × ${b.id}`).toBe(true);
      }
    }
  });

  it('переполнение атласа — ошибка, а не молча обрезанные надписи', () => {
    expect(() => packSigns([{ id: 'big', kind: 'poster', lines: [], pw: 600, ph: 600, w: 1 }, { id: 'big2', kind: 'poster', lines: [], pw: 600, ph: 600, w: 1 }], 1024)).toThrow();
  });

  it('у каждого рода помещения есть трафарет; плакаты и надписи от руки существуют', () => {
    for (const id of Object.values(ROOM_LABEL)) expect(SIGN[id], id).toBeDefined();
    for (const id of [...POSTERS, ...BRUSH, 'germo', 'dzg', 'arc', 'scheme', 'dial_a', 'dial_b', 'dial_c', 'attention', 'door_sector']) expect(SIGN[id], id).toBeDefined();
    // Надписи — русские: это часть места действия.
    expect(SIGN.germo!.lines[0]).toBe('ГЕРМОДВЕРЬ');
    const d = digitRect(7);
    expect(d.u0).toBeGreaterThan(SIGN.digits!.u0);
    expect(d.u1).toBeLessThanOrEqual(SIGN.digits!.u1);
  });

  it('знак на стене — лист с uv из атласа, лицом в комнату; трафарет и печать — разные материалы', () => {
    for (const rot of [0, 1, 2, 3] as const) {
      const mb = new MeshBuilder();
      new Xf(mb, new ColliderSet(), 0, 0, 0, rot).sign('germo', 0, 1.5, 0.6);
      const m = mb.build();
      expect(m.index.length).toBe(6);
      expect([...m.mat]).toEqual([MAT.stencil, MAT.stencil, MAT.stencil, MAT.stencil]);
      const s = SIGN.germo!;
      expect(Math.min(...m.uv.filter((_, i) => i % 2 === 0))).toBeCloseTo(s.u0, 5);
      expect(Math.max(...m.uv.filter((_, i) => i % 2 === 1))).toBeCloseTo(s.v1, 5);
      // Нормаль — по локальной +z, повёрнутой вместе с предметом.
      const want = new Xf(mb, null, 0, 0, 0, rot).pt(0, 0, 1);
      expect(m.normal[0]).toBeCloseTo(want[0], 5);
      expect(m.normal[2]).toBeCloseTo(want[2], 5);
    }
    const mb = new MeshBuilder();
    const xf = new Xf(mb, null, 0, 0, 0, 0);
    xf.sign('poster_mask', 0, 1.2);
    xf.floorSign('arc', 0, 0, 1);
    const m = mb.build();
    expect(m.mat[0]).toBe(MAT.print);
    expect(m.mat[4]).toBe(MAT.stencil);
    // Знак на полу смотрит вверх.
    expect(m.normal[4 * 3 + 1]).toBeCloseTo(1, 5);
    expect(() => xf.sign('no_such_sign', 0, 0)).toThrow();
  });
});
