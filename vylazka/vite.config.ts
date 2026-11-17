import { existsSync, readdirSync, readFileSync } from 'node:fs';
import playgamaBridge from '@playgama/bridge/vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Сборка для Playgama: `npm run build:playgama` (= `vite build --mode playgama`) → dist-playgama/.
 * Как собрать, проверить и что ещё нужно на площадке — docs/vylazka/playgama.md.
 * Плагин @playgama/bridge/vite в режиме `local` кладёт SDK в корень архива и вставляет <script>
 * первым в <head>: внешних запросов нет. Обычная сборка (`npm run build` → dist/) Bridge не содержит:
 * без window.bridge работает web-plain.
 */

/**
 * playgama-bridge-config.json рядом с index.html — обязательный шаг 1 Bridge: без него или с битым файлом
 * архив не проходит автоматическую проверку. Источник — vylazka/playgama-bridge-config.json (его можно
 * заменить файлом из редактора конфига Playgama); сборка падает, если это не JSON-объект.
 */
function bridgeConfigPlugin(): Plugin {
  const file = new URL('./playgama-bridge-config.json', import.meta.url);
  return {
    name: 'vz-playgama-config',
    generateBundle() {
      const source = readFileSync(file, 'utf8');
      const parsed: unknown = JSON.parse(source);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('playgama-bridge-config.json: нужен JSON-объект');
      this.emitFile({ type: 'asset', fileName: 'playgama-bridge-config.json', source });
    },
  };
}

/**
 * Порядок загрузки на Playgama (обязательный шаг 2 Bridge): сначала SDK и его инициализация, потом движок и
 * код игры. Vite ставит <script type="module"> игры в <head>, и браузер качал бы его вместе с SDK. Здесь этот
 * тег заменяется маленьким встроенным скриптом: он ждёт bridge.initialize() и только тогда подключает код
 * игры (createPlatform зовёт initialize ещё раз — Bridge отдаёт тот же результат). Не вышла инициализация —
 * игра всё равно грузится и работает как web-plain (platform/index.ts). Только для сборки: dev-сервер не трогаем.
 */
function bridgeFirstPlugin(): Plugin {
  return {
    name: 'vz-bridge-first',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const entry = /<script type="module" crossorigin src="([^"]+)"><\/script>\s*/;
        const m = entry.exec(html);
        if (!m) throw new Error('vz-bridge-first: в index.html нет <script type="module"> игры');
        const loader =
          `<script>(function(){var go=function(){var s=document.createElement('script');s.type='module';s.crossOrigin='';` +
          `s.src=${JSON.stringify(m[1])};document.head.appendChild(s)};var b=window.bridge;` +
          `if(b&&typeof b.initialize==='function')b.initialize().then(go,go);else go()})()</script>\n`;
        // Предзагрузка кода игры тоже до инициализации не нужна.
        return html.replace(entry, loader).replace(/<link rel="modulepreload"[^>]*>\s*/g, '');
      },
    },
  };
}

/** Версия сборки для аналитики: версия пакета и время сборки по UTC (src/core/build.ts). */
function buildVersion(): string {
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${version}+${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}.${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

/**
 * Какие звуковые файлы лежат в public/audio на момент сборки. Список вшивается в код: игра
 * запрашивает только существующие файлы и не сыплет ошибками 404, пока звук не сгенерирован.
 */
function audioFiles(): string[] {
  const dir = new URL('./public/audio/', import.meta.url);
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.mp3')).sort() : [];
}

export default defineConfig(({ mode }) => {
  const playgama = mode === 'playgama';
  return {
    define: { __VZ_AUDIO__: JSON.stringify(audioFiles()), __VZ_BUILD__: JSON.stringify(buildVersion()) },
    // Относительные пути: index.html в корне архива, игра работает из любой подпапки.
    base: './',
    plugins: playgama ? [playgamaBridge({ mode: 'local' }), bridgeConfigPlugin(), bridgeFirstPlugin()] : [],
    build: {
      outDir: playgama ? 'dist-playgama' : 'dist',
      emptyOutDir: true,
      target: 'es2020',
      sourcemap: false,
      chunkSizeWarningLimit: 1200,
    },
    server: { host: true, port: 5175 },
    preview: { host: true, port: 4175 },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
      reporters: ['default'],
      // Тесты, собирающие десятки уровней, идут по 4–5 с: на загруженной машине стандартных 5 с не хватает.
      testTimeout: 30000,
    },
  };
});
