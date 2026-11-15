/**
 * Тайловые шумовые поля, из которых на CPU собираются все текстуры игры. Только целочисленный хеш:
 * картинка одинакова на любом устройстве и переживает потерю графического контекста.
 *
 * Поле — квадратный Float32Array со значениями 0..1, бесшовный по обеим осям. Поля считаются один раз
 * и потом читаются с целым множителем частоты (тогда бесшовность сохраняется), поэтому десяток
 * разных текстур стоит немногим дороже одной.
 */
import { hash01 } from '../core/rng';

export interface Field {
  size: number;
  data: Float32Array;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Фрактальный шум: octaves октав, начиная с px×py периодов на сторону. */
export function fbmField(size: number, px: number, py: number, octaves: number, seed: number): Field {
  if ((size & (size - 1)) !== 0) throw new Error('сторона шумового поля должна быть степенью двойки');
  const data = new Float32Array(size * size);
  let amp = 0.5;
  let norm = 0;
  let fx = px;
  let fy = py;
  for (let o = 0; o < octaves; o++) {
    // Решётка случайных значений октавы.
    const lat = new Float32Array(fx * fy);
    for (let j = 0; j < fy; j++) for (let i = 0; i < fx; i++) lat[j * fx + i] = hash01(i, j, seed + o * 17);
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * fy;
      const y0 = Math.floor(gy);
      const ty = smooth(gy - y0);
      const r0 = (y0 % fy) * fx;
      const r1 = ((y0 + 1) % fy) * fx;
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * fx;
        const x0 = Math.floor(gx);
        const tx = smooth(gx - x0);
        const c0 = x0 % fx;
        const c1 = (x0 + 1) % fx;
        const a = lat[r0 + c0]!;
        const b = lat[r0 + c1]!;
        const c = lat[r1 + c0]!;
        const d = lat[r1 + c1]!;
        data[y * size + x]! += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
      }
    }
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
    if (fx > size || fy > size) break;
  }
  for (let i = 0; i < data.length; i++) data[i] = data[i]! / norm;
  return { size, data };
}

/**
 * Градиентный (перлинов) фрактальный шум. У шума «случайные числа в узлах решётки» (fbmField) пятна
 * выходят угловатыми — ромбами и квадратами по осям решётки; после растяжки контраста это видно на
 * стене как камуфляж. Здесь в узлах лежат не числа, а направления: пятна круглее и разной формы.
 * Значения — около 0..1 (точный разброс потом подгоняют под нужный, см. matchField).
 */
export function gradField(size: number, px: number, py: number, octaves: number, seed: number): Field {
  if ((size & (size - 1)) !== 0) throw new Error('сторона шумового поля должна быть степенью двойки');
  const data = new Float32Array(size * size);
  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
  let amp = 0.5;
  let norm = 0;
  let fx = px;
  let fy = py;
  for (let o = 0; o < octaves; o++) {
    const gx = new Float32Array(fx * fy);
    const gy = new Float32Array(fx * fy);
    for (let j = 0; j < fy; j++) {
      for (let i = 0; i < fx; i++) {
        const a = hash01(i, j, seed + o * 31) * Math.PI * 2;
        gx[j * fx + i] = Math.cos(a);
        gy[j * fx + i] = Math.sin(a);
      }
    }
    for (let y = 0; y < size; y++) {
      const v = (y / size) * fy;
      const y0 = Math.floor(v);
      const dy = v - y0;
      const ty = fade(dy);
      const r0 = (y0 % fy) * fx;
      const r1 = ((y0 + 1) % fy) * fx;
      for (let x = 0; x < size; x++) {
        const u = (x / size) * fx;
        const x0 = Math.floor(u);
        const dx = u - x0;
        const tx = fade(dx);
        const c0 = x0 % fx;
        const c1 = (x0 + 1) % fx;
        const a = gx[r0 + c0]! * dx + gy[r0 + c0]! * dy;
        const b = gx[r0 + c1]! * (dx - 1) + gy[r0 + c1]! * dy;
        const c = gx[r1 + c0]! * dx + gy[r1 + c0]! * (dy - 1);
        const d = gx[r1 + c1]! * (dx - 1) + gy[r1 + c1]! * (dy - 1);
        data[y * size + x]! += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
      }
    }
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
    if (fx > size || fy > size) break;
  }
  for (let i = 0; i < data.length; i++) data[i] = Math.max(0, Math.min(1, (data[i]! / norm) * 0.75 + 0.5));
  return { size, data };
}

/** Увести поле в стороны по другому полю (оба бесшовные — результат тоже): пятна теряют правильность. amount — доля стороны. */
export function warpField(f: Field, by: Field, amount: number): Field {
  const n = f.size;
  const m = n - 1;
  const out = new Float32Array(n * n);
  const half = n >> 1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const sx = x + (by.data[y * n + x]! - 0.5) * amount * n;
      const sy = y + (by.data[((y + half) & m) * n + ((x + half) & m)]! - 0.5) * amount * n;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const tx = sx - x0;
      const ty = sy - y0;
      const a = f.data[(y0 & m) * n + (x0 & m)]!;
      const b = f.data[(y0 & m) * n + ((x0 + 1) & m)]!;
      const c = f.data[((y0 + 1) & m) * n + (x0 & m)]!;
      const d = f.data[((y0 + 1) & m) * n + ((x0 + 1) & m)]!;
      out[y * n + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }
  }
  return { size: n, data: out };
}

/**
 * Подогнать разброс значений поля f под разброс поля like (оба одного размера): самое тёмное место f
 * получает самое тёмное значение like, и так по порядку. Форма пятен — от f, а доля тёмного, среднего
 * и светлого — как у like: пороги в шейдере, подобранные под прежнюю карту, дают те же площади.
 */
export function matchField(f: Field, like: Field): Field {
  const n = f.data.length;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => f.data[a]! - f.data[b]! || a - b);
  const sorted = Float32Array.from(like.data).sort();
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[order[i]!] = sorted[i]!;
  return { size: f.size, data: out };
}

export interface CellField {
  size: number;
  /** Расстояние до ближайшей точки, 0..1 (в долях ячейки). */
  near: Float32Array;
  /** Расстояние до границы ячейки, 0..1: у трещины — ноль. */
  edge: Float32Array;
  /** Случайное число ячейки, 0..1: одно на весь «лоскут». */
  id: Float32Array;
}

/** Ячеистый шум (Вороной): cells×cells точек на сторону, бесшовный. */
export function cellField(size: number, cells: number, seed: number): CellField {
  const near = new Float32Array(size * size);
  const edge = new Float32Array(size * size);
  const id = new Float32Array(size * size);
  const px = new Float32Array(cells * cells);
  const py = new Float32Array(cells * cells);
  const pid = new Float32Array(cells * cells);
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      px[j * cells + i] = 0.12 + 0.76 * hash01(i, j, seed);
      py[j * cells + i] = 0.12 + 0.76 * hash01(i, j, seed + 53);
      pid[j * cells + i] = hash01(i, j, seed + 97);
    }
  }
  for (let y = 0; y < size; y++) {
    const gy = (y / size) * cells;
    const cy = Math.floor(gy);
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * cells;
      const cx = Math.floor(gx);
      let d1 = 9;
      let d2 = 9;
      let best = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const ix = (((cx + ox) % cells) + cells) % cells;
          const iy = (((cy + oy) % cells) + cells) % cells;
          const k = iy * cells + ix;
          const dx = cx + ox + px[k]! - gx;
          const dy = cy + oy + py[k]! - gy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < d1) {
            d2 = d1;
            d1 = d;
            best = k;
          } else if (d < d2) d2 = d;
        }
      }
      const o = y * size + x;
      near[o] = Math.min(1, d1);
      edge[o] = Math.min(1, d2 - d1);
      id[o] = pid[best]!;
    }
  }
  return { size, near, edge, id };
}

/**
 * Прочитать поле с целыми множителями частоты и сдвигом в текселях (бесшовность сохраняется).
 * Сторона поля — степень двойки: заворот считается маской, а не делением (это самое горячее место запекания).
 */
export function at(f: Field, x: number, y: number, kx = 1, ky = kx, ox = 0, oy = 0): number {
  const m = f.size - 1;
  return f.data[((y * ky + oy) & m) * f.size + ((x * kx + ox) & m)]!;
}

/** То же для массива ячеистого поля. */
export function atCell(a: Float32Array, size: number, x: number, y: number, k = 1, ox = 0, oy = 0): number {
  const m = size - 1;
  return a[((y * k + oy) & m) * size + ((x * k + ox) & m)]!;
}

export const sstep = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
