/**
 * Инструмент фигур (слова партнёра: «Для фигур мне нужен какой-то простой инструмент разработки»; «Да,
 * инструмент ок, но я сам хочу руками трогать»). Партнёр гнёт шарнирный манекен руками — тянет кисти,
 * щиколотки, макушку, шею (world/figure_ik.ts) — и двигает его по полу комнаты-образца или поднимает в
 * воздух. Справа — из чего фигура и где стоит: в каких местах и помещениях, у чего, лицом куда, на какой
 * высоте (world/figures.ts).
 *
 * Комната здесь — образец края: угол, стена, середина, проём, потолок. В игре фигура встанет в настоящее
 * помещение того же типа, у того же края, так же развёрнутой и так же поднятой.
 *
 * Сохранённые фигуры лежат в базе страницы (коллекция figures): основная модель забирает их оттуда в игру.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { generateLayout } from '../../src/gen/layout';
import type { WorldKind } from '../../src/gen/layout';
import { clonePose, handlePoint, HANDLES, solve } from '../../src/world/figure_ik';
import type { Handle } from '../../src/world/figure_ik';
import { FIGURE_ANCHORS, FIGURE_FACINGS, FIGURE_MATERIALS, FIGURE_WORLDS, figureProblems } from '../../src/world/figures';
import type { FigureAnchor, FigureFacing, FigureMaterial, FigureSpec } from '../../src/world/figures';
import { POSES, skeleton } from '../../src/world/props_people';
import type { Pose, PoseName } from '../../src/world/props_people';
import { figure, materialFor, matcap, PAINTS } from '../matcaps/look';

// ───────────────────────────── подписи ─────────────────────────────

const WORLD_RU: Record<WorldKind, string> = { shelter: 'убежище', office: 'офис', yellow: 'жёлтые комнаты', station: 'зал ожидания' };
const ROOM_RU: Record<string, string> = {
  entrance: 'вход', airlock: 'шлюз', corridor: 'коридор', stairwell: 'лестница', dorm: 'спальный отсек', living: 'гостиная', command: 'пункт управления',
  kitchen: 'кухня', medical: 'медпункт', hallway: 'прихожая', washroom: 'санузел', storage: 'кладовая', fvu: 'ФВУ', diesel: 'дизельная', bedroom: 'спальня',
  tanks: 'баки', bathroom: 'ванная', switchboard: 'щитовая', archive: 'архив', nursery: 'детская', collapsed: 'завал', reception: 'приёмная', breakroom: 'кухня офиса',
  manager: 'кабинет', files: 'картотека', meeting: 'переговорная', cubicles: 'опенспейс', department: 'отдел', hall: 'зал', vestibule: 'вход', concourse: 'зал',
  tickets: 'касса', lockers: 'камеры хранения', buffet: 'буфет', platform: 'перрон', lift: 'лифт', track: 'пути',
};
const POSE_RU: Record<PoseName, string> = { stand: 'стоит', wait: 'ждёт', look: 'смотрит вверх', call: 'с телефоном', sit: 'сидит', sofa: 'на диване', desk: 'за столом', hug: 'обхватил колени', lean: 'у стены' };
const MAT_RU: Record<FigureMaterial, string> = { wood: 'дерево', smoke: 'дым', hair: 'волосы', stone: 'камень', metal: 'металл', coal: 'уголь', skin: 'кожа', plastic: 'пластик' };
const MAT_NOTE: Partial<Record<FigureMaterial, string>> = {
  smoke: 'Дымная висит в воздухе и рассеивается, когда к ней подходят: подними её ползунком «Над полом» или тяни таз с ⌥.',
  hair: 'Волосатая растворяется от рук к телу.',
};
const ANCHOR_RU: Record<FigureAnchor, string> = { corner: 'в углу', wall: 'у стены', middle: 'посреди', door: 'в проёме', ceiling: 'под потолком' };
const FACING_RU: Record<FigureFacing, string> = { wall: 'лицом в стену', room: 'лицом в комнату', door: 'на дверь', player: 'навстречу идущему' };

// ───────────────────────────── фигура ─────────────────────────────

const freshId = (): string => `fig_${Date.now().toString(36)}`;
function fresh(): FigureSpec {
  return { id: freshId(), name: '', pose: clonePose(POSES.stand as Pose), material: 'wood', rule: { worlds: ['shelter'], rooms: [], anchor: 'corner', facing: 'wall', lift: 0, count: 1 }, yaw: 0, offset: [0, 0] };
}
let cur: FigureSpec = fresh();
const undo: string[] = [];
const pushUndo = (): void => {
  undo.push(JSON.stringify(cur));
  if (undo.length > 120) undo.shift();
};

// ───────────────────────────── сцена ─────────────────────────────

const viewEl = document.getElementById('view')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setClearColor(0x0e1012);
viewEl.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xdfe6ef, 0x22262b, 1.1));
const sun = new THREE.DirectionalLight(0xfff2df, 1.5);
sun.position.set(-2, 4, 3);
scene.add(sun);
const cam = new THREE.PerspectiveCamera(40, 1, 0.02, 60);
cam.position.set(2.4, 1.8, 3.6);

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const setNdc = (e: PointerEvent): void => {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
};

// Ручки ловят нажатие раньше вращения вида: слушатель стоит до OrbitControls и на погружении.
type Grip = Handle | 'pelvis';
let drag: { h: Grip; plane: THREE.Plane; start: THREE.Vector3; lift0: number; off0: [number, number]; vertical: boolean } | null = null;
const grips = new Map<Grip, THREE.Mesh>();
renderer.domElement.addEventListener(
  'pointerdown',
  (e) => {
    setNdc(e);
    ray.setFromCamera(ndc, cam);
    const hit = ray.intersectObjects([...grips.values()], false)[0];
    if (!hit) return;
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
    drag = { h, plane, start: p, lift0: cur.rule.lift, off0: [cur.offset[0], cur.offset[1]], vertical };
    renderer.domElement.setPointerCapture(e.pointerId);
  },
  { capture: true },
);
const controls = new OrbitControls(cam, renderer.domElement);
controls.target.set(-0.4, 0.95, -0.4);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.54;
controls.update();

function resize(): void {
  const w = viewEl.clientWidth;
  const h = viewEl.clientHeight;
  renderer.setSize(w, h, false);
  cam.aspect = w / Math.max(1, h);
  cam.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewEl);

// Комната-образец: пол, и по краю правила — угол, стена, проём или потолок.
const room = new THREE.Group();
scene.add(room);
const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.95, side: THREE.DoubleSide });
const ceilMat = new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.35, depthWrite: false });
const H = 2.8;
const BACK = -1.5;
function slab(w: number, h: number, x: number, y: number, z: number, ry = 0, m: THREE.Material = wallMat): void {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  room.add(mesh);
}
function buildRoom(a: FigureAnchor): void {
  for (const c of [...room.children]) {
    room.remove(c);
    (c as THREE.Mesh).geometry?.dispose();
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshStandardMaterial({ color: 0x24282d, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  room.add(floor);
  const grid = new THREE.GridHelper(6, 12, 0x3c424a, 0x2b3036);
  grid.position.y = 0.002;
  room.add(grid);
  if (a === 'corner' || a === 'wall' || a === 'ceiling') slab(6, H, 0, H / 2, BACK);
  if (a === 'corner') slab(6, H, BACK, H / 2, 0, Math.PI / 2);
  if (a === 'door') {
    // Стена с проёмом 0,9 × 2,05 м посередине.
    slab(2.55, H, -1.725, H / 2, BACK);
    slab(2.55, H, 1.725, H / 2, BACK);
    slab(0.9, H - 2.05, 0, 2.05 + (H - 2.05) / 2, BACK);
  }
  if (a === 'ceiling') {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), ceilMat);
    c.rotation.x = Math.PI / 2;
    c.position.y = H;
    room.add(c);
  }
}

/** Точка края, поворот его рамки (куда смотрит нормаль в комнату) и направление на дверь, рад. */
function anchorFrame(a: FigureAnchor): { p: THREE.Vector3; phi: number; door: number } {
  switch (a) {
    case 'corner':
      return { p: new THREE.Vector3(BACK + 0.38, 0, BACK + 0.38), phi: Math.PI / 4, door: Math.PI / 2 };
    case 'wall':
      return { p: new THREE.Vector3(0, 0, BACK + 0.3), phi: 0, door: Math.PI / 2 };
    case 'door':
      return { p: new THREE.Vector3(0, 0, BACK), phi: 0, door: Math.PI };
    case 'ceiling':
    case 'middle':
      return { p: new THREE.Vector3(0, 0, 0), phi: 0, door: Math.PI / 2 };
  }
}

/** Куда развёрнута фигура по правилу (рад; 0 — лицом к +z, в сторону, откуда смотрит камера). */
function facingYaw(a: FigureAnchor, f: FigureFacing): number {
  const fr = anchorFrame(a);
  switch (f) {
    case 'room':
      return fr.phi;
    case 'wall':
      return fr.phi + Math.PI;
    case 'door':
      return fr.door;
    case 'player':
      return 0;
  }
}

const fig = new THREE.Group();
scene.add(fig);
const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 0.55, 0xe3b25e, 0.12, 0.07);
scene.add(arrow);
const lift = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), new THREE.LineDashedMaterial({ color: 0xe3b25e, dashSize: 0.05, gapSize: 0.05 }));
scene.add(lift);

// Материалы: дым и волосы — оболочками, как на картинках материалов.
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

let geo: THREE.BufferGeometry | null = null;
let shownMat: FigureMaterial | null = null;
const meshes: THREE.Mesh[] = [];
const gripMat = new THREE.MeshBasicMaterial({ color: 0xe3b25e, depthTest: false, transparent: true, opacity: 0.92 });
const gripHot = new THREE.MeshBasicMaterial({ color: 0xfff1cf, depthTest: false });
const gripGeo = new THREE.SphereGeometry(0.034, 16, 12);
for (const h of [...HANDLES, 'pelvis'] as Grip[]) {
  const m = new THREE.Mesh(gripGeo, gripMat);
  m.userData.h = h;
  m.renderOrder = 999;
  fig.add(m);
  grips.set(h, m);
}

let dirty = true;
function refreshFigure(): void {
  const g = figure(cur.pose, 2);
  if (shownMat !== cur.material) {
    for (const m of meshes) fig.remove(m);
    meshes.length = 0;
    for (const l of layers(cur.material)) {
      const mesh = new THREE.Mesh(g, l.mat);
      mesh.renderOrder = l.order;
      fig.add(mesh);
      meshes.push(mesh);
    }
    shownMat = cur.material;
  } else for (const m of meshes) m.geometry = g;
  geo?.dispose();
  geo = g;
  const s = skeleton(cur.pose);
  for (const h of HANDLES) grips.get(h)!.position.fromArray(handlePoint(s, h));
  grips.get('pelvis')!.position.fromArray(s.pelvis);
  // Где фигура: край правила + сдвиг, повёрнутый по рамке края; высота — «над полом».
  const fr = anchorFrame(cur.rule.anchor);
  const c = Math.cos(fr.phi);
  const sn = Math.sin(fr.phi);
  const [ox, oz] = cur.offset;
  const base = new THREE.Vector3(fr.p.x + ox * c + oz * sn, 0, fr.p.z - ox * sn + oz * c);
  const y = cur.rule.anchor === 'ceiling' ? Math.max(cur.rule.lift, 0.6) : cur.rule.lift;
  fig.position.set(base.x, y, base.z);
  fig.rotation.y = facingYaw(cur.rule.anchor, cur.rule.facing) + (cur.yaw * Math.PI) / 180;
  arrow.position.set(base.x, 0.01, base.z);
  arrow.setDirection(new THREE.Vector3(Math.sin(fig.rotation.y), 0, Math.cos(fig.rotation.y)));
  lift.visible = y > 0.01;
  lift.scale.y = Math.max(0.001, y);
  lift.position.set(base.x, 0, base.z);
  lift.computeLineDistances();
}

renderer.domElement.addEventListener('pointermove', (e) => {
  setNdc(e);
  ray.setFromCamera(ndc, cam);
  if (!drag) {
    const hit = ray.intersectObjects([...grips.values()], false)[0];
    for (const m of grips.values()) m.material = m === hit?.object ? gripHot : gripMat;
    renderer.domElement.style.cursor = hit ? 'grab' : '';
    return;
  }
  const q = ray.ray.intersectPlane(drag.plane, new THREE.Vector3());
  if (!q) return;
  if (drag.h === 'pelvis') {
    if (drag.vertical) cur.rule.lift = Math.round(Math.max(0, Math.min(2.6, drag.lift0 + (q.y - drag.start.y))) * 100) / 100;
    else {
      const fr = anchorFrame(cur.rule.anchor);
      const dx = q.x - drag.start.x;
      const dz = q.z - drag.start.z;
      const c = Math.cos(fr.phi);
      const sn = Math.sin(fr.phi);
      const cl = (v: number): number => Math.round(Math.max(-3, Math.min(3, v)) * 100) / 100;
      cur.offset = [cl(drag.off0[0] + dx * c - dz * sn), cl(drag.off0[1] + dx * sn + dz * c)];
    }
    syncPanel();
  } else {
    const local = fig.worldToLocal(q.clone());
    cur.pose = solve(cur.pose, drag.h, [local.x, local.y, local.z], 24);
  }
  dirty = true;
  renderer.domElement.style.cursor = 'grabbing';
});
const endDrag = (): void => {
  if (!drag) return;
  drag = null;
  controls.enabled = true;
  renderer.domElement.style.cursor = '';
  validate();
};
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement)) {
    const prev = undo.pop();
    if (!prev) return;
    e.preventDefault();
    cur = JSON.parse(prev) as FigureSpec;
    buildRoom(cur.rule.anchor);
    dirty = true;
    syncPanel();
  }
});

(function loop(): void {
  requestAnimationFrame(loop);
  if (dirty) {
    dirty = false;
    refreshFigure();
  }
  controls.update();
  renderer.render(scene, cam);
})();

// ───────────────────────────── панель ─────────────────────────────

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const nameEl = $<HTMLInputElement>('name');
const statusEl = $('status');
const problemsEl = $('problems');
const savedEl = $('saved');
const setStatus = (t: string): void => {
  statusEl.textContent = t;
};

/** Типы помещений места: по нескольким планам этого места (сиды как у игры). */
const roomsCache = new Map<WorldKind, string[]>();
function roomsOf(w: WorldKind): string[] {
  const have = roomsCache.get(w);
  if (have) return have;
  const types = new Set<string>();
  for (const seed of [7, 42, 20041113]) for (const r of generateLayout(seed, 2, w).rooms) types.add(r.type);
  const out = [...types].sort((a, b) => (ROOM_RU[a] ?? a).localeCompare(ROOM_RU[b] ?? b, 'ru'));
  roomsCache.set(w, out);
  return out;
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

const change = (fn: () => void, room = false): void => {
  pushUndo();
  fn();
  if (room) buildRoom(cur.rule.anchor);
  dirty = true;
  syncPanel();
};

const liftEl = $<HTMLInputElement>('lift');
const yawEl = $<HTMLInputElement>('yaw');
const countEl = $<HTMLInputElement>('count');
liftEl.addEventListener('pointerdown', pushUndo);
yawEl.addEventListener('pointerdown', pushUndo);
liftEl.addEventListener('input', () => {
  cur.rule.lift = Number(liftEl.value);
  dirty = true;
  syncPanel();
});
yawEl.addEventListener('input', () => {
  cur.yaw = Number(yawEl.value);
  dirty = true;
  syncPanel();
});
countEl.addEventListener('input', () => change(() => (cur.rule.count = Number(countEl.value))));
nameEl.addEventListener('input', () => {
  cur.name = nameEl.value;
  validate();
});

function syncPanel(): void {
  const poseNames = Object.keys(POSES) as PoseName[];
  chips($('poses'), poseNames, (p) => POSE_RU[p], () => false, (p) => change(() => (cur.pose = clonePose(POSES[p] as Pose))));
  chips($('mats'), FIGURE_MATERIALS, (m) => MAT_RU[m], (m) => cur.material === m, (m) =>
    change(() => {
      cur.material = m;
      // Дымная по слову партнёра висит в воздухе: поднять, если стоит на полу.
      if (m === 'smoke' && cur.rule.lift === 0) cur.rule.lift = 0.5;
    }),
  );
  $('matnote').textContent = MAT_NOTE[cur.material] ?? '';
  chips($('worlds'), FIGURE_WORLDS, (w) => WORLD_RU[w], (w) => cur.rule.worlds.includes(w), (w) =>
    change(() => {
      const has = cur.rule.worlds.includes(w);
      if (has && cur.rule.worlds.length === 1) return;
      cur.rule.worlds = has ? cur.rule.worlds.filter((x) => x !== w) : [...cur.rule.worlds, w];
      const allowed = new Set(cur.rule.worlds.flatMap(roomsOf));
      cur.rule.rooms = cur.rule.rooms.filter((r) => allowed.has(r));
    }),
  );
  const rooms = [...new Set(cur.rule.worlds.flatMap(roomsOf))];
  chips($('rooms'), ['*', ...rooms], (r) => (r === '*' ? 'любые помещения' : (ROOM_RU[r] ?? r)), (r) => (r === '*' ? cur.rule.rooms.length === 0 : cur.rule.rooms.includes(r)), (r) =>
    change(() => {
      if (r === '*') cur.rule.rooms = [];
      else cur.rule.rooms = cur.rule.rooms.includes(r) ? cur.rule.rooms.filter((x) => x !== r) : [...cur.rule.rooms, r];
    }),
  );
  chips($('anchors'), FIGURE_ANCHORS, (a) => ANCHOR_RU[a], (a) => cur.rule.anchor === a, (a) => change(() => (cur.rule.anchor = a), true));
  chips($('facings'), FIGURE_FACINGS, (f) => FACING_RU[f], (f) => cur.rule.facing === f, (f) => change(() => (cur.rule.facing = f)));
  liftEl.value = String(cur.rule.lift);
  $('liftv').textContent = `${cur.rule.lift.toFixed(2)} м`;
  yawEl.value = String(cur.yaw);
  $('yawv').textContent = `${Math.round(cur.yaw)}°`;
  countEl.value = String(cur.rule.count);
  $('countv').textContent = String(cur.rule.count);
  if (document.activeElement !== nameEl) nameEl.value = cur.name;
  renderSaved();
  validate();
}

function validate(): string[] {
  const bad = figureProblems({ ...cur, name: cur.name.trim() || 'без имени' });
  problemsEl.replaceChildren(...bad.map((b) => Object.assign(document.createElement('li'), { textContent: b })));
  return bad;
}

// ───────────────────────────── база страницы ─────────────────────────────

type Snap = { docs: { id: string; data(): Record<string, unknown> | undefined }[]; metadata: { fromCache: boolean } };
type DbNs = { collection(p: string): { doc(id: string): { set(d: Record<string, unknown>): Promise<void>; delete(): Promise<void> }; onSnapshot(n: (s: Snap) => void, e?: (err: { code: string }) => void): () => void } };
let db: DbNs | null = null;
let canWrite = true;
const saved = new Map<string, FigureSpec>();

function renderSaved(): void {
  savedEl.replaceChildren(
    ...[...saved.values()]
      .sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')))
      .map((f) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `chip${f.id === cur.id ? ' is-on' : ''}`;
        b.textContent = `${f.name} · ${MAT_RU[f.material]}`;
        b.addEventListener('click', () => {
          pushUndo();
          cur = JSON.parse(JSON.stringify(f)) as FigureSpec;
          buildRoom(cur.rule.anchor);
          dirty = true;
          syncPanel();
        });
        return b;
      }),
  );
}

async function connect(): Promise<void> {
  const claude = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
  if (!claude?.use) {
    setStatus('Фигуры не сохраняются: страница открыта не в Claude. Гнуть можно и так.');
    return;
  }
  db = (await claude.use('db')) as DbNs | null;
  const user = (await claude.use('user')) as { can?(n: string): Promise<boolean | null> } | null;
  if (!db) {
    setStatus('Сохранять сейчас нельзя: войди в Claude. Гнуть можно и так.');
    return;
  }
  const can = user?.can ? await user.can('data.write') : null;
  canWrite = can !== false;
  if (!canWrite) setStatus('Можно смотреть; сохранять может только тот, у кого есть право правки.');
  const timer = window.setTimeout(() => setStatus('Сохранённые фигуры пока не загрузились — проверь связь.'), 10000);
  db.collection('figures').onSnapshot(
    (snap) => {
      if (!snap.metadata.fromCache) {
        window.clearTimeout(timer);
        if (canWrite && statusEl.textContent?.startsWith('Сохранённые')) setStatus('');
      }
      saved.clear();
      for (const d of snap.docs) {
        const f = d.data() as unknown as FigureSpec | undefined;
        if (f && figureProblems(f).length === 0) saved.set(d.id, f);
      }
      renderSaved();
    },
    () => {
      window.clearTimeout(timer);
      setStatus('Сохранённые фигуры не загрузились. Обнови страницу позже.');
    },
  );
}

$('save').addEventListener('click', async () => {
  if (!cur.name.trim()) cur.name = `Фигура ${saved.size + 1}`;
  nameEl.value = cur.name;
  const bad = validate();
  if (bad.length > 0) {
    setStatus('Не сохранено: поправь то, что выше красным.');
    return;
  }
  if (!db || !canWrite) {
    setStatus('Сохранить не выйдет: база страницы недоступна.');
    return;
  }
  const spec: FigureSpec = { ...cur, name: cur.name.trim(), at: new Date().toISOString() };
  setStatus('Сохраняю…');
  try {
    await db.collection('figures').doc(spec.id).set(spec as unknown as Record<string, unknown>);
    saved.set(spec.id, spec);
    renderSaved();
    setStatus(`Сохранено: «${spec.name}».`);
  } catch {
    setStatus('Не сохранилось. Попробуй ещё раз через минуту.');
  }
});

$('fresh').addEventListener('click', () => {
  pushUndo();
  cur = fresh();
  buildRoom(cur.rule.anchor);
  dirty = true;
  syncPanel();
  setStatus('Новая фигура: гни её руками.');
});

// Удаление — вторым нажатием: окна подтверждения на странице нет.
let dropArmed = 0;
$('drop').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('drop');
  if (!saved.has(cur.id)) {
    setStatus('Эта фигура ещё не сохранена — удалять нечего.');
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
    await db.collection('figures').doc(cur.id).delete();
    saved.delete(cur.id);
    setStatus(`Удалено: «${cur.name}».`);
    cur = fresh();
    buildRoom(cur.rule.anchor);
    dirty = true;
    syncPanel();
  } catch {
    setStatus('Не удалилось. Попробуй ещё раз через минуту.');
  }
});

buildRoom(cur.rule.anchor);
syncPanel();
void connect();
/** Для проверок: поза, фигура и где на экране ручка (координаты окна). */
(window as unknown as { __figures: { pose(): Pose; spec(): FigureSpec; grip(h: Grip): [number, number] } }).__figures = {
  pose: () => cur.pose,
  spec: () => cur,
  grip: (h) => {
    const v = grips.get(h)!.getWorldPosition(new THREE.Vector3()).project(cam);
    const r = renderer.domElement.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  },
};
