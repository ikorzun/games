/**
 * Лепка (слова партнёра: «Еще мне нужен какой-то простой инструмент скулптинга или моделинга с полным
 * пониманием ограничений игры»; «Своя лепка в браузере… Ограничения можно встроить прямо в редактор…
 * Мне для MacBook давай делать»). Своя, на three.js; кода SculptGL здесь нет — взят приём (ровная сетка и
 * кисти, симметрия по x, ⌥ — наоборот, ⇧ — гладить), а не программа.
 *
 * Под трекпад MacBook: по вещи — лепить, мимо вещи — крутить; два пальца — крутить, щипок — ближе,
 * ⇧ + два пальца — сдвинуть вид. Вещь — в материале игры (тот же атлас маткапов, что у мира), рядом —
 * человек в рост и клетка плана 3 × 3 м под потолком 2,6 м. Справа — что вещь для игры: материал,
 * крепление, бюджет треугольников, габарит и что не так.
 *
 * Сохранённое лежит в базе страницы (коллекция sculpts) и в её файлах: работа целиком (чтобы лепить
 * дальше) и запись модели игры (world/models_data.ts) — её основная модель забирает в игру.
 */
import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import { bakeMatcapAtlas, ATLAS_COLS } from '../../src/render/matcap_atlas';
import { hexToLinear, MAT_DEFS } from '../../src/world/materials';
import { POSES } from '../../src/world/props_people';
import type { Pose } from '../../src/world/props_people';
import { figure } from '../matcaps/look';
import { box, bounds, BRUSHES, BUDGETS, computeNormals, grabMove, grabStart, loadWork, makeMesh, problems, raycast, saveWork, sphere, stamp, subdivide, tcount, toRecord, vcount } from './core';
import type { Brush, Budget, Grab, Mount, SculptMesh, V3, WorkFile } from './core';

// ───────────────────────────── подписи ─────────────────────────────

const BRUSH_RU: Record<Brush, [string, string]> = {
  draw: ['Тянуть', 'D'],
  inflate: ['Надуть', 'I'],
  smooth: ['Гладить', 'S'],
  flatten: ['Плющить', 'F'],
  pinch: ['Щипать', 'P'],
  grab: ['Двигать', 'G'],
  paint: ['Краска', 'C'],
};
const BRUSH_KEY: Record<string, Brush> = { KeyD: 'draw', KeyI: 'inflate', KeyS: 'smooth', KeyF: 'flatten', KeyP: 'pinch', KeyG: 'grab', KeyC: 'paint' };
/** Материалы игры, из которых имеет смысл лепить (имя в атласе → подпись). */
const MATS: [string, string][] = [
  ['plaster', 'гипс'],
  ['concrete', 'бетон'],
  ['wood', 'дерево'],
  ['veneer', 'лак'],
  ['enamel', 'эмаль'],
  ['steel', 'сталь'],
  ['cast_iron', 'чугун'],
  ['brass', 'латунь'],
  ['rust', 'ржавчина'],
  ['rubber', 'резина'],
  ['bakelite', 'бакелит'],
  ['leather', 'кожа'],
  ['canvas', 'ткань'],
  ['upholstery', 'обивка'],
  ['carpet', 'ворс'],
  ['paper', 'бумага'],
  ['cardboard', 'картон'],
  ['dirt', 'земля'],
];
const MOUNT_RU: Record<Mount, string> = { floor: 'на полу', wall: 'на стене', ceiling: 'под потолком', free: 'свободно' };
const BUDGET_RU: Record<Budget, string> = { small: 'мелочь', thing: 'вещь', big: 'крупная' };
const BASES = [
  ['sphere', 'Шар'],
  ['pillow', 'Подушка'],
  ['slab', 'Плита'],
  ['column', 'Столбик'],
] as const;
type Base = (typeof BASES)[number][0];

const matIndex = (name: string): number => Math.max(0, MAT_DEFS.findIndex((d) => d.name === name));
const nf = (n: number): string => n.toLocaleString('ru-RU');

// ───────────────────────────── состояние ─────────────────────────────

interface Doc {
  id: string;
  name: string;
  mat: string;
  mount: Mount;
  budget: Budget;
  tris: number;
  verts: number;
  size: [number, number, number];
  work: string;
  workUrl: string;
  model: string;
  modelUrl: string;
  at: string;
}

const st = {
  id: freshId(),
  name: '',
  mat: 'plaster',
  mount: 'floor' as Mount,
  budget: 'thing' as Budget,
  brush: 'draw' as Brush,
  radius: 0.06,
  strength: 0.5,
  sym: true,
  paint: '#8a2a20',
  base: 'sphere' as Base,
};

function freshId(): string {
  return `sculpt_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** Заготовка: ровная сетка около 20 тысяч треугольников — в самый раз лепить на MacBook. */
function baseMesh(b: Base): SculptMesh {
  if (b === 'pillow') return box(24, [0.5, 0.5, 0.5], 0.35);
  if (b === 'slab') return box(28, [0.8, 0.12, 0.5], 0.2);
  if (b === 'column') {
    const m = box(20, [0.25, 1.1, 0.25], 0.6);
    return m;
  }
  return sphere(5, 0.25, [0, 0.25, 0]);
}

let mesh = baseMesh('sphere');
/** Кадр надо перерисовать (рисуем только когда что-то изменилось: батарея MacBook скажет спасибо). */
let dirty = true;
for (let i = 0; i < mesh.col.length; i++) mesh.col[i] = 1;

// ───────────────────────────── сцена ─────────────────────────────

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
view.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1012);
const cam = new THREE.PerspectiveCamera(38, 1, 0.02, 60);

// Пол и клетка плана: 3 × 3 м, потолок 2,6 м — как обычное помещение игры.
const grid = new THREE.GridHelper(6, 24, 0x3a4048, 0x23272d);
scene.add(grid);
{
  const g = new THREE.BufferGeometry();
  const H = 2.6;
  const h = 1.5;
  const c: number[] = [];
  const quad = (y: number): void => {
    c.push(-h, y, -h, h, y, -h, h, y, -h, h, y, h, h, y, h, -h, y, h, -h, y, h, -h, y, -h);
  };
  quad(0.002);
  quad(H);
  for (const [x, z] of [[-h, -h], [h, -h], [h, h], [-h, h]]) c.push(x!, 0, z!, x!, H, z!);
  g.setAttribute('position', new THREE.Float32BufferAttribute(c, 3));
  scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x4a515a, transparent: true, opacity: 0.55 })));
}
// Человек в рост — для масштаба (манекен игры, 1,75 м), полупрозрачный.
const human = new THREE.Mesh(figure(POSES.stand as Pose, 2), new THREE.MeshBasicMaterial({ color: 0x7c8590, transparent: true, opacity: 0.16, depthWrite: false }));
human.position.set(-1.05, 0, -0.35);
human.rotation.y = 0.35;
scene.add(human);

// Материал вещи — атлас маткапов игры: так вещь выглядит под фонарём в игре.
const atlas = bakeMatcapAtlas(MAT_DEFS, 96);
const atlasTex = new THREE.DataTexture(atlas.data, atlas.width, atlas.height, THREE.RGBAFormat);
atlasTex.magFilter = THREE.LinearFilter;
atlasTex.minFilter = THREE.LinearFilter;
atlasTex.needsUpdate = true;
const sculptMat = new THREE.ShaderMaterial({
  uniforms: { uAtlas: { value: atlasTex }, uCell: { value: new THREE.Vector2(0, 0) }, uGrid: { value: new THREE.Vector2(ATLAS_COLS, atlas.height / atlas.cell) } },
  vertexShader: /* glsl */ `
    attribute vec3 color;
    varying vec3 vN;
    varying vec3 vC;
    void main() {
      vN = normalize(normalMatrix * normal);
      vC = color;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D uAtlas;
    uniform vec2 uCell;
    uniform vec2 uGrid;
    varying vec3 vN;
    varying vec3 vC;
    void main() {
      vec3 n = normalize(vN);
      vec2 uv = (uCell + (n.xy * 0.49 + 0.5)) / uGrid;
      vec3 m = pow(texture2D(uAtlas, uv).rgb, vec3(2.2));
      vec3 c = m * vC;
      gl_FragColor = vec4(pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
    }`,
});
const geo = new THREE.BufferGeometry();
const sculpt = new THREE.Mesh(geo, sculptMat);
scene.add(sculpt);

function bindMesh(): void {
  geo.setAttribute('position', new THREE.BufferAttribute(mesh.pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(mesh.nrm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(mesh.col, 3));
  geo.setIndex(new THREE.BufferAttribute(mesh.idx, 1));
  geo.computeBoundingSphere();
  dirty = true;
  facts();
}

function touchGeo(): void {
  for (const k of ['position', 'normal', 'color'] as const) (geo.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
  dirty = true;
}

function setMaterial(name: string): void {
  st.mat = name;
  const i = matIndex(name);
  (sculptMat.uniforms.uCell!.value as THREE.Vector2).set(i % ATLAS_COLS, Math.floor(i / ATLAS_COLS));
  dirty = true;
}

// Кольцо кисти на поверхности.
const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 56), new THREE.MeshBasicMaterial({ color: 0xe3b25e, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide }));
ring.renderOrder = 10;
ring.visible = false;
scene.add(ring);

// ───────────────────────────── камера ─────────────────────────────

const camSt = { target: new THREE.Vector3(-0.25, 0.62, 0), yaw: 0.42, pitch: 0.22, dist: 3.1 };
function placeCamera(): void {
  const c = Math.cos(camSt.pitch);
  cam.position.set(camSt.target.x + Math.sin(camSt.yaw) * c * camSt.dist, camSt.target.y + Math.sin(camSt.pitch) * camSt.dist, camSt.target.z + Math.cos(camSt.yaw) * c * camSt.dist);
  cam.lookAt(camSt.target);
  dirty = true;
}
function resize(): void {
  const w = view.clientWidth;
  const h = view.clientHeight;
  renderer.setSize(w, h, false);
  cam.aspect = w / Math.max(1, h);
  cam.updateProjectionMatrix();
  dirty = true;
}
new ResizeObserver(resize).observe(view);

function frameObject(): void {
  const { min, max } = bounds(mesh);
  camSt.target.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  camSt.dist = Math.max(0.6, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * 2.1);
  placeCamera();
}

// ───────────────────────────── отмена ─────────────────────────────

interface Snap {
  pos: Float32Array;
  col: Float32Array;
  idx: Uint32Array;
}
const undoStack: Snap[] = [];
const redoStack: Snap[] = [];
const snap = (): Snap => ({ pos: mesh.pos.slice(), col: mesh.col.slice(), idx: mesh.idx });
function pushUndo(): void {
  undoStack.push(snap());
  if (undoStack.length > 30) undoStack.shift();
  redoStack.length = 0;
}
function restore(s: Snap): void {
  if (s.idx === mesh.idx && s.pos.length === mesh.pos.length) {
    mesh.pos.set(s.pos);
    mesh.col.set(s.col);
    computeNormals(mesh);
    touchGeo();
    geo.computeBoundingSphere();
    facts();
  } else {
    mesh = makeMesh(s.pos.slice(), s.idx, s.col.slice());
    bindMesh();
  }
}
function undo(): void {
  const s = undoStack.pop();
  if (!s) return;
  redoStack.push(snap());
  restore(s);
}
function redo(): void {
  const s = redoStack.pop();
  if (!s) return;
  undoStack.push(snap());
  restore(s);
}

// ───────────────────────────── ввод ─────────────────────────────

const ndc = new THREE.Vector2();
const ray = new THREE.Raycaster();
function rayAt(e: { clientX: number; clientY: number }): { o: V3; d: V3 } {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, cam);
  const o = ray.ray.origin;
  const d = ray.ray.direction;
  return { o: [o.x, o.y, o.z], d: [d.x, d.y, d.z] };
}

const keys = { alt: false, shift: false, space: false };
type Drag =
  | { kind: 'orbit' | 'pan'; x: number; y: number }
  | { kind: 'stroke'; brush: Brush; invert: boolean; last: V3; lastN: V3 }
  | { kind: 'grab'; grab: Grab; start: V3; plane: THREE.Plane };
let drag: Drag | null = null;

function placeRing(p: V3, n: V3): void {
  ring.visible = true;
  ring.position.set(p[0] + n[0] * 0.002, p[1] + n[1] * 0.002, p[2] + n[2] * 0.002);
  ring.lookAt(p[0] + n[0], p[1] + n[1], p[2] + n[2]);
  ring.scale.setScalar(st.radius);
  dirty = true;
}

const canvas = renderer.domElement;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const { o, d } = rayAt(e);
  const pan = e.button === 2 || keys.space || e.metaKey;
  const hit = !pan && e.button === 0 ? raycast(mesh, o, d) : null;
  if (!hit) {
    drag = { kind: pan ? 'pan' : 'orbit', x: e.clientX, y: e.clientY };
    return;
  }
  pushUndo();
  if (st.brush === 'grab' && !keys.shift) {
    const n = new THREE.Vector3();
    cam.getWorldDirection(n);
    drag = { kind: 'grab', grab: grabStart(mesh, hit.p, st.radius, st.sym), start: hit.p, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3(...hit.p)) };
    return;
  }
  const brush: Brush = keys.shift ? 'smooth' : st.brush;
  drag = { kind: 'stroke', brush, invert: keys.alt || e.altKey, last: hit.p, lastN: hit.n };
  doStamp(brush, hit.p, hit.n, keys.alt || e.altKey);
});

function doStamp(brush: Brush, p: V3, n: V3, invert: boolean): void {
  const color = brush === 'paint' ? paintTint() : undefined;
  stamp(mesh, { brush, at: p, n, radius: st.radius, strength: st.strength, invert, ...(color ? { color } : {}) }, st.sym);
  touchGeo();
}

/** Краска хранится оттенком к материалу (как в игре: цвет вершины / цвет материала). */
function paintTint(): V3 {
  const c = hexToLinear(st.paint);
  const b = hexToLinear(MAT_DEFS[matIndex(st.mat)]!.color);
  return [Math.min(2.6, Math.max(0.05, c[0] / b[0])), Math.min(2.6, Math.max(0.05, c[1] / b[1])), Math.min(2.6, Math.max(0.05, c[2] / b[2]))];
}

let hoverQueued: PointerEvent | null = null;
canvas.addEventListener('pointermove', (e) => {
  if (!drag) {
    hoverQueued = e;
    return;
  }
  const dg = drag;
  if (dg.kind === 'orbit' || dg.kind === 'pan') {
    const dx = e.clientX - dg.x;
    const dy = e.clientY - dg.y;
    dg.x = e.clientX;
    dg.y = e.clientY;
    if (dg.kind === 'orbit') {
      camSt.yaw -= dx * 0.008;
      camSt.pitch = Math.max(-1.2, Math.min(1.45, camSt.pitch + dy * 0.008));
    } else panBy(dx, dy);
    placeCamera();
    return;
  }
  const { o, d } = rayAt(e);
  if (dg.kind === 'grab') {
    const q = new THREE.Vector3();
    if (!new THREE.Ray(new THREE.Vector3(...o), new THREE.Vector3(...d)).intersectPlane(dg.plane, q)) return;
    grabMove(mesh, dg.grab, [q.x - dg.start[0], q.y - dg.start[1], q.z - dg.start[2]]);
    touchGeo();
    placeRing([q.x, q.y, q.z], [-d[0], -d[1], -d[2]]);
    return;
  }
  const hit = raycast(mesh, o, d);
  if (!hit) return;
  // Мазки через равные промежутки — треть радиуса: линия ровная при любой скорости руки.
  if (dg.kind !== 'stroke') return;
  const s = dg;
  const gap = st.radius * 0.33;
  const dist = Math.hypot(hit.p[0] - s.last[0], hit.p[1] - s.last[1], hit.p[2] - s.last[2]);
  const steps = Math.min(24, Math.floor(dist / gap));
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const p: V3 = [s.last[0] + (hit.p[0] - s.last[0]) * t, s.last[1] + (hit.p[1] - s.last[1]) * t, s.last[2] + (hit.p[2] - s.last[2]) * t];
    const n: V3 = [s.lastN[0] + (hit.n[0] - s.lastN[0]) * t, s.lastN[1] + (hit.n[1] - s.lastN[1]) * t, s.lastN[2] + (hit.n[2] - s.lastN[2]) * t];
    doStamp(s.brush, p, n, s.invert);
  }
  if (steps > 0) {
    s.last = hit.p;
    s.lastN = hit.n;
  }
  placeRing(hit.p, hit.n);
});

const endDrag = (): void => {
  if (drag && (drag.kind === 'stroke' || drag.kind === 'grab')) {
    computeNormals(mesh);
    touchGeo();
    geo.computeBoundingSphere();
    facts();
    markDirty();
  }
  drag = null;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', () => {
  if (!drag) ring.visible = false;
  dirty = true;
});
canvas.addEventListener('dblclick', frameObject);

function panBy(dx: number, dy: number): void {
  const k = camSt.dist * 0.0016;
  const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
  camSt.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
}

// Трекпад: два пальца — крутить, щипок (ctrlKey) — ближе, ⇧ — сдвинуть. Колесо мыши (крупные целые шаги) — ближе.
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const mouse = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY));
    if (e.ctrlKey || mouse) camSt.dist = Math.max(0.25, Math.min(12, camSt.dist * Math.exp(e.deltaY * (e.ctrlKey ? 0.012 : 0.0015))));
    else if (e.shiftKey) panBy(-e.deltaX, -e.deltaY);
    else {
      camSt.yaw += e.deltaX * 0.005;
      camSt.pitch = Math.max(-1.2, Math.min(1.45, camSt.pitch + e.deltaY * 0.005));
    }
    placeCamera();
  },
  { passive: false },
);

window.addEventListener('keydown', (e) => {
  keys.alt = e.altKey;
  keys.shift = e.shiftKey;
  if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;
  if (e.code === 'Space') {
    keys.space = true;
    e.preventDefault();
  }
  if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if (e.metaKey || e.ctrlKey) return;
  const b = BRUSH_KEY[e.code];
  if (b) setBrush(b);
  else if (e.code === 'BracketLeft') setRadius(st.radius / 1.15);
  else if (e.code === 'BracketRight') setRadius(st.radius * 1.15);
  else if (e.code === 'KeyX') setSym(!st.sym);
});
window.addEventListener('keyup', (e) => {
  keys.alt = e.altKey;
  keys.shift = e.shiftKey;
  if (e.code === 'Space') keys.space = false;
});
window.addEventListener('blur', () => {
  keys.alt = keys.shift = keys.space = false;
});

// ───────────────────────────── панель ─────────────────────────────

function chips<T extends string>(host: HTMLElement, items: readonly (readonly [T, string])[], on: () => T, pick: (v: T) => void, kbd?: (v: T) => string): () => void {
  const btns = items.map(([v, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = label;
    const k = kbd?.(v);
    if (k) {
      const el = document.createElement('kbd');
      el.textContent = k;
      b.append(el);
    }
    b.addEventListener('click', () => {
      pick(v);
      sync();
    });
    host.append(b);
    return [v, b] as const;
  });
  const sync = (): void => {
    for (const [v, b] of btns) b.classList.toggle('is-on', v === on());
  };
  sync();
  return sync;
}

const syncBrush = chips($('brushes'), BRUSHES.map((b) => [b, BRUSH_RU[b][0]] as const), () => st.brush, (b) => (st.brush = b), (b) => BRUSH_RU[b][1]);
function setBrush(b: Brush): void {
  st.brush = b;
  syncBrush();
}
const syncMat = chips($('mats'), MATS.map(([k, ru]) => [k, ru] as const), () => st.mat, (k) => {
  setMaterial(k);
  markDirty();
});
const syncMount = chips($('mounts'), (Object.keys(MOUNT_RU) as Mount[]).map((m) => [m, MOUNT_RU[m]] as const), () => st.mount, (m) => {
  st.mount = m;
  facts();
  markDirty();
});
const syncBudget = chips($('budgets'), (Object.keys(BUDGETS) as Budget[]).map((b) => [b, `${BUDGET_RU[b]} · ${nf(BUDGETS[b])}`] as const), () => st.budget, (b) => {
  st.budget = b;
  facts();
  markDirty();
});
chips($('bases'), BASES, () => st.base, (b) => {
  pushUndo();
  st.base = b;
  mesh = baseMesh(b);
  for (let i = 0; i < mesh.col.length; i++) mesh.col[i] = 1;
  bindMesh();
  frameObject();
  markDirty();
});

const radiusEl = $<HTMLInputElement>('radius');
const strengthEl = $<HTMLInputElement>('strength');
function setRadius(r: number): void {
  st.radius = Math.max(0.01, Math.min(0.4, r));
  radiusEl.value = String(st.radius * 100);
  $('radiusv').textContent = `${(st.radius * 100).toFixed(1)} см`;
  ring.scale.setScalar(st.radius);
  dirty = true;
}
radiusEl.addEventListener('input', () => setRadius(Number(radiusEl.value) / 100));
strengthEl.addEventListener('input', () => {
  st.strength = Number(strengthEl.value);
  $('strengthv').textContent = st.strength.toFixed(2);
});
function setSym(on: boolean): void {
  st.sym = on;
  $('sym').classList.toggle('is-on', on);
}
$('sym').addEventListener('click', () => setSym(!st.sym));
$<HTMLInputElement>('color').addEventListener('input', (e) => {
  st.paint = (e.target as HTMLInputElement).value;
  setBrush('paint');
});
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
$('finer').addEventListener('click', () => {
  if (tcount(mesh) * 4 > 330000) {
    setStatus('Подробнее уже некуда: лепке на MacBook станет тяжело, а игре столько не нужно.');
    return;
  }
  pushUndo();
  mesh = subdivide(mesh);
  bindMesh();
  markDirty();
});

// Высота вещи в игре: ползунок масштабирует её целиком, вещь остаётся на полу.
const heightEl = $<HTMLInputElement>('height');
let scaleFrom: { pos: Float32Array; h: number; min: V3; max: V3 } | null = null;
heightEl.addEventListener('pointerdown', () => {
  pushUndo();
  const b = bounds(mesh);
  scaleFrom = { pos: mesh.pos.slice(), h: b.max[1] - b.min[1], min: b.min, max: b.max };
});
heightEl.addEventListener('input', () => {
  if (!scaleFrom) {
    pushUndo();
    const b = bounds(mesh);
    scaleFrom = { pos: mesh.pos.slice(), h: b.max[1] - b.min[1], min: b.min, max: b.max };
  }
  const k = Number(heightEl.value) / Math.max(1e-4, scaleFrom.h);
  const cx = (scaleFrom.min[0] + scaleFrom.max[0]) / 2;
  const cz = (scaleFrom.min[2] + scaleFrom.max[2]) / 2;
  const y0 = scaleFrom.min[1];
  for (let i = 0; i < mesh.pos.length; i += 3) {
    mesh.pos[i] = cx + (scaleFrom.pos[i]! - cx) * k;
    mesh.pos[i + 1] = y0 + (scaleFrom.pos[i + 1]! - y0) * k;
    mesh.pos[i + 2] = cz + (scaleFrom.pos[i + 2]! - cz) * k;
  }
  touchGeo();
  geo.computeBoundingSphere();
  facts(false);
});
heightEl.addEventListener('change', () => {
  scaleFrom = null;
  facts();
  markDirty();
});

const statusEl = $('status');
const setStatus = (t: string): void => {
  statusEl.textContent = t;
};
const nameEl = $<HTMLInputElement>('name');
nameEl.addEventListener('input', () => {
  st.name = nameEl.value;
  markDirty();
});

let unsaved = false;
function markDirty(): void {
  unsaved = true;
}

/** Габарит, треугольники и что не так — справа и в углу вида. */
function facts(syncHeight = true): void {
  const { min, max } = bounds(mesh);
  const w = max[0] - min[0];
  const dd = max[2] - min[2];
  const h = max[1] - min[1];
  const t = tcount(mesh);
  const budget = BUDGETS[st.budget];
  const toGame = Math.min(t, budget);
  const dl = $('facts');
  const row = (k: string, v: string): string => `<dt>${k}</dt><dd>${v}</dd>`;
  dl.innerHTML =
    row('Размер', `${w.toFixed(2)} × ${dd.toFixed(2)} × ${h.toFixed(2)} м`) +
    row('Сетка', `${nf(t)} треуг., ${nf(vcount(mesh))} вершин`) +
    row('В игру', `≤ ${nf(toGame)} треуг.${t > budget ? ' (упростится)' : ''}`);
  if (syncHeight) {
    heightEl.value = String(Math.min(2.6, Math.max(0.03, h)));
  }
  $('heightv').textContent = `${h.toFixed(2)} м`;
  const bad = problems(mesh, st.mount);
  const ul = $('problems');
  ul.replaceChildren(
    ...bad.map((p) => {
      const li = document.createElement('li');
      li.textContent = p;
      return li;
    }),
  );
  $('badge').innerHTML = `<b>${nf(t)}</b> треуг. · в игру ≤ <b>${nf(toGame)}</b>${bad.length > 0 ? ` · <span style="color:var(--warn)">${bad.length} ${bad.length === 1 ? 'замечание' : 'замечания'}</span>` : ''}`;
  $('density').textContent = `Средний шаг сетки ${edgeCm().toFixed(1)} см. Мельче шага кисть не вылепит — тогда «Подробнее».`;
}

/** Средняя длина ребра, см: насколько мелко можно лепить. */
function edgeCm(): number {
  let s = 0;
  let n = 0;
  for (let f = 0; f < Math.min(tcount(mesh), 4000); f++) {
    const a = mesh.idx[f * 3]! * 3;
    const b = mesh.idx[f * 3 + 1]! * 3;
    s += Math.hypot(mesh.pos[a]! - mesh.pos[b]!, mesh.pos[a + 1]! - mesh.pos[b + 1]!, mesh.pos[a + 2]! - mesh.pos[b + 2]!);
    n++;
  }
  return (s / Math.max(1, n)) * 100;
}

// ───────────────────────────── выгрузка и база страницы ─────────────────────────────

/** Упрощение до бюджета: meshoptimizer, форма и краска вместе. */
function simplify(idx: Uint32Array, pos: Float32Array, target: number): Uint32Array {
  if (!MeshoptSimplifier.supported) return idx;
  const [out] = MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, mesh.col, 3, [0.4, 0.4, 0.4], null, target, 0.02);
  return out;
}

/** Сетка для игры: краска — абсолютным цветом (запись модели хранит цвет вершины). */
function forGame(): SculptMesh {
  const base = hexToLinear(MAT_DEFS[matIndex(st.mat)]!.color);
  const col = new Float32Array(mesh.col.length);
  for (let i = 0; i < col.length; i++) col[i] = mesh.col[i]! * base[i % 3]!;
  return { ...mesh, col };
}

type Snapshot = { docs: { id: string; data(): Record<string, unknown> | undefined }[]; metadata: { fromCache: boolean } };
type DbNs = { collection(p: string): { doc(id: string): { set(d: Record<string, unknown>): Promise<void>; delete(): Promise<void> }; onSnapshot(n: (s: Snapshot) => void, e?: (err: { code: string }) => void): () => void } };
type AssetsNs = { upload(b: Blob): Promise<{ id: string; url: string }>; delete(id: string): Promise<void> };
let db: DbNs | null = null;
let assets: AssetsNs | null = null;
let canWrite = true;
const saved = new Map<string, Doc>();

function renderSaved(): void {
  $('saved').replaceChildren(
    ...[...saved.values()]
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((d) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `chip${d.id === st.id ? ' is-on' : ''}`;
        b.textContent = `${d.name} · ${nf(d.tris)}`;
        b.addEventListener('click', () => void open(d));
        return b;
      }),
  );
}

async function open(d: Doc): Promise<void> {
  setStatus(`Открываю «${d.name}»…`);
  try {
    const r = await fetch(d.workUrl);
    const w = (await r.json()) as WorkFile;
    pushUndo();
    mesh = loadWork(w);
    st.id = d.id;
    st.name = d.name;
    nameEl.value = d.name;
    st.mount = d.mount;
    st.budget = d.budget;
    setMaterial(d.mat);
    syncMat();
    syncMount();
    syncBudget();
    bindMesh();
    frameObject();
    renderSaved();
    unsaved = false;
    setStatus(`Открыто: «${d.name}».`);
  } catch {
    setStatus('Не открылось: файл вещи не загрузился. Попробуй ещё раз.');
  }
}

async function connect(): Promise<void> {
  const claude = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
  if (!claude?.use) {
    setStatus('Вещи не сохраняются: страница открыта не в Claude. Лепить можно и так.');
    return;
  }
  db = (await claude.use('db')) as DbNs | null;
  assets = (await claude.use('assets')) as AssetsNs | null;
  const user = (await claude.use('user')) as { can?(n: string): Promise<boolean | null> } | null;
  if (!db || !assets) {
    setStatus('Сохранять сейчас нельзя: войди в Claude (нужно право правки страницы). Лепить можно и так.');
    return;
  }
  const can = user?.can ? await user.can('data.write') : null;
  canWrite = can !== false;
  const timer = window.setTimeout(() => setStatus('Сохранённые вещи пока не загрузились — проверь связь.'), 10000);
  db.collection('sculpts').onSnapshot(
    (s) => {
      if (!s.metadata.fromCache) window.clearTimeout(timer);
      saved.clear();
      for (const d of s.docs) {
        const v = d.data() as unknown as Doc | undefined;
        if (v && typeof v.workUrl === 'string' && typeof v.name === 'string') saved.set(d.id, v);
      }
      renderSaved();
    },
    () => {
      window.clearTimeout(timer);
      setStatus('Сохранённые вещи не загрузились. Обнови страницу позже.');
    },
  );
}

$('save').addEventListener('click', async () => {
  if (!st.name.trim()) st.name = `Вещь ${saved.size + 1}`;
  nameEl.value = st.name;
  if (!db || !assets || !canWrite) {
    setStatus('Сохранить не выйдет: база страницы недоступна.');
    return;
  }
  setStatus('Упрощаю для игры и сохраняю…');
  try {
    await MeshoptSimplifier.ready;
    const { record, tris, verts } = toRecord(forGame(), st.mount, BUDGETS[st.budget], simplify);
    const work = await assets.upload(new Blob([JSON.stringify(saveWork(mesh))], { type: 'application/json' }));
    const model = await assets.upload(new Blob([JSON.stringify({ name: st.name.trim(), mat: st.mat, mount: st.mount, record })], { type: 'application/json' }));
    const { min, max } = bounds(mesh);
    const prev = saved.get(st.id);
    const doc: Doc = {
      id: st.id,
      name: st.name.trim(),
      mat: st.mat,
      mount: st.mount,
      budget: st.budget,
      tris,
      verts,
      size: [+(max[0] - min[0]).toFixed(3), +(max[2] - min[2]).toFixed(3), +(max[1] - min[1]).toFixed(3)],
      work: work.id,
      workUrl: work.url,
      model: model.id,
      modelUrl: model.url,
      at: new Date().toISOString(),
    };
    await db.collection('sculpts').doc(st.id).set(doc as unknown as Record<string, unknown>);
    // Прежние файлы этой вещи больше никому не нужны.
    if (prev) {
      for (const id of [prev.work, prev.model]) await assets.delete(id).catch(() => undefined);
    }
    saved.set(doc.id, doc);
    renderSaved();
    unsaved = false;
    setStatus(`Сохранено: «${doc.name}» — в игру уйдёт ${nf(tris)} треугольников.`);
  } catch (err) {
    setStatus(`Не сохранилось${err instanceof Error && err.message.startsWith('вершин') ? `: ${err.message}` : ''}. Попробуй ещё раз через минуту.`);
  }
});

$('fresh').addEventListener('click', () => {
  pushUndo();
  st.id = freshId();
  st.name = '';
  nameEl.value = '';
  mesh = baseMesh(st.base);
  for (let i = 0; i < mesh.col.length; i++) mesh.col[i] = 1;
  bindMesh();
  frameObject();
  renderSaved();
  unsaved = false;
  setStatus('Новая вещь: лепи.');
});

// Удаление — вторым нажатием: окон подтверждения на странице нет.
let dropArmed = 0;
$('drop').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('drop');
  const d = saved.get(st.id);
  if (!d) {
    setStatus('Эта вещь ещё не сохранена — удалять нечего.');
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
  if (!db || !assets) return;
  try {
    await db.collection('sculpts').doc(d.id).delete();
    for (const id of [d.work, d.model]) await assets.delete(id).catch(() => undefined);
    saved.delete(d.id);
    renderSaved();
    setStatus(`Удалено: «${d.name}».`);
  } catch {
    setStatus('Не удалилось. Попробуй ещё раз через минуту.');
  }
});

window.addEventListener('beforeunload', (e) => {
  if (unsaved && saved.size > 0) e.preventDefault();
});

// ───────────────────────────── цикл ─────────────────────────────

function loop(): void {
  requestAnimationFrame(loop);
  if (hoverQueued && !drag) {
    const { o, d } = rayAt(hoverQueued);
    hoverQueued = null;
    const hit = raycast(mesh, o, d);
    if (hit) placeRing(hit.p, hit.n);
    else if (ring.visible) {
      ring.visible = false;
      dirty = true;
    }
  }
  if (!dirty) return;
  dirty = false;
  renderer.render(scene, cam);
}

setMaterial(st.mat);
setRadius(st.radius);
strengthEl.value = String(st.strength);
$('strengthv').textContent = st.strength.toFixed(2);
setSym(st.sym);
bindMesh();
resize();
placeCamera();
loop();
void connect();
(window as unknown as { __sculpt: unknown }).__sculpt = {
  st,
  mesh: () => mesh,
  stroke: (brush: Brush, from: V3, to: V3, n: V3, invert = false) => {
    pushUndo();
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      doStamp(brush, [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t], n, invert);
    }
    computeNormals(mesh);
    touchGeo();
    facts();
  },
  material: (k: string) => {
    setMaterial(k);
    syncMat();
  },
  exportRecord: async () => {
    await MeshoptSimplifier.ready;
    return toRecord(forGame(), st.mount, BUDGETS[st.budget], simplify);
  },
};
