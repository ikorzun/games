#!/usr/bin/env node
/**
 * Собрать готовую сборку (dist/) в одну страницу: стили, шрифты, код и картинки плакатов вшиты.
 * Такую страницу можно открыть с диска или опубликовать одним файлом по ссылке (так сборку смотрят
 * с телефона до публикации на площадке). У страницы нет <html>/<head>/<body> — их добавляет тот, кто
 * её показывает; если нужен самостоятельный файл, оберните результат сами.
 *
 *   node scripts/single_page.mjs [dist] [куда.html]      (по умолчанию: dist → dist-single/untitled_session.html)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [dist = 'dist', out = 'dist-single/untitled_session.html'] = process.argv.slice(2);
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const jsTag = html.match(/<script type="module"[^>]*src="\.\/([^"]+)"><\/script>/);
const cssTag = html.match(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)">/);
if (!jsTag || !cssTag) throw new Error(`в ${dist}/index.html не найден скрипт или стили`);

const MIME = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', woff2: 'font/woff2' };
const dataUri = (file) => `data:${MIME[file.slice(file.lastIndexOf('.') + 1)]};base64,${readFileSync(file).toString('base64')}`;

const cssPath = join(dist, cssTag[1]);
const css = readFileSync(cssPath, 'utf8').replace(/url\((\.\/[^)]+\.woff2)\)/g, (_, rel) => `url(${dataUri(join(dirname(cssPath), rel))})`);

const jsPath = join(dist, jsTag[1]);
let inlined = 0;
const js = readFileSync(jsPath, 'utf8')
  // Картинки, которые сборка кладёт отдельными файлами рядом с кодом (листы плакатов).
  .replace(/new URL\("([^"]+\.(?:webp|png|jpg))",\s*import\.meta\.url\)\.href/g, (_, rel) => {
    inlined += 1;
    return JSON.stringify(dataUri(join(dirname(jsPath), rel)));
  })
  .replace(/<\/script/gi, '<\\/script');
// Вшитый код не знает, откуда он загружен: любая оставшаяся ссылка «рядом с кодом» не откроется.
if (js.includes('import.meta.url')) throw new Error('в коде остались ссылки на файлы рядом со сборкой (import.meta.url): страница одним файлом их не найдёт');

const page = `<title>Untitled Session</title>
<meta name="theme-color" content="#000000">
<style>
:root { color-scheme: dark; }
${css}
</style>
<div id="app" class="vz-root" role="application"></div>
<noscript>JavaScript is required to play.</noscript>
<script type="module">${js}</script>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`[single_page] ${out}: ${(page.length / 1024).toFixed(0)} КБ, картинок вшито: ${inlined}`);
