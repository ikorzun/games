// Смоук «Дежурной части» в Chromium: проходит смену целиком и проверяет итог.
//   node test/smoke.mjs                 — телефон и широкий экран, верные решения, затем все неверные
//   node test/smoke.mjs --dist          — то же по собранному dist/index.html
//   node test/smoke.mjs --shots DIR     — и скриншоты ключевых экранов в DIR
// Нужен Playwright с Chromium (playwright или playwright-core из ../runtime).
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  ({ chromium } = require(join(here, '..', '..', 'runtime', 'node_modules', 'playwright-core')));
}

const shotsAt = process.argv.indexOf('--shots');
const shots = shotsAt >= 0 ? resolve(process.argv[shotsAt + 1]) : null;
if (shots) mkdirSync(shots, { recursive: true });
const page0 = process.argv.includes('--dist') ? join(here, '..', 'dist', 'index.html') : join(here, '..', 'index.html');
const url = pathToFileURL(page0).href;

let failed = 0;
const check = (ok, what) => { if (!ok) { failed++; console.error('  FAIL', what); } };

async function run(browser, name, viewport, mode) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: shots ? 2 : 1, reducedMotion: 'reduce', hasTouch: viewport.width < 800 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  const snap = async (tag) => { if (shots) await page.screenshot({ path: join(shots, `${name}-${tag}.png`) }); };
  const noOverflow = async (tag) => check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name}: горизонтальная прокрутка (${tag})`);
  const isPhoto = () => page.evaluate(() => document.querySelector('.dz-app').classList.contains('is-photo'));
  const primaryInView = async (tag) => check(await page.evaluate(() => {
    const b = document.querySelector('.dz-actions button'); if (!b) return false;
    const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight + 1;
  }), `${name}: главное действие видно без прокрутки (${tag})`);

  const cases = await page.evaluate(() => window.DZ.cases.map((c) => ({ id: c.id, verdict: c.verdict, grounds: c.grounds, items: c.items.map((i) => ({ id: i.id, views: i.views.length })) })));
  await snap('00-intro');
  await noOverflow('intro');
  await primaryInView('начало');
  await page.click('[data-act="start"]');

  for (let n = 0; n < cases.length; n++) {
    const c = cases[n];
    check((await page.textContent('.dz-bar-main')).trim() === `Задержанный ${n + 1} из ${cases.length}`, `${name}: шапка на деле ${c.id}`);
    if (n === 0) {
      await snap('01-talk');
      await primaryInView('реплики');
      if (await page.evaluate(() => !!window.DZ.PHOTO_LOBBY)) {
        check(await isPhoto(), `${name}: по умолчанию графика «Фото»`);
        check(await page.evaluate(() => { const i = document.querySelector('.dz-photo-det'); return !!i.getAttribute('href') && i.getBBox().width > 0; }), `${name}: фото-кадр задержанного подставлен`);
        await page.click('#dz-menu');
        await snap('01a-settings');
        await page.click('[data-act="pref"][data-id="photo"][data-value="0"]');
        check(!(await isPhoto()), `${name}: настройка «Графика: рисованная»`);
        await page.click('.dz-dialog [data-act="close"]');
        await snap('01b-drawn');
        await page.click('#dz-menu');
        await page.click('[data-act="pref"][data-id="photo"][data-value="1"]');
        await page.keyboard.press('Escape');
        check(await isPhoto(), `${name}: настройка «Графика: фото» вернулась`);
        check(!(await page.isVisible('.dz-modal')), `${name}: Escape закрывает настройки`);
      }
    }
    while (await page.locator('[data-act="next"]').count()) await page.click('[data-act="next"]');
    check((await page.locator('.dz-item').count()) === c.items.length, `${name}: вещи в лотке, дело ${c.id}`);
    if (n === 0 || n === 3) { await snap(`02-tray-${c.id}`); await primaryInView(`осмотр ${c.id}`); }
    for (const it of c.items) {
      await page.click(`.dz-item[data-id="${it.id}"]`);
      check(await page.isVisible('.dz-sheet'), `${name}: вещь ${c.id}.${it.id} открылась`);
      check(await page.evaluate(() => { const w = document.querySelector('.dz-window').getBoundingClientRect(); const s = document.querySelector('.dz-sheet-in').getBoundingClientRect(); return s.top >= w.bottom - 1 || s.left >= w.right - 1; }), `${name}: лист не закрывает окно (${c.id}.${it.id})`);
      check((await page.locator('.dz-sheet [data-act="view"]').count()) === 0, `${name}: у вещи нет переключателя видов (${c.id}.${it.id})`);
      if (it.id === 'passport') check((await page.locator('.dz-sheet .dz-f').count()) >= 4, `${name}: паспорт открывается сразу с данными (${c.id})`);
      if (c.id === 'c02' && it.id === 'radio') check((await page.textContent('.dz-sheet')).includes('0417'), `${name}: магнитола открывается сразу с заводским номером`);
      if (c.id === 'c05' && it.id === 'wallet') check((await page.textContent('.dz-sheet')).includes('Сомова'), `${name}: бумажник открывается сразу с содержимым`);
      if (c.id === 'c05' && it.id === 'watch') check((await page.textContent('.dz-sheet')).includes('от коллектива'), `${name}: часы открываются сразу с гравировкой`);
      if (await page.locator('.dz-sheet [data-act="ask"]').count()) {
        await page.click('.dz-sheet [data-act="ask"]');
        check(await page.isVisible('.dz-sheet .dz-qa'), `${name}: ответ на вопрос в листе (${c.id}.${it.id})`);
      }
      if (mode === 'bad' && (await page.locator('.dz-sheet [data-act="bribe"]').count())) await page.click('.dz-sheet [data-act="bribe"]');
      if ((n === 0 && it.id === 'passport') || (n === 1 && it.id === 'radio') || (n === 4 && it.id === 'wallet') || (n === 6 && it.id === 'passport')) await snap(`03-item-${c.id}-${it.id}`);
      await noOverflow(`${c.id}.${it.id}`);
      await page.click('.dz-sheet [data-act="close"]');
    }
    check((await page.locator('.dz-item.is-seen').count()) === c.items.length, `${name}: отметки «осмотрено», дело ${c.id}`);
    check((await page.textContent('#dz-tray-note')).trim() === `Осмотрено ${c.items.length} из ${c.items.length}`, `${name}: счётчик осмотренного, дело ${c.id}`);
    if (n === 0 && viewport.width < 800) {          // лист убирается жестом вниз за ручку, не только кнопкой
      await page.click('.dz-paperbtn[data-id="memo"]');
      const box = await page.locator('.dz-sheet-title').boundingBox();
      await page.mouse.move(box.x + 20, box.y + 10);
      await page.mouse.down();
      await page.mouse.move(box.x + 20, box.y + 140, { steps: 6 });
      await page.mouse.up();
      check(!(await page.isVisible('.dz-sheet')), `${name}: лист убирается жестом вниз`);
    }
    for (const d of ['report', 'bulletin', 'memo']) {
      await page.click(`.dz-paperbtn[data-id="${d}"]`);
      if (n === 0) await snap(`04-doc-${d}`);
      if (n === 0 && d === 'bulletin' && viewport.width < 800) {
        const h0 = await page.evaluate(() => document.querySelector('.dz-sheet').getBoundingClientRect().height);
        await page.click('.dz-sheet [data-act="size"]');
        await page.waitForTimeout(50);
        const h1 = await page.evaluate(() => document.querySelector('.dz-sheet').getBoundingClientRect().height);
        check(h1 > h0 + 40, `${name}: ручка разворачивает лист (${Math.round(h0)} → ${Math.round(h1)})`);
        await snap('04-doc-bulletin-large');
      }
      await page.click('.dz-sheet [data-act="close"]');
    }
    if (n === 5) {
      const zoomed = () => page.evaluate(() => document.querySelector('.dz-app').classList.contains('is-zoomed'));
      await page.click('#dz-zoom'); await page.waitForTimeout(50); await snap('05-zoom'); await page.click('#dz-zoom');
      await page.click('.dz-scene');
      await page.waitForTimeout(450);
      check(!(await zoomed()), `${name}: одиночное касание окна ничего не приближает`);
      await page.dblclick('.dz-scene');
      check(await zoomed(), `${name}: двойное касание окна приближает`);
      await page.waitForTimeout(450);
      await page.dblclick('.dz-scene');
      check(!(await zoomed()), `${name}: двойное касание окна отдаляет`);
      await page.waitForTimeout(450);
      const pinchBy = (from, to) => page.evaluate(([a, b]) => {
        const sc = document.querySelector('.dz-scene'); const r = sc.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const fire = (type, id, x) => sc.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: cy, bubbles: true }));
        fire('pointerdown', 11, cx - a); fire('pointerdown', 12, cx + a); fire('pointermove', 11, cx - b); fire('pointermove', 12, cx + b); fire('pointerup', 11, cx - b); fire('pointerup', 12, cx + b);
      }, [from, to]);
      await pinchBy(30, 70);
      check(await zoomed(), `${name}: щипок наружу приближает`);
      await pinchBy(70, 30);
      check(!(await zoomed()), `${name}: щипок внутрь отдаляет`);
      await page.waitForTimeout(450);
    }

    const guilty = c.verdict === 'cell';
    const goCell = mode === 'good' ? guilty : !guilty;
    if (goCell) {
      await page.click('#dz-cell');
      if (n === 1) await snap('06-grounds');
      await page.click(`[data-act="ground"][data-id="${guilty ? c.grounds[0] : 'weapon'}"]`);
    } else await page.click('#dz-home');
    await page.waitForSelector('.dz-verdict');
    const grade = await page.evaluate(() => window.DZ.state.results[window.DZ.state.results.length - 1].grade);
    check(grade === (mode === 'good' ? 'ok' : 'bad'), `${name}: оценка дела ${c.id} = ${grade}`);
    check(!(await page.textContent('.dz-explain')).includes('dz.'), `${name}: пояснение без сырого ключа, дело ${c.id}`);
    if (n === 1 || n === 2) { await snap(`07-verdict-${c.id}`); await primaryInView(`итог ${c.id}`); }
    await noOverflow(`verdict ${c.id}`);
    await page.click('[data-act="continue"]');
  }

  await page.waitForSelector('.dz-ledger');
  const score = (await page.textContent('.dz-score b')).trim();
  check(score === (mode === 'good' ? `${cases.length} из ${cases.length}` : `0 из ${cases.length}`), `${name}: итог «${score}»`);
  check((await page.locator('.dz-rows .dz-row').count()) === cases.length, `${name}: строк в книге учёта`);
  const raw = await page.evaluate(() => document.getElementById('dz').innerText.match(/dz\.[a-z0-9_.]+/g));
  check(!raw, `${name}: сырые ключи на экране: ${raw}`);
  await snap('08-end');
  await noOverflow('end');
  await page.click('[data-act="again"]');
  check((await page.textContent('.dz-bar-main')).trim() === `Задержанный 1 из ${cases.length}`, `${name}: смена начинается заново`);
  if (mode === 'good' && viewport.width < 800) {   // ход смены переживает перезагрузку страницы
    while (await page.locator('[data-act="next"]').count()) await page.click('[data-act="next"]');
    await page.click('#dz-home');
    await page.waitForSelector('.dz-verdict');
    await page.reload();
    await page.waitForSelector('.dz-bar-main');
    check((await page.textContent('.dz-bar-main')).trim() === `Задержанный 2 из ${cases.length}`, `${name}: после перезагрузки смена продолжается со второго задержанного`);
    await page.click('#dz-menu');
    await page.click('[data-act="help"]');
    check((await page.locator('.dz-dialog .dz-steps li').count()) === 3, `${name}: справка «Как играть» в настройках`);
    await snap('09-help');
    await page.click('.dz-dialog [data-act="close"]');
    await page.click('#dz-menu');
    await page.click('[data-act="restart"]');
    await snap('10-restart');
    await page.click('[data-act="restart-yes"]');
    check((await page.textContent('.dz-bar-main')).trim() === `Задержанный 1 из ${cases.length}`, `${name}: «Начать смену заново» после подтверждения`);
    await page.reload();
    await page.waitForSelector('[data-act="start"]');
    check(true, `${name}: после сброса игра открывается с начала`);
  }
  check(errors.length === 0, `${name}: ошибки в консоли: ${errors.join(' | ')}`);
  await ctx.close();
  console.log(`${name} (${mode}): пройдено дел ${cases.length}, верных решений ${score}`);
}

const browser = await chromium.launch();
try {
  await run(browser, 'phone', { width: 390, height: 760 }, 'good');
  await run(browser, 'wide', { width: 1280, height: 800 }, 'good');
  await run(browser, 'phone-bad', { width: 390, height: 760 }, 'bad');
} finally {
  await browser.close();
}
if (failed) { console.error(`\nПровалено проверок: ${failed}`); process.exit(1); }
console.log('\nСмоук пройден.');
