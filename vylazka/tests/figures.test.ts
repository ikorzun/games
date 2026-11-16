import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types';
import { clonePose, handlePoint, HANDLES, solve } from '../src/world/figure_ik';
import { figureProblems, LIMITS, poseOk } from '../src/world/figures';
import type { FigureSpec } from '../src/world/figures';
import { POSES, skeleton } from '../src/world/props_people';
import type { Pose } from '../src/world/props_people';

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const stand = (): Pose => clonePose(POSES.stand as Pose);

/** Слова партнёра: «Да, инструмент ок, но я сам хочу руками трогать». Инструмент фигур гнёт манекен руками. */
describe('фигура гнётся руками', () => {
  it('все позы-заготовки — в пределах суставов', () => {
    for (const [name, p] of Object.entries(POSES)) expect(poseOk(p), name).toBe(true);
  });

  it('потянул кисть в достижимую точку — кисть там с точностью до сантиметра; плечо на месте', () => {
    const p = stand();
    const s0 = skeleton(p);
    // Поднять левую руку вперёд и вбок: точка в пределах длины руки от плеча.
    const sh = s0.shL;
    const target: Vec3 = [sh[0] + 0.25, sh[1] + 0.1, sh[2] + 0.35];
    const q = solve(p, 'wristL', target);
    const s1 = skeleton(q);
    expect(dist(s1.wrL, target)).toBeLessThan(0.01);
    expect(dist(s1.shL, sh)).toBeLessThan(1e-9);
    // Другая рука и ноги не тронуты.
    expect(q.armR).toEqual(p.armR);
    expect(q.legL).toEqual(p.legL);
  });

  it('щиколотку можно вывести вперёд и вверх — нога сгибается, другая нога и тело стоят', () => {
    const p = stand();
    const s0 = skeleton(p);
    const target: Vec3 = [s0.anR[0], s0.anR[1] + 0.35, s0.anR[2] + 0.3];
    const q = solve(p, 'ankleR', target);
    const s1 = skeleton(q);
    expect(dist(s1.anR, target)).toBeLessThan(0.02);
    // Стоящий опирается подошвами на пол: поднял одну ногу — тело оседает на другую на несколько миллиметров.
    expect(dist(s1.anL, s0.anL)).toBeLessThan(0.01);
    expect(q.legR.bend).toBeGreaterThan(5);
  });

  it('недостижимая цель: рука тянется к ней, но суставы не выходят за пределы', () => {
    const p = stand();
    const q = solve(p, 'wristR', [-3, 1.2, 2]);
    expect(poseOk(q)).toBe(true);
    expect(q.armR.bend).toBeGreaterThanOrEqual(LIMITS.armBend[0]);
    expect(q.armR.bend).toBeLessThanOrEqual(LIMITS.armBend[1]);
    // Рука выпрямлена в сторону цели: кисть дальше от тела, чем была.
    expect(skeleton(q).wrR[0]).toBeLessThan(skeleton(p).wrR[0] - 0.2);
  });

  it('голову и корпус тоже тянут: макушка и основание шеи идут к цели, поза в пределах; заготовку решатель не трогает', () => {
    const p = stand();
    const before = JSON.stringify(POSES.stand);
    const head0 = handlePoint(skeleton(p), 'head');
    const q = solve(p, 'head', [head0[0] + 0.08, head0[1] - 0.04, head0[2] + 0.06]);
    expect(dist(handlePoint(skeleton(q), 'head'), head0)).toBeGreaterThan(0.05);
    expect(poseOk(q)).toBe(true);
    const neck0 = handlePoint(skeleton(p), 'chest');
    const r = solve(p, 'chest', [neck0[0], neck0[1] - 0.1, neck0[2] + 0.25]);
    expect(r.spine).toBeGreaterThan(p.spine + 10);
    expect(poseOk(r)).toBe(true);
    expect(JSON.stringify(POSES.stand)).toBe(before);
    expect(HANDLES.length).toBe(6);
  });
});

describe('фигура для игры: данные и их проверка', () => {
  const good = (): FigureSpec => ({
    id: 'smoke_corner',
    name: 'Дымный у угла',
    pose: stand(),
    material: 'smoke',
    rule: { worlds: ['shelter'], rooms: ['dorm'], anchor: 'corner', facing: 'wall', lift: 0.6, count: 1 },
    yaw: 0,
    offset: [0, 0.2],
  });

  it('годная фигура проходит', () => {
    expect(figureProblems(good())).toEqual([]);
  });

  it('ловит плохой ключ, материал, правило и позу', () => {
    expect(figureProblems({ ...good(), id: 'Дым 1' })).toContain('ключ: только a–z, 0–9 и _');
    expect(figureProblems({ ...good(), material: 'glass' })).toContain('материал');
    expect(figureProblems({ ...good(), rule: { ...good().rule, worlds: [] } })).toContain('места');
    expect(figureProblems({ ...good(), rule: { ...good().rule, lift: 5 } })).toContain('высота: от 0 до 2,6 м');
    expect(figureProblems({ ...good(), rule: { ...good().rule, count: 4 } })).toContain('сколько: 1–3');
    const bent = stand();
    bent.armL.bend = 170;
    expect(figureProblems({ ...good(), pose: bent })).toContain('поза вне пределов суставов');
    expect(figureProblems(null)).toEqual(['не объект']);
  });
});

// ── Фигуры в игре: сетка, расстановка по правилу, поведение (слова партнёра: дымные висят в воздухе и
// рассеиваются при подходе; волосатые растворяются по анатомии — «от рук к телу»). ──

import { generateLayout } from '../src/gen/layout';
import { Game, STEP } from '../src/game';
import type { DreamEvent } from '../src/game';
import { emptyInput } from '../src/player/input';
import type { GameRenderer, ThingView } from '../src/render/renderer';
import { DEFAULT_FIGURES, Figures } from '../src/systems/figures';
import { mulberry32 } from '../src/core/rng';
import { figureMesh, HAIR_ORDER, HAIR_SHELLS, SMOKE_DOTS } from '../src/world/figure_mesh';
import { FIGURES } from '../src/world/figures_data';
import { buildLevel } from '../src/world/level_build';
import { MAT } from '../src/world/materials';
import { CELL } from '../src/world/shell';
import type { BuiltLevel } from '../src/world/level';
import type { FigureAnchor, FigureFacing, FigureMaterial } from '../src/world/figures';

const fig = (material: FigureMaterial, anchor: FigureAnchor, facing: FigureFacing, over: Partial<FigureSpec['rule']> = {}, id = `t_${material}_${anchor}_${facing}`): FigureSpec => ({
  id,
  name: id,
  pose: stand(),
  material,
  rule: { worlds: ['shelter', 'office', 'yellow', 'station'], rooms: [], anchor, facing, lift: 0, count: 1, ...over },
  yaw: 0,
  offset: [0, 0],
});

describe('сетка фигуры', () => {
  it('волосатая — четырнадцать частей тела; растворяется от рук к телу: кисти первыми, голова последней', () => {
    const m = figureMesh(stand(), 'hair', 3);
    expect(m.pieces.map((p) => p.part)).toEqual(Object.keys(HAIR_ORDER));
    const d = (p: string): number => m.pieces.find((x) => x.part === p)!.delay;
    expect(d('handL')).toBe(0);
    expect(d('handR')).toBeLessThan(d('foreL'));
    expect(Math.max(d('foreL'), d('foreR'))).toBeLessThan(Math.min(d('upperL'), d('upperR')));
    expect(Math.max(d('upperL'), d('upperR'))).toBeLessThan(Math.min(d('footL'), d('footR')));
    expect(Math.max(d('thighL'), d('thighR'))).toBeLessThan(d('torso'));
    expect(d('torso')).toBeLessThan(d('head'));
    // Ворс — слоями, как мох: основание и HAIR_SHELLS слоёв; у слоёв в канале качания — уровень со знаком минус.
    for (const p of m.pieces) {
      const n = p.data.position.length / 3;
      expect(n % (HAIR_SHELLS + 1)).toBe(0);
      const sw = p.data.sway!;
      expect(sw[0]).toBe(0);
      expect(sw[n - 1]).toBeCloseTo(-1, 6);
      expect(p.data.mat.every((v) => v === MAT.carpet)).toBe(true);
    }
  });

  it('дымная — цельная и из редких точек; остальные — цельные, каждая в своём материале', () => {
    const smoke = figureMesh(stand(), 'smoke', 1);
    expect(smoke.pieces.length).toBe(1);
    expect(smoke.dots).toBe(SMOKE_DOTS);
    const wood = figureMesh(stand(), 'wood', 1);
    const stone = figureMesh(stand(), 'stone', 1);
    expect(wood.dots).toBe(0);
    expect(wood.pieces[0]!.data.mat.every((v) => v === MAT.wood)).toBe(true);
    expect(stone.pieces[0]!.data.mat.every((v) => v === MAT.concrete)).toBe(true);
    // Стоящий: подошвы у пола, макушка выше полутора метров, середина тела — на высоте пояса.
    expect(wood.low).toBeLessThan(0.05);
    expect(wood.top).toBeGreaterThan(1.5);
    expect(wood.core[1]).toBeGreaterThan(0.8);
    expect(wood.core[1]).toBeLessThan(1.3);
  });
});

describe('расстановка по правилу', () => {
  const layout = generateLayout(20041113, 2, 'shelter');
  const lvl = (figures: FigureSpec[]): BuiltLevel => buildLevel(layout, { figures });
  /** Луч по горизонтали от груди фигуры туда, куда она смотрит: до первой преграды, м. */
  const ahead = (l: BuiltLevel, at: number[], yaw: number): number => l.colliders.raycast(at[0]!, at[1]! + 1.25, at[2]!, Math.sin(yaw), 0, Math.cos(yaw), 6);

  it('пока партнёр не сохранил ни одной фигуры, на уровнях их нет', () => {
    expect(FIGURES.length).toBe(0);
    expect(buildLevel(layout).figures).toBeUndefined();
  });

  it('у стены лицом в стену — стена в полуметре; лицом в комнату — простор', () => {
    const l = lvl([fig('wood', 'wall', 'wall', { count: 3 }, 'a'), fig('wood', 'wall', 'room', { count: 3 }, 'b')]);
    const a = l.figures!.filter((f) => f.id === 'a');
    const b = l.figures!.filter((f) => f.id === 'b');
    expect(a.length).toBe(3);
    expect(b.length).toBe(3);
    for (const f of a) expect(ahead(l, f.at, f.yaw)).toBeLessThan(0.5);
    for (const f of b) expect(ahead(l, f.at, f.yaw)).toBeGreaterThan(1);
    // По возможности — в разных помещениях.
    expect(new Set(a.map((f) => f.room)).size).toBe(3);
  });

  it('в углу — в 0,38 м от обеих стен; не у самого начала, не вплотную друг к другу, ни во что не вросла', () => {
    const l = lvl([fig('stone', 'corner', 'wall', { count: 3 })]);
    const spots = l.figures!;
    expect(spots.length).toBe(3);
    const sp = l.spawn.pos;
    for (const f of spots) {
      if (f.tier === 0) expect(Math.hypot(f.at[0]! - sp[0], f.at[2]! - sp[2])).toBeGreaterThan(3.1);
      // До стен по обеим осям: от точки до края клетки 3/2 − 0,15 − 0,38 = 0,97 м.
      const lx = (((f.at[0]! / CELL + 0.5) % 1) + 1) % 1;
      const lz = (((f.at[2]! / CELL + 0.5) % 1) + 1) % 1;
      expect(Math.min(lx, 1 - lx) * CELL).toBeCloseTo(0.53, 1);
      expect(Math.min(lz, 1 - lz) * CELL).toBeCloseTo(0.53, 1);
      // Лицом в угол: в той стороне стена рядом.
      expect(ahead(l, f.at, f.yaw)).toBeLessThan(0.9);
      // Таз фигуры не внутри преграды.
      const inBox = l.colliders.boxes.some((b) => !b.off && f.at[0]! > b.minX && f.at[0]! < b.maxX && f.at[2]! > b.minZ && f.at[2]! < b.maxZ && f.at[1]! + 0.9 > b.minY && f.at[1]! + 0.9 < b.maxY);
      expect(inBox).toBe(false);
    }
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) if (spots[i]!.tier === spots[j]!.tier) expect(Math.hypot(spots[i]!.at[0]! - spots[j]!.at[0]!, spots[i]!.at[2]! - spots[j]!.at[2]!)).toBeGreaterThan(1.5);
  });

  it('тот же сид — те же места; чужое место и чужое помещение правило не берёт', () => {
    const one = lvl([fig('hair', 'corner', 'room', { count: 2 })]).figures;
    const two = lvl([fig('hair', 'corner', 'room', { count: 2 })]).figures;
    expect(two).toEqual(one);
    expect(lvl([fig('wood', 'wall', 'wall', { worlds: ['office'] })]).figures).toBeUndefined();
    // Спальни в этом плане две (ярусы 0 и 2): фигура «посреди спальни» встаёт только в них.
    const only = 'dorm';
    expect(layout.rooms.filter((r) => r.type === only).length).toBe(2);
    const got = lvl([fig('wood', 'middle', 'room', { rooms: [only], count: 3 })]).figures ?? [];
    expect(got.length).toBeGreaterThan(0);
    for (const f of got) expect(layout.rooms[f.room]!.type).toBe(only);
  });

  it('под потолком — не ниже 0,6 м над полом и макушкой не в потолке; в проёме — на линии стены', () => {
    const l = lvl([fig('smoke', 'ceiling', 'door', { lift: 2.6, count: 2 }, 'c'), fig('coal', 'door', 'room', { count: 2 }, 'd')]);
    for (const f of l.figures!.filter((x) => x.id === 'c')) {
      const floor = -4.5 * f.tier;
      expect(f.at[1]! - floor).toBeGreaterThanOrEqual(0.6 - 1e-9);
      expect(f.at[1]! - floor + figureMesh(stand(), 'smoke', 1).top).toBeLessThan((l.ceilings?.[f.room] ?? 2.6) + 1e-6);
    }
    const doors = l.figures!.filter((x) => x.id === 'd');
    expect(doors.length).toBe(2);
    for (const f of doors) {
      const onX = Math.abs(((f.at[0]! / CELL + 0.5) % 1 + 1) % 1) < 1e-6 || Math.abs(((f.at[0]! / CELL + 0.5) % 1 + 1) % 1 - 1) < 1e-6;
      const onZ = Math.abs(((f.at[2]! / CELL + 0.5) % 1 + 1) % 1) < 1e-6 || Math.abs(((f.at[2]! / CELL + 0.5) % 1 + 1) % 1 - 1) < 1e-6;
      expect(onX || onZ).toBe(true);
    }
  });
});

describe('поведение фигур', () => {
  const core: Vec3 = [0, 1, 0];
  const lightOn = (): number => 1;

  it('дымная рассеивается при подходе и собирается, когда отошёл', () => {
    const fs = new Figures();
    const f = fs.add('s', 0, 'smoke', [0, 0.5, 0], 0, core, [{ part: 'body', delay: 0 }], SMOKE_DOTS);
    // Далеко — стоит и медленно ходит вверх-вниз.
    let t = 0;
    for (let i = 0; i < 60; i++) fs.update(STEP, [0, 1.6, 5], (t += STEP), lightOn);
    expect(f.state).toBe('here');
    expect(Math.abs(f.bob)).toBeGreaterThan(0);
    const ev = fs.update(STEP, [0, 1.6, 2], (t += STEP), lightOn);
    expect(ev.map((e) => e.what)).toEqual(['gone']);
    for (let i = 0; i < Math.ceil(DEFAULT_FIGURES.smokeGo / STEP) + 2; i++) fs.update(STEP, [0, 1.6, 2], (t += STEP), lightOn);
    expect(f.state).toBe('gone');
    // Рядом — не собирается; отошёл — через несколько секунд собирается.
    for (let i = 0; i < 10 / STEP; i++) fs.update(STEP, [0, 1.6, 2], (t += STEP), lightOn);
    expect(f.state).toBe('gone');
    let back = false;
    for (let i = 0; i < 12 / STEP; i++) {
      const ev2 = fs.update(STEP, [0, 1.6, 9], (t += STEP), lightOn);
      back = back || ev2.some((e) => e.what === 'back');
    }
    expect(back).toBe(true);
    expect(f.state).toBe('here');
    expect(f.pieces[0]!.dissolve).toBe(0);
  });

  it('волосатая растворяется от рук к телу; возвращается, когда свет погас и зажёгся, — от головы к рукам', () => {
    const m = figureMesh(stand(), 'hair', 2);
    const fs = new Figures();
    const f = fs.add('h', 0, 'hair', [0, 0, 0], 0, m.core, m.pieces, 0);
    const part = (p: string): number => f.pieces.find((x) => x.part === p)!.dissolve;
    let t = 0;
    // В полутора метрах ещё стоит; ближе — пошла.
    fs.update(STEP, [0, 1.6, 1.6], (t += STEP), lightOn);
    expect(f.state).toBe('here');
    fs.update(STEP, [0, 1.6, 1.1], (t += STEP), lightOn);
    expect(f.state).toBe('going');
    for (let i = 0; i < 0.6 / STEP; i++) fs.update(STEP, [0, 1.6, 1.1], (t += STEP), lightOn);
    expect(part('handL')).toBeGreaterThan(0.5);
    expect(part('torso')).toBe(0);
    expect(part('head')).toBe(0);
    for (let i = 0; i < 1.4 / STEP; i++) fs.update(STEP, [0, 1.6, 1.1], (t += STEP), lightOn);
    expect(part('upperL')).toBe(1);
    expect(part('head')).toBe(0);
    for (let i = 0; i < 2 / STEP; i++) fs.update(STEP, [0, 1.6, 1.1], (t += STEP), lightOn);
    expect(f.state).toBe('gone');
    // Свет горит — не возвращается; погас и зажёгся — возвращается (игрок отошёл).
    for (let i = 0; i < 2 / STEP; i++) fs.update(STEP, [0, 1.6, 5], (t += STEP), lightOn);
    expect(f.state).toBe('gone');
    fs.update(STEP, [0, 1.6, 5], (t += STEP), () => 0);
    fs.update(STEP, [0, 1.6, 5], (t += STEP), lightOn);
    expect(f.state).toBe('coming');
    for (let i = 0; i < 0.5 / STEP; i++) fs.update(STEP, [0, 1.6, 5], (t += STEP), lightOn);
    expect(part('head')).toBeLessThan(1);
    expect(part('handL')).toBe(1);
    for (let i = 0; i < 4 / STEP; i++) fs.update(STEP, [0, 1.6, 5], (t += STEP), lightOn);
    expect(f.state).toBe('here');
  });

  it('деревянная уходит только от касания; собиравшаяся уходит с того, что успело собраться', () => {
    const fs = new Figures();
    const f = fs.add('w', 0, 'wood', [0, 0, 0], 0, core, [{ part: 'body', delay: 0 }], 0);
    let t = 0;
    for (let i = 0; i < 30; i++) fs.update(STEP, [0, 1.45, 1.2], (t += STEP), lightOn);
    expect(f.state).toBe('here');
    fs.update(STEP, [0, 1.45, 0.5], (t += STEP), lightOn);
    expect(f.state).toBe('going');
    for (let i = 0; i < 2 / STEP; i++) fs.update(STEP, [0, 1.45, 0.5], (t += STEP), lightOn);
    expect(f.state).toBe('gone');
    fs.update(STEP, [0, 1.45, 5], (t += STEP), () => 0);
    fs.update(STEP, [0, 1.45, 5], (t += STEP), lightOn);
    for (let i = 0; i < 0.8 / STEP; i++) fs.update(STEP, [0, 1.45, 5], (t += STEP), lightOn);
    const mid = f.pieces[0]!.dissolve;
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.8);
    fs.update(STEP, [0, 1.45, 0.5], (t += STEP), lightOn);
    expect(f.state).toBe('going');
    expect(f.pieces[0]!.dissolve).toBeGreaterThanOrEqual(mid);
  });
});

describe('фигуры в игре', () => {
  /** Рендер-заглушка: запоминает вещи и их последний вид; остальное молча принимает. */
  function fakeRenderer(): { r: GameRenderer; things: Map<number, ThingView | null> } {
    const things = new Map<number, ThingView | null>();
    let next = 1;
    const base: Record<string, unknown> = {
      addThing: () => {
        const id = next++;
        things.set(id, null);
        return id;
      },
      setThing: (id: number, v: ThingView) => {
        if (things.has(id)) things.set(id, v);
      },
      removeThing: (id: number) => things.delete(id),
    };
    const r = new Proxy(base, { get: (t, k: string) => (k in t ? t[k] : () => undefined) });
    return { r: r as unknown as GameRenderer, things };
  }

  it('фигура уровня встаёт в игре частями; подошёл — ушла со звуком; дымная висит и из редких точек', () => {
    const layout = generateLayout(20041113, 2, 'shelter');
    const level = buildLevel(layout, { figures: [fig('smoke', 'middle', 'room', { lift: 0.9, count: 1 }, 'smoky')] });
    expect(level.figures?.length).toBe(1);
    const { r, things } = fakeRenderer();
    const g = new Game(r, mulberry32(3));
    g.calm = true;
    // Фигуры нет в списке игры — даём её как поставленную отладкой (тот же путь, что __vz.figure).
    const spec = fig('smoke', 'middle', 'room', { lift: 0.9, count: 1 }, 'smoky');
    g.loadLevel(level);
    expect(g.figures.list.length).toBe(0);
    const spot = level.figures![0]!;
    const f = g.addDebugFigure(spec, spot.at, spot.yaw);
    expect(things.size).toBeGreaterThan(0);
    const dream: DreamEvent[] = [];
    // Встать в метре от неё.
    g.teleport(f.at[0] + 1, f.at[1] - 0.9, f.at[2]);
    for (let i = 0; i < 40; i++) {
      dream.push(...g.step(STEP, emptyInput()).dream);
      g.draw(1, STEP);
    }
    expect(dream.some((e) => e.type === 'figure' && e.what === 'gone' && e.material === 'smoke')).toBe(true);
    const views = [...things.values()].filter((v): v is ThingView => v !== null);
    expect(views.length).toBeGreaterThan(0);
    const v = views[views.length - 1]!;
    expect(v.dots ?? 0).toBeGreaterThanOrEqual(SMOKE_DOTS);
    expect(Math.abs(v.y - f.at[1])).toBeLessThan(0.05);
  });
});
