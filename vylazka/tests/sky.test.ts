import { describe, expect, it } from 'vitest';
import { fillSky, NEBULA_HUES, SKY_FAR, SKY_NEAR, SKY_NEBULA, SKY_TOTAL, skyLook, STAR_KIND } from '../src/render/sky';

const buffers = (): [Float32Array, Float32Array] => [new Float32Array(SKY_TOTAL * 3), new Float32Array(SKY_TOTAL * 4)];

describe('звёздное небо — у каждого сна своё (партнёр 17.11: «звездное небо и космос должны быть разными каждый раз»)', () => {
  it('одно зерно — одно и то же небо до последней звезды; другое зерно — другое небо', () => {
    const [p1, s1] = buffers();
    const [p2, s2] = buffers();
    fillSky(12345, p1, s1);
    fillSky(12345, p2, s2);
    expect(p1).toEqual(p2);
    expect(s1).toEqual(s2);
    const [p3] = buffers();
    fillSky(12346, p3, new Float32Array(SKY_TOTAL * 4));
    let same = 0;
    for (let i = 0; i < SKY_FAR * 3; i++) if (p1[i] === p3[i]) same += 1;
    expect(same / (SKY_FAR * 3)).toBeLessThan(0.01);
  });

  it('небеса разные по существу: млечный путь ложится по-разному или его нет, звёзд то больше, то меньше, туманностей 0–3', () => {
    const looks = Array.from({ length: 60 }, (_, i) => skyLook(1000 + i * 7919));
    const angles = looks.flatMap((l) => (l.band ? [l.band.angle] : []));
    expect(looks.some((l) => l.band === null)).toBe(true);
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(2);
    const fars = looks.map((l) => l.far);
    expect(Math.max(...fars) - Math.min(...fars)).toBeGreaterThan(SKY_FAR * 0.15);
    const counts = new Set(looks.map((l) => l.nebulae.length));
    for (const n of [0, 1, 2]) expect(counts.has(n), `туманностей ${n}`).toBe(true);
    const hues = new Set(looks.flatMap((l) => l.nebulae.map((n) => n.hue)));
    expect(hues.size).toBe(NEBULA_HUES);
    const warm = looks.map((l) => l.warm);
    expect(Math.max(...warm) - Math.min(...warm)).toBeGreaterThan(0.15);
  });

  it('все точки в поле неба; лишние звёзды и пустые места туманностей погашены; туманность — своего рода и оттенка', () => {
    for (const seed of [1, 2, 99, 20041113]) {
      const [p, s] = buffers();
      const look = fillSky(seed, p, s);
      for (let i = 0; i < SKY_FAR + SKY_NEAR + SKY_NEBULA; i++) {
        expect(Math.abs(p[i * 3]!)).toBeLessThanOrEqual(1);
        expect(p[i * 3 + 1]!).toBeGreaterThanOrEqual(0);
        expect(p[i * 3 + 1]!).toBeLessThanOrEqual(1);
        expect(Math.abs(p[i * 3 + 2]!)).toBeLessThanOrEqual(1);
      }
      let lit = 0;
      for (let i = 0; i < SKY_FAR; i++) if (s[i * 4]! > 0) lit += 1;
      expect(lit).toBe(look.far);
      const nebula = look.nebulae.reduce((n, x) => n + x.count, 0);
      expect(nebula).toBeLessThanOrEqual(SKY_NEBULA);
      let glowing = 0;
      for (let i = SKY_FAR + SKY_NEAR; i < SKY_FAR + SKY_NEAR + SKY_NEBULA; i++) {
        expect(s[i * 4 + 3]).toBe(STAR_KIND.nebula);
        if (s[i * 4]! > 0) {
          glowing += 1;
          // Туманность тусклая и крупная: она светит облаком, а не звездой.
          expect(s[i * 4]!).toBeLessThan(0.05);
          expect(s[i * 4 + 1]!).toBeGreaterThanOrEqual(11);
          expect(Math.floor(s[i * 4 + 2]! * 8)).toBeLessThan(NEBULA_HUES);
        }
      }
      expect(glowing).toBe(nebula);
      // Падающие на месте: три по срокам и одна по знаку игры.
      const tail = SKY_FAR + SKY_NEAR + SKY_NEBULA;
      expect([0, 1, 2, 3].map((k) => s[(tail + k * 16) * 4 + 3])).toEqual([2, 3, 4, 5]);
    }
  });

  it('полоса — полоса: звёзды млечного пути лежат вдоль одной прямой', () => {
    const seed = [...Array(50).keys()].map((i) => 5000 + i).find((x) => (skyLook(x).band?.share ?? 0) > 0.4 && (skyLook(x).band?.width ?? 1) < 0.1)!;
    const look = skyLook(seed);
    const [p, s] = buffers();
    fillSky(seed, p, s);
    const c = Math.cos(look.band!.angle);
    const sn = Math.sin(look.band!.angle);
    // Расстояние до прямой полосы (с учётом того, что поле повторяется): у звёзд полосы оно мало, у остальных — любое.
    let near = 0;
    for (let i = 0; i < look.far; i++) {
      const d = Math.abs(-p[i * 3]! * sn + p[i * 3 + 2]! * c);
      if (d < 0.15) near += 1;
    }
    // Без полосы у прямой лежала бы примерно седьмая часть звёзд, с полосой — заметно больше.
    expect(near / look.far).toBeGreaterThan(0.3);
  });
});
