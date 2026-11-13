#!/usr/bin/env node
/**
 * Скриншоты витрины реквизита: по кадру на предмет из реестра PROPS (src/world/props_more.ts).
 *   npm run build && node e2e/shots_props.mjs [--props a,b,c] [--q med] [--dist dist]
 * Файлы — в e2e/out/props/<имя>.png. Смотреть глазами: пропорции, цвет, не висит ли предмет в воздухе.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const only = opt('props', null);
const quality = opt('q', 'med');
const OUT = join(ROOT, 'e2e', 'out', 'props');
mkdirSync(OUT, { recursive: true });
// Шаг витрины и стена — как в src/world/showcase.ts.
const STEP = 2.4;

const server = await preview({ configFile: false, root: ROOT, base: './', logLevel: 'error', build: { outDir: resolve(ROOT, opt('dist', 'dist')) }, preview: { host: '127.0.0.1', port: 4194, strictPort: false, open: false } });
const executablePath = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, locale: 'ru-RU' })).newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.log(`[error] ${m.text()}`);
});
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(new URL(`?level=show&q=${quality}&fail=0&lang=ru${only ? `&props=${only}` : ''}`, server.resolvedUrls.local[0]).toString());
await page.waitForFunction(() => window.__vz?.ready() === true, null, { timeout: 120000 });
const items = await page.evaluate(() => {
  window.__vz.freeze(true);
  window.__vz.start();
  window.__vz.calm?.(true);
  return window.__vz.showcase();
});
console.log(`предметов на витрине: ${items.length}`);
await page.addStyleTag({ content: '.vz-hud { display: none !important; }' });
for (let i = 0; i < items.length; i++) {
  const it = items[i];
  // Камера в двух с лишним метрах к югу и чуть сбоку от предмета. Луч — в середину его высоты:
  // на потолочное смотрим вверх, на высокое — прямо, на низкое — вниз.
  const mid = it.mount === 'ceiling' ? 2.7 - it.h / 2 : it.mount === 'wall' ? it.y + it.h / 2 : it.h / 2;
  const pitch = Math.atan2(mid - 1.42, 2.45);
  await page.evaluate(([x, p]) => {
    const v = window.__vz;
    v.teleport(x + 0.45, 0, 1.15, 0.17, p);
    v.step(40);
  }, [i * STEP, pitch]);
  await page.screenshot({ path: join(OUT, `${it.name}.png`) });
  console.log(`  ${it.name}`);
}
await browser.close();
await server.close();
