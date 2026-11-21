// Проверка конструктора задержанных (src/chargen.js и страница constructor.html):
//   — у каждого вида, детали и варианта есть подпись dz.cg.*;
//   — 60 случайных персонажей каждого вида и каждый вариант каждой детали рисуются без NaN и undefined;
//   — одно зерно всегда даёт одного и того же персонажа; normalize не меняет уже полный spec;
//   — у каждого кадра картотеки (src/cast.js) есть файл и полное описание; готовый кадр показывается в окне, пока детали не тронуты;
//   — страница открывается на телефоне и на широком экране без ошибок и прокрутки вбок, области касания не меньше 44 pt,
//     кнопки и списки меняют персонажа.
//   node test/chargen.mjs [--dist]
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const fail = (msg) => { console.error('ОШИБКА: ' + msg); process.exit(1); };

const box = { console }; box.window = box; box.globalThis = box;
vm.createContext(box);
for (const f of ['src/chargen_strings_ru.js', 'src/chargen.js', 'src/cast.js']) vm.runInContext(readFileSync(join(here, '..', f), 'utf8'), box, { filename: f });
const CG = box.DZ.chargen, RU = box.DZ.strings.ru;

const missing = [];
for (const p of CG.PARTS) { if (!RU['dz.cg.part.' + p]) missing.push('part.' + p); for (const o of CG.OPTIONS[p]) if (!RU[`dz.cg.${p}.${o}`]) missing.push(`${p}.${o}`); }
for (const id in CG.SPECIES) { if (!RU['dz.cg.species.' + id]) missing.push('species.' + id); if (CG.KINDS.indexOf(CG.SPECIES[id].kind) < 0) missing.push('kind of ' + id); }
if (missing.length) fail('нет подписей: ' + missing.join(', '));

const bad = (svg) => /NaN|undefined|Infinity/.test(svg) || !svg.startsWith('<svg') || !svg.endsWith('</svg>');
let drawn = 0;
for (const id in CG.SPECIES) {
  for (let i = 1; i <= 60; i++) {
    const spec = CG.random(i * 977 + id.length, id), svg = CG.svg(spec, { bg: 'lobby', uid: 't' });
    if (bad(svg)) fail(`кривой рисунок: ${id}, зерно ${spec.seed}`);
    if (svg !== CG.svg(spec, { bg: 'lobby', uid: 't' })) fail(`рисунок не повторяется: ${id}, зерно ${spec.seed}`);
    if (JSON.stringify(CG.normalize(spec)) !== JSON.stringify(spec)) fail(`normalize меняет полный spec: ${id}`);
    if (JSON.stringify(CG.random(spec.seed, id)) !== JSON.stringify(spec)) fail(`зерно не повторяет персонажа: ${id}`);
    for (const p of CG.PARTS) if (CG.OPTIONS[p].indexOf(spec[p]) < 0) fail(`неизвестный вариант ${p}=${spec[p]} у ${id}`);
    if (CG.prompt(spec).length < 200) fail(`пустое описание: ${id}`);
    drawn++;
  }
  const base = CG.random(7, id);
  for (const p of CG.PARTS) for (const o of CG.OPTIONS[p]) { if (bad(CG.svg(Object.assign({}, base, { [p]: o }), { uid: 't' }))) fail(`кривой рисунок: ${id}, ${p}=${o}`); drawn++; }
}

const CAST = box.DZ.cast;
if (!CAST.length) fail('картотека пуста');
for (const c of CAST) {
  if (!existsSync(join(here, '..', c.img))) fail(`нет файла кадра ${c.img}`);
  if (JSON.stringify(CG.normalize(c.spec)) !== JSON.stringify(c.spec)) fail(`неполное описание кадра ${c.id}`);
}

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(join(here, '..', '..', 'runtime', 'node_modules', 'playwright-core'))); }
const url = pathToFileURL(join(here, '..', process.argv.includes('--dist') ? 'dist/constructor.html' : 'constructor.html')).href;
const browser = await chromium.launch();
try {
  for (const [label, viewport] of [['телефон 390×844', { width: 390, height: 844 }], ['малый телефон 360×640', { width: 360, height: 640 }], ['широкий 1280×800', { width: 1280, height: 800 }]]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    const who = () => page.textContent('#cg-who');
    if (!(await page.locator('#cg-frame img').count())) fail(`${label}: страница не открывается готовым кадром`);
    await page.click('[data-act="shot"][data-id="1"]');
    if (!(await who()).includes(CAST[1].id) || !(await page.locator('#cg-frame img').count())) fail(`${label}: кадр из картотеки не открывается`);
    await page.click('[data-act="mood"][data-id="calm"]');
    if (!(await page.locator('#cg-frame svg').count())) fail(`${label}: после правки детали не показан эскиз`);
    const first = await who();
    await page.click('[data-act="random"]');
    if ((await who()) === first) fail(`${label}: «Случайный» не меняет персонажа`);
    await page.click('[data-act="kind"][data-id="myth"]');
    await page.selectOption('#cg-species', 'gorynych');
    if (!(await who()).startsWith(RU['dz.cg.species.gorynych'])) fail(`${label}: вид не выбирается из списка`);
    for (const m of CG.OPTIONS.mood) await page.click(`[data-act="mood"][data-id="${m}"]`);
    for (const p of CG.PARTS) if (p !== 'mood') for (const o of CG.OPTIONS[p]) await page.selectOption('#cg-' + p, String(o));
    await page.click('[data-act="thumb"][data-id="3"]');
    await page.click('[data-act="queue"]');
    for (const tab of ['prompt', 'svg', 'data']) { await page.click(`[data-act="tab"][data-id="${tab}"]`); if ((await page.inputValue('#cg-out')).length < 100) fail(`${label}: пустая выгрузка «${tab}»`); }
    const report = await page.evaluate(() => {
      const out = [];
      if (document.querySelectorAll('#cg-shots img').length !== window.DZ.cast.length) out.push('нет кадров картотеки');
      for (const el of document.querySelectorAll('#cg button, #cg select, #cg label.cg-check')) { const r = el.getBoundingClientRect(); if (r.width < 43.5 || r.height < 43.5) out.push(`касание ${Math.round(r.width)}×${Math.round(r.height)}: ${el.textContent.trim().slice(0, 20)}`); }
      if (document.documentElement.scrollWidth > window.innerWidth) out.push('горизонтальная прокрутка');
      if (/dz\.cg\./.test(document.getElementById('cg').innerText)) out.push('сырой ключ в тексте');
      if (document.querySelectorAll('#cg-thumbs svg').length !== 12 || !document.querySelector('#cg-frame svg')) out.push('нет рисунков');
      return out;
    });
    if (errors.length) fail(`${label}: ошибки в консоли: ${errors.slice(0, 3).join(' | ')}`);
    if (report.length) fail(`${label}: ${report.slice(0, 6).join('; ')}`);
    await page.close();
  }
} finally { await browser.close(); }
console.log(`Конструктор проверен: ${Object.keys(CG.SPECIES).length} видов, ${drawn} эскизов, ${CAST.length} кадров в картотеке, страница на трёх экранах.`);
