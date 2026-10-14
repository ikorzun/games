/** Интерпретатор + монтажёр: кадры покрытия в событиях и в кадре (view), сейвы и откат. */
import { describe, expect, it } from 'vitest';
import { Interpreter, defaultViewFor } from '../src/core/interpreter';
import type { EngineEvent, Pending, Shot, Snapshot, Step } from '../src/core/types';
import { miniEpisode } from './helpers/mini';

const SET = 'office';
const sh = (id: string, kind: Shot['kind'], cast: string[], extra: Partial<Shot> = {}): Shot => ({
  id,
  set: SET,
  bg: 'bg_a',
  kind,
  cast: cast.map((who) => ({ who })),
  file: `assets/x/shots/${SET}/${id}.webp`,
  ...extra,
});
const SHOTS: Shot[] = [
  sh('wide_ab', 'wide', ['a', 'b']),
  sh('medium_ab', 'medium', ['a', 'b']),
  sh('ots_a_b', 'ots', ['a', 'b'], { from: 'a', focus: 'b' }),
  sh('ots_b_a', 'ots', ['a', 'b'], { from: 'b', focus: 'a' }),
  { ...sh('close_a_neutral', 'close', ['a'], { focus: 'a' }), cast: [{ who: 'a', expression: 'neutral' }] },
  { ...sh('close_b_tense', 'close', ['b'], { focus: 'b' }), cast: [{ who: 'b', expression: 'tense' }] },
  sh('insert_1', 'insert', []),
];

const talk: Step[] = [
  { do: 'show', who: 'a', position: 'left' },
  { do: 'show', who: 'b', position: 'right' },
  { do: 'say', who: 'a', key: 'k.1' },
  { do: 'say', who: 'b', key: 'k.2' },
  { do: 'say', who: 'b', key: 'k.3', expression: 'tense' },
  { do: 'narrate', key: 'k.4' },
  { do: 'hide', who: 'b' },
  { do: 'say', who: 'a', key: 'k.5' },
  { do: 'end', ending: 'e_main' },
];

function make(steps: Step[] = talk, extra: Record<string, { steps: Step[]; coverage?: string; stage?: { bg: string } }> = {}, lineLength?: (key: string) => number) {
  const episode = miniEpisode({ s1: { coverage: SET, steps }, ...extra }, { shots: SHOTS, pov: 'a' });
  const warnings: string[] = [];
  const interp = new Interpreter(episode, { warn: (m) => warnings.push(m), ...(lineLength ? { lineLength } : {}) });
  interp.start();
  return { interp, warnings, episode };
}

/** Прогнать до конца: события каждой партии и кадр (shot) на каждой реплике. */
function run(interp: Interpreter): { events: EngineEvent[]; lineShots: Array<string | null>; pendings: Pending[] } {
  const events: EngineEvent[] = [];
  const lineShots: Array<string | null> = [];
  const pendings: Pending[] = [];
  for (let i = 0; i < 200; i++) {
    const r = interp.pump();
    events.push(...r.events);
    pendings.push(r.pending);
    if (r.pending.kind === 'line') lineShots.push(interp.view.shot);
    if (r.pending.kind === 'end') return { events, lineShots, pendings };
    if (r.pending.kind === 'choice') interp.choose(r.pending.options[0]!.id);
    else interp.continue();
  }
  throw new Error('не дошли до конца');
}
const shotEvents = (events: EngineEvent[]): Array<string | null> => events.filter((e) => e.t === 'shot').map((e) => (e as { shot: string | null }).shot);

describe('сцена с coverage', () => {
  it('у первой реплики явный кадр (сцена «на кадре через плечо») — вход сразу на нём: общий план не мелькает', () => {
    const steps: Step[] = [
      { do: 'show', who: 'a', position: 'left' },
      { do: 'show', who: 'b', position: 'right' },
      { do: 'say', who: 'b', key: 'k.1', shot: 'ots_a_b' },
      { do: 'say', who: 'a', key: 'k.2', shot: 'ots_a_b' },
      { do: 'end', ending: 'e_main' },
    ];
    const { interp } = make(steps);
    const { events } = run(interp);
    const scene = events.find((e) => e.t === 'scene');
    expect(scene && scene.t === 'scene' ? scene.view.shot : null).toBe('ots_a_b');
    expect(shotEvents(events)).toEqual([]); // ни одной склейки: на общем плане сцена не стояла
  });

  it('вход: show с ложным when в состав не входит; общий план с ним не годится — кадр через плечо', () => {
    const shots = [sh('wide_abc', 'wide', ['a', 'b', 'c']), sh('ots_a_b', 'ots', ['a', 'b'], { from: 'a', focus: 'b' })];
    const steps: Step[] = [
      { do: 'show', who: 'a', position: 'left' },
      { do: 'show', who: 'b', position: 'right' },
      { do: 'show', who: 'c', position: 'center', when: 'false' }, // его в этой ветке нет
      { do: 'say', who: 'a', key: 'k.1' },
      { do: 'end', ending: 'e_main' },
    ];
    const interp = new Interpreter(miniEpisode({ s1: { coverage: SET, steps } }, { shots, pov: 'a' }), { warn: () => undefined });
    interp.start();
    const scene = run(interp).events.find((e) => e.t === 'scene');
    expect(scene && scene.t === 'scene' ? scene.view.shot : null).toBe('ots_a_b');
  });

  it('вход — wide с составом сцены в самом событии scene; реплики режутся по грамматике; события shot идут перед speaker', () => {
    const { interp } = make();
    const { events, lineShots } = run(interp);
    const scene = events.find((e) => e.t === 'scene');
    expect(scene && scene.t === 'scene' ? scene.view.shot : null).toBe('wide_ab');
    expect(scene && scene.t === 'scene' ? scene.view.coverage : null).toBe(SET);
    // a: общий план входа держится на первой реплике; b: ots от a; b tense: крупный план; рассказчик: wide; после ухода b — a один: wide не годится → спрайты; реплика a → крупный план a
    expect(lineShots).toEqual(['wide_ab', 'ots_a_b', 'close_b_tense', 'wide_ab', 'close_a_neutral']);
    const order = events.map((e) => e.t);
    const iShot = order.indexOf('shot');
    expect(iShot).toBeGreaterThan(-1);
    expect(order[iShot + 1]).toBe('speaker');
    // hide b: кадр с b сменился до события hide
    const iHide = order.indexOf('hide');
    expect(order[iHide - 1]).toBe('shot');
    expect(shotEvents(events)).toEqual(['ots_a_b', 'close_b_tense', 'wide_ab', null, 'close_a_neutral']);
  });

  it('общий план входа — по составу до первой реплики: пришедший позже не попадает в кадр, кадр держится на первой реплике', () => {
    const steps: Step[] = [
      { do: 'show', who: 'a', position: 'left' },
      { do: 'say', who: 'a', key: 'k.1' },
      { do: 'show', who: 'b', position: 'right' }, // открыли дверь
      { do: 'say', who: 'b', key: 'k.2' },
      { do: 'end', ending: 'e_main' },
    ];
    const shots: Shot[] = [...SHOTS, sh('wide_a', 'wide', ['a'])];
    const episode = miniEpisode({ s1: { coverage: SET, steps } }, { shots, pov: 'a' });
    const interp = new Interpreter(episode);
    interp.start();
    const { events, lineShots } = run(interp);
    const scene = events.find((e) => e.t === 'scene');
    expect(scene && scene.t === 'scene' ? scene.view.shot : null).toBe('wide_a'); // не wide_ab: b ещё нет
    expect(lineShots[0]).toBe('wide_a'); // без мелькания: на первой реплике тот же кадр
    expect(shotEvents(events)[0]).not.toBe('wide_a');
  });

  it('кадр хранится в view и переживает снимок/восстановление; старый снимок без полей нормализуется', () => {
    const { interp } = make();
    interp.pump();
    interp.continue(); // k.1 показан, a в medium
    interp.pump();
    expect(interp.view.shot).toBe('ots_a_b');
    expect(interp.view.shot_ctx).toMatchObject({ speaker: 'b', prev_speaker: 'a' });
    const snap: Snapshot = interp.snapshot();
    const { interp: other } = make();
    other.restore(snap);
    expect(other.view.shot).toBe('ots_a_b');
    expect(other.view.shot_ctx).toEqual(snap.view.shot_ctx);
    // снимок эпохи без покрытия
    const legacy = JSON.parse(JSON.stringify(snap)) as Snapshot;
    delete (legacy.view as Partial<typeof legacy.view>).shot;
    delete (legacy.view as Partial<typeof legacy.view>).shot_ctx;
    delete (legacy.view as Partial<typeof legacy.view>).coverage;
    other.restore(legacy);
    expect(other.view).toMatchObject({ shot: null, shot_ctx: null, coverage: null });
  });

  it('явный shot сценариста исполняется; неизвестный — предупреждение и текущий кадр', () => {
    const steps: Step[] = [
      { do: 'show', who: 'a', position: 'left' },
      { do: 'show', who: 'b', position: 'right', shot: 'close_b_tense' },
      { do: 'say', who: 'a', key: 'k.1', shot: 'insert_1' },
      { do: 'say', who: 'a', key: 'k.2', shot: 'nope' },
      { do: 'end', ending: 'e_main' },
    ];
    const { interp, warnings } = make(steps);
    const { events, lineShots } = run(interp);
    expect(shotEvents(events)).toEqual(['close_b_tense', 'insert_1']);
    expect(lineShots).toEqual(['insert_1', 'insert_1']);
    expect(warnings.some((w) => w.includes('nope'))).toBe(true);
  });

  it('смена фона внутри сцены на другую локацию снимает покрытие до следующей сцены', () => {
    const steps: Step[] = [
      { do: 'show', who: 'a', position: 'left' },
      { do: 'show', who: 'b', position: 'right' },
      { do: 'say', who: 'a', key: 'k.1' },
      { do: 'bg', bg: 'bg_other' },
      { do: 'say', who: 'b', key: 'k.2' },
      { do: 'bg', bg: 'bg_a' },
      { do: 'say', who: 'a', key: 'k.3' },
      { do: 'end', ending: 'e_main' },
    ];
    const { interp } = make(steps);
    const { events, lineShots } = run(interp);
    expect(lineShots).toEqual(['wide_ab', null, null]);
    const kinds = events.map((e) => (e.t === 'shot' ? `shot:${e.shot ?? '-'}` : e.t));
    expect(kinds.indexOf('shot:-')).toBeLessThan(kinds.indexOf('bg'));
    expect(interp.view.coverage).toBeNull();
  });

  it('выбор игрока: medium с персонажем игрока; с таймером — крупный план оппонента', () => {
    const steps: Step[] = [
      { do: 'show', who: 'a', position: 'left' },
      { do: 'show', who: 'b', position: 'right' },
      { do: 'say', who: 'b', key: 'k.1', expression: 'tense' },
      { do: 'choice', id: 'c1', options: [{ id: 'o1', key: 'k.o1', goto: 's2' }] },
      { do: 'end', ending: 'e_main' },
    ];
    const s2: Step[] = [
      { do: 'show', who: 'a', position: 'left' },
      { do: 'show', who: 'b', position: 'right' },
      { do: 'say', who: 'b', key: 'k.2' },
      { do: 'choice', id: 'c2', timer_ms: 5000, options: [{ id: 'o2', key: 'k.o2', goto: 's3' }] },
      { do: 'end', ending: 'e_main' },
    ];
    const { interp } = make(steps, { s2: { coverage: SET, steps: s2 }, s3: { steps: [{ do: 'end', ending: 'e_main' }] } });
    const { pendings, events } = run(interp);
    const choices = pendings.filter((p) => p.kind === 'choice');
    expect(choices).toHaveLength(2);
    const shots = shotEvents(events);
    expect(shots).toContain('medium_ab'); // перед c1 (после крупного плана b)
    expect(shots[shots.length - 1]).toBe('close_b_tense'); // c2 с таймером: оппонент b
  });

  it('длинная реплика говорящего после его крупного плана → реакция слушающего (lineLength из опций)', () => {
    const steps: Step[] = [
      { do: 'show', who: 'a', position: 'left' },
      { do: 'show', who: 'b', position: 'right' },
      { do: 'say', who: 'a', key: 'k.long' },
      { do: 'say', who: 'a', key: 'k.long' },
      { do: 'say', who: 'a', key: 'k.long' },
      { do: 'say', who: 'b', key: 'k.short', expression: 'tense' },
      { do: 'say', who: 'b', key: 'k.long' },
      { do: 'end', ending: 'e_main' },
    ];
    const shots: Shot[] = [...SHOTS, sh('reaction_a', 'reaction', ['a'], { focus: 'a' })];
    const episode = miniEpisode({ s1: { coverage: SET, steps } }, { shots, pov: 'a' });
    const interp = new Interpreter(episode, { lineLength: (key) => (key === 'k.long' ? 200 : 10) });
    interp.start();
    const { lineShots } = run(interp);
    expect(lineShots).toEqual(['wide_ab', 'medium_ab', 'medium_ab', 'close_b_tense', 'reaction_a']); // первая — общий план входа
  });

  it('сцена без coverage — кадров нет и событий shot нет; defaultViewFor без coverage', () => {
    const episode = miniEpisode({ s1: { steps: talk } }, { shots: SHOTS, pov: 'a' });
    const interp = new Interpreter(episode);
    interp.start();
    const { events, lineShots } = run(interp);
    expect(shotEvents(events)).toEqual([]);
    expect(lineShots.every((s) => s === null)).toBe(true);
    expect(defaultViewFor(episode, 's1')).toMatchObject({ coverage: null, shot: null, shot_ctx: null });
  });

  it('coverage_alt: тот же путь в другой день — первый вариант с истинным условием даёт свой сет и фон', () => {
    const d2 = SHOTS.map((s) => ({ ...s, id: `${s.id}_d2`, set: 'office_d2', bg: 'bg_b' }));
    const alt = [{ when: 'day == 2', coverage: 'office_d2', bg: 'bg_b' }];
    const mk = (day: number) => {
      const ep = miniEpisode({ s1: { coverage: SET, coverage_alt: alt, steps: talk } }, {
        shots: [...SHOTS, ...d2],
        pov: 'a',
        variables: { day: { type: 'int', default: day } },
      });
      const interp = new Interpreter(ep);
      interp.start();
      return interp;
    };
    const day1 = mk(1);
    day1.pump();
    expect(day1.view).toMatchObject({ coverage: SET, bg: 'bg_a', shot: 'wide_ab' });
    const day2 = mk(2);
    const first = day2.pump();
    expect(day2.view).toMatchObject({ coverage: 'office_d2', bg: 'bg_b', shot: 'wide_ab_d2' });
    const sceneEv = first.events.find((e) => e.t === 'scene');
    expect(sceneEv?.t === 'scene' ? sceneEv.view.bg : null).toBe('bg_b');
    const { lineShots } = run(day2);
    expect(lineShots.every((s) => s === null || s.endsWith('_d2'))).toBe(true);
  });

  it('coverage_alt: явный кадр основного сета — кадр того же вида из сета дня (вход в сцену и реплика)', () => {
    const d2 = SHOTS.map((s) => ({ ...s, id: `${s.id}_d2`, set: 'office_d2', bg: 'bg_b' }));
    const alt = [{ when: 'day == 2', coverage: 'office_d2', bg: 'bg_b' }];
    const steps: Step[] = [
      { do: 'show', who: 'a', position: 'left' },
      { do: 'narrate', key: 'k.1', shot: 'insert_1' }, // дорога открывается видом из окна
      { do: 'say', who: 'b', key: 'k.2', shot: 'ots_a_b' },
      { do: 'end', ending: 'e_main' },
    ];
    const mk = (day: number, withAlt = true) => {
      const warnings: string[] = [];
      const ep = miniEpisode({ s1: { coverage: SET, ...(withAlt ? { coverage_alt: alt } : {}), steps } }, {
        shots: [...SHOTS, ...d2],
        pov: 'a',
        variables: { day: { type: 'int', default: day } },
      });
      const interp = new Interpreter(ep, { warn: (m) => warnings.push(m) });
      interp.start();
      interp.pump();
      const entry = interp.view.shot; // кадр входа — кадр первой реплики
      const { lineShots } = run(interp);
      return { entry, lineShots, warnings };
    };
    expect(mk(1)).toMatchObject({ entry: 'insert_1', lineShots: ['insert_1', 'ots_a_b'] });
    expect(mk(2)).toEqual({ entry: 'insert_1_d2', lineShots: ['insert_1_d2', 'ots_a_b_d2'], warnings: [] });
    expect(mk(2, false)).toMatchObject({ entry: 'insert_1', lineShots: ['insert_1', 'ots_a_b'] }); // без coverage_alt — как написано
    // Пары нет — кадр основного сета и предупреждение.
    const loneWarnings: string[] = [];
    const lone = new Interpreter(
      miniEpisode({ s1: { coverage: SET, coverage_alt: alt, steps } }, {
        shots: [...SHOTS, ...d2.filter((s) => s.kind !== 'insert')],
        pov: 'a',
        variables: { day: { type: 'int', default: 2 } },
      }),
      { warn: (m) => loneWarnings.push(m) },
    );
    lone.start();
    lone.pump();
    expect(lone.view.shot).toBe('insert_1');
    expect(loneWarnings.join('\n')).toContain('нет пары того же вида в сете office_d2');
  });

  it('fx с кадром: кадр выстрела встаёт до вспышки, без реплики', () => {
    const steps: Step[] = [
      { do: 'show', who: 'a', position: 'left' },
      { do: 'show', who: 'b', position: 'right' },
      { do: 'say', who: 'a', key: 'k.1' },
      { do: 'fx', fx: 'flash', shot: 'insert_1' },
      { do: 'end', ending: 'e_main' },
    ];
    const { interp } = make(steps);
    interp.pump(); // реплика k.1
    interp.continue();
    const r = interp.pump();
    expect(r.pending).toMatchObject({ kind: 'hold', reason: 'fx' });
    expect(interp.view.shot).toBe('insert_1');
    expect(shotEvents(r.events)).toEqual(['insert_1']);
  });

  it('coverage указывает на сет без кадров — как без покрытия', () => {
    const episode = miniEpisode({ s1: { coverage: 'nope', steps: talk } }, { shots: SHOTS, pov: 'a' });
    const interp = new Interpreter(episode);
    interp.start();
    const { events } = run(interp);
    expect(shotEvents(events)).toEqual([]);
    expect(interp.view.coverage).toBeNull();
  });
});
