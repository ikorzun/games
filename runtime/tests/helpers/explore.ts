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
 */
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

  /** Подпись состояния: только переменные, живые в этой точке программы. */
  const liveKey = (s: GameState): string => {
    const env = { ...s.globals, ...s.vars };
    const names = keepAll ? allVars : [...analysis.liveAt(s.scene_id, s.step_index)].sort();
    return names.map((v) => `${v}=${String(env[v])}`).join(',');
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
      for (const ev of res.events) if (ev.t === 'scene') report.visitedScenes.add(ev.view.scene);
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
            for (const o of enabled) branches.push({ label: `${p.id}=${o.id}`, choice: p.remember, apply: () => interp.choose(o.id) });
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

/** Решения свидетельского пути → политики автопилота (явные ответы на выборы и мини-игры). */
export function policyFromTrail(trail: readonly string[]): {
  choices: Record<string, string>;
  minigames: Record<string, MinigameResult>;
} {
  const choices: Record<string, string> = {};
  const minigames: Record<string, MinigameResult> = {};
  for (const d of trail) {
    if (d.includes('=')) {
      const [c, o] = d.split('=');
      if (c && o) choices[c] = o;
    } else {
      const [m, r] = d.split(':');
      if (m && r) minigames[m] = r as MinigameResult;
    }
  }
  return { choices, minigames };
}
