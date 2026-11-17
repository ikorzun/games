import { describe, expect, it } from 'vitest';
import { CEIL_MAX, decayAt, erased, FLOOR_MAX, keepsClutter, lapsLeft, startForm, strength, WALLS_LATE, WALLS_MAX, WEAR } from '../src/systems/decay';
import { FORM_GONE, FORM_LACE, FORM_REAL } from '../src/systems/illusions';

const STEPS = Array.from({ length: 101 }, (_, i) => i / 100);

describe('стирание: кривая деградации', () => {
  it('нетронутое место цело; стёртое — без вещей и красок, но архитектура держится (вариант A)', () => {
    const fresh = decayAt(0);
    expect(fresh).toMatchObject({ integrity: 1, lace: 0, gone: 0, flats: 1, clutter: 1, ceiling: 0, walls: 0, floor: 0, paint: 0, voices: 1, birches: 0, mound: 0 });
    const end = decayAt(1);
    expect(end.integrity).toBe(0);
    // Слова партнёра 16.11: «A…» — потолок уходит дырами, не больше половины; стены — пятнами кружева,
    // не больше трети; пол держится. Раньше в стёртом месте не оставалось ни потолка, ни стен, ни пола.
    expect(end.ceiling).toBe(CEIL_MAX);
    // Стены — до трети, кроме двух последних кругов: там они уходят большей частью (квиз 17.11).
    expect(end.walls).toBeCloseTo(WALLS_MAX + WALLS_LATE);
    expect(end.floor).toBe(FLOOR_MAX);
    expect(CEIL_MAX).toBeLessThanOrEqual(0.6);
    expect(WALLS_MAX).toBeLessThanOrEqual(1 / 3);
    expect(FLOOR_MAX).toBeLessThanOrEqual(0.15);
    expect(end.paint).toBe(1);
    expect(end.voices).toBe(0);
    expect(end.clutter).toBe(0);
    expect(end.birches).toBe(1);
    expect(end.mound).toBe(3);
    // От вещей остаются считаные нити кружева.
    expect(end.gone).toBeGreaterThan(0.9);
    expect(end.lace).toBeGreaterThanOrEqual(end.gone);
    // За пределами 0..1 кривые не уезжают.
    expect(decayAt(-3)).toEqual(decayAt(0));
    expect(decayAt(7)).toEqual(decayAt(1));
  });

  it('всё стирается только в одну сторону: ни один слой не возвращается', () => {
    for (let i = 1; i < STEPS.length; i++) {
      const a = decayAt(STEPS[i - 1]!);
      const b = decayAt(STEPS[i]!);
      for (const k of ['lace', 'gone', 'flats', 'ceiling', 'walls', 'floor', 'paint', 'birches', 'mound'] as const) expect(b[k], `${k} при ${STEPS[i]}`).toBeGreaterThanOrEqual(a[k]);
      for (const k of ['integrity', 'clutter', 'voices'] as const) expect(b[k], `${k} при ${STEPS[i]}`).toBeLessThanOrEqual(a[k]);
      expect(b.lace).toBeGreaterThanOrEqual(b.gone);
    }
  });

  it('слои уходят по очереди: мелочи, краски и вещи — потолок — стены — пол (доли от того, что слой может потерять)', () => {
    type Layer = 'clutter' | 'paint' | 'ceiling' | 'walls' | 'floor' | 'lace';
    const rel = (k: Layer, w: number): number => {
      const d = decayAt(w);
      if (k === 'clutter') return 1 - d.clutter;
      if (k === 'ceiling') return d.ceiling / CEIL_MAX;
      if (k === 'walls') return d.walls / (WALLS_MAX + WALLS_LATE);
      if (k === 'floor') return d.floor / FLOOR_MAX;
      return d[k];
    };
    const half = (k: Layer): number => STEPS.find((w) => rel(k, w) >= 0.5)!;
    expect(half('clutter')).toBeLessThan(half('ceiling'));
    expect(half('paint')).toBeLessThan(half('ceiling'));
    expect(half('lace')).toBeLessThan(half('walls'));
    expect(half('ceiling')).toBeLessThan(half('walls'));
    expect(half('walls')).toBeLessThan(half('floor'));
    // Пока потолок не начал выпадать, стены целы; пока стены не поредели, пол цел.
    expect(decayAt(0.44).walls).toBe(0);
    expect(rel('ceiling', 0.44)).toBeGreaterThan(0.25);
    expect(decayAt(0.84).floor).toBe(0);
    expect(rel('walls', 0.84)).toBeGreaterThan(0.6);
  });

  it('стены: на кругах 1–6 — не больше трети пятнами; на 7–8 уходят большей частью (ответ партнёра в квизе 17.11)', () => {
    const lap = (n: number): number => decayAt((n - 1) * WEAR.lap).walls;
    for (let n = 1; n <= 6; n++) expect(lap(n), `круг ${n}`).toBeLessThanOrEqual(WALLS_MAX * 0.5);
    // Круги 1–6 — как было (вариант A): поздняя кривая до них не дотягивается.
    expect(decayAt(0.7).walls).toBeCloseTo(decayAt(0.7).walls - WALLS_LATE * 0, 6);
    expect(lap(6)).toBeCloseTo(0.125, 2);
    expect(lap(7)).toBeGreaterThan(0.5);
    expect(lap(8)).toBeGreaterThan(0.8);
    expect(WALLS_MAX + WALLS_LATE).toBeLessThan(0.9);
  });

  it('кривая S-образная: первые круги место почти цело, середина рушится быстрее всего', () => {
    const at = (laps: number): number => decayAt(laps * WEAR.lap).integrity;
    // После первого круга — больше девяти десятых.
    expect(at(1)).toBeGreaterThan(0.9);
    // Самый большой провал — в середине, а не в начале и не в конце.
    const drops = [1, 2, 3, 4, 5, 6, 7].map((n) => at(n - 1) - at(n));
    const worst = drops.indexOf(Math.max(...drops));
    expect(worst).toBeGreaterThanOrEqual(2);
    expect(worst).toBeLessThanOrEqual(4);
    expect(drops[0]!).toBeLessThan(drops[worst]! / 2);
    expect(drops[6]!).toBeLessThan(drops[worst]! / 2);
  });

  it('петля: без касаний место выдерживает восемь кругов; касания и Осыпь укорачивают', () => {
    expect(lapsLeft(0)).toBe(8);
    let w = 0;
    let laps = 0;
    while (!erased(w)) {
      w += WEAR.lap;
      laps += 1;
    }
    expect(laps).toBe(8);
    // Игрок, который трогает по сорок вещей за круг и дважды попадается.
    w = 0;
    laps = 0;
    while (!erased(w)) {
      w += WEAR.lap + 40 * WEAR.touch + 2 * WEAR.caught;
      laps += 1;
    }
    expect(laps).toBeLessThanOrEqual(4);
    expect(laps).toBeGreaterThanOrEqual(3);
    expect(erased(0.999)).toBe(false);
    expect(erased(1)).toBe(true);
    expect(lapsLeft(1)).toBe(0);
    expect(lapsLeft(0.95)).toBe(1);
  });

  it('у предмета своя прочность: стирается одно и то же в одном и том же порядке', () => {
    const ids = Array.from({ length: 600 }, (_, i) => i + 1);
    // Прочность не зависит от стёртости и равномерна.
    const mean = ids.reduce((s, id) => s + strength(id, 2004), 0) / ids.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.05);
    expect(strength(17, 2004)).toBe(strength(17, 2004));
    expect(strength(17, 2004)).not.toBe(strength(17, 2005));
    // Ступень с ростом стёртости только падает: настоящая → кружево → нет.
    for (const id of ids.slice(0, 80)) {
      let prev = FORM_REAL as number;
      for (const w of STEPS) {
        const f = startForm(id, 2004, w);
        expect([FORM_REAL, FORM_LACE, FORM_GONE]).toContain(f);
        expect(f).toBeGreaterThanOrEqual(prev);
        prev = f;
      }
    }
    // Доли на 600 предметах сходятся с кривыми.
    for (const w of [0.3, 0.5, 0.7, 0.9]) {
      const d = decayAt(w);
      const gone = ids.filter((id) => startForm(id, 2004, w) === FORM_GONE).length / ids.length;
      const lace = ids.filter((id) => startForm(id, 2004, w) !== FORM_REAL).length / ids.length;
      expect(Math.abs(gone - d.gone)).toBeLessThan(0.06);
      expect(Math.abs(lace - d.lace)).toBeLessThan(0.06);
    }
    // В нетронутом месте всё настоящее.
    expect(ids.every((id) => startForm(id, 2004, 0) === FORM_REAL)).toBe(true);
  });

  it('мелочи редеют по своей кривой, и пропавшая на этом круге не возвращается на следующем', () => {
    const idx = Array.from({ length: 400 }, (_, i) => i);
    for (const w of [0.2, 0.4, 0.6]) {
      const share = idx.filter((i) => keepsClutter(i, 7, w)).length / idx.length;
      expect(Math.abs(share - decayAt(w).clutter)).toBeLessThan(0.07);
    }
    for (const i of idx.slice(0, 100)) {
      let alive = true;
      for (const w of STEPS) {
        const k = keepsClutter(i, 7, w);
        if (!alive) expect(k).toBe(false);
        alive = k;
      }
    }
  });
});
