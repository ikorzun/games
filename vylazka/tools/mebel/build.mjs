// Сборка каталога мебели в один HTML-файл: node tools/mebel/build.mjs <out.html> [адрес игры]
// 1) считает, где стоит каждая вещь (usage.ts, строит уровни всех мест); 2) собирает страницу (main.ts)
// вместе с кодом вещей из игры; 3) вставляет всё в page.html.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const out = resolve(process.argv[2] ?? join(ROOT, 'e2e/out/mebel.html'));
const game = process.argv[3] ?? 'https://claude.ai/artifact/KESaPEH4QtDb6DYWX4LVbF';
const tmp = join(ROOT, 'e2e/out');
mkdirSync(tmp, { recursive: true });

await build({ entryPoints: [join(HERE, 'usage.ts')], bundle: true, platform: 'node', outfile: join(tmp, 'mebel_usage.cjs'), logLevel: 'warning' });
const usage = execFileSync('node', [join(tmp, 'mebel_usage.cjs')], { maxBuffer: 64 << 20 }).toString();

const res = await build({
  entryPoints: [join(HERE, 'main.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  write: false,
  logLevel: 'warning',
  define: { __USAGE__: usage, __GAME_URL__: JSON.stringify(game) },
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const page = readFileSync(join(HERE, 'page.html'), 'utf8').replace('<!--SCRIPT-->', () => `<script>${js}</script>`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`[mebel] ${out}: ${(page.length / 1024).toFixed(0)} КБ`);
