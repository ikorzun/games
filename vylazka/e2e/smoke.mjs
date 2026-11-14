#!/usr/bin/env node
/**
 * Смоук-тест собранной игры в настоящем браузере (Chromium, программный WebGL).
 *
 *   npm run build && npm run smoke                                   # dist/
 *   npm run build:playgama && npm run smoke -- --dist dist-playgama  # с настоящим Bridge SDK
 *   npm run smoke:matrix                                             # + раскладка по матрице размеров, скриншоты в e2e/out/
 *   npm run smoke -- --url https://…                                 # опубликованная ссылка
 *
 * Параметры: --dist <dir> | --url <url>, --matrix, --langs ru,en, --no-shots, --shell, --only play,gen,session,fear,audio,frame,touch,bridge,matrix.
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
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
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
/** Словари интерфейса: ожидаемые тексты берём из locales/, а не пишем в проверки второй раз. */
const RU = JSON.parse(readFileSync(join(ROOT, 'locales', 'ru', 'ui.json'), 'utf8'));
const EN = JSON.parse(readFileSync(join(ROOT, 'locales', 'en', 'ui.json'), 'utf8'));

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

/**
 * Заглушка захвата мыши: игра считает мышь захваченной, а браузер её не захватывает.
 *
 * Зачем. В chromium-headless-shell (браузер CI) настоящий захват запускает в самом браузере петлю
 * синтетических «движений» мыши — десятки тысяч событий в секунду, пока захват держится. Лёгкая
 * страница успевает их разбирать, а на полном уровне они копятся: за секунды браузер и страница
 * набирают гигабайты памяти, кадры почти перестают идти, и на длинном сценарии страница падает
 * («Target crashed»). В полном Chromium и в настоящих браузерах такого нет.
 *
 * Поэтому настоящий захват оставлен только там, где проверяется сама мышь (realLock в openPage);
 * остальные сценарии ведут игру через window.__vz, и им хватает заглушки.
 */
const FAKE_LOCK = () => {
  let locked = null;
  const changed = () => Promise.resolve().then(() => document.dispatchEvent(new Event('pointerlockchange')));
  Object.defineProperty(Document.prototype, 'pointerLockElement', { configurable: true, get: () => locked });
  Element.prototype.requestPointerLock = function fakeLock() {
    locked = this;
    changed();
    return Promise.resolve();
  };
  Document.prototype.exitPointerLock = function fakeUnlock() {
    if (locked === null) return;
    locked = null;
    changed();
  };
};

/** Страница с журналом ошибок, неудачных и внешних запросов. realLock — настоящий захват мыши (см. FAKE_LOCK). */
async function openPage(browser, baseUrl, query, ctxOpts = {}, onConsole = null, prepare = null, realLock = false) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US', ...ctxOpts });
  if (!realLock) await context.addInitScript(FAKE_LOCK);
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

  // Заставка: по умолчанию английская (игра не следует языку площадки), с ?lang=ru — русская;
  // предупреждение о вспышках и настройки на месте, выбор запоминается.
  {
    const t = await openPage(browser, baseUrl, '?q=low&fail=0&touch=0&level=test', { locale: 'ru-RU' });
    const tp = t.page;
    const opt = (name) => tp.textContent(`.vz-overlay__opt--${name}`).then((x) => x?.trim());
    check('без ?lang заставка английская, даже если язык браузера русский', (await tp.textContent('.vz-overlay__title')) === 'UNTITLED SESSION' && (await tp.textContent('.vz-overlay__prompt')) === 'Click to begin' && (await tp.evaluate(() => document.documentElement.lang)) === 'en');
    const lines = await tp.$$eval('.vz-overlay__line', (els) => els.map((e) => e.textContent));
    check('на заставке есть как играть и предупреждение о вспышках', lines.includes(EN['title.how']) && lines.includes(EN['title.warn']) && /flashing/i.test(EN['title.warn']), JSON.stringify(lines));
    check('на заставке видны кнопки «Вспышки» и «Язык» (и звук, качество)', (await Promise.all(['flash', 'lang', 'sound', 'quality'].map((n) => tp.isVisible(`.vz-overlay__opt--${n}`)))).every(Boolean) && (await opt('flash')) === 'Flashing: full' && (await opt('lang')) === 'Language: English');
    await tp.click('.vz-overlay__opt--flash');
    await tp.click('.vz-overlay__opt--lang');
    await sleep(200);
    const s0 = await state(tp);
    check('нажатие на настройки не начинает игру; подписи сменились (вспышки мягкие, язык русский)', s0.screen === 'title' && s0.overlay === 'start' && (await opt('flash')) === 'Вспышки: мягкие' && (await opt('lang')) === 'Язык: Русский' && (await tp.textContent('.vz-overlay__prompt')) === 'Нажмите, чтобы начать' && (await tp.evaluate(() => document.documentElement.lang)) === 'ru', JSON.stringify({ screen: s0.screen, flash: await opt('flash'), lang: await opt('lang') }));
    await sleep(300);
    await tp.reload({ waitUntil: 'load' });
    await tp.waitForFunction(() => window.__vz?.ready() === true, null, { timeout: 90000 });
    check('после перезагрузки выбор запомнен: вспышки мягкие, язык русский', (await opt('flash')) === 'Вспышки: мягкие' && (await opt('lang')) === 'Язык: Русский' && (await tp.evaluate(() => document.documentElement.lang)) === 'ru');
    await tp.click('.vz-overlay__opt--lang');
    await tp.click('.vz-overlay__opt--flash');
    await sleep(200);
    check('кнопки работают в обе стороны: снова английский и полные вспышки', (await opt('lang')) === 'Language: English' && (await opt('flash')) === 'Flashing: full');
    check('заставка: нет ошибок в консоли', t.log.errors.length === 0, t.log.errors.join(' | ').slice(0, 300));
    await t.context.close();
  }

  // Здесь проверяется сама мышь (тряска, потеря и возврат захвата), поэтому захват настоящий.
  const { page, context, log } = await openPage(browser, baseUrl, '?q=high&fail=0&lang=ru&touch=0&level=test', {}, null, null, true);
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
  // Порог центра — с запасом: мир собран из точек, и даже в середине луча остаются редкие дыры
  // (сплошная картинка давала здесь 49,6, облако точек — 48,1).
  check('в центре луча светло, по краям кадра темно', center(lit) > 40 && mean(lit) < center(lit) * 0.6, `центр ${center(lit).toFixed(1)}, среднее ${mean(lit).toFixed(1)}`);
  check('тень фонаря затемняет часть кадра', maxDiff > 8, `наибольшая разница ${maxDiff.toFixed(1)}`);
  const info = await vz(page, () => window.__vz.info());
  check('мир рисуется малым числом вызовов', info.calls <= 8 && info.triangles > 5000, `${info.calls} вызовов, ${info.triangles} треугольников`);
  check('внутренний буфер 1280×720 на высоком качестве', info.width === 1280 && info.height === 720, `${info.width}×${info.height}`);

  // Облако точек: мир собран из точек, как 3D-скан. В середине луча они стоят почти вплотную — там кадр
  // так же ярок, как у сплошной картинки; вокруг луча остаётся россыпь, и кадр в целом темнее.
  const dots = await vz(page, () => window.__vz.probeColor());
  await vz(page, () => window.__vz.scan(false));
  const solidGrid = await vz(page, () => window.__vz.probe());
  const solid = await vz(page, () => window.__vz.probeColor());
  await vz(page, () => window.__vz.scan(true));
  const dotsAgain = await vz(page, () => window.__vz.probe());
  check(
    'мир собран из точек: середина луча почти сплошная, вокруг — россыпь',
    Math.abs(center(lit) - center(solidGrid)) < center(solidGrid) * 0.2 && mean(lit) < mean(solidGrid) * 0.9 && dots.dark > solid.dark + 0.015,
    `центр ${center(lit).toFixed(1)} против ${center(solidGrid).toFixed(1)} у сплошной картинки, среднее ${mean(lit).toFixed(1)} против ${mean(solidGrid).toFixed(1)}, тёмных точек кадра ${dots.dark.toFixed(3)} против ${solid.dark.toFixed(3)}`,
  );
  check('облако точек выключается и включается обратно: кадр тот же', Math.abs(mean(dotsAgain) - mean(lit)) < 1.5 && Math.abs(center(dotsAgain) - center(lit)) < 3, `среднее ${mean(lit).toFixed(1)} → ${mean(dotsAgain).toFixed(1)}, центр ${center(lit).toFixed(1)} → ${center(dotsAgain).toFixed(1)}`);

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
  // Контекст возвращается через четверть секунды, но пересборка шейдеров на программном рендере идёт
  // от долей секунды до нескольких: ждём самого события (пауза игрока осталась, причины «context»
  // уже нет), а не срок — на медленной машине фиксированной секунды не хватало.
  await page
    .waitForFunction(
      () => {
        const r = window.__vz.state().pauseReasons;
        return r.includes('user') && !r.includes('context');
      },
      null,
      { timeout: 30000 },
    )
    .catch(() => undefined);
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

/** Ждать, пока звук придёт в нужное состояние (петли затихают и обрываются по часам звука, не сразу). */
async function audioUntil(page, cond, ms = 6000) {
  let au = await vz(page, () => window.__vz.audio());
  for (let t = 0; t < ms && !cond(au); t += 200) {
    await sleep(200);
    au = await vz(page, () => window.__vz.audio());
  }
  return au;
}

/** Шагать по n шагов, пока не выполнится условие (но не больше max раз). */
async function stepUntil(page, cond, n = 20, max = 60) {
  let st = await state(page);
  for (let i = 0; i < max && !cond(st); i++) st = await vz(page, (k) => window.__vz.step(k), n);
  return st;
}

/** Мелкие вещи сна (их можно рассматривать, не упираясь в мебель). */
const SMALL_THINGS = ['mug', 'slippers', 'ball', 'teddy', 'alarm_clock', 'remote', 'photo_frame', 'night_light', 'school_bag', 'goldfish_bowl', 'keys', 'phone'];
/** Средняя яркость кадра по сетке 32×18. */
const frameMean = (grid) => mean(grid);

async function scenarioFear(browser, baseUrl) {
  section('Рой и аномалии: охота, развал лучом, поимка не конец сессии; помещения: строб, темнота, сетка, тонкое место');
  const { page, context, log } = await openPage(browser, baseUrl, '?q=low&fail=0&lang=ru&touch=0&rank=3&seed=20041113');
  await page.click('.vz-overlay');
  await sleep(300);
  await vz(page, () => window.__vz.freeze(true));
  let st = await vz(page, () => window.__vz.step(5));
  check('в начале сессии рой спит, режиссёр в первой фазе', st.swarm.mode === 'dormant' && st.director.phase === 0 && st.swarm.near === 0);
  const spawn = [...st.pos];

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
  // Ушёл далеко — на вход, на первый ярус: комнату уже не видно.
  await vz(page, ([p]) => window.__vz.teleport(p[0], p[1], p[2]), [spawn]);
  st = await vz(page, () => window.__vz.step(5));
  check('побывал, ушёл далеко — комната изменилась', st.anomalies.alt.includes(variant.room), JSON.stringify(st.anomalies.alt));

  // ── Рой ──
  await vz(page, () => window.__vz.phase(0));
  // Идёт поиск вещи: рой, который поймает игрока, заставит её «забыться».
  await vz(page, () => window.__vz.reveal());
  st = await vz(page, () => window.__vz.step(5));
  const mem0 = await vz(page, () => window.__vz.memory());
  check('идёт поиск воспоминания: вещь появилась и её видно в списке', mem0 !== null && st.session.memories.filter((m) => m.state === 'active').length === 1, JSON.stringify(mem0));
  const ok = await vz(page, () => window.__vz.swarm('release', 5));
  st = await state(page);
  check('рой выпущен в пяти клетках и знает, где игрок', ok && (st.swarm.mode === 'stalk' || st.swarm.mode === 'cohere') && st.swarm.awareness > 0.5, st.swarm.mode);
  for (let i = 0; i < 60 && st.swarm.mode !== 'hunt'; i++) st = await vz(page, () => window.__vz.step(20));
  check('рой подошёл на свет и собрался в фигуру', st.swarm.mode === 'hunt' && st.swarm.cohesion === 1 && st.swarm.near > 0.15, `${st.swarm.mode}, сцепление ${st.swarm.cohesion.toFixed(2)}, близость ${st.swarm.near.toFixed(2)}`);
  check('подсказка про луч показана один раз', (await page.textContent('.vz-hud__toast'))?.includes('луч') === true);
  for (let i = 0; i < 80 && st.swarm.mode === 'hunt' && st.jump?.cause !== 'caught'; i++) st = await aimAndStep(6);
  check('прямой луч развалил рой, игрок цел', st.swarm.mode === 'scatter' && st.swarm.aggravation === 1 && st.jump?.cause !== 'caught', `${st.swarm.mode}, скачок ${JSON.stringify(st.jump)}`);
  for (let i = 0; i < 90 && st.swarm.mode !== 'hunt' && st.jump?.cause !== 'caught'; i++) st = await vz(page, () => window.__vz.step(20));
  check('рой вернулся и снова охотится', st.swarm.mode === 'hunt' && st.jump?.cause !== 'caught', st.swarm.mode);
  // Гасим фонарь: в темноте рой, который уже знает, где игрок, добирается быстро. Поимка — не конец.
  await vz(page, () => window.__vz.toggleLight());
  const before = await state(page);
  const spotBefore = before.session.memories.find((m) => m.state === 'active').spot;
  const nodeBefore = before.node;
  const timeBefore = before.time;
  const others = [];
  st = before;
  for (let i = 0; i < 400 && st.jump?.cause !== 'caught'; i++) {
    st = await vz(page, () => window.__vz.step(5));
    if (st.jump && st.jump.cause !== 'caught' && !others.includes(st.jump.cause)) others.push(st.jump.cause);
  }
  check('с погашенным фонарём рой ловит игрока: скачок «caught» затемнением в другое место убежища', st.jump?.cause === 'caught' && st.jump.style === 'blackout' && st.jump.to === 'elsewhere', `скачок ${JSON.stringify(st.jump)}, другие: ${others.join(',')}, рой ${st.swarm.mode}`);
  st = await stepUntil(page, (s) => s.jump === null, 10, 30);
  const mem1 = await vz(page, () => window.__vz.memory());
  const active1 = st.session.memories.find((m) => m.state === 'active');
  check('поимка — не конец: убежище, запись идёт, отчёта и гибели нет', st.where === 'main' && st.screen === 'play' && st.overlay === 'hidden' && st.session.over === false && st.time > timeBefore && !!active1, JSON.stringify({ where: st.where, screen: st.screen, overlay: st.overlay, over: st.session.over }));
  check('игрока унесло в другое место убежища', st.node >= 0 && st.node !== nodeBefore, `узел ${nodeBefore} → ${st.node}`);
  check('искомая вещь «забыта»: сессия назначила ей другое место, на экране — «где же это было»', !!active1 && !!spotBefore && Math.hypot(active1.spot[0] - spotBefore[0], active1.spot[2] - spotBefore[2]) > 0.5 && (await page.textContent('.vz-hud__toast')) === RU['toast.forgot'], `${JSON.stringify(spotBefore)} → ${JSON.stringify(active1?.spot)}`);
  check('и сама вещь в мире переехала на новое место', !!mem1 && !!active1 && Math.hypot(mem1.pos[0] - active1.spot[0], mem1.pos[1] - active1.spot[1], mem1.pos[2] - active1.spot[2]) < 0.05 && Math.hypot(mem1.pos[0] - mem0.pos[0], mem1.pos[2] - mem0.pos[2]) > 0.5, `вещь ${JSON.stringify(mem1?.pos)}, место ${JSON.stringify(active1?.spot)}, было ${JSON.stringify(mem0.pos)}`);
  check('нет ненайденных ключей локализации', (await vz(page, () => window.__vz.missingKeys())).length === 0);
  check('нет ошибок в консоли', log.errors.length === 0, log.errors.join(' | ').slice(0, 400));
  await context.close();

  await scenarioRooms(browser, baseUrl);
}

/** Особенности помещений: тонкое место, строб (и мягкий строб), тёмное помещение, красная сетка. */
async function scenarioRooms(browser, baseUrl) {
  const { page, context, log } = await openPage(browser, baseUrl, '?q=low&fail=0&lang=ru&touch=0&rank=3&seed=20041113');
  await page.click('.vz-overlay');
  await sleep(300);
  await vz(page, () => window.__vz.freeze(true));
  // Тонкое помещение: постоял — оно рассыпается (скачок тоже нужна выдержка: не раньше 50 с сессии).
  let st = await vz(page, () => window.__vz.step(52 * 60));
  const thin = await vz(page, () => window.__vz.gotoFx('thin'));
  st = await stepUntil(page, (s) => s.jump !== null, 10, 60);
  check('тонкое помещение рассыпается, если в нём постоять: скачок dissolve в карман', thin && st.jump?.cause === 'thin' && st.jump.style === 'dissolve', JSON.stringify({ thin, jump: st.jump, fx: st.roomFx }));
  st = await stepUntil(page, (s) => s.where === 'pocket', 20, 30);
  check('и игрок оказывается в карманном пространстве', st.where === 'pocket' && ['void', 'meadow', 'dollhouse'].includes(st.pocket), `${st.where}/${st.pocket}`);
  await vz(page, () => window.__vz.jump('elsewhere', 'cut'));
  st = await stepUntil(page, (s) => s.where === 'main' && s.jump === null, 20, 30);
  await vz(page, () => window.__vz.calm(true));

  // Какие помещения «обычные» (без особенностей): с ними сравниваем.
  const lvl = await vz(page, () => window.__vz.level());
  const plain = [];
  for (const r of lvl.rooms) {
    if (!['living', 'command', 'kitchen', 'medical', 'bedroom', 'nursery', 'storage'].includes(r.type) || plain.length >= 3) continue;
    await vz(page, (id) => window.__vz.gotoRoom(id), r.id);
    const s = await vz(page, () => window.__vz.step(2));
    if (s.roomFx === null) plain.push(r.id);
  }
  // Красноту кадра меряем при выключенном фонаре: кирпичная кладовая и бордовый ковёр в луче красные
  // сами по себе, а сетка светится и без света.
  const redInDark = async () => {
    await vz(page, () => window.__vz.toggleLight());
    await vz(page, () => window.__vz.step(50));
    const col = await vz(page, () => window.__vz.probeColor());
    await vz(page, () => window.__vz.toggleLight());
    await vz(page, () => window.__vz.step(20));
    return col.red;
  };
  const look = async (room) => {
    await vz(page, (id) => window.__vz.gotoRoom(id), room);
    const s = await vz(page, () => window.__vz.step(100));
    const grid = await vz(page, () => window.__vz.probe());
    return { s, grid, red: await redInDark() };
  };
  const norms = [];
  for (const id of plain) norms.push(await look(id));
  const normCenter = mean(norms.map((n) => center(n.grid)));
  const normRed = Math.max(...norms.map((n) => n.red));
  check('для сравнения нашлись три обычных помещения без красной сетки', norms.length === 3 && normRed < 0.01 && norms.every((n) => n.s.fx.wire < 0.02), `помещения ${plain.join(',')}, красного ${normRed.toFixed(4)}`);

  // Тёмное помещение: фонарь не светит, при этом проступает красная сетка.
  const darkRoom = await vz(page, () => window.__vz.gotoFx('dark'));
  st = await vz(page, () => window.__vz.step(120));
  const dg = await vz(page, () => window.__vz.probe());
  const dc = await vz(page, () => window.__vz.probeColor());
  check('тёмное помещение: фонарь включён, но не светит — центр кадра темнее, чем в обычном помещении', darkRoom && st.roomFx === 'dark' && st.light.state === 'on' && st.fx.light < 0.1 && center(dg) < normCenter * 0.8, `центр ${center(dg).toFixed(1)} против ${normCenter.toFixed(1)}, свет помещения ${st.fx.light.toFixed(2)}`);
  check('в тёмном помещении проступает красная сетка', dc.red > 0.01 && dc.red > normRed * 5, `красного ${dc.red.toFixed(4)} против ${normRed.toFixed(4)}`);

  // Красная сетка без темноты.
  const wireRoom = await vz(page, () => window.__vz.gotoFx('wire'));
  st = await vz(page, () => window.__vz.step(120));
  const wg = await vz(page, () => window.__vz.probe());
  const wc = { red: await redInDark() };
  check('помещение с сеткой: красного в кадре больше, чем в обычном; фонарь светит', wireRoom && st.roomFx === 'wire' && st.fx.wire > 0.3 && wc.red > normRed + 0.01 && st.fx.light > 0.9 && Math.max(...wg) > 60, `красного ${wc.red.toFixed(4)} против ${normRed.toFixed(4)}, сетка ${st.fx.wire.toFixed(2)}`);

  // Строб: вспышки не чаще трёх в секунду; с настройкой «мягкие вспышки» резких скачков нет.
  // Частоту считаем по состоянию игры на каждом шаге (сила вспышки — число, его не надо читать с
  // экрана), а картинку подтверждаем несколькими кадрами: чтение пикселей в программном рендере
  // медленное, и сотни чтений подряд растягивали проверку на минуты.
  const series = () =>
    vz(page, () => {
      const out = [];
      for (let i = 0; i < 240; i++) out.push(window.__vz.step(1).fx.strobe);
      return out;
    });
  const rises = (s, d) => s.flatMap((x, i) => (i > 0 && x - s[i - 1] > d ? [i] : []));
  const jumpMax = (s) => Math.max(...s.slice(1).map((x, i) => Math.abs(x - s[i])));
  /**
   * Средняя яркость кадра в момент, когда сила вспышки подходит под условие. Ждём до 150 шагов:
   * вспышка идёт раз в 23 шага, и пятая часть ударов пропускается, так что пауза в 46 шагов — обычное дело.
   */
  const frameWhen = async (want) => {
    for (let i = 0; i < 150; i++) {
      const s = await vz(page, () => window.__vz.step(1));
      if (want(s.fx.strobe)) return mean(await vz(page, () => window.__vz.probe()));
    }
    return null;
  };
  const measure = async (softFlash) => {
    await vz(page, (id) => window.__vz.gotoRoom(id), plain[0]);
    await vz(page, () => window.__vz.step(300));
    const there = await vz(page, () => window.__vz.gotoFx('strobe'));
    await vz(page, (c) => window.__vz.calmFlash(c), softFlash);
    const s0 = await vz(page, () => window.__vz.step(30));
    return { there: there && s0.roomFx === 'strobe', s: await series() };
  };
  const softRun = await measure(true);
  const hardRun = await measure(false);
  const soft = softRun.s;
  const hard = hardRun.s;
  const strobeRoom = softRun.there && hardRun.there;
  const flashes = rises(hard, 0.5);
  const gaps = flashes.slice(1).map((x, i) => (x - flashes[i]) / 60);
  check('строб: вспышек за 4 секунды не больше 12 и не чаще трёх в секунду', strobeRoom && flashes.length >= 3 && flashes.length <= 12 && Math.min(...gaps) >= 1 / 3 - 0.01, `вспышек ${flashes.length}, наименьший промежуток ${Math.min(...gaps).toFixed(2)} с`);
  // Картинка: кадр со вспышкой заметно светлее кадра без неё (три пары, чтобы не попасть на случайность).
  const pairs = [];
  for (let i = 0; i < 3; i++) pairs.push([await frameWhen((v) => v > 0.5), await frameWhen((v) => v < 0.5)]);
  check('строб: во вспышке кадр светлеет целиком', pairs.every(([on, off]) => on !== null && off !== null && on > off * 1.5 && on - off > 12), pairs.map(([on, off]) => `${on?.toFixed(1)} / ${off?.toFixed(1)}`).join('; '));
  check('мягкие вспышки: сила света плывёт без скачков', rises(soft, 0.02).length === 0 && jumpMax(soft) < 0.02 && Math.max(...soft) < 0.2, `наибольший скачок ${jumpMax(soft).toFixed(3)}, предел ${Math.max(...soft).toFixed(2)}`);
  check('нет ошибок в консоли', log.errors.length === 0, log.errors.join(' | ').slice(0, 400));
  await context.close();
}

/** Тексты воспоминания по его id из словаря. */
const memText = (lang, id, kind) => lang[`mem.${id}.${kind}`];

async function scenarioSession(browser, baseUrl) {
  section('Сессия: вспышки воспоминаний, «вспомнил», лимбо, следующая сессия, перезагрузка');
  const { page, context, log } = await openPage(browser, baseUrl, '?q=low&fail=0&lang=ru&touch=0&rank=1&seed=20041113');
  let st = await state(page);
  const lines0 = await page.$$eval('.vz-overlay__line', (els) => els.map((e) => e.textContent));
  check('заставка: как играть и предупреждение, заданий и счётчиков нет', st.screen === 'title' && lines0.length === 2 && lines0[0] === RU['title.how'] && lines0[1] === RU['title.warn'], JSON.stringify(lines0));
  await page.click('.vz-overlay');
  await sleep(300);
  await vz(page, () => window.__vz.freeze(true));
  await vz(page, () => window.__vz.calm(true));
  st = await vz(page, () => window.__vz.step(5 * 60));
  check('сессия началась; первые секунды заданий нет: ни воспоминаний, ни строк, ни вспышки', st.screen === 'play' && st.profile.sorties === 1 && st.session.memories.length === 5 && st.session.memories.every((m) => m.state === 'hidden') && (await page.evaluate(() => !document.querySelector('.vz-hud__goals').classList.contains('is-on') && !document.querySelector('.vz-hud__flash').classList.contains('is-on'))), JSON.stringify(st.session.memories.map((m) => m.state)));
  check('на ПК нет кнопок действия и списка на экране', await page.evaluate(() => !document.querySelector('.vz-touch') && !document.querySelector('.vz-hud__act.is-on') && !document.querySelector('.vz-hud__bat.is-on')));
  const ids1 = st.session.memories.map((m) => m.id);

  // Клавиши E, R, Tab ничего не делают — ни без воспоминания, ни рядом с ним.
  const brief = (s) => JSON.stringify({ m: s.session.memories.map((x) => `${x.id}:${x.state}`), hold: s.session.hold, things: s.things.map((t) => `${t.id}:${t.state}`), light: s.light.state, paused: s.paused, overlay: s.overlay, archive: s.archive, pos: s.pos.map((v) => +v.toFixed(2)) });
  const pressKeys = async () => {
    for (const code of ['KeyE', 'KeyR', 'Tab']) {
      await page.keyboard.down(code);
      await vz(page, () => window.__vz.tick(6));
      await page.keyboard.up(code);
    }
    await vz(page, () => window.__vz.tick(2));
  };
  let b0 = brief(st);
  await pressKeys();
  check('клавиши E, R, Tab ничего не делают: ни движения, ни паузы, ни действий', brief(await state(page)) === b0, `${b0} → ${brief(await state(page))}`);
  // Вызвать воспоминание и тем же обращением к странице прочитать вспышку. Она горит 5,2 с настоящего
  // времени, а между вызовом и чтением у теста бывают десятки обращений: на медленной машине (CI)
  // вспышка успевала погаснуть раньше, чем её читали.
  const revealNow = () =>
    vz(page, () => {
      window.__vz.reveal();
      const s = window.__vz.step(5);
      const el = document.querySelector('.vz-hud__flash');
      return { st: s, flash: { on: el.classList.contains('is-on'), text: el.textContent } };
    });
  let revealed = await revealNow();
  st = revealed.st;
  b0 = brief(st);
  await pressKeys();
  check('и когда воспоминание уже пришло, они ничего не берут и не снимают', brief(await state(page)) === b0 && (await state(page)).session.memories.some((m) => m.state === 'active'));
  // Дальше — пять воспоминаний подряд; первое уже пришло.
  let progress = true;
  let shot = 0;
  for (let k = 0; k < 5; k++) {
    if (k > 0) {
      revealed = await revealNow();
      st = revealed.st;
    }
    const mem = await vz(page, () => window.__vz.memory());
    const active = st.session.memories.find((m) => m.state === 'active');
    const flash = revealed.flash;
    const rows = await page.$$eval('.vz-hud__goal', (els) => els.map((e) => ({ text: e.textContent, done: e.classList.contains('is-done') })));
    const flashOk = !!active && flash.on && flash.text === memText(RU, active.id, 'flash');
    const rowsOk = rows.length === k + 1 && rows.at(-1).text === memText(RU, active?.id, 'task') && !rows.at(-1).done;
    if (!(mem && flashOk && rowsOk)) progress = false;
    check(`воспоминание ${k + 1}: на экране вспышка с текстом «${active ? memText(RU, active.id, 'flash') : '?'}», в списке слева появилась строка`, !!mem && flashOk && rowsOk, JSON.stringify({ mem, flash, rows: rows.length }));
    if (wantShots && k === 0) {
      mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: join(OUT, 'session_flash.png') });
    }
    const near = await vz(page, () => window.__vz.gotoMemory());
    await vz(page, () => window.__vz.step(20));
    st = await vz(page, () => window.__vz.step(140));
    const done = st.session.memories.find((m) => m.id === active?.id)?.state === 'done';
    const thing = st.things.find((t) => t.id === mem?.thing);
    const after = await page.evaluate(() => ({ text: document.querySelector('.vz-hud__flash').textContent, done: [...document.querySelectorAll('.vz-hud__goal.is-done')].length, rows: document.querySelectorAll('.vz-hud__goal').length }));
    const ok = near && done && after.text === memText(RU, active.id, 'done') && after.done === k + 1 && !!thing && (thing.state === 'gone' || thing.dissolve > 0.15);
    if (!ok) progress = false;
    check(`воспоминание ${k + 1}: удержал взгляд — строка зачёркнута, текст «${active ? memText(RU, active.id, 'done') : '?'}», вещь рассыпалась`, ok, JSON.stringify({ near, done, after, thing: thing && { state: thing.state, dissolve: thing.dissolve } }));
    if (!progress) break;
  }

  if (progress) {
    // Всё вспомнено: чуть погодя место рассыпается и игрок в лимбо.
    st = await stepUntil(page, (s) => s.jump !== null && s.jump.cause === 'end', 10, 60);
    check('пять из пяти — место рассыпается (dissolve) и ведёт в лимбо', st.jump?.style === 'dissolve' && st.jump.to === 'limbo' && st.session.over === true && st.session.done === 5, JSON.stringify({ jump: st.jump, over: st.session.over, done: st.session.done }));
    st = await stepUntil(page, (s) => s.where === 'limbo', 20, 30);
    st = await vz(page, () => window.__vz.step(90));
    const grid = await vz(page, () => window.__vz.probe());
    check('лимбо: белое нигде — кадр светлый', st.where === 'limbo' && frameMean(grid) > 120, `среднее ${frameMean(grid).toFixed(1)}`);
    const limbo = await page.$$eval('.vz-hud__limbo > div', (els) => els.map((e) => e.textContent));
    const limboOn = await page.evaluate(() => document.querySelector('.vz-hud__limbo').classList.contains('is-on') && !document.querySelector('.vz-hud__goals').classList.contains('is-on'));
    check('в лимбо видны строки: итог сессии, реплика, ожидание', limboOn && limbo.length === 3 && /^сессия 0001 закрыта\. сохранено воспоминаний: 5\.$/.test(limbo[0]) && limbo[2] === RU['limbo.wait'], JSON.stringify(limbo));
    check('в лимбо копятся вспомненные вещи; закрытая сессия засчитана', st.things.length === 5 && st.archive.length === 5 && st.profile.successes === 1 && st.profile.archive.length === 5, JSON.stringify({ things: st.things.length, archive: st.archive.length, successes: st.profile.successes }));
    if (wantShots) await page.screenshot({ path: join(OUT, 'session_limbo.png') });

    // Приложение собирает следующую сессию, лимбо отпускает: новые воспоминания.
    for (let i = 0; i < 50 && st.profile.sorties < 2; i++) {
      st = await vz(page, () => window.__vz.step(60));
      await sleep(150);
    }
    st = await vz(page, () => window.__vz.step(30));
    const ids2 = st.session?.memories.map((m) => m.id) ?? [];
    check('через несколько секунд началась новая сессия: другое убежище, другие воспоминания, заданий снова нет', st.where === 'main' && st.profile.sorties === 2 && st.session.memories.every((m) => m.state === 'hidden') && ids2.length === 5 && ids2.every((id) => !ids1.includes(id)) && st.session.time < 5, JSON.stringify({ where: st.where, sorties: st.profile.sorties, ids1, ids2 }));
    check('на экране — название новой сессии, строк лимбо нет', (await page.textContent('.vz-hud__toast'))?.trim() === 'untitled session 0002' && (await page.evaluate(() => !document.querySelector('.vz-hud__limbo').classList.contains('is-on'))));
  }

  // Перезагрузка: счётчики на заставке сохранились.
  await sleep(400);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__vz?.ready() === true, null, { timeout: 90000 });
  const cnt = await page.$$eval('.vz-overlay__line', (els) => els.map((e) => e.textContent));
  check('после перезагрузки на заставке: закрыто сессий — 1, сохранено воспоминаний — 5', cnt.some((l) => /закрыто сессий: 1 · сохранено воспоминаний: 5 из \d+/.test(l)), JSON.stringify(cnt));
  check('нет ненайденных ключей локализации', (await vz(page, () => window.__vz.missingKeys())).length === 0, (await vz(page, () => window.__vz.missingKeys())).join(', '));
  check('нет ошибок в консоли', log.errors.length === 0, log.errors.join(' | ').slice(0, 400));
  await context.close();

  await scenarioHonest(browser, baseUrl);
  await scenarioThings(browser, baseUrl);
}

/** Честный прогон без подсказок: ничего не подталкиваем, симуляции не больше 40 секунд. */
async function scenarioHonest(browser, baseUrl) {
  const { page, context, log } = await openPage(browser, baseUrl, '?q=low&fail=0&lang=ru&touch=0&rank=1&seed=777');
  await page.click('.vz-overlay');
  await sleep(300);
  await vz(page, () => window.__vz.freeze(true));
  await vz(page, () => window.__vz.calm(true));
  let st = await vz(page, () => window.__vz.step(28 * 60));
  check('честный прогон: за 28 секунд воспоминаний нет', st.session.memories.every((m) => m.state === 'hidden') && (await vz(page, () => window.__vz.memory())) === null, `${st.time.toFixed(1)} с`);
  // Игрок смотрит на мелкую вещь сна: это и есть повод для первой вспышки.
  const things = await vz(page, () => window.__vz.things());
  const small = things.find((t) => !t.memory && SMALL_THINGS.includes(t.kind) && (t.fate === 'shrink' || t.fate === 'dust'));
  st = await vz(page, () => window.__vz.step(3 * 60));
  const near = !!small && (await vz(page, (id) => window.__vz.gotoThing(id, 2.4), small.id));
  st = await vz(page, () => window.__vz.step(90));
  const mem = await vz(page, () => window.__vz.memory());
  check('честный прогон: к тридцатой секунде игрок засмотрелся на вещь — пришло первое воспоминание само', near && mem !== null && st.session.memories.some((m) => m.state === 'active') && st.time >= 30 && st.time < 40, JSON.stringify({ near, time: st.time, mem }));
  await vz(page, () => window.__vz.gotoMemory());
  st = await vz(page, () => window.__vz.step(130));
  check('честный прогон: вспомнил — за сорок секунд симуляции', st.session.done === 1 && st.time < 40, `${st.time.toFixed(1)} с, вспомнено ${st.session.done}`);
  check('честный прогон: нет ошибок в консоли', log.errors.length === 0, log.errors.join(' | ').slice(0, 400));
  await context.close();
}

/** Вещи под взглядом и скачки в карманные пространства. */
async function scenarioThings(browser, baseUrl) {
  const { page, context, log } = await openPage(browser, baseUrl, '?q=med&fail=0&lang=ru&touch=0&seed=20041113&rank=2');
  await page.click('.vz-overlay');
  await sleep(300);
  await vz(page, () => window.__vz.freeze(true));
  await vz(page, () => window.__vz.calm(true));
  let st = await vz(page, () => window.__vz.step(150));
  const things = await vz(page, () => window.__vz.things());
  check('в убежище стоят вещи сна: мелкие и крупные, с разными судьбами', things.length >= 8 && ['shrink', 'dust', 'grow', 'jump'].every((f) => things.some((t) => t.fate === f)), things.map((t) => `${t.kind}/${t.fate}`).join(' '));
  const watch = async (fate) => {
    const t = things.find((x) => x.fate === fate && !x.memory && SMALL_THINGS.includes(x.kind)) ?? things.find((x) => x.fate === fate && !x.memory);
    if (!t) return null;
    const near = await vz(page, (id) => window.__vz.gotoThing(id, 2.4), t.id);
    return { t, near };
  };
  const now = (s, t) => s.things.find((x) => x.id === t.id);

  let w = await watch('shrink');
  st = await vz(page, () => window.__vz.step(165));
  let cur = now(st, w.t);
  check(`вещь «${w.t.kind}» под долгим взглядом уменьшается`, w.near && cur.state === 'changing' && cur.scale < 0.95 && cur.scale > 0, JSON.stringify(cur));
  st = await vz(page, () => window.__vz.step(100));
  check('и исчезает совсем', now(st, w.t).state === 'gone', JSON.stringify(now(st, w.t)));

  w = await watch('dust');
  st = await vz(page, () => window.__vz.step(165));
  cur = now(st, w.t);
  check(`вещь «${w.t.kind}» под долгим взглядом рассыпается в пыль`, w.near && cur.state === 'changing' && cur.dissolve > 0.05 && cur.scale === 1, JSON.stringify(cur));
  st = await vz(page, () => window.__vz.step(120));
  check('и её больше нет', now(st, w.t).state === 'gone' && now(st, w.t).dissolve === 1, JSON.stringify(now(st, w.t)));

  w = await watch('grow');
  st = await vz(page, () => window.__vz.step(165));
  cur = now(st, w.t);
  check(`вещь «${w.t.kind}» под долгим взглядом растёт`, w.near && cur.state === 'changing' && cur.scale > 1.1, JSON.stringify(cur));
  st = await vz(page, () => window.__vz.step(200));
  cur = now(st, w.t);
  check('и остаётся огромной', cur.state === 'giant' && cur.scale > 6.5 && st.where === 'main', JSON.stringify(cur));
  if (wantShots) await page.screenshot({ path: join(OUT, 'session_giant.png') });

  // Вещь с судьбой jump вырастает и утягивает в карманное пространство.
  w = await watch('jump');
  st = await vz(page, () => window.__vz.step(150));
  st = await stepUntil(page, (s) => s.where === 'pocket', 20, 30);
  check(`крупная вещь «${w.t.kind}» утягивает в карманное пространство`, w.near && st.where === 'pocket' && ['void', 'meadow', 'dollhouse'].includes(st.pocket), JSON.stringify({ where: st.where, pocket: st.pocket, thing: now(st, w.t) }));
  await vz(page, () => window.__vz.step(60));
  // Оттуда игра возвращает: уйти за край.
  st = await state(page);
  await vz(page, ([p]) => window.__vz.teleport(p[0] + 150, p[1], p[2]), [st.pos]);
  st = await stepUntil(page, (s) => s.where === 'main' && s.jump === null, 20, 40);
  check('уйти за край пространства — вернуться в убежище', st.where === 'main' && st.pocket === null && st.session.over === false, JSON.stringify({ where: st.where, pocket: st.pocket }));
  // И дождаться: время пространства ограничено.
  await vz(page, () => window.__vz.jump('meadow', 'cut'));
  st = await stepUntil(page, (s) => s.where === 'pocket', 20, 20);
  const tIn = st.time;
  st = await stepUntil(page, (s) => s.where === 'main' && s.jump === null, 300, 16);
  check('можно просто подождать: карман отпускает не позже чем через минуту', st.where === 'main' && st.time - tIn < 62 && st.time - tIn > 6, `прошло ${(st.time - tIn).toFixed(0)} с, ${st.where}`);

  // Скачки в каждое пространство: картинка есть и не чёрная.
  for (const [to, style] of [['void', 'whiteout'], ['meadow', 'dissolve'], ['dollhouse', 'blackout']]) {
    await vz(page, ([t, s]) => window.__vz.jump(t, s), [to, style]);
    st = await stepUntil(page, (s) => s.where === 'pocket' && s.jump === null, 20, 30);
    st = await vz(page, () => window.__vz.step(60));
    const g = await vz(page, () => window.__vz.probe());
    check(`скачок в «${to}»: игрок там, картинка есть и не чёрная`, st.where === 'pocket' && st.pocket === to && frameMean(g) > 20 && Math.max(...g) > 100, `среднее ${frameMean(g).toFixed(1)}, максимум ${Math.max(...g).toFixed(0)}, ${st.where}/${st.pocket}`);
    if (wantShots) await page.screenshot({ path: join(OUT, `session_pocket_${to}.png`) });
    await vz(page, () => window.__vz.jump('elsewhere', 'cut'));
    st = await stepUntil(page, (s) => s.where === 'main' && s.jump === null, 20, 30);
  }
  check('нет ненайденных ключей локализации', (await vz(page, () => window.__vz.missingKeys())).length === 0);
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

async function scenarioTouchSession(browser, baseUrl) {
  section('Телефон в сессии: ни кнопки действия, ни списка; вспышка воспоминания и лимбо в кадре');
  for (const [name, width, height] of [
    ['ландшафт 915×412', 915, 412],
    ['портрет 390×844', 390, 844],
  ]) {
    const { page, context, log } = await openPage(browser, baseUrl, '?q=low&fail=0&lang=ru&rank=1', { viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    let bad = await page.evaluate(layoutProbe);
    const lines = await page.$$eval('.vz-overlay__line', (els) => els.map((e) => e.textContent));
    check(`${name}: заставка с предупреждением и настройками помещается на экране`, bad.length === 0 && lines.includes(RU['title.warn']) && (await page.isVisible('.vz-overlay__opt--flash')) && (await page.isVisible('.vz-overlay__opt--lang')), bad.join('; '));
    await page.tap('.vz-overlay');
    await sleep(300);
    await vz(page, () => window.__vz.freeze(true));
    await vz(page, () => window.__vz.calm(true));
    let st = await vz(page, () => window.__vz.step(5));
    check(`${name}: кнопки действия и списка заданий нет вовсе; фонарь и пауза на месте`, await page.evaluate(() => !document.querySelector('.vz-touch__btn--act') && !document.querySelector('.vz-touch__btn--goals') && !!document.querySelector('.vz-touch__btn--light') && !!document.querySelector('.vz-touch__btn--pause')));
    check(`${name}: в первые секунды заданий нет`, st.session.memories.every((m) => m.state === 'hidden') && (await page.evaluate(() => !document.querySelector('.vz-hud__goals').classList.contains('is-on'))));

    // Вспышка воспоминания.
    await vz(page, () => window.__vz.reveal());
    st = await vz(page, () => window.__vz.step(5));
    await sleep(350);
    const active = st.session.memories.find((m) => m.state === 'active');
    const flash = await page.evaluate(() => {
      const el = document.querySelector('.vz-hud__flash');
      const r = el.getBoundingClientRect();
      return { on: el.classList.contains('is-on'), text: el.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: innerWidth, h: innerHeight };
    });
    check(`${name}: вспышка воспоминания видна, с текстом, и целиком в кадре`, !!active && flash.on && flash.text === memText(RU, active.id, 'flash') && flash.left >= 0 && flash.right <= flash.w && flash.top >= 0 && flash.bottom <= flash.h, JSON.stringify(flash));
    bad = await page.evaluate(layoutProbe);
    check(`${name}: вспышка, список слева и кнопки не наезжают друг на друга`, bad.length === 0, bad.join('; '));
    if (wantShots) {
      mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: join(OUT, `touch_session_flash_${width}x${height}.png`) });
    }

    // Сессия проходится на таче так же (через отладочный API): вспомнил — строка зачёркнута.
    const near = await vz(page, () => window.__vz.gotoMemory());
    st = await vz(page, () => window.__vz.step(160));
    check(`${name}: вспомнил — воспоминание закрыто, строка зачёркнута`, near && st.session.done === 1 && (await page.$$eval('.vz-hud__goal.is-done', (els) => els.length)) === 1);
    bad = await page.evaluate(layoutProbe);
    check(`${name}: со строкой в списке всё помещается`, bad.length === 0, bad.join('; '));

    // Лимбо.
    await vz(page, () => window.__vz.finish());
    st = await stepUntil(page, (s) => s.where === 'limbo', 20, 40);
    st = await vz(page, () => window.__vz.step(60));
    // Симуляция заморожена, а вспышка (5,2 с и ещё 1,6 с затухания) и сообщения гаснут по реальному времени: ждём.
    await sleep(7000);
    const limbo = await page.evaluate(() => {
      const el = document.querySelector('.vz-hud__limbo');
      const r = el.getBoundingClientRect();
      return { on: el.classList.contains('is-on'), rows: el.children.length, left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: innerWidth, h: innerHeight };
    });
    check(`${name}: строки лимбо видны и целиком в кадре`, st.where === 'limbo' && limbo.on && limbo.rows === 3 && limbo.left >= 0 && limbo.right <= limbo.w && limbo.top >= 0 && limbo.bottom <= limbo.h, JSON.stringify(limbo));
    bad = await page.evaluate(layoutProbe);
    check(`${name}: в лимбо надписи и кнопки не наезжают друг на друга`, bad.length === 0, bad.join('; '));
    if (wantShots) await page.screenshot({ path: join(OUT, `touch_session_limbo_${width}x${height}.png`) });
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
  const lightBtn = rect('.vz-touch__btn--light');
  if (overlap(goals, pause)) bad.push('overlap цели и кнопка паузы');
  if (overlap(goals, tr)) bad.push('overlap цели и время');
  // Вспышка воспоминания и строки лимбо — посреди кадра: не наезжают на кнопки, надписи записи и список.
  const flash = rect('.vz-hud__flash.is-on');
  const limbo = rect('.vz-hud__limbo.is-on');
  if (overlap(flash, pause) || overlap(flash, lightBtn) || overlap(flash, goals) || overlap(flash, tl) || overlap(flash, tr)) bad.push('overlap вспышка воспоминания и кнопки, список или надписи записи');
  if (overlap(limbo, pause) || overlap(limbo, lightBtn) || overlap(limbo, tl) || overlap(limbo, tr) || overlap(limbo, flash)) bad.push('overlap лимбо и кнопки или надписи записи');
  const toast = rect('.vz-hud__toast.is-on');
  if (overlap(toast, goals)) bad.push('overlap сообщение и цели');
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
      const { page, context, log } = await openPage(browser, baseUrl, `?lang=${lang}&pseudo=1&q=low&fail=0&rank=1&touch=${mobile ? 1 : 0}`, { viewport: { width, height }, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile, locale: lang });
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
      await vz(page, () => window.__vz.calm(true));
      await vz(page, () => window.__vz.step(20));
      ok = (await probe('play')) && ok;
      // Вспышка воспоминания: строка посреди кадра и строка в списке слева.
      await vz(page, () => window.__vz.reveal());
      await vz(page, () => window.__vz.step(5));
      await sleep(350);
      ok = (await probe('flash')) && ok;
      await vz(page, () => window.__vz.fail());
      await vz(page, () => window.__vz.step(10));
      ok = (await probe('dead')) && ok;
      await vz(page, () => window.__vz.finish());
      await stepUntil(page, (s) => s.where === 'limbo', 30, 40);
      await vz(page, () => window.__vz.step(60));
      await sleep(7000);
      ok = (await probe('limbo')) && ok;
      await vz(page, () => window.__vz.pause(true));
      await sleep(150);
      ok = (await probe('paused')) && ok;
      const sizeOk = await page.evaluate(() => {
        const c = document.querySelector('canvas').getBoundingClientRect();
        return Math.abs(c.width - innerWidth) < 1 && Math.abs(c.height - innerHeight) < 1;
      });
      check(`${name} ${lang}: заставка, игра, вспышка воспоминания, заглохший фонарь, лимбо, пауза — без выхода за экран; canvas во весь экран`, ok && sizeOk && log.errors.length === 0, screens.filter((s) => s.includes(':')).join(' | ') + (log.errors.length ? ' ошибки: ' + log.errors.join(' | ').slice(0, 200) : ''));
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
  // Язык браузера русский, а игра по умолчанию английская: площадка язык игре не навязывает.
  const { page, context, log } = await openPage(browser, baseUrl, '?debug=1&q=low&fail=0&rank=1', { locale: 'ru-RU' }, onConsole);
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
  check('хранилище читается одним вызовом, ключ один — профиль', gets.length === 1 && JSON.stringify(gets[0].vals[0]) === JSON.stringify(['profile']), JSON.stringify(gets.map((g) => g.vals[0])));
  check('игра на заставке английская, хотя браузер русский', (await page.textContent('.vz-overlay__title')) === 'UNTITLED SESSION' && (await page.textContent('.vz-overlay__prompt')) === 'Click to begin' && (await page.evaluate(() => document.documentElement.lang)) === 'en');
  check('game_ready отправлен ровно один раз', messages('game_ready').length === 1, `отправлено ${messages('game_ready').length}`);
  check('до нажатия «начать» level_started не уходит', messages('level_started').length === 0);
  await page.click('.vz-overlay');
  await sleep(600);
  await queue;
  check('level_started отправлен при старте', messages('level_started').length === 1 && !!messages('level_started')[0].vals[1]?.level, JSON.stringify(messages('level_started').map((m) => m.vals[1])));
  const firstGet = sdk.findIndex((c) => /\[storage\] get\(\)$/.test(c.text));
  const sets = sdk.slice(firstGet + 1).filter((c) => /\[storage\] set\(\)$/.test(c.text));
  check('запись хранилища пакетная: только профиль, и только по событию', sets.length >= 1 && sets.length <= 2 && sets.every((c) => JSON.stringify(c.vals[0]) === JSON.stringify(['profile'])), `записей ${sets.length}: ${JSON.stringify(sets.map((c) => c.vals[0]))}`);
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
  // Первая половина сценария проверяет настоящую мышь (ложное движение после захвата, тряска) — захват настоящий.
  const { page, context, log } = await openPage(browser, baseUrl, '?q=low&fail=0&lang=ru&touch=0&seed=20041113&audio=snd', {}, null, prepare, true);
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

  // Выбор запоминается. Мышь дальше не проверяется, а сессия впереди длинная: после перезагрузки
  // страница получает заглушку захвата (см. FAKE_LOCK).
  await context.addInitScript(FAKE_LOCK);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__vz?.ready() === true, null, { timeout: 90000 });
  au = await vz(page, () => window.__vz.audio());
  check('после перезагрузки звук остаётся выключенным', au.muted === true && (await page.textContent('.vz-overlay__opt--sound'))?.trim() === 'Звук: выкл');
  await page.click('.vz-overlay__opt--sound');
  await sleep(600);
  au = await vz(page, () => window.__vz.audio());
  st = await state(page);
  check('на карточке задания играет музыка меню, вылазка не началась', st.overlay === 'start' && au.muted === false && au.state === 'running' && au.loops.includes('music_menu'), JSON.stringify({ overlay: st.overlay, state: au.state, loops: au.loops }));

  // Сессия: вспышка воспоминания, «вспомнил», скачок, лимбо, начало следующей сессии.
  await page.click('.vz-overlay');
  await sleep(300);
  await vz(page, () => window.__vz.freeze(true));
  await vz(page, () => window.__vz.calm(true));
  const sorties0 = (await vz(page, () => window.__vz.step(5))).profile.sorties;
  au = await vz(page, () => window.__vz.audio());
  const at0 = { hold: au.played.camera_hold ?? 0, beep: au.played.camera_beep ?? 0, spark: au.played.flash_spark ?? 0, hatch: au.played.hatch ?? 0, report: au.played.ui_report ?? 0 };
  check('в начале сессии люк уже прозвучал один раз, до вспышки камера молчит', at0.hatch === 1 && at0.hold === 0 && at0.beep === 0, JSON.stringify(at0));
  await vz(page, () => window.__vz.reveal());
  await vz(page, () => window.__vz.step(5));
  au = await vz(page, () => window.__vz.audio());
  check('вспышка воспоминания звучит: камера наводится', (au.played.camera_hold ?? 0) === at0.hold + 1, `${at0.hold} → ${au.played.camera_hold ?? 0}`);
  await vz(page, () => window.__vz.gotoMemory());
  st = await vz(page, () => window.__vz.step(150));
  au = await vz(page, () => window.__vz.audio());
  check('«вспомнил» — писк камеры один раз', st.session.done === 1 && (au.played.camera_beep ?? 0) === at0.beep + 1, JSON.stringify({ done: st.session.done, beep: au.played.camera_beep }));
  const spark1 = au.played.flash_spark ?? 0;
  await vz(page, () => window.__vz.jump('void', 'cut'));
  st = await stepUntil(page, (s) => s.where === 'pocket', 10, 30);
  au = await vz(page, () => window.__vz.audio());
  const spark2 = au.played.flash_spark ?? 0;
  check('скачок звучит: искра в момент смены места', st.where === 'pocket' && spark2 === spark1 + 1, `${spark1} → ${spark2}`);
  await stepUntil(page, (s) => s.jump === null, 20, 30);
  au = await audioUntil(page, (a) => !a.loops.includes('amb_bunker') && !a.loops.includes('breath_calm'));
  check('вне убежища его гул и дыхание стихают', !au.loops.includes('amb_bunker') && !au.loops.includes('breath_calm'), au.loops.join(', '));
  await vz(page, () => window.__vz.jump('elsewhere', 'cut'));
  await stepUntil(page, (s) => s.where === 'main' && s.jump === null, 20, 30);
  au = await audioUntil(page, (a) => a.loops.includes('amb_bunker'));
  check('вернулись в убежище — гул вернулся', au.loops.includes('amb_bunker'), JSON.stringify({ loops: au.loops, state: au.state, where: (await state(page)).where, paused: (await state(page)).paused }));

  await vz(page, () => window.__vz.finish());
  st = await stepUntil(page, (s) => s.where === 'limbo', 20, 40);
  st = await vz(page, () => window.__vz.step(120));
  au = await audioUntil(page, (a) => !a.loops.includes('amb_bunker'));
  check('лимбо: звучит сообщение системы, гул убежища стих, музыки меню нет', st.where === 'limbo' && (au.played.ui_report ?? 0) === at0.report + 1 && !au.loops.includes('amb_bunker') && !au.loops.includes('music_menu'), JSON.stringify({ where: st.where, report: au.played.ui_report, loops: au.loops }));
  for (let i = 0; i < 50 && st.profile.sorties <= sorties0; i++) {
    st = await vz(page, () => window.__vz.step(60));
    await sleep(150);
  }
  st = await vz(page, () => window.__vz.step(30));
  au = await audioUntil(page, (a) => a.loops.includes('amb_bunker'));
  check('началась следующая сессия: люк звучит снова, гул убежища вернулся', st.where === 'main' && st.profile.sorties === sorties0 + 1 && (au.played.hatch ?? 0) === at0.hatch + 1 && au.loops.includes('amb_bunker'), JSON.stringify({ where: st.where, hatch: au.played.hatch, loops: au.loops }));

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

  // Заставка в песочнице: без хранилища и без ?lang игра английская, что бы ни говорил браузер.
  const page2 = await context.newPage();
  await page2.setContent(`<!doctype html><style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100%;height:100%}</style><iframe sandbox="allow-scripts" src="${new URL('?q=low&fail=0&touch=0&level=test', baseUrl).toString()}"></iframe>`);
  const frame2 = page2.frames().find((f) => f !== page2.mainFrame());
  let ready2 = true;
  await frame2.waitForFunction(() => window.__vz?.ready() === true, null, { timeout: 90000 }).catch(() => {
    ready2 = false;
  });
  check('в песочнице без ?lang заставка английская, предупреждение о вспышках и настройки на месте', ready2 && (await frame2.textContent('.vz-overlay__title')) === 'UNTITLED SESSION' && (await frame2.textContent('.vz-overlay__prompt')) === 'Click to begin' && (await frame2.evaluate(() => document.documentElement.lang)) === 'en' && (await frame2.$$eval('.vz-overlay__line', (els) => els.map((e) => e.textContent))).includes(EN['title.warn']) && (await frame2.isVisible('.vz-overlay__opt--flash')) && (await frame2.isVisible('.vz-overlay__opt--lang')));
  if (ready2) {
    // Выбор в песочнице действует до конца страницы, хотя сохранить его некуда.
    await frame2.click('.vz-overlay__opt--lang');
    check('смена языка работает и без хранилища', (await frame2.textContent('.vz-overlay__prompt')) === 'Нажмите, чтобы начать' && (await frame2.evaluate(() => document.documentElement.lang)) === 'ru');
  }

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
  if (wants('session')) await scenarioSession(browser, server.url);
  if (wants('fear')) await scenarioFear(browser, server.url);
  if (wants('audio')) await scenarioAudio(browser, server.url);
  if (wants('frame')) await scenarioFrame(browser, server.url);
  if (wants('touch')) await scenarioTouch(browser, server.url);
  if (wants('touch')) await scenarioTouchSession(browser, server.url);
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
