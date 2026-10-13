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

  it('оба варианта конторы (с помощницей и без) встречаются; дорога к каждому месту — своя сцена с целью поездки', () => {
    expect(report.visitedScenes.has('notary')).toBe(true);
    expect(report.visitedScenes.has('notary_alone')).toBe(true);
    for (const place of ['flat', 'galina', 'notary', 'zhek', 'bti']) expect(report.visitedScenes.has(`go_${place}`), place).toBe(true);
  });

  it('мини-игры: осмотр, сверка документов и картотека встречаются; находки картотеки — шесть или три сделки', () => {
    for (const s of ['flat_inspect', 'd1_lens', 'd1_lens_ok', 'd1_lens_fail', 'bti_chain_ok', 'bti_chain_part', 'bti_chain_fail']) {
      expect(report.visitedScenes.has(s), s).toBe(true);
    }
    for (const end of report.ends) {
      const v = end.final.vars;
      if (v.bti_six === true) expect(v.bti_chain).toBe(true);
      if (end.final.archive.includes('n_date')) expect(v.case_opened).toBe(true);
    }
  });
});
