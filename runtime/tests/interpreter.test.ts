/** Юнит-тесты интерпретатора на миниатюрных эпизодах. Полный обход ep01 — в interpreter.paths.test.ts. */
import { describe, expect, it } from 'vitest';
import { runAutoplay } from '../src/core/autoplay';
import type { AutoplayReport } from '../src/core/autoplay';
import { EngineError, Interpreter } from '../src/core/interpreter';
import { cloneState, StateError } from '../src/core/state';
import type { ChoicePending, ChoiceStep, EngineEvent, GameState, Pending, Snapshot, VariableDef } from '../src/core/types';
import { deductionEpisode, mg, miniEpisode } from './helpers/mini';

const INT: VariableDef = { type: 'int', default: 0, min: 0, max: 3 };
const BOOL: VariableDef = { type: 'bool', default: false };

function make(episode = miniEpisode({ s1: { steps: [{ do: 'end', ending: 'e_main' }] } })) {
  const warnings: string[] = [];
  const interp = new Interpreter(episode, { warn: (m) => warnings.push(m) });
  interp.start();
  return { interp, warnings };
}

/** Пройти до остановки и вернуть ожидание вместе со всеми событиями, накопленными до него. */
function until(interp: Interpreter, pred: (p: Pending) => boolean): { pending: Pending; events: EngineEvent[] } {
  const events: EngineEvent[] = [];
  for (let i = 0; i < 500; i++) {
    const r = interp.pump();
    events.push(...r.events);
    if (pred(r.pending)) return { pending: r.pending, events };
    if (r.pending.kind === 'end') throw new Error('дошли до конца, не встретив нужного ожидания');
    interp.continue();
  }
  throw new Error('нет нужного ожидания');
}

describe('линейное исполнение', () => {
  it('say / narrate останавливаются, continue двигает дальше, when пропускает шаги', () => {
    const ep = miniEpisode(
      {
        s1: {
          steps: [
            { do: 'say', who: 'a', key: 'k.1' },
            { do: 'narrate', key: 'k.skipped', when: 'flag' },
            { do: 'narrate', key: 'k.2', style: 'inner' },
            { do: 'end', ending: 'e_main' },
          ],
        },
      },
      { variables: { flag: BOOL } },
    );
    const { interp } = make(ep);
    const first = interp.pump();
    expect(first.events.map((e) => e.t)).toContain('scene');
    expect(first.pending).toMatchObject({ kind: 'line', style: 'say', who: 'a', key: 'k.1', index: 0 });
    // Повторный pump без ответа возвращает то же ожидание и не дублирует события.
    const again = interp.pump();
    expect(again.pending).toBe(first.pending);
    expect(again.events).toEqual([]);
    interp.continue();
    const second = interp.pump();
    expect(second.pending).toMatchObject({ kind: 'line', style: 'narrate', key: 'k.2', narrate_style: 'inner', who: null });
    expect(interp.state.step_index).toBe(2);
    interp.continue();
    expect(interp.pump().pending).toMatchObject({ kind: 'end', ending: { id: 'e_main' } });
    expect(interp.isEnded).toBe(true);
  });

  it('continue() не к месту — EngineError', () => {
    const { interp } = make();
    expect(() => interp.continue()).toThrow(EngineError);
    interp.pump(); // end
    expect(() => interp.continue()).toThrow(EngineError);
    expect(() => interp.choose('x')).toThrow(EngineError);
    expect(() => interp.finishMinigame('success')).toThrow(EngineError);
  });

  it('сцена без терминального шага — понятная ошибка', () => {
    const ep = miniEpisode({ s1: { steps: [{ do: 'narrate', key: 'k.1' }] } });
    const { interp } = make(ep);
    interp.pump();
    interp.continue();
    expect(() => interp.pump()).toThrow(/шаги закончились без перехода/);
  });

  it('jump на самого себя упирается в предохранитель', () => {
    const ep = miniEpisode({ s1: { steps: [{ do: 'jump', scene: 's1' }] } });
    const { interp } = make(ep);
    expect(() => interp.pump()).toThrow(/бесконечный цикл/);
  });

  it('переход на несуществующую сцену — EngineError', () => {
    const ep = miniEpisode({ s1: { steps: [{ do: 'jump', scene: 'nowhere' }] } });
    const { interp } = make(ep);
    expect(() => interp.pump()).toThrow(/несуществующую сцену/);
  });
});

describe('условие when на любом шаге (schema: у каждого шага может быть when)', () => {
  const ep = miniEpisode(
    {
      s1: {
        steps: [
          { do: 'set', effects: [{ var: 'n', op: 'add', value: 1 }], when: 'flag' },
          { do: 'show', who: 'a', when: '!flag' },
          { do: 'cg', cg: 'cg_a', when: 'flag' },
          { do: 'caption', key: 'k.cap', style: 'location', when: 'flag' },
          { do: 'fx', fx: 'flash', when: 'flag' },
          { do: 'archive_unlock', item: 'arc_x', when: 'flag' },
          { do: 'jump', scene: 's2', when: 'flag' },
          { do: 'jump', scene: 's3' },
        ],
      },
      s2: { steps: [{ do: 'end', ending: 'e_main' }] },
      s3: { steps: [{ do: 'end', ending: 'e_alt' }] },
    },
    { variables: { n: INT, flag: BOOL } },
  );

  it('ложное условие пропускает шаг любого вида, в том числе terminal jump', () => {
    const { interp } = make(ep);
    const { events, pending } = interp.pump();
    expect(interp.state.vars.n).toBe(0);
    // cg, caption, fx, archive_unlock и первый jump пропущены; show (when: !flag) выполнен.
    // Единственный archive — от ending e_alt (unlocks), а не от пропущенного archive_unlock.
    expect(events.map((e) => e.t)).toEqual(['scene', 'checkpoint', 'show', 'scene', 'archive']);
    expect(events.find((e) => e.t === 'archive')).toEqual({ t: 'archive', item: 'arc_x', toast: false });
    expect(pending).toMatchObject({ kind: 'end', ending: { id: 'e_alt' } });
    expect(interp.view.cg).toBeNull();
  });

  it('истинное условие выполняет шаги', () => {
    const { interp } = make(ep);
    interp.setVar('flag', true);
    const first = interp.pump();
    expect(first.events.map((e) => e.t)).toEqual(['scene', 'checkpoint', 'cg', 'caption']);
    expect(interp.view.cg).toBe('cg_a');
    expect(interp.view.sprites).toEqual([]); // show с when: !flag пропущен
    expect(first.pending).toMatchObject({ kind: 'hold', reason: 'fx', fx: { fx: 'flash' } });
    interp.continue();
    const end = interp.pump();
    expect(end.events.map((e) => e.t)).toEqual(['archive', 'scene']);
    expect(end.events[0]).toEqual({ t: 'archive', item: 'arc_x', toast: true });
    expect(end.pending).toMatchObject({ kind: 'end', ending: { id: 'e_main' } });
    expect(interp.state.vars.n).toBe(1);
  });
});

describe('переменные и эффекты', () => {
  const ep = miniEpisode(
    {
      s1: {
        steps: [
          { do: 'set', effects: [{ var: 'n', op: 'add', value: 5 }] },
          { do: 'narrate', key: 'k.hi', when: 'n == 3' },
          { do: 'set', effects: [{ var: 'n', op: 'sub', value: 10 }, { var: 'flag', op: 'toggle' }] },
          { do: 'narrate', key: 'k.lo', when: 'n == 0 && flag' },
          { do: 'set', effects: [{ var: 'g', op: 'add', value: 1 }, { var: 'name', op: 'set', value: 'full' }] },
          { do: 'end', ending: 'e_main' },
        ],
      },
    },
    {
      variables: {
        n: INT,
        flag: BOOL,
        g: { type: 'int', default: 0, scope: 'global', min: 0, max: 5 },
        name: { type: 'string', default: 'none' },
      },
    },
  );

  it('add/sub зажимаются в [min, max], toggle, set; глобальные лежат отдельно', () => {
    const { interp } = make(ep);
    expect(interp.pump().pending).toMatchObject({ key: 'k.hi' }); // 0 + 5 → зажато до 3
    interp.continue();
    expect(interp.pump().pending).toMatchObject({ key: 'k.lo' }); // 3 − 10 → 0, flag стал true
    interp.continue();
    expect(interp.pump().pending.kind).toBe('end');
    expect(interp.state.vars).toEqual({ n: 0, flag: true, name: 'full' });
    expect(interp.state.globals).toEqual({ g: 1 });
    expect(interp.env()).toEqual({ n: 0, flag: true, name: 'full', g: 1 });
  });

  it('перенесённые глобальные подставляются только в объявленные global-переменные', () => {
    const interp = new Interpreter(ep, { carriedGlobals: { g: 4, n: 3, alien: 1 } });
    interp.start();
    expect(interp.state.globals).toEqual({ g: 4 });
    expect(interp.state.vars.n).toBe(0);
  });

  it('неверный тип и необъявленная переменная — StateError', () => {
    const bad = miniEpisode(
      { s1: { steps: [{ do: 'set', effects: [{ var: 'n', op: 'set', value: 'oops' }] }, { do: 'end', ending: 'e_main' }] } },
      { variables: { n: INT } },
    );
    expect(() => make(bad).interp.pump()).toThrow(StateError);
    const ghost = miniEpisode(
      { s1: { steps: [{ do: 'set', effects: [{ var: 'zz', op: 'toggle' }] }, { do: 'end', ending: 'e_main' }] } },
      { variables: { n: INT } },
    );
    expect(() => make(ghost).interp.pump()).toThrow(StateError);
  });

  it('ошибка в условии сообщает сцену и шаг', () => {
    const bad = miniEpisode({
      s1: { steps: [{ do: 'narrate', key: 'k', when: 'ghost' }, { do: 'end', ending: 'e_main' }] },
    });
    expect(() => make(bad).interp.pump()).toThrow(/сцена s1, шаг 0 \(narrate\)/);
  });

  it('debug: setVar проверяет тип и границы', () => {
    const { interp } = make(ep);
    interp.setVar('n', 99);
    expect(interp.state.vars.n).toBe(3);
    expect(() => interp.setVar('n', 'x')).toThrow(StateError);
  });
});

describe('branch', () => {
  const ep = miniEpisode(
    {
      s1: { steps: [{ do: 'branch', cases: [{ when: 'a', goto: 's_a' }, { when: 'b', goto: 's_b' }], default: 's_d' }] },
      s_a: { steps: [{ do: 'end', ending: 'e_main' }] },
      s_b: { steps: [{ do: 'end', ending: 'e_alt' }] },
      s_d: { steps: [{ do: 'narrate', key: 'k.d' }, { do: 'end', ending: 'e_main' }] },
    },
    { variables: { a: BOOL, b: BOOL } },
  );

  it('берёт первую истинную ветку, иначе default', () => {
    for (const [a, b, expected] of [
      [true, true, 's_a'],
      [false, true, 's_b'],
      [false, false, 's_d'],
    ] as const) {
      const { interp } = make(ep);
      interp.setVar('a', a);
      interp.setVar('b', b);
      const { events } = interp.pump();
      expect(events.filter((e) => e.t === 'scene').map((e) => (e.t === 'scene' ? e.view.scene : ''))).toEqual(['s1', expected]);
    }
  });
});

describe('выборы', () => {
  const ep = miniEpisode(
    {
      s1: {
        steps: [
          {
            do: 'choice',
            id: 'c1',
            kind: 'moral',
            prompt_key: 'k.prompt',
            timer_ms: 5000,
            default_option: 'two',
            options: [
              { id: 'one', key: 'k.one', effects: [{ var: 'n', op: 'add', value: 1 }], goto: 's2' },
              { id: 'two', key: 'k.two', goto: 's2' },
              { id: 'locked', key: 'k.locked', when: 'flag', goto: 's2' },
              { id: 'secret', key: 'k.secret', when: 'flag', hidden_when_false: true, goto: 's2' },
            ],
          },
        ],
      },
      s2: {
        steps: [
          {
            do: 'choice',
            id: 'c2',
            remember: false,
            options: [
              { id: 'x', key: 'k.x', goto: 's3' },
              { id: 'y', key: 'k.y', goto: 's3' },
            ],
          },
        ],
      },
      s3: { steps: [{ do: 'end', ending: 'e_main' }] },
    },
    { variables: { n: INT, flag: BOOL } },
  );

  it('недоступные опции показываются выключенными, скрытые — не показываются', () => {
    const { interp } = make(ep);
    const { pending } = interp.pump();
    expect(pending).toMatchObject({
      kind: 'choice',
      id: 'c1',
      choice_kind: 'moral',
      timer_ms: 5000,
      default_option: 'two',
      remember: true,
      prompt_key: 'k.prompt',
      deduction: null,
    });
    if (pending.kind !== 'choice') throw new Error();
    // Обычный выбор: полей дедукции нет (verdict/item — null, tried/hinted — false).
    const plain = { verdict: null, tried: false, hinted: false, item: null };
    expect(pending.options).toEqual([
      { id: 'one', key: 'k.one', enabled: true, ...plain },
      { id: 'two', key: 'k.two', enabled: true, ...plain },
      { id: 'locked', key: 'k.locked', enabled: false, ...plain },
    ]);
  });

  it('когда условие выполнено, скрытая опция появляется', () => {
    const { interp } = make(ep);
    interp.setVar('flag', true);
    const { pending } = interp.pump();
    if (pending.kind !== 'choice') throw new Error();
    expect(pending.options.map((o) => [o.id, o.enabled])).toEqual([
      ['one', true],
      ['two', true],
      ['locked', true],
      ['secret', true],
    ]);
  });

  it('choose применяет эффекты, пишет журнал, переходит и просит автосейв', () => {
    const { interp } = make(ep);
    interp.pump();
    interp.choose('one');
    expect(interp.state.vars.n).toBe(1);
    expect(interp.state.journal).toEqual([
      { choice: 'c1', option: 'one', scene: 's1', kind: 'moral', prompt_key: 'k.prompt', key: 'k.one' },
    ]);
    const { events, pending } = interp.pump();
    expect(events.map((e) => e.t)).toEqual(['scene', 'checkpoint']);
    expect(pending).toMatchObject({ kind: 'choice', id: 'c2' });
    interp.choose('y'); // remember:false → без записи в журнал
    expect(interp.state.journal).toHaveLength(1);
    expect(interp.pump().pending.kind).toBe('end');
  });

  it('недоступную и несуществующую опцию выбрать нельзя', () => {
    const { interp } = make(ep);
    interp.pump();
    expect(() => interp.choose('locked')).toThrow(/недоступна/);
    expect(() => interp.choose('secret')).toThrow(EngineError);
    expect(() => interp.choose('nope')).toThrow(/нет опции/);
  });

  it('если доступных опций нет вообще — показываются все (и есть предупреждение)', () => {
    const stuck = miniEpisode(
      {
        s1: {
          steps: [
            {
              do: 'choice',
              id: 'c',
              options: [
                { id: 'p', key: 'k.p', when: 'flag', goto: 's2' },
                { id: 'q', key: 'k.q', when: 'flag', hidden_when_false: true, goto: 's2' },
              ],
            },
          ],
        },
        s2: { steps: [{ do: 'end', ending: 'e_main' }] },
      },
      { variables: { flag: BOOL } },
    );
    const { interp, warnings } = make(stuck);
    const { pending } = interp.pump();
    if (pending.kind !== 'choice') throw new Error();
    expect(pending.options.map((o) => o.enabled)).toEqual([true, true]);
    expect(warnings.join('\n')).toMatch(/нет доступных опций/);
  });
});

describe('дедуктивная развилка (kind=deduction)', () => {
  /** Дойти до ближайшего выбора (реплики пролистываются). */
  function question(interp: Interpreter): ChoicePending {
    const { pending } = until(interp, (p) => p.kind === 'choice');
    if (pending.kind !== 'choice') throw new Error('ждали выбор');
    return pending;
  }
  /** Новая партия: c0 (look — открыть улику arc_card) и вопрос d1. */
  function atQuestion(card = false, episode = deductionEpisode()) {
    const made = make(episode);
    expect(question(made.interp)).toMatchObject({ id: 'c0', deduction: null });
    made.interp.choose(card ? 'look' : 'skip');
    return { ...made, p: question(made.interp) };
  }
  const opt = (p: ChoicePending, id: string) => p.options.find((o) => o.id === id);

  it('вопрос: у опций вердикты; опции-улики без материала в архиве нет вовсе; шкала — первый эффект penalty (nerves 5 из 5)', () => {
    const { p, warnings } = atQuestion();
    expect(p).toMatchObject({
      id: 'd1',
      choice_kind: 'deduction',
      prompt_key: 'k.q',
      timer_ms: null,
      remember: true,
      deduction: { fails: 0, hint_after: 2, meter: { var: 'nerves', value: 5, max: 5 } },
    });
    const none = { tried: false, hinted: false, item: null };
    expect(p.options).toEqual([
      { id: 'w1', key: 'k.w1', enabled: true, verdict: 'wrong', ...none },
      { id: 'w2', key: 'k.w2', enabled: true, verdict: 'wrong', ...none },
      { id: 'r', key: 'k.r', enabled: true, verdict: 'right', ...none },
    ]);
    expect(warnings).toEqual([]);
  });

  it('неверный ход: fails=1, penalty (nerves 5→4), опция в tried, журнал пуст; реакция, jump назад — вопрос снова, опция погашена', () => {
    const { interp } = atQuestion();
    interp.choose('w1');
    expect(interp.state.deductions).toEqual({ d1: { fails: 1, tried: ['w1'] } });
    expect(interp.state.vars.nerves).toBe(4);
    expect(interp.state.journal).toEqual([]);
    const react = interp.pump();
    expect(react.events).toContainEqual({ t: 'checkpoint', reason: 'choice' }); // автосейв как после любого выбора
    expect(react.pending).toMatchObject({ kind: 'line', key: 'k.no1' });
    expect(interp.state.scene_id).toBe('s_w1');
    interp.continue();
    const again = question(interp);
    expect(interp.state.scene_id).toBe('s_q');
    expect(again.id).toBe('d1');
    expect(opt(again, 'w1')).toMatchObject({ enabled: false, tried: true, hinted: false, verdict: 'wrong' });
    expect(opt(again, 'w2')).toMatchObject({ enabled: true, tried: false });
    expect(again.deduction).toEqual({ fails: 1, hint_after: 2, meter: { var: 'nerves', value: 4, max: 5 } });
    expect(() => interp.choose('w1')).toThrow(/недоступна/);
  });

  it('второй неверный ход: fails=2 и подсказка у верной; верный ход пишет журнал с fails: 2, счётчики остаются', () => {
    const { interp } = atQuestion();
    interp.choose('w1');
    question(interp);
    interp.choose('w2');
    expect(interp.state.vars).toMatchObject({ nerves: 3, pushed: true }); // penalty и эффекты опции
    const p = question(interp);
    expect(p.deduction).toMatchObject({ fails: 2, hint_after: 2, meter: { value: 3 } });
    expect(p.options.map((o) => [o.id, o.enabled, o.tried, o.hinted])).toEqual([
      ['w1', false, true, false],
      ['w2', false, true, false],
      ['r', true, false, true],
    ]);
    interp.choose('r');
    expect(interp.state.journal).toEqual([{ choice: 'd1', option: 'r', scene: 's_q', kind: 'deduction', prompt_key: 'k.q', key: 'k.r', fails: 2 }]);
    expect(interp.state.deductions).toEqual({ d1: { fails: 2, tried: ['w1', 'w2'] } });
    // nerves 3 < 4: дальше ветка «сбит с толку»
    expect(until(interp, (x) => x.kind === 'end').pending).toMatchObject({ ending: { id: 'e_alt' } });
  });

  it('penalty применяется до эффектов неверной опции', () => {
    const ep = deductionEpisode();
    const step = ep.scenes.s_q!.steps[2] as ChoiceStep;
    step.options[0]!.effects = [{ var: 'nerves', op: 'set', value: 2 }];
    const { interp } = atQuestion(false, ep);
    interp.choose('w1');
    expect(interp.state.vars.nerves).toBe(2); // 5 → 4 (penalty) → 2 (set опции), а не 2 → 1
  });

  it('верный ход сразу: журнал с fails: 0, счётчиков нет; hint_after шага (1) включает подсказку после первой ошибки', () => {
    const a = atQuestion();
    a.interp.choose('r');
    expect(a.interp.state.journal).toEqual([{ choice: 'd1', option: 'r', scene: 's_q', kind: 'deduction', prompt_key: 'k.q', key: 'k.r', fails: 0 }]);
    expect(a.interp.state.deductions).toEqual({});

    const b = atQuestion(false, deductionEpisode({ hint_after: 1 }));
    expect(b.p.options.some((o) => o.hinted)).toBe(false);
    b.interp.choose('w2');
    const p = question(b.interp);
    expect(p.deduction?.hint_after).toBe(1);
    expect(p.options.filter((o) => o.hinted).map((o) => o.id)).toEqual(['r']);
  });

  it('опция-улика появляется после archive_unlock: карточка с видом и названием материала, верная по умолчанию, тоже подсвечивается', () => {
    const { interp, p } = atQuestion(true);
    expect(interp.state.archive).toContain('arc_card');
    expect(p.options.map((o) => o.id)).toEqual(['w1', 'w2', 'ev', 'r']);
    expect(opt(p, 'ev')).toEqual({
      id: 'ev',
      key: 'k.ev',
      enabled: true,
      verdict: 'right',
      tried: false,
      hinted: false,
      item: { id: 'arc_card', kind: 'photo', title_key: 'mini.arc_card' },
    });
    interp.choose('w1');
    question(interp);
    interp.choose('w2');
    expect(question(interp).options.filter((o) => o.hinted).map((o) => o.id)).toEqual(['ev', 'r']);
    interp.choose('ev');
    expect(interp.state.journal).toEqual([expect.objectContaining({ choice: 'd1', option: 'ev', fails: 2 })]);
  });

  it('снимки: счётчики переживают restore и откат; снимок до ошибки возвращает опцию; старый снимок без поля — {}; cloneState глубокий', () => {
    const { interp } = atQuestion();
    const before = interp.snapshot();
    interp.choose('w1');
    interp.pump(); // реакция
    const after = interp.snapshot();
    expect(after.state.deductions).toEqual({ d1: { fails: 1, tried: ['w1'] } });
    const copy = cloneState(interp.state);
    copy.deductions.d1!.tried.push('w2');
    copy.deductions.d1!.fails = 9;
    expect(interp.state.deductions).toEqual({ d1: { fails: 1, tried: ['w1'] } });

    const other = new Interpreter(deductionEpisode());
    other.restore(JSON.parse(JSON.stringify(after)) as Snapshot);
    expect(other.state.deductions).toEqual({ d1: { fails: 1, tried: ['w1'] } });
    expect(opt(question(other), 'w1')).toMatchObject({ enabled: false, tried: true });

    other.restore(before);
    expect(other.state.deductions).toEqual({});
    expect(other.state.vars.nerves).toBe(5);
    expect(opt(question(other), 'w1')).toMatchObject({ enabled: true, tried: false });

    const legacy = JSON.parse(JSON.stringify(before)) as Snapshot;
    delete (legacy.state as Partial<GameState>).deductions;
    other.restore(legacy);
    expect(other.state.deductions).toEqual({});
    expect(question(other).deduction?.fails).toBe(0);
  });

  it('ошибка контента — верной опции нет (when ложно, скрыта): после всех неверных ходов показываются все опции и предупреждение', () => {
    const ep = deductionEpisode();
    const step = ep.scenes.s_q!.steps[2] as ChoiceStep;
    step.options = step.options.map((o) => (o.id === 'r' ? { ...o, when: 'has_card', hidden_when_false: true } : o));
    const { interp, warnings } = atQuestion(false, ep);
    interp.choose('w1');
    question(interp);
    interp.choose('w2');
    const p = question(interp);
    expect(warnings.join('\n')).toMatch(/нет доступных опций/);
    expect(p.options.map((o) => [o.id, o.enabled, o.tried])).toEqual([
      ['w1', true, false],
      ['w2', true, false],
      ['ev', true, false],
      ['r', true, false],
    ]);
    interp.choose('r');
    expect(interp.state.journal).toEqual([expect.objectContaining({ option: 'r', fails: 2 })]);
  });
});

describe('автопилот на дедуктивной развилке', () => {
  const ep = deductionEpisode();
  const picks = (r: AutoplayReport) => r.choices.filter((c) => c.choice === 'd1');

  it('first и default сразу берут первую доступную ВЕРНУЮ опцию (с уликой — её карточку): неверных ходов нет', () => {
    for (const policy of ['first', 'default'] as const) {
      const r = runAutoplay(new Interpreter(ep), policy);
      expect(r.choices, policy).toEqual([
        { choice: 'c0', option: 'look' },
        { choice: 'd1', option: 'ev', verdict: 'right' },
      ]);
      expect(r.scenes).not.toContain('s_w1');
      expect(r).toMatchObject({ ending: 'e_main', truncated: false });
    }
    const noCard = runAutoplay(new Interpreter(ep), { choices: { c0: 'skip' } });
    expect(picks(noCard)).toEqual([{ choice: 'd1', option: 'r', verdict: 'right' }]);
  });

  it('random и last: петля конечна — испробованные гаснут, последний ход верный, неверные без повторов', () => {
    let wrongSeen = false;
    for (let seed = 1; seed <= 80; seed++) {
      const r = runAutoplay(new Interpreter(ep), { choice: 'random', seed });
      expect(r.truncated, `seed ${seed}`).toBe(false);
      expect(r.ending, `seed ${seed}`).not.toBeNull();
      const d = picks(r);
      expect(d.at(-1)?.verdict).toBe('right');
      expect(d.slice(0, -1).every((c) => c.verdict === 'wrong')).toBe(true);
      expect(new Set(d.map((c) => c.option)).size).toBe(d.length);
      if (d.length > 1) wrongSeen = true;
    }
    expect(wrongSeen).toBe(true);
    // last на развилке, где последней стоит неверная: перебирает неверные с конца, пока не останется верная
    const reversed = deductionEpisode();
    (reversed.scenes.s_q!.steps[2] as ChoiceStep).options.reverse();
    const last = runAutoplay(new Interpreter(reversed), { choice: 'last' });
    expect(last.choices.map((c) => c.option)).toEqual(['skip', 'w1', 'w2', 'r']);
    expect(last).toMatchObject({ ending: 'e_alt', truncated: false });
  });

  it('явные ответы: список — по порядку на повторные заходы; одиночный неверный ответ не зацикливает (дальше решает политика)', () => {
    const seq = runAutoplay(new Interpreter(ep), { choices: { c0: 'skip', d1: ['w2', 'w1', 'r'] } });
    expect(picks(seq)).toEqual([
      { choice: 'd1', option: 'w2', verdict: 'wrong' },
      { choice: 'd1', option: 'w1', verdict: 'wrong' },
      { choice: 'd1', option: 'r', verdict: 'right' },
    ]);
    expect(seq.scenes.filter((s) => s === 's_q')).toHaveLength(3);
    expect(seq.ending).toBe('e_alt');
    const single = runAutoplay(new Interpreter(ep), { choices: { c0: 'skip', d1: 'w1' } });
    expect(picks(single).map((c) => c.option)).toEqual(['w1', 'r']);
    expect(single.ending).toBe('e_main');
    // ответ из списка, которого нет среди доступных, пропускается
    const skipped = runAutoplay(new Interpreter(ep), { choices: { c0: 'skip', d1: ['ev', 'w1'] } });
    expect(picks(skipped).map((c) => c.option)).toEqual(['w1', 'r']);
  });
});

describe('мини-игры', () => {
  const outcomes = {
    success: { goto: 's_ok', effects: [{ var: 'n', op: 'set' as const, value: 3 }], archive_unlock: 'arc_x' },
    partial: { goto: 's_part', effects: [{ var: 'n', op: 'set' as const, value: 2 }] },
    fail: { goto: 's_bad' },
  };
  const ep = miniEpisode(
    {
      s1: { steps: [{ do: 'minigame', minigame: 'm1', intro_key: 'k.intro' }] },
      s2: { steps: [{ do: 'minigame', minigame: 'm_nopartial' }] },
      s3: { steps: [{ do: 'minigame', minigame: 'm_noskip' }] },
      s_ok: { steps: [{ do: 'end', ending: 'e_main' }] },
      s_part: { steps: [{ do: 'end', ending: 'e_main' }] },
      s_bad: { steps: [{ do: 'end', ending: 'e_main' }] },
    },
    {
      variables: { n: INT },
      minigames: {
        m1: mg('m1', { outcomes, skip: { allowed: true, skip_counts_as: 'success' } }),
        m_nopartial: mg('m_nopartial', {
          outcomes: { success: { goto: 's_ok' }, fail: { goto: 's_bad' } },
          skip: { allowed: true },
        }),
        m_noskip: mg('m_noskip', { outcomes, skip: { allowed: false } }),
      },
    },
  );

  const finish = (scene: string, result: Parameters<Interpreter['finishMinigame']>[0]) => {
    const { interp } = make(ep);
    interp.jumpTo(scene);
    const { pending } = interp.pump();
    expect(pending.kind).toBe('minigame');
    const res = interp.finishMinigame(result);
    const { events } = interp.pump();
    return { interp, res, events };
  };

  it('success / partial / fail ведут по своим исходам; эффекты и архив применяются', () => {
    const ok = finish('s1', 'success');
    expect(ok.res).toEqual({ result: 'success', counted: 'success', goto: 's_ok' });
    expect(ok.interp.state.vars.n).toBe(3);
    expect(ok.interp.state.archive).toEqual(['arc_x']);
    expect(ok.events.map((e) => e.t)).toEqual(['archive', 'scene', 'checkpoint']);
    const part = finish('s1', 'partial');
    expect(part.res.goto).toBe('s_part');
    expect(part.interp.state.vars.n).toBe(2);
    const bad = finish('s1', 'fail');
    expect(bad.res.goto).toBe('s_bad');
    expect(bad.interp.state.vars.n).toBe(0);
  });

  it('skipped маппится в skip.skip_counts_as (по умолчанию partial)', () => {
    expect(finish('s1', 'skipped').res).toEqual({ result: 'skipped', counted: 'success', goto: 's_ok' });
    // у m_nopartial counts_as не задан → partial, а partial-исхода нет → запасной fail
    expect(finish('s2', 'skipped').res).toEqual({ result: 'skipped', counted: 'partial', goto: 's_bad' });
  });

  it('если partial-исхода нет, частичный результат считается неудачей', () => {
    expect(finish('s2', 'partial').res.goto).toBe('s_bad');
    expect(finish('s2', 'success').res.goto).toBe('s_ok');
  });

  it('пропуск запрещён, если skip.allowed=false', () => {
    const { interp } = make(ep);
    interp.jumpTo('s3');
    interp.pump();
    expect(() => interp.finishMinigame('skipped')).toThrow(/пропуск запрещён/);
  });

  it('неизвестная мини-игра — EngineError', () => {
    const bad = miniEpisode({ s1: { steps: [{ do: 'minigame', minigame: 'ghost' }] } });
    expect(() => make(bad).interp.pump()).toThrow(/не объявлена/);
  });
});

describe('титры и эффекты', () => {
  const ep = miniEpisode({
    s1: {
      steps: [
        { do: 'caption', key: 'k.date', style: 'date_stamp', hold_ms: 1500 },
        { do: 'caption', key: 'k.loc', style: 'location' },
        { do: 'caption', key: 'k.ch', style: 'chapter', hold_ms: 2000 },
        { do: 'fx', fx: 'black_hold', ms: 700 },
        { do: 'fx', fx: 'flash' },
        { do: 'caption', key: 'k.fact', style: 'fact' },
        { do: 'end', ending: 'e_main' },
      ],
    },
  });

  it('date_stamp/location/lower_third не блокируют; chapter/fact и fx держат паузу', () => {
    const { interp } = make(ep);
    const a = interp.pump();
    expect(a.events.filter((e) => e.t === 'caption')).toEqual([
      { t: 'caption', key: 'k.date', style: 'date_stamp', hold_ms: 1500 },
      { t: 'caption', key: 'k.loc', style: 'location', hold_ms: 3500 },
    ]);
    expect(a.pending).toEqual({ kind: 'hold', reason: 'caption', ms: 2000, caption: { key: 'k.ch', style: 'chapter' } });
    interp.continue();
    expect(interp.pump().pending).toEqual({ kind: 'hold', reason: 'fx', ms: 700, fx: { fx: 'black_hold', intensity: 1 } });
    interp.continue();
    expect(interp.pump().pending).toMatchObject({ kind: 'hold', reason: 'fx', ms: 250, fx: { fx: 'flash' } });
    interp.continue();
    expect(interp.pump().pending).toMatchObject({ kind: 'hold', reason: 'caption', ms: 4000 });
  });
});

describe('сцена: спрайты, CG, звук', () => {
  it('show / hide / say меняют спрайты и speaker; say может сменить выражение', () => {
    const ep = miniEpisode({
      s1: {
        steps: [
          { do: 'show', who: 'a', expression: 'calm', position: 'left' },
          { do: 'show', who: 'b', position: 'right', silhouette: true },
          { do: 'say', who: 'a', key: 'k.1', expression: 'angry' },
          { do: 'say', who: 'b', key: 'k.2' },
          { do: 'narrate', key: 'k.3' },
          { do: 'hide', who: 'a', transition: 'fade' },
          { do: 'end', ending: 'e_main' },
        ],
      },
    });
    const { interp } = make(ep);
    const first = until(interp, (p) => p.kind === 'line');
    const shows = first.events.filter((e) => e.t === 'show');
    expect(shows).toHaveLength(3); // два show + смена выражения у a
    expect(first.events.at(-1)).toEqual({ t: 'speaker', who: 'a' });
    expect(interp.view.sprites).toEqual([
      { who: 'a', expression: 'angry', pose: null, position: 'left', silhouette: false },
      { who: 'b', expression: null, pose: null, position: 'right', silhouette: true },
    ]);
    expect(first.pending).toMatchObject({ who: 'a', expression: 'angry' });
    interp.continue();
    interp.pump();
    expect(interp.view.speaker).toBe('b');
    interp.continue();
    interp.pump();
    expect(interp.view.speaker).toBeNull();
    interp.continue();
    const end = interp.pump();
    expect(end.events.find((e) => e.t === 'hide')).toEqual({ t: 'hide', who: 'a', transition: 'fade' });
    expect(interp.view.sprites.map((s) => s.who)).toEqual(['b']);
  });

  it('say сразу показывает говорящего, только если указана позиция', () => {
    const ep = miniEpisode({
      s1: {
        steps: [
          { do: 'say', who: 'a', key: 'k.1', expression: 'calm' },
          { do: 'say', who: 'b', key: 'k.2', position: 'center' },
          { do: 'end', ending: 'e_main' },
        ],
      },
    });
    const { interp } = make(ep);
    interp.pump();
    expect(interp.view.sprites).toEqual([]);
    interp.continue();
    interp.pump();
    expect(interp.view.sprites.map((s) => s.who)).toEqual(['b']);
  });

  it('say с position offscreen_*: запись остаётся в view.sprites, speaker выставлен, реплика показывается как обычно', () => {
    // Голос за кадром (раненый герой звонит из больницы): рендерер такой спрайт не рисует,
    // но имя говорящего и текст реплики интерфейс показывает обычным образом.
    const ep = miniEpisode({
      s1: {
        steps: [
          { do: 'show', who: 'a', expression: 'calm', position: 'left' },
          { do: 'say', who: 'b', key: 'k.call', expression: 'hurt', position: 'offscreen_right' },
          { do: 'say', who: 'b', key: 'k.call2', position: 'offscreen_left' },
          { do: 'end', ending: 'e_main' },
        ],
      },
    });
    const { interp } = make(ep);
    const first = until(interp, (p) => p.kind === 'line');
    expect(first.pending).toMatchObject({ kind: 'line', style: 'say', who: 'b', key: 'k.call', expression: 'hurt' });
    expect(interp.view.speaker).toBe('b');
    expect(interp.view.sprites).toEqual([
      { who: 'a', expression: 'calm', pose: null, position: 'left', silhouette: false },
      { who: 'b', expression: 'hurt', pose: null, position: 'offscreen_right', silhouette: false },
    ]);
    expect(first.events.filter((e) => e.t === 'show')).toHaveLength(2);
    expect(first.events.at(-1)).toEqual({ t: 'speaker', who: 'b' });
    // Повторная реплика с другой offscreen-позицией обновляет запись, а не плодит новую.
    interp.continue();
    interp.pump();
    expect(interp.view.sprites.filter((s) => s.who === 'b')).toEqual([
      { who: 'b', expression: 'hurt', pose: null, position: 'offscreen_left', silhouette: false },
    ]);
    expect(interp.view.speaker).toBe('b');
  });

  it('смена сцены очищает спрайты; музыка переключается только если id другой', () => {
    const ep = miniEpisode({
      s1: {
        music: 'm_a',
        ambient: 'amb_a',
        steps: [{ do: 'show', who: 'a' }, { do: 'sfx', id: 'sfx_a' }, { do: 'jump', scene: 's2', transition: 'vhs_glitch' }],
      },
      s2: { music: 'm_a', steps: [{ do: 'jump', scene: 's3' }] },
      s3: { music: 'm_b', steps: [{ do: 'stop_ambient' }, { do: 'music' }, { do: 'end', ending: 'e_main' }] },
    });
    const { interp, warnings } = make(ep);
    const { events } = interp.pump();
    const audio = events.filter((e) => e.t === 'audio').map((e) => (e.t === 'audio' ? `${e.kind}:${e.id}` : ''));
    expect(audio).toEqual(['music:m_a', 'ambient:amb_a', 'sfx:sfx_a', 'music:m_b', 'stop_ambient:null']);
    const scenes = events.filter((e) => e.t === 'scene');
    expect(scenes.map((e) => (e.t === 'scene' ? [e.view.scene, e.transition] : []))).toEqual([
      ['s1', 'fade'],
      ['s2', 'vhs_glitch'],
      ['s3', 'cut'],
    ]);
    expect(interp.view.sprites).toEqual([]);
    expect(interp.view.music).toBe('m_b');
    expect(interp.view.ambient).toBeNull();
    expect(warnings.join()).toMatch(/без id/);
  });

  describe('CG', () => {
    const ep = miniEpisode(
      {
        s1: {
          steps: [
            { do: 'cg', cg: 'cg_a', transition: 'flash' },
            { do: 'jump', scene: 's2' },
          ],
        },
        s2: { steps: [{ do: 'narrate', key: 'k.1' }, { do: 'narrate', key: 'k.2' }, { do: 'jump', scene: 's3' }] },
        s3: {
          block: 'b2',
          steps: [{ do: 'cg', cg: 'cg_b', hide_after: false }, { do: 'narrate', key: 'k.3' }, { do: 'bg', bg: 'bg_z', filter: 'noir' }, { do: 'end', ending: 'e_main' }],
        },
      },
      {
        blocks: [
          { id: 'b1', entry_scene: 's1' },
          { id: 'b2', entry_scene: 's3' },
        ],
      },
    );

    it('переживает смену сцены в блоке и скрывается после ближайшей реплики (hide_after по умолчанию)', () => {
      const { interp } = make(ep);
      const r = interp.pump();
      expect(r.events.filter((e) => e.t === 'cg')).toEqual([{ t: 'cg', cg: 'cg_a', transition: 'flash' }]);
      expect(interp.view.cg).toBe('cg_a'); // кадр держится в s2
      interp.continue();
      const r2 = interp.pump();
      expect(r2.events.some((e) => e.t === 'cg_hide')).toBe(true);
      expect(interp.view.cg).toBeNull();
    });

    it('hide_after:false не скрывается репликой, но bg-шаг его убирает', () => {
      const { interp } = make(ep);
      interp.jumpTo('s3');
      const r = interp.pump();
      expect(r.pending).toMatchObject({ key: 'k.3' });
      interp.continue();
      expect(interp.view.cg).toBe('cg_b');
      const r2 = interp.pump();
      expect(r2.events.map((e) => e.t)).toEqual(['cg_hide', 'bg']);
      expect(r2.events.find((e) => e.t === 'bg')).toMatchObject({ bg: 'bg_z', filter: 'noir' });
      expect(interp.view.cg).toBeNull();
    });

    it('граница блока гасит CG', () => {
      const e2 = miniEpisode(
        {
          s1: { steps: [{ do: 'cg', cg: 'cg_a', hide_after: false }, { do: 'jump', scene: 's2' }] },
          s2: { block: 'b2', steps: [{ do: 'end', ending: 'e_main' }] },
        },
        { blocks: [{ id: 'b1', entry_scene: 's1' }, { id: 'b2', entry_scene: 's2' }] },
      );
      const { interp } = make(e2);
      const r = interp.pump();
      expect(r.events.map((e) => e.t)).toContain('cg_hide');
      expect(interp.view.cg).toBeNull();
    });
  });

  it('неизвестный фильтр в bg игнорируется с предупреждением', () => {
    const ep = miniEpisode({ s1: { steps: [{ do: 'bg', bg: 'bg_z', filter: 'rainbow' }, { do: 'end', ending: 'e_main' }] } });
    const { interp, warnings } = make(ep);
    interp.pump();
    expect(interp.view.filter).toBeNull();
    expect(interp.view.bg).toBe('bg_z');
    expect(warnings.join()).toMatch(/неизвестный фильтр/);
  });
});

describe('блоки: условия, реклама, автосейв', () => {
  const ep = miniEpisode(
    {
      s1: { block: 'b1', steps: [{ do: 'narrate', key: 'k.1' }, { do: 'jump', scene: 's2' }] },
      s2: { block: 'b2', steps: [{ do: 'jump', scene: 's3' }] },
      s3: { block: 'b3', steps: [{ do: 'narrate', key: 'k.3' }, { do: 'jump', scene: 's4' }] },
      s3b: { block: 'b3', steps: [{ do: 'end', ending: 'e_main' }] },
      s4: { block: 'b4', steps: [{ do: 'end', ending: 'e_alt' }] },
    },
    {
      variables: { gate: BOOL },
      blocks: [
        { id: 'b1', entry_scene: 's1', ad_break_allowed: true }, // первый блок: рекламы перед эпизодом нет
        { id: 'b2', entry_scene: 's2', ad_break_allowed: true, autosave: false },
        { id: 'b3', entry_scene: 's3', when: 'gate' },
        { id: 'b4', entry_scene: 's4' },
      ],
    },
  );

  it('ad_break — только перед блоком с ad_break_allowed и не перед первым; autosave:false не просит сейв', () => {
    const { interp } = make(ep);
    const first = interp.pump();
    expect(first.pending.kind).toBe('line'); // без ad_break перед первым блоком
    expect(first.events.filter((e) => e.t === 'checkpoint')).toHaveLength(1);
    interp.continue();
    const second = interp.pump();
    expect(second.pending).toEqual({ kind: 'ad_break', block: 'b2' });
    expect(second.events.filter((e) => e.t === 'checkpoint')).toHaveLength(0); // b2.autosave=false
    interp.continue();
    // b3 выключен условием gate=false → пропускается, дальше b4
    const third = interp.pump();
    expect(third.pending).toMatchObject({ kind: 'end', ending: { id: 'e_alt' } });
  });

  it('блок с when включается, когда условие истинно', () => {
    const { interp } = make(ep);
    interp.setVar('gate', true);
    interp.pump();
    interp.continue();
    interp.pump(); // ad_break перед b2
    interp.continue();
    expect(interp.pump().pending).toMatchObject({ kind: 'line', key: 'k.3' });
  });

  it('отладочный jumpTo не включает рекламу и проверку блока', () => {
    const { interp } = make(ep);
    interp.jumpTo('s2');
    expect(interp.pump().pending.kind).not.toBe('ad_break');
    interp.jumpTo('s3b');
    expect(interp.pump().pending.kind).toBe('end');
  });
});

describe('архив и концовки', () => {
  it('archive_unlock, document.adds_to_archive и ending.unlocks дают событие один раз', () => {
    const ep = miniEpisode({
      s1: {
        steps: [
          { do: 'archive_unlock', item: 'arc_y', toast: false },
          { do: 'document', doc: 'doc_a', text_key: 'k.doc', adds_to_archive: 'arc_x' },
          { do: 'archive_unlock', item: 'arc_y' },
          { do: 'end', ending: 'e_alt' },
        ],
      },
    });
    const { interp } = make(ep);
    const r1 = interp.pump();
    expect(r1.events.filter((e) => e.t === 'archive')).toEqual([
      { t: 'archive', item: 'arc_y', toast: false },
      { t: 'archive', item: 'arc_x', toast: true },
    ]);
    expect(r1.pending).toEqual({ kind: 'document', doc: 'doc_a', text_key: 'k.doc', zoomable: true, adds_to_archive: 'arc_x' });
    interp.continue();
    const r2 = interp.pump();
    expect(r2.events.filter((e) => e.t === 'archive')).toEqual([]); // arc_y уже открыт, arc_x из ending.unlocks тоже
    expect(interp.state.archive).toEqual(['arc_y', 'arc_x']);
    expect(r2.pending).toMatchObject({ kind: 'end', ending: { id: 'e_alt', kind: 'variant' } });
  });

  it('неизвестная концовка — EngineError', () => {
    const ep = miniEpisode({ s1: { steps: [{ do: 'end', ending: 'e_ghost' }] } });
    expect(() => make(ep).interp.pump()).toThrow(/не объявлена/);
  });
});

describe('снимки', () => {
  const ep = miniEpisode(
    {
      s1: {
        steps: [
          { do: 'show', who: 'a', expression: 'calm', position: 'left' },
          { do: 'say', who: 'a', key: 'k.1' },
          { do: 'set', effects: [{ var: 'n', op: 'add', value: 1 }] },
          {
            do: 'choice',
            id: 'c',
            options: [
              { id: 'x', key: 'k.x', goto: 's2' },
              { id: 'y', key: 'k.y', effects: [{ var: 'n', op: 'add', value: 2 }], goto: 's2' },
            ],
          },
        ],
      },
      s2: { steps: [{ do: 'narrate', key: 'k.end' }, { do: 'end', ending: 'e_main' }] },
    },
    { variables: { n: INT } },
  );

  it('restore() возвращает ровно то же ожидание и дальше идёт так же, как исходная партия', () => {
    const { interp } = make(ep);
    interp.pump();
    interp.continue();
    const atChoice = interp.pump();
    expect(atChoice.pending.kind).toBe('choice');
    const snap = interp.snapshot();
    interp.choose('y');
    const direct = runAutoplay(interp, 'first');

    const copy = new Interpreter(ep);
    copy.restore(JSON.parse(JSON.stringify(snap)));
    expect(copy.view.sprites).toHaveLength(1);
    const again = copy.pump();
    expect(again.pending).toEqual(atChoice.pending);
    copy.choose('y');
    expect(runAutoplay(copy, 'first').ending).toBe(direct.ending);
    expect(copy.state).toEqual(interp.state);
  });

  it('restore() отвергает чужой эпизод, неизвестную сцену и шаг вне сцены', () => {
    const { interp } = make(ep);
    const snap = interp.snapshot();
    expect(() => interp.restore({ ...snap, state: { ...snap.state, episode_id: 'other' } })).toThrow(/другого эпизода/);
    expect(() => interp.restore({ ...snap, state: { ...snap.state, scene_id: 'zz' } })).toThrow(/неизвестная сцена/);
    expect(() => interp.restore({ ...snap, state: { ...snap.state, step_index: 99 } })).toThrow(/вне сцены/);
  });
});

describe('автопилот', () => {
  const ep = miniEpisode(
    {
      s1: {
        steps: [
          { do: 'choice', id: 'c', default_option: 'b', options: [{ id: 'a', key: 'k.a', goto: 's2' }, { id: 'b', key: 'k.b', goto: 's2' }] },
        ],
      },
      s2: { steps: [{ do: 'minigame', minigame: 'm1' }] },
      s_ok: { steps: [{ do: 'end', ending: 'e_main' }] },
      s_bad: { steps: [{ do: 'end', ending: 'e_alt' }] },
    },
    { minigames: { m1: mg('m1', { skip: { allowed: false } }) } },
  );

  it('политики first / last / default / явные ответы', () => {
    const run = (p: Parameters<typeof runAutoplay>[1]) => runAutoplay(new Interpreter(ep), p);
    expect(run('first').choices).toEqual([{ choice: 'c', option: 'a' }]);
    expect(run('last').choices).toEqual([{ choice: 'c', option: 'b' }]);
    expect(run('default').choices).toEqual([{ choice: 'c', option: 'b' }]);
    expect(run({ choices: { c: 'b' } }).choices).toEqual([{ choice: 'c', option: 'b' }]);
    expect(run({ minigames: { m1: 'fail' } })).toMatchObject({ ending: 'e_alt', endingKind: 'variant' });
    expect(run({ minigame: 'success' })).toMatchObject({ ending: 'e_main' });
  });

  it('skipped при запрещённом пропуске подменяется на partial', () => {
    const r = runAutoplay(new Interpreter(ep), { minigame: 'skipped' });
    expect(r.minigames).toEqual([{ id: 'm1', result: 'partial', counted: 'partial' }]);
  });

  it('random детерминирован по seed; maxSteps обрывает прогон', () => {
    const r = runAutoplay(new Interpreter(ep), { choice: 'random', seed: 7 });
    expect(r.choices.every((c) => c.verdict === undefined)).toBe(true); // вердикт — только у дедуктивных развилок
    const a = runAutoplay(new Interpreter(ep), { choice: 'random', minigame: 'random', seed: 7 });
    const b = runAutoplay(new Interpreter(ep), { choice: 'random', minigame: 'random', seed: 7 });
    expect(a).toEqual(b);
    const cut = runAutoplay(new Interpreter(ep), { maxSteps: 1 });
    expect(cut).toMatchObject({ ending: null, truncated: true });
  });
});
