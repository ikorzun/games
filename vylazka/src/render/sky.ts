/**
 * Звёздное небо — у каждого сна своё (партнёр 17.11: «звездное небо и космос должны быть разными каждый раз»).
 *
 * Небо задаётся числом-зерном: из него выходит, сколько звёзд горит, есть ли млечный путь и куда он лёг поперёк неба,
 * насколько он широк и густ, сколько звёзд тёплых и какие туманности висят в глубине — облака мягких цветных точек,
 * того же рода, что точки скана, только далеко и тускло. Зерно меняется с каждой загрузкой места (новая сцена, новая
 * сессия, скачок в другое место): дважды одно и то же небо не повторяется, а снимок с тем же зерном — повторяем.
 *
 * Здесь только числа: буферы заполняет fillSky, рисует их STAR_VERT (render/shaders.ts). Размеры буферов постоянны —
 * лишние звёзды получают нулевую яркость, и вершинный шейдер их выбрасывает.
 */

/** Наибольшее число дальних звёзд (горит от трёх четвертей до всех). */
export const SKY_FAR = 6000;
/** Ближних звёзд (от пяти до сорока пяти метров над полом): они дают глубину, смещаясь при ходьбе. */
export const SKY_NEAR = 520;
/** Точек на все туманности неба. */
export const SKY_NEBULA = 2400;
/** Точек в хвосте падающей звезды; падающих четыре: три по своим срокам и одна по знаку игры. */
export const SKY_TAIL = 16;
export const SKY_TOTAL = SKY_FAR + SKY_NEAR + SKY_NEBULA + 4 * SKY_TAIL;

/** Род точки неба (aStar.w в шейдере). */
export const STAR_KIND = { far: 0, near: 1, fall: 2, sign: 5, nebula: 6 } as const;

/** Оттенки туманностей (номер — в aStar.z, палитра — в STAR_VERT): фиолетовая, бирюзовая, розовая, янтарная, синяя. */
export const NEBULA_HUES = 5;

export interface Nebula {
  /** Середина облака в координатах поля: x, z — от −1 до 1 (ящик вокруг камеры), y — 0..1 (высота, как у дальних). */
  x: number;
  y: number;
  z: number;
  /** Размер (доля поля). */
  size: number;
  /** Оттенок: 0..NEBULA_HUES−1. */
  hue: number;
  /** Яркость одной точки. */
  bright: number;
  /** Сколько точек. */
  count: number;
}

export interface SkyLook {
  /** Сколько дальних звёзд горит. */
  far: number;
  /** Млечный путь: направление поперёк неба (рад), ширина (доля поля), какая доля дальних звёзд в нём; null — полосы нет. */
  band: { angle: number; width: number; share: number } | null;
  /** Доля тёплых звёзд (остальные — холодные, голубоватые). */
  warm: number;
  nebulae: Nebula[];
}

/** Целочисленный генератор: небо одно и то же для одного зерна на любом устройстве. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 0x5eed57a1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Каким будет небо с этим зерном. */
export function skyLook(seed: number): SkyLook {
  const r = rng(seed ^ 0x51c0ffee);
  const far = Math.round(SKY_FAR * (0.75 + 0.25 * r()));
  // Каждое пятое небо — без млечного пути: звёзды рассыпаны ровно.
  const band = r() < 0.2 ? null : { angle: r() * Math.PI, width: 0.06 + 0.11 * r(), share: 0.28 + 0.24 * r() };
  const warm = 0.08 + 0.3 * r();
  // Туманностей: чаще одна, бывает ни одной, изредка три.
  const roll = r();
  const n = roll < 0.22 ? 0 : roll < 0.62 ? 1 : roll < 0.9 ? 2 : 3;
  const nebulae: Nebula[] = [];
  let left = SKY_NEBULA;
  for (let k = 0; k < n; k++) {
    const count = Math.min(left, Math.round(420 + 380 * r()));
    left -= count;
    nebulae.push({ x: (r() * 2 - 1) * 0.8, y: 0.25 + 0.55 * r(), z: (r() * 2 - 1) * 0.8, size: 0.06 + 0.14 * r(), hue: Math.floor(r() * NEBULA_HUES), bright: 0.035 + 0.055 * r(), count });
  }
  return { far, band, warm, nebulae };
}

/** Свернуть координату в поле −1..1 (поле повторяется ящиком вокруг камеры). */
const wrap = (v: number): number => ((((v + 1) % 2) + 2) % 2) - 1;

/**
 * Заполнить буферы неба (position — 3 числа на точку, aStar — 4) по зерну. Возвращает его облик.
 * pos и star — длиной SKY_TOTAL × 3 и SKY_TOTAL × 4.
 */
export function fillSky(seed: number, pos: Float32Array, star: Float32Array): SkyLook {
  const look = skyLook(seed);
  const r = rng(seed);
  const gauss = (): number => r() + r() + r() - 1.5;
  for (let i = 0; i < SKY_FAR + SKY_NEAR; i++) {
    const far = i < SKY_FAR;
    let x = r() * 2 - 1;
    let z = r() * 2 - 1;
    // Полоса: её звёзды лежат вдоль прямой поперёк неба, с разбросом в её ширину — она гуще и уже, её видно и в щель потолка.
    if (far && look.band && r() < look.band.share) {
      const t = r() * 2 - 1;
      const off = gauss() * look.band.width * 1.4;
      const c = Math.cos(look.band.angle);
      const s = Math.sin(look.band.angle);
      x = wrap(t * c - off * s);
      z = wrap(t * s + off * c);
    }
    pos[i * 3] = x;
    pos[i * 3 + 1] = r();
    pos[i * 3 + 2] = z;
    // Ярких мало, тусклых много.
    const m = r();
    const lit = !far || i < look.far;
    star[i * 4] = !lit ? 0 : far ? 0.07 + 0.93 * m * m * m * m : 0.08 + 0.3 * m * m;
    // Размер: у дальних от точки до крупной звезды с ореолом (каждая тридцатая).
    star[i * 4 + 1] = far ? (m > 0.967 ? 4.6 + 1.4 * r() : 1.3 + 2.2 * m * m) : 1.2 + 1.2 * m;
    // Оттенок: случайное число; тёплая — если оно выше 1 − warm (порог — в шейдере, uWarm).
    star[i * 4 + 2] = r();
    star[i * 4 + 3] = far ? STAR_KIND.far : STAR_KIND.near;
  }
  // Туманности: облако из нескольких сгустков (а не ровный шар) — мягкие крупные тусклые точки одного оттенка.
  let i = SKY_FAR + SKY_NEAR;
  for (const nb of look.nebulae) {
    const lumps = 2 + Math.floor(r() * 3);
    const at: [number, number, number][] = [];
    for (let k = 0; k < lumps; k++) at.push([gauss() * nb.size, gauss() * nb.size, 0.5 + r()]);
    for (let j = 0; j < nb.count; j++, i++) {
      const [ox, oz, w] = at[Math.floor(r() * lumps)]!;
      pos[i * 3] = wrap(nb.x + ox + gauss() * nb.size * 0.55 * w);
      pos[i * 3 + 1] = Math.min(1, Math.max(0, nb.y + gauss() * 0.05));
      pos[i * 3 + 2] = wrap(nb.z + oz + gauss() * nb.size * 0.55 * w);
      // Крупные и очень тусклые: по одной их не видно, сливаясь сотнями, они дают свечение облака.
      star[i * 4] = nb.bright * 0.42 * (0.4 + 0.6 * r());
      star[i * 4 + 1] = 11 + 17 * r();
      star[i * 4 + 2] = (nb.hue + 0.5) / 8;
      star[i * 4 + 3] = STAR_KIND.nebula;
    }
  }
  // Свободные места под туманности гаснут.
  for (; i < SKY_FAR + SKY_NEAR + SKY_NEBULA; i++) {
    pos[i * 3] = 0;
    pos[i * 3 + 1] = 0;
    pos[i * 3 + 2] = 0;
    star[i * 4] = 0;
    star[i * 4 + 1] = 1;
    star[i * 4 + 2] = 0;
    star[i * 4 + 3] = STAR_KIND.nebula;
  }
  // Падающие звёзды: голова и хвост; position.x — место точки в хвосте.
  for (let k = 0; k < 4; k++) {
    for (let j = 0; j < SKY_TAIL; j++, i++) {
      pos[i * 3] = j / (SKY_TAIL - 1);
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = 0;
      star[i * 4] = 1;
      star[i * 4 + 1] = 3.2 - 2.0 * (j / (SKY_TAIL - 1));
      // У хвоста падающей — холодный оттенок (а не тёплый, как у части звёзд).
      star[i * 4 + 2] = r() * 0.2;
      star[i * 4 + 3] = k < 3 ? STAR_KIND.fall + k : STAR_KIND.sign;
    }
  }
  return look;
}
