// Конструктор: node tools/constructor/build.mjs <out.html>
// Собирает tools/constructor/main.ts (уровень, реквизит, манекен и правила расстановки из игры) в одну страницу.
// Сохраняет вещи и фигуры в базу страницы (коллекции things и figures): основная модель забирает их в игру.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] ?? join(HERE, '../../e2e/out/constructor.html'));
const res = await build({
  entryPoints: [join(HERE, 'main.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  write: false,
  logLevel: 'warning',
  define: { __VZ_AUDIO__: '[]', __VZ_BUILD__: '"tool"' },
  loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.webp': 'dataurl' },
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const page = readFileSync(join(HERE, 'page.html'), 'utf8').replace('<!--SCRIPT-->', () => `<script>${js}</script>`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`[constructor] ${out}: ${Math.round(page.length / 1024)} КБ`);
