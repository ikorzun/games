/**
 * Проверка записей партнёра перед заливкой в игру (push.mjs): те же правила, что в игре и в конструкторе. Печатает JSON:
 * что не так (problems) и сколько чего (counts). Собирается esbuild'ом на лету; JSON записей читается при сборке.
 */
import { FIGURES } from '../../src/world/figures_data';
import { figureProblems } from '../../src/world/figures';
import { PLACED, REMOVED } from '../../src/world/placed_data';
import { placedProblems, removedProblems } from '../../src/world/placed';
import { ALL_PROPS, FIXED } from '../../src/world/props_all';
import REQUESTS from './work/requests.json';

const problems: string[] = [];
for (const s of PLACED) for (const p of placedProblems(s, ALL_PROPS, FIXED)) problems.push(`вещь «${s.name}» (${s.id}): ${p}`);
for (const r of REMOVED) for (const p of removedProblems(r, ALL_PROPS, FIXED)) problems.push(`убранная «${r.name}» (${r.id}): ${p}`);
for (const f of FIGURES) for (const p of figureProblems(f)) problems.push(`человек «${f.name}» (${f.id}): ${p}`);
const ids = [...PLACED, ...REMOVED, ...FIGURES].map((r) => r.id);
for (const id of ids) {
  if (!/^[a-z0-9_]+$/.test(id)) problems.push(`ключ ${id}: только [a-z0-9_]`);
  if (ids.indexOf(id) !== ids.lastIndexOf(id)) problems.push(`ключ ${id} повторяется`);
}
const counts = {
  things: PLACED.filter((s) => !s.moves).length,
  moved: PLACED.filter((s) => s.moves).length,
  removed: REMOVED.length,
  figures: FIGURES.length,
  requests: (REQUESTS as unknown[]).length,
};
console.log(JSON.stringify({ problems: [...new Set(problems)], counts }));
