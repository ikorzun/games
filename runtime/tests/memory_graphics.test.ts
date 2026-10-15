// @vitest-environment jsdom
/**
 * Графика «Воспоминания» (решение владельца 2026-10-13): настройка, выбор файлов в каталоге (16:9, квадрат на
 * вертикальном экране, маски к каждому, запасной кадр «Реализма»), растворение точками по матрице Байера.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, GRAPHICS_MODES, sanitizeSettings } from '../src/core/settings';
import { AssetCatalog } from '../src/stage/assets';
import { bayer8, DITHER_FRAGMENT, DITHER_MS } from '../src/stage/dither_filter';
import { miniEpisode } from './helpers/mini';

describe('настройка «Графика»: реализм / воспоминания', () => {
  it('по умолчанию «Воспоминания» (2026-10-13); выбор игрока в настройках версии 2 сохраняется; неизвестное — к умолчанию', () => {
    expect([...GRAPHICS_MODES]).toEqual(['real', 'memory']);
    expect(DEFAULT_SETTINGS.graphics).toBe('memory');
    expect(sanitizeSettings({ v: 2, graphics: 'real' }).graphics).toBe('real');
    expect(sanitizeSettings({ v: 2, graphics: 'memory' }).graphics).toBe('memory');
    for (const bad of ['Memory', 'real ', '', 1, null, {}] as unknown[]) expect(sanitizeSettings({ v: 2, graphics: bad }).graphics).toBe('memory');
    expect(sanitizeSettings({ fontScale: 1.2 }).graphics).toBe('memory');
  });

  it('версия 3: музыка по умолчанию вдвое тише звуков; нетронутое прежнее умолчание 0,7 — тоже 0,4, выбор игрока — его', () => {
    expect(sanitizeSettings({})).toMatchObject({ music: 0.4, sfx: 0.8, v: 3 });
    expect(sanitizeSettings({ v: 2, music: 0.7 }).music).toBe(0.4);
    expect(sanitizeSettings({ v: 2, music: 0.55 }).music).toBe(0.55);
    expect(sanitizeSettings({ v: 3, music: 0.7 }).music).toBe(0.7); // после обновления 0,7 — уже выбор игрока
  });

  it('сохранённые до версии 2: «Реализм» был прежним умолчанием — получают «Воспоминания»; остальное не трогаем', () => {
    const old = sanitizeSettings({ graphics: 'real', fontScale: 1.25, cameraFx: 'off' });
    expect(old).toMatchObject({ graphics: 'memory', fontScale: 1.25, cameraFx: 'off', v: 3 });
    // Выбор после обновления переживает перезапуск (повторная чистка того, что записали).
    expect(sanitizeSettings({ ...old, graphics: 'real' }).graphics).toBe('real');
  });
});

describe('каталог: кадры «Воспоминаний»', () => {
  const ep = miniEpisode({ s1: { steps: [{ do: 'end', ending: 'e_main' }] } });
  ep.assets = {
    ...ep.assets,
    backgrounds: [
      { id: 'bg_room', path: 'assets/x/room.webp', memory: 'assets/m/room.webp' },
      { id: 'bg_plain', path: 'assets/x/plain.webp' },
      { id: 'bg_wide', path: 'assets/x/wide_bg.webp', memory: 'assets/m/wide.webp' }, // фон — тот же файл, что общий план
    ],
    shots: [
      {
        id: 'sh_full', set: 'room', bg: 'bg_room', kind: 'wide', angle: 'eye', file: 'assets/x/wide.webp',
        cast: [{ who: 'a', mask: 'assets/x/wide.a.webp' }],
        memory: { file: 'assets/m/wide.webp', square: 'assets/m/wide.square.webp', masks: { a: 'assets/m/wide.a.webp' }, square_masks: { a: 'assets/m/wide.square.a.webp' }, video: 'assets/m/wide.mp4' },
      },
      { id: 'sh_wide_only', set: 'room', bg: 'bg_room', kind: 'ots', angle: 'eye', file: 'assets/x/ots.webp', cast: [{ who: 'a' }], memory: { file: 'assets/m/ots.webp', video: 'assets/m/ots.mp4', video_loop: true } },
      { id: 'sh_real', set: 'room', bg: 'bg_room', kind: 'wide', angle: 'eye', file: 'assets/x/real.webp', video: 'assets/x/real.mp4', video_loop: true, cast: [{ who: 'a', mask: 'assets/x/real.a.webp' }] },
    ],
  };
  const urls = (c: { urls: readonly string[] } | null): readonly string[] | undefined => c?.urls;

  it('«Реализм»: прежние файлы и маски, квадратов нет; ролик — только свой, не «Воспоминаний»', () => {
    const cat = new AssetCatalog(ep, './');
    expect(urls(cat.shotChain('sh_full'))).toEqual(['./assets/x/wide.webp']);
    expect(urls(cat.shotMask('sh_full', 'a'))).toEqual(['./assets/x/wide.a.webp']);
    expect(urls(cat.bgChain('bg_room'))).toEqual(['./assets/x/room.webp']);
    expect(cat.shotIsSquare('sh_full')).toBe(false);
    expect(cat.shotVideo('sh_full')).toBeNull(); // у кадра только ролик «Воспоминаний»
    expect(cat.shotVideo('sh_real')).toEqual({ url: './assets/x/real.mp4', loop: true }); // свой ролик «Реализма»
  });

  it('«Воспоминания», горизонталь: кадр 16:9, его маски и ролик; реалистичный кадр — запасным вторым в цепочке', () => {
    const cat = new AssetCatalog(ep, './');
    cat.setGraphics({ memory: true, square: false });
    expect(urls(cat.shotChain('sh_full'))).toEqual(['./assets/m/wide.webp', './assets/x/wide.webp']);
    expect(urls(cat.shotMask('sh_full', 'a'))).toEqual(['./assets/m/wide.a.webp']);
    expect(urls(cat.bgChain('bg_room'))).toEqual(['./assets/m/room.webp', './assets/x/room.webp']);
    expect(urls(cat.bgChain('bg_plain'))).toEqual(['./assets/x/plain.webp']);
    expect(urls(cat.bgChain('bg_wide'))).toEqual(['./assets/m/wide.webp', './assets/x/wide_bg.webp']); // горизонталь — 16:9
    expect(urls(cat.shotChain('sh_real'))).toEqual(['./assets/x/real.webp']); // у кадра нет «воспоминаний»
    expect(urls(cat.shotMask('sh_real', 'a'))).toEqual(['./assets/x/real.a.webp']);
    expect(cat.shotIsSquare('sh_full')).toBe(false);
    expect(cat.shotVideo('sh_full')).toEqual({ url: './assets/m/wide.mp4', loop: false }); // один раз и замирает
    expect(cat.shotVideo('sh_wide_only')).toEqual({ url: './assets/m/ots.mp4', loop: true });
    expect(cat.shotVideo('sh_real')).toEqual({ url: './assets/x/real.mp4', loop: true }); // «воспоминаний» нет — показан кадр «Реализма» и его ролик
    expect(urls(cat.shotChain('sh_full'))).not.toContain('./assets/m/wide.mp4'); // ролик не идёт в цепочку картинок (их грузит предзагрузчик)
  });

  it('«Воспоминания», вертикаль: квадрат и его маски там, где квадрат есть; без квадрата — кадр 16:9 и его ролик', () => {
    const cat = new AssetCatalog(ep, './');
    cat.setGraphics({ memory: true, square: true });
    expect(urls(cat.shotChain('sh_full'))).toEqual(['./assets/m/wide.square.webp', './assets/x/wide.webp']);
    expect(urls(cat.shotMask('sh_full', 'a'))).toEqual(['./assets/m/wide.square.a.webp']);
    expect(cat.shotIsSquare('sh_full')).toBe(true);
    expect(urls(cat.shotChain('sh_wide_only'))).toEqual(['./assets/m/ots.webp', './assets/x/ots.webp']);
    expect(cat.shotIsSquare('sh_wide_only')).toBe(false);
    expect(cat.shotMask('sh_wide_only', 'a')).toBeNull(); // масок у «воспоминаний» этого кадра нет — без подсветки
    expect(cat.shotVideo('sh_full')).toBeNull(); // ролик 16:9 квадрат не заменяет
    expect(cat.shotVideo('sh_wide_only')).toEqual({ url: './assets/m/ots.mp4', loop: true });
    // Фон сцены — тот же файл, что её общий план: на вертикальном экране сразу квадрат, 16:9 — только запасным.
    expect(urls(cat.bgChain('bg_wide'))).toEqual(['./assets/m/wide.square.webp', './assets/m/wide.webp', './assets/x/wide_bg.webp']);
    expect(urls(cat.bgChain('bg_room'))).toEqual(['./assets/m/room.webp', './assets/x/room.webp']); // квадрата нет
  });
});

describe('растворение точками: матрица Байера 8×8', () => {
  it('64 разных порога 0…63, первая строка — каноническая; узор повторяется через 8 клеток', () => {
    const all = new Set<number>();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) all.add(bayer8(x, y));
    expect(all.size).toBe(64);
    expect(Math.min(...all)).toBe(0);
    expect(Math.max(...all)).toBe(63);
    expect(Array.from({ length: 8 }, (_, x) => bayer8(x, 0))).toEqual([0, 32, 8, 40, 2, 34, 10, 42]);
    expect(bayer8(11, 13)).toBe(bayer8(3, 5));
  });

  it('шейдер считает ту же матрицу дробной арифметикой, без побитовых операций (Pixi собирает GLSL ES 1.00)', () => {
    const fract = (v: number): number => v - Math.floor(v);
    const b2 = (x: number, y: number): number => fract((Math.floor(x) % 2) * 0.5 + (Math.floor(y) % 2) * 0.75);
    const b4 = (x: number, y: number): number => b2(x / 2, y / 2) * 0.25 + b2(x, y);
    const b8 = (x: number, y: number): number => b4(x / 2, y / 2) * 0.25 + b2(x, y);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) expect(b8(x + 0.5, y + 0.5) * 64).toBe(bayer8(x, y));
    expect(DITHER_FRAGMENT).not.toMatch(/<<|>>|\^|ivec|#version/);
  });

  it('быстрый: меньше секунды («быстрее и интереснее» — владелец, 2026-10-13)', () => {
    expect(DITHER_MS).toBeGreaterThanOrEqual(500);
    expect(DITHER_MS).toBeLessThan(1000);
  });
});
