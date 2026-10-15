/**
 * Озвучка реплик: соглашение о файлах и индекс клипов. Чистое ядро без DOM — проверяется в node
 * (tests/voice.test.ts).
 *
 *   assets/<папка эпизода>/voice/<язык>/<id клипа>.<ext>
 *
 *   папка эпизода — первый сегмент id эпизода (`ep01_murylev` → `ep01`, как у остальных ассетов `assets/ep01/…`);
 *                   полный id (`assets/ep01_murylev/voice/…`) тоже принимается, первой смотрится короткая папка
 *   язык          — ru | en | es | pt: клип играет только на своём языке, другого языка вместо него не берётся
 *   id клипа      — явное поле `voice` шага say / narrate (приоритет), иначе ключ локализации реплики (`ep01.s12.l003`)
 *   ext           — mp3 (канон: так же, как эмбиент и эффекты), допустимы m4a и ogg; если есть несколько форматов,
 *                   берётся первый из VOICE_EXTENSIONS
 *
 * Рантайм обращается к клипу, только если он есть в voice-index.json: его строит плагин сборки
 * (scripts/assets_plugin.mjs) по содержимому ../assets, поэтому ни запросов за несуществующими файлами,
 * ни 404 в консоли нет — даже когда клипов нет вовсе (индекс пуст, озвучка просто молчит).
 */
import type { Episode, Lang, LinePending } from './types';

/** Файл индекса клипов в корне сборки (рядом с episodes/index.json). */
export const VOICE_INDEX_FILE = 'voice-index.json';
/** Подпапка озвучки внутри папки эпизода. */
export const VOICE_DIR = 'voice';
/** Форматы клипов по убыванию предпочтения (mp3 играет везде, включая iOS Safari). */
export const VOICE_EXTENSIONS = ['mp3', 'm4a', 'ogg'] as const;
export type VoiceExt = (typeof VOICE_EXTENSIONS)[number];

/** Допустимое имя клипа без расширения: ключ локализации (`ep01.s12.l003`) или id (`take_two`) — только `[a-z0-9_.]`. */
const CLIP_ID_RE = /^[a-z0-9_]+(?:\.[a-z0-9_]+)*$/;

/** Содержимое voice-index.json. Файлы перечислены с расширением, как они лежат на диске. */
export interface VoiceIndexData {
  version: 1;
  /** Папка эпизода (`ep01`) → язык → имена файлов клипов (`ep01.s12.l003.mp3`). */
  episodes: Record<string, Record<string, string[]>>;
}

/** Реплика для поиска клипа: ключ, явный id клипа и говорящий (null — рассказчик). */
export type VoiceLineRef = Pick<LinePending, 'key' | 'voice' | 'who'>;

/** Найденный в индексе клип. */
export interface VoiceClipRef {
  /** Имя клипа без расширения. */
  id: string;
  ext: VoiceExt;
  folder: string;
  lang: Lang;
  /** Путь относительно корня сборки: `assets/ep01/voice/ru/ep01.s12.l003.mp3`. */
  path: string;
}

const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

/** Короткий код эпизода — имя его папки с ассетами: `ep01_murylev` → `ep01` (так же считает Session для телеметрии). */
export function episodeCode(episodeId: string): string {
  return episodeId.split('_')[0] || episodeId;
}

/** Папки с озвучкой эпизода по порядку просмотра: короткий код, затем полный id. */
export function voiceFolders(episodeId: string): string[] {
  return unique([episodeCode(episodeId), episodeId]);
}

export function isVoiceExt(ext: string): ext is VoiceExt {
  return (VOICE_EXTENSIONS as readonly string[]).includes(ext);
}

/** Путь клипа относительно корня сборки. */
export function voicePath(folder: string, lang: string, clipId: string, ext: VoiceExt): string {
  return `assets/${folder}/${VOICE_DIR}/${lang}/${clipId}.${ext}`;
}

/** Идентификаторы клипа реплики по приоритету: явное поле `voice`, затем ключ локализации. */
export function clipIdsOf(line: Pick<VoiceLineRef, 'key' | 'voice'>): string[] {
  return line.voice ? unique([line.voice, line.key]) : [line.key];
}

/** Имя файла `ep01.s12.l003.mp3` → { id, ext }; не по соглашению (регистр, чужое расширение) — null. */
export function parseClipFile(file: string): { id: string; ext: VoiceExt } | null {
  const dot = file.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = file.slice(dot + 1).toLowerCase();
  const id = file.slice(0, dot);
  return isVoiceExt(ext) && file.slice(dot + 1) === ext && CLIP_ID_RE.test(id) ? { id, ext } : null;
}

/**
 * Язык озвучки при языке игры (владелец 2026-10-15): русский и английский — текст и голос на одном языке; испанский и
 * португальский — свой текст под английскую озвучку.
 */
export function voiceLangFor(lang: Lang): Lang {
  return lang === 'es' || lang === 'pt' ? 'en' : lang;
}

/**
 * Политика озвучки персонажа (`cast[].voice`): none — не озвучен, ru_only — только на русском, all (и не задано) — на всех
 * языках, где есть клипы.
 */
export function voiceAllowed(policy: 'none' | 'ru_only' | 'all' | undefined, lang: Lang): boolean {
  if (policy === 'none') return false;
  if (policy === 'ru_only') return lang === 'ru';
  return true;
}

/** Политика по персонажам эпизода: id → cast.voice (только заданные). */
export function castVoicePolicies(episode: Pick<Episode, 'cast'>): Map<string, 'none' | 'ru_only' | 'all'> {
  const out = new Map<string, 'none' | 'ru_only' | 'all'>();
  for (const c of episode.cast ?? []) if (c.voice) out.set(c.id, c.voice);
  return out;
}

export class VoiceIndex {
  /** `папка/язык` → (id клипа → формат). */
  private readonly sets = new Map<string, Map<string, VoiceExt>>();
  private total = 0;

  static empty(): VoiceIndex {
    return new VoiceIndex();
  }

  /**
   * Разобрать voice-index.json. Терпимо к мусору: неизвестная версия, не объект, не массив, имена не по соглашению —
   * просто пропускаются (рантайм при этом не падает, а озвучка молчит).
   */
  static parse(json: unknown): VoiceIndex {
    const index = new VoiceIndex();
    if (typeof json !== 'object' || json === null) return index;
    const data = json as Partial<VoiceIndexData>;
    if (data.version !== 1 || typeof data.episodes !== 'object' || data.episodes === null) return index;
    for (const [folder, langs] of Object.entries(data.episodes)) {
      if (typeof langs !== 'object' || langs === null) continue;
      for (const [lang, files] of Object.entries(langs)) {
        if (!Array.isArray(files)) continue;
        for (const file of files) {
          const clip = typeof file === 'string' ? parseClipFile(file) : null;
          if (clip) index.add(folder, lang, clip.id, clip.ext);
        }
      }
    }
    return index;
  }

  /** Всего клипов в индексе (по всем папкам и языкам). */
  get size(): number {
    return this.total;
  }

  /** Сколько клипов у эпизода на языке (для QA: `__vn.audio().voice.clips`). */
  count(episodeId: string, lang: Lang): number {
    let n = 0;
    for (const folder of voiceFolders(episodeId)) n += this.sets.get(`${folder}/${lang}`)?.size ?? 0;
    return n;
  }

  /** Клип по id в папке эпизода на языке; null — его нет в индексе (файл не запрашивается). */
  find(episodeId: string, lang: Lang, clipId: string): VoiceClipRef | null {
    for (const folder of voiceFolders(episodeId)) {
      const ext = this.sets.get(`${folder}/${lang}`)?.get(clipId);
      if (ext) return { id: clipId, ext, folder, lang, path: voicePath(folder, lang, clipId, ext) };
    }
    return null;
  }

  /** Клип реплики: сначала явное поле `voice`, затем ключ локализации; первый найденный в индексе. */
  resolve(episodeId: string, lang: Lang, line: Pick<VoiceLineRef, 'key' | 'voice'>): VoiceClipRef | null {
    if (this.total === 0) return null;
    for (const id of clipIdsOf(line)) {
      const hit = this.find(episodeId, lang, id);
      if (hit) return hit;
    }
    return null;
  }

  private add(folder: string, lang: string, id: string, ext: VoiceExt): void {
    const slot = `${folder}/${lang}`;
    let set = this.sets.get(slot);
    if (!set) this.sets.set(slot, (set = new Map()));
    const have = set.get(id);
    if (have === undefined) this.total += 1;
    else if (VOICE_EXTENSIONS.indexOf(have) <= VOICE_EXTENSIONS.indexOf(ext)) return; // формат предпочтительнее уже есть
    set.set(id, ext);
  }
}
