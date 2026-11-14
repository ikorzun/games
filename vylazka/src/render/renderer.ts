/**
 * Рендер: один материал на весь мир, тень фонаря ручным depth-pass, один пост-проход «бодикам».
 * Сцена рисуется во внутренний буфер фиксированного размера (640×360 … 1280×720 по качеству),
 * canvas имеет тот же размер и растягивается CSS: дёшево для телефона и к лицу записи с камеры.
 */
import * as THREE from 'three';
import type { Vec3 } from '../core/types';
import type { MeshData } from '../world/kit';
import type { LevelChunk, StairLink } from '../world/level';
import { MAT_COUNT, MAT_DEFS } from '../world/materials';
import { bakeDetail } from './detail';
import { bakeGrime } from './grime';
import { ATLAS_COLS, ATLAS_ROWS, bakeMatcapAtlas } from './matcap_atlas';
import { MAX_WORMS } from '../swarm/body';
import { DEPTH_FRAG, DEPTH_VERT, DUST_FRAG, DUST_VERT, HAZE_FRAG, POST_FRAG, POST_VERT, SPOT_FRAG, SWARM_FRAG, SWARM_VERT, WIRE_FRAG, WIRE_VERT, WORLD_FRAG, WORLD_VERT } from './shaders';

export type Quality = 'low' | 'med' | 'high';

export interface QualitySpec {
  /** Число пикселей внутреннего буфера. */
  pixels: number;
  /** Сторона карты тени; 0 — тени выключены. */
  shadow: number;
  chroma: boolean;
  detail: boolean;
  dust: number;
  /** Сколько червей роя рисовать. */
  worms: number;
  /** Дымка в луче: число шагов вдоль взгляда (0 — выключена) и во сколько раз её буфер меньше кадра. */
  haze: number;
  hazeDiv: number;
  /** Предметы режут дымку тенями. */
  hazeShadow: boolean;
}

export const QUALITY: Record<Quality, QualitySpec> = {
  low: { pixels: 640 * 360, shadow: 0, chroma: false, detail: false, dust: 140, worms: 44, haze: 0, hazeDiv: 3, hazeShadow: false },
  med: { pixels: 960 * 540, shadow: 512, chroma: true, detail: true, dust: 300, worms: 68, haze: 8, hazeDiv: 3, hazeShadow: false },
  high: { pixels: 1280 * 720, shadow: 1024, chroma: true, detail: true, dust: 520, worms: MAX_WORMS, haze: 14, hazeDiv: 2, hazeShadow: true },
};

/** Всё, что нужно для одного кадра. */
export interface FrameView {
  camPos: Vec3;
  camYaw: number;
  camPitch: number;
  camRoll: number;
  lightPos: Vec3;
  lightDir: Vec3;
  /** Яркость фонаря, 0..~1.2. */
  lightIntensity: number;
  /** 0 — свежая батарейка (белый свет), 1 — почти села (жёлтый). */
  lightWarmth: number;
  /** Расстояние от фонаря до первой преграды по лучу, м. */
  beamDist: number;
  gain: number;
  noise: number;
  glitch: number;
  tunnel: number;
  /** 0..1: игрок в газу — жёлтая муть. */
  gas: number;
  /** 0..1: насколько здесь сыро и запущено (растёт с глубиной): облезшая краска, ржавчина, плесень. */
  decay: number;
  /** Плотность взвеси в воздухе: насколько виден сам луч. */
  haze: number;
  fade: number;
  time: number;
  frame: number;
  /** Окружение пространства: рассеянный свет, цвет дали (он же фон) и плотность тумана. */
  ambient: Vec3;
  fogColor: Vec3;
  fogDensity: number;
  /** Множитель света фонаря в этом месте: 0 — фонарь «не проходит». */
  lightScale: number;
  /** Множитель плотности облака точек, 0..1: карманное пространство редеет, когда его время выходит. */
  scanFade: number;
  /** Прямой свет пространства: направление на источник (мир) и цвет; цвет [0,0,0] — прямого света нет. */
  keyDir: Vec3;
  keyColor: Vec3;
  /** Докуда рассеянный свет «сканирует» пространство, м: плотно до первого, россыпь после второго. */
  scanRange: [number, number];
  /** 0..1: мир рассыпается в пыль. */
  dissolve: number;
  /** 0..1: красная полигонная сетка на всём, что видно. */
  wire: number;
  /** 0..1: насколько заметен кинескоп. */
  crt: number;
  /** 0..1: кадр выбелен (скачок между пространствами). */
  flash: number;
}

/** Состояние «вещи» — отдельного предмета, который можно двигать, растить и рассыпать. */
export interface ThingView {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  /** 0..1: вещь рассыпается. */
  dissolve: number;
  /** 0..1: красная сетка поверх вещи. */
  wire: number;
  /** Сетка видна сквозь стены. */
  xray: boolean;
  visible: boolean;
}

interface Thing {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  wire: THREE.LineSegments | null;
  wireMat: THREE.ShaderMaterial | null;
  radius: number;
}

/** Рёбра треугольников сетки без повторов: индексы для линий. */
function edgeIndex(index: ArrayLike<number>, vertexCount: number): Uint32Array {
  const seen = new Set<number>();
  const out: number[] = [];
  const push = (a: number, b: number): void => {
    const k = a < b ? a * vertexCount + b : b * vertexCount + a;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(a, b);
  };
  for (let i = 0; i + 2 < index.length; i += 3) {
    const a = index[i]!;
    const b = index[i + 1]!;
    const c = index[i + 2]!;
    push(a, b);
    push(b, c);
    push(c, a);
  }
  return new Uint32Array(out);
}

/** Размер внутреннего буфера под соотношение сторон экрана и бюджет пикселей. */
export function internalSize(cssW: number, cssH: number, pixels: number, dpr = 1): [number, number] {
  const aspect = Math.max(0.3, Math.min(3.5, cssW / Math.max(1, cssH)));
  let h = Math.sqrt(pixels / aspect);
  let w = h * aspect;
  // Больше физического размера экрана рисовать незачем.
  const k = Math.min(1, (cssW * dpr) / w, (cssH * dpr) / h);
  w *= k;
  h *= k;
  return [Math.max(2, Math.round(w / 2) * 2), Math.max(2, Math.round(h / 2) * 2)];
}

/** Вертикальный угол обзора: в ландшафте держим широкий горизонтальный угол, в портрете не даём «рыбьему глазу» разъехаться. */
export function verticalFov(aspect: number): number {
  const hTarget = (106 * Math.PI) / 180;
  const v = 2 * Math.atan(Math.tan(hTarget / 2) / aspect);
  return Math.max(62, Math.min(96, (v * 180) / Math.PI));
}

/**
 * Облако точек (см. SCAN_GLSL). h — «число замеров»: закрытая доля поверхности равна 1 − exp(−h).
 * ghost — h там, куда свет не достаёт (редкие «призрачные» точки: занято около 5 % клеток); perLight —
 * h на единицу освещённости (яркое пятно луча закрыто почти сплошь, в ореоле точки стоят плотно, на
 * краю — россыпью); max — предел (97 %: даже в середине луча остаются редкие дыры, как у настоящего
 * скана); glow — насколько светятся призрачные точки; dot — клетка точек в пикселях буфера высотой
 * 540, dotMin — наименьшая клетка (на низком качестве точки не мельче двух пикселей).
 */
const SCAN = { ghost: 0.05, perLight: 24, max: 3.5, glow: 0.11, dot: 3.0, dotMin: 2.2 } as const;

/** Сколько материалов помещается в массивы шейдера мира (uMatA, uMatB, uMatBase). */
const MAT_SLOTS = 48;

const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const deg = (d: number): number => Math.cos((d * Math.PI) / 180);

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  quality: Quality;
  width = 2;
  height = 2;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  private readonly lightCam = new THREE.PerspectiveCamera(66, 1, 0.08, 34);
  private sceneRT: THREE.WebGLRenderTarget;
  private shadowRT: THREE.WebGLRenderTarget | null = null;
  private readonly worldMat: THREE.ShaderMaterial;
  private signsTex: THREE.Texture;
  private readonly depthMat: THREE.ShaderMaterial;
  private readonly postMat: THREE.ShaderMaterial;
  private readonly hazeMat: THREE.ShaderMaterial;
  private readonly hazeScene = new THREE.Scene();
  /** Цвет освещённого пятна прошлого кадра (2×2): им окрашен отсвет фонаря. */
  private readonly spotRT = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false, stencilBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false });
  private readonly spotScene = new THREE.Scene();
  private spotMat!: THREE.ShaderMaterial;
  private hazeRT: THREE.WebGLRenderTarget | null = null;
  private readonly postScene = new THREE.Scene();
  private readonly postCam = new THREE.Camera();
  private dust: THREE.Points | null = null;
  private readonly dustMat: THREE.ShaderMaterial;
  private readonly swarmMat: THREE.ShaderMaterial;
  private readonly swarmMesh: THREE.Mesh;
  private readonly swarmHead: THREE.InstancedBufferAttribute;
  private readonly swarmDir: THREE.InstancedBufferAttribute;
  private readonly swarmParam: THREE.InstancedBufferAttribute;
  private readonly chunks: THREE.Mesh[] = [];
  /** Геометрия карманного пространства (белое нигде, луг…): рисуется всегда, пока оно активно. */
  private readonly pocket: THREE.Mesh[] = [];
  private readonly things = new Map<number, Thing>();
  private nextThing = 1;
  private readonly wireMat: THREE.ShaderMaterial;
  private readonly clearColor = new THREE.Color(0, 0, 0);
  /** Предметы по ярусам: по одной маленькой геометрии на ярус. */
  /** Имена чанков, которые сейчас скрыты (обвал до обрушения, неактивный вариант комнаты). */
  private readonly hiddenIds = new Set<string>();
  private readonly lightU: Record<string, THREE.IUniform>;
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpM = new THREE.Matrix4();
  private cssW = 1;
  private cssH = 1;
  private lastCalls = 0;
  private lastTris = 0;
  /** Яркость картинки по выбору игрока: множитель усиления камеры. */
  brightness = 1;
  /** Отладка: временно выключить тень, не меняя качество (сравнение «тень вкл/выкл»). */
  debugShadowsOff = false;
  /** Отладка: рисовать мир сплошными поверхностями, без облака точек (для сравнения кадров). */
  private debugScanOff = false;
  /** Перепад между ярусами уровня, м (для отсечения этажей). */
  tierDrop = 4.5;
  /** Дальше этого расстояния чанки не рисуются: свет фонаря туда уже не достаёт. */
  cullDistance = 30;
  private stairs: readonly StairLink[] = [];

  /** Вызывается при потере и восстановлении графического контекста. */
  onContextLost: (() => void) | null = null;
  onContextRestored: (() => void) | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    quality: Quality,
  ) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = true;
    this.renderer.info.autoReset = false;
    this.renderer.setClearColor(0x000000, 1);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.onContextLost?.();
    });
    canvas.addEventListener('webglcontextrestored', () => this.onContextRestored?.());

    // Текстуры запекаются на CPU: детерминированы и переживают потерю контекста.
    const atlas = bakeMatcapAtlas(MAT_DEFS);
    const atlasTex = new THREE.DataTexture(atlas.data, atlas.width, atlas.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    atlasTex.colorSpace = THREE.SRGBColorSpace;
    atlasTex.magFilter = THREE.LinearFilter;
    atlasTex.minFilter = THREE.LinearFilter;
    atlasTex.generateMipmaps = false;
    atlasTex.needsUpdate = true;
    const grimeTex = new THREE.DataTexture(bakeGrime(256), 256, 256, THREE.RGBAFormat, THREE.UnsignedByteType);
    grimeTex.wrapS = THREE.RepeatWrapping;
    grimeTex.wrapT = THREE.RepeatWrapping;
    grimeTex.magFilter = THREE.LinearFilter;
    grimeTex.minFilter = THREE.LinearMipmapLinearFilter;
    grimeTex.generateMipmaps = true;
    grimeTex.needsUpdate = true;
    if (ATLAS_COLS * ATLAS_ROWS < MAT_COUNT || MAT_COUNT > MAT_SLOTS) throw new Error(`атлас matcap меньше числа материалов (или их больше ${MAT_SLOTS} — столько места в шейдере)`);
    // Фактуры: стопка слоёв. Анизотропная фильтрация держит рельеф на стенах, уходящих вдаль.
    const detail = bakeDetail(256);
    const detailTex = new THREE.DataArrayTexture(detail.data, detail.size, detail.size, detail.layers);
    detailTex.format = THREE.RGBAFormat;
    detailTex.type = THREE.UnsignedByteType;
    detailTex.wrapS = THREE.RepeatWrapping;
    detailTex.wrapT = THREE.RepeatWrapping;
    detailTex.magFilter = THREE.LinearFilter;
    detailTex.minFilter = THREE.LinearMipmapLinearFilter;
    detailTex.generateMipmaps = true;
    detailTex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    detailTex.needsUpdate = true;
    grimeTex.anisotropy = detailTex.anisotropy;
    // Атлас надписей и плакатов: пока пустой белый лист, рисуется отдельно (setSigns).
    this.signsTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.signsTex.needsUpdate = true;

    this.lightU = {
      uLightPosV: { value: new THREE.Vector3() },
      uLightDirV: { value: new THREE.Vector3(0, 0, -1) },
      uLightColor: { value: new THREE.Vector3() },
      // Яркое пятно 7–13°, ореол до 25°, слабая засветка до 52°.
      uCone: { value: new THREE.Vector4(deg(7), deg(13), deg(25), deg(52)) },
    };
    const defOf = (i: number): (typeof MAT_DEFS)[number] => MAT_DEFS[i] ?? MAT_DEFS[0]!;
    // Массивы в шейдере — на MAT_SLOTS мест: three.js заливает их целиком, поэтому хвост заполняется нулями.
    const matA = Array.from({ length: MAT_SLOTS }, (_, i) => (i < MAT_COUNT ? new THREE.Vector4(defOf(i).grime, defOf(i).glow ?? 0, defOf(i).layer, 1 / defOf(i).tile) : new THREE.Vector4(0, 0, 0, 1)));
    const matB = Array.from({ length: MAT_SLOTS }, (_, i) => (i < MAT_COUNT ? new THREE.Vector4(defOf(i).bump, defOf(i).decay, defOf(i).alt ?? i, 0) : new THREE.Vector4(0, 0, i, 0)));

    this.worldMat = new THREE.ShaderMaterial({
      vertexShader: WORLD_VERT,
      fragmentShader: WORLD_FRAG,
      uniforms: {
        ...this.lightU,
        uAtlas: { value: atlasTex },
        uGrime: { value: grimeTex },
        uDetail: { value: detailTex },
        uSigns: { value: this.signsTex },
        uDecay: { value: 0.3 },
        uTierDrop: { value: 4.5 },
        uLightRightV: { value: new THREE.Vector3(1, 0, 0) },
        uLightUpV: { value: new THREE.Vector3(0, 1, 0) },
        uShadowMap: { value: null },
        uShadowMatrix: { value: new THREE.Matrix4() },
        uShadowTexel: { value: 1 / 512 },
        uAmbient: { value: new THREE.Vector3(0.0016, 0.0019, 0.0024) },
        uKeyDirV: { value: new THREE.Vector3(0, 1, 0) },
        uKeyColor: { value: new THREE.Vector3(0, 0, 0) },
        uBounce: { value: new THREE.Vector4(0, 0, -1000, 0) },
        uSpot: { value: this.spotRT.texture },
        uFog: { value: 0.035 },
        uFogColor: { value: new THREE.Vector3(0, 0, 0) },
        uDissolve: { value: 0 },
        uThing: { value: new THREE.Vector4(0, 0, 0, 0) },
        uScan: { value: new THREE.Vector4(SCAN.ghost, SCAN.perLight, SCAN.max, SCAN.glow) },
        uDot: { value: SCAN.dot },
        uScanTime: { value: 0 },
        uScanFade: { value: 1 },
        uScanRange: { value: new THREE.Vector2(4, 15) },
        uMatA: { value: matA },
        uMatB: { value: matB },
        uMatBase: { value: Array.from({ length: MAT_SLOTS }, (_, i) => new THREE.Vector3(...(atlas.base[i] ?? [0.5, 0.5, 0.5]))) },
      },
    });
    this.depthMat = new THREE.ShaderMaterial({ vertexShader: DEPTH_VERT, fragmentShader: DEPTH_FRAG, side: THREE.BackSide, colorWrite: false });
    // Красная сетка: распад берёт у мира (одни и те же uniform-объекты), яркость своя.
    this.wireMat = new THREE.ShaderMaterial({
      vertexShader: WIRE_VERT,
      fragmentShader: WIRE_FRAG,
      uniforms: {
        uDissolve: this.worldMat.uniforms.uDissolve!,
        uThing: this.worldMat.uniforms.uThing!,
        uWireColor: { value: new THREE.Vector3(1.0, 0.06, 0.03) },
        uWireAlpha: { value: 0 },
        uTime: { value: 0 },
      },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.dustMat = new THREE.ShaderMaterial({
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      uniforms: { ...this.lightU, uTime: { value: 0 }, uCamPos: { value: new THREE.Vector3() }, uPointScale: { value: 4 }, uBoost: { value: 0 } },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    // Рой: шаблон одного червя (кольца × грани), размноженный инстансами.
    const RINGS = 9;
    const SIDES = 5;
    const tpl: number[] = [];
    const idx: number[] = [];
    for (let r = 0; r < RINGS; r++) {
      for (let k = 0; k < SIDES; k++) {
        const a = (k / SIDES) * Math.PI * 2;
        tpl.push(Math.cos(a), Math.sin(a), r / (RINGS - 1));
      }
    }
    for (let r = 0; r < RINGS - 1; r++) {
      for (let k = 0; k < SIDES; k++) {
        const a = r * SIDES + k;
        const b = r * SIDES + ((k + 1) % SIDES);
        idx.push(a, a + SIDES, b, b, a + SIDES, b + SIDES);
      }
    }
    const sg = new THREE.InstancedBufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tpl), 3));
    sg.setIndex(idx);
    this.swarmHead = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WORMS * 3), 3);
    this.swarmDir = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WORMS * 3), 3);
    this.swarmParam = new THREE.InstancedBufferAttribute(new Float32Array(MAX_WORMS * 2), 2);
    this.swarmHead.setUsage(THREE.DynamicDrawUsage);
    this.swarmDir.setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('iHead', this.swarmHead);
    sg.setAttribute('iDir', this.swarmDir);
    sg.setAttribute('iParam', this.swarmParam);
    sg.instanceCount = 0;
    this.swarmMat = new THREE.ShaderMaterial({
      vertexShader: SWARM_VERT,
      fragmentShader: SWARM_FRAG,
      uniforms: { ...this.lightU, uTime: { value: 0 }, uThick: { value: 0.042 }, uAlpha: { value: 0.85 }, uFog: { value: 0.035 } },
      side: THREE.DoubleSide,
    });
    this.swarmMesh = new THREE.Mesh(sg, this.swarmMat);
    this.swarmMesh.frustumCulled = false;
    // Слой 1: рой не попадает в проход тени — он «призрачный» и тени не отбрасывает.
    this.swarmMesh.layers.set(1);
    this.swarmMesh.visible = false;
    this.scene.add(this.swarmMesh);

    this.postMat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      uniforms: {
        tScene: { value: null },
        uRes: { value: new THREE.Vector2(2, 2) },
        uAspect: { value: 1 },
        uFrame: { value: 0 },
        uGain: { value: 1 },
        uNoise: { value: 0.01 },
        uBarrel: { value: 0.085 },
        uVignette: { value: 1 },
        uGlitch: { value: 0 },
        uTunnel: { value: 0 },
        uFade: { value: 1 },
        uGas: { value: 0 },
        uBeam: { value: new THREE.Vector3(0.5, 0.5, 0) },
        tHaze: { value: null },
        uGrime: { value: grimeTex },
        uHazeTexel: { value: new THREE.Vector2(1, 1) },
        uBloom: { value: 0.1 },
        uCrt: { value: 0 },
        uFlash: { value: 0 },
        tDepth: { value: null },
        uNearFar: { value: new THREE.Vector2(0.05, 120) },
        uEdge: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const postMesh = new THREE.Mesh(tri, this.postMat);
    postMesh.frustumCulled = false;
    this.postScene.add(postMesh);

    this.spotMat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: SPOT_FRAG,
      uniforms: { tScene: { value: null }, uBeam: { value: new THREE.Vector3(0.5, 0.5, 0) }, uLod: { value: 5 }, uAspect: { value: 1 } },
      depthTest: false,
      depthWrite: false,
    });
    const spotMesh = new THREE.Mesh(tri, this.spotMat);
    spotMesh.frustumCulled = false;
    this.spotScene.add(spotMesh);

    this.hazeMat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: HAZE_FRAG,
      uniforms: {
        ...this.lightU,
        tDepth: { value: null },
        uGrime: { value: grimeTex },
        uShadowMap: { value: null },
        uShadowMatrixV: { value: new THREE.Matrix4() },
        uCamRot: { value: new THREE.Matrix3() },
        uCamPos: { value: new THREE.Vector3() },
        uTan: { value: new THREE.Vector2(1, 1) },
        uNearFar: { value: new THREE.Vector2(0.05, 70) },
        uDensity: { value: 0.02 },
        uFrame: { value: 0 },
        uTime: { value: 0 },
      },
      defines: { HAZE_STEPS: 8 },
      depthTest: false,
      depthWrite: false,
    });
    const hazeMesh = new THREE.Mesh(tri, this.hazeMat);
    hazeMesh.frustumCulled = false;
    this.hazeScene.add(hazeMesh);

    this.camera.rotation.order = 'YXZ';
    this.camera.layers.enable(1);
    this.sceneRT = this.makeSceneRT(2, 2);
    this.applyQuality();
  }

  private makeSceneRT(w: number, h: number): THREE.WebGLRenderTarget {
    // Глубина — текстурой: по ней дымка знает, где кончается воздух. Уменьшенные копии кадра нужны ореолу.
    const haze = QUALITY[this.quality].haze > 0;
    const depthTexture = new THREE.DepthTexture(w, h);
    const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, depthTexture, stencilBuffer: false, type: THREE.UnsignedByteType, magFilter: THREE.LinearFilter, minFilter: haze ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, generateMipmaps: haze });
    // sRGB8: в тёмных градиентах нет полос, шейдер пишет линейный цвет, выборка возвращает линейный.
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    return rt;
  }

  private makeHazeRT(w: number, h: number): THREE.WebGLRenderTarget {
    const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, stencilBuffer: false, type: THREE.UnsignedByteType, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    return rt;
  }

  private applyQuality(): void {
    const q = QUALITY[this.quality];
    this.shadowRT?.dispose();
    this.shadowRT = null;
    if (q.shadow > 0) {
      const depth = new THREE.DepthTexture(q.shadow, q.shadow);
      depth.compareFunction = THREE.LessEqualCompare;
      depth.magFilter = THREE.LinearFilter;
      depth.minFilter = THREE.LinearFilter;
      this.shadowRT = new THREE.WebGLRenderTarget(q.shadow, q.shadow, { depthBuffer: true, depthTexture: depth, stencilBuffer: false });
      this.worldMat.uniforms.uShadowTexel!.value = 1 / q.shadow;
    }
    this.worldMat.defines = { ATLAS_ROWS, ...(q.shadow > 0 ? { SHADOWS: '' } : {}), ...(q.detail ? { DETAIL: '' } : {}), ...(this.debugScanOff ? {} : { SCAN: '' }) };
    this.worldMat.needsUpdate = true;
    for (const t of this.things.values()) {
      t.mat.defines = { ...this.worldMat.defines };
      t.mat.needsUpdate = true;
    }
    this.postMat.defines = { ...(q.chroma ? { CHROMA: '' } : {}), ...(q.haze > 0 ? { HAZE: '' } : {}) };
    this.postMat.needsUpdate = true;
    this.hazeMat.defines = { HAZE_STEPS: Math.max(1, q.haze), ...(q.hazeShadow && q.shadow > 0 ? { HAZE_SHADOW: '' } : {}) };
    this.hazeMat.needsUpdate = true;
    this.rebuildDust(q.dust);
    // Буферы зависят от качества (копии кадра, дымка): пересоздаём, даже если размер тот же.
    this.width = 0;
    this.resize(this.cssW, this.cssH);
  }

  private rebuildDust(count: number): void {
    if (this.dust) {
      this.scene.remove(this.dust);
      this.dust.geometry.dispose();
    }
    const seeds = new Float32Array(count * 3);
    // Равномерный разброс без Math.random: кадры повторяемы от запуска к запуску.
    let s = 12345;
    for (let i = 0; i < seeds.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      seeds[i] = s / 4294967296;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    this.dust = new THREE.Points(g, this.dustMat);
    this.dust.frustumCulled = false;
    this.dust.layers.set(1);
    this.scene.add(this.dust);
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.applyQuality();
  }

  /** Размер области показа в пикселях CSS. */
  resize(cssW: number, cssH: number): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const [w, h] = internalSize(this.cssW, this.cssH, QUALITY[this.quality].pixels, dpr);
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.sceneRT.depthTexture?.dispose();
    this.sceneRT.dispose();
    this.sceneRT = this.makeSceneRT(w, h);
    this.hazeRT?.dispose();
    this.hazeRT = null;
    const q = QUALITY[this.quality];
    if (q.haze > 0) {
      const hw = Math.max(2, Math.round(w / q.hazeDiv));
      const hh = Math.max(2, Math.round(h / q.hazeDiv));
      this.hazeRT = this.makeHazeRT(hw, hh);
      this.postMat.uniforms.uHazeTexel!.value.set(1 / hw, 1 / hh);
    }
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.fov = verticalFov(aspect);
    this.camera.updateProjectionMatrix();
    const tanY = Math.tan((this.camera.fov * Math.PI) / 360);
    this.hazeMat.uniforms.uTan!.value.set(tanY * aspect, tanY);
    this.hazeMat.uniforms.uNearFar!.value.set(this.camera.near, this.camera.far);
    this.postMat.uniforms.uRes!.value.set(w, h);
    this.postMat.uniforms.uAspect!.value = aspect;
    (this.postMat.uniforms.uNearFar!.value as THREE.Vector2).set(this.camera.near, this.camera.far);
    this.spotMat.uniforms.uAspect!.value = aspect;
    // Уменьшенная копия, где один тексель — примерно восьмая часть высоты кадра.
    this.spotMat.uniforms.uLod!.value = Math.max(0, Math.log2(h) - 3);
    this.dustMat.uniforms.uPointScale!.value = h / 160;
    this.worldMat.uniforms.uDot!.value = Math.max(SCAN.dotMin, (SCAN.dot * h) / 540);
  }

  /** Отладка: облако точек вкл/выкл. */
  debugScan(on: boolean): void {
    if (this.debugScanOff === !on) return;
    this.debugScanOff = !on;
    this.applyQuality();
  }

  /** Заменить геометрию мира. stairs — лестницы между ярусами: рядом с ними виден соседний ярус. */
  setWorld(chunks: readonly LevelChunk[], stairs: readonly StairLink[] = []): void {
    this.stairs = stairs;
    for (const m of this.chunks) this.dropMesh(m);
    this.chunks.length = 0;
    this.hiddenIds.clear();
    for (const chunk of chunks) {
      const mesh = this.makeMesh(chunk.mesh, chunk.tierMin, chunk.tierMax);
      if (chunk.id) mesh.userData.id = chunk.id;
      if (chunk.id && chunk.hidden) this.hiddenIds.add(chunk.id);
      this.chunks.push(mesh);
      this.scene.add(mesh);
    }
  }

  private makeMesh(data: MeshData, tierMin: number, tierMax: number): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(data.uv, 2));
    g.setAttribute('aColor', new THREE.BufferAttribute(data.color, 4));
    g.setAttribute('aMat', new THREE.BufferAttribute(data.mat, 1));
    g.setIndex(new THREE.BufferAttribute(data.index, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.worldMat);
    mesh.matrixAutoUpdate = false;
    mesh.userData.tierMin = tierMin;
    mesh.userData.tierMax = tierMax;
    return mesh;
  }

  /** Убрать сетку из сцены вместе с её красной сеткой. */
  private dropMesh(m: THREE.Mesh): void {
    const w = m.userData.wire as THREE.LineSegments | undefined;
    if (w) w.geometry.dispose();
    this.scene.remove(m);
    m.geometry.dispose();
  }

  /** Линии рёбер сетки: строятся при первом показе и остаются при ней. */
  private wireFor(m: THREE.Mesh, mat: THREE.ShaderMaterial): THREE.LineSegments {
    const have = m.userData.wire as THREE.LineSegments | undefined;
    if (have) return have;
    const g = new THREE.BufferGeometry();
    const pos = m.geometry.getAttribute('position');
    g.setAttribute('position', pos);
    g.setIndex(new THREE.BufferAttribute(edgeIndex(m.geometry.getIndex()!.array, pos.count), 1));
    g.boundingSphere = m.geometry.boundingSphere;
    const lines = new THREE.LineSegments(g, mat);
    // Слой 1: в проход тени линии не попадают.
    lines.layers.set(1);
    lines.frustumCulled = false;
    m.add(lines);
    m.userData.wire = lines;
    return lines;
  }

  /** Показать карманное пространство (null — убрать). Убежище при этом остаётся в сцене, но оно далеко. */
  setPocket(meshes: readonly MeshData[] | null): void {
    for (const m of this.pocket) this.dropMesh(m);
    this.pocket.length = 0;
    for (const data of meshes ?? []) {
      const mesh = this.makeMesh(data, 0, 0);
      this.pocket.push(mesh);
      this.scene.add(mesh);
    }
  }

  /** Добавить вещь: геометрия вокруг начала координат. Возвращает номер для setThing и removeThing. */
  addThing(data: MeshData, seed = 0): number {
    const mat = this.worldMat.clone();
    // Всё общее — теми же uniform-объектами, что у мира: свет, туман, фактуры обновляются разом.
    for (const k of Object.keys(this.worldMat.uniforms)) mat.uniforms[k] = this.worldMat.uniforms[k]!;
    mat.uniforms.uThing = { value: new THREE.Vector4(0, 0, 0, (seed % 97) * 1.37) };
    mat.defines = { ...this.worldMat.defines };
    const mesh = this.makeMesh(data, 0, 0);
    mesh.material = mat;
    mesh.matrixAutoUpdate = true;
    mesh.visible = false;
    this.scene.add(mesh);
    const id = this.nextThing++;
    this.things.set(id, { mesh, mat, wire: null, wireMat: null, radius: mesh.geometry.boundingSphere?.radius ?? 0.5 });
    return id;
  }

  setThing(id: number, v: ThingView): void {
    const t = this.things.get(id);
    if (!t) return;
    t.mesh.visible = v.visible;
    if (!v.visible) return;
    t.mesh.position.set(v.x, v.y, v.z);
    t.mesh.rotation.set(0, v.yaw, 0);
    t.mesh.scale.setScalar(v.scale);
    (t.mat.uniforms.uThing!.value as THREE.Vector4).x = v.dissolve;
    // Рассыпающаяся вещь тени не отбрасывает.
    t.mesh.layers.set(v.dissolve > 0.4 ? 1 : 0);
    if (v.wire > 0.01) {
      if (!t.wire) {
        t.wireMat = this.wireMat.clone();
        t.wireMat.uniforms.uDissolve = this.worldMat.uniforms.uDissolve!;
        t.wireMat.uniforms.uThing = t.mat.uniforms.uThing!;
        t.wireMat.uniforms.uTime = this.wireMat.uniforms.uTime!;
        t.wire = this.wireFor(t.mesh, t.wireMat);
      }
      t.wire.visible = true;
      t.wireMat!.uniforms.uWireAlpha!.value = v.wire;
      t.wireMat!.depthTest = !v.xray;
    } else if (t.wire) t.wire.visible = false;
  }

  removeThing(id: number): void {
    const t = this.things.get(id);
    if (!t) return;
    this.dropMesh(t.mesh);
    t.mat.dispose();
    t.wireMat?.dispose();
    this.things.delete(id);
  }

  clearThings(): void {
    for (const id of [...this.things.keys()]) this.removeThing(id);
  }

  /**
   * Передать рою позиции на кадр. heads, dirs, params — массивы тела роя; alpha — плотность
   * (0 — роя нет). Сколько червей рисовать, решает качество.
   */
  setSwarm(heads: Float32Array, dirs: Float32Array, params: Float32Array, alpha: number, time: number): void {
    const on = alpha > 0.01;
    this.swarmMesh.visible = on;
    if (!on) return;
    (this.swarmHead.array as Float32Array).set(heads);
    (this.swarmDir.array as Float32Array).set(dirs);
    (this.swarmParam.array as Float32Array).set(params);
    this.swarmHead.needsUpdate = true;
    this.swarmDir.needsUpdate = true;
    this.swarmParam.needsUpdate = true;
    (this.swarmMesh.geometry as THREE.InstancedBufferGeometry).instanceCount = Math.min(MAX_WORMS, QUALITY[this.quality].worms);
    this.swarmMat.uniforms.uAlpha!.value = alpha;
    this.swarmMat.uniforms.uTime!.value = time;
  }

  /** Атлас надписей и плакатов, нарисованный на canvas (render/signs_atlas.ts). */
  setSigns(canvas: HTMLCanvasElement): void {
    this.signsTex.dispose();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    this.signsTex = tex;
    this.worldMat.uniforms.uSigns!.value = tex;
  }

  /** Показать или скрыть именованный чанк (обвал обрушился, комната сменила вариант). */
  setChunkVisible(id: string, on: boolean): void {
    if (on) this.hiddenIds.delete(id);
    else this.hiddenIds.add(id);
  }

  /** Яркость фосфорных надписей: 1 — обычная, 0 — погасли, больше — вспышка. */
  setGlow(k: number): void {
    const params = this.worldMat.uniforms.uMatA!.value as THREE.Vector4[];
    params.forEach((p, i) => {
      p.y = (MAT_DEFS[i]?.glow ?? 0) * k;
    });
  }

  /** Точка мира на экране: x, y в долях кадра (0..1, y вниз); visible — перед камерой и в кадре. */
  project(p: readonly [number, number, number]): { x: number; y: number; visible: boolean } {
    const v = this.tmpV.set(p[0], p[1], p[2]).project(this.camera);
    return { x: v.x * 0.5 + 0.5, y: 0.5 - v.y * 0.5, visible: v.z > -1 && v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1 };
  }

  /** Заранее собрать шейдеры, чтобы первый кадр не подвисал. */
  async warmup(): Promise<void> {
    this.renderer.setRenderTarget(this.sceneRT);
    await this.renderer.compileAsync(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    await this.renderer.compileAsync(this.postScene, this.postCam);
    if (this.hazeRT) await this.renderer.compileAsync(this.hazeScene, this.postCam);
  }

  render(v: FrameView): void {
    const r = this.renderer;
    r.info.reset();

    const cam = this.camera;
    cam.position.set(v.camPos[0], v.camPos[1], v.camPos[2]);
    cam.rotation.set(v.camPitch, v.camYaw, v.camRoll);
    cam.updateMatrixWorld(true);

    // Отсечение чанков: дальше черты видимости всё равно чёрный туман, а чужой ярус виден только
    // с лестницы и от её площадок.
    const tf = -(v.camPos[1] - 1.42) / this.tierDrop;
    const base = Math.round(tf);
    let lo = base;
    let hi = base;
    if (tf - base > 0.12) hi = base + 1;
    else if (base - tf > 0.12) lo = base - 1;
    const near = (p: readonly [number, number, number]): boolean => (p[0] - v.camPos[0]) ** 2 + (p[2] - v.camPos[2]) ** 2 < 16 * 16;
    for (const s of this.stairs) {
      if (s.upperTier === base && near(s.top)) hi = Math.max(hi, base + 1);
      if (s.upperTier + 1 === base && near(s.bottom)) lo = Math.min(lo, base - 1);
    }
    for (const m of this.chunks) {
      const sphere = m.geometry.boundingSphere;
      const far = sphere ? cam.position.distanceTo(sphere.center) - sphere.radius > this.cullDistance : false;
      const hidden = m.userData.id !== undefined && this.hiddenIds.has(m.userData.id as string);
      m.visible = !far && !hidden && (m.userData.tierMax as number) >= lo && (m.userData.tierMin as number) <= hi;
    }
    for (const m of this.pocket) m.visible = true;

    // Красная сетка на всём видимом. Линии строятся по мере надобности: то, что рядом с камерой, — сразу
    // (иначе первый кадр в «сеточной» комнате пуст), дальнее — не больше трёх сеток за кадр.
    this.wireMat.uniforms.uWireAlpha!.value = v.wire;
    this.wireMat.uniforms.uTime!.value = v.time;
    let built = 0;
    for (const m of [...this.chunks, ...this.pocket]) {
      const w = m.userData.wire as THREE.LineSegments | undefined;
      if (v.wire > 0.01 && m.visible) {
        if (w) w.visible = true;
        else {
          const sphere = m.geometry.boundingSphere;
          const near = sphere ? cam.position.distanceTo(sphere.center) - sphere.radius < 7 : true;
          if (near || built < 3) {
            this.wireFor(m, this.wireMat).visible = true;
            if (!near) built += 1;
          }
        }
      } else if (w) w.visible = false;
    }

    // Окружение пространства.
    const wuEnv = this.worldMat.uniforms;
    (wuEnv.uAmbient!.value as THREE.Vector3).set(v.ambient[0], v.ambient[1], v.ambient[2]);
    (wuEnv.uFogColor!.value as THREE.Vector3).set(v.fogColor[0], v.fogColor[1], v.fogColor[2]);
    (wuEnv.uKeyDirV!.value as THREE.Vector3).set(v.keyDir[0], v.keyDir[1], v.keyDir[2]).transformDirection(cam.matrixWorldInverse);
    (wuEnv.uKeyColor!.value as THREE.Vector3).set(v.keyColor[0], v.keyColor[1], v.keyColor[2]);
    wuEnv.uFog!.value = v.fogDensity;
    wuEnv.uDissolve!.value = v.dissolve;
    this.swarmMat.uniforms.uFog!.value = v.fogDensity;
    this.dustMat.uniforms.uBoost!.value = v.dissolve;
    this.clearColor.setRGB(v.fogColor[0], v.fogColor[1], v.fogColor[2]);

    // Фонарь в пространстве камеры.
    const lu = this.lightU;
    (lu.uLightPosV!.value as THREE.Vector3).set(v.lightPos[0], v.lightPos[1], v.lightPos[2]).applyMatrix4(cam.matrixWorldInverse);
    (lu.uLightDirV!.value as THREE.Vector3).set(v.lightDir[0], v.lightDir[1], v.lightDir[2]).transformDirection(cam.matrixWorldInverse);
    // Поверхности в грязи и рельефе отражают меньше, чем ровная краска: фонарь взят с запасом.
    // Лампа фонаря чуть дышит: контакт неидеален, даже когда фонарь «горит ровно».
    const breathe = 1 + 0.018 * Math.sin(v.time * 31.0) + 0.012 * Math.sin(v.time * 7.3 + 1.7);
    const k = 3.3 * v.lightIntensity * v.lightScale * breathe;
    const w = v.lightWarmth;
    (lu.uLightColor!.value as THREE.Vector3).set(k, k * (0.94 - 0.2 * w), k * (0.82 - 0.4 * w));
    // Оси пятна фонаря: по ним ложатся разводы отражателя.
    const wu = this.worldMat.uniforms;
    const right = (wu.uLightRightV!.value as THREE.Vector3).set(-v.lightDir[2], 0, v.lightDir[0]);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const upL = (wu.uLightUpV!.value as THREE.Vector3).set(v.lightDir[0], v.lightDir[1], v.lightDir[2]).cross(right).negate().normalize();
    right.transformDirection(cam.matrixWorldInverse);
    upL.transformDirection(cam.matrixWorldInverse);
    wu.uDecay!.value = v.decay;
    wu.uTierDrop!.value = this.tierDrop;
    wu.uScanTime!.value = v.time;
    const scan = wu.uScan!.value as THREE.Vector4;
    wu.uScanFade!.value = v.scanFade;
    (wu.uScanRange!.value as THREE.Vector2).set(v.scanRange[0], v.scanRange[1]);
    scan.x = SCAN.ghost * v.lightScale;
    // Призрачные точки не разгораются, когда камера в темноте поднимает усиление: темнота остаётся темнотой.
    scan.w = (SCAN.glow * v.lightScale) / Math.max(1, v.gain) ** 0.55;

    // Отсвет от пятна: точка попадания луча и сила, убывающая с расстоянием до стены.
    const hitDist = Math.min(v.beamDist, 30);
    const hit = this.tmpV.set(v.lightPos[0] + v.lightDir[0] * hitDist, v.lightPos[1] + v.lightDir[1] * hitDist, v.lightPos[2] + v.lightDir[2] * hitDist);
    const hitWorld = hit.clone();
    hit.applyMatrix4(cam.matrixWorldInverse);
    const bounce = v.beamDist < 30 ? (0.05 * v.lightIntensity * v.lightScale) / (1 + 0.07 * hitDist * hitDist) : 0;
    (this.worldMat.uniforms.uBounce!.value as THREE.Vector4).set(hit.x, hit.y, hit.z, bounce);

    // Тень: глубина сцены из точки фонаря.
    const shadowOn = this.shadowRT !== null && v.lightIntensity * v.lightScale > 0.01 && !this.debugShadowsOff;
    if (this.shadowRT && shadowOn) {
      const lc = this.lightCam;
      lc.position.set(v.lightPos[0], v.lightPos[1], v.lightPos[2]);
      lc.up.set(0, 1, 0);
      lc.lookAt(v.lightPos[0] + v.lightDir[0], v.lightPos[1] + v.lightDir[1], v.lightPos[2] + v.lightDir[2]);
      lc.updateMatrixWorld(true);
      this.tmpM.multiplyMatrices(lc.projectionMatrix, lc.matrixWorldInverse);
      (this.worldMat.uniforms.uShadowMatrix!.value as THREE.Matrix4).multiplyMatrices(BIAS, this.tmpM);
      this.worldMat.uniforms.uShadowMap!.value = null;
      this.scene.overrideMaterial = this.depthMat;
      r.setRenderTarget(this.shadowRT);
      r.clear();
      r.render(this.scene, lc);
      this.scene.overrideMaterial = null;
      this.worldMat.uniforms.uShadowMap!.value = this.shadowRT.depthTexture;
    } else if (this.shadowRT) {
      // Тень не считается: карта очищается, чтобы в шейдере всё было освещено.
      r.setRenderTarget(this.shadowRT);
      r.clear();
      this.worldMat.uniforms.uShadowMap!.value = this.shadowRT.depthTexture;
    }

    this.dustMat.uniforms.uTime!.value = v.time;
    (this.dustMat.uniforms.uCamPos!.value as THREE.Vector3).copy(cam.position);

    r.setRenderTarget(this.sceneRT);
    r.setClearColor(this.clearColor, 1);
    r.clear();
    r.render(this.scene, cam);
    r.setClearColor(0x000000, 1);

    // Дымка в луче: маленький буфер, по глубине готового кадра.
    if (this.hazeRT) {
      const hu = this.hazeMat.uniforms;
      hu.tDepth!.value = this.sceneRT.depthTexture;
      hu.uShadowMap!.value = shadowOn && this.shadowRT ? this.shadowRT.depthTexture : null;
      (hu.uShadowMatrixV!.value as THREE.Matrix4).multiplyMatrices(this.worldMat.uniforms.uShadowMatrix!.value as THREE.Matrix4, cam.matrixWorld);
      (hu.uCamRot!.value as THREE.Matrix3).setFromMatrix4(cam.matrixWorld);
      (hu.uCamPos!.value as THREE.Vector3).copy(cam.position);
      hu.uDensity!.value = v.lightIntensity * v.lightScale > 0.01 ? v.haze : 0;
      hu.uFrame!.value = v.frame;
      hu.uTime!.value = v.time;
      r.setRenderTarget(this.hazeRT);
      r.render(this.hazeScene, this.postCam);
    }

    // Где на экране центр луча — там светится пыльный воздух.
    const ndc = hitWorld.project(cam);
    const visible = ndc.z < 1 && ndc.z > -1;
    // Цвет освещённого пятна — в маленький буфер: в следующем кадре им окрасится отсвет.
    const su = this.spotMat.uniforms;
    su.tScene!.value = this.sceneRT.texture;
    const inFrame = visible && Math.abs(ndc.x) < 0.95 && Math.abs(ndc.y) < 0.95 && v.lightIntensity * v.lightScale > 0.05 && v.beamDist < 30;
    (su.uBeam!.value as THREE.Vector3).set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5, inFrame ? 1 : 0);
    r.setRenderTarget(this.spotRT);
    r.render(this.spotScene, this.postCam);
    const pu = this.postMat.uniforms;
    pu.tDepth!.value = this.sceneRT.depthTexture;
    (pu.uBeam!.value as THREE.Vector3).set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5, visible ? 0.018 * v.lightIntensity * v.lightScale : 0);
    pu.uCrt!.value = v.crt;
    pu.uFlash!.value = v.flash;
    pu.tScene!.value = this.sceneRT.texture;
    pu.tHaze!.value = this.hazeRT ? this.hazeRT.texture : null;
    pu.uFrame!.value = v.frame;
    pu.uGain!.value = v.gain * this.brightness;
    pu.uNoise!.value = v.noise;
    pu.uGlitch!.value = v.glitch;
    pu.uTunnel!.value = v.tunnel;
    pu.uGas!.value = v.gas;
    pu.uFade!.value = v.fade;
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCam);

    this.lastCalls = r.info.render.calls;
    this.lastTris = r.info.render.triangles;
  }

  info(): { calls: number; triangles: number; width: number; height: number; quality: Quality; programs: number; chunks: number; visible: number } {
    return { calls: this.lastCalls, triangles: this.lastTris, width: this.width, height: this.height, quality: this.quality, programs: this.renderer.info.programs?.length ?? 0, chunks: this.chunks.length, visible: this.chunks.filter((m) => m.visible).length };
  }

  /**
   * Яркость текущего кадра сеткой cols×rows (0..255). Вызывать сразу после render() в том же такте:
   * буфер экрана очищается после показа. Нужна смоуку: «в конусе светло», «тень что-то меняет».
   */
  /**
   * Средний цвет кадра, доля «красных» точек (красный канал заметно сильнее двух других): по ней
   * проверки отличают красную сетку от просто светлой картинки, — и доля тёмных (все каналы ниже 40):
   * по ней видно, что поверхность собрана из точек с пустотой между ними.
   */
  probeColor(): { r: number; g: number; b: number; red: number; dark: number } {
    const gl = this.renderer.getContext();
    const w = this.width;
    const h = this.height;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let r = 0;
    let g = 0;
    let b = 0;
    let red = 0;
    let dark = 0;
    let n = 0;
    for (let o = 0; o < px.length; o += 8) {
      const pr = px[o]!;
      const pg = px[o + 1]!;
      const pb = px[o + 2]!;
      r += pr;
      g += pg;
      b += pb;
      if (pr > 70 && pr > pg * 1.6 && pr > pb * 1.6) red += 1;
      if (pr < 40 && pg < 40 && pb < 40) dark += 1;
      n += 1;
    }
    return { r: r / n, g: g / n, b: b / n, red: red / n, dark: dark / n };
  }

  probe(cols = 32, rows = 18): number[] {
    const gl = this.renderer.getContext();
    const w = this.width;
    const h = this.height;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const out: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = Math.floor((c * w) / cols);
        const x1 = Math.floor(((c + 1) * w) / cols);
        // Строки readPixels идут снизу вверх — переворачиваем, чтобы строка 0 была верхней.
        const y0 = Math.floor(((rows - 1 - r) * h) / rows);
        const y1 = Math.floor(((rows - r) * h) / rows);
        let sum = 0;
        let n = 0;
        for (let y = y0; y < y1; y += 2) {
          for (let x = x0; x < x1; x += 2) {
            const o = (y * w + x) * 4;
            sum += 0.299 * px[o]! + 0.587 * px[o + 1]! + 0.114 * px[o + 2]!;
            n += 1;
          }
        }
        out.push(n > 0 ? sum / n : 0);
      }
    }
    return out;
  }

  /** Потерять и вернуть контекст (проверка восстановления в смоуке). */
  debugLoseContext(restoreAfterMs = 200): void {
    const ext = this.renderer.getContext().getExtension('WEBGL_lose_context');
    if (!ext) return;
    ext.loseContext();
    setTimeout(() => ext.restoreContext(), restoreAfterMs);
  }
}
