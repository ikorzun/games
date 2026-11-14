/**
 * Материалы мира: номер = ячейка в атласе matcap (8×5). Один материал-шейдер на весь мир,
 * номер лежит в вершине — комната рисуется одним вызовом.
 *
 * У материала три стороны: matcap-шар (как он блестит под фонарём), фактура (слой из render/detail.ts:
 * рельеф и пестрота) и род запустения — как он стареет: краска облезает до штукатурки, металл
 * ржавеет, бетон сыреет и покрывается высолами.
 */
import type { Vec3 } from '../core/types';

export const MAT = {
  concrete: 0,
  plaster: 1,
  paintGreen: 2,
  paintBlue: 3,
  rust: 4,
  steel: 5,
  metalGreen: 6,
  rubber: 7,
  wood: 8,
  enamel: 9,
  brass: 10,
  canvas: 11,
  wetConcrete: 12,
  paintRed: 13,
  glow: 14,
  paper: 15,
  floor: 16,
  tile: 17,
  tileFloor: 18,
  brick: 19,
  zinc: 20,
  metalGrey: 21,
  paintOchre: 22,
  bakelite: 23,
  glass: 24,
  leather: 25,
  lagging: 26,
  dirt: 27,
  cardboard: 28,
  castIron: 29,
  print: 30,
  stencil: 31,
  wallpaper: 32,
  parquet: 33,
  linoleum: 34,
  veneer: 35,
  upholstery: 36,
  // Офис: потолочный светильник (светится, пока свет в его клетке включён), ковролин, потолочная плита.
  lamp: 37,
  carpet: 38,
  ceilTile: 39,
} as const;

export type MatId = (typeof MAT)[keyof typeof MAT];
export const MAT_COUNT = 40;

/** Номера слоёв фактур; совпадают с DETAIL в render/detail.ts (тест следит). */
const L = { concrete: 0, plaster: 1, paint: 2, rust: 3, metal: 4, wood: 5, fabric: 6, tile: 7, floor: 8, plastic: 9, paper: 10, brick: 11, dirt: 12, lagging: 13, zinc: 14, smooth: 15, wallpaper: 17, parquet: 18, linoleum: 19, veneer: 20, upholstery: 21 } as const;

/** Род запустения: что шейдер делает с поверхностью со временем. */
export const DECAY = {
  /** Ничего, кроме общей грязи. */
  none: 0,
  /** Краска по стене: трескается и облезает лоскутами до материала alt. */
  paint: 1,
  /** Металл: ржавеет пятнами от швов и кромок до материала alt. */
  metal: 2,
  /** Бетон, штукатурка, кирпич: сыреют, темнеют, покрываются высолами и плесенью; alt — мокрый вид. */
  mineral: 3,
  /** Дерево, ткань, бумага: темнеют от сырости, плесневеют. */
  organic: 4,
  /** Эмаль, плитка, стекло: только плёнка грязи и пыль. */
  glossy: 5,
  /** Печать: цвет берётся из атласа надписей (плакаты, таблички, шкалы). */
  print: 6,
  /** Трафарет: краска по стене, вне букв — прозрачно. */
  stencil: 7,
} as const;

export interface MatDef {
  name: string;
  /** Альбедо, sRGB-hex. */
  color: string;
  /** 0 — зеркальная гладь, 1 — матовая шероховатость. */
  rough: number;
  /** Сила блика. */
  spec: number;
  /** 0..1: металл — блик окрашен, диффузная часть слабая. */
  metal?: number;
  /** Лаковый слой поверх: острый белый блик (масляная краска, мокрое, эмаль). */
  coat?: number;
  /** Ворс: светлеет по краю (ткань, пыль). */
  sheen?: number;
  /** Блик вытянут поперёк (шлифованный и оцинкованный металл). */
  aniso?: number;
  /** Пятнистость самого шара: патина на круглых предметах. */
  mottle?: number;
  /** Сколько грязи ложится на материал, 0..1. */
  grime: number;
  /** Собственное свечение (фосфорная краска), линейная яркость. */
  glow?: number;
  /** Слой фактуры и её масштаб: сколько метров занимает один повтор. */
  layer: number;
  tile: number;
  /** Глубина рельефа, м. */
  bump: number;
  /** Род запустения и материал, который проступает из-под этого. */
  decay: number;
  alt?: number;
}

export const MAT_DEFS: readonly MatDef[] = [
  { name: 'concrete', color: '#8d8b85', rough: 0.95, spec: 0.3, grime: 0.9, layer: L.concrete, tile: 1.2, bump: 0.012, decay: DECAY.mineral, alt: 12 },
  { name: 'plaster', color: '#cbc8bb', rough: 1.0, spec: 0.1, grime: 0.8, layer: L.plaster, tile: 1.0, bump: 0.007, decay: DECAY.mineral, alt: 0 },
  { name: 'paint_green', color: '#4d7561', rough: 0.5, spec: 0.5, coat: 0.5, grime: 0.6, layer: L.paint, tile: 0.8, bump: 0.003, decay: DECAY.paint, alt: 1 },
  { name: 'paint_blue', color: '#4b667b', rough: 0.5, spec: 0.5, coat: 0.5, grime: 0.6, layer: L.paint, tile: 0.8, bump: 0.003, decay: DECAY.paint, alt: 1 },
  { name: 'rust', color: '#7c4526', rough: 0.9, spec: 0.3, mottle: 0.5, grime: 0.85, layer: L.rust, tile: 0.5, bump: 0.006, decay: DECAY.none },
  { name: 'steel', color: '#8e9297', rough: 0.38, spec: 1.0, metal: 0.85, aniso: 0.6, grime: 0.45, layer: L.metal, tile: 0.5, bump: 0.002, decay: DECAY.metal, alt: 4 },
  { name: 'metal_green', color: '#47523b', rough: 0.55, spec: 0.5, coat: 0.3, grime: 0.55, layer: L.metal, tile: 0.6, bump: 0.002, decay: DECAY.metal, alt: 4 },
  { name: 'rubber', color: '#222223', rough: 0.6, spec: 0.6, grime: 0.3, layer: L.plastic, tile: 0.3, bump: 0.001, decay: DECAY.glossy },
  { name: 'wood', color: '#705339', rough: 0.8, spec: 0.3, grime: 0.7, layer: L.wood, tile: 0.8, bump: 0.004, decay: DECAY.organic },
  { name: 'enamel', color: '#d9d9d0', rough: 0.3, spec: 0.6, coat: 0.9, grime: 0.5, layer: L.smooth, tile: 0.5, bump: 0.0008, decay: DECAY.glossy },
  { name: 'brass', color: '#a9883d', rough: 0.32, spec: 1.0, metal: 0.9, grime: 0.4, layer: L.metal, tile: 0.4, bump: 0.0015, decay: DECAY.glossy },
  { name: 'canvas', color: '#6c6951', rough: 1.0, spec: 0.0, sheen: 0.35, grime: 0.6, layer: L.fabric, tile: 0.25, bump: 0.002, decay: DECAY.organic },
  { name: 'wet_concrete', color: '#4c4b48', rough: 0.55, spec: 0.5, coat: 1.0, grime: 0.5, layer: L.floor, tile: 1.5, bump: 0.006, decay: DECAY.none },
  { name: 'paint_red', color: '#8f2c23', rough: 0.45, spec: 0.5, coat: 0.5, grime: 0.5, layer: L.metal, tile: 0.6, bump: 0.002, decay: DECAY.metal, alt: 4 },
  { name: 'glow', color: '#a6dba8', rough: 1.0, spec: 0.0, grime: 0.15, glow: 0.012, layer: L.paint, tile: 0.4, bump: 0.001, decay: DECAY.none },
  { name: 'paper', color: '#c8c1a7', rough: 1.0, spec: 0.0, grime: 0.5, layer: L.paper, tile: 0.4, bump: 0.0015, decay: DECAY.organic },
  { name: 'floor', color: '#7b7872', rough: 0.9, spec: 0.3, grime: 0.9, layer: L.floor, tile: 1.5, bump: 0.008, decay: DECAY.mineral, alt: 12 },
  { name: 'tile', color: '#cfcbb8', rough: 0.25, spec: 0.6, coat: 1.0, grime: 0.6, layer: L.tile, tile: 1.2, bump: 0.004, decay: DECAY.glossy },
  { name: 'tile_floor', color: '#8a5a3c', rough: 0.4, spec: 0.5, coat: 0.6, grime: 0.75, layer: L.tile, tile: 0.8, bump: 0.003, decay: DECAY.glossy },
  { name: 'brick', color: '#8a4a36', rough: 0.95, spec: 0.2, grime: 0.8, layer: L.brick, tile: 1.0, bump: 0.012, decay: DECAY.mineral, alt: 12 },
  { name: 'zinc', color: '#9aa0a2', rough: 0.45, spec: 0.9, metal: 0.7, aniso: 0.4, mottle: 0.25, grime: 0.5, layer: L.zinc, tile: 0.4, bump: 0.001, decay: DECAY.metal, alt: 4 },
  { name: 'metal_grey', color: '#6f7673', rough: 0.5, spec: 0.5, coat: 0.4, grime: 0.55, layer: L.metal, tile: 0.6, bump: 0.002, decay: DECAY.metal, alt: 4 },
  { name: 'paint_ochre', color: '#9a8450', rough: 0.5, spec: 0.5, coat: 0.5, grime: 0.6, layer: L.paint, tile: 0.8, bump: 0.003, decay: DECAY.paint, alt: 1 },
  { name: 'bakelite', color: '#1b1917', rough: 0.3, spec: 0.7, coat: 0.6, grime: 0.35, layer: L.plastic, tile: 0.3, bump: 0.0008, decay: DECAY.glossy },
  { name: 'glass', color: '#27322c', rough: 0.08, spec: 1.0, coat: 1.0, grime: 0.6, layer: L.smooth, tile: 0.4, bump: 0.0005, decay: DECAY.glossy },
  { name: 'leather', color: '#4a3024', rough: 0.55, spec: 0.5, coat: 0.25, grime: 0.5, layer: L.plastic, tile: 0.25, bump: 0.002, decay: DECAY.organic },
  { name: 'lagging', color: '#a39d8a', rough: 1.0, spec: 0.05, sheen: 0.2, grime: 0.85, layer: L.lagging, tile: 0.6, bump: 0.006, decay: DECAY.organic },
  { name: 'dirt', color: '#4f463b', rough: 1.0, spec: 0.05, grime: 0.6, layer: L.dirt, tile: 1.0, bump: 0.03, decay: DECAY.none },
  { name: 'cardboard', color: '#8a7150', rough: 1.0, spec: 0.0, grime: 0.6, layer: L.paper, tile: 0.5, bump: 0.002, decay: DECAY.organic },
  { name: 'cast_iron', color: '#2e2f31', rough: 0.6, spec: 0.8, metal: 0.6, mottle: 0.3, grime: 0.5, layer: L.rust, tile: 0.4, bump: 0.003, decay: DECAY.metal, alt: 4 },
  { name: 'print', color: '#d8d2bd', rough: 1.0, spec: 0.0, grime: 0.55, layer: L.paper, tile: 0.4, bump: 0.001, decay: DECAY.print },
  { name: 'stencil', color: '#e6e2d6', rough: 0.8, spec: 0.2, grime: 0.5, layer: L.paint, tile: 0.8, bump: 0.001, decay: DECAY.stencil },
  // Домашний набор: обои, паркет, линолеум, полированная плита, обивка.
  { name: 'wallpaper', color: '#cfc5aa', rough: 0.9, spec: 0.1, sheen: 0.12, grime: 0.6, layer: L.wallpaper, tile: 1.06, bump: 0.0035, decay: DECAY.paint, alt: 1 },
  { name: 'parquet', color: '#9a7243', rough: 0.34, spec: 0.55, coat: 0.7, grime: 0.7, layer: L.parquet, tile: 1.2, bump: 0.0016, decay: DECAY.organic },
  { name: 'linoleum', color: '#a08d6a', rough: 0.5, spec: 0.4, coat: 0.3, grime: 0.75, layer: L.linoleum, tile: 1.0, bump: 0.0012, decay: DECAY.glossy },
  { name: 'veneer', color: '#80593a', rough: 0.24, spec: 0.7, coat: 0.95, grime: 0.5, layer: L.veneer, tile: 0.8, bump: 0.0006, decay: DECAY.organic },
  { name: 'upholstery', color: '#716d58', rough: 1.0, spec: 0.0, sheen: 0.5, grime: 0.6, layer: L.upholstery, tile: 0.3, bump: 0.003, decay: DECAY.organic },
  // Офисный набор. Светильник светится, как фосфорная краска (оттенок вершины — множитель яркости), но
  // только пока свет в его клетке включён (render: uCellLight). Ковролин — ворс без блика. Потолочная
  // плита — рисунок плитки с шагом 0,6 м (в слое 8 плиток на повтор).
  { name: 'lamp', color: '#e9e8dc', rough: 1.0, spec: 0.0, grime: 0.1, glow: 0.012, layer: L.smooth, tile: 0.5, bump: 0.0005, decay: DECAY.none },
  { name: 'carpet', color: '#6b7068', rough: 1.0, spec: 0.0, sheen: 0.45, grime: 0.65, layer: L.upholstery, tile: 0.45, bump: 0.003, decay: DECAY.organic },
  { name: 'ceil_tile', color: '#d4d2c8', rough: 1.0, spec: 0.05, grime: 0.7, layer: L.tile, tile: 4.8, bump: 0.003, decay: DECAY.mineral, alt: 0 },
];

/** sRGB-hex → линейный цвет. */
export function hexToLinear(hex: string): Vec3 {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [ch((n >> 16) & 255), ch((n >> 8) & 255), ch(n & 255)];
}
