// Конструктор для Claude: node tools/constructor/build.mjs <out.html> [адрес игры]
// Страница сохраняет в свою базу: вещи и передвинутые вещи игры — things, фигуры — figures, убранные вещи игры — removed,
// отметки к вещам — verdicts. Основная модель переносит их в игру (src/world/partner/*.json).
// На своём компьютере — npm run constructor (serve.mjs): те же правки сразу в файлы, и поиск по каталогу Sand3D.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { buildPage, ROOT } from './page.mjs';

const out = resolve(process.argv[2] ?? join(ROOT, 'e2e/out/constructor.html'));
const page = await buildPage({ game: process.argv[3] });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`[constructor] ${out}: ${Math.round(page.length / 1024)} КБ`);
