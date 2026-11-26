import { describe, expect, it } from 'vitest';
import { bakeContact, CONTACT_SIZE, DEFAULT_CONTACT, tierOf } from '../src/world/contact';
import type { ContactMap } from '../src/world/contact';
import type { LevelObject } from '../src/world/objects';

const C = DEFAULT_CONTACT;
/** Пол яруса t лежит на −4,5·t м. */
const floor = (t: number): number => -4.5 * t;

/** Предмет-коробка: низ на высоте y, основание x0..x1 × z0..z1, высота h. */
const box = (id: number, x0: number, z0: number, x1: number, z1: number, h: number, y = 0): LevelObject => ({
  id,
  name: 'box',
  at: [(x0 + x1) / 2, y, (z0 + z1) / 2],
  rot: 0,
  min: [x0, y, z0],
  max: [x1, y + h, z1],
  solid: true,
  flat: false,
});

/** Значение канала ch в точке мира (x, z): точка переводится в точку карты по формуле из шапки. */
function at(m: ContactMap, x: number, z: number, ch = 0): number {
  const ix = Math.floor(((x - m.origin[0]) / m.span) * m.size);
  const iz = Math.floor(((z - m.origin[1]) / m.span) * m.size);
  if (ix < 0 || iz < 0 || ix >= m.size || iz >= m.size) return 0;
  return m.data[(iz * m.size + ix) * 4 + ch]!;
}

describe('контактные тени: tierOf', () => {
  it('предмет на полу яруса — номер яруса; на ярусе 1 — единица', () => {
    expect(tierOf(box(1, 0, 0, 1, 1, 0.8), floor, 3)).toBe(0);
    expect(tierOf(box(1, 0, 0, 1, 1, 0.8, -4.5), floor, 3)).toBe(1);
  });

  it('висящий выше lift над полом — минус единица', () => {
    expect(tierOf(box(1, 0, 0, 1, 1, 0.5, 1.5), floor, 3)).toBe(-1);
    // Чуть выше допуска — тоже висит, чуть ниже — стоит.
    expect(tierOf(box(1, 0, 0, 1, 1, 0.5, C.lift + 0.01), floor, 3)).toBe(-1);
    expect(tierOf(box(1, 0, 0, 1, 1, 0.5, C.lift - 0.01), floor, 3)).toBe(0);
  });
});

describe('контактные тени: bakeContact', () => {
  const o = box(1, 2, 2, 3, 3, 0.8);

  it('под стоящим предметом — тёмное пятно в канале 0 (около 255 × dark), в других каналах — ноль', () => {
    const m = bakeContact([o], floor, 3)!;
    expect(m).not.toBeNull();
    expect(m.size).toBe(CONTACT_SIZE);
    expect(m.data.length).toBe(CONTACT_SIZE * CONTACT_SIZE * 4);
    const v = at(m, 2.5, 2.5, 0);
    expect(Math.abs(v - 255 * C.dark)).toBeLessThanOrEqual(1);
    for (const ch of [1, 2, 3]) expect(at(m, 2.5, 2.5, ch)).toBe(0);
    // Во всей карте канал 1..3 пуст.
    for (let i = 0; i < m.data.length; i += 4) {
      expect(m.data[i + 1]).toBe(0);
      expect(m.data[i + 2]).toBe(0);
      expect(m.data[i + 3]).toBe(0);
    }
  });

  it('за габаритом пятно плавно сходит на нет не дальше spreadMax; дальше — ноль', () => {
    const m = bakeContact([o], floor, 3)!;
    const px = m.span / m.size;
    let prev = at(m, 2.5, 2.5);
    let seenPositive = false;
    let lastNonZero = 3;
    // Идём от края предмета (x = 3) вправо мелкими шагами по середине стороны.
    for (let x = 3.001; x < 3 + 1; x += 0.01) {
      const v = at(m, x, 2.5);
      expect(v).toBeLessThanOrEqual(prev);
      if (v > 0) {
        seenPositive = true;
        lastNonZero = x;
      }
      prev = v;
    }
    expect(seenPositive).toBe(true);
    // Сход плавный: рядом с краем ещё темно, а не обрыв в ноль.
    expect(at(m, 3.01, 2.5)).toBeGreaterThan(0.6 * 255 * C.dark);
    // Выше предмета 0,8 м: растекание = min(spreadMax, 0,8·spread); пиксельная точность — не больше точки.
    expect(lastNonZero - 3).toBeLessThanOrEqual(C.spreadMax + px);
    expect(at(m, 3 + C.spreadMax + 2 * px, 2.5)).toBe(0);
    expect(at(m, 3 + 0.8, 2.5)).toBe(0);
  });

  it('предмет ниже minHeight (коврик) пятна не даёт; один коврик — null', () => {
    const rug = box(2, 0, 0, 2, 2, 0.02);
    expect(bakeContact([rug], floor, 3)).toBeNull();
    // Рядом с настоящим предметом коврик ничего не добавляет и карту не растягивает.
    const solo = bakeContact([o], floor, 3)!;
    const both = bakeContact([o, rug], floor, 3)!;
    expect(both.origin).toEqual(solo.origin);
    expect(both.span).toBe(solo.span);
    expect(Array.from(both.data)).toEqual(Array.from(solo.data));
  });

  it('висящий предмет (min.y = 1,5) пятна не даёт; список из одних висящих — null', () => {
    const hung = box(3, 0, 0, 1, 1, 0.5, 1.5);
    expect(tierOf(hung, floor, 3)).toBe(-1);
    expect(bakeContact([hung], floor, 3)).toBeNull();
    expect(bakeContact([hung, box(4, 5, 5, 6, 6, 0.3, 2)], floor, 3)).toBeNull();
  });

  it('пустой список — null', () => {
    expect(bakeContact([], floor, 3)).toBeNull();
  });

  it('предмет на ярусе 1 пишет в канал 1, а не в канал 0', () => {
    const t1 = box(5, 2, 2, 3, 3, 0.8, -4.5);
    const m = bakeContact([t1], floor, 3)!;
    expect(at(m, 2.5, 2.5, 1)).toBeGreaterThan(100);
    expect(at(m, 2.5, 2.5, 0)).toBe(0);
  });

  it('два яруса одной картой: каналы независимы', () => {
    const m = bakeContact([o, box(5, 2, 2, 3, 3, 0.8, -4.5)], floor, 3)!;
    expect(at(m, 2.5, 2.5, 0)).toBeGreaterThan(100);
    expect(at(m, 2.5, 2.5, 1)).toBeGreaterThan(100);
  });

  it('низкий предмет темнит слабее высокого — пропорционально высоте до fullHeight', () => {
    const low = bakeContact([box(1, 2, 2, 3, 3, 0.2)], floor, 3)!;
    const high = bakeContact([box(1, 2, 2, 3, 3, 0.8)], floor, 3)!;
    const vl = at(low, 2.5, 2.5);
    const vh = at(high, 2.5, 2.5);
    expect(vl).toBeLessThan(vh);
    expect(Math.abs(vl - 255 * C.dark * (0.2 / C.fullHeight))).toBeLessThanOrEqual(1);
    // Выше fullHeight темнее уже не становится.
    const tall = bakeContact([box(1, 2, 2, 3, 3, 2.0)], floor, 3)!;
    expect(at(tall, 2.5, 2.5)).toBe(vh);
  });

  it('gone убирает пятно предмета, но origin и span карты не меняются', () => {
    const a = o;
    const b = box(2, 6, 6, 7, 7, 0.8);
    const full = bakeContact([a, b], floor, 3)!;
    const part = bakeContact([a, b], floor, 3, new Set([2]))!;
    expect(part.origin).toEqual(full.origin);
    expect(part.span).toBe(full.span);
    expect(at(full, 6.5, 6.5)).toBeGreaterThan(100);
    expect(at(part, 6.5, 6.5)).toBe(0);
    // Пятно оставшегося на месте.
    expect(at(part, 2.5, 2.5)).toBe(at(full, 2.5, 2.5));
    // Если рассыпались все — карта всё равно есть (пустая, тех же габаритов).
    const none = bakeContact([a, b], floor, 3, new Set([1, 2]))!;
    expect(none).not.toBeNull();
    expect(none.span).toBe(full.span);
    expect(none.data.every((v) => v === 0)).toBe(true);
  });

  it('мировая точка под предметом переводится в точку карты по (x − origin) / span · size — пятно именно там', () => {
    const obj = box(1, 10, -4, 11, -3, 0.8);
    const other = box(2, 14, 2, 15, 3, 0.8);
    const m = bakeContact([obj, other], floor, 3)!;
    const x = 10.5;
    const z = -3.5;
    const ix = Math.floor(((x - m.origin[0]) / m.span) * m.size);
    const iz = Math.floor(((z - m.origin[1]) / m.span) * m.size);
    const v = m.data[(iz * m.size + ix) * 4]!;
    expect(Math.abs(v - 255 * C.dark)).toBeLessThanOrEqual(1);
    // Весь самый тёмный блок вокруг — именно у этой точки: центр масс пятна рядом.
    let sx = 0;
    let sz = 0;
    let sum = 0;
    for (let j = 0; j < m.size; j++) {
      for (let i = 0; i < m.size; i++) {
        const w = m.data[(j * m.size + i) * 4]!;
        // Берём только окрестность первого предмета: до x = 12,5.
        if (i < ix + 20 && w > 0 && ((i + 0.5) / m.size) * m.span + m.origin[0] < 12.5) {
          sx += w * i;
          sz += w * j;
          sum += w;
        }
      }
    }
    expect(Math.abs(sx / sum - ix)).toBeLessThan(3);
    expect(Math.abs(sz / sum - iz)).toBeLessThan(3);
    // Карта целиком охватывает оба предмета.
    expect(at(m, 14.5, 2.5)).toBeGreaterThan(100);
  });
});
