import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import type { WorldKind } from '../src/gen/layout';
import { panelDead } from '../src/systems/cell_lights';
import { ColliderSet } from '../src/world/colliders';
import { FLAT_EYE, FLAT_RATIO, flatten, flattenPoint, shapeOf, standee, STANDEE_DIST, veil, VEIL_DIST, VEIL_SCENES } from '../src/world/flat';
import type { FlatFrame, FlatMark } from '../src/world/flat';
import { FLAT_SHARE } from '../src/world/furnish';
import { MeshBuilder } from '../src/world/kit';
import type { BuiltLevel } from '../src/world/level';
import { buildLevel } from '../src/world/level_build';
import { MAT } from '../src/world/materials';
import { Xf } from '../src/world/props';
import { ALL_PROPS } from '../src/world/props_all';
import { buildDisplay, DISPLAY_SIZE, SCREEN_PROPS } from '../src/world/props_screens';
import type { DisplayShape } from '../src/world/props_screens';
import { DOOR_IMAGE, DOOR_NAME, SCREEN_COLS, SCREEN_IMAGES, SCREEN_PH, SCREEN_PW, SCREEN_ROWS, screenCell, screenFor, SCREENS_H, SCREENS_W, screenUv } from '../src/world/screens';
import { CELL, WALL_T } from '../src/world/shell';

const SEEDS = [1, 5, 7, 42, 808, 4242, 9001, 31337, 20041113, 123456789, ...Array.from({ length: 20 }, (_, i) => (i * 7919 + 101) >>> 0)];
const FRAME: FlatFrame = { eye: [0.3, FLAT_EYE, 3.6], plane: 0.4, ratio: FLAT_RATIO };
const sub = (a: readonly number[], b: readonly number[]): number[] => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const len = (a: readonly number[]): number => Math.hypot(a[0]!, a[1]!, a[2]!);
const levels = new Map<string, BuiltLevel>();
const level = (seed: number, world: WorldKind, rank: 1 | 2 | 3 = 2): BuiltLevel => {
  const key = `${seed}:${world}:${rank}`;
  let l = levels.get(key);
  if (!l) {
    l = buildLevel(generateLayout(seed, rank, world));
    levels.set(key, l);
  }
  return l;
};
const flats = (l: BuiltLevel, kind: FlatMark['kind']): FlatMark[] => (l.flats ?? []).filter((f) => f.kind === kind);

describe('сплющивание: картинка из «объектива» не меняется, меняется только то, что видно сбоку', () => {
  it('точка на плоскости остаётся на месте', () => {
    const p = flattenPoint([0.7, 1.1, FRAME.plane], FRAME);
    expect(p[0]).toBeCloseTo(0.7, 9);
    expect(p[1]).toBeCloseTo(1.1, 9);
    expect(p[2]).toBeCloseTo(FRAME.plane, 9);
  });

  it('каждая точка едет по своему лучу из «объектива»', () => {
    for (const p of [[-0.6, 0.1, 0], [0.5, 2.0, 0.1], [0, 0.9, -0.5], [1.2, 1.4, 0.39]] as const) {
      const q = flattenPoint([p[0], p[1], p[2]], FRAME);
      const a = sub(p, FRAME.eye);
      const b = sub(q, FRAME.eye);
      const cos = (a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) / (len(a) * len(b));
      expect(cos).toBeGreaterThan(1 - 1e-9);
    }
  });

  it('глубина сжата до нескольких сантиметров, а порядок вдоль луча прежний', () => {
    let prev = Infinity;
    for (let z = FRAME.plane; z >= FRAME.plane - 1.2; z -= 0.1) {
      const q = flattenPoint([FRAME.eye[0], FRAME.eye[1], z], FRAME);
      // Дальнее остаётся дальше ближнего — иначе на снимке ближнее перестало бы его заслонять.
      expect(q[2]).toBeLessThanOrEqual(prev);
      prev = q[2];
      expect(FRAME.plane - q[2]).toBeLessThan(0.05);
    }
    // Метр глубины — около трёх сантиметров рельефа.
    expect(FRAME.plane - flattenPoint([0, 1, FRAME.plane - 1], FRAME)[2]).toBeGreaterThan(0.015);
  });

  it('у снимка нет оборотной стороны: грани, повёрнутые от «объектива», в него не попадают', () => {
    const mb = new MeshBuilder();
    mb.box([-0.5, 0, 0], [0.5, 1, 0.4], MAT.wood);
    const src = mb.build();
    const { position, tris } = flatten(src, { eye: [0, 0.5, 3.4], plane: 0.4, ratio: FLAT_RATIO });
    // У коробки, на которую смотрят в лоб, видна одна грань из шести: два треугольника.
    expect(tris.length).toBe(2);
    expect(position.length).toBe(src.position.length);
    const off = { eye: [1.5, 2.2, 3.4] as [number, number, number], plane: 0.4, ratio: FLAT_RATIO };
    // Сбоку и сверху — три грани.
    expect(flatten(src, off).tris.length).toBe(6);
  });
});

describe('картонка: предмет, который оказался листом', () => {
  const names = ['wardrobe', 'bookshelf', 'wall_unit', 'fridge', 'armchair', 'filing_cabinet', 'vending_machine'];

  it.each(names)('%s: плоская, без преграды и легче настоящей', (name) => {
    const spec = ALL_PROPS[name]!;
    const mb = new MeshBuilder();
    const col = new ColliderSet();
    const r = standee(new Xf(mb, col, 0, 0, 0, 0), spec, 77);
    const flat = mb.build();
    const real = shapeOf(spec, 77);
    expect(col.boxes.length).toBe(0);
    expect(flat.index.length).toBeGreaterThan(0);
    expect(flat.index.length).toBeLessThan(real.index.length);
    let zMin = Infinity;
    let zMax = -Infinity;
    for (let i = 2; i < flat.position.length; i += 3) {
      zMin = Math.min(zMin, flat.position[i]!);
      zMax = Math.max(zMax, flat.position[i]!);
    }
    // Вся картонка — у плоскости передней стороны предмета, толщиной в пару сантиметров.
    expect(zMax).toBeCloseTo(r.plane, 5);
    expect(zMax - zMin).toBeLessThan(0.045);
    expect(r.plane).toBeGreaterThan(0.1);
    // Снимок не шире и не выше самого предмета: дальнее на нём мельче ближнего.
    expect(r.w).toBeLessThanOrEqual(spec.w + 0.12);
    expect(r.h).toBeLessThanOrEqual(spec.h + 0.12);
    expect(r.w).toBeGreaterThan(spec.w * 0.6);
    for (const v of flat.position) expect(Number.isFinite(v)).toBe(true);
  });

  it('из «объектива» картонка выглядит как настоящий предмет: вершины лежат на тех же лучах', () => {
    const spec = ALL_PROPS.wardrobe!;
    const src = shapeOf(spec, 5);
    let front = -Infinity;
    for (let i = 2; i < src.position.length; i += 3) front = Math.max(front, src.position[i]!);
    const eye: [number, number, number] = [0, FLAT_EYE, front + STANDEE_DIST];
    const { position } = flatten(src, { eye, plane: front, ratio: FLAT_RATIO });
    for (let i = 0; i < src.position.length; i += 3) {
      const a = sub([src.position[i]!, src.position[i + 1]!, src.position[i + 2]!], eye);
      const b = sub([position[i]!, position[i + 1]!, position[i + 2]!], eye);
      expect((a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) / (len(a) * len(b))).toBeGreaterThan(1 - 1e-7);
    }
  });

  it('повёрнутая картонка стоит там же, куда её поставили', () => {
    const spec = ALL_PROPS.bookshelf!;
    for (const rot of [0, 1, 2, 3] as const) {
      const mb = new MeshBuilder();
      const xf = new Xf(mb, null, 10, 0, -4, rot);
      const r = standee(xf, spec, 3);
      const m = mb.build();
      const c = xf.pt(0, 1, r.plane);
      for (let i = 0; i < m.position.length; i += 3) {
        expect(Math.hypot(m.position[i]! - c[0], m.position[i + 2]! - c[2])).toBeLessThan(spec.w / 2 + 0.1);
      }
    }
  });
});

describe('проекция: комната, которой нет', () => {
  const W = CELL - WALL_T;
  const H = 2.7;

  it('без сетки проекций её нет', () => {
    expect(veil(new Xf(new MeshBuilder(), null, 0, 0, 0, 0), VEIL_SCENES[1]!, ALL_PROPS, 1, W, H)).toBeNull();
  });

  it.each(VEIL_SCENES.map((s) => s.id))('сцена «%s»: плоский лист света ровно в сечение коридора', (id) => {
    const scene = VEIL_SCENES.find((s) => s.id === id)!;
    const mb = new MeshBuilder();
    const sl = new MeshBuilder();
    const col = new ColliderSet();
    const r = veil(new Xf(mb, col, 0, 0, 0, 0, sl), scene, ALL_PROPS, 9, W, H);
    expect(r).not.toBeNull();
    // В вещество не попадает ничего: проекция — только свет, и пройти сквозь неё можно.
    expect(mb.triangleCount).toBe(0);
    expect(col.boxes.length).toBe(0);
    const m = sl.build();
    expect(m.index.length / 3).toBeGreaterThan(40);
    for (let i = 0; i < m.position.length / 3; i++) {
      const x = m.position[i * 3]!;
      const y = m.position[i * 3 + 1]!;
      const z = m.position[i * 3 + 2]!;
      expect(Math.abs(x)).toBeLessThanOrEqual(W / 2 + 1e-4);
      expect(y).toBeGreaterThanOrEqual(-1e-4);
      expect(y).toBeLessThanOrEqual(H + 1e-4);
      // Вся комната — в четырёх сантиметрах за плоскостью.
      expect(z).toBeLessThanOrEqual(1e-5);
      expect(z).toBeGreaterThan(-0.045);
      expect(m.mat[i]).toBe(MAT.glow);
      expect(m.normal[i * 3 + 2]).toBeCloseTo(1, 6);
      expect(m.uv[i * 2]!).toBeGreaterThanOrEqual(-1e-4);
      expect(m.uv[i * 2]!).toBeLessThanOrEqual(1 + 1e-4);
      expect(m.uv[i * 2 + 1]!).toBeGreaterThanOrEqual(-1e-4);
      expect(m.uv[i * 2 + 1]!).toBeLessThanOrEqual(1 + 1e-4);
      // Цвет вершины — готовая картинка: не чёрная дыра и не пересвет.
      const c = Math.max(m.color[i * 4]!, m.color[i * 4 + 1]!, m.color[i * 4 + 2]!);
      expect(c).toBeGreaterThan(0);
      expect(c).toBeLessThan(2);
    }
  });

  it('все предметы сцен есть в реестре', () => {
    for (const s of VEIL_SCENES) for (const [name] of s.items) expect(ALL_PROPS[name], `${s.id}: ${name}`).toBeDefined();
    expect(VEIL_DIST).toBeGreaterThan(3);
  });
});

describe('плоские вещи в уровне', () => {
  it('в убежище ниже первого яруса стоят проекции: по одной на ярус, поперёк прямого коридора без дверей', () => {
    let total = 0;
    for (const seed of SEEDS) {
      const l = level(seed, 'shelter');
      const veils = flats(l, 'veil');
      total += veils.length;
      expect(veils.length).toBeLessThanOrEqual(l.layout!.tierCount - 1);
      for (const v of veils) {
        expect(v.tier).toBeGreaterThan(0);
        expect(l.layout!.rooms[v.room]!.type).toBe('corridor');
        expect(v.w).toBeCloseTo(CELL - WALL_T, 6);
        // Смотрит строго вдоль коридора.
        expect(Math.abs(v.n[0]) + Math.abs(v.n[2])).toBeCloseTo(1, 6);
        expect(v.n[1]).toBeCloseTo(0, 6);
      }
    }
    // Почти в каждом убежище они есть.
    expect(total).toBeGreaterThan(SEEDS.length * 1.2);
  });

  it('сквозь проекцию можно пройти: в её клетке нет преграды поперёк коридора', () => {
    for (const seed of SEEDS.slice(0, 12)) {
      const l = level(seed, 'shelter');
      for (const v of flats(l, 'veil')) {
        const blocked = l.colliders.boxes.some((b) => !b.off && v.at[0] > b.minX && v.at[0] < b.maxX && v.at[2] > b.minZ && v.at[2] < b.maxZ && v.floor + 1 > b.minY && v.floor + 1 < b.maxY);
        expect(blocked).toBe(false);
      }
    }
  });

  it('в жёлтых комнатах проекции стоят в прямых клетках коридора — до трёх на коридор и не только под мёртвыми панелями; в офисе их нет', () => {
    let yellow = 0;
    let underLive = 0;
    for (const seed of SEEDS) {
      expect(flats(level(seed, 'office'), 'veil').length).toBe(0);
      const l = level(seed, 'yellow');
      const perRoom = new Map<number, number>();
      for (const v of flats(l, 'veil')) {
        yellow += 1;
        perRoom.set(v.room, (perRoom.get(v.room) ?? 0) + 1);
        expect(l.layout!.rooms[v.room]!.type).toBe('corridor');
        // Смотрит строго вдоль коридора.
        expect(Math.abs(v.n[0]) + Math.abs(v.n[2])).toBeCloseTo(1, 6);
        expect(v.n[1]).toBeCloseTo(0, 6);
        const cx = Math.round(v.at[0] / CELL) + 8;
        const cz = Math.round(v.at[2] / CELL) + 8;
        if (!panelDead(l.layout!.seed, cx, cz)) underLive += 1;
      }
      for (const [room, n] of perRoom) expect(n, `${seed}: коридор ${room}`).toBeLessThanOrEqual(3);
    }
    expect(yellow).toBeGreaterThan(0);
    // Мёртвая лампа проекции больше не нужна: этаж обесточен целиком, и стоят они где придётся.
    expect(underLive).toBeGreaterThan(0);
  });

  it('картонки есть во всех мирах, но редкие: доля 0,12 в убежище, 0,04 в офисе, 0,2 в жёлтых комнатах', () => {
    expect(FLAT_SHARE).toEqual({ shelter: 0.12, office: 0.04, yellow: 0.2 });
    expect(FLAT_SHARE.office).toBeLessThan(FLAT_SHARE.shelter);
    expect(FLAT_SHARE.shelter).toBeLessThan(FLAT_SHARE.yellow);
    const count = (world: WorldKind): number => SEEDS.reduce((n, seed) => n + flats(level(seed, world), 'standee').length, 0);
    expect(count('shelter')).toBeGreaterThan(SEEDS.length);
    expect(count('office')).toBeGreaterThan(0);
    // В офисе мебели у стен много, но картонок среди неё мало: это настоящее воспоминание.
    expect(count('office')).toBeLessThan(SEEDS.length * 3);
  });

  it('там, где стоит картонка, пройти можно: преграды у неё нет', () => {
    let checked = 0;
    for (const seed of SEEDS.slice(0, 14)) {
      const l = level(seed, 'shelter');
      for (const f of flats(l, 'standee')) {
        // Точка в десяти сантиметрах за листом — внутри настоящего предмета была бы преграда.
        const p = [f.at[0] - f.n[0] * 0.1, f.floor + Math.min(0.5, f.h * 0.5), f.at[2] - f.n[2] * 0.1];
        const inside = l.colliders.boxes.some((b) => !b.off && p[0]! > b.minX && p[0]! < b.maxX && p[1]! > b.minY && p[1]! < b.maxY && p[2]! > b.minZ && p[2]! < b.maxZ);
        expect(inside, `${f.what} в помещении ${f.room}`).toBe(false);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('один сид — одни и те же плоские вещи', () => {
    for (const world of ['shelter', 'office', 'yellow'] as const) {
      const a = buildLevel(generateLayout(4242, 2, world)).flats!;
      const b = buildLevel(generateLayout(4242, 2, world)).flats!;
      expect(a).toEqual(b);
      expect(a.length).toBeGreaterThan(0);
    }
  });

  it('проекции лежат отдельной сеткой куска, а не в его веществе', () => {
    const l = level(20041113, 'shelter');
    const withSlides = l.chunks.filter((c) => c.slides);
    expect(flats(l, 'veil').length).toBeGreaterThan(0);
    expect(withSlides.length).toBeGreaterThan(0);
    // Кусков со светом не больше, чем самих проекций и экранов.
    expect(withSlides.length).toBeLessThanOrEqual(flats(l, 'veil').length + flats(l, 'screen').length);
    for (const c of withSlides) {
      expect(c.slides!.index.length).toBeGreaterThan(0);
      for (const m of c.slides!.mat) expect([MAT.glow, MAT.print]).toContain(m);
    }
  });
});

describe('выставочные экраны', () => {
  it('картинки названы по правилам, клетки атласа не налезают друг на друга', () => {
    const ids = SCREEN_IMAGES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_]+$/);
    expect(SCREEN_ROWS * SCREEN_COLS).toBeGreaterThanOrEqual(ids.length);
    expect(SCREENS_W).toBe(SCREEN_COLS * SCREEN_PW);
    expect(SCREENS_H).toBe(SCREEN_ROWS * SCREEN_PH);
    const seen = new Set<string>();
    ids.forEach((_, i) => {
      const c = screenCell(i);
      expect(c.x + SCREEN_PW).toBeLessThanOrEqual(SCREENS_W);
      expect(c.y + SCREEN_PH).toBeLessThanOrEqual(SCREENS_H);
      expect(seen.has(`${c.x},${c.y}`)).toBe(false);
      seen.add(`${c.x},${c.y}`);
      const r = screenUv(i);
      for (const v of [r.u0, r.u1, r.v0, r.v1]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(r.u1).toBeGreaterThan(r.u0);
      expect(r.v1).toBeGreaterThan(r.v0);
      // Лежачий экран берёт полосу из середины той же картинки.
      const b = screenUv(i, 0.35);
      expect(b.v0).toBeGreaterThan(r.v0);
      expect(b.v1).toBeLessThan(r.v1);
      expect((b.v0 + b.v1) / 2).toBeCloseTo((r.v0 + r.v1) / 2, 6);
    });
  });

  it('первые клетки рисует код: экран светится и без файлов', () => {
    expect(SCREEN_IMAGES[0]!.kind).toBe('signal');
    expect(SCREEN_IMAGES[1]!.kind).toBe('signal');
    expect(SCREEN_IMAGES.filter((s) => s.kind !== 'signal').length).toBeGreaterThanOrEqual(6);
  });

  it('что на экране — решает сид; род картинки — тот, что просили', () => {
    const picks = new Set<number>();
    for (let seed = 0; seed < 400; seed++) {
      const i = screenFor(seed, ['nature', 'strange']);
      expect(['nature', 'strange']).toContain(SCREEN_IMAGES[i]!.kind);
      expect(screenFor(seed, ['nature', 'strange'])).toBe(i);
      picks.add(i);
    }
    // Попадаются все картинки рода, а не одна и та же.
    expect(picks.size).toBe(SCREEN_IMAGES.filter((s) => s.kind === 'nature' || s.kind === 'strange').length);
    expect(SCREEN_IMAGES[screenFor(12345)]).toBeDefined();
  });

  it.each(['lean', 'stand', 'wall'] as const)('экран «%s»: панель — вещество, картинка — свет', (shape: DisplayShape) => {
    const mb = new MeshBuilder();
    const sl = new MeshBuilder();
    const col = new ColliderSet();
    buildDisplay(new Xf(mb, col, 0, 0, 0, 0, sl), shape, 3);
    expect(mb.triangleCount).toBeGreaterThan(10);
    const pic = sl.build();
    // Картинка — один лист с uv в свою клетку атласа экранов.
    expect(pic.index.length).toBe(6);
    for (const m of pic.mat) expect(m).toBe(MAT.print);
    const r = screenUv(3, shape === 'wall' ? DISPLAY_SIZE.wall[1] / DISPLAY_SIZE.wall[0] / (640 / 384) : 1);
    for (let i = 0; i < 4; i++) {
      expect(pic.uv[i * 2]!).toBeGreaterThanOrEqual(r.u0 - 1e-6);
      expect(pic.uv[i * 2]!).toBeLessThanOrEqual(r.u1 + 1e-6);
      expect(pic.uv[i * 2 + 1]!).toBeGreaterThanOrEqual(r.v0 - 1e-6);
      expect(pic.uv[i * 2 + 1]!).toBeLessThanOrEqual(r.v1 + 1e-6);
    }
    // Картинка смотрит в комнату.
    expect(pic.normal[2]).toBeGreaterThan(0.9);
    // Стоящий на полу экран мешает пройти; висящий на стене — нет.
    expect(col.boxes.length > 0).toBe(shape !== 'wall');
  });

  it('без сетки проекций экран всё равно светится — ровным свечением', () => {
    const mb = new MeshBuilder();
    buildDisplay(new Xf(mb, null, 0, 0, 0, 0), 'lean', 2);
    expect([...mb.build().mat].some((m) => m === MAT.glow)).toBe(true);
  });

  it.each(Object.keys(SCREEN_PROPS))('%s помещается в заявленные габариты', (name) => {
    const p = SCREEN_PROPS[name]!;
    const m = shapeOf(p, 11);
    for (let i = 0; i < m.position.length; i += 3) {
      const x = m.position[i]!;
      const y = m.position[i + 1]!;
      const z = m.position[i + 2]!;
      expect(Math.abs(x)).toBeLessThanOrEqual(p.w / 2 + 0.03);
      expect(y).toBeGreaterThanOrEqual(-1e-6);
      expect(y).toBeLessThanOrEqual(p.h + 0.02);
      if (p.mount === 'free') expect(Math.abs(z)).toBeLessThanOrEqual(p.d / 2 + 0.02);
      else {
        expect(z).toBeGreaterThanOrEqual(-1e-6);
        expect(z).toBeLessThanOrEqual(p.d + 0.02);
      }
    }
  });

  /** Размер картинки WebP с потерями (простой контейнер «VP8 »): ширина и высота лежат в заголовке кадра. */
  const webpSize = (file: string): { w: number; h: number } => {
    const b = readFileSync(file);
    expect(b.toString('ascii', 0, 4), file).toBe('RIFF');
    expect(b.toString('ascii', 8, 16), file).toBe('WEBPVP8 ');
    return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  };

  it('у каждой картинки есть файл для игры (384×640, не тяжелее 130 КБ) и полный исходник; лишних файлов нет', () => {
    const dir = fileURLToPath(new URL('../assets/screens/', import.meta.url));
    const need = SCREEN_IMAGES.filter((s) => s.kind !== 'signal').map((s) => s.id);
    expect(readdirSync(dir).filter((f) => f.endsWith('.webp')).map((f) => f.slice(0, -5)).sort()).toEqual([...need].sort());
    for (const id of need) {
      const file = `${dir}${id}.webp`;
      expect(existsSync(file), file).toBe(true);
      expect(webpSize(file)).toEqual({ w: SCREEN_PW, h: SCREEN_PH });
      expect(statSync(file).size, id).toBeLessThan(130 * 1024);
      const master = `${dir}master/${id}.webp`;
      expect(existsSync(master), master).toBe(true);
      expect(webpSize(master).h, id).toBeGreaterThanOrEqual(1280);
    }
  });

  it('проверка сборки: без файла картинки экрана — ошибка с её именем', async () => {
    const mod = (await import('../scripts/check_dist.mjs' as string)) as { checkDist(dir: string, opts?: Record<string, unknown>): { problems: string[] } };
    const dist = mkdtempSync(join(tmpdir(), 'vz-screens-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>t</title>');
    mkdirSync(join(dist, 'assets'));
    const need = SCREEN_IMAGES.filter((s) => s.kind !== 'signal').map((s) => s.id);
    for (const id of need.filter((x) => x !== 'moss')) writeFileSync(join(dist, 'assets', `${id}-AbC123.webp`), 'x');
    const lost = mod.checkDist(dist).problems.filter((p) => p.includes('картинок экранов'));
    expect(lost.length).toBe(1);
    expect(lost[0]).toContain('moss');
    expect(lost[0]).not.toContain('roots');
    writeFileSync(join(dist, 'assets', 'moss-XyZ789.webp'), 'x');
    expect(mod.checkDist(dist).problems.filter((p) => p.includes('картинок экранов'))).toEqual([]);
  });

  it('в офисе экраны показывают природу, в приёмной экран есть всегда; телевизор в комнате отдыха — единственный с поп-культурой', () => {
    let n = 0;
    let tvs = 0;
    for (const seed of SEEDS) {
      const l = level(seed, 'office');
      const screens = flats(l, 'screen');
      n += screens.length;
      const breakrooms = new Set(l.layout!.rooms.filter((r) => r.type === 'breakroom').map((r) => r.id));
      for (const s of screens) {
        const kind = SCREEN_IMAGES.find((im) => im.id === s.what)!.kind;
        // Поп-культура — только на телевизоре в комнате отдыха; всё остальное — природа и «странное».
        if (kind === 'pop') {
          expect(breakrooms.has(s.room), `сид ${seed}: поп-культура вне комнаты отдыха`).toBe(true);
          tvs += 1;
        } else expect(['nature', 'strange']).toContain(kind);
      }
      // В комнате отдыха — не больше одного телевизора.
      for (const id of breakrooms) expect(screens.filter((s) => s.room === id && SCREEN_IMAGES.find((im) => im.id === s.what)!.kind === 'pop').length).toBeLessThanOrEqual(1);
      const reception = l.layout!.rooms.find((r) => r.type === 'reception');
      if (reception) expect(screens.some((s) => s.room === reception.id)).toBe(true);
    }
    expect(n).toBeGreaterThan(SEEDS.length);
    expect(tvs, 'ни в одном офисе нет телевизора в комнате отдыха').toBeGreaterThan(0);
  });

  it('в убежище экранов нет вовсе', () => {
    for (const seed of SEEDS) expect(flats(level(seed, 'shelter'), 'screen'), `сид ${seed}`).toHaveLength(0);
  });

  it('в жёлтых комнатах на уровень ровно два экрана: ближний к началу — природа или «странное», дальний — проём с лугом', () => {
    for (const seed of SEEDS) {
      const l = level(seed, 'yellow');
      const screens = flats(l, 'screen');
      expect(screens, `сид ${seed}`).toHaveLength(2);
      const kinds = screens.map((s) => SCREEN_IMAGES.find((im) => im.id === s.what)!.kind);
      expect(kinds.filter((k) => k === 'door'), `сид ${seed}: проём — один`).toHaveLength(1);
      const door = screens[kinds.indexOf('door')]!;
      const plain = screens[1 - kinds.indexOf('door')]!;
      expect(door.what).toBe(SCREEN_IMAGES[DOOR_IMAGE]!.id);
      expect(['nature', 'strange']).toContain(SCREEN_IMAGES.find((im) => im.id === plain.what)!.kind);
      // Проём — в зале не ближе к началу, чем обычный экран.
      const rooms = l.layout!.rooms;
      const start = rooms[l.layout!.entranceRoom]!.cells[0]!;
      const far = (id: number): number => Math.min(...rooms.find((r) => r.id === id)!.cells.map(([x, z]) => Math.abs(x - start[0]) + Math.abs(z - start[1])));
      expect(far(door.room), `сид ${seed}: проём ближе обычного экрана`).toBeGreaterThanOrEqual(far(plain.room));
      // Сам экран проёма — отдельный объект со своим именем: по нему игра узнаёт, что в него входят.
      expect(l.objects!.filter((o) => o.name === DOOR_NAME), `сид ${seed}`).toHaveLength(1);
    }
  });

  it('проём бывает только в жёлтых комнатах, и сам на экран не попадает: его ставит сборка уровня', () => {
    expect(SCREEN_IMAGES.filter((s) => s.kind === 'door')).toHaveLength(1);
    expect(SCREEN_IMAGES[DOOR_IMAGE]!.id).toBe('meadow');
    for (let seed = 0; seed < 400; seed++) {
      expect(screenFor(seed)).not.toBe(DOOR_IMAGE);
      expect(screenFor(seed, ['door'])).not.toBe(DOOR_IMAGE);
      expect(screenFor(seed, ['nature', 'strange', 'pop'])).not.toBe(DOOR_IMAGE);
    }
    for (const world of ['shelter', 'office'] as const) {
      for (const seed of SEEDS) {
        const l = level(seed, world);
        expect(flats(l, 'screen').some((s) => s.what === 'meadow'), `${world} ${seed}`).toBe(false);
        expect(l.objects!.some((o) => o.name === DOOR_NAME), `${world} ${seed}`).toBe(false);
      }
    }
  });
});
