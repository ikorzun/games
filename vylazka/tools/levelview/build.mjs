// Вид уровня сверху в разрезе: node tools/levelview/build.mjs <out.html>
// Тот же код, что в игре (generateLayout → buildLevel); снимок — e2e/out/levelview_shot.mjs.
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] ?? join(HERE, '../../e2e/out/levelview.html'));
const res = await build({ entryPoints: [join(HERE, 'main.ts')], bundle: true, format: 'iife', platform: 'browser', target: 'es2020', minify: true, write: false, logLevel: 'warning', loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.webp': 'dataurl' } });
const js = res.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Уровень сверху</title>
<style>
html,body{margin:0;background:#16171a;font-family:"JetBrains Mono",ui-monospace,monospace;color:#ece6d8}
#wrap{position:relative;display:inline-block}
#labels{position:absolute;inset:0;pointer-events:none}
.room{position:absolute;transform:translate(-50%,-50%);font-size:13px;padding:2px 6px;background:rgba(10,10,12,.72);border-radius:3px;white-space:nowrap}
.start{position:absolute;transform:translate(-50%,-50%);font-size:14px;font-weight:700;color:#ff6a4d;background:rgba(10,10,12,.8);padding:2px 6px;border-radius:3px}
#meta{position:absolute;left:14px;top:12px;font-size:14px;opacity:.85;background:rgba(10,10,12,.7);padding:4px 8px;border-radius:3px}
</style></head><body><div id="wrap"><canvas id="c"></canvas><div id="labels"></div><div id="meta"></div></div>
<script>${js}</script></body></html>`;
writeFileSync(out, html);
console.log(`[levelview] ${out}: ${Math.round(html.length / 1024)} КБ`);
