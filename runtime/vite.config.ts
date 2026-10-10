import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import playgamaBridge from '@playgama/bridge/vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { assetsPlugin } from './scripts/assets_plugin.mjs';

/**
 * Контент (эпизоды и локали) лежит вне runtime/ и рантаймом не владеет:
 *   ../episodes/**.json            → /episodes/**.json
 *   ../locales/<lang>/*.json       → /locales/<lang>/*.json
 * В dev-режиме файлы отдаются middleware прямо из репозитория (с перезагрузкой страницы
 * при правке JSON), в build — копируются в dist как обычные статические ассеты.
 * Плюс генерируется /episodes/index.json — манифест эпизодов для загрузчика.
 * Всё, что начинается с «_» (черновики, _export), в сборку не попадает.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const EPISODES_DIR = join(REPO_ROOT, 'episodes');
const LOCALES_DIR = join(REPO_ROOT, 'locales');
const LANGS = ['ru', 'en', 'es', 'pt'] as const;
/** Графика и звук (webp, png, mp3): ../assets → /assets/** в dev и dist/assets/** в сборке; scripts/assets_plugin.mjs. */
const ASSETS_DIR = process.env.VN_ASSETS_DIR ? resolve(process.env.VN_ASSETS_DIR) : join(REPO_ROOT, 'assets');

interface ContentFile {
  /** Путь в сборке и в dev-сервере, без ведущего «/». */
  url: string;
  abs: string;
}

function walkJson(dir: string, urlPrefix: string, out: ContentFile[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('_') || name.startsWith('.')) continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walkJson(abs, `${urlPrefix}/${name}`, out);
    else if (name.endsWith('.json')) out.push({ url: `${urlPrefix}/${name}`, abs });
  }
}

function collectContent(): { files: ContentFile[]; manifest: string } {
  const files: ContentFile[] = [];
  walkJson(EPISODES_DIR, 'episodes', files);
  for (const lang of LANGS) walkJson(join(LOCALES_DIR, lang), `locales/${lang}`, files);

  const episodes: Array<Record<string, unknown>> = [];
  for (const f of files) {
    if (!f.url.startsWith('episodes/')) continue;
    try {
      const ep = JSON.parse(readFileSync(f.abs, 'utf8')) as Record<string, unknown>;
      if (typeof ep.id === 'string' && Array.isArray(ep.blocks) && ep.scenes && typeof ep.scenes === 'object') {
        episodes.push({
          id: ep.id,
          path: f.url,
          season: ep.season,
          order: ep.order,
          title_key: ep.title_key,
          logline_key: ep.logline_key,
          estimated_minutes: ep.estimated_minutes,
          age_rating: ep.age_rating,
          content_warnings: ep.content_warnings ?? [],
        });
      }
    } catch (e) {
      console.warn(`[vn-content] пропущен ${f.url}: ${(e as Error).message}`);
    }
  }
  episodes.sort(
    (a, b) => Number(a.season) - Number(b.season) || Number(a.order) - Number(b.order),
  );
  return { files, manifest: JSON.stringify({ episodes }, null, 2) + '\n' };
}

function contentPlugin(): Plugin {
  return {
    name: 'vn-content',

    configureServer(server) {
      server.watcher.add([EPISODES_DIR, LOCALES_DIR]);
      const onChange = (file: string): void => {
        if (file.startsWith(EPISODES_DIR) || file.startsWith(LOCALES_DIR)) {
          server.ws.send({ type: 'full-reload' });
        }
      };
      server.watcher.on('change', onChange);
      server.watcher.on('add', onChange);

      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0] ?? '').replace(/^\/+/, '');
        if (!url.startsWith('episodes/') && !url.startsWith('locales/')) return next();
        const { files, manifest } = collectContent();
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (url === 'episodes/index.json') {
          res.end(manifest);
          return;
        }
        const hit = files.find((f) => f.url === url);
        if (!hit) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'not found', url }));
          return;
        }
        res.end(readFileSync(hit.abs));
      });
    },

    generateBundle() {
      const { files, manifest } = collectContent();
      for (const f of files) {
        this.emitFile({ type: 'asset', fileName: f.url, source: readFileSync(f.abs) });
      }
      this.emitFile({ type: 'asset', fileName: 'episodes/index.json', source: manifest });
    },
  };
}

/**
 * Сборка для Playgama: `npm run build:playgama` (= `vite build --mode playgama`) → dist-playgama/.
 *   - официальный плагин @playgama/bridge/vite в режиме `local`: runtime Bridge SDK копируется в корень
 *     архива (playgama-bridge.js), тег <script> вставляется в <head> раньше кода игры — window.bridge
 *     появляется до старта рантайма, внешних запросов за SDK нет (режим `cdn` тянул бы его с CDN);
 *   - минимальный playgama-bridge-config.json рядом с index.html (SDK запрашивает его при initialize();
 *     без файла работает, но пишет ошибку в консоль). Настоящий конфиг (реклама, платежи, таски)
 *     собирается в редакторе конфигов Playgama и заменяет этот файл.
 * Обычная сборка (`npm run build` → dist/) Bridge не содержит: платформа выбирается по window.bridge,
 * без него работает web-plain.
 */
function bridgeConfigPlugin(): Plugin {
  return {
    name: 'vn-playgama-config',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'playgama-bridge-config.json', source: '{}\n' });
    },
  };
}

export default defineConfig(({ mode }) => {
  const playgama = mode === 'playgama';
  return {
    // Относительные пути: index.html в корне архива, работает из любой подпапки (Playgama).
    base: './',
    plugins: [contentPlugin(), assetsPlugin({ dir: ASSETS_DIR }), ...(playgama ? [playgamaBridge({ mode: 'local' }), bridgeConfigPlugin()] : [])],
    build: {
      outDir: playgama ? 'dist-playgama' : 'dist',
      emptyOutDir: true,
      target: 'es2020',
      sourcemap: false,
      // PixiJS выносится в отдельный чанк (ленивый import) и заведомо больше 500 КБ.
      chunkSizeWarningLimit: 1600,
    },
    server: { host: true, port: 5173 },
    preview: { host: true, port: 4173 },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
      reporters: ['default'],
    },
  };
});
