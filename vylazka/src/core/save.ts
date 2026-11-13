/**
 * Сохранение: профиль (архив находок, счёт вылазок) и текущая вылазка (сид и прогресс).
 * Пишется пакетно через платформу и только по событиям — находка, цель, смена яруса, пауза, конец.
 * Уровень не хранится: он восстанавливается по сиду и версии генератора.
 */
import type { IPlatform } from '../platform/types';
import { hash2 } from './rng';

export interface Profile {
  v: 1;
  /** Сколько вылазок начато. */
  sorties: number;
  /** Сколько раз игрок выбрался. */
  successes: number;
  /** id находок, вынесенных наверх (без повторов). */
  archive: string[];
  /** Зерно, от которого считаются сиды объектов этого игрока. */
  baseSeed: number;
}

export interface RunSave {
  v: 1;
  genVersion: number;
  seed: number;
  rank: 1 | 2 | 3;
  taken: number[];
  done: number[];
  finds: string[];
  spares: number;
  charge: number;
  time: number;
  maxTier: number;
  collapsed: string[];
}

const KEYS = ['profile', 'run'];

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const numArr = (v: unknown): number[] => (Array.isArray(v) ? v.filter(isNum) : []);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function defaultProfile(baseSeed: number): Profile {
  return { v: 1, sorties: 0, successes: 0, archive: [], baseSeed };
}

/** Разобрать профиль из хранилища; всё непонятное заменяется значениями по умолчанию. */
export function parseProfile(raw: unknown, baseSeed: number): Profile {
  if (!raw || typeof raw !== 'object') return defaultProfile(baseSeed);
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return defaultProfile(baseSeed);
  return {
    v: 1,
    sorties: isNum(o.sorties) ? Math.max(0, Math.floor(o.sorties)) : 0,
    successes: isNum(o.successes) ? Math.max(0, Math.floor(o.successes)) : 0,
    archive: [...new Set(strArr(o.archive))],
    baseSeed: isNum(o.baseSeed) ? o.baseSeed >>> 0 : baseSeed,
  };
}

/** Разобрать сохранённую вылазку; null — её нет или она от другой версии генератора. */
export function parseRun(raw: unknown, genVersion: number): RunSave | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1 || o.genVersion !== genVersion || !isNum(o.seed)) return null;
  const rank = o.rank === 1 || o.rank === 2 || o.rank === 3 ? o.rank : null;
  if (!rank) return null;
  return {
    v: 1,
    genVersion,
    seed: o.seed >>> 0,
    rank,
    taken: numArr(o.taken),
    done: numArr(o.done),
    finds: strArr(o.finds),
    spares: isNum(o.spares) ? Math.max(0, Math.floor(o.spares)) : 0,
    charge: isNum(o.charge) ? Math.max(0, Math.min(1, o.charge)) : 1,
    time: isNum(o.time) ? Math.max(0, o.time) : 0,
    maxTier: isNum(o.maxTier) ? Math.max(0, Math.floor(o.maxTier)) : 0,
    collapsed: strArr(o.collapsed),
  };
}

export async function loadSave(platform: IPlatform, baseSeed: number, genVersion: number): Promise<{ profile: Profile; run: RunSave | null }> {
  try {
    const [p, r] = await platform.load(KEYS);
    return { profile: parseProfile(p, baseSeed), run: parseRun(r, genVersion) };
  } catch (e) {
    console.warn('[save] не удалось прочитать сохранение:', e);
    return { profile: defaultProfile(baseSeed), run: null };
  }
}

export async function writeSave(platform: IPlatform, profile: Profile, run: RunSave | null): Promise<void> {
  try {
    await platform.save(KEYS, [profile, run]);
  } catch (e) {
    console.warn('[save] не удалось записать сохранение:', e);
  }
}

/** Ранг следующего объекта: первый — простой, дальше глубже. */
export function rankFor(profile: Profile): 1 | 2 | 3 {
  return profile.successes < 1 ? 1 : profile.successes < 3 ? 2 : 3;
}

/** Сид следующего объекта игрока. */
export function sortieSeed(profile: Profile): number {
  return hash2(profile.baseSeed, profile.sorties, 0x5eed) >>> 0;
}

/** Номер убежища для карточки задания: трёхзначный, от сида. */
export function objectNumber(seed: number): number {
  return 100 + ((seed >>> 0) % 900);
}
