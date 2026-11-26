import { describe, expect, it } from 'vitest';
import { DEFAULT_FLOW, Flow } from '../src/systems/flow';

const DT = 1 / 60;
const run = (f: Flow, seconds: number, speed: number): { wdt: number; tore: number } => {
  let wdt = 0;
  let tore = 0;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const r = f.update(DT, speed);
    wdt += r.wdt;
    tore = Math.max(tore, r.tore);
  }
  return { wdt, tore };
};

describe('зал ожидания: ход времени', () => {
  it('пока игрок идёт, время места идёт в полную силу и он видит место, а не снимок', () => {
    const f = new Flow(7);
    run(f, 2, 1.6);
    expect(f.f).toBeGreaterThan(0.97);
    expect(f.frozen).toBe(false);
    const { wdt } = run(f, 10, 1.6);
    expect(wdt).toBeGreaterThan(9.8);
    expect(f.viewT).toBeCloseTo(f.t, 6);
  });

  it('остановился — виден снимок: время на нём стоит, а под ним идёт втрое медленнее', () => {
    const f = new Flow(7);
    run(f, 3, 1.6);
    run(f, 3, 0);
    expect(f.frozen).toBe(true);
    const view = f.viewT;
    const t0 = f.t;
    const { wdt } = run(f, 5, 0);
    expect(f.viewT).toBe(view);
    expect(wdt).toBeCloseTo(5 * DEFAULT_FLOW.idle, 1);
    expect(f.t - t0).toBeCloseTo(wdt, 6);
    // Повороты головы времени не двигают: скорость по полу — ноль.
    expect(f.f).toBe(0);
  });

  it('время не обрывается, а сходит на нет и разгоняется: шаг начинается и кончается в замедлении', () => {
    const f = new Flow(7);
    run(f, 3, 1.6);
    f.update(DT, 0);
    expect(f.f).toBeLessThan(1);
    expect(f.f).toBeGreaterThan(0.9);
    run(f, 0.3, 0);
    expect(f.f).toBeGreaterThan(0.3);
    expect(f.f).toBeLessThan(0.75);
  });

  it('снимок расходится с местом: сначала держится ровно, потом дрожит, через двенадцать секунд рвётся сам', () => {
    const f = new Flow(7);
    run(f, 3, 1.6);
    run(f, 1.5, 0);
    expect(f.strain).toBe(0);
    run(f, 6, 0);
    expect(f.strain).toBeGreaterThan(0.05);
    expect(f.rattle()).toBeGreaterThan(0);
    const { tore } = run(f, 8, 0);
    expect(tore).toBe(1);
    // Порвался — и сложился заново, с нынешнего места.
    expect(f.frozen).toBe(true);
    expect(f.drift).toBeLessThan(8);
  });

  it('первый шаг рвёт снимок: чем дольше стоял, тем сильнее разрыв', () => {
    const short = new Flow(7);
    run(short, 3, 1.6);
    run(short, 2, 0);
    const a = run(short, 1, 1.6).tore;
    const long = new Flow(7);
    run(long, 3, 1.6);
    run(long, 9, 0);
    const b = run(long, 1, 1.6).tore;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThanOrEqual(1);
    expect(long.frozen).toBe(false);
  });

  it('день: от высокого солнца к темноте за семь минут времени места; ночью зал закрывается', () => {
    const f = new Flow(7);
    const noon = f.sun();
    expect(noon.dir[1]).toBeGreaterThan(0.8);
    expect(noon.ambient).toBeGreaterThan(0.95);
    run(f, DEFAULT_FLOW.day * 0.8, 1.6);
    const dusk = f.sun();
    expect(dusk.dir[1]).toBeLessThan(0.45);
    expect(dusk.ambient).toBeLessThan(0.7);
    expect(dusk.color[2]).toBeLessThan(dusk.color[0] * 0.7);
    expect(f.night).toBe(false);
    run(f, DEFAULT_FLOW.day * 0.25, 1.6);
    expect(f.night).toBe(true);
  });

  it('поезда идут по сиду: раз в минуту-полторы в зале темнеет на три секунды', () => {
    const a = new Flow(11);
    const b = new Flow(11);
    const c = new Flow(12);
    let dark = 0;
    for (let i = 0; i < 200 * 60; i++) {
      a.update(DT, 1.6);
      b.update(DT, 1.6);
      c.update(DT, 1.6);
      if (a.train > 0.5) dark += DT;
    }
    expect(a.trains).toBe(b.trains);
    expect(a.trains).toBeGreaterThanOrEqual(2);
    expect(a.trains).toBeLessThanOrEqual(4);
    expect(dark / a.trains).toBeGreaterThan(1.2);
    expect(dark / a.trains).toBeLessThan(3);
    expect(a.toTrain).not.toBe(c.toTrain);
  });

  it('после ночи день начинается заново: часы на полдень, и поезда снова идут', () => {
    const f = new Flow(11);
    run(f, DEFAULT_FLOW.day + 5, 1.6);
    expect(f.night).toBe(true);
    const before = f.trains;
    expect(before).toBeGreaterThanOrEqual(4);
    f.restart();
    expect(f.night).toBe(false);
    expect(f.day).toBe(0);
    expect(f.days).toBe(1);
    // Счёт поездов не сбрасывается (по нему звук узнаёт о новом поезде), а следующий приходит в срок.
    expect(f.trains).toBe(before);
    expect(f.toTrain).toBeLessThanOrEqual(DEFAULT_FLOW.trainEvery[1]);
    run(f, DEFAULT_FLOW.trainEvery[1] + 1, 1.6);
    expect(f.trains).toBeGreaterThan(before);
  });

  it('часы можно перевести: снимок встаёт на то же время, следующий поезд — через обычный промежуток', () => {
    const f = new Flow(11);
    run(f, 300, 1.6);
    f.seek(120);
    expect(f.t).toBe(120);
    expect(f.viewT).toBe(120);
    expect(f.train).toBe(0);
    expect(f.toTrain).toBeGreaterThanOrEqual(DEFAULT_FLOW.trainEvery[0]);
    expect(f.toTrain).toBeLessThanOrEqual(DEFAULT_FLOW.trainEvery[1]);
  });

  it('стоя зал собран до дальней стены, на ходу — остров вокруг игрока; на ходу угол зрения шире, в тесноте — уже', () => {
    const f = new Flow(7);
    run(f, 4, 0);
    expect(f.scan()[0]).toBeGreaterThan(15);
    expect(f.fov(false)).toBe(1);
    run(f, 3, 1.6);
    expect(f.scan()[0]).toBeLessThan(4);
    expect(f.scan()[1]).toBeLessThan(12);
    expect(f.fov(false)).toBeGreaterThan(1.1);
    expect(f.fov(true)).toBeLessThan(0.95);
    // Собрано только там, куда смотрит герой: на ходу взгляд узок, как луч фонаря; стоя — раскрывается.
    expect(f.gaze()[1]).toBeLessThan(27);
    expect(f.gaze()[0]).toBeLessThan(54);
    run(f, 4, 0);
    expect(f.gaze()[1]).toBeGreaterThan(34);
    expect(f.gaze()[0]).toBeGreaterThan(60);
  });
});
