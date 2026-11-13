/**
 * Атлас matcap-шаров, запечённый на CPU. Шар освещён «от зрителя»: в шейдере мира выборка идёт
 * по направлению на фонарь, поэтому шар и есть вид поверхности под фонарём. Асимметрия шара —
 * слабая тёплая подсветка снизу: свет фонаря, отражённый от пола.
 * Чистая функция: детерминирована, проверяется в vitest, переживает потерю WebGL-контекста.
 */
import { clamp01, lerp, linearToSrgb8 } from '../core/math';
import type { Vec3 } from '../core/types';
import { hexToLinear, MAT_COUNT } from '../world/materials';
import type { MatDef } from '../world/materials';

export const ATLAS_GRID = 4;

/** Цвет точки шара с нормалью (nx, ny, nz), nz — к зрителю. Линейное пространство. */
export function shadeMatcap(def: MatDef, base: Vec3, nx: number, ny: number, nz: number): Vec3 {
  void nx;
  const z = clamp01(nz);
  // Шероховатая поверхность под соосным светом выглядит плоской (как полная луна), гладкая — по Ламберту.
  const diff = lerp(z, Math.pow(z, 0.42), def.rough * 0.75);
  const shininess = lerp(260, 6, Math.pow(def.rough, 0.6));
  const spec = def.spec * Math.pow(z, shininess) * (1 + (1 - def.rough) * 1.5);
  const metal = def.metal ?? 0;
  // Отсвет от пола на обращённых вниз участках, сильнее у края шара.
  const bounce = Math.max(0, -ny) * (1 - z * 0.6) * 0.07;
  const warm: Vec3 = [1.0, 0.9, 0.75];
  const out: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const b = base[i]!;
    out[i] = b * diff * (1 - metal * 0.7) + lerp(1, b, metal) * spec + b * bounce * warm[i]!;
  }
  return out;
}

export interface MatcapAtlas {
  /** RGBA, sRGB, строка 0 — нижняя (как в текстуре WebGL). */
  data: Uint8Array;
  size: number;
  cell: number;
  /** Альбедо материалов, линейное: для ambient-слагаемого и свечения. */
  base: Vec3[];
}

export function bakeMatcapAtlas(defs: readonly MatDef[], cell = 128): MatcapAtlas {
  const size = cell * ATLAS_GRID;
  const data = new Uint8Array(size * size * 4);
  const base: Vec3[] = [];
  for (let m = 0; m < MAT_COUNT; m++) {
    const def = defs[m] ?? defs[0]!;
    const albedo = hexToLinear(def.color);
    base.push(albedo);
    const col = m % ATLAS_GRID;
    const row = Math.floor(m / ATLAS_GRID);
    for (let py = 0; py < cell; py++) {
      for (let px = 0; px < cell; px++) {
        let x = ((px + 0.5) / cell) * 2 - 1;
        let y = ((py + 0.5) / cell) * 2 - 1;
        const r2 = x * x + y * y;
        let z = 0;
        if (r2 >= 1) {
          // За кругом повторяем цвет края: линейная фильтрация не подмешает мусор.
          const r = Math.sqrt(r2);
          x /= r;
          y /= r;
        } else z = Math.sqrt(1 - r2);
        const c = shadeMatcap(def, albedo, x, y, z);
        const o = ((row * cell + py) * size + col * cell + px) * 4;
        data[o] = linearToSrgb8(c[0]);
        data[o + 1] = linearToSrgb8(c[1]);
        data[o + 2] = linearToSrgb8(c[2]);
        data[o + 3] = 255;
      }
    }
  }
  return { data, size, cell, base };
}
