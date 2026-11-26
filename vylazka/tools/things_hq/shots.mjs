#!/usr/bin/env node
/**
 * Вещи памяти вплотную под лучом: кадр на вещь, «до» (болванка из блоков, ?hq=0) и «после» (подробная модель с картами).
 *   npm run build && node tools/things_hq/shots.mjs [--kinds a,b] [--hq 0|1|both] [--q high] [--out e2e/out/things_hq]
 * Вещь стоит на полу коридора технического среза (?level=test), повёрнутой на три четверти, в метре и дальше от героя (ближе
 * она растворяется от касания); луч — в её середину; в файл идёт середина кадра вдвое крупнее. Кадр печатает ещё и число вызовов отрисовки и треугольников (renderer.info) — для таблицы замеров.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const KINDS = ['alarm_clock', 'kettle', 'remote', 'st_coat', 'photo_frame', 'office_terminal', 'office_chair', 'st_ticket', 'water_cooler', 'desk_phone', 'wet_floor_sign', 'slippers', 'office_clock', 'st_note', 'st_key', 'st_cup'];
// Наибольший размер вещи, м (по описи реквизита) — от него расстояние до камеры.
const SIZE = { alarm_clock: 0.2, kettle: 0.34, remote: 0.22, st_coat: 0.55, photo_frame: 0.3, office_terminal: 0.5, office_chair: 1.02, st_ticket: 0.12, water_cooler: 1.35, desk_phone: 0.22, wet_floor_sign: 0.62, slippers: 0.34, office_clock: 0.34, st_note: 0.16, st_key: 0.14, st_cup: 0.2 };
const kinds = opt('kinds', KINDS.join(',')).split(',');
const which = opt('hq', 'both');
const quality = opt('q', 'high');
const OUT = resolve(ROOT, opt('out', 'e2e/out/things_hq'));
mkdirSync(OUT, { recursive: true });

const server = await preview({ configFile: false, root: ROOT, base: './', logLevel: 'error', build: { outDir: resolve(ROOT, opt('dist', 'dist')) }, preview: { host: '127.0.0.1', port: 4196, strictPort: false, open: false } });
const executablePath = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, locale: 'ru-RU' });

async function shot(kind, hq) {
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[error] ${m.text()}`);
  });
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await page.goto(new URL(`?level=test&q=${quality}&fail=0&lang=ru&hq=${hq}`, server.resolvedUrls.local[0]).toString());
  await page.waitForFunction(() => window.__vz?.ready() === true, null, { timeout: 120000 });
  await page.addStyleTag({ content: '.vz-hud { display: none !important; }' });
  const size = SIZE[kind] ?? 0.4;
  const dist = Number(opt('range', '0')) || Math.max(1.0, Math.min(2.4, size * 1.9));
  const before = await page.evaluate(() => {
    const v = window.__vz;
    v.freeze(true);
    v.start();
    v.calm?.(true);
    v.step(20);
    return v.info();
  });
  await page.evaluate(([k, d, h, FATE, LIFT, TURN]) => {
    const v = window.__vz;
    const st = v.state();
    const lift = LIFT < 0 ? Math.max(0, 1.36 - h / 2) : LIFT;
    v.teleport(st.pos[0], st.pos[1], st.pos[2], st.aim[0], 0);
    v.spawnThing(k, FATE, d, true, lift, TURN);
    // Луч — в середину вещи.
    v.teleport(st.pos[0], st.pos[1], st.pos[2], st.aim[0], Math.atan2(lift + h / 2 - 1.42, d));
    v.step(4);
  }, [kind, dist, kind === 'water_cooler' ? 1.35 : kind === 'office_chair' ? 1.02 : kind === 'office_terminal' ? 0.42 : ['remote', 'desk_phone', 'st_ticket', 'st_note', 'st_key', 'slippers', 'st_coat'].includes(kind) ? 0.03 : size, opt('fate', 'dust'), Number(opt('lift', '0')), Number(opt('turn', '28'))]);
  if (hq === 1) await page.waitForFunction((k) => window.__vz.hqReady(k), kind, { timeout: 15000 }).catch(() => console.log(`  ${kind}: подробной модели нет или не пришла`));
  await page.waitForTimeout(700);
  const info = await page.evaluate((STEPS) => {
    window.__vz.step(STEPS);
    return window.__vz.info();
  }, Number(opt('steps', '8')));
  const name = `${kind}_${hq === 1 ? 'hq' : 'old'}.png`;
  // Вырезка середины кадра вдвое крупнее: вещь на полу в полутора метрах от глаз занимает малую часть кадра.
  await page.screenshot({ path: join(OUT, name), clip: { x: 400, y: 225, width: 480, height: 270 } });
  console.log(`  ${name}: вызовов ${info.calls} (без вещи ${before.calls}), треугольников ${info.triangles} (без вещи ${before.triangles})`);
  await page.close();
}

for (const kind of kinds) {
  if (which !== '1') await shot(kind, 0);
  if (which !== '0') await shot(kind, 1);
}
await browser.close();
await server.close();
