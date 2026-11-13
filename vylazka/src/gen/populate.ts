/**
 * Наполнение уровня: цели вылазки, находки и батарейки по местам, которые отдала сборка уровня.
 * Чистая функция от уровня и сида: одно и то же на любом устройстве.
 */
import { hash2, mulberry32 } from '../core/rng';
import type { Rng } from '../core/rng';
import type { BuiltLevel, ItemSpot, Landmark } from '../world/level';

/** Находка для архива. Названия и описания — в локалях: find.<id>.name, find.<id>.desc. */
export interface FindDef {
  id: string;
  /** Как выглядит на уровне. */
  shape: 'paper' | 'bag' | 'device' | 'small';
  /** Ценность: 1 — мелочь, 3 — редкость; редкое лежит глубже. */
  value: 1 | 2 | 3;
}

export const FINDS: readonly FindDef[] = [
  { id: 'journal', shape: 'paper', value: 2 },
  { id: 'order', shape: 'paper', value: 2 },
  { id: 'scheme', shape: 'paper', value: 3 },
  { id: 'photo', shape: 'paper', value: 1 },
  { id: 'gasmask', shape: 'bag', value: 1 },
  { id: 'medkit', shape: 'bag', value: 1 },
  { id: 'ration', shape: 'bag', value: 1 },
  { id: 'dosimeter', shape: 'device', value: 3 },
  { id: 'receiver', shape: 'device', value: 2 },
  { id: 'lamp', shape: 'device', value: 2 },
  { id: 'tape', shape: 'device', value: 3 },
  { id: 'badge', shape: 'small', value: 1 },
  { id: 'keys', shape: 'small', value: 2 },
  { id: 'stamp', shape: 'small', value: 3 },
  { id: 'tube', shape: 'small', value: 1 },
  { id: 'pennant', shape: 'small', value: 2 },
];

export interface LevelItem {
  id: number;
  type: 'battery' | 'find';
  /** id находки из FINDS (у батарейки нет). */
  find?: string;
  x: number;
  y: number;
  z: number;
  tier: number;
  room: number;
}

export interface Objective {
  id: number;
  /** take — забрать предмет; shoot — снять примету на камеру. */
  type: 'take' | 'shoot';
  tier: number;
  /** Для take: id предмета в items. */
  item?: number;
  /** Для shoot: примета. */
  landmark?: Landmark;
}

export interface Population {
  items: LevelItem[];
  objectives: Objective[];
}

function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

/** Приметы, годные как цель съёмки (выход — не цель). */
const SHOOTABLE = new Set(['radio', 'map', 'safe', 'cabinet', 'bunks', 'racks', 'fvu', 'fan', 'panel', 'diesel', 'tank', 'switchboard', 'archive', 'collapse', 'sinks']);

export function populate(level: BuiltLevel, seed: number): Population {
  const rng = mulberry32(hash2(seed, 0x17e5, 0xb0b));
  const tiers = level.layout?.tierCount ?? 1;
  const last = tiers - 1;
  const items: LevelItem[] = [];
  const objectives: Objective[] = [];
  const freeSpots = shuffled(rng, level.spots);
  const takeSpot = (pred: (s: ItemSpot) => boolean): ItemSpot | null => {
    const i = freeSpots.findIndex(pred);
    return i >= 0 ? freeSpots.splice(i, 1)[0]! : null;
  };
  const finds = shuffled(rng, FINDS);
  const nextFind = (minValue: number): FindDef => {
    const i = finds.findIndex((f) => f.value >= minValue);
    return finds.splice(i >= 0 ? i : 0, 1)[0]!;
  };
  const put = (type: LevelItem['type'], s: ItemSpot, find?: string): LevelItem => {
    const it: LevelItem = { id: items.length, type, x: s.x, y: s.y, z: s.z, tier: s.tier, room: s.room, ...(find ? { find } : {}) };
    items.push(it);
    return it;
  };

  // Три цели, чем дальше — тем глубже: первая на верхних ярусах, последняя на самом нижнем.
  const goalTiers = tiers === 1 ? [0, 0, 0] : tiers === 2 ? [0, 1, 1] : [rng() < 0.5 ? 0 : 1, 1, last];
  const kinds: Array<'take' | 'shoot'> = shuffled(rng, ['shoot', 'take', rng() < 0.5 ? 'shoot' : 'take'] as const);
  const usedLandmarks = new Set<string>();
  for (let i = 0; i < 3; i++) {
    const tier = goalTiers[i]!;
    let made = false;
    if (kinds[i] === 'shoot') {
      const lm = shuffled(rng, level.landmarks).find((l) => l.tier === tier && SHOOTABLE.has(l.id) && !usedLandmarks.has(l.id));
      if (lm) {
        usedLandmarks.add(lm.id);
        objectives.push({ id: objectives.length, type: 'shoot', tier, landmark: lm });
        made = true;
      }
    }
    if (!made) {
      const s = takeSpot((sp) => sp.tier === tier) ?? takeSpot(() => true);
      if (!s) continue;
      const it = put('find', s, nextFind(tier === last && tiers > 1 ? 2 : 1).id);
      objectives.push({ id: objectives.length, type: 'take', tier: s.tier, item: it.id });
    }
  }

  // Необязательные находки: по две-три на ярус, ценное — глубже.
  for (let t = 0; t < tiers; t++) {
    const count = 2 + (t === last && tiers > 1 ? 1 : 0);
    for (let i = 0; i < count && finds.length > 0; i++) {
      const s = takeSpot((sp) => sp.tier === t);
      if (!s) break;
      put('find', s, nextFind(t === last && tiers > 1 ? 2 : 1).id);
    }
  }

  // Батарейки: одна в самом начале пути и по две на каждом ярусе.
  for (let t = 0; t < tiers; t++) {
    for (let i = 0; i < 2; i++) {
      const s = takeSpot((sp) => sp.tier === t);
      if (s) put('battery', s);
    }
  }
  return { items, objectives };
}
