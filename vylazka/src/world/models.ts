/**
 * Готовые модели в игре: разбор записей из models_data.ts и укладка в сетку реквизита.
 * Модель уже в метрах и в координатах реквизита (пол y = 0, спина z = 0 — см. scripts/import_models.py).
 * Работает и в браузере, и в node (vitest): base64 читаем через atob.
 */
import type { Vec3 } from '../core/types';
import { MAT, MAT_DEFS, hexToLinear } from './materials';
import type { Xf } from './props';
import { MODEL_DATA } from './models_data';

export interface DecodedModel {
  /** Позиции, м, по три числа на вершину. */
  position: Float32Array;
  /** Единичные нормали. */
  normal: Float32Array;
  /** Цвет вершины в линейном пространстве, 0…1, по три числа. */
  color: Float32Array;
  index: Uint16Array;
  min: Vec3;
  max: Vec3;
}

export interface PlaceOpts {
  /** Материал (по умолчанию бумага: ровная матовая основа, цвет даёт оттенок вершины). */
  mat?: number;
  /** Дополнительный множитель оттенка. */
  tint?: Vec3;
  /** Равномерный масштаб относительно начала координат реквизита. */
  scale?: number;
}

const cache = new Map<string, DecodedModel>();
/** Таблица sRGB (0…255) → линейный, чтобы не считать степень на каждую вершину. */
const LIN = new Float32Array(256).map((_, i) => {
  const s = i / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
});

function bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Модель из данных; разбирается один раз. */
export function decodeModel(name: string): DecodedModel {
  const hit = cache.get(name);
  if (hit) return hit;
  const r = MODEL_DATA[name];
  if (!r) throw new Error(`нет такой модели: ${name}`);
  const pos = bytes(r.pos);
  const nrm = bytes(r.nrm);
  const col = bytes(r.col);
  const idx = bytes(r.idx);
  const pq = new Uint16Array(pos.buffer, pos.byteOffset, pos.length >> 1);
  const iq = new Uint16Array(idx.buffer, idx.byteOffset, idx.length >> 1);
  const nv = r.v;
  const position = new Float32Array(nv * 3);
  const normal = new Float32Array(nv * 3);
  const color = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    for (let k = 0; k < 3; k++) {
      position[i * 3 + k] = r.min[k]! + (pq[i * 3 + k]! / 65535) * (r.max[k]! - r.min[k]!);
      // int8: байты 128…255 — отрицательные.
      const s = nrm[i * 3 + k]!;
      normal[i * 3 + k] = (s > 127 ? s - 256 : s) / 127;
      color[i * 3 + k] = LIN[col[i * 3 + k]!]!;
    }
    const l = Math.hypot(normal[i * 3]!, normal[i * 3 + 1]!, normal[i * 3 + 2]!) || 1;
    normal[i * 3] = normal[i * 3]! / l;
    normal[i * 3 + 1] = normal[i * 3 + 1]! / l;
    normal[i * 3 + 2] = normal[i * 3 + 2]! / l;
  }
  const m: DecodedModel = { position, normal, color, index: new Uint16Array(iq), min: [...r.min], max: [...r.max] };
  cache.set(name, m);
  return m;
}

/** Габарит модели (min/max в координатах реквизита, м). */
export function modelBounds(name: string): { min: Vec3; max: Vec3 } {
  const r = MODEL_DATA[name];
  if (!r) throw new Error(`нет такой модели: ${name}`);
  return { min: [...r.min], max: [...r.max] };
}

/** Поворот нормали на столько же четвертей оборота, что и у Xf.pt: (x, z) → (z, −x), (−x, −z), (−z, x). */
function rotNormal(n: Vec3, rot: number): Vec3 {
  if (rot === 1) return [n[2], n[1], -n[0]];
  if (rot === 2) return [-n[0], n[1], -n[2]];
  if (rot === 3) return [-n[2], n[1], n[0]];
  return n;
}

/** Кладёт модель в сетку xf.mb. Оттенок подобран так, чтобы на выбранном материале вышел собственный цвет модели. */
export function placeModel(xf: Xf, name: string, opts: PlaceOpts = {}): void {
  const m = decodeModel(name);
  const mat = opts.mat ?? MAT.paper;
  const base = hexToLinear(MAT_DEFS[mat]!.color);
  const extra = opts.tint ?? [1, 1, 1];
  const s = opts.scale ?? 1;
  const first = xf.mb.vertexCount;
  const n = m.position.length / 3;
  for (let i = 0; i < n; i++) {
    const p = xf.pt(m.position[i * 3]! * s, m.position[i * 3 + 1]! * s, m.position[i * 3 + 2]! * s);
    const nn = rotNormal([m.normal[i * 3]!, m.normal[i * 3 + 1]!, m.normal[i * 3 + 2]!], xf.rot);
    const tint: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) tint[k] = Math.min(2.6, Math.max(0.05, m.color[i * 3 + k]! / base[k]!)) * extra[k]!;
    xf.mb.vertex(p, nn, mat, tint, 1);
  }
  for (let i = 0; i < m.index.length; i += 3) xf.mb.tri(first + m.index[i]!, first + m.index[i + 1]!, first + m.index[i + 2]!);
}
