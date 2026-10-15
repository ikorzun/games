/**
 * Исчерпывающий обход графа эпизода: на каждом выборе берутся все доступные опции, на каждой
 * мини-игре — все исходы (success / partial / fail / skipped).
 *
 * Полный перебор путей растёт как произведение вариантов (у полного ep01 — миллионы), поэтому
 * обход идёт по ПРОСТРАНСТВУ СОСТОЯНИЙ: интерпретатор детерминирован, а будущее зависит только от
 * (сцена, шаг, значения переменных, которые читают условия), поэтому совпавшие состояния
 * сливаются. Это равносильно проверке всех путей: если из каждого достижимого состояния есть
 * путь до `end`, нет циклов и исключений, то каждый путь доходит до end. Число полных путей
 * считается динамическим программированием по DAG состояний (BigInt).
 *
 * Дедуктивные развилки (kind=deduction) перебираются целиком, вместе с неверными ходами: неверный ход ведёт
 * в сцену-реакцию и обратно к вопросу, где испробованная опция уже погашена. Чтобы такая петля не выглядела
 * циклом и не сливалась с первым заходом, в подпись состояния входят счётчики развилки и материалы её
 * опций-улик — но только пока из текущей сцены вопрос ещё достижим (deductionSpots).
 */
import { runAutoplay } from '../../src/core/autoplay';
import { Interpreter } from '../../src/core/interpreter';
import type { Episode, GameState, MinigameResult, Snapshot } from '../../src/core/types';
import { analyzeLiveness } from './liveness';

export interface ExploreOptions {
  /** Предел остановок интерпретатора на одном отрезке между решениями (защита от цикла). */
  maxPausesPerSegment?: number;
  results?: readonly MinigameResult[];
  /** Аварийный предел числа состояний, чтобы тест не завис при взрыве графа. */
  maxStates?: number;
  /** false — различать состояния по всем переменным (медленно, для проверки корректности слияния). */
  mergeDead?: boolean;
}

export interface EndState {
  ending: string;
  endingKind: string;
  final: GameState;
}

export interface ExploreReport {
  /** Различные состояния-решения (выбор / мини-игра / конец), которые обошли. */
  states: number;
  /** Число различных полных путей до end. */
  paths: bigint;
  /** Сколько путей заканчивается каждой концовкой. */
  byEnding: Map<string, bigint>;
  failures: string[];
  warnings: string[];
  visitedScenes: Set<string>;
  /** Различные конечные состояния (для проверки инвариантов). */
  ends: EndState[];
  /** Сколько рёбер (решений) проверили инвариантами. */
  edges: number;
  /** Переменные, от которых зависит ход эпизода (условия их читают). */
  liveVars: string[];
  /** Первый найденный путь (список решений «выбор=опция» / «мини-игра:результат») к каждой концовке. */
  witness: Map<string, string[]>;
}

interface Node {
  paths: bigint;
  endings: Map<string, bigint>;
}

export function exploreAll(episode: Episode, options: ExploreOptions = {}): ExploreReport {
  const maxPauses = options.maxPausesPerSegment ?? 3000;
  const maxStates = options.maxStates ?? 400_000;
  const results = options.results ?? (['success', 'partial', 'fail', 'skipped'] as const);
  const analysis = analyzeLiveness(episode);
  const allVars = Object.keys(episode.variables).sort();
  const keepAll = options.mergeDead === false;
  const liveNames = [...(keepAll ? allVars : analysis.all)].sort();
  const warnings: string[] = [];
  const interp = new Interpreter(episode, { warn: (m) => warnings.push(m) });
  interp.start();

  const report: ExploreReport = {
    states: 0,
    paths: 0n,
    byEnding: new Map(),
    failures: [],
    warnings,
    visitedScenes: new Set(),
    ends: [],
    edges: 0,
    liveVars: liveNames,
    witness: new Map(),
  };

  const memo = new Map<string, Node>();
  const onStack = new Set<string>();
  const dead: Node = { paths: 0n, endings: new Map() };

  // Монотонные счётчики (только `add` положительных чисел, например style_hard/style_soft/case_strength):
  // всё, что выше наибольшей константы сравнений + 1, ведёт себя одинаково во всех будущих условиях —
  // такие значения сливаются в одно. Без этого эпизод 1 с точками выбора даёт миллионы состояний.
  const caps = keepAll ? new Map<string, number>() : monotoneCaps(episode);
  const spots = deductionSpots(episode);
  /** Состояние дедуктивных развилок, к вопросу которых ещё можно вернуться (в «слепом» режиме — всех). */
  const deductionKey = (s: GameState): string => {
    let out = '';
    for (const d of spots) {
      if (!keepAll && !d.reachFrom.has(s.scene_id)) continue;
      const rec = s.deductions[d.id];
      out += `|${d.id}:${rec ? `${rec.fails}/${[...rec.tried].sort().join('+')}` : '-'}`;
      for (const item of d.items) out += `|${item}=${s.archive.includes(item) ? 1 : 0}`;
    }
    return out;
  };
  /** Подпись состояния: только переменные, живые в этой точке программы (+ живые дедуктивные развилки). */
  const liveKey = (s: GameState): string => {
    const env = { ...s.globals, ...s.vars };
    const names = keepAll ? allVars : [...analysis.liveAt(s.scene_id, s.step_index)].sort();
    return (
      names
        .map((v) => {
          let val = env[v];
          const cap = caps.get(v);
          if (cap !== undefined && typeof val === 'number' && val > cap) val = cap;
          return `${v}=${String(val)}`;
        })
        .join(',') + deductionKey(s)
    );
  };

  const fail = (msg: string): Node => {
    if (report.failures.length < 20) report.failures.push(msg);
    return dead;
  };

  /** Проверки, которые обязаны выполняться на каждом ребре графа решений. */
  const checkEdge = (s: GameState, choicesMade: number, where: string): void => {
    report.edges += 1;
    if (s.journal.length !== choicesMade) fail(`${where}: журнал решений ${s.journal.length} ≠ сделано выборов ${choicesMade}`);
    for (const [name, def] of Object.entries(episode.variables)) {
      const v = (def.scope === 'global' ? s.globals : s.vars)[name];
      if (v === undefined) {
        fail(`${where}: переменная ${name} потеряна`);
        continue;
      }
      if (def.type === 'int' && typeof v === 'number') {
        if ((def.min !== undefined && v < def.min) || (def.max !== undefined && v > def.max)) fail(`${where}: ${name}=${v} вне границ`);
      }
    }
    if (new Set(s.archive).size !== s.archive.length) fail(`${where}: дубли в архиве`);
    for (const m of deductionProblems(episode, s)) fail(`${where}: ${m}`);
  };

  // Начало отрезка — всегда (сцена, шаг 0) после решения: если такое состояние уже разобрано,
  // повторно проходить отрезок до следующего решения незачем.
  const segmentMemo = new Map<string, Node>();

  const visit = (snap: Snapshot, trail: string[], choicesMade: number): Node => {
    report.visitedScenes.add(snap.state.scene_id);
    const startKey = `${snap.state.scene_id}#${snap.state.step_index}|${liveKey(snap.state)}`;
    const known = segmentMemo.get(startKey);
    if (known) return known;
    const node = walk(snap, trail, choicesMade);
    // Кешируем только завершённые отрезки (не провал/цикл).
    if (node !== dead) segmentMemo.set(startKey, node);
    return node;
  };

  const walk = (snap: Snapshot, trail: string[], choicesMade: number): Node => {
    interp.restore(snap);
    const seen = new Set<string>();
    let pauses = 0;
    for (;;) {
      if (++pauses > maxPauses) return fail(`превышен предел ${maxPauses} остановок (зацикливание?) на пути ${trail.join(' → ')}`);
      let res;
      try {
        res = interp.pump();
      } catch (e) {
        return fail(`исключение на пути [${trail.join(' → ')}]: ${(e as Error).message}`);
      }
      for (const ev of res.events) {
        if (ev.t === 'scene') report.visitedScenes.add(ev.view.scene);
        else if (ev.t === 'scene_pass') report.visitedScenes.add(ev.scene);
      }
      const p = res.pending;
      const s = interp.state;
      const segKey = `${p.kind}@${s.scene_id}#${s.step_index}|${liveKey(s)}`;
      if (seen.has(segKey)) return fail(`цикл без решений: ${segKey} на пути [${trail.join(' → ')}]`);
      seen.add(segKey);

      switch (p.kind) {
        case 'line':
        case 'hold':
        case 'document':
        case 'ad_break':
          interp.continue();
          break;
        case 'choice':
        case 'minigame': {
          const decisionId = p.kind === 'choice' ? `choice:${p.id}` : `minigame:${p.def.id}`;
          const key = `${decisionId}@${s.scene_id}#${s.step_index}|${liveKey(s)}`;
          const hit = memo.get(key);
          if (hit) return hit;
          if (onStack.has(key)) return fail(`цикл через решения: ${key}`);
          if (memo.size > maxStates) return fail(`взрыв состояний: больше ${maxStates}`);
          onStack.add(key);
          const decisionSnap = interp.snapshot();
          const node: Node = { paths: 0n, endings: new Map() };
          const branches: Array<{ label: string; apply: () => void; choice: boolean }> = [];
          if (p.kind === 'choice') {
            const enabled = p.options.filter((o) => o.enabled);
            if (enabled.length === 0) fail(`выбор ${p.id}: нет доступных опций (${trail.join(' → ')})`);
            // В журнал решений попадают только выборы с remember (по умолчанию true): считаем их, а не все.
            // Неверный ход дедуктивной развилки в журнал не пишется.
            for (const o of enabled) {
              branches.push({ label: `${p.id}=${o.id}`, choice: p.remember && o.verdict !== 'wrong', apply: () => interp.choose(o.id) });
            }
          } else {
            for (const r of results) {
              if (r === 'skipped' && !p.def.skip.allowed) continue;
              branches.push({ label: `${p.def.id}:${r}`, choice: false, apply: () => interp.finishMinigame(r) });
            }
          }
          for (const b of branches) {
            interp.restore(decisionSnap);
            interp.pump(); // поднять то же ожидание
            b.apply();
            const next = interp.snapshot();
            const made = choicesMade + (b.choice ? 1 : 0);
            checkEdge(next.state, made, [...trail, b.label].join(' → '));
            const child = visit(next, [...trail, b.label], made);
            node.paths += child.paths;
            for (const [e, n] of child.endings) node.endings.set(e, (node.endings.get(e) ?? 0n) + n);
          }
          onStack.delete(key);
          memo.set(key, node);
          report.states = memo.size;
          return node;
        }
        case 'end': {
          const key = `end:${p.ending.id}@${s.scene_id}|${liveKey(s)}`;
          const hit = memo.get(key);
          if (hit) return hit;
          const node: Node = { paths: 1n, endings: new Map([[p.ending.id, 1n]]) };
          memo.set(key, node);
          report.ends.push({ ending: p.ending.id, endingKind: p.ending.kind, final: interp.snapshot().state });
          if (!report.witness.has(p.ending.id)) report.witness.set(p.ending.id, [...trail]);
          report.states = memo.size;
          return node;
        }
      }
    }
  };

  const root = visit(interp.snapshot(), [], 0);
  report.paths = root.paths;
  report.byEnding = root.endings;
  return report;
}

/**
 * Решения свидетельского пути → политики автопилота: явные ответы на выборы (списком по порядку — дедуктивная
 * развилка спрашивает снова после неверного хода) и результаты мини-игр.
 */
export function policyFromTrail(trail: readonly string[]): {
  choices: Record<string, string[]>;
  minigames: Record<string, MinigameResult>;
} {
  const choices: Record<string, string[]> = {};
  const minigames: Record<string, MinigameResult> = {};
  for (const d of trail) {
    if (d.includes('=')) {
      const [c, o] = d.split('=');
      if (c && o) (choices[c] ??= []).push(o);
    } else {
      const [m, r] = d.split(':');
      if (m && r) minigames[m] = r as MinigameResult;
    }
  }
  return { choices, minigames };
}

interface EffectLike {
  var: string;
  op: string;
  value?: unknown;
}

/**
 * Для каждой int-переменной, которую меняют только `add` положительных констант, — потолок
 * (наибольшая константа из сравнений с ней + 1): значения выше него неразличимы ни одним условием
 * эпизода и остаются неразличимыми после любых дальнейших прибавлений.
 */
export function monotoneCaps(episode: Episode): Map<string, number> {
  const ops = new Map<string, Set<string>>();
  const consts = new Map<string, number>();
  const noteEffects = (effs: readonly EffectLike[] | undefined): void => {
    for (const e of effs ?? []) {
      const set = ops.get(e.var) ?? new Set<string>();
      set.add(e.op === 'add' && typeof e.value === 'number' && e.value > 0 ? 'add+' : e.op);
      ops.set(e.var, set);
    }
  };
  const noteCond = (expr: string | undefined): void => {
    if (!expr) return;
    for (const m of expr.matchAll(/([a-z][a-z0-9_]*)\s*(==|!=|<=|>=|<|>)\s*(-?\d+)/g)) {
      const v = m[1] ?? '';
      consts.set(v, Math.max(consts.get(v) ?? Number.NEGATIVE_INFINITY, Number(m[3])));
    }
    for (const m of expr.matchAll(/(-?\d+)\s*(==|!=|<=|>=|<|>)\s*([a-z][a-z0-9_]*)/g)) {
      const v = m[3] ?? '';
      consts.set(v, Math.max(consts.get(v) ?? Number.NEGATIVE_INFINITY, Number(m[1])));
    }
  };
  for (const b of episode.blocks) noteCond(b.when);
  for (const sc of Object.values(episode.scenes)) {
    for (const st of sc.steps) {
      const step = st as unknown as Record<string, unknown>;
      noteCond(step.when as string | undefined);
      noteEffects(step.effects as EffectLike[] | undefined);
      noteEffects(step.penalty as EffectLike[] | undefined); // цена неверного хода дедуктивной развилки
      for (const o of (step.options as Array<{ when?: string; effects?: EffectLike[] }> | undefined) ?? []) {
        noteCond(o.when);
        noteEffects(o.effects);
      }
      for (const c of (step.cases as Array<{ when: string }> | undefined) ?? []) noteCond(c.when);
    }
  }
  for (const mg of Object.values(episode.minigames ?? {})) {
    for (const oc of Object.values((mg as unknown as { outcomes?: Record<string, { effects?: EffectLike[] }> }).outcomes ?? {})) noteEffects(oc.effects);
  }
  for (const e of episode.endings ?? []) noteCond((e as unknown as { when?: string }).when);
  const caps = new Map<string, number>();
  for (const [name, def] of Object.entries(episode.variables)) {
    if (def.type !== 'int') continue;
    const used = ops.get(name);
    const c = consts.get(name);
    if (!used || c === undefined || !Number.isFinite(c)) continue;
    if ([...used].every((o) => o === 'add+')) caps.set(name, c + 1);
  }
  return caps;
}

export interface SampleReport {
  runs: number;
  failures: string[];
  warnings: string[];
  visitedScenes: Set<string>;
  /** Сколько прогонов закончилось каждой концовкой. */
  byEnding: Map<string, number>;
  /** Конечные состояния всех прогонов. */
  ends: EndState[];
  /** Первый найденный путь (решения «выбор=опция» / «мини-игра:результат») к каждой концовке. */
  witness: Map<string, string[]>;
  /** Сколько решений (выборов и мини-игр) прошли проверку инвариантов. */
  edges: number;
}

/**
 * Выборочная проверка большого эпизода: много случайных прогонов автопилота с разными зёрнами
 * (выборы и исходы мини-игр случайны) плюс детерминированные политики first/last/default × все исходы.
 * Полный перебор состояний (exploreAll) на эпизоде 1 с точками выбора и эпилогом, читающим два десятка
 * переменных, не умещается ни в какой разумный предел; выборка проверяет те же инварианты на каждом
 * прогоне: нет исключений, обрывов и зацикливаний, журнал решений совпадает с числом remember-выборов
 * (неверные ходы дедуктивных развилок не в счёт), переменные в границах, в архиве нет дублей, счётчики развилок
 * согласованы.
 */
export function sampleEpisode(episode: Episode, options: { runs?: number; seed?: number } = {}): SampleReport {
  const runs = options.runs ?? 1200;
  const seed0 = options.seed ?? 1;
  const remember = new Map<string, boolean>();
  for (const sc of Object.values(episode.scenes)) {
    for (const st of sc.steps) if (st.do === 'choice') remember.set(st.id, st.remember !== false);
  }
  const report: SampleReport = {
    runs: 0,
    failures: [],
    warnings: [],
    visitedScenes: new Set(),
    byEnding: new Map(),
    ends: [],
    witness: new Map(),
    edges: 0,
  };
  const fail = (msg: string): void => {
    if (report.failures.length < 20) report.failures.push(msg);
  };
  const policies: Array<Parameters<typeof runAutoplay>[1]> = [];
  for (let i = 0; i < runs; i++) policies.push({ choice: 'random', minigame: 'random', seed: seed0 + i });
  for (const choice of ['first', 'last', 'default'] as const) {
    for (const minigame of ['success', 'partial', 'fail', 'skipped'] as const) policies.push({ choice, minigame, seed: seed0 });
  }
  for (const policy of policies) {
    const label = JSON.stringify(policy);
    const interp = new Interpreter(episode, { warn: (m) => report.warnings.push(m) });
    let out;
    try {
      out = runAutoplay(interp, policy);
    } catch (e) {
      fail(`исключение (${label}): ${(e as Error).message}`);
      continue;
    }
    report.runs += 1;
    for (const sid of out.scenes) report.visitedScenes.add(sid);
    if (out.truncated) fail(`обрыв по пределу шагов — зацикливание? (${label})`);
    if (out.ending === null) {
      fail(`прогон не дошёл до end (${label})`);
      continue;
    }
    const s = interp.state;
    const remembered = out.choices.filter((c) => remember.get(c.choice) !== false && c.verdict !== 'wrong').length;
    report.edges += out.choices.length + out.minigames.length;
    if (s.journal.length !== remembered) fail(`${label}: журнал решений ${s.journal.length} ≠ remember-выборов ${remembered}`);
    for (const [name, def] of Object.entries(episode.variables)) {
      const v = (def.scope === 'global' ? s.globals : s.vars)[name];
      if (v === undefined) {
        fail(`${label}: переменная ${name} потеряна`);
        continue;
      }
      if (def.type === 'int' && typeof v === 'number') {
        if ((def.min !== undefined && v < def.min) || (def.max !== undefined && v > def.max)) fail(`${label}: ${name}=${v} вне границ`);
      }
    }
    if (new Set(s.archive).size !== s.archive.length) fail(`${label}: дубли в архиве`);
    for (const m of deductionProblems(episode, s)) fail(`${label}: ${m}`);
    report.byEnding.set(out.ending, (report.byEnding.get(out.ending) ?? 0) + 1);
    report.ends.push({ ending: out.ending, endingKind: out.endingKind ?? '', final: s });
    if (!report.witness.has(out.ending)) {
      report.witness.set(out.ending, [...out.choices.map((c) => `${c.choice}=${c.option}`), ...out.minigames.map((m) => `${m.id}:${m.result}`)]);
    }
  }
  return report;
}

export interface DeductionSpot {
  /** id выбора kind=deduction. */
  id: string;
  /** Сцена вопроса. */
  scene: string;
  /** Материалы опций-улик (`item`): доступность опции зависит от архива. */
  items: string[];
  /** Сцены, из которых сцена вопроса достижима (включая её саму). */
  reachFrom: Set<string>;
}

/**
 * Дедуктивные развилки эпизода и сцены, из которых к их вопросу можно вернуться. Граф переходов — по сценам,
 * со всеми целями jump / branch / choice / исходов мини-игр и с обходом выключенных блоков (как в liveness.ts),
 * то есть с запасом: лишняя сцена в reachFrom лишь мельчит слияние состояний, но не делает его неверным.
 */
export function deductionSpots(episode: Episode): DeductionSpot[] {
  const pred = new Map<string, Set<string>>();
  const edge = (from: string, to: string): void => {
    let set = pred.get(to);
    if (!set) pred.set(to, (set = new Set()));
    set.add(from);
  };
  for (const [sid, sc] of Object.entries(episode.scenes)) {
    for (const st of sc.steps) {
      if (st.do === 'jump') edge(sid, st.scene);
      else if (st.do === 'branch') {
        for (const c of st.cases) edge(sid, c.goto);
        edge(sid, st.default);
      } else if (st.do === 'choice') for (const o of st.options) edge(sid, o.goto);
      else if (st.do === 'minigame') {
        for (const oc of Object.values(episode.minigames?.[st.minigame]?.outcomes ?? {})) if (oc) edge(sid, oc.goto);
      }
    }
  }
  episode.blocks.forEach((b, bi) => {
    if (b.when === undefined) return;
    for (let k = bi + 1; k < episode.blocks.length; k++) {
      const nb = episode.blocks[k];
      if (!nb) break;
      edge(b.entry_scene, nb.entry_scene);
      if (nb.when === undefined) break;
    }
  });
  const spots: DeductionSpot[] = [];
  for (const [sid, sc] of Object.entries(episode.scenes)) {
    for (const st of sc.steps) {
      if (st.do !== 'choice' || st.kind !== 'deduction') continue;
      const reachFrom = new Set<string>([sid]);
      const queue = [sid];
      for (let cur = queue.pop(); cur !== undefined; cur = queue.pop()) {
        for (const from of pred.get(cur) ?? []) {
          if (reachFrom.has(from)) continue;
          reachFrom.add(from);
          queue.push(from);
        }
      }
      const items = [...new Set(st.options.flatMap((o) => (o.item ? [o.item] : [])))];
      spots.push({ id: st.id, scene: sid, items, reachFrom });
    }
  }
  return spots;
}

/** Инварианты счётчиков дедуктивных развилок: испробованы только неверные опции, без повторов, ошибок не меньше. */
export function deductionProblems(episode: Episode, s: GameState): string[] {
  const wrong = new Map<string, Set<string>>();
  for (const sc of Object.values(episode.scenes)) {
    for (const st of sc.steps) {
      if (st.do === 'choice' && st.kind === 'deduction') wrong.set(st.id, new Set(st.options.filter((o) => o.verdict === 'wrong').map((o) => o.id)));
    }
  }
  const out: string[] = [];
  for (const [id, rec] of Object.entries(s.deductions)) {
    const w = wrong.get(id);
    if (!w) out.push(`счётчики у ${id}, а это не дедуктивная развилка`);
    else if (rec.tried.some((o) => !w.has(o))) out.push(`${id}: испробована не неверная опция (${rec.tried.join(', ')})`);
    if (new Set(rec.tried).size !== rec.tried.length) out.push(`${id}: повтор в испробованных`);
    if (rec.fails < rec.tried.length) out.push(`${id}: ошибок ${rec.fails} меньше испробованных ${rec.tried.length}`);
  }
  return out;
}
