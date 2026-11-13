/**
 * Материалы мира: номер = ячейка в атласе matcap (4×4). Один материал-шейдер на весь мир,
 * номер лежит в вершине — комната рисуется одним вызовом.
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
} as const;

export type MatId = (typeof MAT)[keyof typeof MAT];
export const MAT_COUNT = 16;

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
  /** Сколько грязи ложится на материал, 0..1. */
  grime: number;
  /** Собственное свечение (фосфорная краска), линейная яркость. */
  glow?: number;
}

export const MAT_DEFS: readonly MatDef[] = [
  { name: 'concrete', color: '#8d8b85', rough: 0.95, spec: 0.02, grime: 0.9 },
  { name: 'plaster', color: '#cbc8bb', rough: 1.0, spec: 0.0, grime: 0.8 },
  { name: 'paint_green', color: '#4d7561', rough: 0.45, spec: 0.22, grime: 0.6 },
  { name: 'paint_blue', color: '#4b667b', rough: 0.45, spec: 0.22, grime: 0.6 },
  { name: 'rust', color: '#7c4526', rough: 0.85, spec: 0.06, grime: 0.85 },
  { name: 'steel', color: '#8e9297', rough: 0.35, spec: 0.55, metal: 0.8, grime: 0.45 },
  { name: 'metal_green', color: '#47523b', rough: 0.5, spec: 0.2, grime: 0.55 },
  { name: 'rubber', color: '#222223', rough: 0.7, spec: 0.12, grime: 0.3 },
  { name: 'wood', color: '#705339', rough: 0.8, spec: 0.05, grime: 0.7 },
  { name: 'enamel', color: '#d9d9d0', rough: 0.2, spec: 0.5, grime: 0.5 },
  { name: 'brass', color: '#a9883d', rough: 0.3, spec: 0.65, metal: 0.9, grime: 0.4 },
  { name: 'canvas', color: '#6c6951', rough: 1.0, spec: 0.0, grime: 0.6 },
  { name: 'wet_concrete', color: '#4c4b48', rough: 0.15, spec: 0.5, grime: 0.5 },
  { name: 'paint_red', color: '#8f2c23', rough: 0.4, spec: 0.28, grime: 0.5 },
  { name: 'glow', color: '#a6dba8', rough: 1.0, spec: 0.0, grime: 0.15, glow: 0.012 },
  { name: 'paper', color: '#c8c1a7', rough: 1.0, spec: 0.0, grime: 0.5 },
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
