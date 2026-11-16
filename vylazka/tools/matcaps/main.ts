/**
 * Картинки материалов (слова партнёра: «Покажи манекенов с маткапами в разных шейдерах, включая металл,
 * камень, глянцевый пластик, человеческую кожу, дым, уголь, волосы. Просто картинками, чтобы я понимал
 * возможный уровень рендера»).
 *
 * Тот же манекен, что в игре (world/props_people.ts), в восьми материалах. Маткап — картинка шара,
 * освещённого так, как освещён материал: поверхность берёт цвет по направлению своей нормали к камере.
 * Маткапы здесь рисуются кодом (как атлас игры). Чего маткапом не передать, досчитывает шейдер:
 * у камня — прожилки, у угля — тлеющие трещины и искры, у дыма — шумная плотность в нескольких
 * оболочках, у волос — оболочки с прядями (shell texturing) и блик вдоль волоса.
 *
 * ?view=full — во весь рост, ?view=close — голова и плечи. Готово, когда window.__done === true.
 */
import * as THREE from 'three';
import { POSES } from '../../src/world/props_people';
import type { Pose } from '../../src/world/props_people';
import { figure, materialFor, matcap, PAINTS } from './look';

const params = new URLSearchParams(location.search);
const VIEW = params.get('view') === 'close' ? 'close' : 'full';

interface Cell {
  key: string;
  label: string;
  note: string;
}

const CELLS: Cell[] = [
  { key: 'wood', label: 'Дерево', note: 'как манекен сейчас' },
  { key: 'metal', label: 'Металл', note: 'полированная сталь' },
  { key: 'stone', label: 'Камень', note: 'мрамор, прожилки' },
  { key: 'plastic', label: 'Глянцевый пластик', note: 'красный, блик' },
  { key: 'skin', label: 'Кожа', note: 'свет за терминатором краснеет' },
  { key: 'smoke', label: 'Дым', note: '6 оболочек, шум' },
  { key: 'coal', label: 'Уголь', note: 'трещины, тлеет пятнами, зола' },
  { key: 'hair', label: 'Волосы', note: '40 оболочек, пряди' },
];

const COLS = 4;
const ROWS = 2;
const CW = 400;
const CH = VIEW === 'close' ? 460 : 560;
const W = CW * COLS;
const H = CH * ROWS;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
canvas.style.width = `${W}px`;
canvas.style.height = `${H}px`;
renderer.setClearColor(0x000000, 0);
renderer.autoClear = false;

const pose: Pose = POSES.look as Pose;
const geo = figure(pose);

// Мягкая тень на полу под фигурой.
const shadowMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: { uK: { value: 0.55 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: 'uniform float uK; varying vec2 vUv; void main(){ float r = length(vUv - 0.5) * 2.0; gl_FragColor = vec4(0.0,0.0,0.0, uK * (1.0 - smoothstep(0.15, 1.0, r))); }',
});
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.75), shadowMat);
shadow.rotation.x = -Math.PI / 2;
shadow.position.y = 0.002;

const camera = new THREE.PerspectiveCamera(VIEW === 'close' ? 26 : 27, CW / CH, 0.05, 50);
if (VIEW === 'close') {
  camera.position.set(0.78, 1.66, 1.55);
  camera.lookAt(0, 1.36, 0);
} else {
  camera.position.set(1.75, 1.3, 4.05);
  camera.lookAt(0, 0.86, 0);
}

const labels = document.getElementById('labels')!;
CELLS.forEach((c, i) => {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const scene = new THREE.Scene();
  scene.add(shadow.clone());
  if (c.key === 'smoke') {
    // Плотная середина и пять всё более клочковатых оболочек снаружи.
    const caps = matcap(PAINTS.smoke!);
    for (let s = 0; s < 6; s++) {
      const m = materialFor('smoke', { shell: s * 0.012, level: s / 5, alpha: s === 0 ? 0.9 : 0.42 });
      m.uniforms.uMatcap!.value = caps;
      m.transparent = true;
      m.depthWrite = false;
      m.side = THREE.DoubleSide;
      const mesh = new THREE.Mesh(geo, m);
      mesh.renderOrder = s;
      scene.add(mesh);
    }
    (scene.children[0] as THREE.Mesh).material = shadowMat.clone();
    ((scene.children[0] as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uK!.value = 0.25;
  } else if (c.key === 'hair') {
    const caps = matcap(PAINTS.hair!);
    const N = 40;
    for (let s = 0; s <= N; s++) {
      const m = materialFor('hair', { shell: (s / N) * 0.024, level: s / N });
      m.uniforms.uMatcap!.value = caps;
      scene.add(new THREE.Mesh(geo, m));
    }
  } else {
    scene.add(new THREE.Mesh(geo, materialFor(c.key)));
  }
  renderer.setViewport(col * CW, (ROWS - 1 - row) * CH, CW, CH);
  renderer.setScissor(col * CW, (ROWS - 1 - row) * CH, CW, CH);
  renderer.setScissorTest(true);
  renderer.clear();
  renderer.render(scene, camera);
  const el = document.createElement('div');
  el.className = 'label';
  el.style.left = `${col * CW}px`;
  el.style.top = `${row * CH}px`;
  el.style.width = `${CW}px`;
  el.style.setProperty('--ch', `${CH}px`);
  el.innerHTML = `<b>${c.label}</b><span>${c.note}</span>`;
  labels.append(el);
});

(window as unknown as { __done: boolean }).__done = true;
