import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import type { WorldKind } from '../src/gen/layout';
import { createBody, DEFAULT_CONTROLLER, groundHeight, stepPlayer } from '../src/player/controller';
import { DEFAULT_ILLUSIONS, Illusions } from '../src/systems/illusions';
import type { Comeback, ComebackOptions } from '../src/systems/illusions';
import { ColliderSet } from '../src/world/colliders';
import type { MeshData } from '../src/world/kit';
import type { BuiltLevel } from '../src/world/level';
import { buildLevel } from '../src/world/level_build';
import type { LevelObject } from '../src/world/objects';
import { ALL_PROPS, FIXED } from '../src/world/props_all';

const DT = 1 / 60;
const C = DEFAULT_ILLUSIONS;

/** Предмет-заготовка: габариты и место не важны автомату. */
const obj = (id: number, name = 'wardrobe'): LevelObject => ({ id, name, at: [id, 0, 0], rot: 0, min: [id - 0.5, 0, -0.3], max: [id + 0.5, 1.8, 0.3], solid: true, flat: false });
const objects = (n: number): LevelObject[] => Array.from({ length: n }, (_, i) => obj(i + 1));
const NONE: ComebackOptions = { kinds: [], slots: [] };
const BOTH: ComebackOptions = { kinds: ['stool', 'locker'], slots: [3, 8, 13] };

/** Прогнать автомат dt за dt. */
function run(ill: Illusions, seconds: number, light: () => number = () => 1, blocked: () => boolean = () => false, options: ComebackOptions = NONE): Comeback[] {
  const out: Comeback[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) out.push(...ill.update(DT, light, blocked, () => options));
  return out;
}

/** Один шаг: что решено вернуть именно сейчас (пока игра не исполнит решение, оно повторяется на каждом шаге). */
const decide = (ill: Illusions, light: () => number, blocked: () => boolean = () => false, options: ComebackOptions = NONE): Comeback[] => ill.update(DT, light, blocked, () => options);

/** Растворить всё и довести до состояния «нет». */
function dissolve(ill: Illusions): void {
  for (const i of ill.list) ill.touch(i.obj.id);
  run(ill, C.goTime + 0.2);
}

describe('иллюзорные предметы: автомат', () => {
  it('касание запускает растворение, и за goTime предмет исчезает; второе касание ничего не меняет', () => {
    const ill = new Illusions(objects(3), 1);
    expect(ill.get(2)!.state).toBe('here');
    expect(ill.touch(2)).toBe(true);
    expect(ill.touch(2)).toBe(false);
    expect(ill.get(2)!.state).toBe('going');
    // Остальные стоят.
    expect(ill.get(1)!.state).toBe('here');
    expect(ill.get(3)!.state).toBe('here');
    run(ill, C.goTime / 2);
    expect(ill.get(2)!.state).toBe('going');
    expect(ill.get(2)!.dis).toBeGreaterThan(0.4);
    expect(ill.get(2)!.dis).toBeLessThan(0.6);
    run(ill, C.goTime / 2 + 0.05);
    expect(ill.get(2)!.state).toBe('gone');
    expect(ill.get(2)!.dis).toBe(1);
    expect(ill.get(1)!.dis).toBe(0);
  });

  it('несуществующий предмет не трогается и не ломает автомат', () => {
    const ill = new Illusions(objects(2), 1);
    expect(ill.touch(0)).toBe(false);
    expect(ill.touch(3)).toBe(false);
    expect(ill.get(3)).toBeUndefined();
    expect(ill.open(3)).toBe(false);
    expect(ill.update(DT, () => 0, () => false, () => NONE)).toEqual([]);
  });

  it('сквозь предмет нельзя пройти, пока он держит, и можно с доли распада yield — и потом, когда его нет', () => {
    const ill = new Illusions(objects(1), 1);
    expect(ill.open(1)).toBe(false);
    ill.touch(1);
    expect(ill.open(1)).toBe(false);
    let opened = -1;
    for (let i = 0; i < 200 && ill.get(1)!.state === 'going'; i++) {
      ill.update(DT, () => 1, () => false, () => NONE);
      if (opened < 0 && ill.open(1)) opened = ill.get(1)!.dis;
      // Пока распада меньше yield, он держит.
      if (ill.get(1)!.dis < C.yield) expect(ill.open(1)).toBe(false);
    }
    expect(opened).toBeGreaterThanOrEqual(C.yield);
    expect(opened).toBeLessThan(C.yield + DT / C.goTime + 1e-6);
    expect(ill.get(1)!.state).toBe('gone');
    expect(ill.open(1)).toBe(true);
  });

  it('при постоянном свете растворённый предмет не возвращается', () => {
    const ill = new Illusions(objects(5), 7);
    dissolve(ill);
    expect(run(ill, 60, () => 1, () => false, BOTH)).toEqual([]);
    for (const i of ill.list) expect(i.state).toBe('gone');
    // И в постоянной полутьме между порогами — тоже.
    expect(run(ill, 30, () => (C.darkBelow + C.litAbove) / 2, () => false, BOTH)).toEqual([]);
  });

  it('темнота, а затем свет — предмет возвращается; свет без темноты и темнота без света не хватает', () => {
    const ill = new Illusions(objects(1), 3);
    dissolve(ill);
    let light = 1;
    // Свет был, потом полутьма (ещё не темно), потом снова светло: возврата нет.
    light = (C.darkBelow + C.litAbove) / 2;
    expect(run(ill, 1, () => light)).toEqual([]);
    light = 1;
    expect(run(ill, 1, () => light)).toEqual([]);
    // Темно, но света так и не стало.
    light = 0;
    expect(run(ill, 2, () => light)).toEqual([]);
    light = (C.darkBelow + C.litAbove) / 2;
    expect(run(ill, 1, () => light)).toEqual([]);
    // Зажёгся.
    light = 1;
    const back = decide(ill, () => light);
    expect(back).toHaveLength(1);
    expect(back[0]!.id).toBe(1);
    // Пока игра не исполнила решение, предмет ждёт.
    expect(ill.get(1)!.state).toBe('gone');
  });

  it('пока на месте предмета стоит игрок, он не возвращается; вышел — возвращается', () => {
    const ill = new Illusions(objects(1), 3);
    dissolve(ill);
    let light = 0;
    run(ill, 1, () => light);
    light = 1;
    let standing = true;
    expect(run(ill, 2, () => light, () => standing)).toEqual([]);
    expect(ill.get(1)!.state).toBe('gone');
    standing = false;
    expect(decide(ill, () => light, () => standing)).toHaveLength(1);
  });

  it('предметы возвращаются каждый по своему свету: где зажглось — там вернулся', () => {
    const ill = new Illusions(objects(2), 3);
    dissolve(ill);
    const level = new Map([
      [1, 0],
      [2, 0],
    ]);
    const light = (o: LevelObject): number => level.get(o.id)!;
    for (let i = 0; i < 30; i++) ill.update(DT, light, () => false, () => NONE);
    level.set(2, 1);
    const back = ill.update(DT, light, () => false, () => NONE);
    expect(back.map((b) => b.id)).toEqual([2]);
  });

  it('без вариантов предмет всегда возвращается тем же', () => {
    const ill = new Illusions(objects(200), 11);
    dissolve(ill);
    run(ill, 1, () => 0);
    const back = decide(ill, () => 1);
    expect(back).toHaveLength(200);
    for (const b of back) expect(b.how).toBe('same');
  });

  it('если нет мест, второй вариант заменяется предметом, и наоборот — «на месте» достаётся только тем же', () => {
    const pick = (opt: ComebackOptions): Comeback[] => {
      const ill = new Illusions(objects(300), 5);
      dissolve(ill);
      run(ill, 1, () => 0);
      return decide(ill, () => 1, () => false, opt);
    };
    const onlyKinds = pick({ kinds: ['stool'], slots: [] });
    expect(onlyKinds.some((b) => b.how === 'kind')).toBe(true);
    expect(onlyKinds.some((b) => b.how === 'place')).toBe(false);
    const onlySlots = pick({ kinds: [], slots: [4] });
    expect(onlySlots.some((b) => b.how === 'place')).toBe(true);
    expect(onlySlots.some((b) => b.how === 'kind')).toBe(false);
  });

  it('с вариантами на 400 предметах доли возвратов — около 0,5 тем же, 0,3 другим предметом, 0,2 в другом месте', () => {
    const ill = new Illusions(objects(400), 2004);
    dissolve(ill);
    run(ill, 1, () => 0);
    const back = decide(ill, () => 1, () => false, BOTH);
    expect(back).toHaveLength(400);
    const share = (how: Comeback['how']): number => back.filter((b) => b.how === how).length / back.length;
    expect(Math.abs(share('same') - 0.5)).toBeLessThan(0.08);
    expect(Math.abs(share('kind') - 0.3)).toBeLessThan(0.08);
    expect(Math.abs(share('place') - 0.2)).toBeLessThan(0.08);
    // Выбор — только из того, что предложено.
    for (const b of back) {
      if (b.how === 'kind') expect(BOTH.kinds).toContain(b.kind);
      if (b.how === 'place') expect(BOTH.slots).toContain(b.slot);
    }
    // Из предложенного выбираются разные.
    expect(new Set(back.filter((b) => b.how === 'kind').map((b) => (b as { kind: string }).kind)).size).toBe(BOTH.kinds.length);
    expect(new Set(back.filter((b) => b.how === 'place').map((b) => (b as { slot: number }).slot)).size).toBe(BOTH.slots.length);
  });

  it('решения детерминированы: один сид — те же, другой сид — другие', () => {
    const choose = (seed: number): Comeback[] => {
      const ill = new Illusions(objects(60), seed);
      dissolve(ill);
      run(ill, 1, () => 0);
      return decide(ill, () => 1, () => false, BOTH);
    };
    expect(choose(9)).toEqual(choose(9));
    expect(choose(9)).not.toEqual(choose(10));
  });

  it('счёт возвращений тоже решает: предмет, вернувшийся второй раз, может вернуться иначе', () => {
    const cycle = (ill: Illusions): Comeback[] => {
      dissolve(ill);
      run(ill, 1, () => 0);
      const back = decide(ill, () => 1, () => false, BOTH);
      for (const b of back) ill.comeBack(b.id);
      run(ill, C.comeTime + 0.1);
      return back;
    };
    const ill = new Illusions(objects(80), 31);
    const first = cycle(ill);
    const second = cycle(ill);
    expect(second).toHaveLength(80);
    expect(second.filter((b, i) => b.how !== first[i]!.how).length).toBeGreaterThan(10);
  });

  it('comeBack: предмет собирается за comeTime и снова стоит; пока собирается, он держит', () => {
    const ill = new Illusions(objects(1), 3);
    dissolve(ill);
    expect(ill.open(1)).toBe(true);
    ill.comeBack(1);
    expect(ill.get(1)!.state).toBe('coming');
    expect(ill.get(1)!.turns).toBe(1);
    // Собирающийся держит сразу.
    expect(ill.open(1)).toBe(false);
    run(ill, C.comeTime / 2);
    expect(ill.get(1)!.state).toBe('coming');
    expect(ill.get(1)!.dis).toBeGreaterThan(0.4);
    expect(ill.get(1)!.dis).toBeLessThan(0.6);
    run(ill, C.comeTime / 2 + 0.05);
    expect(ill.get(1)!.state).toBe('here');
    expect(ill.get(1)!.dis).toBe(0);
    // И его можно растворить снова.
    expect(ill.touch(1)).toBe(true);
  });

  it('comeBack и leave действуют только на растворённый предмет', () => {
    const ill = new Illusions(objects(2), 3);
    ill.comeBack(1);
    ill.leave(1);
    expect(ill.get(1)!.state).toBe('here');
    ill.touch(2);
    ill.comeBack(2);
    ill.leave(2);
    expect(ill.get(2)!.state).toBe('going');
  });

  it('leave: предмет ушёл насовсем — вместо него теперь отдельная вещь; сквозь место проходят, касание и возврат не действуют', () => {
    const ill = new Illusions(objects(1), 3);
    dissolve(ill);
    ill.leave(1);
    expect(ill.get(1)!.state).toBe('left');
    expect(ill.get(1)!.turns).toBe(1);
    expect(ill.open(1)).toBe(true);
    expect(ill.touch(1)).toBe(false);
    // Темнота и свет его уже не возвращают.
    run(ill, 1, () => 0);
    expect(run(ill, 1, () => 1, () => false, BOTH)).toEqual([]);
    expect(ill.get(1)!.state).toBe('left');
    expect(ill.open(1)).toBe(true);
  });

  it('changed(): отдаёт тех, чьё состояние менялось, и очищает список', () => {
    const ill = new Illusions(objects(3), 3);
    expect(ill.changed()).toEqual([]);
    ill.touch(2);
    expect(ill.changed()).toEqual([2]);
    expect(ill.changed()).toEqual([]);
    ill.update(DT, () => 1, () => false, () => NONE);
    expect(ill.changed()).toEqual([2]);
    // Стоящие на месте в списке не появляются.
    run(ill, 3);
    ill.changed();
    run(ill, 1);
    expect(ill.changed()).toEqual([]);
  });
});

const SEEDS = [1, 5, 808, 20041113];
const WORLDS: readonly WorldKind[] = ['shelter', 'office', 'yellow'];
const built = new Map<string, BuiltLevel>();
const level = (seed: number, world: WorldKind): BuiltLevel => {
  const key = `${seed}:${world}`;
  let l = built.get(key);
  if (!l) built.set(key, (l = buildLevel(generateLayout(seed, 2, world))));
  return l;
};

/** Все сетки уровня: основные и проекции. */
const meshesOf = (l: BuiltLevel): MeshData[] => l.chunks.flatMap((c) => (c.slides ? [c.mesh, c.slides] : [c.mesh]));

describe('иллюзорные предметы: объекты уровня', () => {
  it('у уровня каждого мира есть объекты, номера идут с единицы подряд, имена и свободные места осмысленны', () => {
    for (const world of WORLDS) {
      for (const seed of SEEDS) {
        const l = level(seed, world);
        const objs = l.objects!;
        expect(objs.length, `${world} ${seed}`).toBeGreaterThan(5);
        objs.forEach((o, i) => {
          expect(o.id).toBe(i + 1);
          expect(o.name.length).toBeGreaterThan(0);
          for (let k = 0; k < 3; k++) {
            expect(Number.isFinite(o.min[k]!) && Number.isFinite(o.max[k]!)).toBe(true);
            expect(o.max[k]!).toBeGreaterThanOrEqual(o.min[k]!);
          }
        });
        expect(l.freeSlots!.length, `${world} ${seed}: свободных мест`).toBeGreaterThan(0);
        for (const s of l.freeSlots!) expect([0, 1, 2, 3]).toContain(s.rot);
      }
    }
  });

  it('номер объекта стоит в вершинах: массив по вершине, номера не больше числа объектов, сами вершины — в габаритах объекта', () => {
    for (const world of WORLDS) {
      for (const seed of SEEDS) {
        const l = level(seed, world);
        const n = l.objects!.length;
        const eps = 1e-3;
        let marked = 0;
        for (const m of meshesOf(l)) {
          if (!m.obj) continue;
          expect(m.obj.length, `${world} ${seed}`).toBe(m.position.length / 3);
          for (let v = 0; v < m.obj.length; v++) {
            const id = m.obj[v]!;
            expect(id).toBeLessThanOrEqual(n);
            if (id === 0) continue;
            marked += 1;
            const o = l.objects![id - 1]!;
            for (let k = 0; k < 3; k++) {
              const p = m.position[v * 3 + k]!;
              if (p < o.min[k]! - eps || p > o.max[k]! + eps) throw new Error(`${world} ${seed}: вершина объекта ${id} (${o.name}) вне габаритов по оси ${k}: ${p} не в [${o.min[k]}, ${o.max[k]}]`);
            }
          }
        }
        expect(marked, `${world} ${seed}`).toBeGreaterThan(0);
      }
    }
  });

  it('у предмета с преградой есть хотя бы одна коробка с его номером, у остальных коробок нет; коробок без номера у предметов нет', () => {
    for (const world of WORLDS) {
      for (const seed of SEEDS) {
        const l = level(seed, world);
        const owned = new Map<number, number>();
        for (const b of l.colliders.boxes) if (b.owner !== undefined) owned.set(b.owner, (owned.get(b.owner) ?? 0) + 1);
        for (const [id] of owned) expect(id, `${world} ${seed}: коробка чужого хозяина`).toBeLessThanOrEqual(l.objects!.length);
        for (const o of l.objects!) {
          if (o.solid) expect(owned.get(o.id) ?? 0, `${world} ${seed}: ${o.name} №${o.id}`).toBeGreaterThan(0);
          else expect(owned.get(o.id) ?? 0, `${world} ${seed}: ${o.name} №${o.id} без преград`).toBe(0);
        }
        // Хоть какие-то предметы с преградами в мире есть.
        expect(l.objects!.some((o) => o.solid)).toBe(true);
        expect(l.objects!.some((o) => !o.solid)).toBe(true);
      }
    }
  });

  it('потолочные предметы и FIXED (порог, двери лифта) объектами не становятся', () => {
    const seen = new Set<string>();
    for (const world of WORLDS) {
      for (const seed of SEEDS) {
        for (const o of level(seed, world).objects!) {
          seen.add(o.name);
          expect(FIXED.has(o.name), o.name).toBe(false);
          const spec = ALL_PROPS[o.name];
          if (spec) expect(spec.mount, o.name).not.toBe('ceiling');
          else expect(o.name.startsWith('display_'), `неизвестное имя ${o.name}`).toBe(true);
        }
      }
    }
    expect(FIXED.has('coaming') && FIXED.has('elevator_doors')).toBe(true);
    expect(seen.has('ceiling_panel')).toBe(false);
    expect(seen.has('elevator_doors')).toBe(false);
    expect(seen.has('coaming')).toBe(false);
  });

  it('каждой картонке из flats соответствует объект flat: true без преград; экраны — объекты display_*', () => {
    let standees = 0;
    let screens = 0;
    for (const world of WORLDS) {
      for (const seed of SEEDS) {
        const l = level(seed, world);
        const flatObjs = l.objects!.filter((o) => o.flat);
        for (const o of flatObjs) expect(o.solid, `${o.name} №${o.id}`).toBe(false);
        // Картонка — по одному объекту на отметку (варианты комнат в общий список отметок не идут).
        const marks = (l.flats ?? []).filter((f) => f.kind === 'standee');
        standees += marks.length;
        expect(flatObjs.length, `${world} ${seed}`).toBeGreaterThanOrEqual(marks.length);
        for (const f of marks) expect(flatObjs.some((o) => o.name === f.what), `${world} ${seed}: картонка ${f.what}`).toBe(true);
        const displays = l.objects!.filter((o) => o.name.startsWith('display_'));
        const sc = (l.flats ?? []).filter((f) => f.kind === 'screen');
        screens += sc.length;
        expect(displays.length, `${world} ${seed}`).toBeGreaterThanOrEqual(sc.length);
        for (const d of displays) expect(['display_lean', 'display_stand', 'display_wall']).toContain(d.name);
      }
    }
    expect(standees).toBeGreaterThan(0);
    expect(screens).toBeGreaterThan(0);
  });

  it('один сид — один и тот же список объектов и свободных мест', () => {
    for (const world of WORLDS) {
      const a = buildLevel(generateLayout(808, 2, world));
      const b = buildLevel(generateLayout(808, 2, world));
      expect(a.objects).toEqual(b.objects);
      expect(a.freeSlots).toEqual(b.freeSlots);
      expect(a.objects!.length).toBeGreaterThan(0);
    }
  });
});

describe('иллюзорные предметы: контроллер и преграды', () => {
  const P = DEFAULT_CONTROLLER;
  const ground = (): ColliderSet => {
    const c = new ColliderSet();
    c.addBox(-20, -1, -20, 20, 0, 20);
    return c;
  };
  const box = (c: ColliderSet, x0: number, x1: number, h: number, extra: Record<string, unknown> = {}): number => c.add({ minX: x0, minY: 0, minZ: -5, maxX: x1, maxY: h, maxZ: 5, ...extra });
  /** Идти вдоль +x заданное время; вернуть тело и всё, чего коснулись. */
  function walkX(c: ColliderSet, seconds: number, track = true): { b: ReturnType<typeof createBody>; touched: Set<number> } {
    const b = createBody(0, 0, 0);
    const touched = new Set<number>();
    for (let i = 0; i < Math.round(seconds / DT); i++) stepPlayer(b, 1, 0, 2.3, DT, c, P, track ? touched : undefined);
    return { b, touched };
  }

  it('упёрся в коробку с хозяином — хозяин попадает в touched; в коробку без хозяина — ничего', () => {
    const c = ground();
    box(c, 3, 3.4, 2, { owner: 4 });
    const r = walkX(c, 3);
    expect(r.b.x).toBeCloseTo(3 - P.radius, 2);
    expect([...r.touched]).toEqual([4]);
    const c2 = ground();
    box(c2, 3, 3.4, 2);
    expect(walkX(c2, 3).touched.size).toBe(0);
  });

  it('вещь сна (хозяин с минусом) тоже записывается, как есть', () => {
    const c = ground();
    box(c, 3, 3.4, 2, { owner: -7 });
    expect([...walkX(c, 3).touched]).toEqual([-7]);
  });

  it('пока до коробки не дошёл, touched пуст', () => {
    const c = ground();
    box(c, 9, 9.4, 2, { owner: 4 });
    expect(walkX(c, 1).touched.size).toBe(0);
  });

  it('ghost-коробка не мешает пройти, но сообщает о касании', () => {
    const c = ground();
    box(c, 3, 3.4, 2, { owner: 6, ghost: true });
    const r = walkX(c, 3);
    expect(r.b.x).toBeGreaterThan(4.5);
    expect([...r.touched]).toEqual([6]);
  });

  it('ghost без хозяина ничего не сообщает; ghost на другой высоте (над головой) не задет', () => {
    const c = ground();
    box(c, 3, 3.4, 2, { ghost: true });
    expect(walkX(c, 3).touched.size).toBe(0);
    const c2 = ground();
    c2.add({ minX: 3, minY: 3, minZ: -5, maxX: 3.4, maxY: 4, maxZ: 5, owner: 6, ghost: true });
    const r = walkX(c2, 3);
    expect(r.b.x).toBeGreaterThan(4.5);
    expect(r.touched.size).toBe(0);
  });

  it('ghost-коробка не служит опорой: низкая, она не поднимает игрока', () => {
    const c = ground();
    box(c, 3, 3.4, 0.2, { owner: 6, ghost: true });
    const r = walkX(c, 3);
    expect(r.b.y).toBe(0);
    expect(groundHeight(c, 3.2, 0, 0, P)).toBe(0);
  });

  it('gone-коробка (растворённый предмет) не мешает и не сообщает', () => {
    const c = ground();
    const id = box(c, 3, 3.4, 2, { owner: 4 });
    c.boxes[id]!.gone = true;
    const r = walkX(c, 3);
    expect(r.b.x).toBeGreaterThan(4.5);
    expect(r.touched.size).toBe(0);
    // Вернулась — снова держит.
    c.boxes[id]!.gone = false;
    const again = walkX(c, 3);
    expect(again.b.x).toBeCloseTo(3 - P.radius, 2);
    expect([...again.touched]).toEqual([4]);
  });

  it('луч проходит сквозь ghost, но упирается в обычную коробку позади и в обычную перед ним', () => {
    const c = ground();
    box(c, 3, 3.4, 2, { owner: 6, ghost: true });
    expect(c.raycast(0, 1, 0, 1, 0, 0, 10)).toBe(10);
    box(c, 6, 6.4, 2);
    expect(c.raycast(0, 1, 0, 1, 0, 0, 10)).toBeCloseTo(6, 6);
    const solid = ground();
    box(solid, 3, 3.4, 2, { owner: 6 });
    expect(solid.raycast(0, 1, 0, 1, 0, 0, 10)).toBeCloseTo(3, 6);
    // Растворённый предмет луч тоже не замечает.
    solid.boxes[solid.boxes.length - 1]!.gone = true;
    expect(solid.raycast(0, 1, 0, 1, 0, 0, 10)).toBe(10);
  });

  it('встал на низкую коробку с хозяином — хозяин в touched; groundHeight отдаёт его же', () => {
    const c = ground();
    box(c, 3, 6, 0.25, { owner: 8 });
    // Шагнул на неё и стоит на ней (дальше идти ещё есть куда).
    const r = walkX(c, 2);
    expect(r.b.x).toBeGreaterThan(3.2);
    expect(r.b.y).toBeCloseTo(0.25, 3);
    expect(r.touched.has(8)).toBe(true);
    const t = new Set<number>();
    expect(groundHeight(c, 3.5, 0, 0.25, P, t)).toBeCloseTo(0.25, 6);
    expect([...t]).toEqual([8]);
    // Над коробкой, а не на ней, — не касание.
    const hover = new Set<number>();
    groundHeight(c, 3.5, 0, 0.3, P, hover);
    expect(hover.size).toBe(0);
  });

  it('без touched поведение прежнее: те же координаты, что и с ним', () => {
    const make = (): ColliderSet => {
      const c = ground();
      box(c, 3, 3.4, 2, { owner: 4 });
      box(c, 1, 1.5, 0.2, { owner: 5 });
      return c;
    };
    const a = walkX(make(), 3, false).b;
    const b = walkX(make(), 3, true).b;
    expect(a).toEqual(b);
    expect(a.x).toBeCloseTo(3 - P.radius, 2);
  });

  it('ColliderSet.owner: новые коробки получают хозяина, пока он задан, а явный хозяин не перезаписывается', () => {
    const c = new ColliderSet();
    c.addBox(0, 0, 0, 1, 1, 1);
    c.owner = 12;
    c.addBox(2, 0, 0, 3, 1, 1);
    c.add({ minX: 4, minY: 0, minZ: 0, maxX: 5, maxY: 1, maxZ: 1, owner: -3 });
    c.owner = 0;
    c.addBox(6, 0, 0, 7, 1, 1);
    expect(c.boxes.map((b) => b.owner)).toEqual([undefined, 12, -3, undefined]);
  });
});
