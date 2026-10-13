/**
 * «Ход следствия» (ep01_hod, проба дней 1–2): выборочный обход маршрутов теми же инвариантами, что и ep01,
 * плюс правила самой пробы — за день два места, всего четыре из пяти; фамилия доверенного к ночи известна
 * на любом маршруте; помощница нотариуса не появляется во второй день, если её отправили в отпуск.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { REPO_ROOT, loadEpisode } from './helpers/content';
import { sampleEpisode } from './helpers/explore';
import type { SampleReport } from './helpers/explore';

const HOD_PATH = join(REPO_ROOT, 'episodes', 's1', 'ep01_hod.json');
const run = existsSync(HOD_PATH) ? describe : describe.skip;

run('ep01_hod: маршруты пробы', () => {
  const episode = loadEpisode(HOD_PATH);
  let report: SampleReport;

  beforeAll(() => {
    report = sampleEpisode(episode, { runs: 800 });
  }, 120_000);

  it('ни одного исключения, цикла, тупика или нарушения инвариантов', () => {
    expect(report.failures).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('достижимы все сцены и единственная концовка', () => {
    expect([...report.visitedScenes].sort()).toEqual(Object.keys(episode.scenes).sort());
    expect([...report.byEnding.keys()]).toEqual(['e_proto']);
  });

  it('за два дня — четыре места из пяти, фамилия к ночи известна', () => {
    const places = ['visited_flat', 'visited_galina', 'visited_notary', 'visited_zhek', 'visited_bti'];
    for (const end of report.ends) {
      const v = end.final.vars;
      expect(places.filter((p) => v[p] === true)).toHaveLength(4);
      expect(v.day).toBe(2);
      expect(v.know_name).toBe(true);
    }
  });

  it('оба варианта конторы (с помощницей и без) встречаются, а у тех, кто был у Лапиных в первый день, Люды нет', () => {
    expect(report.visitedScenes.has('notary')).toBe(true);
    expect(report.visitedScenes.has('notary_alone')).toBe(true);
    for (const end of report.ends) {
      const j = end.final.journal.map((x) => `${x.choice}=${x.option}`);
      if (j.some((x) => x.endsWith('=notary_alone'))) expect(end.final.vars.lyuda_gone).toBe(true);
    }
  });
});
