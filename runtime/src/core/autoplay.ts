/**
 * Автопилот: проходит эпизод без интерфейса по заданной политике. Используется
 * window.__vn.autoplay (headless-прогон в CI) и тестами.
 */
import type { Interpreter } from './interpreter';
import type { ChoiceOptionView, EngineEvent, MinigameOutcomeKind, MinigameResult, Verdict } from './types';

export type ChoicePolicy = 'first' | 'last' | 'random' | 'default';
export type MinigamePolicy = MinigameResult | 'random';

export interface AutoplayOptions {
  /**
   * Политика для выборов без явного ответа. По умолчанию `first`. На дедуктивной развилке `first` и запасной
   * вариант `default` берут первую доступную ВЕРНУЮ опцию (иначе прогон собирал бы все неверные ходы);
   * `last` и `random` выбирают среди всех доступных — испробованные гаснут, верная остаётся, петля конечна.
   */
  choice?: ChoicePolicy;
  /**
   * Явные ответы: id выбора → id опции либо список ответов по порядку на повторные заходы в тот же выбор
   * (дедуктивная развилка после неверного хода задаёт вопрос снова). Недоступный ответ (в том числе уже
   * испробованный) пропускается; когда ответа нет — решает политика.
   */
  choices?: Readonly<Record<string, string | readonly string[]>>;
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
  /** Сделанные выборы по порядку; у дедуктивной развилки — с вердиктом (неверные ходы в журнал не попадают). */
  choices: Array<{ choice: string; option: string; verdict?: Verdict }>;
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

/** «Первая» опция: у дедуктивной развилки — первая доступная верная; у остальных выборов — просто первая. */
function firstOf(enabled: readonly ChoiceOptionView[]): ChoiceOptionView | undefined {
  return enabled.find((o) => o.verdict !== 'wrong') ?? enabled[0];
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

  /** Сколько ответов из явного списка уже израсходовано, по id выбора. */
  const cursor = new Map<string, number>();
  const explicitPick = (id: string, enabled: readonly ChoiceOptionView[]): ChoiceOptionView | undefined => {
    const answer = opts.choices?.[id];
    if (answer === undefined) return undefined;
    if (typeof answer === 'string') return enabled.find((o) => o.id === answer);
    let i = cursor.get(id) ?? 0;
    let pick: ChoiceOptionView | undefined;
    while (!pick && i < answer.length) {
      const want = answer[i++];
      pick = enabled.find((o) => o.id === want);
    }
    cursor.set(id, i);
    return pick;
  };

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
    for (const ev of events) {
      if (ev.t === 'scene') report.scenes.push(ev.view.scene);
      else if (ev.t === 'scene_pass') report.scenes.push(ev.scene); // сцена-логика: пройдена, хоть и без показа
    }
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
        let pick = explicitPick(pending.id, enabled);
        if (!pick) {
          switch (opts.choice ?? 'first') {
            case 'last':
              pick = enabled[enabled.length - 1];
              break;
            case 'random':
              pick = enabled[Math.floor(rand() * enabled.length)];
              break;
            case 'default':
              pick = enabled.find((o) => o.id === pending.default_option) ?? firstOf(enabled);
              break;
            default:
              pick = firstOf(enabled);
          }
        }
        if (!pick) throw new Error(`autoplay: в выборе ${pending.id} нет доступных опций`);
        report.choices.push({ choice: pending.id, option: pick.id, ...(pick.verdict !== null ? { verdict: pick.verdict } : {}) });
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
