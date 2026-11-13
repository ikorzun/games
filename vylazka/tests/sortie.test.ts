import { describe, expect, it } from 'vitest';
import { defaultProfile, objectNumber, parseProfile, parseRun, rankFor, sortieSeed } from '../src/core/save';
import type { Vec3 } from '../src/core/types';
import { GEN_VERSION, generateLayout } from '../src/gen/layout';
import { populate } from '../src/gen/populate';
import { Sortie } from '../src/systems/sortie';
import type { SortieEvent, SortieInput } from '../src/systems/sortie';
import type { BuiltLevel } from '../src/world/level';
import { buildLevel } from '../src/world/level_build';

const DT = 1 / 60;
const SEED = 20041113;

function make(rank: 1 | 2 | 3 = 3): { level: BuiltLevel; s: Sortie } {
  const level = buildLevel(generateLayout(SEED, rank));
  return { level, s: new Sortie(level, populate(level, SEED)) };
}

const clear = (): number => 99;
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Игрок стоит в pos и смотрит на точку at. */
function input(pos: Vec3, at: Vec3 | null, extra: Partial<SortieInput> = {}): SortieInput {
  const eye: Vec3 = [pos[0], pos[1] + 1.42, pos[2]];
  const aim: Vec3 = at ? norm([at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]]) : [0, 0, -1];
  return { pos, eye, aim, light: 1, actionPressed: false, actionHeld: false, landed: 0, swarm: 0, ...extra };
}

function run(s: Sortie, seconds: number, inp: SortieInput): SortieEvent[] {
  const out: SortieEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) out.push(...s.update(DT, inp, clear));
  return out;
}

describe('вылазка', () => {
  it('предмет берётся одним нажатием, когда он рядом и на него смотрят; издали и спиной — нет', () => {
    const { s } = make();
    const it0 = s.pop.items.find((i) => i.type === 'battery')!;
    const at: Vec3 = [it0.x, it0.y, it0.z];
    const near: Vec3 = [it0.x + 0.8, it0.y - 0.5 < 0 ? Math.floor(it0.y / -4.5) * -4.5 : 0, it0.z];
    near[1] = -it0.tier * 4.5;
    expect(s.update(DT, input([it0.x + 5, near[1], it0.z], at, { actionPressed: true }), clear).some((e) => e.type === 'picked')).toBe(false);
    // Стоим рядом, но смотрим в противоположную сторону.
    const away: Vec3 = [near[0] + 5, near[1] + 1.42, near[2]];
    expect(s.update(DT, input(near, away, { actionPressed: true }), clear).some((e) => e.type === 'picked')).toBe(false);
    s.update(DT, input(near, at), clear);
    expect(s.target?.kind).toBe('item');
    const ev = s.update(DT, input(near, at, { actionPressed: true }), clear);
    expect(ev.some((e) => e.type === 'picked')).toBe(true);
    expect(s.spares).toBe(1);
    expect(s.taken.has(it0.id)).toBe(true);
    // Второй раз тот же предмет взять нельзя.
    expect(s.update(DT, input(near, at, { actionPressed: true }), clear).some((e) => e.type === 'picked')).toBe(false);
  });

  it('цель «забрать» закрывается находкой; находка попадает в список вылазки', () => {
    const { s } = make();
    const o = s.objectives.find((x) => x.type === 'take')!;
    const it0 = s.pop.items[o.item!]!;
    const pos: Vec3 = [it0.x + 0.7, -it0.tier * 4.5, it0.z];
    const ev = s.update(DT, input(pos, [it0.x, it0.y, it0.z], { actionPressed: true }), clear);
    expect(ev.map((e) => e.type)).toEqual(expect.arrayContaining(['picked', 'objective']));
    expect(s.done.has(o.id)).toBe(true);
    expect(s.finds).toContain(it0.find);
  });

  it('цель «снять»: нужно держать примету в луче со светом полторы секунды; в темноте и за преградой — не снимается', () => {
    const { s } = make();
    const o = s.objectives.find((x) => x.type === 'shoot')!;
    const lm = o.landmark!;
    const at: Vec3 = [lm.x, lm.y, lm.z];
    const pos: Vec3 = [lm.x + 2.5, -lm.tier * 4.5, lm.z];
    // Без света.
    run(s, 2, input(pos, at, { actionHeld: true, light: 0 }));
    expect(s.done.has(o.id)).toBe(false);
    // За преградой: луч упирается в стену в метре.
    for (let i = 0; i < 120; i++) s.update(DT, input(pos, at, { actionHeld: true }), () => 1);
    expect(s.done.has(o.id)).toBe(false);
    // Смотрим мимо.
    run(s, 2, input(pos, [lm.x, lm.y + 3, lm.z + 3], { actionHeld: true }));
    expect(s.done.has(o.id)).toBe(false);
    // Как надо — но отпустили кнопку раньше времени.
    run(s, 1.0, input(pos, at, { actionHeld: true }));
    expect(s.hold).toBeGreaterThan(0.5);
    run(s, 1.0, input(pos, at));
    expect(s.hold).toBe(0);
    expect(s.done.has(o.id)).toBe(false);
    const ev = run(s, 1.6, input(pos, at, { actionHeld: true }));
    expect(ev.some((e) => e.type === 'objective')).toBe(true);
    expect(s.done.has(o.id)).toBe(true);
  });

  it('все цели — событие all-done; выход у лестницы по удержанию завершает вылазку', () => {
    const { s, level } = make(1);
    const all: SortieEvent[] = [];
    for (const o of s.objectives) {
      if (o.type === 'take') {
        const it0 = s.pop.items[o.item!]!;
        all.push(...s.update(DT, input([it0.x + 0.7, -it0.tier * 4.5, it0.z], [it0.x, it0.y, it0.z], { actionPressed: true }), clear));
      } else {
        const lm = o.landmark!;
        all.push(...run(s, 1.7, input([lm.x + 2.5, -lm.tier * 4.5, lm.z], [lm.x, lm.y, lm.z], { actionHeld: true })));
      }
    }
    expect(s.allDone).toBe(true);
    expect(all.filter((e) => e.type === 'all-done').length).toBe(1);
    const [x, y, z] = level.exit;
    // Вдали от лестницы удержание ничего не даёт.
    run(s, 2, input([x + 8, y, z - 8], null, { actionHeld: true }));
    expect(s.outcome).toBeNull();
    s.update(DT, input([x, y, z + 0.4], null), clear);
    expect(s.target?.kind).toBe('exit');
    // В самом начале, пока игрок не отходил от люка, подняться не предлагают.
    const fresh = make(1);
    fresh.s.update(DT, input([x, y, z + 0.4], null), clear);
    expect(fresh.s.target).toBeNull();
    const ev = run(s, 1.2, input([x, y, z + 0.4], null, { actionHeld: true }));
    expect(ev.at(-1)).toEqual({ type: 'ended', outcome: 'escaped' });
    expect(s.outcome).toBe('escaped');
    // После конца вылазка больше ничего не делает.
    expect(run(s, 1, input([x, y, z], null, { actionHeld: true }))).toEqual([]);
  });

  it('паника растёт в темноте и спадает на свету; испуг прибавляет сразу', () => {
    const { s, level } = make();
    const pos = level.spawn.pos;
    run(s, 10, input(pos, null, { light: 0 }));
    const dark = s.panic;
    expect(dark).toBeGreaterThan(0.3);
    expect(dark).toBeLessThan(0.4);
    run(s, 4, input(pos, null, { light: 1 }));
    expect(s.panic).toBeLessThan(dark - 0.15);
    s.panic = 0;
    s.scare(0.3);
    expect(s.panic).toBeCloseTo(0.3);
    run(s, 5, input(pos, null, { light: 1, swarm: 1 }));
    expect(s.panic).toBeGreaterThan(0.8);
  });

  it('вода замедляет (флаг), газ душит после заминки и убивает, если не уйти', () => {
    const { s, level } = make();
    const water = level.zones.find((z) => z.kind === 'water')!;
    const wp: Vec3 = [(water.minX + water.maxX) / 2, water.minY + 0.2, (water.minZ + water.maxZ) / 2];
    s.update(DT, input(wp, null), clear);
    expect(s.inWater).toBe(true);
    const gas = level.zones.find((z) => z.kind === 'gas')!;
    const gp: Vec3 = [(gas.minX + gas.maxX) / 2, gas.minY + 0.2, (gas.minZ + gas.maxZ) / 2];
    const first = run(s, 2, input(gp, null));
    expect(first.filter((e) => e.type === 'gas-enter').length).toBe(1);
    expect(s.inWater).toBe(false);
    expect(s.health).toBe(100);
    const later = run(s, 4, input(gp, null));
    expect(later.some((e) => e.type === 'cough')).toBe(true);
    expect(s.health).toBeLessThan(80);
    // Вышли — здоровье понемногу возвращается.
    const h = s.health;
    run(s, 5, input(level.spawn.pos, null));
    expect(s.health).toBeGreaterThan(h);
    const end = run(s, 30, input(gp, null));
    expect(end.at(-1)).toEqual({ type: 'ended', outcome: 'gassed' });
  });

  it('провал и падение с высоты обрывают запись; ушиб отнимает здоровье', () => {
    const a = make();
    const pit = a.level.zones.find((z) => z.kind === 'pit')!;
    const ev = a.s.update(DT, input([(pit.minX + pit.maxX) / 2, pit.maxY - 0.3, (pit.minZ + pit.maxZ) / 2], null), clear);
    expect(ev).toEqual([{ type: 'ended', outcome: 'fell' }]);
    const b = make();
    const hurt = b.s.update(DT, input(b.level.spawn.pos, null, { landed: 8 }), clear);
    expect(hurt.some((e) => e.type === 'hurt')).toBe(true);
    expect(b.s.health).toBeCloseTo(60, 0);
    expect(b.s.update(DT, input(b.level.spawn.pos, null, { landed: 11 }), clear).at(-1)).toEqual({ type: 'ended', outcome: 'fell' });
  });

  it('обвал: взводится, когда по клетке прошли, и рушится за спиной один раз', () => {
    const { s, level } = make();
    const c = level.collapses[0]!;
    const at = (dx: number): SortieInput => input([c.center[0] + dx, c.center[1], c.center[2]], null);
    expect(run(s, 0.5, at(6)).some((e) => e.type === 'collapse')).toBe(false);
    run(s, 0.2, at(0.5));
    expect(s.collapsed()).toEqual([]);
    const ev = run(s, 0.2, at(5));
    expect(ev.filter((e) => e.type === 'collapse').length).toBe(1);
    expect(s.collapsed()).toEqual([c.id]);
    expect(s.panic).toBeGreaterThan(0.3);
    run(s, 0.2, at(0.5));
    expect(run(s, 0.2, at(5)).some((e) => e.type === 'collapse')).toBe(false);
  });

  it('замена батарейки: только с запасной, занимает время, одна за раз', () => {
    const { s, level } = make();
    expect(s.startSwap()).toBeNull();
    s.spares = 2;
    expect(s.startSwap()).toEqual({ type: 'swap-start' });
    expect(s.startSwap()).toBeNull();
    expect(s.spares).toBe(1);
    const ev = run(s, 2, input(level.spawn.pos, null));
    expect(ev.filter((e) => e.type === 'swap-done').length).toBe(1);
    expect(s.swapping).toBe(0);
  });

  it('состояние восстанавливается из сохранения', () => {
    const a = make();
    const it0 = a.s.pop.items.find((i) => i.type === 'battery')!;
    a.s.update(DT, input([it0.x + 0.7, -it0.tier * 4.5, it0.z], [it0.x, it0.y, it0.z], { actionPressed: true }), clear);
    const b = make();
    b.s.restore({ taken: [...a.s.taken], done: [...a.s.done], finds: [...a.s.finds], spares: a.s.spares, time: 123, maxTier: 2, collapsed: [b.level.collapses[0]!.id] });
    expect(b.s.taken.has(it0.id)).toBe(true);
    expect(b.s.spares).toBe(1);
    expect(b.s.time).toBe(123);
    expect(b.s.collapsed()).toEqual([b.level.collapses[0]!.id]);
  });
});

describe('сохранение', () => {
  it('профиль: мусор заменяется значениями по умолчанию, архив без повторов', () => {
    expect(parseProfile(null, 7)).toEqual(defaultProfile(7));
    expect(parseProfile({ v: 2 }, 7)).toEqual(defaultProfile(7));
    expect(parseProfile({ v: 1, sorties: 3.7, successes: -2, archive: ['a', 'a', 5, 'b'], baseSeed: 42 }, 7)).toEqual({ v: 1, sorties: 3, successes: 0, archive: ['a', 'b'], baseSeed: 42 });
  });

  it('вылазка от другой версии генератора не открывается', () => {
    const ok = { v: 1, genVersion: GEN_VERSION, seed: 5, rank: 2, taken: [1, 'x'], done: [], finds: ['journal'], spares: 2, charge: 1.5, time: 10, maxTier: 1, collapsed: [] };
    const run0 = parseRun(ok, GEN_VERSION)!;
    expect(run0.taken).toEqual([1]);
    expect(run0.charge).toBe(1);
    expect(parseRun({ ...ok, genVersion: GEN_VERSION + 1 }, GEN_VERSION)).toBeNull();
    expect(parseRun({ ...ok, rank: 9 }, GEN_VERSION)).toBeNull();
    expect(parseRun('nope', GEN_VERSION)).toBeNull();
  });

  it('ранг растёт с успехами; сид следующего объекта зависит от числа вылазок; номер убежища трёхзначный', () => {
    const p = defaultProfile(1);
    expect(rankFor(p)).toBe(1);
    expect(rankFor({ ...p, successes: 1 })).toBe(2);
    expect(rankFor({ ...p, successes: 3 })).toBe(3);
    expect(sortieSeed(p)).not.toBe(sortieSeed({ ...p, sorties: 1 }));
    expect(sortieSeed(p)).toBe(sortieSeed({ ...p }));
    for (const seed of [0, 1, 899, 900, 4294967295]) {
      expect(objectNumber(seed)).toBeGreaterThanOrEqual(100);
      expect(objectNumber(seed)).toBeLessThanOrEqual(999);
    }
  });
});
