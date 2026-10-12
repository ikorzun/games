/**
 * Точка входа: платформа → сейвы и настройки → эпизод и локали → шрифты → сцена и интерфейс →
 * меню → `game_ready`. Никаких внешних ресурсов: шрифты, стили и контент лежат в сборке.
 */
import './stage/stage.css';
import './ui/styles.css';

import { App } from './app';
import { i18n, parseSupportedLang } from './core/i18n';
import { ensureLangs, loadEpisode, loadManifest, loadSeason, loadVoiceIndex } from './core/loader';
import { SaveManager } from './core/saves';
import type { Lang } from './core/types';
import { installDebug } from './debug/debug';
import { registerBuiltinMinigames } from './minigames/registry';
import { createPlatform } from './platform';
import { createAppAssets, loadUiArt } from './stage/app_assets';
import type { AppAssets } from './stage/app_assets';
import { joinUrl } from './stage/assets';
import { AudioManager } from './stage/audio';
import { HtmlAudioBackend } from './stage/audio_html';
import type { RendererChoice } from './stage/stage_factory';
import { LineVoice } from './stage/voice';

/** Дождаться шрифтов, но не дольше таймаута: без них игра всё равно играбельна. */
async function loadFonts(timeoutMs = 2500): Promise<void> {
  if (!('fonts' in document)) return;
  // DM Mono (латиница) и JetBrains Mono (кириллица) — свои файлы в src/ui/fonts (@font-face в styles.css).
  const sample = 'Аёбв Ññãçüé ¿¡ 1993';
  const load = Promise.all([
    document.fonts.load('16px "DM Mono"', sample),
    document.fonts.load('300 16px "DM Mono"', sample),
    document.fonts.load('16px "JetBrains Mono"', sample),
    document.fonts.load('300 16px "JetBrains Mono"', sample),
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

/** `?items=arc_keys,arc_registration` → id материалов архива (только `[a-z0-9_]`). */
export function parseItemsParam(raw: string | null): string[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter((s) => /^[a-z][a-z0-9_]*$/.test(s));
}

/** `?vars=a:true,b:3,c:full` → пары имя/значение; значения как в эффектах: true/false, целое число, иначе строка. */
export function parseVarsParam(raw: string | null): Array<[string, boolean | number | string]> {
  const out: Array<[string, boolean | number | string]> = [];
  for (const part of (raw ?? '').split(',')) {
    const i = part.indexOf(':');
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!/^[a-z][a-z0-9_]*$/.test(name)) continue;
    if (v === 'true' || v === 'false') out.push([name, v === 'true']);
    else if (/^-?\d+$/.test(v)) out.push([name, Number(v)]);
    else out.push([name, v]);
  }
  return out;
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
    const voiceIndexLoad = loadVoiceIndex(base); // индекс клипов озвучки: параллельно манифесту и эпизоду, ошибок не бросает
    const manifest = await loadManifest(base);
    const wanted = params.get('episode');
    const entry = manifest.find((m) => m.id === wanted) ?? manifest[0];
    if (!entry) throw new Error('в манифесте нет эпизодов');
    const seasonLoad = loadSeason(base, entry.season); // рамка сезона для полки эпизодов меню: ошибок не бросает
    const { episode, contentVersion } = await loadEpisode(base, entry);

    // Язык: ?lang= → выбор игрока → язык платформы (bridge.platform.language / браузер) → en.
    const lang: Lang = parseSupportedLang(params.get('lang')) ?? saves.settings.lang ?? platform.language();
    await ensureLangs(i18n, base, episode.id, [lang]);
    i18n.setLang(lang);
    document.documentElement.lang = lang; // по языку выбирается шрифт (кириллица — JetBrains Mono)
    if (params.get('pseudo') === '1') i18n.setPseudo(true);

    registerBuiltinMinigames();
    await loadFonts();

    // Ассеты: каталог путей эпизода, хранилище картинок, предзагрузка по блокам, звук на HTMLAudioElement.
    let assets: AppAssets | null = null;
    const backend = new HtmlAudioBackend((id) => assets?.catalog.audioUrl(id) ?? null);
    backend.installUnlock(); // iOS: звук разблокируется первым касанием
    const audio = new AudioManager(backend);
    // Озвучка реплик: клип берётся только если он есть в индексе (нет клипов — реплики немые, без запросов и предупреждений).
    const voice = new LineVoice({ episode, index: await voiceIndexLoad, url: (path) => joinUrl(base, path), lang: () => i18n.lang, output: audio });
    assets = createAppAssets(episode, base, backend, undefined, voice);
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
      voice,
      assets,
      loadLang: (l) => ensureLangs(i18n, base, episode.id, [l]),
      season: await seasonLoad,
      renderer: renderer === 'dom' || renderer === 'pixi' ? (renderer as RendererChoice) : 'auto',
      debug: params.get('debug') === '1' || import.meta.env.DEV,
    });
    installDebug(app);

    // Быстрая проверка геймплея: ?scene=s41b_q&vars=keys_found:true&items=arc_keys,arc_registration — новая партия
    // минуя меню, переменные как у эффектов сценария (true/false, целое, строка), материалы архива (улики
    // дедуктивных развилок), переход сразу к сцене.
    const testScene = params.get('scene');
    if (testScene) {
      await app.startNewGame({ skipWarning: true });
      for (const [name, value] of parseVarsParam(params.get('vars'))) app.debugSet(name, value);
      for (const item of parseItemsParam(params.get('items'))) app.debugUnlock(item);
      app.debugGoto(testScene);
    } else if (params.get('autostart') === '1') await app.startNewGame({ skipWarning: true });
    else app.showMenu(); // меню сразу; главная тема стартует при показе (или при первом жесте, если автозапуск запрещён)

    // Первый играбельный кадр (меню отрисовано, шрифты загружены) → game_ready.
    await nextFrame();
    platform.ready();
  } catch (e) {
    fatal(root, e);
  }
}

void boot();
