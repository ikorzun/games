import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import type { WorldKind } from '../src/gen/layout';
import { Grass, GRASS_CLEAR, GRASS_STRIDE } from '../src/systems/grass';
import { BODY_CHANCE, bodyCapsules, bodyRolled, buildLevel, cellToWorld, grassChance, grassRolled, LAWN_CHANCE, lawnRolled, tierFloor } from '../src/world/level_build';
import { GRASS_FORMS, GRASS_KINDS, GRASS_VARIANTS, grassForm, grassTile } from '../src/world/grass';
import type { GrassKind, GrassLod } from '../src/world/grass';
import { mulberry32 } from '../src/core/rng';
import { buildMeadow } from '../src/world/pocket_meadow';

/** Корни травинок плитки: вершины на высоте 0 (у ближней сетки — по две на травинку). */
const roots = (kind: GrassKind, v: number, lod: GrassLod): string[] => {
  const m = grassTile(kind, v, lod);
  const out: string[] = [];
  for (let i = 0; i < m.position.length; i += 3) if (Math.abs(m.position[i + 1]!) < 1e-6) out.push(`${m.position[i]!.toFixed(4)},${m.position[i + 2]!.toFixed(4)}`);
  return out;
};

describe('трава: плитка (world/grass.ts)', () => {
  it('плитка 1 × 1 м: травинки внутри, корни на полу, кончики ниже 0,65 м; луговая — до 1400 / 100 / 40 треугольников, комнатная (гуще) — до 2200 / 150 / 50, газон (с подложкой) — до 2000 / 230 / 80', () => {
    const MAX = { meadow: [1400, 100, 40], pale: [2200, 150, 50], lawn: [2000, 230, 80] } as const;
    for (const kind of GRASS_KINDS) {
      for (let v = 0; v < GRASS_VARIANTS; v++) {
        const near = grassTile(kind, v, 0);
        const far = grassTile(kind, v, 1);
        const horizon = grassTile(kind, v, 2);
        expect(near.index.length / 3, `${kind}/${v}`).toBeLessThanOrEqual(MAX[kind][0]);
        expect(far.index.length / 3, `${kind}/${v}`).toBeLessThanOrEqual(MAX[kind][1]);
        expect(far.index.length / 3).toBeGreaterThan(20);
        expect(horizon.index.length / 3, `${kind}/${v}`).toBeLessThanOrEqual(MAX[kind][2]);
        expect(horizon.index.length / 3).toBeGreaterThan(10);
        for (const m of [near, far, horizon]) {
          for (let i = 0; i < m.position.length; i += 3) {
            const [x, y, z] = [m.position[i]!, m.position[i + 1]!, m.position[i + 2]!];
            expect(Math.abs(x)).toBeLessThan(0.5 + 0.3);
            expect(Math.abs(z)).toBeLessThan(0.5 + 0.3);
            expect(y).toBeGreaterThanOrEqual(-1e-6);
            expect(y).toBeLessThan(0.65);
          }
          expect([...m.normal].every(Number.isFinite)).toBe(true);
        }
      }
    }
  });

  it('у корня трава не качается, у кончика — качается (ветер и шаги гнут кончики)', () => {
    const m = grassTile('meadow', 0, 0);
    expect(m.sway).toBeDefined();
    let top = 0;
    for (let i = 0; i < m.position.length / 3; i++) {
      const y = m.position[i * 3 + 1]!;
      const w = m.sway![i]!;
      if (y < 1e-6) expect(w).toBe(0);
      else expect(w).toBeGreaterThan(0);
      top = Math.max(top, w);
    }
    // Кончик гнётся сильнее всего: вес — квадрат доли высоты (у наклонённой травинки кончик чуть ниже её длины).
    expect(top).toBeGreaterThan(0.6);
  });

  it('дальняя плитка и плитка у горизонта — те же травинки, но не все: каждая стоит там же, где ближняя (смена подробности не прыгает)', () => {
    // У дальней корень шире (в 1,6 раза, у горизонта — в 2,4), поэтому сверяется середина корня: она у всех одна.
    const mids = (list: string[]): [number, number][] => {
      const out: [number, number][] = [];
      for (let i = 0; i + 1 < list.length; i += 2) {
        const [ax, az] = list[i]!.split(',').map(Number);
        const [bx, bz] = list[i + 1]!.split(',').map(Number);
        out.push([(ax! + bx!) / 2, (az! + bz!) / 2]);
      }
      return out;
    };
    for (const kind of GRASS_KINDS) {
      const nearMid = mids(roots(kind, 1, 0));
      const farMid = mids(roots(kind, 1, 1));
      const horizonMid = mids(roots(kind, 1, 2));
      expect(farMid.length).toBeGreaterThan(horizonMid.length);
      expect(horizonMid.length).toBeGreaterThan(0);
      for (const [x, z] of farMid) expect(nearMid.some(([a, b]) => Math.hypot(a - x, b - z) < 1e-3), `${kind}: ${x.toFixed(3)},${z.toFixed(3)}`).toBe(true);
      for (const [x, z] of horizonMid) expect(farMid.some(([a, b]) => Math.hypot(a - x, b - z) < 1e-3), `${kind}: ${x.toFixed(3)},${z.toFixed(3)}`).toBe(true);
    }
  });

  it('у каждой вершины травинки uv — её корень: шейдер решает травинку целиком (вытоптанный круг, стёртый пол)', () => {
    for (const lod of [0, 1, 2] as const) {
      const m = grassTile('pale', 2, lod);
      // Все три вершины треугольника — одной травинки: uv у них один (подложка газона — не травинка: у её вершин корень — они сами).
      for (let t = 0; t < m.index.length; t += 3) {
        const [a, b, c] = [m.index[t]!, m.index[t + 1]!, m.index[t + 2]!];
        if ([a, b, c].every((i) => m.position[i * 3 + 1]! > 1e-6 && m.position[i * 3 + 1]! < 0.01)) continue;
        expect(m.uv[b * 2]).toBe(m.uv[a * 2]);
        expect(m.uv[c * 2 + 1]).toBe(m.uv[a * 2 + 1]);
      }
      // И это корень: у вершин на полу (корень травинки) середина пары — ровно uv.
      for (let i = 0; i < m.position.length / 3; i++) {
        if (Math.abs(m.position[i * 3 + 1]!) > 1e-6) continue;
        const u = m.uv[i * 2]!;
        const v = m.uv[i * 2 + 1]!;
        // Вершины корня — по краям корня; у плитки горизонта он шире всех, до 6,5 см в полуширину.
        expect(Math.hypot(m.position[i * 3]! - u, m.position[i * 3 + 2]! - v), `lod ${lod}`).toBeLessThan(0.07);
        expect(Math.abs(u)).toBeLessThan(0.5);
        expect(Math.abs(v)).toBeLessThan(0.5);
      }
    }
  });

  it('номера форм: вид × вариант, все разные', () => {
    const forms = new Set<number>();
    for (const k of GRASS_KINDS) for (let v = 0; v < GRASS_VARIANTS; v++) forms.add(grassForm(k, v));
    expect(forms.size).toBe(GRASS_FORMS);
    expect(Math.max(...forms)).toBe(GRASS_FORMS - 1);
  });
});

describe('трава: какие плитки отдать рендеру (systems/grass.ts)', () => {
  it('вытоптанные круги: сперва вещи на полу травы (кругом в свой размер), потом двери; вещь на столе и вне травы — без круга; не больше GRASS_CLEAR', () => {
    const sites = [];
    for (let x = 0; x < 6; x++) for (let z = 0; z < 6; z++) sites.push({ pos: [x, -0.01, z] as [number, number, number], rot: 0, s: 1.05, h: 1, form: 3 });
    const g = new Grass(sites);
    const out: [number, number, number, number][] = [];
    const doors: [number, number, number, number][] = [[6.5, 0, 2, 0.95]];
    const n = g.clearings(
      [
        { pos: [2, 0, 2], radius: 0.1 },
        { pos: [3, 0.78, 3], radius: 0.1 },
        { pos: [12, 0, 2], radius: 0.1 },
        { pos: [4, 0, 1], radius: 0.5 },
      ],
      doors,
      out,
    );
    expect(n).toBe(3);
    expect(out[0]).toEqual([2, -0.01, 2, expect.closeTo(0.74, 5)]);
    expect(out[1]![3]).toBeCloseTo(1.2, 5);
    expect(out[2]).toEqual(doors[0]);
    const many = Array.from({ length: 30 }, (_, i) => ({ pos: [(i % 6) * 0.9, 0, Math.floor(i / 6)] as [number, number, number], radius: 0.1 }));
    expect(g.clearings(many, doors, out)).toBe(GRASS_CLEAR);
    expect(out.length).toBe(GRASS_CLEAR);
    expect(new Grass([]).clearings(many, doors, out)).toBe(1);
  });

  it('на газоне вещь не вытаптывает круг — только свой след, в свой размер: газон остаётся нетронутым', () => {
    const lawnForm = GRASS_KINDS.indexOf('lawn') * GRASS_VARIANTS;
    const sites = [];
    for (let x = 0; x < 4; x++) for (let z = 0; z < 4; z++) sites.push({ pos: [x, -0.005, z] as [number, number, number], rot: 0, s: 1, h: 1, form: lawnForm + ((x + z) % GRASS_VARIANTS) });
    const g = new Grass(sites);
    expect(g.field?.short).toBe(true);
    const out: [number, number, number, number][] = [];
    expect(g.clearings([{ pos: [1, 0, 1], radius: 0.1 }, { pos: [2, 0, 2], radius: 0.9 }], [], out)).toBe(2);
    expect(out[0]![3]).toBeCloseTo(0.2, 5);
    expect(out[1]![3]).toBeCloseTo(0.6, 5);
    // Луг или трава помещения рядом с газоном — уже не газон.
    expect(new Grass([...sites, { pos: [5, 0, 5], rot: 0, s: 1, h: 1, form: 3 }]).field?.short).toBe(false);
  });

  it('ближние первыми, дальше предела (с метром на край плитки) — нет; глаз сдвинулся — порядок пересчитан', () => {
    const sites = Array.from({ length: 40 }, (_, i) => ({ pos: [i, 0, 0] as [number, number, number], rot: 0, s: 1, h: 1, form: i % 3 }));
    const g = new Grass(sites);
    const out = new Float32Array(40 * GRASS_STRIDE);
    const n = g.visible([10.2, 0, 0], 40, out, 5);
    // Плитки с серединой не дальше 6 м: от 4,2 до 16,2.
    expect(n).toBe(12);
    expect(out[0]).toBe(10);
    for (let k = 1; k < n; k++) expect(Math.abs(out[k * GRASS_STRIDE]! - 10.2)).toBeGreaterThanOrEqual(Math.abs(out[(k - 1) * GRASS_STRIDE]! - 10.2) - 1e-6);
    const m = g.visible([30.4, 0, 0], 3, out, 18);
    expect(m).toBe(3);
    expect(out[0]).toBe(30);
  });
});

describe('трава на лугу', () => {
  it('луг весь в траве: тысячи плиток в круге ходьбы, ни одной на тропинке к двери; плитки повёрнуты четвертями', () => {
    const p = buildMeadow(5, [0, 0, 0]);
    const grass = p.grass ?? [];
    expect(grass.length).toBeGreaterThan(1500);
    for (const s of grass) {
      expect(Math.hypot(s.pos[0], s.pos[2])).toBeLessThanOrEqual(31);
      expect(s.form).toBeLessThan(GRASS_VARIANTS);
      const q = s.rot / (Math.PI / 2);
      expect(Math.abs(q - Math.round(q))).toBeLessThan(1e-9);
    }
    // Точка появления и середина тропинки (дверь в 12 м впереди, тропа S-образная): там травы нет.
    expect(grass.some((s) => Math.hypot(s.pos[0], s.pos[2]) < 0.4)).toBe(false);
  });
});

describe('трава на весь пол помещения', () => {
  const RANKS = [1, 2, 3] as const;
  const SEEDS = [20041113, 7, 11, 42, 99, 1234, 5150, 808];

  it('«иногда»: на первом круге — в двух уровнях из пяти, к поздним кругам — в четырёх из пяти; жребий один на сид', () => {
    expect(grassChance(0)).toBeCloseTo(0.4, 5);
    expect(grassChance(1)).toBeCloseTo(0.82, 5);
    for (let w = 0; w < 1; w += 0.05) expect(grassChance(w + 0.05)).toBeGreaterThanOrEqual(grassChance(w));
    for (const [wear, lo, hi] of [[0, 0.36, 0.44], [1, 0.78, 0.86]] as const) {
      let n = 0;
      for (let seed = 0; seed < 4000; seed++) if (grassRolled(seed * 7919 + 13, wear)) n++;
      expect(n / 4000, `стёртость ${wear}`).toBeGreaterThan(lo);
      expect(n / 4000, `стёртость ${wear}`).toBeLessThan(hi);
    }
    // Заросшее раз — заросло и на следующих кругах.
    for (let seed = 0; seed < 500; seed++) if (grassRolled(seed, 0.2)) expect(grassRolled(seed, 0.6)).toBe(true);
  });

  it('в убежище и офисе — одно помещение, где выпал жребий; в зале ожидания — нет; плитки — сеткой клеток, поворот четвертями', () => {
    let rooms = 0;
    for (const world of ['shelter', 'office', 'station', 'yellow'] as WorldKind[]) {
      for (const seed of SEEDS) {
        for (const rank of RANKS) {
          const layout = generateLayout(seed, rank, world);
          const l = buildLevel(layout, { wear: 0.8 });
          if (world === 'station') {
            expect(l.grass ?? []).toEqual([]);
            expect(l.grassClear ?? []).toEqual([]);
            continue;
          }
          // Жёлтые — только газон (ниже, отдельной проверкой); бледной травы там не бывает.
          if (world === 'yellow') {
            for (const g of l.grass ?? []) expect(Math.floor(g.form / GRASS_VARIANTS), 'в жёлтых — только газон').toBe(GRASS_KINDS.indexOf('lawn'));
            continue;
          }
          if (!grassRolled(seed, 0.8)) {
            expect(l.grassRoom, `${world} ${seed}/${rank}: жребий не выпал`).toBeUndefined();
            continue;
          }
          if (l.grassRoom === undefined) continue;
          rooms++;
          const room = layout.rooms.find((r) => r.id === l.grassRoom)!;
          expect([l.greenRoom, l.skyRoom]).not.toContain(room.id);
          // Плитки — только в клетках этого помещения, на его полу, ровно по сетке клеток (три на сторону) и четвертями.
          for (const s of l.grass ?? []) {
            expect(room.cells.some(([x, z]) => [-1, 0, 1].some((i) => Math.abs(s.pos[0] - cellToWorld(x) - i) < 1e-9) && [-1, 0, 1].some((j) => Math.abs(s.pos[2] - cellToWorld(z) - j) < 1e-9) && Math.abs(s.pos[0] - cellToWorld(x)) <= 1.01 && Math.abs(s.pos[2] - cellToWorld(z)) <= 1.01)).toBe(true);
            expect(Math.abs(s.pos[1] - tierFloor(room.tier))).toBeLessThan(0.05);
            const q = s.rot / (Math.PI / 2);
            expect(Math.abs(q - Math.round(q))).toBeLessThan(1e-9);
          }
          expect((l.grass ?? []).length, `${world} ${seed}/${rank}`).toBeGreaterThan(room.cells.length * 3);
        }
      }
    }
    expect(rooms).toBeGreaterThan(10);
  });

  it('у дверей помещения с травой — вытоптанные круги на его полу: порог не встаёт ровной линией травы; половина кругов — вещам', () => {
    let doors = 0;
    for (const world of ['shelter', 'office'] as WorldKind[]) {
      for (const seed of SEEDS) {
        const layout = generateLayout(seed, 2, world);
        const l = buildLevel(layout, { wear: 0.8 });
        if (l.grassRoom === undefined) continue;
        const room = layout.rooms.find((r) => r.id === l.grassRoom)!;
        const y0 = tierFloor(room.tier);
        const clear = l.grassClear ?? [];
        expect(clear.length).toBeGreaterThan(0);
        expect(clear.length).toBeLessThanOrEqual(GRASS_CLEAR / 2);
        for (const c of clear) {
          doors++;
          expect(c[1]).toBeCloseTo(y0, 5);
          expect(c[3]).toBeGreaterThan(0.5);
          // Середина круга — на стене помещения, посреди стороны его клетки (проём).
          const onSide = room.cells.some(([x, z]) => (Math.abs(Math.abs(c[0] - cellToWorld(x)) - 1.5) < 1e-6 && Math.abs(c[2] - cellToWorld(z)) < 1e-6) || (Math.abs(Math.abs(c[2] - cellToWorld(z)) - 1.5) < 1e-6 && Math.abs(c[0] - cellToWorld(x)) < 1e-6));
          expect(onSide, `${world} ${seed}: ${c[0]},${c[2]}`).toBe(true);
        }
      }
    }
    expect(doors).toBeGreaterThan(5);
  });

  it('под мебелью травы нет: середина каждой плитки свободна от преград', () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const l = buildLevel(generateLayout(seed, 2, 'shelter'), { wear: 0.8 });
      for (const s of l.grass ?? []) {
        const [x, y, z] = s.pos;
        const hit = l.colliders.boxes.some((b) => !b.ghost && b.minY < y + 0.4 && b.maxY > y + 0.05 && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);
        expect(hit, `${seed}: ${x.toFixed(2)},${z.toFixed(2)}`).toBe(false);
      }
    }
  });
});

describe('газон в жёлтых комнатах (квиз партнёра, ночь на 20.11: «Идеальный газон, изредка»)', () => {
  it('изредка — в трёх уровнях из десяти; в зале без экранов, не в начале сна; ровный: одна высота, сетка клеток, без порогов', () => {
    let n = 0;
    for (let seed = 0; seed < 4000; seed++) if (lawnRolled(seed * 7919 + 13)) n++;
    expect(n / 4000).toBeGreaterThan(LAWN_CHANCE - 0.04);
    expect(n / 4000).toBeLessThan(LAWN_CHANCE + 0.04);
    let lawns = 0;
    for (let seed = 1; seed < 60 && lawns < 4; seed++) {
      if (!lawnRolled(seed)) continue;
      const layout = generateLayout(seed, 2, 'yellow');
      const l = buildLevel(layout);
      if (l.grassRoom === undefined) continue;
      lawns++;
      const room = layout.rooms.find((r) => r.id === l.grassRoom)!;
      expect(room.type).toBe('hall');
      expect(room.id).not.toBe(layout.entranceRoom);
      expect(l.skyRoom).not.toBe(room.id);
      expect(l.grassClear ?? [], 'у газона порогов нет').toEqual([]);
      expect(l.grassBody, 'на газоне следа нет').toBeUndefined();
      const grass = l.grass ?? [];
      expect(grass.length).toBeGreaterThan(room.cells.length * 6);
      for (const g of grass) {
        expect(Math.floor(g.form / GRASS_VARIANTS)).toBe(GRASS_KINDS.indexOf('lawn'));
        expect(g.h).toBe(1);
        // Над полом, а не в нём: подложка (3 мм над корнями) под полом не видна, и газона нет — одни кончики травинок.
        expect(g.pos[1], 'газон над полом').toBeGreaterThan(tierFloor(room.tier));
        expect(g.pos[1]).toBeLessThan(tierFloor(room.tier) + 0.01);
        expect(room.cells.some(([x, z]) => Math.abs(g.pos[0] - cellToWorld(x)) <= 1.01 && Math.abs(g.pos[2] - cellToWorld(z)) <= 1.01)).toBe(true);
      }
    }
    expect(lawns).toBeGreaterThan(1);
  });

  it('газон неподвижен — ни ветра, ни шагов (вес качания — ноль): у ложного нет времени; луговая и комнатная качаются', () => {
    for (let v = 0; v < GRASS_VARIANTS; v++) {
      for (const lod of [0, 1, 2] as const) {
        const sway = grassTile('lawn', v, lod).sway;
        expect(!sway || sway.every((w) => w === 0), `lawn/${v}/${lod}`).toBe(true);
        expect(grassTile('meadow', v, lod).sway?.some((w) => w > 0)).toBe(true);
        expect(grassTile('pale', v, lod).sway?.some((w) => w > 0)).toBe(true);
      }
    }
  });

  it('травинка газона короткая (до 10 см); под травинками — зелёная подложка во всю плитку на всех подробностях', () => {
    const m = grassTile('lawn', 0, 0);
    let top = 0;
    for (let i = 1; i < m.position.length; i += 3) top = Math.max(top, m.position[i]!);
    expect(top).toBeLessThan(0.1);
    expect(top).toBeGreaterThan(0.05);
    for (const lod of [0, 1, 2] as const) {
      const t = grassTile('lawn', 1, lod);
      // Четыре угла подложки — на высоте 3 мм, по углам квадрата 1 × 1 м.
      const corners = new Set<string>();
      for (let i = 0; i < t.position.length; i += 3) if (Math.abs(t.position[i + 1]! - 0.003) < 1e-6) corners.add(`${t.position[i]},${t.position[i + 2]}`);
      expect([...corners].sort()).toEqual(['-0.5,-0.5', '-0.5,0.5', '0.5,-0.5', '0.5,0.5']);
    }
  });
});

describe('след лежавшего человека в траве (квиз партнёра, ночь на 20.11)', () => {
  it('редко: в двух помещениях с травой из пяти; силуэт — шесть капсул ростом около 1,85 м', () => {
    let n = 0;
    for (let seed = 0; seed < 4000; seed++) if (bodyRolled(seed * 7919 + 13)) n++;
    expect(n / 4000).toBeGreaterThan(BODY_CHANCE - 0.04);
    expect(n / 4000).toBeLessThan(BODY_CHANCE + 0.04);
    const caps = bodyCapsules(0, 0, 0, mulberry32(5));
    expect(caps.length).toBe(6);
    // От пяток до макушки: голова — u до 0,84 + 0,11, ноги — до −0,92 − 0,08.
    let lo = Infinity;
    let hi = -Infinity;
    for (const [ax, , bx, , r] of caps) {
      lo = Math.min(lo, ax - r, bx - r);
      hi = Math.max(hi, ax + r, bx + r);
    }
    expect(hi - lo).toBeGreaterThan(1.7);
    expect(hi - lo).toBeLessThan(2.2);
  });

  it('силуэт лежит на траве целиком: не под мебелью, не у порога, в клетках помещения; только в бледной траве убежища и офиса', () => {
    let bodies = 0;
    for (const world of ['shelter', 'office'] as WorldKind[]) {
      for (let seed = 1; seed < 80 && bodies < 6; seed++) {
        if (!bodyRolled(seed) || !grassRolled(seed, 0.8)) continue;
        const layout = generateLayout(seed, 2, world);
        const l = buildLevel(layout, { wear: 0.8 });
        if (!l.grassBody) continue;
        bodies++;
        const room = layout.rooms.find((r) => r.id === l.grassRoom)!;
        const y0 = tierFloor(room.tier);
        expect(l.grassBody.floor).toBeCloseTo(y0, 5);
        const doors = l.grassClear ?? [];
        for (const [ax, az, bx, bz] of l.grassBody.caps) {
          for (const [x, z] of [[ax, az], [bx, bz], [(ax + bx) / 2, (az + bz) / 2]] as const) {
            expect(room.cells.some(([cx, cz]) => Math.abs(x - cellToWorld(cx)) <= 1.5 && Math.abs(z - cellToWorld(cz)) <= 1.5), `${world} ${seed}: вне помещения`).toBe(true);
            expect((l.grass ?? []).some((g) => Math.abs(g.pos[0] - x) <= 0.55 && Math.abs(g.pos[2] - z) <= 0.55), `${world} ${seed}: не на траве`).toBe(true);
            for (const d of doors) expect(Math.hypot(x - d[0], z - d[2]), `${world} ${seed}: у порога`).toBeGreaterThanOrEqual(1.0 - 1e-9);
            const hit = l.colliders.boxes.some((b) => !b.ghost && b.minY < y0 + 0.5 && b.maxY > y0 + 0.03 && x > b.minX - 0.12 && x < b.maxX + 0.12 && z > b.minZ - 0.12 && z < b.maxZ + 0.12);
            expect(hit, `${world} ${seed}: под мебелью`).toBe(false);
          }
        }
      }
    }
    expect(bodies).toBeGreaterThan(2);
  });
});

