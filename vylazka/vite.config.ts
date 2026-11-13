import playgamaBridge from '@playgama/bridge/vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Сборка для Playgama: `npm run build:playgama` (= `vite build --mode playgama`) → dist-playgama/.
 * Плагин @playgama/bridge/vite в режиме `local` кладёт SDK в корень архива и вставляет <script>
 * в <head> раньше кода игры: window.bridge есть до старта, внешних запросов нет.
 * Минимальный playgama-bridge-config.json — чтобы SDK не писал ошибку о его отсутствии; настоящий
 * конфиг (реклама, платежи) собирается в редакторе Playgama и заменяет этот файл.
 * Обычная сборка (`npm run build` → dist/) Bridge не содержит: без window.bridge работает web-plain.
 */
function bridgeConfigPlugin(): Plugin {
  return {
    name: 'vz-playgama-config',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'playgama-bridge-config.json', source: '{}\n' });
    },
  };
}

export default defineConfig(({ mode }) => {
  const playgama = mode === 'playgama';
  return {
    // Относительные пути: index.html в корне архива, игра работает из любой подпапки.
    base: './',
    plugins: playgama ? [playgamaBridge({ mode: 'local' }), bridgeConfigPlugin()] : [],
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
    },
  };
});
