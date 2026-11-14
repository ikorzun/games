/**
 * Сохранение: профиль (архив находок, счёт вылазок) и текущая вылазка (сид и прогресс).
 * Пишется пакетно через платформу и только по событиям — находка, цель, смена яруса, пауза, конец.
 * Уровень не хранится: он восстанавливается по сиду и версии генератора.
 */
import type { WorldKind } from '../gen/layout';
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
  /** Игрок выключил звук. */
  muted: boolean;
  /** Чувствительность обзора и яркость картинки: 0 — ниже, 1 — как задумано, 2 — выше. */
  sens: Level3;
  bright: Level3;
  /** Игрок просил поменьше вспышек: стробоскоп становится плавным, белые вспышки — затемнением. */
  calm: boolean;
  /** Язык, выбранный игроком (null — по умолчанию, английский). */
  lang: string | null;
  /** Место вылазки, выбранное на заставке: убежище, офис или жёлтые комнаты. */
  place: WorldKind;
}

export type Level3 = 0 | 1 | 2;
const level3 = (v: unknown): Level3 => (v === 0 || v === 2 ? v : 1);

const KEYS = ['profile'];

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function defaultProfile(baseSeed: number): Profile {
  return { v: 1, sorties: 0, successes: 0, archive: [], baseSeed, muted: false, sens: 1, bright: 1, calm: false, lang: null, place: 'shelter' };
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
    muted: o.muted === true,
    sens: level3(o.sens),
    bright: level3(o.bright),
    calm: o.calm === true,
    lang: typeof o.lang === 'string' ? o.lang : null,
    place: o.place === 'office' || o.place === 'yellow' ? o.place : 'shelter',
  };
}

export async function loadSave(platform: IPlatform, baseSeed: number): Promise<{ profile: Profile }> {
  try {
    const [p] = await platform.load(KEYS);
    return { profile: parseProfile(p, baseSeed) };
  } catch (e) {
    console.warn('[save] не удалось прочитать сохранение:', e);
    return { profile: defaultProfile(baseSeed) };
  }
}

/** Записать профиль. */
export async function writeProfile(platform: IPlatform, profile: Profile): Promise<void> {
  try {
    await platform.save([KEYS[0]!], [profile]);
  } catch (e) {
    console.warn('[save] не удалось записать профиль:', e);
  }
}

/** Ранг следующей сессии: первая — небольшая, дальше глубже и страннее. */
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
