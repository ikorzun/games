/**
 * Ассеты эпизода (src/stage/assets.ts, preload.ts, app_assets.ts): резолв путей, цепочка спрайта
 * «выражение → neutral → base», силуэт, плейсхолдер и один warn на отсутствующий файл, предзагрузка по блокам,
 * приоритеты очереди, набор удержания, картинки интерфейса. Загрузчик картинок подменён — браузер не нужен.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Episode } from '../src/core/types';
import { createAppAssets, loadUiArt } from '../src/stage/app_assets';
import {
  AssetCatalog,
  AssetStore,
  collectBlockAssets,
  dirnameOf,
  joinUrl,
  NO_ASSETS,
  nextBlocks,
  prepareView,
  StoreSceneAssets,
  UI_ASSETS,
  viewChains,
} from '../src/stage/assets';
import type { ImageHandle, ImageLoader } from '../src/stage/assets';
import { BlockPreloader } from '../src/stage/preload';
import { ASSET_EXTENSIONS } from '../scripts/assets_plugin.mjs';
import { defaultViewFor } from '../src/core/interpreter';
import { EP01_PATH, hasRepoContent, loadEpisode } from './helpers/content';
import { mg, miniEpisode } from './helpers/mini';

const BASE = './';
const handle = (url: string): ImageHandle => ({ url, image: {} as HTMLImageElement, width: 100, height: 200 });

/** Загрузчик: существуют только файлы из набора; журнал вызовов. */
function loaderOf(existing: Iterable<string>): { loadImage: ImageLoader; calls: string[] } {
  const have = new Set(existing);
  const calls: string[] = [];
  return {
    calls,
    loadImage: (url) => {
      calls.push(url);
      return have.has(url) ? Promise.resolve(handle(url)) : Promise.reject(new Error('404'));
    },
  };
}

/** Загрузчик, который держит запросы, пока тест не разрешит их вручную. */
function manualLoader() {
  const waiting = new Map<string, { ok: () => void; fail: () => void }>();
  const started: string[] = [];
  let active = 0;
  let peak = 0;
  const loadImage: ImageLoader = (url) =>
    new Promise<ImageHandle>((resolve, reject) => {
      started.push(url);
      active += 1;
      peak = Math.max(peak, active);
      waiting.set(url, {
        ok: () => {
          active -= 1;
          resolve(handle(url));
        },
        fail: () => {
          active -= 1;
          reject(new Error('404'));
        },
      });
    });
  return { loadImage, waiting, started, peak: () => peak };
}

const flush = async (n = 6): Promise<void> => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

/** Эпизод с ассетами: два фона, чёрный фон, CG, документ, три набора спрайтов, звук. */
function assetEpisode(): Episode {
  const ep = miniEpisode({
    s1: { block: 'b1', stage: { bg: 'bg_yard' }, music: 'm_theme', steps: [{ do: 'jump', scene: 's2' }] },
    s2: { block: 'b1', stage: { bg: 'bg_black' }, steps: [{ do: 'jump', scene: 's3' }] },
    s3: { block: 'b2', stage: { bg: 'bg_office' }, ambient: 'amb_room', steps: [{ do: 'end', ending: 'e_main' }] },
  });
  ep.cast = [
    { id: 'zoya', name_key: 'n.zoya', role: 'victim', sprite_set: 'zoya_set' },
    { id: 'murashov', name_key: 'n.m', role: 'criminal', sprite_set: 'murashov' },
    { id: 'murashov_sil', name_key: 'n.ms', role: 'criminal', sprite_set: 'murashov' },
    { id: 'lonely', name_key: 'n.l', role: 'extra' }, // нет sprite_set, но есть набор с тем же id
    { id: 'ghost', name_key: 'n.g', role: 'extra' }, // набора нет вовсе
  ];
  ep.assets = {
    backgrounds: [
      { id: 'bg_yard', path: 'assets/ep01/bg/yard.webp' },
      { id: 'bg_office', path: 'assets/common/bg/office.webp' },
      { id: 'bg_black', path: 'assets/common/bg/black.png' },
    ],
    cg: [{ id: 'cg_door', path: 'assets/ep01/cg/door.webp' }],
    documents: [{ id: 'doc_paper', path: 'assets/ep01/docs/paper.webp' }],
    sprites: [
      { id: 'zoya_set', base: 'assets/ep01/sprites/zoya/base.png', expressions: ['neutral', 'warm', 'worried'] },
      { id: 'murashov', base: 'assets/ep01/sprites/murashov/base.png', expressions: ['neutral', 'smile'], silhouette: true },
      { id: 'lonely', base: 'assets/common/sprites/lonely/base.png', expressions: ['neutral'] },
    ],
    music: [{ id: 'm_theme', path: 'assets/common/music/theme.m4a' }],
    ambient: [{ id: 'amb_room', path: 'assets/common/amb/room.mp3' }],
    sfx: [{ id: 'sfx_door', path: 'assets/common/sfx/door.mp3' }],
  };
  return ep;
}

describe('пути', () => {
  it('joinUrl: BASE_URL + путь из эпизода без ведущих «./» и «/»; абсолютные адреса не трогаем', () => {
    expect(joinUrl('./', 'assets/ep01/bg/yard.webp')).toBe('./assets/ep01/bg/yard.webp');
    expect(joinUrl('/', './assets/a.webp')).toBe('/assets/a.webp');
    expect(joinUrl('', '/assets/a.webp')).toBe('assets/a.webp');
    expect(joinUrl('./', 'https://cdn.example.com/a.webp')).toBe('https://cdn.example.com/a.webp');
    expect(dirnameOf('assets/ep01/sprites/zoya/base.png')).toBe('assets/ep01/sprites/zoya');
    expect(dirnameOf('base.png')).toBe('');
  });

  it('все картинки интерфейса лежат там, где их ждёт владелец', () => {
    expect(UI_ASSETS.menuBackground).toBe('assets/common/ui/menu_video_salon.webp');
    expect(UI_ASSETS.titlePlate).toBe('assets/common/ui/title_plate.webp');
  });
});

describe('AssetCatalog: фоны, CG, документы, звук', () => {
  const cat = new AssetCatalog(assetEpisode(), BASE);

  it('id → адрес относительно корня сборки (./assets/…)', () => {
    expect(cat.bgUrl('bg_yard')).toBe('./assets/ep01/bg/yard.webp');
    expect(cat.bgUrl('bg_office')).toBe('./assets/common/bg/office.webp');
    expect(cat.cgUrl('cg_door')).toBe('./assets/ep01/cg/door.webp');
    expect(cat.docUrl('doc_paper')).toBe('./assets/ep01/docs/paper.webp');
    expect(cat.audioUrl('m_theme')).toBe('./assets/common/music/theme.m4a');
    expect(cat.audioUrl('amb_room')).toBe('./assets/common/amb/room.mp3');
    expect(cat.audioUrl('sfx_door')).toBe('./assets/common/sfx/door.mp3');
    expect(cat.bgUrl('bg_unknown')).toBeNull();
    expect(cat.cgUrl('cg_unknown')).toBeNull();
    expect(cat.audioUrl('nope')).toBeNull();
  });

  it('bgChain: один файл; неизвестный фон — null (плейсхолдер); чёрный кадр — сплошной цвет без запросов', () => {
    expect(cat.bgChain('bg_yard')).toEqual({ urls: ['./assets/ep01/bg/yard.webp'], silhouetteFirst: false });
    expect(cat.bgChain('bg_none')).toBeNull();
    expect(cat.bgChain('bg_black')).toEqual({ urls: [], silhouetteFirst: false, solid: '#000000' });
    expect(cat.cgChain('cg_door')?.urls).toEqual(['./assets/ep01/cg/door.webp']);
  });
});

describe('AssetCatalog: цепочка файлов спрайта', () => {
  const cat = new AssetCatalog(assetEpisode(), BASE);
  const dir = './assets/ep01/sprites/zoya';

  it('выражение → neutral → base: каталог = dirname(base), файл выражения <dir>/<expression>.webp', () => {
    expect(cat.spriteChain({ who: 'zoya', expression: 'worried', silhouette: false })).toEqual({
      urls: [`${dir}/worried.webp`, `${dir}/neutral.webp`, `${dir}/base.png`],
      silhouetteFirst: false,
    });
  });

  it('без выражения и для neutral цепочка короче, повторов нет', () => {
    expect(cat.spriteChain({ who: 'zoya', expression: null, silhouette: false })?.urls).toEqual([`${dir}/neutral.webp`, `${dir}/base.png`]);
    expect(cat.spriteChain({ who: 'zoya', expression: 'neutral', silhouette: false })?.urls).toEqual([`${dir}/neutral.webp`, `${dir}/base.png`]);
  });

  it('силуэт: первым стоит <dir>/silhouette.webp, затем обычная цепочка (из неё рендерер сделает тёмный силуэт)', () => {
    const chain = cat.spriteChain({ who: 'murashov_sil', expression: 'smile', silhouette: true })!;
    const m = './assets/ep01/sprites/murashov';
    expect(chain.urls).toEqual([`${m}/silhouette.webp`, `${m}/smile.webp`, `${m}/neutral.webp`, `${m}/base.png`]);
    expect(chain.silhouetteFirst).toBe(true);
  });

  it('набор берётся из cast.sprite_set (два персонажа — один набор), а при его отсутствии — по id персонажа', () => {
    expect(cat.spriteSetOf('murashov_sil')?.id).toBe('murashov');
    expect(cat.spriteSetOf('murashov')?.id).toBe('murashov');
    expect(cat.spriteSetOf('lonely')?.id).toBe('lonely');
    expect(cat.spriteChain({ who: 'lonely', expression: null, silhouette: false })?.urls[0]).toBe('./assets/common/sprites/lonely/neutral.webp');
  });

  it('нет набора у персонажа — null: рисуется плейсхолдер без единого запроса', () => {
    expect(cat.spriteChain({ who: 'ghost', expression: 'x', silhouette: false })).toBeNull();
    expect(cat.spriteChain({ who: 'nobody', expression: null, silhouette: false })).toBeNull();
  });

  it('base без каталога (лежит в корне) не ломает цепочку', () => {
    const ep = assetEpisode();
    ep.assets.sprites = [{ id: 'flat', base: 'flat.png', expressions: ['neutral'] }];
    ep.cast = [{ id: 'flat', name_key: 'n', role: 'extra' }];
    expect(new AssetCatalog(ep, BASE).spriteChain({ who: 'flat', expression: null, silhouette: false })?.urls).toEqual(['./neutral.webp', './flat.png']);
  });
});

describe('AssetStore: загрузка, плейсхолдер и один warn', () => {
  it('существующий файл → handle; отсутствующий → null и «known missing»; peek различает «неизвестно / есть / нет»', async () => {
    const { loadImage, calls } = loaderOf(['a.webp']);
    const store = new AssetStore({ loadImage, warn: () => undefined });
    expect(store.peek('a.webp')).toBeUndefined();
    const a = await store.load('a.webp');
    expect(a?.url).toBe('a.webp');
    expect(store.peek('a.webp')).toBe(a);
    expect(await store.load('b.webp')).toBeNull();
    expect(store.peek('b.webp')).toBeNull();
    expect(store.isMissing('b.webp')).toBe(true);
    await store.load('a.webp');
    await store.load('b.webp');
    expect(calls).toEqual(['a.webp', 'b.webp']); // повторных запросов нет
    expect(store.stats()).toMatchObject({ loaded: ['a.webp'], missing: ['b.webp'], pending: 0 });
  });

  it('одновременные запросы одного файла сливаются в один', async () => {
    const m = manualLoader();
    const store = new AssetStore({ loadImage: m.loadImage });
    const p1 = store.load('x.webp');
    const p2 = store.load('x.webp');
    await flush();
    expect(m.started).toEqual(['x.webp']);
    m.waiting.get('x.webp')!.ok();
    expect((await p1)?.url).toBe('x.webp');
    expect(await p2).toBe(await p1);
  });

  it('loadFirst: берёт первый существующий файл цепочки; запасные подхватываются молча (без warn)', async () => {
    const { loadImage } = loaderOf(['d/neutral.webp', 'd/base.png']);
    const warns: string[] = [];
    const store = new AssetStore({ loadImage, warn: (m) => warns.push(m) });
    const res = await store.loadFirst(['d/worried.webp', 'd/neutral.webp', 'd/base.png']);
    expect(res?.index).toBe(1);
    expect(res?.handle.url).toBe('d/neutral.webp');
    expect(warns).toEqual([]);
    expect((await store.loadFirst(['d/neutral.webp']))?.index).toBe(0);
  });

  it('нет ни одного файла цепочки → null и РОВНО ОДИН console.warn на цепочку, сколько бы раз ни просили', async () => {
    const { loadImage } = loaderOf([]);
    const warns: string[] = [];
    const store = new AssetStore({ loadImage, warn: (m) => warns.push(m) });
    expect(await store.loadFirst(['./assets/ep01/bg/x.webp'])).toBeNull();
    expect(await store.loadFirst(['./assets/ep01/bg/x.webp'])).toBeNull();
    expect(await store.loadFirst(['d/a.webp', 'd/neutral.webp', 'd/base.png'])).toBeNull();
    expect(await store.loadFirst(['d/a.webp', 'd/neutral.webp', 'd/base.png'])).toBeNull();
    expect(warns).toHaveLength(2);
    expect(warns[0]).toContain('./assets/ep01/bg/x.webp');
    expect(warns[1]).toContain('d/base.png');
  });

  it('по умолчанию предупреждение идёт в console.warn', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = new AssetStore({ loadImage: loaderOf([]).loadImage });
    await store.loadFirst(['gone.webp']);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('peekFirst: готово / нет ни одного / пока неизвестно (в порядке цепочки)', async () => {
    const store = new AssetStore({ loadImage: loaderOf(['b']).loadImage, warn: () => undefined });
    expect(store.peekFirst(['a', 'b'])).toBeUndefined();
    await store.load('a');
    expect(store.peekFirst(['a', 'b'])).toBeUndefined(); // a: нет, b: ещё не известно
    await store.load('b');
    expect(store.peekFirst(['a', 'b'])?.index).toBe(1);
    expect(store.peekFirst(['a'])).toBeNull();
  });

  it('очередь: одновременно не больше concurrency запросов, «now» обгоняет «idle», запрос с «now» поднимает уже стоящий в очереди idle', async () => {
    const m = manualLoader();
    const store = new AssetStore({ loadImage: m.loadImage, concurrency: 2 });
    for (const u of ['i1', 'i2', 'i3', 'i4']) void store.load(u, 'idle');
    await flush();
    expect(m.started).toEqual(['i1', 'i2']);
    void store.load('n1', 'now');
    void store.load('i4', 'now'); // стоял в очереди idle — теперь срочный
    m.waiting.get('i1')!.ok();
    await flush();
    expect(m.started.slice(2)).toEqual(['n1']);
    m.waiting.get('i2')!.ok();
    await flush();
    expect(m.started.slice(2)).toEqual(['n1', 'i4']);
    m.waiting.get('n1')!.ok();
    await flush();
    expect(m.started.slice(2)).toEqual(['n1', 'i4', 'i3']);
    expect(m.peak()).toBeLessThanOrEqual(2);
  });

  it('retain освобождает всё, кроме набора удержания и закреплённых файлов (меню); показанное держит рендерер', async () => {
    const store = new AssetStore({ loadImage: loaderOf(['a', 'b', 'c', 'menu']).loadImage });
    store.pin('menu');
    await Promise.all(['a', 'b', 'c', 'menu'].map((u) => store.load(u)));
    store.retain(new Set(['b']));
    expect(store.peek('a')).toBeUndefined();
    expect(store.peek('b')).toBeDefined();
    expect(store.peek('c')).toBeUndefined();
    expect(store.peek('menu')).toBeDefined();
    expect((await store.load('a'))?.url).toBe('a'); // можно загрузить заново
  });

  it('unresolved: что из набора ещё не загружено и не помечено отсутствующим', async () => {
    const store = new AssetStore({ loadImage: loaderOf(['a']).loadImage });
    await store.load('a');
    await store.load('gone');
    expect(store.unresolved(['a', 'gone', 'new'])).toEqual(['new']);
  });
});

describe('prepareView / viewChains', () => {
  const ep = assetEpisode();
  const cat = new AssetCatalog(ep, BASE);
  const view = (over: Partial<ReturnType<typeof defaultViewFor>> = {}) => ({ ...defaultViewFor(ep, 's1'), ...over });

  it('цепочки кадра: фон, CG и спрайты на сцене; голос за кадром (offscreen) не рисуется и не грузится', () => {
    const sc = new StoreSceneAssets(cat, new AssetStore({ loadImage: loaderOf([]).loadImage }));
    const chains = viewChains(sc, {
      bg: 'bg_yard',
      cg: 'cg_door',
      sprites: [
        { who: 'zoya', expression: 'warm', pose: null, position: 'left', silhouette: false },
        { who: 'murashov', expression: null, pose: null, position: 'offscreen_right', silhouette: false },
      ],
    });
    expect(chains).toHaveLength(3);
    expect(chains.some((c) => c.urls.some((u) => u.includes('murashov')))).toBe(false);
  });

  it('prepareView ждёт неизвестные картинки кадра и не ждёт уже загруженные; с NO_ASSETS мгновенно', async () => {
    await prepareView(NO_ASSETS, view({ sprites: [] })); // не зависает
    const m = manualLoader();
    const store = new AssetStore({ loadImage: m.loadImage });
    const sc = new StoreSceneAssets(cat, store);
    let done = false;
    const p = prepareView(sc, view({ bg: 'bg_yard', sprites: [{ who: 'zoya', expression: 'warm', pose: null, position: 'left', silhouette: false }] })).then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    m.waiting.get('./assets/ep01/bg/yard.webp')!.ok();
    await flush();
    expect(done).toBe(false);
    m.waiting.get('./assets/ep01/sprites/zoya/warm.webp')!.ok();
    await p;
    expect(done).toBe(true);
    // всё уже в памяти — повторно не ждём
    await prepareView(sc, view({ bg: 'bg_yard', sprites: [] }));
  });

  it('prepareView не ждёт дольше таймаута (зависшая загрузка не вешает игру)', async () => {
    vi.useFakeTimers();
    try {
      const m = manualLoader();
      const sc = new StoreSceneAssets(cat, new AssetStore({ loadImage: m.loadImage }));
      let done = false;
      const p = prepareView(sc, view({ bg: 'bg_yard' }), 2000).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(1900);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      await p;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('collectBlockAssets и nextBlocks на мини-эпизоде', () => {
  it('ассеты блока: фоны сцен, шаги bg / cg / document / show / say, звук сцен и шагов; чёрный фон не запрашивается', () => {
    const ep = assetEpisode();
    ep.scenes.s1!.steps = [
      { do: 'show', who: 'zoya', expression: 'warm', position: 'left' },
      { do: 'say', who: 'murashov', key: 'k', expression: 'smile' },
      { do: 'show', who: 'murashov_sil', silhouette: true },
      { do: 'cg', cg: 'cg_door' },
      { do: 'document', doc: 'doc_paper' },
      { do: 'bg', bg: 'bg_office' },
      { do: 'sfx', id: 'sfx_door' },
      { do: 'music', id: 'm_theme' },
      { do: 'jump', scene: 's2' },
    ];
    const cat = new AssetCatalog(ep, BASE);
    const plan = collectBlockAssets(ep, cat, 'b1');
    const flat = plan.images.map((c) => c.urls.join(' > '));
    expect(flat).toContain('./assets/ep01/bg/yard.webp');
    expect(flat).toContain('./assets/common/bg/office.webp');
    expect(flat).toContain('./assets/ep01/cg/door.webp');
    expect(flat).toContain('./assets/ep01/docs/paper.webp');
    expect(flat).toContain('./assets/ep01/sprites/zoya/warm.webp > ./assets/ep01/sprites/zoya/neutral.webp > ./assets/ep01/sprites/zoya/base.png');
    expect(flat.some((c) => c.startsWith('./assets/ep01/sprites/murashov/smile.webp'))).toBe(true); // say с выражением
    expect(flat.some((c) => c.startsWith('./assets/ep01/sprites/murashov/silhouette.webp'))).toBe(true); // силуэт
    expect(plan.images.some((c) => c.urls.length === 0)).toBe(false); // bg_black не запрашивается
    expect(plan.audio.sort()).toEqual(['./assets/common/music/theme.m4a', './assets/common/sfx/door.mp3']);
    expect(plan.all.has('./assets/common/music/theme.m4a')).toBe(true);
    // блок b2 — свой набор
    const plan2 = collectBlockAssets(ep, cat, 'b2');
    expect(plan2.audio).toEqual(['./assets/common/amb/room.mp3']);
    expect(collectBlockAssets(ep, cat, 'b_none').images).toEqual([]);
  });

  it('nextBlocks: по jump / branch / choice / исходам мини-игры, без самого блока; нет переходов — следующий по списку', () => {
    const ep = miniEpisode(
      {
        a1: { block: 'A', steps: [{ do: 'jump', scene: 'a2' }] },
        a2: {
          block: 'A',
          steps: [
            {
              do: 'choice',
              id: 'c',
              options: [
                { id: 'o1', key: 'k1', goto: 'b1' },
                { id: 'o2', key: 'k2', goto: 'c1' },
              ],
            },
          ],
        },
        b1: { block: 'B', steps: [{ do: 'minigame', minigame: 'mg1' }] },
        c1: { block: 'C', steps: [{ do: 'branch', cases: [{ when: 'true', goto: 'd1' }], default: 'e1' }] },
        d1: { block: 'D', steps: [{ do: 'end', ending: 'e_main' }] },
        e1: { block: 'E', steps: [{ do: 'end', ending: 'e_main' }] },
        s_ok: { block: 'F', steps: [{ do: 'end', ending: 'e_main' }] },
        s_bad: { block: 'G', steps: [{ do: 'end', ending: 'e_main' }] },
        z1: { block: 'Z', steps: [{ do: 'end', ending: 'e_main' }] },
      },
      {
        blocks: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'Z'].map((id) => ({ id, entry_scene: id === 'A' ? 'a1' : id === 'B' ? 'b1' : id === 'C' ? 'c1' : id === 'D' ? 'd1' : id === 'E' ? 'e1' : id === 'F' ? 's_ok' : id === 'G' ? 's_bad' : 'z1' })),
        minigames: { mg1: mg('mg1') },
      },
    );
    expect(nextBlocks(ep, 'A')).toEqual(['B', 'C']);
    expect(nextBlocks(ep, 'B')).toEqual(['F', 'G']); // исходы мини-игры
    expect(nextBlocks(ep, 'C')).toEqual(['D', 'E']);
    expect(nextBlocks(ep, 'D')).toEqual(['E']); // переходов нет — следующий по списку блоков
    expect(nextBlocks(ep, 'Z')).toEqual([]);
  });
});

describe.skipIf(!hasRepoContent())('эпизод 1: все ассеты разрешаются и укладываются в правила', () => {
  const ep = loadEpisode(EP01_PATH);
  const cat = new AssetCatalog(ep, BASE);

  it('пути в assets — латиница [a-z0-9_./-] и расширения, которые копирует плагин сборки (иначе файл молча не попадёт в архив)', () => {
    const all: string[] = [];
    const a = ep.assets;
    for (const list of [a.backgrounds, a.cg, a.documents, a.music, a.sfx, a.ambient, a.voice]) for (const e of list ?? []) all.push(e.path);
    for (const s of a.sprites ?? []) all.push(s.base);
    expect(all.length).toBeGreaterThan(40);
    for (const p of all) {
      expect(p, p).toMatch(/^assets\/[a-z0-9_./-]+$/);
      expect(ASSET_EXTENSIONS, p).toContain(`.${p.split('.').pop()}`);
    }
  });

  it('каждый блок даёт план; все картинки и звук, на которые ссылаются шаги и сцены, найдены в каталоге', () => {
    const referencedBg = new Set<string>();
    const referencedAudio = new Set<string>();
    for (const sc of Object.values(ep.scenes)) {
      referencedBg.add(sc.stage.bg);
      if (sc.music) referencedAudio.add(sc.music);
      if (sc.ambient) referencedAudio.add(sc.ambient);
      for (const st of sc.steps) {
        if (st.do === 'bg') referencedBg.add(st.bg);
        if (st.do === 'music' || st.do === 'sfx' || st.do === 'ambient') if (st.id) referencedAudio.add(st.id);
      }
    }
    for (const b of ep.blocks) if (b.music) referencedAudio.add(b.music);
    for (const id of referencedBg) expect(cat.bgChain(id), `фон ${id}`).not.toBeNull();
    for (const id of referencedAudio) expect(cat.audioUrl(id), `звук ${id}`).not.toBeNull();
    const urls = new Set<string>();
    const audioUrls = new Set<string>();
    for (const b of ep.blocks) {
      const plan = collectBlockAssets(ep, cat, b.id);
      expect(plan.images.length + plan.audio.length, b.id).toBeGreaterThan(0);
      for (const c of plan.images) for (const u of c.urls) urls.add(u);
      for (const u of plan.audio) audioUrls.add(u);
    }
    // каждый нечёрный фон эпизода попал в какой-то блок
    for (const e of ep.assets.backgrounds ?? []) {
      if (/black\.png$/.test(e.path)) continue;
      expect(urls.has(cat.url(e.path)), e.id).toBe(true);
    }
    for (const id of referencedAudio) expect(audioUrls.has(cat.audioUrl(id)!), id).toBe(true);
    for (const u of [...urls, ...audioUrls]) expect(u.startsWith('./assets/')).toBe(true);
  });

  it('силуэт Мурашова (show с silhouette) → первым кандидатом silhouette.webp, затем обычный кадр; чёрный фон — сплошной цвет', () => {
    const plans = ep.blocks.flatMap((b) => collectBlockAssets(ep, cat, b.id).images);
    const sil = plans.filter((c) => c.silhouetteFirst);
    expect(sil.length).toBeGreaterThan(0);
    for (const c of sil) {
      expect(c.urls[0]).toMatch(/\/murashov\/silhouette\.webp$/);
      expect(c.urls.at(-1)).toMatch(/\/murashov\/neutral\.webp$/); // base набора в ep01 — тот же neutral.webp
    }
    expect(cat.bgChain('bg_black')?.solid).toBe('#000000');
  });

  it('у каждого блока есть следующий (кроме финальных), граф не ведёт «в себя»', () => {
    const ends = new Set<string>();
    for (const b of ep.blocks) {
      const next = nextBlocks(ep, b.id);
      expect(next.includes(b.id)).toBe(false);
      if (next.length === 0) ends.add(b.id);
    }
    expect(ends.size).toBeLessThanOrEqual(2);
  });
});

describe('BlockPreloader: предзагрузка по блокам', () => {
  function setup(existing: string[] = []) {
    const ep = assetEpisode();
    ep.scenes.s1!.steps = [{ do: 'show', who: 'zoya', expression: 'warm', position: 'left' }, { do: 'jump', scene: 's3' }];
    ep.scenes.s2!.steps = [{ do: 'jump', scene: 's3' }];
    ep.blocks = [
      { id: 'b1', type: 'investigation', presentation: 'procedural', entry_scene: 's1' },
      { id: 'b2', type: 'investigation', presentation: 'procedural', entry_scene: 's3' },
    ];
    const cat = new AssetCatalog(ep, BASE);
    const l = loaderOf(existing);
    const store = new AssetStore({ loadImage: l.loadImage, warn: () => undefined });
    const audioCalls: string[][] = [];
    const events: string[] = [];
    const pre = new BlockPreloader({
      episode: ep,
      catalog: cat,
      store,
      audio: { preload: (u) => (audioCalls.push([...u]), Promise.resolve()) },
      hooks: { onLoading: (on) => events.push(`loading:${on}`), track: (e) => events.push(e) },
      indicatorDelayMs: 300,
      timeoutMs: 5000,
    });
    return { pre, store, l, audioCalls, events, ep, cat };
  }

  const ALL = [
    './assets/ep01/bg/yard.webp',
    './assets/ep01/sprites/zoya/warm.webp',
    './assets/common/bg/office.webp',
  ];

  it('вход в блок ждёт его картинки, музыку греет сразу, следующий блок грузит в фоне; платформе — in_game_loading_started / stopped', async () => {
    const { pre, store, l, audioCalls, events } = setup(ALL);
    await pre.enterBlock('b1');
    expect(store.peek('./assets/ep01/bg/yard.webp')).toBeDefined();
    expect(store.peek('./assets/ep01/sprites/zoya/warm.webp')).toBeDefined();
    expect(audioCalls[0]).toEqual(['./assets/common/music/theme.m4a']);
    expect(events).toEqual(['in_game_loading_started', 'in_game_loading_stopped']);
    await flush(20);
    // следующий блок b2 прогрет в фоне: фон кабинета и эмбиент
    expect(l.calls).toContain('./assets/common/bg/office.webp');
    expect(audioCalls.some((c) => c.includes('./assets/common/amb/room.mp3'))).toBe(true);
  });

  it('если всё уже в памяти — ни загрузок, ни событий платформы', async () => {
    const { pre, events } = setup(ALL);
    await pre.enterBlock('b1');
    events.length = 0;
    await pre.enterBlock('b1');
    expect(events).toEqual([]);
  });

  it('индикатор загрузки появляется, только если загрузка затянулась (> 300 мс), и гаснет по окончании', async () => {
    vi.useFakeTimers();
    try {
      const ep = assetEpisode();
      ep.scenes.s1!.steps = [{ do: 'jump', scene: 's3' }];
      const m = manualLoader();
      const events: string[] = [];
      const cat = new AssetCatalog(ep, BASE);
      const store = new AssetStore({ loadImage: m.loadImage, warn: () => undefined });
      const pre = new BlockPreloader({ episode: ep, catalog: cat, store, hooks: { onLoading: (on) => events.push(`loading:${on}`), track: (e) => events.push(e) }, indicatorDelayMs: 300 });
      let done = false;
      void pre.enterBlock('b1').then(() => (done = true));
      await vi.advanceTimersByTimeAsync(200);
      expect(events).toEqual(['in_game_loading_started']);
      await vi.advanceTimersByTimeAsync(200);
      expect(events).toEqual(['in_game_loading_started', 'loading:true']);
      m.waiting.get('./assets/ep01/bg/yard.webp')!.ok();
      await vi.advanceTimersByTimeAsync(10);
      expect(done).toBe(true);
      expect(events).toEqual(['in_game_loading_started', 'loading:true', 'loading:false', 'in_game_loading_stopped']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('зависшая загрузка не держит игру дольше таймаута', async () => {
    vi.useFakeTimers();
    try {
      const ep = assetEpisode();
      const m = manualLoader();
      const cat = new AssetCatalog(ep, BASE);
      const store = new AssetStore({ loadImage: m.loadImage, warn: () => undefined });
      const pre = new BlockPreloader({ episode: ep, catalog: cat, store, timeoutMs: 3000 });
      let done = false;
      void pre.enterBlock('b1').then(() => (done = true));
      await vi.advanceTimersByTimeAsync(2900);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('повторный вызов для того же блока, пока он готовится, возвращает тот же промис; план кешируется', async () => {
    const { pre } = setup(ALL);
    const p1 = pre.enterBlock('b1');
    const p2 = pre.enterBlock('b1');
    expect(p2).toBe(p1);
    await p1;
    expect(pre.plan('b1')).toBe(pre.plan('b1'));
  });

  it('набор удержания: при входе в блок старые картинки освобождаются, следующие блоки остаются', async () => {
    const { pre, store } = setup(ALL);
    await pre.enterBlock('b1');
    await flush(20);
    await pre.enterBlock('b2');
    await flush(20);
    // b1 → b2: картинки b1 (yard, zoya) вытеснены, фон b2 в памяти
    expect(store.peek('./assets/ep01/bg/yard.webp')).toBeUndefined();
    expect(store.peek('./assets/common/bg/office.webp')).toBeDefined();
  });

  it('отсутствующие файлы: плейсхолдер и ровно один warn на файл; вход в блок не падает', async () => {
    const warns: string[] = [];
    const ep = assetEpisode();
    const cat = new AssetCatalog(ep, BASE);
    const store = new AssetStore({ loadImage: loaderOf([]).loadImage, warn: (m) => warns.push(m) });
    const pre = new BlockPreloader({ episode: ep, catalog: cat, store });
    await pre.enterBlock('b1');
    await pre.enterBlock('b1');
    await flush(20);
    expect(warns.length).toBeGreaterThan(0);
    expect(new Set(warns).size).toBe(warns.length); // без повторов
  });
});

describe('AppAssets: бланки документов, картинки интерфейса, проверка файлов', () => {
  it('document(): адрес сразу, если файл уже загружен, иначе промис; нет файла — null и один warn', async () => {
    const ep = assetEpisode();
    const warns: string[] = [];
    const store = new AssetStore({ loadImage: loaderOf(['./assets/ep01/docs/paper.webp']).loadImage, warn: (m) => warns.push(m) });
    const assets = createAppAssets(ep, BASE, null, store);
    const first = assets.document('doc_paper');
    expect(first.url).toBeNull(); // ещё не загружен
    expect(await first.ready).toBe('./assets/ep01/docs/paper.webp');
    expect(assets.document('doc_paper').url).toBe('./assets/ep01/docs/paper.webp');
    expect(assets.document('doc_unknown')).toEqual({ url: null, ready: expect.any(Promise) });
    expect(await assets.document('doc_unknown').ready).toBeNull();
    // файл описан, но не загрузился
    const ep2 = assetEpisode();
    const assets2 = createAppAssets(ep2, BASE, null, new AssetStore({ loadImage: loaderOf([]).loadImage, warn: (m) => warns.push(m) }));
    expect(await assets2.document('doc_paper').ready).toBeNull();
    await assets2.document('doc_paper').ready;
    expect(warns.filter((w) => w.includes('paper.webp'))).toHaveLength(1);
  });

  it('loadUiArt: меню и плашка заставки — адреса, если файлы есть; иначе null (прежний фон) и по одному warn', async () => {
    const ep = assetEpisode();
    const bg = `./${UI_ASSETS.menuBackground}`;
    const plate = `./${UI_ASSETS.titlePlate}`;
    const warns: string[] = [];
    const full = createAppAssets(ep, BASE, null, new AssetStore({ loadImage: loaderOf([bg, plate]).loadImage, warn: (m) => warns.push(m) }));
    expect(await loadUiArt(full)).toEqual({ background: bg, plate });
    expect(full.art).toEqual({ background: bg, plate });
    expect(warns).toEqual([]);
    const empty = createAppAssets(ep, BASE, null, new AssetStore({ loadImage: loaderOf([]).loadImage, warn: (m) => warns.push(m) }));
    expect(await loadUiArt(empty)).toEqual({ background: null, plate: null });
    await loadUiArt(empty);
    expect(warns).toHaveLength(2);
    expect(warns.some((w) => w.includes('menu_video_salon.webp'))).toBe(true);
    expect(warns.some((w) => w.includes('title_plate.webp'))).toBe(true);
    // одна картинка есть, другой нет
    const half = createAppAssets(ep, BASE, null, new AssetStore({ loadImage: loaderOf([plate]).loadImage, warn: () => undefined }));
    expect(await loadUiArt(half)).toEqual({ background: null, plate });
  });

  it('loadUiArt не ждёт дольше таймаута', async () => {
    vi.useFakeTimers();
    try {
      const m = manualLoader();
      const assets = createAppAssets(assetEpisode(), BASE, null, new AssetStore({ loadImage: m.loadImage, warn: () => undefined }));
      const p = loadUiArt(assets, 1500);
      await vi.advanceTimersByTimeAsync(1600);
      expect(await p).toEqual({ background: null, plate: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it('verify: HEAD по всем объявленным файлам; ответ HTML (SPA-фолбэк сервера) считается «файла нет»', async () => {
    const ep = assetEpisode();
    const assets = createAppAssets(ep, BASE, null, new AssetStore({ loadImage: loaderOf([]).loadImage }));
    const res = await assets.verify(async (url) => ({
      ok: true,
      headers: { get: () => (/\.(mp3|m4a)$/.test(url) ? 'audio/mpeg' : 'text/html') },
    }));
    expect(res.present.every((u) => /\.(m4a|mp3)$/.test(u))).toBe(true);
    expect(res.missing.length).toBeGreaterThan(10);
    expect(res.missing).toContain('./assets/ep01/bg/yard.webp');
    expect(res.missing).toContain('./assets/ep01/sprites/zoya/neutral.webp');
    expect(res.missing).toContain(`./${UI_ASSETS.titlePlate}`);
    // чёрный кадр — сплошной цвет, а не файл: его нет ни среди найденных, ни среди пропавших
    expect([...res.present, ...res.missing].some((u) => /black\.png$/.test(u))).toBe(false);
    const err = await assets.verify(async () => {
      throw new Error('сеть');
    });
    expect(err.present).toEqual([]);
  });
});

afterEach(() => {
  vi.useRealTimers();
});
