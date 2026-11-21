/**
 * Объёмный вид в карточке вещи (бывший «Опросник мебели», tools/mebel): вещь — или пара KayKit, слева та, что сейчас, справа
 * замена, — рядом с силуэтом человека 1,75 м, под светом; тянуть — повернуть, колесо — ближе. Сетка вещи — та же, что на
 * полке и в помещении конструктора (main.ts, geometryOf): собрана кодом игры.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** Рост человека рядом с вещью: тонкий силуэт 1,75 м. */
function person(): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x55606c, roughness: 0.9, transparent: true, opacity: 0.35 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 1.15, 6, 16), m);
  body.position.y = 0.17 + 0.575 + 0.04;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), m);
  head.position.y = 1.64;
  g.add(body, head);
  return g;
}

export interface CardView {
  /** Показать вещи (одну или пару); lift — высота над полом у каждой (настенные висят на своей высоте). */
  show(items: readonly { name: string; lift: number }[]): void;
  /** Кадр: повернуть, если тянут, и нарисовать, если карточка видна. */
  frame(): void;
}

export function cardView(host: HTMLElement, geometryOf: (name: string) => THREE.BufferGeometry, material: THREE.Material): CardView {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x121417);
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe6ef, 0x2a2622, 1.6));
  const key = new THREE.DirectionalLight(0xfff1dc, 2.2);
  key.position.set(2.5, 4, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fb4d0, 0.8);
  rim.position.set(-3, 2, -2);
  scene.add(rim);
  const holder = new THREE.Group();
  scene.add(holder);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 1 });
  const man = person();
  const cam = new THREE.PerspectiveCamera(38, 1, 0.01, 60);
  const controls = new OrbitControls(cam, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.52;
  let w = 0;
  let h = 0;
  new ResizeObserver(() => {
    w = host.clientWidth;
    h = host.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }).observe(host);

  return {
    show(items) {
      holder.clear();
      const boxes = items.map((i) => {
        const b = geometryOf(i.name).boundingBox!.clone();
        return b.translate(new THREE.Vector3(0, i.lift, 0));
      });
      const widths = boxes.map((b) => b.max.x - b.min.x);
      const gap = items.length > 1 ? Math.max(0.25, 0.25 * Math.max(...widths)) : 0;
      const total = widths.reduce((a, b) => a + b, 0) + gap;
      const box = new THREE.Box3();
      let x = -total / 2;
      items.forEach((it, k) => {
        const b = boxes[k]!;
        const mesh = new THREE.Mesh(geometryOf(it.name), material);
        const ox = x - b.min.x;
        const cz = (b.min.z + b.max.z) / 2;
        mesh.position.set(ox, it.lift, -cz);
        holder.add(mesh);
        box.union(b.clone().translate(new THREE.Vector3(ox, 0, -cz)));
        x += widths[k]! + gap;
      });
      const floor = new THREE.Mesh(new THREE.CircleGeometry(Math.max(0.8, total * 0.75), 48), floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.002;
      holder.add(floor);
      man.position.set(box.min.x - 0.45, 0, 0);
      holder.add(man);
      // Кадр: вещь и человек целиком, чуть сверху.
      const all = box.clone().union(new THREE.Box3(new THREE.Vector3(box.min.x - 0.7, 0, -0.2), new THREE.Vector3(box.min.x - 0.2, 1.75, 0.2)));
      const size = all.getSize(new THREE.Vector3());
      const c = all.getCenter(new THREE.Vector3());
      const r = Math.max(size.x, size.y, size.z, 1.2) * 0.62;
      const dist = r / Math.sin((cam.fov * Math.PI) / 360);
      cam.position.set(c.x + dist * 0.45, Math.max(1.0, c.y + dist * 0.3), c.z + dist * 0.85);
      controls.target.copy(c);
      controls.update();
    },
    frame() {
      if (w === 0 || h === 0 || host.offsetParent === null) return;
      controls.update();
      renderer.render(scene, cam);
    },
  };
}
