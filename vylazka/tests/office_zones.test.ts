import { describe, expect, it } from 'vitest';
import { generateLayout, GRID } from '../src/gen/layout';
import type { RoomType } from '../src/gen/layout';

/**
 * Офис строится от приёмной вглубь (партнёр 24.11: «Пройдись по устройству офиса, перестрой его логично, как строят офисы»):
 * переговорные — у входа, отделы и комната отдыха — посередине, санузел и подсобки — дальше, кабинет руководителя — в глубине.
 */
describe('офис: зоны по глубине этажа', () => {
  const depth = (seed: number): Map<RoomType, number[]> => {
    const l = generateLayout(seed, 2, 'office');
    const out = new Map<RoomType, number[]>();
    const lift = l.rooms[l.entranceRoom]!.cells[0]!;
    for (const r of l.rooms) {
      // Глубина — расстояние по прямой от лифта до ближней клетки помещения (в клетках).
      const d = Math.min(...r.cells.map(([x, z]) => Math.abs(x - lift[0]) + Math.abs(z - lift[1])));
      out.set(r.type, [...(out.get(r.type) ?? []), d / GRID]);
    }
    return out;
  };
  const mean = (type: RoomType): number => {
    const all: number[] = [];
    for (let s = 1; s <= 60; s++) all.push(...(depth(s * 131).get(type) ?? []));
    return all.reduce((a, b) => a + b, 0) / Math.max(1, all.length);
  };

  it('переговорные ближе к входу, чем отделы; кабинет руководителя и подсобки — дальше отделов', () => {
    const meeting = mean('meeting');
    const cubicles = mean('cubicles');
    expect(meeting).toBeLessThan(cubicles);
    expect(mean('manager')).toBeGreaterThan(cubicles);
    expect(mean('server')).toBeGreaterThan(meeting);
    expect(mean('washroom')).toBeGreaterThan(meeting);
  });
});
