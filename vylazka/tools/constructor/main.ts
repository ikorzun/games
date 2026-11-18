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
// Первым: модели полки Sand3D подключаются раньше, чем что-нибудь соберёт вещь полки.
import './sand3d_all';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { generateLayout } from '../../src/gen/layout';
import type { GenRoom, WorldKind } from '../../src/gen/layout';
import type { Vec3 } from '../../src/core/types';
import { anchorSpots, fitSpot } from '../../src/world/figure_place';
import type { AnchorSpot, PlaceWorld } from '../../src/world/figure_place';
import { clonePose, handlePoint, HANDLES, solve } from '../../src/world/figure_ik';
import type { Handle } from '../../src/world/figure_ik';
import { FIGURE_ANCHORS, FIGURE_FACINGS, FIGURE_MATERIALS, FIGURE_WORLDS, figureProblems } from '../../src/world/figures';
import type { FigureAnchor, FigureFacing, FigureMaterial, FigureSpec } from '../../src/world/figures';
import { roomOpenness } from '../../src/world/furnish';
import { withOpenMode } from '../../src/world/furniture';
import { MeshBuilder } from '../../src/world/kit';
import { buildLevel } from '../../src/world/level_build';
import type { BuiltLevel } from '../../src/world/level';
import { MAT_DEFS, hexToLinear } from '../../src/world/materials';
import { placeable, placedProblems, PLACED_OPEN, removedProblems, swapFits } from '../../src/world/placed';
import type { Aabb } from '../../src/world/colliders';
import type { LevelObject } from '../../src/world/objects';
import type { PlacedOpen, PlacedSpec, RemovedSpec } from '../../src/world/placed';
import { doorsAt, fitMoved, fitThing, gameNth, moveSpot, NEVER, placedSeed, placeThings, roomDoors, roomIndex, roomNear, rotOf, throatBox } from '../../src/world/placed_place';
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
import { isTilted, mul, tiltMat, tiltPoint, tiltPose } from '../../src/world/tilt';
import type { Tilt } from '../../src/world/tilt';
import { figure, materialFor, matcap, PAINTS } from '../matcaps/look';
import { asked, CHOICES, gameLink, ITEM, ITEMS, LABEL, MEMORY, ROOM_RU, roomsText, SHORT, sizeText, whereText, WORLD_RU } from './catalog';
import type { Item as Entry, Kind, Mark, Verdict } from './catalog';
import { cardView } from './card';
import { slotFor, slotNumber, slotOf, slotType } from '../../src/world/variants';

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
/**
 * Вариант показанного помещения (world/variants.ts; квиз 17.11, ночь: «Свой вариант на каждую»): «тип.номер» — номер
 * «другого такого». Что поставлено, передвинуто или убрано здесь, — его; в игре каждое такое помещение берёт один из вариантов.
 */
const slotNow = (): string => slotOf(roomType, roomPick);
/** Видна ли запись в показанном помещении: своего варианта или общая (на несколько типов или любые помещения). */
function mine(slot: string | undefined, rooms: readonly string[]): boolean {
  const s = slotFor(slot, rooms);
  return s === undefined || s === slotNow();
}
/** Своего варианта (не общая): такие идут первыми — перекрывают общую запись о той же вещи игры. */
const ownFirst = <T>(list: Iterable<T>, slot: (x: T) => string | undefined): T[] => [...list].sort((a, b) => Number(slot(b) === slotNow()) - Number(slot(a) === slotNow()));
/** Как назвать вариант для партнёра: «кухня 2». */
const slotLabel = (slot: string): string => `${(ROOM_RU[slotType(slot)] ?? slotType(slot)).toLowerCase()} ${slotNumber(slot) + 1}`;
/** Шаг отмены: правка (что было в работе) или запись базы (добавлена или удалена). */
type Coll3 = 'things' | 'removed' | 'figures';
type UndoStep = { t: 'cur'; json: string } | { t: 'rec'; coll: Coll3; add: boolean; spec: PlacedSpec | RemovedSpec | FigureSpec };
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
  // Выбранное остаётся в своём помещении (оно сохранено): в другое помещение переходят с пустыми руками.
  flushSave();
  cur = null;
  setReplace(0);
  try {
    localStorage.setItem('ctor.view', JSON.stringify({ world: w, type, pick: roomPick }));
  } catch {
    /* браузер не даёт хранить — откроется кухня убежища */
  }
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
/**
 * Сетка вещи из реестра игры, в её координатах (низ y = 0). Дверцы и ящики — как их поставит игра (квиз 18.11, «Как выпадет +
 * переключатель»): по записи open — закрыто или открыто всё; без неё — как выпадет: доля открытого у помещения share (как у вещей
 * игры в нём) и сид копии seed. Ни того ни другого — пример (полка, перенос): три вещи из четырёх с чем-нибудь открытым.
 */
function geometryOf(name: string, open?: PlacedOpen, share?: number, seed = 7): THREE.BufferGeometry {
  const key = `${name}|${open ?? ''}|${share ?? ''}|${seed}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const p = ALL_PROPS[name]!;
  const mb = new MeshBuilder();
  const sl = new MeshBuilder();
  try {
    withOpenMode(open, () => p.build(new Xf(mb, null, 0, 0, 0, 0, sl), seed), share);
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
  geoCache.set(key, g);
  return g;
}
const opensCache = new Map<string, boolean>();
/** Есть ли у вещи что открыть: закрытая и открытая собираются по-разному (дверцы и ящики моделей полки, world/furniture.ts). */
function canOpen(name: string): boolean {
  let v = opensCache.get(name);
  if (v === undefined) {
    const a = geometryOf(name, 'shut').getAttribute('position').array;
    const b = geometryOf(name, 'open').getAttribute('position').array;
    v = a.length !== b.length || a.some((x, i) => Math.abs(x - b[i]!) > 1e-4);
    opensCache.set(name, v);
  }
  return v;
}
/** Как оставлено показанное помещение (furnish.ts, roomOpenness): доля вещей с чем-нибудь открытым. */
const roomShare = (): number => roomOpenness(world, lvl.layout!.seed, room.id);
/** Сетка вещи партнёра в этом помещении — так, как её поставит игра: первая копия на этом плане (сборка уровня, placedSeed). */
const tiltCache = new Map<string, THREE.BufferGeometry>();
/**
 * Сетка, повёрнутая доворотом записи по всем осям (партнёр 18.11, 16:19; world/tilt.ts): та же поза, что у сборки уровня, —
 * вокруг середины собранного и на свою опору.
 */
function tilted(g: THREE.BufferGeometry, t: Tilt | undefined, mount: PropSpec['mount']): THREE.BufferGeometry {
  if (!isTilted(t)) return g;
  const key = `${g.uuid}|${t.join(',')}`;
  const hit = tiltCache.get(key);
  if (hit) return hit;
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const pose = tiltPose(pos.array as ArrayLike<number>, t, mount);
  const m = tiltMat(t);
  const P = new Float32Array(pos.count * 3);
  const N = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    P.set(tiltPoint(pose, [pos.getX(i), pos.getY(i), pos.getZ(i)]), i * 3);
    N.set(mul(m, [nrm.getX(i), nrm.getY(i), nrm.getZ(i)]), i * 3);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('color', g.getAttribute('color'));
  out.setIndex(g.getIndex());
  out.computeBoundingBox();
  out.computeBoundingSphere();
  // Запас небольшой: крутят одну вещь, по градусу за раз.
  if (tiltCache.size > 48) tiltCache.delete(tiltCache.keys().next().value!);
  tiltCache.set(key, out);
  return out;
}
const thingGeo = (s: Pick<PlacedSpec, 'id' | 'prop' | 'open' | 'tilt'>): THREE.BufferGeometry => tilted(geometryOf(s.prop, s.open, roomShare(), placedSeed(lvl.layout!.seed, 0, s.id)), s.tilt, ALL_PROPS[s.prop]!.mount);
const thingMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.05, side: THREE.DoubleSide });
/** Вещь, которую несут с полки: полупрозрачная, пока её не отпустили. */
const ghostMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, transparent: true, opacity: 0.38, depthWrite: false });
/**
 * Поставленные вещи (сохранённые записи) — как настоящие: в простом редакторе поставленное стоит, а выбранное — в рамке
 * (партнёр 18.11: «интерфейс как в простых и понятных 3D-редакторах»).
 */
const savedMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide });
/** Передвинутая вещь игры (сохранённая запись) — тоже как настоящая. */
const movedMat = savedMat;

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
    // У какого края её поставили — как у вещей: игра возьмёт ближайший такой край (FigureSpec.near).
    it.spec.near = roomNear(room, a.x, a.z);
  }
  // Правка выбранного — сразу в сохранение (через полсекунды тишины).
  if (it === cur) scheduleSave();
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
  // Край — тот, у которого её поставили (near: доли рамки помещения, как в игре), — в этом помещении это тот самый край,
  // в другом — у того же его края. Без near — край, ближе всего к середине помещения: так вещь видна целиком.
  // (Раньше сохранённое всегда вставало к середине — «конструктор не запоминает, где я поставил», партнёр 17.11.)
  const near = it.kind === 'thing' ? (it.spec.replaces ? undefined : it.spec.near) : it.spec.near;
  let a: AnchorSpot;
  if (near) {
    let best = spots[0]!;
    let bd = Infinity;
    for (const sp of spots) {
      const [u, v] = roomNear(room, sp.x, sp.z);
      const d = Math.hypot(u - near[0], v - near[1]);
      if (d < bd - 1e-9) {
        bd = d;
        best = sp;
      }
    }
    a = best;
  } else {
    const rects = cellRects(room);
    const mx = rects.reduce((s, r) => s + (r.x0 + r.x1) / 2, 0) / rects.length;
    const mz = rects.reduce((s, r) => s + (r.z0 + r.z1) / 2, 0) / rects.length;
    a = nearest(spots, mx, mz)!.a;
  }
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
  /** Её коробка на новом месте (с местом для дверец, как у сборки уровня) — соседи в неё не врастают. */
  box?: Box;
}
let edits: { removed: RemovedHere[]; moved: MovedHere[] } = { removed: [], moved: [] };
const applies = (worlds: readonly WorldKind[], rooms: readonly string[]): boolean => worlds.includes(world) && (rooms.length === 0 || rooms.includes(roomType));

/** Какие сохранённые записи о вещах игры касаются показанного помещения (как их применит сборка: сперва убранные). */
function computeEdits(): void {
  const removed: RemovedHere[] = [];
  for (const spec of ownFirst(savedRemoved.values(), (r) => slotFor(r.slot, r.rooms))) {
    if (!applies(spec.worlds, spec.rooms) || !mine(spec.slot, spec.rooms)) continue;
    const o = findGame(lvl, room, spec.what.thing, spec.what.nth);
    if (o && !removed.some((r) => r.o.id === o.id)) removed.push({ spec, o });
  }
  const moved: MovedHere[] = [];
  for (const spec of ownFirst(savedThings.values(), (t) => slotFor(t.slot, t.rule.rooms))) {
    if (!spec.moves || !applies(spec.rule.worlds, spec.rule.rooms) || !mine(spec.slot, spec.rule.rooms)) continue;
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
  // Тот же расчёт, что у сборки уровня (placed_place.ts, fitMoved): оставшаяся на своём месте занимает его для остальных.
  const fits = fitMoved(edits.moved.map((m) => ({ spec: m.spec, room, at: m.o.at, rot: m.o.rot })), pw, ALL_PROPS);
  edits.moved.forEach((m, i) => {
    const f = fits[i];
    m.spot = f ? f.spot : null;
    m.box = f?.box;
  });
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

// ───────────────────────────── инструменты: двигать и крутить ─────────────────────────────

/**
 * Что мышь делает с выбранной вещью (партнёр 18.11, 16:19: «интерфейс как в простых и понятных 3D-редакторах», «крутить
 * объекты по всем осям»): «двигать» — тянуть по полу (G), «крутить» — кольца по трём осям вокруг её середины (R). Q и E —
 * как раньше, на четверть.
 */
type Tool = 'move' | 'rotate';
let tool: Tool = 'move';
/** Точка вращения выбранной вещи — середина её габарита. Кольца крутят её; в записи — доворот (PlacedSpec.tilt). */
const pivot = new THREE.Object3D();
scene.add(pivot);
const gizmo = new TransformControls(cam, renderer.domElement);
gizmo.setMode('rotate');
gizmo.setSpace('local');
gizmo.setSize(0.85);
/** Кольца щёлкают по 15°; с Shift — свободно. */
const SNAP = THREE.MathUtils.degToRad(15);
gizmo.setRotationSnap(SNAP);
scene.add(gizmo.getHelper());
gizmo.addEventListener('dragging-changed', (e) => {
  const on = (e as unknown as { value: boolean }).value;
  controls.enabled = !on;
  if (on) pushUndo();
  else scheduleSave();
});
gizmo.addEventListener('objectChange', () => onGizmo());
/** Кольца повернули точку вращения — доворот выбранной вещи; у манекена — только вокруг вертикали. */
function onGizmo(): void {
  if (!cur) return;
  if (cur.kind === 'thing') {
    const base = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (cur.rot * Math.PI) / 2);
    const e = new THREE.Euler().setFromQuaternion(base.invert().multiply(pivot.quaternion), 'XYZ');
    const t = [e.x, e.y, e.z].map((v) => Math.round(THREE.MathUtils.radToDeg(v) * 2) / 2 + 0) as [number, number, number];
    if (isTilted(t)) cur.spec.tilt = t;
    else delete cur.spec.tilt;
  } else {
    cur.yaw = new THREE.Euler().setFromQuaternion(pivot.quaternion, 'YXZ').y;
    derive(cur);
  }
  dirty = true;
  syncPanel();
}
/** Поставить точку вращения на выбранную вещь (пока кольца не тянут — тогда её ведут они). */
function placePivot(geo: THREE.BufferGeometry | null): void {
  if (!cur || gizmo.dragging) return;
  if (cur.kind === 'thing') {
    const bb = (geo ?? thingGeo(cur.spec)).boundingBox!;
    const c = bb.getCenter(new THREE.Vector3());
    const yaw = (cur.rot * Math.PI) / 2;
    pivot.position.set(cur.at[0], cur.at[1], cur.at[2]).add(c.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
    const t = cur.spec.tilt ?? [0, 0, 0];
    const qt = new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(t[0]), THREE.MathUtils.degToRad(t[1]), THREE.MathUtils.degToRad(t[2]), 'XYZ'));
    pivot.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(qt);
  } else {
    pivot.position.set(cur.at[0], cur.at[1] + 0.9, cur.at[2]);
    pivot.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), cur.yaw);
  }
}
/** Кольца видны, когда выбран инструмент «крутить» и есть что крутить. */
function syncGizmo(): void {
  if (tool === 'rotate' && cur) {
    if (gizmo.object !== pivot) gizmo.attach(pivot);
    const full = cur.kind === 'thing';
    gizmo.showX = full;
    gizmo.showZ = full;
  } else if (gizmo.object) gizmo.detach();
}
function setTool(t: Tool): void {
  tool = t;
  for (const [id, k] of [['tool-move', 'move'], ['tool-rotate', 'rotate']] as const) $(id).classList.toggle('is-on', tool === k);
  dirty = true;
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
  // Выбор один, как в редакторе: выбранная раньше вещь партнёра отпускается (она сохранена).
  if (cur) {
    flushSave();
    cur = null;
    renderGhosts();
  }
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
  const spec: RemovedSpec = { id: `rm_${stamp()}`, name: `${ruShort(o.name)} — убрана`.slice(0, 80), what: { thing: o.name, nth: nthOf(lvl, o) }, worlds: [world], rooms: [roomType], slot: slotNow(), at: new Date().toISOString() };
  const bad = removedProblems(spec, ALL_PROPS, FIXED);
  if (bad.length > 0) {
    setStatus(`Не убрано: ${bad.join('; ')}.`);
    return null;
  }
  gameSel = id;
  pushStep({ t: 'rec', coll: 'removed', add: true, spec });
  void putRecord('removed', spec);
  setStatus(`Убрана: ${spec.what.nth + 1}-я «${ruShort(o.name)}» — в варианте «${slotLabel(spec.slot!)}» (${WORLD_RU[world]}). ⌘Z или «Вернуть» — отменить.${localNote()}`);
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
  flushSave();
  pushUndo();
  const nth = nthOf(lvl, o);
  const it: ThingItem = {
    kind: 'thing',
    spec: { id: `pl_${stamp()}`, name: `${ruShort(o.name)} — передвинута`.slice(0, 80), prop: o.name, rule: { worlds: [world], rooms: [roomType], anchor: 'wall', facing: 'room', lift: 0, count: 1 }, turn: 0, offset: [0, 0], moves: { thing: o.name, nth }, slot: slotNow() },
    at: [o.at[0], o.at[1], o.at[2]],
    rot: o.rot,
  };
  cur = it;
  derive(it);
  gameSel = 0;
  hover = 0;
  followCard(o.name);
  pushStep({ t: 'rec', coll: 'things', add: true, spec: it.spec });
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
  syncGizmo();
  if (!cur) {
    problems = [];
    return;
  }
  if (cur.kind === 'thing') {
    const chk = curCheck(cur);
    // Как выпадет, а открытым дверцам здесь тесно — в игре эта копия закрыта: так её и показать.
    const geo = thingGeo(!cur.spec.replaces && chk.open === 'shut' ? { ...cur.spec, open: 'shut' } : cur.spec);
    placePivot(geo);
    const mesh = new THREE.Mesh(geo, thingMat);
    mesh.position.set(cur.at[0], cur.at[1], cur.at[2]);
    mesh.rotation.y = (cur.rot * Math.PI) / 2;
    mesh.userData.pick = true;
    holder.add(mesh);
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
    placePivot(null);
    arrow.position.set(cur.at[0], floorY + 0.02, cur.at[2]);
    arrow.setDirection(new THREE.Vector3(Math.sin(cur.yaw), 0, Math.cos(cur.yaw)));
    arrow.visible = true;
    problems = [];
  }
}
/**
 * Проверка места вещи — как у сборки уровня (placed_place.ts, doorsAt): преграды, проходы, потолок и дверцы — у «открыто» место
 * с вылетом, у «как выпадет» открытым должно хватить места впереди, иначе здесь она закрыта (open: 'shut'). Соседи — и
 * передвинутые вещи игры здесь (сохранённые): в них новая вещь врастать не должна.
 */
function curCheck(c: ThingItem): ReturnType<typeof doorsAt> {
  const p = ALL_PROPS[c.spec.prop]!;
  const cell = cellOf(c.at[0], c.at[2]);
  const others = edits.moved.filter((m) => m.box && m.spec.id !== c.spec.id).map((m) => m.box!);
  return doorsAt(c.spec, p, c.at, c.rot, room, { floor: floorY, ceil: ceilY, pit: cell?.noFloor === true, tier: room.tier }, pw, others);
}
function cellOf(x: number, z: number): { noFloor?: boolean } | undefined {
  return pw.shells[room.tier]!.get(Math.round(x / CELL), Math.round(z / CELL));
}

// Призраки: уже сохранённые вещи, правило которых пускает их в это помещение; передвинутые вещи игры — там, где их
// поставит игра; убранные — бледные красные рамки на их месте.
const ghosts = new THREE.Group();
/** Манекен-призрак: светлый полупрозрачный, сетка — по позе (запоминается, пока поза та же). */
const figGhostMat = new THREE.MeshStandardMaterial({ color: 0xd9cbb6, roughness: 0.85 });
const figGhostCache = new Map<string, THREE.BufferGeometry>();
function figGhostGeo(f: FigureSpec): THREE.BufferGeometry {
  const key = `${f.id}:${JSON.stringify(f.pose)}`;
  let g = figGhostCache.get(key);
  if (!g) {
    for (const [k, old] of figGhostCache) if (k.startsWith(`${f.id}:`)) {
      old.dispose();
      figGhostCache.delete(k);
    }
    g = figure(f.pose, 2);
    figGhostCache.set(key, g);
  }
  return g;
}
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
    if (!s.rule.worlds.includes(world) || (s.rule.rooms.length > 0 && !s.rule.rooms.includes(roomType)) || !mine(s.slot, s.rule.rooms)) continue;
    const p = ALL_PROPS[s.prop];
    if (!p) continue;
    const it: ThingItem = { kind: 'thing', spec: JSON.parse(JSON.stringify(s)) as PlacedSpec, at: [0, 0, 0], rot: 0 };
    settle(it);
    const mesh = new THREE.Mesh(thingGeo(s), savedMat);
    mesh.position.set(it.at[0], it.at[1], it.at[2]);
    mesh.rotation.y = (it.rot * Math.PI) / 2;
    mesh.userData.ghost = s.id;
    ghosts.add(mesh);
  }
  for (const m of edits.moved) {
    if (!m.spot || (cur && cur.kind === 'thing' && cur.spec.id === m.spec.id)) continue;
    // Передвинутая — с дверцами по записи (или закрытая, если открытым тесно); как выпадет — с долей помещения (сид её места в
    // игре здесь не известен — пример).
    const mesh = new THREE.Mesh(tilted(geometryOf(m.spec.prop, m.spot.open, roomShare()), m.spec.tilt, ALL_PROPS[m.spec.prop]!.mount), movedMat);
    mesh.position.set(m.spot.at[0], m.spot.at[1], m.spot.at[2]);
    mesh.rotation.y = (m.spot.rot * Math.PI) / 2;
    mesh.userData.ghost = m.spec.id;
    ghosts.add(mesh);
  }
  // Сохранённые манекены — тоже призраками: их видно в каждом помещении, куда их пускает правило, и их можно выбрать
  // щелчком (раньше вне правки их не было видно вовсе — ни выделить, ни удалить).
  for (const f of savedFigs.values()) {
    if (cur && cur.kind === 'figure' && cur.spec.id === f.id) continue;
    if (!f.rule.worlds.includes(world) || (f.rule.rooms.length > 0 && !f.rule.rooms.includes(roomType)) || !mine(f.slot, f.rule.rooms)) continue;
    const it: FigItem = { kind: 'figure', spec: JSON.parse(JSON.stringify(f)) as FigureSpec, at: [0, 0, 0], yaw: 0 };
    settle(it);
    const mesh = new THREE.Mesh(figGhostGeo(f), figGhostMat);
    mesh.position.set(it.at[0], it.at[1], it.at[2]);
    mesh.rotation.y = it.yaw;
    mesh.userData.ghost = f.id;
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
    // Кольца поворота под курсором — их ведёт TransformControls; вид при этом не крутится.
    if (gizmo.axis) {
      controls.enabled = false;
      return;
    }
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
    if (cur?.kind === 'thing' && tool === 'move') {
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
      const id = g.object.userData.ghost as string;
      const s = savedThings.get(id);
      const f = savedFigs.get(id);
      if (s || f) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (s) openThing(s);
        else if (f) openFigure(f);
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
    // Отпущенная вещь добавляется (партнёр 18.11: «добавлять новые вещи и людей, а не заменять их»); заменить — с ⌥ (Alt):
    // тогда над вещью игры её рамка, и отпущенная встанет вместо неё.
    const t = 'prop' in carry && e.altKey ? swapTarget(e, carry.prop) : null;
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
  scheduleSave();
  if (was.what === 'thing' && cur?.kind === 'thing' && cur.spec.moves) setStatus(`Передвинута: ${ruShort(cur.spec.moves.thing)}.`);
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
    const t = 'prop' in what && e.altKey ? swapTarget(e, what.prop) : null;
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
  // Щелчок в пустоту (не поворот вида): выделение снимается, вещь остаётся, где стоит, — она уже сохранена (партнёр 18.11:
  // «вещь остается на месте, а выделение с нее снимается, чтобы выбрать другую»).
  if (blank && Math.hypot(e.clientX - blank.x, e.clientY - blank.y) < 5) deselect();
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

/**
 * Стрелки (партнёр 17.11: «добавь возможность перемещать объекты в редакторе стрелками»): сдвиг по полу по оси мира, ближайшей
 * к взгляду камеры: ↑ — от себя, ↓ — к себе, ← → — вбок. Шаг 10 см, с Shift — 50 см, с Alt — 2 см. Вещь, что спиной к стене,
 * по стене скользит и в стену не уходит, а стрелкой от стены отходит (прилипание при перетаскивании её бы не отпускало).
 * Выбранная вещь игры от стрелки становится передвинутой. Серия нажатий подряд — один шаг отмены.
 */
let nudgeAt = 0;
function nudge(ax: number, az: number, e: { shiftKey: boolean; altKey: boolean }): boolean {
  // Выбрана вещь игры, но ещё не тронута — стрелка начинает её передвигать (как если бы её потянули).
  if (gameSel) {
    const o = objById(gameSel);
    if (!o || !gameOk(o)) return false;
    beginGameDrag(o);
    nudgeAt = performance.now();
  } else if (!cur) return false;
  else if (performance.now() - nudgeAt > 700) pushUndo();
  nudgeAt = performance.now();
  const it = cur!;
  const step = e.shiftKey ? 0.5 : e.altKey ? 0.02 : 0.1;
  const f = cam.getWorldDirection(new THREE.Vector3());
  const fwd: [number, number] = Math.abs(f.x) > Math.abs(f.z) ? [Math.sign(f.x), 0] : [0, Math.sign(f.z)];
  const right: [number, number] = [-fwd[1], fwd[0]];
  const dx = (az * fwd[0] + ax * right[0]) * step;
  const dz = (az * fwd[1] + ax * right[1]) * step;
  const x = it.at[0] + dx;
  const z = it.at[2] + dz;
  if (it.kind === 'thing') {
    const p = ALL_PROPS[it.spec.prop]!;
    const wall = p.mount === 'free' ? null : nearest(spotsOf('wall'), x, z);
    // От стены в комнату — без прилипания; вдоль стены и в стену — прилипает (вплотную, не сквозь).
    const away = wall !== null && dx * Math.sin(wall.a.phi) + dz * Math.cos(wall.a.phi) > 1e-6;
    if (away) {
      it.at = [Math.round(x * 100) / 100, it.at[1], Math.round(z * 100) / 100];
      derive(it);
    } else moveCurTo(x, z);
  } else {
    it.at = [Math.round(x * 100) / 100, it.at[1], Math.round(z * 100) / 100];
    derive(it);
  }
  dirty = true;
  syncPanel();
  return true;
}

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
  window.clearTimeout(saveTimer);
  saveTimer = 0;
  if (s.t === 'cur') {
    cur = JSON.parse(s.json) as Item | null;
    if (cur) {
      placeIfElsewhere(cur);
      // Вернуть и в базе: выбранное там уже сохранено в новом виде.
      if (savedThings.has(cur.spec.id) || savedFigs.has(cur.spec.id)) scheduleSave();
    }
  } else if (s.add) {
    if (cur?.spec.id === s.spec.id) cur = null;
    void dropRecord(s.coll, s.spec);
  } else void putRecord(s.coll, s.spec);
  renderGhosts();
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
  if (e.code === 'Delete' || e.code === 'Backspace') {
    if (cur || gameSel) {
      e.preventDefault();
      void deleteSelected();
    }
    return;
  }
  if (e.code === 'KeyQ') turn(-1);
  else if (e.code === 'KeyE') turn(1);
  else if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    const ax = e.code === 'ArrowRight' ? 1 : e.code === 'ArrowLeft' ? -1 : 0;
    const az = e.code === 'ArrowUp' ? 1 : e.code === 'ArrowDown' ? -1 : 0;
    // Сдвинули — странице не прокручиваться.
    if (nudge(ax, az, e)) e.preventDefault();
  }
  else if (e.code === 'Escape') {
    if (carry) {
      carry = null;
      carryMesh.visible = false;
      document.body.classList.remove('is-carrying');
    } else if (replaceFor) setReplace(0);
    else deselect();
  } else if (e.code === 'KeyG') setTool('move');
  else if (e.code === 'KeyR') setTool('rotate');
  else if (e.code === 'KeyD' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    duplicate();
  }
  if (e.key === 'Shift') gizmo.setRotationSnap(null);
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') gizmo.setRotationSnap(SNAP);
});

/** Подпись замены: «диван вместо кушетки»; одинаковые названия («картотечный шкаф» вместо «картотечного шкафа») — «новый вместо прежнего». */
function swapName(to: string, from: string): string {
  const a = to.split(',')[0]!.slice(0, 40);
  const b = from.split(',')[0]!.slice(0, 30);
  return a === b ? `${a}: новый вместо прежнего` : `${a} вместо ${b}`;
}

/** Вещь с полки — вместо вещи игры (замена): там же и так же повёрнута, правило — «вместо такой-то». */
function dropSwap(prop: string, o: LevelObject): void {
  flushSave();
  pushUndo();
  const p = ALL_PROPS[prop]!;
  const from = ALL_PROPS[o.name]!;
  // Разные опоры — сдвиг на полглубины вдоль «лица», как при сборке уровня (world/props_all.ts, swapXf).
  const f: [number, number] = [[0, 1], [1, 0], [0, -1], [-1, 0]][o.rot] as [number, number];
  const k = from.mount === 'floor' && p.mount === 'free' ? p.d / 2 : from.mount === 'free' && p.mount === 'floor' ? -from.d / 2 : 0;
  const it: ThingItem = {
    kind: 'thing',
    spec: { id: `pl_${stamp()}`, name: swapName(p.ru, from.ru), prop, rule: { worlds: [world], rooms: [roomType], anchor: 'wall', facing: 'room', lift: 0, count: 1 }, turn: 0, offset: [0, 0], replaces: o.name, slot: slotNow() },
    at: [o.at[0] + f[0] * k, o.at[1], o.at[2] + f[1] * k],
    rot: o.rot,
  };
  cur = it;
  derive(it);
  it.spec.replaces = o.name;
  it.obj = o.id;
  gameSel = 0;
  setStatus(`Вместо «${from.ru.split(',')[0]}» — «${p.ru.split(',')[0]}».`);
  pushStep({ t: 'rec', coll: 'things', add: true, spec: it.spec });
  void saveCur();
  dirty = true;
  syncPanel();
}

/** Новая вещь (фигура) там, где её отпустили. */
function drop(what: { prop: string } | { figure: true }, x: number, z: number): void {
  // Прежняя вещь уже стоит и сохранена — новая добавляется рядом с ней, а не вместо (партнёр 18.11).
  flushSave();
  pushUndo();
  if ('prop' in what) {
    const p = ALL_PROPS[what.prop]!;
    const s = snapToWall(p, x, z, 0);
    const lift = p.mount === 'wall' ? (p.y ?? 1.2) : 0;
    const it: ThingItem = {
      kind: 'thing',
      spec: { id: `pl_${stamp()}`, name: p.ru.split(',')[0]!.slice(0, 60), prop: what.prop, rule: { worlds: [world], rooms: [roomType], anchor: 'wall', facing: 'room', lift, count: 1 }, turn: 0, offset: [0, 0], slot: slotNow() },
      at: [s.x, floorY + lift, s.z],
      rot: s.rot,
    };
    // Не у стены — лицом в комнату (от ближайшего проёма), как стоят вещи у края «посреди».
    if (s.x === x && s.z === z) it.rot = rotOf(anchorAt(x, z, lift, false).a.phi);
    cur = it;
    derive(it);
    setStatus(`Поставлено: ${ruShort(what.prop)}.`);
  } else {
    const it: FigItem = {
      kind: 'figure',
      spec: { id: `fig_${stamp()}`, name: '', pose: clonePose(POSES.stand as Pose), material: 'wood', rule: { worlds: [world], rooms: [roomType], anchor: 'middle', facing: 'room', lift: 0, count: 1 }, yaw: 0, offset: [0, 0], slot: slotNow() },
      at: [x, floorY, z],
      yaw: anchorAt(x, z, 0, false).a.phi,
    };
    cur = it;
    derive(it);
    setStatus('Человек поставлен: шарики — гнуть руки и ноги, таз с ⌥ — поднять.');
  }
  pushStep({ t: 'rec', coll: cur.kind === 'thing' ? 'things' : 'figures', add: true, spec: cur.spec });
  void saveCur();
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
type ShelfKind = 'all' | Exclude<Kind, 'other'> | 'unmarked' | 'catalog' | 'requests';
/** Конструктор на своём компьютере (квиз 18.11: «Программа на MacBook», tools/constructor/serve.mjs): ставит сборка. */
declare const __LOCAL__: boolean;
const LOCAL = typeof __LOCAL__ !== 'undefined' && __LOCAL__;
const KINDS: readonly [ShelfKind, string, string][] = [
  ...(LOCAL
    ? ([
        ['catalog', 'Каталог', 'все вещи каталога Sand3D (около 106 тыс.): поиск по смыслу, можно по-русски; понравилась — в заявку'],
        ['requests', 'Заявки', 'вещи каталога, которые основная модель доведёт до игры: лицензия, марки, масштаб, материалы'],
      ] as [ShelfKind, string, string][])
    : []),
  ['all', 'Все', 'вся опись игры'],
  ['furniture', 'Мебель', 'на чём сидят, лежат, за чем работают и куда кладут — и стоит на уровнях'],
  ['memory', 'Вещи памяти', 'вещи, которые ищут'],
  ['people', 'Люди', 'позы манекена'],
  ['pair', 'Пары', 'вещь из набора KayKit и её замена'],
  ['s3', 'Sand3D', 'настоящая мебель из каталога Sand3D: тяни в помещение — встанет рядом, на вещь игры — вместо неё'],
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
  const label = (k: ShelfKind): string => (k === 'requests' && requests.size > 0 ? `Заявки ${requests.size}` : KINDS.find((x) => x[0] === k)![1]);
  chips($('kinds'), KINDS.map((k) => k[0]), label, (k) => k === shelfKind, (k) => {
    if (k === 'catalog' && shelfKind !== 'catalog') {
      catOffset = 0;
      catQuery = '';
    }
    shelfKind = k;
    searchEl.placeholder = k === 'catalog' ? 'Каталог: стул, старое радио, чемодан…' : 'Найти: стул, часы, чемодан…';
    renderKinds();
    renderShelf();
  });
  for (const b of $('kinds').querySelectorAll('button')) b.title = KINDS.find((x) => x[1] === b.textContent)?.[2] ?? '';
}
function renderShelf(): void {
  if (shelfKind === 'catalog') return void renderCatalog();
  if (shelfKind === 'requests') return renderRequests();
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
    if (x.kind === 's3') tags.append(tag('Sand3D', 's3'));
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
  // «Заменить…» у вещи игры: щелчок по вещи полки ставит её вместо той.
  if (replaceFor && name) {
    const o = objById(replaceFor);
    setReplace(0);
    if (o && swappable(name).some((x) => x.id === o.id)) dropSwap(name, o);
    else setStatus(`«${ruShort(name)}» на это место не встанет: другая опора или слишком большая.`);
    return;
  }
  if (name) openCard(name, 'shelf');
  else setStatus('Человека — тяни с полки в помещение.');
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
searchEl.addEventListener('input', () => {
  // Каталог ищет на сервере — не на каждую букву.
  if (shelfKind === 'catalog') {
    window.clearTimeout(catTimer);
    catTimer = window.setTimeout(() => {
      catOffset = 0;
      void renderCatalog();
    }, 450);
  } else renderShelf();
});

// ───────────────────────────── каталог Sand3D и заявки (только на своём компьютере) ─────────────────────────────

/**
 * Каталог (квиз 18.11: «Ищу везде, беру по заявке»): поиск по всем вещам каталога Sand3D через serve.mjs — по смыслу,
 * можно по-русски; картинка, название, вид. Понравилась — «В заявку»: основная модель доведёт её до игры (лицензия, марки и
 * надписи, масштаб, материалы), и она появится на полке. В игру идёт только то, что поставлено.
 */
interface CatItem {
  id: string;
  name: string;
  family: string;
  dataset: string;
  joints?: number;
}
interface RequestRow {
  id: string;
  name: string;
  family: string;
  dataset: string;
  at: string;
  note?: string;
}
const requests = new Map<string, RequestRow>();
/**
 * Русские слова запроса — по-английски: каталог ищет по смыслу и понимает русский, но хуже (на «старый чемодан» он отдаёт
 * автобусы и самолёты — «путешествие», а на «old suitcase» — чемоданы). Основа слова → английское; чего нет — как есть.
 */
const RU_EN: readonly (readonly [string, string])[] = (
  [
    ['кухонн', 'kitchen'], ['стар', 'old'], ['древн', 'ancient'], ['деревян', 'wooden'], ['желез', 'iron'], ['металл', 'metal'], ['стеклян', 'glass'],
    ['пластиков', 'plastic'], ['мягк', 'soft'], ['детск', 'child'], ['офисн', 'office'], ['больнич', 'hospital'], ['медицин', 'medical'], ['советск', 'soviet'],
    ['ржав', 'rusty'], ['сломан', 'broken'], ['чемодан', 'suitcase'], ['сумк', 'bag'], ['рюкзак', 'backpack'], ['коробк', 'box'], ['ящик', 'crate'],
    ['сундук', 'chest'], ['ведр', 'bucket'], ['бутыл', 'bottle'], ['банк', 'jar'], ['кастрюл', 'pot'], ['сковород', 'frying pan'], ['чайник', 'kettle'],
    ['чашк', 'cup'], ['кружк', 'mug'], ['тарелк', 'plate'], ['ложк', 'spoon'], ['вилк', 'fork'], ['нож', 'knife'], ['стул', 'chair'], ['табурет', 'stool'],
    ['кресл', 'armchair'], ['диван', 'sofa'], ['скамь', 'bench'], ['лавк', 'bench'], ['столик', 'small table'], ['стол', 'table'], ['парт', 'school desk'],
    ['кроват', 'bed'], ['нары', 'bunk bed'], ['шкафчик', 'locker'], ['шкаф', 'cabinet'], ['гардероб', 'wardrobe'], ['комод', 'dresser'], ['тумб', 'nightstand'],
    ['полк', 'shelf'], ['стеллаж', 'shelving'], ['вешалк', 'coat rack'], ['зеркал', 'mirror'], ['ковёр', 'rug'], ['ковр', 'rug'], ['штор', 'curtain'],
    ['картин', 'painting'], ['рамк', 'picture frame'], ['фотограф', 'photo frame'], ['люстр', 'chandelier'], ['светильник', 'lamp'], ['ламп', 'lamp'],
    ['фонар', 'lantern'], ['свеч', 'candle'], ['будильник', 'alarm clock'], ['часы', 'clock'], ['радио', 'radio'], ['приёмник', 'radio'], ['приемник', 'radio'],
    ['телевизор', 'television'], ['телефон', 'telephone'], ['магнитофон', 'tape recorder'], ['проигрывател', 'record player'], ['пластинк', 'vinyl record'],
    ['компьютер', 'computer'], ['монитор', 'monitor'], ['клавиатур', 'keyboard'], ['печатн', 'typewriter'], ['холодильник', 'refrigerator'], ['плит', 'stove'],
    ['печ', 'stove'], ['раковин', 'sink'], ['ванн', 'bathtub'], ['унитаз', 'toilet'], ['душ', 'shower'], ['игрушк', 'toy'], ['кукл', 'doll'], ['мишк', 'teddy bear'],
    ['мяч', 'ball'], ['велосипед', 'bicycle'], ['коляск', 'pram'], ['качел', 'swing'], ['лошадк', 'rocking horse'], ['сейф', 'safe'], ['двер', 'door'],
    ['окн', 'window'], ['батаре', 'radiator'], ['вентилятор', 'fan'], ['огнетушител', 'fire extinguisher'], ['противогаз', 'gas mask'], ['носилк', 'stretcher'],
    ['каталк', 'gurney'], ['пальто', 'coat'], ['шляп', 'hat'], ['обув', 'shoes'], ['тапк', 'slippers'], ['тапоч', 'slippers'], ['ботин', 'boots'], ['книг', 'book'],
    ['газет', 'newspaper'], ['папк', 'folder'], ['документ', 'documents'], ['письм', 'letter'], ['открытк', 'postcard'], ['цвет', 'flower'], ['растени', 'plant'],
    ['горшк', 'flower pot'], ['горшок', 'flower pot'], ['дерев', 'tree'], ['торгов', 'vending'], ['автомат', 'machine'], ['кулер', 'water cooler'], ['урн', 'trash can'],
    ['мусор', 'trash'], ['табличк', 'sign'], ['знак', 'sign'], ['указател', 'signpost'], ['касс', 'cash register'], ['турникет', 'turnstile'], ['билет', 'ticket'],
  ] as const
)
  .slice()
  .sort((a, b) => b[0].length - a[0].length);
function toEnglish(q: string): string {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const low = w.toLowerCase();
      return RU_EN.find(([ru]) => low.startsWith(ru))?.[1] ?? w;
    })
    .join(' ');
}
let catTimer = 0;
let catOffset = 0;
let catTotal = 0;
let catItems: CatItem[] = [];
let catQuery = '';
function catRow(i: CatItem, onReq: () => void): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'shelf__item shelf__item--cat';
  const img = document.createElement('img');
  img.className = 'shelf__thumb';
  img.alt = '';
  img.loading = 'lazy';
  img.width = 56;
  img.height = 56;
  img.src = `api/catalog/render/${encodeURIComponent(i.id)}.png`;
  const text = document.createElement('span');
  text.className = 'shelf__text';
  const title = document.createElement('b');
  title.textContent = i.name;
  const small = document.createElement('small');
  small.textContent = `${i.family} · ${i.dataset}${i.joints ? ' · двигается' : ''}`;
  const b = document.createElement('button');
  b.type = 'button';
  const have = requests.has(i.id);
  b.className = `btn btn--small${have ? ' is-on' : ''}`;
  b.textContent = have ? '✓ в заявке' : 'В заявку';
  b.addEventListener('click', onReq);
  text.append(title, small, b);
  row.append(img, text);
  // Картинка крупно — по наведению: в 56 px вещь не разглядеть.
  row.title = `${i.name} — ${i.family}`;
  img.addEventListener('click', () => window.open(img.src, '_blank'));
  return row;
}
async function toggleRequest(i: CatItem): Promise<void> {
  if (!db) return;
  if (requests.has(i.id)) {
    requests.delete(i.id);
    await db.collection('requests').doc(i.id).delete();
    setStatus(`Из заявки убрано: ${i.name}.`);
  } else {
    const row: RequestRow = { id: i.id, name: i.name, family: i.family, dataset: i.dataset, at: new Date().toISOString() };
    requests.set(i.id, row);
    await db.collection('requests').doc(i.id).set(row as unknown as Record<string, unknown>);
    setStatus(`В заявке: ${i.name}. Залить — npm run constructor:push.`);
  }
  renderShelf();
  renderKinds();
}
async function renderCatalog(): Promise<void> {
  const q = searchEl.value.trim();
  if (!q) {
    const p = Object.assign(document.createElement('p'), { className: 'count', textContent: 'Напиши, что ищешь: «стул», «старое радио», «чемодан» — поиск по смыслу среди 106 тыс. вещей.' });
    shelfEl.replaceChildren(p);
    $('shelfcount').textContent = 'каталог Sand3D';
    return;
  }
  if (q !== catQuery || catOffset === 0) {
    catQuery = q;
    $('shelfcount').textContent = 'ищу…';
    try {
      const r = await fetch(`api/catalog/search?${new URLSearchParams({ q: toEnglish(q), offset: String(catOffset), limit: '40' })}`);
      const d = (await r.json()) as { total?: number; items?: CatItem[]; error?: string };
      if (!r.ok || !d.items) throw new Error(d.error ?? String(r.status));
      catTotal = d.total ?? 0;
      catItems = catOffset === 0 ? d.items : [...catItems, ...d.items];
    } catch (e) {
      shelfEl.replaceChildren(Object.assign(document.createElement('p'), { className: 'count', textContent: `Каталог не ответил: ${String((e as Error).message ?? e)}. Нужен интернет; спейс иногда просыпается минуту.` }));
      $('shelfcount').textContent = 'каталог Sand3D';
      return;
    }
  }
  const rows: HTMLElement[] = catItems.map((i) => catRow(i, () => void toggleRequest(i)));
  if (catItems.length < catTotal) {
    const more = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn--small', textContent: 'ещё' });
    more.addEventListener('click', () => {
      catOffset = catItems.length;
      catQuery = '';
      void renderCatalog();
    });
    rows.push(more);
  }
  // Что ушло в каталог, если запрос переведён: видно, почему нашлось то, что нашлось.
  const en = toEnglish(q);
  if (en !== q) rows.unshift(Object.assign(document.createElement('p'), { className: 'count', textContent: `ищу: ${en}` }));
  shelfEl.replaceChildren(...rows);
  $('shelfcount').textContent = `${catItems.length} из ${catTotal.toLocaleString('ru-RU')}`;
}
function renderRequests(): void {
  const list = [...requests.values()].sort((a, b) => a.at.localeCompare(b.at));
  const rows: HTMLElement[] = list.map((r) => catRow(r, () => void toggleRequest(r)));
  if (rows.length === 0) rows.push(Object.assign(document.createElement('p'), { className: 'count', textContent: 'Заявок нет: найди вещь во вкладке «Каталог» и нажми «В заявку».' }));
  shelfEl.replaceChildren(...rows);
  $('shelfcount').textContent = `заявок: ${list.length}`;
}

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
  $('c-ask').textContent = i.kind === 'memory' ? 'Насколько проработать' : i.kind === 'pair' ? 'Менять или оставить' : i.kind === 'people' ? 'Поза' : i.kind === 's3' ? 'Годится ли игре' : 'Что с ней делать';
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
/** Переключатель дверец в карточке: как выпадет (поля нет), закрыто, открыто. */
type DoorsChip = PlacedOpen | 'roll';
const DOORS: readonly DoorsChip[] = ['roll', ...PLACED_OPEN];
const DOORS_RU: Record<DoorsChip, string> = { roll: 'как выпадет', shut: 'закрыто', open: 'открыто' };
/** Что значит выбранное — с тем, как оставлено показанное помещение (у «как выпадет»). */
function doorsNote(open: PlacedOpen | undefined, cramped: boolean): string {
  if (open === 'shut') return 'Закрыто всё — в любом помещении, у каждой копии.';
  if (open === 'open') return 'Открыто всё: дверцы распахнуты, ящики выдвинуты. Место ей ищется с вылетом дверец — распахнутая не перекроет проход и не войдёт в соседа.';
  if (cramped) return 'Как выпадет — но здесь открытым дверцам впереди тесно (проход, сосед или стена): в этой точке она закрыта, как вещи игры у дверей. Где просторнее — как у вещей игры рядом.';
  const share = roomShare();
  const here = share >= 0.9 ? 'из этого помещения уходили второпях — открыто почти всё' : share > 0 ? 'это помещение как обычно — открыто кое-что' : 'это помещение прибрано — закрыто всё';
  return `Как у вещей игры рядом: ${here}. Помещения в игре оставлены по-разному, и у каждой копии по-своему — здесь показана одна.`;
}
const change = (fn: () => void): void => {
  pushUndo();
  fn();
  dirty = true;
  scheduleSave();
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
  scheduleSave();
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
$('greplace').addEventListener('click', () => {
  if (gameSel) setReplace(gameSel);
});
$('tool-move').addEventListener('click', () => setTool('move'));
$('tool-rotate').addEventListener('click', () => setTool('rotate'));
$('tool-undo').addEventListener('click', () => void undoStep());
$('tool-dup').addEventListener('click', () => duplicate());
$('tool-help').addEventListener('click', () => $('help').toggleAttribute('hidden'));
for (const [id, k] of [['tilt-x', 0], ['tilt-y', 1], ['tilt-z', 2]] as const) {
  $<HTMLInputElement>(id).addEventListener('change', (e) => {
    if (cur?.kind !== 'thing') return;
    const c = cur;
    const v = Math.max(-180, Math.min(180, Number((e.target as HTMLInputElement).value) || 0));
    change(() => {
      const t = [...(c.spec.tilt ?? [0, 0, 0])] as [number, number, number];
      t[k] = v;
      if (isTilted(t)) c.spec.tilt = t;
      else delete c.spec.tilt;
    });
  });
}
$('tilt-0').addEventListener('click', () => {
  if (cur?.kind !== 'thing' || !cur.spec.tilt) return;
  const c = cur;
  change(() => delete c.spec.tilt);
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
  const own = [...savedThings.values()].some((t) => slotFor(t.slot, t.rule.rooms) === slotNow()) || [...savedFigs.values()].some((f) => slotFor(f.slot, f.rule.rooms) === slotNow()) || [...savedRemoved.values()].some((r) => slotFor(r.slot, r.rooms) === slotNow());
  $('roomnum').textContent = `${roomPick + 1} из ${total}${own ? ' · свой вариант' : ''}`;
  syncGame();
  const has = !!cur;
  $('rule').toggleAttribute('hidden', !has);
  $('figbox').toggleAttribute('hidden', cur?.kind !== 'figure');
  $('turns').toggleAttribute('hidden', !has);
  $('curcard').toggleAttribute('hidden', cur?.kind !== 'thing');
  $('tiltrow').toggleAttribute('hidden', cur?.kind !== 'thing');
  if (cur?.kind === 'thing') {
    const t = cur.spec.tilt ?? [0, 0, 0];
    for (const [id, k] of [['tilt-x', 0], ['tilt-y', 1], ['tilt-z', 2]] as const) {
      const el = $<HTMLInputElement>(id);
      if (document.activeElement !== el) el.value = String(t[k]);
    }
  }
  if (!cur) {
    $('what').textContent = 'Ничего не выбрано: тяни вещь с полки или щёлкни поставленную.';
    if (document.activeElement !== nameEl) nameEl.value = '';
    renderSaved();
    renderProblems();
    return;
  }
  const c = cur;
  $('what').textContent = c.kind === 'thing' ? (ALL_PROPS[c.spec.prop]?.ru ?? c.spec.prop) : `манекен · ${MAT_RU[c.spec.material]}`;
  // Дверцы и ящики (квиз 18.11, «Как выпадет + переключатель»): только у вещи, которой есть что открыть.
  const opens = c.kind === 'thing' && canOpen(c.spec.prop);
  $('doors').toggleAttribute('hidden', !opens);
  $('doorsnote').toggleAttribute('hidden', !opens);
  if (opens && c.kind === 'thing') {
    const spec = c.spec;
    chips($('doors'), DOORS, (k) => DOORS_RU[k], (k) => (k === 'roll' ? spec.open === undefined : spec.open === k), (k) =>
      change(() => {
        if (k === 'roll') delete spec.open;
        else spec.open = k;
      }),
    );
    $('doorsnote').textContent = doorsNote(spec.open, !spec.replaces && !spec.open && curCheck(c).open === 'shut');
  }
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
  // Замена «везде» (куратор, пачка 41, 239): каждая такая вещь игры во всех местах и помещениях — места, помещения и счёт не нужны.
  const all = c.kind === 'thing' && !!rp && c.spec.everywhere === true;
  $('swapscope').toggleAttribute('hidden', !rp);
  if (rp && c.kind === 'thing') {
    const spec = c.spec;
    chips($('swapscope'), ['here', 'all'], (k) => (k === 'all' ? 'везде, где она стоит' : 'только здесь'), (k) => (k === 'all') === all, (k) =>
      change(() => {
        if (k === 'all') spec.everywhere = true;
        else delete spec.everywhere;
      }),
    );
  }
  $('worlds').toggleAttribute('hidden', all);
  $('rooms').toggleAttribute('hidden', all);
  $('moved').toggleAttribute('hidden', !mv);
  if (mv) $('movenote').textContent = `вещь игры: ${mv.nth + 1}-я «${ruShort(mv.thing)}» в помещениях правила — встанет по правилу в том же помещении, одна`;
  $('countrow').toggleAttribute('hidden', !!mv || all);
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
    ? all
      ? `везде: вместо каждой «${ALL_PROPS[rp]?.ru.split(',')[0] ?? rp}» во всех местах и помещениях — там же и так же повёрнута`
      : `${where} · ${rooms} · вместо «${ALL_PROPS[rp]?.ru.split(',')[0] ?? rp}» — там же и так же повёрнута · до ${c.spec.rule.count} шт. на место`
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
/**
 * Сколько замен встанет на плане: вещи игры этого имени в помещениях правила, не больше count; у замены «везде» — все такие
 * на плане (картонку не заменяют).
 */
function swapsIn(l: BuiltLevel, spec: PlacedSpec): number {
  let n = 0;
  for (const o of l.objects ?? []) {
    if (o.name !== spec.replaces || o.flat) continue;
    const r = roomOfObj(l, o);
    if (spec.everywhere === true || (r && (spec.rule.rooms.length === 0 || spec.rule.rooms.includes(r.type)))) n += 1;
  }
  return spec.everywhere === true ? n : Math.min(n, spec.rule.count);
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
    // Замена «везде» считается по всем местам: вещь игры может стоять и там, где партнёр её не видел.
    for (const w of c.kind === 'thing' && c.spec.replaces && c.spec.everywhere === true ? FIGURE_WORLDS : c.spec.rule.worlds) {
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
          : c.kind === 'thing' && c.spec.replaces && c.spec.everywhere === true
            ? `в игре заменит ${pieces} шт. — на ${hit} из ${levels} планов всех мест (там, где такая вещь стоит)`
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

/** Подпись набора записей: тот же набор — та же строка. */
const sigOf = (m: ReadonlyMap<string, unknown>): string => JSON.stringify([...m.entries()].sort((a, b) => a[0].localeCompare(b[0])));
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
async function putRecord(coll: Coll3, spec: PlacedSpec | RemovedSpec | FigureSpec): Promise<boolean> {
  if (coll === 'things') savedThings.set(spec.id, spec as PlacedSpec);
  else if (coll === 'figures') savedFigs.set(spec.id, spec as FigureSpec);
  else savedRemoved.set(spec.id, spec as RemovedSpec);
  // Убранная и передвинутая меняют, что видно из вещей игры, — помещение пересобирается; прочее — только список и призраки.
  if (coll === 'removed' || (spec as PlacedSpec).moves) editsChanged();
  else {
    renderGhosts();
    renderSaved();
    dirty = true;
  }
  // Сперва — в браузер: вкладку закроют, связь пропадёт — правка дождётся.
  keepDraft({ coll, id: spec.id, spec });
  if (!db || !canWrite) return false;
  try {
    await db.collection(coll).doc(spec.id).set(spec as unknown as Record<string, unknown>);
    dropDraft(coll, spec.id);
    return true;
  } catch {
    setStatus('База не ответила — правка лежит в браузере и уйдёт в базу при следующем открытии.');
    return false;
  }
}
/** Убрать запись из коллекции. */
async function dropRecord(coll: Coll3, spec: PlacedSpec | RemovedSpec | FigureSpec): Promise<void> {
  if (coll === 'things') savedThings.delete(spec.id);
  else if (coll === 'figures') savedFigs.delete(spec.id);
  else savedRemoved.delete(spec.id);
  editsChanged();
  keepDraft({ coll, id: spec.id });
  if (!db || !canWrite) return;
  try {
    await db.collection(coll).doc(spec.id).delete();
    dropDraft(coll, spec.id);
  } catch {
    setStatus('База не ответила — удаление уйдёт в базу при следующем открытии.');
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
  const where = (slot: string | undefined, rooms: readonly string[]): string => {
    const s = slotFor(slot, rooms);
    return s ? ` · ${slotLabel(s)}` : ' · везде';
  };
  const doors = (o: PlacedOpen | undefined): string => (o ? ` · ${DOORS_RU[o]}` : '');
  // Сначала — что видно в этом помещении (его вариант или общее); остальное — по кнопке «ещё».
  const here = (worlds: readonly WorldKind[], rooms: readonly string[], slot: string | undefined): boolean => applies(worlds, rooms) && mine(slot, rooms);
  let rest = 0;
  for (const s of [...savedThings.values()].sort(byAt)) {
    if (!savedAll && !here(s.rule.worlds, s.rule.rooms, s.slot)) {
      rest += 1;
      continue;
    }
    add((s.moves ? (/передвин/.test(s.name) ? s.name : `${s.name} · передвинута`) : s.name) + doors(s.open) + (savedAll ? where(s.slot, s.rule.rooms) : ''), cur?.spec.id === s.id, () => openThing(s));
  }
  for (const f of [...savedFigs.values()].sort(byAt)) {
    if (!savedAll && !here(f.rule.worlds, f.rule.rooms, f.slot)) {
      rest += 1;
      continue;
    }
    add(`${f.name} · ${MAT_RU[f.material]}${savedAll ? where(f.slot, f.rule.rooms) : ''}`, cur?.spec.id === f.id, () => openFigure(f));
  }
  for (const r of [...savedRemoved.values()].sort(byAt)) {
    if (!savedAll && !here(r.worlds, r.rooms, r.slot)) {
      rest += 1;
      continue;
    }
    add((/убран/.test(r.name) ? r.name : `${r.name} · убрана`) + (savedAll ? where(r.slot, r.rooms) : ''), gameSel !== 0 && removedOf(gameSel)?.spec.id === r.id, () => openRemoved(r));
  }
  if (rest > 0 || savedAll) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn--small';
    b.textContent = savedAll ? 'только это помещение' : `ещё ${rest} в других помещениях`;
    b.addEventListener('click', () => {
      savedAll = !savedAll;
      renderSaved();
    });
    rows.push(b);
  }
  savedEl.replaceChildren(...rows);
}
/** «Поставлено»: всё сохранённое, а не только это помещение. */
let savedAll = false;
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
/** Открыть помещение варианта записи (там она сделана); false — запись общая, варианта нет. */
function goToSlot(slot: string | undefined, rooms: readonly string[], worlds: readonly WorldKind[]): boolean {
  const s = slotFor(slot, rooms);
  if (!s) return false;
  const w = worlds.includes(world) ? world : worlds[0]!;
  const t = slotType(s);
  const k = slotNumber(s);
  if (roomsOfType(w, t).length === 0) return false;
  if (w !== world || t !== roomType || k !== roomPick) enterRoom(w, t, k);
  return true;
}
function openThing(s: PlacedSpec): void {
  flushSave();
  pushUndo();
  if (goToSlot(s.slot, s.rule.rooms, s.rule.worlds)) {
    /* уже в помещении её варианта */
  } else if (s.moves) goToGame(s.rule.worlds, s.rule.rooms, s.moves.thing, s.moves.nth);
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
  flushSave();
  pushUndo();
  if (!goToSlot(f.slot, f.rule.rooms, f.rule.worlds)) goTo(f.rule);
  const it: FigItem = { kind: 'figure', spec: JSON.parse(JSON.stringify(f)) as FigureSpec, at: [0, 0, 0], yaw: 0 };
  settle(it);
  cur = it;
  dirty = true;
  syncPanel();
}
function openRemoved(r: RemovedSpec): void {
  if (!goToSlot(r.slot, r.rooms, r.worlds)) goToGame(r.worlds, r.rooms, r.what.thing, r.what.nth);
  const o = findGame(lvl, room, r.what.thing, r.what.nth);
  if (o) selectGame(o.id);
}

/**
 * База конструктора на своём компьютере (квиз 18.11: «Программа на MacBook»): те же коллекции, что у страницы в Claude, но
 * записи идут в файлы репозитория через serve.mjs (src/world/partner/*.json — их берёт игра; tools/constructor/work — отметки
 * и заявки). Окно одно, поэтому снимок — то, что загрузили при открытии, плюс свои правки.
 */
function localDb(): DbNs {
  const data = new Map<string, Map<string, Record<string, unknown>>>();
  const listeners = new Map<string, ((s: Snap) => void)[]>();
  let loaded: Promise<void> | null = null;
  const load = (): Promise<void> =>
    (loaded ??= fetch('api/work')
      .then((r) => r.json() as Promise<Record<string, Record<string, unknown>[]>>)
      .then((all) => {
        for (const [c, rows] of Object.entries(all)) data.set(c, new Map(rows.map((r) => [String(r.id), r])));
      }));
  const coll = (c: string): Map<string, Record<string, unknown>> => {
    let m = data.get(c);
    if (!m) data.set(c, (m = new Map()));
    return m;
  };
  const emit = (c: string): void => {
    const snap: Snap = { docs: [...coll(c).entries()].map(([id, d]) => ({ id, data: () => d })), metadata: { fromCache: false } };
    for (const fn of listeners.get(c) ?? []) fn(snap);
  };
  const call = async (c: string, id: string, init: RequestInit): Promise<void> => {
    const r = await fetch(`api/work/${c}/${encodeURIComponent(id)}`, init);
    if (!r.ok) throw new Error(`сервер ответил ${r.status}`);
  };
  return {
    collection: (c) => ({
      doc: (id) => ({
        set: async (d) => {
          await call(c, id, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) });
          coll(c).set(id, { ...d, id });
          emit(c);
        },
        delete: async () => {
          await call(c, id, { method: 'DELETE' });
          coll(c).delete(id);
          emit(c);
        },
      }),
      onSnapshot: (next, err) => {
        const list = listeners.get(c) ?? [];
        list.push(next);
        listeners.set(c, list);
        load().then(
          () => next({ docs: [...coll(c).entries()].map(([id, d]) => ({ id, data: () => d })), metadata: { fromCache: false } }),
          () => err?.({ code: 'unavailable' }),
        );
        return () => undefined;
      },
    }),
  };
}

async function connect(): Promise<void> {
  if (LOCAL) {
    // Свой компьютер: база — файлы репозитория (serve.mjs); заявки на вещи каталога — своя коллекция.
    db = localDb();
    canWrite = true;
    db.collection('requests').onSnapshot((snap) => {
      requests.clear();
      for (const d of snap.docs) requests.set(d.id, d.data() as unknown as RequestRow);
      renderKinds();
      if (shelfKind === 'requests') renderShelf();
    });
  } else {
    const claude = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
    if (!claude?.use) {
      restoreDrafts();
      setSave('local');
      return;
    }
    db = (await claude.use('db')) as DbNs | null;
    const user = (await claude.use('user')) as { can?(n: string): Promise<boolean | null> } | null;
    if (!db) {
      restoreDrafts();
      setSave('local');
      return;
    }
    const can = user?.can ? await user.can('data.write') : null;
    canWrite = can !== false;
    if (!canWrite) setStatus('Можно смотреть; сохранять может только тот, у кого есть право правки.');
  }
  void flushDrafts();
  renderCard();
  const timer = window.setTimeout(() => setStatus('Сохранённое пока не загрузилось — проверь связь.'), 10000);
  const done = (): void => {
    window.clearTimeout(timer);
    if (canWrite && statusEl.textContent?.startsWith('Сохранённое')) setStatus('');
  };
  db.collection('things').onSnapshot(
    (snap) => {
      if (!snap.metadata.fromCache) done();
      const next = new Map<string, PlacedSpec>();
      for (const d of snap.docs) {
        const s = d.data() as unknown as PlacedSpec | undefined;
        if (s && placedProblems(s, ALL_PROPS, FIXED).length === 0) next.set(d.id, s);
      }
      // Своя же запись, вернувшаяся из базы, ничего не меняет — помещение не пересобирать.
      if (sigOf(next) === sigOf(savedThings)) return;
      savedThings.clear();
      for (const [k, v] of next) savedThings.set(k, v);
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
      renderGhosts();
      dirty = true;
    },
    () => setStatus('Сохранённые фигуры не загрузились. Обнови страницу позже.'),
  );
  db.collection('removed').onSnapshot(
    (snap) => {
      if (!snap.metadata.fromCache) done();
      const next = new Map<string, RemovedSpec>();
      for (const d of snap.docs) {
        const r = d.data() as unknown as RemovedSpec | undefined;
        if (r && removedProblems(r, ALL_PROPS, FIXED).length === 0) next.set(d.id, r);
      }
      if (sigOf(next) === sigOf(savedRemoved)) return;
      savedRemoved.clear();
      for (const [k, v] of next) savedRemoved.set(k, v);
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

// ───────────────────────────── автосохранение ─────────────────────────────

/**
 * Автосохранение (партнёр 18.11: «нужны автосохранения, если случайно вышел или вылетел»). Кнопки «Сохранить» больше нет:
 * поставленная вещь сохраняется сразу, правка — через полсекунды после последнего движения, и перед тем как выбрать другое.
 * Что не дошло до базы (вне Claude её нет, бывает, что нет связи), лежит в браузере (localStorage, черновики) и уходит в базу при
 * следующем открытии; вне Claude из черновиков же и показывается. Вид — место, помещение и его номер — тоже запоминается.
 */
type SaveState = 'saved' | 'pending' | 'local' | 'bad';
let saveTimer = 0;
function setSave(st: SaveState, why = ''): void {
  const el = document.getElementById('savestate');
  if (!el) return;
  el.dataset.state = st;
  el.textContent = st === 'saved' ? 'сохранено' : st === 'pending' ? 'сохраняю…' : st === 'local' ? 'сохранено в браузере' : `не сохраняется${why ? `: ${why}` : ''}`;
}
function scheduleSave(): void {
  if (!cur) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveCur(), 450);
  setSave('pending');
}
/** Сохранить выбранное сейчас: перед новой вещью, другим выбором, другим помещением. */
function flushSave(): void {
  if (!saveTimer) return;
  window.clearTimeout(saveTimer);
  saveTimer = 0;
  void saveCur();
}
const defaultName = (c: Item): string => (c.kind === 'thing' ? ruShort(c.spec.prop) : `Фигура ${savedFigs.size + 1}`);
/** Годится ли выбранное для записи: пусто — да. */
const curBad = (c: Item): string[] => (c.kind === 'thing' ? placedProblems({ ...c.spec, name: c.spec.name.trim() || defaultName(c) }, ALL_PROPS, FIXED) : figureProblems({ ...c.spec, name: c.spec.name.trim() || defaultName(c) }));
async function saveCur(): Promise<void> {
  window.clearTimeout(saveTimer);
  saveTimer = 0;
  const c = cur;
  if (!c) return;
  if (!c.spec.name.trim()) c.spec.name = defaultName(c);
  const bad = curBad(c);
  if (bad.length > 0) {
    setSave('bad', bad[0]);
    return;
  }
  if (db && !canWrite) {
    setSave('bad', 'нет права правки');
    return;
  }
  // Запись живёт в том варианте помещения, где её поставили (квиз 17.11, ночь: «Свой вариант на каждую»).
  c.spec.name = c.spec.name.trim();
  c.spec.at = new Date().toISOString();
  c.spec.slot = slotNow();
  const spec = JSON.parse(JSON.stringify(c.spec)) as PlacedSpec | FigureSpec;
  const ok = await putRecord(c.kind === 'thing' ? 'things' : 'figures', spec);
  if (cur === c && !saveTimer) setSave(ok ? 'saved' : 'local');
}

/** Черновики: записи, которые ещё не дошли до базы (spec нет — удаление). */
const DRAFTS = 'ctor.drafts.v1';
type Draft = { coll: Coll3; id: string; spec?: PlacedSpec | RemovedSpec | FigureSpec };
function readDrafts(): Draft[] {
  try {
    const v = JSON.parse(localStorage.getItem(DRAFTS) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as Draft[]) : [];
  } catch {
    return [];
  }
}
function writeDrafts(list: readonly Draft[]): void {
  try {
    localStorage.setItem(DRAFTS, JSON.stringify(list));
  } catch {
    /* браузер не даёт хранить: правка живёт, пока страница открыта */
  }
}
function keepDraft(d: Draft): void {
  writeDrafts([...readDrafts().filter((x) => !(x.coll === d.coll && x.id === d.id)), d]);
}
function dropDraft(coll: Coll3, id: string): void {
  const list = readDrafts();
  const rest = list.filter((x) => !(x.coll === coll && x.id === id));
  if (rest.length !== list.length) writeDrafts(rest);
}
/** Вне Claude: что сделано на этой странице раньше, — из черновиков. */
function restoreDrafts(): void {
  const list = readDrafts();
  if (list.length === 0) return;
  for (const d of list) {
    const map = d.coll === 'things' ? savedThings : d.coll === 'figures' ? savedFigs : savedRemoved;
    if (d.spec) (map as Map<string, unknown>).set(d.id, d.spec);
    else map.delete(d.id);
  }
  editsChanged();
}
/** База появилась: черновики — в неё. */
async function flushDrafts(): Promise<void> {
  if (!db || !canWrite) return;
  for (const d of readDrafts()) {
    try {
      if (d.spec) await db.collection(d.coll).doc(d.id).set(d.spec as unknown as Record<string, unknown>);
      else await db.collection(d.coll).doc(d.id).delete();
      dropDraft(d.coll, d.id);
    } catch {
      /* связи нет — попробуем при следующем открытии */
    }
  }
}

/** Снять выделение: вещь остаётся, где стоит, — она сохранена (несохранимую не отпускаем: скажем, что не так). */
function deselect(): void {
  if (cur && curBad(cur).length > 0) {
    setStatus(`Не сохраняется: ${curBad(cur)[0]}. Поправь или удали (Delete).`);
    return;
  }
  flushSave();
  if (!cur && !gameSel && !replaceFor) return;
  cur = null;
  gameSel = 0;
  setReplace(0);
  renderGhosts();
  dirty = true;
  syncPanel();
}

/** Копия выбранного (⌘D): рядом, своя запись. */
function duplicate(): void {
  if (!cur) return;
  flushSave();
  pushUndo();
  const c = JSON.parse(JSON.stringify(cur)) as Item;
  c.spec.id = `${c.kind === 'thing' ? 'pl' : 'fig'}_${stamp()}`;
  c.spec.name = `${c.spec.name.trim() || defaultName(c)} — копия`.slice(0, 80);
  if (c.kind === 'thing') {
    delete c.spec.moves;
    delete c.spec.replaces;
    delete c.spec.everywhere;
    delete c.obj;
  }
  c.at = [c.at[0] + 0.4, c.at[1], c.at[2] + 0.4];
  derive(c);
  cur = c;
  pushStep({ t: 'rec', coll: c.kind === 'thing' ? 'things' : 'figures', add: true, spec: c.spec });
  void saveCur();
  renderGhosts();
  dirty = true;
  syncPanel();
}

/** Заменить выбранную вещь игры: следующий щелчок по вещи на полке ставит её вместо этой (0 — не заменять). */
let replaceFor = 0;
function setReplace(id: number): void {
  replaceFor = id;
  document.body.classList.toggle('is-replacing', id !== 0);
  const o = id ? objById(id) : undefined;
  if (o) setStatus(`Выбери на полке, чем заменить «${ruShort(o.name)}». Esc — отмена.`);
}

/**
 * Удалить то, что выделено: правку в работе (сохранённую — из базы) или вещь игры (убрать её). Одним нажатием — кнопкой
 * «Удалить» или клавишей Delete / Backspace; вернуть — ⌘Z (партнёр 17.11: «Конструктор не удаляет добавленные мной
 * объекты»: удаление было вторым нажатием, а манекены вне правки и выделить было нельзя).
 */
async function deleteSelected(): Promise<boolean> {
  if (!cur) {
    if (!gameSel) return false;
    removeGame(gameSel);
    return true;
  }
  const name = cur.spec.name || (cur.kind === 'thing' ? ruShort(cur.spec.prop) : 'манекен');
  const coll: Coll3 = cur.kind === 'thing' ? 'things' : 'figures';
  const saved = cur.kind === 'thing' ? savedThings.get(cur.spec.id) : savedFigs.get(cur.spec.id);
  pushUndo();
  cur = null;
  if (!saved) {
    dirty = true;
    syncPanel();
    renderGhosts();
    setStatus('Убрано (сохранено не было). ⌘Z — вернуть.');
    return true;
  }
  if (db && !canWrite) {
    setStatus('Удалить не выйдет: право правки есть не у всех.');
    return true;
  }
  pushStep({ t: 'rec', coll, add: false, spec: saved });
  await dropRecord(coll, saved);
  setStatus(`Удалено: «${name}». ⌘Z — вернуть.`);
  dirty = true;
  syncPanel();
  return true;
}
$('drop').addEventListener('click', () => void deleteSelected());
$('nextroom').addEventListener('click', () => {
  enterRoom(world, roomType, roomPick + 1);
  setStatus(`«${ROOM_RU[roomType] ?? roomType}» ${roomPick + 1} — свой вариант: что поставишь, передвинешь или уберёшь здесь, будет только в ней. В игре каждая такая комната берёт один из твоих вариантов по жребию.`);
});

renderKinds();
{
  // Где был в прошлый раз (вкладку закрыли, браузер вылетел) — там и открыться.
  let v: { world?: WorldKind; type?: string; pick?: number } = {};
  try {
    v = JSON.parse(localStorage.getItem('ctor.view') ?? '{}') as typeof v;
  } catch {
    v = {};
  }
  const w = v.world && FIGURE_WORLDS.includes(v.world) ? v.world : 'shelter';
  const t = v.type && roomTypes(w).includes(v.type) ? v.type : roomTypes(w).includes('kitchen') ? 'kitchen' : roomTypes(w)[0]!;
  enterRoom(w, t, typeof v.pick === 'number' ? v.pick : 0);
}
/**
 * «Залить в игру» прямо из окна (партнёр 18.11: «давай конструктор отдельной простой программой без этих плясок с
 * терминалом»). То же, что npm run constructor:push: проверка правилами игры, коммит, отправка на GitHub (serve.mjs →
 * push_lib.mjs). Вход в GitHub — один раз, токеном; его хранит связка ключей Mac. Есть только в программе на своём компьютере.
 */
type PushResult = { ok: boolean; message?: string; problems?: string[]; detail?: string; auth?: boolean; nothing?: boolean };
const POST = { method: 'POST', headers: { 'x-constructor': '1' } } as const;
function showPush(state: 'busy' | 'ok' | 'bad' | 'note', msg: string, r?: PushResult): void {
  const box = $('pushbox');
  box.hidden = false;
  box.dataset.state = state;
  $('pushmsg').textContent = msg;
  const list = $('pushlist');
  list.replaceChildren(...(r?.problems ?? []).map((p) => Object.assign(document.createElement('li'), { textContent: p })));
  list.hidden = !r?.problems?.length;
  const detail = $('pushdetail');
  detail.textContent = r?.detail ?? '';
  detail.hidden = !r?.detail;
  $('tokenform').hidden = !r?.auth;
  if (r?.auth) $<HTMLInputElement>('tokenin').focus();
}
const showPushResult = (r: PushResult): void => showPush(r.ok ? 'ok' : 'bad', r.message ?? (r.ok ? 'Готово.' : 'Не получилось.'), r);
/** Дождаться, пока последняя правка дойдёт до файла (автосохранение ждёт полсекунды после движения). */
async function settleSave(): Promise<void> {
  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = 0;
    await saveCur();
  }
  for (let i = 0; i < 30 && document.getElementById('savestate')?.dataset.state === 'pending'; i++) await new Promise((r) => setTimeout(r, 100));
}
const NO_ANSWER = 'Конструктор не ответил. Закрой программу и открой снова — всё сохранено.';
async function pushNow(): Promise<void> {
  const btn = $<HTMLButtonElement>('push');
  btn.disabled = true;
  showPush('busy', 'Проверяю и отправляю…');
  try {
    await settleSave();
    showPushResult((await (await fetch('api/push', POST)).json()) as PushResult);
  } catch {
    showPush('bad', NO_ANSWER);
  } finally {
    btn.disabled = false;
  }
}
async function sendToken(e: Event): Promise<void> {
  e.preventDefault();
  const input = $<HTMLInputElement>('tokenin');
  const token = input.value.trim();
  if (!token) return;
  showPush('busy', 'Вхожу в GitHub и отправляю…');
  try {
    const init = { ...POST, headers: { ...POST.headers, 'content-type': 'application/json' }, body: JSON.stringify({ token }) };
    const r = (await (await fetch('api/token', init)).json()) as { ok: boolean; message?: string; result?: PushResult };
    input.value = '';
    if (!r.ok) showPush('bad', r.message ?? 'Не вышло.', { ok: false, auth: true });
    else if (r.result) showPushResult(r.result);
  } catch {
    showPush('bad', NO_ANSWER);
  }
}
function setupPush(): void {
  if (!LOCAL) return;
  $('push').hidden = false;
  $('push').addEventListener('click', () => void pushNow());
  $('tokenform').addEventListener('submit', (e) => void sendToken(e));
  $('pushclose').addEventListener('click', () => {
    $('pushbox').hidden = true;
  });
  // Окно живо — серверу слышно (запасная программа без своего окна уходит сама, когда страницу закрыли).
  const ping = (): void => void fetch('api/ping', POST).catch(() => undefined);
  ping();
  window.setInterval(ping, 15000);
  void fetch('api/hello')
    .then((r) => r.json() as Promise<{ note?: string }>)
    .then((h) => {
      if (h.note) showPush('note', h.note);
    })
    .catch(() => undefined);
}

setTool('move');
loop();
setupPush();
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
  /** Стрелка: ax — вбок (+1 вправо), az — от себя (+1); shift/alt — шаг 50 / 2 см. */
  nudge: (ax: number, az: number, shift = false, alt = false) => nudge(ax, az, { shiftKey: shift, altKey: alt }) && cur ? { at: cur.at, rot: cur.kind === 'thing' ? cur.rot : null } : null,
  save: () => saveCur(),
  fresh: () => deselect(),
  tool: (t: Tool) => setTool(t),
  /** Доворот выбранной вещи по всем осям, градусы (как кольцами). */
  tilt: (t: [number, number, number] | null) => {
    if (cur?.kind !== 'thing') return null;
    change(() => {
      if (t && isTilted(t)) (cur as ThingItem).spec.tilt = t;
      else delete (cur as ThingItem).spec.tilt;
    });
    return (cur as ThingItem).spec.tilt ?? null;
  },
  duplicate: () => duplicate(),
  replaceWith: (id: number, prop: string) => {
    const o = objById(id);
    if (!o || !swappable(prop).some((x) => x.id === id)) return false;
    dropSwap(prop, o);
    return true;
  },
  drafts: () => readDrafts(),
  /** Удалить выделенное (как Delete). */
  del: () => deleteSelected(),
  /** Призраки в показанном помещении: чей и где стоит. */
  ghosts: () => ghosts.children.map((m) => ({ id: m.userData.ghost as string, at: [m.position.x, m.position.y, m.position.z] })),
  /** Открыть сохранённое (как щелчок по призраку). */
  open: (id: string) => {
    const s = savedThings.get(id);
    const f = savedFigs.get(id);
    if (s) openThing(s);
    else if (f) openFigure(f);
    return cur ? { id: cur.spec.id, at: cur.at } : null;
  },
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
  saved: () => ({ things: [...savedThings.values()], removed: [...savedRemoved.values()], figures: [...savedFigs.values()], marks: Object.fromEntries(marks) }),
  hidden: () => [...hidden],
  coverage: () => $('coverage').textContent,
};
