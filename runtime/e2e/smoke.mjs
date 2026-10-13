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
 * Параметры: --dist <dir> | --url <url>, --matrix, --langs ru,en,es,pt (для матрицы), --no-shots,
 * --only play,case,camera,bridge,matrix (часть сценариев),
 * --require-assets (все файлы из episode.assets обязаны быть на месте; без флага отсутствующие файлы допустимы:
 * игра показывает плейсхолдеры и пишет по одному предупреждению на файл).
 *
 * Сборка может быть без картинок и звука (`VN_ASSETS_DIR=/пустой/каталог npm run build`) или с ними (из `../assets`):
 * сценарий «Камкордер и графика» сам определяет режим по ответу `__vn.assets(true)` и проверяет оба.
 * Браузер: переменная CHROMIUM_PATH (свой Chromium) или управляемый Playwright
 * (`npx playwright-core install chromium`). Доп. флаги запуска — CHROMIUM_ARGS (через пробел).
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
const requireAssets = flag('require-assets');
const CPU_THROTTLE = Number(process.env.SMOKE_CPU_THROTTLE ?? '1') || 1;
/** --only play,case,camera,bridge,matrix — запустить часть сценариев (для разработки). */
const only = opt('only', null)?.split(',').map((x) => x.trim());
const wants = (name) => !only || only.includes(name);
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

/** Прежний эпизод 1 (новелла и режим дела) открывается по адресу; по умолчанию — «Ход следствия» (ep01_hod). */
const LEGACY = 'ep01_murylev';
const AUDIO_URL = /\/assets\/[^?#]+\.(?:mp3|m4a|ogg|wav)(?:[?#]|$)/i;

/** Заставка (логотип, «коснитесь, чтобы начать») стоит перед меню: тапаем её, если она есть, и ждём меню. */
/** Сохранение и загрузка живут в настройках (решение владельца 2026-10-11): панель быстрых кнопок над группами. */
async function openSaveLoad(page, mode) {
  await page.click('.vn-qbtn--settings');
  await page.waitForSelector('.vn-settings');
  const quick = await page.$$eval('.vn-settings__quick .vn-settings__qbtn', (els) => els.map((e) => e.dataset.action));
  check('в настройках во время игры есть кнопки сохранить/загрузить/звук, а в быстром меню их нет', quick.join(',') === 'save,load,mute' && (await page.$('.vn-qbtn--save')) === null && (await page.$('.vn-qbtn--load')) === null && (await page.$('.vn-qbtn--mute')) === null, quick.join(','));
  await page.click(`.vn-settings__qbtn[data-action="${mode}"]`);
  await page.waitForSelector('.vn-saveload .vn-slot');
}

/** Закрыть список слотов и настройки под ним (Escape закрывает по одному экрану). */
async function closeSaveLoad(page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.vn-saveload'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.vn-settings'));
}

async function toMenu(p) {
  await p.waitForSelector('.vn-ep__open', { state: 'visible' });
}

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
    console.error(`Не удалось запустить Chromium: ${e.message}\nУкажите CHROMIUM_PATH или выполните: npx playwright-core install chromium`);
    process.exit(2);
  }
}

/** Страница с журналом ошибок, неудачных и внешних запросов. */
async function openPage(browser, baseUrl, query, ctxOpts = {}, seedStorage = null, onConsole = null) {
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
  // SMOKE_CPU_THROTTLE=6 — замедлить процессор страницы в N раз (как слабый раннер CI или старый телефон): проверка таймингов.
  if (CPU_THROTTLE > 1) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
  const origin = new URL(baseUrl).origin;
  const log = { errors: [], warnings: [], external: [], failed: [] };
  page.on('console', (m) => {
    // Журнал самого Bridge SDK пишет ошибки в консоль только при настоящих проблемах.
    if (m.type() === 'error') log.errors.push(m.text());
    else if (m.type() === 'warning') log.warnings.push(m.text());
  });
  page.on('pageerror', (e) => log.errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText ?? '';
    // Браузер сам обрывает загрузку аудио, когда элементу меняют src (смена трека), и при перезагрузке страницы.
    if (why.includes('ERR_ABORTED') && AUDIO_URL.test(r.url())) return;
    log.failed.push(`${r.url()} ${why}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) log.failed.push(`HTTP ${r.status()} ${r.url()}`);
  });
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:')) return;
    if (new URL(u).origin !== origin) log.external.push(u);
  });
  if (onConsole) page.on('console', onConsole); // до перехода: загрузка страницы уже попадает в журнал
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
  section('Игра: загрузка → предупреждение → первый выбор → сейв/лоад → язык (новелла, ?episode=ep01_murylev&vn=1)');
  const { page, context, log } = await openPage(browser, baseUrl, `?debug=1&vn=1&episode=${LEGACY}`, { locale: 'ru-RU' }, null);
  await toMenu(page);
  // Игра открывается сразу главным меню (без заставки), и при его показе стартует главная тема передачи
  // (в смоуке автозапуск разрешён флагом Chromium; в браузере без жеста трек ждёт первого касания или клика).
  const theme = await page.evaluate(() => window.__vn.audio());
  check('игра открывается главным меню, и на нём играет главная тема (m_theme_main)', (await page.$('.vn-splash')) === null && theme.music === 'm_theme_main' && theme.audible === true, JSON.stringify({ music: theme.music, audible: theme.audible, log: theme.log.slice(-3) }));
  // Настройки через отладочный хук — одинаково для web-plain и Playgama (там localStorage не используется).
  await page.evaluate(() => window.__vn.settings({ textSpeed: 5, skipUnread: true, lang: 'ru' }));
  check('меню показано, window.__vn установлен', await page.evaluate(() => typeof window.__vn?.goto === 'function'));
  const isBridge = await page.evaluate(() => !!window.bridge);
  console.log(`  (платформа: ${isBridge ? 'Playgama Bridge' : 'web-plain'}; рендерер сцены: ${await page.evaluate(() => window.__vn.renderer())})`);
  check('язык выбран по браузеру (ru-RU → ru)', (await page.evaluate(() => document.documentElement.lang)) === 'ru');

  // клик по эпизоду (сейва нет) → новая игра → контент-предупреждение
  check('на полке открыт текущий эпизод и есть закрытые', (await page.locator('.vn-ep.is-open').count()) === 1 && (await page.locator('.vn-ep.is-locked').count()) > 0);
  check('язык, архив и настройки — иконками', (await page.locator('.vn-menu__icons button').count()) === 3);
  await page.click('.vn-ep__open');
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
  // Выбор сделан, когда ожидание сменилось (в журнал попадают только remember-выборы, первый — косметический).
  await page.waitForFunction((id) => {
    const p = window.__vn.pending();
    return !(p && p.kind === 'choice' && p.id === id);
  }, choice.id);
  check('цифра 1 выбрала первый вариант (last_choice = его id)', (await stateOf(page)).vars.last_choice === choice.options[0].id, JSON.stringify((await stateOf(page)).vars.last_choice));

  // сейв / лоад
  await advanceUntil(page, (p) => p.kind === 'line');
  const saved = await stateOf(page);
  if (isBridge) {
    // Playgama: один ручной слот — «быстрый» (progress.quick), а «Продолжить» возвращает автосейв.
    await openSaveLoad(page, 'save');
    await page.click('.vn-saveload .vn-slot');
    await sleep(300);
    await closeSaveLoad(page);
  } else {
    await openSaveLoad(page, 'save');
    await page.click('.vn-saveload [data-slot="2"]');
    await sleep(300);
    check('слот 2 записан в localStorage (web-plain)', await page.evaluate(() => !!localStorage.getItem('krimrussia:slot_2')));
    await closeSaveLoad(page);
  }
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Space');
    await sleep(120);
  }
  await page.reload({ waitUntil: 'networkidle' });
  await toMenu(page);
  check('после перезагрузки у эпизода есть «Начать заново» (прогресс сохранён)', (await page.locator('.vn-ep__restart').count()) === 1);
  await page.click('.vn-ep__open'); // продолжение
  await page.waitForFunction(() => window.__vn.pending()?.kind === 'line', null, { timeout: 15000 });
  await openSaveLoad(page, 'load');
  await page.click(isBridge ? '.vn-saveload .vn-slot:last-of-type' : '.vn-saveload [data-slot="2"]');
  // Загрузка закрывает все экраны (и настройки под списком слотов).
  await page.waitForFunction(() => !document.querySelector('.vn-saveload') && !document.querySelector('.vn-settings'));
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

async function scenarioCamera(browser, baseUrl) {
  section('Камкордер и графика: «слабо» по умолчанию, HUD, выключатель, reduced-motion, учёт ассетов');
  const { page, context, log } = await openPage(browser, baseUrl, `?debug=1&episode=${LEGACY}`, { locale: 'ru-RU' });
  await toMenu(page);
  const cam = () => page.evaluate(() => window.__vn.camera());
  const stageClass = () => page.evaluate(() => document.querySelector('.vn-stage')?.className ?? '');
  await page.evaluate(() => window.__vn.settings({ textSpeed: 5, skipUnread: true }));
  await page.evaluate(() => window.__vn.start());
  await page.waitForFunction(() => window.__vn.pending()?.kind === 'line', null, { timeout: 15000 });
  // Камкордер включается, когда показан первый кадр: Director сначала ждёт картинки блока и проводит переход.
  // На раннере CI без GPU с настоящими 1920×1080 это дольше секунды — ждём сам цикл, а не фиксированную паузу.
  await page.waitForFunction(() => window.__vn.camera().running, null, { polling: 100, timeout: 20000 }).catch(() => undefined);
  // Первый кадр камкордера на видеокарте компилирует шейдер записи: без GPU (SwiftShader в CI) это может занять
  // секунды, и всё это время страница стоит. Ждём, пока кадры действительно пошли.
  await page.waitForFunction(() => window.__vn.camera().frames > 3, null, { polling: 100, timeout: 30000 }).catch(() => undefined);
  await sleep(400);

  // Что должно быть нарисовано по файлам, которые реально есть в сборке. Оракул повторяет правила каталога (путь фона из
  // episode.assets, цепочка спрайта силуэт → выражение → neutral → base) и сверяется с тем, что показал рендерер (__vn.slots()).
  const slotOracle = () =>
    page.evaluate(async (id) => {
      const idx = await (await fetch('./episodes/index.json')).json();
      const ep = await (await fetch('./' + idx.episodes.find((e) => e.id === id).path)).json();
      const { present } = (await window.__vn.assets(true)).verify;
      const has = (path) => present.some((u) => u.endsWith(path));
      const view = window.__vn.view();
      const bgPath = ep.assets.backgrounds.find((b) => b.id === view.bg)?.path ?? null;
      const bg = !bgPath ? 'placeholder' : /(?:^|\/)black\.(?:png|webp)$/.test(bgPath) ? 'solid' : has(bgPath) ? 'image' : 'placeholder';
      const sprites = {};
      for (const sp of view.sprites) {
        if (sp.position === 'offscreen_left' || sp.position === 'offscreen_right') continue;
        const setId = (ep.cast ?? []).find((c) => c.id === sp.who)?.sprite_set ?? sp.who;
        const set = (ep.assets.sprites ?? []).find((x) => x.id === setId);
        if (!set) {
          sprites[sp.who] = 'placeholder';
          continue;
        }
        const dir = set.base.slice(0, set.base.lastIndexOf('/'));
        const files = [sp.silhouette ? `${dir}/silhouette.webp` : null, sp.expression ? `${dir}/${sp.expression}.webp` : null, `${dir}/neutral.webp`, set.base].filter(Boolean);
        sprites[sp.who] = files.some(has) ? 'image' : 'placeholder';
      }
      return { bg, sprites, actual: window.__vn.slots() };
    }, LEGACY);
  const checkSlots = async (label) => {
    // Кадр интерпретатора меняется сразу, рендерер — после перехода и загрузки: ждём, пока он догонит (тот же фон, те же спрайты).
    await page
      .waitForFunction(() => {
        const st = window.__vn.slots();
        const v = window.__vn.view();
        if (!st || !v || st.bgId !== v.bg || st.bg === 'loading') return false;
        const want = v.sprites.filter((x) => !x.position.startsWith('offscreen')).map((x) => x.who).sort().join();
        return Object.keys(st.sprites).sort().join() === want && Object.values(st.sprites).every((x) => x !== 'loading');
      }, null, { polling: 100, timeout: 10000 })
      .catch(() => undefined);
    const o = await slotOracle();
    const same = !!o.actual && o.actual.bg === o.bg && Object.keys(o.actual.sprites).sort().join() === Object.keys(o.sprites).sort().join() && Object.entries(o.sprites).every(([who, st]) => o.actual.sprites[who] === st);
    check(`${label}: фон и спрайты нарисованы по наличию файлов (картинка / плейсхолдер / сплошной цвет)`, same, JSON.stringify({ ожидали: { bg: o.bg, sprites: o.sprites }, нарисовано: o.actual }));
    return o;
  };

  // Пролог — реконструкция: самый заметный уровень ручной камеры и HUD записи.
  const presentation = await page.evaluate(() => window.__vn.view()?.presentation);
  const c0 = await cam();
  check('эффекты камеры по умолчанию «слабо», цикл идёт (пролог — реконструкция)', presentation === 'reconstruction' && c0.setting === 'low' && c0.effective === 'low' && c0.running && !c0.reducedMotion, JSON.stringify(c0));
  // Кадры идут с частотой браузера; на нагруженной машине без GPU их может быть мало — ждём 4 разных значения до 8 с.
  const seen = new Set();
  const samples = [];
  for (const t0 = Date.now(); seen.size < 4 && Date.now() - t0 < 8000; ) {
    const t = (await cam()).transform;
    samples.push(t);
    seen.add(t);
    await sleep(150);
  }
  // translate3d(0.29%, -0.47%, 0px) rotate(0.33deg) scale(1.0197) → [tx, ty, rot, scale]
  const parse = (t) => {
    const m = /translate3d\((-?[\d.]+)%,\s*(-?[\d.]+)%.*rotate\((-?[\d.]+)deg\)\s*scale\(([\d.]+)\)/.exec(t);
    return m ? m.slice(1).map(Number) : [NaN, NaN, NaN, NaN];
  };
  const frames = samples.map(parse);
  check('кадр дышит: трансформ ручной камеры меняется со временем', seen.size >= 3, [...seen].slice(0, 3).join(' | '));
  // Устойчивая тряска ≤ 1,2 % / 0,5° / 1,03; поправки оператора на короткое время выходят за эти рамки — допуск шире.
  check('…и остаётся малым (сдвиг, поворот, масштаб в разумных пределах)', frames.every(([tx, ty, rot, sc]) => Math.abs(tx) < 5 && Math.abs(ty) < 5 && Math.abs(rot) < 2.6 && sc >= 1 && sc < 1.15), JSON.stringify(frames.slice(0, 2)));
  const prologue = await checkSlots('пролог');
  if (prologue.bg === 'image') check('пролог: картинка фона из файла действительно показана рендерером', prologue.actual?.bg === 'image');
  const hud = await page.evaluate(() => {
    const el = document.querySelector('.vn-stage__hud');
    return el ? { display: getComputedStyle(el).display, text: el.textContent } : null;
  });
  check('реконструкция: HUD записи (точка и REC) показан внутри картинки', c0.rec && hud?.display !== 'none' && hud?.text === 'REC', JSON.stringify(hud));
  const fxCanvas = await page.evaluate(() => {
    const c = document.querySelector('canvas.vn-stage__camfx');
    return c ? { w: c.width, h: c.height, display: getComputedStyle(c).display } : null;
  });
  const renderer = await page.evaluate(() => window.__vn.renderer());
  if (renderer === 'pixi') {
    // PixiJS: движение камеры и искажения записи — шейдер на самой картинке (vhs_filter.ts); холста помех и
    // CSS-трансформации нет (от них мелкий шум мылился).
    const handTf = await page.evaluate(() => document.querySelector('.vn-stage__hand')?.style.transform ?? '');
    check('PixiJS: камкордер рисует шейдер на картинке (gpu), холст помех скрыт, обёртку кадра CSS не трясёт', c0.gpu === true && fxCanvas?.display === 'none' && handTf === '' && /cam-gpu/.test(await stageClass()), JSON.stringify({ gpu: c0.gpu, fxCanvas, handTf }));
  } else {
    check('DOM-рендерер: помехи и зерно рисуются на маленьком холсте (~256 пкс по ширине), а не во весь экран', !!fxCanvas && fxCanvas.w <= 320 && fxCanvas.h <= 360, JSON.stringify(fxCanvas));
  }

  // Помеха по требованию: класс появляется и гаснет сам (длительность 150–500 мс по часам камкордера;
  // без GPU кадры редкие, а часы внутри не бегут быстрее 100 мс за кадр, поэтому ждём с запасом).
  await page.evaluate(() => window.__vn.camera('burst'));
  const burstOn = await page.waitForFunction(() => document.querySelector('.vn-stage')?.classList.contains('cam-burst'), null, { polling: 'raf', timeout: 3000 }).then(() => true, () => false);
  const burstOff = await page.waitForFunction(() => !document.querySelector('.vn-stage')?.classList.contains('cam-burst'), null, { polling: 100, timeout: 8000 }).then(() => true, () => false);
  check('всплеск помех включается и сам заканчивается', burstOn && burstOff, `включился=${burstOn} закончился=${burstOff}`);

  // Выключатель.
  await page.evaluate(() => window.__vn.settings({ cameraFx: 'off' }));
  await sleep(150);
  const off = await cam();
  check('«Выкл»: цикл остановлен, трансформ и HUD сняты', off.setting === 'off' && off.effective === 'off' && !off.running && off.transform === '' && !off.rec, JSON.stringify(off));
  check('«Выкл»: на сцене нет классов камкордера, шейдер снят', !/cam-on|cam-rec|cam-burst|cam-gpu/.test(await stageClass()) && off.gpu === false);
  await page.evaluate(() => window.__vn.settings({ cameraFx: 'high' }));
  await sleep(300);
  const high = await cam();
  check('«Сильно»: уровень применяется на лету, цикл снова идёт', high.effective === 'high' && high.running && /cam-on/.test(await stageClass()), JSON.stringify(high));
  await page.evaluate(() => window.__vn.settings({ cameraFx: 'low' }));

  // Экран настроек: сегменты, выбор мышью.
  await page.click('.vn-qbtn--settings');
  await page.waitForSelector('.vn-settings .vn-camfx');
  const chips = await page.$$eval('.vn-settings .vn-camfx .vn-chip', (els) => els.map((e) => ({ v: e.dataset.cameraFx, on: e.getAttribute('aria-pressed') === 'true', off: e.disabled })));
  check('настройки: «Эффекты камеры» — Выкл / Слабо / Сильно, отмечено «Слабо»', chips.map((c) => c.v).join() === 'off,low,high' && chips.find((c) => c.on)?.v === 'low' && chips.every((c) => !c.off), JSON.stringify(chips));
  // Озвучка: пункт в настройках; клипов в сборке может не быть — тогда озвучка молчит (индекс прочитан, к клипам никто не обращается).
  const voiceUi = await page.evaluate(() => {
    const g = document.querySelector('.vn-settings .vn-voice');
    return g && { box: g.querySelector('input[type=checkbox]')?.checked, slider: g.querySelector('input[type=range]')?.value, disabled: g.querySelector('input[type=range]')?.disabled };
  });
  check('настройки: пункт «Озвучка» — переключатель включён, громкость 0,9', voiceUi?.box === true && voiceUi.slider === '0.9' && voiceUi.disabled === false, JSON.stringify(voiceUi));
  const voiceNow = await page.evaluate(() => window.__vn.audio().voice);
  check('озвучка: индекс клипов прочитан; нет клипов — молчит', typeof voiceNow.clips === 'number' && voiceNow.enabled === true && (voiceNow.clips > 0 || voiceNow.playing === null), JSON.stringify(voiceNow));
  await page.click('.vn-settings .vn-camfx [data-camera-fx="off"]');
  await sleep(200);
  check('выбор «Выкл» в настройках выключает камеру и сохраняется в настройках', (await cam()).effective === 'off' && (await page.evaluate(() => window.__vn.settings().cameraFx)) === 'off');
  await page.click('.vn-settings .vn-camfx [data-camera-fx="low"]');
  await page.keyboard.press('Escape');
  await sleep(200);

  // Не-реконструкция: HUD только в реконструкции.
  await page.evaluate(() => window.__vn.goto('s12'));
  await advanceUntil(page, (p) => p.kind === 'line' && p.style === 'say');
  const procReady = await page.waitForFunction(() => window.__vn.view()?.presentation === 'procedural' && !window.__vn.camera().rec, null, { polling: 100, timeout: 8000 }).then(() => true, () => false);
  const proc = await cam();
  const procHud = await page.evaluate(() => getComputedStyle(document.querySelector('.vn-stage__hud')).display);
  check('процедурная сцена: камера работает, но HUD записи скрыт', procReady && proc.effective === 'low' && proc.running && !proc.rec && procHud === 'none', JSON.stringify(proc));
  const withCast = await checkSlots('сцена с персонажами');
  if (Object.values(withCast.sprites).includes('image')) check('спрайты из файлов действительно показаны рендерером', Object.entries(withCast.sprites).some(([who, st]) => st === 'image' && withCast.actual?.sprites[who] === 'image'));

  // Весь эпизод с работающей камерой: ни одной ошибки на всех пресетах показа.
  const report = await page.evaluate(() => window.__vn.autoplay('default'));
  check('эпизод проходится целиком с включённой камерой', typeof report?.ending === 'string' && report.ending.length > 0);
  check('камкордер не породил ошибок в консоли', log.errors.length === 0, log.errors.join(' | ').slice(0, 300));

  // Ассеты: либо файлы на месте, либо плейсхолдеры и ровно одно предупреждение на отсутствующий файл.
  // Последний блок запрашивает картинки в самом конце автопилота: ждём, пока очередь не опустеет (и не пополнится снова).
  let a = await page.evaluate(() => window.__vn.assets());
  for (let i = 0; i < 50 && a.pending > 0; i++) {
    await sleep(200);
    a = await page.evaluate(() => window.__vn.assets());
  }
  const queue = a;
  a = await page.evaluate(() => window.__vn.assets(true));
  const present = a.verify?.present ?? [];
  const missing = a.verify?.missing ?? [];
  const withFiles = present.length > 0;
  console.log(`  (ассеты: на месте ${present.length}, нет ${missing.length} из ${present.length + missing.length}; загружено игрой ${a.loaded.length}; режим: ${withFiles ? 'с файлами' : 'без файлов — плейсхолдеры'})`);
  check('загрузка ассетов завершена: очередь пуста', queue.pending === 0, `в работе ${queue.pending}: ${(queue.inflight ?? []).join(', ')}`);
  const warned = log.warnings.filter((w) => /^\[assets\] нет файла/.test(w));
  check('каждый отсутствующий файл упомянут в консоли один раз (без шквала предупреждений)', new Set(warned).size === warned.length, warned.slice(0, 3).join(' | '));
  if (withFiles) {
    check('картинки реально загружены и показаны (loaded > 0)', a.loaded.length > 0, JSON.stringify(a.loaded.slice(0, 3)));
    if (requireAssets) check('все файлы из episode.assets на месте (--require-assets)', missing.length === 0, missing.slice(0, 5).join(', '));
    else if (missing.length > 0) console.log(`  (нет ${missing.length} файлов — игра показывает плейсхолдеры: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ', …' : ''})`);
  } else {
    check('без файлов игра не падает: ни одна картинка не помечена загруженной, плейсхолдеры показаны', a.loaded.length === 0 && a.missing.length > 0, JSON.stringify(a.missing.slice(0, 3)));
    if (requireAssets) check('все файлы из episode.assets на месте (--require-assets)', false, `в сборке нет ни одного из ${missing.length} файлов`);
  }
  check('нет неудачных запросов, кроме отсутствующих ассетов', log.failed.filter((f) => !/\/assets\/(?:common|ep\d+)\//.test(f)).length === 0, log.failed.slice(0, 3).join(' | '));
  await context.close();

  // prefers-reduced-motion: эффекты выключены принудительно, переключатель недоступен.
  const rm = await openPage(browser, baseUrl, `?debug=1&episode=${LEGACY}`, { locale: 'ru-RU', reducedMotion: 'reduce' });
  await toMenu(rm.page);
  await rm.page.evaluate(() => window.__vn.start());
  await rm.page.waitForFunction(() => window.__vn.pending()?.kind === 'line', null, { timeout: 15000 });
  await sleep(600);
  const r = await rm.page.evaluate(() => window.__vn.camera());
  check('prefers-reduced-motion: эффекты камеры выключены, несмотря на «Слабо» в настройках', r.reducedMotion && r.setting === 'low' && r.effective === 'off' && !r.running && r.transform === '' && !r.rec, JSON.stringify(r));
  await rm.page.click('.vn-qbtn--settings');
  await rm.page.waitForSelector('.vn-settings .vn-camfx');
  const rmChips = await rm.page.$$eval('.vn-settings .vn-camfx .vn-chip', (els) => els.map((e) => ({ v: e.dataset.cameraFx, on: e.getAttribute('aria-pressed') === 'true', off: e.disabled })));
  check('…в настройках отмечено «Выкл», сегменты недоступны', rmChips.every((c) => c.off) && rmChips.find((c) => c.on)?.v === 'off', JSON.stringify(rmChips));
  check('reduced-motion: нет ошибок в консоли', rm.log.errors.length === 0, rm.log.errors.join(' | ').slice(0, 200));
  await rm.context.close();
}

async function scenarioBridgeSdk(browser, baseUrl) {
  section('Bridge SDK: game_ready, пакетное хранилище, пауза (только сборка с window.bridge)');
  const sdk = [];
  // Журнал вызовов — собственный debug-лог SDK (включается параметром ?debug=1). Обрабатывается по очереди,
  // чтобы порядок записей совпадал с порядком вызовов; слушатель ставится до загрузки страницы (одна загрузка,
  // без перезагрузки: хвост журнала прежней страницы не смешивается с новым).
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
  const { page, context, log } = await openPage(browser, baseUrl, '?debug=1', {}, null, onConsole);
  const hasBridge = await page.evaluate(() => !!window.bridge);
  if (!hasBridge) {
    console.log('  (window.bridge нет — раздел пропущен)');
    await context.close();
    return;
  }
  await toMenu(page);
  const calls = (re) => sdk.filter((c) => re.test(c.text));
  const isReady = (c) => /\[platform\] sendMessage\(\)$/.test(c.text) && c.vals[0] === 'game_ready';
  for (let i = 0; i < 50 && !sdk.some(isReady); i++) {
    await sleep(100);
    await queue;
  }
  await sleep(400);
  await queue;
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
  await queue;
  // Записи самой игры идут после её первого чтения; до него SDK сам пишет служебные ключи своей mock-платформы.
  const firstGet = sdk.findIndex((c) => /\[storage\] get\(\)$/.test(c.text));
  const sets = sdk.slice(firstGet + 1).filter((c) => /\[storage\] set\(\)$/.test(c.text));
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
    if (el.closest('.vn-menu__shelf')) continue; // полка эпизодов листается горизонтально: карточки за краем — норма
    if (el.parentElement?.closest('.mg-scene__list.is-targets')) continue; // список целей на боку — полоса с прокруткой (сама полоса проверяется)
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
      const { page, context, log } = await openPage(browser, baseUrl, `?lang=${lang}&pseudo=1&debug=1&vn=1&episode=${LEGACY}`, { viewport: { width, height }, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile, locale: lang }, { settings: { v: 1, textSpeed: 5, lang } });
      const found = {};
      const shot = async (screen) => {
        if (wantShots) await page.screenshot({ path: join(OUT, `${name}_${lang}_${screen}.png`) });
      };
      // Экран считается готовым, когда видны его элементы (а не просто сменилось ожидание сессии):
      // иначе проверка попадает на середину перехода сцены, когда окно текста ещё скрыто.
      const READY = {
        menu: '.vn-ep__open',
        warning: '.vn-warning.is-in .vn-btn',
        dialogue: '.vn-textbox.is-complete:not([hidden]) .vn-textbox__shown',
        choice: '.vn-choices:not([hidden]) .vn-choice',
        minigame: '.mg-shell .mg-shell__body, .mg-gb .mg-btn',
        settings: '.vn-settings.is-in .vn-range',
        log: '.vn-log.is-in .vn-log__item',
        ending: '.vn-ending.is-in .vn-ending__title',
      };
      const probe = async (screen) => {
        await page.waitForSelector(READY[screen], { state: 'visible', timeout: 15000 });
        await sleep(450);
        found[screen] = await page.evaluate(layoutProbe);
        await shot(screen);
      };
      await toMenu(page);
      await probe('menu');
      await page.click('.vn-ep__open');
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
      // Настоящий осмотр прячет «Пропустить» до skip.after_fails промахов: один тап мимо зон открывает его.
      if (await page.$('.mg-scene__stage')) await page.click('.mg-scene__stage', { position: { x: 4, y: 4 } });
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

// ───────────────────────────── режим дела ─────────────────────────────

/** Пробел, пока не откроется папка дела (разговор дела идёт своим интерпретатором, __vn.pending() его не видит). */
async function talkToFolder(page, max = 40) {
  for (let i = 0; i < max; i++) {
    if (await page.$('.vn-case.is-in')) return true;
    await page.keyboard.press('Space');
    await sleep(120);
  }
  return !!(await page.$('.vn-case.is-in'));
}

/** Осмотр без списка (crime_scene_search): зоны невидимы — клики мышью по их центрам, пока осмотр не закончится. */
async function solveInspect(page) {
  await page.waitForSelector('.mg-scene__zone', { state: 'attached', timeout: 20000 });
  await sleep(300);
  const centers = await page.evaluate(() => [...document.querySelectorAll('.mg-scene__zone')].map((z) => {
    const b = z.getBoundingClientRect();
    return [b.left + b.width / 2, b.top + b.height / 2];
  }));
  for (const [x, y] of centers) {
    if (await page.isVisible('.mg-shell__btn.is-next')) break; // всё обязательное найдено — осмотр закончен
    await page.mouse.click(x, y);
    await sleep(120);
  }
  return centers.length;
}

/** Найти всё из списка поиска: настоящие клики мышью по центрам активных зон. */
async function solveSearch(page) {
  await page.waitForSelector('.mg-scene__list.is-targets .mg-scene__item', { state: 'visible' });
  const centers = await page.evaluate(() => [...document.querySelectorAll('.mg-scene__zone')].map((z) => {
    const b = z.getBoundingClientRect();
    return [b.left + b.width / 2, b.top + b.height / 2];
  }));
  for (const [x, y] of centers) {
    await page.mouse.click(x, y);
    await sleep(60);
  }
  return centers.length;
}

const caseText = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.textContent.trim()), sel);

async function scenarioCase(browser, baseUrl) {
  section('Режим дела: меню → предупреждение → вступление → папка → поиск по списку → ★ → разговор → сохранение');
  const { page, context, log } = await openPage(browser, baseUrl, `?debug=1&episode=${LEGACY}`, { locale: 'ru-RU' });
  await toMenu(page);
  await page.evaluate(() => window.__vn.settings({ textSpeed: 5, lang: 'ru' }));
  await page.click('.vn-ep__open');
  await page.waitForSelector('.vn-warning', { state: 'visible' });
  await page.click('.vn-warning .vn-btn.is-primary');
  await page.waitForSelector('.vn-textbox:not([hidden]) .vn-textbox__shown', { state: 'visible', timeout: 15000 });
  check('после предупреждения — вступление главы репликой в текстовом окне', (await page.locator('.vn-textbox__shown').innerText()).length > 0);
  check('вступление пролистывается до папки дела', await talkToFolder(page));
  await page.keyboard.press('Space');
  await page.keyboard.press('Space');
  await sleep(300);
  check('лишний пробел после разговора не уводит из папки и не прокручивает её', !!(await page.$('.vn-case.is-in')) && (await page.evaluate(() => document.querySelector('.vn-case').scrollTop)) === 0);
  check('в начале открыта одна задача — осмотр квартиры, ★ 0', (await page.locator('.vn-case__task').count()) === 1 && (await page.locator('.vn-case__star-n').innerText()) === '0');
  check('папка на 1280×720 держит вёрстку', (await page.evaluate(layoutProbe)).length === 0, (await page.evaluate(layoutProbe)).join('; '));

  await page.click('.vn-case__task.is-open .vn-case__task-btn');
  await page.waitForSelector('.vn-mg.is-wide .mg-scene__list.is-targets', { state: 'visible' });
  const targets = await caseText(page, '.mg-scene__list.is-targets .mg-scene__item');
  check('поиск по списку: 10 предметов, улики (фото, очки, лекарства) в списке первого захода', targets.length === 10 && ['Фото внука', 'Очки', 'Лекарства'].every((x) => targets.includes(x)), targets.join(', '));
  const stageW = await page.evaluate(() => document.querySelector('.mg-scene__stage').getBoundingClientRect().width);
  check('картинка поиска крупная (на 1280×720 шире 800 px)', stageW > 800, String(Math.round(stageW)));
  await solveSearch(page);
  check('клики по предметам находят всё из списка', (await page.locator('.mg-shell__progress').innerText()).includes('10 из 10'));
  await page.click('.mg-shell__btn.is-next');
  await page.waitForSelector('.vn-case-result.is-in', { state: 'visible' });
  check('итог захода: ★★★ и +3 ★', (await page.locator('.vn-case-result__stars').innerText()) === '★★★' && (await page.locator('.vn-case-result__earned').innerText()).includes('+3'));
  await page.click('.vn-case-result .vn-btn.is-primary');
  await page.waitForSelector('.vn-case.is-in', { state: 'visible' });
  check('папка: ★ 3, три улики, открылись разговор с Лапиным и подъезд', (await page.locator('.vn-case__star-n').innerText()) === '3' && (await page.locator('.vn-case__clue').count()) === 3 && (await page.locator('[data-id="talk_lapin"].is-open, [data-id="search_stairs"].is-open').count()) === 2);

  await page.click('[data-id="talk_lapin"] .vn-case__task-btn');
  await page.waitForSelector('.vn-textbox:not([hidden]) .vn-textbox__shown', { state: 'visible' });
  check('разговор с Лапиным идёт движком новеллы', (await page.locator('.vn-textbox__name').innerText()).length > 0);
  await page.click('.vn-qbtn--settings');
  await page.waitForSelector('.vn-settings');
  const caseQuick = await page.$$eval('.vn-settings__quick .vn-settings__qbtn', (els) => els.map((e) => e.dataset.action));
  check('в настройках во время разговора дела нет «Сохранить / Загрузить» (сейвы — у новеллы)', !caseQuick.includes('save') && !caseQuick.includes('load'), caseQuick.join(','));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.vn-settings', { state: 'detached' });
  check('…и заканчивается папкой', await talkToFolder(page));
  check('после разговора: Лапин в подозреваемых с портретом, копия договора в уликах, ★ 2', (await caseText(page, '.vn-case__name')).includes('Лапин') && (await page.locator('.vn-case__face:not(.is-unknown)').count()) === 1 && (await page.locator('.vn-case__star-n').innerText()) === '2');

  await page.reload({ waitUntil: 'networkidle' });
  await toMenu(page);
  check('после перезагрузки у эпизода «Начать заново» (прогресс дела сохранён)', (await page.locator('.vn-ep__restart').count()) === 1);
  await page.click('.vn-ep__open');
  await page.waitForSelector('.vn-case.is-in', { state: 'visible' });
  check('продолжение — сразу папка, без вступления: ★ 2, выполнено 2 задачи', (await page.locator('.vn-case__star-n').innerText()) === '2' && (await page.locator('.vn-case__task.is-done').count()) === 2);
  await page.click('.vn-case__menu');
  await toMenu(page);
  check('«В меню» из папки возвращает в главное меню', (await page.locator('.vn-case').count()) === 0);
  check('нет ошибок в консоли и неудачных запросов', log.errors.length === 0 && log.failed.length === 0, [...log.errors, ...log.failed].join(' | ').slice(0, 400));
  await context.close();

  // Телефон: папка и поиск без выхода за экран; на боку картинка поиска во всю высоту.
  for (const [name, width, height] of [['390x844', 390, 844], ['915x412', 915, 412]]) {
    const ph = await openPage(browser, baseUrl, `?debug=1&lang=ru&episode=${LEGACY}`, { viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU' });
    await toMenu(ph.page);
    await ph.page.click('.vn-ep__open');
    await ph.page.click('.vn-warning .vn-btn.is-primary');
    await ph.page.waitForSelector('.vn-textbox:not([hidden]) .vn-textbox__shown', { state: 'visible', timeout: 15000 });
    await talkToFolder(ph.page);
    await sleep(400);
    const folderBad = await ph.page.evaluate(layoutProbe);
    if (wantShots) {
      mkdirSync(OUT, { recursive: true });
      await ph.page.screenshot({ path: join(OUT, `case_${name}_folder.png`) });
    }
    await ph.page.click('.vn-case__task.is-open .vn-case__task-btn');
    await ph.page.waitForSelector('.mg-scene__list.is-targets .mg-scene__item', { state: 'visible' });
    await sleep(400);
    const searchBad = await ph.page.evaluate(layoutProbe);
    if (wantShots) await ph.page.screenshot({ path: join(OUT, `case_${name}_search.png`) });
    check(`${name}: папка и поиск держат вёрстку`, folderBad.length === 0 && searchBad.length === 0, [...folderBad, ...searchBad].join('; '));
    if (width > height) {
      const h = await ph.page.evaluate(() => document.querySelector('.mg-scene__stage').getBoundingClientRect().height);
      check(`${name}: на боку картинка поиска выше половины экрана`, h > height / 2, String(Math.round(h)));
    }
    check(`${name}: нет ошибок в консоли`, ph.log.errors.length === 0, ph.log.errors.join(' | ').slice(0, 200));
    await ph.context.close();
  }
}

// ───────────────────────────── «Ход следствия» ─────────────────────────────

/**
 * Пройти пробу «Хода следствия» по плану {id выбора → id опции | [опции по очереди]}: пробел на репликах, OK на бумагах,
 * цифра на выборе. На каждом шаге запоминает кадр монтажёра и зовёт onStep (скриншоты, проверки по ходу).
 */
async function playHod(page, plan, onStep = async () => undefined, max = 1500) {
  const seen = { shots: new Set(), choices: [], docs: 0, minigames: [] };
  const queue = Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  for (let i = 0; i < max; i++) {
    const p = await pending(page);
    const v = await page.evaluate(() => window.__vn.view());
    if (v?.shot) seen.shots.add(v.shot);
    if (!p) {
      await sleep(40);
      continue;
    }
    await onStep(p, v);
    if (p.kind === 'end') return { ...seen, end: p };
    if (p.kind === 'choice') {
      const want = queue[p.id]?.length > 1 ? queue[p.id].shift() : queue[p.id]?.[0];
      const idx = p.options.findIndex((o) => o.enabled && (!want || o.id === want));
      if (idx < 0) throw new Error(`playHod: на выборе ${p.id} нет опции ${want}: ${JSON.stringify(p.options)}`);
      seen.choices.push(`${p.id}=${p.options[idx].id}`);
      await page.keyboard.press(String(idx + 1));
      await page.waitForFunction((id) => {
        const q = window.__vn.pending();
        return !(q && q.kind === 'choice' && q.id === id);
      }, p.id);
      continue;
    }
    if (p.kind === 'minigame') {
      // осмотр: настоящие клики по зонам находок, затем «Далее»
      seen.minigames.push(p.id);
      await solveInspect(page);
      await page.waitForSelector('.mg-shell__btn.is-next', { state: 'visible', timeout: 10000 });
      await page.click('.mg-shell__btn.is-next');
      await page.waitForFunction((id) => window.__vn.pending()?.kind !== 'minigame' || window.__vn.pending()?.id !== id, p.id);
      continue;
    }
    if (p.kind === 'document') {
      seen.docs++;
      await page.waitForSelector('.vn-document .vn-actions .vn-btn', { state: 'visible' });
      await page.click('.vn-document .vn-actions .vn-btn');
      await sleep(80);
      continue;
    }
    if (p.kind === 'line') await page.keyboard.press('Space');
    await sleep(30);
  }
  throw new Error(`playHod: не дошли до конца за ${max} шагов; сейчас ${JSON.stringify(await pending(page))}`);
}

async function scenarioHod(browser, baseUrl) {
  section('Ход следствия (по умолчанию): меню → предупреждение → день 1 → вечер → день 2 → версия → реконструкция → конец');
  const { page, context, log } = await openPage(browser, baseUrl, '?debug=1', { locale: 'ru-RU' });
  await toMenu(page);
  await page.evaluate(() => window.__vn.settings({ textSpeed: 5, lang: 'ru' }));
  check('на полке один открытый эпизод', (await page.locator('.vn-ep.is-open').count()) === 1);
  await page.click('.vn-ep__open');
  await page.waitForSelector('.vn-warning', { state: 'visible' });
  await page.click('.vn-warning .vn-btn.is-primary');
  await page.waitForFunction(() => window.__vn.pending()?.kind === 'line', null, { timeout: 15000 });
  check('по умолчанию открывается «Ход следствия» (ep01_hod), без папки дела', (await stateOf(page)).episode_id === 'ep01_hod' && (await page.$('.vn-case')) === null);
  check('квик-меню: шесть кнопок, среди них «Блокнот»', (await page.locator('.vn-quick .vn-qbtn').count()) === 6 && (await page.locator('.vn-qbtn--notebook').count()) === 1);
  if (wantShots) mkdirSync(OUT, { recursive: true });
  const shot = async (name) => {
    if (wantShots) await page.screenshot({ path: join(OUT, `hod_1280_${name}.png`) });
  };

  const plan = {
    c_d1_go: 'galina', c_galina: 'human', c_galina_fear: 'promise', c_route_d1: 'notary', c_notary_bare: 'retreat',
    c_boss: 'push', c_d2_go1: 'flat', c_flat: 'truth', c_flat_photo: 'open', c_route_d2_4: 'bti', c_bti: 'plead',
    d_who: 'murashov', d_how: ['none', 'notary'], d_where: 'left',
  };
  const notes = { checked: false, firstChoice: null, deduction: false, layout: [] };
  const run = await playHod(page, plan, async (p, v) => {
    if (p.kind === 'choice' && !notes.firstChoice) {
      notes.firstChoice = p;
      notes.layout.push(...(await page.evaluate(layoutProbe)));
      await shot('choice_d1');
    }
    // Блокнот после Галины: факты разговора уже в нём
    if (!notes.checked && p.kind === 'choice' && p.id === 'c_route_d1') {
      notes.checked = true;
      await page.click('.vn-qbtn--notebook');
      await page.waitForSelector('.vn-archive', { state: 'visible' });
      const titles = await page.$$eval('.vn-archive__item h3', (els) => els.map((e) => e.textContent));
      notes.notebook = { title: await page.locator('.vn-archive .vn-card__title').textContent(), titles };
      await sleep(400); // экран проявляется
      notes.layout.push(...(await page.evaluate(layoutProbe)));
      await shot('notebook');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.vn-archive', { state: 'detached' });
    }
    if (p.kind === 'choice' && p.id === 'd_who' && !notes.deduction) {
      notes.deduction = true;
      notes.layout.push(...(await page.evaluate(layoutProbe)));
      await shot('deduction');
    }
    if (p.kind === 'line' && v?.scene === 'recon' && !notes.recon) {
      notes.recon = v.shot;
      await sleep(300);
      await shot('recon');
    }
  });
  check('первый выбор дня — куда ехать: три места', notes.firstChoice?.id === 'c_d1_go' && notes.firstChoice.options.length === 3, JSON.stringify(notes.firstChoice));
  check('блокнот открывается в игре и держит факты Галины', notes.notebook?.title === 'Блокнот' && notes.notebook.titles.includes('Галина: «Сергей Викторович»'), JSON.stringify(notes.notebook));
  check('маршрут пройден по плану до конца пробы (концовка e_proto)', run.end.ending === 'e_proto', run.choices.join(' → '));
  const st = await stateOf(page);
  check('итог: второй день, четыре места, неверный ход в версии стоил самообладания, бумаги показаны', st.vars.day === 2 && ['visited_galina', 'visited_notary', 'visited_flat', 'visited_bti'].every((k) => st.vars[k] === true) && st.vars.visited_zhek === false && st.vars.nerves === 2 && run.docs === 2,
    JSON.stringify({ day: st.vars.day, nerves: st.vars.nerves, docs: run.docs }));
  check('осмотр квартиры — мини-игра: найденное открыло свои факты (фото внука, очки) и вопрос нотариусу про очки доступен',
    run.minigames.includes('mg_flat_inspect') && st.vars.photo_seen === true && st.vars.glasses_found === true && st.archive.includes('n_glasses') && st.archive.includes('n_photo'),
    JSON.stringify({ mg: run.minigames, photo: st.vars.photo_seen, glasses: st.vars.glasses_found, archive: st.archive }));
  check('монтаж: кадры сменяются (больше 15 разных за проход), реконструкция в своём кадре', run.shots.size > 15 && /^sh_recon_/.test(notes.recon ?? ''), `${run.shots.size}: ${[...run.shots].join(', ')}`);
  await page.waitForSelector('.vn-ending', { state: 'visible' });
  check('экран концовки: «Версия есть»', (await page.locator('.vn-ending__title').textContent()) === 'Версия есть');
  await sleep(1200);
  await shot('end');
  check('вёрстка на 1280×720 цела (первый выбор, блокнот, версия)', notes.layout.length === 0, notes.layout.join('; '));
  check('нет ошибок в консоли и неудачных запросов', log.errors.length === 0 && log.failed.length === 0, [...log.errors, ...log.failed].join(' | ').slice(0, 400));
  await context.close();

  // Телефон: первая реплика и первый выбор не выходят за экран.
  for (const [name, width, height] of [['390x844', 390, 844], ['915x412', 915, 412]]) {
    const ph = await openPage(browser, baseUrl, '?debug=1&lang=ru', { viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ru-RU' });
    await toMenu(ph.page);
    await ph.page.evaluate(() => window.__vn.settings({ textSpeed: 5, lang: 'ru' }));
    await ph.page.click('.vn-ep__open');
    await ph.page.click('.vn-warning .vn-btn.is-primary');
    await ph.page.waitForFunction(() => window.__vn.pending()?.kind === 'line', null, { timeout: 15000 });
    await ph.page.waitForSelector('.vn-textbox:not([hidden])', { state: 'visible', timeout: 15000 }); // после плашек даты и места
    await sleep(400);
    const lineBad = await ph.page.evaluate(layoutProbe);
    if (wantShots) await ph.page.screenshot({ path: join(OUT, `hod_${name}_line.png`) });
    await advanceUntil(ph.page, (p) => p.kind === 'choice' || p.kind === 'document');
    if ((await pending(ph.page)).kind === 'document') {
      await sleep(300);
      if (wantShots) await ph.page.screenshot({ path: join(OUT, `hod_${name}_doc.png`) });
      await ph.page.click('.vn-document .vn-actions .vn-btn');
    }
    await advanceUntil(ph.page, (p) => p.kind === 'choice');
    await sleep(400);
    const choiceBad = await ph.page.evaluate(layoutProbe);
    if (wantShots) await ph.page.screenshot({ path: join(OUT, `hod_${name}_choice.png`) });
    check(`${name}: реплика, бумага и выбор держат вёрстку`, lineBad.length === 0 && choiceBad.length === 0, [...lineBad, ...choiceBad].join('; '));
    check(`${name}: нет ошибок в консоли`, ph.log.errors.length === 0, ph.log.errors.join(' | ').slice(0, 200));
    await ph.context.close();
  }
}

// ───────────────────────────── запуск ─────────────────────────────

const server = await startServer();
const browser = await launchBrowser();
try {
  console.log(`Смоук-тест: ${server.url}${remoteUrl ? '' : ` (сборка ${distDir})`}`);
  if (wants('hod')) await scenarioHod(browser, server.url);
  if (wants('play')) await scenarioPlay(browser, server.url);
  if (wants('case')) await scenarioCase(browser, server.url);
  if (wants('camera')) await scenarioCamera(browser, server.url);
  if (wants('bridge')) await scenarioBridgeSdk(browser, server.url);
  if (wantMatrix && wants('matrix')) await scenarioMatrix(browser, server.url);
} catch (e) {
  failures.push(`исключение: ${e.message}`);
  console.error(e);
} finally {
  await browser.close();
  await server.close();
}
console.log(`\n${failures.length === 0 ? 'ВСЁ В ПОРЯДКЕ' : `ПРОВАЛЫ (${failures.length}): ${failures.join('; ')}`} — проверок пройдено: ${passed}`);
process.exit(failures.length === 0 ? 0 : 1);
