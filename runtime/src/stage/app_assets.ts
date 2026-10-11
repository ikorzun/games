/**
 * Сборка ассетов приложения: каталог путей эпизода + хранилище загруженных картинок + предзагрузка
 * по блокам + картинки интерфейса (меню, плашка заставки, бланки документов). Всё, что рантайм знает
 * про файлы в assets/**, собрано здесь; остальные модули получают готовые порты.
 */
import type { Episode } from '../core/types';
import { AssetCatalog, AssetStore, StoreSceneAssets, UI_ASSETS, dirnameOf, isSolidBlackFile, NEUTRAL_EXPRESSION, SPRITE_FILE_EXT } from './assets';
import { BlockPreloader } from './preload';
import type { AudioPreloader, PreloadHooks } from './preload';
import type { IVoiceWarmer } from './voice';

/** Адреса уже загруженных картинок интерфейса; null — файла нет, остаётся прежнее оформление. */
export interface UiArt {
  background: string | null;
  plate: string | null;
}

export interface AppAssets {
  readonly catalog: AssetCatalog;
  readonly store: AssetStore;
  readonly scene: StoreSceneAssets;
  readonly preloader: BlockPreloader;
  /** Хуки предзагрузки (индикатор, телеметрия): App заполняет их после сборки интерфейса. */
  readonly hooks: PreloadHooks;
  art: UiArt;
  /** Бланк документа: адрес сразу (если уже загружен) и промис на случай, если ещё грузится. */
  document(docId: string): { url: string | null; ready: Promise<string | null> };
  /** Проверить все файлы, объявленные в episode.assets (HEAD-запросы без загрузки тела) — для QA. */
  verify(fetchFn?: (url: string, init?: { method: string }) => Promise<{ ok: boolean; headers: { get(name: string): string | null } }>): Promise<{ present: string[]; missing: string[] }>;
}

export function createAppAssets(
  episode: Episode,
  base: string,
  audio: AudioPreloader | null,
  store: AssetStore = new AssetStore(),
  voice: IVoiceWarmer | null = null,
): AppAssets {
  const catalog = new AssetCatalog(episode, base);
  const hooks: PreloadHooks = {};
  const preloader = new BlockPreloader({ episode, catalog, store, audio, voice, hooks });
  const scene = new StoreSceneAssets(catalog, store);

  const out: AppAssets = {
    catalog,
    store,
    scene,
    preloader,
    hooks,
    art: { background: null, plate: null },
    document(docId) {
      const url = catalog.docUrl(docId);
      if (!url) return { url: null, ready: Promise.resolve(null) };
      const have = store.peek(url);
      const ready = store.load(url).then((h) => {
        if (!h) store.warnMissing([url]);
        return h ? h.url : null;
      });
      return { url: have ? have.url : null, ready };
    },
    async verify(fetchFn) {
      const f = fetchFn ?? ((url, init) => fetch(url, init));
      const urls = new Set<string>();
      const a = episode.assets;
      // black.png — не файл, а сплошной цвет (bg_black): ни запрашивать, ни считать пропавшим его не нужно
      for (const list of [a.backgrounds, a.cg, a.documents, a.music, a.sfx, a.ambient, a.voice]) for (const e of list ?? []) if (!isSolidBlackFile(e.path)) urls.add(catalog.url(e.path));
      for (const set of a.sprites ?? []) {
        urls.add(catalog.url(set.base));
        const dir = dirnameOf(set.base);
        for (const expr of new Set([NEUTRAL_EXPRESSION, ...set.expressions])) urls.add(catalog.url(`${dir}/${expr}.${SPRITE_FILE_EXT}`));
      }
      urls.add(catalog.url(UI_ASSETS.menuBackground));
      urls.add(catalog.url(UI_ASSETS.titlePlate));
      const present: string[] = [];
      const missing: string[] = [];
      await Promise.all(
        [...urls].map(async (url) => {
          try {
            const res = await f(url, { method: 'HEAD' });
            const type = res.headers.get('content-type') ?? '';
            // SPA-фолбэк сервера отдаёт HTML с кодом 200 — это «файла нет»
            if (res.ok && !/^text\/html/i.test(type)) present.push(url);
            else missing.push(url);
          } catch {
            missing.push(url);
          }
        }),
      );
      return { present: present.sort(), missing: missing.sort() };
    },
  };
  return out;
}

/** Картинки интерфейса: меню и плашка заставки. Ждём не дольше timeoutMs; нет файла — предупреждение и прежний вид. */
export async function loadUiArt(assets: AppAssets, timeoutMs = 2000): Promise<UiArt> {
  const { catalog, store } = assets;
  const bgUrl = catalog.url(UI_ASSETS.menuBackground);
  const plateUrl = catalog.url(UI_ASSETS.titlePlate);
  store.pin(bgUrl);
  store.pin(plateUrl);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const both = Promise.all([store.load(bgUrl, 'now'), store.load(plateUrl, 'now')]);
  const res = await Promise.race([both, timeout]);
  if (timer !== undefined) clearTimeout(timer);
  if (res === 'timeout') return { background: null, plate: null };
  const [bg, plate] = res;
  if (!bg) store.warnMissing([bgUrl]);
  if (!plate) store.warnMissing([plateUrl]);
  const art = { background: bg ? bg.url : null, plate: plate ? plate.url : null };
  assets.art = art;
  return art;
}
