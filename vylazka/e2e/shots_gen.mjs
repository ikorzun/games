#!/usr/bin/env node
/**
 * Скриншоты сгенерированного бункера: по кадру на каждую примету уровня (дизель, ФВУ, баки, архив…)
 * и несколько видов коридоров. Смотреть глазами, как выглядят помещения.
 *   npm run build && node e2e/shots_gen.mjs [--seed 20041113] [--rank 3] [--q high] [--only diesel,fvu] [--dsf 1]
 * Файлы — в e2e/out/gen/.
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
const seed = opt('seed', '20041113');
const rank = opt('rank', '3');
const quality = opt('q', 'high');
const only = opt('only', null)?.split(',');
const dsf = Number(opt('dsf', '1')) || 1;
const OUT = join(ROOT, 'e2e', 'out', 'gen');
mkdirSync(OUT, { recursive: true });

const server = await preview({ configFile: false, root: ROOT, base: './', logLevel: 'error', build: { outDir: resolve(ROOT, opt('dist', 'dist')) }, preview: { host: '127.0.0.1', port: 4192, strictPort: false, open: false } });
const executablePath = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: dsf, locale: 'ru-RU' })).newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.log(`[error] ${m.text()}`);
});
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(new URL(`?q=${quality}&fail=0&lang=ru&seed=${seed}&rank=${rank}`, server.resolvedUrls.local[0]).toString());
await page.waitForFunction(() => window.__vz?.ready() === true, null, { timeout: 120000 });
const level = await page.evaluate(() => {
  window.__vz.freeze(true);
  window.__vz.start();
  return window.__vz.level();
});
console.log(`загрузка ${Date.now() - t0} мс; сид ${level.seed}, ранг ${level.rank}: помещений ${level.rooms.length}, чанков ${level.chunks}, треугольников ${level.triangles}, коллайдеров ${level.colliders}, мест для находок ${level.spots}, примет ${level.landmarks.length}`);

const shots = [['00_start', null]];
const seen = new Map();
for (const m of level.landmarks) {
  const n = seen.get(m.id) ?? 0;
  seen.set(m.id, n + 1);
  if (n < 1) shots.push([`t${m.tier + 1}_${m.id}`, m.id]);
}
// По коридору на ярус: стоим в первой коридорной клетке и смотрим в четыре стороны — берём самый дальний вид.
for (const r of level.rooms.filter((x) => x.type === 'corridor')) shots.push([`t${r.tier + 1}_corridor`, { room: r.id }]);

for (const [name, target] of shots) {
  if (only && !only.some((o) => name.includes(o))) continue;
  const st = await page.evaluate((tg) => {
    const vz = window.__vz;
    if (tg && typeof tg === 'object') {
      let best = 0;
      let bestD = -1;
      for (const yaw of [0, 90, 180, 270]) {
        vz.gotoRoom(tg.room, yaw);
        const d = vz.step(2).beamDist;
        if (d > bestD) {
          bestD = d;
          best = yaw;
        }
      }
      vz.gotoRoom(tg.room, best);
    } else if (tg) vz.gotoLandmark(tg, 0, 2.4);
    vz.step(75);
    return { ...vz.state(), info: vz.info() };
  }, target);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`${name}: ${st.info.calls} вызовов, ${st.info.triangles} тр, видно чанков ${st.info.visible}/${st.info.chunks}, луч ${st.beamDist.toFixed(1)} м`);
}
await browser.close();
await server.close();
