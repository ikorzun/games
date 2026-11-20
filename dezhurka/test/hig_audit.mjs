// Проверка интерфейса «Дежурной части» по числам Apple HIG (см. README, раздел «Интерфейс»):
//   — область касания не меньше 44×44 pt;
//   — текст не мельче 11 pt;
//   — контраст текста с фоном не ниже 4,5:1 (для крупного текста от 18 pt или от 14 pt жирного — 3:1);
//   — нет горизонтальной прокрутки, в том числе при размере текста 200 %.
// Скрипт проходит экраны игры на телефоне и на широком экране и печатает нарушения.
//   node test/hig_audit.mjs [--dist] [--report]     (--report: не падать, только список)
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  ({ chromium } = require(join(here, '..', '..', 'runtime', 'node_modules', 'playwright-core')));
}
const url = pathToFileURL(join(here, '..', process.argv.includes('--dist') ? 'dist/index.html' : 'index.html')).href;
const reportOnly = process.argv.includes('--report');

const MIN_TAP = 44, MIN_TEXT = 11;

// Выполняется в странице: собирает нарушения на текущем экране.
function collect({ MIN_TAP, MIN_TEXT }) {
  const out = [];
  const visible = (el) => {
    if (el.closest('[hidden], [inert]')) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const name = (el) => (el.id ? '#' + el.id : '.' + String(el.className && el.className.baseVal != null ? el.className.baseVal : el.className).trim().split(/\s+/).join('.')) +
    ' «' + (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28) + '»';

  // 1. области касания
  for (const el of document.querySelectorAll('#dz button, #dz a, #dz [role="button"], #dz input, #dz select')) {
    if (!visible(el) || el.disabled) continue;
    const r = el.getBoundingClientRect();
    if (r.width < MIN_TAP - 0.5 || r.height < MIN_TAP - 0.5) out.push(`касание ${Math.round(r.width)}×${Math.round(r.height)}: ${name(el)}`);
  }

  // 2 и 3. размер текста и контраст
  const parse = (c) => { const m = c.match(/[\d.]+/g); return m ? m.slice(0, 4).map(Number) : [0, 0, 0, 0]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (top, a, bottom) => top.map((v, i) => v * a + bottom[i] * (1 - a));
  const backdrop = (el) => {
    const stack = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      const a = c.length > 3 ? c[3] : 1;
      if (a > 0) stack.push([c.slice(0, 3), a]);
      if (a >= 0.999) break;
    }
    let col = [17, 19, 18];
    for (let i = stack.length - 1; i >= 0; i--) col = over(stack[i][0], stack[i][1], col);
    return col;
  };
  const seen = new Set();
  const walker = document.createTreeWalker(document.getElementById('dz'), NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue.trim()) continue;
    const el = node.parentElement;
    if (!el || seen.has(el) || el.closest('svg') || !visible(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    if (size < MIN_TEXT - 0.01) out.push(`текст ${size}px: ${name(el)}`);
    const disabled = el.closest('button:disabled');
    if (disabled) continue;                        // недоступные элементы намеренно приглушены
    let fg = parse(cs.color);
    const bg = backdrop(el);
    let alpha = fg.length > 3 ? fg[3] : 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) alpha *= Number(getComputedStyle(n).opacity);
    fg = over(fg.slice(0, 3), alpha, bg);
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 600) || (size >= 18 && cs.fontFamily.includes('Oswald'));
    const need = large ? 3 : 4.5;
    if (ratio < need - 0.02) out.push(`контраст ${ratio.toFixed(2)}:1 (нужно ${need}): ${name(el)} ${cs.color} на rgb(${bg.map(Math.round).join(', ')})`);
  }
  if (document.documentElement.scrollWidth > window.innerWidth) out.push('горизонтальная прокрутка страницы');
  return out;
}

async function audit(browser, label, viewport, textStep) {
  const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce', hasTouch: true });
  if (textStep) await ctx.addInitScript((step) => { try { localStorage.setItem('dezhurka.prefs.v1', JSON.stringify({ text: step })); } catch (e) { /* без хранилища */ } }, textStep);
  const page = await ctx.newPage();
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  const found = [];
  const shot = async (screen) => { for (const v of await page.evaluate(collect, { MIN_TAP, MIN_TEXT })) found.push(`[${label} · ${screen}] ${v}`); };
  const click = (sel) => page.click(sel);
  const closeSheet = async () => { if (await page.locator('[data-act="close"]:visible').count()) await page.locator('[data-act="close"]:visible').first().click(); };

  await shot('начало');
  await click('[data-act="start"]');
  await shot('реплики');
  while (await page.locator('[data-act="next"]:visible').count()) await click('[data-act="next"]:visible');
  await shot('осмотр');
  const cases = await page.evaluate(() => window.DZ.cases.map((c) => ({ id: c.id, verdict: c.verdict, grounds: c.grounds, items: c.items.map((i) => ({ id: i.id, views: i.views.length })) })));
  for (let n = 0; n < cases.length; n++) {
    const c = cases[n];
    if (n > 0) while (await page.locator('[data-act="next"]:visible').count()) await click('[data-act="next"]:visible');
    for (const it of c.items) {
      await click(`[data-act="item"][data-id="${it.id}"]`);
      await shot(`${c.id}.${it.id}`);
      for (let v = 1; v < it.views; v++) {
        if (await page.locator(`[data-act="view"][data-id="${v}"]`).count()) await click(`[data-act="view"][data-id="${v}"]`); else await click('[data-act="view"]');
        await shot(`${c.id}.${it.id} вид ${v}`);
      }
      if (await page.locator('[data-act="ask"]:visible').count()) { await click('[data-act="ask"]:visible'); await shot(`${c.id}.${it.id} ответ`); }
      await closeSheet();
    }
    if (n === 0) for (const d of ['report', 'bulletin', 'memo']) { await click(`[data-act="doc"][data-id="${d}"]`); await shot(`бумага ${d}`); await closeSheet(); }
    if (n === 0 && (await page.locator('[data-act="menu"]:visible').count())) { await click('[data-act="menu"]:visible'); await shot('настройки'); await closeSheet(); }
    if (c.verdict === 'cell') {
      await click('[data-act="cell"]');
      if (n === 1) await shot('основание');
      await click(`[data-act="ground"][data-id="${c.grounds[0]}"]`);
    } else await click('[data-act="home"]');
    await page.waitForSelector('[data-act="continue"]');
    if (n < 3) await shot(`итог ${c.id}`);
    await click('[data-act="continue"]');
  }
  await page.waitForSelector('[data-act="again"]');
  await shot('конец смены');
  await ctx.close();
  return found;
}

const browser = await chromium.launch();
let all = [];
try {
  all = all.concat(await audit(browser, 'телефон 390×760', { width: 390, height: 760 }));
  all = all.concat(await audit(browser, 'малый телефон 360×640', { width: 360, height: 640 }));
  all = all.concat(await audit(browser, 'широкий 1280×800', { width: 1280, height: 800 }));
  all = all.concat(await audit(browser, 'малый телефон, текст 200 %', { width: 360, height: 640 }, 3));
} finally { await browser.close(); }

const uniq = [...new Set(all.map((s) => s.replace(/^\[[^\]]*\] /, '')))];
if (all.length) {
  console.log(`Нарушений: ${all.length} (разных: ${uniq.length})`);
  const byKind = {};
  for (const s of all) { const k = s.replace(/^\[[^\]]*\] /, '').split(/[ :]/)[0]; byKind[k] = (byKind[k] || 0) + 1; }
  console.log(Object.entries(byKind).map(([k, v]) => `${k}: ${v}`).join(', '));
  for (const s of all.slice(0, process.argv.includes('--all') ? 1e9 : 60)) console.log('  ' + s);
  if (!reportOnly) process.exit(1);
} else console.log('Нарушений нет: касания ≥ 44 pt, текст ≥ 11 pt, контраст в норме, горизонтальной прокрутки нет.');
