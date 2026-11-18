/**
 * Где встают вещи партнёра (world/placed.ts). Правило вещи — то же, что у фигуры: край помещения (угол,
 * стена, проём, середина, потолок), сдвиг от него, «лицом куда», высота, сколько. Края считает тот же код,
 * что у фигур (world/figure_place.ts, anchorSpots), — поэтому инструмент (tools/constructor), где партнёр
 * ставит вещь руками в настоящее помещение, и игра, где та же вещь встаёт в другие помещения того же типа,
 * понимают правило одинаково.
 *
 * Что вещь обязана соблюдать (их же показывает инструмент):
 * - не перекрывать проход: перед каждым проёмом помещения остаётся «горло» 1,2 × 1 м, куда низкая вещь
 *   не встаёт (то, что висит выше 1,9 м, проходу не мешает); посреди коридора — тоже нельзя;
 * - не врастать в стены, мебель и друг в друга: коробка вещи не задевает преград уровня;
 * - помещаться под потолком и не стоять над провалом (если не висит в воздухе);
 * - не стоять у самого начала места: там игрок появляется;
 * - поворачиваться четвертями: коробки и преграды обстановки прямые (world/props.ts, Xf).
 * Где правило не выполнить — вещи на этом уровне просто нет, как у фигур.
 *
 * Помещения и края перебираются по сиду уровня и ключу расстановки: тот же сид — те же места; правка одной
 * расстановки не сдвигает остальные.
 *
 * Здесь же — вещи игры, которые партнёр передвинул (placed.ts, moves): куда такая встаёт в своём помещении (moveSpot), и как
 * найти помещение точки и номер вещи в нём (roomIndex, gameNth) — одинаково в сборке уровня и в инструменте.
 *
 * Чистый TS: работает в сборке уровня (Worker), в инструменте и в тестах.
 */
import { isTilted, tiltBox, tiltPose } from './tilt';
import type { Tilt } from './tilt';
import { hash01, hash2 } from '../core/rng';
import type { Vec3 } from '../core/types';
import { GRID, TIER_DROP } from '../gen/layout';
import type { GenLayout, GenRoom } from '../gen/layout';
import type { Aabb } from './colliders';
import { anchorSpots, roomNear } from './figure_place';

export { roomNear };
import type { AnchorSpot, PlaceWorld } from './figure_place';
import type { FigureFacing } from './figures';
import type { LevelObject } from './objects';
import type { PlacedOpen, PlacedSpec } from './placed';
import type { PropSpec } from './props_more';
import { CELL, DIRS } from './shell';

const HALF = GRID / 2;
/** Горло проёма: ширина вдоль стены и глубина в помещение, м. */
export const THROAT_W = 1.2;
export const THROAT_D = 1.0;
/** Выше этого над полом вещь проходу не мешает, м. */
export const HEADROOM = 1.9;
/** Не ближе к началу места, м (как у фигур). */
const SPAWN_CLEAR = 3.2;
/** Зазор до преград, м: вещь может касаться стены спиной, но не входить в неё. */
const SKIN = 0.03;

/** Помещения, куда вещи не ставятся: лестничные марши, лифт, пути под перроном (как у фигур). Вещи игры там не двигают. */
export const NEVER: ReadonlySet<string> = new Set(['stairwell', 'lift', 'track']);

export type Turn = 0 | 1 | 2 | 3;

/** Где встала вещь: ключ расстановки, номер экземпляра, какая вещь, точка (низ — y), поворот четвертями. */
export interface PlacedSpot {
  id: string;
  k: number;
  prop: string;
  at: Vec3;
  rot: Turn;
  room: number;
  tier: number;
  /** Передвинутая вещь игры (placed.ts, moves): встала по правилу записи в своём помещении. */
  moved?: true;
  /**
   * Дверцы и ящики: по записи (placed.ts, PlacedSpec.open); у записи «как выпадет» — 'shut', если открытым дверцам здесь впереди
   * тесно (doorsAt); нет — как выпадет.
   */
  open?: PlacedOpen;
  /** Доворот по всем осям (placed.ts, PlacedSpec.tilt; world/tilt.ts): сборка уровня поворачивает собранное. */
  tilt?: Tilt;
}

/**
 * Помещение точки: по её клетке и ярусу (ярус — по высоте: пол яруса t на −4,5·t м, вещь стоит на нём или висит на стене).
 * Так помещение вещи игры находят и сборка уровня (хук записей партнёра, level_build.ts), и инструмент — одинаково.
 */
export function roomIndex(layout: GenLayout): (x: number, y: number, z: number) => GenRoom | undefined {
  const byCell = new Map<string, GenRoom>();
  for (const r of layout.rooms) for (const [x, z] of r.cells) byCell.set(`${r.tier},${x},${z}`, r);
  return (x, y, z) => byCell.get(`${-Math.floor((y + 0.2) / TIER_DROP)},${Math.round(x / CELL) + HALF},${Math.round(z / CELL) + HALF}`);
}

/**
 * Номер вещи игры в её помещении (placed.ts, GameThing) — так, как его считает сборка уровня: среди объектов уровня с тем же
 * именем в том же помещении, по порядку сборки (номеру объекта), с нуля. objects — объекты уровня, собранного без записей
 * партнёра; roomAt — roomIndex того же плана. Вещи вне помещений — −1.
 */
export function gameNth(objects: readonly LevelObject[], o: LevelObject, roomAt: (x: number, y: number, z: number) => GenRoom | undefined): number {
  const room = roomAt(o.at[0], o.at[1], o.at[2]);
  if (!room) return -1;
  let n = 0;
  for (const q of objects) {
    if (q.id >= o.id) break;
    if (q.name === o.name && roomAt(q.at[0], q.at[1], q.at[2]) === room) n += 1;
  }
  return n;
}

/** Коробка в мире (без меток коллайдера). */
export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Поворот четвертями из угла «лицом куда» (рад; 0 — к +z, как у фигур). Тот же, что у Xf: 1 — лицом к +x. */
export const rotOf = (yaw: number): Turn => ((((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4) as Turn);

/**
 * Коробка вещи в её координатах: у стены — спина в z = 0, посреди пола — середина в начале (world/props_real.ts). reach — на
 * сколько вперёд выходят открытые дверцы и ящики (вещь партнёра, открытая по записи: PlacedSpec.open).
 */
export function propBox(p: PropSpec, reach = 0): { min: Vec3; max: Vec3 } {
  const free = p.mount === 'free';
  return { min: [-p.w / 2, 0, free ? -p.d / 2 : 0], max: [p.w / 2, p.h, (free ? p.d / 2 : p.d) + reach] };
}

/**
 * Проверка точки для вещи партнёра с дверцами (квиз 18.11, «Как выпадет + переключатель»): «открыто» — коробка с вылетом;
 * «как выпадет» у вещи, которой есть что открыть, — открытым дверцам должно хватить места впереди (не в проход, не в соседа,
 * не в стену); не хватает — здесь она закрыта (open: 'shut'), как вещи игры у проёмов, а хватает — место для дверец за ней
 * держится (коробка с вылетом). others — коробки уже поставленных вещей.
 */
export function doorsAt(spec: Pick<PlacedSpec, 'open' | 'tilt'>, p: PropSpec, at: Vec3, rot: Turn, room: GenRoom, a: Pick<AnchorSpot, 'floor' | 'ceil' | 'pit' | 'tier'>, w: PlaceWorld, others: readonly Box[] = []): SpotCheck & { open?: PlacedOpen } {
  const chk = checkSpot(p, at, rot, room, a, w, others, reachOf(p, spec.open), spec.tilt);
  if (spec.open) return { ...chk, open: spec.open };
  if (chk.problems.length > 0 || !((p.reach ?? 0) > 0)) return chk;
  const wide = checkSpot(p, at, rot, room, a, w, others, p.reach, spec.tilt);
  return wide.problems.length > 0 ? { ...chk, open: 'shut' } : wide;
}

/** Сид k-й копии вещи партнёра на уровне с сидом layoutSeed: с ним её строит сборка (level_build.ts) и показывает конструктор. */
export const placedSeed = (layoutSeed: number, k: number, id: string): number => (hash2(layoutSeed, k + 1, id.length * 977) >>> 0) % 1000003;

/** Вылет вещи по записи: у открытой — дверцы и ящики до предела (PropSpec.reach), у прочих — ничего (как у вещей игры). */
export const reachOf = (p: PropSpec, open?: PlacedOpen): number => (open === 'open' ? (p.reach ?? 0) : 0);

/** Точка вещи в мире — тот же поворот, что у Xf.pt. */
function turnPt(x: number, z: number, rot: Turn): [number, number] {
  if (rot === 1) return [z, -x];
  if (rot === 2) return [-x, -z];
  if (rot === 3) return [-z, x];
  return [x, z];
}

/**
 * Коробка вещи в мире: точка at (низ), поворот rot; reach — вылет открытых дверец (propBox); tilt — доворот по всем осям
 * (world/tilt.ts): тогда габарит повёрнутой коробки, легшей на опору.
 */
export function worldBox(p: PropSpec, at: Vec3, rot: Turn, reach = 0, tilt?: Tilt): Box {
  let { min, max } = propBox(p, reach);
  if (isTilted(tilt)) {
    const pts: number[] = [];
    for (let k = 0; k < 8; k++) pts.push(k & 1 ? max[0] : min[0], k & 2 ? max[1] : min[1], k & 4 ? max[2] : min[2]);
    [min, max] = tiltBox(tiltPose(pts, tilt, p.mount), min, max);
  }
  const [ax, az] = turnPt(min[0], min[2], rot);
  const [bx, bz] = turnPt(max[0], max[2], rot);
  return { minX: at[0] + Math.min(ax, bx), maxX: at[0] + Math.max(ax, bx), minY: at[1] + min[1], maxY: at[1] + max[1], minZ: at[2] + Math.min(az, bz), maxZ: at[2] + Math.max(az, bz) };
}

const overlap = (a: Box, b: Box, m = 0): boolean => a.minX < b.maxX - m && a.maxX > b.minX + m && a.minZ < b.maxZ - m && a.maxZ > b.minZ + m && a.minY < b.maxY - m && a.maxY > b.minY + m;

/** Проём помещения: точка посреди проёма и «внутрь» — нормаль в помещение. */
export interface DoorGap {
  x: number;
  z: number;
  nx: number;
  nz: number;
}

/** Проёмы помещения (двери и открытые стыки с другими помещениями). */
export function roomDoors(room: GenRoom, w: Pick<PlaceWorld, 'shells'>): DoorGap[] {
  const sh = w.shells[room.tier]!;
  const out: DoorGap[] = [];
  for (const [gx, gz] of room.cells) {
    const sx = gx - HALF;
    const sz = gz - HALF;
    for (let d = 0; d < 4; d++) {
      const a = DIRS[d]!;
      const k = sh.edge(sx, sz, d);
      const nb = sh.get(sx + a[0], sz + a[1]);
      if (!(k === 'door' || (k === 'open' && nb !== undefined && nb.room !== room.id))) continue;
      out.push({ x: sx * CELL + a[0] * (CELL / 2), z: sz * CELL + a[1] * (CELL / 2), nx: -a[0], nz: -a[1] });
    }
  }
  return out;
}

/** Горло проёма: куда низкая вещь не встаёт. */
export function throatBox(d: DoorGap, floor: number): Box {
  const cx = d.x + d.nx * (THROAT_D / 2);
  const cz = d.z + d.nz * (THROAT_D / 2);
  const hx = d.nx !== 0 ? THROAT_D / 2 : THROAT_W / 2;
  const hz = d.nz !== 0 ? THROAT_D / 2 : THROAT_W / 2;
  return { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz, minY: floor, maxY: floor + HEADROOM };
}

const yawFor = (a: AnchorSpot, f: FigureFacing): number => (f === 'room' ? a.phi : f === 'wall' ? a.wall : f === 'door' ? a.door : a.entry);

/** Точка и поворот вещи по правилу у края a. Как в инструменте: край + сдвиг, повёрнутый по рамке края. */
export function fitThing(spec: Pick<PlacedSpec, 'rule' | 'turn' | 'offset'>, a: AnchorSpot, p: PropSpec): { at: Vec3; rot: Turn } {
  const c = Math.cos(a.phi);
  const s = Math.sin(a.phi);
  const [ox, oz] = spec.offset;
  const x = a.x + ox * c + oz * s;
  const z = a.z - ox * s + oz * c;
  // Под потолком — верхом под самый потолок; иначе — на заданной высоте, но не выше потолка.
  const top = a.ceil - 0.02 - p.h;
  const y = spec.rule.anchor === 'ceiling' ? Math.max(a.floor, top) : Math.max(a.floor, Math.min(a.floor + spec.rule.lift, top));
  return { at: [x, y, z], rot: (((rotOf(yawFor(a, spec.rule.facing)) + spec.turn) % 4) as Turn) };
}

/** Почему вещь не встанет в этой точке — по-русски; пусто — встанет. */
export interface SpotCheck {
  /** Коробка вещи в мире. */
  box: Box;
  problems: string[];
}

const scratch: Aabb[] = [];

/**
 * Проверка одной точки: те же правила, по которым игра ищет место (их же видит партнёр в инструменте).
 * others — коробки уже поставленных вещей; reach — вылет открытых дверец (reachOf).
 */
export function checkSpot(p: PropSpec, at: Vec3, rot: Turn, room: GenRoom, a: Pick<AnchorSpot, 'floor' | 'ceil' | 'pit' | 'tier'>, w: PlaceWorld, others: readonly Box[] = [], reach = 0, tilt?: Tilt): SpotCheck {
  const box = worldBox(p, at, rot, reach, tilt);
  const problems: string[] = [];
  const lift = at[1] - a.floor;
  if (box.maxY > a.ceil - 0.01) problems.push('не помещается под потолком');
  if (a.pit && lift < 0.3) problems.push('под ней провал');
  if (room.type === 'corridor' && lift < HEADROOM && !nearWall(box, room, w)) problems.push('посреди коридора: перекроет путь');
  if (lift < HEADROOM) {
    for (const d of roomDoors(room, w)) {
      if (overlap(box, throatBox(d, a.floor))) {
        problems.push('перекрывает проход');
        break;
      }
    }
  }
  if (a.tier === w.spawnTier && Math.hypot((box.minX + box.maxX) / 2 - w.spawn[0], (box.minZ + box.maxZ) / 2 - w.spawn[2]) < SPAWN_CLEAR) problems.push('у самого начала места');
  w.col.query(box.minX + SKIN, box.minZ + SKIN, box.maxX - SKIN, box.maxZ - SKIN, scratch);
  for (const b of scratch) {
    if (b.off || b.gone) continue;
    // Плита пола (верх не выше пола) не в счёт: на ней вещь стоит.
    if (b.maxY <= a.floor + 0.02) continue;
    if (overlap(box, b, SKIN)) {
      problems.push('врастает в стену или мебель');
      break;
    }
  }
  if (others.some((o) => overlap(box, o, SKIN))) problems.push('задевает другую поставленную вещь');
  return { box, problems };
}

/** Вещь в коридоре стоит у стены: её коробка касается полосы 0,9 м у глухой стены клетки. */
function nearWall(box: Box, room: GenRoom, w: Pick<PlaceWorld, 'shells'>): boolean {
  const sh = w.shells[room.tier]!;
  for (const [gx, gz] of room.cells) {
    const sx = gx - HALF;
    const sz = gz - HALF;
    for (let d = 0; d < 4; d++) {
      if (sh.edge(sx, sz, d) !== 'wall') continue;
      const a = DIRS[d]!;
      // Полоса у стены внутри клетки: от стены на 0,9 м внутрь.
      const ex = sx * CELL + a[0] * (CELL / 2);
      const ez = sz * CELL + a[1] * (CELL / 2);
      const strip: Box = {
        minX: a[0] !== 0 ? Math.min(ex, ex - a[0] * 0.9) : sx * CELL - CELL / 2,
        maxX: a[0] !== 0 ? Math.max(ex, ex - a[0] * 0.9) : sx * CELL + CELL / 2,
        minZ: a[1] !== 0 ? Math.min(ez, ez - a[1] * 0.9) : sz * CELL - CELL / 2,
        maxZ: a[1] !== 0 ? Math.max(ez, ez - a[1] * 0.9) : sz * CELL + CELL / 2,
        minY: -1e9,
        maxY: 1e9,
      };
      // Вся вещь — в полосе (с допуском 5 см).
      if (box.minX >= strip.minX - 0.05 && box.maxX <= strip.maxX + 0.05 && box.minZ >= strip.minZ - 0.05 && box.maxZ <= strip.maxZ + 0.05) return true;
    }
  }
  return false;
}

/** Ключ расстановки числом: свой порядок перебора мест у каждой. */
function idHash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Помещения, куда правило вообще пускает вещь. */
export function roomsFor(spec: Pick<PlacedSpec, 'rule'>, w: PlaceWorld): GenRoom[] {
  if (!spec.rule.worlds.includes(w.layout.world)) return [];
  return w.layout.rooms.filter((r) => !w.skip.has(r.id) && !NEVER.has(r.type) && (spec.rule.rooms.length === 0 || spec.rule.rooms.includes(r.type)));
}

/** Насколько край далёк от того, где вещь отпустили (в долях рамки помещения); без near — 0: решает жребий. */
function nearCost(spec: PlacedSpec, room: GenRoom, a: AnchorSpot): number {
  if (!spec.near) return 0;
  const [u, v] = roomNear(room, a.x, a.z);
  return Math.hypot(u - spec.near[0], v - spec.near[1]);
}

/**
 * Расставить вещи по уровню. Вещь встаёт, только если её место в правиле и есть помещение нужного типа;
 * сколько — rule.count, по возможности в разных помещениях. Вещи, которой нет в реестре, нет и на уровне.
 */
/**
 * roomOk — пускает ли запись в помещение сверх её правила (вариант расстановки, world/variants.ts); нет — пускает.
 */
export function placeThings(specs: readonly PlacedSpec[], w: PlaceWorld, props: Readonly<Record<string, PropSpec>>, roomOk?: (spec: PlacedSpec, room: GenRoom) => boolean): PlacedSpot[] {
  const out: PlacedSpot[] = [];
  const boxes: Box[] = [];
  for (const spec of specs) {
    // Замены ставит сама сборка уровня, на место вещи игры (world/props_all.ts, withSwap); передвинутые вещи игры — тоже она,
    // в их помещениях (moveSpot).
    if (spec.replaces || spec.moves) continue;
    const p = props[spec.prop];
    if (!p) continue;
    const rooms = roomsFor(spec, w).filter((r) => !roomOk || roomOk(spec, r));
    if (rooms.length === 0) continue;
    const h = idHash(spec.id);
    const cands = rooms.flatMap((r) => anchorSpots(r, spec.rule.anchor, w).map((a) => ({ a, r, d: nearCost(spec, r, a) })));
    const used = new Set<number>();
    for (let k = 0; k < spec.rule.count; k++) {
      // Сначала край, ближайший к тому, где вещь отпустили (near; в каждом помещении — у того же его края), потом — по жребию.
      const order = cands.map((c, i) => ({ ...c, q: hash01(i * 7 + 1, k * 131 + 17, hash2(w.layout.seed, h, 0x7a11)) })).sort((x, y) => x.d - y.d || x.q - y.q);
      let pick: PlacedSpot | null = null;
      let pickBox: Box | null = null;
      for (const pass of [0, 1]) {
        for (const { a, r } of order) {
          if (pass === 0 && used.has(a.room)) continue;
          const { at, rot } = fitThing(spec, a, p);
          const { box, problems, open } = doorsAt(spec, p, at, rot, r, a, w, boxes);
          if (problems.length > 0) continue;
          pick = { id: spec.id, k, prop: spec.prop, at, rot, room: a.room, tier: a.tier, ...(open ? { open } : {}), ...(isTilted(spec.tilt) ? { tilt: spec.tilt } : {}) };
          pickBox = box;
          break;
        }
        if (pick) break;
      }
      if (!pick || !pickBox) break;
      used.add(pick.room);
      boxes.push(pickBox);
      out.push(pick);
    }
  }
  return out;
}

/**
 * Куда встанет передвинутая вещь игры (placed.ts, moves) в помещении room: по правилу записи — те же края, точка и проверки,
 * что у вещей партнёра (placeThings: не в проход, не в мебель, под потолком). Края помещения перебираются по хешу сида, ключа
 * записи и номера помещения: тот же сид — та же точка, другие записи её не сдвигают (кроме тех, что уже встали рядом: others —
 * их коробки). Места нет — null: вещь стоит, где её поставила игра.
 */
export function moveSpot(spec: PlacedSpec, room: GenRoom, w: PlaceWorld, props: Readonly<Record<string, PropSpec>>, others: readonly Box[] = []): { spot: PlacedSpot; box: Box } | null {
  const p = props[spec.prop];
  if (!p || NEVER.has(room.type) || w.skip.has(room.id)) return null;
  const h = hash2(w.layout.seed, idHash(spec.id), room.id);
  // Сначала край, ближайший к тому, где вещь отпустили (near), потом — по жребию.
  const order = anchorSpots(room, spec.rule.anchor, w)
    .map((a, i) => ({ a, d: nearCost(spec, room, a), q: hash01(i * 7 + 1, 0x3a7, h) }))
    .sort((x, y) => x.d - y.d || x.q - y.q);
  for (const { a } of order) {
    const { at, rot } = fitThing(spec, a, p);
    const { box, problems, open } = doorsAt(spec, p, at, rot, room, a, w, others);
    if (problems.length > 0) continue;
    return { spot: { id: spec.id, k: 0, prop: spec.prop, at, rot, room: room.id, tier: room.tier, moved: true, ...(open ? { open } : {}), ...(isTilted(spec.tilt) ? { tilt: spec.tilt } : {}) }, box };
  }
  return null;
}
