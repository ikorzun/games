// Сборка страницы «Дежурной части» в один файл: стили, шрифты и картинки (data:) и скрипты вшиваются в HTML.
//   node build.mjs                 → dist/index.html (самодостаточная страница, открывается с диска)
//   node build.mjs --fragment FILE → FILE без <html>/<head>/<body> (для публикации страницей-артефактом)
//   node build.mjs --page constructor.html [--fragment FILE] → то же для другой страницы (по умолчанию index.html)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');

const pageAt = process.argv.indexOf('--page');
const page = pageAt >= 0 ? process.argv[pageAt + 1] : 'index.html';
const index = read(page);
const title = (index.match(/<title>([^<]*)<\/title>/) || [])[1] || 'Дежурная часть';
const scripts = [...index.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
if (!scripts.length) throw new Error(`в ${page} не найдено ни одного <script src>`);
const styles = [...index.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
const mount = ((index.match(/<body>\s*([\s\S]*?)\s*<script/) || [])[1] || '').trim();
if (!mount) throw new Error(`в ${page} не найдена разметка перед скриптами`);

const css = styles.map(read).join('\n').replace(/url\((fonts\/[^)]+\.woff2)\)/g, (_, p) =>
  `url(data:font/woff2;base64,${readFileSync(join(here, p)).toString('base64')})`);
const js = scripts.map((p) => read(p).replace(/<\/script/gi, '<\\/script')).join('\n')
  .replace(/'(img\/[a-z0-9_\/.]+\.(webp|png|jpg))'/g, (_, p, ext) =>
    `'data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${readFileSync(join(here, p)).toString('base64')}'`);

const body = `<style>\n${css}</style>\n${mount}\n<script>\n${js}</script>\n`;

const at = process.argv.indexOf('--fragment');
if (at >= 0) {
  const out = resolve(process.argv[at + 1] || 'dezhurka.fragment.html');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `<title>${title}</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${body}`);
  console.log('fragment →', out);
} else {
  const out = join(here, 'dist', page);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>${title}</title>\n<style>:root{box-sizing:border-box;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}</style>\n</head>\n<body>\n${body}</body>\n</html>\n`);
  console.log('page →', out);
}
