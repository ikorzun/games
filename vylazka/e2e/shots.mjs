#!/usr/bin/env node
/**
 * Скриншоты фиксированных ракурсов собранной игры — чтобы смотреть картинку глазами на каждом этапе.
 *   npm run build && node e2e/shots.mjs [--dist dist] [--q high] [--size 1280x720] [--only name,name]
 * Кадры детерминированы: симуляция заморожена и шагается вручную через window.__vz.
 * Файлы — в e2e/out/shots/. Браузер: CHROMIUM_PATH или /opt/pw-browsers/chromium.
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
const distDir = resolve(ROOT, opt('dist', 'dist'));
const quality = opt('q', 'high');
const [W, H] = opt('size', '1280x720').split('x').map(Number);
const only = opt('only', null)?.split(',');
const extraQuery = opt('query', '');
const OUT = join(ROOT, 'e2e', 'out', 'shots');
mkdirSync(OUT, { recursive: true });

const R = Math.PI / 180;
/** name, позиция, yaw, pitch (градусы), действие перед кадром. */
const POSES = [
  ['01_corridor', [0, 0, 3], 0, -2],
  ['02_corridor_far', [0.4, 0, -1.5], 6, 0],
  ['03_door', [-0.6, 0, -4.2], -62, -3],
  ['04_room_bunks', [3.2, 0, -6.6], -80, -4],
  ['05_room_lockers', [3.6, 0, -7.6], 25, 2],
  ['06_pipes_valve', [0.2, 0, -2.2], 70, 14],
  ['07_turn', [0, 0, -13.2], 55, -3],
  ['08_stairs', [-5.2, 0, -15], 90, -18],
  ['09_lower', [-11.2, -1.44, -15], 90, -4],
  ['10_floor', [0, 0, -9], 10, -55],
  ['11_dark', [0, 0, 3], 0, -2, 'off'],
  ['13_shadow', [0.5, 0, -8.2], 40, -12],
  ['14_stairs_up', [-12.5, -1.44, -15], -90, 12],
  ['12_dead', [0, 0, -1], 0, -2, 'dead'],
];

const server = await preview({ configFile: false, root: ROOT, base: './', logLevel: 'error', build: { outDir: distDir }, preview: { host: '127.0.0.1', port: 4190, strictPort: false, open: false } });
const url = server.resolvedUrls?.local?.[0];
const executablePath = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, locale: 'ru-RU' })).newPage();
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(new URL(`?q=${quality}&fail=0&lang=ru${extraQuery ? '&' + extraQuery : ''}`, url).toString());
await page.waitForFunction(() => window.__vz?.ready() === true, null, { timeout: 60000 });
await page.evaluate(() => {
  window.__vz.freeze(true);
  window.__vz.start();
});
for (const [name, pos, yaw, pitch, action] of POSES) {
  if (only && !only.some((o) => name.includes(o))) continue;
  const t0 = Date.now();
  const st = await page.evaluate(
    ([p, y, pt, act]) => {
      const vz = window.__vz;
      if (vz.state().light.state !== 'on') {
        if (vz.state().light.state === 'off') vz.toggleLight();
        else vz.shake(1, 2.5);
      }
      vz.teleport(p[0], p[1], p[2], y, pt);
      vz.step(75);
      if (act === 'off') {
        vz.toggleLight();
        vz.step(150);
      } else if (act === 'dead') {
        vz.fail();
        vz.step(20);
      }
      return { ...vz.state(), info: vz.info() };
    },
    [pos, yaw * R, pitch * R, action ?? null],
  );
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`${name}: ${Date.now() - t0} мс, gain ${st.gain.toFixed(2)}, луч ${st.beamDist.toFixed(1)} м, ${st.info.calls} dc, ${st.info.triangles} тр, ${st.info.width}×${st.info.height}`);
}
await browser.close();
await server.close();
