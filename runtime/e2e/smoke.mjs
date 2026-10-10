#!/usr/bin/env node
/**
 * Смоук-тест собранной игры в настоящем браузере (Playwright), docs/architecture/06 §8 и пункт 36
 * чеклиста Playgama: загрузка → game_ready → первый выбор → сейв/лоад → смена языка →
 * (опционально) матрица раскладки 360×640, 390×844, 915×412, 1280×720, 2560×1440 × языки.
 *
 *   npm run build && npm run smoke                  # dist/ отдаётся встроенным vite preview
 *   npm run build:playgama && npm run smoke -- --dist dist-playgama   # с настоящим Bridge SDK (mock-платформа)
 *   npm run smoke -- --url https://…                # опубликованная ссылка (чеклист Playgama, п. 36)
 *   npm run smoke:matrix                            # + проверка раскладки, скриншоты в e2e/out/
 *
 * Параметры: --dist <dir> | --url <url>, --matrix, --langs ru,en,es,pt (для матрицы), --no-shots.
 * Браузер: переменная CHROMIUM_PATH (свой Chromium) или управляемый Playwright
 * (`npx playwright install chromium`). Доп. флаги запуска — CHROMIUM_ARGS (через пробел).
 * Выход: 0 — все проверки прошли, 1 — есть провалы.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'e2e', 'out');

// ───────────────────────────── аргументы ─────────────────────────────

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
const matrixLangs = opt('langs', 'ru,en').split(',').map((s) => s.trim()).filter(Boolean);

// ───────────────────────────── результаты ─────────────────────────────

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

// ───────────────────────────── браузер и сервер ─────────────────────────────

async function startServer() {
  if (remoteUrl) return { url: remoteUrl, close: async () => undefined };
  const server = await preview({
    configFile: false,
    root: ROOT,
    base: './',
    logLevel: 'error',
    build: { outDir: distDir },
    preview: { host: '127.0.0.1', port: 4180, strictPort: false, open: false },
  });
  const url = server.resolvedUrls?.local?.[0];
  if (!url) throw new Error('vite preview не вернул адрес');
  return { url, close: () => server.close() };
}

async function launchBrowser() {
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  const extra = (process.env.CHROMIUM_ARGS ?? '').split(/\s+/).filter(Boolean);
  try {
    return await chromium.launch({
      executablePath,
      headless: true,
      // Программный WebGL: на CI без GPU PixiJS всё равно получает контекст.
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', ...extra],
    });
  } catch (e) {
    console.error(`Не удалось запустить Chromium: ${e.message}\nУкажите CHROMIUM_PATH или выполните: npx playwright install chromium`);
    process.exit(2);
  }
}

/** Страница с журналом ошибок, неудачных и внешних запросов. */
async function openPage(browser, baseUrl, query, ctxOpts = {}, seedStorage = null) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US', ...ctxOpts });
  if (seedStorage) {
    await context.addInitScript((kv) => {
      try {
        if (window.bridge) return;
        for (const [k, v] of Object.entries(kv)) if (localStorage.getItem('krimrussia:' + k) === null) localStorage.setItem('krimrussia:' + k, JSON.stringify(v));
      } catch {
        /* хранилище недоступно — не страшно */
      }
    }, seedStorage);
  }
  const page = await context.newPage();
  const origin = new URL(baseUrl).origin;
  const log = { errors: [], external: [], failed: [] };
  page.on('console', (m) => {
    // Журнал самого Bridge SDK пишет ошибки в консоль только при настоящих проблемах.
    if (m.type() === 'error') log.errors.push(m.text());
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
  const url = new URL(query, baseUrl).toString();
  await page.goto(url, { waitUntil: 'networkidle' });
  return { page, context, log };
}

const pending = (page) => page.evaluate(() => window.__vn?.pending() ?? null);
const stateOf = (page) => page.evaluate(() => window.__vn?.state() ?? null);

/** Space, пока не появится нужное ожидание. */
async function advanceUntil(page, pred, { max = 400, delay = 30 } = {}) {
  for (let i = 0; i < max; i++) {
    const p = await pending(page);
    if (p && pred(p)) return p;
    await page.keyboard.press('Space');
    await sleep(delay);
  }
  throw new Error(`advanceUntil: не дождались за ${max} нажатий; сейчас ${JSON.stringify(await pending(page))}`);
}

const visibleText = (page) => page.evaluate(() => document.querySelector('.vn-root')?.innerText ?? '');
const PLACEHOLDER = /\[(?:ui|common|ep\d+)\.[a-z0-9_.]+\]/;

// ───────────────────────────── сценарии ─────────────────────────────

async function scenarioPlay(browser, baseUrl) {
  section('Игра: загрузка → предупреждение → первый выбор → сейв/лоад → язык');
  const { page, context, log } = await openPage(browser, baseUrl, '?debug=1', { locale: 'ru-RU' }, null);
  await page.waitForSelector('.vn-menu__nav button', { state: 'visible' });
  // Настройки через отладочный хук — одинаково для web-plain и Playgama (там localStorage не используется).
  await page.evaluate(() => window.__vn.settings({ textSpeed: 5, skipUnread: true, lang: 'ru' }));
  check('меню показано, window.__vn установлен', await page.evaluate(() => typeof window.__vn?.goto === 'function'));
  const isBridge = await page.evaluate(() => !!window.bridge);
  console.log(`  (платформа: ${isBridge ? 'Playgama Bridge' : 'web-plain'}; рендерер сцены: ${await page.evaluate(() => window.__vn.renderer())})`);
  check('язык выбран по браузеру (ru-RU → ru)', (await page.evaluate(() => document.documentElement.lang)) === 'ru');

  // новая игра → контент-предупреждение
  await page.click('.vn-menu__nav .is-primary');
  await page.waitForSelector('.vn-warning', { state: 'visible' });
  check('перед эпизодом показано контент-предупреждение и дисклеймер', (await page.locator('.vn-warning__title').innerText()).length > 0 && (await page.locator('.vn-warning__disclaimer h3').count()) === 1);
  await page.click('.vn-warning .vn-btn.is-primary');
  await page.waitForFunction(() => window.__vn.pending()?.kind === 'line', null, { timeout: 15000 });
  check('после предупреждения началась партия: первая реплика на экране', (await visibleText(page)).length > 20);

  // первый выбор: пролог проматывается режимом Skip (в настройках разрешён и непрочитанный текст)
  await page.evaluate(() => window.__vn.skip(true));
  await page.waitForFunction(() => window.__vn.pending()?.kind === 'choice', null, { timeout: 90000 });
  const choice = await pending(page);
  check('Skip довёл игрока до первого выбора и остановился на нём', choice.kind === 'choice' && choice.options.length >= 2 && (await page.locator('.vn-qbtn--skip').getAttribute('aria-pressed')) === 'false', JSON.stringify(choice));
  await page.keyboard.press('1');
  await page.waitForFunction((id) => window.__vn.state().journal.some((e) => e.choice === id), choice.id);
  check('цифра 1 выбрала вариант, решение попало в журнал', (await stateOf(page)).journal.at(-1).choice === choice.id);

  // сейв / лоад
  await advanceUntil(page, (p) => p.kind === 'line');
  const saved = await stateOf(page);
  if (isBridge) {
    // Playgama: один ручной слот — «быстрый» (progress.quick), а «Продолжить» возвращает автосейв.
    await page.click('.vn-qbtn--save');
    await page.waitForSelector('.vn-saveload .vn-slot');
    await page.click('.vn-saveload .vn-slot');
    await sleep(300);
    await page.keyboard.press('Escape');
  } else {
    await page.click('.vn-qbtn--save');
    await page.waitForSelector('.vn-saveload .vn-slot');
    await page.click('.vn-saveload [data-slot="2"]');
    await sleep(300);
    check('слот 2 записан в localStorage (web-plain)', await page.evaluate(() => !!localStorage.getItem('krimrussia:slot_2')));
    await page.keyboard.press('Escape');
  }
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Space');
    await sleep(120);
  }
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.vn-menu__nav button', { state: 'visible' });
  check('после перезагрузки в меню есть «Продолжить» (прогресс сохранён)', (await page.locator('.vn-menu__nav button').count()) === 4);
  await page.click('.vn-menu__nav .is-primary'); // Продолжить
  await page.waitForFunction(() => window.__vn.pending()?.kind === 'line', null, { timeout: 15000 });
  await page.click('.vn-qbtn--load');
  await page.waitForSelector('.vn-saveload .vn-slot');
  await page.click(isBridge ? '.vn-saveload .vn-slot:last-of-type' : '.vn-saveload [data-slot="2"]');
  await page.waitForFunction(() => !document.querySelector('.vn-saveload'));
  const loaded = await stateOf(page);
  check('загрузка слота возвращает сохранённую позицию и переменные', loaded.scene_id === saved.scene_id && loaded.step_index === saved.step_index && JSON.stringify(loaded.vars) === JSON.stringify(saved.vars), `${saved.scene_id}:${saved.step_index} → ${loaded.scene_id}:${loaded.step_index}`);

  // живая смена языка из настроек: сцена и шаг не меняются
  const before = await stateOf(page);
  const uiRu = await page.locator('.vn-qbtn--auto').innerText();
  await page.click('.vn-qbtn--settings');
  await page.waitForSelector('.vn-settings');
  await page.click('.vn-settings [data-lang="en"]');
  await sleep(500);
  const uiEn = await page.locator('.vn-qbtn--auto').innerText();
  check('язык переключается на лету (подписи интерфейса меняются)', uiRu !== uiEn && (await page.evaluate(() => document.documentElement.lang)) === 'en', `${uiRu} → ${uiEn}`);
  const after = await stateOf(page);
  check('смена языка не трогает сцену и шаг', before.scene_id === after.scene_id && before.step_index === after.step_index);
  for (const lang of ['es', 'pt', 'ru']) {
    await page.click(`.vn-settings [data-lang="${lang}"]`);
    await sleep(350);
    const text = await visibleText(page);
    check(`язык ${lang}: в интерфейсе нет видимых [ключей]`, !PLACEHOLDER.test(text), (text.match(PLACEHOLDER) ?? [''])[0]);
  }
  await page.keyboard.press('Escape');

  // эпизод целиком автопилотом (в браузере, на собранной версии)
  const report = await page.evaluate(() => window.__vn.autoplay('default'));
  check('автопилот довёл эпизод до концовки', typeof report?.ending === 'string' && report.ending.length > 0, JSON.stringify(report)?.slice(0, 200));

  check('нет ошибок в консоли и неудачных запросов', log.errors.length === 0 && log.failed.length === 0, [...log.errors, ...log.failed].join(' | ').slice(0, 400));
  if (!remoteUrl && !isBridge) check('нет внешних запросов', log.external.length === 0, log.external.join(', '));
  await context.close();
}

async function scenarioBridgeSdk(browser, baseUrl) {
  section('Bridge SDK: game_ready, пакетное хранилище, пауза (только сборка с window.bridge)');
  const sdk = [];
  const { page, context, log } = await openPage(browser, baseUrl, '?debug=1');
  const hasBridge = await page.evaluate(() => !!window.bridge);
  if (!hasBridge) {
    console.log('  (window.bridge нет — раздел пропущен)');
    await context.close();
    return;
  }
  // Журнал вызовов — собственный debug-лог SDK (включается параметром ?debug=1).
  page.on('console', async (m) => {
    if (!m.text().includes('PlaygamaBridge')) return;
    const vals = await Promise.all(m.args().slice(3).map((a) => a.jsonValue().catch(() => '?'))).catch(() => []);
    sdk.push({ text: m.text().replace(/%c/g, '').replace(/background:[^;]*;[^;]*;[^;]*;[^;]*;?/g, '').trim(), vals });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.vn-menu__nav button', { state: 'visible' });
  await sleep(400);
  const calls = (re) => sdk.filter((c) => re.test(c.text));
  check('Bridge инициализирован до старта игры', await page.evaluate(() => window.bridge.isInitialized === true));
  const gets = calls(/\[storage\] get\(\)$/);
  check('хранилище читается одним вызовом со всеми четырьмя ключами', gets.length === 1 && JSON.stringify(gets[0].vals[0]) === JSON.stringify(['profile', 'progress', 'settings', 'archive']), JSON.stringify(gets.map((g) => g.vals[0])));
  check('game_ready отправлен ровно один раз', calls(/\[platform\] sendMessage\(\)$/).filter((c) => c.vals[0] === 'game_ready').length === 1);
  await page.evaluate(() => window.__vn.start());
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Space');
    await sleep(100);
  }
  await sleep(500);
  const sets = calls(/\[storage\] set\(\)$/);
  check('запись хранилища пакетная (profile/progress/settings/archive за один вызов)', sets.length >= 1 && sets.every((c) => JSON.stringify(c.vals[0]) === JSON.stringify(['profile', 'progress', 'settings', 'archive'])));
  check('localStorage напрямую не используется (ключи krimrussia:*)', !(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('krimrussia:')))));
  check('level_started отправлен с world/level', calls(/\[platform\] sendMessage\(\)$/).some((c) => c.vals[0] === 'level_started' && c.vals[1]?.world && c.vals[1]?.level));
  // Пауза/звук приходят из SDK при уходе вкладки в фон.
  const hide = (hidden) =>
    page.evaluate((h) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await hide(true);
  await sleep(400);
  check('PAUSE_STATE_CHANGED(true) ставит игру на паузу', await page.evaluate(() => document.querySelector('.vn-root').classList.contains('is-paused')));
  await hide(false);
  await sleep(400);
  check('…и возвращает после возврата во вкладку', await page.evaluate(() => !document.querySelector('.vn-root').classList.contains('is-paused')));
  check('нет ошибок в консоли', log.errors.length === 0, log.errors.join(' | ').slice(0, 300));
  await context.close();
}

/** Горизонтальный выход за экран, обрезанный текст и прокрутка страницы. */
const layoutProbe = () => {
  const vw = innerWidth;
  const bad = [];
  for (const el of document.querySelectorAll('.vn-root *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (el.closest('.vn-stage') && !el.closest('.vn-stage__captions')) continue;
    if (el.closest('.vn-hud')) continue;
    const name = el.tagName + '.' + String(el.className).split(' ')[0];
    if (r.left < -1 || r.right > vw + 1) bad.push(`x-out ${name} ${Math.round(r.left)}..${Math.round(r.right)} из ${vw}`);
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && !/auto|scroll|hidden/.test(cs.overflowX) && ['BUTTON', 'LABEL', 'SPAN', 'P', 'H1', 'H2', 'H3', 'DT', 'DD', 'LI', 'B'].includes(el.tagName)) bad.push(`clip-x ${name} ${el.scrollWidth}>${el.clientWidth}`);
  }
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth || de.scrollHeight > de.clientHeight) bad.push(`page-scroll ${de.scrollWidth}x${de.scrollHeight} в ${de.clientWidth}x${de.clientHeight}`);
  return bad.slice(0, 6);
};

const MATRIX = [
  ['360x640', 360, 640, 2, true],
  ['390x844', 390, 844, 3, true],
  ['915x412', 915, 412, 2.6, true],
  ['1280x720', 1280, 720, 1, false],
  ['2560x1440', 2560, 1440, 1, false],
];

async function scenarioMatrix(browser, baseUrl) {
  section(`Матрица раскладки: ${MATRIX.map((m) => m[0]).join(', ')} × ${matrixLangs.join(', ')} (псевдолокализация +35 %)`);
  if (wantShots) mkdirSync(OUT, { recursive: true });
  for (const lang of matrixLangs) {
    for (const [name, width, height, dpr, mobile] of MATRIX) {
      const { page, context, log } = await openPage(browser, baseUrl, `?lang=${lang}&pseudo=1&debug=1`, { viewport: { width, height }, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile, locale: lang }, { settings: { v: 1, textSpeed: 5, lang } });
      const found = {};
      const shot = async (screen) => {
        if (wantShots) await page.screenshot({ path: join(OUT, `${name}_${lang}_${screen}.png`) });
      };
      const probe = async (screen) => {
        await sleep(350);
        found[screen] = await page.evaluate(layoutProbe);
        await shot(screen);
      };
      await page.waitForSelector('.vn-menu__nav button', { state: 'visible' });
      await probe('menu');
      await page.click('.vn-menu__nav .is-primary');
      await page.waitForSelector('.vn-warning', { state: 'visible' });
      await probe('warning');
      await page.click('.vn-warning .vn-btn.is-primary');
      await page.waitForFunction(() => window.__vn.pending()?.kind === 'line', null, { timeout: 15000 });
      await page.evaluate(() => window.__vn.goto('s12'));
      await advanceUntil(page, (p) => p.kind === 'line' && p.style === 'say');
      await probe('dialogue');
      await page.evaluate(() => window.__vn.goto('s11'));
      await advanceUntil(page, (p) => p.kind === 'choice');
      await probe('choice');
      await page.keyboard.press('1');
      await advanceUntil(page, (p) => p.kind === 'minigame');
      await probe('minigame');
      await page.click('.mg-btn.is-skip');
      await sleep(300);
      await page.click('.vn-qbtn--settings');
      await page.waitForSelector('.vn-settings');
      await probe('settings');
      await page.keyboard.press('Escape');
      await page.click('.vn-qbtn--log');
      await page.waitForSelector('.vn-log');
      await probe('log');
      await page.keyboard.press('Escape');
      await page.evaluate(() => window.__vn.autoplay({ choice: 'first' }));
      await page.waitForSelector('.vn-ending', { timeout: 15000 });
      await probe('ending');
      const bad = Object.entries(found).filter(([, v]) => v.length > 0);
      check(`${name} ${lang}: вёрстка держится на всех экранах`, bad.length === 0, bad.map(([k, v]) => `${k}: ${v.join('; ')}`).join(' | '));
      check(`${name} ${lang}: нет ошибок в консоли`, log.errors.length === 0, log.errors.join(' | ').slice(0, 200));
      await context.close();
    }
  }
  if (wantShots) console.log(`  скриншоты: ${OUT}`);
}

// ───────────────────────────── запуск ─────────────────────────────

const server = await startServer();
const browser = await launchBrowser();
try {
  console.log(`Смоук-тест: ${server.url}${remoteUrl ? '' : ` (сборка ${distDir})`}`);
  await scenarioPlay(browser, server.url);
  await scenarioBridgeSdk(browser, server.url);
  if (wantMatrix) await scenarioMatrix(browser, server.url);
} catch (e) {
  failures.push(`исключение: ${e.message}`);
  console.error(e);
} finally {
  await browser.close();
  await server.close();
}
console.log(`\n${failures.length === 0 ? 'ВСЁ В ПОРЯДКЕ' : `ПРОВАЛЫ (${failures.length}): ${failures.join('; ')}`} — проверок пройдено: ${passed}`);
process.exit(failures.length === 0 ? 0 : 1);
