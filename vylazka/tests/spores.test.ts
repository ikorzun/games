import { describe, expect, it } from 'vitest';
import { generateLayout } from '../src/gen/layout';
import { DEFAULT_SPORES, Spores, sporeSites } from '../src/systems/spores';
import type { SporeSource } from '../src/systems/spores';
import type { NavNode } from '../src/world/level';
import { buildLevel } from '../src/world/level_build';
import { FORMS, SPECIES, mushroomForm, speciesBend } from '../src/world/mushrooms';
import { CORNER_FLORA, FIELD_FLORA, SPORE_STRIDE } from '../src/systems/spores';

const DT = 1 / 30;
const C = DEFAULT_SPORES;

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
    // Только настоящие углы (без подножий стен).
    const sites = sporeSites(room(), 7, { ...C, wallShare: 0 });
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
    expect(sporeSites(room(), 7, { ...C, wallShare: 0 })).toEqual(sites);
    expect(sporeSites(room(), 8, { ...C, wallShare: 0 })).not.toEqual(sites);
    // У подножия стен — тоже: около половины из десяти стен комнаты, вплотную к стене и в пределах своей клетки.
    const feet = sporeSites(room(), 7).filter((s) => s.kind === 'corner').length - 4;
    expect(feet).toBeGreaterThanOrEqual(2);
    expect(feet).toBeLessThanOrEqual(9);
    for (const s of sporeSites(room(), 7).filter((q) => q.kind === 'corner')) {
      const n = room()[s.node]!;
      expect(Math.max(Math.abs(s.pos[0] - n.x), Math.abs(s.pos[2] - n.z))).toBeGreaterThan(1.2);
      expect(Math.max(Math.abs(s.pos[0] - n.x), Math.abs(s.pos[2] - n.z))).toBeLessThan(1.5);
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

  it('углы — знак приближения: чем она ближе, тем они выше; с другого яруса её не чуют', () => {
    const s = new Spores(room(), 7, { ...C, wallShare: 0 });
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
    const s = new Spores(room(), 7, { ...C, wallShare: 0 });
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
    const calm = new Spores(room(), 7, { ...C, wallShare: 0 });
    run(calm, 8, far, 0);
    const sorry = new Spores(room(), 7, { ...C, wallShare: 0 });
    run(sorry, 8, far, 1);
    const sum = (s: Spores): number => s.sites.filter((q) => q.kind === 'corner').reduce((a, q) => a + q.grow, 0);
    expect(sum(sorry)).toBeGreaterThan(sum(calm));
    // Угол в тринадцати метрах без сожаления её не чует вовсе.
    const nearest = (s: Spores) => s.sites.filter((q) => q.kind === 'corner').sort((a, b) => Math.hypot(a.pos[0] - 13, a.pos[2]) - Math.hypot(b.pos[0] - 13, b.pos[2]))[3]!;
    expect(nearest(calm).grow).toBe(0);
    expect(nearest(sorry).grow).toBeGreaterThan(0);
  });

  it('рендеру уходят ближайшие проросшие места: по SPORE_STRIDE чисел, с формой грозди, не больше заказанного', () => {
    const S = SPORE_STRIDE;
    const s = new Spores(room(), 7);
    run(s, 6, at(3, 1.5, { cohesion: 1, hunting: true }));
    const buf = new Float32Array(5 * S);
    const n = s.visible([3, 0, 1.5], 5, buf);
    expect(n).toBe(5);
    let prev = 0;
    for (let i = 0; i < n; i++) {
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
    // Грибов до 220 на экране: гроздь — не больше 1500 треугольников.
    expect(m.index.length / 3).toBeLessThan(1500);
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
