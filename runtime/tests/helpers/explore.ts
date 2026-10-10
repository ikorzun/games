/**
 * Исчерпывающий обход графа эпизода: на каждом выборе берутся все доступные опции,
 * на каждой мини-игре — все исходы (success / partial / fail / skipped). Интерпретатор
 * детерминирован, поэтому ветвление делается через snapshot()/restore().
 */
import { Interpreter } from '../../src/core/interpreter';
import type { Episode, GameState, MinigameResult } from '../../src/core/types';

export interface LeafPath {
  ending: string;
  endingKind: string;
  decisions: string[];
  scenes: string[];
  /** Финальное состояние партии. */
  final: GameState;
  /** Сколько раз интерпретатор останавливался на ожидании. */
  pauses: number;
}

export interface ExploreReport {
  leaves: LeafPath[];
  failures: string[];
  visitedScenes: Set<string>;
  endings: Set<string>;
  warnings: string[];
}

export interface ExploreOptions {
  /** Предел остановок интерпретатора на одном пути — защита от бесконечного цикла. */
  maxPausesPerPath?: number;
  results?: readonly MinigameResult[];
}

export function exploreAll(episode: Episode, options: ExploreOptions = {}): ExploreReport {
  const maxPauses = options.maxPausesPerPath ?? 2000;
  const results = options.results ?? ['success', 'partial', 'fail', 'skipped'];
  const warnings: string[] = [];
  const interp = new Interpreter(episode, { warn: (m) => warnings.push(m) });
  interp.start();

  const report: ExploreReport = {
    leaves: [],
    failures: [],
    visitedScenes: new Set(),
    endings: new Set(),
    warnings,
  };

  const sig = (): string => {
    const s = interp.state;
    return `${s.scene_id}#${s.step_index}|${JSON.stringify(s.vars)}|${JSON.stringify(s.globals)}`;
  };

  // `seen` — подписи (сцена, шаг, переменные) на текущем пути: повтор означает цикл.
  const walk = (decisions: string[], scenes: string[], seen: Set<string>, pausesSoFar: number): void => {
    let pauses = pausesSoFar;
    for (;;) {
      if (++pauses > maxPauses) {
        report.failures.push(`превышен предел ${maxPauses} остановок (зацикливание?) на пути ${decisions.join(' → ')}`);
        return;
      }
      let res;
      try {
        res = interp.pump();
      } catch (e) {
        report.failures.push(`исключение на пути [${decisions.join(' → ')}]: ${(e as Error).message}`);
        return;
      }
      for (const ev of res.events) {
        if (ev.t === 'scene') {
          scenes.push(ev.view.scene);
          report.visitedScenes.add(ev.view.scene);
        }
      }
      const p = res.pending;
      const here = `${p.kind}@${sig()}`;
      if (seen.has(here)) {
        report.failures.push(`цикл: повторное состояние ${here} на пути [${decisions.join(' → ')}]`);
        return;
      }
      seen.add(here);

      switch (p.kind) {
        case 'line':
        case 'hold':
        case 'document':
        case 'ad_break':
          interp.continue();
          break;
        case 'choice': {
          const snap = interp.snapshot();
          const enabled = p.options.filter((o) => o.enabled);
          if (enabled.length === 0) {
            report.failures.push(`выбор ${p.id}: нет доступных опций`);
            return;
          }
          for (const o of enabled) {
            interp.restore(snap);
            interp.pump(); // повторно подняли то же ожидание выбора
            interp.choose(o.id);
            walk([...decisions, `${p.id}=${o.id}`], [...scenes], new Set(seen), pauses);
          }
          return;
        }
        case 'minigame': {
          const snap = interp.snapshot();
          for (const r of results) {
            if (r === 'skipped' && !p.def.skip.allowed) continue;
            interp.restore(snap);
            interp.pump(); // повторно подняли то же ожидание мини-игры
            interp.finishMinigame(r);
            walk([...decisions, `${p.def.id}:${r}`], [...scenes], new Set(seen), pauses);
          }
          return;
        }
        case 'end':
          report.endings.add(p.ending.id);
          report.leaves.push({
            ending: p.ending.id,
            endingKind: p.ending.kind,
            decisions,
            scenes,
            final: interp.snapshot().state,
            pauses,
          });
          return;
      }
    }
  };

  walk([], [], new Set(), 0);
  return report;
}
