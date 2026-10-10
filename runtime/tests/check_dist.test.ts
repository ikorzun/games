/** Проверка сборки (scripts/check_dist.mjs): корень архива, латиница в именах, внешние ресурсы, бюджеты. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ARCHIVE_BUDGET_BYTES, checkDist, CORE_BUDGET_BYTES } from '../scripts/check_dist.mjs';

const dirs: string[] = [];
function dist(files: Record<string, string | number>): string {
  const root = mkdtempSync(join(tmpdir(), 'vn-dist-'));
  dirs.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof body === 'number' ? Buffer.alloc(body) : body);
  }
  return root;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const GOOD_HTML = '<!doctype html><html><head><script type="module" src="./assets/index-ab12.js"></script><link rel="stylesheet" href="./assets/index-ab12.css"></head><body><div id="app"></div></body></html>';

describe('check_dist', () => {
  it('нормальная сборка проходит; размер делится на ядро и контент эпизода', () => {
    const root = dist({
      'index.html': GOOD_HTML,
      'assets/index-ab12.js': 1000,
      'assets/index-ab12.css': 'body { background: url(./font.woff2); }',
      'episodes/s1/ep01_murylev.json': 5000,
      'locales/ru/ep01_murylev.json': 2000,
    });
    const { problems, stats } = checkDist(root);
    expect(problems).toEqual([]);
    expect(stats.contentBytes).toBe(7000);
    expect(stats.coreBytes).toBe(stats.totalBytes - 7000);
    expect(stats.files).toBe(5);
  });

  it('index.html не в корне — ошибка', () => {
    expect(checkDist(dist({ 'game/index.html': GOOD_HTML })).problems).toContain('index.html должен лежать в корне архива');
  });

  it('кириллица, пробелы и прочие символы в именах файлов — ошибка; хеши vite, дефисы и подчёркивания — нет', () => {
    const root = dist({ 'index.html': GOOD_HTML, 'assets/Фон.png': 10, 'assets/my file.png': 10, 'assets/pt-sans-latin-400-normal_AbC-12.woff2': 10 });
    const bad = checkDist(root).problems.filter((p) => p.startsWith('имя файла'));
    expect(bad).toHaveLength(2);
    expect(bad.join('\n')).toContain('Фон.png');
    expect(bad.join('\n')).toContain('my file.png');
  });

  it('внешние ресурсы в index.html (script, link, protocol-relative) и CSS (url, @import) — ошибка', () => {
    const html = '<script src="https://cdn.example.com/x.js"></script><link href="//fonts.example.com/a.css" rel="stylesheet">';
    const css = '@import url("https://fonts.example.com/f.css"); a { background: url(http://example.com/a.png); }';
    const { problems } = checkDist(dist({ 'index.html': html, 'assets/a.css': css }));
    expect(problems.some((p) => p.includes('index.html') && p.includes('внешние ресурсы'))).toBe(true);
    expect(problems.some((p) => p.includes('a.css') && p.includes('внешние ресурсы'))).toBe(true);
  });

  it('локальные ссылки и data: URI внешними не считаются', () => {
    const html = '<link rel="icon" href="data:,"><script src="./playgama-bridge.js"></script><a href="#x">x</a>';
    expect(checkDist(dist({ 'index.html': html, 'playgama-bridge.js': 10 })).problems).toEqual([]);
  });

  it('ядро больше бюджета — ошибка, а крупный эпизод в бюджет ядра не входит', () => {
    const heavyCore = dist({ 'index.html': GOOD_HTML, 'assets/big.js': 2048 });
    expect(checkDist(heavyCore, { coreBudget: 1024 }).problems.some((p) => p.startsWith('ядро'))).toBe(true);
    const heavyEpisode = dist({ 'index.html': GOOD_HTML, 'episodes/s1/ep.json': 4096 });
    expect(checkDist(heavyEpisode, { coreBudget: 1024 }).problems).toEqual([]);
  });

  it('архив больше лимита Playgama — ошибка', () => {
    const root = dist({ 'index.html': GOOD_HTML, 'episodes/e.json': 2048 });
    expect(checkDist(root, { archiveBudget: 1024 }).problems.some((p) => p.startsWith('архив'))).toBe(true);
  });

  it('бюджеты по умолчанию: ядро 5 МБ, архив 300 МБ', () => {
    expect(CORE_BUDGET_BYTES).toBe(5 * 1024 * 1024);
    expect(ARCHIVE_BUDGET_BYTES).toBe(300 * 1024 * 1024);
  });

  it('несуществующий каталог — понятная ошибка, а не исключение', () => {
    const { problems } = checkDist(join(tmpdir(), 'vn-no-such-dist-dir'));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('нет каталога сборки');
  });
});
