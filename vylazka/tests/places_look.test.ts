import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import type { WorldKind } from '../src/gen/layout';
import { GRADE, RINGS } from '../src/game';
import { GRADE_DEFAULT, RINGS_DEFAULT } from '../src/render/grade';
import { STAR_VERT, TRAIL_FRAG, WORLD_FRAG, WORLD_VERT } from '../src/render/shaders';
import { cellToWorld, ceilTileOf, buildLevel, tierFloor } from '../src/world/level_build';
import { CEIL_TILE, MAT, MAT_DEFS } from '../src/world/materials';
import { GROWTH_OBJ, HANG_OBJ, isSpecialObj, MAX_OBJECTS } from '../src/world/objects';

/**
 * Аудит мест (16.11, docs/vylazka/audit.md): цвет камеры у каждого места свой, подвешенное к потолку
 * уходит вместе с потолком, подвесной потолок выпадает плитками, небо не тянется в выдержку.
 */
describe('цвет камеры у мест', () => {
  const WORLDS: WorldKind[] = ['shelter', 'office', 'yellow', 'station'];
  const green = (v: readonly number[]): number => v[1]! - (v[0]! + v[2]!) / 2;

  it('убежище — как было; у остальных мест свой цвет', () => {
    expect(GRADE.shelter).toEqual(GRADE_DEFAULT);
    expect(RINGS.shelter).toBe(RINGS_DEFAULT);
    for (const w of WORLDS) {
      const g = GRADE[w];
      for (const v of [...g.lo, ...g.hi]) expect(v, w).toBeGreaterThan(0.7);
      for (const v of [...g.lo, ...g.hi]) expect(v, w).toBeLessThan(1.15);
      expect(g.sat, w).toBeGreaterThan(0.6);
      expect(g.sat, w).toBeLessThanOrEqual(1);
    }
  });

  it('жёлтые комнаты держат жёлтый: цвет не снимается, тени и света тёплые', () => {
    const y = GRADE.yellow;
    expect(y.sat).toBeGreaterThanOrEqual(0.95);
    // Синий заметно слабее красного — и в тенях, и в светах.
    expect(y.lo[0] - y.lo[2]).toBeGreaterThan(0.15);
    expect(y.hi[0] - y.hi[2]).toBeGreaterThan(0.2);
  });

  it('в зале ожидания и офисе тени без болотной зелени, а у убежища она есть', () => {
    expect(green(GRADE_DEFAULT.lo)).toBeGreaterThan(0.05);
    expect(green(GRADE.station.lo)).toBeLessThan(0.01);
    expect(green(GRADE.office.lo)).toBeLessThan(0.03);
    // Зал теплее в светах, чем в тенях.
    expect(GRADE.station.hi[0] - GRADE.station.hi[2]).toBeGreaterThan(GRADE.station.lo[0] - GRADE.station.lo[2]);
  });

  it('кольца отражателя заметны только в убежище', () => {
    for (const w of ['office', 'yellow', 'station'] as const) expect(RINGS[w]).toBeLessThan(RINGS.shelter / 2);
  });
});

describe('подвесной потолок и то, что висит у потолка', () => {
  it('шаг плиток — тот же, что у рисунка потолочной плиты; плитками выпадает потолок офиса и жёлтых комнат', () => {
    const def = MAT_DEFS[MAT.ceilTile]!;
    // В слое фактуры «плитка» 8 плиток на повтор (render/detail.ts).
    expect(def.tile / 8).toBeCloseTo(CEIL_TILE, 9);
    expect(ceilTileOf('office')).toBe(CEIL_TILE);
    expect(ceilTileOf('yellow')).toBe(CEIL_TILE);
    expect(ceilTileOf('shelter')).toBe(0);
    expect(ceilTileOf('station')).toBe(0);
  });

  it('особые номера вершин не заняты вещами журнала и помещаются в текстуру состояний', () => {
    expect(MAX_OBJECTS).toBeLessThan(HANG_OBJ);
    expect(HANG_OBJ).not.toBe(GROWTH_OBJ);
    expect(Math.max(HANG_OBJ, GROWTH_OBJ)).toBeLessThan(64 * 64);
    expect(isSpecialObj(HANG_OBJ) && isSpecialObj(GROWTH_OBJ)).toBe(true);
    expect(isSpecialObj(1) || isSpecialObj(MAX_OBJECTS) || isSpecialObj(0)).toBe(false);
  });

  it('светильники офиса и убежища помечены как висящие у потолка — и висит это под потолком, в своей клетке', () => {
    for (const world of ['office', 'yellow', 'shelter'] as const) {
      const layout = generateLayout(20041113, 2, world);
      const level = buildLevel(layout);
      let hung = 0;
      for (const chunk of level.chunks) {
        const m = chunk.mesh;
        if (!m.obj) continue;
        for (let v = 0; v < m.obj.length; v++) {
          if (m.obj[v] !== HANG_OBJ) continue;
          hung += 1;
          const x = m.position[v * 3]!;
          const y = m.position[v * 3 + 1]!;
          const z = m.position[v * 3 + 2]!;
          // Высота над полом своего яруса: ярус — ближайший пол снизу.
          let tier = 0;
          while (y < tierFloor(tier) - 0.01) tier += 1;
          expect(y - tierFloor(tier), `${world}: вершина висящего на высоте ${y}`).toBeGreaterThan(1.0);
          // Вершина не дальше полуклетки от середины клетки, к которой рендер привязывает её стирание.
          const cx = Math.round(x / 3) * 3;
          const cz = Math.round(z / 3) * 3;
          expect(Math.abs(x - cx), world).toBeLessThanOrEqual(1.5);
          expect(Math.abs(z - cz), world).toBeLessThanOrEqual(1.5);
        }
      }
      expect(hung, world).toBeGreaterThan(100);
    }
    // Середины клеток — на кратных трём: стирание висящего берёт шум в середине клетки (archGone).
    for (const c of [0, 5, 8, 13]) expect(Math.abs(cellToWorld(c) % 3)).toBe(0);
  });

  it('шейдер мира знает номер висящего, стирает его вместе с потолком и выбивает подвесной потолок плитками', () => {
    expect(WORLD_VERT).toContain(`${HANG_OBJ}.0`);
    expect(WORLD_FRAG).toContain('uniform float uCeilTile;');
    expect(WORLD_FRAG).toMatch(/if \(vArch > 1\.5\)/);
    expect(WORLD_FRAG).toMatch(/ceil_ && uCeilTile > 0\.0/);
  });
});

describe('небо', () => {
  it('небо в длинную выдержку не идёт: след обрезан там, где глубина мира пуста', () => {
    expect(TRAIL_FRAG).toContain('uniform highp sampler2D tDepth;');
    expect(TRAIL_FRAG).toMatch(/texture2D\(tDepth, vUv\)\.r > 0\.99999\) was = vec3\(0\.0\)/);
  });

  it('у неба есть падающая звезда по знаку игры', () => {
    expect(STAR_VERT).toContain('uniform vec4 uFall;');
    expect(STAR_VERT).toMatch(/aStar\.w > 4\.5/);
  });
});
