/**
 * «Ход следствия» (ep01_hod, дни 1–5 и развязка): выборочный обход маршрутов теми же инвариантами, что и ep01,
 * плюс правила эпизода — за первые два дня четыре места из пяти, в среду два места; фамилия доверенного к ночи
 * вторника известна на любом маршруте; помощница нотариуса не появляется во второй день, если её отправили в отпуск;
 * где искать Мурашова, к четвергу известно всегда; сила дела и концовка считаются только из найденного
 * (docs/season1/ep01-hod-finale.md §6).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { REPO_ROOT, loadEpisode } from './helpers/content';
import { sampleEpisode } from './helpers/explore';
import type { SampleReport } from './helpers/explore';

const HOD_PATH = join(REPO_ROOT, 'episodes', 's1', 'ep01_hod.json');
const run = existsSync(HOD_PATH) ? describe : describe.skip;

run('ep01_hod: маршруты', () => {
  const episode = loadEpisode(HOD_PATH);
  let report: SampleReport;

  beforeAll(() => {
    report = sampleEpisode(episode, { runs: 3000 });
  }, 240_000);

  it('ни одного исключения, цикла, тупика или нарушения инвариантов', () => {
    expect(report.failures).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('достижимы все сцены и все три концовки', () => {
    expect([...report.visitedScenes].sort()).toEqual(Object.keys(episode.scenes).sort());
    expect([...report.byEnding.keys()].sort()).toEqual(['e_canon', 'e_early', 'e_variant']);
  });

  it('места: за два дня четыре из пяти, в среду — два; фамилия известна; где искать Мурашова — тоже', () => {
    const places = ['visited_flat', 'visited_galina', 'visited_notary', 'visited_zhek', 'visited_bti'];
    for (const end of report.ends) {
      const v = end.final.vars;
      expect(places.filter((p) => v[p] === true).length).toBeGreaterThanOrEqual(4);
      expect(v.know_name).toBe(true);
      expect(v.day).toBe(5);
      expect(['v3_third', 'v3_address', 'v3_kovrigin'].filter((p) => v[p] === true)).toHaveLength(2);
      expect(v.office_known).toBe(true);
    }
  });

  it('оба варианта конторы (с помощницей и без) встречаются; дорога к каждому месту — своя сцена с целью поездки', () => {
    expect(report.visitedScenes.has('notary')).toBe(true);
    expect(report.visitedScenes.has('notary_alone')).toBe(true);
    for (const place of ['flat', 'galina', 'notary', 'zhek', 'bti']) expect(report.visitedScenes.has(`go_${place}`), place).toBe(true);
    for (const place of ['second', 'address', 'kovrigin']) {
      expect(report.visitedScenes.has(`g3c_${place}`), place).toBe(true);
      expect(report.visitedScenes.has(`g3w_${place}`), place).toBe(true);
    }
  });

  it('мини-игры: осмотр, сверка документов и картотека встречаются; находки картотеки — шесть или три сделки', () => {
    for (const s of ['flat_inspect', 'd1_lens', 'd1_lens_ok', 'd1_lens_fail', 'bti_chain_ok', 'bti_chain_part', 'bti_chain_fail', 'd3_lens_ok', 'd3_lens_fail']) {
      expect(report.visitedScenes.has(s), s).toBe(true);
    }
    for (const end of report.ends) {
      const v = end.final.vars;
      if (v.bti_six === true) expect(v.bti_chain).toBe(true);
      if (end.final.archive.includes('n_date')) expect(v.case_opened).toBe(true);
    }
  });

  it('операция: ждать можно только с Сайко, зная расписание и не спугнув; ранен только Сайко, который был рядом', () => {
    for (const end of report.ends) {
      const v = end.final.vars;
      if (v.op_waited === true) expect([v.oper_with, v.office_watched, v.murashov_spooked]).toEqual([true, true, false]);
      if (v.oper_wounded === true) expect(v.oper_with).toBe(true);
      if (v.shmel_escaped === true) expect([v.oper_with, v.accomplice_talks]).toEqual([false, false]);
      expect(v.field_seen).toBe(v.accomplice_talks);
      if (v.sanction !== true) expect([v.case_transferred, v.oper_wounded, v.accomplice_talks]).toEqual([true, false, false]);
    }
  });

  it('сила дела — восемь пунктов из найденного; концовка — по силе, Сайко и решению Палыча', () => {
    for (const end of report.ends) {
      const v = end.final.vars;
      const points = [
        v.case_opened,
        v.klava_statement,
        v.kovrigin_deal === true && v.kovrigin_retracted !== true,
        v.accomplice_talks,
        v.keys_found,
        v.identified,
        v.bti_six,
        v.confession === 'full',
      ].filter((x) => x === true).length;
      const strength = v.sanction === true ? points : 0; // без санкции до пятничного подсчёта не доходят
      expect(v.case_strength).toBe(strength);
      const kept = v.sanction === true && v.case_transferred !== true;
      if (v.sanction === true) expect(kept).toBe(strength >= 5 || (strength >= 3 && (end.final.globals.boss_favor as number) >= 1)); // отношение Палыча — глобальная переменная сезона
      const want = !kept ? 'e_early' : v.oper_wounded === true || strength < 5 ? 'e_variant' : 'e_canon';
      expect(end.ending).toBe(want);
    }
  });
});
