/**
 * Сборка уровня из плана генератора: скорлупа по ярусам, лестничные марши, двери, обстановка,
 * места для находок, приметные объекты и навигационный граф. Чистый TS: работает в тестах и в Worker.
 */
import { hash01, hash2, mulberry32 } from '../core/rng';
import type { Vec3 } from '../core/types';
import { CEIL_H, DX, DZ, GRID, STAIR_CELLS, TIER_DROP } from '../gen/layout';
import type { GenLayout, GenRoom, RoomType } from '../gen/layout';
import { ColliderSet } from './colliders';
import { doorSign, furnishRoom } from './furnish';
import { ROOM_LABEL, SIGN } from './signs';
import type { CellInfo, RoomCtx, Slot } from './furnish';
import { MeshBuilder } from './kit';
import type { BuiltLevel, CollapseSpec, ItemSpot, Landmark, LevelChunk, NavNode, RoomVariant, StairLink, Zone } from './level';
import { MAT } from './materials';
import { hermoDoor, stairsDown, Xf } from './props';
import { doorFrame, doorLeaf, collapse, pit, warningSign, waterSheet } from './props_bunker';
import { ALL_PROPS } from './props_all';
import { buildShell, CELL, Shell, STYLE_CORRIDOR, WALL_T } from './shell';
import type { ShellCell, WallStyle } from './shell';

const HALF = GRID / 2;
/** Клетка сетки → координата её центра в мире. */
export const cellToWorld = (c: number): number => (c - HALF) * CELL;
export const tierFloor = (tier: number): number => -TIER_DROP * tier;

/**
 * Марш: 30 ступеней по 0,15 × 0,30 м на три клетки длины. Десять ступеней — ровно клетка по
 * горизонтали и 1,5 м по высоте, период рисунка грязи на стенах: сдвиг игрока на десять ступеней
 * не виден. На этом стоит аномалия «лестница длиннее, чем должна быть».
 */
export const STAIR_STEPS = 30;
export const STAIR_RISE = TIER_DROP / STAIR_STEPS;
export const STAIR_RUN = (STAIR_CELLS * CELL) / STAIR_STEPS;

const ROOM_STYLE: Partial<Record<RoomType, Partial<WallStyle>>> = {
  dorm: { lower: MAT.paintOchre, stripe: MAT.rubber, paintHeight: 1.35 },
  command: { lower: MAT.wood, lowerTint: [0.75, 0.7, 0.62], stripe: MAT.rubber, paintHeight: 1.1 },
  // Медпункт и санузел — в кафеле до плеча, на полу мелкая плитка.
  medical: { lower: MAT.tile, lowerTint: [0.95, 0.97, 0.95], stripe: MAT.paintGreen, paintHeight: 1.6, floor: MAT.tileFloor, floorTint: [0.9, 0.9, 0.9] },
  washroom: { lower: MAT.tile, lowerTint: [0.82, 0.9, 0.9], stripe: MAT.paintBlue, paintHeight: 1.8, floor: MAT.tileFloor, floorTint: [0.8, 0.8, 0.8] },
  // Кладовые сложены из кирпича и никогда не красились.
  storage: { lower: MAT.brick, lowerTint: [0.85, 0.85, 0.85], upper: MAT.brick, upperTint: [1.05, 1.05, 1.05], stripe: MAT.brick, paintHeight: 1.0 },
  fvu: { lower: MAT.paintGreen, lowerTint: [0.8, 0.85, 0.8], paintHeight: 1.7 },
  diesel: { lower: MAT.paintGreen, lowerTint: [0.62, 0.66, 0.55], stripe: MAT.paintRed, paintHeight: 1.2, floor: MAT.tileFloor, floorTint: [0.75, 0.75, 0.75] },
  tanks: { lower: MAT.paintBlue, lowerTint: [0.75, 0.8, 0.8], paintHeight: 1.0, floor: MAT.wetConcrete, floorTint: [0.85, 0.85, 0.85] },
  switchboard: { lower: MAT.paintOchre, lowerTint: [0.85, 0.85, 0.85], stripe: MAT.paintRed, paintHeight: 1.5 },
  archive: { lower: MAT.wood, lowerTint: [0.6, 0.55, 0.5], paintHeight: 1.2 },
  collapsed: { lower: MAT.brick, upper: MAT.concrete, stripe: MAT.brick, lowerTint: [0.7, 0.7, 0.7], upperTint: [0.7, 0.7, 0.7], paintHeight: 1.4 },
  entrance: { lower: MAT.concrete, lowerTint: [0.75, 0.75, 0.72], upper: MAT.concrete, upperTint: [0.9, 0.9, 0.87], paintHeight: 1.2 },
  airlock: { lower: MAT.paintGreen, lowerTint: [0.7, 0.75, 0.62], paintHeight: 1.6 },
  // Дом, вросший в убежище: обои на всю высоту стены (полоса и верх — те же обои) и паркет вместо бетона.
  // Оттенки у комнат разные, всё пастельное.
  living: { lower: MAT.wallpaper, lowerTint: [1.12, 0.88, 0.86], upper: MAT.wallpaper, upperTint: [1.1, 0.9, 0.88], stripe: MAT.wallpaper, paintHeight: 2.2, floor: MAT.parquet, floorTint: [0.95, 0.8, 0.65] },
  bedroom: { lower: MAT.wallpaper, lowerTint: [0.86, 0.95, 1.12], upper: MAT.wallpaper, upperTint: [0.88, 0.96, 1.1], stripe: MAT.wallpaper, paintHeight: 2.2, floor: MAT.parquet, floorTint: [0.85, 0.75, 0.65] },
  nursery: { lower: MAT.wallpaper, lowerTint: [1.12, 1.12, 0.78], upper: MAT.wallpaper, upperTint: [1.1, 1.1, 0.82], stripe: MAT.wallpaper, paintHeight: 2.2, floor: MAT.linoleum, floorTint: [1.05, 0.9, 0.72] },
  hallway: { lower: MAT.wallpaper, lowerTint: [0.98, 0.84, 0.68], upper: MAT.wallpaper, upperTint: [1.0, 0.88, 0.74], stripe: MAT.wallpaper, paintHeight: 2.0, floor: MAT.linoleum, floorTint: [0.78, 0.62, 0.5] },
  // Ванная светлее санузла убежища: белёсая плитка до потолка, на полу плитка посветлее.
  bathroom: { lower: MAT.tile, lowerTint: [1.08, 1.14, 1.16], upper: MAT.tile, upperTint: [1.05, 1.1, 1.12], stripe: MAT.tile, paintHeight: 2.2, floor: MAT.tileFloor, floorTint: [1.35, 1.45, 1.55] },
  // Кухня: крашеный низ, побелка сверху, на полу плитка.
  kitchen: { lower: MAT.paintGreen, lowerTint: [1.45, 1.5, 1.3], stripe: MAT.paintGreen, paintHeight: 1.5, floor: MAT.tileFloor, floorTint: [1.0, 1.0, 0.95] },
};

/** Коридоры ярусов красят по-разному; чем глубже, тем темнее и грязнее. */
const TIER_CORRIDOR: readonly Partial<WallStyle>[] = [
  {},
  { lower: MAT.paintBlue, lowerTint: [0.75, 0.78, 0.8], upperTint: [0.82, 0.8, 0.76], ceilTint: [0.7, 0.68, 0.64], floorTint: [0.72, 0.72, 0.72] },
  { lower: MAT.concrete, lowerTint: [0.55, 0.57, 0.55], upper: MAT.concrete, upperTint: [0.72, 0.72, 0.7], stripe: MAT.rust, ceil: MAT.concrete, ceilTint: [0.6, 0.6, 0.58], floor: MAT.wetConcrete, floorTint: [0.95, 0.95, 0.95] },
];

function styleFor(room: GenRoom): WallStyle {
  const dark = room.tier === 2 ? 0.82 : room.tier === 1 ? 0.92 : 1;
  const base: WallStyle = { ...STYLE_CORRIDOR, ...(TIER_CORRIDOR[room.tier] ?? {}) };
  // Шахта лестницы — голый бетон без линии покраски: на стенах нет ничего, что выдало бы высоту.
  const well: Partial<WallStyle> = { lower: MAT.concrete, upper: MAT.concrete, stripe: MAT.concrete, lowerTint: [0.72, 0.72, 0.7], upperTint: [0.72, 0.72, 0.7] };
  const own = room.type === 'corridor' ? {} : room.type === 'stairwell' ? well : (ROOM_STYLE[room.type] ?? {});
  const st: WallStyle = { ...base, ...own };
  const mul = (t: Vec3): Vec3 => [t[0] * dark, t[1] * dark, t[2] * dark];
  return { ...st, lowerTint: mul(st.lowerTint), upperTint: mul(st.upperTint), floorTint: mul(st.floorTint), ceilTint: mul(st.ceilTint) };
}

interface ChunkBuild {
  mb: MeshBuilder;
  tierMin: number;
  tierMax: number;
  id?: string;
  hidden?: boolean;
}

/** Помещения нижнего яруса, которые могут «меняться за спиной». */
const VARIANT_ROOMS: ReadonlySet<RoomType> = new Set<RoomType>(['dorm', 'storage', 'archive', 'washroom']);

/** Поворот размещения, при котором локальная ось +z смотрит по направлению dir. */
const ROT_FACING: readonly (0 | 1 | 2 | 3)[] = [1, 0, 3, 2];
/** Сторона дыры провала, м: по краям коридора остаются карнизы по 0,7 м. */
export const PIT_HOLE = 1.3;
const PIT_DEPTH = 1.6;
/** Смещение навигационного узла от центра клетки с провалом — на середину карниза. */
const PIT_LEDGE = 0.95;

export function buildLevel(layout: GenLayout): BuiltLevel {
  const col = new ColliderSet();
  const chunks = new Map<string, ChunkBuild>();
  const T = WALL_T / 2;

  // Какая из двух лестничных клеток верхняя: та, чей ярус совпадает с верхним ярусом марша.
  const upperWells = new Set<number>();
  const lowerWells = new Set<number>();
  for (const room of layout.rooms) {
    if (room.type !== 'stairwell') continue;
    const [x, z] = room.cells[0]!;
    const st = layout.stairs.find((s) => s.cx + DX[s.dir]! === x && s.cz + DZ[s.dir]! === z && (s.upperTier === room.tier || s.upperTier + 1 === room.tier));
    if (st && st.upperTier === room.tier) upperWells.add(room.id);
    else lowerWells.add(room.id);
  }

  const chunkFor = (room: GenRoom, cx: number, cz: number): ChunkBuild => {
    // Помещение — один чанк; длинные коридоры режутся блоками 4×4 клетки, чтобы отсекаться частями.
    const key = room.type === 'corridor' ? `${room.id}:${cx >> 2}:${cz >> 2}` : `${room.id}`;
    let c = chunks.get(key);
    if (!c) {
      const well = room.type === 'stairwell';
      c = { mb: new MeshBuilder(), tierMin: well ? room.tier - (lowerWells.has(room.id) ? 1 : 0) : room.tier, tierMax: well ? room.tier + (upperWells.has(room.id) ? 1 : 0) : room.tier };
      chunks.set(key, c);
    }
    return c;
  };

  const hz = layout.hazards;
  const pitAt = new Set(hz.pits.map((p) => `${p.tier},${p.x},${p.z}`));

  // ── Скорлупа по ярусам ──
  const shells: Shell[] = [];
  for (let t = 0; t < layout.tierCount; t++) shells.push(new Shell());
  for (const room of layout.rooms) {
    const style = styleFor(room);
    const y = tierFloor(room.tier);
    for (const [x, z] of room.cells) {
      const cell: ShellCell = { cx: x - HALF, cz: z - HALF, floorY: y, ceilY: y + CEIL_H, room: room.id, style };
      if (pitAt.has(`${room.tier},${x},${z}`)) cell.noFloor = true;
      if (upperWells.has(room.id)) cell.noFloor = true;
      else if (lowerWells.has(room.id)) {
        // Нижняя часть шахты марша тянется до пола верхнего яруса и открыта вверх.
        cell.ceilY = y + TIER_DROP;
        cell.noCeil = true;
      }
      shells[room.tier]!.add(cell);
    }
  }
  for (const e of layout.edges) {
    const sh = shells[e.tier]!;
    if (e.kind === 'open') sh.setOpen(e.cx - HALF, e.cz - HALF, e.dir);
    else sh.setDoor(e.cx - HALF, e.cz - HALF, e.dir);
  }
  const roomById = (id: number): GenRoom => layout.rooms[id]!;
  for (const sh of shells) buildShell(sh, (c) => chunkFor(roomById(c.room), c.cx + HALF, c.cz + HALF).mb, col);

  // ── Лестничные марши ──
  for (const s of layout.stairs) {
    const well = layout.rooms.find((r) => upperWells.has(r.id) && r.tier === s.upperTier && r.cells[0]![0] === s.cx + DX[s.dir]! && r.cells[0]![1] === s.cz + DZ[s.dir]!)!;
    const c = chunkFor(well, 0, 0);
    // Марш спускается вдоль локальной оси −x; начало — середина ребра между площадкой и первой клеткой марша.
    const rot = ([2, 1, 0, 3] as const)[s.dir]!;
    const ox = cellToWorld(s.cx) + DX[s.dir]! * (CELL / 2);
    const oz = cellToWorld(s.cz) + DZ[s.dir]! * (CELL / 2);
    stairsDown(new Xf(c.mb, col, ox, tierFloor(s.upperTier), oz, rot), STAIR_STEPS, STAIR_RISE, STAIR_RUN, -CELL / 2 + T, CELL / 2 - T);
  }

  // ── Двери ──
  // В игре двери не открывают: проём либо пуст (коробка осталась), либо створка распахнута, либо
  // сорвана — прислонена к стене рядом или лежит на полу за проёмом.
  const hazardCells = new Set([...hz.pits, ...hz.water, ...hz.collapses].map((c) => `${c.tier},${c.x},${c.z}`));
  /** Участки стен у дверей, занятые прислонённой створкой: обстановка их пропускает. */
  const blockedSlots = new Set<string>();
  const gridAt = (tier: number, x: number, z: number): GenRoom | undefined => {
    const c = shells[tier]!.get(x - HALF, z - HALF);
    return c ? roomById(c.room) : undefined;
  };
  for (const e of layout.edges) {
    if (e.kind === 'open') continue;
    const a = gridAt(e.tier, e.cx, e.cz)!;
    const bx = e.cx + (e.dir === 0 ? 1 : 0);
    const bz = e.cz + (e.dir === 1 ? 1 : 0);
    const b = gridAt(e.tier, bx, bz)!;
    // Створка открывается внутрь помещения, чтобы не перегораживать коридор.
    const intoB = b.type !== 'corridor';
    const toward = e.dir === 0 ? (intoB ? 0 : 2) : intoB ? 1 : 3;
    const host = intoB ? b : a;
    const hostCell: [number, number] = intoB ? [bx, bz] : [e.cx, e.cz];
    const wx = cellToWorld(e.cx) + (e.dir === 0 ? CELL / 2 : 0);
    const wz = cellToWorld(e.cz) + (e.dir === 1 ? CELL / 2 : 0);
    const y = tierFloor(e.tier);
    const xf = new Xf(chunkFor(host, hostCell[0], hostCell[1]).mb, col, wx, y, wz, ROT_FACING[toward]!);
    if (e.kind === 'hermo') hermoDoor(xf);
    else {
      const tint: Vec3 = host.type === 'medical' ? [1.5, 1.5, 1.45] : [0.9 + ((host.id * 7) % 5) * 0.05, 0.85, 0.8];
      doorFrame(xf, tint);
      // Шахта лестницы и клетки с опасностями остаются как есть: створка распахнута.
      const plain = a.type === 'stairwell' || b.type === 'stairwell' || hazardCells.has(`${e.tier},${hostCell[0]},${hostCell[1]}`) || hazardCells.has(`${e.tier},${e.cx},${e.cz}`) || hazardCells.has(`${e.tier},${bx},${bz}`);
      const h = plain ? 0.35 : hash01(e.cx * 64 + e.cz, e.dir + 2 * e.tier, layout.seed ^ 0xd00d);
      const seed = Math.floor(hash01(e.cz * 64 + e.cx, e.tier, layout.seed ^ 0xbeef) * 1e6);
      let lean = h >= 0.65 && h < 0.85;
      let side: 1 | -1 = hash2(e.cx, e.cz, layout.seed ^ e.dir) & 1 ? 1 : -1;
      if (lean) {
        // Прислонить можно к глухому участку той же стены; у одноклеточных помещений стену не отнимаем.
        const ax = xf.pt(1, 0, 0);
        const dirPlus = Math.abs(ax[0] - xf.ox) > 0.5 ? (ax[0] > xf.ox ? 0 : 2) : ax[2] > xf.oz ? 1 : 3;
        const hsx = hostCell[0] - HALF;
        const hsz = hostCell[1] - HALF;
        const wallAt = (sd: 1 | -1): boolean => shells[e.tier]!.edge(hsx, hsz, sd === 1 ? dirPlus : (dirPlus + 2) % 4) === 'wall';
        if (host.cells.length < 2) lean = false;
        else if (!wallAt(side)) {
          side = side === 1 ? -1 : 1;
          if (!wallAt(side)) lean = false;
        }
        if (lean) {
          blockedSlots.add(`${e.tier},${hostCell[0]},${hostCell[1]},${side === 1 ? dirPlus : (dirPlus + 2) % 4}`);
        }
      }
      if (h < 0.35) {
        // Только коробка.
      } else if (h < 0.65 || (h < 0.85 && !lean)) doorLeaf(xf, tint);
      else if (lean) {
        // Створка сорвана и прислонена к стене у проёма: от косяка до угла остаётся не меньше 0,9 м прохода.
        ALL_PROPS.door_leaf_lean!.build(xf.child(side * 0.9, 0, 0.17), seed);
      } else {
        // Лежит на полу сразу за проёмом, плашмя: перешагнуть можно, преграды нет.
        ALL_PROPS.door_leaf_down!.build(xf.child(0, 0, 1.4), seed);
      }
    }
    // Табличка над дверью со стороны, противоположной створке.
    const other = intoB ? a : b;
    const otherCell: [number, number] = intoB ? [e.cx, e.cz] : [bx, bz];
    const back = ((toward + 2) % 4) as 0 | 1 | 2 | 3;
    const outer = new Xf(chunkFor(other, otherCell[0], otherCell[1]).mb, null, wx + DX[back]! * T, y, wz + DZ[back]! * T, ROT_FACING[back]!);
    doorSign(outer.child(0, 2.32, 0));
    // Трафарет справа от двери: что за ней. У гермодвери слева — предупреждение.
    const label = ROOM_LABEL[host.type];
    const ink: Vec3 = e.tier === 2 ? [0.82, 0.8, 0.76] : host.id % 3 === 0 ? [0.1, 0.1, 0.1] : [0.6, 0.11, 0.08];
    if (label && other.type !== 'stairwell') {
      const w = Math.min(SIGN[label]!.w, 0.74);
      outer.sign(label, 0.72 + w / 2, 1.52, w, ink);
    }
    if (e.kind === 'hermo' && other.type !== 'stairwell') {
      outer.sign('attention', -1.05, 1.66, 0.44, [0.6, 0.11, 0.08]);
      outer.sign('door_sector', -1.05, 1.52, 0.66, [0.6, 0.11, 0.08]);
    }
  }

  // ── Опасности среды ──
  const zones: Zone[] = [];
  const collapses: CollapseSpec[] = [];
  const roomOf = (tier: number, x: number, z: number): GenRoom => gridAt(tier, x, z)!;
  for (const p of hz.pits) {
    const room = roomOf(p.tier, p.x, p.z);
    const y = tierFloor(p.tier);
    const wx = cellToWorld(p.x);
    const wz = cellToWorld(p.z);
    const st = styleFor(room);
    pit(new Xf(chunkFor(room, p.x, p.z).mb, col, wx, y, wz, 0), CELL, PIT_HOLE, PIT_DEPTH, st.floor, st.floorTint);
    zones.push({ kind: 'pit', tier: p.tier, minX: wx - PIT_HOLE / 2, maxX: wx + PIT_HOLE / 2, minZ: wz - PIT_HOLE / 2, maxZ: wz + PIT_HOLE / 2, minY: y - PIT_DEPTH - 1, maxY: y - 0.7 });
  }
  for (const w of hz.water) {
    const room = roomOf(w.tier, w.x, w.z);
    const y = tierFloor(w.tier);
    const wx = cellToWorld(w.x);
    const wz = cellToWorld(w.z);
    waterSheet(new Xf(chunkFor(room, w.x, w.z).mb, null, wx, y, wz, 0), CELL);
    zones.push({ kind: 'water', tier: w.tier, minX: wx - CELL / 2, maxX: wx + CELL / 2, minZ: wz - CELL / 2, maxZ: wz + CELL / 2, minY: y - 0.2, maxY: y + 1 });
  }
  for (const id of hz.gasRooms) {
    const room = roomById(id);
    const y = tierFloor(room.tier);
    for (const [x, z] of room.cells) {
      const wx = cellToWorld(x);
      const wz = cellToWorld(z);
      zones.push({ kind: 'gas', tier: room.tier, minX: wx - CELL / 2 + T, maxX: wx + CELL / 2 - T, minZ: wz - CELL / 2 + T, maxZ: wz + CELL / 2 - T, minY: y - 0.2, maxY: y + CEIL_H });
    }
    // Знак у каждой двери помещения со стороны коридора.
    for (const e of layout.edges) {
      if (e.tier !== room.tier || e.kind === 'open') continue;
      const bx = e.cx + (e.dir === 0 ? 1 : 0);
      const bz = e.cz + (e.dir === 1 ? 1 : 0);
      const aIn = roomOf(e.tier, e.cx, e.cz).id === id;
      const bIn = roomOf(e.tier, bx, bz).id === id;
      if (aIn === bIn) continue;
      // Нормаль от стены в сторону коридора.
      const out = e.dir === 0 ? (aIn ? 0 : 2) : aIn ? 1 : 3;
      const host = aIn ? roomOf(e.tier, bx, bz) : roomOf(e.tier, e.cx, e.cz);
      const hostCell: [number, number] = aIn ? [bx, bz] : [e.cx, e.cz];
      const wx = cellToWorld(e.cx) + (e.dir === 0 ? CELL / 2 : 0) + DX[out]! * T;
      const wz = cellToWorld(e.cz) + (e.dir === 1 ? CELL / 2 : 0) + DZ[out]! * T;
      const xf = new Xf(chunkFor(host, hostCell[0], hostCell[1]).mb, null, wx, y + 1.5, wz, ROT_FACING[out]!);
      warningSign(xf.child(0.9, 0, 0));
    }
  }
  hz.collapses.forEach((c, i) => {
    const y = tierFloor(c.tier);
    const wx = cellToWorld(c.x);
    const wz = cellToWorld(c.z);
    // Завал лежит отдельным скрытым чанком; его преграды попадут в мир в момент обрушения.
    const mb = new MeshBuilder();
    const tmp = new ColliderSet();
    // Клетка-перемычка: проход идёт вдоль той оси, где есть коридорные соседи.
    const alongX = gridAt(c.tier, c.x + 1, c.z) !== undefined && gridAt(c.tier, c.x - 1, c.z) !== undefined;
    for (const rot of alongX ? ([1, 3] as const) : ([0, 2] as const)) collapse(new Xf(mb, tmp, wx, y, wz, rot), CEIL_H, c.x * 53 + c.z * 29 + rot);
    const id = `collapse:${i}`;
    chunks.set(id, { mb, tierMin: c.tier, tierMax: c.tier, id, hidden: true });
    collapses.push({ id, tier: c.tier, center: [wx, y, wz], boxes: tmp.boxes.slice() });
  });

  // ── Обстановка ──
  // У провала, в воде и под будущим завалом у стен пусто: там нужен проход по карнизу.
  const spots: ItemSpot[] = [];
  const landmarks: Landmark[] = [];
  // Комната-аномалия: одно помещение нижнего яруса получает два варианта обстановки. Находок и целей
  // в ней нет — иначе после подмены они повисли бы в воздухе.
  const variants: RoomVariant[] = [];
  const lastTier = layout.tierCount - 1;
  const variantRoom =
    layout.rank >= 2 && lastTier >= 2
      ? layout.rooms.filter((r) => r.tier === lastTier && VARIANT_ROOMS.has(r.type) && r.cells.length >= 2 && !hz.gasRooms.includes(r.id)).sort((a, b) => b.cells.length - a.cells.length || a.id - b.id)[0]
      : undefined;

  /** Слоты и клетки помещения; геометрия идёт в mbFor, преграды — в colSet. */
  const roomCtx = (room: GenRoom, mbFor: (x: number, z: number) => MeshBuilder, colSet: ColliderSet, salt: number, outSpots: ItemSpot[], outMarks: Landmark[]): RoomCtx => {
    const sh = shells[room.tier]!;
    const y = tierFloor(room.tier);
    const slots: Slot[] = [];
    const cells: CellInfo[] = [];
    for (const [x, z] of room.cells) {
      const mb = mbFor(x, z);
      const sx = x - HALF;
      const sz = z - HALF;
      const kinds = [0, 1, 2, 3].map((d) => sh.edge(sx, sz, d));
      const neighbours = [0, 1, 2, 3].map((d) => sh.get(sx + DX[d]!, sz + DZ[d]!));
      // Проходом считается дверь или открытое ребро в другое помещение.
      const doors = kinds.filter((k, d) => k === 'door' || (k === 'open' && neighbours[d] !== undefined && neighbours[d]!.room !== room.id)).length;
      cells.push({ cx: x, cz: z, xf: new Xf(mb, colSet, cellToWorld(x), y, cellToWorld(z), 0), doors });
      const hazard = hazardCells.has(`${room.tier},${x},${z}`);
      for (let d = 0; d < 4; d++) {
        if (kinds[d] !== 'wall') continue;
        const inward = ((d + 2) % 4) as 0 | 1 | 2 | 3;
        const rot = ROT_FACING[inward]!;
        const xf = new Xf(mb, colSet, cellToWorld(x) + DX[d]! * (CELL / 2 - T), y, cellToWorld(z) + DZ[d]! * (CELL / 2 - T), rot);
        // Локальная ось +x слота в мире и концы стены: есть ли там перпендикулярная стена или проход.
        const ax = xf.pt(1, 0, 0);
        const along = Math.abs(ax[0] - xf.ox) > 0.5 ? (ax[0] > xf.ox ? 0 : 2) : ax[2] > xf.oz ? 1 : 3;
        const kR = kinds[along]!;
        const kL = kinds[(along + 2) % 4]!;
        slots.push({ xf, cx: x, cz: z, dir: d, hazard, deep: doors === 0 && room.type !== 'corridor', cornerR: kR === 'wall' || kR === 'door', cornerL: kL === 'wall' || kL === 'door', used: blockedSlots.has(`${room.tier},${x},${z},${d}`) });
      }
    }
    // Свой ГСЧ у каждого помещения: правка одной комнаты не сдвигает остальные.
    return { room, rng: mulberry32(hash2(layout.seed, room.id, 0xf00d + salt)), h: CEIL_H, slots, cells, spots: outSpots, landmarks: outMarks };
  };

  for (const room of layout.rooms) {
    if (lowerWells.has(room.id)) continue;
    if (room !== variantRoom) {
      furnishRoom(roomCtx(room, (x, z) => chunkFor(room, x, z).mb, col, 0, spots, landmarks));
      continue;
    }
    // Два варианта: обстановка каждого — в своём чанке и своей группе коллайдеров.
    const names = ['a', 'b'] as const;
    const ids = names.map((n) => `variant:${room.id}:${n}`);
    names.forEach((_, i) => {
      const mb = new MeshBuilder();
      const tmp = new ColliderSet();
      furnishRoom(roomCtx(room, () => mb, tmp, i * 7919, [], []));
      chunks.set(ids[i]!, { mb, tierMin: room.tier, tierMax: room.tier, id: ids[i]!, hidden: i === 1 });
      for (const b of tmp.boxes) col.add({ ...b, group: ids[i]!, off: i === 1 });
    });
    let cx = 0;
    let cz = 0;
    for (const [x, z] of room.cells) {
      cx += cellToWorld(x);
      cz += cellToWorld(z);
    }
    variants.push({ room: room.id, tier: room.tier, center: [cx / room.cells.length, tierFloor(room.tier), cz / room.cells.length], chunkA: ids[0]!, chunkB: ids[1]!, groupA: ids[0]!, groupB: ids[1]! });
  }

  // ── Навигационный граф: узел на клетку; нижние части шахт — те же места, что верхние, узлов не получают ──
  const nav: NavNode[] = [];
  const nodeAt = new Map<string, number>();
  const nk = (t: number, x: number, z: number): string => `${t},${x},${z}`;
  for (const room of layout.rooms) {
    if (lowerWells.has(room.id)) continue;
    for (const [x, z] of room.cells) {
      let y = tierFloor(room.tier);
      if (upperWells.has(room.id)) {
        const st = layout.stairs.find((s) => s.upperTier === room.tier && [1, 2, 3].some((i) => s.cx + DX[s.dir]! * i === x && s.cz + DZ[s.dir]! * i === z))!;
        const i = Math.abs(x - st.cx) + Math.abs(z - st.cz);
        y -= ((i - 0.5) / STAIR_CELLS) * TIER_DROP;
      }
      // У провала узел стоит на карнизе, а не над дырой: по нему ходит и тест маршрута, и рой.
      let ox = 0;
      let oz = 0;
      if (pitAt.has(nk(room.tier, x, z))) {
        const alongX = gridAt(room.tier, x + 1, z)?.id === room.id && gridAt(room.tier, x - 1, z)?.id === room.id;
        if (alongX) oz = PIT_LEDGE;
        else ox = PIT_LEDGE;
      }
      nodeAt.set(nk(room.tier, x, z), nav.length);
      nav.push({ id: nav.length, tier: room.tier, cx: x, cz: z, x: cellToWorld(x) + ox, y, z: cellToWorld(z) + oz, room: room.id, links: [] });
    }
  }
  const link = (a: number | undefined, b: number | undefined): void => {
    if (a === undefined || b === undefined || a === b) return;
    if (!nav[a]!.links.includes(b)) nav[a]!.links.push(b);
    if (!nav[b]!.links.includes(a)) nav[b]!.links.push(a);
  };
  for (const n of nav.slice()) {
    for (const d of [0, 1]) {
      const m = nodeAt.get(nk(n.tier, n.cx + DX[d]!, n.cz + DZ[d]!));
      if (m !== undefined && nav[m]!.room === n.room) link(n.id, m);
    }
  }
  for (const e of layout.edges) {
    const a = nodeAt.get(nk(e.tier, e.cx, e.cz));
    const b = nodeAt.get(nk(e.tier, e.cx + (e.dir === 0 ? 1 : 0), e.cz + (e.dir === 1 ? 1 : 0)));
    // Ребро внизу марша ведёт из нижней части шахты (узла нет) — его заменяет связь «низ марша — площадка».
    link(a, b);
  }
  for (const s of layout.stairs) {
    const bottom = nodeAt.get(nk(s.upperTier, s.cx + DX[s.dir]! * STAIR_CELLS, s.cz + DZ[s.dir]! * STAIR_CELLS));
    const landing = nodeAt.get(nk(s.upperTier + 1, s.cx + DX[s.dir]! * (STAIR_CELLS + 1), s.cz + DZ[s.dir]! * (STAIR_CELLS + 1)));
    link(bottom, landing);
  }

  const ent = layout.rooms[layout.entranceRoom]!;
  const [ex, ez] = ent.cells[0]!;
  const out: LevelChunk[] = [];
  for (const c of chunks.values()) if (c.mb.triangleCount > 0) out.push({ mesh: c.mb.build(), tierMin: c.tierMin, tierMax: c.tierMax, ...(c.id ? { id: c.id } : {}), ...(c.hidden ? { hidden: true } : {}) });
  const stairs: StairLink[] = layout.stairs.map((s) => ({
    upperTier: s.upperTier,
    top: [cellToWorld(s.cx), tierFloor(s.upperTier), cellToWorld(s.cz)],
    bottom: [cellToWorld(s.cx + DX[s.dir]! * (STAIR_CELLS + 1)), tierFloor(s.upperTier + 1), cellToWorld(s.cz + DZ[s.dir]! * (STAIR_CELLS + 1))],
  }));
  return {
    chunks: out,
    stairs,
    colliders: col,
    // Старт — у люка, лицом к шлюзу (на север).
    spawn: { pos: [cellToWorld(ex), 0, cellToWorld(ez) + 0.4], yaw: 0 },
    exit: [cellToWorld(ex), 0, cellToWorld(ez)],
    spots,
    landmarks,
    zones,
    collapses,
    variants,
    nav,
    sheets: [...chunks.values()].filter((c) => !c.hidden).flatMap((c) => c.mb.sheets),
    layout,
  };
}
