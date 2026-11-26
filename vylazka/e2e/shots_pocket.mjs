#!/usr/bin/env node
/**
 * Скриншоты карманного пространства: четыре вида от точки появления (вперёд, вправо, назад, влево).
 *   npm run build && node e2e/shots_pocket.mjs --kind meadow [--q med] [--walk 6]
 * Файлы — в e2e/out/pocket/<kind>_<n>.png. --walk N — перед съёмкой пройти N метров вперёд.
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
const kind = opt('kind', 'void');
const quality = opt('q', 'med');
const walk = Number(opt('walk', '0'));
const OUT = join(ROOT, 'e2e', 'out', 'pocket');
mkdirSync(OUT, { recursive: true });

const server = await preview({ configFile: false, root: ROOT, base: './', logLevel: 'error', build: { outDir: resolve(ROOT, opt('dist', 'dist')) }, preview: { host: '127.0.0.1', port: 4196, strictPort: false, open: false } });
const executablePath = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, locale: 'en-US' })).newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.log(`[error] ${m.text()}`);
});
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(new URL(`?level=pocket_${kind}&q=${quality}&fail=0&lang=en`, server.resolvedUrls.local[0]).toString());
await page.waitForFunction(() => window.__vz?.ready() === true, null, { timeout: 120000 });
const st = await page.evaluate((steps) => {
  window.__vz.freeze(true);
  window.__vz.start();
  if (steps > 0) window.__vz.step(steps, { moveZ: 1 });
  return window.__vz.step(30);
}, Math.round((walk / 2.3) * 60));
const [x, y, z] = st.pos;
const yaw0 = st.aim[0];
for (let i = 0; i < 4; i++) {
  await page.evaluate(([px, py, pz, yaw]) => {
    window.__vz.teleport(px, py, pz, yaw, 0);
    window.__vz.step(40);
  }, [x, y, z, yaw0 - (i * Math.PI) / 2]);
  await page.screenshot({ path: join(OUT, `${kind}_${i}.png`) });
}
console.log(`${kind}: 4 кадра в ${OUT}, позиция ${st.pos.map((v) => v.toFixed(1)).join(', ')}`);
await browser.close();
await server.close();
