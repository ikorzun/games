/**
 * Сохранение: профиль (архив находок, счёт вылазок) и текущая вылазка (сид и прогресс).
 * Пишется пакетно через платформу и только по событиям — находка, цель, смена яруса, пауза, конец.
 * Уровень не хранится: он восстанавливается по сиду и версии генератора.
 */
import type { WorldKind } from '../gen/layout';
import type { IPlatform } from '../platform/types';
import { hash2 } from './rng';
import { emptyNarrative, parseNarrative, type NarrativeSaveV3 } from '../systems/koma';

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
  /**
   * Вспышки: мягкие (по умолчанию) или «почти незаметные». Полных больше нет (слова партнёра 19.11, 15:59): прежнее поле
   * calm (полные или мягкие) не читается — и те, и другие становятся мягкими.
   */
  flash: FlashLevel;
  /** Язык, выбранный игроком (null — по умолчанию, английский). */
  lang: string | null;
  /**
   * Качество, выбранное игроком рукой (null — не выбирал: решает замер при запуске). Помнится между запусками (куратор,
   * пачка 51, противоречие 324: «ультра» включает только игрок — и не заново после каждой перезагрузки). Замер сюда не пишет.
   */
  quality: QualityPick;
  /** Место вылазки, выбранное на заставке: убежище, офис или жёлтые комнаты. */
  place: WorldKind;
  /**
   * Воспоминания: у каждого места — то, что сейчас проходится по кругу. Петля (слова партнёра:
   * «бесконечна, пока не сотрётся всё воспоминание»): следующая сессия возвращает в то же место, но оно
   * стёрто сильнее. Стёрлось совсем — запись убирается, и место открывается другим воспоминанием.
   */
  memories: Partial<Record<WorldKind, PlaceMemory>>;
  /** Метаслой (systems/meta.ts): id обрывков, которые игрок уже видел, — по одному за сон. */
  meta: string[];
  /** Сюжет «Невостребованное» (systems/koma.ts): флаги, фазы вещей, сыгранные события. */
  koma: NarrativeSaveV3;
}

/** Воспоминание, которое проходится по кругу. */
export interface PlaceMemory {
  /** Сид и размер уровня: место остаётся тем же от круга к кругу. */
  seed: number;
  rank: 1 | 2 | 3;
  /** Стёртость 0..1 (systems/decay.ts). */
  wear: number;
  /** Сколько кругов пройдено. */
  laps: number;
  /**
   * Сон из сцен (docs/vylazka/pressure.md, §4.6): сколько вещей цепочки этого места уже вспомнено в его
   * сценах — с какой вещи начнётся следующая сцена здесь. Нет поля — с первой.
   */
  chain?: number;
}

export type Level3 = 0 | 1 | 2;
/** Качество, выбранное рукой, или null — выбора не было. */
export type QualityPick = 'low' | 'med' | 'high' | 'ultra' | null;
const qualityPick = (v: unknown): QualityPick => (v === 'low' || v === 'med' || v === 'high' || v === 'ultra' ? v : null);
/** Вспышки: мягкие или «почти незаметные». */
export type FlashLevel = 'soft' | 'faint';
const level3 = (v: unknown): Level3 => (v === 0 || v === 2 ? v : 1);

const KEYS = ['profile'];

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function defaultProfile(baseSeed: number): Profile {
  return { v: 1, sorties: 0, successes: 0, archive: [], baseSeed, muted: false, sens: 1, bright: 1, flash: 'soft', lang: null, quality: null, place: 'shelter', memories: {}, meta: [], koma: emptyNarrative() };
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
    flash: o.flash === 'faint' ? 'faint' : 'soft',
    lang: typeof o.lang === 'string' ? o.lang : null,
    quality: qualityPick(o.quality),
    place: o.place === 'office' || o.place === 'yellow' || o.place === 'station' ? o.place : 'shelter',
    memories: parseMemories(o.memories),
    meta: [...new Set(strArr(o.meta))],
    koma: parseNarrative(o.koma),
  };
}

// Все четыре места: зал ожидания здесь тоже — без него его стёртость и круги терялись при перезагрузке.
const WORLDS: readonly WorldKind[] = ['shelter', 'office', 'yellow', 'station'];

function parseMemories(raw: unknown): Partial<Record<WorldKind, PlaceMemory>> {
  const out: Partial<Record<WorldKind, PlaceMemory>> = {};
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  for (const w of WORLDS) {
    const m = o[w] as Record<string, unknown> | undefined;
    if (!m || typeof m !== 'object' || !isNum(m.seed) || !isNum(m.wear)) continue;
    const rank = m.rank === 2 || m.rank === 3 ? m.rank : 1;
    const wear = Math.max(0, Math.min(1, m.wear));
    // Стёртое до конца воспоминание не хранится: место откроется другим.
    if (wear >= 1) continue;
    out[w] = { seed: m.seed >>> 0, rank, wear, laps: isNum(m.laps) ? Math.max(0, Math.floor(m.laps)) : 0, ...(isNum(m.chain) && m.chain > 0 ? { chain: Math.floor(m.chain) } : {}) };
  }
  return out;
}

/** Воспоминание места: то, что уже проходится по кругу, или новое (ещё не записанное в профиль). */
export function memoryFor(profile: Profile, world: WorldKind): PlaceMemory {
  const m = profile.memories[world];
  return m ? { ...m } : { seed: sortieSeed(profile), rank: rankFor(profile), wear: 0, laps: 0 };
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
