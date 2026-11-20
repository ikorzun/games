// Смоук «Дежурной части» в Chromium: проходит смену целиком и проверяет итог.
//   node test/smoke.mjs                 — телефон и широкий экран, верные решения, затем все неверные
//   node test/smoke.mjs --shots DIR     — то же и скриншоты ключевых экранов в DIR
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
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: shots ? 2 : 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  const snap = async (tag) => { if (shots) await page.screenshot({ path: join(shots, `${name}-${tag}.png`) }); };
  const noOverflow = async (tag) => check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name}: горизонтальная прокрутка (${tag})`);

  const cases = await page.evaluate(() => window.DZ.cases.map((c) => ({ id: c.id, verdict: c.verdict, grounds: c.grounds, items: c.items.map((i) => ({ id: i.id, views: i.views.length })) })));
  await snap('00-intro');
  await noOverflow('intro');
  await page.click('[data-act="start"]');

  for (let n = 0; n < cases.length; n++) {
    const c = cases[n];
    check((await page.textContent('.dz-count')).trim() === `${n + 1} из ${cases.length}`, `${name}: счётчик на деле ${c.id}`);
    if (n === 0) await snap('01-talk');
    if (n === 0) {
      const hasPhoto = await page.evaluate(() => !!window.DZ.PHOTO_LOBBY);
      if (hasPhoto) {
        check(await page.evaluate(() => document.querySelector('.dz-app').classList.contains('is-photo')), `${name}: по умолчанию режим «фото»`);
        check(await page.evaluate(() => { const i = document.querySelector('.dz-photo-det'); return !!i.getAttribute('href') && i.getBBox().width > 0; }), `${name}: фото-кадр задержанного подставлен`);
        await page.click('#dz-gfx');
        check(await page.evaluate(() => !document.querySelector('.dz-app').classList.contains('is-photo')), `${name}: переключение на рисованную графику`);
        await snap('01b-drawn');
        await page.click('#dz-gfx');
      }
    }
    while (await page.isVisible('#dz-next')) await page.click('#dz-next');
    check((await page.locator('.dz-item').count()) === c.items.length, `${name}: вещи в лотке, дело ${c.id}`);
    if (n === 0 || n === 3) await snap(`02-tray-${c.id}`);
    for (const it of c.items) {
      await page.click(`.dz-item[data-id="${it.id}"]`);
      check(await page.isVisible('.dz-sheet'), `${name}: вещь ${c.id}.${it.id} открылась`);
      for (let v = 1; v < it.views; v++) await page.click('.dz-sheet [data-act="view"]');
      if (await page.locator('.dz-sheet [data-act="ask"]').count()) await page.click('.dz-sheet [data-act="ask"]');
      if (mode === 'bad' && (await page.locator('.dz-sheet [data-act="bribe"]').count())) await page.click('.dz-sheet [data-act="bribe"]');
      if ((n === 0 && it.id === 'passport') || (n === 1 && it.id === 'radio') || (n === 4 && it.id === 'wallet') || (n === 6 && it.id === 'passport')) await snap(`03-item-${c.id}-${it.id}`);
      await noOverflow(`${c.id}.${it.id}`);
      await page.click('.dz-sheet [data-act="close"]');
    }
    check((await page.locator('.dz-item.is-seen').count()) === c.items.length, `${name}: отметки «осмотрено», дело ${c.id}`);
    for (const d of ['report', 'bulletin', 'memo']) {
      await page.click(`.dz-docbtn[data-id="${d}"]`);
      if (n === 0) await snap(`04-doc-${d}`);
      await page.click('.dz-sheet [data-act="close"]');
    }
    if (n === 5) { await page.click('#dz-zoom'); await page.waitForTimeout(50); await snap('05-zoom'); await page.click('#dz-zoom'); }

    const guilty = c.verdict === 'cell';
    const goCell = mode === 'good' ? guilty : !guilty;
    if (goCell) {
      await page.click('#dz-cell');
      if (n === 1) await snap('06-grounds');
      await page.click(`[data-act="ground"][data-id="${guilty ? c.grounds[0] : 'weapon'}"]`);
    } else await page.click('#dz-home');
    await page.waitForSelector('.dz-card--verdict');
    const grade = await page.evaluate(() => window.DZ.state.results[window.DZ.state.results.length - 1].grade);
    check(grade === (mode === 'good' ? 'ok' : 'bad'), `${name}: оценка дела ${c.id} = ${grade}`);
    check(!(await page.textContent('.dz-note')).includes('dz.'), `${name}: пояснение без сырого ключа, дело ${c.id}`);
    if (n === 1 || n === 2) await snap(`07-verdict-${c.id}`);
    await noOverflow(`verdict ${c.id}`);
    await page.click('[data-act="continue"]');
  }

  await page.waitForSelector('.dz-card--end');
  const score = (await page.textContent('.dz-score')).trim();
  check(score.endsWith(mode === 'good' ? `${cases.length} из ${cases.length}` : `0 из ${cases.length}`), `${name}: итог «${score}»`);
  check((await page.locator('.dz-ledger tbody tr').count()) === cases.length, `${name}: строк в книге учёта`);
  const raw = await page.evaluate(() => document.getElementById('dz').innerText.match(/dz\.[a-z0-9_.]+/g));
  check(!raw, `${name}: сырые ключи на экране: ${raw}`);
  await snap('08-end');
  await noOverflow('end');
  await page.click('[data-act="again"]');
  check((await page.textContent('.dz-count')).trim() === `1 из ${cases.length}`, `${name}: смена начинается заново`);
  check(errors.length === 0, `${name}: ошибки в консоли: ${errors.join(' | ')}`);
  await ctx.close();
  console.log(`${name} (${mode}): пройдено дел ${cases.length}, итог «${score}»`);
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
