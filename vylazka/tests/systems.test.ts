import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/core/rng';
import { STORAGE_PREFIX, WebPlainPlatform } from '../src/platform/web_plain';
import { Lifecycle } from '../src/lifecycle';
import { AutoExposure, beamAtten } from '../src/render/exposure';
import { bakeDetail, DETAIL, DETAIL_LAYERS } from '../src/render/detail';
import { bakeGrime } from '../src/render/grime';
import { ATLAS_COLS, ATLAS_ROWS, bakeMatcapAtlas } from '../src/render/matcap_atlas';
import { internalSize, QUALITY, verticalFov } from '../src/render/renderer';
import { CALM_ENV, DEFAULT_FLASHLIGHT, Flashlight } from '../src/systems/flashlight';
import { recTimestamp } from '../src/ui/hud';
import { DECAY, MAT, MAT_COUNT, MAT_DEFS } from '../src/world/materials';

const DT = 1 / 60;

describe('фонарь', () => {
  it('первый отказ приходит в заданное время: сначала мерцание, потом темнота', () => {
    const f = new Flashlight(mulberry32(1), { ...DEFAULT_FLASHLIGHT, firstFailAt: 5 });
    let failedAt = -1;
    let dipped = false;
    for (let i = 0; i < 600; i++) {
      const ev = f.update(DT, CALM_ENV);
      if (i * DT > 5 && f.state === 'on' && f.intensity < 0.6) dipped = true;
      if (ev.failed) {
        failedAt = i * DT;
        break;
      }
    }
    expect(failedAt).toBeGreaterThan(5.4);
    expect(failedAt).toBeLessThan(6.6);
    expect(dipped).toBe(true);
    expect(f.state).toBe('dead');
    f.update(DT, CALM_ENV);
    expect(f.intensity).toBe(0);
  });

  it('заглохший фонарь оживает только от тряски, вялая тряска помогает хуже', () => {
    const timeToRevive = (shake: number): number => {
      const f = new Flashlight(mulberry32(7));
      f.forceFail();
      for (let i = 0; i < 60 * 30; i++) if (f.update(DT, { ...CALM_ENV, shake }).revived) return i * DT;
      return Infinity;
    };
    expect(timeToRevive(0)).toBe(Infinity);
    const fast = timeToRevive(1);
    const slow = timeToRevive(0.4);
    expect(fast).toBeGreaterThanOrEqual(DEFAULT_FLASHLIGHT.reviveNeed[0] - 0.05);
    expect(fast).toBeLessThanOrEqual(DEFAULT_FLASHLIGHT.reviveNeed[1] + 0.05);
    expect(slow).toBeGreaterThan(fast * 2.5);
  });

  it('прогресс оживления растёт, искры и дребезг идут только при тряске', () => {
    const f = new Flashlight(mulberry32(3));
    f.forceFail();
    let sparks = 0;
    let rattle = 0;
    let last = 0;
    for (let i = 0; i < 30; i++) {
      const ev = f.update(DT, { ...CALM_ENV, shake: 0.8 });
      if (ev.spark) sparks += 1;
      rattle = Math.max(rattle, ev.rattle);
      expect(f.reviveProgress).toBeGreaterThanOrEqual(last);
      last = f.reviveProgress;
    }
    expect(rattle).toBeCloseTo(0.8);
    expect(sparks).toBeGreaterThan(0);
    const quiet = new Flashlight(mulberry32(3));
    quiet.forceFail();
    for (let i = 0; i < 120; i++) {
      const ev = quiet.update(DT, CALM_ENV);
      expect(ev.spark).toBe(false);
      expect(ev.rattle).toBe(0);
    }
  });

  it('после оживления есть передышка без отказов', () => {
    const f = new Flashlight(mulberry32(11), { ...DEFAULT_FLASHLIGHT, meanFailInterval: 0.01, graceAfterRevive: 8 });
    f.forceFail();
    while (f.state === 'dead') f.update(DT, { ...CALM_ENV, shake: 1 });
    let t = 0;
    while (f.state === 'on' && t < 30) {
      f.update(DT, CALM_ENV);
      t += DT;
    }
    expect(t).toBeGreaterThan(8);
    expect(t).toBeLessThan(11);
  });

  it('отказы чаще при низком заряде, в сырости, в панике и рядом с роем', () => {
    const f = new Flashlight(mulberry32(1));
    const base = f.hazard(CALM_ENV);
    expect(f.hazard({ ...CALM_ENV, wet: 1 })).toBeGreaterThan(base * 2.5);
    expect(f.hazard({ ...CALM_ENV, panic: 1 })).toBeGreaterThan(base * 2);
    expect(f.hazard({ ...CALM_ENV, swarm: 1 })).toBeGreaterThan(base * 6);
    f.charge = 0.1;
    expect(f.hazard(CALM_ENV)).toBeGreaterThan(base * 2.5);
  });

  it('кнопка выключает и включает; у севшей батарейки свет не вернуть', () => {
    const f = new Flashlight(mulberry32(1));
    f.toggle();
    f.update(DT);
    expect(f.state).toBe('off');
    expect(f.intensity).toBe(0);
    f.toggle();
    f.update(DT);
    expect(f.state).toBe('on');
    expect(f.intensity).toBeGreaterThan(0.5);
    f.charge = 0.00001;
    const ev = f.update(DT);
    expect(ev.failed).toBe(true);
    for (let i = 0; i < 600; i++) f.update(DT, { ...CALM_ENV, shake: 1 });
    expect(f.state).toBe('dead');
  });

  it('один сид — одна и та же история', () => {
    const play = (): string => {
      const f = new Flashlight(mulberry32(99), { ...DEFAULT_FLASHLIGHT, meanFailInterval: 5, graceAfterRevive: 1 });
      const log: number[] = [];
      for (let i = 0; i < 3000; i++) {
        const ev = f.update(DT, { ...CALM_ENV, shake: f.state === 'dead' ? 1 : 0 });
        if (ev.failed || ev.revived) log.push(i);
      }
      return log.join(',');
    };
    expect(play()).toBe(play());
    expect(play().split(',').length).toBeGreaterThan(4);
  });
});

describe('экспозиция', () => {
  it('близкая стена — усиление у нижней границы; даль при горящем фонаре — не выше «светлого» предела', () => {
    const e = new AutoExposure();
    expect(e.target(beamAtten(1), 1)).toBe(0.8);
    expect(e.target(beamAtten(25), 1)).toBe(2.1);
    expect(e.target(0, 0)).toBe(5.5);
  });

  it('темнеет быстро, светлеет медленно; шум растёт с усилением', () => {
    const e = new AutoExposure();
    e.gain = 1;
    for (let i = 0; i < 30; i++) e.update(DT, 0, 0);
    const up = e.gain - 1;
    const noiseDark = e.noise();
    e.gain = 5.5;
    for (let i = 0; i < 30; i++) e.update(DT, 1, 1);
    const down = 5.5 - e.gain;
    expect(down).toBeGreaterThan(up * 2);
    expect(noiseDark).toBeGreaterThan(new AutoExposure().noise() * 0.5);
  });
});

describe('запечённые текстуры', () => {
  const atlas = bakeMatcapAtlas(MAT_DEFS, 32);

  it('атлас детерминирован и нужного размера: 8×5 шаров', () => {
    expect(atlas.width).toBe(256);
    expect(atlas.height).toBe(160);
    expect(atlas.data.length).toBe(256 * 160 * 4);
    expect(bakeMatcapAtlas(MAT_DEFS, 32).data).toEqual(atlas.data);
    expect(MAT_DEFS.length).toBe(MAT_COUNT);
    expect(ATLAS_COLS * ATLAS_ROWS).toBeGreaterThanOrEqual(MAT_COUNT);
  });

  it('шар светлее в центре, чем у края; у гладкого материала блик ярче', () => {
    const at = (mat: number, px: number, py: number): number => {
      const o = ((Math.floor(mat / 8) * 32 + py) * 256 + (mat % 8) * 32 + px) * 4;
      return atlas.data[o]! + atlas.data[o + 1]! + atlas.data[o + 2]!;
    };
    for (let m = 0; m < MAT_COUNT; m++) expect(at(m, 16, 16), MAT_DEFS[m]!.name).toBeGreaterThan(at(m, 30, 16));
    // Эмаль бликует сильнее побелки, хотя альбедо у них близкое.
    expect(at(MAT.enamel, 16, 16) / at(MAT.enamel, 22, 16)).toBeGreaterThan(at(MAT.plaster, 16, 16) / at(MAT.plaster, 22, 16));
    // Стекло тёмное, но блик на нём — до белого.
    expect(at(MAT.glass, 16, 16)).toBeGreaterThan(600);
    expect(at(MAT.glass, 24, 16)).toBeLessThan(at(MAT.glass, 16, 16) / 3);
    expect(atlas.data.every((v, i) => i % 4 !== 3 || v === 255)).toBe(true);
  });

  it('у каждого материала есть слой фактуры, а проступающий материал существует', () => {
    for (const d of MAT_DEFS) {
      expect(d.layer, d.name).toBeGreaterThanOrEqual(0);
      expect(d.layer, d.name).toBeLessThan(DETAIL_LAYERS);
      expect(d.tile, d.name).toBeGreaterThan(0.1);
      expect(d.bump, d.name).toBeLessThanOrEqual(0.03);
      if (d.alt !== undefined) expect(MAT_DEFS[d.alt], d.name).toBeDefined();
      // Краска и металл без «изнанки» не могут ни облезть, ни заржаветь.
      if (d.decay === DECAY.paint || d.decay === DECAY.metal) expect(d.alt, d.name).toBeDefined();
    }
    // Номера слоёв в материалах и в стопке фактур — одни и те же.
    expect(MAT_DEFS[MAT.concrete]!.layer).toBe(DETAIL.concrete);
    expect(MAT_DEFS[MAT.paintGreen]!.layer).toBe(DETAIL.paint);
    expect(MAT_DEFS[MAT.brick]!.layer).toBe(DETAIL.brick);
    expect(MAT_DEFS[MAT.zinc]!.layer).toBe(DETAIL.zinc);
    expect(MAT_DEFS[MAT.tile]!.layer).toBe(DETAIL.tile);
  });

  it('у домашних материалов свой слой фактуры и свой шар в атласе', () => {
    const home = [
      [MAT.wallpaper, DETAIL.wallpaper],
      [MAT.parquet, DETAIL.parquet],
      [MAT.linoleum, DETAIL.linoleum],
      [MAT.veneer, DETAIL.veneer],
      [MAT.upholstery, DETAIL.upholstery],
    ] as const;
    expect(new Set(home.map(([, l]) => l)).size).toBe(home.length);
    const cell = 32;
    for (const [m, layer] of home) {
      expect(MAT_DEFS[m]!.layer, MAT_DEFS[m]!.name).toBe(layer);
      expect(m, MAT_DEFS[m]!.name).toBeLessThan(ATLAS_COLS * ATLAS_ROWS);
      // Шар записан: в его ячейке есть непустые пикселы (атлас — sRGB, чёрное — нули).
      let sum = 0;
      const x0 = (m % ATLAS_COLS) * cell;
      const y0 = Math.floor(m / ATLAS_COLS) * cell;
      for (let py = 0; py < cell; py++) for (let px = 0; px < cell; px++) sum += atlas.data[((y0 + py) * atlas.width + x0 + px) * 4]!;
      expect(sum, MAT_DEFS[m]!.name).toBeGreaterThan(cell * cell * 8);
    }
    // Обои обдираются до штукатурки, как краска.
    expect(MAT_DEFS[MAT.wallpaper]!.decay).toBe(DECAY.paint);
    expect(MAT_DEFS[MAT.wallpaper]!.alt).toBe(MAT.plaster);
  });

  it('фактуры детерминированы, бесшовны и не вырождаются в ровный серый', () => {
    const size = 64;
    const d = bakeDetail(size);
    expect(d.layers).toBe(DETAIL_LAYERS);
    expect(d.data.length).toBe(size * size * 4 * DETAIL_LAYERS);
    expect(bakeDetail(size).data).toEqual(d.data);
    for (let l = 0; l < DETAIL_LAYERS; l++) {
      const base = l * size * size * 4;
      let lo = 255;
      let hi = 0;
      let jump = 0;
      let inner = 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const h = d.data[base + (y * size + x) * 4]!;
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
        const left = d.data[base + (y * size) * 4]!;
        const right = d.data[base + (y * size + size - 1) * 4]!;
        jump += Math.abs(left - right);
        inner += Math.abs(left - d.data[base + (y * size + 1) * 4]!);
      }
      // Рельеф есть: высота гуляет хотя бы на десятую долю диапазона.
      expect(hi - lo, `слой ${l}`).toBeGreaterThan(25);
      // Шов на стыке повторов не грубее обычного перепада между соседними точками (с запасом).
      expect(jump, `слой ${l}`).toBeLessThanOrEqual(inner * 3 + size * 4);
    }
  });

  it('грязь тайлится: края совпадают с противоположными с точностью до шага шума', () => {
    const size = 64;
    const g = bakeGrime(size, 7);
    expect(bakeGrime(size, 7)).toEqual(g);
    let maxJump = 0;
    let maxInner = 0;
    for (let y = 0; y < size; y++) {
      const left = g[(y * size + 0) * 4]!;
      const right = g[(y * size + size - 1) * 4]!;
      const inner = g[(y * size + 1) * 4]!;
      maxJump = Math.max(maxJump, Math.abs(left - right));
      maxInner = Math.max(maxInner, Math.abs(left - inner));
    }
    expect(maxJump).toBeLessThanOrEqual(maxInner * 2 + 12);
  });
});

describe('рендер: чистые функции', () => {
  it('внутренний размер держит соотношение сторон, бюджет и чётность', () => {
    for (const [w, h] of [
      [1280, 720],
      [360, 640],
      [915, 412],
      [2560, 1440],
      [800, 800],
    ] as const) {
      for (const q of ['low', 'med', 'high'] as const) {
        const [iw, ih] = internalSize(w, h, QUALITY[q].pixels, 3);
        expect(iw % 2).toBe(0);
        expect(ih % 2).toBe(0);
        expect(iw * ih).toBeLessThanOrEqual(QUALITY[q].pixels * 1.02);
        expect(Math.abs(iw / ih - w / h)).toBeLessThan(0.02);
      }
    }
    // Маленький экран: не больше физических пикселей.
    expect(internalSize(320, 180, QUALITY.high.pixels, 1)).toEqual([320, 180]);
  });

  it('угол обзора: широкий в ландшафте, ограничен в портрете и квадрате', () => {
    expect(verticalFov(16 / 9)).toBeGreaterThan(70);
    expect(verticalFov(16 / 9)).toBeLessThan(76);
    expect(verticalFov(1)).toBe(96);
    expect(verticalFov(9 / 16)).toBe(96);
    expect(verticalFov(3)).toBe(62);
  });
});

describe('обвязка', () => {
  it('пауза складывается из причин', () => {
    const l = new Lifecycle();
    const log: boolean[] = [];
    l.onChange((p) => log.push(p));
    l.set('hidden', true);
    l.set('user', true);
    l.set('hidden', false);
    expect(l.paused).toBe(true);
    l.set('user', false);
    expect(l.paused).toBe(false);
    expect(log).toEqual([true, false]);
  });

  it('web-plain: пакетное сохранение и чтение, свой префикс, язык браузера', async () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) } as unknown as Storage;
    const p = new WebPlainPlatform({ storage, languages: ['de-DE', 'ru-RU'], simulateRewarded: false, coarsePointer: true });
    await p.save(['profile', 'settings'], [{ finds: 3 }, { q: 'low' }]);
    expect([...mem.keys()].every((k) => k.startsWith(STORAGE_PREFIX))).toBe(true);
    expect(STORAGE_PREFIX).toBe('vylazka:');
    expect(await p.load(['settings', 'nope', 'profile'])).toEqual([{ q: 'low' }, null, { finds: 3 }]);
    expect(p.language()).toBe('ru');
    expect(p.deviceType()).toBe('mobile');
    expect(await p.showRewarded()).toBe(false);
    const noStore = new WebPlainPlatform({ storage: null, languages: ['fr'], coarsePointer: false });
    await noStore.save(['a'], [1]);
    expect(await noStore.load(['a'])).toEqual([1]);
    expect(noStore.language()).toBe('en');
    expect(noStore.deviceType()).toBe('desktop');
  });

  it('время записи идёт от 23:41:07 и переходит через полночь', () => {
    expect(recTimestamp(0)).toBe('2004-11-13 23:41:07');
    expect(recTimestamp(59.9)).toBe('2004-11-13 23:42:06');
    expect(recTimestamp(20 * 60)).toBe('2004-11-14 00:01:07');
  });
});
