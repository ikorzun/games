import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import { DEFAULT_SPORES, Spores, sporeSites } from '../src/systems/spores';
import type { SporeSource } from '../src/systems/spores';
import type { NavNode } from '../src/world/level';
import { buildLevel } from '../src/world/level_build';
import { FORMS, SPECIES, mushroomForm, speciesBend } from '../src/world/mushrooms';
import { CORNER_FLORA, FIELD_FLORA, PATCH_LAG, SPORE_STRIDE } from '../src/systems/spores';

const DT = 1 / 30;
const C = DEFAULT_SPORES;
/** Логика роста проверяется на одиночных углах: пятно у угла (perCorner) — отдельная проверка. */
const ONE = { ...C, wallShare: 0, perCorner: 1 };

/** Комната 3 × 2 клетки на одном ярусе: шесть узлов, соседи связаны. */
function room(): NavNode[] {
  const nav: NavNode[] = [];
  for (let z = 0; z < 2; z++) for (let x = 0; x < 3; x++) nav.push({ id: nav.length, tier: 0, cx: x, cz: z, x: x * 3, y: 0, z: z * 3, room: 1, links: [] });
  for (const a of nav) for (const b of nav) if (a !== b && Math.abs(a.cx - b.cx) + Math.abs(a.cz - b.cz) === 1) a.links.push(b.id);
  return nav;
}
const at = (x: number, z: number, o: Partial<SporeSource> = {}): SporeSource => ({ pos: [x, 0, z], active: true, cohesion: 0, hunting: false, ...o });
const run = (s: Spores, seconds: number, src: SporeSource | null, regret = 0): void => {
  for (let i = 0; i < Math.round(seconds / DT); i++) s.update(DT, src, regret);
};

describe('грибы: места', () => {
  it('углы — там, где сходятся две стены: у комнаты 3 × 2 их четыре; на полу — по несколько мест в клетке', () => {
    // Только настоящие углы (без подножий стен), по одной грозди.
    const sites = sporeSites(room(), 7, ONE);
    const corners = sites.filter((s) => s.kind === 'corner');
    expect(corners).toHaveLength(4);
    // Углы комнаты — у её внешних углов, чуть отступив от стен.
    const xs = corners.map((s) => s.pos[0]).sort((a, b) => a - b);
    const zs = corners.map((s) => s.pos[2]).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(-1.5 + C.inset, 5);
    expect(xs[3]).toBeCloseTo(7.5 - C.inset, 5);
    expect(zs[0]).toBeCloseTo(-1.5 + C.inset, 5);
    expect(zs[3]).toBeCloseTo(4.5 - C.inset, 5);
    const floor = sites.filter((s) => s.kind === 'floor');
    expect(floor).toHaveLength(6 * C.perCell);
    // Места на полу — внутри своей клетки, не в стене.
    for (const s of floor) {
      const n = room()[s.node]!;
      expect(Math.abs(s.pos[0] - n.x)).toBeLessThan(1.2);
      expect(Math.abs(s.pos[2] - n.z)).toBeLessThan(1.2);
    }
    expect(sites.every((s) => s.grow === 0 && s.size > 0.5 && s.size < 1.3)).toBe(true);
    // Один сид — те же места.
    expect(sporeSites(room(), 7, ONE)).toEqual(sites);
    expect(sporeSites(room(), 8, ONE)).not.toEqual(sites);
    // У подножия стен — тоже: у каждой из десяти стен комнаты по perWall гроздей, вплотную к стене и в пределах своей клетки.
    const all = sporeSites(room(), 7).filter((s) => s.kind === 'corner');
    expect(all.length - 4 * C.perCorner).toBe(10 * C.perWall);
    for (const s of all) {
      const n = room()[s.node]!;
      expect(Math.max(Math.abs(s.pos[0] - n.x), Math.abs(s.pos[2] - n.z))).toBeGreaterThan(1.2);
      expect(Math.max(Math.abs(s.pos[0] - n.x), Math.abs(s.pos[2] - n.z))).toBeLessThan(1.5);
      expect(Math.min(Math.abs(s.pos[0] - n.x), Math.abs(s.pos[2] - n.z))).toBeLessThan(1.5);
    }
  });

  it('грибов вчетверо с лишним гуще (партнёр 19.11): у угла — пятно вдоль двух его стен, у стены — пара, на полу — ковёр', () => {
    // Было: угол — одна гроздь, подножие — у половины стен по одной, пол — пять мест на клетку. Сравнение — с ожидаемым
    // числом (у одного сида половина стен может выпасть и больше, и меньше).
    const walls = 10;
    const was = 4 + 0.5 * walls + 6 * 5;
    const now = sporeSites(room(), 7);
    expect(now.length).toBeGreaterThanOrEqual(4 * was);
    expect(now.length).toBe(4 * C.perCorner + walls * C.perWall + 6 * C.perCell);
    // Пятно: первая гроздь — в самом углу, остальные прижаты к одной из двух его стен (одна координата — как у угла),
    // парами: в паре — по одной у каждой стены, следующая пара дальше от угла и мельче.
    const patch = sporeSites(room(), 7, { ...C, wallShare: 0 }).filter((s) => s.kind === 'corner');
    expect(patch).toHaveLength(4 * C.perCorner);
    const firstWall = new Set<boolean>();
    for (let k = 0; k < 4; k++) {
      const [head, ...rest] = patch.slice(k * C.perCorner, (k + 1) * C.perCorner);
      const off = rest.map((s) => {
        const dx = Math.abs(s.pos[0] - head!.pos[0]);
        const dz = Math.abs(s.pos[2] - head!.pos[2]);
        expect(Math.min(dx, dz)).toBe(0);
        expect(s.node).toBe(head!.node);
        expect(s.size).toBeLessThan(head!.size);
        return { d: Math.max(dx, dz), alongX: dx > 0, size: s.size };
      });
      firstWall.add(off[0]!.alongX);
      for (let j = 0; j + 1 < off.length; j += 2) expect(off[j]!.alongX).not.toBe(off[j + 1]!.alongX);
      for (const o of off) {
        expect(o.d).toBeGreaterThan(0.4);
        expect(o.d).toBeLessThan(1.05);
      }
      // Вторая пара — дальше первой.
      expect(Math.min(off[2]!.d, off[3]!.d)).toBeGreaterThan(Math.max(off[0]!.d, off[1]!.d));
    }
    // Не у всех углов первой занята одна и та же стена: узор не повторяется из угла в угол (на этом сиде — точно).
    expect(firstWall.size).toBe(2);
    // У стены пара гроздей — в разных половинах её длины. Подножие — на 0,18 м от стены, ближе угловых (0,24).
    const off = (s: { pos: readonly number[]; node: number }): number => {
      const n = room()[s.node]!;
      return Math.max(Math.abs(s.pos[0] - n.x), Math.abs(s.pos[2] - n.z));
    };
    const feet = now.filter((s) => s.kind === 'corner' && Math.abs(off(s) - (C.cell / 2 - C.inset * 0.75)) < 1e-6);
    expect(feet).toHaveLength(walls * C.perWall);
    for (let i = 0; i < feet.length; i += 2) {
      const [a, b] = [feet[i]!, feet[i + 1]!];
      const n = room()[a.node]!;
      const along = (s: typeof a): number => (Math.abs(s.pos[0] - n.x) > Math.abs(s.pos[2] - n.z) ? s.pos[2] - n.z : s.pos[0] - n.x);
      expect(along(a)).toBeLessThan(0);
      expect(along(b)).toBeGreaterThanOrEqual(0);
    }
    // Пол: двадцать пять мест на клетку — по сетке с разбросом: в каждой четверти клетки есть место.
    const nav = room();
    for (const n of nav) {
      const floor = now.filter((s) => s.kind === 'floor' && s.node === n.id);
      expect(floor).toHaveLength(C.perCell);
      for (const [qx, qz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
        expect(floor.some((s) => Math.sign(s.pos[0] - n.x) === qx && Math.sign(s.pos[2] - n.z) === qz)).toBe(true);
      }
    }
  });

  it('на настоящих уровнях места есть во всех мирах, лежат на полу своих ярусов; на лестницах грибов нет', () => {
    for (const world of ['shelter', 'office', 'yellow'] as const) {
      const l = buildLevel(generateLayout(20041113, 2, world));
      const sites = sporeSites(l.nav, 5);
      expect(sites.filter((s) => s.kind === 'corner').length, world).toBeGreaterThan(20);
      for (const s of sites) {
        const n = l.nav[s.node]!;
        expect(s.pos[1]).toBe(n.y);
        expect(n.links.every((k) => Math.abs(l.nav[k]!.y - n.y) <= 0.3)).toBe(true);
      }
    }
  });
});

describe('грибы: рост', () => {
  it('пока Осыпи нет, ничего не растёт', () => {
    const s = new Spores(room(), 7);
    run(s, 30, null);
    expect(s.sites.every((q) => q.grow === 0)).toBe(true);
    run(s, 30, at(0, 0, { active: false, hunting: true, cohesion: 1 }));
    expect(s.sites.every((q) => q.grow === 0)).toBe(true);
  });

  it('она появилась: всё вокруг прорастает — быстро, и чем ближе, тем гуще; дальше круга пол пуст', () => {
    const s = new Spores(room(), 7);
    const src = at(0, 0, { cohesion: 1, hunting: true });
    run(s, C.fieldTime + 0.5, src);
    const floor = s.sites.filter((q) => q.kind === 'floor');
    const d = (q: { pos: readonly number[] }): number => Math.hypot(q.pos[0]!, q.pos[2]!);
    const near = floor.filter((q) => d(q) < 1.2);
    const far = floor.filter((q) => d(q) > C.fieldRange + 0.3);
    expect(near.length).toBeGreaterThan(0);
    for (const q of near) expect(q.grow).toBeGreaterThan(0.6);
    for (const q of far) expect(q.grow).toBe(0);
    // Рассеянная по полу, она поля не даёт: только знаки в углах.
    const calm = new Spores(room(), 7);
    run(calm, 5, at(0, 0, { cohesion: 0.1 }));
    expect(calm.sites.filter((q) => q.kind === 'floor').every((q) => q.grow === 0)).toBe(true);
    expect(calm.sites.filter((q) => q.kind === 'corner').some((q) => q.grow > 0.3)).toBe(true);
  });

  it('роли мест: голова угла — одна на угол, спутники пятна парами, подножия, поле; у спутника пары — другой вариант грозди', () => {
    const sites = sporeSites(room(), 7);
    const by = (r: string): number => sites.filter((s) => s.role === r).length;
    expect(by('head')).toBe(4);
    expect(by('patch')).toBe(4 * (C.perCorner - 1));
    expect(by('foot')).toBe(10 * C.perWall);
    expect(by('field')).toBe(6 * C.perCell);
    expect(sites.filter((s) => s.role === 'patch').every((s) => s.step === 1 || s.step === 2)).toBe(true);
    // Пятно — не пять одинаковых гроздей: первый спутник каждой пары — другой вариант того же вида, что голова.
    const corner = sites.filter((s) => s.kind === 'corner');
    for (let i = 0; i < corner.length; i++) {
      if (corner[i]!.role !== 'head') continue;
      const head = corner[i]!;
      const first = corner[i + 1]!;
      expect(first.role).toBe('patch');
      expect(Math.floor(first.form / FORMS)).toBe(Math.floor(head.form / FORMS));
      expect(first.form).not.toBe(head.form);
    }
  });

  it('пятно растёт к ней (куратор, пачка 51, 321): издалека — голова угла, ближе — пары, совсем близко — и подножия', () => {
    const sites = (src: number): Spores => {
      const s = new Spores(room(), 7);
      run(s, C.cornerTime * 2, at(src, 1.5, { cohesion: 0.1 }));
      return s;
    };
    // Она за десять метров от комнаты: растут только головы углов (и то немного).
    const far = sites(-9.5);
    const grownFar = far.sites.filter((q) => q.kind === 'corner' && q.grow > 0.03);
    expect(grownFar.length).toBeGreaterThan(0);
    expect(grownFar.every((q) => q.role === 'head' || (q.role === 'patch' && q.step === 1))).toBe(true);
    // Она в комнате: проросло всё у стен.
    const near = sites(3);
    const corner = near.sites.filter((q) => q.kind === 'corner');
    const nearest = (role: string): number => Math.max(...corner.filter((q) => q.role === role).map((q) => q.grow));
    // Головы — в углах комнаты, в пяти метрах от неё.
    expect(nearest('head')).toBeGreaterThan(0.6);
    expect(nearest('patch')).toBeGreaterThan(0.5);
    expect(nearest('foot')).toBeGreaterThan(0.4);
    // Порядок прорастания: голова, первая пара, вторая пара, подножия — последними.
    expect(0).toBeLessThan(PATCH_LAG.pair);
    expect(PATCH_LAG.pair * 2).toBeLessThan(PATCH_LAG.foot);
  });

  it('след держит только голова угла: ушла — спутники и подножия опадают до нуля', () => {
    const s = new Spores(room(), 7);
    run(s, 8, at(1.5, 1.5, { cohesion: 1, hunting: true }));
    run(s, C.fadeTime + 5, null);
    const corner = s.sites.filter((q) => q.kind === 'corner');
    expect(corner.filter((q) => q.role !== 'head').every((q) => q.grow === 0 && q.trace === 0)).toBe(true);
    expect(corner.some((q) => q.role === 'head' && q.grow > 0.1)).toBe(true);
  });

  it('места внутри вещей (322): голова отступает к середине клетки, остальное отбрасывается', () => {
    const s = new Spores(room(), 7);
    const total = s.sites.length;
    // «Шкаф» в углу (-1.5..-0.6, -1.5..-0.6) у узла 0.
    const box = (x: number, z: number): boolean => x < -0.6 && z < -0.6;
    const head = s.sites.find((q) => q.role === 'head' && q.node === 0 && q.pos[0] < 0 && q.pos[2] < 0)!;
    const before = [...head.pos];
    const dropped = s.settle((x, z) => box(x, z));
    expect(dropped).toBeGreaterThan(0);
    expect(s.sites.length).toBe(total - dropped);
    expect(s.sites.every((q) => !box(q.pos[0], q.pos[2]))).toBe(true);
    // Голова осталась — у края «шкафа», ближе к середине клетки.
    expect(s.sites).toContain(head);
    expect(Math.hypot(head.pos[0], head.pos[2])).toBeLessThan(Math.hypot(before[0]!, before[2]!));
    // Всё по-прежнему растёт и рисуется: буфер dist пересчитан.
    run(s, 6, at(0, 0, { cohesion: 1, hunting: true }));
    const buf = new Float32Array(400 * SPORE_STRIDE);
    expect(s.visible([0, 0, 0], 400, buf)).toBeGreaterThan(0);
  });

  it('под пределом качества головы углов идут первыми: густое поле у ног не вытесняет дальний знак', () => {
    const s = new Spores(room(), 7);
    run(s, 8, at(6, 3, { cohesion: 1, hunting: true }));
    const S = SPORE_STRIDE;
    const buf = new Float32Array(12 * S);
    // Игрок у дальнего угла от неё; первые 12 мест — среди них есть голова угла, хотя поле рядом гуще.
    const n = s.visible([6, 0, 3], 12, buf);
    const heads = s.sites.filter((q) => q.role === 'head' && q.grow > 0.03).map((q) => `${q.pos[0].toFixed(3)},${q.pos[2].toFixed(3)}`);
    let found = 0;
    for (let i = 0; i < n; i++) if (heads.includes(`${buf[i * S]!.toFixed(3)},${buf[i * S + 2]!.toFixed(3)}`)) found += 1;
    expect(found).toBeGreaterThanOrEqual(Math.min(4, heads.length));
  });

  it('углы — знак приближения: чем она ближе, тем они выше; с другого яруса её не чуют', () => {
    const s = new Spores(room(), 7, ONE);
    run(s, C.cornerTime + 1, at(0, 0));
    const corners = s.sites.filter((q) => q.kind === 'corner').sort((a, b) => Math.hypot(a.pos[0], a.pos[2]) - Math.hypot(b.pos[0], b.pos[2]));
    expect(corners[0]!.grow).toBeGreaterThan(corners[3]!.grow);
    expect(corners[0]!.grow).toBeGreaterThan(0.7);
    expect(corners[3]!.grow).toBeGreaterThan(0);
    const other = new Spores(room(), 7);
    run(other, 10, { pos: [0, -4.5, 0], active: true, cohesion: 1, hunting: true });
    expect(other.sites.every((q) => q.grow === 0)).toBe(true);
  });

  it('она ушла: поле осыпается, а в углу, где она побывала, остаётся след', () => {
    const s = new Spores(room(), 7, ONE);
    run(s, 6, at(-1, -1, { cohesion: 1, hunting: true }));
    const grown = s.sites.filter((q) => q.kind === 'floor' && q.grow > 0.5).length;
    expect(grown).toBeGreaterThan(0);
    run(s, C.fadeTime + 5, null);
    expect(s.sites.filter((q) => q.kind === 'floor').every((q) => q.grow === 0)).toBe(true);
    const corners = s.sites.filter((q) => q.kind === 'corner').sort((a, b) => Math.hypot(a.pos[0] + 1, a.pos[2] + 1) - Math.hypot(b.pos[0] + 1, b.pos[2] + 1));
    // В ближнем углу — след в полную силу; в дальнем — слабее или никакого.
    expect(corners[0]!.grow).toBeCloseTo(C.trace, 5);
    expect(corners[3]!.grow).toBeLessThan(C.trace);
  });

  it('сожаление: чем больше стёрто, тем дальше от неё проступают знаки и шире поле', () => {
    const far = at(13, 0);
    const calm = new Spores(room(), 7, ONE);
    run(calm, 8, far, 0);
    const sorry = new Spores(room(), 7, ONE);
    run(sorry, 8, far, 1);
    const sum = (s: Spores): number => s.sites.filter((q) => q.kind === 'corner').reduce((a, q) => a + q.grow, 0);
    expect(sum(sorry)).toBeGreaterThan(sum(calm));
    // Угол в тринадцати метрах без сожаления её не чует вовсе.
    const nearest = (s: Spores) => s.sites.filter((q) => q.kind === 'corner').sort((a, b) => Math.hypot(a.pos[0] - 13, a.pos[2]) - Math.hypot(b.pos[0] - 13, b.pos[2]))[3]!;
    expect(nearest(calm).grow).toBe(0);
    expect(nearest(sorry).grow).toBeGreaterThan(0);
  });

  it('рендеру уходят ближайшие проросшие места (головы углов — первыми): по SPORE_STRIDE чисел, с формой грозди, не больше заказанного', () => {
    const S = SPORE_STRIDE;
    const s = new Spores(room(), 7);
    run(s, 6, at(3, 1.5, { cohesion: 1, hunting: true }));
    const want = 9;
    const buf = new Float32Array(want * S);
    const n = s.visible([3, 0, 1.5], want, buf);
    expect(n).toBe(want);
    const key = (x: number, z: number): string => `${x.toFixed(3)},${z.toFixed(3)}`;
    const heads = new Set(s.sites.filter((q) => q.role === 'head' && q.grow > 0.03).map((q) => key(q.pos[0], q.pos[2])));
    expect(heads.size).toBe(4);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const isHead = heads.has(key(buf[i * S]!, buf[i * S + 2]!));
      // Сначала все четыре головы, потом остальные; внутри каждой группы — от ближнего.
      expect(isHead).toBe(i < 4);
      if (i === 4) prev = 0;
      const d = Math.hypot(buf[i * S]! - 3, buf[i * S + 2]! - 1.5);
      expect(d).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = d;
      expect(buf[i * S + 4]!).toBeGreaterThan(0);
      expect([0, 1]).toContain(buf[i * S + 5]!);
      expect(Number.isInteger(buf[i * S + 6]!)).toBe(true);
      expect(buf[i * S + 6]!).toBeLessThan(SPECIES.length * FORMS);
    }
    // С другого яруса не видно ничего.
    expect(s.visible([3, -4.5, 1.5], 5, buf)).toBe(0);
  });

});

describe('грибы: виды по ядовитым (партнёр 19.11)', () => {
  const each = SPECIES.flatMap((sp, i) => Array.from({ length: FORMS }, (_, v) => ({ id: sp.id, form: i * FORMS + v })));
  it.each(each)('$id (форма $form): низ на полу, гроздь в ладонях, высокая — до полуметра, без мусора в числах', ({ form }) => {
    const m = mushroomForm(form);
    let minY = Infinity;
    let maxY = -Infinity;
    let r = 0;
    for (let i = 0; i < m.position.length; i += 3) {
      expect(Number.isFinite(m.position[i]!) && Number.isFinite(m.position[i + 1]!) && Number.isFinite(m.position[i + 2]!)).toBe(true);
      minY = Math.min(minY, m.position[i + 1]!);
      maxY = Math.max(maxY, m.position[i + 1]!);
      r = Math.max(r, Math.hypot(m.position[i]!, m.position[i + 2]!));
    }
    for (let i = 0; i < m.normal.length; i += 3) expect(Math.hypot(m.normal[i]!, m.normal[i + 1]!, m.normal[i + 2]!)).toBeCloseTo(1, 3);
    expect(minY).toBeGreaterThanOrEqual(-1e-6);
    expect(minY).toBeLessThan(0.005);
    // Неестественно крупные — знак читается с края луча, — но не выше колена.
    expect(maxY).toBeGreaterThan(0.1);
    expect(maxY).toBeLessThan(0.5);
    expect(r).toBeLessThan(0.36);
    // Гроздь — не больше 1500 треугольников: вблизи их сотни разом (дальние — упрощённые, проверка ниже).
    expect(m.index.length / 3).toBeLessThan(1500);
  });

  it.each(each)('$id (форма $form): дальняя сетка — та же гроздь вдвое проще: треугольников меньше, очертания те же', ({ form }) => {
    const near = mushroomForm(form, 0);
    const far = mushroomForm(form, 1);
    expect(far.index.length / near.index.length).toBeLessThan(0.66);
    expect(far.index.length / 3).toBeGreaterThan(60);
    const box = (m: typeof near): number[] => {
      const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let i = 0; i < m.position.length; i += 3) {
        for (let a = 0; a < 3; a++) {
          b[a] = Math.min(b[a]!, m.position[i + a]!);
          b[a + 3] = Math.max(b[a + 3]!, m.position[i + a]!);
        }
      }
      return b;
    };
    // Раскладка грибов в грозди одна и та же: упрощённая гроздь не «перескакивает», когда отходишь.
    const [a, b] = [box(near), box(far)];
    for (let i = 0; i < 6; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThan(0.03);
    for (let i = 0; i < far.normal.length; i += 3) expect(Math.hypot(far.normal[i]!, far.normal[i + 1]!, far.normal[i + 2]!)).toBeCloseTo(1, 3);
    expect(far.position.every(Number.isFinite)).toBe(true);
    // Повторный запрос — та же сетка (кеш), ближняя от дальней не испорчена.
    expect(mushroomForm(form, 0)).toBe(near);
    expect(mushroomForm(form, 1)).toBe(far);
  });

  it('видов десять, у каждого две грозди — и они разные', () => {
    expect(SPECIES).toHaveLength(10);
    for (let i = 0; i < SPECIES.length; i++) expect(mushroomForm(i * FORMS).position).not.toEqual(mushroomForm(i * FORMS + 1).position);
  });

  it('ножки не только прямые: у пучков на древесине и у коноцибе — дуга, у бледной поганки и сатанинского гриба — почти прямые', () => {
    for (const id of ['sulphur_tuft', 'jack_o_lantern', 'deadly_conocybe']) expect(speciesBend(id), id).toBeGreaterThan(35);
    for (const id of ['destroying_angel', 'fire_coral', 'fools_funnel']) expect(speciesBend(id), id).toBeGreaterThan(10);
    for (const id of ['death_cap', 'satan_bolete', 'false_morel']) expect(speciesBend(id), id).toBeLessThan(15);
  });

  it('у омфалота пластинки светятся (материал свечения); у остальных — нет', () => {
    const glows = (form: number): boolean => Array.from(mushroomForm(form).mat).includes(14);
    expect(glows(SPECIES.findIndex((s) => s.id === 'jack_o_lantern') * FORMS)).toBe(true);
    for (const [i, sp] of SPECIES.entries()) if (sp.id !== 'jack_o_lantern') expect(glows(i * FORMS), sp.id).toBe(false);
  });

  it('у каждого места свои грибы в углах, на полу вокруг Осыпи — одни на все; все виды где-то растут', () => {
    const ids = new Set(SPECIES.map((s) => s.id));
    for (const list of [...Object.values(CORNER_FLORA), FIELD_FLORA]) for (const id of list) expect(ids.has(id), id).toBe(true);
    const used = new Set([...Object.values(CORNER_FLORA).flat(), ...FIELD_FLORA]);
    expect(used.size).toBe(SPECIES.length);
    // В углах места — его виды; в клетке углы одного вида (пятна, а не салат).
    for (const place of ['shelter', 'office', 'yellow', 'station']) {
      const sites = sporeSites(room(), 7, C, place);
      const allowed = new Set(CORNER_FLORA[place]!.map((id) => SPECIES.findIndex((s) => s.id === id)));
      for (const s of sites.filter((q) => q.kind === 'corner')) expect(allowed.has(Math.floor(s.form / FORMS)), place).toBe(true);
      const byNode = new Map<number, Set<number>>();
      for (const s of sites.filter((q) => q.kind === 'corner')) byNode.set(s.node, (byNode.get(s.node) ?? new Set()).add(Math.floor(s.form / FORMS)));
      for (const set of byNode.values()) expect(set.size).toBe(1);
    }
    const field = new Set(FIELD_FLORA.map((id) => SPECIES.findIndex((s) => s.id === id)));
    for (const s of sporeSites(room(), 7, C, 'office').filter((q) => q.kind === 'floor')) expect(field.has(Math.floor(s.form / FORMS))).toBe(true);
  });
});
