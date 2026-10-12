/**
 * Проверка ep01 по многим вариантам выборов и исходам мини-игр (success / partial / fail / skipped):
 * каждый прогон обязан дойти до шага end и не зациклиться.
 *
 * Полный перебор состояний (exploreAll, tests/helpers/explore.ts) сливает состояния по живым переменным
 * (tests/helpers/liveness.ts) и годится для синтетических эпизодов; на эпизоде 1 с 46 точками выбора и
 * эпилогом, который читает два десятка переменных, состояний больше миллиона, поэтому ep01 проверяется
 * выборкой: ~1200 случайных прогонов + политики first/last/default × все исходы, с теми же инвариантами
 * на каждом прогоне (sampleEpisode). Полный перебор ep01 включается переменной окружения
 * VN_FULL_EXPLORE=1. Тесты не зашивают сюжет ep01 — только свойства, обязательные для любого эпизода.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { runAutoplay } from '../src/core/autoplay';
import { Interpreter } from '../src/core/interpreter';
import type { ChoiceStep, MinigameResult } from '../src/core/types';
import { EP01_PATH, hasRepoContent, loadEpisode } from './helpers/content';
import { deductionSpots, exploreAll, monotoneCaps, policyFromTrail, sampleEpisode } from './helpers/explore';
import type { SampleReport } from './helpers/explore';
import { deductionEpisode, mg, miniEpisode } from './helpers/mini';

const run = hasRepoContent() ? describe : describe.skip;

run('ep01: выборочный обход графа', () => {
  const episode = loadEpisode(EP01_PATH);
  let report: SampleReport;
  let ms = 0;

  beforeAll(() => {
    const t0 = Date.now();
    report = sampleEpisode(episode, { runs: 1200 });
    ms = Date.now() - t0;
    console.info(
      `[ep01 paths] прогонов: ${report.runs}, решений: ${report.edges}, ` +
        `сцен: ${report.visitedScenes.size}/${Object.keys(episode.scenes).length}, ` +
        `концовки: ${[...report.byEnding].map(([k, v]) => `${k}=${v}`).join(' ')}, ${ms} мс`,
    );
  }, 300_000);

  it('ни одного исключения, цикла, тупика или нарушения инвариантов; замечаний по контенту нет', () => {
    expect(report.failures).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('прогонов много, и каждый кончается объявленной концовкой', () => {
    expect(report.runs).toBeGreaterThan(1000);
    const declared = new Set(episode.endings.map((e) => e.id));
    let sum = 0;
    for (const [id, n] of report.byEnding) {
      expect(declared.has(id), id).toBe(true);
      sum += n;
    }
    expect(sum).toBe(report.runs);
  });

  it('достижимы все объявленные концовки (ровно одна canonical) и все сцены эпизода', () => {
    expect([...report.byEnding.keys()].sort()).toEqual(episode.endings.map((e) => e.id).sort());
    expect(episode.endings.filter((e) => e.kind === 'canonical')).toHaveLength(1);
    expect([...report.visitedScenes].sort()).toEqual(Object.keys(episode.scenes).sort());
  });

  it('в конечных состояниях открыты материалы концовки, а мини-игры и выборы не оставили лишнего', () => {
    const byId = new Map(episode.endings.map((e) => [e.id, e]));
    expect(report.ends.length).toBeGreaterThan(0);
    for (const end of report.ends) {
      for (const item of byId.get(end.ending)?.unlocks ?? []) expect(end.final.archive, end.ending).toContain(item);
    }
  });

  it('автопилот по записанным решениям повторяет путь (детерминизм; snapshot/restore не искажают состояние)', () => {
    for (const [ending, trail] of report.witness) {
      const policy = policyFromTrail(trail);
      const interp = new Interpreter(episode);
      const out = runAutoplay(interp, policy);
      expect(out.ending, `${ending}: ${trail.join(' → ')}`).toBe(ending);
      expect(out.truncated).toBe(false);
    }
  });

  it('случайные прогоны воспроизводимы: решения, записанные автопилотом, дают то же конечное состояние', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const a = new Interpreter(episode);
      const first = runAutoplay(a, { choice: 'random', minigame: 'random', seed });
      expect(first.ending, `seed ${seed}`).not.toBeNull();
      // Ответы по порядку: дедуктивная развилка после неверного хода задаёт вопрос снова.
      const choices: Record<string, string[]> = {};
      for (const c of first.choices) (choices[c.choice] ??= []).push(c.option);
      const minigames: Record<string, MinigameResult> = {};
      for (const m of first.minigames) minigames[m.id] = m.result;
      const b = new Interpreter(episode);
      const again = runAutoplay(b, { choices, minigames });
      expect(again.scenes, `seed ${seed}`).toEqual(first.scenes);
      expect(b.state).toEqual(a.state);
    }
  });

  it('все политики автопилота доходят до end', () => {
    for (const choice of ['first', 'last', 'default', 'random'] as const) {
      for (const minigame of ['success', 'partial', 'fail', 'skipped'] as const) {
        const out = runAutoplay(new Interpreter(episode), { choice, minigame, seed: 3 });
        expect(out.ending, `${choice}/${minigame}`).not.toBeNull();
      }
    }
  });

  it('skipped ведёт туда же, куда skip_counts_as', () => {
    const defs = Object.values(episode.minigames ?? {});
    expect(defs.length).toBeGreaterThan(0);
    for (const def of defs) {
      if (!def.skip.allowed) continue;
      const as = def.skip.skip_counts_as ?? 'partial';
      const skipped = runAutoplay(new Interpreter(episode), { minigames: { [def.id]: 'skipped' } });
      const counted = runAutoplay(new Interpreter(episode), { minigames: { [def.id]: as } });
      expect(skipped.scenes, def.id).toEqual(counted.scenes);
      expect(skipped.ending, def.id).toBe(counted.ending);
    }
  });

  it('любую мини-игру можно пропустить, а таймерные выборы имеют default_option среди опций', () => {
    for (const def of Object.values(episode.minigames ?? {})) expect(def.skip.allowed, def.id).toBe(true);
    for (const scene of Object.values(episode.scenes)) {
      for (const step of scene.steps) {
        if (step.do !== 'choice' || step.timer_ms === undefined) continue;
        expect(step.default_option, `${scene.id}/${step.id}`).toBeDefined();
        expect(step.options.map((o) => o.id)).toContain(step.default_option);
      }
    }
  });

  it('политика default берёт default_option на таймерном выборе', () => {
    const timed = Object.values(episode.scenes)
      .flatMap((s) => s.steps)
      .find((st) => st.do === 'choice' && st.timer_ms !== undefined);
    if (!timed || timed.do !== 'choice') return;
    const out = runAutoplay(new Interpreter(episode), { choice: 'default' });
    const made = out.choices.find((c) => c.choice === timed.id);
    if (made) expect(made.option).toBe(timed.default_option);
  });

  it.runIf(process.env.VN_FULL_EXPLORE === '1')(
    'полная проверка слияния на ep01: без слияния получаются те же числа путей по концовкам',
    () => {
      const full = exploreAll(episode, { mergeDead: false, maxStates: 3_000_000 });
      expect(full.failures).toEqual([]);
      expect([...full.byEnding.keys()].sort()).toEqual([...report.byEnding.keys()].sort());
      expect([...full.visitedScenes].sort()).toEqual([...report.visitedScenes].sort());
    },
    900_000,
  );
});

describe('исследователь состояний: корректность слияния по живым переменным', () => {
  // Эпизод с независимыми «шумовыми» флагами и двумя значимыми развилками.
  const BOOL = { type: 'bool' as const, default: false };
  const INT = { type: 'int' as const, default: 0, min: 0, max: 4 };
  const ep = miniEpisode(
    {
      s1: {
        steps: [
          { do: 'choice', id: 'c1', options: [{ id: 'a', key: 'k.a', effects: [{ var: 'noise1', op: 'set', value: true }, { var: 'score', op: 'add', value: 1 }], goto: 's2' }, { id: 'b', key: 'k.b', effects: [{ var: 'noise2', op: 'set', value: true }], goto: 's2' }, { id: 'c', key: 'k.c', effects: [{ var: 'score', op: 'add', value: 2 }], goto: 's2' }] },
        ],
      },
      s2: { steps: [{ do: 'minigame', minigame: 'm1' }] },
      s3: { steps: [{ do: 'narrate', key: 'k.3' }, { do: 'choice', id: 'c2', options: [{ id: 'x', key: 'k.x', effects: [{ var: 'noise3', op: 'toggle' }, { var: 'flag', op: 'set', value: true }], goto: 's4' }, { id: 'y', key: 'k.y', goto: 's4' }] }] },
      s4: { steps: [{ do: 'branch', cases: [{ when: 'flag && score >= 2', goto: 's_win' }], default: 's_lose' }] },
      s_win: { steps: [{ do: 'end', ending: 'e_main' }] },
      s_lose: { steps: [{ do: 'end', ending: 'e_alt' }] },
    },
    {
      variables: { noise1: BOOL, noise2: BOOL, noise3: BOOL, flag: BOOL, score: INT },
      minigames: {
        m1: mg('m1', {
          outcomes: { success: { goto: 's3', effects: [{ var: 'score', op: 'add', value: 1 }] }, partial: { goto: 's3' }, fail: { goto: 's3', effects: [{ var: 'flag', op: 'set', value: false }] } },
          skip: { allowed: true, skip_counts_as: 'partial' },
        }),
      },
    },
  );

  it('слияние не меняет ни число путей, ни распределение по концовкам, но сокращает число состояний', () => {
    const merged = exploreAll(ep);
    const full = exploreAll(ep, { mergeDead: false });
    expect(merged.failures).toEqual([]);
    expect(full.failures).toEqual([]);
    expect(merged.paths).toBe(full.paths);
    expect([...merged.byEnding].sort()).toEqual([...full.byEnding].sort());
    expect(merged.states).toBeLessThan(full.states);
    expect(merged.liveVars).toEqual(['flag', 'score']);
    // 3 варианта выбора × 4 исхода мини-игры × 2 варианта второго выбора
    expect(merged.paths).toBe(24n);
  });

  it('находит цикл, тупик и исключение вместо зависания', () => {
    const loop = miniEpisode({
      s1: { steps: [{ do: 'choice', id: 'c', options: [{ id: 'again', key: 'k.a', goto: 's1' }, { id: 'out', key: 'k.o', goto: 's2' }] }] },
      s2: { steps: [{ do: 'end', ending: 'e_main' }] },
    });
    const r = exploreAll(loop);
    expect(r.failures.some((f) => /цикл/.test(f))).toBe(true);

    const dead = miniEpisode({ s1: { steps: [{ do: 'narrate', key: 'k' }] } });
    expect(exploreAll(dead).failures.some((f) => /исключение/.test(f))).toBe(true);

    const spin = miniEpisode({ s1: { steps: [{ do: 'narrate', key: 'k' }, { do: 'jump', scene: 's1' }] } });
    expect(exploreAll(spin).failures.some((f) => /цикл без решений/.test(f))).toBe(true);
  });
});

describe('дедуктивная развилка: перебор путей и выборка', () => {
  const ep = deductionEpisode();

  it('перебор идёт и по неверным ходам: петля «вопрос → реакция → вопрос» не цикл; пути посчитаны точно; слияние их не меняет', () => {
    const merged = exploreAll(ep);
    const full = exploreAll(ep, { mergeDead: false });
    expect(merged.failures).toEqual([]);
    expect(full.failures).toEqual([]);
    expect(merged.warnings).toEqual([]);
    expect([...merged.visitedScenes].sort()).toEqual(Object.keys(ep.scenes).sort());
    // Из вопроса с W неиспробованными неверными и R верными: R + W · (пути после ошибки).
    // skip (R = 1): 1 + 2·(1 + 1·1) = 5; look (улика, R = 2): 2 + 2·(2 + 1·2) = 10.
    expect(merged.paths).toBe(15n);
    expect(full.paths).toBe(15n);
    // ≤ 1 ошибки — e_main: 3 + 6; две ошибки (nerves 3) — e_alt: 2 + 4.
    expect(Object.fromEntries(merged.byEnding)).toEqual({ e_main: 9n, e_alt: 6n });
    expect([...full.byEnding].sort()).toEqual([...merged.byEnding].sort());
    // pushed никто не читает; после ответа счётчики развилки мертвы — состояния сливаются.
    expect(merged.liveVars).toEqual(['has_card', 'nerves']);
    expect(merged.states).toBeLessThan(full.states);
  });

  it('счётчики развилки входят в подпись состояния, только пока вопрос достижим', () => {
    const [spot, ...rest] = deductionSpots(ep);
    expect(rest).toEqual([]);
    expect(spot).toMatchObject({ id: 'd1', scene: 's_q', items: ['arc_card'] });
    expect([...(spot?.reachFrom ?? [])].sort()).toEqual(['s0', 's1', 's_q', 's_w1', 's_w2']);
  });

  it('цена ошибки (penalty) — не «монотонный счётчик»: nerves не обрезается при слиянии', () => {
    const grow = deductionEpisode();
    // Верный ход ещё и прибавляет: без учёта penalty nerves выглядел бы счётчиком «только add».
    (grow.scenes.s_q!.steps[2] as ChoiceStep).options[3]!.effects = [{ var: 'nerves', op: 'add', value: 1 }];
    expect(monotoneCaps(grow).has('nerves')).toBe(false);
  });

  it('выборка автопилотом: неверные ходы в журнал не идут, счётчики согласованы, сцены-реакции посещены; путь воспроизводится', () => {
    const r = sampleEpisode(ep, { runs: 200 });
    expect(r.failures).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect([...r.visitedScenes].sort()).toEqual(Object.keys(ep.scenes).sort());
    expect([...r.byEnding.keys()].sort()).toEqual(['e_alt', 'e_main']);
    for (const [ending, trail] of r.witness) {
      const out = runAutoplay(new Interpreter(ep), policyFromTrail(trail));
      expect(out.ending, trail.join(' → ')).toBe(ending);
      expect([...out.choices.map((c) => `${c.choice}=${c.option}`), ...out.minigames.map((m) => `${m.id}:${m.result}`)]).toEqual(trail);
    }
    expect(r.witness.get('e_alt')?.filter((d) => d.startsWith('d1=w'))).toHaveLength(2);
  });
});
