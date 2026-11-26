import { describe, expect, it } from 'vitest';
import { DOT_GRID, dotGrid } from '../src/render/renderer';

/**
 * Пыль выросшей вещи (куратор, 429): решётка в мире, шаг 1 / dotGrid м. В кадре 720 строк — мелкая пыль, как просил партнёр
 * (4,5 см); в низком кадре пылинка не мельче пикселя на трёх метрах, иначе мерцает и пропадает, и вещь исчезает без пыли.
 */
describe('решётка пыли выросшей вещи', () => {
  const tanY = Math.tan((75 * Math.PI) / 360);
  // Сколько строк кадра занимает пылинка (точка ~0,3 клетки при полном росте) на расстоянии d при высоте кадра rows.
  const px = (rows: number, d: number): number => ((0.3 / dotGrid(rows)) * rows) / (2 * d * tanY);

  it('в кадре 720 строк и выше — мелкая пыль, 22 клетки на метр', () => {
    expect(dotGrid(720)).toBe(DOT_GRID.max);
    expect(dotGrid(1440)).toBe(DOT_GRID.max);
  });

  it('в низком кадре клетка крупнее, но не крупнее 11 см', () => {
    expect(dotGrid(360)).toBeLessThan(DOT_GRID.max);
    expect(dotGrid(200)).toBe(DOT_GRID.min);
    expect(1 / DOT_GRID.min).toBeLessThan(0.115);
  });

  it('на трёх метрах пылинка — не меньше двух строк на любом кадре от 360 строк (прежде в низком — одна)', () => {
    for (const rows of [360, 405, 540, 720, 1080]) expect(px(rows, 3)).toBeGreaterThanOrEqual(2);
  });
});
