import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import type { WorldKind } from '../src/gen/layout';
import { buildLevel, dunesRolled, ODD_SHARE, oddRolled, poolRoll, WHITE_CHANCE, whiteRolled } from '../src/world/level_build';
import { GARDEN_H } from '../src/world/furnish_extras';
import { BALLOON, ODD_REACH, touchesOdd } from '../src/world/furnish_odd';
import type { OddRoom } from '../src/world/furnish_odd';
import { FIGURES } from '../src/world/figures_data';
import { PLACED, REMOVED } from '../src/world/placed_data';
import { ODD, ODD_KINDS, ODD_TIMING, oddAt, oddEnvelope, oddJitter, oddOn } from '../src/systems/odd';
import type { OddKind } from '../src/systems/odd';

/**
 * Странные комнаты (партнёр 21.11, 19:06: «еще придумай 5 комнат с подобных подходом»; строить — 25.11; design.md, §37.1;
 * world/furnish_odd.ts, systems/odd.ts): баян, аквариум, телевизор, шарик. Жребий общий с белой комнатой — чудо одно на уровень.
 */
const cache = new Map<string, ReturnType<typeof buildLevel> & { layout: ReturnType<typeof generateLayout> }>();
function level(world: WorldKind, seed: number, odd?: OddKind | 'none') {
  const k = `${world}/${seed}/${odd ?? ''}`;
  let l = cache.get(k);
  if (!l) {
    const layout = generateLayout(seed, 2, world);
    l = { ...buildLevel(layout, odd ? { odd } : {}), layout };
    cache.set(k, l);
  }
  return l;
}
/** Первые сиды, где жребий дал именно эту комнату. */
const seedsOf = (kind: OddKind, n: number): number[] => {
  const out: number[] = [];
  for (let s = 1000; s < 6000 && out.length < n; s++) if (oddRolled(s) === kind) out.push(s);
  return out;
};
const partnerTypes = (world: WorldKind): Set<string> =>
  new Set([...[...PLACED, ...FIGURES].filter((s) => s.rule.worlds.includes(world)).flatMap((s) => s.rule.rooms), ...REMOVED.filter((r) => r.worlds.includes(world)).flatMap((r) => r.rooms)]);

describe('жребий чуда: белая комната и четыре странные — одна на уровень', () => {
  const N = 4000;
  const seeds = Array.from({ length: N }, (_, i) => 1000 + i);

  it('белая комната — как и была, в половине уровней; каждая странная — около одного из двадцати', () => {
    const white = seeds.filter((s) => whiteRolled(s)).length / N;
    expect(white).toBeGreaterThan(0.45);
    expect(white).toBeLessThan(0.55);
    for (const kind of ODD_KINDS) {
      const share = seeds.filter((s) => oddRolled(s) === kind).length / N;
      expect(share, kind).toBeGreaterThan(ODD_SHARE * 0.6);
      expect(share, kind).toBeLessThan(ODD_SHARE * 1.4);
    }
  });

  it('одно число на всех: белая и странная никогда не выпадают вместе, песчаный зал — не там, где странная', () => {
    for (const s of seeds) {
      const k = oddRolled(s);
      if (whiteRolled(s)) expect(k).toBeNull();
      if (k) {
        expect(poolRoll(s)).toBeGreaterThanOrEqual(WHITE_CHANCE);
        expect(dunesRolled(s)).toBe(false);
      }
    }
  });

  it('песчаный зал остаётся примерно в трёх уровнях из десяти', () => {
    const dunes = seeds.filter((s) => dunesRolled(s)).length / N;
    expect(dunes).toBeGreaterThan(0.25);
    expect(dunes).toBeLessThan(0.4);
  });
});

describe('странная комната на уровне', () => {
  it.each(ODD_KINDS)('%s: выпала — есть (убежище), и на уровне больше нет ни белой комнаты, ни песчаного зала', (kind) => {
    let have = 0;
    for (const s of seedsOf(kind, 3)) {
      const l = level('shelter', s);
      expect(l.whiteRoom, `сид ${s}`).toBeUndefined();
      expect(l.duneDoor, `сид ${s}`).toBeUndefined();
      if (!l.oddRoom) continue;
      have++;
      expect(l.oddRoom.kind).toBe(kind);
    }
    expect(have).toBeGreaterThanOrEqual(2);
  });

  it('не выпала — её нет', () => {
    for (let s = 1000; s < 1008; s++) if (oddRolled(s) === null) expect(level('shelter', s).oddRoom, `сид ${s}`).toBeUndefined();
  });

  it('в зале ожидания странных комнат нет', () => {
    for (const kind of ODD_KINDS) for (const s of seedsOf(kind, 1)) expect(level('station', s).oddRoom).toBeUndefined();
  });

  it('в первом сне (odd: none) — ни странной, ни белой комнаты; песчаный зал — по своему жребию', () => {
    for (const kind of ODD_KINDS) {
      const s = seedsOf(kind, 1)[0]!;
      expect(level('shelter', s, 'none').oddRoom).toBeUndefined();
    }
    const w = [1000, 1001, 1002, 1003, 1004, 1005].find((s) => whiteRolled(s) && level('shelter', s).whiteRoom)!;
    expect(level('shelter', w, 'none').whiteRoom).toBeUndefined();
    const d = Array.from({ length: 40 }, (_, i) => 2000 + i * 41).find((s) => dunesRolled(s) && level('shelter', s).duneDoor)!;
    expect(level('shelter', d, 'none').duneDoor).toBeDefined();
  });

  it.each(['shelter', 'office', 'yellow'] as const)('%s: прямоугольник в две или четыре клетки; не начало, не особое и не помещение партнёра; пусто', (world) => {
    const pt = partnerTypes(world);
    for (const kind of ODD_KINDS) {
      for (const s of [1066]) {
        const l = level(world, s, kind);
        const o = l.oddRoom;
        expect(o, `${world} ${kind} ${s}`).toBeDefined();
        if (!o) continue;
        const room = l.layout.rooms[o.room]!;
        expect([2, 4]).toContain(room.cells.length);
        const xs = room.cells.map((c) => c[0]);
        const zs = room.cells.map((c) => c[1]);
        expect((Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...zs) - Math.min(...zs) + 1)).toBe(room.cells.length);
        expect(o.room).not.toBe(l.layout.entranceRoom);
        expect([l.greenRoom, l.skyRoom, l.grassRoom, l.whiteRoom?.room]).not.toContain(o.room);
        expect(['corridor', 'department', 'collapsed', 'stairwell', 'lift']).not.toContain(room.type);
        expect(pt.has(room.type), `партнёр ставит вещи в ${room.type}`).toBe(false);
        expect((o.box[2] - o.box[0]) * (o.box[3] - o.box[1])).toBeCloseTo(room.cells.length * 9, 5);
        // Пусто: ни мест для вещей, ни вещей журнала (вещь комнаты — не вещь сна: касание её не растворяет), ни бумаги.
        const inside = (p: readonly number[]): boolean => p[0]! > o.box[0] && p[0]! < o.box[2] && p[2]! > o.box[1] && p[2]! < o.box[3] && p[1]! > o.y[0] - 0.5 && p[1]! < o.y[1] + 0.5;
        expect(l.spots.filter((sp) => sp.room === o.room)).toEqual([]);
        expect((l.objects ?? []).filter((ob) => inside(ob.at)).map((ob) => ob.name)).toEqual([]);
        expect((l.flats ?? []).filter((f) => inside(f.at)).length).toBe(0);
        // Вещь посередине, лицом к проходу.
        expect(o.at[0]).toBeCloseTo((o.box[0] + o.box[2]) / 2, 5);
        expect(o.at[2]).toBeCloseTo((o.box[1] + o.box[3]) / 2, 5);
        expect(Math.hypot(o.face[0], o.face[1])).toBeCloseTo(1, 6);
        if (o.door) expect((o.door[0] - o.at[0]) * o.face[0] + (o.door[1] - o.at[2]) * o.face[1]).toBeGreaterThan(0);
      }
    }
  });

  it('шарик: потолок высокий (как в саду), комната — на верхнем ярусе, нитка свисает до пояса', () => {
    for (const s of [1066, 1081, 1134]) {
      const l = level('shelter', s, 'balloon');
      const o = l.oddRoom!;
      expect(o.y[1] - o.y[0]).toBeCloseTo(GARDEN_H, 5);
      expect(l.ceilings?.[o.room]).toBeCloseTo(GARDEN_H, 5);
      expect(l.layout.rooms[o.room]!.tier).toBe(l.layout.rooms[l.layout.entranceRoom]!.tier);
      expect('line' in o.trigger).toBe(true);
      if ('line' in o.trigger) {
        expect(o.trigger.line[0][1] - o.y[0]).toBeCloseTo(BALLOON.end, 2);
        expect(o.trigger.line[1][1] - o.y[0]).toBeCloseTo(BALLOON.knot, 2);
      }
    }
  });

  it('телевизор: экран на лице корпуса смотрит к проходу; вещи с коробкой — стоят преградой', () => {
    for (const kind of ['bayan', 'aquarium', 'tv'] as const) {
      const l = level('shelter', 1066, kind);
      const o = l.oddRoom!;
      expect('box' in o.trigger).toBe(true);
      if (!('box' in o.trigger)) continue;
      const [lo, hi] = o.trigger.box;
      // Посередине стоит преграда: тело туда не пройдёт.
      const boxes = l.colliders.boxes.filter((b) => b.minX < o.at[0] + 0.05 && b.maxX > o.at[0] - 0.05 && b.minZ < o.at[2] + 0.05 && b.maxZ > o.at[2] - 0.05 && b.maxY > o.y[0] + 0.3 && b.minY < o.y[0] + 0.3);
      expect(boxes.length, kind).toBeGreaterThan(0);
      expect(lo[0]).toBeGreaterThan(o.box[0] + 0.5);
      expect(hi[0]).toBeLessThan(o.box[2] - 0.5);
      if (kind === 'tv') {
        const sc = o.screen!;
        expect(sc.n[0]).toBeCloseTo(o.face[0], 6);
        expect(sc.n[2]).toBeCloseTo(o.face[1], 6);
        expect(sc.at[1] - o.y[0]).toBeGreaterThan(0.1);
        expect(sc.at[1] - o.y[0]).toBeLessThan(0.5);
        expect(sc.w).toBeGreaterThan(sc.h);
      }
    }
  });
});

describe('касание вещи странной комнаты', () => {
  const box: OddRoom = { kind: 'bayan', room: 0, tier: 0, box: [-3, -3, 3, 3], y: [0, 2.7], face: [0, 1], at: [0, 0, 0], trigger: { box: [[-0.24, 0, -0.24], [0.24, 0.95, 0.24]] } };
  const line: OddRoom = { ...box, kind: 'balloon', trigger: { line: [[0, 0.95, 0], [0, 2.46, 0]], r: 0.03 } };

  it('коробка: тело у её края — касается; в шаге — нет', () => {
    expect(touchesOdd(box, 0, 0, 0.24 + 0.3, 0.3)).toBe(true);
    expect(touchesOdd(box, 0, 0, 0.24 + 0.3 + ODD_REACH - 0.01, 0.3)).toBe(true);
    expect(touchesOdd(box, 0, 0, 0.24 + 0.3 + ODD_REACH + 0.05, 0.3)).toBe(false);
    expect(touchesOdd(box, 1.2, 0, 0, 0.3)).toBe(false);
  });

  it('нитка: тело на ней — касается; рядом или ниже её конца (голова ниже) — нет', () => {
    expect(touchesOdd(line, 0.1, 0, 0, 0.3)).toBe(true);
    expect(touchesOdd(line, 0.5, 0, 0, 0.3)).toBe(false);
    expect(touchesOdd(line, 0, 0, 0, 0.3, 0.8)).toBe(false);
  });
});

describe('пять секунд другого ощущения (systems/odd.ts)', () => {
  it.each(ODD_KINDS)('%s: до касания и после — ничего; мягко набирается, держится до пятой секунды и уходит', (kind) => {
    const c = ODD_TIMING[kind];
    expect(c.hold).toBe(5);
    expect(oddAt(kind, -1, false).k).toBe(0);
    expect(oddEnvelope(kind, 0)).toBe(0);
    // Без рывка: за первый кадр почти ничего.
    expect(oddEnvelope(kind, 1 / 60)).toBeLessThan(0.05);
    expect(oddEnvelope(kind, c.in)).toBeCloseTo(1, 6);
    expect(oddEnvelope(kind, 4.9)).toBeCloseTo(1, 6);
    expect(oddEnvelope(kind, c.hold + c.out / 2)).toBeLessThan(1);
    expect(oddEnvelope(kind, c.hold + c.out / 2)).toBeGreaterThan(0);
    expect(oddOn(kind, c.hold + c.out - 0.01)).toBe(true);
    expect(oddOn(kind, c.hold + c.out)).toBe(false);
    expect(oddAt(kind, c.hold + c.out, false).k).toBe(0);
  });

  it('баян: стены сходятся, кадр уже (телевик), сердце и аккорд; тихий режим — вполовину', () => {
    const f = oddAt('bayan', 3, false);
    expect(f.squeeze).toBeCloseTo(ODD.bayan.squeeze, 6);
    expect(f.fov).toBeCloseTo(ODD.bayan.fov, 6);
    expect(f.heart).toBe(1);
    expect(f.chord).toBe(1);
    expect(f.rise).toBe(0);
    const q = oddAt('bayan', 3, true);
    expect(q.squeeze).toBeCloseTo(ODD.bayan.squeeze / 2, 6);
    expect(q.fov).toBeCloseTo(1 - (1 - ODD.bayan.fov) / 2, 6);
  });

  it('аквариум: шаг втрое тяжелее, звук глохнет, след; в тихом режиме следа нет, тяжесть та же', () => {
    const f = oddAt('aquarium', 3, false);
    expect(f.speed).toBeCloseTo(1 / 3, 6);
    expect(f.muffle).toBeGreaterThan(0.5);
    expect(f.trail).toBeGreaterThan(0.5);
    expect(f.fov).toBe(1);
    const q = oddAt('aquarium', 3, true);
    expect(q.trail).toBe(0);
    expect(q.speed).toBeCloseTo(1 / 3, 6);
  });

  it('телевизор: дрожь мелкая; в «почти незаметных» и при «меньше движения» её нет вовсе', () => {
    const f = oddAt('tv', 3, false);
    expect(f.jitter).toBeCloseTo(ODD.tv.jitter, 6);
    expect(oddAt('tv', 3, true).jitter).toBe(0);
    let peak = 0;
    for (let t = 0; t < 5; t += 0.01) {
      const [y, p] = oddJitter(t, f.jitter);
      peak = Math.max(peak, Math.abs(y), Math.abs(p));
    }
    expect(peak).toBeLessThanOrEqual(ODD.tv.jitter + 1e-9);
    expect(peak).toBeGreaterThan(ODD.tv.jitter * 0.5);
    expect(oddJitter(1.3, 0)).toEqual([0, 0]);
  });

  it('шарик: простор — потолок уходит вверх, кадр чуть шире, героя мягко поднимает, ход скольжением; камера без крена', () => {
    const f = oddAt('balloon', 4, false);
    expect(f.rise).toBeCloseTo(ODD.balloon.rise, 6);
    expect(f.fov).toBeCloseTo(ODD.balloon.fov, 6);
    expect(f.fov).toBeGreaterThan(1);
    expect(f.lift).toBeCloseTo(ODD.balloon.lift, 6);
    expect(f.glide).toBeGreaterThan(0.5);
    expect(f.jitter).toBe(0);
    const q = oddAt('balloon', 4, true);
    expect(q.lift).toBeCloseTo(ODD.balloon.lift / 2, 6);
    expect(q.rise).toBeCloseTo(ODD.balloon.rise / 2, 6);
    // Подъём без рывка: за кадр — меньше сантиметра.
    for (let t = 0; t < 8; t += 1 / 60) expect(Math.abs(oddAt('balloon', t + 1 / 60, false).lift - oddAt('balloon', t, false).lift)).toBeLessThan(0.01);
  });
});
