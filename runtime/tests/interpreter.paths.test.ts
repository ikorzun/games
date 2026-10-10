/**
 * Обход графа ep01 автопилотом по ВСЕМ вариантам выборов и ВСЕМ исходам мини-игр
 * (success / partial / fail / skipped): каждый путь обязан дойти до шага end и не зациклиться.
 * Сверх этого — независимый «оракул» концовок и инварианты состояния на каждом пути.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { runAutoplay } from '../src/core/autoplay';
import { Interpreter } from '../src/core/interpreter';
import type { MinigameResult, Value } from '../src/core/types';
import { EP01_PATH, hasRepoContent, loadEpisode } from './helpers/content';
import { exploreAll } from './helpers/explore';
import type { ExploreReport } from './helpers/explore';

const run = hasRepoContent() ? describe : describe.skip;

/** Правило ветвления эпилога ep01 (s20.branch), записанное независимо от интерпретатора. */
function expectedEnding(v: Record<string, Value>): string {
  if (!v.board_done && v.confession === 'none') return 'e_early';
  if (v.oper_wounded || v.buyer_detained) return 'e_variant';
  return 'e_canon';
}

run('ep01: исчерпывающий обход графа', () => {
  const episode = loadEpisode(EP01_PATH);
  let report: ExploreReport;
  const t0 = Date.now();

  beforeAll(() => {
    report = exploreAll(episode);
  }, 120_000);

  it('ни одного исключения, цикла или тупика; интерпретатор не выдал замечаний по контенту', () => {
    expect(report.failures).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('путей достаточно много, и каждый кончается объявленной концовкой', () => {
    // 5 мини-игр × 4 исхода (часть совпадает через skip_counts_as) × 3 выбора с ветвлением по покупателю.
    console.info(
      `[ep01 paths] путей до end: ${report.leaves.length}, сцен посещено: ${report.visitedScenes.size}/${Object.keys(episode.scenes).length}, ${Date.now() - t0} мс`,
    );
    expect(report.leaves.length).toBeGreaterThan(5000);
    const declared = new Set(episode.endings.map((e) => e.id));
    for (const leaf of report.leaves) expect(declared.has(leaf.ending)).toBe(true);
  });

  it('достижимы все концовки, включая единственную canonical, и все сцены эпизода', () => {
    expect([...report.endings].sort()).toEqual(['e_canon', 'e_early', 'e_variant']);
    expect(episode.endings.filter((e) => e.kind === 'canonical')).toHaveLength(1);
    expect([...report.visitedScenes].sort()).toEqual(Object.keys(episode.scenes).sort());
  });

  it('концовка на каждом пути совпадает с независимым оракулом ветвления эпилога', () => {
    for (const leaf of report.leaves) {
      expect(leaf.ending, leaf.decisions.join(' → ')).toBe(expectedEnding(leaf.final.vars));
    }
  });

  it('последняя сцена пути — эпилог, объявленный у достигнутой концовки', () => {
    const byId = new Map(episode.endings.map((e) => [e.id, e]));
    for (const leaf of report.leaves) {
      expect(leaf.scenes[0]).toBe('s01');
      expect(leaf.scenes.at(-1), leaf.decisions.join(' → ')).toBe(byId.get(leaf.ending)?.epilogue_scene);
      expect(leaf.scenes).toContain('s19'); // суд обязателен на любом пути
    }
  });

  it('инварианты состояния: журнал, границы глобальных, архив без дублей, ветка покупателя', () => {
    for (const leaf of report.leaves) {
      const where = leaf.decisions.join(' → ');
      const choiceCount = leaf.decisions.filter((d) => d.includes('=')).length;
      expect(leaf.final.journal, where).toHaveLength(choiceCount);
      const trust = leaf.final.globals.trust_oper;
      expect(typeof trust === 'number' && trust >= 0 && trust <= 5, where).toBe(true);
      expect(new Set(leaf.final.archive).size, where).toBe(leaf.final.archive.length);
      expect(leaf.final.archive, where).toContain('arc_fact_privatization');
      const viaBuyer = leaf.decisions.includes('c_who=buyer');
      expect(leaf.scenes.includes('s09'), where).toBe(viaBuyer);
      expect(leaf.final.vars.wrong_suspect, where).toBe(viaBuyer);
    }
  });

  it('исходы мини-игр: skipped ведёт туда же, куда skip_counts_as', () => {
    const counts: Record<string, 'success' | 'partial' | 'fail'> = {};
    for (const [id, mg] of Object.entries(episode.minigames ?? {})) counts[id] = mg.skip.skip_counts_as ?? 'partial';
    for (const [id, as] of Object.entries(counts)) {
      const base = [...Object.keys(counts)].reduce<Record<string, MinigameResult>>((acc, k) => ({ ...acc, [k]: 'success' }), {});
      const a = runAutoplay(new Interpreter(episode), { minigames: { ...base, [id]: 'skipped' }, choices: { c_who: 'notary' } });
      const b = runAutoplay(new Interpreter(episode), { minigames: { ...base, [id]: as }, choices: { c_who: 'notary' } });
      expect(a.scenes, id).toEqual(b.scenes);
      expect(a.ending, id).toBe(b.ending);
    }
  });

  it('повтор пути автопилотом по записанным решениям даёт то же состояние (детерминизм, snapshot/restore не искажают)', () => {
    // Равномерная выборка путей, без зависимости от порядка обхода.
    const step = Math.max(1, Math.floor(report.leaves.length / 60));
    for (let i = 0; i < report.leaves.length; i += step) {
      const leaf = report.leaves[i];
      if (!leaf) continue;
      const choices: Record<string, string> = {};
      const minigames: Record<string, MinigameResult> = {};
      for (const d of leaf.decisions) {
        if (d.includes('=')) {
          const [c, o] = d.split('=');
          if (c && o) choices[c] = o;
        } else {
          const [m, r] = d.split(':');
          if (m && r) minigames[m] = r as MinigameResult;
        }
      }
      const interp = new Interpreter(episode);
      const out = runAutoplay(interp, { choices, minigames });
      expect(out.ending, leaf.decisions.join(' → ')).toBe(leaf.ending);
      expect(out.scenes).toEqual(leaf.scenes);
      expect(interp.state).toEqual(leaf.final);
    }
  });

  it('таймерный выбор c_take: default_option "wait" существует среди опций', () => {
    const scene = episode.scenes.s15;
    const choice = scene?.steps.find((s) => s.do === 'choice');
    expect(choice && choice.do === 'choice' ? choice.timer_ms : null).toBe(12000);
    expect(choice && choice.do === 'choice' ? choice.options.map((o) => o.id) : []).toContain('wait');
    const r = runAutoplay(new Interpreter(episode), { choice: 'default' });
    expect(r.choices.find((c) => c.choice === 'c_take')?.option).toBe('wait');
  });
});
