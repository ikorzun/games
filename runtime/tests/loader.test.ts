/** Загрузчик контента: манифест, эпизод, локали, догрузка языков; ошибки сети и формата. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { I18n } from '../src/core/i18n';
import {
  assertEpisode,
  ContentError,
  contentHash,
  ensureLangs,
  loadCase,
  loadEpisode,
  loadManifest,
  loadStrings,
  loadSeason,
  loadVoiceIndex,
} from '../src/core/loader';
import type { FetchedResponse, FetchLike } from '../src/core/loader';
import { EP01_PATH, hasRepoContent, REPO_ROOT } from './helpers/content';
import { miniEpisode } from './helpers/mini';

type Route = string | { status: number } | { throws: string };

/** fetch поверх таблицы «url → тело / код ошибки / исключение»; ведёт журнал запросов. */
function fakeFetch(routes: Record<string, Route>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const f = ((url: string): Promise<FetchedResponse> => {
    calls.push(url);
    const r = routes[url];
    if (r === undefined) return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
    if (typeof r === 'string') return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(r) });
    if ('throws' in r) return Promise.reject(new Error(r.throws));
    return Promise.resolve({ ok: false, status: r.status, text: () => Promise.resolve('') });
  }) as FetchLike & { calls: string[] };
  f.calls = calls;
  return f;
}

const episodeJson = (over: Record<string, unknown> = {}): string => JSON.stringify({ ...miniEpisode({ s1: { steps: [{ do: 'end', ending: 'e_main' }] } }), ...over });

describe('contentHash', () => {
  it('детерминирован, 8 hex-символов, чувствителен к любой правке текста', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'));
    expect(contentHash('abc')).toMatch(/^[0-9a-f]{8}$/);
    expect(contentHash('abc')).not.toBe(contentHash('abd'));
    expect(contentHash('')).toMatch(/^[0-9a-f]{8}$/);
    expect(contentHash('привет')).not.toBe(contentHash('привеt'));
  });
});

describe('loadManifest', () => {
  it('читает episodes/index.json относительно базового пути', async () => {
    const f = fakeFetch({ './episodes/index.json': JSON.stringify({ episodes: [{ id: 'ep01', path: 'episodes/s1/ep01.json', season: 1, order: 1, title_key: 'k', content_warnings: [] }] }) });
    const list = await loadManifest('./', f);
    expect(list.map((e) => e.id)).toEqual(['ep01']);
    expect(f.calls).toEqual(['./episodes/index.json']);
  });

  it('пустой манифест, HTTP-ошибка, сетевой сбой и невалидный JSON — ContentError с понятным текстом', async () => {
    await expect(loadManifest('./', fakeFetch({ './episodes/index.json': '{"episodes":[]}' }))).rejects.toThrow(/нет эпизодов/);
    await expect(loadManifest('./', fakeFetch({ './episodes/index.json': { status: 500 } }))).rejects.toThrow(/HTTP 500/);
    await expect(loadManifest('./', fakeFetch({ './episodes/index.json': { throws: 'offline' } }))).rejects.toThrow(/offline/);
    await expect(loadManifest('./', fakeFetch({ './episodes/index.json': '{oops' }))).rejects.toBeInstanceOf(ContentError);
    await expect(loadManifest('./', fakeFetch({}))).rejects.toThrow(/HTTP 404/);
  });
});

describe('loadEpisode', () => {
  const entry = { id: 'ep_mini', path: 'episodes/ep_mini.json' };

  it('возвращает эпизод и версию контента id@хеш; правка текста меняет версию', async () => {
    const a = await loadEpisode('./', entry, fakeFetch({ './episodes/ep_mini.json': episodeJson() }));
    expect(a.episode.id).toBe('ep_mini');
    expect(a.contentVersion).toBe(`ep_mini@${contentHash(episodeJson())}`);
    const b = await loadEpisode('./', entry, fakeFetch({ './episodes/ep_mini.json': episodeJson({ order: 2 }) }));
    expect(b.contentVersion).not.toBe(a.contentVersion);
  });

  it('id в файле не совпал с манифестом — ошибка', async () => {
    await expect(loadEpisode('./', { id: 'other', path: entry.path }, fakeFetch({ './episodes/ep_mini.json': episodeJson() }))).rejects.toThrow(/не совпадает/);
  });

  it('assertEpisode перечисляет все недостающие части', () => {
    expect(() => assertEpisode(null, 'x')).toThrow(/это не объект/);
    expect(() => assertEpisode({ schema_version: 2 }, 'x')).toThrow(/schema_version=2/);
    try {
      assertEpisode({ schema_version: 1 }, 'ep.json');
      expect.unreachable();
    } catch (e) {
      const msg = (e as Error).message;
      expect(e).toBeInstanceOf(ContentError);
      for (const part of ['нет id', 'нет blocks', 'нет scenes', 'нет endings', 'нет variables', 'нет cast', 'нет assets']) expect(msg).toContain(part);
      expect(msg).toContain('ep.json');
    }
  });
});

describe('loadStrings / ensureLangs', () => {
  const routes: Record<string, Route> = {
    './locales/ru/ui.json': JSON.stringify({ 'ui.a': 'ру-ui', 'ui.n': 5 }),
    './locales/ru/ep_mini.json': JSON.stringify({ 'ep.x': 'ру-эпизод' }),
    './locales/en/ui.json': JSON.stringify({ 'ui.a': 'en-ui' }),
    './locales/en/common.json': JSON.stringify({ 'common.ok': 'OK' }),
    // en/ep_mini.json нет — предупреждение; es целиком нет
  };

  it('сливает ui + common + файл эпизода в один словарь, нестроковые значения отбрасываются', async () => {
    const strings = await loadStrings('./', 'ru', 'ep_mini', fakeFetch(routes), () => undefined);
    expect(strings).toEqual({ 'ui.a': 'ру-ui', 'ep.x': 'ру-эпизод' });
  });

  it('для ru ui и файл эпизода обязательны, для остальных отсутствие — предупреждение, common молчит', async () => {
    await expect(loadStrings('./', 'ru', 'ep_mini', fakeFetch({ './locales/ru/ui.json': '{}' }), () => undefined)).rejects.toThrow(/ep_mini/);
    const warn = vi.fn();
    const en = await loadStrings('./', 'en', 'ep_mini', fakeFetch(routes), warn);
    expect(en).toEqual({ 'ui.a': 'en-ui', 'common.ok': 'OK' });
    expect(warn).toHaveBeenCalledTimes(1); // только en/ep_mini.json; отсутствие common — штатно
    expect(String(warn.mock.calls[0]?.[0])).toContain('en/ep_mini.json');
  });

  it('ensureLangs грузит язык и его цепочку фолбэков (es → en → ru) и только то, чего ещё нет', async () => {
    const i18n = new I18n();
    const f = fakeFetch(routes);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await ensureLangs(i18n, './', 'ep_mini', ['es'], f);
      expect(['ru', 'en', 'es'].every((l) => i18n.hasLang(l as 'ru'))).toBe(true);
      const afterFirst = f.calls.length;
      await ensureLangs(i18n, './', 'ep_mini', ['es', 'en'], f);
      expect(f.calls.length).toBe(afterFirst); // ничего лишнего
      i18n.setLang('es');
      expect(i18n.t('ui.a')).toBe('en-ui'); // es пуст → en
      expect(i18n.t('ep.x')).toBe('ру-эпизод'); // нет и в en → ru
      expect(i18n.t('common.ok')).toBe('OK');
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe.skipIf(!hasRepoContent())('загрузчик на настоящем контенте репозитория', () => {
  /** fetch поверх файловой системы: './x/y.json' → <repo>/x/y.json. */
  const diskFetch: FetchLike = async (url) => {
    try {
      const body = readFileSync(join(REPO_ROOT, url.replace(/^\.\//, '')), 'utf8');
      return { ok: true, status: 200, text: () => Promise.resolve(body) };
    } catch {
      return { ok: false, status: 404, text: () => Promise.resolve('') };
    }
  };

  it('ep01 и локали ru/en загружаются; все text-ключи ru-эпизода разрешаются через цепочку i18n', async () => {
    const rel = EP01_PATH.slice(REPO_ROOT.length + 1).split('\\').join('/');
    const { episode, contentVersion } = await loadEpisode('./', { id: 'ep01_murylev', path: rel }, diskFetch);
    expect(contentVersion).toMatch(/^ep01_murylev@[0-9a-f]{8}$/);
    const i18n = new I18n();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await ensureLangs(i18n, './', episode.id, ['en'], diskFetch);
    } finally {
      vi.restoreAllMocks();
    }
    i18n.setLang('en');
    expect(i18n.hasLang('ru')).toBe(true);
    expect(i18n.t(episode.title_key)).not.toMatch(/^\[/);
  });

  it('manifest-независимая проверка: имя файла эпизода из репозитория проходит assertEpisode', () => {
    const json: unknown = JSON.parse(readFileSync(EP01_PATH, 'utf8'));
    expect(() => assertEpisode(json, EP01_PATH)).not.toThrow();
  });
});

describe('loadSeason: рамка сезона для полки эпизодов', () => {
  it('файл есть — сезон с полкой; слоты без order отбрасываются', async () => {
    const f = fakeFetch({ './episodes/s1/season.json': JSON.stringify({ season: 1, title_key: 'ui.season.s1.title', years: '1992–1997', episodes: [{ order: 1, id: 'ep01', year: 1993, cover: 'assets/a.webp' }, { order: 2, year: 1994 }, { year: 1999 }] }) });
    expect(await loadSeason('./', 1, f)).toEqual({ season: 1, title_key: 'ui.season.s1.title', years: '1992–1997', episodes: [{ order: 1, id: 'ep01', year: 1993, cover: 'assets/a.webp' }, { order: 2, year: 1994 }] });
  });

  it('нет файла, кривой JSON или чужой сезон — null без исключений', async () => {
    expect(await loadSeason('./', 1, fakeFetch({ './episodes/s1/season.json': { status: 404 } }))).toBeNull();
    expect(await loadSeason('./', 1, fakeFetch({ './episodes/s1/season.json': '<html>' }))).toBeNull();
    expect(await loadSeason('./', 1, fakeFetch({ './episodes/s1/season.json': JSON.stringify({ season: 2, title_key: 'k', episodes: [] }) }))).toBeNull();
  });

  it.skipIf(!hasRepoContent())('season.json сезона 1 в репозитории: текущий эпизод на полке, у остальных — год', () => {
    const s = JSON.parse(readFileSync(join(REPO_ROOT, 'episodes', 's1', 'season.json'), 'utf8')) as { episodes: Array<{ id?: string; year?: number }> };
    expect(s.episodes.some((x) => x.id === 'ep01_hod')).toBe(true);
    expect(s.episodes.every((x) => typeof x.year === 'number')).toBe(true);
  });
});

describe('loadVoiceIndex: индекс клипов озвучки', () => {
  const INDEX = JSON.stringify({ version: 1, episodes: { ep01: { ru: ['ep01.s01.l001.mp3'], en: ['ep01.s01.l001.mp3'] } } });

  it('читает voice-index.json рядом с episodes/index.json (относительно базового пути)', async () => {
    const f = fakeFetch({ './voice-index.json': INDEX });
    const idx = await loadVoiceIndex('./', f);
    expect(f.calls).toEqual(['./voice-index.json']);
    expect(idx.size).toBe(2);
    expect(idx.find('ep01_murylev', 'ru', 'ep01.s01.l001')?.path).toBe('assets/ep01/voice/ru/ep01.s01.l001.mp3');
  });

  it('нет файла, HTTP-ошибка, сетевой сбой, не JSON (SPA-фолбэк отдал HTML), мусор — пустой индекс без исключения', async () => {
    for (const route of [{ status: 404 }, { status: 500 }, { throws: 'offline' }, '<!doctype html><title>spa</title>', '{oops', '[]', 'null', '{"version":3}'] as const) {
      const idx = await loadVoiceIndex('./', fakeFetch({ './voice-index.json': route }));
      expect(idx.size, JSON.stringify(route)).toBe(0);
    }
    expect((await loadVoiceIndex('./', fakeFetch({}))).size).toBe(0); // маршрута нет вовсе → 404
  });

  it('зависший запрос не задерживает старт: по таймауту — пустой индекс', async () => {
    vi.useFakeTimers();
    try {
      const hang: FetchLike = () => new Promise<FetchedResponse>(() => undefined);
      const p = loadVoiceIndex('./', hang, 2500);
      let done = false;
      void p.then(() => (done = true));
      await vi.advanceTimersByTimeAsync(2400);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(done).toBe(true);
      expect((await p).size).toBe(0);
      // быстрый ответ таймер не оставляет
      expect((await loadVoiceIndex('./', fakeFetch({ './voice-index.json': INDEX }), 2500)).size).toBe(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('loadCase: дело рядом с эпизодом', () => {
  const ep = miniEpisode({ s1: { steps: [{ do: 'end', ending: 'e_main' }] } });
  const entry = { path: 'episodes/s1/x.json' };
  const URL = '/b/episodes/s1/x.case.json';
  const good = { schema_version: 1, episode: ep.id, title_key: 't', traits: [], suspects: [], clues: [], scenes: {}, talks: {}, chapters: [{ id: 'ch1', title_key: 'c', tasks: [] }] };

  it('читает <эпизод>.case.json и проверяет, что это дело этого эпизода', async () => {
    await expect(loadCase('/b/', entry, ep, fakeFetch({ [URL]: JSON.stringify(good) }))).resolves.toMatchObject({ episode: ep.id });
  });

  it('никогда не бросает: нет файла, кривой JSON, чужой эпизод, сбой сети — null', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(loadCase('/b/', entry, ep, fakeFetch({}))).resolves.toBeNull();
    await expect(loadCase('/b/', entry, ep, fakeFetch({ [URL]: '{нет' }))).resolves.toBeNull();
    await expect(loadCase('/b/', entry, ep, fakeFetch({ [URL]: JSON.stringify({ ...good, episode: 'other' }) }))).resolves.toBeNull();
    await expect(loadCase('/b/', entry, ep, fakeFetch({ [URL]: { throws: 'offline' } }))).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(3); // 404 — штатно и молча
    warn.mockRestore();
  });
});
