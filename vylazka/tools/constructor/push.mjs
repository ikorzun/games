// «Залить в игру» (квиз 18.11: «Программа на MacBook»): npm run constructor:push
//
// 1) проверяет записи партнёра теми же правилами, что игра (check.ts); что-то не так — ничего не отправляет и говорит, что;
// 2) коммитит файлы записей (src/world/partner/*.json) и рабочие файлы конструктора (отметки, заявки на вещи каталога);
// 3) забирает свежее с GitHub и отправляет туда же (git pull --rebase, git push).
// Дальше — основная модель: собирает игру по ссылке и доводит заявки до полки.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './page.mjs';

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
const plural = (n, one, few, many) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many}`;

const tmp = join(ROOT, 'e2e/out/constructor_check.cjs');
await build({ entryPoints: [join(ROOT, 'tools/constructor/check.ts')], bundle: true, platform: 'node', outfile: tmp, logLevel: 'warning', define: { __VZ_AUDIO__: '[]', __VZ_BUILD__: '"tool"' } });
const { problems, counts } = JSON.parse(execFileSync('node', [tmp], { encoding: 'utf8', maxBuffer: 16 << 20 }));
if (problems.length > 0) {
  console.error('[залить] не отправлено — поправь в конструкторе:');
  for (const p of problems) console.error(`  • ${p}`);
  process.exit(1);
}
// Только проверить (npm run constructor:push -- --check): ничего не коммитит и не отправляет.
if (process.argv.includes('--check')) {
  console.log(`[залить] всё годно: ${JSON.stringify(counts)}`);
  process.exit(0);
}
const paths = ['src/world/partner', 'tools/constructor/work/verdicts.json', 'tools/constructor/work/requests.json'];
git('add', '--', ...paths);
const staged = git('diff', '--cached', '--name-only', '--', ...paths);
if (!staged) {
  console.log('[залить] нового нет — всё уже в игре.');
  process.exit(0);
}
const what = [plural(counts.things, 'вещь', 'вещи', 'вещей'), `передвинуто ${counts.moved}`, `убрано ${counts.removed}`, plural(counts.figures, 'человек', 'человека', 'человек'), plural(counts.requests, 'заявка', 'заявки', 'заявок')].join(', ');
git('commit', '-m', `Конструктор: правки партнёра — ${what}`, '--', ...paths);
try {
  git('pull', '--rebase', '--autostash');
} catch (e) {
  console.error('[залить] не получилось забрать свежее с GitHub — напиши основной модели, она разберётся. Коммит сохранён у тебя.');
  console.error(String(e.stderr ?? e.message ?? e));
  process.exit(1);
}
git('push');
console.log(`[залить] отправлено: ${what}. Напиши в чат «залил» — соберу игру по ссылке и доведу заявки до полки.`);
