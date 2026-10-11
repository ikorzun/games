/**
 * Анализ живых переменных по графу шагов эпизода (обратный поток данных). Переменная «жива» в
 * точке (сцена, шаг), если её значение может быть прочитано условием раньше, чем будет
 * перезаписано. Нужен исследователю состояний: состояния, различающиеся только мёртвыми
 * переменными, имеют одинаковое будущее и сливаются — число состояний падает на порядки.
 */
import { parseCached, variables } from '../../src/core/expr';
import type { Effect, Episode, Step } from '../../src/core/types';

type VarSet = Set<string>;

function exprVars(expr: string | undefined, into: VarSet): void {
  if (expr === undefined) return;
  for (const v of variables(parseCached(expr))) into.add(v);
}

/**
 * Обратный перенос набора живых переменных через последовательность эффектов.
 * set полностью перезаписывает значение (переменная до него мертва). add / sub / toggle читают
 * прежнее значение только затем, чтобы получить новое: если новое никому не нужно, то и старое
 * не нужно, поэтому живость они не меняют.
 */
function throughEffects(live: VarSet, effects: readonly Effect[] | undefined): VarSet {
  const out = new Set(live);
  if (!effects) return out;
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    if (e?.op === 'set') out.delete(e.var);
  }
  return out;
}

export interface Liveness {
  /** Живые переменные перед выполнением шага (сцена, индекс). */
  liveAt(scene: string, index: number): ReadonlySet<string>;
  /** Объединение живых переменных по всему эпизоду (для сравнения с «слепым» режимом). */
  all: ReadonlySet<string>;
}

export function analyzeLiveness(episode: Episode): Liveness {
  const scenes = episode.scenes;
  const key = (s: string, i: number): string => `${s}#${i}`;
  const live = new Map<string, VarSet>();
  const get = (s: string, i: number): VarSet => live.get(key(s, i)) ?? new Set<string>();

  // Преемники узла: [целевой узел, эффекты на ребре]
  interface Edge {
    to: [string, number];
    effects?: readonly Effect[];
  }
  const blockOf = new Map(episode.blocks.map((b) => [b.id, b]));
  const edgesOf = (sid: string, i: number, step: Step): Edge[] => {
    const next: Edge = { to: [sid, i + 1] };
    const out: Edge[] = [];
    const goto = (scene: string, effects?: readonly Effect[]): void => {
      out.push({ to: [scene, 0], ...(effects ? { effects } : {}) });
    };
    switch (step.do) {
      case 'jump':
        goto(step.scene);
        break;
      case 'branch':
        for (const c of step.cases) goto(c.goto);
        goto(step.default);
        break;
      case 'choice':
        for (const o of step.options) {
          // Неверный ход дедуктивной развилки: сначала цена (penalty), затем эффекты опции.
          const wrong = step.kind === 'deduction' && o.verdict === 'wrong';
          goto(o.goto, wrong ? [...(step.penalty ?? []), ...(o.effects ?? [])] : o.effects);
        }
        break;
      case 'minigame': {
        const mg = episode.minigames?.[step.minigame];
        if (mg) {
          for (const o of Object.values(mg.outcomes)) if (o) goto(o.goto, o.effects);
        }
        break;
      }
      case 'end':
        break;
      case 'set':
        out.push({ ...next, effects: step.effects });
        break;
      default:
        out.push(next);
    }
    // Ложное when пропускает любой шаг и переходит к следующему.
    if (step.when !== undefined && i + 1 < (scenes[sid]?.steps.length ?? 0)) out.push(next);
    return out;
  };

  const readsOf = (sid: string, i: number, step: Step): VarSet => {
    const r = new Set<string>();
    exprVars(step.when, r);
    if (step.do === 'branch') for (const c of step.cases) exprVars(c.when, r);
    if (step.do === 'choice') for (const o of step.options) exprVars(o.when, r);
    if (i === 0) {
      // Вход в первую сцену блока с `when`: условие читается при переходе.
      const block = blockOf.get(scenes[sid]?.block ?? '');
      if (block && block.entry_scene === sid) exprVars(block.when, r);
    }
    return r;
  };

  // Блок с `when`, пропущенный условием, ведёт в следующие блоки: добавим консервативные рёбра.
  const skipTargets = new Map<string, string[]>();
  episode.blocks.forEach((b, bi) => {
    if (b.when === undefined) return;
    const targets: string[] = [];
    for (let k = bi + 1; k < episode.blocks.length; k++) {
      const nb = episode.blocks[k];
      if (!nb) break;
      targets.push(nb.entry_scene);
      if (nb.when === undefined) break;
    }
    skipTargets.set(b.entry_scene, targets);
  });

  let changed = true;
  let guard = 0;
  while (changed && guard++ < 1000) {
    changed = false;
    for (const [sid, scene] of Object.entries(scenes)) {
      for (let i = scene.steps.length - 1; i >= 0; i--) {
        const step = scene.steps[i];
        if (!step) continue;
        const acc = readsOf(sid, i, step);
        for (const e of edgesOf(sid, i, step)) {
          for (const v of throughEffects(get(e.to[0], e.to[1]), e.effects)) acc.add(v);
        }
        if (i === 0) {
          for (const t of skipTargets.get(sid) ?? []) for (const v of get(t, 0)) acc.add(v);
        }
        const prev = live.get(key(sid, i));
        if (!prev || prev.size !== acc.size || [...acc].some((v) => !prev.has(v))) {
          live.set(key(sid, i), acc);
          changed = true;
        }
      }
    }
  }

  const all = new Set<string>();
  for (const s of live.values()) for (const v of s) all.add(v);
  return {
    liveAt: (scene, index) => live.get(key(scene, index)) ?? all,
    all,
  };
}
