// Конструктор: node tools/constructor/build.mjs <out.html> [адрес игры]
// 1) считает, где стоит каждая вещь (usage.ts — строит уровни всех мест; это карточка вещи, бывший «Опросник мебели»);
// 2) собирает tools/constructor/main.ts (уровень, реквизит, манекен и правила расстановки из игры) в одну страницу.
// Сохраняет в базу страницы: вещи и передвинутые вещи игры — things, фигуры — figures, убранные вещи игры — removed,
// отметки к вещам — verdicts. Основная модель забирает их в игру.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const out = resolve(process.argv[2] ?? join(ROOT, 'e2e/out/constructor.html'));
const game = process.argv[3] ?? 'https://claude.ai/artifact/KESaPEH4QtDb6DYWX4LVbF';
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
  define: { ...define, __USAGE__: usage, __GAME_URL__: JSON.stringify(game) },
  loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.webp': 'dataurl' },
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const page = readFileSync(join(HERE, 'page.html'), 'utf8').replace('<!--SCRIPT-->', () => `<script>${js}</script>`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`[constructor] ${out}: ${Math.round(page.length / 1024)} КБ`);
