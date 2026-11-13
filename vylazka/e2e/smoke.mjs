#!/usr/bin/env node
/**
 * Смоук-тест собранной игры в настоящем браузере (Chromium, программный WebGL).
 *
 *   npm run build && npm run smoke                                   # dist/
 *   npm run build:playgama && npm run smoke -- --dist dist-playgama  # с настоящим Bridge SDK
 *   npm run smoke:matrix                                             # + раскладка по матрице размеров, скриншоты в e2e/out/
 *   npm run smoke -- --url https://…                                 # опубликованная ссылка
 *
 * Параметры: --dist <dir> | --url <url>, --matrix, --langs ru,en, --no-shots, --shell, --only play,gen,sortie,fear,audio,frame,touch,bridge,matrix.
 * Симуляция в тестах заморожена и шагается через window.__vz: проверяется логика и вёрстка, а не
 * частота кадров (SwiftShader даёт 5–10 к/с). Качество задаётся параметром адреса, иначе по строке
 * видеокарты выбралось бы «низкое» и тень осталась бы непроверенной.
 * Браузер: CHROMIUM_PATH (или /opt/pw-browsers/chromium, или `npx playwright-core install chromium`).
 * Браузеров два, и ведут они себя по-разному. Без пути Playwright берёт chromium-headless-shell — так
 * идёт CI; /opt/pw-browsers/chromium — полный Chromium, он ближе к браузеру игрока. Разница, на которой
 * мы уже обжигались: под захватом мыши headless-shell держит курсор в точке (0, 0) и каждое движение
 * присылает парой «+координата, −координата», а нажатие кнопки — одиночным «−координата». Взгляд в нём
 * после работы мышью случаен, поэтому проверки картинки выставляют его заново. Перед отправкой
 * прогоняйте оба: `npm run smoke` и `npm run smoke -- --shell` (тот же браузер, что на CI).
 * Выход: 0 — всё прошло, 1 — есть провалы, 2 — не запустился браузер.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'e2e', 'out');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const distDir = resolve(ROOT, opt('dist', 'dist'));
const remoteUrl = opt('url', null);
const wantMatrix = flag('matrix');
const wantShots = !flag('no-shots');
const only = opt('only', null)?.split(',').map((x) => x.trim());
const wants = (name) => !only || only.includes(name);
const matrixLangs = opt('langs', 'ru,en').split(',').map((s) => s.trim()).filter(Boolean);

let passed = 0;
const failures = [];
function check(name, ok, details = '') {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    // Подробности — и в итоговую сводку: по хвосту лога CI должно быть видно не только что упало, но и как.
    failures.push(`${name}${details ? ` — ${details}` : ''}`);
    console.log(`  FAIL ${name}${details ? ` — ${details}` : ''}`);
  }
}
const section = (title) => console.log(`\n# ${title}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = Math.PI / 180;

async function startServer() {
  if (remoteUrl) return { url: remoteUrl, close: async () => undefined };
  // cors: в песочнице iframe без allow-same-origin у страницы «пустой» источник, и модули со стилями
  // браузер отдаёт ей только с заголовком Access-Control-Allow-Origin (GitHub Pages и CDN его шлют).
  const server = await preview({ configFile: false, root: ROOT, base: './', logLevel: 'error', build: { outDir: distDir }, preview: { host: '127.0.0.1', port: 4185, strictPort: false, open: false, cors: true } });
  const url = server.resolvedUrls?.local?.[0];
  if (!url) throw new Error('vite preview не вернул адрес');
  return { url, close: () => server.close() };
}

/** Предустановленный chromium-headless-shell (браузер CI), если он есть на этой машине. */
function localShell() {
  const root = '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse()) {
    for (const sub of readdirSync(join(root, dir))) {
      const exe = join(root, dir, sub, 'chrome-headless-shell');
      if (existsSync(exe)) return exe;
    }
  }
  return undefined;
}

async function launchBrowser() {
  // --shell: как на CI. Если своего headless-shell нет, путь не задаётся и Playwright берёт его сам.
  const executablePath = process.env.CHROMIUM_PATH || (flag('shell') ? localShell() : existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const extra = (process.env.CHROMIUM_ARGS ?? '').split(/\s+/).filter(Boolean);
  try {
    return await chromium.launch({ executablePath, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio', ...extra] });
  } catch (e) {
    console.error(`Не удалось запустить Chromium: ${e.message}\nУкажите CHROMIUM_PATH или выполните: npx playwright-core install chromium`);
    process.exit(2);
  }
}

/** Страница с журналом ошибок, неудачных и внешних запросов. */
async function openPage(browser, baseUrl, query, ctxOpts = {}, onConsole = null, prepare = null) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US', ...ctxOpts });
  if (prepare) await prepare(context);
  const page = await context.newPage();
  const origin = new URL(baseUrl).origin;
  const log = { errors: [], warnings: [], external: [], failed: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') log.errors.push(m.text());
    else if (m.type() === 'warning') log.warnings.push(m.text());
  });
  page.on('pageerror', (e) => log.errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => log.failed.push(`${r.url()} ${r.failure()?.errorText ?? ''}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) log.failed.push(`HTTP ${r.status()} ${r.url()}`);
  });
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:')) return;
    if (new URL(u).origin !== origin) log.external.push(u);
  });
  if (onConsole) page.on('console', onConsole);
  await page.goto(new URL(query, baseUrl).toString(), { waitUntil: 'load' });
  await page.waitForFunction(() => window.__vz?.ready() === true, null, { timeout: 90000 });
  return { page, context, log };
}

const vz = (page, fn, arg) => page.evaluate(fn, arg);
const state = (page) => page.evaluate(() => window.__vz.state());
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
/** Средняя яркость центральной части сетки 32×18. */
const center = (grid) => {
  const out = [];
  for (let r = 6; r < 12; r++) for (let c = 12; c < 20; c++) out.push(grid[r * 32 + c]);
  return mean(out);
};
/** WebGL-предупреждения, не относящиеся к игре (программный рендер в тестовом браузере). */
const benign = (w) => /KHR_parallel_shader_compile|GPU stall due to ReadPixels|Automatic fallback to software WebGL/i.test(w);

// ───────────────────────────── сценарии ─────────────────────────────

async function scenarioPlay(browser, baseUrl) {
  section('Игра на ПК: загрузка, ходьба, фонарь, тряска, пауза, качество');
  const { page, context, log } = await openPage(browser, baseUrl, '?q=high&fail=0&lang=ru&touch=0&level=test');
  let st = await state(page);
  check('первый кадр показан, игра ждёт на стартовом экране', st.overlay === 'start' && st.paused === true, JSON.stringify({ overlay: st.overlay, paused: st.paused }));
  check('стартовый экран виден и подписан по-русски', (await page.textContent('.vz-overlay__prompt'))?.includes('Нажмите') === true);
  check('язык документа — ru', (await page.evaluate(() => document.documentElement.lang)) === 'ru');

  await page.click('.vz-overlay');
  await sleep(300);
  st = await state(page);
  check('клик по стартовому экрану запускает игру', st.paused === false && st.overlay === 'hidden', JSON.stringify(st.pauseReasons));
  await vz(page, () => window.__vz.freeze(true));

  // Ходьба: вперёд по коридору, затем в стену.
  const z0 = st.pos[2];
  st = await vz(page, () => window.__vz.step(120, { moveZ: 1 }));
  check('2 секунды вперёд — около 4,3 м по коридору', Math.abs(z0 - st.pos[2] - 4.35) < 0.4, `пройдено ${(z0 - st.pos[2]).toFixed(2)} м`);
  st = await vz(page, () => window.__vz.step(180, { moveX: 1 }));
  check('стена останавливает игрока', st.pos[0] > 0.9 && st.pos[0] < 1.1, `x = ${st.pos[0].toFixed(3)}`);
  st = await vz(page, () => window.__vz.step(60, { moveZ: 1, run: true }));
  check('бег быстрее шага', Math.hypot(st.vel[0], st.vel[2]) > 3.5, `скорость ${Math.hypot(st.vel[0], st.vel[2]).toFixed(2)}`);

  // Клавиатура: настоящие нажатия проходят через ввод.
  await page.keyboard.down('KeyS');
  const before = (await state(page)).pos[2];
  st = await vz(page, () => window.__vz.tick(60));
  await page.keyboard.up('KeyS');
  check('клавиша S (по физическому коду) ведёт назад', st.pos[2] > before + 1, `Δz = ${(st.pos[2] - before).toFixed(2)}`);

  // Камера догоняет луч.
  await vz(page, () => window.__vz.teleport(0, 0, 3, 0, 0));
  st = await vz(page, () => window.__vz.step(1, { lookYaw: 0.35 }));
  const lag = st.aim[0] - st.cam[0];
  st = await vz(page, () => window.__vz.step(90));
  check('луч опережает камеру, затем камера его догоняет', lag > 0.2 && Math.abs(st.aim[0] - st.cam[0]) < 0.03, `отставание ${lag.toFixed(3)} → ${(st.aim[0] - st.cam[0]).toFixed(3)}`);

  // Картинка: в луче светло, без фонаря темно, тень что-то меняет.
  await vz(page, ([y, p]) => window.__vz.teleport(3.6, 0, -7.6, y, p), [25 * R, 2 * R]);
  await vz(page, () => window.__vz.step(60));
  const lit = await vz(page, () => window.__vz.probe());
  await vz(page, () => window.__vz.shadows(false));
  const noShadow = await vz(page, () => window.__vz.probe());
  await vz(page, () => window.__vz.shadows(true));
  let maxDiff = 0;
  for (let i = 0; i < lit.length; i++) maxDiff = Math.max(maxDiff, noShadow[i] - lit[i]);
  check('в центре луча светло, по краям кадра темно', center(lit) > 48 && mean(lit) < center(lit) * 0.6, `центр ${center(lit).toFixed(1)}, среднее ${mean(lit).toFixed(1)}`);
  check('тень фонаря затемняет часть кадра', maxDiff > 8, `наибольшая разница ${maxDiff.toFixed(1)}`);
  const info = await vz(page, () => window.__vz.info());
  check('мир рисуется малым числом вызовов', info.calls <= 8 && info.triangles > 5000, `${info.calls} вызовов, ${info.triangles} треугольников`);
  check('внутренний буфер 1280×720 на высоком качестве', info.width === 1280 && info.height === 720, `${info.width}×${info.height}`);

  await vz(page, () => window.__vz.toggleLight());
  await vz(page, () => window.__vz.step(240));
  const dark = await vz(page, () => window.__vz.probe());
  st = await state(page);
  check('фонарь выключен — в кадре темно, камера поднимает усиление', center(dark) < center(lit) * 0.45 && st.gain > 3, `центр ${center(dark).toFixed(1)}, усиление ${st.gain.toFixed(2)}`);
  await vz(page, () => window.__vz.toggleLight());

  // Отказ и тряска.
  await vz(page, () => window.__vz.fail());
  st = await vz(page, () => window.__vz.step(10));
  check('фонарь заглох', st.light.state === 'dead' && st.light.intensity < 0.9);
  check('на экране подсказка «трясите» с полосой прогресса', (await page.isVisible('.vz-hud__prompt')) && (await page.textContent('.vz-hud__prompt-text'))?.includes('мыш') === true);
  st = await vz(page, () => window.__vz.step(120));
  check('без тряски фонарь не оживает', st.light.state === 'dead');
  // Настоящая тряска мышью: быстрые развороты.
  await page.mouse.move(640, 360);
  await page.mouse.down();
  for (let i = 0; i < 44; i++) {
    await page.mouse.move(640 + (i % 2 === 0 ? 90 : -90), 360, { steps: 3 });
    await vz(page, () => window.__vz.tick(5));
    if ((await state(page)).light.state === 'on') break;
  }
  await page.mouse.up();
  st = await state(page);
  check('тряска мышью оживляет фонарь', st.light.state === 'on', `состояние ${st.light.state}, прогресс ${st.light.revive.toFixed(2)}`);
  check('подсказка убрана', !(await page.isVisible('.vz-hud__prompt')));
  await vz(page, () => window.__vz.fail());
  await vz(page, () => window.__vz.step(5));
  for (let i = 0; i < 60 && (await state(page)).light.state === 'dead'; i++) {
    await page.keyboard.press('KeyF');
    await vz(page, () => window.__vz.tick(6));
  }
  check('запасной способ: стучать клавишей F', (await state(page)).light.state === 'on');

  // Пауза клавишей P и возврат кликом.
  await vz(page, () => window.__vz.freeze(false));
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.__vz.state().overlay === 'paused', null, { timeout: 15000 }).catch(() => undefined);
  st = await state(page);
  check('P ставит на паузу, экран паузы виден', st.paused === true && st.overlay === 'paused');
  const tPaused = st.time;
  await sleep(500);
  check('на паузе игровое время стоит', (await state(page)).time === tPaused);
  await page.click('.vz-overlay');
  await sleep(300);
  check('клик возвращает в игру', (await state(page)).paused === false);

  // Захват мыши не дался один раз: Chrome около секунды после Esc отклоняет повторный захват. Игра
  // не должна решить, что захвата нет вовсе, — она возвращает паузу, и следующий клик пробует снова.
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForFunction(() => window.__vz.state().overlay === 'paused', null, { timeout: 15000 }).catch(() => undefined);
  await page.evaluate(() => {
    const real = Element.prototype.requestPointerLock;
    Element.prototype.requestPointerLock = function refuseOnce() {
      Element.prototype.requestPointerLock = real;
      return Promise.reject(new DOMException('The user has exited the lock before this request was completed.', 'SecurityError'));
    };
  });
  await page.click('.vz-overlay');
  await sleep(400);
  st = await state(page);
  check('отказ в захвате мыши возвращает паузу, а не переводит в режим зажатой кнопки', st.paused === true && st.overlay === 'paused' && st.drag === false, JSON.stringify({ paused: st.paused, overlay: st.overlay, drag: st.drag, reasons: st.pauseReasons }));
  await page.click('.vz-overlay');
  await sleep(400);
  st = await state(page);
  const relocked = await page.evaluate(() => document.pointerLockElement !== null);
  check('следующий клик захватывает мышь, игра идёт', st.paused === false && relocked && st.drag === false, JSON.stringify({ paused: st.paused, locked: relocked, drag: st.drag, reasons: st.pauseReasons }));
  await vz(page, () => window.__vz.freeze(true));

  // Качество и язык.
  await vz(page, () => window.__vz.quality('low'));
  const low = await vz(page, () => window.__vz.info());
  check('низкое качество: буфер 640×360', low.width === 640 && low.height === 360, `${low.width}×${low.height}`);
  // После тряски мышью и кликов взгляд в тестовом браузере может стоять как угодно — выставляем заново.
  await vz(page, ([y, p]) => window.__vz.teleport(3.6, 0, -7.6, y, p), [25 * R, 2 * R]);
  await vz(page, () => window.__vz.step(30));
  const lowGrid = await vz(page, () => window.__vz.probe());
  check('на низком качестве картинка есть', center(lowGrid) > 30, `центр ${center(lowGrid).toFixed(1)}`);
  await vz(page, () => window.__vz.quality('high'));
  await vz(page, () => window.__vz.lang('en'));
  check('смена языка на лету: REC/CAM и документ', (await page.textContent('.vz-hud__cam')) === 'CAM-07' && (await page.evaluate(() => document.documentElement.lang)) === 'en');
  check('нет ненайденных ключей локализации', (await vz(page, () => window.__vz.missingKeys())).length === 0);

  // Потеря графического контекста.
  await vz(page, () => window.__vz.freeze(false));
  await vz(page, () => window.__vz.loseContext(250));
  await sleep(1200);
  st = await state(page);
  check('потеря контекста ставит паузу, после восстановления её можно снять', st.pauseReasons.includes('context') === false && st.paused === true, JSON.stringify(st.pauseReasons));
  await page.click('.vz-overlay');
  await sleep(300);
  await vz(page, () => window.__vz.freeze(true));
  await vz(page, ([y, p]) => window.__vz.teleport(3.6, 0, -7.6, y, p), [25 * R, 2 * R]);
  await vz(page, () => window.__vz.step(30));
  const after = await vz(page, () => window.__vz.probe());
  check('после восстановления контекста картинка вернулась', center(after) > 48, `центр ${center(after).toFixed(1)}`);

  check('нет ошибок в консоли', log.errors.length === 0, log.errors.join(' | ').slice(0, 400));
  const warns = log.warnings.filter((w) => !benign(w));
  check('нет предупреждений в консоли', warns.length === 0, warns.join(' | ').slice(0, 400));
  check('нет внешних запросов', log.external.length === 0, log.external.join(', ').slice(0, 300));
  check('нет неудачных запросов', log.failed.length === 0, log.failed.join(', ').slice(0, 300));
  await context.close();
}

async function scenarioGen(browser, baseUrl) {
  section('Сгенерированный бункер: загрузка, ярусы, отсечение, спуск по лестнице');
  const { page, context, log } = await openPage(browser, baseUrl, '?q=med&fail=0&lang=ru&touch=0&seed=20041113&rank=3');
  await page.click('.vz-overlay');
  await sleep(300);
  await vz(page, () => window.__vz.freeze(true));
  await vz(page, () => window.__vz.calm(true));
  const level = await vz(page, () => window.__vz.level());
  check('уровень собран из генератора: три яруса, помещений больше двадцати', level.seed === 20041113 && level.tiers === 3 && level.rooms.length > 20, `ярусов ${level.tiers}, помещений ${level.rooms.length}`);
  check('геометрия в бюджете: чанков меньше 140, треугольников меньше 400 тысяч', level.chunks < 140 && level.triangles < 400000, `${level.chunks} чанков, ${level.triangles} треугольников`);
  check('есть места для находок и приметы на каждом ярусе', level.spots > 25 && [0, 1, 2].every((t) => level.landmarks.some((m) => m.tier === t)), `мест ${level.spots}, примет ${level.landmarks.length}`);

  let st = await vz(page, () => window.__vz.step(30));
  const grid0 = await vz(page, () => window.__vz.probe());
  let info = await vz(page, () => window.__vz.info());
  check('у люка: картинка есть, игрок стоит на полу первого яруса', Math.max(...grid0) > 40 && Math.abs(st.pos[1]) < 0.01 && st.onGround, `y = ${st.pos[1].toFixed(3)}`);
  check('на первом ярусе чужие этажи не рисуются', info.visible < info.chunks * 0.7, `видно ${info.visible} из ${info.chunks}`);
  check('вызовов отрисовки не больше 80', info.calls <= 80, `${info.calls} вызовов, ${info.triangles} треугольников`);

  // Приметы на каждом ярусе: встаём рядом, проверяем высоту пола и картинку.
  for (const [tier, id] of [
    [1, 'diesel'],
    [2, 'archive'],
  ]) {
    const ok = await vz(page, (i) => window.__vz.gotoLandmark(i), id);
    st = await vz(page, () => window.__vz.step(40));
    const g = await vz(page, () => window.__vz.probe());
    info = await vz(page, () => window.__vz.info());
    check(`ярус ${tier + 1}: примета «${id}» найдена, игрок стоит на полу яруса, в кадре светло`, ok && Math.abs(st.pos[1] + tier * 4.5) < 0.01 && st.onGround && Math.max(...g) > 40, `y = ${st.pos[1].toFixed(2)}, максимум ${Math.max(...g).toFixed(0)}`);
    check(`ярус ${tier + 1}: рисуется не весь уровень`, info.visible < info.chunks, `видно ${info.visible} из ${info.chunks}, ${info.calls} вызовов`);
  }
  check('нет ошибок в консоли', log.errors.length === 0, log.errors.join(' | ').slice(0, 400));
  await context.close();
}

async function scenarioFear(browser, baseUrl) {
  section('Рой и аномалии: охота, развал лучом, возвращение, поимка, длинная лестница, изменившаяся комната');
  const { page, context, log } = await openPage(browser, baseUrl, '?q=low&fail=0&lang=ru&touch=0&rank=3&seed=20041113');
  await page.click('.vz-overlay');
  await sleep(300);
  await vz(page, () => window.__vz.freeze(true));
  let st = await vz(page, () => window.__vz.step(5));
  check('в начале вылазки рой спит, режиссёр в первой фазе', st.swarm.mode === 'dormant' && st.director.phase === 0 && st.swarm.near === 0);

  // Повернуть луч на рой и шагать, пока не выполнится условие.
  const aimAndStep = (steps, extra = {}) =>
    vz(
      page,
      ([n, inp]) => {
        const v = window.__vz;
        const s = v.state();
        const dx = s.swarm.pos[0] - s.pos[0];
        const dz = s.swarm.pos[2] - s.pos[2];
        v.teleport(s.pos[0], s.pos[1], s.pos[2], Math.atan2(-dx, -dz), 0.02);
        return v.step(n, inp);
      },
      [steps, extra],
    );

  // ── Аномалии (пока рой спит) ──
  const an = await vz(page, () => window.__vz.anomalies());
  const stair = an.stairs.find((x) => x.upperTier === 1);
  const ax = Math.sign(stair.bottom[0] - stair.top[0]);
  const az = Math.sign(stair.bottom[2] - stair.top[2]);
  await vz(page, ([p, yaw]) => window.__vz.teleport(p[0], p[1], p[2], yaw, -0.3), [stair.top, Math.atan2(-ax, -az)]);
  st = await vz(page, () => window.__vz.step(10));
  check('перед спуском на нижний ярус лестница «заряжена» на два лишних пролёта', st.anomalies.loops === 2 && Math.abs(st.pos[1] + 4.5) < 0.01);
  let ticks = 0;
  for (; ticks < 40 && st.pos[1] > -8.95; ticks++) st = await vz(page, () => window.__vz.step(20, { moveZ: 1 }));
  const seconds = (ticks * 20) / 60;
  check('спуск занял заметно дольше обычного: лестница оказалась длиннее', st.anomalies.loops === 0 && Math.abs(st.pos[1] + 9) < 0.06 && seconds > 6.3 && seconds < 11, `${seconds.toFixed(1)} с вместо ~4,5; осталось пролётов ${st.anomalies.loops}; y = ${st.pos[1].toFixed(2)}`);
  check('камера на лестнице не дёргалась рывком вверх', st.onGround === true);

  const variant = an.variants[0];
  await vz(page, () => window.__vz.swarm('sleep'));
  await vz(page, () => window.__vz.phase(0));
  await vz(page, (c) => window.__vz.teleport(c[0], c[1], c[2]), variant.center);
  st = await vz(page, () => window.__vz.step(5));
  check('в комнате-аномалии поначалу первый вариант обстановки', st.anomalies.alt.length === 0);
  const far = [variant.center[0] + 30, variant.center[1], variant.center[2] + 30];
  await vz(page, () => window.__vz.gotoExit());
  st = await vz(page, () => window.__vz.step(5));
  check('побывал, ушёл далеко — комната изменилась', st.anomalies.alt.includes(variant.room), JSON.stringify(st.anomalies.alt));
  void far;

  // ── Рой ──
  await vz(page, () => window.__vz.phase(0));
  const ok = await vz(page, () => window.__vz.swarm('release', 5));
  st = await state(page);
  check('рой выпущен в пяти клетках и знает, где игрок', ok && (st.swarm.mode === 'stalk' || st.swarm.mode === 'cohere') && st.swarm.awareness > 0.5, st.swarm.mode);
  for (let i = 0; i < 60 && st.swarm.mode !== 'hunt'; i++) st = await vz(page, () => window.__vz.step(20));
  check('рой подошёл на свет и собрался в фигуру', st.swarm.mode === 'hunt' && st.swarm.cohesion === 1 && st.swarm.near > 0.15, `${st.swarm.mode}, сцепление ${st.swarm.cohesion.toFixed(2)}, близость ${st.swarm.near.toFixed(2)}`);
  check('подсказка про луч показана один раз', (await page.textContent('.vz-hud__toast'))?.includes('луч') === true);
  for (let i = 0; i < 80 && st.swarm.mode === 'hunt' && !st.sortie.outcome; i++) st = await aimAndStep(6);
  check('прямой луч развалил рой, игрок цел', st.swarm.mode === 'scatter' && st.swarm.aggravation === 1 && st.sortie.outcome === null, `${st.swarm.mode}, исход ${st.sortie.outcome}`);
  for (let i = 0; i < 90 && st.swarm.mode !== 'hunt' && !st.sortie.outcome; i++) st = await vz(page, () => window.__vz.step(20));
  check('рой вернулся и снова охотится', st.swarm.mode === 'hunt' && st.sortie.outcome === null, st.swarm.mode);
  // Гасим фонарь: в темноте рой, который уже знает, где игрок, добирается быстро.
  await vz(page, () => window.__vz.toggleLight());
  for (let i = 0; i < 90 && !st.sortie.outcome; i++) st = await vz(page, () => window.__vz.step(20, { moveZ: 0 }));
  check('с погашенным фонарём рой ловит игрока', st.sortie.outcome === 'caught', `исход ${st.sortie.outcome}, рой ${st.swarm.mode}, близость ${st.swarm.near.toFixed(2)}`);
  st = await vz(page, () => window.__vz.step(130));
  check('отчёт: запись прервана, причина — сигнал потерян', st.overlay === 'report' && (await page.textContent('.vz-overlay__title')) === 'ЗАПИСЬ ПРЕРВАНА' && (await page.textContent('.vz-overlay__sub')) === 'сигнал потерян');

  check('нет ненайденных ключей локализации', (await vz(page, () => window.__vz.missingKeys())).length === 0);
  check('нет ошибок в консоли', log.errors.length === 0, log.errors.join(' | ').slice(0, 400));
  await context.close();
}

/**
 * Выполнить цель вылазки: встать перед ней и взять либо снять. Рядом с целью может лежать другая
 * вещь — она берётся первой, поэтому «забрать» повторяется, пока цель не закрыта.
 */
async function doGoal(page, index, goal) {
  let st;
  for (let attempt = 0; attempt < 4; attempt++) {
    await vz(page, (n) => window.__vz.gotoGoal(n), index);
    await vz(page, () => window.__vz.step(20));
    st = goal.type === 'take' ? await vz(page, () => window.__vz.step(3, { actionPressed: true, action: true })) : await vz(page, () => window.__vz.step(110, { action: true }));
    if (st.sortie.done.includes(goal.id)) break;
  }
  return st;
}

async function scenarioSortie(browser, baseUrl) {
  section('Вылазка: задание, цели, батарейка, продолжение после перезагрузки, выход и отчёт, гибель');
  const { page, context, log } = await openPage(browser, baseUrl, '?q=low&fail=0&lang=ru&touch=0&rank=3');
  // Журнал сообщений вверху кадра: сами сообщения гаснут через несколько секунд реального времени.
  await page.evaluate(() => {
    window.__toasts = [];
    const el = document.querySelector('.vz-hud__toast');
    new MutationObserver(() => {
      if (el.textContent) window.__toasts.push(el.textContent);
    }).observe(el, { childList: true, characterData: true, subtree: true });
  });
  let st = await state(page);
  const lines = await page.$$eval('.vz-overlay__line--todo', (els) => els.map((e) => e.textContent));
  check('карточка задания: объект с номером и три цели', st.screen === 'briefing' && /Убежище № \d{3}/.test((await page.textContent('.vz-overlay__sub')) ?? '') && lines.length === 3, `экран ${st.screen}, целей ${lines.length}`);
  const seed1 = st.seed;
  await page.click('.vz-overlay');
  await sleep(300);
  await vz(page, () => window.__vz.freeze(true));
  await vz(page, () => window.__vz.calm(true));
  st = await vz(page, () => window.__vz.step(5));
  check('вылазка началась, счётчик вылазок вырос', st.screen === 'play' && st.profile.sorties === 1 && st.sortie.outcome === null);
  check('список целей виден в начале вылазки', await page.evaluate(() => document.querySelector('.vz-hud__goals').classList.contains('is-on') && document.querySelectorAll('.vz-hud__goal').length === 3));

  // Первая цель: подойти и выполнить.
  const goals = await vz(page, () => window.__vz.goals());
  const first = goals[0];
  await vz(page, () => window.__vz.gotoGoal(0));
  st = await vz(page, () => window.__vz.step(20));
  check(`цель «${first.type}» под рукой: подсказка действия и рамка видны`, st.sortie.target === (first.type === 'take' ? 'item' : 'shoot') && (await page.isVisible('.vz-hud__act')) && (await page.isVisible('.vz-hud__mark')), `под рукой: ${st.sortie.target}`);
  st = await doGoal(page, 0, first);
  const toasts = await page.evaluate(() => window.__toasts ?? []);
  check('первая цель выполнена, на экране было сообщение об этом', st.sortie.done.includes(first.id) && toasts.some((x) => x.startsWith('Выполнено')), `${JSON.stringify(st.sortie.done)}; сообщения: ${toasts.join(' | ')}`);
  check('в списке целей она зачёркнута', (await page.$$eval('.vz-hud__goal.is-done', (els) => els.length)) === 1);

  // Батарейка.
  let items = await vz(page, () => window.__vz.items());
  const sparesBefore = st.sortie.spares;
  const bat = items.find((i) => i.type === 'battery' && !i.taken);
  for (let attempt = 0; attempt < 4 && !(await state(page)).sortie.taken.includes(bat.id); attempt++) {
    await vz(page, (id) => window.__vz.gotoItem(id), bat.id);
    await vz(page, () => window.__vz.step(10));
    await vz(page, () => window.__vz.step(3, { actionPressed: true, action: true }));
  }
  st = await state(page);
  check('батарейка подобрана: запасная в счётчике', st.sortie.taken.includes(bat.id) && st.sortie.spares > sparesBefore && (await page.textContent('.vz-hud__bat-spare')) === `+${st.sortie.spares}`, `запасных ${st.sortie.spares}`);
  items = await vz(page, () => window.__vz.items());
  const sparesSaved = st.sortie.spares;
  // Настоящая клавиша E берёт предмет.
  const find = items.find((i) => i.type === 'find' && !i.taken && !goals.some((g) => g.type === 'take' && g.pos[0] === i.pos[0] && g.pos[2] === i.pos[2]));
  for (let attempt = 0; attempt < 4 && !(await state(page)).sortie.taken.includes(find.id); attempt++) {
    await vz(page, (id) => window.__vz.gotoItem(id), find.id);
    await vz(page, () => window.__vz.step(10));
    await page.keyboard.down('KeyE');
    await vz(page, () => window.__vz.tick(4));
    await page.keyboard.up('KeyE');
    await vz(page, () => window.__vz.tick(2));
  }
  st = await state(page);
  check('клавиша E подбирает находку', st.sortie.taken.includes(find.id) && st.sortie.finds.includes(find.find), `находки: ${st.sortie.finds.join(', ')}`);

  // Перезагрузка: вылазку можно продолжить.
  await sleep(300);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__vz?.ready() === true, null, { timeout: 90000 });
  st = await state(page);
  check('после перезагрузки тот же объект, предлагается продолжить', st.seed === seed1 && (await page.textContent('.vz-overlay__prompt'))?.includes('продолжить') === true && (await page.$$eval('.vz-overlay__line--done', (els) => els.length)) === 1, `сид ${st.seed} вместо ${seed1}`);
  await page.click('.vz-overlay');
  await sleep(300);
  await vz(page, () => window.__vz.freeze(true));
  await vz(page, () => window.__vz.calm(true));
  st = await vz(page, () => window.__vz.step(5));
  check('прогресс восстановлен: цель, батарейка, находка; вылазка не посчитана второй раз', st.sortie.done.includes(first.id) && st.sortie.spares === sparesSaved && st.sortie.finds.includes(find.find) && st.profile.sorties === 1, JSON.stringify({ done: st.sortie.done, spares: st.sortie.spares, sorties: st.profile.sorties }));

  // Остальные цели и выход.
  for (let i = 1; i < 3; i++) {
    const g = goals[i];
    st = await doGoal(page, i, g);
    check(`цель ${i + 1} («${g.type}», ярус ${g.tier + 1}) выполнена`, st.sortie.done.includes(g.id), `под рукой: ${st.sortie.target}, удержание ${st.sortie.hold.toFixed(2)}`);
  }
  check('спуск на третий ярус отмечен как глубина вылазки', st.sortie.maxTier === 2);
  await vz(page, () => window.__vz.gotoExit());
  st = await vz(page, () => window.__vz.step(10));
  check('у лестницы предлагается подняться', st.sortie.target === 'exit' && (await page.textContent('.vz-hud__act-text'))?.includes('подняться') === true);
  st = await vz(page, () => window.__vz.step(80, { action: true }));
  check('удержание у лестницы завершает вылазку', st.sortie.outcome === 'escaped' && st.screen === 'ending');
  st = await vz(page, () => window.__vz.step(120));
  const title = await page.textContent('.vz-overlay__title');
  check('отчёт: вылазка завершена, находки вынесены и попали в архив', st.screen === 'report' && st.overlay === 'report' && title === 'ВЫЛАЗКА ЗАВЕРШЕНА' && st.profile.successes === 1 && st.profile.archive.includes(find.find), `${title}; архив: ${st.profile.archive.join(', ')}`);
  check('в отчёте три выполненные цели', (await page.$$eval('.vz-overlay__line--done', (els) => els.length)) === 3);
  const bad = await page.evaluate(layoutProbe);
  check('отчёт помещается на экране', bad.length === 0, bad.join('; '));

  // Следующий объект.
  await vz(page, () => window.__vz.freeze(false));
  await sleep(1000);
  await page.click('.vz-overlay');
  await page.waitForFunction(() => window.__vz.state().screen === 'briefing', null, { timeout: 30000 }).catch(() => undefined);
  st = await state(page);
  check('после отчёта — новый объект', st.screen === 'briefing' && st.seed !== seed1 && st.sortie.done.length === 0, `сид ${st.seed}`);
  check('в карточке задания виден счёт архива', (await page.textContent('.vz-overlay__body'))?.includes('В архиве') === true);

  // Гибель в провале: находки не выносятся.
  await page.click('.vz-overlay');
  await sleep(300);
  await vz(page, () => window.__vz.freeze(true));
  await vz(page, () => window.__vz.calm(true));
  const archiveBefore = (await state(page)).profile.archive.length;
  const hz = await vz(page, () => window.__vz.hazards());
  const pit = hz.zones.find((z) => z.kind === 'pit');
  check('на объекте есть провалы, вода, газ и обвал', !!pit && hz.zones.some((z) => z.kind === 'water') && hz.zones.some((z) => z.kind === 'gas') && hz.collapses.length > 0, JSON.stringify(hz.zones.map((z) => z.kind)));
  const water = hz.zones.find((z) => z.kind === 'water');
  await vz(page, (c) => window.__vz.teleport(c[0], c[1] - 1, c[2]), water.center);
  st = await vz(page, () => window.__vz.step(30));
  check('в воде игрок «в воде» и идёт медленнее', st.sortie.inWater === true);
  const gas = hz.zones.find((z) => z.kind === 'gas');
  await vz(page, (c) => window.__vz.teleport(c[0], c[1] - 2.7, c[2]), gas.center);
  st = await vz(page, () => window.__vz.step(400));
  check('в газу здоровье падает и растёт паника', st.sortie.inGas === true && st.sortie.health < 85 && st.sortie.panic > 0.3, `здоровье ${st.sortie.health.toFixed(0)}, паника ${st.sortie.panic.toFixed(2)}`);
  await vz(page, (c) => window.__vz.teleport(c[0], c[1] + 0.8, c[2]), pit.center);
  st = await vz(page, () => window.__vz.step(60));
  check('шаг в провал обрывает запись', st.sortie.outcome === 'fell');
  st = await vz(page, () => window.__vz.step(120));
  check('отчёт: запись прервана, архив не пополнился', st.overlay === 'report' && (await page.textContent('.vz-overlay__title')) === 'ЗАПИСЬ ПРЕРВАНА' && st.profile.archive.length === archiveBefore && st.profile.successes === 1);

  check('нет ненайденных ключей локализации', (await vz(page, () => window.__vz.missingKeys())).length === 0, (await vz(page, () => window.__vz.missingKeys())).join(', '));
  check('нет ошибок в консоли', log.errors.length === 0, log.errors.join(' | ').slice(0, 400));
  await context.close();
}

/** Синтетический палец: события указателя на элементе под точкой. */
const finger = (page, type, id, x, y) =>
  page.evaluate(
    ([t, i, px, py]) => {
      const el = document.elementFromPoint(px, py) ?? document.body;
      const target = t === 'pointerdown' ? el : document.querySelector('.vz-touch');
      target.dispatchEvent(new PointerEvent(t, { pointerId: i, clientX: px, clientY: py, bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: i === 1 }));
    },
    [type, id, x, y],
  );

async function scenarioTouch(browser, baseUrl) {
  section('Телефон: тач-управление, тряска пальцем, портрет и ландшафт');
  for (const [name, width, height] of [
    ['ландшафт 915×412', 915, 412],
    ['портрет 390×844', 390, 844],
  ]) {
    const { page, context, log } = await openPage(browser, baseUrl, '?q=med&fail=0&lang=ru&level=test', { viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    let st = await state(page);
    check(`${name}: схема управления — тач`, st.touch === true);
    check(`${name}: стартовый экран зовёт коснуться`, (await page.textContent('.vz-overlay__prompt'))?.includes('Коснитесь') === true);
    await page.tap('.vz-overlay');
    await sleep(300);
    st = await state(page);
    check(`${name}: касание запускает игру`, st.paused === false);
    await vz(page, () => window.__vz.freeze(true));
    check(`${name}: кнопки фонаря и паузы видны и достаточно велики`, await page.evaluate(() => [...document.querySelectorAll('.vz-touch__btn')].filter((b) => !b.hidden).every((b) => b.getBoundingClientRect().width >= 44 && b.getBoundingClientRect().height >= 44)));

    // Стик слева: палец вверх — вперёд.
    const sx = width * 0.2;
    const sy = height * 0.7;
    const z0 = st.pos[2];
    await finger(page, 'pointerdown', 1, sx, sy);
    await finger(page, 'pointermove', 1, sx, sy - 40);
    st = await vz(page, () => window.__vz.tick(60));
    check(`${name}: стик слева ведёт вперёд`, z0 - st.pos[2] > 1, `пройдено ${(z0 - st.pos[2]).toFixed(2)} м`);
    check(`${name}: стик виден под пальцем`, await page.evaluate(() => document.querySelector('.vz-touch__stick').classList.contains('is-on')));
    // Второй палец справа ведёт луч, не мешая ходьбе.
    const yaw0 = st.aim[0];
    await finger(page, 'pointerdown', 2, width * 0.7, height * 0.4);
    await finger(page, 'pointermove', 2, width * 0.7 + 60, height * 0.4);
    st = await vz(page, () => window.__vz.tick(2));
    check(`${name}: палец справа поворачивает луч вправо`, st.aim[0] < yaw0 - 0.2, `Δyaw = ${(st.aim[0] - yaw0).toFixed(3)}`);
    await finger(page, 'pointerup', 2, width * 0.7 + 60, height * 0.4);
    await finger(page, 'pointerup', 1, sx, sy - 40);
    st = await vz(page, () => window.__vz.tick(40));
    check(`${name}: палец убран — игрок останавливается`, Math.hypot(st.vel[0], st.vel[2]) < 0.1);

    // Кнопка фонаря: тап выключает и включает.
    const btn = await page.evaluate(() => {
      const r = document.querySelector('.vz-touch__btn--light').getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    });
    await finger(page, 'pointerdown', 3, btn[0], btn[1]);
    await finger(page, 'pointerup', 3, btn[0], btn[1]);
    st = await vz(page, () => window.__vz.tick(2));
    check(`${name}: тап по кнопке выключает фонарь`, st.light.state === 'off');
    await finger(page, 'pointerdown', 3, btn[0], btn[1]);
    await finger(page, 'pointerup', 3, btn[0], btn[1]);
    st = await vz(page, () => window.__vz.tick(2));
    check(`${name}: второй тап включает`, st.light.state === 'on');

    // Отказ: кнопку трут пальцем.
    await vz(page, () => window.__vz.fail());
    st = await vz(page, () => window.__vz.step(5));
    check(`${name}: у заглохшего фонаря кнопка подсвечена, подсказка про палец`, (await page.evaluate(() => document.querySelector('.vz-touch__btn--light').classList.contains('is-dead'))) && (await page.textContent('.vz-hud__prompt-text'))?.includes('трите') === true);
    await finger(page, 'pointerdown', 4, btn[0], btn[1]);
    for (let i = 0; i < 70; i++) {
      await finger(page, 'pointermove', 4, btn[0] + (i % 2 === 0 ? 26 : -26), btn[1]);
      st = await vz(page, () => window.__vz.tick(4));
      if (st.light.state === 'on') break;
    }
    await finger(page, 'pointerup', 4, btn[0], btn[1]);
    check(`${name}: растирание кнопки оживляет фонарь`, st.light.state === 'on', `состояние ${st.light.state}, прогресс ${st.light.revive.toFixed(2)}`);
    st = await vz(page, () => window.__vz.tick(2));
    check(`${name}: протяжка по кнопке не считается нажатием`, st.light.state === 'on');

    const grid = await vz(page, () => window.__vz.probe());
    check(`${name}: картинка есть`, Math.max(...grid) > 40, `максимум ${Math.max(...grid).toFixed(1)}`);
    const bad = await page.evaluate(layoutProbe);
    check(`${name}: надписи и кнопки в пределах экрана`, bad.length === 0, bad.join('; '));
    if (wantShots) {
      mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: join(OUT, `touch_${width}x${height}.png`) });
    }
    // Пауза кнопкой.
    await vz(page, () => window.__vz.freeze(false));
    await page.tap('.vz-touch__btn--pause');
    await page.waitForFunction(() => window.__vz.state().overlay === 'paused', null, { timeout: 15000 }).catch(() => undefined);
    check(`${name}: кнопка паузы работает`, (await state(page)).overlay === 'paused');
    check(`${name}: нет ошибок в консоли`, log.errors.length === 0, log.errors.join(' | ').slice(0, 300));
    await context.close();
  }
}

async function scenarioTouchSortie(browser, baseUrl) {
  section('Телефон в вылазке: кнопка действия, список целей, раскладка');
  for (const [name, width, height] of [
    ['ландшафт 915×412', 915, 412],
    ['портрет 390×844', 390, 844],
  ]) {
    const { page, context, log } = await openPage(browser, baseUrl, '?q=low&fail=0&lang=ru&rank=2', { viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    let bad = await page.evaluate(layoutProbe);
    check(`${name}: карточка задания помещается на экране`, bad.length === 0 && (await page.$$eval('.vz-overlay__line--todo', (els) => els.length)) === 3, bad.join('; '));
    await page.tap('.vz-overlay');
    await sleep(300);
    await vz(page, () => window.__vz.freeze(true));
    await vz(page, () => window.__vz.calm(true));
    let st = await vz(page, () => window.__vz.step(5));
    check(`${name}: кнопки действия нет, пока брать нечего`, await page.evaluate(() => document.querySelector('.vz-touch__btn--act').hidden === true));
    const items = await vz(page, () => window.__vz.items());
    const bat = items.find((i) => i.type === 'battery');
    await vz(page, (id) => window.__vz.gotoItem(id), bat.id);
    st = await vz(page, () => window.__vz.step(10));
    const rect = await page.evaluate(() => {
      const b = document.querySelector('.vz-touch__btn--act');
      const r = b.getBoundingClientRect();
      return b.hidden ? null : [r.left + r.width / 2, r.top + r.height / 2, r.width];
    });
    check(`${name}: рядом с предметом появляется кнопка действия`, st.sortie.target === 'item' && rect !== null && rect[2] >= 44, `под рукой: ${st.sortie.target}`);
    bad = await page.evaluate(layoutProbe);
    check(`${name}: цели, заряд, подсказка действия и кнопки не наезжают друг на друга`, bad.length === 0, bad.join('; '));
    if (wantShots) {
      mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: join(OUT, `touch_sortie_${width}x${height}.png`) });
    }
    if (rect) {
      const before = st.sortie.taken.length;
      await finger(page, 'pointerdown', 7, rect[0], rect[1]);
      st = await vz(page, () => window.__vz.tick(3));
      await finger(page, 'pointerup', 7, rect[0], rect[1]);
      check(`${name}: касание кнопки действия подбирает предмет`, st.sortie.taken.length === before + 1, `взято ${st.sortie.taken.length}`);
    }
    // Кнопка «задание» показывает список целей.
    await vz(page, () => window.__vz.step(600));
    const hiddenGoals = await page.evaluate(() => !document.querySelector('.vz-hud__goals').classList.contains('is-on'));
    await page.tap('.vz-touch__btn--goals');
    await vz(page, () => window.__vz.tick(2));
    check(`${name}: список целей прячется сам и открывается кнопкой`, hiddenGoals && (await page.evaluate(() => document.querySelector('.vz-hud__goals').classList.contains('is-on'))));
    check(`${name}: нет ошибок в консоли`, log.errors.length === 0, log.errors.join(' | ').slice(0, 300));
    await context.close();
  }
}

/** Выход за экран, обрезанный текст и прокрутка страницы. */
const layoutProbe = () => {
  const vw = innerWidth;
  const vh = innerHeight;
  const bad = [];
  for (const el of document.querySelectorAll('.vz-root *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    if (el.tagName === 'CANVAS' || el.classList.contains('vz-touch__stick') || el.classList.contains('vz-touch__knob')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const name = el.tagName + '.' + String(el.className).split(' ')[0];
    if (r.left < -1 || r.right > vw + 1) bad.push(`x-out ${name} ${Math.round(r.left)}..${Math.round(r.right)} из ${vw}`);
    if (r.top < -1 || r.bottom > vh + 1) bad.push(`y-out ${name} ${Math.round(r.top)}..${Math.round(r.bottom)} из ${vh}`);
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && !/auto|scroll|hidden/.test(cs.overflowX) && ['BUTTON', 'SPAN', 'DIV'].includes(el.tagName) && el.children.length === 0) bad.push(`clip-x ${name} ${el.scrollWidth}>${el.clientWidth}`);
  }
  // Надписи записи не наезжают друг на друга и на кнопку паузы.
  const rect = (sel) => {
    const el = document.querySelector(sel);
    if (!el || getComputedStyle(el).display === 'none' || el.closest('.is-hidden')) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  };
  const overlap = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  const tl = rect('.vz-hud__tl');
  const tr = rect('.vz-hud__clock');
  const pause = rect('.vz-touch__btn--pause');
  if (overlap(tl, tr)) bad.push('overlap REC и время');
  if (overlap(tl, pause) || overlap(tr, pause)) bad.push('overlap надписи и кнопка паузы');
  if (overlap(rect('.vz-hud__prompt'), rect('.vz-touch__btn--light'))) bad.push('overlap подсказка тряски и кнопка фонаря');
  if (overlap(rect('.vz-hud__hint.is-on'), rect('.vz-touch__btn--light'))) bad.push('overlap подсказка и кнопка фонаря');
  const goals = rect('.vz-hud__goals.is-on');
  const act = rect('.vz-hud__act.is-on');
  const bat = rect('.vz-hud__bat.is-on');
  const actBtn = document.querySelector('.vz-touch__btn--act:not([hidden])') ? rect('.vz-touch__btn--act') : null;
  if (overlap(goals, pause) || overlap(goals, rect('.vz-touch__btn--goals'))) bad.push('overlap цели и кнопки слева');
  if (overlap(goals, tr) || overlap(goals, bat)) bad.push('overlap цели и время или заряд');
  if (overlap(bat, tr) || overlap(bat, tl)) bad.push('overlap заряд и надписи записи');
  if (overlap(act, actBtn) || overlap(act, rect('.vz-touch__btn--light'))) bad.push('overlap подсказка действия и кнопки справа');
  if (overlap(act, goals)) bad.push('overlap подсказка действия и цели');
  const hint = document.querySelector('.vz-hud__hint.is-on');
  if (hint && Number(getComputedStyle(hint).opacity) > 0.05 && (overlap(act, rect('.vz-hud__hint.is-on')) || overlap(rect('.vz-hud__prompt'), rect('.vz-hud__hint.is-on')))) bad.push('overlap подсказка и подсказка действия');
  const toast = rect('.vz-hud__toast.is-on');
  if (overlap(toast, goals) || overlap(toast, act)) bad.push('overlap сообщение и цели или действие');
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth || de.scrollHeight > de.clientHeight) bad.push(`page-scroll ${de.scrollWidth}x${de.scrollHeight} в ${de.clientWidth}x${de.clientHeight}`);
  return bad.slice(0, 6);
};

const MATRIX = [
  ['360x640', 360, 640, 2, true],
  ['390x844', 390, 844, 3, true],
  ['915x412', 915, 412, 2.6, true],
  ['800x800', 800, 800, 1, false],
  ['1280x720', 1280, 720, 1, false],
  ['2560x1440', 2560, 1440, 1, false],
];

async function scenarioMatrix(browser, baseUrl) {
  section(`Матрица раскладки: ${MATRIX.map((m) => m[0]).join(', ')} × ${matrixLangs.join(', ')} (псевдолокализация +35 %)`);
  if (wantShots) mkdirSync(OUT, { recursive: true });
  for (const lang of matrixLangs) {
    for (const [name, width, height, dpr, mobile] of MATRIX) {
      const { page, context, log } = await openPage(browser, baseUrl, `?lang=${lang}&pseudo=1&q=low&fail=0&level=test`, { viewport: { width, height }, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile, locale: lang });
      const screens = [];
      const probe = async (screen) => {
        const bad = await page.evaluate(layoutProbe);
        screens.push(`${screen}${bad.length ? ': ' + bad.join('; ') : ''}`);
        if (wantShots) await page.screenshot({ path: join(OUT, `${name}_${lang}_${screen}.png`) });
        return bad.length === 0;
      };
      let ok = await probe('start');
      await page.click('.vz-overlay', { position: { x: 5, y: 5 } });
      await sleep(250);
      await vz(page, () => window.__vz.freeze(true));
      await vz(page, () => window.__vz.step(20));
      ok = (await probe('play')) && ok;
      await vz(page, () => window.__vz.fail());
      await vz(page, () => window.__vz.step(10));
      ok = (await probe('dead')) && ok;
      await vz(page, () => window.__vz.pause(true));
      await sleep(150);
      ok = (await probe('paused')) && ok;
      const sizeOk = await page.evaluate(() => {
        const c = document.querySelector('canvas').getBoundingClientRect();
        return Math.abs(c.width - innerWidth) < 1 && Math.abs(c.height - innerHeight) < 1;
      });
      check(`${name} ${lang}: старт, игра, заглохший фонарь, пауза — без выхода за экран; canvas во весь экран`, ok && sizeOk && log.errors.length === 0, screens.filter((s) => s.includes(':')).join(' | ') + (log.errors.length ? ' ошибки: ' + log.errors.join(' | ').slice(0, 200) : ''));
      await context.close();
    }
  }
}

async function scenarioBridge(browser, baseUrl) {
  section('Bridge SDK: game_ready, язык и устройство площадки, пауза (только сборка с window.bridge)');
  const sdk = [];
  // Журнал вызовов — собственный debug-лог SDK (?debug=1); слушатель ставится до загрузки страницы.
  let queue = Promise.resolve();
  const onConsole = (m) => {
    if (!m.text().includes('PlaygamaBridge')) return;
    const handles = m.args().slice(3);
    const text = m.text().replace(/%c/g, '').replace(/background:[^;]*;[^;]*;[^;]*;[^;]*;?/g, '').trim();
    queue = queue.then(async () => {
      const vals = await Promise.all(handles.map((a) => a.jsonValue().catch(() => '?'))).catch(() => []);
      sdk.push({ text, vals });
    });
  };
  const { page, context, log } = await openPage(browser, baseUrl, '?debug=1&q=low&fail=0&rank=1', {}, onConsole);
  const hasBridge = await page.evaluate(() => !!window.bridge);
  if (!hasBridge) {
    console.log('  (window.bridge нет — раздел пропущен)');
    await context.close();
    return;
  }
  const messages = (name) => sdk.filter((c) => /\[platform\] sendMessage\(\)$/.test(c.text) && c.vals[0] === name);
  for (let i = 0; i < 50 && messages('game_ready').length === 0; i++) {
    await sleep(100);
    await queue;
  }
  await sleep(400);
  await queue;
  check('Bridge инициализирован до старта игры', await page.evaluate(() => window.bridge.isInitialized === true));
  check('игра работает через адаптер playgama', (await state(page)).platform === 'playgama');
  const gets = sdk.filter((c) => /\[storage\] get\(\)$/.test(c.text));
  check('хранилище читается одним вызовом с обоими ключами', gets.length === 1 && JSON.stringify(gets[0].vals[0]) === JSON.stringify(['profile', 'run']), JSON.stringify(gets.map((g) => g.vals[0])));
  check('game_ready отправлен ровно один раз', messages('game_ready').length === 1, `отправлено ${messages('game_ready').length}`);
  check('до нажатия «начать» level_started не уходит', messages('level_started').length === 0);
  await page.click('.vz-overlay');
  await sleep(600);
  await queue;
  check('level_started отправлен при старте', messages('level_started').length === 1 && !!messages('level_started')[0].vals[1]?.level, JSON.stringify(messages('level_started').map((m) => m.vals[1])));
  const firstGet = sdk.findIndex((c) => /\[storage\] get\(\)$/.test(c.text));
  const sets = sdk.slice(firstGet + 1).filter((c) => /\[storage\] set\(\)$/.test(c.text));
  check('запись хранилища пакетная: profile и run одним вызовом, и только по событию', sets.length >= 1 && sets.length <= 2 && sets.every((c) => JSON.stringify(c.vals[0]) === JSON.stringify(['profile', 'run'])), `записей ${sets.length}: ${JSON.stringify(sets.map((c) => c.vals[0]))}`);
  check('localStorage напрямую не используется (ключи vylazka:*)', !(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('vylazka:')))));
  // Пауза приходит из SDK при уходе вкладки в фон.
  const hide = (hidden) =>
    page.evaluate((h) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await hide(true);
  await sleep(400);
  let st = await state(page);
  check('уход вкладки в фон ставит игру на паузу', st.paused === true && st.overlay === 'paused', JSON.stringify(st.pauseReasons));
  await hide(false);
  await sleep(400);
  st = await state(page);
  check('после возврата игра ждёт нажатия (мышь без жеста не захватить)', st.paused === true && !st.pauseReasons.includes('platform') && !st.pauseReasons.includes('hidden'), JSON.stringify(st.pauseReasons));
  await page.click('.vz-overlay');
  await sleep(300);
  check('нажатие возвращает в игру', (await state(page)).paused === false);
  await sleep(300);
  await queue;
  check('game_ready так и остался один', messages('game_ready').length === 1);
  check('нет ошибок в консоли', log.errors.length === 0, log.errors.join(' | ').slice(0, 300));
  check('нет внешних запросов', log.external.length === 0, log.external.join(', ').slice(0, 300));
  await context.close();
}

/** Короткий тихий WAV: тестовая замена любому звуковому файлу (настоящие клипы смоуку не нужны). */
function tinyWav(seconds = 0.25, rate = 8000) {
  const n = Math.floor(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i * 0.35) * 900), 44 + i * 2);
  return buf;
}

async function scenarioAudio(browser, baseUrl) {
  section('Звук: разблокировка жестом, загрузка набора, события и петли, пауза, выключатель');
  const wav = tinyWav();
  const asked = [];
  const prepare = (context) =>
    context.route('**/snd/*.mp3', (route) => {
      asked.push(new URL(route.request().url()).pathname.split('/').pop());
      return route.fulfill({ status: 200, contentType: 'audio/wav', body: wav });
    });
  const { page, context, log } = await openPage(browser, baseUrl, '?q=low&fail=0&lang=ru&touch=0&seed=20041113&audio=snd', {}, null, prepare);
  const aim0 = (await state(page)).aim;
  // Набор грузится в фоне сразу после первого кадра, но звучать до нажатия браузер не даст.
  await page.waitForFunction(() => window.__vz.audio().loaded === window.__vz.audio().total, null, { timeout: 30000 }).catch(() => undefined);
  let au = await vz(page, () => window.__vz.audio());
  check('до первого нажатия звук заперт, а набор уже загружен целиком', au.state === 'locked' && au.known === au.total && au.total >= 50 && au.loaded === au.total && au.missing === 0, JSON.stringify({ state: au.state, known: au.known, total: au.total, loaded: au.loaded, missing: au.missing }));
  check('каждый файл запрошен один раз, первыми — нужные в начале вылазки', asked.length === au.total && new Set(asked).size === au.total && asked.slice(0, 3).join() === 'ui_click_1.mp3,ui_start_1.mp3,hatch_1.mp3', `${asked.length} запросов, первые: ${asked.slice(0, 3).join(', ')}`);
  check('на карточке задания есть кнопка звука', (await page.textContent('.vz-overlay__opt--sound'))?.trim() === 'Звук: вкл');

  await page.click('.vz-overlay');
  await sleep(300);
  au = await vz(page, () => window.__vz.audio());
  check('нажатие «начать» будит звук: старт записи и люк звучат сразу', au.state === 'running' && (au.played.ui_start ?? 0) === 1 && (au.played.hatch ?? 0) === 1, JSON.stringify({ state: au.state, start: au.played.ui_start, hatch: au.played.hatch }));
  await vz(page, () => window.__vz.calm(true));
  await sleep(400);
  au = await vz(page, () => window.__vz.audio());
  check('в вылазке идут гул убежища и дыхание, музыки нет', au.loops.includes('amb_bunker') && au.loops.includes('breath_calm') && !au.loops.includes('music_menu'), au.loops.join(', '));

  // Взгляд не должен поворачиваться сам: мышь после старта никто не трогал. (Сразу после захвата
  // мыши браузер может прислать ложное «движение» — игра обязана его пропустить.)
  await vz(page, () => window.__vz.freeze(true));
  const before = await state(page);
  const locked = await page.evaluate(() => document.pointerLockElement !== null);
  check('взгляд после старта не дёрнулся сам по себе', Math.abs(before.aim[0] - aim0[0]) < 0.02 && Math.abs(before.aim[1] - aim0[1]) < 0.02, `был ${aim0.map((v) => v.toFixed(3)).join(', ')}, стал ${before.aim.map((v) => v.toFixed(3)).join(', ')}; мышь захвачена: ${locked}`);

  // Шаги: идём отсчитанными шагами симуляции с явным вводом (частота кадров в тестовом браузере
  // непредсказуема, клавиатуру проверяет другой сценарий) и строго вперёд от люка — взгляд выставлен
  // заново. После каждой порции дожидаемся двух настоящих кадров: шаг озвучивается в кадре.
  await vz(page, ([p, a]) => window.__vz.teleport(p[0], p[1], p[2], a[0], a[1]), [before.pos, aim0]);
  let walked = before;
  for (let i = 0; i < 8; i++) {
    walked = await vz(page, () => window.__vz.step(24, { moveZ: 1 }));
    await vz(page, () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))));
  }
  au = await vz(page, () => window.__vz.audio());
  check(
    'шаги по бетону звучат на ходу',
    (au.played.step_concrete ?? 0) >= 2,
    `сыграно ${au.played.step_concrete ?? 0}, просили ${au.asked.step_concrete ?? 0}, пройдено ${Math.hypot(walked.pos[0] - before.pos[0], walked.pos[2] - before.pos[2]).toFixed(2)} м от ${before.pos.map((v) => v.toFixed(2)).join(', ')} до ${walked.pos.map((v) => v.toFixed(2)).join(', ')}, звук ${au.state}, пауза: ${JSON.stringify(walked.pauseReasons)}`,
  );

  // Фонарь: щелчок выключателя, отказ, дребезг при тряске, оживление.
  await vz(page, () => window.__vz.freeze(true));
  const clicks = au.played.flash_click ?? 0;
  await vz(page, () => window.__vz.step(2, { light: true }));
  await vz(page, () => window.__vz.step(2, { light: true }));
  au = await vz(page, () => window.__vz.audio());
  check('выключатель фонаря щёлкает', (au.played.flash_click ?? 0) >= clicks + 2, `${clicks} → ${au.played.flash_click ?? 0}`);
  await vz(page, () => window.__vz.fail());
  await vz(page, () => window.__vz.step(2));
  let st = await state(page);
  // Настоящая тряска мышью: звук дребезга идёт от рывков, которые видит детектор.
  await page.mouse.move(640, 360);
  await page.mouse.down();
  for (let i = 0; i < 44 && st.light.state === 'dead'; i++) {
    await page.mouse.move(640 + (i % 2 === 0 ? 90 : -90), 360, { steps: 3 });
    st = await vz(page, () => window.__vz.tick(5));
    await sleep(140);
  }
  await page.mouse.up();
  au = await vz(page, () => window.__vz.audio());
  check('фонарь глохнет со звуком, при тряске гремят батарейки, потом щелчок', st.light.state === 'on' && (au.played.flash_die ?? 0) === 1 && (au.played.flash_rattle ?? 0) >= 2 && (au.played.flash_click ?? 0) >= clicks + 3, JSON.stringify({ die: au.played.flash_die, rattle: au.played.flash_rattle, click: au.played.flash_click, light: st.light.state }));

  // Находка и газ.
  await vz(page, () => window.__vz.gotoItem(0));
  await vz(page, () => window.__vz.step(3, { actionPressed: true, action: true }));
  au = await vz(page, () => window.__vz.audio());
  check('находка убрана в сумку со звуком', (au.played.pickup ?? 0) >= 1);

  // Пауза и возврат.
  await vz(page, () => window.__vz.freeze(false));
  await vz(page, () => window.__vz.pause(true));
  await sleep(250);
  au = await vz(page, () => window.__vz.audio());
  check('на паузе звук остановлен целиком', au.state === 'suspended', au.state);
  check('на экране паузы тоже есть кнопка звука', (await page.isVisible('.vz-overlay__opt--sound')) === true);
  await page.click('.vz-overlay__opt--sound');
  au = await vz(page, () => window.__vz.audio());
  st = await state(page);
  check('кнопка звука выключает звук и не снимает паузу', au.muted === true && st.paused === true && (await page.textContent('.vz-overlay__opt--sound'))?.trim() === 'Звук: выкл');
  await page.click('.vz-overlay');
  await sleep(300);
  au = await vz(page, () => window.__vz.audio());
  check('после паузы звук снова идёт (но выключен игроком)', au.state === 'running' && au.muted === true, au.state);
  await page.keyboard.press('KeyM');
  au = await vz(page, () => window.__vz.audio());
  check('клавиша M включает звук обратно', au.muted === false);
  await page.keyboard.press('KeyM');
  await sleep(200);

  // Выбор запоминается.
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__vz?.ready() === true, null, { timeout: 90000 });
  au = await vz(page, () => window.__vz.audio());
  check('после перезагрузки звук остаётся выключенным', au.muted === true && (await page.textContent('.vz-overlay__opt--sound'))?.trim() === 'Звук: выкл');
  await page.click('.vz-overlay__opt--sound');
  await sleep(600);
  au = await vz(page, () => window.__vz.audio());
  st = await state(page);
  check('на карточке задания играет музыка меню, вылазка не началась', st.overlay === 'start' && au.muted === false && au.state === 'running' && au.loops.includes('music_menu'), JSON.stringify({ overlay: st.overlay, state: au.state, loops: au.loops }));

  // Конец вылазки: отчёт и музыка.
  await page.click('.vz-overlay');
  await sleep(300);
  await vz(page, () => window.__vz.freeze(true));
  await vz(page, () => window.__vz.calm(true));
  // Выход предлагается только тому, кто уже отходил от люка.
  await vz(page, () => window.__vz.gotoGoal(0));
  await vz(page, () => window.__vz.step(10));
  await vz(page, () => window.__vz.gotoExit());
  st = await vz(page, () => window.__vz.step(10));
  for (let i = 0; i < 40 && !st.sortie.outcome; i++) st = await vz(page, (first) => window.__vz.step(10, { action: true, actionPressed: first }), i === 0);
  st = await vz(page, () => window.__vz.step(130));
  await vz(page, () => window.__vz.freeze(false));
  await sleep(500);
  au = await vz(page, () => window.__vz.audio());
  check('выход наверх: звук лестницы, отчёт, петли вылазки оборваны, играет музыка', st.overlay === 'report' && (au.played.ladder ?? 0) === 1 && (au.played.ui_report ?? 0) === 1 && au.loops.join() === 'music_menu', JSON.stringify({ overlay: st.overlay, outcome: st.sortie.outcome, ladder: au.played.ladder, report: au.played.ui_report, loops: au.loops }));

  check('нет ненайденных ключей локализации', (await vz(page, () => window.__vz.missingKeys())).length === 0);
  check('нет ошибок в консоли', log.errors.length === 0, log.errors.join(' | ').slice(0, 400));
  check('нет неудачных запросов', log.failed.length === 0, log.failed.join(' | ').slice(0, 300));
  await context.close();

  // Сборка без звуковых файлов: игра молчит и ничего не запрашивает.
  const bare = await openPage(browser, baseUrl, '?q=low&fail=0&lang=ru&touch=0&seed=20041113');
  await bare.page.click('.vz-overlay');
  await sleep(500);
  au = await vz(bare.page, () => window.__vz.audio());
  const real = au.known > 0;
  check(real ? 'в сборке лежит полный набор звуков' : 'без файлов игра молчит и не запрашивает несуществующее', real ? au.known === au.total : au.loaded === 0 && au.missing === 0 && bare.log.failed.length === 0, JSON.stringify({ known: au.known, loaded: au.loaded, failed: bare.log.failed.length }));
  check('нет ошибок в консоли', bare.log.errors.length === 0, bare.log.errors.join(' | ').slice(0, 300));
  await bare.context.close();
}

/**
 * Игра внутри iframe с песочницей без allow-pointer-lock и без allow-same-origin: так её может встроить
 * портал или просмотрщик файлов. Мышь не захватывается, хранилище недоступно — игра обязана идти.
 */
async function scenarioFrame(browser, baseUrl) {
  section('Песочница iframe: без захвата мыши и без хранилища');
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const src = new URL('?q=low&fail=0&lang=ru&touch=0&level=test', baseUrl).toString();
  await page.setContent(`<!doctype html><style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100%;height:100%}</style><iframe sandbox="allow-scripts" src="${src}"></iframe>`);
  const frame = page.frames().find((f) => f !== page.mainFrame());
  let ready = true;
  await frame.waitForFunction(() => window.__vz?.ready() === true, null, { timeout: 90000 }).catch(() => {
    ready = false;
  });
  check('игра загрузилась в песочнице', ready, errors.join(' | ').slice(0, 300));
  if (!ready) {
    await context.close();
    return;
  }
  const fstate = () => frame.evaluate(() => window.__vz.state());
  await frame.click('.vz-overlay');
  await sleep(400);
  await frame.evaluate(() => window.__vz.freeze(true));
  let st = await frame.evaluate(() => window.__vz.step(1));
  const locked = await frame.evaluate(() => document.pointerLockElement !== null);
  check('мышь не захвачена, но игра идёт без паузы', st.paused === false && st.overlay === 'hidden' && locked === false && st.drag === true, JSON.stringify({ paused: st.paused, overlay: st.overlay, locked, drag: st.drag, reasons: st.pauseReasons }));
  const hint = await frame.textContent('.vz-hud__hint');
  check('подсказка говорит про зажатую кнопку мыши', hint?.includes('зажатой') === true, hint ?? '');

  // Луч: только с зажатой кнопкой.
  const aim0 = st.aim[0];
  await page.mouse.move(640, 360);
  await page.mouse.down();
  await page.mouse.move(760, 360, { steps: 6 });
  await page.mouse.up();
  st = await frame.evaluate(() => window.__vz.tick(2));
  const turned = st.aim[0] - aim0;
  check('с зажатой кнопкой мышь ведёт луч', Math.abs(turned + 0.252) < 0.03, `поворот ${turned.toFixed(3)} рад при движении на 120 px`);
  await page.mouse.move(520, 360, { steps: 6 });
  st = await frame.evaluate(() => window.__vz.tick(2));
  check('без кнопки луч стоит', Math.abs(st.aim[0] - aim0 - turned) < 0.005, `ушёл на ${(st.aim[0] - aim0 - turned).toFixed(3)} рад`);

  // Тряска: подсказка «трясите мышью» работает и без зажатой кнопки.
  await frame.evaluate(() => window.__vz.fail());
  await frame.evaluate(() => window.__vz.step(10));
  for (let i = 0; i < 44; i++) {
    await page.mouse.move(640 + (i % 2 === 0 ? 90 : -90), 360, { steps: 3 });
    await frame.evaluate(() => window.__vz.tick(5));
    if ((await fstate()).light.state === 'on') break;
  }
  st = await fstate();
  check('тряска мышью оживляет фонарь и без зажатой кнопки', st.light.state === 'on', `состояние ${st.light.state}, прогресс ${st.light.revive.toFixed(2)}`);

  // Браузер сам пишет в консоль, что захват мыши в песочнице запрещён, — это не ошибка игры.
  const own = errors.filter((e) => !/Blocked pointer lock/i.test(e));
  check('игра не сыплет ошибками без хранилища и захвата мыши', own.length === 0, own.join(' | ').slice(0, 400));
  await context.close();
}

// ───────────────────────────── запуск ─────────────────────────────

const server = await startServer();
const browser = await launchBrowser();
// «HeadlessChrome/…» — chromium-headless-shell, «Chrome/…» — полный Chromium: по логу видно, кто гонял тест.
const product = await browser.newBrowserCDPSession().then((cdp) => cdp.send('Browser.getVersion')).then((v) => v.product).catch(() => browser.version());
console.log(`Смоук: ${remoteUrl ?? distDir} → ${server.url}; браузер ${product}`);
try {
  if (wants('play')) await scenarioPlay(browser, server.url);
  if (wants('gen')) await scenarioGen(browser, server.url);
  if (wants('sortie')) await scenarioSortie(browser, server.url);
  if (wants('fear')) await scenarioFear(browser, server.url);
  if (wants('audio')) await scenarioAudio(browser, server.url);
  if (wants('frame')) await scenarioFrame(browser, server.url);
  if (wants('touch')) await scenarioTouch(browser, server.url);
  if (wants('touch')) await scenarioTouchSortie(browser, server.url);
  if (wants('bridge')) await scenarioBridge(browser, server.url);
  if (wantMatrix && wants('matrix')) await scenarioMatrix(browser, server.url);
} catch (e) {
  failures.push(`исключение: ${e.message}`);
  console.error(e);
} finally {
  await browser.close();
  await server.close();
}
console.log(`\nИтог: прошло ${passed}, провалено ${failures.length}`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  — ${f}`);
  process.exit(1);
}
