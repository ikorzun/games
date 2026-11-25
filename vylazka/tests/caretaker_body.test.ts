/**
 * Тело Смотрителя (квиз 24.11: «без тела до акта IV; тело — один раз, ближе к финалу, фигурой партнёра»; канон A4_E03).
 * Состояние: встаёт только в лимбо и один раз; договорили или подошли — рассеивается и не возвращается. Фигура: по
 * умолчанию дымный манекен у стола, рука на бирке; фигура партнёра, названная «Смотритель», встаёт вместо него и в местах
 * не стоит. Жест — по кругу, без скачка на стыке.
 */
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types';
import { CARETAKER, CaretakerBody } from '../src/systems/caretaker_body';
import { CARETAKER_BODY, caretakerFigure, caretakerMesh, caretakerSpot, fingertip, gesture, gesturePose, GESTURE_FRAMES, GESTURE_S, restPose, TABLE, TAG_AT } from '../src/world/caretaker_body';
import type { FigureSpec } from '../src/world/figures';
import { figureProblems, isCaretakerFigure } from '../src/world/figures';
import { FIGURES, PLACED_FIGURES } from '../src/world/figures_data';
import { skeleton, skeletonPoints } from '../src/world/props_people';

const FAR: Vec3 = [0, 1.6, 30];

describe('тело Смотрителя: когда оно есть', () => {
  it('встаёт только в лимбо и только один раз', () => {
    const b = new CaretakerBody();
    expect(b.come(false, [0, 0, 0], 0, [0, 1, 0])).toBe(false);
    expect(b.state).toBe('none');
    expect(b.come(true, [0, 0, 0], 0, [0, 1, 0])).toBe(true);
    expect(b.state).toBe('coming');
    expect(b.come(true, [5, 0, 5], 0, [0, 1, 0])).toBe(false);
    expect(b.at).toEqual([0, 0, 0]);
  });

  it('дым собирается, потом рука работает по кругу; пока собирается — рука стоит', () => {
    const b = new CaretakerBody();
    b.come(true, [0, 0, 0], 0, [0, 1.08, 0]);
    expect(b.dissolve).toBe(1);
    b.update(CARETAKER.come / 2, FAR);
    expect(b.dissolve).toBeCloseTo(0.5);
    expect(b.u).toBe(0);
    b.update(CARETAKER.come / 2 + 0.01, FAR);
    expect(b.state).toBe('here');
    expect(b.dissolve).toBe(0);
    b.update(GESTURE_S / 4, FAR);
    expect(b.u).toBeCloseTo(0.25);
    b.update(GESTURE_S, FAR);
    expect(b.u).toBeCloseTo(0.25);
  });

  it('договорили — рассеивается: фигура, потом стол с биркой; ушедшее не возвращается', () => {
    const b = new CaretakerBody();
    b.come(true, [0, 0, 0], 0, [0, 1.08, 0]);
    b.update(2, FAR);
    b.go();
    expect(b.state).toBe('going');
    expect(b.why).toBe('end');
    const u = b.u;
    let gone = false;
    for (let i = 0; i < 60 && !gone; i++) {
      gone = b.update(0.05, FAR);
      expect(b.u).toBe(u);
      expect(b.rest).toBeLessThanOrEqual(b.dissolve + 1e-9);
    }
    expect(gone).toBe(true);
    expect(b.state).toBe('gone');
    expect(b.shown).toBe(false);
    // Отошёл, постоял, стемнело и зажглось — тело не собирается снова, как дымные фигуры мест: оно было один раз.
    for (let i = 0; i < 100; i++) b.update(0.2, FAR);
    expect(b.state).toBe('gone');
    expect(b.come(true, [0, 0, 0], 0, [0, 1, 0])).toBe(false);
  });

  it('подошёл ближе чем на 1,2 м — рассеивается, как дымные фигуры; дальше — стоит', () => {
    const b = new CaretakerBody();
    b.come(true, [0, 0, 0], 0, [0, 1.08, 0]);
    b.update(2, FAR);
    // Глаза в 1,6 м от середины тела по горизонтали — стоит.
    b.update(0.1, [0, 1.53, 1.6]);
    expect(b.state).toBe('here');
    b.update(0.1, [0, 1.53, 1.1]);
    expect(b.state).toBe('going');
    expect(b.why).toBe('near');
    for (let i = 0; i < 80; i++) b.update(0.05, [0, 1.53, 1.1]);
    expect(b.state).toBe('gone');
  });

  it('подошёл, пока дым ещё собирается, — уходит с того, что успело собраться', () => {
    const b = new CaretakerBody();
    b.come(true, [0, 0, 0], 0, [0, 1.08, 0]);
    b.update(CARETAKER.come * 0.4, FAR);
    const d = b.dissolve;
    b.update(0.05, [0, 1.53, 0.5]);
    expect(b.state).toBe('going');
    expect(b.dissolve).toBeGreaterThanOrEqual(d);
  });

  it('лимбо кончилось, пока тело стояло, — его сразу нет; команда «уйти» без тела ничего не делает', () => {
    const b = new CaretakerBody();
    b.go();
    expect(b.state).toBe('none');
    b.come(true, [0, 0, 0], 0, [0, 1, 0]);
    b.drop();
    expect(b.state).toBe('gone');
    expect(b.shown).toBe(false);
  });
});

describe('тело Смотрителя: фигура, стол, жест', () => {
  it('по умолчанию — дымный манекен основной модели; запись можно переставить на фигуру партнёра', () => {
    expect(CARETAKER_BODY.kind).toBe('default');
    expect(caretakerFigure(CARETAKER_BODY, FIGURES).source).toBe(FIGURES.some(isCaretakerFigure) ? FIGURES.find(isCaretakerFigure)!.id : 'default');
    expect(caretakerFigure(CARETAKER_BODY, []).material).toBe('smoke');
    const own = FIGURES[0]!;
    const byKey = caretakerFigure({ ...CARETAKER_BODY, kind: own.id }, FIGURES);
    expect(byKey.source).toBe(own.id);
    expect(byKey.pose).toEqual(own.pose);
    expect(byKey.material).toBe(own.material);
    // Ключа нет — остаётся манекен по умолчанию.
    expect(caretakerFigure({ ...CARETAKER_BODY, kind: 'nope' }, FIGURES).source).toBe('default');
  });

  it('фигура партнёра, названная «Смотритель», встаёт сама — и в местах её нет', () => {
    const own: FigureSpec = { ...FIGURES[0]!, id: 'fig_watcher', name: ' Смотритель ', material: 'hair' };
    expect(figureProblems(own)).toEqual([]);
    expect(isCaretakerFigure(own)).toBe(true);
    expect(isCaretakerFigure({ id: 'caretaker', name: 'кто-то' })).toBe(true);
    expect(isCaretakerFigure(FIGURES[0]!)).toBe(false);
    const fig = caretakerFigure(CARETAKER_BODY, [...FIGURES, own]);
    expect(fig.source).toBe('fig_watcher');
    expect(fig.material).toBe('hair');
    // Его поза — как он её выгнул: стол и жест под неё не подгоняются.
    expect(restPose(fig)).toEqual(own.pose);
    // В местах стоят все фигуры партнёра, кроме назначенной Смотрителем.
    expect(PLACED_FIGURES.length).toBe(FIGURES.filter((f) => !isCaretakerFigure(f)).length);
    expect(PLACED_FIGURES.some(isCaretakerFigure)).toBe(false);
    const m = caretakerMesh(CARETAKER_BODY, [own], 3, 4);
    expect(m.arm.length).toBe(4);
    expect(m.dots).toBe(0);
  });

  it('манекен по умолчанию: кончики пальцев правой руки — на бирке, левой — на краю стола; в стол ничто не врастает', () => {
    const rest = restPose(caretakerFigure(CARETAKER_BODY, []));
    const tip = fingertip(rest, 'R');
    expect(Math.hypot(tip[0] - TAG_AT[0], tip[2] - TAG_AT[2])).toBeLessThan(0.02);
    expect(tip[1] - TABLE.h).toBeGreaterThan(0);
    expect(tip[1] - TABLE.h).toBeLessThan(0.03);
    const left = fingertip(rest, 'L');
    expect(left[1] - TABLE.h).toBeGreaterThan(0);
    expect(left[1] - TABLE.h).toBeLessThan(0.03);
    expect(Math.abs(left[0] - TABLE.x)).toBeLessThan(TABLE.w / 2);
    // Ладонь вниз, а не ребром: плоскость кисти почти перпендикулярна столу по ширине.
    const fr = skeleton(rest).frames.foreR;
    expect(Math.abs(fr[2])).toBeLessThan(0.2);
    // Голова опущена, корпус наклонён к столу: лица не нужно, и его не видно.
    expect(rest.head.pitch).toBeGreaterThanOrEqual(30);
    expect(rest.spine).toBeGreaterThan(10);
    const inTable = (p: readonly number[]): boolean => p[1]! < TABLE.h - 0.005 && p[1]! > TABLE.h - 0.12 && Math.abs(p[0]! - TABLE.x) < TABLE.w / 2 && Math.abs(p[2]! - TABLE.z) < TABLE.d / 2;
    for (let i = 0; i < GESTURE_FRAMES; i++) {
      const p = gesturePose(rest, i / GESTURE_FRAMES);
      expect(skeletonPoints(skeleton(p)).filter(inTable), `кадр ${i}`).toEqual([]);
      // Рука ходит по бирке: кончики пальцев не дальше 8 см от её середины и не выше 6 см над столом.
      const t = fingertip(p, 'R');
      expect(Math.hypot(t[0] - TAG_AT[0], t[2] - TAG_AT[2]), `кадр ${i}`).toBeLessThan(0.08);
      expect(t[1] - TABLE.h, `кадр ${i}`).toBeLessThan(0.06);
    }
  });

  it('жест по кругу: начало и конец совпадают, по ходу нет скачков; бирку утаскивает и выравнивает', () => {
    const a = gesture(0);
    const z = gesture(0.99999);
    expect(Math.hypot(a.hand[0] - z.hand[0], a.hand[1] - z.hand[1], a.hand[2] - z.hand[2])).toBeLessThan(1e-3);
    expect(Math.abs(a.tagYaw - z.tagYaw)).toBeLessThan(1e-3);
    let maxYaw = 0;
    let prev = gesture(0);
    for (let i = 1; i <= 400; i++) {
      const g = gesture(i / 400);
      expect(Math.hypot(g.hand[0] - prev.hand[0], g.hand[1] - prev.hand[1], g.hand[2] - prev.hand[2])).toBeLessThan(0.004);
      expect(Math.abs(g.tagYaw - prev.tagYaw)).toBeLessThan(0.01);
      maxYaw = Math.max(maxYaw, g.tagYaw);
      prev = g;
    }
    expect(maxYaw).toBeGreaterThan(0.1);
    // Круг — 5 секунд, как герой дописывает бирку взглядом (квиз 25.11), а не мигание.
    expect(GESTURE_S).toBe(5);
  });

  it('сетки: тело, правая рука по кадрам жеста, стол и бирка; дымная — из редких точек', () => {
    const m = caretakerMesh(CARETAKER_BODY, [], 7);
    expect(m.figure.source).toBe('default');
    expect(m.arm.length).toBe(GESTURE_FRAMES);
    expect(m.dots).toBeGreaterThan(0.5);
    for (const d of [m.body, m.table, m.tag, ...m.arm]) expect(d.index.length).toBeGreaterThan(0);
    // Рука в разных кадрах — в разных местах (плечевой шар стоит, кисть ходит).
    const sumX = (d: { position: Float32Array }): number => d.position.reduce((n, v, i) => (i % 3 === 0 ? n + v : n), 0);
    expect(Math.abs(sumX(m.arm[0]!) - sumX(m.arm[GESTURE_FRAMES / 2]!))).toBeGreaterThan(0.5);
    expect(m.top).toBeGreaterThan(1.3);
    expect(m.top).toBeLessThan(1.8);
  });

  it('место: перед взглядом игрока, вполоборота от него; в экспонат не встаёт', () => {
    const eye: Vec3 = [0, 1.42, 0];
    for (const yaw of [0, 1.1, -2.4]) {
      const p = caretakerSpot(CARETAKER_BODY, eye, yaw, 0, []);
      const fwd = [-Math.sin(yaw), -Math.cos(yaw)] as const;
      const to = [p.at[0] - eye[0], p.at[2] - eye[2]] as const;
      // Впереди, на заданном расстоянии.
      expect(to[0] * fwd[0] + to[1] * fwd[1]).toBeCloseTo(CARETAKER_BODY.offset[1], 5);
      // Лицо фигуры (её +z) смотрит не на игрока: угол между ним и направлением к игроку — «вполоборота».
      const face = [Math.sin(p.yaw), Math.cos(p.yaw)] as const;
      const back = [-to[0], -to[1]];
      const ang = (Math.acos((face[0] * back[0] + face[1] * back[1]) / Math.hypot(back[0], back[1])) * 180) / Math.PI;
      expect(ang).toBeGreaterThan(110);
      expect(ang).toBeLessThan(170);
      expect(p.at[1]).toBe(0);
    }
    // Экспонат там, где встал бы стол, — место сдвигается.
    const free = caretakerSpot(CARETAKER_BODY, eye, 0, 0, []);
    const busy = caretakerSpot(CARETAKER_BODY, eye, 0, 0, [free.at]);
    expect(Math.hypot(busy.at[0] - free.at[0], busy.at[2] - free.at[2])).toBeGreaterThan(0.8);
  });
});
