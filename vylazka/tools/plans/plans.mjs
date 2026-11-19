#!/usr/bin/env node
// План сверху всех комнат (раскладка по смыслу, docs/vylazka/design.md, §31): node tools/plans/plans.mjs [--seeds 20041113,7]
// [--rank 2] [--worlds shelter,office] [--partner] [--png]. Страницы — в e2e/out/plans/<мир>_<сид>.html (и .png с --png).
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const OUT = join(ROOT, 'e2e/out/plans');
mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
await build({ entryPoints: [join(HERE, 'dump.ts')], bundle: true, platform: 'node', outfile: join(OUT, 'dump.cjs'), logLevel: 'warning', define: { __VZ_AUDIO__: '[]', __VZ_BUILD__: '"tool"' } });
const json = execFileSync('node', [join(OUT, 'dump.cjs'), ...args.filter((a) => a !== '--png')], { maxBuffer: 256 << 20 });
writeFileSync(join(OUT, 'levels.json'), json);
execFileSync('python3', ['-I', join(HERE, 'render.py'), join(OUT, 'levels.json'), OUT], { stdio: 'inherit' });
if (args.includes('--png')) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  for (const f of readdirSync(OUT).filter((n) => n.endsWith('.html'))) {
    await page.goto('file://' + join(OUT, f));
    await page.screenshot({ path: join(OUT, f.replace(/\.html$/, '.png')), fullPage: true });
  }
  await browser.close();
}
console.log(`планы: ${OUT}`);
