import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import type { WorldKind } from '../src/gen/layout';
import { EDGE_CEIL, EDGE_CORNER, EDGE_DOOR, EDGE_FLOOR } from '../src/world/edges';
import { buildLevel, cellToWorld, tierFloor } from '../src/world/level_build';
import { CELL, DOOR_H, DOOR_W } from '../src/world/shell';

// Тихий слой (вариант A): точки по рёбрам и углам той же разметки, по которой строятся стены.
const SEED = 20041113;

describe.each(['shelter', 'office', 'yellow', 'station'] as WorldKind[])('тихий слой — %s', (world) => {
  const layout = generateLayout(SEED, 2, world);
  const level = buildLevel(layout, { wear: 0 });
  const e = level.edges!;

  it('есть на каждом ярусе; по видам — низ, верх, углы; все числа конечны; бюджет точек', () => {
    expect(e).toBeDefined();
    expect(e.count).toBe(e.tier.length);
    expect(e.pos.length).toBe(e.count * 3);
    for (const v of e.pos) expect(Number.isFinite(v)).toBe(true);
    for (let t = 0; t < layout.tierCount; t++) expect(e.tier.some((x) => x === t), `ярус ${t}`).toBe(true);
    for (const k of [EDGE_FLOOR, EDGE_CEIL, EDGE_CORNER]) expect(e.kind.some((x) => x === k), `вид ${k}`).toBe(true);
    // Точек — десятки тысяч, не сотни тысяч: это лишний вызов отрисовки на телефоне, не второе облако.
    expect(e.count).toBeLessThan(40000 * layout.tierCount);
  });

  it('низ стены — у пола своего яруса, верх — у потолка; угол — от пола до потолка', () => {
    for (let i = 0; i < e.count; i++) {
      const y = e.pos[i * 3 + 1]! - tierFloor(e.tier[i]!);
      if (e.kind[i] === EDGE_FLOOR) expect(y).toBeCloseTo(0.03, 3);
      else if (e.kind[i] === EDGE_CEIL) expect(y).toBeGreaterThan(2.0);
      else if (e.kind[i] === EDGE_DOOR) expect(y).toBeLessThanOrEqual(DOOR_H + 0.031);
      else expect(y).toBeGreaterThanOrEqual(0.029);
    }
  });

  it('в дверном проёме низа стены нет: план читается с проходами', () => {
    const doors = layout.edges.filter((d) => d.kind !== 'open');
    if (doors.length === 0) return;
    let checked = 0;
    for (const d of doors) {
      const lineX = d.dir === 0 ? cellToWorld(d.cx) + CELL / 2 : cellToWorld(d.cx);
      const lineZ = d.dir === 1 ? cellToWorld(d.cz) + CELL / 2 : cellToWorld(d.cz);
      for (let i = 0; i < e.count; i++) {
        if (e.kind[i] !== EDGE_FLOOR || e.tier[i] !== d.tier) continue;
        const x = e.pos[i * 3]!;
        const z = e.pos[i * 3 + 2]!;
        const along = d.dir === 0 ? Math.abs(z - lineZ) : Math.abs(x - lineX);
        const across = d.dir === 0 ? Math.abs(x - lineX) : Math.abs(z - lineZ);
        expect(along < DOOR_W / 2 - 0.05 && across < 0.4, `точка пола в проёме ${d.tier},${d.cx},${d.cz},${d.dir}`).toBe(false);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('тот же сид — те же точки', () => {
    const again = buildLevel(generateLayout(SEED, 2, world), { wear: 0 }).edges!;
    expect(again.count).toBe(e.count);
    expect(Array.from(again.pos.slice(0, 300))).toEqual(Array.from(e.pos.slice(0, 300)));
  });
});
