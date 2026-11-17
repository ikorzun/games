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
 * Вещи, которые поставила сама игра, партнёр тоже двигает и убирает (17.11, 19:15: «текущую расстановку мебели я
 * тоже должен уметь двигать и удалять»): щелчок — выбрать (и карточка), тянуть — передвинуть (запись PlacedSpec с
 * moves), «Убрать отсюда» — убрать (RemovedSpec). Вещь игры названа именем и номером среди таких же в помещении —
 * тем же номером, каким её считает сборка уровня (world/placed_place.ts, gameNth).
 *
 * Сюда же переехал «Опросник мебели» (квиз: «Опросник внутрь»): щелчок по вещи на полке — её карточка (объёмно рядом
 * с ростом человека, размеры, где стоит, совет основной модели) и отметка «оставить / реальнее / заменить / убрать».
 *
 * Сохранённое лежит в базе страницы: вещи и передвинутые вещи игры — коллекция things, фигуры — figures, убранные вещи
 * игры — removed, отметки — verdicts (документ = имя вещи). Основная модель забирает их оттуда в игру
 * (world/placed_data.ts, world/figures_data.ts). Без базы (страница открыта не в Claude) всё живёт в памяти страницы.
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
import { placeable, placedProblems, removedProblems, swapFits } from '../../src/world/placed';
import type { Aabb } from '../../src/world/colliders';
import type { LevelObject } from '../../src/world/objects';
import type { PlacedSpec, RemovedSpec } from '../../src/world/placed';
import { checkSpot, fitThing, gameNth, moveSpot, NEVER, placeThings, roomDoors, roomIndex, roomNear, rotOf, throatBox, worldBox } from '../../src/world/placed_place';
import type { Box, PlacedSpot } from '../../src/world/placed_place';
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
import { asked, CHOICES, gameLink, ITEM, ITEMS, LABEL, MEMORY, ROOM_RU, roomsText, SHORT, sizeText, whereText, WORLD_RU } from './catalog';
import type { Item as Entry, Kind, Mark, Verdict } from './catalog';
import { cardView } from './card';

setThingRegistry(ALL_PROPS);
const HALF = GRID / 2;

// ───────────────────────────── подписи ─────────────────────────────

const POSE_RU: Record<PoseName, string> = { stand: 'стоит', wait: 'ждёт', look: 'смотрит вверх', call: 'с телефоном', sit: 'сидит', sofa: 'на диване', desk: 'за столом', hug: 'обхватил колени', lean: 'у стены' };
const MAT_RU: Record<FigureMaterial, string> = { wood: 'дерево', smoke: 'дым', hair: 'волосы', stone: 'камень', metal: 'металл', coal: 'уголь', skin: 'кожа', plastic: 'пластик' };
const MAT_NOTE: Partial<Record<FigureMaterial, string>> = {
  smoke: 'Дымная висит в воздухе, бледная, из редких точек. Подойдёшь ближе 2,3 м — рассеется; отойдёшь дальше 6 м — через 7 с соберётся снова.',
  hair: 'Волосатая — в ворсе. Подойдёшь ближе 1,3 м — растворится от рук к телу. Вернётся, когда свет погаснет и зажжётся, — от головы к рукам.',
};
const ANCHOR_RU: Record<FigureAnchor, string> = { corner: 'в углу', wall: 'у стены', middle: 'посреди', door: 'в проёме', ceiling: 'под потолком' };
const FACING_RU: Record<FigureFacing, string> = { wall: 'лицом в стену', room: 'лицом в комнату', door: 'на дверь', player: 'навстречу идущему' };
/** Не ставятся руками: помещения, где ничего не стоит (как в игре). */
const NO_ROOMS = NEVER;
/** Короткое имя вещи: до первой запятой. */
const ruShort = (name: string): string => (ALL_PROPS[name]?.ru ?? name).split(',')[0]!;

// ───────────────────────────── что редактируем ─────────────────────────────

/** Вещь в показанном помещении: правило (spec) и где она стоит здесь. */
interface ThingItem {
  kind: 'thing';
  spec: PlacedSpec;
  at: Vec3;
  rot: Turn;
  /** Замена: номер объекта уровня (вещи игры), вместо которой она стоит в показанном помещении. */
  obj?: number;
}
/** Фигура в показанном помещении: правило (spec), точка подошв и поворот, рад. */
interface FigItem {
  kind: 'figure';
  spec: FigureSpec;
  at: Vec3;
  yaw: number;
}
type Item = ThingItem | FigItem;

let seq = 0;
const stamp = (): string => `${Date.now().toString(36)}${(seq++ % 36).toString(36)}`;
let cur: Item | null = null;
/** Шаг отмены: правка (что было в работе) или запись базы (добавлена или удалена). */
type UndoStep = { t: 'cur'; json: string } | { t: 'rec'; coll: 'things' | 'removed'; add: boolean; spec: PlacedSpec | RemovedSpec };
const undo: UndoStep[] = [];
const pushStep = (s: UndoStep): void => {
  undo.push(s);
  if (undo.length > 120) undo.shift();
};
const pushUndo = (): void => pushStep({ t: 'cur', json: JSON.stringify(cur) });

// ───────────────────────────── место и помещение ─────────────────────────────

const SEEDS = [20041113, 7, 42, 1234, 5];
let world: WorldKind = 'shelter';
let roomType = 'kitchen';
/** Какое по счёту помещение этого типа показываем (по всем сидам). */
let roomPick = 0;
const levelCache = new Map<string, BuiltLevel>();
/** Уровень так, как его собирает игра, но без записей партнёра: номера вещей игры считаются по нему (как у сборки). */
function levelOf(seed: number, w: WorldKind): BuiltLevel {
  const key = `${w}:${seed}`;
  let lvl = levelCache.get(key);
  if (!lvl) {
    lvl = buildLevel(generateLayout(seed, 2, w), { wear: 0, figures: [], placed: [], removed: [], keepPlaceWorld: true });
    levelCache.set(key, lvl);
  }
  return lvl;
}
type RoomAt = (x: number, y: number, z: number) => GenRoom | undefined;
const roomAtCache = new WeakMap<BuiltLevel, RoomAt>();
/** Помещение точки на уровне — тот же расчёт, что у сборки (world/placed_place.ts, roomIndex). */
function roomAtOf(l: BuiltLevel): RoomAt {
  let f = roomAtCache.get(l);
  if (!f) {
    f = roomIndex(l.layout!);
    roomAtCache.set(l, f);
  }
  return f;
}
const roomOfObj = (l: BuiltLevel, o: LevelObject): GenRoom | undefined => roomAtOf(l)(o.at[0], o.at[1], o.at[2]);
/** Номер вещи игры среди таких же в её помещении — как у сборки уровня (world/placed_place.ts, gameNth). */
const nthOf = (l: BuiltLevel, o: LevelObject): number => gameNth(l.objects ?? [], o, roomAtOf(l));
/** nth-я вещь thing в помещении r уровня l (или ничего). */
function findGame(l: BuiltLevel, r: GenRoom, thing: string, nth: number): LevelObject | undefined {
  return (l.objects ?? []).find((o) => o.name === thing && roomOfObj(l, o) === r && nthOf(l, o) === nth);
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
const setNdc = (e: { clientX: number; clientY: number }): void => {
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
/** Сетки помещения с номерами объектов у вершин: по ним мышь находит вещь игры. */
const roomMeshes: THREE.Mesh[] = [];
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

/**
 * Объекты уровня (вещи игры), которых в показанном помещении не видно: на их месте вещь партнёра (замена), их тянут или
 * передвинули (передвинутая), их убрали. Их преграды на это время «растворены»: проверки места их не видят — как в игре,
 * где этих вещей на старом месте нет.
 */
let hidden = new Set<number>();
const goneBoxes: Aabb[] = [];
function applyHidden(h: Set<number>): void {
  for (const b of goneBoxes) delete b.gone;
  goneBoxes.length = 0;
  hidden = h;
  if (h.size === 0) return;
  for (const b of lvl.colliders.boxes) {
    if (b.owner === undefined || !h.has(b.owner) || b.gone) continue;
    b.gone = true;
    goneBoxes.push(b);
  }
}
/** На время расчёта по другому плану: растворить преграды объектов ids уровня l, потом вернуть как было. */
function withGone<T>(l: BuiltLevel, ids: readonly number[], fn: () => T): T {
  const touched: Aabb[] = [];
  const set = new Set(ids);
  for (const b of l.colliders.boxes) {
    if (b.owner === undefined || !set.has(b.owner) || b.gone) continue;
    b.gone = true;
    touched.push(b);
  }
  try {
    return fn();
  } finally {
    for (const b of touched) delete b.gone;
  }
}

/** Показать помещение: только его треугольники (с кромкой стен), без потолка — чтобы смотреть сверху. */
function showRoom(keepView = false): void {
  for (const c of [...roomGroup.children]) {
    roomGroup.remove(c);
    (c as THREE.Mesh).geometry?.dispose();
  }
  roomMeshes.length = 0;
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
      // Вещь игры, которую заменили, передвинули или убрали, не рисуется.
      if (hidden.size > 0 && m.obj && hidden.has(m.obj[a]!)) continue;
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
    const mesh = new THREE.Mesh(g, roomMat);
    mesh.userData.obj = m.obj;
    roomGroup.add(mesh);
    roomMeshes.push(mesh);
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
}
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** Выбрать место, тип помещения и номер; собрать уровень. */
function enterRoom(w: WorldKind, type: string, pick = 0): void {
  const all = roomsOfType(w, type);
  if (all.length === 0) return;
  applyHidden(new Set());
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
  gameSel = 0;
  hover = 0;
  if (cur) placeInRoom(cur);
  computeEdits();
  layoutEdits();
  showRoom();
  renderGhosts();
  dirty = true;
  syncPanel();
  renderShelf();
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
  if (g.boundingBox!.isEmpty()) g.boundingBox!.set(new THREE.Vector3(-0.2, 0, -0.2), new THREE.Vector3(0.2, 0.4, 0.2));
  g.computeBoundingSphere();
  geoCache.set(name, g);
  return g;
}
const thingMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.05, side: THREE.DoubleSide });
const ghostMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, transparent: true, opacity: 0.38, depthWrite: false });
/** Передвинутая вещь игры (сохранённая запись): плотнее призрака — это вещь игры, просто в другом месте. */
const movedMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, transparent: true, opacity: 0.72, depthWrite: false });

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
    // У какого края помещения её отпустили — в долях его рамки: игра возьмёт ближайший такой край (PlacedSpec.near), а не
    // любой по жребию; в помещении другой формы — тот, что у того же его края.
    if (!it.spec.replaces) it.spec.near = roomNear(room, a.x, a.z);
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

/**
 * Поставить правку в показанное помещение: замену — на место первой такой вещи игры здесь (если есть); передвинутую —
 * туда, куда её поставит игра (moveSpot), иначе по правилу; остальное — по правилу (settle).
 */
function placeInRoom(it: Item): void {
  if (it.kind === 'thing') delete it.obj;
  if (it.kind === 'thing' && it.spec.replaces) {
    const o = swappable(it.spec.prop).find((x) => x.name === it.spec.replaces);
    if (o) {
      it.at = [o.at[0], o.at[1], o.at[2]];
      it.rot = o.rot;
      it.obj = o.id;
      return;
    }
  }
  if (it.kind === 'thing' && it.spec.moves) {
    const o = findGame(lvl, room, it.spec.moves.thing, it.spec.moves.nth);
    const f = o ? withGone(lvl, [o.id], () => moveSpot(it.spec, room, pw, ALL_PROPS)) : null;
    if (f) {
      it.at = f.spot.at;
      it.rot = f.spot.rot;
      return;
    }
  }
  settle(it);
}

// ───────────────────────────── правки партнёра в показанном помещении ─────────────────────────────

/** Убранная вещь игры здесь: запись и объект уровня. */
interface RemovedHere {
  spec: RemovedSpec;
  o: LevelObject;
}
/** Передвинутая вещь игры здесь: запись, объект уровня (где её ставит игра) и где она встанет по правилу (нет — останется). */
interface MovedHere {
  spec: PlacedSpec;
  o: LevelObject;
  spot: PlacedSpot | null;
}
let edits: { removed: RemovedHere[]; moved: MovedHere[] } = { removed: [], moved: [] };
const applies = (worlds: readonly WorldKind[], rooms: readonly string[]): boolean => worlds.includes(world) && (rooms.length === 0 || rooms.includes(roomType));

/** Какие сохранённые записи о вещах игры касаются показанного помещения (как их применит сборка: сперва убранные). */
function computeEdits(): void {
  const removed: RemovedHere[] = [];
  for (const spec of savedRemoved.values()) {
    if (!applies(spec.worlds, spec.rooms)) continue;
    const o = findGame(lvl, room, spec.what.thing, spec.what.nth);
    if (o && !removed.some((r) => r.o.id === o.id)) removed.push({ spec, o });
  }
  const moved: MovedHere[] = [];
  for (const spec of savedThings.values()) {
    if (!spec.moves || !applies(spec.rule.worlds, spec.rule.rooms)) continue;
    const o = findGame(lvl, room, spec.moves.thing, spec.moves.nth);
    if (!o || removed.some((r) => r.o.id === o.id) || moved.some((m) => m.o.id === o.id)) continue;
    moved.push({ spec, o, spot: null });
  }
  moved.sort((a, b) => a.o.id - b.o.id);
  edits = { removed, moved };
}

/** Какие вещи игры сейчас не видны: заменённая, передвигаемая, убранные и передвинутые. */
function wantHidden(): Set<number> {
  const s = new Set<number>();
  if (cur?.kind === 'thing') {
    if (cur.spec.replaces && cur.obj) s.add(cur.obj);
    const m = cur.spec.moves;
    if (m) {
      const o = findGame(lvl, room, m.thing, m.nth);
      if (o) s.add(o.id);
    }
  }
  for (const r of edits.removed) s.add(r.o.id);
  // Передвинутая прячется, только если ей нашлось место по правилу: нет места — в игре стоит, где стояла.
  for (const m of edits.moved) if (m.spot) s.add(m.o.id);
  return s;
}
const sameSet = (a: ReadonlySet<number>, b: ReadonlySet<number>): boolean => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * Где встанут передвинутые здесь — в порядке сборки, как в игре: их старые места и убранные вещи уже свободны (преграды
 * растворены). Потом — что скрыть: убранные, правка и те передвинутые, которым нашлось место.
 */
function layoutEdits(): void {
  applyHidden(new Set([...wantHidden(), ...edits.moved.map((m) => m.o.id)]));
  const taken: Box[] = [];
  for (const m of edits.moved) {
    const f = moveSpot(m.spec, room, pw, ALL_PROPS, taken);
    m.spot = f ? f.spot : null;
    if (f) taken.push(f.box);
  }
  applyHidden(wantHidden());
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
/** Вещь игры под мышью (её можно выбрать и потянуть) и выбранная вещь игры. */
const hoverHelper = new THREE.Box3Helper(new THREE.Box3(), 0xe3b25e);
hoverHelper.visible = false;
scene.add(hoverHelper);
const selHelper = new THREE.Box3Helper(new THREE.Box3(), 0xfff1cf);
selHelper.visible = false;
scene.add(selHelper);
const box3 = (o: Pick<LevelObject, 'min' | 'max'>): THREE.Box3 => new THREE.Box3(new THREE.Vector3(...o.min), new THREE.Vector3(...o.max));

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
    if (hidden.has(o.id)) continue;
    if (!ray.ray.intersectBox(box3(o), hit)) continue;
    const d = hit.distanceTo(ray.ray.origin);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

// ───────────────────────────── вещи игры: выбрать, убрать, передвинуть ─────────────────────────────

/** Варианты комнаты-аномалии, скрытые сейчас: их вещи не видны и не выбираются. */
const groupsCache = new WeakMap<BuiltLevel, Set<string>>();
function hiddenGroups(): Set<string> {
  let g = groupsCache.get(lvl);
  if (!g) {
    g = new Set(lvl.chunks.filter((c) => c.hidden && c.id).map((c) => c.id!));
    groupsCache.set(lvl, g);
  }
  return g;
}
/**
 * Вещь игры, которую партнёр может взять: стоит в показанном помещении, видна, ставится руками (как с полки). Экраны —
 * нет: их ставит обстановка мимо реестра, это примета места (выставка, проём на луг), а не мебель.
 */
function gameOk(o: LevelObject): boolean {
  const p = ALL_PROPS[o.name];
  if (!p || !placeable(o.name, p, FIXED) || o.name.startsWith('display_')) return false;
  if (o.group && hiddenGroups().has(o.group)) return false;
  return roomOfObj(lvl, o) === room;
}
const objById = (id: number): LevelObject | undefined => (lvl.objects ?? []).find((o) => o.id === id);
/** Выбранная вещь игры (номер объекта; 0 — никакой) и вещь под мышью. */
let gameSel = 0;
let hover = 0;

/** Вещь игры под курсором — по видимой сетке помещения (номер объекта у вершин), а не по коробке. */
function gameAt(e: { clientX: number; clientY: number }): { o: LevelObject; d: number } | null {
  setNdc(e);
  ray.setFromCamera(ndc, cam);
  const hit = ray.intersectObjects(roomMeshes, false)[0];
  if (!hit || !hit.face) return null;
  const ids = hit.object.userData.obj as Uint16Array | undefined;
  const id = ids ? ids[hit.face.a]! : 0;
  const o = id > 0 ? objById(id) : undefined;
  return o && gameOk(o) ? { o, d: hit.distance } : null;
}
/** Убранная вещь под курсором — по её рамке. */
function removedAt(e: { clientX: number; clientY: number }): { r: RemovedHere; d: number } | null {
  setNdc(e);
  ray.setFromCamera(ndc, cam);
  let best: { r: RemovedHere; d: number } | null = null;
  const p = new THREE.Vector3();
  for (const r of edits.removed) {
    if (!ray.ray.intersectBox(box3(r.o), p)) continue;
    const d = p.distanceTo(ray.ray.origin);
    if (!best || d < best.d) best = { r, d };
  }
  return best;
}

/** Выбрать вещь игры: блок «Вещь игры» и её карточка. */
function selectGame(id: number): void {
  const o = objById(id);
  if (!o) return;
  gameSel = id;
  openCard(o.name, 'room');
  dirty = true;
  syncPanel();
}
function removedOf(id: number): RemovedHere | undefined {
  return edits.removed.find((r) => r.o.id === id);
}
function movedOf(id: number): MovedHere | undefined {
  return edits.moved.find((m) => m.o.id === id);
}

/** Без базы записи живут только на этой странице — так и сказать. */
const localNote = (): string => (db ? '' : ' Только на этой странице: база недоступна.');
/** Убрать выбранную вещь игры: запись в removed сразу (⌘Z отменяет). */
function removeGame(id: number): RemovedSpec | null {
  const o = objById(id);
  if (!o || !gameOk(o)) return null;
  const spec: RemovedSpec = { id: `rm_${stamp()}`, name: `${ruShort(o.name)} — убрана`.slice(0, 80), what: { thing: o.name, nth: nthOf(lvl, o) }, worlds: [world], rooms: [roomType], at: new Date().toISOString() };
  const bad = removedProblems(spec, ALL_PROPS, FIXED);
  if (bad.length > 0) {
    setStatus(`Не убрано: ${bad.join('; ')}.`);
    return null;
  }
  gameSel = id;
  pushStep({ t: 'rec', coll: 'removed', add: true, spec });
  void putRecord('removed', spec);
  setStatus(`Убрана: ${spec.what.nth + 1}-я «${ruShort(o.name)}» — в игре её не будет в помещениях «${ROOM_RU[roomType] ?? roomType}» (${WORLD_RU[world]}). ⌘Z или «Вернуть» — отменить.${localNote()}`);
  return spec;
}
/** Вернуть убранную вещь игры: удалить запись. */
function restoreGame(id: number): void {
  const r = removedOf(id);
  if (!r) return;
  pushStep({ t: 'rec', coll: 'removed', add: false, spec: r.spec });
  void dropRecord('removed', r.spec);
  setStatus(`Вернулась: «${ruShort(r.o.name)}» — игра снова ставит её, где ставила.${localNote()}`);
}

/** Начать тянуть вещь игры: появляется передвинутая запись, оригинал прячется. */
function beginGameDrag(o: LevelObject): void {
  pushUndo();
  const nth = nthOf(lvl, o);
  const it: ThingItem = {
    kind: 'thing',
    spec: { id: `pl_${stamp()}`, name: `${ruShort(o.name)} — передвинута`.slice(0, 80), prop: o.name, rule: { worlds: [world], rooms: [roomType], anchor: 'wall', facing: 'room', lift: 0, count: 1 }, turn: 0, offset: [0, 0], moves: { thing: o.name, nth } },
    at: [o.at[0], o.at[1], o.at[2]],
    rot: o.rot,
  };
  derive(it);
  cur = it;
  gameSel = 0;
  hover = 0;
  followCard(o.name);
  setStatus(`Тянешь ${nth + 1}-ю «${ruShort(o.name)}». Отпусти — и в игре она встанет так в каждом помещении этого типа. Q и E — повернуть.`);
  dirty = true;
  syncPanel();
}

/** Вернуть передвинутую на место игры: убрать запись (сохранённую — из базы, с отменой ⌘Z). */
function unmove(spec: PlacedSpec): void {
  const saved = savedThings.get(spec.id);
  if (cur?.kind === 'thing' && cur.spec.id === spec.id) {
    pushUndo();
    cur = null;
  }
  if (saved) {
    pushStep({ t: 'rec', coll: 'things', add: false, spec: saved });
    void dropRecord('things', saved);
  }
  setStatus(`Вернулась на место игры: «${ruShort(spec.prop)}».${saved ? localNote() : ''}`);
  dirty = true;
  syncPanel();
}

function refresh(): void {
  // Что скрыто: правка и записи в помещении. Изменилось — перерисовать помещение и призраков.
  const want = wantHidden();
  if (!sameSet(want, hidden)) {
    applyHidden(want);
    showRoom(true);
    renderGhosts();
  }
  holder.clear();
  figGroup.visible = false;
  boxHelper.visible = false;
  arrow.visible = false;
  swapHelper.visible = false;
  const ho = hover && hover !== gameSel ? objById(hover) : undefined;
  hoverHelper.visible = !!ho && !hidden.has(ho.id);
  if (ho) hoverHelper.box.copy(box3(ho));
  const so = gameSel ? objById(gameSel) : undefined;
  selHelper.visible = !!so;
  if (so) selHelper.box.copy(box3(so));
  if (!cur) {
    problems = [];
    return;
  }
  if (cur.kind === 'thing') {
    const mesh = new THREE.Mesh(geometryOf(cur.spec.prop), thingMat);
    mesh.position.set(cur.at[0], cur.at[1], cur.at[2]);
    mesh.rotation.y = (cur.rot * Math.PI) / 2;
    mesh.userData.pick = true;
    holder.add(mesh);
    const p = ALL_PROPS[cur.spec.prop]!;
    const cell = cellOf(cur.at[0], cur.at[2]);
    // Передвинутые вещи игры здесь (сохранённые) — тоже соседи: в них новая вещь врастать не должна.
    const others = edits.moved.filter((m) => m.spot && !(cur && m.spec.id === cur.spec.id)).map((m) => worldBox(ALL_PROPS[m.spec.prop]!, m.spot!.at, m.spot!.rot));
    const chk = checkSpot(p, cur.at, cur.rot, room, { floor: floorY, ceil: ceilY, pit: cell?.noFloor === true, tier: room.tier }, pw, others);
    // Замена встаёт на место вещи игры — проверки места её не касаются (там уже стояла вещь).
    problems = cur.spec.replaces ? [] : chk.problems;
    const so2 = cur.spec.replaces && cur.obj ? objById(cur.obj) : undefined;
    swapHelper.visible = !!so2;
    if (so2) swapHelper.box.copy(box3(so2));
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

// Призраки: уже сохранённые вещи, правило которых пускает их в это помещение; передвинутые вещи игры — там, где их
// поставит игра; убранные — бледные красные рамки на их месте.
const ghosts = new THREE.Group();
scene.add(ghosts);
const frames = new THREE.Group();
scene.add(frames);
function renderGhosts(): void {
  ghosts.clear();
  for (const f of frames.children) (f as THREE.Box3Helper).geometry.dispose();
  frames.clear();
  for (const s of savedThings.values()) {
    if (cur && cur.kind === 'thing' && cur.spec.id === s.id) continue;
    if (s.moves) continue;
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
  for (const m of edits.moved) {
    if (!m.spot || (cur && cur.kind === 'thing' && cur.spec.id === m.spec.id)) continue;
    const mesh = new THREE.Mesh(geometryOf(m.spec.prop), movedMat);
    mesh.position.set(m.spot.at[0], m.spot.at[1], m.spot.at[2]);
    mesh.rotation.y = (m.spot.rot * Math.PI) / 2;
    mesh.userData.ghost = m.spec.id;
    ghosts.add(mesh);
  }
  for (const r of edits.removed) {
    const h = new THREE.Box3Helper(box3(r.o), 0xdc7f73);
    const mat = h.material as THREE.LineBasicMaterial;
    mat.transparent = true;
    mat.opacity = 0.6;
    frames.add(h);
  }
}

// ───────────────────────────── мышь и клавиши ─────────────────────────────

type Drag = { what: 'thing' } | { what: 'grip'; h: Grip; plane: THREE.Plane; start: THREE.Vector3; at0: Vec3; vertical: boolean };
let drag: Drag | null = null;
/** Нажали на вещь игры: щелчок (выбрать) или начало перетаскивания (передвинуть) — решит сдвиг больше 5 px. */
let press: { o: LevelObject; x: number; y: number } | null = null;
/** Нажали на пустое место: щелчок снимает выбор (поворот вида — нет). */
let blank: { x: number; y: number } | null = null;
/** Поднесённая с полки вещь: что и её призрак под курсором. */
let carry: { prop: string } | { figure: true } | null = null;
const carryMesh = new THREE.Mesh(new THREE.BufferGeometry(), ghostMat);
carryMesh.visible = false;
scene.add(carryMesh);

function floorHit(e: { clientX: number; clientY: number }): THREE.Vector3 | null {
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

/** Сдвинуть редактируемую вещь в точку пола (x, z): у стены — вплотную, правило — из точки. */
function moveCurTo(x: number, z: number): void {
  if (!cur || cur.kind !== 'thing') return;
  const p = ALL_PROPS[cur.spec.prop]!;
  const s = snapToWall(p, x, z, cur.rot);
  cur.at = [Math.round(s.x * 100) / 100, cur.at[1], Math.round(s.z * 100) / 100];
  cur.rot = s.rot;
  derive(cur);
}

renderer.domElement.addEventListener(
  'pointerdown',
  (e) => {
    if (carry || e.button !== 0) return;
    setNdc(e);
    ray.setFromCamera(ndc, cam);
    const take = (): void => {
      e.preventDefault();
      e.stopImmediatePropagation();
      controls.enabled = false;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    if (cur?.kind === 'figure') {
      const hit = ray.intersectObjects([...grips.values()], false)[0];
      if (hit) {
        take();
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
        return;
      }
    }
    if (cur?.kind === 'thing') {
      const hit = ray.intersectObjects(holder.children, false)[0];
      if (hit) {
        take();
        pushUndo();
        drag = { what: 'thing' };
        return;
      }
    }
    // Ближайшее под курсором: призрак сохранённой вещи, рамка убранной, вещь игры.
    ray.setFromCamera(ndc, cam);
    const g = ray.intersectObjects(ghosts.children, false)[0];
    const r = removedAt(e);
    const o = gameAt(e);
    const dg = g ? g.distance : Infinity;
    const dr = r ? r.d : Infinity;
    const dobj = o ? o.d : Infinity;
    if (g && dg <= dr && dg <= dobj) {
      const s = savedThings.get(g.object.userData.ghost as string);
      if (s) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openThing(s);
      }
      return;
    }
    if (r && dr <= dobj) {
      e.preventDefault();
      e.stopImmediatePropagation();
      selectGame(r.r.o.id);
      return;
    }
    if (o) {
      take();
      press = { o: o.o, x: e.clientX, y: e.clientY };
      return;
    }
    blank = { x: e.clientX, y: e.clientY };
  },
  { capture: true },
);

/** Вещь под мышью ищется раз в кадр: сетка помещения большая. */
let hoverAt: { clientX: number; clientY: number } | null = null;
renderer.domElement.addEventListener('pointermove', (e) => {
  if (carry) {
    const q = floorHit(e);
    carryMesh.visible = !!q;
    if (q) carryMesh.position.set(q.x, floorY, q.z);
    // Над вещью игры, которую можно заменить, — её рамка: отпустишь — встанет вместо неё.
    const t = 'prop' in carry ? swapTarget(e, carry.prop) : null;
    swapHelper.visible = !!t;
    if (t) swapHelper.box.copy(box3(t));
    return;
  }
  if (press) {
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 5) return;
    const o = press.o;
    press = null;
    beginGameDrag(o);
    drag = { what: 'thing' };
  }
  if (!drag) {
    if (cur?.kind === 'figure') {
      setNdc(e);
      ray.setFromCamera(ndc, cam);
      const hit = ray.intersectObjects([...grips.values()], false)[0];
      for (const m of grips.values()) m.material = m === hit?.object ? gripHot : gripMat;
      renderer.domElement.style.cursor = hit ? 'grab' : '';
      if (hit) return;
    }
    hoverAt = { clientX: e.clientX, clientY: e.clientY };
    return;
  }
  if (!cur) return;
  if (drag.what === 'thing' && cur.kind === 'thing') {
    const q = floorHit(e);
    if (!q) return;
    if (cur.spec.replaces) {
      delete cur.spec.replaces;
      delete cur.obj;
      setStatus('Уже не замена: вещь стоит сама по себе. Чтобы заменить снова — отпусти вещь с полки на вещь игры.');
    }
    moveCurTo(q.x, q.z);
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
renderer.domElement.addEventListener('pointerleave', () => {
  hoverAt = null;
  if (hover) {
    hover = 0;
    dirty = true;
  }
});

const endDrag = (): void => {
  controls.enabled = true;
  if (!drag) return;
  const was = drag;
  drag = null;
  renderer.domElement.style.cursor = '';
  if (was.what === 'thing' && cur?.kind === 'thing' && cur.spec.moves) {
    const m = cur.spec.moves;
    setStatus(`Передвинута ${m.nth + 1}-я «${ruShort(m.thing)}». «Сохранить» — и в игре так будет в помещениях правила; «Вернуть на место игры» — передумал.`);
  }
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
  if (press) {
    // Нажал и отпустил, не сдвинув, — щелчок: выбрать вещь игры.
    const o = press.o;
    press = null;
    controls.enabled = true;
    selectGame(o.id);
    return;
  }
  if (blank && Math.hypot(e.clientX - blank.x, e.clientY - blank.y) < 5 && gameSel) {
    gameSel = 0;
    dirty = true;
    syncPanel();
  }
  blank = null;
  endDrag();
});
renderer.domElement.addEventListener('pointercancel', () => {
  press = null;
  blank = null;
  endDrag();
});
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

/** Отменить последний шаг: правку или запись в базе (убранная, удалённая передвинутая). */
function undoStep(): boolean {
  const s = undo.pop();
  if (!s) return false;
  if (s.t === 'cur') {
    cur = JSON.parse(s.json) as Item | null;
    if (cur) placeIfElsewhere(cur);
  } else if (s.add) void dropRecord(s.coll, s.spec);
  else void putRecord(s.coll, s.spec);
  setStatus('Отменено.');
  dirty = true;
  syncPanel();
  return true;
}
/** Правка из отмены могла стоять в другом помещении: поставить её сюда по правилу. */
function placeIfElsewhere(it: Item): void {
  const rects = cellRects(room);
  const inRoom = rects.some((r) => it.at[0] >= r.x0 && it.at[0] <= r.x1 && it.at[2] >= r.z0 && it.at[2] <= r.z1) && Math.abs(it.at[1] - floorY) < 3;
  if (!inRoom) placeInRoom(it);
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    if (undoStep()) e.preventDefault();
    return;
  }
  if (e.code === 'KeyQ') turn(-1);
  else if (e.code === 'KeyE') turn(1);
  else if (e.code === 'Escape') {
    if (carry) {
      carry = null;
      carryMesh.visible = false;
      document.body.classList.remove('is-carrying');
    } else if (gameSel) {
      gameSel = 0;
      dirty = true;
      syncPanel();
    }
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
  it.obj = o.id;
  cur = it;
  setStatus(`Вместо «${from.ru.split(',')[0]}» — «${p.ru.split(',')[0]}». В игре так будет в помещениях правила, сколько указано.`);
  dirty = true;
  syncPanel();
}

/** Новая вещь (фигура) там, где её отпустили. */
function drop(what: { prop: string } | { figure: true }, x: number, z: number): void {
  pushUndo();
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

/** Кадр: перерисовать, если что-то поменялось. Запускается в самом конце, когда всё готово. */
function loop(): void {
  requestAnimationFrame(loop);
  if (hoverAt && !drag && !carry && !press) {
    const h = gameAt(hoverAt);
    const id = h ? h.o.id : 0;
    hoverAt = null;
    renderer.domElement.style.cursor = id ? 'grab' : '';
    if (id !== hover) {
      hover = id;
      dirty = true;
    }
  }
  if (dirty) {
    dirty = false;
    refresh();
    renderProblems();
  }
  controls.update();
  renderer.render(scene, cam);
  card.frame();
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
/** Что можно ставить руками (как с полки), — остальное на полке «только карточка». */
const PLACE = new Set(Object.keys(ALL_PROPS).filter((n) => placeable(n, ALL_PROPS[n]!, FIXED)));
/** Вся опись на полке: что ставится руками и что только с карточкой (бывший «Опросник мебели»). */
const SHELF = ITEMS.slice().sort((a, b) => a.ru.localeCompare(b.ru, 'ru'));
type ShelfKind = 'all' | Exclude<Kind, 'other'> | 'unmarked';
const KINDS: readonly [ShelfKind, string, string][] = [
  ['all', 'Все', 'вся опись игры'],
  ['furniture', 'Мебель', 'на чём сидят, лежат, за чем работают и куда кладут — и стоит на уровнях'],
  ['memory', 'Вещи памяти', 'вещи, которые ищут'],
  ['people', 'Люди', 'позы манекена'],
  ['pair', 'Пары', 'вещь из набора KayKit и её замена'],
  ['unmarked', 'Без отметки', 'о чём опросник спрашивал, а отметки ещё нет'],
];
let shelfKind: ShelfKind = 'all';
const lazy = new IntersectionObserver((list) => {
  for (const en of list) {
    if (!en.isIntersecting) continue;
    const img = en.target as HTMLImageElement;
    lazy.unobserve(img);
    img.src = thumbOf(img.dataset.name!);
  }
});
const tag = (text: string, kind: string): HTMLSpanElement => Object.assign(document.createElement('span'), { className: `tag tag--${kind}`, textContent: text });
function shelfVisible(i: Entry, q: string): boolean {
  if (q && !i.ru.toLowerCase().includes(q) && !i.name.includes(q)) return false;
  if (shelfKind === 'all') return true;
  if (shelfKind === 'unmarked') return asked(i) && !marks.get(i.name)?.verdict;
  return i.kind === shelfKind;
}
function renderKinds(): void {
  chips($('kinds'), KINDS.map((k) => k[0]), (k) => KINDS.find((x) => x[0] === k)![1], (k) => k === shelfKind, (k) => {
    shelfKind = k;
    renderKinds();
    renderShelf();
  });
  for (const b of $('kinds').querySelectorAll('button')) b.title = KINDS.find((x) => x[1] === b.textContent)?.[2] ?? '';
}
function renderShelf(): void {
  const q = searchEl.value.trim().toLowerCase();
  // Сначала то, что уже стоит в этом месте (по обстановке показанного уровня), потом остальное.
  const here = new Set((lvl.objects ?? []).map((o) => o.name));
  const list = SHELF.filter((i) => shelfVisible(i, q)).sort((a, b) => (here.has(b.name) ? 1 : 0) - (here.has(a.name) ? 1 : 0));
  const items: HTMLButtonElement[] = [];
  if ((shelfKind === 'all' || shelfKind === 'people') && (!q || 'манекен'.includes(q))) {
    const fig = document.createElement('button');
    fig.type = 'button';
    fig.className = 'shelf__item shelf__item--fig';
    fig.innerHTML = '<span class="shelf__thumb shelf__thumb--fig">◎</span><span class="shelf__text"><b>Манекен</b><small>гнуть руками, свой материал</small></span>';
    fig.addEventListener('pointerdown', (e) => pressShelf(e, null));
    items.push(fig);
  }
  for (const x of list) {
    const b = document.createElement('button');
    b.type = 'button';
    const can = PLACE.has(x.name);
    b.className = `shelf__item${can ? '' : ' shelf__item--card'}${cardName === x.name ? ' is-current' : ''}`;
    b.dataset.name = x.name;
    const img = document.createElement('img');
    img.className = 'shelf__thumb';
    img.alt = '';
    img.width = 56;
    img.height = 56;
    img.dataset.name = x.name;
    const have = thumbs.get(x.name);
    if (have) img.src = have;
    else lazy.observe(img);
    const text = document.createElement('span');
    text.className = 'shelf__text';
    const title = document.createElement('b');
    title.textContent = x.alt ? `${x.ru} → ${ALL_PROPS[x.alt]?.ru ?? x.alt}` : x.ru;
    const small = document.createElement('small');
    small.textContent = `${here.has(x.name) ? 'уже есть в этом месте · ' : ''}${x.mount === 'wall' ? 'на стену' : x.mount === 'free' ? 'посреди пола' : x.mount === 'ceiling' ? 'под потолок' : 'у стены'}`;
    const tags = document.createElement('span');
    tags.className = 'tags';
    if (!can) tags.append(tag('только карточка', 'card'));
    if (x.kind === 'memory') tags.append(tag('вещь памяти', 'mem'));
    if (x.toy && x.kind !== 'pair') tags.append(tag('KayKit', 'toy'));
    const v = marks.get(x.name)?.verdict;
    if (v) tags.append(tag(SHORT[v], `v-${v}`));
    text.append(title, small);
    if (tags.childElementCount > 0) text.append(tags);
    b.append(img, text);
    b.title = can ? 'Щелчок — карточка; тяни — в помещение' : 'Щелчок — карточка (руками эту вещь не ставят)';
    b.addEventListener('pointerdown', (e) => pressShelf(e, x.name));
    // С клавиатуры (Enter, пробел) — карточка.
    b.addEventListener('click', (e) => {
      if (e.detail === 0) openCard(x.name, 'shelf');
    });
    items.push(b);
  }
  shelfEl.replaceChildren(...items);
  $('shelfcount').textContent = `${list.length} из ${SHELF.length}`;
  const ask = ITEMS.filter(asked);
  $('marked').textContent = `${ask.filter((i) => marks.get(i.name)?.verdict).length} из ${ask.length}`;
}
/** Нажали на вещь полки: отпустил на месте — карточка; потянул дальше 5 px — понёс в помещение. */
let shelfPress: { name: string | null; x: number; y: number } | null = null;
function pressShelf(e: PointerEvent, name: string | null): void {
  if (e.button !== 0) return;
  e.preventDefault();
  shelfPress = { name, x: e.clientX, y: e.clientY };
}
window.addEventListener('pointermove', (e) => {
  if (!shelfPress || carry) return;
  if (Math.hypot(e.clientX - shelfPress.x, e.clientY - shelfPress.y) < 5) return;
  const name = shelfPress.name;
  shelfPress = null;
  if (name !== null && !PLACE.has(name)) {
    setStatus(`«${ruShort(name)}» руками не ставят — у неё только карточка.`);
    return;
  }
  startCarry(name === null ? { figure: true } : { prop: name });
});
window.addEventListener('pointerup', () => {
  if (!shelfPress) return;
  const name = shelfPress.name;
  shelfPress = null;
  if (name) openCard(name, 'shelf');
  else setStatus('Манекен: тяни его с полки в помещение.');
});
function startCarry(what: { prop: string } | { figure: true }): void {
  carry = what;
  if ('prop' in what) followCard(what.prop);
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

// ───────────────────────────── карточка вещи (бывший «Опросник мебели») ─────────────────────────────

const card = cardView($('cardview'), geometryOf, thingMat);
/** Чья карточка открыта (имя в реестре) и откуда её открыли. */
let cardName: string | null = null;
const marks = new Map<string, Mark>();
const noteEl = $<HTMLTextAreaElement>('c-note');

/** Высота вещи в карточке: настенная — на своей высоте, подвесная — под потолком 2,6 м (её начало — у потолка). */
const cardLift = (i: Entry): number => (i.mount === 'ceiling' ? 2.6 : i.y);
/** Карточка свёрнута в строку: партнёр расставляет, карточка не занимает панель. */
let cardFolded = false;
function foldCard(folded: boolean): void {
  cardFolded = folded;
  $('card').classList.toggle('is-folded', folded);
  const b = $('c-fold');
  b.textContent = folded ? 'развернуть' : 'свернуть';
  b.setAttribute('aria-expanded', String(!folded));
}
/** Партнёр расставляет: открытая карточка переходит на вещь в работе и сворачивается в строку — панель правила видна. */
function followCard(name: string): void {
  if (!cardName) return;
  if (cardName !== name && ITEM.has(name)) openCard(name, 'cur');
  foldCard(true);
}
function openCard(name: string, from: 'shelf' | 'room' | 'cur'): void {
  const i = ITEM.get(name);
  if (!i) return;
  const fresh = cardName !== name;
  cardName = name;
  if (fresh) {
    noteEl.value = marks.get(name)?.note ?? '';
    const alt = i.alt ? ITEM.get(i.alt) : undefined;
    card.show([{ name, lift: cardLift(i) }, ...(alt ? [{ name: alt.name, lift: cardLift(alt) }] : [])]);
  }
  // С полки — к описи: выбор вещи игры в помещении снимается.
  if (from === 'shelf' && gameSel) {
    gameSel = 0;
    dirty = true;
    syncPanel();
  }
  foldCard(false);
  renderCard();
  for (const b of shelfEl.querySelectorAll<HTMLButtonElement>('.shelf__item')) b.classList.toggle('is-current', b.dataset.name === name);
  // На узком экране карточка ниже помещения: открыл с полки — показать её.
  if (from === 'shelf' && window.matchMedia('(max-width: 1180px)').matches) $('card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function renderCard(): void {
  const el = $('card');
  el.toggleAttribute('hidden', !cardName);
  if (!cardName) return;
  const i = ITEM.get(cardName)!;
  const alt = i.alt ? ITEM.get(i.alt) : undefined;
  const v0 = marks.get(cardName)?.verdict;
  $('c-title').textContent = `· ${ruShort(cardName)}${v0 ? ` · ${SHORT[v0]}` : ''}`;
  $('c-ru').textContent = alt ? `Слева — сейчас: ${i.ru}. Справа — замена: ${alt.ru}.` : i.ru;
  $('c-name').textContent = alt ? `${i.name} → ${alt.name}` : i.name;
  $('c-size').textContent = alt ? `${sizeText(i)} → ${sizeText(alt)}` : sizeText(i);
  $('c-source').textContent = alt ? 'сейчас — готовая модель из набора KayKit; замена — собрана кодом, как стул' : i.source;
  $('c-where').textContent = whereText(i);
  const rt = roomsText(i);
  $('c-rooms-dt').textContent = rt.label;
  $('c-rooms').textContent = rt.text;
  $('c-advice').textContent = i.advice ? `Совет основной модели: ${i.advice}.` : '';
  $('c-ask').textContent = i.kind === 'memory' ? 'Насколько проработать' : i.kind === 'pair' ? 'Менять или оставить' : i.kind === 'people' ? 'Поза' : 'Что с ней делать';
  const m = marks.get(cardName) ?? {};
  const can = !db || canWrite;
  $('c-verdicts').replaceChildren(
    ...CHOICES[i.kind].map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      const on = m.verdict === c.id;
      b.className = `verdict verdict--${c.id}${on ? ' is-on' : ''}`;
      b.setAttribute('aria-pressed', String(on));
      b.dataset.v = c.id;
      b.disabled = !can;
      b.append(Object.assign(document.createElement('span'), { textContent: c.label }), Object.assign(document.createElement('small'), { textContent: c.hint }));
      b.addEventListener('click', () => {
        if (!cardName) return;
        // Повторное нажатие снимает отметку.
        const now = marks.get(cardName)?.verdict;
        void saveMark(cardName, now === c.id ? undefined : c.id, noteEl.value);
      });
      return b;
    }),
  );
  noteEl.disabled = !can;
  $<HTMLButtonElement>('c-savenote').disabled = !can;
  const game = $<HTMLAnchorElement>('c-game');
  game.href = gameLink(i.alt ?? i.name);
  game.textContent = i.alt ? 'Замена в игре ↗' : 'Посмотреть в игре ↗';
  if (MEMORY.has(i.name)) game.title = 'Вещь памяти в витрине игры, под фонарём';
}
/** Записать отметку (и заметку) вещи name: в базу страницы, без базы — в память страницы. */
async function saveMark(name: string, verdict: Verdict | undefined, note: string): Promise<void> {
  const next: Mark = { at: new Date().toISOString() };
  if (verdict) next.verdict = verdict;
  const n = note.trim();
  if (n) next.note = n.slice(0, 2000);
  marks.set(name, next);
  renderCard();
  renderShelf();
  if (!db) {
    setStatus(`Отметка «${ruShort(name)}»: ${verdict ? LABEL[verdict] : 'снята'} — только на этой странице: база недоступна.`);
    return;
  }
  if (!canWrite) return;
  setStatus('Сохраняю отметку…');
  try {
    await db.collection('verdicts').doc(name).set(next as Record<string, unknown>);
    setStatus(`Отметка «${ruShort(name)}»: ${verdict ? LABEL[verdict] : 'снята'}${n ? ', с заметкой' : ''}.`);
  } catch {
    setStatus('Отметка не сохранилась. Попробуй ещё раз через минуту.');
  }
}
$('c-fold').addEventListener('click', () => foldCard(!cardFolded));
$('c-close').addEventListener('click', () => {
  cardName = null;
  renderCard();
  for (const b of shelfEl.querySelectorAll<HTMLButtonElement>('.shelf__item')) b.classList.remove('is-current');
});
$('c-savenote').addEventListener('click', () => {
  if (cardName) void saveMark(cardName, marks.get(cardName)?.verdict, noteEl.value);
});

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
    if (cur?.kind === 'thing') {
      delete cur.spec.replaces;
      delete cur.obj;
    }
    if (cur) derive(cur);
  }),
);
$('unmove').addEventListener('click', () => {
  if (cur?.kind === 'thing' && cur.spec.moves) unmove(cur.spec);
});
$('turnl').addEventListener('click', () => turn(-1));
$('turnr').addEventListener('click', () => turn(1));
$('curcard').addEventListener('click', () => {
  if (cur?.kind === 'thing') openCard(cur.spec.prop, 'cur');
});
$('gremove').addEventListener('click', () => {
  if (gameSel) removeGame(gameSel);
});
$('grestore').addEventListener('click', () => {
  if (gameSel) restoreGame(gameSel);
});
$('gedit').addEventListener('click', () => {
  const m = gameSel ? movedOf(gameSel) : undefined;
  if (m) openThing(m.spec);
});
$('gunmove').addEventListener('click', () => {
  const m = gameSel ? movedOf(gameSel) : undefined;
  if (m) unmove(m.spec);
});
$('gcard').addEventListener('click', () => {
  const o = gameSel ? objById(gameSel) : undefined;
  if (o) openCard(o.name, 'room');
});

/** Блок «Вещь игры»: что выбрано, какое по счёту, убрана ли, передвинута ли. */
function syncGame(): void {
  const o = gameSel ? objById(gameSel) : undefined;
  $('gamebox').toggleAttribute('hidden', !o);
  if (!o) return;
  const nth = nthOf(lvl, o);
  const same = (lvl.objects ?? []).filter((q) => q.name === o.name && roomOfObj(lvl, q) === room).length;
  $('gname').textContent = ALL_PROPS[o.name]?.ru ?? o.name;
  $('gnth').textContent = `${nth + 1}-я такая в этом помещении${same > 1 ? ` из ${same}` : ''}${o.flat ? ' · стоит картонкой' : ''}`;
  const r = removedOf(o.id);
  const m = movedOf(o.id);
  const st = $('gstate');
  st.classList.toggle('is-gone', !!r);
  st.textContent = r ? `Убрана: «${r.spec.name}». В игре её нет в помещениях: ${r.spec.rooms.length ? r.spec.rooms.map((t) => ROOM_RU[t] ?? t).join(', ') : 'любых'} (${r.spec.worlds.map((w) => WORLD_RU[w]).join(', ')}).` : m ? (m.spot ? `Передвинута: «${m.spec.name}» — стоит там, куда её поставит игра.` : `Передвинута: «${m.spec.name}», но здесь места по правилу нет — в этом помещении она останется, где стояла.`) : '';
  $('gremove').toggleAttribute('hidden', !!r || !!m);
  $('grestore').toggleAttribute('hidden', !r);
  $('gedit').toggleAttribute('hidden', !m);
  $('gunmove').toggleAttribute('hidden', !m);
  $('ghint').toggleAttribute('hidden', !!r || !!m);
  const cov = $('gcover');
  cov.classList.remove('is-bad');
  cov.textContent = r ? removedCoverage(r.spec) : '';
}

function syncPanel(): void {
  chips($('worldpick'), FIGURE_WORLDS, (w) => WORLD_RU[w]!, (w) => w === world, (w) => enterRoom(w, roomTypes(w).includes(roomType) ? roomType : roomTypes(w)[0]!, 0));
  chips($('roompick'), roomTypes(world), (r) => ROOM_RU[r] ?? r, (r) => r === roomType, (r) => enterRoom(world, r, 0));
  const total = roomsOfType(world, roomType).length;
  $('roomnum').textContent = `${roomPick + 1} из ${total}`;
  syncGame();
  const has = !!cur;
  $('rule').toggleAttribute('hidden', !has);
  $('figbox').toggleAttribute('hidden', cur?.kind !== 'figure');
  $('turns').toggleAttribute('hidden', !has);
  $('curcard').toggleAttribute('hidden', cur?.kind !== 'thing');
  if (!cur) {
    $('what').textContent = 'Перетащи вещь с полки в помещение — или потяни вещь игры.';
    if (document.activeElement !== nameEl) nameEl.value = '';
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
  chips($('worlds'), FIGURE_WORLDS, (w) => WORLD_RU[w]!, (w) => c.spec.rule.worlds.includes(w), (w) =>
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
  const mv = c.kind === 'thing' ? c.spec.moves : undefined;
  $('replace').toggleAttribute('hidden', !rp);
  if (rp) $('replacetext').textContent = `вместо вещи игры: ${ALL_PROPS[rp]?.ru.split(',')[0] ?? rp}`;
  $('moved').toggleAttribute('hidden', !mv);
  if (mv) $('movenote').textContent = `вещь игры: ${mv.nth + 1}-я «${ruShort(mv.thing)}» в помещениях правила — встанет по правилу в том же помещении, одна`;
  $('countrow').toggleAttribute('hidden', !!mv);
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
  const lift = c.spec.rule.lift > 0 ? `${c.spec.rule.lift.toFixed(2)} м над полом · ` : '';
  $('summary').textContent = rp
    ? `${where} · ${rooms} · вместо «${ALL_PROPS[rp]?.ru.split(',')[0] ?? rp}» — там же и так же повёрнута · до ${c.spec.rule.count} шт. на место`
    : mv
      ? `${where} · ${rooms} · ${mv.nth + 1}-я такая — ${ANCHOR_RU[c.spec.rule.anchor]}, ${FACING_RU[c.spec.rule.facing]}${turnTxt} · ${lift}в своём помещении`
      : `${where} · ${rooms} · ${ANCHOR_RU[c.spec.rule.anchor]}, ${FACING_RU[c.spec.rule.facing]}${turnTxt} · ${lift}${c.spec.rule.count} шт. на место`;
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
/** Сколько замен встанет на плане: вещи игры этого имени в помещениях правила, не больше count (картонку не заменяют). */
function swapsIn(l: BuiltLevel, spec: PlacedSpec): number {
  let n = 0;
  for (const o of l.objects ?? []) {
    if (o.name !== spec.replaces || o.flat) continue;
    const r = roomOfObj(l, o);
    if (r && (spec.rule.rooms.length === 0 || spec.rule.rooms.includes(r.type))) n += 1;
  }
  return Math.min(n, spec.rule.count);
}
/** Помещения правила на плане, где стоит nth-я вещь thing: объект уровня там и само помещение. */
function gameRooms(l: BuiltLevel, rooms: readonly string[], thing: string, nth: number): { r: GenRoom; o: LevelObject }[] {
  const out: { r: GenRoom; o: LevelObject }[] = [];
  for (const r of l.layout!.rooms) {
    if (rooms.length > 0 && !rooms.includes(r.type)) continue;
    const o = findGame(l, r, thing, nth);
    if (o) out.push({ r, o });
  }
  return out;
}
/** Сколько помещений на пяти планах потеряют убранную вещь (запись не меняется — счёт один раз). */
const removedCov = new Map<string, string>();
function removedCoverage(spec: RemovedSpec): string {
  const have = removedCov.get(spec.id);
  if (have) return have;
  let n = 0;
  let only = 0;
  let plans = 0;
  for (const w of spec.worlds) {
    for (const seed of SEEDS) {
      plans += 1;
      const l = levelOf(seed, w);
      for (const { r } of gameRooms(l, spec.rooms, spec.what.thing, spec.what.nth)) {
        n += 1;
        // Единственная такая в помещении — без неё там такой вещи не останется вовсе.
        if ((l.objects ?? []).filter((o) => o.name === spec.what.thing && roomOfObj(l, o) === r).length === 1) only += 1;
      }
    }
  }
  const text = `уберётся из ${n} ${n % 10 === 1 && n % 100 !== 11 ? 'помещения' : 'помещений'} на ${plans} планах${only > 0 ? `; в ${only} из них она единственная такая` : ''}`;
  removedCov.set(spec.id, text);
  return text;
}

function coverage(): void {
  if (!cur) return;
  const c = cur;
  const el = $('coverage');
  // Растворённое в показанном помещении (убранное, передвигаемое) на счёт по планам не влияет.
  const gone = goneBoxes.slice();
  for (const b of gone) delete b.gone;
  try {
    if (c.kind === 'thing' && c.spec.moves) {
      const m = c.spec.moves;
      let have = 0;
      let moved = 0;
      for (const w of c.spec.rule.worlds) {
        for (const seed of SEEDS) {
          const l = levelOf(seed, w);
          if (!l.placeWorld) continue;
          for (const { r, o } of gameRooms(l, c.spec.rule.rooms, m.thing, m.nth)) {
            have += 1;
            if (withGone(l, [o.id], () => moveSpot(c.spec, r, l.placeWorld!, ALL_PROPS))) moved += 1;
          }
        }
      }
      el.classList.toggle('is-bad', moved === 0);
      el.textContent =
        have === 0
          ? `на пяти планах нет помещений правила, где стоит ${m.nth + 1}-я «${ruShort(m.thing)}»`
          : moved === 0
            ? `в игре не передвинется ни в одном из ${have} таких помещений: по правилу места нет — сдвинь вещь или выбери другой край`
            : `в игре передвинется в ${moved} из ${have} таких помещений${moved < have ? '; в остальных останется, где стояла' : ''}`;
      return;
    }
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
    el.classList.toggle('is-bad', hit === 0);
    el.textContent =
      levels === 0
        ? ''
        : hit === 0
          ? `в игре не встанет ни на одном из ${levels} планов: правило нигде не выполнимо — сдвинь вещь или выбери другой край, помещения`
          : `в игре встанет на ${hit} из ${levels} планов${pieces > hit ? `, всего ${pieces} шт.` : ''}`;
  } finally {
    for (const b of gone) b.gone = true;
  }
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
/** Убранные вещи игры (коллекция removed). */
const savedRemoved = new Map<string, RemovedSpec>();

/** Записи о вещах игры поменялись: пересчитать, что здесь скрыто, и перерисовать. */
function editsChanged(): void {
  computeEdits();
  layoutEdits();
  showRoom(true);
  renderGhosts();
  dirty = true;
  syncPanel();
}

/** Положить запись в коллекцию (things — вещи и передвинутые, removed — убранные): сразу в память, потом в базу. */
async function putRecord(coll: 'things' | 'removed', spec: PlacedSpec | RemovedSpec): Promise<void> {
  if (coll === 'things') savedThings.set(spec.id, spec as PlacedSpec);
  else savedRemoved.set(spec.id, spec as RemovedSpec);
  editsChanged();
  if (!db) return;
  if (!canWrite) {
    setStatus('Можно смотреть; сохранять может только тот, у кого есть право правки.');
    return;
  }
  try {
    await db.collection(coll).doc(spec.id).set(spec as unknown as Record<string, unknown>);
  } catch {
    setStatus('Не сохранилось. Попробуй ещё раз через минуту.');
  }
}
/** Убрать запись из коллекции. */
async function dropRecord(coll: 'things' | 'removed', spec: PlacedSpec | RemovedSpec): Promise<void> {
  if (coll === 'things') savedThings.delete(spec.id);
  else savedRemoved.delete(spec.id);
  editsChanged();
  if (!db || !canWrite) return;
  try {
    await db.collection(coll).doc(spec.id).delete();
  } catch {
    setStatus('Не удалилось. Попробуй ещё раз через минуту.');
  }
}

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
  const byAt = <T extends { at?: string }>(a: T, b: T): number => String(a.at ?? '').localeCompare(String(b.at ?? ''));
  for (const s of [...savedThings.values()].sort(byAt)) add(s.moves ? (/передвин/.test(s.name) ? s.name : `${s.name} · передвинута`) : `${s.name} · ${ALL_PROPS[s.prop]?.ru.split(',')[0] ?? s.prop}`, cur?.spec.id === s.id, () => openThing(s));
  for (const f of [...savedFigs.values()].sort(byAt)) add(`${f.name} · манекен, ${MAT_RU[f.material]}`, cur?.spec.id === f.id, () => openFigure(f));
  for (const r of [...savedRemoved.values()].sort(byAt)) add(/убран/.test(r.name) ? r.name : `${r.name} · убрана`, gameSel !== 0 && removedOf(gameSel)?.spec.id === r.id, () => openRemoved(r));
  savedEl.replaceChildren(...rows);
}
/** Открыть сохранённое: в помещении, куда его пускает правило. */
function goTo(rule: PlacedSpec['rule']): void {
  if (rule.worlds.includes(world) && (rule.rooms.length === 0 || rule.rooms.includes(roomType))) return;
  const w = rule.worlds[0]!;
  const t = rule.rooms[0] ?? roomTypes(w)[0]!;
  enterRoom(w, t, 0);
}
/** Открыть запись о вещи игры: помещение правила, где эта вещь (nth-я такая) есть. */
function goToGame(worlds: readonly WorldKind[], rooms: readonly string[], thing: string, nth: number): void {
  const here = (): boolean => applies(worlds, rooms) && !!findGame(lvl, room, thing, nth);
  if (here()) return;
  for (const w of worlds) {
    for (const t of rooms.length ? rooms : roomTypes(w)) {
      const all = roomsOfType(w, t);
      for (let k = 0; k < all.length; k++) {
        const [seed, id] = all[k]!;
        const l = levelOf(seed, w);
        if (!findGame(l, l.layout!.rooms[id]!, thing, nth)) continue;
        enterRoom(w, t, k);
        return;
      }
    }
  }
  goTo({ worlds: [...worlds], rooms: [...rooms], anchor: 'wall', facing: 'room', lift: 0, count: 1 });
}
function openThing(s: PlacedSpec): void {
  pushUndo();
  if (s.moves) goToGame(s.rule.worlds, s.rule.rooms, s.moves.thing, s.moves.nth);
  else goTo(s.rule);
  const it: ThingItem = { kind: 'thing', spec: JSON.parse(JSON.stringify(s)) as PlacedSpec, at: [0, 0, 0], rot: 0 };
  // Передвинутая — туда, где её поставит игра в этом помещении; замена — на место первой такой вещи игры здесь.
  const m = s.moves ? edits.moved.find((x) => x.spec.id === s.id) : undefined;
  if (m?.spot) {
    it.at = [...m.spot.at] as Vec3;
    it.rot = m.spot.rot;
  } else placeInRoom(it);
  cur = it;
  gameSel = 0;
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
function openRemoved(r: RemovedSpec): void {
  goToGame(r.worlds, r.rooms, r.what.thing, r.what.nth);
  const o = findGame(lvl, room, r.what.thing, r.what.nth);
  if (o) selectGame(o.id);
}

async function connect(): Promise<void> {
  const claude = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
  if (!claude?.use) {
    setStatus('Расстановки и отметки не сохраняются: страница открыта не в Claude — они живут, пока она открыта. Ставить и смотреть можно и так.');
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
  renderCard();
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
      editsChanged();
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
  db.collection('removed').onSnapshot(
    (snap) => {
      if (!snap.metadata.fromCache) done();
      savedRemoved.clear();
      for (const d of snap.docs) {
        const r = d.data() as unknown as RemovedSpec | undefined;
        if (r && removedProblems(r, ALL_PROPS, FIXED).length === 0) savedRemoved.set(d.id, r);
      }
      editsChanged();
    },
    () => setStatus('Убранные вещи игры не загрузились. Обнови страницу позже.'),
  );
  db.collection('verdicts').onSnapshot(
    (snap) => {
      if (!snap.metadata.fromCache) done();
      marks.clear();
      for (const d of snap.docs) marks.set(d.id, (d.data() ?? {}) as Mark);
      renderShelf();
      renderCard();
    },
    () => setStatus('Отметки к вещам не загрузились. Обнови страницу позже.'),
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
  if (db && !canWrite) {
    setStatus('Сохранить не выйдет: право правки есть не у всех.');
    return;
  }
  const where = problems.length > 0 ? ' Здесь вещь не встанет, но в других помещениях — где правило выполнимо.' : '';
  const local = db ? '' : ' Только на этой странице: база недоступна, после перезагрузки пропадёт.';
  if (cur.kind === 'thing') {
    const spec: PlacedSpec = { ...(cur.spec as PlacedSpec), name: named.name, at: new Date().toISOString() };
    cur.spec = JSON.parse(JSON.stringify(spec)) as PlacedSpec;
    setStatus('Сохраняю…');
    await putRecord('things', spec);
    setStatus(`Сохранено: «${named.name}».${where}${local}`);
    return;
  }
  const spec: FigureSpec = { ...(cur.spec as FigureSpec), name: named.name, at: new Date().toISOString() };
  savedFigs.set(spec.id, spec);
  renderSaved();
  if (!db) {
    setStatus(`Сохранено: «${named.name}».${local}`);
    return;
  }
  setStatus('Сохраняю…');
  try {
    await db.collection('figures').doc(spec.id).set(spec as unknown as Record<string, unknown>);
    setStatus(`Сохранено: «${named.name}».`);
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
  setStatus('Перетащи вещь или манекен с полки в помещение — или потяни вещь игры.');
});

// Удаление — вторым нажатием: окна подтверждения на странице нет.
let dropArmed = 0;
$('drop').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('drop');
  if (!cur) return;
  const savedHere = cur.kind === 'thing' ? savedThings.has(cur.spec.id) : savedFigs.has(cur.spec.id);
  if (!savedHere) {
    pushUndo();
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
  if (db && !canWrite) return;
  const name = cur.spec.name;
  if (cur.kind === 'thing') {
    const spec = savedThings.get(cur.spec.id)!;
    pushUndo();
    cur = null;
    pushStep({ t: 'rec', coll: 'things', add: false, spec });
    await dropRecord('things', spec);
  } else {
    const id = cur.spec.id;
    cur = null;
    savedFigs.delete(id);
    if (db) {
      try {
        await db.collection('figures').doc(id).delete();
      } catch {
        setStatus('Не удалилось. Попробуй ещё раз через минуту.');
        return;
      }
    }
  }
  setStatus(`Удалено: «${name}».`);
  renderGhosts();
  dirty = true;
  syncPanel();
});
$('nextroom').addEventListener('click', () => enterRoom(world, roomType, roomPick + 1));

renderKinds();
enterRoom('shelter', 'kitchen', 0);
loop();
void connect();

/** Для проверок: что редактируется, где на экране точка мира, и «поставить», «убрать», «отметить» без мыши. */
const gameInfo = (o: LevelObject) => ({
  id: o.id,
  name: o.name,
  nth: nthOf(lvl, o),
  at: o.at,
  rot: o.rot,
  min: o.min,
  max: o.max,
  flat: o.flat,
  removed: !!removedOf(o.id),
  moved: !!movedOf(o.id),
  hidden: hidden.has(o.id),
});
(window as unknown as Record<string, unknown>).__constructor = {
  cur: () => cur,
  room: () => {
    // Беды места считает кадр; для проверки — сразу.
    if (dirty) {
      dirty = false;
      refresh();
      renderProblems();
    }
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
  /** Вещи игры в показанном помещении, которые партнёр может взять. */
  objects: () => (lvl.objects ?? []).filter(gameOk).map(gameInfo),
  /** Все объекты помещения (и скрытые) — с номерами, как у сборки. */
  allObjects: () => (lvl.objects ?? []).filter((o) => roomOfObj(lvl, o) === room).map(gameInfo),
  pickGame: (id: number) => {
    selectGame(id);
    const o = objById(id);
    return o ? gameInfo(o) : null;
  },
  game: () => ({ sel: gameSel, hover, box: $('gamebox').hidden ? null : $('gamebox').innerText }),
  removeGame: (id: number) => removeGame(id),
  restoreGame: (id: number) => restoreGame(id),
  /** Потянуть вещь игры в точку пола (x, z), повернуть на rot четвертей (Q/E) и отпустить. */
  moveGame: (id: number, x: number, z: number, turns = 0) => {
    const o = objById(id);
    if (!o || !gameOk(o)) return null;
    beginGameDrag(o);
    moveCurTo(x, z);
    for (let k = 0; k < Math.abs(turns); k++) turn(turns > 0 ? 1 : -1);
    drag = { what: 'thing' };
    endDrag();
    return cur;
  },
  unmove: () => cur?.kind === 'thing' && cur.spec.moves && unmove(cur.spec),
  save: () => $('save').click(),
  undo: () => undoStep(),
  card: (name: string) => {
    openCard(name, 'shelf');
    return cardName;
  },
  cardInfo: () => (cardName ? { name: cardName, kind: ITEM.get(cardName)?.kind, mark: marks.get(cardName) ?? null, text: $('card').innerText } : null),
  mark: (verdict: Verdict | null, note?: string) => cardName && saveMark(cardName, verdict ?? undefined, note ?? noteEl.value),
  shelfKind: (k: ShelfKind) => {
    shelfKind = k;
    renderKinds();
    renderShelf();
    return shelfEl.childElementCount;
  },
  edits: () => ({ removed: edits.removed.map((r) => ({ id: r.spec.id, obj: r.o.id })), moved: edits.moved.map((m) => ({ id: m.spec.id, obj: m.o.id, spot: m.spot })) }),
  saved: () => ({ things: [...savedThings.values()], removed: [...savedRemoved.values()], marks: Object.fromEntries(marks) }),
  hidden: () => [...hidden],
  coverage: () => $('coverage').textContent,
};
