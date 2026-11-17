/**
 * Конструктор Untitled Session (слова партнёра 17.11: «мне нужен очень простой редактор расстановки объектов
 * по локациям из этой библиотеки. С пониманием игры, ограничений и тд. Начни писать его, совмести с
 * редактором и расстановкой манекенов. Это просто конструктор, где можно перетащить вещь в пространство и
 * поставить»). Вырос из инструмента фигур (tools/figures): манекена здесь так же гнут руками.
 *
 * Пространство — настоящее помещение места, собранное тем же кодом, что в игре (generateLayout → buildLevel),
 * со своей обстановкой. Партнёр тащит вещь с полки в помещение, двигает по полу, поворачивает, поднимает.
 * Конструктор сам понимает, у чего она стоит (угол, стена, проём, середина) и куда смотрит, и показывает это
 * правилом: в игре план места каждый раз новый, и вещь встаёт в помещения того же типа у такого же края.
 * Правило и проверки — общий код с игрой (world/placed.ts, world/placed_place.ts, world/figure_place.ts):
 * что здесь красное, того в игре не будет.
 *
 * Сохранённое лежит в базе страницы: вещи — коллекция things, фигуры — figures. Основная модель забирает их
 * оттуда в игру (world/placed_data.ts, world/figures_data.ts).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { generateLayout } from '../../src/gen/layout';
import type { GenRoom, WorldKind } from '../../src/gen/layout';
import type { Vec3 } from '../../src/core/types';
import { anchorSpots, fitSpot } from '../../src/world/figure_place';
import type { AnchorSpot, PlaceWorld } from '../../src/world/figure_place';
import { clonePose, handlePoint, HANDLES, solve } from '../../src/world/figure_ik';
import type { Handle } from '../../src/world/figure_ik';
import { FIGURE_ANCHORS, FIGURE_FACINGS, FIGURE_MATERIALS, FIGURE_WORLDS, figureProblems } from '../../src/world/figures';
import type { FigureAnchor, FigureFacing, FigureMaterial, FigureSpec } from '../../src/world/figures';
import { MeshBuilder } from '../../src/world/kit';
import { buildLevel } from '../../src/world/level_build';
import type { BuiltLevel } from '../../src/world/level';
import { MAT_DEFS, hexToLinear } from '../../src/world/materials';
import { placeable, placedProblems, swapFits } from '../../src/world/placed';
import type { LevelObject } from '../../src/world/objects';
import type { PlacedSpec } from '../../src/world/placed';
import { checkSpot, fitThing, HEADROOM, placeThings, roomDoors, rotOf, throatBox } from '../../src/world/placed_place';
import { placeFigures } from '../../src/world/figure_place';
import type { Turn } from '../../src/world/placed_place';
import { Xf } from '../../src/world/props';
import { ALL_PROPS, FIXED } from '../../src/world/props_all';
import type { PropSpec } from '../../src/world/props_more';
import { POSES, skeleton } from '../../src/world/props_people';
import type { Pose, PoseName } from '../../src/world/props_people';
import { GRID } from '../../src/gen/layout';
import { CELL } from '../../src/world/shell';
import { setThingRegistry } from '../../src/world/thing_mesh';
import { figure, materialFor, matcap, PAINTS } from '../matcaps/look';

setThingRegistry(ALL_PROPS);
const HALF = GRID / 2;

// ───────────────────────────── подписи ─────────────────────────────

const WORLD_RU: Record<WorldKind, string> = { shelter: 'убежище', office: 'офис', yellow: 'жёлтые комнаты', station: 'зал ожидания' };
const ROOM_RU: Record<string, string> = {
  entrance: 'вход', airlock: 'шлюз', corridor: 'коридор', stairwell: 'лестница', dorm: 'спальный отсек', living: 'гостиная', command: 'пункт управления',
  kitchen: 'кухня', medical: 'медпункт', hallway: 'прихожая', washroom: 'санузел', storage: 'кладовая', fvu: 'ФВУ', diesel: 'дизельная', bedroom: 'спальня',
  tanks: 'баки', bathroom: 'ванная', switchboard: 'щитовая', archive: 'архив', nursery: 'детская', collapsed: 'завал', reception: 'приёмная', breakroom: 'кухня офиса',
  manager: 'кабинет', files: 'картотека', meeting: 'переговорная', cubicles: 'опенспейс', department: 'отдел', hall: 'зал', vestibule: 'вход', concourse: 'зал',
  tickets: 'касса', lockers: 'камеры хранения', buffet: 'буфет', platform: 'перрон', lift: 'лифт', track: 'пути', copyroom: 'копировальная', server: 'серверная',
};
const POSE_RU: Record<PoseName, string> = { stand: 'стоит', wait: 'ждёт', look: 'смотрит вверх', call: 'с телефоном', sit: 'сидит', sofa: 'на диване', desk: 'за столом', hug: 'обхватил колени', lean: 'у стены' };
const MAT_RU: Record<FigureMaterial, string> = { wood: 'дерево', smoke: 'дым', hair: 'волосы', stone: 'камень', metal: 'металл', coal: 'уголь', skin: 'кожа', plastic: 'пластик' };
const MAT_NOTE: Partial<Record<FigureMaterial, string>> = {
  smoke: 'Дымная висит в воздухе, бледная, из редких точек. Подойдёшь ближе 2,3 м — рассеется; отойдёшь дальше 6 м — через 7 с соберётся снова.',
  hair: 'Волосатая — в ворсе. Подойдёшь ближе 1,3 м — растворится от рук к телу. Вернётся, когда свет погаснет и зажжётся, — от головы к рукам.',
};
const ANCHOR_RU: Record<FigureAnchor, string> = { corner: 'в углу', wall: 'у стены', middle: 'посреди', door: 'в проёме', ceiling: 'под потолком' };
const FACING_RU: Record<FigureFacing, string> = { wall: 'лицом в стену', room: 'лицом в комнату', door: 'на дверь', player: 'навстречу идущему' };
/** Не ставятся руками: помещения, где ничего не стоит (как в игре). */
const NO_ROOMS = new Set(['stairwell', 'lift', 'track']);

// ───────────────────────────── что редактируем ─────────────────────────────

/** Вещь в показанном помещении: правило (spec) и где она стоит здесь. */
interface ThingItem {
  kind: 'thing';
  spec: PlacedSpec;
  at: Vec3;
  rot: Turn;
}
/** Фигура в показанном помещении: правило (spec), точка подошв и поворот, рад. */
interface FigItem {
  kind: 'figure';
  spec: FigureSpec;
  at: Vec3;
  yaw: number;
}
type Item = ThingItem | FigItem;

const stamp = (): string => Date.now().toString(36);
let cur: Item | null = null;
const undo: string[] = [];
const pushUndo = (): void => {
  if (!cur) return;
  undo.push(JSON.stringify(cur));
  if (undo.length > 120) undo.shift();
};

// ───────────────────────────── место и помещение ─────────────────────────────

const SEEDS = [20041113, 7, 42, 1234, 5];
let world: WorldKind = 'shelter';
let roomType = 'kitchen';
/** Какое по счёту помещение этого типа показываем (по всем сидам). */
let roomPick = 0;
const levelCache = new Map<string, BuiltLevel>();
function levelOf(seed: number, w: WorldKind): BuiltLevel {
  const key = `${w}:${seed}`;
  let lvl = levelCache.get(key);
  if (!lvl) {
    lvl = buildLevel(generateLayout(seed, 2, w), { wear: 0, figures: [], placed: [], keepPlaceWorld: true });
    levelCache.set(key, lvl);
  }
  return lvl;
}
/** Все помещения типа по сидам: [сид, номер помещения]. */
function roomsOfType(w: WorldKind, type: string): [number, number][] {
  const out: [number, number][] = [];
  for (const seed of SEEDS) for (const r of generateLayout(seed, 2, w).rooms) if (r.type === type) out.push([seed, r.id]);
  return out;
}
const typesCache = new Map<WorldKind, string[]>();
function roomTypes(w: WorldKind): string[] {
  const have = typesCache.get(w);
  if (have) return have;
  const types = new Set<string>();
  for (const seed of SEEDS.slice(0, 3)) for (const r of generateLayout(seed, 2, w).rooms) if (!NO_ROOMS.has(r.type)) types.add(r.type);
  const out = [...types].sort((a, b) => (ROOM_RU[a] ?? a).localeCompare(ROOM_RU[b] ?? b, 'ru'));
  typesCache.set(w, out);
  return out;
}

let lvl: BuiltLevel;
let pw: PlaceWorld;
let room: GenRoom;
let floorY = 0;
let ceilY = 2.8;

// ───────────────────────────── сцена ─────────────────────────────

const viewEl = document.getElementById('view')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setClearColor(0x0e1012);
viewEl.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xdfe6ef, 0x22262b, 1.25));
const sun = new THREE.DirectionalLight(0xfff2df, 1.5);
sun.position.set(-2, 6, 3);
scene.add(sun);
const cam = new THREE.PerspectiveCamera(42, 1, 0.02, 120);
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const setNdc = (e: PointerEvent): void => {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
};
const controls = new OrbitControls(cam, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;

function resize(): void {
  const w = viewEl.clientWidth;
  const h = viewEl.clientHeight;
  renderer.setSize(w, h, false);
  cam.aspect = w / Math.max(1, h);
  cam.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewEl);

const BASE = MAT_DEFS.map((m) => hexToLinear(m.color));
const roomGroup = new THREE.Group();
scene.add(roomGroup);
// Только лицевые стороны: стена, обращённая к камере изнанкой, не рисуется — помещение видно, как кукольный домик.
const roomMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide });

/** Клетки помещения в мире: прямоугольники пола. */
function cellRects(r: GenRoom): { x0: number; x1: number; z0: number; z1: number }[] {
  return r.cells.map(([gx, gz]) => {
    const cx = (gx - HALF) * CELL;
    const cz = (gz - HALF) * CELL;
    return { x0: cx - CELL / 2, x1: cx + CELL / 2, z0: cz - CELL / 2, z1: cz + CELL / 2 };
  });
}

/** Номер объекта уровня, который в показанном помещении скрыт: его заменяет вещь партнёра. */
let hiddenObj = 0;

/** Показать помещение: только его треугольники (с кромкой стен), без потолка — чтобы смотреть сверху. */
function showRoom(keepView = false): void {
  for (const c of [...roomGroup.children]) {
    roomGroup.remove(c);
    (c as THREE.Mesh).geometry?.dispose();
  }
  // Ровно по клеткам: внутренние грани стен (в 0,15 м от края клетки) попадают, наружные — нет.
  const rects = cellRects(room).map((r) => ({ x0: r.x0 + 0.02, x1: r.x1 - 0.02, z0: r.z0 + 0.02, z1: r.z1 - 0.02 }));
  const inside = (x: number, z: number): boolean => rects.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  for (const ch of lvl.chunks) {
    if (ch.hidden || ch.tierMin > room.tier || ch.tierMax < room.tier) continue;
    const m = ch.mesh;
    const idx: number[] = [];
    for (let t = 0; t < m.index.length; t += 3) {
      const a = m.index[t]!;
      const b = m.index[t + 1]!;
      const c = m.index[t + 2]!;
      const cx = (m.position[a * 3]! + m.position[b * 3]! + m.position[c * 3]!) / 3;
      const cy = (m.position[a * 3 + 1]! + m.position[b * 3 + 1]! + m.position[c * 3 + 1]!) / 3 - floorY;
      const cz = (m.position[a * 3 + 2]! + m.position[b * 3 + 2]! + m.position[c * 3 + 2]!) / 3;
      if (!inside(cx, cz) || cy < -0.4 || cy > ceilY - floorY + 0.4) continue;
      // Заменяемая вещь игры не рисуется: на её месте — вещь партнёра.
      if (hiddenObj > 0 && m.obj && m.obj[a] === hiddenObj) continue;
      // Потолок и то, что под ним, — срезаны: помещение видно сверху, как макет.
      const ny = (m.normal[a * 3 + 1]! + m.normal[b * 3 + 1]! + m.normal[c * 3 + 1]!) / 3;
      if (cy > 2.3 && ny < -0.5) continue;
      idx.push(a, b, c);
    }
    if (idx.length === 0) continue;
    const n = m.position.length / 3;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const b = BASE[Math.round(m.mat[i]!)] ?? [0.5, 0.5, 0.5];
      const ao = m.color[i * 4 + 3]!;
      for (let k = 0; k < 3; k++) col[i * 3 + k] = Math.min(1.3, b[k]! * m.color[i * 4 + k]! * (0.45 + 0.55 * ao) * 1.5);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    roomGroup.add(new THREE.Mesh(g, roomMat));
  }
  // Горла проёмов: красноватые пятна на полу — туда низкая вещь не встаёт.
  const throatMat = new THREE.MeshBasicMaterial({ color: 0xdc7f73, transparent: true, opacity: 0.22, depthWrite: false });
  for (const d of roomDoors(room, pw)) {
    const b = throatBox(d, floorY);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(b.maxX - b.minX, b.maxZ - b.minZ), throatMat);
    plate.rotation.x = -Math.PI / 2;
    plate.position.set((b.minX + b.maxX) / 2, floorY + 0.012, (b.minZ + b.maxZ) / 2);
    roomGroup.add(plate);
  }
  // Пол для захвата мышью: невидимая плоскость на уровне пола помещения.
  floorPlane.constant = -floorY;
  const xs = cellRects(room);
  const cx = (Math.min(...xs.map((r) => r.x0)) + Math.max(...xs.map((r) => r.x1))) / 2;
  const cz = (Math.min(...xs.map((r) => r.z0)) + Math.max(...xs.map((r) => r.z1))) / 2;
  const span = Math.max(Math.max(...xs.map((r) => r.x1)) - Math.min(...xs.map((r) => r.x0)), Math.max(...xs.map((r) => r.z1)) - Math.min(...xs.map((r) => r.z0)));
  if (!keepView) {
    controls.target.set(cx, floorY + 0.8, cz);
    cam.position.set(cx + span * 0.55, floorY + span * 0.95 + 2.2, cz + span * 0.85);
    controls.update();
  }
  renderGhosts();
}
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** Выбрать место, тип помещения и номер; собрать уровень. */
function enterRoom(w: WorldKind, type: string, pick = 0): void {
  hiddenObj = 0;
  const all = roomsOfType(w, type);
  if (all.length === 0) return;
  world = w;
  roomType = type;
  roomPick = ((pick % all.length) + all.length) % all.length;
  const [seed, id] = all[roomPick]!;
  lvl = levelOf(seed, w);
  pw = lvl.placeWorld!;
  room = lvl.layout!.rooms[id]!;
  const cell = pw.shells[room.tier]!.get(room.cells[0]![0] - HALF, room.cells[0]![1] - HALF)!;
  floorY = cell.floorY;
  ceilY = cell.ceilY;
  showRoom();
  if (cur) settle(cur);
  dirty = true;
  syncPanel();
}

// ───────────────────────────── геометрия вещей ─────────────────────────────

const geoCache = new Map<string, THREE.BufferGeometry>();
/** Сетка вещи из реестра игры, в её координатах (низ y = 0). */
function geometryOf(name: string): THREE.BufferGeometry {
  const hit = geoCache.get(name);
  if (hit) return hit;
  const p = ALL_PROPS[name]!;
  const mb = new MeshBuilder();
  const sl = new MeshBuilder();
  try {
    p.build(new Xf(mb, null, 0, 0, 0, 0, sl), 7);
  } catch {
    /* вещь, которой нужен уровень вокруг, показывается тем, что успела собрать */
  }
  const data = mb.build();
  const n = data.position.length / 3;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const b = BASE[Math.round(data.mat[i]!)] ?? [0.5, 0.5, 0.5];
    const ao = 0.35 + 0.65 * data.color[i * 4 + 3]!;
    for (let k = 0; k < 3; k++) col[i * 3 + k] = Math.min(1, b[k]! * data.color[i * 4 + k]! * ao * 1.25);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(data.index, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  geoCache.set(name, g);
  return g;
}
const thingMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.05, side: THREE.DoubleSide });
const ghostMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, transparent: true, opacity: 0.38, depthWrite: false });

// ───────────────────────────── правило из положения ─────────────────────────────

const yawFor = (a: AnchorSpot, f: FigureFacing): number => (f === 'room' ? a.phi : f === 'wall' ? a.wall : f === 'door' ? a.door : a.entry);
/** Сдвиг точки (x, z) от края a в рамке края: x — вдоль стены, z — от стены в комнату. */
function offsetFrom(a: AnchorSpot, x: number, z: number): [number, number] {
  const c = Math.cos(a.phi);
  const s = Math.sin(a.phi);
  const dx = x - a.x;
  const dz = z - a.z;
  const r2 = (v: number): number => Math.round(Math.max(-3, Math.min(3, v)) * 100) / 100;
  return [r2(dx * c - dz * s), r2(dx * s + dz * c)];
}
const spotsCache = new Map<string, AnchorSpot[]>();
function spotsOf(anchor: FigureAnchor): AnchorSpot[] {
  const key = `${world}:${roomType}:${roomPick}:${anchor}`;
  let s = spotsCache.get(key);
  if (!s) {
    s = anchorSpots(room, anchor, pw);
    spotsCache.set(key, s);
  }
  return s;
}
function nearest(list: readonly AnchorSpot[], x: number, z: number): { a: AnchorSpot; d: number } | null {
  let best: AnchorSpot | null = null;
  let bd = Infinity;
  for (const a of list) {
    const d = Math.hypot(a.x - x, a.z - z);
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  return best ? { a: best, d: bd } : null;
}
/** У чего стоит точка: угол ближе 0,8 м, проём ближе 0,9 м, стена ближе 0,75 м от её края, иначе середина. */
function anchorAt(x: number, z: number, lift: number, keepCeiling: boolean): { anchor: FigureAnchor; a: AnchorSpot } {
  if (keepCeiling && lift > 1.4) {
    const m = nearest(spotsOf('ceiling'), x, z);
    if (m) return { anchor: 'ceiling', a: m.a };
  }
  const corner = nearest(spotsOf('corner'), x, z);
  if (corner && corner.d < 0.8) return { anchor: 'corner', a: corner.a };
  const door = nearest(spotsOf('door'), x, z);
  if (door && door.d < 0.9) return { anchor: 'door', a: door.a };
  const wall = nearest(spotsOf('wall'), x, z);
  if (wall) {
    const [ox, oz] = offsetFrom(wall.a, x, z);
    if (Math.abs(oz) < 0.75 && Math.abs(ox) <= CELL / 2) return { anchor: 'wall', a: wall.a };
  }
  const mid = nearest(spotsOf('middle'), x, z);
  return { anchor: 'middle', a: mid!.a };
}

/** Записать в правило, где вещь (фигура) стоит сейчас в показанном помещении. */
function derive(it: Item): void {
  const lift = Math.max(0, it.at[1] - floorY);
  const { anchor, a } = anchorAt(it.at[0], it.at[2], lift, it.spec.rule.anchor === 'ceiling');
  it.spec.rule.anchor = anchor;
  it.spec.offset = offsetFrom(a, it.at[0], it.at[2]);
  it.spec.rule.lift = Math.round(Math.min(2.6, lift) * 100) / 100;
  if (it.kind === 'thing') {
    // Куда смотрит: первое из «в комнату, в стену, на дверь, навстречу», что совпадает с поворотом; иначе — доворот.
    const match = FIGURE_FACINGS.find((f) => rotOf(yawFor(a, f)) === it.rot);
    if (match) {
      it.spec.rule.facing = match;
      it.spec.turn = 0;
    } else {
      it.spec.rule.facing = 'room';
      it.spec.turn = (((it.rot - rotOf(a.phi)) % 4) + 4) % 4 as Turn;
    }
  } else {
    const deg = ((((it.yaw - yawFor(a, it.spec.rule.facing)) * 180) / Math.PI + 540) % 360) - 180;
    it.spec.yaw = Math.round(deg);
  }
}

/** Поставить вещь (фигуру) в показанное помещение по её правилу: тот же расчёт, что в игре. */
function settle(it: Item): void {
  const spots = spotsOf(it.spec.rule.anchor);
  if (spots.length === 0) {
    // У помещения нет такого края (проёма у кладовой без дверей не бывает, но вдруг) — середина.
    const mid = spotsOf('middle')[0];
    if (!mid) return;
    it.at = [mid.x, mid.floor, mid.z];
    return;
  }
  // Край, ближе всего к середине помещения: так вещь видна целиком.
  const rects = cellRects(room);
  const mx = rects.reduce((s, r) => s + (r.x0 + r.x1) / 2, 0) / rects.length;
  const mz = rects.reduce((s, r) => s + (r.z0 + r.z1) / 2, 0) / rects.length;
  const a = nearest(spots, mx, mz)!.a;
  if (it.kind === 'thing') {
    const p = ALL_PROPS[it.spec.prop]!;
    const f = fitThing(it.spec, a, p);
    it.at = f.at;
    it.rot = f.rot;
  } else {
    const s = skeleton(it.spec.pose);
    const top = Math.max(...HANDLES.map((h) => handlePoint(s, h)[1]));
    const f = fitSpot(it.spec, a, top);
    it.at = f.at;
    it.yaw = f.yaw;
  }
}

// ───────────────────────────── вещь на сцене ─────────────────────────────

const holder = new THREE.Group();
scene.add(holder);
const boxHelper = new THREE.Box3Helper(new THREE.Box3(), 0x86b98c);
scene.add(boxHelper);
const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 0.6, 0xe3b25e, 0.14, 0.08);
scene.add(arrow);

// Фигура: оболочки материалов и ручки, как в инструменте фигур.
const matCache = new Map<FigureMaterial, { mat: THREE.Material; order: number }[]>();
function layers(m: FigureMaterial): { mat: THREE.Material; order: number }[] {
  const have = matCache.get(m);
  if (have) return have;
  const out: { mat: THREE.Material; order: number }[] = [];
  if (m === 'smoke') {
    const caps = matcap(PAINTS.smoke!);
    for (let s = 0; s < 6; s++) {
      const mat = materialFor('smoke', { shell: s * 0.012, level: s / 5, alpha: s === 0 ? 0.9 : 0.42 });
      mat.uniforms.uMatcap!.value = caps;
      mat.transparent = true;
      mat.depthWrite = false;
      mat.side = THREE.DoubleSide;
      out.push({ mat, order: s + 1 });
    }
  } else if (m === 'hair') {
    const caps = matcap(PAINTS.hair!);
    const N = 16;
    for (let s = 0; s <= N; s++) {
      const mat = materialFor('hair', { shell: (s / N) * 0.024, level: s / N });
      mat.uniforms.uMatcap!.value = caps;
      out.push({ mat, order: 0 });
    }
  } else out.push({ mat: materialFor(m), order: 0 });
  matCache.set(m, out);
  return out;
}
type Grip = Handle | 'pelvis';
const grips = new Map<Grip, THREE.Mesh>();
const gripMat = new THREE.MeshBasicMaterial({ color: 0xe3b25e, depthTest: false, transparent: true, opacity: 0.92 });
const gripHot = new THREE.MeshBasicMaterial({ color: 0xfff1cf, depthTest: false });
const gripGeo = new THREE.SphereGeometry(0.034, 16, 12);
const figGroup = new THREE.Group();
scene.add(figGroup);
for (const h of [...HANDLES, 'pelvis'] as Grip[]) {
  const m = new THREE.Mesh(gripGeo, gripMat);
  m.userData.h = h;
  m.renderOrder = 999;
  figGroup.add(m);
  grips.set(h, m);
}
let figGeo: THREE.BufferGeometry | null = null;
let figMat: FigureMaterial | null = null;
const figMeshes: THREE.Mesh[] = [];

let problems: string[] = [];
let dirty = true;
/** Вещь игры, вместо которой встаёт вещь партнёра (замена, квиз 17.11), — её рамка в помещении. */
const swapHelper = new THREE.Box3Helper(new THREE.Box3(), 0xe3b25e);
swapHelper.visible = false;
scene.add(swapHelper);
let swapBox: [Vec3, Vec3] | null = null;

/** Скрыть вещь игры (0 — показать все) и перерисовать помещение, не сбивая вид. */
function hideObj(id: number): void {
  if (hiddenObj === id) return;
  hiddenObj = id;
  showRoom(true);
}

/** Вещи игры в показанном помещении (объекты уровня), которые можно заменить вещью prop. */
function swappable(prop: string): LevelObject[] {
  const rects = cellRects(room);
  const to = ALL_PROPS[prop];
  if (!to) return [];
  return (lvl.objects ?? []).filter((o) => {
    const from = ALL_PROPS[o.name];
    if (!from || o.flat || !placeable(o.name, from, FIXED) || !swapFits(from, to)) return false;
    return Math.abs(o.at[1] - floorY) < 2.6 && rects.some((r) => o.at[0] >= r.x0 && o.at[0] <= r.x1 && o.at[2] >= r.z0 && o.at[2] <= r.z1);
  });
}

/** Вещь игры под курсором (по её габариту), которую можно заменить вещью prop. */
function swapTarget(e: PointerEvent, prop: string): LevelObject | null {
  setNdc(e);
  ray.setFromCamera(ndc, cam);
  let best: LevelObject | null = null;
  let bd = Infinity;
  const hit = new THREE.Vector3();
  for (const o of swappable(prop)) {
    const box = new THREE.Box3(new THREE.Vector3(...o.min), new THREE.Vector3(...o.max));
    if (!ray.ray.intersectBox(box, hit)) continue;
    const d = hit.distanceTo(ray.ray.origin);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

function refresh(): void {
  holder.clear();
  figGroup.visible = false;
  boxHelper.visible = false;
  arrow.visible = false;
  swapHelper.visible = false;
  if (!cur) return;
  if (cur.kind === 'thing') {
    const mesh = new THREE.Mesh(geometryOf(cur.spec.prop), thingMat);
    mesh.position.set(cur.at[0], cur.at[1], cur.at[2]);
    mesh.rotation.y = (cur.rot * Math.PI) / 2;
    mesh.userData.pick = true;
    holder.add(mesh);
    const p = ALL_PROPS[cur.spec.prop]!;
    const cell = cellOf(cur.at[0], cur.at[2]);
    const chk = checkSpot(p, cur.at, cur.rot, room, { floor: floorY, ceil: ceilY, pit: cell?.noFloor === true, tier: room.tier }, pw);
    // Замена встаёт на место вещи игры — проверки места её не касаются (там уже стояла вещь).
    problems = cur.spec.replaces ? [] : chk.problems;
    swapHelper.visible = !!cur.spec.replaces && swapBox !== null;
    if (swapHelper.visible && swapBox) swapHelper.box.set(new THREE.Vector3(...swapBox[0]), new THREE.Vector3(...swapBox[1]));
    boxHelper.box.set(new THREE.Vector3(chk.box.minX, chk.box.minY, chk.box.minZ), new THREE.Vector3(chk.box.maxX, chk.box.maxY, chk.box.maxZ));
    (boxHelper.material as THREE.LineBasicMaterial).color.set(problems.length > 0 ? 0xdc7f73 : 0x86b98c);
    boxHelper.visible = true;
    const yaw = (cur.rot * Math.PI) / 2;
    arrow.position.set(cur.at[0], floorY + 0.02, cur.at[2]);
    arrow.setDirection(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)));
    arrow.visible = true;
  } else {
    const g = figure(cur.spec.pose, 2);
    if (figMat !== cur.spec.material) {
      for (const m of figMeshes) figGroup.remove(m);
      figMeshes.length = 0;
      for (const l of layers(cur.spec.material)) {
        const mesh = new THREE.Mesh(g, l.mat);
        mesh.renderOrder = l.order;
        figGroup.add(mesh);
        figMeshes.push(mesh);
      }
      figMat = cur.spec.material;
    } else for (const m of figMeshes) m.geometry = g;
    figGeo?.dispose();
    figGeo = g;
    const s = skeleton(cur.spec.pose);
    for (const h of HANDLES) grips.get(h)!.position.fromArray(handlePoint(s, h));
    grips.get('pelvis')!.position.fromArray(s.pelvis);
    figGroup.position.set(cur.at[0], cur.at[1], cur.at[2]);
    figGroup.rotation.y = cur.yaw;
    figGroup.visible = true;
    arrow.position.set(cur.at[0], floorY + 0.02, cur.at[2]);
    arrow.setDirection(new THREE.Vector3(Math.sin(cur.yaw), 0, Math.cos(cur.yaw)));
    arrow.visible = true;
    problems = [];
  }
}
function cellOf(x: number, z: number): { noFloor?: boolean } | undefined {
  return pw.shells[room.tier]!.get(Math.round(x / CELL), Math.round(z / CELL));
}

// Призраки: уже сохранённые вещи, правило которых пускает их в это помещение.
const ghosts = new THREE.Group();
scene.add(ghosts);
function renderGhosts(): void {
  ghosts.clear();
  for (const s of savedThings.values()) {
    if (cur && cur.kind === 'thing' && cur.spec.id === s.id) continue;
    if (!s.rule.worlds.includes(world) || (s.rule.rooms.length > 0 && !s.rule.rooms.includes(roomType))) continue;
    const p = ALL_PROPS[s.prop];
    if (!p) continue;
    const it: ThingItem = { kind: 'thing', spec: JSON.parse(JSON.stringify(s)) as PlacedSpec, at: [0, 0, 0], rot: 0 };
    settle(it);
    const mesh = new THREE.Mesh(geometryOf(s.prop), ghostMat);
    mesh.position.set(it.at[0], it.at[1], it.at[2]);
    mesh.rotation.y = (it.rot * Math.PI) / 2;
    mesh.userData.ghost = s.id;
    ghosts.add(mesh);
  }
}

// ───────────────────────────── мышь и клавиши ─────────────────────────────

type Drag = { what: 'thing' } | { what: 'grip'; h: Grip; plane: THREE.Plane; start: THREE.Vector3; at0: Vec3; vertical: boolean };
let drag: Drag | null = null;
/** Поднесённая с полки вещь: что и её призрак под курсором. */
let carry: { prop: string } | { figure: true } | null = null;
const carryMesh = new THREE.Mesh(new THREE.BufferGeometry(), ghostMat);
carryMesh.visible = false;
scene.add(carryMesh);

function floorHit(e: PointerEvent): THREE.Vector3 | null {
  setNdc(e);
  ray.setFromCamera(ndc, cam);
  return ray.ray.intersectPlane(floorPlane, new THREE.Vector3());
}

/** Спиной к ближайшей стене, если она ближе 0,45 м: вещь у стены встаёт вплотную. */
function snapToWall(p: PropSpec, x: number, z: number, rot: Turn): { x: number; z: number; rot: Turn } {
  if (p.mount === 'free') return { x, z, rot };
  const wall = nearest(spotsOf('wall'), x, z);
  if (!wall) return { x, z, rot };
  const [ox, oz] = offsetFrom(wall.a, x, z);
  // Край стены: точка правила стоит в 0,3 м от неё.
  if (oz > 0.15 || oz < -0.45 || Math.abs(ox) > CELL / 2) return { x, z, rot };
  const c = Math.cos(wall.a.phi);
  const s = Math.sin(wall.a.phi);
  const back = -0.29;
  return { x: wall.a.x + ox * c + back * s, z: wall.a.z - ox * s + back * c, rot: rotOf(wall.a.phi) };
}

renderer.domElement.addEventListener(
  'pointerdown',
  (e) => {
    if (carry) return;
    setNdc(e);
    ray.setFromCamera(ndc, cam);
    if (cur?.kind === 'figure') {
      const hit = ray.intersectObjects([...grips.values()], false)[0];
      if (hit) {
        e.preventDefault();
        e.stopImmediatePropagation();
        controls.enabled = false;
        pushUndo();
        const h = hit.object.userData.h as Grip;
        const p = hit.object.getWorldPosition(new THREE.Vector3());
        const toCam = cam.getWorldDirection(new THREE.Vector3()).negate();
        const vertical = h === 'pelvis' && e.altKey;
        let plane: THREE.Plane;
        if (h === 'pelvis' && !vertical) plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -p.y);
        else if (vertical) plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(toCam.x, 0, toCam.z).normalize(), p);
        else plane = new THREE.Plane().setFromNormalAndCoplanarPoint(toCam, p);
        drag = { what: 'grip', h, plane, start: p, at0: [...cur.at] as Vec3, vertical };
        renderer.domElement.setPointerCapture(e.pointerId);
        return;
      }
    }
    if (cur?.kind === 'thing') {
      const hit = ray.intersectObjects(holder.children, false)[0];
      if (hit) {
        e.preventDefault();
        e.stopImmediatePropagation();
        controls.enabled = false;
        pushUndo();
        drag = { what: 'thing' };
        renderer.domElement.setPointerCapture(e.pointerId);
        return;
      }
    }
    // Щелчок по призраку — взять сохранённую вещь в правку.
    const g = ray.intersectObjects(ghosts.children, false)[0];
    if (g) {
      const s = savedThings.get(g.object.userData.ghost as string);
      if (s) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openThing(s);
      }
    }
  },
  { capture: true },
);

renderer.domElement.addEventListener('pointermove', (e) => {
  if (carry) {
    const q = floorHit(e);
    carryMesh.visible = !!q;
    if (q) carryMesh.position.set(q.x, floorY, q.z);
    // Над вещью игры, которую можно заменить, — её рамка: отпустишь — встанет вместо неё.
    const t = 'prop' in carry ? swapTarget(e, carry.prop) : null;
    swapHelper.visible = !!t;
    if (t) swapHelper.box.set(new THREE.Vector3(...t.min), new THREE.Vector3(...t.max));
    return;
  }
  if (!drag) {
    if (cur?.kind === 'figure') {
      setNdc(e);
      ray.setFromCamera(ndc, cam);
      const hit = ray.intersectObjects([...grips.values()], false)[0];
      for (const m of grips.values()) m.material = m === hit?.object ? gripHot : gripMat;
      renderer.domElement.style.cursor = hit ? 'grab' : '';
    }
    return;
  }
  if (!cur) return;
  if (drag.what === 'thing' && cur.kind === 'thing') {
    const q = floorHit(e);
    if (!q) return;
    if (cur.spec.replaces) {
      delete cur.spec.replaces;
      swapBox = null;
      hideObj(0);
      setStatus('Уже не замена: вещь стоит сама по себе. Чтобы заменить снова — отпусти вещь с полки на вещь игры.');
    }
    const p = ALL_PROPS[cur.spec.prop]!;
    const s = snapToWall(p, q.x, q.z, cur.rot);
    cur.at = [Math.round(s.x * 100) / 100, cur.at[1], Math.round(s.z * 100) / 100];
    cur.rot = s.rot;
    derive(cur);
    syncPanel();
  } else if (drag.what === 'grip' && cur.kind === 'figure') {
    setNdc(e);
    ray.setFromCamera(ndc, cam);
    const q = ray.ray.intersectPlane(drag.plane, new THREE.Vector3());
    if (!q) return;
    if (drag.h === 'pelvis') {
      if (drag.vertical) cur.at = [cur.at[0], Math.max(floorY, Math.min(floorY + 2.6, drag.at0[1] + (q.y - drag.start.y))), cur.at[2]];
      else cur.at = [drag.at0[0] + (q.x - drag.start.x), cur.at[1], drag.at0[2] + (q.z - drag.start.z)];
      derive(cur);
      syncPanel();
    } else {
      const local = figGroup.worldToLocal(q.clone());
      cur.spec.pose = solve(cur.spec.pose, drag.h, [local.x, local.y, local.z], 24);
    }
  }
  dirty = true;
  renderer.domElement.style.cursor = 'grabbing';
});

const endDrag = (): void => {
  if (!drag) return;
  drag = null;
  controls.enabled = true;
  renderer.domElement.style.cursor = '';
  dirty = true;
  syncPanel();
};
renderer.domElement.addEventListener('pointerup', (e) => {
  if (carry) {
    const q = floorHit(e);
    const what = carry;
    carry = null;
    carryMesh.visible = false;
    document.body.classList.remove('is-carrying');
    const t = 'prop' in what ? swapTarget(e, what.prop) : null;
    if (t && 'prop' in what) dropSwap(what.prop, t);
    else if (q) drop(what, q.x, q.z);
    return;
  }
  endDrag();
});
renderer.domElement.addEventListener('pointercancel', endDrag);
window.addEventListener('pointerup', () => {
  // Отпустил вещь мимо помещения — она возвращается на полку.
  if (carry) {
    carry = null;
    carryMesh.visible = false;
    document.body.classList.remove('is-carrying');
  }
});

/** Повернуть вещь на четверть (фигуру — на 15°). */
function turn(dir: 1 | -1): void {
  if (!cur) return;
  pushUndo();
  if (cur.kind === 'thing') {
    cur.rot = ((((cur.rot - dir) % 4) + 4) % 4) as Turn;
  } else cur.yaw -= (dir * Math.PI) / 12;
  derive(cur);
  dirty = true;
  syncPanel();
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    const prev = undo.pop();
    if (!prev) return;
    e.preventDefault();
    cur = JSON.parse(prev) as Item;
    dirty = true;
    syncPanel();
    return;
  }
  if (e.code === 'KeyQ') turn(-1);
  else if (e.code === 'KeyE') turn(1);
  else if (e.code === 'Escape' && carry) {
    carry = null;
    carryMesh.visible = false;
    document.body.classList.remove('is-carrying');
  }
});

/** Вещь с полки — вместо вещи игры (замена): там же и так же повёрнута, правило — «вместо такой-то». */
function dropSwap(prop: string, o: LevelObject): void {
  pushUndo();
  const p = ALL_PROPS[prop]!;
  const from = ALL_PROPS[o.name]!;
  // Разные опоры — сдвиг на полглубины вдоль «лица», как при сборке уровня (world/props_all.ts, swapXf).
  const f: [number, number] = [[0, 1], [1, 0], [0, -1], [-1, 0]][o.rot] as [number, number];
  const k = from.mount === 'floor' && p.mount === 'free' ? p.d / 2 : from.mount === 'free' && p.mount === 'floor' ? -from.d / 2 : 0;
  const it: ThingItem = {
    kind: 'thing',
    spec: { id: `pl_${stamp()}`, name: `${p.ru.split(',')[0]!.slice(0, 40)} вместо ${from.ru.split(',')[0]!.slice(0, 30)}`, prop, rule: { worlds: [world], rooms: [roomType], anchor: 'wall', facing: 'room', lift: 0, count: 1 }, turn: 0, offset: [0, 0], replaces: o.name },
    at: [o.at[0] + f[0] * k, o.at[1], o.at[2] + f[1] * k],
    rot: o.rot,
  };
  derive(it);
  it.spec.replaces = o.name;
  swapBox = [o.min, o.max];
  hideObj(o.id);
  cur = it;
  setStatus(`Вместо «${from.ru.split(',')[0]}» — «${p.ru.split(',')[0]}». В игре так будет в помещениях правила, сколько указано.`);
  dirty = true;
  syncPanel();
}

/** Новая вещь (фигура) там, где её отпустили. */
function drop(what: { prop: string } | { figure: true }, x: number, z: number): void {
  pushUndo();
  hideObj(0);
  swapBox = null;
  if ('prop' in what) {
    const p = ALL_PROPS[what.prop]!;
    const s = snapToWall(p, x, z, 0);
    const lift = p.mount === 'wall' ? (p.y ?? 1.2) : 0;
    const it: ThingItem = {
      kind: 'thing',
      spec: { id: `pl_${stamp()}`, name: p.ru.split(',')[0]!.slice(0, 60), prop: what.prop, rule: { worlds: [world], rooms: [roomType], anchor: 'wall', facing: 'room', lift, count: 1 }, turn: 0, offset: [0, 0] },
      at: [s.x, floorY + lift, s.z],
      rot: s.rot,
    };
    // Не у стены — лицом в комнату (от ближайшего проёма), как стоят вещи у края «посреди».
    if (s.x === x && s.z === z) it.rot = rotOf(anchorAt(x, z, lift, false).a.phi);
    derive(it);
    cur = it;
    setStatus(`Поставлено: ${p.ru}. Двигай мышью, Q и E — повернуть.`);
  } else {
    const it: FigItem = {
      kind: 'figure',
      spec: { id: `fig_${stamp()}`, name: '', pose: clonePose(POSES.stand as Pose), material: 'wood', rule: { worlds: [world], rooms: [roomType], anchor: 'middle', facing: 'room', lift: 0, count: 1 }, yaw: 0, offset: [0, 0] },
      at: [x, floorY, z],
      yaw: anchorAt(x, z, 0, false).a.phi,
    };
    derive(it);
    cur = it;
    setStatus('Манекен поставлен: тяни шарики — гнутся руки и ноги; таз — ходит по полу, с ⌥ — в воздух.');
  }
  dirty = true;
  syncPanel();
}

/** Кадр: перерисовать вещь, если что-то поменялось. Запускается в самом конце, когда всё готово. */
function loop(): void {
  requestAnimationFrame(loop);
  if (dirty) {
    dirty = false;
    refresh();
    renderProblems();
  }
  controls.update();
  renderer.render(scene, cam);
}

// ───────────────────────────── полка ─────────────────────────────

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const shelfEl = $('shelf');
const searchEl = $<HTMLInputElement>('search');
const thumbR = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
thumbR.setSize(112, 112, false);
thumbR.setClearColor(0x16191d);
const thumbScene = new THREE.Scene();
thumbScene.add(new THREE.HemisphereLight(0xdfe6ef, 0x2a2622, 1.6));
const tKey = new THREE.DirectionalLight(0xfff1dc, 2.0);
tKey.position.set(2.5, 4, 3);
thumbScene.add(tKey);
const thumbCam = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
const thumbs = new Map<string, string>();
function thumbOf(name: string): string {
  const have = thumbs.get(name);
  if (have) return have;
  const g = geometryOf(name);
  const mesh = new THREE.Mesh(g, thingMat);
  thumbScene.add(mesh);
  const box = g.boundingBox ?? new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z) * 0.5 + 0.04;
  const dist = (r / Math.sin((thumbCam.fov * Math.PI) / 360)) * 1.02;
  thumbCam.position.set(c.x + dist * 0.62, c.y + dist * 0.42, c.z + dist * 0.66);
  thumbCam.lookAt(c);
  thumbR.render(thumbScene, thumbCam);
  thumbScene.remove(mesh);
  const url = thumbR.domElement.toDataURL('image/jpeg', 0.8);
  thumbs.set(name, url);
  return url;
}
const PLACEABLE = Object.entries(ALL_PROPS)
  .filter(([n, p]) => placeable(n, p, FIXED))
  .map(([n, p]) => ({ name: n, ru: p.ru, mount: p.mount }))
  .sort((a, b) => a.ru.localeCompare(b.ru, 'ru'));
const lazy = new IntersectionObserver((list) => {
  for (const en of list) {
    if (!en.isIntersecting) continue;
    const img = en.target as HTMLImageElement;
    lazy.unobserve(img);
    img.src = thumbOf(img.dataset.name!);
  }
});
function renderShelf(): void {
  const q = searchEl.value.trim().toLowerCase();
  // Сначала то, что уже стоит в этом месте (по обстановке показанного уровня), потом остальное.
  const here = new Map<string, number>();
  for (const o of lvl.objects ?? []) here.set(o.name, (here.get(o.name) ?? 0) + 1);
  const list = PLACEABLE.filter((x) => !q || x.ru.toLowerCase().includes(q) || x.name.includes(q)).sort((a, b) => (here.has(b.name) ? 1 : 0) - (here.has(a.name) ? 1 : 0));
  const fig = document.createElement('button');
  fig.type = 'button';
  fig.className = 'shelf__item shelf__item--fig';
  fig.innerHTML = '<span class="shelf__thumb shelf__thumb--fig">◎</span><span class="shelf__text"><b>Манекен</b><small>гнуть руками, свой материал</small></span>';
  fig.addEventListener('pointerdown', (e) => startCarry(e, { figure: true }));
  const items = list.map((x) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'shelf__item';
    const img = document.createElement('img');
    img.className = 'shelf__thumb';
    img.alt = '';
    img.width = 56;
    img.height = 56;
    img.dataset.name = x.name;
    lazy.observe(img);
    const text = document.createElement('span');
    text.className = 'shelf__text';
    const title = document.createElement('b');
    title.textContent = x.ru;
    const small = document.createElement('small');
    small.textContent = `${here.has(x.name) ? 'уже есть в этом месте · ' : ''}${x.mount === 'wall' ? 'на стену' : x.mount === 'free' ? 'посреди пола' : 'у стены'}`;
    text.append(title, small);
    b.append(img, text);
    b.addEventListener('pointerdown', (e) => startCarry(e, { prop: x.name }));
    return b;
  });
  shelfEl.replaceChildren(fig, ...items);
  $('shelfcount').textContent = `${list.length} из ${PLACEABLE.length}`;
}
function startCarry(e: PointerEvent, what: { prop: string } | { figure: true }): void {
  e.preventDefault();
  carry = what;
  document.body.classList.add('is-carrying');
  if ('prop' in what) {
    carryMesh.geometry = geometryOf(what.prop);
    carryMesh.scale.set(1, 1, 1);
  } else {
    carryMesh.geometry = new THREE.CapsuleGeometry(0.2, 1.3, 4, 12).translate(0, 0.85, 0);
  }
  setStatus('Отпусти над полом помещения. Esc — передумал.');
}
searchEl.addEventListener('input', renderShelf);

// ───────────────────────────── панель ─────────────────────────────

const nameEl = $<HTMLInputElement>('name');
const statusEl = $('status');
const problemsEl = $('problems');
const savedEl = $('saved');
function setStatus(t: string): void {
  statusEl.textContent = t;
}
function chips<T extends string>(el: HTMLElement, items: readonly T[], label: (x: T) => string, on: (x: T) => boolean, click: (x: T) => void): void {
  el.replaceChildren(
    ...items.map((x) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `chip${on(x) ? ' is-on' : ''}`;
      b.textContent = label(x);
      b.setAttribute('aria-pressed', String(on(x)));
      b.addEventListener('click', () => click(x));
      return b;
    }),
  );
}
const change = (fn: () => void): void => {
  pushUndo();
  fn();
  dirty = true;
  syncPanel();
};
const liftEl = $<HTMLInputElement>('lift');
const countEl = $<HTMLInputElement>('count');
liftEl.addEventListener('pointerdown', pushUndo);
liftEl.addEventListener('input', () => {
  if (!cur) return;
  cur.at = [cur.at[0], floorY + Number(liftEl.value), cur.at[2]];
  derive(cur);
  dirty = true;
  syncPanel();
});
countEl.addEventListener('input', () => change(() => cur && (cur.spec.rule.count = Number(countEl.value))));
nameEl.addEventListener('input', () => {
  if (cur) cur.spec.name = nameEl.value;
  renderProblems();
});
$('unreplace').addEventListener('click', () =>
  change(() => {
    if (cur?.kind === 'thing') delete cur.spec.replaces;
    swapBox = null;
    hideObj(0);
    if (cur) derive(cur);
  }),
);
$('turnl').addEventListener('click', () => turn(-1));
$('turnr').addEventListener('click', () => turn(1));

function syncPanel(): void {
  chips($('worldpick'), FIGURE_WORLDS, (w) => WORLD_RU[w], (w) => w === world, (w) => enterRoom(w, roomTypes(w).includes(roomType) ? roomType : roomTypes(w)[0]!, 0));
  chips($('roompick'), roomTypes(world), (r) => ROOM_RU[r] ?? r, (r) => r === roomType, (r) => enterRoom(world, r, 0));
  const total = roomsOfType(world, roomType).length;
  $('roomnum').textContent = `${roomPick + 1} из ${total}`;
  const has = !!cur;
  $('rule').toggleAttribute('hidden', !has);
  $('figbox').toggleAttribute('hidden', cur?.kind !== 'figure');
  $('turns').toggleAttribute('hidden', !has);
  if (!cur) {
    $('what').textContent = 'Перетащи вещь с полки в помещение.';
    renderSaved();
    renderProblems();
    return;
  }
  const c = cur;
  $('what').textContent = c.kind === 'thing' ? (ALL_PROPS[c.spec.prop]?.ru ?? c.spec.prop) : `манекен · ${MAT_RU[c.spec.material]}`;
  if (c.kind === 'figure') {
    chips($('poses'), Object.keys(POSES) as PoseName[], (p) => POSE_RU[p], () => false, (p) => change(() => (c.spec.pose = clonePose(POSES[p] as Pose))));
    chips($('mats'), FIGURE_MATERIALS, (m) => MAT_RU[m], (m) => c.spec.material === m, (m) =>
      change(() => {
        c.spec.material = m;
        // Дымная по слову партнёра висит в воздухе: поднять, если стоит на полу.
        if (m === 'smoke' && c.at[1] - floorY < 0.05) {
          c.at = [c.at[0], floorY + 0.5, c.at[2]];
          derive(c);
        }
      }),
    );
    $('matnote').textContent = MAT_NOTE[c.spec.material] ?? 'В игре растворяется от касания и возвращается, когда свет погаснет и зажжётся.';
  }
  chips($('worlds'), FIGURE_WORLDS, (w) => WORLD_RU[w], (w) => c.spec.rule.worlds.includes(w), (w) =>
    change(() => {
      const on = c.spec.rule.worlds.includes(w);
      if (on && c.spec.rule.worlds.length === 1) return;
      c.spec.rule.worlds = on ? c.spec.rule.worlds.filter((x) => x !== w) : [...c.spec.rule.worlds, w];
      const allowed = new Set(c.spec.rule.worlds.flatMap(roomTypes));
      c.spec.rule.rooms = c.spec.rule.rooms.filter((r) => allowed.has(r));
    }),
  );
  const types = [...new Set(c.spec.rule.worlds.flatMap(roomTypes))];
  chips($('rooms'), ['*', ...types], (r) => (r === '*' ? 'любые помещения' : (ROOM_RU[r] ?? r)), (r) => (r === '*' ? c.spec.rule.rooms.length === 0 : c.spec.rule.rooms.includes(r)), (r) =>
    change(() => {
      if (r === '*') c.spec.rule.rooms = [];
      else c.spec.rule.rooms = c.spec.rule.rooms.includes(r) ? c.spec.rule.rooms.filter((x) => x !== r) : [...c.spec.rule.rooms, r];
    }),
  );
  // Край выбирается и руками: вещь переезжает к ближайшему краю этого вида.
  chips($('anchors'), FIGURE_ANCHORS, (a) => ANCHOR_RU[a], (a) => c.spec.rule.anchor === a, (a) =>
    change(() => {
      c.spec.rule.anchor = a;
      c.spec.offset = [0, c.kind === 'thing' && a === 'wall' ? -0.29 : 0];
      settle(c);
    }),
  );
  chips($('facings'), FIGURE_FACINGS, (f) => FACING_RU[f], (f) => c.spec.rule.facing === f, (f) =>
    change(() => {
      c.spec.rule.facing = f;
      if (c.kind === 'thing') c.spec.turn = 0;
      else c.spec.yaw = 0;
      settle(c);
    }),
  );
  const rp = c.kind === 'thing' ? c.spec.replaces : undefined;
  $('replace').toggleAttribute('hidden', !rp);
  if (rp) $('replacetext').textContent = `вместо вещи игры: ${ALL_PROPS[rp]?.ru.split(',')[0] ?? rp}`;
  $('anchors').toggleAttribute('hidden', !!rp);
  $('facings').toggleAttribute('hidden', !!rp);
  liftEl.value = String(c.spec.rule.lift);
  $('liftv').textContent = `${c.spec.rule.lift.toFixed(2)} м`;
  countEl.value = String(c.spec.rule.count);
  $('countv').textContent = String(c.spec.rule.count);
  if (document.activeElement !== nameEl) nameEl.value = c.spec.name;
  const where = c.spec.rule.worlds.map((w) => WORLD_RU[w]).join(', ');
  const rooms = c.spec.rule.rooms.length === 0 ? 'любые помещения' : c.spec.rule.rooms.map((r) => ROOM_RU[r] ?? r).join(', ');
  const TURN_RU = ['', ', и ещё на четверть вправо', ', и ещё задом наперёд', ', и ещё на четверть влево'];
  const turnTxt = c.kind === 'thing' ? TURN_RU[c.spec.turn]! : c.spec.yaw ? `, доворот ${c.spec.yaw}°` : '';
  $('summary').textContent = rp
    ? `${where} · ${rooms} · вместо «${ALL_PROPS[rp]?.ru.split(',')[0] ?? rp}» — там же и так же повёрнута · до ${c.spec.rule.count} шт. на место`
    : `${where} · ${rooms} · ${ANCHOR_RU[c.spec.rule.anchor]}, ${FACING_RU[c.spec.rule.facing]}${turnTxt} · ${c.spec.rule.lift > 0 ? `${c.spec.rule.lift.toFixed(2)} м над полом · ` : ''}${c.spec.rule.count} шт. на место`;
  renderSaved();
  renderProblems();
  coverageSoon();
}

/**
 * Встанет ли правило в игре: тот же расчёт, что при сборке уровня, по пяти планам каждого места правила
 * (замечание куратора, пачка 38: «партнёр не видит, на скольких сидах правило не встанет»). Считается после
 * того, как правка утихла, — планы строятся один раз и дальше берутся из запаса.
 */
let covTimer = 0;
function coverageSoon(): void {
  window.clearTimeout(covTimer);
  $('coverage').textContent = 'считаю, где встанет…';
  covTimer = window.setTimeout(coverage, 350);
}
/** Сколько замен встанет на плане: вещи игры этого имени в помещениях правила, не больше count. */
function swapsIn(l: BuiltLevel, spec: PlacedSpec): number {
  const layout = l.layout!;
  const byCell = new Map<string, GenRoom>();
  for (const r of layout.rooms) for (const [x, z] of r.cells) byCell.set(`${r.tier},${x},${z}`, r);
  let n = 0;
  for (const o of l.objects ?? []) {
    if (o.name !== spec.replaces) continue;
    const tier = -Math.floor((o.at[1] + 0.2) / 4.5);
    const r = byCell.get(`${tier},${Math.round(o.at[0] / CELL) + HALF},${Math.round(o.at[2] / CELL) + HALF}`);
    if (r && (spec.rule.rooms.length === 0 || spec.rule.rooms.includes(r.type))) n += 1;
  }
  return Math.min(n, spec.rule.count);
}

function coverage(): void {
  if (!cur) return;
  const c = cur;
  let levels = 0;
  let hit = 0;
  let pieces = 0;
  for (const w of c.spec.rule.worlds) {
    for (const seed of SEEDS) {
      const l = levelOf(seed, w);
      if (!l.placeWorld) continue;
      levels += 1;
      const n = c.kind === 'thing' && c.spec.replaces ? swapsIn(l, c.spec) : c.kind === 'thing' ? placeThings([c.spec], l.placeWorld, ALL_PROPS).length : placeFigures([c.spec], l.placeWorld).length;
      if (n > 0) hit += 1;
      pieces += n;
    }
  }
  const el = $('coverage');
  el.classList.toggle('is-bad', hit === 0);
  el.textContent =
    levels === 0
      ? ''
      : hit === 0
        ? `в игре не встанет ни на одном из ${levels} планов: правило нигде не выполнимо — сдвинь вещь или выбери другой край, помещения`
        : `в игре встанет на ${hit} из ${levels} планов${pieces > hit ? `, всего ${pieces} шт.` : ''}`;
}

/** Что мешает: данные (как у игры) и это место (точка в показанном помещении). */
function renderProblems(): void {
  const lines: string[] = [];
  if (cur) {
    const named = { ...cur.spec, name: cur.spec.name.trim() || 'без имени' };
    const data = cur.kind === 'thing' ? placedProblems(named, ALL_PROPS, FIXED) : figureProblems(named);
    lines.push(...data);
    for (const p of problems) lines.push(`здесь: ${p}`);
  }
  problemsEl.replaceChildren(...lines.map((b) => Object.assign(document.createElement('li'), { textContent: b })));
  $('spotnote').toggleAttribute('hidden', !(cur?.kind === 'thing' && problems.length > 0));
}

// ───────────────────────────── база страницы ─────────────────────────────

type Snap = { docs: { id: string; data(): Record<string, unknown> | undefined }[]; metadata: { fromCache: boolean } };
type Coll = { doc(id: string): { set(d: Record<string, unknown>): Promise<void>; delete(): Promise<void> }; onSnapshot(n: (s: Snap) => void, e?: (err: { code: string }) => void): () => void };
type DbNs = { collection(p: string): Coll };
let db: DbNs | null = null;
let canWrite = true;
const savedThings = new Map<string, PlacedSpec>();
const savedFigs = new Map<string, FigureSpec>();

function renderSaved(): void {
  const rows: HTMLButtonElement[] = [];
  const add = (label: string, on: boolean, click: () => void): void => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip${on ? ' is-on' : ''}`;
    b.textContent = label;
    b.addEventListener('click', click);
    rows.push(b);
  };
  for (const s of [...savedThings.values()].sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')))) add(`${s.name} · ${ALL_PROPS[s.prop]?.ru.split(',')[0] ?? s.prop}`, cur?.spec.id === s.id, () => openThing(s));
  for (const f of [...savedFigs.values()].sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')))) add(`${f.name} · манекен, ${MAT_RU[f.material]}`, cur?.spec.id === f.id, () => openFigure(f));
  savedEl.replaceChildren(...rows);
}
/** Открыть сохранённое: в помещении, куда его пускает правило. */
function goTo(rule: PlacedSpec['rule']): void {
  if (rule.worlds.includes(world) && (rule.rooms.length === 0 || rule.rooms.includes(roomType))) return;
  const w = rule.worlds[0]!;
  const t = rule.rooms[0] ?? roomTypes(w)[0]!;
  enterRoom(w, t, 0);
}
function openThing(s: PlacedSpec): void {
  pushUndo();
  goTo(s.rule);
  const it: ThingItem = { kind: 'thing', spec: JSON.parse(JSON.stringify(s)) as PlacedSpec, at: [0, 0, 0], rot: 0 };
  settle(it);
  swapBox = null;
  // Замена — на место первой такой вещи игры в показанном помещении, если она здесь есть.
  const o = s.replaces ? swappable(s.prop).find((x) => x.name === s.replaces) : undefined;
  if (o) {
    it.at = [o.at[0], o.at[1], o.at[2]];
    it.rot = o.rot;
    swapBox = [o.min, o.max];
  }
  hideObj(o ? o.id : 0);
  cur = it;
  renderGhosts();
  dirty = true;
  syncPanel();
}
function openFigure(f: FigureSpec): void {
  pushUndo();
  goTo(f.rule);
  const it: FigItem = { kind: 'figure', spec: JSON.parse(JSON.stringify(f)) as FigureSpec, at: [0, 0, 0], yaw: 0 };
  settle(it);
  cur = it;
  dirty = true;
  syncPanel();
}

async function connect(): Promise<void> {
  const claude = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
  if (!claude?.use) {
    setStatus('Расстановки не сохраняются: страница открыта не в Claude. Ставить и смотреть можно и так.');
    return;
  }
  db = (await claude.use('db')) as DbNs | null;
  const user = (await claude.use('user')) as { can?(n: string): Promise<boolean | null> } | null;
  if (!db) {
    setStatus('Сохранять сейчас нельзя: войди в Claude. Ставить и смотреть можно и так.');
    return;
  }
  const can = user?.can ? await user.can('data.write') : null;
  canWrite = can !== false;
  if (!canWrite) setStatus('Можно смотреть; сохранять может только тот, у кого есть право правки.');
  const timer = window.setTimeout(() => setStatus('Сохранённое пока не загрузилось — проверь связь.'), 10000);
  const done = (): void => {
    window.clearTimeout(timer);
    if (canWrite && statusEl.textContent?.startsWith('Сохранённое')) setStatus('');
  };
  db.collection('things').onSnapshot(
    (snap) => {
      if (!snap.metadata.fromCache) done();
      savedThings.clear();
      for (const d of snap.docs) {
        const s = d.data() as unknown as PlacedSpec | undefined;
        if (s && placedProblems(s, ALL_PROPS, FIXED).length === 0) savedThings.set(d.id, s);
      }
      renderSaved();
      renderGhosts();
    },
    () => setStatus('Сохранённые вещи не загрузились. Обнови страницу позже.'),
  );
  db.collection('figures').onSnapshot(
    (snap) => {
      if (!snap.metadata.fromCache) done();
      savedFigs.clear();
      for (const d of snap.docs) {
        const f = d.data() as unknown as FigureSpec | undefined;
        if (f && figureProblems(f).length === 0) savedFigs.set(d.id, f);
      }
      renderSaved();
    },
    () => setStatus('Сохранённые фигуры не загрузились. Обнови страницу позже.'),
  );
}

$('save').addEventListener('click', async () => {
  if (!cur) return;
  if (!cur.spec.name.trim()) cur.spec.name = cur.kind === 'thing' ? (ALL_PROPS[cur.spec.prop]?.ru.split(',')[0] ?? 'вещь') : `Фигура ${savedFigs.size + 1}`;
  nameEl.value = cur.spec.name;
  const named = { ...cur.spec, name: cur.spec.name.trim() };
  const bad = cur.kind === 'thing' ? placedProblems(named, ALL_PROPS, FIXED) : figureProblems(named);
  if (bad.length > 0) {
    setStatus('Не сохранено: поправь то, что красным.');
    return;
  }
  if (!db || !canWrite) {
    setStatus('Сохранить не выйдет: база страницы недоступна.');
    return;
  }
  setStatus('Сохраняю…');
  try {
    if (cur.kind === 'thing') {
      const spec: PlacedSpec = { ...(cur.spec as PlacedSpec), name: named.name, at: new Date().toISOString() };
      await db.collection('things').doc(spec.id).set(spec as unknown as Record<string, unknown>);
      savedThings.set(spec.id, spec);
    } else {
      const spec: FigureSpec = { ...(cur.spec as FigureSpec), name: named.name, at: new Date().toISOString() };
      await db.collection('figures').doc(spec.id).set(spec as unknown as Record<string, unknown>);
      savedFigs.set(spec.id, spec);
    }
    renderSaved();
    setStatus(`Сохранено: «${named.name}». ${problems.length > 0 ? 'Здесь вещь не встанет, но в других помещениях — где правило выполнимо.' : ''}`);
  } catch {
    setStatus('Не сохранилось. Попробуй ещё раз через минуту.');
  }
});

$('fresh').addEventListener('click', () => {
  pushUndo();
  cur = null;
  renderGhosts();
  dirty = true;
  syncPanel();
  setStatus('Перетащи вещь или манекен с полки в помещение.');
});

// Удаление — вторым нажатием: окна подтверждения на странице нет.
let dropArmed = 0;
$('drop').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('drop');
  if (!cur) return;
  const savedHere = cur.kind === 'thing' ? savedThings.has(cur.spec.id) : savedFigs.has(cur.spec.id);
  if (!savedHere) {
    cur = null;
    dirty = true;
    syncPanel();
    setStatus('Убрано (сохранено не было).');
    return;
  }
  if (Date.now() - dropArmed > 4000) {
    dropArmed = Date.now();
    btn.textContent = 'Точно? Нажми ещё раз';
    window.setTimeout(() => (btn.textContent = 'Удалить'), 4000);
    return;
  }
  dropArmed = 0;
  btn.textContent = 'Удалить';
  if (!db || !canWrite) return;
  try {
    const name = cur.spec.name;
    if (cur.kind === 'thing') {
      await db.collection('things').doc(cur.spec.id).delete();
      savedThings.delete(cur.spec.id);
    } else {
      await db.collection('figures').doc(cur.spec.id).delete();
      savedFigs.delete(cur.spec.id);
    }
    setStatus(`Удалено: «${name}».`);
    cur = null;
    renderGhosts();
    dirty = true;
    syncPanel();
  } catch {
    setStatus('Не удалилось. Попробуй ещё раз через минуту.');
  }
});
$('nextroom').addEventListener('click', () => enterRoom(world, roomType, roomPick + 1));

enterRoom('shelter', 'kitchen', 0);
renderShelf();
loop();
void connect();

/** Для проверок: что редактируется, где на экране точка мира, и «поставить» без мыши. */
(window as unknown as Record<string, unknown>).__constructor = {
  cur: () => cur,
  room: () => {
    const r = cellRects(room);
    return { world, type: roomType, pick: roomPick, floor: floorY, problems, center: [r.reduce((a, q) => a + (q.x0 + q.x1) / 2, 0) / r.length, r.reduce((a, q) => a + (q.z0 + q.z1) / 2, 0) / r.length] };
  },
  screen: (p: Vec3): [number, number] => {
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(cam);
    const r = renderer.domElement.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  },
  drop: (prop: string, x: number, z: number) => drop({ prop }, x, z),
  dropFigure: (x: number, z: number) => drop({ figure: true }, x, z),
  swappable: (prop: string) => swappable(prop).map((o) => ({ name: o.name, at: o.at })),
  dropOnto: (prop: string, name: string) => {
    const o = swappable(prop).find((x) => x.name === name);
    if (o) dropSwap(prop, o);
    return !!o;
  },
  doors: () => roomDoors(room, pw),
  enter: (w: WorldKind, t: string, k = 0) => enterRoom(w, t, k),
  turn,
};
void HEADROOM;
