/**
 * Автопилот: проходит эпизод без интерфейса по заданной политике. Используется
 * window.__vn.autoplay (headless-прогон в CI) и тестами.
 */
import type { Interpreter } from './interpreter';
import type { EngineEvent, MinigameOutcomeKind, MinigameResult } from './types';

export type ChoicePolicy = 'first' | 'last' | 'random' | 'default';
export type MinigamePolicy = MinigameResult | 'random';

export interface AutoplayOptions {
  /** Политика для выборов без явного ответа. По умолчанию `first`. */
  choice?: ChoicePolicy;
  /** Явные ответы: id выбора → id опции. */
  choices?: Readonly<Record<string, string>>;
  /** Результат для мини-игр без явного ответа. По умолчанию `success`. */
  minigame?: MinigamePolicy;
  /** Явные результаты: id мини-игры → результат. */
  minigames?: Readonly<Record<string, MinigameResult>>;
  /** Зерно ГСЧ для политик `random`. */
  seed?: number;
  /** Предел итераций (защита от зацикливания). */
  maxSteps?: number;
}

export type AutoplayPolicy = ChoicePolicy | AutoplayOptions;

export interface AutoplayReport {
  /** id достигнутой концовки или null, если прогон оборван. */
  ending: string | null;
  endingKind: string | null;
  /** Сколько раз интерпретатор останавливался на ожидании. */
  steps: number;
  /** Посещённые сцены по порядку (с повторами). */
  scenes: string[];
  choices: Array<{ choice: string; option: string }>;
  minigames: Array<{ id: string; result: MinigameResult; counted: MinigameOutcomeKind }>;
  truncated: boolean;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalizePolicy(policy: AutoplayPolicy | undefined): AutoplayOptions {
  if (policy === undefined) return {};
  return typeof policy === 'string' ? { choice: policy } : policy;
}

export function runAutoplay(
  interp: Interpreter,
  policy: AutoplayPolicy = 'first',
  hooks: { onEvents?: (events: EngineEvent[]) => void } = {},
): AutoplayReport {
  const opts = normalizePolicy(policy);
  const rand = mulberry32(opts.seed ?? 1);
  const maxSteps = opts.maxSteps ?? 20000;
  if (!interp.started) interp.start();

  const report: AutoplayReport = {
    ending: null,
    endingKind: null,
    steps: 0,
    scenes: [],
    choices: [],
    minigames: [],
    truncated: false,
  };

  for (let i = 0; i < maxSteps; i++) {
    const { events, pending } = interp.pump();
    for (const ev of events) if (ev.t === 'scene') report.scenes.push(ev.view.scene);
    hooks.onEvents?.(events);
    report.steps += 1;

    switch (pending.kind) {
      case 'line':
      case 'hold':
      case 'document':
      case 'ad_break':
        interp.continue();
        break;
      case 'choice': {
        const enabled = pending.options.filter((o) => o.enabled);
        const explicit = opts.choices?.[pending.id];
        let pick = explicit !== undefined ? enabled.find((o) => o.id === explicit) : undefined;
        if (!pick) {
          switch (opts.choice ?? 'first') {
            case 'last':
              pick = enabled[enabled.length - 1];
              break;
            case 'random':
              pick = enabled[Math.floor(rand() * enabled.length)];
              break;
            case 'default':
              pick = enabled.find((o) => o.id === pending.default_option) ?? enabled[0];
              break;
            default:
              pick = enabled[0];
          }
        }
        if (!pick) throw new Error(`autoplay: в выборе ${pending.id} нет доступных опций`);
        report.choices.push({ choice: pending.id, option: pick.id });
        interp.choose(pick.id);
        break;
      }
      case 'minigame': {
        const def = pending.def;
        let result: MinigameResult = opts.minigames?.[def.id] ?? 'success';
        if (opts.minigames?.[def.id] === undefined) {
          const p = opts.minigame ?? 'success';
          if (p === 'random') {
            const pool: MinigameResult[] = ['success', 'partial', 'fail'];
            if (def.skip.allowed) pool.push('skipped');
            result = pool[Math.floor(rand() * pool.length)] ?? 'fail';
          } else {
            result = p;
          }
        }
        if (result === 'skipped' && !def.skip.allowed) result = 'partial';
        const r = interp.finishMinigame(result);
        report.minigames.push({ id: def.id, result, counted: r.counted });
        break;
      }
      case 'end':
        report.ending = pending.ending.id;
        report.endingKind = pending.ending.kind;
        return report;
    }
  }
  report.truncated = true;
  return report;
}
