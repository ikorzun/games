#!/usr/bin/env node
/**
 * Замер: сколько стоит подробная вещь памяти. Перед героем веером ставится N будильников (подробных или болванок),
 * 10 секунд игра идёт сама; печатается среднее время кадра, вызовы отрисовки и треугольники (renderer.info).
 *   npm run build && node tools/things_hq/perf.mjs [--q high|med|low] [--counts 0,1,5,20,40]
 * В контейнере Chromium рисует на процессоре (SwiftShader): абсолютные миллисекунды к телефону и ноутбуку не относятся,
 * смысл имеет только прирост от строки к строке. Настоящий замер — на устройстве: ?level=test&hq=1 и #diag.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const quality = opt('q', 'low');
const counts = opt('counts', '0,1,5,20,40').split(',').map(Number);
const kind = opt('kind', 'alarm_clock');
const server = await preview({ configFile: false, root: ROOT, base: './', logLevel: 'error', build: { outDir: resolve(ROOT, 'dist') }, preview: { host: '127.0.0.1', port: 4197, strictPort: false, open: false } });
const executablePath = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, locale: 'ru-RU' });
console.log(`| вещей | вид | вызовов | треугольников | кадр, мс (SwiftShader, ${quality}) |`);
console.log('|---|---|---|---|---|');
for (const hq of [0, 1]) {
  for (const n of counts) {
    if (n === 0 && hq === 1) continue;
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
    await page.goto(new URL(`?level=test&q=${quality}&fail=0&lang=ru&hq=${hq}`, server.resolvedUrls.local[0]).toString());
    await page.waitForFunction(() => window.__vz?.ready() === true, null, { timeout: 120000 });
    await page.evaluate(([k, count]) => {
      const v = window.__vz;
      v.start();
      v.calm?.(true);
      const st = v.state();
      // Веером: от 1,6 до 4 м, поперёк коридора — все в кадре и под лучом.
      for (let i = 0; i < count; i++) {
        v.teleport(st.pos[0] + ((i % 5) - 2) * 0.28, st.pos[1], st.pos[2], st.aim[0], -0.45);
        v.spawnThing(k, 'jump', 1.6 + Math.floor(i / 5) * 0.3, true, 0, 0);
      }
      v.teleport(st.pos[0], st.pos[1], st.pos[2], st.aim[0], -0.45);
    }, [kind, n]);
    if (hq === 1) await page.waitForFunction((k) => window.__vz.hqReady(k), kind, { timeout: 15000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(
      (WINDOW) =>
        new Promise((done) => {
          const t = [];
          let last = performance.now();
          const end = last + WINDOW;
          const tick = (now) => {
            t.push(now - last);
            last = now;
            if (now < end) requestAnimationFrame(tick);
            else {
              t.sort((a, b) => a - b);
              done({ avg: t.reduce((a, b) => a + b, 0) / t.length, med: t[t.length >> 1], info: window.__vz.info() });
            }
          };
          requestAnimationFrame(tick);
        }),
      Number(opt('window', '10000')),
    );
    console.log(`| ${n} | ${hq ? 'подробные' : 'болванки'} | ${r.info.calls} | ${r.info.triangles} | ${r.med.toFixed(1)} (средн. ${r.avg.toFixed(1)}) |`);
    await page.close();
  }
}
await browser.close();
await server.close();
