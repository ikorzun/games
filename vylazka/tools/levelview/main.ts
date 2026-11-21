/**
 * Что строит генератор: уровень целиком, сверху под углом, без потолков (разрез), без облака точек,
 * стирания и темноты — то, что получается до того, как игра начинает показывать место «из памяти».
 * Тот же код, что в игре: generateLayout → buildLevel. Подписи — типы помещений.
 *
 * ?world=shelter&seed=20041113&rank=2&tier=0. Готово, когда window.__done === true.
 */
import * as THREE from 'three';
import { generateLayout } from '../../src/gen/layout';
import type { RoomType, WorldKind } from '../../src/gen/layout';
import { buildLevel, cellToWorld, tierFloor } from '../../src/world/level_build';
import { hexToLinear, MAT_DEFS } from '../../src/world/materials';
import { ALL_PROPS } from '../../src/world/props_all';
import { setThingRegistry } from '../../src/world/thing_mesh';

const p = new URLSearchParams(location.search);
const world = (p.get('world') ?? 'shelter') as WorldKind;
const seed = Number(p.get('seed') ?? 20041113) >>> 0;
const rank = Number(p.get('rank') ?? 2) as 1 | 2 | 3;
const tier = Number(p.get('tier') ?? 0);
const W = Number(p.get('w') ?? 1600);
const H = Number(p.get('h') ?? 1100);

const RU: Partial<Record<RoomType, string>> = {
  corridor: 'коридор', entrance: 'вход', airlock: 'шлюз', stairwell: 'лестница', dorm: 'спальный отсек', command: 'пункт управления',
  medical: 'медпункт', storage: 'склад', washroom: 'санузел', fvu: 'ФВУ', diesel: 'дизельная', tanks: 'баки', switchboard: 'щитовая',
  archive: 'архив', collapsed: 'обвал', kitchen: 'кухня', living: 'гостиная', bedroom: 'спальня', bathroom: 'ванная', nursery: 'детская',
  hallway: 'прихожая', lift: 'лифт', reception: 'приёмная', department: 'отдел', cubicles: 'кабинки', meeting: 'переговорная',
  breakroom: 'комната отдыха', manager: 'кабинет', files: 'картотека', copyroom: 'копировальная', server: 'серверная', hall: 'зал',
  vestibule: 'вестибюль', concourse: 'зал ожидания', tickets: 'касса', lockers: 'камеры хранения', buffet: 'буфет', platform: 'перрон', track: 'пути',
};

setThingRegistry(ALL_PROPS);
const layout = generateLayout(seed, rank, world);
const level = buildLevel(layout, { wear: 0 });
const tierY = tierFloor(tier);

const base = MAT_DEFS.map((m) => hexToLinear(m.color));
const scene = new THREE.Scene();
let minX = Infinity;
let maxX = -Infinity;
let minZ = Infinity;
let maxZ = -Infinity;
for (const ch of level.chunks) {
  if (ch.hidden || ch.tierMin > tier || ch.tierMax < tier) continue;
  const m = ch.mesh;
  const n = m.position.length / 3;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const b = base[Math.round(m.mat[i]!)] ?? [0.5, 0.5, 0.5];
    const ao = m.color[i * 4 + 3]!;
    for (let k = 0; k < 3; k++) col[i * 3 + k] = Math.min(1.4, b[k]! * m.color[i * 4 + k]! * (0.45 + 0.55 * ao) * 1.6);
  }
  // Разрез: потолки (грани нормалью вниз) и всё выше 2,5 м над полом яруса не рисуются.
  const idx: number[] = [];
  for (let t = 0; t < m.index.length; t += 3) {
    const a = m.index[t]!;
    const b = m.index[t + 1]!;
    const c = m.index[t + 2]!;
    const ny = (m.normal[a * 3 + 1]! + m.normal[b * 3 + 1]! + m.normal[c * 3 + 1]!) / 3;
    const y = Math.max(m.position[a * 3 + 1]!, m.position[b * 3 + 1]!, m.position[c * 3 + 1]!) - tierY;
    if (ny < -0.6 || y > 2.55 || y < -0.6) continue;
    idx.push(a, b, c);
    for (const v of [a, b, c]) {
      const x = m.position[v * 3]!;
      const z = m.position[v * 3 + 2]!;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
}
scene.add(new THREE.HemisphereLight(0xdfe6ee, 0x3a332c, 1.35));
const sun = new THREE.DirectionalLight(0xfff2e0, 1.6);
sun.position.set(-0.5, 1, 0.35);
scene.add(sun);

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c') as HTMLCanvasElement, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.setClearColor(0x16171a, 1);
const cx = (minX + maxX) / 2;
const cz = (minZ + maxZ) / 2;
const span = Math.max(maxX - minX, (maxZ - minZ) * (W / H)) * 0.56;
const cam = new THREE.OrthographicCamera(-span, span, (span * H) / W, (-span * H) / W, 0.1, 400);
const dir = new THREE.Vector3(0.38, 1, 0.62).normalize();
cam.position.set(cx + dir.x * 120, tierY + dir.y * 120, cz + dir.z * 120);
cam.up.set(0, 1, 0);
cam.lookAt(cx, tierY, cz);
cam.updateMatrixWorld(true);
renderer.render(scene, cam);

// Подписи помещений и отметка начала.
const labels = document.getElementById('labels')!;
const put = (x: number, y: number, z: number, text: string, cls: string): void => {
  const v = new THREE.Vector3(x, y, z).project(cam);
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = text;
  el.style.left = `${((v.x + 1) / 2) * W}px`;
  el.style.top = `${((1 - v.y) / 2) * H}px`;
  labels.append(el);
};
for (const r of layout.rooms) {
  if (r.tier !== tier || r.type === 'corridor') continue;
  const x = r.cells.reduce((s, [a]) => s + cellToWorld(a), 0) / r.cells.length;
  const z = r.cells.reduce((s, [, b]) => s + cellToWorld(b), 0) / r.cells.length;
  put(x, tierY + 0.2, z, RU[r.type] ?? r.type, 'room');
}
put(level.spawn.pos[0], level.spawn.pos[1] + 0.2, level.spawn.pos[2], '● начало', 'start');
document.getElementById('meta')!.textContent = `${world}, сид ${seed}, ранг ${rank}, ярус ${tier + 1} из ${layout.tierCount}: помещений ${layout.rooms.filter((r) => r.tier === tier).length}, проходов ${layout.edges.filter((e) => e.tier === tier).length}, циклов ${layout.loops[tier] ?? 0}`;
(window as unknown as { __done: boolean }).__done = true;
