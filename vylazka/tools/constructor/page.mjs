// Сборка страницы конструктора в одну строку HTML: её пишет на диск build.mjs (страница для Claude) и отдаёт serve.mjs
// (конструктор на компьютере партнёра, квиз 18.11: «Программа на MacBook»).
// 1) считает, где стоит каждая вещь (usage.ts — строит уровни всех мест; это карточка вещи, бывший «Опросник мебели»);
// 2) собирает main.ts (уровень, реквизит, манекен и правила расстановки из игры) в одну страницу.
// local — страница для своего компьютера: записи — в файлы репозитория через serve.mjs, есть поиск по каталогу Sand3D.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../..');

export async function buildPage({ local = false, game = 'https://claude.ai/artifact/KESaPEH4QtDb6DYWX4LVbF' } = {}) {
  const tmp = join(ROOT, 'e2e/out');
  mkdirSync(tmp, { recursive: true });
  const define = { __VZ_AUDIO__: '[]', __VZ_BUILD__: '"tool"' };
  await build({ entryPoints: [join(HERE, 'usage.ts')], bundle: true, platform: 'node', outfile: join(tmp, 'constructor_usage.cjs'), logLevel: 'warning', define });
  const usage = execFileSync('node', [join(tmp, 'constructor_usage.cjs')], { maxBuffer: 64 << 20 }).toString();
  const res = await build({
    entryPoints: [join(HERE, 'main.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    write: false,
    logLevel: 'warning',
    define: { ...define, __USAGE__: usage, __GAME_URL__: JSON.stringify(game), __LOCAL__: local ? 'true' : 'false' },
    loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.webp': 'dataurl' },
  });
  const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  return readFileSync(join(HERE, 'page.html'), 'utf8').replace('<!--SCRIPT-->', () => `<script>${js}</script>`);
}
