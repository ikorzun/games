import { describe, expect, it } from 'vitest';
import { FrameMeter, frameStats } from '../src/ui/measure';

describe('замер 30 с: средняя частота и «1 % худших»', () => {
  it('ровные кадры: средняя и «1 % худших» совпадают', () => {
    const s = frameStats(Array.from({ length: 600 }, () => 20));
    expect(s.frames).toBe(600);
    expect(s.seconds).toBeCloseTo(12, 9);
    expect(s.avg).toBeCloseTo(50, 9);
    expect(s.low1).toBeCloseTo(50, 9);
  });

  it('средняя — кадров за время, а не среднее частот; «1 %» — самый медленный процент кадров', () => {
    // 990 кадров по 16 мс и 10 по 100 мс: процент худших — ровно эти десять.
    const ms = [...Array.from({ length: 990 }, () => 16), ...Array.from({ length: 10 }, () => 100)];
    const s = frameStats(ms);
    expect(s.avg).toBeCloseTo((1000 * 1000) / (990 * 16 + 10 * 100), 9);
    expect(s.low1).toBeCloseTo(10, 9);
    // Порядок кадров не важен.
    expect(frameStats([...ms].reverse())).toEqual(s);
  });

  it('кадров меньше сотни — «1 %» берёт хотя бы один, самый медленный; процент округляется вверх', () => {
    expect(frameStats([10, 10, 40, 10]).low1).toBeCloseTo(25, 9);
    // 150 кадров: худших — два (1,5 → 2).
    const ms = [...Array.from({ length: 148 }, () => 10), 50, 30];
    expect(frameStats(ms).low1).toBeCloseTo(1000 / 40, 9);
  });

  it('пусто и мусор — нули, не NaN', () => {
    expect(frameStats([])).toEqual({ frames: 0, seconds: 0, avg: 0, low1: 0 });
    expect(frameStats([0, -5, Number.NaN, Infinity])).toEqual({ frames: 0, seconds: 0, avg: 0, low1: 0 });
  });

  it('счётчик: итог — один раз, когда набралось 30 с игры; остановка страницы не в счёт; нагрузка — средняя', () => {
    const m = new FrameMeter(30);
    expect(m.frame(16)).toBeNull();
    expect(m.running).toBe(false);
    m.start();
    m.load(100, 200_000);
    m.load(120, 220_000);
    let out = null;
    let n = 0;
    // Шесть секунд стояла вкладка: такой кадр — не заминка, его не считают.
    expect(m.frame(6000)).toBeNull();
    while (!out && n < 10_000) {
      out = m.frame(25);
      n++;
    }
    expect(n).toBe(1200);
    expect(m.running).toBe(false);
    expect(out!.avg).toBeCloseTo(40, 9);
    expect(out!.calls).toBeCloseTo(110, 9);
    expect(out!.triangles).toBeCloseTo(210_000, 6);
    expect(m.frame(25), 'после итога кадры не идут').toBeNull();
    expect(m.left).toBe(0);
    // Начать снова — с нуля.
    m.start();
    expect(m.left).toBe(30);
  });
});
