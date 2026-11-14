import { describe, expect, it } from 'vitest';
import { MeshBuilder } from '../src/world/kit';
import type { MeshData } from '../src/world/kit';
import { MAT } from '../src/world/materials';
import { fillStratum, pointBuffers, pointSource, splitCells, STRATA, stratumCount, stratumRoom } from '../src/world/points';
import type { PointSource } from '../src/world/points';

/** Комната 4 × 3 × 4 м: шесть прямоугольников — как помещение убежища. */
function room(): MeshData {
  const mb = new MeshBuilder();
  mb.box([0, 0, 0], [4, 3, 4], MAT.concrete);
  return mb.build();
}

/** Пол w × d м одним прямоугольником, от начала координат. */
function floor(w: number, d: number, mat: number = MAT.concrete): MeshData {
  const mb = new MeshBuilder();
  mb.quadFacing([0, 0, 0], [w, 0, 0], [w, 0, d], [0, 0, d], [0, 1, 0], mat);
  return mb.build();
}

/** Посеять все слои клетки подряд. ends — где кончается каждый слой. */
function sowCell(src: PointSource, density: number, seed = 7) {
  const buf = pointBuffers(stratumRoom(src, density) * STRATA);
  let n = 0;
  const ends: number[] = [];
  for (let k = 0; k < STRATA; k++) {
    n += fillStratum(src, k, density, seed, buf, n);
    ends.push(n);
  }
  return { src, buf, n, ends };
}

/** Посеять всю сетку одной клеткой. */
const sow = (mesh: MeshData, density: number, seed = 7) => sowCell(pointSource(mesh), density, seed);

/**
 * Доля точек, у которых сосед ближе r (в плоскости пола). У случайного посева плотности λ она равна
 * 1 − exp(−π r² λ); у ровного — заметно меньше.
 */
function crowded(buf: { position: Float32Array }, ids: number[], r: number): number {
  const cell = r;
  const grid = new Map<number, number[]>();
  const key = (cx: number, cz: number) => cx * 100003 + cz;
  for (const i of ids) {
    const k = key(Math.floor(buf.position[i * 3]! / cell), Math.floor(buf.position[i * 3 + 2]! / cell));
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  }
  let close = 0;
  for (const i of ids) {
    const x = buf.position[i * 3]!;
    const z = buf.position[i * 3 + 2]!;
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx++) {
      for (let dz = -1; dz <= 1 && !hit; dz++) {
        for (const j of grid.get(key(cx + dx, cz + dz)) ?? []) {
          if (j !== i && Math.hypot(buf.position[j * 3]! - x, buf.position[j * 3 + 2]! - z) < r) {
            hit = true;
            break;
          }
        }
      }
    }
    if (hit) close += 1;
  }
  return close / ids.length;
}

describe('посев точек по поверхностям', () => {
  it('точки лежат на поверхности сетки, нормали единичные, очередь растёт от слоя к слою', () => {
    const mesh = room();
    const { src, buf, n, ends } = sow(mesh, 400);
    expect(src.area).toBeCloseTo(2 * (4 * 4 + 4 * 3 + 4 * 3), 3);
    const per = stratumCount(src, 400);
    expect(per).toBeCloseTo((src.area * 400) / STRATA, 6);
    // Точное число точек известно только после посева; от ожидаемого оно отходит на доли процента.
    expect(Math.abs(n - per * STRATA)).toBeLessThan(per * STRATA * 0.02);
    for (let k = 0; k < STRATA; k++) expect(Math.abs(ends[k]! - (k > 0 ? ends[k - 1]! : 0) - per)).toBeLessThan(per * 0.05);
    let onWall = 0;
    let stratum = 0;
    for (let i = 0; i < n; i++) {
      while (i >= ends[stratum]!) stratum += 1;
      const x = buf.position[i * 3]!;
      const y = buf.position[i * 3 + 1]!;
      const z = buf.position[i * 3 + 2]!;
      expect(x).toBeGreaterThanOrEqual(-1e-4);
      expect(x).toBeLessThanOrEqual(4 + 1e-4);
      expect(y).toBeGreaterThanOrEqual(-1e-4);
      expect(y).toBeLessThanOrEqual(3 + 1e-4);
      expect(z).toBeGreaterThanOrEqual(-1e-4);
      expect(z).toBeLessThanOrEqual(4 + 1e-4);
      const d = Math.min(x, 4 - x, y, 3 - y, z, 4 - z);
      if (d < 1e-3) onWall += 1;
      const l = Math.hypot(buf.nrm[i * 4]!, buf.nrm[i * 4 + 1]!, buf.nrm[i * 4 + 2]!) / 127;
      expect(l).toBeGreaterThan(0.97);
      expect(l).toBeLessThan(1.03);
      const rank = buf.seed[i * 4]! / 256;
      expect(rank).toBeGreaterThanOrEqual(stratum / STRATA);
      expect(rank).toBeLessThan((stratum + 1) / STRATA);
    }
    expect(onWall).toBe(n);
  });

  it('посев одинаков от запуска к запуску; сид меняет только случайные числа точек, места — нет; слой не зависит от остальных', () => {
    const mesh = room();
    const a = sow(mesh, 200, 11);
    const b = sow(mesh, 200, 11);
    const c = sow(mesh, 200, 12);
    expect(a.n).toBe(b.n);
    expect(Array.from(a.buf.position.subarray(0, 300))).toEqual(Array.from(b.buf.position.subarray(0, 300)));
    expect(Array.from(a.buf.seed.subarray(0, 400))).toEqual(Array.from(b.buf.seed.subarray(0, 400)));
    // Места точек — свойство самой поверхности: рисунок на стене один, кто бы и когда его ни сеял.
    expect(c.n).toBe(a.n);
    expect(Array.from(c.buf.position.subarray(0, 300))).toEqual(Array.from(a.buf.position.subarray(0, 300)));
    // А разлетаются точки по-своему: случайные числа (кроме очереди) другие.
    let same = 0;
    for (let i = 0; i < 100; i++) {
      expect(c.buf.seed[i * 4]).toBe(a.buf.seed[i * 4]);
      if (c.buf.seed[i * 4 + 1] === a.buf.seed[i * 4 + 1] && c.buf.seed[i * 4 + 2] === a.buf.seed[i * 4 + 2]) same += 1;
    }
    expect(same).toBeLessThan(3);
    // Пятый слой, посеянный отдельно (так облако досевает память, отданную раньше), — тот же самый.
    const src = pointSource(mesh);
    const alone = pointBuffers(stratumRoom(src, 200));
    const count = fillStratum(src, 5, 200, 11, alone, 0);
    expect(count).toBe(a.ends[5]! - a.ends[4]!);
    expect(Array.from(alone.position.subarray(0, count * 3))).toEqual(Array.from(a.buf.position.subarray(a.ends[4]! * 3, a.ends[5]! * 3)));
  });

  it('точки делятся по площади поровну: и один слой, и все вместе', () => {
    // Пол 8 × 4 м делится на восемь клеток 2 × 2 м: в каждой должно быть поровну точек.
    const mesh = floor(8, 4);
    const { buf, n, ends } = sow(mesh, 400);
    const cell = (i: number) => Math.min(3, Math.floor(buf.position[i * 3]! / 2)) + 4 * Math.min(1, Math.floor(buf.position[i * 3 + 2]! / 2));
    const first = new Array<number>(8).fill(0);
    for (let i = 0; i < ends[0]!; i++) first[cell(i)]! += 1;
    // Один слой: около 1600 точек, по 200 на клетку. У случайного посева разброс был бы ±13 (и до ±40).
    for (const k of first) expect(Math.abs(k - 200)).toBeLessThan(14);
    const all = new Array<number>(8).fill(0);
    for (let i = 0; i < n; i++) all[cell(i)]! += 1;
    for (const k of all) expect(Math.abs(k - 1600)).toBeLessThan(40);
  });

  it('точки не слипаются: сгустков в разы меньше, чем у случайного посева, при любой доле плотности', () => {
    const mesh = floor(8, 4);
    const density = 400;
    const { buf, n } = sow(mesh, density);
    const ids = (maxRank: number) => {
      const out: number[] = [];
      for (let i = 0; i < n; i++) if (buf.seed[i * 4]! / 256 < maxRank) out.push(i);
      return out;
    };
    for (const share of [1, 0.5, 0.25, 0.125]) {
      const set = ids(share);
      // Точек — та самая доля от всех.
      expect(Math.abs(set.length - n * share)).toBeLessThan(n * share * 0.03 + 8);
      // Шаг решётки при этой плотности и «тесно» — ближе 0,3 шага.
      const step = 1 / Math.sqrt(density * share);
      const r = 0.3 * step;
      const random = 1 - Math.exp(-Math.PI * r * r * density * share);
      expect(random).toBeGreaterThan(0.24);
      expect(crowded(buf, set, r)).toBeLessThan(0.06);
    }
  });

  it('у двух половин прямоугольной стены решётка одного рисунка: точки не зависят от того, как стена разрезана', () => {
    // Плотность по обе стороны диагонали одинакова: в полосе вдоль диагонали точек столько же, сколько положено по площади.
    const mesh = floor(4, 4);
    const { buf, n } = sow(mesh, 900);
    let near = 0;
    for (let i = 0; i < n; i++) if (Math.abs(buf.position[i * 3]! - buf.position[i * 3 + 2]!) < 0.1) near += 1;
    // Полоса |x − z| < 0,1 на квадрате 4 × 4: площадь 16 − 3,9² = 0,79 м².
    const expected = (16 - 3.9 * 3.9) * 900;
    expect(Math.abs(near - expected)).toBeLessThan(expected * 0.08);
  });

  it('светящееся точек не получает', () => {
    const mb = new MeshBuilder();
    mb.quadFacing([0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2], [0, 1, 0], MAT.concrete);
    mb.quadFacing([10, 0, 0], [12, 0, 0], [12, 0, 2], [10, 0, 2], [0, 1, 0], MAT.glow);
    const mesh = mb.build();
    const { src, buf, n } = sow(mesh, 500);
    expect(src.area).toBeCloseTo(4, 4);
    expect(src.tri.length / 3).toBe(2);
    expect(Math.abs(n - 2000)).toBeLessThan(60);
    for (let i = 0; i < n; i++) expect(buf.position[i * 3]!).toBeLessThanOrEqual(2 + 1e-4);
  });

  it('мелкие треугольники не теряются: на сетке из сотен крошечных граней точек столько, сколько положено по площади', () => {
    // 400 квадратиков 5 × 5 см (как фаски и мелкие детали): на каждый приходится всего две точки.
    const mb = new MeshBuilder();
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 20; j++) {
        const x = i * 0.05;
        const z = j * 0.05;
        mb.quadFacing([x, 0, z], [x + 0.05, 0, z], [x + 0.05, 0, z + 0.05], [x, 0, z + 0.05], [0, 1, 0], MAT.concrete);
      }
    }
    const mesh = mb.build();
    const { src, buf, n, ends } = sow(mesh, 800);
    expect(src.tri.length / 3).toBe(800);
    expect(Math.abs(n - 800)).toBeLessThan(80);
    // Слои получают точки поровну — ни один не пуст.
    for (let k = 0; k < STRATA; k++) expect(ends[k]! - (k > 0 ? ends[k - 1]! : 0)).toBeGreaterThan(60);
    // И по площади ровно: в каждой четверти квадрата — около четверти точек.
    const quarters = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) quarters[(buf.position[i * 3]! < 0.5 ? 0 : 1) + (buf.position[i * 3 + 2]! < 0.5 ? 0 : 2)]! += 1;
    for (const q of quarters) expect(Math.abs(q - n / 4)).toBeLessThan(n * 0.06);
  });

  it('места в буферах хватает: запас покрывает разницу между ожидаемым и настоящим числом точек', () => {
    for (const mesh of [room(), floor(8, 4), floor(0.3, 0.2)]) {
      for (const density of [300, 600, 1100]) {
        for (const src of [pointSource(mesh), ...splitCells(mesh, 1.3)]) {
          const buf = pointBuffers(stratumRoom(src, density) * STRATA);
          let n = 0;
          for (let k = 0; k < STRATA; k++) n += fillStratum(src, k, density, 3, buf, n);
          // Буфер не упёрся в край: значит, ни одна точка не отброшена.
          expect(n).toBeLessThan(buf.position.length / 3);
          expect(n).toBeGreaterThan(stratumCount(src, density) * STRATA * 0.9 - 8);
        }
      }
    }
  });

  it('когда место кончилось, посев останавливается и за край не пишет', () => {
    const src = pointSource(floor(8, 4));
    const buf = pointBuffers(100);
    expect(fillStratum(src, 0, 400, 1, buf, 0)).toBe(100);
    expect(fillStratum(src, 1, 400, 1, buf, 100)).toBe(0);
    expect(fillStratum(src, 0, 400, 1, buf, 60)).toBe(40);
  });

  it('пустая сетка точек не даёт', () => {
    const empty = new MeshBuilder().build();
    expect(splitCells(empty, 4)).toEqual([]);
    const src = pointSource(empty);
    expect(src.area).toBe(0);
    expect(stratumCount(src, 800)).toBe(0);
    expect(stratumRoom(src, 800)).toBe(0);
    expect(fillStratum(src, 0, 800, 1, pointBuffers(10), 0)).toBe(0);
  });
});

describe('клетки: сетка режется на части, у каждой свои точки', () => {
  /** Комната 12 × 3 × 12 м из шести больших прямоугольников: каждая стена — два треугольника. */
  const hall = (): MeshData => {
    const mb = new MeshBuilder();
    mb.box([-2, 0, -2], [10, 3, 10], MAT.concrete);
    return mb.build();
  };

  it('клетки не крупнее заданного размера, а их площадь в сумме — площадь сетки', () => {
    const mesh = hall();
    const whole = pointSource(mesh);
    expect(whole.area).toBeCloseTo(2 * 144 + 4 * 36, 3);
    const cells = splitCells(mesh, 4.5);
    // 12 м делятся на три клетки по 4 м по каждой оси.
    expect(cells.length).toBe(9);
    let area = 0;
    for (const c of cells) {
      area += c.area;
      expect(c.max[0] - c.min[0]).toBeLessThanOrEqual(4 + 1e-4);
      expect(c.max[2] - c.min[2]).toBeLessThanOrEqual(4 + 1e-4);
      // По высоте клетка — вся комната.
      expect(c.min[1]).toBeCloseTo(0, 5);
      expect(c.max[1]).toBeCloseTo(3, 5);
    }
    expect(area).toBeCloseTo(whole.area, 3);
    // Серединной клетке достаются только пол и потолок (2 × 16 м²), угловой — ещё и две стены.
    const sizes = cells.map((c) => Math.round(c.area)).sort((a, b) => a - b);
    expect(sizes).toEqual([32, 44, 44, 44, 44, 56, 56, 56, 56]);
  });

  it('точки клетки лежат в её габаритах и на поверхности; всего их столько же, сколько без разрезания', () => {
    const mesh = hall();
    const cells = splitCells(mesh, 4.5);
    let total = 0;
    for (const c of cells) {
      const { buf, n } = sowCell(c, 400);
      total += n;
      expect(Math.abs(n - c.area * 400)).toBeLessThan(c.area * 400 * 0.03 + 20);
      let outside = 0;
      let offSurface = 0;
      for (let i = 0; i < n; i++) {
        const x = buf.position[i * 3]!;
        const y = buf.position[i * 3 + 1]!;
        const z = buf.position[i * 3 + 2]!;
        if (x < c.min[0] - 1e-4 || x > c.max[0] + 1e-4 || z < c.min[2] - 1e-4 || z > c.max[2] + 1e-4) outside += 1;
        // На поверхности коробки: хотя бы одна координата — на её грани.
        if (Math.min(Math.abs(x + 2), Math.abs(x - 10), Math.abs(y), Math.abs(y - 3), Math.abs(z + 2), Math.abs(z - 10)) > 1e-3) offSurface += 1;
      }
      expect(outside).toBe(0);
      expect(offSurface).toBe(0);
    }
    expect(Math.abs(total - 432 * 400)).toBeLessThan(432 * 400 * 0.01);
  });

  it('кусок разрезанной стены несёт её нормаль: точки на полу смотрят вверх, на стене — от стены', () => {
    const cells = splitCells(hall(), 4.5);
    for (const c of cells) {
      // Куски есть: большие треугольники стен режутся границами клеток.
      expect(c.extraPos.length).toBeGreaterThan(0);
      const { buf, n } = sowCell(c, 200);
      let checked = 0;
      let wrong = 0;
      for (let i = 0; i < n; i++) {
        const x = buf.position[i * 3]!;
        const y = buf.position[i * 3 + 1]!;
        const z = buf.position[i * 3 + 2]!;
        // До каждой из шести граней коробки; точки на рёбрах (две грани сразу) не в счёт.
        const dist = [x + 2, 10 - x, y, 3 - y, z + 2, 10 - z].map(Math.abs);
        const faces = dist.filter((d) => d < 1e-3).length;
        if (faces !== 1) continue;
        const f = dist.findIndex((d) => d < 1e-3);
        // Коробка строится нормалями наружу: у грани x = −2 нормаль (−1, 0, 0), у пола — вниз и так далее.
        const want = [-1, 1, -1, 1, -1, 1][f]!;
        const got = buf.nrm[i * 4 + (f >> 1)]! / 127;
        checked += 1;
        if (Math.abs(got - want) > 0.01) wrong += 1;
      }
      expect(checked).toBeGreaterThan(n * 0.9);
      expect(wrong).toBe(0);
    }
  });

  it('на гладкой поверхности нормаль куска — между нормалями вершин: колонна, разрезанная пополам', () => {
    const mb = new MeshBuilder();
    mb.cylinder([0, 0, 0], 'y', 3, 1, MAT.concrete, { segments: 12, caps: false });
    const mesh = mb.build();
    const cells = splitCells(mesh, 1.2);
    expect(cells.length).toBe(4);
    for (const c of cells) {
      const { buf, n } = sowCell(c, 600);
      expect(n).toBeGreaterThan(1500);
      for (let i = 0; i < n; i += 3) {
        const x = buf.position[i * 3]!;
        const z = buf.position[i * 3 + 2]!;
        const r = Math.hypot(x, z);
        // Точка на боку колонны; нормаль единичная и смотрит от оси.
        expect(r).toBeGreaterThan(0.96);
        expect(r).toBeLessThan(1.001);
        const nx = buf.nrm[i * 4]! / 127;
        const nz = buf.nrm[i * 4 + 2]! / 127;
        expect(Math.hypot(nx, buf.nrm[i * 4 + 1]! / 127, nz)).toBeGreaterThan(0.97);
        expect((nx * x + nz * z) / r).toBeGreaterThan(0.95);
      }
    }
  });

  it('точки и в клетке не слипаются: границы клеток сгустков не добавляют', () => {
    // Пол 8 × 8 м, четыре клетки; точки всех клеток вместе — как один посев.
    const mesh = floor(8, 8);
    const cells = splitCells(mesh, 4);
    expect(cells.length).toBe(4);
    const density = 400;
    const all = pointBuffers(8 * 8 * density * 1.2);
    let n = 0;
    for (const [i, c] of cells.entries()) {
      const { buf, n: count } = sowCell(c, density, 7 + i);
      all.position.set(buf.position.subarray(0, count * 3), n * 3);
      n += count;
    }
    expect(Math.abs(n - 64 * density)).toBeLessThan(64 * density * 0.02);
    const ids = Array.from({ length: n }, (_, i) => i);
    const r = 0.3 / Math.sqrt(density);
    expect(crowded(all, ids, r)).toBeLessThan(0.07);
  });

  it('рисунок точек не зависит от того, как стена разрезана: точки клеток вместе — те же, что у целой сетки', () => {
    const mesh = hall();
    const whole = sow(mesh, 300);
    const key = (x: number, y: number, z: number) => `${Math.round(x * 2000)},${Math.round(y * 2000)},${Math.round(z * 2000)}`;
    const set = new Set<string>();
    for (let i = 0; i < whole.n; i++) set.add(key(whole.buf.position[i * 3]!, whole.buf.position[i * 3 + 1]!, whole.buf.position[i * 3 + 2]!));
    let total = 0;
    let missing = 0;
    for (const c of splitCells(mesh, 4.5)) {
      const { buf, n } = sowCell(c, 300);
      total += n;
      for (let i = 0; i < n; i++) if (!set.has(key(buf.position[i * 3]!, buf.position[i * 3 + 1]!, buf.position[i * 3 + 2]!))) missing += 1;
    }
    // Точка ровно на границе клеток может достаться обеим или ни одной — таких единицы на сотню тысяч.
    expect(Math.abs(total - whole.n)).toBeLessThan(6);
    expect(missing).toBeLessThan(6);
  });

  it('у параллельных граней рисунок разный: точки двух сторон тонкой доски не стоят друг против друга', () => {
    // Доска 2 × 2 м толщиной 2 см: верх и низ — одна и та же проекция на плоскость.
    const mb = new MeshBuilder();
    mb.box([0, 0, 0], [2, 0.02, 2], MAT.concrete);
    const { buf, n } = sow(mb.build(), 600);
    const top = new Set<string>();
    const key = (x: number, z: number) => `${Math.round(x * 500)},${Math.round(z * 500)}`;
    let below = 0;
    let matched = 0;
    for (let i = 0; i < n; i++) if (buf.position[i * 3 + 1]! > 0.019) top.add(key(buf.position[i * 3]!, buf.position[i * 3 + 2]!));
    for (let i = 0; i < n; i++) {
      if (buf.position[i * 3 + 1]! > 0.001) continue;
      below += 1;
      if (top.has(key(buf.position[i * 3]!, buf.position[i * 3 + 2]!))) matched += 1;
    }
    expect(below).toBeGreaterThan(2000);
    // Случайных совпадений с точностью до 2 мм — доли процента; у одинакового рисунка совпало бы всё.
    expect(matched).toBeLessThan(below * 0.03);
  });

  it('мелкая сетка — одна клетка, и вершины у неё общие с сеткой, без копий', () => {
    const mesh = room();
    const cells = splitCells(mesh, 4.5);
    expect(cells.length).toBe(1);
    expect(cells[0]!.extraPos.length).toBe(0);
    expect(cells[0]!.position).toBe(mesh.position);
    expect(cells[0]!.tri.length / 3).toBe(12);
    // Без предела размера — тоже одна, какой бы большой сетка ни была.
    expect(splitCells(floor(88, 88), Infinity).length).toBe(1);
    expect(splitCells(floor(88, 88), 11).length).toBe(64);
  });

  it('светящееся в клетки не попадает', () => {
    const mb = new MeshBuilder();
    mb.quadFacing([0, 0, 0], [8, 0, 0], [8, 0, 2], [0, 0, 2], [0, 1, 0], MAT.concrete);
    mb.quadFacing([0, 3, 0], [8, 3, 0], [8, 3, 2], [0, 3, 2], [0, -1, 0], MAT.glow);
    const cells = splitCells(mb.build(), 4);
    expect(cells.length).toBe(2);
    for (const c of cells) {
      expect(c.area).toBeCloseTo(8, 4);
      expect(c.max[1]).toBeCloseTo(0, 5);
    }
  });
});
