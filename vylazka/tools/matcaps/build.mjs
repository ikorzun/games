// Картинки материалов: node tools/matcaps/build.mjs <out.html>
// Собирает tools/matcaps/main.ts (с манекеном из игры) в одну страницу. Снимок — e2e/out/matcaps_shot.mjs.
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] ?? join(HERE, '../../e2e/out/matcaps.html'));
const res = await build({ entryPoints: [join(HERE, 'main.ts')], bundle: true, format: 'iife', platform: 'browser', target: 'es2020', minify: true, write: false, logLevel: 'warning' });
const js = res.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Материалы манекена</title>
<style>
html,body{margin:0;background:#121212;font-family:"JetBrains Mono",ui-monospace,monospace;color:#e9e4d8}
#wrap{position:relative;display:inline-block}
#bg{position:absolute;inset:0;display:grid;grid-template-columns:repeat(4,400px);grid-template-rows:repeat(2,1fr)}
#bg div{background:radial-gradient(120% 90% at 50% 38%,#3a3936 0%,#232220 55%,#151514 100%);border:1px solid #0d0d0d;box-sizing:border-box}
#c{position:relative;display:block}
#labels{position:absolute;inset:0;pointer-events:none}
.label{position:absolute;padding:12px 14px;box-sizing:border-box;transform:translateY(calc(var(--ch) - 100%))}
.label b{display:block;font-size:17px;letter-spacing:.02em}
.label span{display:block;font-size:12px;opacity:.6;margin-top:3px}
</style></head><body><div id="wrap"><div id="bg">${'<div></div>'.repeat(8)}</div><canvas id="c"></canvas><div id="labels"></div></div>
<script>${js}</script></body></html>`;
writeFileSync(out, html);
console.log(`[matcaps] ${out}: ${Math.round(html.length / 1024)} КБ`);
