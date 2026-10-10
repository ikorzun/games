/**
 * Точка входа: платформа → сейвы и настройки → эпизод и локали → шрифты → сцена и интерфейс →
 * меню → `game_ready`. Никаких внешних ресурсов: шрифты, стили и контент лежат в сборке.
 */
import '@fontsource/pt-mono/cyrillic-400.css';
import '@fontsource/pt-mono/latin-400.css';
import '@fontsource/pt-mono/latin-ext-400.css';
import '@fontsource/pt-sans-narrow/cyrillic-700.css';
import '@fontsource/pt-sans-narrow/latin-700.css';
import '@fontsource/pt-sans-narrow/latin-ext-700.css';
import '@fontsource/pt-sans/cyrillic-400-italic.css';
import '@fontsource/pt-sans/cyrillic-400.css';
import '@fontsource/pt-sans/cyrillic-700.css';
import '@fontsource/pt-sans/latin-400-italic.css';
import '@fontsource/pt-sans/latin-400.css';
import '@fontsource/pt-sans/latin-700.css';
import '@fontsource/pt-sans/latin-ext-400.css';
import '@fontsource/pt-sans/latin-ext-700.css';
import './stage/stage.css';
import './ui/styles.css';

import { App } from './app';
import { i18n, parseSupportedLang } from './core/i18n';
import { ensureLangs, loadEpisode, loadManifest } from './core/loader';
import { SaveManager } from './core/saves';
import type { Lang } from './core/types';
import { installDebug } from './debug/debug';
import { registerBuiltinMinigames } from './minigames/registry';
import { createPlatform } from './platform';
import { createAppAssets, loadUiArt } from './stage/app_assets';
import type { AppAssets } from './stage/app_assets';
import { AudioManager } from './stage/audio';
import { HtmlAudioBackend } from './stage/audio_html';
import type { RendererChoice } from './stage/stage_factory';

/** Дождаться шрифтов, но не дольше таймаута: без них игра всё равно играбельна. */
async function loadFonts(timeoutMs = 2500): Promise<void> {
  if (!('fonts' in document)) return;
  const sample = 'Аёбв Ññãçüé ¿¡';
  const load = Promise.all([
    document.fonts.load('16px "PT Sans"', sample),
    document.fonts.load('italic 16px "PT Sans"', sample),
    document.fonts.load('700 16px "PT Sans"', sample),
    document.fonts.load('700 16px "PT Sans Narrow"', sample),
    document.fonts.load('16px "PT Mono"', sample),
  ]);
  await Promise.race([load, new Promise((r) => setTimeout(r, timeoutMs))]);
}

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

function fatal(root: HTMLElement, e: unknown): void {
  console.error('[boot]', e);
  root.classList.add('vn-root');
  const pre = document.createElement('pre');
  pre.className = 'vn-error__msg';
  pre.style.cssText = 'margin:0;padding:16px;white-space:pre-wrap;color:#ffb3ad;font:14px monospace';
  pre.textContent = `Failed to start\n${e instanceof Error ? e.message : String(e)}`;
  root.replaceChildren(pre);
}

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('нет контейнера #app');
  const params = new URLSearchParams(location.search);

  try {
    const platform = await createPlatform();
    const saves = new SaveManager(platform, { slots: platform.capabilities.manualSlots });
    await saves.init();

    const base = import.meta.env.BASE_URL;
    const manifest = await loadManifest(base);
    const wanted = params.get('episode');
    const entry = manifest.find((m) => m.id === wanted) ?? manifest[0];
    if (!entry) throw new Error('в манифесте нет эпизодов');
    const { episode, contentVersion } = await loadEpisode(base, entry);

    // Язык: ?lang= → выбор игрока → язык платформы (bridge.platform.language / браузер) → en.
    const lang: Lang = parseSupportedLang(params.get('lang')) ?? saves.settings.lang ?? platform.language();
    await ensureLangs(i18n, base, episode.id, [lang]);
    i18n.setLang(lang);
    if (params.get('pseudo') === '1') i18n.setPseudo(true);

    registerBuiltinMinigames();
    await loadFonts();

    // Ассеты: каталог путей эпизода, хранилище картинок, предзагрузка по блокам, звук на HTMLAudioElement.
    let assets: AppAssets | null = null;
    const backend = new HtmlAudioBackend((id) => assets?.catalog.audioUrl(id) ?? null);
    backend.installUnlock(); // iOS: звук разблокируется первым касанием
    assets = createAppAssets(episode, base, backend);
    const audio = new AudioManager(backend);
    // Картинки меню и заставки грузим до первого показа меню (но не дольше пары секунд).
    await loadUiArt(assets);
    const renderer = params.get('renderer');
    const app = await App.create({
      root,
      platform,
      saves,
      episode,
      contentVersion,
      audio,
      assets,
      loadLang: (l) => ensureLangs(i18n, base, episode.id, [l]),
      renderer: renderer === 'dom' || renderer === 'pixi' ? (renderer as RendererChoice) : 'auto',
      debug: params.get('debug') === '1' || import.meta.env.DEV,
    });
    installDebug(app);

    if (params.get('autostart') === '1') await app.startNewGame({ skipWarning: true });
    else app.showMenu();

    // Первый играбельный кадр (меню отрисовано, шрифты загружены) → game_ready.
    await nextFrame();
    platform.ready();
  } catch (e) {
    fatal(root, e);
  }
}

void boot();
