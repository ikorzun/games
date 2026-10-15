/** Монтажёр (core/editor.ts): детерминированный выбор кадров покрытия по грамматике 08 §4. */
import { describe, expect, it } from 'vitest';
import {
  ANGLE_EVERY,
  EMPTY_CTX,
  MAX_CLOSES,
  MAX_HOLD,
  REACTION_EVERY,
  ShotIndex,
  afterHide,
  beatOf,
  choiceShot,
  entryShot,
  explicitShot,
  hashSeed,
  lineShot,
} from '../src/core/editor';
import type { LineInput } from '../src/core/editor';
import type { Shot, ShotCtx } from '../src/core/types';

const S = 'office';
const sh = (id: string, kind: Shot['kind'], cast: string[], extra: Partial<Shot> = {}): Shot => ({
  id,
  set: S,
  bg: 'bg_office',
  kind,
  cast: cast.map((who) => ({ who })),
  file: `assets/x/shots/${S}/${id}.webp`,
  ...extra,
});
const SHOTS: Shot[] = [
  sh('wide_ab', 'wide', ['a', 'b']),
  sh('wide_abc', 'wide', ['a', 'b', 'c']),
  sh('medium_ab', 'medium', ['a', 'b']),
  sh('medium_abc', 'medium', ['a', 'b', 'c']),
  sh('ots_a_b', 'ots', ['a', 'b'], { from: 'a', focus: 'b' }),
  sh('ots_b_a', 'ots', ['a', 'b'], { from: 'b', focus: 'a' }),
  { ...sh('close_a_neutral', 'close', ['a'], { focus: 'a' }), cast: [{ who: 'a', expression: 'neutral' }] },
  { ...sh('close_a_tense', 'close', ['a'], { focus: 'a' }), cast: [{ who: 'a', expression: 'tense' }] },
  { ...sh('close_b_neutral', 'close', ['b'], { focus: 'b' }), cast: [{ who: 'b', expression: 'neutral' }] },
  sh('reaction_a', 'reaction', ['a'], { focus: 'a' }),
  sh('reaction_b', 'reaction', ['b'], { focus: 'b' }),
  sh('insert_1', 'insert', []),
  sh('insert_2', 'insert', []),
  sh('angle_low', 'angle', ['a', 'b'], { angle: 'low' }),
];
const index = new ShotIndex(SHOTS);

const line = (over: Partial<LineInput>): LineInput => ({
  set: S,
  who: 'a',
  expression: null,
  beat: 'calm',
  narrate: null,
  longLine: false,
  cast: ['a', 'b'],
  pov: 'a',
  current: null,
  ctx: { ...EMPTY_CTX },
  seed: 's1:0',
  ...over,
});

/** Сыграть реплики подряд: каждая берёт кадр и память предыдущей. */
function play(lines: Array<Partial<LineInput>>, start: { current: string | null; ctx: ShotCtx } = { current: null, ctx: { ...EMPTY_CTX } }): string[] {
  const out: string[] = [];
  let cur = start.current;
  let ctx = start.ctx;
  lines.forEach((l, i) => {
    const pick = lineShot(index, line({ seed: `s1:${i}`, ...l, current: cur, ctx }));
    out.push(pick.shot ?? '-');
    cur = pick.shot;
    ctx = pick.ctx;
  });
  return out;
}

describe('ShotIndex и вспомогательные', () => {
  it('индекс по id и по сетам; хеш детерминирован', () => {
    expect(index.size).toBe(SHOTS.length);
    expect(index.get('wide_ab')?.kind).toBe('wide');
    expect(index.set(S)).toHaveLength(SHOTS.length);
    expect(index.hasSet('nope')).toBe(false);
    expect(hashSeed('s1:0')).toBe(hashSeed('s1:0'));
    expect(hashSeed('s1:0')).not.toBe(hashSeed('s1:1'));
  });

  it('beatOf: явный beat, иначе напряжённое выражение → tense, иначе calm', () => {
    expect(beatOf('climax', 'neutral')).toBe('climax');
    expect(beatOf(undefined, 'angry')).toBe('tense');
    expect(beatOf(undefined, 'neutral')).toBe('calm');
    expect(beatOf(undefined, null)).toBe('calm');
  });
});

describe('вход в сцену (§4.1)', () => {
  it('wide с максимальным совпадением состава; в кадре нет никого, кого нет на сцене', () => {
    expect(entryShot(index, S, ['a', 'b'])?.id).toBe('wide_ab');
    expect(entryShot(index, S, ['a', 'b', 'c'])?.id).toBe('wide_abc');
    expect(entryShot(index, S, ['b', 'a', 'c', 'd'])?.id).toBe('wide_abc');
    // один a на сцене: все wide показывают ещё и b — кадра нет, остаются спрайты
    expect(entryShot(index, S, ['a'])).toBeNull();
    expect(entryShot(index, 'nope', ['a', 'b'])).toBeNull();
  });

  it('общего и среднего плана по составу нет — вход через плечо, а не фон сета с теми, кого нет', () => {
    const only = new ShotIndex([sh('wide_abc', 'wide', ['a', 'b', 'c']), sh('ots_a_b', 'ots', ['a', 'b'], { from: 'a', focus: 'b' })]);
    expect(entryShot(only, S, ['a', 'b'])?.id).toBe('ots_a_b');
    expect(entryShot(only, S, ['a'])).toBeNull();
  });
});

describe('реплики (§4.2): спокойный разговор', () => {
  it('первая реплика — medium (ots не от кого), ответ — ots от предыдущего говорящего, повтор держится', () => {
    expect(play([{ who: 'a' }, { who: 'b' }, { who: 'b' }, { who: 'b' }])).toEqual(['medium_ab', 'ots_a_b', 'ots_a_b', 'ots_a_b']);
  });

  it('кадр говорящего держится не дольше MAX_HOLD реплик, потом medium (тот же ots дважды подряд нельзя)', () => {
    const lines = Array.from({ length: MAX_HOLD + 1 }, () => ({ who: 'b' }));
    const got = play([{ who: 'a' }, ...lines]);
    expect(got.slice(1, 1 + MAX_HOLD)).toEqual(Array(MAX_HOLD).fill('ots_a_b'));
    expect(got[MAX_HOLD + 1]).toBe('medium_ab');
  });

  it('тот же кадр дважды подряд — только при том же говорящем', () => {
    // a говорит из medium_ab; b отвечает без ots (нет ots b←a? есть) — проверим на составе без ots: только a и c
    const got = play([{ who: 'a', cast: ['a', 'b', 'c'] }, { who: 'c', cast: ['a', 'b', 'c'] }]);
    expect(got[0]).toBe('medium_abc');
    expect(got[1]).not.toBe('medium_abc');
  });
});

describe('реплики (§4.2): напряжение и кульминация', () => {
  it('tense → крупный план говорящего с выражением шага, без точного — neutral', () => {
    expect(play([{ who: 'a', beat: 'tense', expression: 'tense' }])).toEqual(['close_a_tense']);
    expect(play([{ who: 'a', beat: 'tense', expression: 'angry' }])).toEqual(['close_a_neutral']);
    expect(play([{ who: 'b', beat: 'tense', expression: 'scared' }])).toEqual(['close_b_neutral']);
  });

  it('крупный план только того, кто на сцене; иначе medium / wide', () => {
    expect(play([{ who: 'a', beat: 'tense', cast: ['b'] }])).toEqual(['-']);
    expect(play([{ who: 'c', beat: 'tense', cast: ['a', 'b', 'c'] }])).toEqual(['medium_abc']);
  });

  it('не больше MAX_CLOSES крупных планов подряд — дальше medium', () => {
    const lines = Array.from({ length: MAX_CLOSES + 1 }, (_, i) => ({ who: i % 2 ? 'b' : 'a', beat: 'tense' as const }));
    const got = play(lines);
    expect(got.slice(0, MAX_CLOSES).every((id) => id.startsWith('close_'))).toBe(true);
    expect(got[MAX_CLOSES]).toBe('medium_ab');
  });

  it('climax: перебивка angle по жребию зерна, не чаще раза в ANGLE_EVERY реплик; после неё — возврат в покрытие', () => {
    let seed = '';
    for (let i = 0; i < 100; i++) {
      if (hashSeed(`x:${i}`) % 3 === 0) {
        seed = `x:${i}`;
        break;
      }
    }
    const first = lineShot(index, line({ who: 'a', beat: 'climax', seed }));
    expect(first.shot).toBe('angle_low');
    expect(first.ctx.last_angle).toBe(0);
    // после перебивки — возврат в покрытие (medium / ots), даже если реплика напряжённая
    const second = lineShot(index, line({ who: 'a', beat: 'climax', seed, current: first.shot, ctx: first.ctx }));
    expect(second.shot).toBe('medium_ab');
    const after = lineShot(index, line({ who: 'b', beat: 'tense', current: 'angle_low', ctx: { ...EMPTY_CTX, line: 1, last_angle: 0, speaker: 'a', prev_speaker: null } }));
    expect(after.shot).toBe('ots_a_b');
    // ещё одна кульминация с тем же жребием, но перебивка была недавно → крупный план
    const third = lineShot(index, line({ who: 'b', beat: 'climax', seed, current: 'medium_ab', ctx: { ...second.ctx, speaker: 'a', prev_speaker: null } }));
    expect(third.shot).toBe('close_b_neutral');
    // жребий не выпал → обычный крупный план
    let miss = '';
    for (let i = 0; i < 100; i++) {
      if (hashSeed(`y:${i}`) % 3 !== 0) {
        miss = `y:${i}`;
        break;
      }
    }
    expect(lineShot(index, line({ who: 'a', beat: 'climax', seed: miss })).shot).toBe('close_a_neutral');
    expect(ANGLE_EVERY).toBeGreaterThan(1);
  });

  it('кульминация не держит прежний крупный план — режет заново (без жребия — тот же крупный план)', () => {
    let miss = '';
    for (let i = 0; i < 100; i++) {
      if (hashSeed(`z:${i}`) % 3 !== 0) {
        miss = `z:${i}`;
        break;
      }
    }
    const r = lineShot(index, line({ who: 'a', beat: 'climax', seed: miss, current: 'close_a_neutral', ctx: { ...EMPTY_CTX, held: 1, speaker: 'a' } }));
    expect(r.shot).toBe('close_a_neutral');
    expect(r.ctx.held).toBe(2);
  });

  it('tense на ots режет в крупный план; на крупном плане меняется только выражение', () => {
    const onOts = lineShot(index, line({ who: 'b', beat: 'tense', expression: 'scared', current: 'ots_a_b', ctx: { ...EMPTY_CTX, held: 1, speaker: 'b', prev_speaker: 'a' } }));
    expect(onOts.shot).toBe('close_b_neutral');
    const sameExpr = lineShot(index, line({ who: 'a', beat: 'tense', expression: 'angry', current: 'close_a_tense', ctx: { ...EMPTY_CTX, held: 1, speaker: 'a' } }));
    expect(sameExpr.shot).toBe('close_a_tense'); // точного «angry» нет — держим
    const newExpr = lineShot(index, line({ who: 'a', beat: 'tense', expression: 'tense', current: 'close_a_neutral', ctx: { ...EMPTY_CTX, held: 1, speaker: 'a' } }));
    expect(newExpr.shot).toBe('close_a_tense');
  });

  it('prev_speaker — последний собеседник, а не сам говорящий: ots после серии реплик одного человека', () => {
    const got = play([{ who: 'a' }, { who: 'b' }, { who: 'b' }, { who: 'b' }, { who: 'b' }, { who: 'a' }]);
    expect(got[5]).toBe('ots_b_a');
  });
});

describe('реакция слушающего (§4.4)', () => {
  it('длинная реплика после крупного плана говорящего → reaction слушающего, не чаще каждой REACTION_EVERY-й', () => {
    const ctx: ShotCtx = { ...EMPTY_CTX, held: 1, closes: 1, long_lines: REACTION_EVERY - 1, speaker: 'a', prev_speaker: 'b', line: 5 };
    const r = lineShot(index, line({ who: 'a', longLine: true, current: 'close_a_neutral', ctx }));
    expect(r.shot).toBe('reaction_b');
    expect(r.ctx.long_lines).toBe(0);
    // счётчик ещё не набрался — кадр держится, длинная реплика учитывается
    const early = lineShot(index, line({ who: 'a', longLine: true, current: 'close_a_neutral', ctx: { ...ctx, long_lines: 0 } }));
    expect(early.shot).toBe('close_a_neutral');
    expect(early.ctx.long_lines).toBe(1);
  });

  it('слушающий начинает говорить — его reaction не держится как «кадр говорящего»', () => {
    const r = lineShot(index, line({ who: 'b', current: 'reaction_b', ctx: { ...EMPTY_CTX, held: 1, speaker: 'a', prev_speaker: 'b' } }));
    expect(r.shot).toBe('ots_a_b');
  });
});

describe('рассказчик (§4.3)', () => {
  it('voiceover / report: wide и insert по очереди; inner — лицо персонажа игрока', () => {
    const got = play([
      { who: null, narrate: 'voiceover' },
      { who: null, narrate: 'voiceover' },
      { who: null, narrate: 'report' },
      { who: null, narrate: 'voiceover' },
      { who: null, narrate: 'inner' },
    ]);
    expect(got).toEqual(['wide_ab', 'insert_1', 'wide_ab', 'insert_2', 'close_a_neutral']);
  });

  it('inner без персонажа игрока на сцене — как закадровый', () => {
    expect(play([{ who: null, narrate: 'inner', pov: null }])).toEqual(['wide_ab']);
  });
});

describe('выбор игрока, уход со сцены, явный кадр', () => {
  it('choice: medium с персонажем игрока; с таймером — крупный план оппонента', () => {
    expect(choiceShot(index, S, ['a', 'b'], 'a', false, 'b')?.id).toBe('medium_ab');
    expect(choiceShot(index, S, ['a', 'b'], 'a', true, 'b')?.id).toBe('close_b_neutral');
    expect(choiceShot(index, S, ['a', 'b'], 'a', true, null)?.id).toBe('medium_ab');
    expect(choiceShot(index, S, ['a', 'b'], null, false, null)?.id).toBe('wide_ab');
  });

  it('afterHide: кадр с ушедшим заменяется общим планом оставшихся или спрайтами; чужой кадр остаётся', () => {
    expect(afterHide(index, S, ['a', 'b'], 'wide_abc', 'c')).toBe('wide_ab');
    expect(afterHide(index, S, ['a'], 'wide_ab', 'b')).toBeNull();
    expect(afterHide(index, S, ['a'], 'close_a_neutral', 'b')).toBe('close_a_neutral');
    expect(afterHide(index, S, ['a'], null, 'b')).toBeNull();
  });

  it('explicitShot: кадр сценариста, счёт реплик и крупных планов ведётся', () => {
    const r = explicitShot(index, 'close_b_neutral', 'wide_ab', { ...EMPTY_CTX }, 'b');
    expect(r.shot).toBe('close_b_neutral');
    expect(r.ctx).toMatchObject({ held: 1, closes: 1, line: 1, speaker: 'b', prev_speaker: null });
    const same = explicitShot(index, 'close_b_neutral', 'close_b_neutral', r.ctx, 'b');
    expect(same.ctx.held).toBe(2);
    // неизвестный id — текущий кадр остаётся
    expect(explicitShot(index, 'nope', 'wide_ab', { ...EMPTY_CTX }, 'a').shot).toBe('wide_ab');
  });

  it('пустой сет — кадров нет, память всё равно идёт', () => {
    const r = lineShot(new ShotIndex([]), line({ who: 'a' }));
    expect(r.shot).toBeNull();
    expect(r.ctx.line).toBe(1);
  });

  it('детерминизм: одинаковый вход — одинаковый выход', () => {
    const a = play([{ who: 'a' }, { who: 'b', beat: 'climax' }, { who: 'a', longLine: true }]);
    const b = play([{ who: 'a' }, { who: 'b', beat: 'climax' }, { who: 'a', longLine: true }]);
    expect(a).toEqual(b);
  });
});
