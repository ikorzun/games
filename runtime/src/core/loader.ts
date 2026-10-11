/**
 * Загрузка контента: манифест эпизодов, JSON эпизода и локали (fetch). Эпизод и локали лежат
 * вне рантайма (../episodes, ../locales) и копируются в сборку как статические файлы
 * (vite.config.ts); рантайм грузит только нужный эпизод и нужные языки.
 */
import type { I18n } from './i18n';
import { fallbackChain } from './i18n';
import type { Episode, Lang } from './types';
import { VOICE_INDEX_FILE, VoiceIndex } from './voice';

export interface ManifestEntry {
  id: string;
  path: string;
  season: number;
  order: number;
  title_key: string;
  logline_key?: string;
  estimated_minutes?: number;
  age_rating?: string;
  content_warnings: string[];
}

export interface LoadedEpisode {
  episode: Episode;
  /** Версия контента для сейвов: id эпизода + хеш его JSON. Меняется при любой правке сценария. */
  contentVersion: string;
}

export interface FetchedResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}
export type FetchLike = (url: string) => Promise<FetchedResponse>;

const defaultFetch: FetchLike = (url) => fetch(url, { cache: 'no-cache' });

/** FNV-1a, 32 бита → 8 hex-символов. Достаточно, чтобы отличать версии контента. */
export function contentHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export class ContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentError';
  }
}

async function fetchText(url: string, f: FetchLike): Promise<string> {
  let res: FetchedResponse;
  try {
    res = await f(url);
  } catch (e) {
    throw new ContentError(`не удалось загрузить ${url}: ${(e as Error).message}`);
  }
  if (!res.ok) throw new ContentError(`не удалось загрузить ${url}: HTTP ${res.status}`);
  return res.text();
}

function parseJson(text: string, url: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    throw new ContentError(`${url}: невалидный JSON (${(e as Error).message})`);
  }
}

/** Минимальная проверка формы эпизода: полную проверку делает tools/validate_episode.py. */
export function assertEpisode(json: unknown, source: string): asserts json is Episode {
  const e = json as Partial<Episode> | null;
  const problems: string[] = [];
  if (!e || typeof e !== 'object') problems.push('это не объект');
  else {
    if (e.schema_version !== 1) problems.push(`schema_version=${String(e.schema_version)}, поддерживается 1`);
    if (typeof e.id !== 'string') problems.push('нет id');
    if (!Array.isArray(e.blocks) || e.blocks.length === 0) problems.push('нет blocks');
    if (!e.scenes || typeof e.scenes !== 'object') problems.push('нет scenes');
    if (!Array.isArray(e.endings) || e.endings.length === 0) problems.push('нет endings');
    if (!e.variables || typeof e.variables !== 'object') problems.push('нет variables');
    if (!Array.isArray(e.cast)) problems.push('нет cast');
    if (!e.assets || typeof e.assets !== 'object') problems.push('нет assets');
  }
  if (problems.length > 0) throw new ContentError(`эпизод ${source}: ${problems.join('; ')}`);
}

export async function loadManifest(base: string, f: FetchLike = defaultFetch): Promise<ManifestEntry[]> {
  const url = `${base}episodes/index.json`;
  const json = parseJson(await fetchText(url, f), url) as { episodes?: ManifestEntry[] };
  if (!Array.isArray(json.episodes) || json.episodes.length === 0) throw new ContentError(`${url}: в манифесте нет эпизодов`);
  return json.episodes;
}

export async function loadEpisode(base: string, entry: Pick<ManifestEntry, 'id' | 'path'>, f: FetchLike = defaultFetch): Promise<LoadedEpisode> {
  const url = `${base}${entry.path}`;
  const text = await fetchText(url, f);
  const json = parseJson(text, url);
  assertEpisode(json, url);
  if (json.id !== entry.id) throw new ContentError(`${url}: id эпизода «${json.id}» не совпадает с манифестом «${entry.id}»`);
  return { episode: json, contentVersion: `${json.id}@${contentHash(text)}` };
}

/**
 * Строки одного языка: ui.json + common.json (если есть) + файл эпизода — в один плоский словарь.
 * Для ru файл эпизода обязателен (язык-источник); для остальных отсутствие — предупреждение,
 * строки уйдут в фолбэк.
 */
export async function loadStrings(
  base: string,
  lang: Lang,
  episodeId: string,
  f: FetchLike = defaultFetch,
  warn: (m: string) => void = (m) => console.warn(m),
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const parts: Array<{ name: string; required: boolean }> = [
    { name: 'ui', required: lang === 'ru' },
    { name: 'common', required: false },
    { name: episodeId, required: lang === 'ru' },
  ];
  for (const part of parts) {
    const url = `${base}locales/${lang}/${part.name}.json`;
    try {
      const json = parseJson(await fetchText(url, f), url);
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        for (const [k, v] of Object.entries(json as Record<string, unknown>)) if (typeof v === 'string') out[k] = v;
      }
    } catch (e) {
      if (part.required) throw e;
      // common.json пока нет ни в одном языке — это штатно, молчим.
      if (part.name !== 'common') warn(`[i18n] ${(e as Error).message}`);
    }
  }
  return out;
}

/** Догрузить в словарь указанные языки и цепочку фолбэков (lang → en → ru) — только то, чего ещё нет. */
export async function ensureLangs(
  i18n: I18n,
  base: string,
  episodeId: string,
  langs: readonly Lang[],
  f: FetchLike = defaultFetch,
): Promise<void> {
  const needed = [...new Set(langs.flatMap((l) => fallbackChain(l)))].filter((l) => !i18n.hasLang(l));
  const loaded = await Promise.all(needed.map(async (l) => [l, await loadStrings(base, l, episodeId, f)] as const));
  for (const [l, strings] of loaded) i18n.addStrings(l, strings);
}

/**
 * Индекс клипов озвучки (voice-index.json в корне сборки, его строит плагин ассетов). Никогда не бросает и не шумит:
 * нет файла, ответ не JSON (SPA-фолбэк сервера), сбой сети или таймаут — индекс пуст, озвучка молчит, игра грузится
 * как раньше. Запрос уходит параллельно загрузке эпизода и шрифтов, поэтому старт не замедляет.
 */
export async function loadVoiceIndex(base: string, f: FetchLike = defaultFetch, timeoutMs = 2500): Promise<VoiceIndex> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const load = (async (): Promise<VoiceIndex> => {
      const res = await f(`${base}${VOICE_INDEX_FILE}`);
      return res.ok ? VoiceIndex.parse(JSON.parse(await res.text())) : VoiceIndex.empty();
    })();
    const timeout = new Promise<VoiceIndex>((resolve) => {
      timer = setTimeout(() => resolve(VoiceIndex.empty()), timeoutMs);
    });
    return await Promise.race([load, timeout]);
  } catch {
    return VoiceIndex.empty();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
