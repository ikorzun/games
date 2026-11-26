/**
 * Фигура партнёра в игре: манекен в его позе и его материале (world/figures.ts), собранный вокруг начала
 * координат — как в конструкторе (tools/constructor): подошвы стоящего на y = 0, лицом к +z.
 *
 * Фигура живёт по тем же законам скана, что и всё остальное: это «вещь» рендера (render/renderer.ts,
 * addThing) — облако точек следует за ней, свет и туман общие, распад идёт пылью. Особенное у двух
 * материалов (слова партнёра):
 * - волосатая растворяется «от рук к телу» — поэтому она собрана частями тела, каждая часть отдельной
 *   вещью, и у каждой своя задержка (HAIR_ORDER); ворс — слоями, тем же приёмом, что мох (world/moss.ts);
 * - дымная — из редких точек (uDots у вещи): сквозь неё видно, она висит в воздухе и рассеивается при
 *   подходе (systems/figures.ts).
 * Остальные — цельная вещь в своём материале.
 *
 * Чистый TS: читают игра и тесты.
 */
import type { Vec3 } from '../core/types';
import type { FigureMaterial } from './figures';
import { MeshBuilder } from './kit';
import type { MeshData } from './kit';
import { MAT } from './materials';
import { Xf } from './props';
import { mannequin, PARTS, skeleton, skeletonPoints } from './props_people';
import type { MannequinPaint, Part, Pose } from './props_people';

/** Краска тела и суставов для каждого материала; дерево — родной бук манекена (краски нет). */
export const FIGURE_PAINT: Record<Exclude<FigureMaterial, 'wood'>, MannequinPaint> = {
  // Камень: бледный, как гипсовый слепок, суставы — темнее, забитые пылью.
  stone: { body: { mat: MAT.concrete, tint: [0.98, 0.96, 0.92] }, joint: { mat: MAT.concrete, tint: [0.66, 0.65, 0.62] } },
  // Металл: сталь, суставы — чугунные.
  metal: { body: { mat: MAT.steel, tint: [0.86, 0.87, 0.9] }, joint: { mat: MAT.castIron, tint: [0.55, 0.55, 0.57] } },
  // Уголь: почти чёрная резина, без блеска.
  coal: { body: { mat: MAT.rubber, tint: [0.2, 0.2, 0.22] }, joint: { mat: MAT.rubber, tint: [0.13, 0.13, 0.14] } },
  // Кожа: тёплая выделанная кожа, суставы — темнее.
  skin: { body: { mat: MAT.leather, tint: [1.02, 0.84, 0.72] }, joint: { mat: MAT.leather, tint: [0.82, 0.64, 0.54] } },
  // Пластик: глянцевая красная эмаль.
  plastic: { body: { mat: MAT.enamel, tint: [0.86, 0.2, 0.16] }, joint: { mat: MAT.enamel, tint: [0.66, 0.15, 0.12] } },
  // Дым: светлая штукатурка — из неё остаются одни редкие точки.
  smoke: { body: { mat: MAT.plaster, tint: [0.74, 0.75, 0.78] }, joint: { mat: MAT.plaster, tint: [0.7, 0.71, 0.74] } },
  // Волосы: тёмно-каштановый ворс; основание темнее, кончики светлее (furred).
  hair: { body: { mat: MAT.carpet, tint: [0.62, 0.42, 0.28] }, joint: { mat: MAT.carpet, tint: [0.54, 0.36, 0.24] } },
};

/**
 * Волосатая растворяется «от рук к телу» (слова партнёра): задержка каждой части от начала, с. Кисти,
 * предплечья, плечи, потом ступни, голени, бёдра, тело и последней — голова. Левая и правая — вразнобой,
 * чуть врозь: так это читается как распад, а не как анимация.
 */
export const HAIR_ORDER: Readonly<Record<Part, number>> = {
  handL: 0,
  handR: 0.14,
  foreL: 0.32,
  foreR: 0.46,
  upperL: 0.66,
  upperR: 0.78,
  footL: 0.98,
  footR: 1.08,
  shinL: 1.22,
  shinR: 1.32,
  thighL: 1.46,
  thighR: 1.56,
  torso: 1.84,
  head: 2.24,
};

/** Сколько слоёв ворса у волосатой, его высота и насколько кончики свисают вниз, м. */
export const HAIR_SHELLS = 8;
export const HAIR_PILE = 0.026;
const HAIR_DROOP = 0.02;
/**
 * Масштаб uv ворса: шейдер берёт ворсинку клеткой uv·260 (render/shaders.ts, vShell) — у мха это 4 мм.
 * Волос в полтора-два раза толще, иначе издали он сливается в шум кадра.
 */
const HAIR_UV = 0.5;

/** Насколько редки точки дымной: 1 — одни точки (render, uDots). */
export const SMOKE_DOTS = 0.72;

/** Кусок фигуры для рендера: часть тела (у волосатой) или вся фигура разом. */
export interface FigurePiece {
  part: Part | 'body';
  data: MeshData;
  /** Через сколько после начала распада этот кусок начинает растворяться, с. */
  delay: number;
}

export interface FigureMesh {
  pieces: FigurePiece[];
  /** Редкость точек (дымная) или 0. */
  dots: number;
  /** Габариты позы над точкой фигуры: низ и верх, м. */
  low: number;
  top: number;
  /** Середина тела в координатах фигуры: от неё меряется, подошёл ли игрок. */
  core: Vec3;
  /** Точки скелета в координатах фигуры: по ним расстановка проверяет, не вросла ли фигура в мебель. */
  points: Vec3[];
}

/**
 * Ворс слоями: поверхность повторена HAIR_SHELLS раз, каждый слой чуть дальше по нормали и чуть ниже
 * (кончики свисают). В канале качания у вершин слоя — его уровень со знаком минус (так шейдер узнаёт
 * слой; ветер такие вершины не трогает). Основание тёмное, кончики светлее.
 */
export function furred(d: MeshData): MeshData {
  const n = d.position.length / 3;
  const L = HAIR_SHELLS + 1;
  const position = new Float32Array(n * 3 * L);
  const normal = new Float32Array(n * 3 * L);
  const color = new Float32Array(n * 4 * L);
  const mat = new Float32Array(n * L);
  const uv = new Float32Array(n * 2 * L);
  const sway = new Float32Array(n * L);
  const index = new Uint32Array(d.index.length * L);
  for (let s = 0; s < L; s++) {
    const level = s / HAIR_SHELLS;
    const out = HAIR_PILE * level;
    const down = HAIR_DROOP * level * level;
    const tone = 0.72 + 0.62 * level;
    for (let i = 0; i < n; i++) {
      const o = (s * n + i) * 3;
      for (let k = 0; k < 3; k++) {
        position[o + k] = d.position[i * 3 + k]! + d.normal[i * 3 + k]! * out - (k === 1 ? down : 0);
        normal[o + k] = d.normal[i * 3 + k]!;
      }
      const c = (s * n + i) * 4;
      color[c] = d.color[i * 4]! * tone;
      color[c + 1] = d.color[i * 4 + 1]! * tone;
      color[c + 2] = d.color[i * 4 + 2]! * tone;
      color[c + 3] = d.color[i * 4 + 3]! * (0.55 + 0.45 * level);
      mat[s * n + i] = d.mat[i]!;
      uv[(s * n + i) * 2] = d.uv[i * 2]! * HAIR_UV;
      uv[(s * n + i) * 2 + 1] = d.uv[i * 2 + 1]! * HAIR_UV;
      sway[s * n + i] = s === 0 ? 0 : -level;
    }
    for (let j = 0; j < d.index.length; j++) index[s * d.index.length + j] = d.index[j]! + s * n;
  }
  return { position, normal, color, mat, uv, index, sway };
}

/** Собрать фигуру: поза, материал, сид (разброс тона), подробность сетки (1 — как у манекенов места). */
export function figureMesh(pose: Pose, material: FigureMaterial, seed: number, detail = 1): FigureMesh {
  const paint = material === 'wood' ? undefined : FIGURE_PAINT[material];
  const s = skeleton(pose);
  const points = skeletonPoints(s);
  const low = Math.min(...points.map((p) => p[1])) - 0.03;
  const top = Math.max(...points.map((p) => p[1])) + 0.01;
  const core: Vec3 = [s.waist[0], s.waist[1], s.waist[2]];
  let pieces: FigurePiece[];
  if (material === 'hair') {
    const mbs = new Map<Part, MeshBuilder>(PARTS.map((p) => [p, new MeshBuilder()]));
    const xfs = new Map<Part, Xf>(PARTS.map((p) => [p, new Xf(mbs.get(p)!, null, 0, 0, 0, 0)]));
    mannequin((part) => xfs.get(part)!, pose, seed, detail, paint);
    pieces = PARTS.map((part) => ({ part, data: furred(mbs.get(part)!.build()), delay: HAIR_ORDER[part] }));
  } else {
    const mb = new MeshBuilder();
    const xf = new Xf(mb, null, 0, 0, 0, 0);
    mannequin(() => xf, pose, seed, detail, paint);
    pieces = [{ part: 'body', data: mb.build(), delay: 0 }];
  }
  return { pieces, dots: material === 'smoke' ? SMOKE_DOTS : 0, low, top, core, points };
}
