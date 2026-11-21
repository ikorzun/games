// Геймплейное видео (партнёр 21.11, 19:24: «Видео запиши только после всех изменений и с лучшими моментами, давящей атмосферой
// страха и потерянности»). Кадры игры подряд, пошагово: кадр — два шага симуляции (30 к/с), снимок — после шагов. Не входит в CI.
//   npm run build && node tools/video/record.mjs record [сцены через запятую]   (scout — только последний кадр каждого куска)
// Кадры — в e2e/out/gameplay/<сцена>/, метки кусков — в e2e/out/gameplay/marks*.json. Дальше — tools/video/README.md.
import { join, resolve } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const ROOT = process.cwd();
const mode = process.argv[2] ?? 'scout';
const only = process.argv[3] ? new Set(process.argv[3].split(',')) : null;
const OUT = join(ROOT, 'e2e', 'out', mode === 'record' ? 'gameplay' : 'gameplay_scout');
if (!only) rmSync(OUT, { recursive: true, force: true });
for (const s of only ?? []) rmSync(join(OUT, s), { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const W = 1280;
const H = 720;
// Сборка, с которой пишем (DIST=dist-rec — отдельная, чтобы не пересобирать dist под идущей записью).
const server = await preview({ configFile: false, root: ROOT, base: './', logLevel: 'error', build: { outDir: resolve(ROOT, process.env.DIST ?? 'dist') }, preview: { host: '127.0.0.1', port: 4276, strictPort: false, open: false } });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Метки — свой файл на каждый набор сцен: наборы пишутся параллельно и не затирают друг друга.
const marksPath = join(OUT, only ? `marks_${[...only].join('_')}.json` : 'marks.json');
const marks = {};

async function open(scene, params, { calm = true } = {}) {
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, locale: 'en-US' })).newPage();
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await page.goto(new URL(`?q=med&touch=0&lang=en&${params}`, server.resolvedUrls.local[0]).toString());
  await page.waitForFunction(() => window.__vz?.ready() === true, null, { timeout: 180000 });
  const vz = (fn, arg) => page.evaluate(fn, arg);
  await vz((c) => { window.__vz.start(); window.__vz.freeze(true); window.__vz.calm(c); }, calm);
  // От интерфейса — только рамка камеры: REC, номер, время; и карточка обрывка, когда она есть.
  await page.addStyleTag({ content: '.vz-hud__goals,.vz-hud__toast,.vz-hud__hint,.vz-hud__fps,.vz-hud__prompt,.vz-hud__mark,.vz-hud__bat,.vz-hud__act,.vz-hud__flash,.vz-hud__limbo,.vz-hud__lap,.vz-hud__place{display:none!important}' });
  const dir = join(OUT, scene);
  mkdirSync(dir, { recursive: true });
  let n = 0;
  const frames = async (count, input, steps = 2) => {
    for (let i = 0; i < count; i++) {
      await vz(([inp, s]) => window.__vz.step(s, inp ?? undefined), [input ?? null, steps]);
      if (mode === 'record' || i === count - 1) await page.screenshot({ path: join(dir, `${String(n).padStart(4, '0')}.png`), timeout: 120000 });
      if (mode === 'record' || i === count - 1) n++;
    }
  };
  const mark = (name) => { marks[`${scene}.${name}`] = n; };
  const state = () => vz(() => window.__vz.state());
  const light = async (on) => { const s = await state(); if ((s.light.state === 'on') !== on) await vz(() => window.__vz.toggleLight()); };
  // look() в игре — как мышь: прибавляет поворот к текущему. Навести взгляд на угол — приращением от нынешнего.
  const aimAt = async (yaw, pitch) => {
    const s = await state();
    let dy = yaw - s.aim[0];
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    await vz(([a, b]) => window.__vz.look(a, b), [dy, pitch - s.aim[1]]);
  };
  // Повернуть взгляд к точке за k кадров (плавно), двигаясь input.
  const turnTo = async (p, k, input, pitch = -0.04) => {
    const s = await state();
    const a0 = s.aim[0];
    let a1 = Math.atan2(-(p[0] - s.pos[0]), -(p[2] - s.pos[2]));
    while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
    while (a1 - a0 < -Math.PI) a1 += 2 * Math.PI;
    const p0 = s.aim[1];
    for (let i = 1; i <= k; i++) {
      const t = i / k;
      const e = t * t * (3 - 2 * t);
      await aimAt(a0 + (a1 - a0) * e, p0 + (pitch - p0) * e);
      await frames(1, input);
    }
  };
  return { page, vz, frames, mark, state, light, turnTo, aimAt, count: () => n };
}

const want = (s) => !only || only.has(s);

// 1. Тьма и свет: убежище, фонарь зажигается — место собирается из точек; идём; в конце луча — она.
if (want('s1')) {
  const { page, vz, frames, mark, light, state, turnTo } = await open('s1', 'fail=0&seed=20041113&rank=2&world=shelter');
  await light(false);
  await vz(() => window.__vz.step(20));
  mark('dark');
  await frames(45);
  await light(true);
  mark('on');
  await frames(75);
  mark('walk');
  await frames(120, { moveZ: 0.42 });
  // Явление — впереди, в луче, как первое явление сна; места впереди нет — рядом.
  const ok = (await vz(() => window.__vz.swarm('glimpse'))) || (await vz(() => window.__vz.swarm('appear', 4)));
  const sw = (await state()).swarm;
  console.log('s1 appear', ok, JSON.stringify(sw?.pos));
  mark('appear');
  await frames(78, { moveZ: 0.12 });
  await vz(() => window.__vz.calm(false));
  mark('scatter');
  await frames(48);
  await vz(() => window.__vz.calm(true));
  mark('end');
  await page.close();
}

// 3. Белая комната: идём к цепи; задел — камеру перекручивает, мир широкоугольный.
if (want('s3')) {
  const { page, vz, frames, mark, state, turnTo } = await open('s3', 'fail=0&seed=2002&rank=2&world=shelter');
  const w = await vz(() => window.__vz.white());
  const c = w.chain.at;
  const d = w.door;
  const dx = c[0] - d[0];
  const dz = c[2] - d[1];
  const l = Math.hypot(dx, dz);
  const sx = d[0] - (dx / l) * 2.6;
  const sz = d[1] - (dz / l) * 2.6;
  await vz(([x, y, z, yaw]) => window.__vz.teleport(x, y, z, yaw, 0), [sx, w.y[0], sz, Math.atan2(-dx, -dz)]);
  await vz(() => window.__vz.step(40));
  mark('approach');
  let warped = false;
  for (let i = 0; i < 200 && !warped; i++) {
    await frames(1, { moveZ: 0.5 });
    const ww = await vz(() => window.__vz.white());
    warped = ww.warp.open > 0.05 || Math.abs(ww.warp.roll) > 0.01;
  }
  mark('warp');
  await frames(150);
  mark('end');
  await page.close();
}

// 4b. Песчаный зал монтажом (просмотр кармана, проём — в (0, 0, 0), зал уходит в −z; точки — те же, что у кадров для обложек):
// шаг из проёма, рёбра вдали, под сводом рёбер, медленный наезд на череп.
if (want('s4b')) {
  const { page, vz, frames, mark, aimAt } = await open('s4b', 'level=pocket_dunes&fail=0&seed=7');
  const deg = Math.PI / 180;
  const at = async (x, z, yaw, pitch) => {
    await vz(([px, pz, yw, pt]) => window.__vz.teleport(px, 7, pz, yw, pt), [x, z, yaw * deg, pitch * deg]);
    await vz(() => window.__vz.step(100));
    const s = await vz(() => window.__vz.state());
    if (s.light?.state !== 'on') await vz(() => window.__vz.toggleLight());
    await vz(() => window.__vz.step(40));
  };
  const pan = async (n, y0, y1, p0, p1, input) => {
    for (let i = 0; i < n; i++) {
      const t = i / Math.max(1, n - 1);
      const e = t * t * (3 - 2 * t);
      await aimAt((y0 + (y1 - y0) * e) * deg, (p0 + (p1 - p0) * e) * deg);
      await frames(1, input);
    }
  };
  await at(0, -0.8, 0, -2);
  mark('door');
  await pan(75, 0, 4, -2, 0, { moveZ: 0.35 });
  await at(2.5, -12, 6, 4);
  mark('ribs');
  await pan(90, 6, 14, 4, 7, { moveZ: 0.3 });
  await at(0.2, -25.5, 35, 14);
  mark('under');
  await pan(90, 35, 62, 14, 22, null);
  await at(-10.1, -34.7, 11.5, -8);
  mark('skull');
  await pan(105, 11.5, 13, -8, -5, { moveZ: 0.22 });
  mark('end');
  await page.close();
}

// 5. Охота в темноте: свет погас, и к тебе идут белые точки.
if (want('s5')) {
  const { page, vz, frames, mark, state, light, aimAt } = await open('s5', 'fail=0&seed=20041113&rank=2&world=shelter', { calm: false });
  await vz(() => window.__vz.step(60));
  await vz(() => window.__vz.swarm('release', 3));
  const sw = (await state()).swarm;
  if (sw?.pos) {
    const s = await state();
    await aimAt(Math.atan2(-(sw.pos[0] - s.pos[0]), -(sw.pos[2] - s.pos[2])), 0);
  }
  mark('hunt');
  await frames(40);
  await light(false);
  mark('dark');
  let caught = false;
  for (let i = 0; i < 360 && !caught; i++) {
    const st = await state();
    if (st.swarm?.pos) {
      const want = Math.atan2(-(st.swarm.pos[0] - st.pos[0]), -(st.swarm.pos[2] - st.pos[2]));
      let dy = want - st.aim[0];
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      dy = Math.max(-0.05, Math.min(0.05, dy));
      await vz(([a, b]) => window.__vz.look(a, b), [dy, -st.aim[1] * 0.1]);
    }
    await frames(1);
    caught = st.jump !== null && st.jump !== undefined;
  }
  mark('caught');
  await frames(70);
  mark('end');
  await page.close();
}

// 6. Лимбо и обрывок: место рассыпалось; экспонат вспоминает — «ты не спишь?».
if (want('s6')) {
  const { page, vz, frames, mark, state } = await open('s6', 'fail=0&seed=20041113&rank=2&world=shelter');
  await vz(() => window.__vz.step(30));
  await vz(() => window.__vz.finish());
  mark('finish');
  let limbo = false;
  for (let i = 0; i < 300 && !limbo; i++) {
    await frames(1);
    limbo = (await state()).where === 'limbo';
  }
  await frames(60);
  mark('meta');
  await vz(() => window.__vz.meta('m14'));
  await sleep(650);
  await frames(150);
  mark('end');
  await page.close();
}

writeFileSync(marksPath, JSON.stringify(marks, null, 1));
console.log(JSON.stringify(marks));
await browser.close();
server.close();
