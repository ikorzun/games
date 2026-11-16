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
import { MeshBuilder } from '../../src/world/kit';
import { Xf } from '../../src/world/props';
import { buildMannequin, POSES } from '../../src/world/props_people';
import type { Pose } from '../../src/world/props_people';

type V3 = [number, number, number];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sat = (x: number): number => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number): number => {
  const t = sat((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const mulv = (a: V3, b: V3): V3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];

const params = new URLSearchParams(location.search);
const VIEW = params.get('view') === 'close' ? 'close' : 'full';

// ───────────────────────────── маткапы ─────────────────────────────

/** Свет студии в координатах камеры: ключ слева сверху, заполняющий справа, контровой сзади сверху. */
const KEY = norm([-0.55, 0.62, 0.56]);
const FILL = norm([0.75, 0.05, 0.45]);
const RIM = norm([0.25, 0.75, -0.62]);
const VIEWV: V3 = [0, 0, 1];
const half = (l: V3): V3 => norm(add(l, VIEWV));
const lam = (n: V3, l: V3): number => Math.max(0, dot(n, l));
const blinn = (n: V3, l: V3, p: number): number => Math.pow(Math.max(0, dot(n, half(l))), p);
const fres = (n: V3, p = 5): number => Math.pow(1 - Math.max(0, n[2]), p);
const reflectV = (n: V3): V3 => {
  const k = 2 * n[2];
  return [n[0] * k, n[1] * k, n[2] * k - 1];
};

/** Окружение для металла: небо светлеет к зениту, резкий горизонт, тёмный пол, два софтбокса. */
function studio(r: V3): V3 {
  const y = r[1];
  const sky: V3 = mul([0.78, 0.84, 0.95], 0.35 + 0.9 * smooth(-0.05, 0.9, y));
  const ground: V3 = mul([0.06, 0.055, 0.05], 1 + 0.6 * smooth(-1, -0.2, y));
  let c: V3 = y > 0 ? sky : ground;
  // Линия горизонта — светлая полоса, как отражённая стена студии.
  c = add(c, mul([1, 0.97, 0.92], 0.55 * Math.exp(-Math.pow(y / 0.035, 2))));
  // Софтбоксы: прямоугольники света слева сверху и справа.
  const box = (d: V3, wx: number, wy: number, k: number): void => {
    const dd = norm(d);
    const ax = norm([dd[2], 0, -dd[0]]);
    const ay = norm([-dd[0] * dd[1], dd[0] * dd[0] + dd[2] * dd[2], -dd[2] * dd[1]]);
    if (dot(r, dd) <= 0) return;
    const u = dot(r, ax) / dot(r, dd);
    const v = dot(r, ay) / dot(r, dd);
    const m = (1 - smooth(wx * 0.8, wx, Math.abs(u))) * (1 - smooth(wy * 0.8, wy, Math.abs(v)));
    c = add(c, mul([1, 0.98, 0.95], k * m));
  };
  box([-0.6, 0.55, 0.6], 0.42, 0.62, 3.2);
  box([0.85, 0.2, 0.3], 0.22, 0.9, 1.6);
  box([0.1, 0.9, -0.4], 0.8, 0.25, 1.2);
  return c;
}

type Paint = (n: V3) => V3;

const PAINTS: Record<string, Paint> = {
  // Бук манекена: мягкий рассеянный свет, слабый блик лака.
  wood: (n) => {
    const base: V3 = [0.62, 0.45, 0.28];
    const d = 0.08 + 0.95 * lam(n, KEY) + 0.25 * lam(n, FILL);
    return add(mul(base, d), mul([1, 0.95, 0.85], 0.18 * blinn(n, KEY, 24) + 0.12 * fres(n) * lam(n, RIM)));
  },
  // Полированная сталь: всё — отражение студии, цвет металла — тонировка отражения.
  metal: (n) => mulv(studio(reflectV(n)), [0.92, 0.95, 1.0]),
  // Светлый мрамор: матовый, с лёгким блеском полировки; прожилки — в шейдере.
  stone: (n) => {
    const base: V3 = [0.82, 0.8, 0.76];
    const w = (dot(n, KEY) + 0.25) / 1.25;
    const d = 0.1 + 0.9 * Math.max(0, w) + 0.2 * lam(n, FILL);
    return add(mul(base, d), mul([1, 1, 1], 0.1 * blinn(n, KEY, 40) + 0.08 * fres(n, 3)));
  },
  // Глянцевый пластик: насыщенный цвет, резкий белый блик, отражение студии по краю.
  plastic: (n) => {
    const base: V3 = [0.62, 0.035, 0.03];
    const d = 0.04 + 0.85 * lam(n, KEY) + 0.18 * lam(n, FILL);
    const f = 0.04 + 0.96 * fres(n, 5);
    return add(add(mul(base, d), mul([1, 1, 1], 1.4 * blinn(n, KEY, 180) + 0.5 * blinn(n, FILL, 120))), mul(studio(reflectV(n)), f * 0.55));
  },
  // Кожа: свет «затекает» за терминатор и краснеет там (подповерхностное рассеяние), широкий мягкий блик.
  skin: (n) => {
    const base: V3 = [0.74, 0.47, 0.35];
    const k = dot(n, KEY);
    const wrap = sat((k + 0.5) / 1.5);
    // Подповерхностное рассеяние: у терминатора свет уходит под кожу и выходит красным.
    const scatter = Math.exp(-Math.pow((k + 0.02) / 0.3, 2));
    let c = mul(mulv(base, [1, 0.96, 0.94]), 0.05 + 1.0 * Math.pow(wrap, 1.4));
    c = add(c, mul([0.62, 0.1, 0.05], 0.6 * scatter));
    c = add(c, mul(base, 0.25 * lam(n, FILL)));
    // Жирный блеск — широкий и неяркий, по краю — светлый пушок.
    c = add(c, mul([1, 0.93, 0.9], 0.16 * blinn(n, KEY, 10) + 0.12 * blinn(n, KEY, 60)));
    c = add(c, mul([1, 0.85, 0.78], 0.3 * fres(n, 3.5) * (0.3 + lam(n, RIM))));
    return c;
  },
  // Дым: мягкий свет сверху, без блика.
  smoke: (n) => {
    const d = 0.35 + 0.55 * sat((dot(n, KEY) + 0.5) / 1.5) + 0.15 * n[1];
    return mul([0.78, 0.79, 0.82], d);
  },
  // Уголь: почти чёрный, тусклый синеватый отблеск по рёбрам.
  coal: (n) => {
    const d = 0.012 + 0.05 * lam(n, KEY);
    return add([d, d, d * 1.05], mul([0.32, 0.36, 0.45], 0.35 * blinn(n, KEY, 30) + 0.2 * fres(n, 3) * lam(n, RIM)));
  },
  // Волосы: тёмно-каштановый, свет через пряди мягкий; блик вдоль волоса — в шейдере.
  hair: (n) => {
    const base: V3 = [0.16, 0.085, 0.045];
    const d = 0.12 + 0.85 * sat((dot(n, KEY) + 0.3) / 1.3) + 0.2 * lam(n, FILL);
    return add(mul(base, d), mul([0.5, 0.36, 0.25], 0.25 * fres(n, 3) * lam(n, RIM)));
  },
};

function matcap(paint: Paint, size = 256): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let u = ((x + 0.5) / size) * 2 - 1;
      let v = 1 - ((y + 0.5) / size) * 2;
      const r = Math.hypot(u, v);
      if (r > 0.995) {
        u *= 0.995 / r;
        v *= 0.995 / r;
      }
      const n: V3 = [u, v, Math.sqrt(Math.max(0, 1 - u * u - v * v))];
      const col = paint(n);
      const i = (y * size + x) * 4;
      // Мягкое ограничение и гамма: в текстуре sRGB.
      for (let k = 0; k < 3; k++) img.data[i + k] = Math.round(255 * Math.pow(sat(col[k]! / (1 + 0.15 * col[k]!)), 1 / 2.2));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ───────────────────────────── шейдеры ─────────────────────────────

const NOISE = /* glsl */ `
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
// Ячейки Вороного: расстояние до ближайшей и второй точки.
vec2 worley(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = vec3(hash3(i + g), hash3(i + g + 7.1), hash3(i + g + 13.7));
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return vec2(d1, d2);
}
`;

const VERT = /* glsl */ `
attribute float ao;
uniform float uShell;   // сдвиг оболочки по нормали, м
varying vec3 vN;        // нормаль в координатах камеры
varying vec3 vView;     // направление на точку из камеры
varying vec3 vObj;      // точка на исходной поверхности (координаты фигуры)
varying vec3 vNObj;
varying float vAo;
void main() {
  vObj = position;
  vNObj = normal;
  vec3 p = position + normal * uShell;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal);
  vView = normalize(mv.xyz);
  vAo = ao;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMatcap;
uniform int uKind;        // 0 обычный маткап, 1 камень, 2 уголь, 3 дым, 4 волосы, 5 кожа
uniform float uLevel;     // уровень оболочки 0..1 (дым, волосы)
uniform float uAlpha;
varying vec3 vN;
varying vec3 vView;
varying vec3 vObj;
varying vec3 vNObj;
varying float vAo;
${NOISE}
vec2 capUv(vec3 n) {
  vec3 x = normalize(vec3(-vView.z, 0.0, vView.x));
  vec3 y = cross(vView, x);
  return vec2(dot(x, n), dot(y, n)) * 0.495 + 0.5;
}
vec3 toneOut(vec3 c) { c = c / (1.0 + 0.12 * c); return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }
void main() {
  vec3 n = normalize(vN);
  vec3 col = texture2D(uMatcap, capUv(n)).rgb;
  float ao = mix(1.0, vAo, 0.7);
  float alpha = 1.0;
  if (uKind == 1) {
    // Мрамор: извилистые прожилки и мелкое зерно.
    float t = vObj.y * 5.0 + vObj.x * 3.0 + fbm(vObj * 3.5) * 5.0;
    float vein = pow(1.0 - abs(sin(t)), 9.0);
    float fine = pow(1.0 - abs(sin(t * 2.7 + fbm(vObj * 9.0) * 3.0)), 30.0);
    col *= 1.0 - 0.38 * vein - 0.18 * fine;
    col *= 0.95 + 0.1 * vnoise(vObj * 180.0);
  } else if (uKind == 2) {
    // Уголь: трещины между ячейками тлеют, на гранях искрятся блёстки.
    // Обугленное дерево: трещины «крокодиловой кожей», в них — чернота; тлеет только часть, пятнами;
    // сверху местами серая зола.
    vec2 w = worley(vObj * 26.0 + fbm(vObj * 4.0) * 0.6);
    float crack = 1.0 - smoothstep(0.0, 0.06, w.y - w.x);
    float heat = smoothstep(0.5, 0.76, fbm(vObj * 4.5 + 3.0));
    float ash = smoothstep(0.55, 0.75, fbm(vObj * 9.0 + 17.0)) * smoothstep(-0.2, 0.6, n.y);
    vec3 ember = mix(vec3(0.7, 0.07, 0.01), vec3(2.8, 1.05, 0.25), heat);
    col *= 1.0 - 0.85 * crack;
    col = mix(col, vec3(0.16, 0.155, 0.15) * (0.4 + 0.6 * max(0.0, dot(n, normalize(vec3(-0.55, 0.62, 0.56))))), ash * 0.8);
    float g = step(0.993, hash3(floor(vObj * 300.0)));
    vec3 hx = normalize(vec3(-0.35, 0.55, 0.75) - vView);
    col += vec3(0.7, 0.75, 0.9) * g * pow(max(0.0, dot(n, hx)), 3.0) * 1.2 * (1.0 - ash);
    // Тлеет и сама поверхность рядом с горячей трещиной — слабым красным.
    float glow = crack * heat * 1.7 + heat * 0.12 * (1.0 - ash);
    col = col * ao + ember * glow;
    gl_FragColor = vec4(toneOut(col), 1.0);
    return;
  } else if (uKind == 3) {
    // Дым: плотность — шум, у силуэта редеет; внешние оболочки — клочья.
    float facing = abs(dot(n, -vView));
    float d = fbm(vObj * 7.0 + vec3(0.0, -uLevel * 2.0, 0.0));
    float lim = mix(0.38, 0.62, uLevel);
    alpha = smoothstep(lim, lim + 0.18, d) * pow(facing, 0.7) * uAlpha;
    col *= 0.85 + 0.3 * d;
    gl_FragColor = vec4(toneOut(col), alpha);
    return;
  } else if (uKind == 4) {
    // Волосы: прядь — клетка в 2,5 мм у исходной поверхности; оболочка держит её, пока прядь выше уровня.
    vec3 down = vec3(0.0, -1.0, 0.0);
    vec3 tObj = normalize(down - vNObj * dot(down, vNObj) + vec3(1e-4));
    vec3 q = (vObj + tObj * uLevel * uLevel * 0.022) * 520.0;
    vec3 cell = floor(q);
    float h = 0.55 + 0.45 * hash3(cell);
    vec3 c0 = vec3(hash3(cell + 3.1), hash3(cell + 5.3), hash3(cell + 9.7));
    float r = length(fract(q) - c0) ;
    // Самый нижний слой — кожа головы под волосами: сплошной и тёмный.
    if (uLevel > 0.001 && (uLevel > h || r > 0.62 * (1.0 - uLevel / h * 0.8))) discard;
    // Блик вдоль волоса (Каджия — Кей): ярко там, где волос поперёк полувектора.
    vec3 tV = normalize((viewMatrix * vec4(tObj, 0.0)).xyz);
    vec3 hv = normalize(normalize(vec3(-0.55, 0.62, 0.56)) - vView);
    float th = dot(tV, hv);
    float spec = pow(sqrt(max(0.0, 1.0 - th * th)), 60.0);
    float spec2 = pow(sqrt(max(0.0, 1.0 - th * th)), 12.0);
    col = col * (0.45 + 0.75 * uLevel) * ao + vec3(0.55, 0.42, 0.3) * spec * 0.6 + vec3(0.35, 0.18, 0.08) * spec2 * 0.25;
    col *= 0.85 + 0.3 * hash3(cell + 1.7);
    gl_FragColor = vec4(toneOut(col), 1.0);
    return;
  } else if (uKind == 5) {
    // Кожа: едва заметная неровность и пятнистость тона.
    col *= 0.96 + 0.06 * vnoise(vObj * 90.0) + 0.04 * (fbm(vObj * 9.0) - 0.5);
  }
  gl_FragColor = vec4(toneOut(col * ao), alpha);
}
`;

// ───────────────────────────── сцена ─────────────────────────────

function figure(pose: Pose): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  buildMannequin(new Xf(mb, null, 0, 0, 0), pose, 11, 3);
  const m = mb.build();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
  const ao = new Float32Array(m.position.length / 3);
  for (let i = 0; i < ao.length; i++) ao[i] = m.color[i * 4 + 3]!;
  g.setAttribute('ao', new THREE.BufferAttribute(ao, 1));
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  g.computeBoundingSphere();
  return g;
}

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
const KIND: Record<string, number> = { wood: 0, metal: 0, plastic: 0, stone: 1, coal: 2, smoke: 3, hair: 4, skin: 5 };

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

function materialFor(key: string, extra: Record<string, number> = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uMatcap: { value: matcap(PAINTS[key]!) },
      uKind: { value: KIND[key] },
      uShell: { value: extra.shell ?? 0 },
      uLevel: { value: extra.level ?? 0 },
      uAlpha: { value: extra.alpha ?? 1 },
    },
  });
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
