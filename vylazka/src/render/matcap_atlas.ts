/**
 * Атлас matcap-шаров, запечённый на CPU. Шар освещён «от зрителя»: в шейдере мира выборка идёт
 * по направлению на фонарь, поэтому шар и есть вид поверхности под фонарём.
 *
 * Модель шара — как у настоящего материала под соосным светом: матовая часть (шероховатое почти
 * не темнеет к краю, как полная луна), блик по распределению GGX (у металла окрашен), лаковый слой
 * с острым белым бликом, ворс, пятнистость патины. Асимметрия — слабый тёплый отсвет снизу: свет
 * фонаря, отражённый от пола.
 * Чистая функция: детерминирована, проверяется в vitest, переживает потерю WebGL-контекста.
 */
import { clamp01, lerp, linearToSrgb8 } from '../core/math';
import { hash01 } from '../core/rng';
import type { Vec3 } from '../core/types';
import { hexToLinear, MAT_COUNT } from '../world/materials';
import type { MatDef } from '../world/materials';

export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 4;

/** Блик GGX под соосным светом: полувектор совпадает с направлением на фонарь. */
function ggx(z: number, alpha: number): number {
  const a2 = alpha * alpha;
  const d = z * z * (a2 - 1) + 1;
  return a2 / (Math.PI * d * d);
}

/** Плавный шум на сфере: пятна патины не зависят от разрешения шара. */
function sphereNoise(x: number, y: number, z: number, freq: number, seed: number): number {
  const px = (x + 1.5) * freq;
  const py = (y + 1.5) * freq;
  const pz = (z + 1.5) * freq;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const z0 = Math.floor(pz);
  const s = (t: number): number => t * t * (3 - 2 * t);
  const tx = s(px - x0);
  const ty = s(py - y0);
  const tz = s(pz - z0);
  const h = (i: number, j: number, k: number): number => hash01(i * 31 + k * 57, j, seed);
  const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
  return mix(
    mix(mix(h(x0, y0, z0), h(x0 + 1, y0, z0), tx), mix(h(x0, y0 + 1, z0), h(x0 + 1, y0 + 1, z0), tx), ty),
    mix(mix(h(x0, y0, z0 + 1), h(x0 + 1, y0, z0 + 1), tx), mix(h(x0, y0 + 1, z0 + 1), h(x0 + 1, y0 + 1, z0 + 1), tx), ty),
    tz,
  );
}

/** Цвет точки шара с нормалью (nx, ny, nz), nz — к зрителю. Линейное пространство. */
export function shadeMatcap(def: MatDef, base: Vec3, nx: number, ny: number, nz: number, seed = 0): Vec3 {
  const z = clamp01(nz);
  const metal = def.metal ?? 0;
  // Шероховатая поверхность под соосным светом выглядит плоской (как полная луна), гладкая — по Ламберту.
  const diff = lerp(z, Math.pow(z, 0.42), def.rough * 0.75) * (1 - metal * 0.75);
  const alpha = Math.max(0.03, def.rough * def.rough);

  // Блик: у шлифованного металла он растянут поперёк.
  let spec: number;
  const an = def.aniso ?? 0;
  if (an > 0) {
    const len = Math.max(1e-4, Math.hypot(nx, z));
    const hx = -nx / len;
    const hy = (-ny * z) / len;
    const ax = alpha * (1 + an * 2.5);
    const ay = alpha / (1 + an);
    const d = (hx * hx) / (ax * ax) + (hy * hy) / (ay * ay) + z * z;
    spec = 1 / (Math.PI * ax * ay * d * d);
  } else spec = ggx(z, alpha);
  spec *= 0.25 * z * def.spec;
  const coat = (def.coat ?? 0) * 0.04 * 0.25 * z * ggx(z, 0.05);
  const sheen = (def.sheen ?? 0) * Math.pow(1 - z, 2.5) * 0.3;
  // Отсвет от пола на обращённых вниз участках, сильнее у края шара.
  const bounce = Math.max(0, -ny) * (1 - z * 0.6) * 0.07;
  const mottle = def.mottle ? 1 + (sphereNoise(nx, ny, nz, 3.3, seed) * 0.6 + sphereNoise(nx, ny, nz, 9.1, seed + 5) * 0.4 - 0.5) * 2 * def.mottle : 1;
  const warm: Vec3 = [1.0, 0.9, 0.75];
  const out: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const b = base[i]! * mottle;
    const f0 = lerp(0.04, b, metal);
    out[i] = b * diff + f0 * spec + coat + lerp(b, 1, 0.5) * sheen + b * bounce * warm[i]!;
  }
  return out;
}

export interface MatcapAtlas {
  /** RGBA, sRGB, строка 0 — нижняя (как в текстуре WebGL). */
  data: Uint8Array;
  width: number;
  height: number;
  cell: number;
  /** Альбедо материалов, линейное: для ambient-слагаемого и свечения. */
  base: Vec3[];
}

/** Таблица «линейный цвет → sRGB8»: степень на каждый из полутора миллионов каналов считать дорого. */
const SRGB_LUT = new Uint8Array(4097);
for (let i = 0; i <= 4096; i++) SRGB_LUT[i] = linearToSrgb8(i / 4096);
const enc = (v: number): number => SRGB_LUT[Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 4096)]!;

export function bakeMatcapAtlas(defs: readonly MatDef[], cell = 128): MatcapAtlas {
  const width = cell * ATLAS_COLS;
  const height = cell * ATLAS_ROWS;
  const data = new Uint8Array(width * height * 4);
  const base: Vec3[] = [];
  for (let m = 0; m < MAT_COUNT; m++) {
    const def = defs[m] ?? defs[0]!;
    const albedo = hexToLinear(def.color);
    base.push(albedo);
    const col = m % ATLAS_COLS;
    const row = Math.floor(m / ATLAS_COLS);
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
        const c = shadeMatcap(def, albedo, x, y, z, m * 13 + 1);
        const o = ((row * cell + py) * width + col * cell + px) * 4;
        // Блик может быть ярче единицы: в атласе он упирается в белое, как пересвет на записи.
        data[o] = enc(c[0]);
        data[o + 1] = enc(c[1]);
        data[o + 2] = enc(c[2]);
        data[o + 3] = 255;
      }
    }
  }
  return { data, width, height, cell, base };
}
