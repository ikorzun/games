// «Залить в игру» из Терминала: npm run constructor:push. То же делает кнопка «Залить в игру» в окне конструктора
// (партнёр 18.11: «давай конструктор отдельной простой программой без этих плясок с терминалом»); работа — в push_lib.mjs:
// проверка правилами игры (check.ts), коммит файлов партнёра, git pull --rebase, git push.
// --check — только проверить, ничего не коммитить и не отправлять.
import { checkAll, describe, pushAll } from './push_lib.mjs';

if (process.argv.includes('--check')) {
  const { problems, counts } = await checkAll();
  if (problems.length > 0) {
    console.error('[залить] не годится — поправь в конструкторе:');
    for (const p of problems) console.error(`  • ${p}`);
    process.exit(1);
  }
  console.log(`[залить] всё годно: ${describe(counts)}`);
  process.exit(0);
}

const r = await pushAll({ status: (s) => console.log(`[залить] ${s}`) });
if (r.ok) {
  console.log(`[залить] ${r.message}`);
  process.exit(0);
}
console.error(`[залить] ${r.message}`);
for (const p of r.problems ?? []) console.error(`  • ${p}`);
if (r.detail) console.error(`  ${r.detail}`);
if (r.auth) console.error('  Войти: открой программу «Конструктор» и нажми «Залить в игру» — она попросит токен; или git push в Терминале.');
process.exit(1);
