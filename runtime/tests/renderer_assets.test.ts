// @vitest-environment jsdom
/**
 * DOM-рендерер с настоящими ассетами: картинки вместо плейсхолдеров, фолбэк «выражение → neutral → base»,
 * силуэт (свой файл / тёмный из кадра), плейсхолдер и ровно один warn, когда файла нет, загрузка без
 * мигания плейсхолдером. Pixi-рендерер использует те же цепочки и состояния (проверяется в смоуке в Chromium).
 */
import { describe, expect, it } from 'vitest';
import type { SpriteView } from '../src/core/types';
import { AssetCatalog, AssetStore, StoreSceneAssets } from '../src/stage/assets';
import type { ImageHandle, ImageLoader } from '../src/stage/assets';
import { DomSceneRenderer } from '../src/stage/renderer_dom';
import { SPRITE_FIT, SPRITE_MAX_WIDTH } from '../src/stage/renderer';
import { miniEpisode } from './helpers/mini';

const episode = (() => {
  const ep = miniEpisode({ s1: { steps: [{ do: 'end', ending: 'e_main' }] } });
  ep.cast = [
    { id: 'zoya', name_key: 'n', role: 'victim', sprite_set: 'zoya' },
    { id: 'murashov', name_key: 'n', role: 'criminal', sprite_set: 'murashov' },
    { id: 'clerk', name_key: 'n', role: 'extra', sprite_set: 'clerk' },
    { id: 'ghost', name_key: 'n', role: 'extra' },
  ];
  ep.assets = {
    backgrounds: [
      { id: 'bg_yard', path: 'assets/ep01/bg/yard.webp' },
      { id: 'bg_office', path: 'assets/ep01/bg/office.webp' },
      { id: 'bg_black', path: 'assets/common/bg/black.png' },
    ],
    cg: [{ id: 'cg_door', path: 'assets/ep01/cg/door.webp' }],
    sprites: [
      { id: 'zoya', base: 'assets/ep01/sprites/zoya/base.png', expressions: ['neutral', 'warm', 'worried'] },
      { id: 'murashov', base: 'assets/ep01/sprites/murashov/base.png', expressions: ['neutral', 'smile'], silhouette: true },
      { id: 'clerk', base: 'assets/ep01/sprites/clerk/base.png', expressions: ['neutral'] },
    ],
  };
  return ep;
})();

const handle = (url: string, w = 100, h = 200): ImageHandle => ({ url, image: {} as HTMLImageElement, width: w, height: h });
const sprite = (who: string, expression: string | null, over: Partial<SpriteView> = {}): SpriteView => ({
  who,
  expression,
  pose: null,
  position: 'left',
  silhouette: false,
  ...over,
});
const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

interface Rig {
  r: DomSceneRenderer;
  host: HTMLElement;
  store: AssetStore;
  warns: string[];
  /** Разрешить ожидающую загрузку (для тестов «пока грузится»). */
  release: (url: string, ok?: boolean) => void;
}

async function rig(existing: string[] | 'manual'): Promise<Rig> {
  const warns: string[] = [];
  const have = new Set(existing === 'manual' ? [] : existing);
  const waiting = new Map<string, { ok: () => void; fail: () => void }>();
  const loadImage: ImageLoader = (url) =>
    existing === 'manual'
      ? new Promise<ImageHandle>((resolve, reject) => void waiting.set(url, { ok: () => resolve(handle(url)), fail: () => reject(new Error('404')) }))
      : have.has(url)
        ? Promise.resolve(handle(url))
        : Promise.reject(new Error('404'));
  const store = new AssetStore({ loadImage, warn: (m) => warns.push(m) });
  const r = new DomSceneRenderer(new StoreSceneAssets(new AssetCatalog(episode, './'), store));
  const host = document.createElement('div');
  document.body.appendChild(host);
  await r.mount(host);
  return {
    r,
    host,
    store,
    warns,
    release: (url, ok = true) => {
      const w = waiting.get(url);
      if (!w) throw new Error(`не запрашивали ${url}`);
      if (ok) w.ok();
      else w.fail();
    },
  };
}

const bgEl = (h: HTMLElement): HTMLElement => h.querySelector('.ph-bg') as HTMLElement;
const spriteEl = (h: HTMLElement, who: string): HTMLElement | null => h.querySelector(`.ph-sprite[data-who="${who}"]`);
const imgSrc = (el: Element | null): string => (el?.querySelector('img') as HTMLImageElement | null)?.getAttribute('src') ?? '';

const Z = './assets/ep01/sprites/zoya';
const M = './assets/ep01/sprites/murashov';

describe('DomSceneRenderer: фон и CG из файлов', () => {
  it('файл есть → картинка (data-state=image), подпись плейсхолдера скрыта CSS-состоянием', async () => {
    const { r, host } = await rig(['./assets/ep01/bg/yard.webp']);
    r.setBackground('bg_yard');
    await flush();
    expect(bgEl(host).dataset.state).toBe('image');
    expect(imgSrc(bgEl(host))).toBe('./assets/ep01/bg/yard.webp');
  });

  it('файла нет → плейсхолдер с подписью id и ровно один warn, сколько бы раз ни показывали фон', async () => {
    const { r, host, warns } = await rig([]);
    for (let i = 0; i < 3; i++) {
      r.setBackground('bg_office');
      await flush();
    }
    expect(bgEl(host).dataset.state).toBe('placeholder');
    expect(host.querySelector('.ph-bg .ph-label')?.textContent).toBe('bg_office');
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('./assets/ep01/bg/office.webp');
  });

  it('нет записи в assets (неизвестный id) → плейсхолдер без запросов и без предупреждений загрузки', async () => {
    const { r, host, warns } = await rig([]);
    r.setBackground('bg_unknown');
    await flush();
    expect(bgEl(host).dataset.state).toBe('placeholder');
    expect(warns).toEqual([]);
  });

  it('чёрный фон (bg_black) — сплошной цвет: файл не запрашивается, предупреждения нет', async () => {
    const { r, host, warns, store } = await rig([]);
    r.setBackground('bg_black');
    await flush();
    expect(bgEl(host).dataset.state).toBe('solid');
    expect(bgEl(host).style.getPropertyValue('--solid')).toBe('#000000');
    expect(warns).toEqual([]);
    expect(store.stats().missing).toEqual([]);
  });

  it('пока картинка грузится — не плейсхолдер: первый кадр чёрный (none), при смене фона остаётся прежняя картинка', async () => {
    const { r, host, release } = await rig('manual');
    r.setBackground('bg_yard');
    await flush();
    expect(bgEl(host).dataset.state).toBe('none'); // чёрный кадр, подписи нет
    release('./assets/ep01/bg/yard.webp');
    await flush();
    expect(bgEl(host).dataset.state).toBe('image');
    r.setBackground('bg_office');
    await flush();
    expect(bgEl(host).dataset.state).toBe('image'); // новая ещё грузится — на экране прежняя
    expect(imgSrc(bgEl(host))).toBe('./assets/ep01/bg/yard.webp');
    release('./assets/ep01/bg/office.webp');
    await flush();
    expect(imgSrc(bgEl(host))).toBe('./assets/ep01/bg/office.webp');
  });

  it('запоздавшая загрузка старого фона не затирает новый (быстрая смена)', async () => {
    const { r, host, release } = await rig('manual');
    r.setBackground('bg_yard');
    r.setBackground('bg_office');
    await flush();
    release('./assets/ep01/bg/office.webp');
    await flush();
    release('./assets/ep01/bg/yard.webp');
    await flush();
    expect(imgSrc(bgEl(host))).toBe('./assets/ep01/bg/office.webp');
  });

  it('CG: картинка из файла; нет файла — плейсхолдер; setCg(null) прячет; схематичный режим глушит картинку', async () => {
    const { r, host, warns } = await rig(['./assets/ep01/cg/door.webp']);
    const cg = host.querySelector('.ph-cg') as HTMLElement;
    r.setCg('cg_door');
    await flush();
    expect(cg.hidden).toBe(false);
    expect(cg.dataset.state).toBe('image');
    expect(imgSrc(cg)).toBe('./assets/ep01/cg/door.webp');
    r.setViolenceMode('schematic');
    expect(cg.classList.contains('is-schematic')).toBe(true);
    r.setViolenceMode('full');
    expect(cg.classList.contains('is-schematic')).toBe(false);
    r.setCg(null);
    expect(cg.hidden).toBe(true);
    expect(cg.dataset.state).toBe('none');
    expect(warns).toEqual([]);
    const r2 = await rig([]);
    r2.r.setCg('cg_door');
    await flush();
    expect((r2.host.querySelector('.ph-cg') as HTMLElement).dataset.state).toBe('placeholder');
    expect(r2.warns).toHaveLength(1);
  });
});

describe('DomSceneRenderer: спрайты', () => {
  it('файл выражения есть → <dir>/<expression>.webp', async () => {
    const { r, host } = await rig([`${Z}/warm.webp`, `${Z}/neutral.webp`]);
    r.showSprite(sprite('zoya', 'warm'), false, 'cut');
    await flush();
    const el = spriteEl(host, 'zoya')!;
    expect(el.dataset.state).toBe('image');
    expect(el.classList.contains('has-image')).toBe(true);
    expect(imgSrc(el)).toBe(`${Z}/warm.webp`);
  });

  it('файла выражения нет → neutral.webp; нет и его → base.png; молча (без warn)', async () => {
    const a = await rig([`${Z}/neutral.webp`, `${Z}/base.png`]);
    a.r.showSprite(sprite('zoya', 'worried'), false, 'cut');
    await flush();
    expect(imgSrc(spriteEl(a.host, 'zoya'))).toBe(`${Z}/neutral.webp`);
    expect(a.warns).toEqual([]);
    const b = await rig([`${Z}/base.png`]);
    b.r.showSprite(sprite('zoya', 'worried'), false, 'cut');
    await flush();
    expect(imgSrc(spriteEl(b.host, 'zoya'))).toBe(`${Z}/base.png`);
    expect(b.warns).toEqual([]);
  });

  it('нет ни одного файла набора → плейсхолдер с именем и выражением и ровно один warn', async () => {
    const { r, host, warns } = await rig([]);
    for (let i = 0; i < 3; i++) {
      r.hideSprite('clerk', 'cut');
      r.showSprite(sprite('clerk', 'neutral'), false, 'cut');
      await flush();
    }
    const el = spriteEl(host, 'clerk')!;
    expect(el.dataset.state).toBe('placeholder');
    expect(el.querySelector('.ph-name')?.textContent).toBe('clerk');
    expect(el.querySelector('.ph-expr')?.textContent).toBe('neutral');
    expect(warns).toHaveLength(1);
  });

  it('у персонажа нет набора спрайтов → плейсхолдер сразу, без запросов', async () => {
    const { r, host, store, warns } = await rig([]);
    r.showSprite(sprite('ghost', 'x'), false, 'cut');
    await flush();
    expect(spriteEl(host, 'ghost')!.dataset.state).toBe('placeholder');
    expect(store.stats()).toMatchObject({ loaded: [], missing: [] });
    expect(warns).toEqual([]);
  });

  it('пока грузится, новый спрайт не показывается (loading), плейсхолдер не мигает; потом появляется картинка', async () => {
    const { r, host, release } = await rig('manual');
    r.showSprite(sprite('zoya', 'warm'), false, 'cut');
    await flush();
    expect(spriteEl(host, 'zoya')!.dataset.state).toBe('loading');
    release(`${Z}/warm.webp`);
    await flush();
    expect(spriteEl(host, 'zoya')!.dataset.state).toBe('image');
  });

  it('смена выражения у стоящего спрайта: прежняя картинка остаётся, пока не придёт новая', async () => {
    const { r, host, release } = await rig('manual');
    r.showSprite(sprite('zoya', 'warm'), false, 'cut');
    await flush();
    release(`${Z}/warm.webp`);
    await flush();
    r.showSprite(sprite('zoya', 'worried'), true, 'cut');
    await flush();
    expect(imgSrc(spriteEl(host, 'zoya'))).toBe(`${Z}/warm.webp`);
    release(`${Z}/worried.webp`);
    await flush();
    expect(imgSrc(spriteEl(host, 'zoya'))).toBe(`${Z}/worried.webp`);
  });

  it('силуэт: есть silhouette.webp — рисуется как есть; нет — тёмный силуэт из обычного кадра (класс is-derived-silhouette)', async () => {
    const own = await rig([`${M}/silhouette.webp`, `${M}/neutral.webp`]);
    own.r.showSprite(sprite('murashov', null, { silhouette: true }), false, 'cut');
    await flush();
    expect(imgSrc(spriteEl(own.host, 'murashov'))).toBe(`${M}/silhouette.webp`);
    expect(spriteEl(own.host, 'murashov')!.classList.contains('is-derived-silhouette')).toBe(false);
    const derived = await rig([`${M}/smile.webp`, `${M}/neutral.webp`]);
    derived.r.showSprite(sprite('murashov', 'smile', { silhouette: true }), false, 'cut');
    await flush();
    const el = spriteEl(derived.host, 'murashov')!;
    expect(imgSrc(el)).toBe(`${M}/smile.webp`); // кадр выражения, но чёрный
    expect(el.classList.contains('is-derived-silhouette')).toBe(true);
    expect(el.classList.contains('is-silhouette')).toBe(true);
    expect(derived.warns).toEqual([]);
    // обычный показ того же персонажа — не силуэт
    derived.r.showSprite(sprite('murashov', 'smile', { silhouette: false }), true, 'cut');
    await flush();
    expect(el.classList.contains('is-derived-silhouette')).toBe(false);
  });

  it('голос за кадром (offscreen_*): спрайт не рисуется, даже если файлы есть', async () => {
    const { r, host } = await rig([`${Z}/neutral.webp`]);
    r.showSprite(sprite('zoya', null, { position: 'offscreen_right' }), false, 'cut');
    await flush();
    expect(host.querySelectorAll('.ph-sprite')).toHaveLength(0);
    r.showSprite(sprite('zoya', null, { position: 'center' }), false, 'cut');
    await flush();
    expect(host.querySelectorAll('.ph-sprite')).toHaveLength(1);
    r.showSprite(sprite('zoya', null, { position: 'offscreen_left' }), true, 'cut');
    expect(host.querySelectorAll('.ph-sprite')).toHaveLength(0);
  });

  it('рост спрайта ≈ высота сцены, но не шире 46 % ширины: размер считается по пропорциям картинки', async () => {
    expect(SPRITE_FIT).toBeGreaterThan(0.9);
    expect(SPRITE_FIT).toBeLessThanOrEqual(1);
    const { r, host } = await rig([`${Z}/neutral.webp`]);
    const scene = host.querySelector('.ph-scene') as HTMLElement;
    Object.defineProperty(scene, 'clientWidth', { configurable: true, value: 1000 });
    Object.defineProperty(scene, 'clientHeight', { configurable: true, value: 500 });
    r.showSprite(sprite('zoya', null), false, 'cut');
    await flush();
    const el = spriteEl(host, 'zoya')!;
    // картинка 100×200: по высоте s = 500·0,96/200 = 2,4 (ширина 240 < 460) — упираемся в высоту
    expect(parseFloat(el.style.height)).toBeCloseTo(200 * ((500 * SPRITE_FIT) / 200), 1);
    expect(parseFloat(el.style.width)).toBeCloseTo(100 * ((500 * SPRITE_FIT) / 200), 1);
    // узкий портретный кадр: упираемся в ширину (46 %)
    Object.defineProperty(scene, 'clientWidth', { configurable: true, value: 200 });
    Object.defineProperty(scene, 'clientHeight', { configurable: true, value: 500 });
    r.showSprite(sprite('zoya', null), true, 'cut');
    await flush();
    const s = Math.min((500 * SPRITE_FIT) / 200, (200 * SPRITE_MAX_WIDTH) / 100);
    expect(s).toBeCloseTo((200 * SPRITE_MAX_WIDTH) / 100, 9);
    expect(parseFloat(el.style.width)).toBeCloseTo(100 * s, 1);
  });

  it('говорящий подсвечивается: остальные затемняются, но только если говорящий сам на сцене', async () => {
    const { r, host } = await rig([`${Z}/neutral.webp`, `${M}/neutral.webp`]);
    r.showSprite(sprite('zoya', null, { position: 'left' }), false, 'cut');
    r.showSprite(sprite('murashov', null, { position: 'right' }), false, 'cut');
    await flush();
    r.setSpeaker('zoya');
    expect(spriteEl(host, 'murashov')!.classList.contains('is-dim')).toBe(true);
    expect(spriteEl(host, 'zoya')!.classList.contains('is-dim')).toBe(false);
    r.setSpeaker('someone_offscreen');
    expect(host.querySelectorAll('.ph-sprite.is-dim')).toHaveLength(0);
  });

  it('setView выставляет кадр целиком из ассетов: фон, спрайты, CG', async () => {
    const { r, host } = await rig(['./assets/ep01/bg/yard.webp', `${Z}/neutral.webp`, './assets/ep01/cg/door.webp']);
    r.setView({
      scene: 's1',
      block: 'b1',
      presentation: 'reconstruction',
      bg: 'bg_yard',
      filter: null,
      time_of_day: null,
      weather: null,
      letterbox: false,
      sprites: [sprite('zoya', 'neutral')],
      cg: 'cg_door',
      cg_hide_after: true,
      music: null,
      ambient: null,
      speaker: 'zoya',
    });
    await flush();
    expect(bgEl(host).dataset.state).toBe('image');
    expect(spriteEl(host, 'zoya')!.dataset.state).toBe('image');
    expect((host.querySelector('.ph-cg') as HTMLElement).dataset.state).toBe('image');
  });
});
