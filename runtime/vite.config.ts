import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

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

export default defineConfig({
  // Относительные пути: index.html в корне архива, работает из любой подпапки (Playgama).
  base: './',
  plugins: [contentPlugin()],
  build: {
    outDir: 'dist',
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
});
