import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types';
import { DEFAULT_THINGS, looksAt, Things } from '../src/systems/things';
import type { Fate, Look, Thing, ThingEvent } from '../src/systems/things';

const DT = 1 / 60;
const clear = (): number => 99;
const wall = (): number => 0.5;
const FAR: Vec3 = [100, 0, 100];

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Вещь стоит в начале координат; игрок — в двух метрах на +x и светит ей в середину. */
const EYE: Vec3 = [2, 1.2, 0];
function onThing(t: Thing, light = 1, eye: Vec3 = EYE): Look {
  const centre: Vec3 = [t.pos[0], t.pos[1] + t.radius * 0.6, t.pos[2]];
  return { eye, aim: norm([centre[0] - eye[0], centre[1] - eye[1], centre[2] - eye[2]]), light };
}
const away = (): Look => ({ eye: EYE, aim: [1, 0, 0], light: 1 });

function make(fate: Fate, memory = false, radius = 0.3): { th: Things; t: Thing } {
  const th = new Things();
  const t = th.add('mug', [0, 0, 0], 0, fate, radius, memory);
  return { th, t };
}

function run(th: Things, seconds: number, look: Look, feet: Vec3 = FAR, los = clear): ThingEvent[] {
  const out: ThingEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) out.push(...th.update(DT, look, feet, los));
  return out;
}

const kinds = (ev: ThingEvent[]): string[] => ev.map((e) => e.type);

describe('вещи: взгляд', () => {
  it('взгляд копится за gazeTime и спадает со скоростью 0,8 в секунду', () => {
    const { th, t } = make('shrink');
    run(th, DEFAULT_THINGS.gazeTime / 2, onThing(t));
    expect(t.gaze).toBeCloseTo(0.5, 1);
    expect(th.focus).toBe(t);
    run(th, 0.5, away());
    expect(t.gaze).toBeCloseTo(0.5 - 0.4, 1);
    run(th, 5, away());
    expect(t.gaze).toBe(0);
    expect(th.focus).toBeNull();
    expect(t.state).toBe('idle');
  });

  it('noticed приходит один раз — на первом серьёзном взгляде, а не при каждом возвращении взгляда', () => {
    const { th, t } = make('shrink');
    // Мимолётный взгляд (порог — gaze 0,3, то есть около 0,7 с) — ещё не наблюдение.
    expect(kinds(run(th, 0.5, onThing(t)))).toEqual([]);
    run(th, 3, away());
    const first = run(th, 1, onThing(t));
    expect(kinds(first)).toEqual(['noticed']);
    expect(first[0]).toMatchObject({ thing: t });
    run(th, 3, away());
    expect(kinds(run(th, 1, onThing(t)))).toEqual([]);
  });

  it('вещь начинает меняться, когда взгляд набрался: событие changing один раз', () => {
    const { th, t } = make('dust');
    const ev = run(th, DEFAULT_THINGS.gazeTime + 0.1, onThing(t));
    expect(kinds(ev)).toEqual(['noticed', 'changing']);
    expect(t.state).toBe('changing');
    expect(th.change(t)).toBeNull();
  });

  it('в стороне, в темноте, далеко и за преградой вещь не меняется', () => {
    const { th, t } = make('shrink');
    run(th, 6, onThing(t, 0.2));
    run(th, 6, onThing(t), FAR, wall);
    run(th, 6, onThing(t, 1, [20, 1.2, 0]));
    run(th, 6, away());
    expect(t.gaze).toBe(0);
    expect(t.state).toBe('idle');
  });
});

describe('вещи: судьбы', () => {
  it('shrink: уменьшается до нуля за shrinkTime и исчезает; settled один раз', () => {
    const { th, t } = make('shrink');
    run(th, DEFAULT_THINGS.gazeTime + 0.05, onThing(t));
    expect(t.state).toBe('changing');
    run(th, DEFAULT_THINGS.shrinkTime / 2, away());
    expect(t.scale).toBeGreaterThan(0.2);
    expect(t.scale).toBeLessThan(0.8);
    const ev = run(th, DEFAULT_THINGS.shrinkTime, away());
    expect(kinds(ev)).toEqual(['settled']);
    expect(t.state).toBe('gone');
    expect(t.scale).toBe(0);
    expect(kinds(run(th, 3, away()))).toEqual([]);
  });

  it('dust: рассыпается — растёт dissolve от 0 до 1 за dustTime, размер не меняется', () => {
    const { th, t } = make('dust');
    run(th, DEFAULT_THINGS.gazeTime + 0.05, onThing(t));
    expect(t.dissolve).toBeLessThan(0.1);
    run(th, DEFAULT_THINGS.dustTime / 2, away());
    expect(t.dissolve).toBeGreaterThan(0.4);
    expect(t.dissolve).toBeLessThan(0.6);
    expect(t.scale).toBe(1);
    const ev = run(th, DEFAULT_THINGS.dustTime, away());
    expect(kinds(ev)).toEqual(['settled']);
    expect(t.state).toBe('gone');
    expect(t.dissolve).toBe(1);
  });

  it('grow: вырастает в growScale раз за growTime и остаётся гигантом (giant)', () => {
    const { th, t } = make('grow');
    run(th, DEFAULT_THINGS.gazeTime + 0.05, onThing(t));
    run(th, DEFAULT_THINGS.growTime / 2, away());
    expect(t.scale).toBeGreaterThan(2);
    expect(t.scale).toBeLessThan(DEFAULT_THINGS.growScale - 1);
    const ev = run(th, DEFAULT_THINGS.growTime, away());
    expect(kinds(ev)).toEqual(['settled']);
    expect(t.state).toBe('giant');
    expect(t.scale).toBeCloseTo(DEFAULT_THINGS.growScale, 5);
    // Гигант больше не меняется и не шлёт событий.
    expect(kinds(run(th, 5, onThing(t)))).toEqual([]);
    expect(t.state).toBe('giant');
  });

  it('jump: растёт навстречу игроку; как только дотянулась — engulf, затем settled; издали — по окончании роста', () => {
    const near = make('jump');
    run(near.th, DEFAULT_THINGS.gazeTime + 0.05, onThing(near.t));
    const ev = run(near.th, 5, away(), [2, 0, 0]);
    expect(kinds(ev)).toEqual(['engulf', 'settled']);
    expect(near.t.state).toBe('gone');
    // Дотянулась раньше, чем выросла до конца: игрок в двух метрах, радиус 0,3, запас 0,4.
    expect(near.t.scale).toBeLessThan(DEFAULT_THINGS.growScale);
    expect(near.t.scale * near.t.radius + 0.4).toBeGreaterThan(1.9);

    const farAway = make('jump');
    run(farAway.th, DEFAULT_THINGS.gazeTime + 0.05, onThing(farAway.t));
    run(farAway.th, DEFAULT_THINGS.growTime - 0.3, away(), FAR);
    expect(farAway.t.state).toBe('changing');
    const ev2 = run(farAway.th, 0.5, away(), FAR);
    expect(kinds(ev2)).toEqual(['engulf', 'settled']);
  });

  it('вещь, у которой начали менять судьбу вручную (change), идёт по новой судьбе с нуля', () => {
    const { th, t } = make('shrink');
    const e = th.change(t, 'dust');
    expect(e).toEqual({ type: 'changing', thing: t });
    expect(t.fate).toBe('dust');
    run(th, DEFAULT_THINGS.dustTime + 0.1, away());
    expect(t.state).toBe('gone');
    expect(t.scale).toBe(1);
  });

  it('remove и clear убирают вещи; clear забывает и «замеченные»', () => {
    const { th, t } = make('shrink');
    run(th, 1, onThing(t));
    expect(th.list.length).toBe(1);
    th.clear();
    expect(th.list.length).toBe(0);
    const t2 = th.add('mug', [0, 0, 0], 0, 'shrink');
    th.remove(t2);
    expect(th.list.length).toBe(0);
  });
});

describe('вещи: вещь-воспоминание', () => {
  it('под взглядом сама не меняется (её судьбу решает сессия): gaze растёт, но ни noticed, ни changing', () => {
    const { th, t } = make('dust', true);
    const ev = run(th, 20, onThing(t));
    expect(ev).toEqual([]);
    expect(t.state).toBe('idle');
    expect(t.gaze).toBe(1);
    expect(t.scale).toBe(1);
    expect(t.dissolve).toBe(0);
    run(th, 2, away());
    expect(t.gaze).toBe(0);
  });

  it('судьбу ей можно назначить: change запускает рассыпание, и тогда она идёт как обычная', () => {
    const { th, t } = make('shrink', true);
    th.change(t, 'dust');
    const ev = run(th, DEFAULT_THINGS.dustTime + 0.1, away());
    expect(kinds(ev)).toEqual(['settled']);
    expect(t.state).toBe('gone');
  });
});

describe('вещи: экспонат (still)', () => {
  function exhibit(fate: Fate = 'shrink'): { th: Things; t: Thing } {
    const th = new Things();
    const t = th.add('mug', [0, 0, 0], 0, fate, 0.3, false, true);
    return { th, t };
  }

  it('под взглядом не меняется: ни noticed, ни changing; gaze доходит до 1', () => {
    for (const fate of ['shrink', 'grow', 'dust'] as Fate[]) {
      const { th, t } = exhibit(fate);
      const ev = run(th, 20, onThing(t));
      expect(ev, fate).toEqual([]);
      expect(t.state).toBe('idle');
      expect(t.gaze).toBe(1);
      expect(t.scale).toBe(1);
      expect(t.dissolve).toBe(0);
    }
  });

  it('gaze растёт не мгновенно (около 0,4 с) и спадает, когда отвели взгляд', () => {
    const { th, t } = exhibit();
    run(th, 0.2, onThing(t));
    expect(t.gaze).toBeGreaterThan(0);
    expect(t.gaze).toBeLessThan(1);
    run(th, 1, onThing(t));
    expect(t.gaze).toBe(1);
    run(th, 1, away());
    expect(t.gaze).toBe(0);
  });

  it('обычная вещь той же судьбы под тем же взглядом меняется — разница именно в still', () => {
    const th = new Things();
    const t = th.add('mug', [0, 0, 0], 0, 'dust', 0.3);
    const ev = run(th, 20, onThing(t));
    expect(ev.length).toBeGreaterThan(0);
    expect(t.state).not.toBe('idle');
  });
});

describe('looksAt', () => {
  const target: Vec3 = [0, 1, 0];
  const at = (eye: Vec3, light = 1): Look => ({ eye, aim: norm([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]), light });

  it('дальность: в пределах range — да, дальше — нет; впритык (< 0,25 м) — тоже нет', () => {
    expect(looksAt(at([3, 1, 0]), target, 0.3, 6, clear)).toBe(true);
    expect(looksAt(at([5.9, 1, 0]), target, 0.3, 6, clear)).toBe(true);
    expect(looksAt(at([6.2, 1, 0]), target, 0.3, 6, clear)).toBe(false);
    expect(looksAt(at([0.2, 1, 0]), target, 0.3, 6, clear)).toBe(false);
  });

  it('свет: при яркости ниже 0,3 вещь не видно, при 0,3 — видно', () => {
    expect(looksAt(at([3, 1, 0], 0.29), target, 0.3, 6, clear)).toBe(false);
    expect(looksAt(at([3, 1, 0], 0), target, 0.3, 6, clear)).toBe(false);
    expect(looksAt(at([3, 1, 0], 0.3), target, 0.3, 6, clear)).toBe(true);
  });

  it('угол: небольшой промах прощается, чем крупнее и ближе вещь — тем больше; в сторону и назад — нет', () => {
    const eye: Vec3 = [3, 1, 0];
    const rot = (deg: number): Look => {
      const a = (deg * Math.PI) / 180;
      return { eye, aim: [-Math.cos(a), 0, Math.sin(a)], light: 1 };
    };
    expect(looksAt(rot(0), target, 0.3, 6, clear)).toBe(true);
    expect(looksAt(rot(5), target, 0.3, 6, clear)).toBe(true);
    expect(looksAt(rot(30), target, 0.3, 6, clear)).toBe(false);
    expect(looksAt(rot(90), target, 0.3, 6, clear)).toBe(false);
    expect(looksAt(rot(180), target, 0.3, 6, clear)).toBe(false);
    // Крупную вещь поймать проще: 20° мимо — для мелкой нет, для большой да.
    expect(looksAt(rot(20), target, 0.1, 6, clear)).toBe(false);
    expect(looksAt(rot(20), target, 1.2, 6, clear)).toBe(true);
  });

  it('преграда: стена между глазом и вещью — нет; стена за вещью или у самой вещи — да', () => {
    const eye: Vec3 = [3, 1, 0];
    expect(looksAt(at(eye), target, 0.3, 6, () => 1)).toBe(false);
    // Луч упёрся в стену в 2,9 м при расстоянии 3 м — это сама вещь или её подставка.
    expect(looksAt(at(eye), target, 0.3, 6, () => 2.9)).toBe(true);
    expect(looksAt(at(eye), target, 0.3, 6, () => 50)).toBe(true);
  });
});
