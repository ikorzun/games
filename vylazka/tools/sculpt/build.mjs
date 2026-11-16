// Лепка: node tools/sculpt/build.mjs <out.html>
// Собирает tools/sculpt/main.ts (ядро лепки, маткапы игры, упрощение meshoptimizer) в одну страницу.
// Сохраняет вещи в базу страницы (коллекция sculpts) и в её файлы: основная модель забирает их оттуда в игру.
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] ?? join(HERE, '../../e2e/out/sculpt.html'));
const res = await build({ entryPoints: [join(HERE, 'main.ts')], bundle: true, format: 'iife', platform: 'browser', target: 'es2020', minify: true, write: false, logLevel: 'warning' });
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const page = readFileSync(join(HERE, 'page.html'), 'utf8').replace('<!--SCRIPT-->', () => `<script>${js}</script>`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`[sculpt] ${out}: ${Math.round(page.length / 1024)} КБ`);
