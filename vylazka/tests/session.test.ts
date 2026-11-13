import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/types';
import { generateLayout } from '../src/gen/layout';
import { DEFAULT_SESSION, MEMORIES, Session } from '../src/systems/session';
import type { SessionConfig, SessionEvent, SessionInput } from '../src/systems/session';
import type { BuiltLevel, ItemSpot } from '../src/world/level';
import { buildLevel } from '../src/world/level_build';

const DT = 1 / 60;
const SEED = 20041113;
/** Короткие паузы, чтобы не крутить минуты симуляции. */
const FAST: SessionConfig = { ...DEFAULT_SESSION, firstDelay: 2, delay: 3, fallback: 4 };

const clear = (): number => 99;
const wall = (): number => 0.5;

const levels = new Map<string, BuiltLevel>();
function levelOf(seed: number, rank: 1 | 2 | 3): BuiltLevel {
  const key = `${seed}/${rank}`;
  let l = levels.get(key);
  if (!l) levels.set(key, (l = buildLevel(generateLayout(seed, rank))));
  return l;
}

/** Узел навигации у входа: оттуда игрок начинает. */
function startNode(level: BuiltLevel): number {
  const [x, y, z] = level.spawn.pos;
  let best = 0;
  let bestD = Infinity;
  for (const n of level.nav) {
    const d = Math.hypot(n.x - x, n.z - z) + Math.abs(n.y - y) * 4;
    if (d < bestD) {
      bestD = d;
      best = n.id;
    }
  }
  return best;
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Игрок стоит в узле и смотрит в пустоту. */
function idle(level: BuiltLevel, node: number, extra: Partial<SessionInput> = {}): SessionInput {
  // node < 0 — игрок вне убежища: стоит там же, где и вход, но граф его не видит.
  const n = level.nav[node < 0 ? startNode(level) : node]!;
  return { pos: [n.x, n.y, n.z], eye: [n.x, n.y + 1.42, n.z], aim: [0, 0, -1], light: 1, node, swarm: 0, observed: false, landed: 0, ...extra };
}

/** Игрок стоит в двух с половиной метрах от места и светит на вещь. */
function gaze(spot: ItemSpot, node: number, extra: Partial<SessionInput> = {}): SessionInput {
  const eye: Vec3 = [spot.x + 2.5, spot.y + 1.42, spot.z];
  const aim = norm([spot.x - eye[0], spot.y + 0.2 - eye[1], spot.z - eye[2]]);
  return { pos: [eye[0], spot.y, eye[2]], eye, aim, light: 1, node, swarm: 0, observed: false, landed: 0, ...extra };
}

function run(s: Session, seconds: number, inp: SessionInput, los = clear): SessionEvent[] {
  const out: SessionEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) out.push(...s.update(DT, inp, los));
  return out;
}

const types = (ev: SessionEvent[]): string[] => ev.map((e) => e.type);

/** Расстояние в клетках пути от узла до каждого (свой обход в ширину). */
function bfs(level: BuiltLevel, from: number): Int32Array {
  const dist = new Int32Array(level.nav.length).fill(-1);
  dist[from] = 0;
  const q = [from];
  for (let h = 0; h < q.length; h++) {
    for (const l of level.nav[q[h]!]!.links) {
      if (dist[l] === -1) {
        dist[l] = dist[q[h]!]! + 1;
        q.push(l);
      }
    }
  }
  return dist;
}

/** Узел навигации у места вещи (тот же ярус; чужое помещение «дальше»). */
function nodeOfSpot(level: BuiltLevel, s: ItemSpot): number {
  let best = -1;
  let bestD = Infinity;
  for (const n of level.nav) {
    if (n.tier !== s.tier) continue;
    const d = Math.hypot(n.x - s.x, n.z - s.z) + (n.room === s.room ? 0 : 6);
    if (d < bestD) {
      bestD = d;
      best = n.id;
    }
  }
  return best;
}

describe('сессия: вспышки воспоминаний', () => {
  it('заданий на входе нет; первая вспышка — не раньше firstDelay, даже если игрок уже на что-то смотрит', () => {
    const level = levelOf(SEED, 3);
    const s = new Session(level, 1, new Set(), FAST);
    const node = startNode(level);
    expect(s.active).toBeNull();
    expect(s.memories.every((m) => m.state === 'hidden')).toBe(true);
    expect(types(run(s, 1.9, idle(level, node, { observed: true })))).toEqual([]);
    expect(s.active).toBeNull();
    const ev = run(s, 0.3, idle(level, node, { observed: true }));
    expect(types(ev)).toEqual(['reveal']);
    expect(s.active).toBe(s.memories[0]);
  });

  it('вспышки приходят по одной: пока вещь не вспомнена, следующей нет; после — пауза delay, а не firstDelay', () => {
    const level = levelOf(SEED, 3);
    const s = new Session(level, 2, new Set(), FAST);
    const node = startNode(level);
    run(s, 2.1, idle(level, node, { observed: true }));
    const first = s.active!;
    // Сколько ни жди — второе воспоминание не придёт, пока первое не закрыто.
    expect(types(run(s, 30, idle(level, node, { observed: true })))).toEqual([]);
    expect(s.memories.filter((m) => m.state === 'active').length).toBe(1);
    // Взгляд 1,7 с: «вспомнил» на 1,6 с, после него идёт 0,1 с паузы.
    const ev = run(s, 1.7, gaze(first.spot!, node));
    expect(types(ev)).toEqual(['recall']);
    expect(first.state).toBe('done');
    // После «вспомнил» отсчёт пауз начался заново: до delay (3 с) тишина, потом новая вспышка.
    expect(types(run(s, 2.8, idle(level, node, { observed: true })))).toEqual([]);
    expect(types(run(s, 0.4, idle(level, node, { observed: true })))).toEqual(['reveal']);
    expect(s.active).toBe(s.memories[1]);
  });

  it('без наблюдения вспышка приходит сама: через fallback сверх паузы; не раньше', () => {
    const level = levelOf(SEED, 3);
    const s = new Session(level, 3, new Set(), FAST);
    const node = startNode(level);
    // firstDelay 2 + fallback 4 = 6 с.
    expect(types(run(s, 5.9, idle(level, node)))).toEqual([]);
    expect(types(run(s, 0.3, idle(level, node)))).toEqual(['reveal']);
    // Паузы после первого: delay 3 + fallback 4 = 7 с.
    run(s, 1.7, gaze(s.active!.spot!, node));
    expect(s.active).toBeNull();
    expect(types(run(s, 6.8, idle(level, node)))).toEqual([]);
    expect(types(run(s, 0.3, idle(level, node)))).toEqual(['reveal']);
  });

  it('вне убежища (node < 0, карман или лимбо) вспышки не приходят, а после возвращения — сразу', () => {
    const level = levelOf(SEED, 3);
    const s = new Session(level, 4, new Set(), FAST);
    const node = startNode(level);
    expect(types(run(s, 60, idle(level, -1, { observed: true })))).toEqual([]);
    expect(s.active).toBeNull();
    expect(types(run(s, DT, idle(level, node, { observed: true })))).toEqual(['reveal']);
  });

  it('rush(): следующая вспышка приходит на ближайшем шаге без всякого наблюдения', () => {
    const level = levelOf(SEED, 3);
    const s = new Session(level, 5, new Set(), DEFAULT_SESSION);
    const node = startNode(level);
    expect(types(run(s, 1, idle(level, node)))).toEqual([]);
    s.rush();
    expect(types(s.update(DT, idle(level, node), clear))).toEqual(['reveal']);
    expect(s.active).not.toBeNull();
    // После «вспомнил» пауза снова настоящая, пока не вызвали rush ещё раз.
    run(s, 2, gaze(s.active!.spot!, node));
    expect(types(run(s, 5, idle(level, node)))).toEqual([]);
    s.rush();
    expect(types(s.update(DT, idle(level, node), clear))).toEqual(['reveal']);
  });
});

describe('сессия: где появляется вещь', () => {
  it('в пределах minCells…maxCells клеток пути от игрока; на 30 уровнях разных сидов и рангов', () => {
    const cfg = DEFAULT_SESSION;
    let inRange = 0;
    let n = 0;
    for (let i = 0; i < 30; i++) {
      const rank = ((i % 3) + 1) as 1 | 2 | 3;
      const level = levelOf(1000 + i * 7919, rank);
      // Игрок стоит у входа или в одном из узлов уровня.
      const from = i % 2 === 0 ? startNode(level) : (i * 31) % level.nav.length;
      const dist = bfs(level, from);
      const s = new Session(level, i + 1, new Set(), { ...cfg, count: 1 });
      s.rush();
      const ev = s.update(DT, idle(level, from), clear);
      expect(types(ev), `уровень ${i}`).toEqual(['reveal']);
      const spot = s.active!.spot!;
      expect(level.spots).toContain(spot);
      const d = dist[nodeOfSpot(level, spot)]!;
      n += 1;
      // Объект маленький или игрок в углу: тогда берётся самое далёкое достижимое.
      const hadRange = level.spots.some((sp) => {
        const k = dist[nodeOfSpot(level, sp)]!;
        return k >= cfg.minCells && k <= cfg.maxCells;
      });
      if (hadRange) {
        expect(d, `уровень ${i}, ранг ${rank}`).toBeGreaterThanOrEqual(cfg.minCells);
        expect(d, `уровень ${i}, ранг ${rank}`).toBeLessThanOrEqual(cfg.maxCells);
        inRange += 1;
      } else expect(d, `уровень ${i}: запасной случай — место достижимо`).toBeGreaterThanOrEqual(0);
    }
    // Запасной случай — редкость, а не правило.
    expect(inRange).toBeGreaterThanOrEqual(n - 3);
  });

  it('не в занятом (reserve) месте и не дважды в одном; все пять вещей сессии лежат в разных местах', () => {
    const level = levelOf(SEED, 3);
    const node = startNode(level);
    const s = new Session(level, 6, new Set(), DEFAULT_SESSION);
    const reserved = new Set<ItemSpot>();
    level.spots.forEach((sp, i) => {
      if (i % 2 === 0) {
        s.reserve(sp);
        reserved.add(sp);
      }
    });
    const used: ItemSpot[] = [];
    for (let k = 0; k < 5; k++) {
      s.rush();
      s.update(DT, idle(level, node), clear);
      const m = s.active!;
      expect(reserved.has(m.spot!), `воспоминание ${k} попало в занятое место`).toBe(false);
      expect(used).not.toContain(m.spot);
      used.push(m.spot!);
      run(s, 2, gaze(m.spot!, node));
      expect(m.state).toBe('done');
    }
  });

  it('forget(): вещь переезжает в другое место, взгляд сбрасывается; без искомого — ничего', () => {
    const level = levelOf(SEED, 3);
    const node = startNode(level);
    const s = new Session(level, 7, new Set(), FAST);
    expect(s.forget(node)).toBeNull();
    s.rush();
    s.update(DT, idle(level, node), clear);
    const m = s.active!;
    const was = m.spot!;
    run(s, 0.8, gaze(was, node));
    expect(s.hold).toBeGreaterThan(0.3);
    const ev = s.forget(node);
    expect(ev).toEqual({ type: 'forgot', memory: m });
    expect(m.spot).not.toBe(was);
    expect(level.spots).toContain(m.spot);
    expect(m.state).toBe('active');
    expect(s.hold).toBe(0);
  });
});

describe('сессия: «вспомнить»', () => {
  function started(seed = 8): { s: Session; level: BuiltLevel; node: number; spot: ItemSpot } {
    const level = levelOf(SEED, 3);
    const node = startNode(level);
    const s = new Session(level, seed, new Set(), DEFAULT_SESSION);
    s.rush();
    s.update(DT, idle(level, node), clear);
    return { s, level, node, spot: s.active!.spot! };
  }

  it('нужно держать вещь в луче lookTime секунд со светом, попаданием и прямой видимостью', () => {
    const { s, node, spot } = started();
    const t = DEFAULT_SESSION.lookTime;
    expect(types(run(s, t - 0.15, gaze(spot, node)))).toEqual([]);
    expect(s.hold).toBeGreaterThan(0.85);
    expect(s.active).not.toBeNull();
    expect(types(run(s, 0.3, gaze(spot, node)))).toEqual(['recall']);
    expect(s.active).toBeNull();
    expect(s.hold).toBe(0);
  });

  it('слабый свет (< 0,3) не считается: ни при 0, ни при 0,29; при 0,3 — считается', () => {
    for (const [light, ok] of [[0, false], [0.29, false], [0.3, true]] as const) {
      const { s, node, spot } = started();
      run(s, 3, gaze(spot, node, { light }));
      expect(s.active === null, `свет ${light}`).toBe(ok);
    }
  });

  it('мимо луча, слишком далеко и за преградой не считается', () => {
    const { s, node, spot } = started();
    // Смотрим в сторону.
    const away = gaze(spot, node);
    run(s, 3, { ...away, aim: [-away.aim[0], 0, -away.aim[2]] });
    expect(s.active).not.toBeNull();
    expect(s.hold).toBe(0);
    // Дальше lookRange (6 м).
    const far = gaze(spot, node);
    const eye: Vec3 = [spot.x + 9, far.eye[1], spot.z];
    run(s, 3, { ...far, eye, aim: norm([spot.x - eye[0], spot.y + 0.2 - eye[1], spot.z - eye[2]]) });
    expect(s.active).not.toBeNull();
    // Между игроком и вещью стена.
    run(s, 3, gaze(spot, node), wall);
    expect(s.active).not.toBeNull();
    expect(s.hold).toBe(0);
  });

  it('взгляд спадает быстрее, чем копится (2 в секунду против 1/lookTime); частичное удержание не засчитывается', () => {
    const { s, node, spot } = started();
    run(s, 0.8, gaze(spot, node));
    const h = s.hold;
    expect(h).toBeCloseTo(0.5, 1);
    run(s, 0.2, idle(s.level, node));
    expect(s.hold).toBeCloseTo(h - 0.4, 1);
    run(s, 2, idle(s.level, node));
    expect(s.hold).toBe(0);
    expect(s.active).not.toBeNull();
  });

  it('последнее воспоминание даёт all-done и over; дальше вспышек нет', () => {
    const level = levelOf(SEED, 3);
    const node = startNode(level);
    const s = new Session(level, 9, new Set(), { ...FAST, count: 2 });
    const all: SessionEvent[] = [];
    for (let k = 0; k < 2; k++) {
      s.rush();
      all.push(...s.update(DT, idle(level, node), clear));
      all.push(...run(s, 2, gaze(s.active!.spot!, node)));
    }
    expect(types(all)).toEqual(['reveal', 'recall', 'reveal', 'recall', 'all-done']);
    expect(s.over).toBe(true);
    expect(s.doneCount).toBe(2);
    s.rush();
    expect(types(run(s, 5, idle(level, node, { observed: true })))).toEqual([]);
  });
});

describe('сессия: порядок и длина', () => {
  it('known отодвигает уже вспомненное в конец; порядок по сиду повторяем', () => {
    const level = levelOf(SEED, 1);
    const ids = MEMORIES.map((m) => m.id);
    const known = new Set(ids.slice(0, 12));
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = new Session(level, seed, known, DEFAULT_SESSION);
      const order = s.memories.map((m) => m.def.id);
      // Четыре новых идут первыми, пятое — уже знакомое.
      expect(order.slice(0, 4).every((id) => !known.has(id))).toBe(true);
      expect(known.has(order[4]!)).toBe(true);
      expect(new Set(order).size).toBe(5);
    }
    // Новых хватает на всю сессию — знакомых нет вовсе.
    const some = new Set(ids.slice(0, 5));
    expect(new Session(level, 7, some, DEFAULT_SESSION).memories.every((m) => !some.has(m.def.id))).toBe(true);
    // Без known порядок зависит от сида, но для одного сида он один и тот же.
    const a = new Session(level, 11, new Set(), DEFAULT_SESSION).memories.map((m) => m.def.id);
    expect(new Session(level, 11, new Set(), DEFAULT_SESSION).memories.map((m) => m.def.id)).toEqual(a);
    expect(new Session(level, 12, new Set(), DEFAULT_SESSION).memories.map((m) => m.def.id)).not.toEqual(a);
  });

  it('у каждого воспоминания своя вещь, ключи — [a-z0-9_]; их достаточно на несколько сессий', () => {
    expect(new Set(MEMORIES.map((m) => m.id)).size).toBe(MEMORIES.length);
    for (const m of MEMORIES) expect(m.id).toMatch(/^[a-z0-9_]+$/);
    expect(MEMORIES.length).toBeGreaterThanOrEqual(DEFAULT_SESSION.count * 3);
  });

  it('сессия по умолчанию — не короче пяти минут: пауз на 180 с и больше, воспоминаний не меньше пяти', () => {
    const c = DEFAULT_SESSION;
    expect(c.count).toBeGreaterThanOrEqual(5);
    const waits = c.firstDelay + (c.count - 1) * c.delay;
    expect(waits).toBeGreaterThanOrEqual(180);
    // Вещь не лежит у ног: до неё не меньше minCells клеток пути.
    expect(c.minCells).toBeGreaterThanOrEqual(5);
    expect(c.maxCells).toBeGreaterThan(c.minCells);
    expect(MEMORIES.length).toBeGreaterThanOrEqual(c.count);
  });
});

describe('сессия: среда', () => {
  it('провал в яме — fall, и сразу; вне убежища (node < 0) ямы нет', () => {
    const level = levelOf(SEED, 3);
    const pit = level.zones.find((z) => z.kind === 'pit')!;
    const at: Vec3 = [(pit.minX + pit.maxX) / 2, pit.maxY - 0.3, (pit.minZ + pit.maxZ) / 2];
    const s = new Session(level, 10, new Set(), FAST);
    expect(s.update(DT, { ...idle(level, startNode(level)), pos: at }, clear)).toEqual([{ type: 'fall' }]);
    const s2 = new Session(level, 10, new Set(), FAST);
    expect(s2.update(DT, { ...idle(level, -1), pos: at }, clear)).toEqual([]);
  });

  it('воды: замедляет (флаг inWater); газ — gas-enter один раз, кашель, обморок после faintTime; уход из газа отпускает', () => {
    const level = levelOf(SEED, 3);
    const node = startNode(level);
    const s = new Session(level, 11, new Set(), DEFAULT_SESSION);
    const water = level.zones.find((z) => z.kind === 'water')!;
    s.update(DT, { ...idle(level, node), pos: [(water.minX + water.maxX) / 2, water.minY + 0.2, (water.minZ + water.maxZ) / 2] }, clear);
    expect(s.inWater).toBe(true);

    const gas = level.zones.find((z) => z.kind === 'gas')!;
    const gp: Vec3 = [(gas.minX + gas.maxX) / 2, gas.minY + 0.2, (gas.minZ + gas.maxZ) / 2];
    const inGas = { ...idle(level, node), pos: gp };
    const first = run(s, 2, inGas);
    expect(first.filter((e) => e.type === 'gas-enter').length).toBe(1);
    expect(s.inWater).toBe(false);
    expect(s.inGas).toBe(true);
    expect(first.some((e) => e.type === 'cough' || e.type === 'faint')).toBe(false);
    // 2 с в газу пройдено; кашель после 2,5 с, обморок — на faintTime (5,5 с).
    const mid = run(s, 2.5, inGas);
    expect(mid.some((e) => e.type === 'cough')).toBe(true);
    expect(mid.some((e) => e.type === 'faint')).toBe(false);
    const rest = run(s, 3, inGas);
    expect(rest.filter((e) => e.type === 'faint').length).toBe(1);
    expect(rest.some((e) => e.type === 'cough')).toBe(true);
    // Обморок один: пока стоим в том же газу — повторов нет.
    expect(run(s, 10, inGas).some((e) => e.type === 'faint')).toBe(false);
    // Вышли из газа — отпустило, и в следующий раз всё сначала.
    run(s, 8, idle(level, node));
    expect(s.inGas).toBe(false);
    const again = run(s, 1, inGas);
    expect(again.filter((e) => e.type === 'gas-enter').length).toBe(1);
  });

  it('faintTime можно сократить: обморок наступает раньше', () => {
    const level = levelOf(SEED, 3);
    const gas = level.zones.find((z) => z.kind === 'gas')!;
    const gp: Vec3 = [(gas.minX + gas.maxX) / 2, gas.minY + 0.2, (gas.minZ + gas.maxZ) / 2];
    const s = new Session(level, 12, new Set(), { ...DEFAULT_SESSION, faintTime: 3 });
    const ev = run(s, 3.2, { ...idle(level, startNode(level)), pos: gp });
    expect(ev.filter((e) => e.type === 'faint').length).toBe(1);
  });

  it('паника растёт в темноте и рядом с роем, спадает на свету; испуг и тяжёлое приземление прибавляют сразу', () => {
    const level = levelOf(SEED, 3);
    const node = startNode(level);
    const s = new Session(level, 13, new Set(), DEFAULT_SESSION);
    run(s, 10, idle(level, node, { light: 0 }));
    const dark = s.panic;
    expect(dark).toBeGreaterThan(0.3);
    expect(dark).toBeLessThan(0.4);
    run(s, 4, idle(level, node, { light: 1 }));
    expect(s.panic).toBeLessThan(dark - 0.15);
    s.panic = 0;
    s.scare(0.3);
    expect(s.panic).toBeCloseTo(0.3);
    s.scare(5);
    expect(s.panic).toBe(1);
    s.panic = 0;
    run(s, 5, idle(level, node, { light: 1, swarm: 1 }));
    expect(s.panic).toBeGreaterThan(0.5);
    s.panic = 0;
    s.update(DT, idle(level, node, { landed: 8 }), clear);
    expect(s.panic).toBeCloseTo(0.3, 1);
    s.panic = 0;
    s.update(DT, idle(level, node, { landed: 5 }), clear);
    expect(s.panic).toBe(0);
  });

  it('обвал: взводится, когда по клетке прошли, и рушится за спиной один раз', () => {
    const level = levelOf(SEED, 3);
    const node = startNode(level);
    const s = new Session(level, 14, new Set(), DEFAULT_SESSION);
    const c = level.collapses[0]!;
    const at = (dx: number): SessionInput => ({ ...idle(level, node), pos: [c.center[0] + dx, c.center[1], c.center[2]] });
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

  it('самый глубокий ярус запоминается', () => {
    const level = levelOf(SEED, 3);
    const deep = level.nav.find((n) => n.tier === 2)!;
    const s = new Session(level, 15, new Set(), DEFAULT_SESSION);
    s.update(DT, idle(level, deep.id), clear);
    expect(s.maxTier).toBe(2);
    s.update(DT, idle(level, startNode(level)), clear);
    expect(s.maxTier).toBe(2);
  });
});
