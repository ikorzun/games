/**
 * Тени-пятна под обстановкой. Рассеянный свет теней не даёт, а карты теней на телефоне нет вовсе —
 * без пятна стол и скамья висят над полом. Здесь пятна запекаются один раз при сборке уровня в
 * небольшую карту «сверху»: под предметом и на ширину ладони-двух вокруг пол темнее. Шейдер читает
 * её одной выборкой на полу (render/shaders.ts, uContact), годится любому качеству.
 *
 * Ярусы уровня лежат один над другим, поэтому у каждого свой канал карты (до четырёх). Предмет,
 * которого коснулись, рассыпается — его пятно пропадает вместе с ним: карту пересобирает игра.
 *
 * Чистый TS: работает в тестах.
 */
import type { LevelObject } from './objects';

/** Сторона карты, точек. На уровень 48 × 48 м это около 19 см на точку — пятну хватает. */
export const CONTACT_SIZE = 256;

export interface ContactMap {
  /** size × size точек RGBA: канал — ярус, 255 — темно. */
  data: Uint8Array;
  size: number;
  /** Угол карты в мире (x, z) и её сторона, м. */
  origin: [number, number];
  span: number;
}

export interface ContactConfig {
  /** Самое тёмное пятно, 0..1 — под высоким предметом. */
  dark: number;
  /** Ниже этой высоты предмет пятна не даёт (коврик, наклейка на полу), м. */
  minHeight: number;
  /** С этой высоты пятно в полную силу, м. */
  fullHeight: number;
  /** На сколько пятно выходит за габарит: доля высоты предмета и пределы, м. */
  spread: number;
  spreadMin: number;
  spreadMax: number;
  /** Насколько низ предмета может не совпадать с полом яруса, м: выше — он висит и пятна не даёт. */
  lift: number;
}

export const DEFAULT_CONTACT: ContactConfig = { dark: 0.5, minHeight: 0.08, fullHeight: 0.45, spread: 0.3, spreadMin: 0.1, spreadMax: 0.38, lift: 0.3 };

/** На каком ярусе стоит предмет: номер яруса или −1 — он висит (на стене, под потолком). */
export function tierOf(o: LevelObject, tierFloor: (t: number) => number, tiers: number, cfg: ContactConfig = DEFAULT_CONTACT): number {
  for (let t = 0; t < tiers; t++) {
    const d = o.min[1] - tierFloor(t);
    if (d > -cfg.lift && d < cfg.lift) return t;
  }
  return -1;
}

/**
 * Запечь карту. gone — номера предметов, которых сейчас нет (рассыпались): их пятен нет тоже.
 * null — на полу ничего не стоит.
 */
export function bakeContact(
  objects: readonly LevelObject[],
  tierFloor: (t: number) => number,
  tiers: number,
  gone?: ReadonlySet<number>,
  cfg: ContactConfig = DEFAULT_CONTACT,
  size = CONTACT_SIZE,
): ContactMap | null {
  const n = Math.min(4, tiers);
  const stand: { o: LevelObject; tier: number; k: number; f: number }[] = [];
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const o of objects) {
    const h = o.max[1] - o.min[1];
    if (h < cfg.minHeight) continue;
    const tier = tierOf(o, tierFloor, n, cfg);
    if (tier < 0) continue;
    const f = Math.max(cfg.spreadMin, Math.min(cfg.spreadMax, h * cfg.spread));
    stand.push({ o, tier, k: cfg.dark * Math.min(1, h / cfg.fullHeight), f });
    // Габариты карты считаются по всем стоящим предметам, включая рассыпавшиеся: карта не «прыгает».
    minX = Math.min(minX, o.min[0] - f);
    minZ = Math.min(minZ, o.min[2] - f);
    maxX = Math.max(maxX, o.max[0] + f);
    maxZ = Math.max(maxZ, o.max[2] + f);
  }
  if (stand.length === 0) return null;
  const span = Math.max(maxX - minX, maxZ - minZ) + 0.5;
  const ox = (minX + maxX) / 2 - span / 2;
  const oz = (minZ + maxZ) / 2 - span / 2;
  const px = span / size;
  const data = new Uint8Array(size * size * 4);
  for (const s of stand) {
    if (gone?.has(s.o.id)) continue;
    const { o, f } = s;
    const x0 = Math.max(0, Math.floor((o.min[0] - f - ox) / px));
    const x1 = Math.min(size - 1, Math.floor((o.max[0] + f - ox) / px));
    const z0 = Math.max(0, Math.floor((o.min[2] - f - oz) / px));
    const z1 = Math.min(size - 1, Math.floor((o.max[2] + f - oz) / px));
    for (let iz = z0; iz <= z1; iz++) {
      const wz = oz + (iz + 0.5) * px;
      const dz = Math.max(0, o.min[2] - wz, wz - o.max[2]);
      for (let ix = x0; ix <= x1; ix++) {
        const wx = ox + (ix + 0.5) * px;
        const dx = Math.max(0, o.min[0] - wx, wx - o.max[0]);
        const d = Math.hypot(dx, dz);
        if (d >= f) continue;
        // Под самим предметом — в полную силу, наружу сходит плавно (как полутень).
        const t = 1 - d / f;
        const v = Math.round(255 * s.k * t * t * (3 - 2 * t));
        const i = (iz * size + ix) * 4 + s.tier;
        if (v > data[i]!) data[i] = v;
      }
    }
  }
  return { data, size, origin: [ox, oz], span };
}
