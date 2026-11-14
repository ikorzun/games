#!/usr/bin/env node
/**
 * Проверка собранного архива (`npm run build` вызывает её автоматически).
 * Требования Playgama (docs/platform/playgama-constraints.md). Скопировано из runtime/scripts с адаптацией:
 *   - index.html лежит в корне архива;
 *   - имена файлов и папок — только латиница [A-Za-z0-9_.-] (и «/» как разделитель);
 *   - никаких внешних ресурсов в index.html и CSS (http:// и https:// в src/href/url());
 *   - ядро (всё, кроме игровых ассетов) ≤ 5 МБ; весь архив ≤ 300 МБ;
 *   - звук: в сборке либо весь набор из audio/manifest.json (audio/<id>_<n>.mp3), либо ничего;
 *     неполный набор — ошибка, отсутствие — предупреждение (VZ_REQUIRE_AUDIO=1 делает его ошибкой);
 *   - плакаты: у каждого листа из assets/posters/<id>.webp в сборке есть свой файл assets/<id>-<хеш>.webp —
 *     без него на стене висел бы пустой лист;
 *   - игровые ассеты (графика и звук: assets/<папка>/… и audio/…) считаются отдельной строкой: больше 40 МБ —
 *     предупреждение (грузить игру станет долго), общий лимит архива 300 МБ — жёсткий.
 *     Файлы бандла Vite лежат в assets/ плоско (assets/index-<хеш>.js) и входят в ядро.
 * Выход: код 0 — всё в порядке (предупреждения не мешают), 1 — есть нарушения (перечислены в stderr).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CORE_BUDGET_BYTES = 5 * 1024 * 1024;
export const ARCHIVE_BUDGET_BYTES = 300 * 1024 * 1024;
/** Игровые ассеты тяжелее этого — предупреждение (время загрузки на мобильном важнее лимита архива). */
export const ASSETS_WARN_BYTES = 40 * 1024 * 1024;
/** Каталоги контента вне «ядра» (у этой игры их нет: уровни процедурные, строки вшиты). */
const CONTENT_DIRS = [];
/** Игровой ассет: assets/<папка>/… и звук audio/…; плоские assets/<файл> — бандл Vite, это ядро. */
const isGameAsset = (rel) => rel.startsWith('audio/') || (rel.startsWith('assets/') && rel.indexOf('/', 'assets/'.length) > 0);

/** Какие звуковые файлы обязаны быть в сборке: из audio/manifest.json. */
function expectedAudio() {
  try {
    const manifest = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'audio', 'manifest.json'), 'utf8'));
    const out = [];
    for (const s of manifest.sounds) for (let v = 1; v <= s.variants; v++) out.push(`audio/${s.id}_${v}.mp3`);
    return out;
  } catch {
    return [];
  }
}
/** Какие листы-картинки (плакаты, план убежища) обязаны быть в сборке: всё, что лежит в assets/posters. */
function expectedSheets() {
  try {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'posters');
    return readdirSync(dir)
      .filter((f) => f.endsWith('.webp'))
      .map((f) => f.slice(0, -'.webp'.length))
      .sort();
  } catch {
    return [];
  }
}
const NAME_RE = /^[A-Za-z0-9_.\-/]+$/;
const EXTERNAL_IN_HTML = /\b(?:src|href|action|poster|data)\s*=\s*["']\s*(?:https?:)?\/\//gi;
const EXTERNAL_IN_CSS = /url\(\s*["']?\s*(?:https?:)?\/\//gi;
const EXTERNAL_IMPORT_IN_CSS = /@import\s+(?:url\(\s*)?["']?\s*(?:https?:)?\/\//gi;

function walk(root, dir = root, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(root, abs, out);
    else out.push({ rel: relative(root, abs).split(sep).join('/'), abs, size: st.size });
  }
  return out;
}

/** @returns {{ problems: string[], warnings: string[], stats: { files: number, totalBytes: number, coreBytes: number, contentBytes: number, assetBytes: number, assetFiles: number } }} */
export function checkDist(dir, opts = {}) {
  const coreBudget = opts.coreBudget ?? CORE_BUDGET_BYTES;
  const archiveBudget = opts.archiveBudget ?? ARCHIVE_BUDGET_BYTES;
  const assetsWarn = opts.assetsWarn ?? ASSETS_WARN_BYTES;
  const root = resolve(dir);
  const problems = [];
  const warnings = [];
  let files;
  try {
    files = walk(root);
  } catch (e) {
    return { problems: [`нет каталога сборки ${root}: ${e.message}`], warnings, stats: { files: 0, totalBytes: 0, coreBytes: 0, contentBytes: 0, assetBytes: 0, assetFiles: 0 } };
  }

  if (!files.some((f) => f.rel === 'index.html')) problems.push('index.html должен лежать в корне архива');

  let total = 0;
  let content = 0;
  let assets = 0;
  let assetFiles = 0;
  for (const f of files) {
    total += f.size;
    if (CONTENT_DIRS.some((d) => f.rel.startsWith(d))) content += f.size;
    else if (isGameAsset(f.rel)) {
      assets += f.size;
      assetFiles += 1;
    }
    if (!NAME_RE.test(f.rel)) problems.push(`имя файла не латиницей: ${f.rel}`);
    if (f.rel.endsWith('.html')) {
      const hits = readFileSync(f.abs, 'utf8').match(EXTERNAL_IN_HTML);
      if (hits) problems.push(`внешние ресурсы в ${f.rel}: ${[...new Set(hits.map((h) => h.trim()))].join(', ')}`);
    }
    if (f.rel.endsWith('.css')) {
      const css = readFileSync(f.abs, 'utf8');
      const hits = [...(css.match(EXTERNAL_IN_CSS) ?? []), ...(css.match(EXTERNAL_IMPORT_IN_CSS) ?? [])];
      if (hits.length) problems.push(`внешние ресурсы в ${f.rel}: ${[...new Set(hits.map((h) => h.trim()))].join(', ')}`);
    }
  }
  // Плакаты: Vite кладёт каждый лист как assets/<id>-<хеш>.webp. Нет файла — на стене пустой лист.
  const sheets = opts.sheets ?? expectedSheets();
  const lostSheets = sheets.filter((id) => !files.some((f) => f.rel.startsWith(`assets/${id}-`) && f.rel.endsWith('.webp')));
  if (lostSheets.length > 0) problems.push(`в сборке нет листов-картинок (${lostSheets.length} из ${sheets.length}): ${lostSheets.join(', ')}`);
  // Звук: либо весь набор из манифеста, либо ничего. Игра с половиной звуков — брак.
  const expected = expectedAudio();
  const present = new Set(files.filter((f) => f.rel.startsWith('audio/') && f.rel.endsWith('.mp3')).map((f) => f.rel));
  if (expected.length > 0) {
    const lost = expected.filter((f) => !present.has(f));
    if (present.size === 0) {
      const msg = `звука в сборке нет: ожидается ${expected.length} файлов по audio/manifest.json`;
      if (opts.requireAudio ?? process.env.VZ_REQUIRE_AUDIO === '1') problems.push(msg);
      else warnings.push(msg);
    } else if (lost.length > 0) problems.push(`набор звуков неполный, нет ${lost.length} из ${expected.length}: ${lost.slice(0, 8).join(', ')}${lost.length > 8 ? '…' : ''}`);
    const extra = [...present].filter((f) => !expected.includes(f));
    if (extra.length > 0) warnings.push(`лишние звуковые файлы (нет в манифесте): ${extra.slice(0, 8).join(', ')}`);
  }
  const core = total - content - assets;
  if (core > coreBudget) problems.push(`ядро ${mb(core)} МБ больше бюджета ${mb(coreBudget)} МБ`);
  if (total > archiveBudget) problems.push(`архив ${mb(total)} МБ больше лимита Playgama ${mb(archiveBudget)} МБ`);
  if (assets > assetsWarn) warnings.push(`ассеты ${mb(assets)} МБ больше ${mb(assetsWarn)} МБ: игра будет грузиться долго`);
  return { problems, warnings, stats: { files: files.length, totalBytes: total, coreBytes: core, contentBytes: content, assetBytes: assets, assetFiles } };
}

const mb = (n) => (n / 1024 / 1024).toFixed(2);

function main() {
  const dir = process.argv[2] ?? 'dist';
  const { problems, warnings, stats } = checkDist(dir);
  const line =
    `[check_dist] ${dir}: файлов ${stats.files}, всего ${mb(stats.totalBytes)} МБ (лимит ${mb(ARCHIVE_BUDGET_BYTES)}), ` +
    `ядро ${mb(stats.coreBytes)} МБ (бюджет ${mb(CORE_BUDGET_BYTES)}), ` +
    `ассеты ${mb(stats.assetBytes)} МБ (${stats.assetFiles} файлов, предупреждение с ${mb(ASSETS_WARN_BYTES)})`;
  for (const w of warnings) console.warn(`[check_dist] ПРЕДУПРЕЖДЕНИЕ: ${w}`);
  if (problems.length > 0) {
    console.error(line);
    for (const p of problems) console.error(`[check_dist] ОШИБКА: ${p}`);
    process.exit(1);
  }
  console.log(`${line} — OK`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
