import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setLetheStatue } from '../src/world/lethe_statue';
import { MAT } from '../src/world/materials';
import { buildPocket } from '../src/world/pockets';
import { decodeThingHq } from '../src/world/thing_hq';

const FILE = join(__dirname, '..', 'public', 'assets', 'pockets', 'lethe_statue.bin');
const ORIGIN: [number, number, number] = [0, -40, 0];

function scan(): ReturnType<typeof decodeThingHq> {
  const b = readFileSync(FILE);
  return decodeThingHq(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

describe('статуя красной комнаты — скан коры (SMK KAS1800, квиз 24.11 ночью: «Готовая модель»)', () => {
  afterEach(() => setLetheStatue(null));

  it('файл разбирается: не больше 40 тыс. треугольников, рост 2,05 м, низ подножия на полу, середина на оси', () => {
    const m = scan();
    expect(m.index.length / 3).toBeLessThanOrEqual(40000);
    expect(m.index.length / 3).toBeGreaterThan(20000);
    let lo = [Infinity, Infinity, Infinity];
    let hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.position.length; i += 3) {
      lo = lo.map((v, k) => Math.min(v, m.position[i + k]!));
      hi = hi.map((v, k) => Math.max(v, m.position[i + k]!));
    }
    expect(lo[1]).toBeCloseTo(0, 2);
    expect(hi[1]).toBeCloseTo(2.05, 2);
    expect(Math.abs(lo[0]! + hi[0]!)).toBeLessThan(0.02);
    expect(Math.abs(lo[2]! + hi[2]!)).toBeLessThan(0.02);
    expect(hi[0]! - lo[0]!).toBeLessThan(0.6);
    for (const v of m.normal) expect(Number.isFinite(v)).toBe(true);
  });

  it('скан пришёл — в комнате он, отдельной мраморной сеткой на низком постаменте, с преградой; нет — фигура из программы', () => {
    const plain = buildPocket('dollhouse', 7, ORIGIN);
    // Без скана: сетка комнаты (с фигурой из программы) и обводка выхода.
    expect(plain.meshes).toHaveLength(2);
    const m = scan();
    m.mat.fill(MAT.marble);
    setLetheStatue(m);
    const s = buildPocket('dollhouse', 7, ORIGIN);
    // Сетка комнаты, скан и обводка выхода.
    expect(s.meshes.length).toBe(plain.meshes.length + 1);
    const fig = s.meshes.find((x) => x.index.length === m.index.length)!;
    expect(fig).toBeTruthy();
    let top = -Infinity;
    let bottom = Infinity;
    for (let i = 1; i < fig.position.length; i += 3) {
      top = Math.max(top, fig.position[i]!);
      bottom = Math.min(bottom, fig.position[i]!);
    }
    // Стоит на постаменте посреди комнаты, а не в полу.
    expect(bottom).toBeGreaterThan(ORIGIN[1] + 0.2);
    expect(top).toBeLessThan(ORIGIN[1] + 2.6);
    // Сквозь неё не пройти: есть преграда до верха фигуры.
    expect(s.colliders.some((b) => b.minX <= ORIGIN[0] && b.maxX >= ORIGIN[0] && b.minZ <= ORIGIN[2] && b.maxZ >= ORIGIN[2] && b.maxY >= top - 0.05 && b.minY <= ORIGIN[1] + 0.01)).toBe(true);
    // Точка взгляда — перед фигурой, вне преграды.
    const f = s.focus!;
    expect(s.colliders.some((b) => f[0] > b.minX && f[0] < b.maxX && f[1] > b.minY && f[1] < b.maxY && f[2] > b.minZ && f[2] < b.maxZ)).toBe(false);
  });
});
