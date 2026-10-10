/** Доступ тестов к настоящему контенту репозитория (../episodes, ../locales). */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Episode, Lang } from '../../src/core/types';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..', '..');

export const EP01_PATH = join(REPO_ROOT, 'episodes', 's1', 'ep01_murylev.json');

export function hasRepoContent(): boolean {
  return existsSync(EP01_PATH);
}

export function loadEpisode(path: string = EP01_PATH): Episode {
  return JSON.parse(readFileSync(path, 'utf8')) as Episode;
}

export function loadLocale(lang: Lang, name: string): Record<string, string> {
  const p = join(REPO_ROOT, 'locales', lang, `${name}.json`);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Record<string, string>) : {};
}

/** ui.json + <episode>.json одного языка, как их сливает загрузчик. */
export function loadStrings(lang: Lang, episodeId: string): Record<string, string> {
  return { ...loadLocale(lang, 'ui'), ...loadLocale(lang, 'common'), ...loadLocale(lang, episodeId) };
}
