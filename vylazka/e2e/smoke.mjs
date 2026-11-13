#!/usr/bin/env node
/**
 * Смоук-тест собранной игры в настоящем браузере (Chromium, программный WebGL).
 *
 *   npm run build && npm run smoke                                   # dist/
 *   npm run build:playgama && npm run smoke -- --dist dist-playgama  # с настоящим Bridge SDK
 *   npm run smoke:matrix                                             # + раскладка по матрице размеров, скриншоты в e2e/out/
 *   npm run smoke -- --url https://…                                 # опубликованная ссылка
 *
 * Параметры: --dist <dir> | --url <url>, --matrix, --langs ru,en, --no-shots, --only play,touch,bridge,matrix.
 * Симуляция в тестах заморожена и шагается через window.__vz: проверяется логика и вёрстка, а не
 * частота кадров (SwiftShader даёт 5–10 к/с). Качество задаётся параметром адреса, иначе по строке
 * видеокарты выбралось бы «низкое» и тень осталась бы непроверенной.
 * Браузер: CHROMIUM_PATH (или /opt/pw-browsers/chromium, или `npx playwright-core install chromium`).
 * Выход: 0 — всё прошло, 1 — есть провалы, 2 — не запустился браузер.
 */
import { existsSync, mkdirSync } from 'node:fs';
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
    failures.push(name);
    console.log(`  FAIL ${name}${details ? ` — ${details}` : ''}`);
  }
}
const section = (title) => console.log(`\n# ${title}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = Math.PI / 180;

async function startServer() {
  if (remoteUrl) return { url: remoteUrl, close: async () => undefined };
  const server = await preview({ configFile: false, root: ROOT, base: './', logLevel: 'error', build: { outDir: distDir }, preview: { host: '127.0.0.1', port: 4185, strictPort: false, open: false } });
  const url = server.resolvedUrls?.local?.[0];
  if (!url) throw new Error('vite preview не вернул адрес');
  return { url, close: () => server.close() };
}

async function launchBrowser() {
  const executablePath = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const extra = (process.env.CHROMIUM_ARGS ?? '').split(/\s+/).filter(Boolean);
  try {
    return await chromium.launch({ executablePath, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio', ...extra] });
  } catch (e) {
    console.error(`Не удалось запустить Chromium: ${e.message}\nУкажите CHROMIUM_PATH или выполните: npx playwright-core install chromium`);
    process.exit(2);
  }
}

/** Страница с журналом ошибок, неудачных и внешних запросов. */
async function openPage(browser, baseUrl, query, ctxOpts = {}, onConsole = null) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US', ...ctxOpts });
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
  const { page, context, log } = await openPage(browser, baseUrl, '?q=high&fail=0&lang=ru&touch=0');
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
  check('в центре луча светло, по краям кадра темно', center(lit) > 60 && mean(lit) < center(lit) * 0.6, `центр ${center(lit).toFixed(1)}, среднее ${mean(lit).toFixed(1)}`);
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
  await vz(page, () => window.__vz.freeze(true));

  // Качество и язык.
  await vz(page, () => window.__vz.quality('low'));
  const low = await vz(page, () => window.__vz.info());
  check('низкое качество: буфер 640×360', low.width === 640 && low.height === 360, `${low.width}×${low.height}`);
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
  check('после восстановления контекста картинка вернулась', center(after) > 60, `центр ${center(after).toFixed(1)}`);

  check('нет ошибок в консоли', log.errors.length === 0, log.errors.join(' | ').slice(0, 400));
  const warns = log.warnings.filter((w) => !benign(w));
  check('нет предупреждений в консоли', warns.length === 0, warns.join(' | ').slice(0, 400));
  check('нет внешних запросов', log.external.length === 0, log.external.join(', ').slice(0, 300));
  check('нет неудачных запросов', log.failed.length === 0, log.failed.join(', ').slice(0, 300));
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
    const { page, context, log } = await openPage(browser, baseUrl, '?q=med&fail=0&lang=ru', { viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    let st = await state(page);
    check(`${name}: схема управления — тач`, st.touch === true);
    check(`${name}: стартовый экран зовёт коснуться`, (await page.textContent('.vz-overlay__prompt'))?.includes('Коснитесь') === true);
    await page.tap('.vz-overlay');
    await sleep(300);
    st = await state(page);
    check(`${name}: касание запускает игру`, st.paused === false);
    await vz(page, () => window.__vz.freeze(true));
    check(`${name}: кнопки фонаря и паузы видны и достаточно велики`, await page.evaluate(() => [...document.querySelectorAll('.vz-touch__btn')].every((b) => b.getBoundingClientRect().width >= 44 && b.getBoundingClientRect().height >= 44)));

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
      const { page, context, log } = await openPage(browser, baseUrl, `?lang=${lang}&pseudo=1&q=low&fail=0`, { viewport: { width, height }, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile, locale: lang });
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
  const { page, context, log } = await openPage(browser, baseUrl, '?debug=1&q=low&fail=0', {}, onConsole);
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
  check('game_ready отправлен ровно один раз', messages('game_ready').length === 1, `отправлено ${messages('game_ready').length}`);
  check('до нажатия «начать» level_started не уходит', messages('level_started').length === 0);
  await page.click('.vz-overlay');
  await sleep(600);
  await queue;
  check('level_started отправлен при старте', messages('level_started').length === 1 && !!messages('level_started')[0].vals[1]?.level, JSON.stringify(messages('level_started').map((m) => m.vals[1])));
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

// ───────────────────────────── запуск ─────────────────────────────

const server = await startServer();
const browser = await launchBrowser();
console.log(`Смоук: ${remoteUrl ?? distDir} → ${server.url}`);
try {
  if (wants('play')) await scenarioPlay(browser, server.url);
  if (wants('touch')) await scenarioTouch(browser, server.url);
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
