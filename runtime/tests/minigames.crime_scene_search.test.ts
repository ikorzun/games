// @vitest-environment jsdom
/**
 * Осмотр места (crime_scene_search): попадание по зонам без пиксель-хантинга, исходы по порогам,
 * правила пропуска и подсказок, таймер и пауза, serialize / restore, смена языка, одиночный onResult.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCrimeSceneSearch,
  hitTest,
  MIN_HIT_PX,
  parseSceneConfig,
  SLOP_PX,
  TYPE,
} from '../src/minigames/crime_scene_search';
import type { Rect } from '../src/minigames/crime_scene_search';
import { createMinigame, registerBuiltinMinigames } from '../src/minigames/registry';
import type { GameContext } from '../src/minigames/types';
import { EP01_PATH, hasRepoContent, loadEpisode, loadStrings } from './helpers/content';
import { btn, click, defOf, mountGame, press, q, rig, sizeOf, texts, UI } from './helpers/mg_kit';
import type { Rig } from './helpers/mg_kit';
import { miniEpisode } from './helpers/mini';

const W = 640;
const H = 360;

const STRINGS: Record<string, string> = {
  ...UI,
  'mini.m1.title': 'Осмотр квартиры',
  'mini.m1.brief': 'Найдите три предмета',
  'mini.intro': 'Осмотрите комнату',
  'hs.glasses': 'Очки на тумбочке',
  'hs.pills': 'Лекарства',
  'hs.photo': 'Фотография внука',
  'hs.slippers': 'Домашние тапочки',
};

const CFG = {
  scene_bg: 'bg_x',
  hotspots: [
    { id: 'glasses', rect: [0.62, 0.55, 0.08, 0.06], label_key: 'hs.glasses', required: true },
    { id: 'pills', rect: [0.3, 0.48, 0.07, 0.07], label_key: 'hs.pills', required: true },
    { id: 'photo', rect: [0.48, 0.3, 0.06, 0.08], label_key: 'hs.photo', required: true },
    { id: 'slippers', rect: [0.15, 0.8, 0.09, 0.05], label_key: 'hs.slippers', required: false },
  ],
  max_misses: 3,
};

/** Далёкие друг от друга и от зон точки: каждая — отдельный промах. */
const MISSES: Array<[number, number]> = [
  [0.92, 0.08],
  [0.08, 0.08],
  [0.92, 0.92],
  [0.5, 0.96],
  [0.06, 0.5],
];

interface Play {
  r: Rig;
  m: ReturnType<typeof createCrimeSceneSearch>;
  stage: HTMLElement;
  tap(u: number, v: number): void;
  zone(id: string): void;
  miss(i?: number): void;
  next(): void;
}

let missCounter = 0;

function play(over: Parameters<typeof defOf>[2] = {}, cfg: Record<string, unknown> = CFG, ctx: Partial<GameContext> = {}, strings = STRINGS): Play {
  const r = rig(defOf(TYPE, cfg, over), { ctx, strings });
  const m = mountGame(createCrimeSceneSearch(), r, cfg);
  const stage = q(r.dom, '.mg-scene__stage');
  sizeOf(stage, W, H);
  click(q(r.dom, 'button.is-start')); // вступление раскладки «сцена»: «Начать осмотр»
  missCounter = 0;
  const rects = new Map((cfg.hotspots as Array<{ id: string; rect: Rect }>).map((x) => [x.id, x.rect]));
  const tap = (u: number, v: number): void => click(stage, { clientX: u * W, clientY: v * H });
  return {
    r,
    m,
    stage,
    tap,
    zone: (id) => {
      const rect = rects.get(id);
      if (!rect) throw new Error(`нет зоны ${id}`);
      tap(rect[0] + rect[2] / 2, rect[1] + rect[3] / 2);
    },
    miss: (i) => {
      const p = MISSES[i ?? missCounter++ % MISSES.length];
      if (!p) throw new Error('нет точки промаха');
      tap(p[0], p[1]);
    },
    next: () => click(q(r.dom, 'button.is-next')),
  };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('parseSceneConfig', () => {
  it('разбирает зоны, лимиты и фон; координаты зажимаются в [0, 1]', () => {
    const c = parseSceneConfig({ ...CFG, hotspots: [{ id: 'a', rect: [-0.2, 0.5, 2, 0.1], label_key: 'k', required: true }], time_limit_ms: 30000, hint_after_misses: 2 });
    expect(c).not.toBeNull();
    expect(c?.sceneBg).toBe('bg_x');
    expect(c?.hotspots[0]?.rect).toEqual([0, 0.5, 1, 0.1]);
    expect(c?.maxMisses).toBe(3);
    expect(c?.timeLimitMs).toBe(30000);
    expect(c?.hintAfterMisses).toBe(2);
  });

  it('если ни одна зона не помечена обязательной, обязательны все', () => {
    const c = parseSceneConfig({ hotspots: [{ id: 'a', rect: [0.1, 0.1, 0.1, 0.1] }, { id: 'b', rect: [0.5, 0.5, 0.1, 0.1] }], max_misses: 2 });
    expect(c?.hotspots.map((x) => x.required)).toEqual([true, true]);
  });

  it.each([
    ['нет hotspots', {}],
    ['пустой список', { hotspots: [] }],
    ['не массив rect', { hotspots: [{ id: 'a', rect: 'x', required: true }] }],
    ['rect не из 4 чисел', { hotspots: [{ id: 'a', rect: [0, 0, 1], required: true }] }],
    ['нулевая ширина', { hotspots: [{ id: 'a', rect: [0.1, 0.1, 0, 0.1], required: true }] }],
    ['нет id', { hotspots: [{ rect: [0.1, 0.1, 0.1, 0.1], required: true }] }],
    ['повтор id', { hotspots: [{ id: 'a', rect: [0, 0, 0.1, 0.1] }, { id: 'a', rect: [0.5, 0.5, 0.1, 0.1] }] }],
  ])('непригодный config (%s) → null', (_name, cfg) => {
    expect(parseSceneConfig(cfg as Record<string, unknown>)).toBeNull();
  });
});

describe('hitTest: зона не меньше пальца, ближайший центр побеждает', () => {
  const tiny: Rect = [0.5, 0.5, 0.02, 0.02]; // 12.8 × 7.2 px при 640 × 360
  const zones = [{ id: 'tiny', rect: tiny }];
  const cx = 0.51 * W;
  const cy = 0.51 * H;

  it('попадание в центр и в пределах MIN_HIT_PX / 2 + SLOP_PX от него', () => {
    expect(hitTest(zones, 0.51, 0.51, W, H)).toBe('tiny');
    const edge = MIN_HIT_PX / 2 + SLOP_PX; // 34 px
    expect(hitTest(zones, (cx + edge - 1) / W, 0.51, W, H)).toBe('tiny');
    expect(hitTest(zones, 0.51, (cy - edge + 1) / H, W, H)).toBe('tiny');
    expect(hitTest(zones, (cx + edge + 2) / W, 0.51, W, H)).toBeNull();
    expect(hitTest(zones, 0.51, (cy + edge + 2) / H, W, H)).toBeNull();
  });

  it('большая зона не сжимается: попадание по всей её площади и запасу', () => {
    const big: Rect = [0.2, 0.2, 0.4, 0.4];
    expect(hitTest([{ id: 'big', rect: big }], 0.21, 0.21, W, H)).toBe('big');
    expect(hitTest([{ id: 'big', rect: big }], 0.7, 0.7, W, H)).toBeNull();
  });

  it('из пересекающихся зон выбирается та, чей центр ближе', () => {
    const a: Rect = [0.4, 0.5, 0.05, 0.05];
    const b: Rect = [0.47, 0.5, 0.05, 0.05];
    const both = [{ id: 'a', rect: a }, { id: 'b', rect: b }];
    expect(hitTest(both, 0.425, 0.525, W, H)).toBe('a');
    expect(hitTest(both, 0.495, 0.525, W, H)).toBe('b');
  });

  it('мимо всех зон — null', () => {
    expect(hitTest(zones, 0.05, 0.05, W, H)).toBeNull();
    expect(hitTest([], 0.5, 0.5, W, H)).toBeNull();
  });
});

describe('разметка и картинка места', () => {
  it('показывает название, бриф и вступление шага, прогресс и счётчик промахов', () => {
    const { r } = play({}, CFG, { introKey: 'mini.intro' });
    expect(q(r.dom, '.mg-shell__title').textContent).toBe('Осмотр квартиры');
    expect(q(r.dom, '.mg-shell__brief').textContent).toBe('Найдите три предмета');
    expect(q(r.dom, '.mg-shell__intro').textContent).toBe('Осмотрите комнату');
    expect(q(r.dom, '.mg-shell__progress').textContent).toBe('Найдено: 0 из 3');
    expect(q(r.dom, '.mg-shell__fails-text').textContent).toBe('Промахи: 0 из 3');
    expect(r.dom.querySelectorAll('.mg-shell__pip')).toHaveLength(3);
    expect(r.dom.querySelectorAll('.mg-scene__zone')).toHaveLength(4);
  });

  it('вступления нет — блок скрыт; таймера нет — блок скрыт', () => {
    const { r } = play();
    expect(q(r.dom, '.mg-shell__intro').hidden).toBe(true);
    expect(q(r.dom, '.mg-shell__timer').hidden).toBe(true);
  });

  it('нет файла картинки в assets — серая заглушка с подписями зон', () => {
    const { r, stage } = play();
    expect(stage.classList.contains('is-placeholder')).toBe(true);
    expect(stage.querySelector('img')).toBeNull();
    expect(texts(r.dom, '.mg-scene__tag')).toEqual(['Очки на тумбочке', 'Лекарства', 'Фотография внука', 'Домашние тапочки']);
    expect(q(r.dom, '.mg-scene__ph').textContent).toBe('bg_x');
  });

  const withBg = (): ReturnType<typeof miniEpisode> => {
    const ep = miniEpisode({ s1: { steps: [{ do: 'end', ending: 'e_main' }] } });
    ep.assets = { backgrounds: [{ id: 'bg_x', path: 'assets/ep01/bg/x.webp' }] };
    return ep;
  };

  it('фон из assets.backgrounds: картинка загружается, пока не загрузилась — зоны скрыты', () => {
    const r = rig(defOf(TYPE, CFG), { episode: withBg(), strings: STRINGS });
    mountGame(createCrimeSceneSearch(), r, CFG);
    const stage = q(r.dom, '.mg-scene__stage');
    const img = q<HTMLImageElement>(stage, 'img.mg-scene__img');
    expect(img.src).toContain('assets/ep01/bg/x.webp');
    expect(stage.classList.contains('is-loading')).toBe(true);
    expect(stage.classList.contains('is-placeholder')).toBe(false);

    Object.defineProperty(img, 'naturalWidth', { value: 1920 });
    Object.defineProperty(img, 'naturalHeight', { value: 1080 });
    img.dispatchEvent(new Event('load'));
    expect(stage.classList.contains('has-image')).toBe(true);
    expect(stage.classList.contains('is-loading')).toBe(false);
    expect(stage.style.getPropertyValue('--ar')).toBe('1920 / 1080');
  });

  it('картинка не загрузилась — заглушка вместо неё, одно предупреждение на файл, игра продолжается', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = rig(defOf(TYPE, CFG), { episode: withBg(), strings: STRINGS });
    mountGame(createCrimeSceneSearch(), r, CFG);
    const stage = q(r.dom, '.mg-scene__stage');
    q(stage, 'img').dispatchEvent(new Event('error'));
    expect(stage.querySelector('img')).toBeNull();
    expect(stage.classList.contains('is-placeholder')).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('assets/ep01/bg/x.webp');
  });
});

describe('раскладка «сцена» (макеты 2026-10-13): вступление, блок, перетаскивание', () => {
  const fresh = (cfg: Record<string, unknown> = CFG) => {
    const r = rig(defOf(TYPE, cfg), { strings: STRINGS });
    const m = mountGame(createCrimeSceneSearch(), r, cfg);
    const stage = q(r.dom, '.mg-scene__stage');
    sizeOf(stage, W, H);
    return { r, m, stage };
  };

  it('до «Начать осмотр» — вступление: вопрос, бриф, сколько попыток; тапы не засчитываются, блока не видно', () => {
    const { r, stage } = fresh();
    expect(q(r.dom, '.mg-stage__layer').hidden).toBe(false);
    expect(q(r.dom, '.mg-stage__heading').textContent).toBe('Осмотр квартиры');
    expect(q(r.dom, '.mg-stage__attempts').textContent).toBe('У вас всего 3 попытки подметить детали.');
    expect(q(r.dom, '.mg-stage__dock').hidden).toBe(true);
    click(stage, { clientX: 0.92 * W, clientY: 0.08 * H });
    expect(q(r.dom, '.mg-shell__fails-text').textContent).toBe('Промахи: 0 из 3');
    click(q(r.dom, 'button.is-start'));
    expect(q(r.dom, '.mg-stage__layer').hidden).toBe(true);
    expect(q(r.dom, '.mg-stage__dock').hidden).toBe(false);
    click(stage, { clientX: 0.92 * W, clientY: 0.08 * H });
    expect(q(r.dom, '.mg-shell__fails-text').textContent).toBe('Промахи: 1 из 3');
  });

  it('форма слова — по числу попыток: 1 попытка, 4 попытки, 6 попыток', () => {
    for (const [n, word] of [[1, 'попытка'], [4, 'попытки'], [6, 'попыток']] as const) {
      const { r } = fresh({ ...CFG, max_misses: n });
      expect(q(r.dom, '.mg-stage__attempts').textContent).toBe(`У вас всего ${n} ${word} подметить детали.`);
      document.body.replaceChildren();
    }
  });

  it('сейв помнит, что партия начата; в старых сейвах поля нет — партия идёт без вступления', () => {
    const a = play();
    expect((a.m.serialize() as { started: boolean }).started).toBe(true);
    const { r: r1, m: m1 } = fresh();
    expect((m1.serialize() as { started: boolean }).started).toBe(false);
    const { started: _drop, ...old } = JSON.parse(JSON.stringify(a.m.serialize())) as Record<string, unknown>;
    m1.restore(old);
    expect(q(r1.dom, '.mg-stage__layer').hidden).toBe(true);
  });

  it('блок двигается за ручку и не выходит за поле', () => {
    const { r } = fresh();
    click(q(r.dom, 'button.is-start'));
    const root = q(r.dom, '.mg-stage');
    const dock = q(r.dom, '.mg-stage__dock');
    const handle = q(r.dom, '.mg-stage__handle');
    sizeOf(root, 1000, 700);
    sizeOf(dock, 290, 250, 700, 440);
    Object.defineProperty(dock, 'offsetWidth', { value: 290 });
    Object.defineProperty(dock, 'offsetHeight', { value: 250 });
    const ev = (type: string, x: number, y: number): PointerEvent => {
      const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }) as PointerEvent;
      Object.defineProperty(e, 'pointerId', { value: 1 });
      return e;
    };
    handle.dispatchEvent(ev('pointerdown', 900, 450));
    handle.dispatchEvent(ev('pointermove', 500, 300));
    expect([dock.style.left, dock.style.top]).toEqual(['300px', '290px']);
    handle.dispatchEvent(ev('pointermove', -2000, -2000)); // за край — упирается в угол поля
    expect([dock.style.left, dock.style.top]).toEqual(['0px', '0px']);
    handle.dispatchEvent(ev('pointerup', 0, 0));
    expect(dock.classList.contains('is-dragging')).toBe(false);
  });
});

describe('ход игры: находки, промахи, исходы по порогам', () => {
  it('находка: зона подсвечивается и подписывается, прогресс растёт, просит автосейв', () => {
    const { r, zone } = play();
    zone('pills');
    const el = q(r.dom, '.mg-scene__zone[data-id="pills"]');
    expect(el.classList.contains('is-found')).toBe(true);
    expect(q(el, '.mg-scene__pin').textContent).toBe('1');
    // Блок: найденное — номер и название; ненайденные обязательные — безымянные «Найди вещь».
    expect(texts(r.dom, '.mg-scene__item')).toEqual(['1Лекарства', '2Найди вещь', '3Найди вещь']);
    expect(q(r.dom, '.mg-shell__progress').textContent).toBe('Найдено: 1 из 3');
    expect(q(r.dom, '.mg-shell__status').textContent).toBe('Лекарства');
    expect(r.autosaves).toBe(1);
    expect(r.results).toEqual([]);
  });

  it('все обязательные → success; итог показан, onResult — только по «Далее» и ровно один раз', () => {
    const { r, zone, next } = play();
    zone('glasses');
    zone('pills');
    expect(r.dom.querySelector('.mg-shell__result:not([hidden])')).toBeNull();
    zone('photo');
    const banner = q(r.dom, '.mg-shell__result');
    expect(banner.hidden).toBe(false);
    expect(banner.dataset.outcome).toBe('success');
    expect(q(banner, '.mg-shell__result-title').textContent).toBe('Успех');
    expect(q(banner, '.mg-shell__result-note').textContent).toBe('Найдено: 3 из 3');
    expect(q(r.dom, '.mg-shell__actions').hidden).toBe(true);
    expect(r.results).toEqual([]);
    next();
    next();
    click(btn(r.dom, 'is-next'));
    expect(r.results).toEqual(['success']);
  });

  it('необязательная зона находится без промаха и не идёт в зачёт', () => {
    const { r, zone } = play();
    zone('slippers');
    expect(q(r.dom, '.mg-scene__item').classList.contains('is-extra')).toBe(true);
    expect(q(r.dom, '.mg-shell__progress').textContent).toBe('Найдено: 0 из 3');
    expect(q(r.dom, '.mg-shell__fails-text').textContent).toBe('Промахи: 0 из 3');
    zone('glasses');
    zone('pills');
    zone('photo');
    expect(q(r.dom, '.mg-shell__result').dataset.outcome).toBe('success');
  });

  it('повторный тап по найденной зоне — не промах и не новая находка', () => {
    const { r, zone } = play();
    zone('glasses');
    zone('glasses');
    expect(q(r.dom, '.mg-shell__progress').textContent).toBe('Найдено: 1 из 3');
    expect(q(r.dom, '.mg-shell__fails-text').textContent).toBe('Промахи: 0 из 3');
    expect(r.dom.querySelectorAll('.mg-scene__item.is-found')).toHaveLength(1);
  });

  it('промах: счётчик растёт, на поле остаётся след, просит автосейв', () => {
    const { r, miss } = play();
    miss();
    expect(q(r.dom, '.mg-shell__fails-text').textContent).toBe('Промахи: 1 из 3');
    expect(r.dom.querySelectorAll('.mg-shell__pip.is-used')).toHaveLength(1);
    expect(r.dom.querySelectorAll('.mg-scene__miss')).toHaveLength(1);
    expect(q(r.dom, '.mg-shell__status').textContent).toBe('Здесь ничего');
    expect(r.autosaves).toBe(1);
  });

  it('след промаха исчезает сам', () => {
    vi.useFakeTimers();
    const { r, miss } = play();
    miss();
    expect(r.dom.querySelectorAll('.mg-scene__miss')).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(r.dom.querySelectorAll('.mg-scene__miss')).toHaveLength(0);
  });

  it('лимит промахов исчерпан, часть найдена → partial', () => {
    const { r, zone, miss, next } = play();
    zone('photo');
    miss();
    miss();
    expect(r.dom.querySelector('.mg-shell__result:not([hidden])')).toBeNull();
    miss();
    expect(q(r.dom, '.mg-shell__result').dataset.outcome).toBe('partial');
    expect(q(r.dom, '.mg-shell__result-title').textContent).toBe('Частично');
    expect(q(r.dom, '.mg-shell__result-note').textContent).toBe('Найдено: 1 из 3');
    next();
    expect(r.results).toEqual(['partial']);
  });

  it('лимит промахов исчерпан, ничего не найдено → fail; находка необязательной зоны в зачёт не идёт', () => {
    const { r, zone, miss, next } = play();
    zone('slippers');
    miss();
    miss();
    miss();
    expect(q(r.dom, '.mg-shell__result').dataset.outcome).toBe('fail');
    next();
    expect(r.results).toEqual(['fail']);
  });

  it('после конца партии ввод не принимается', () => {
    const { r, zone, miss } = play();
    miss();
    miss();
    miss();
    zone('glasses');
    miss();
    expect(q(r.dom, '.mg-shell__progress').textContent).toBe('Найдено: 0 из 3');
    expect(q(r.dom, '.mg-shell__fails-text').textContent).toBe('Промахи: 3 из 3');
  });

  it('двойной тап по одному месту — один промах; через время или в другом месте — новый', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));
    const { r, tap } = play({}, { ...CFG, max_misses: 10 });
    const misses = (): string => q(r.dom, '.mg-shell__fails-text').textContent ?? '';
    tap(0.9, 0.1);
    vi.advanceTimersByTime(100);
    tap(0.9, 0.1);
    tap(0.905, 0.1);
    expect(misses()).toBe('Промахи: 1 из 10');
    tap(0.1, 0.1); // другое место
    expect(misses()).toBe('Промахи: 2 из 10');
    vi.advanceTimersByTime(400);
    tap(0.1, 0.1); // то же место, но не «двойной» тап
    expect(misses()).toBe('Промахи: 3 из 10');
  });

  it('тап без раскладки (размер 0) не теряется: берётся типовой размер поля', () => {
    const r = rig(defOf(TYPE, CFG), { strings: STRINGS });
    mountGame(createCrimeSceneSearch(), r, CFG);
    click(q(r.dom, 'button.is-start'));
    const stage = q(r.dom, '.mg-scene__stage');
    sizeOf(stage, 0, 0);
    click(stage, { clientX: 0, clientY: 0 });
    expect(q(r.dom, '.mg-shell__fails-text').textContent).toBe('Промахи: 0 из 3'); // клик без раскладки игнорируется
    press(stage, 'Enter'); // прицел в центре: мимо всех зон
    expect(q(r.dom, '.mg-shell__fails-text').textContent).toBe('Промахи: 1 из 3');
  });
});

describe('клавиатура: прицел', () => {
  it('стрелки двигают прицел, Enter осматривает точку', () => {
    const { r, stage } = play();
    expect(stage.getAttribute('tabindex')).toBe('0');
    // из центра (0.5, 0.5) к «лекарствам» (центр 0.335, 0.515): 3 шага влево по 5 % и один по 1 % — достаточно по запасу зоны
    for (let i = 0; i < 3; i++) press(stage, 'ArrowLeft');
    expect(stage.classList.contains('has-cursor')).toBe(true);
    expect(q(r.dom, '.mg-scene__cross').style.left).toBe('35%');
    press(stage, 'Enter');
    expect(q(r.dom, '.mg-scene__zone[data-id="pills"]').classList.contains('is-found')).toBe(true);
  });

  it('Shift — мелкий шаг; Space тоже осматривает; прицел не выходит за поле', () => {
    const { r, stage } = play();
    for (let i = 0; i < 30; i++) press(stage, 'ArrowUp');
    expect(q(r.dom, '.mg-scene__cross').style.top).toBe('0%');
    press(stage, 'ArrowRight', { shiftKey: true });
    expect(q(r.dom, '.mg-scene__cross').style.left).toBe('51%');
    press(stage, ' ');
    expect(q(r.dom, '.mg-shell__fails-text').textContent).toBe('Промахи: 1 из 3');
  });

  it('прочие клавиши и сочетания с Ctrl игнорируются', () => {
    const { r, stage } = play();
    press(stage, 'a');
    press(stage, 'Enter', { ctrlKey: true });
    expect(q(r.dom, '.mg-shell__fails-text').textContent).toBe('Промахи: 0 из 3');
  });
});

describe('пропуск', () => {
  it('skip.allowed=false: кнопки пропуска нет, программный клик ничего не делает', () => {
    const { r } = play({ skip: { allowed: false } });
    expect(btn(r.dom, 'is-skip')).toBeNull();
    q(r.dom, 'button.is-skip').click();
    expect(r.results).toEqual([]);
  });

  it('skip.after_fails: кнопка появляется после N промахов, не раньше', () => {
    const { r, miss, zone } = play({ skip: { allowed: true, after_fails: 2 } });
    expect(btn(r.dom, 'is-skip')).toBeNull();
    zone('glasses');
    miss();
    expect(btn(r.dom, 'is-skip')).toBeNull();
    q(r.dom, 'button.is-skip').click(); // скрытая кнопка не работает даже при программном клике
    expect(r.results).toEqual([]);
    miss();
    const skip = btn(r.dom, 'is-skip');
    expect(skip?.textContent).toBe('Пропустить');
    expect(skip?.classList.contains('is-primary')).toBe(false);
    click(skip);
    click(skip);
    expect(r.results).toEqual(['skipped']);
  });

  it('after_fails не задан или 0 — пропуск доступен сразу', () => {
    expect(btn(play({ skip: { allowed: true } }).r.dom, 'is-skip')).not.toBeNull();
    expect(btn(play({ skip: { allowed: true, after_fails: 0 } }).r.dom, 'is-skip')).not.toBeNull();
  });

  it('режим «только история»: пропуск сразу и выделен как основное действие', () => {
    const { r } = play({ skip: { allowed: true, after_fails: 5 } }, CFG, { settings: { timers: false, storyOnly: true } });
    const skip = btn(r.dom, 'is-skip');
    expect(skip?.classList.contains('is-primary')).toBe(true);
    click(skip);
    expect(r.results).toEqual(['skipped']);
  });

  it('после конца партии пропуск уже не нужен: остаётся «Далее»', () => {
    const { r, miss } = play();
    miss();
    miss();
    miss();
    expect(btn(r.dom, 'is-skip')).toBeNull();
    expect(btn(r.dom, 'is-next')).not.toBeNull();
  });
});

describe('подсказки', () => {
  const withAd = { skip: { allowed: true, hint_rewarded_ad: true } };

  it('rewarded-подсказка: кнопка есть только если флаг выставлен и платформа умеет показывать рекламу', () => {
    const rewarded = (): Promise<boolean> => Promise.resolve(true);
    expect(btn(play(withAd, CFG, { showRewarded: rewarded }).r.dom, 'is-hint')?.textContent).toBe('Подсказка за рекламу');
    expect(btn(play(withAd).r.dom, 'is-hint')).toBeNull(); // платформа без rewarded
    expect(btn(play({}, CFG, { showRewarded: rewarded }).r.dom, 'is-hint')).toBeNull(); // флага нет
  });

  it('просмотренная реклама подсвечивает обязательную зону и называет её; автосейв и телеметрия', async () => {
    const showRewarded = vi.fn(() => Promise.resolve(true));
    const { r, m } = play(withAd, CFG, { showRewarded });
    click(btn(r.dom, 'is-hint'));
    await vi.waitFor(() => expect(r.dom.querySelectorAll('.mg-scene__zone.is-hinted')).toHaveLength(1));
    expect(q(r.dom, '.mg-scene__zone.is-hinted').dataset.id).toBe('glasses');
    expect(q(r.dom, '.mg-shell__status').textContent).toBe('Подсказка: Очки на тумбочке');
    expect(texts(r.dom, '.mg-scene__item.is-hint .mg-scene__name')).toEqual(['Подсказка: Очки на тумбочке']);
    expect(r.autosaves).toBe(1);
    expect(r.tracked).toContainEqual(['minigame_hint', { id: 'm1', rewarded: true }]);
    expect((m.serialize() as { hints: number }).hints).toBe(1);
    expect(showRewarded).toHaveBeenCalledTimes(1);
  });

  it('подсказки идут по очереди и заканчиваются; найденная зона подсказкой быть не может', async () => {
    const { r, zone } = play(withAd, CFG, { showRewarded: () => Promise.resolve(true) });
    zone('glasses');
    for (const id of ['pills', 'photo']) {
      click(btn(r.dom, 'is-hint'));
      await vi.waitFor(() => expect(r.dom.querySelector(`.mg-scene__zone[data-id="${id}"].is-hinted`)).not.toBeNull());
    }
    expect(btn(r.dom, 'is-hint')).toBeNull();
    zone('pills');
    expect(r.dom.querySelector('.mg-scene__zone[data-id="pills"].is-hinted')).toBeNull();
  });

  it('реклама не показана — подсказки нет, автосейва нет, в телеметрии есть', async () => {
    const { r } = play(withAd, CFG, { showRewarded: () => Promise.resolve(false) });
    click(btn(r.dom, 'is-hint'));
    await vi.waitFor(() => expect(r.tracked).toContainEqual(['minigame_hint', { id: 'm1', rewarded: false }]));
    expect(r.dom.querySelectorAll('.mg-scene__zone.is-hinted')).toHaveLength(0);
    expect(r.autosaves).toBe(0);
    expect(btn(r.dom, 'is-hint')).not.toBeNull();
  });

  it('реклама упала с ошибкой — игра цела', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { r } = play(withAd, CFG, { showRewarded: () => Promise.reject(new Error('ad')) });
    click(btn(r.dom, 'is-hint'));
    await vi.waitFor(() => expect(r.tracked).toContainEqual(['minigame_hint', { id: 'm1', rewarded: false }]));
    expect(btn(r.dom, 'is-hint')?.disabled).toBe(false);
  });

  it('пока реклама идёт, кнопка недоступна — двойной тап не запускает вторую рекламу', async () => {
    let done: (ok: boolean) => void = () => undefined;
    const showRewarded = vi.fn(() => new Promise<boolean>((res) => (done = res)));
    const { r } = play(withAd, CFG, { showRewarded });
    const b = q<HTMLButtonElement>(r.dom, 'button.is-hint');
    b.click();
    expect(b.disabled).toBe(true);
    b.click();
    expect(showRewarded).toHaveBeenCalledTimes(1);
    done(true);
    await vi.waitFor(() => expect(b.disabled).toBe(false));
  });

  it('бесплатная подсказка по hint_after_misses: появляется после N промахов, без рекламы', () => {
    const { r, miss } = play({}, { ...CFG, max_misses: 6, hint_after_misses: 2 });
    expect(btn(r.dom, 'is-hint')).toBeNull();
    miss();
    expect(btn(r.dom, 'is-hint')).toBeNull();
    miss();
    const hint = btn(r.dom, 'is-hint');
    expect(hint?.textContent).toBe('Подсказка');
    click(hint);
    expect(q(r.dom, '.mg-scene__zone.is-hinted').dataset.id).toBe('glasses');
    expect(r.tracked).toContainEqual(['minigame_hint', { id: 'm1', rewarded: false, free: true }]);
    expect(r.autosaves).toBe(3);
  });

  it('при флаге рекламы бесплатной подсказки нет, даже если промахов много', () => {
    const { r, miss } = play(withAd, { ...CFG, max_misses: 6, hint_after_misses: 1 });
    miss();
    miss();
    expect(btn(r.dom, 'is-hint')).toBeNull(); // платформа без rewarded: подсказки нет вовсе
  });
});

describe('таймер', () => {
  const timed = { time_limit_ms: 5000 };

  it('время из def.time_limit_ms: обратный отсчёт; вышло время → итог по найденному', () => {
    vi.useFakeTimers();
    const { r, zone } = play(timed, CFG);
    expect(q(r.dom, '.mg-shell__timer').hidden).toBe(false);
    expect(q(r.dom, '.mg-shell__timer-text').textContent).toBe('0:05');
    zone('glasses');
    vi.advanceTimersByTime(2100);
    expect(q(r.dom, '.mg-shell__timer-text').textContent).toBe('0:03');
    vi.advanceTimersByTime(3000);
    const banner = q(r.dom, '.mg-shell__result');
    expect(banner.hidden).toBe(false);
    expect(banner.dataset.outcome).toBe('partial');
    expect(q(banner, '.mg-shell__result-note').textContent).toBe('Время вышло. Найдено: 1 из 3');
    expect(r.results).toEqual([]);
    click(btn(r.dom, 'is-next'));
    expect(r.results).toEqual(['partial']);
  });

  it('время из config.time_limit_ms, если в def его нет', () => {
    vi.useFakeTimers();
    const { r } = play({}, { ...CFG, time_limit_ms: 4000 });
    expect(q(r.dom, '.mg-shell__timer-text').textContent).toBe('0:04');
  });

  it('time_limit_ms: 0 — игра без таймера', () => {
    vi.useFakeTimers();
    const { r } = play({ time_limit_ms: 0 }, { ...CFG, time_limit_ms: 0 });
    expect(q(r.dom, '.mg-shell__timer').hidden).toBe(true);
    vi.advanceTimersByTime(600000);
    expect(r.dom.querySelector('.mg-shell__result:not([hidden])')).toBeNull();
  });

  it.each([
    ['таймеры выключены в настройках', { timers: false, storyOnly: false }],
    ['режим «только история»', { timers: true, storyOnly: true }],
  ])('%s: ограничения по времени нет', (_name, settings) => {
    vi.useFakeTimers();
    const { r } = play(timed, CFG, { settings });
    expect(q(r.dom, '.mg-shell__timer').hidden).toBe(true);
    vi.advanceTimersByTime(60000);
    expect(r.dom.querySelector('.mg-shell__result:not([hidden])')).toBeNull();
  });

  it('пауза замораживает время, resume продолжает', () => {
    vi.useFakeTimers();
    const { r, m } = play(timed, CFG);
    vi.advanceTimersByTime(1000);
    m.pause();
    vi.advanceTimersByTime(60000);
    expect(r.dom.querySelector('.mg-shell__result:not([hidden])')).toBeNull();
    expect(q(r.dom, '.mg-shell__timer-text').textContent).toBe('0:04');
    m.resume();
    vi.advanceTimersByTime(3900);
    expect(r.dom.querySelector('.mg-shell__result:not([hidden])')).toBeNull();
    vi.advanceTimersByTime(300);
    expect(q(r.dom, '.mg-shell__result').dataset.outcome).toBe('fail');
  });

  it('конец партии останавливает таймер', () => {
    vi.useFakeTimers();
    const { r, zone } = play(timed, CFG);
    zone('glasses');
    zone('pills');
    zone('photo');
    vi.advanceTimersByTime(60000);
    expect(q(r.dom, '.mg-shell__result').dataset.outcome).toBe('success');
    expect(q(r.dom, '.mg-shell__result-note').textContent).toBe('Найдено: 3 из 3');
  });
});

describe('пауза', () => {
  it('на паузе (реклама, вкладка в фоне) тапы, «Пропустить» и «Далее» не засчитываются; после resume работают', () => {
    const { r, m, zone, miss } = play();
    m.pause();
    expect(q(r.dom, '.mg-shell').classList.contains('is-paused')).toBe(true);
    zone('glasses');
    miss();
    expect(q(r.dom, '.mg-shell__progress').textContent).toBe('Найдено: 0 из 3');
    click(btn(r.dom, 'is-skip'));
    expect(r.results).toEqual([]);
    m.resume();
    expect(q(r.dom, '.mg-shell').classList.contains('is-paused')).toBe(false);
    zone('glasses');
    expect(q(r.dom, '.mg-shell__progress').textContent).toBe('Найдено: 1 из 3');
    click(btn(r.dom, 'is-skip'));
    expect(r.results).toEqual(['skipped']);
  });

  it('«Далее» на паузе не засчитывается, после resume — да', () => {
    const { r, m, zone, next } = play();
    zone('glasses');
    zone('pills');
    zone('photo');
    m.pause();
    next();
    expect(r.results).toEqual([]);
    m.resume();
    next();
    expect(r.results).toEqual(['success']);
  });
});

describe('serialize / restore', () => {
  it('состояние — чистый JSON и переносится в новый экземпляр: находки, промахи, подсказки', () => {
    const a = play({ skip: { allowed: true, hint_rewarded_ad: true } }, CFG, { showRewarded: () => Promise.resolve(true) });
    a.zone('pills');
    a.zone('slippers');
    a.miss();
    const saved = JSON.parse(JSON.stringify(a.m.serialize()));

    const b = play({ skip: { allowed: true, hint_rewarded_ad: true } }, CFG, { showRewarded: () => Promise.resolve(true) });
    b.m.restore(saved);
    expect(texts(b.r.dom, '.mg-scene__item.is-found')).toEqual(['1Лекарства', '2Домашние тапочки']);
    expect(q(b.r.dom, '.mg-shell__progress').textContent).toBe('Найдено: 1 из 3');
    expect(q(b.r.dom, '.mg-shell__fails-text').textContent).toBe('Промахи: 1 из 3');
    expect(b.m.serialize()).toEqual(saved);
    // игра продолжается с того же места
    b.zone('glasses');
    b.zone('photo');
    expect(q(b.r.dom, '.mg-shell__result').dataset.outcome).toBe('success');
  });

  it('автосейв отдаёт уже обновлённое состояние', () => {
    const r = rig(defOf(TYPE, CFG), { strings: STRINGS });
    const snapshots: unknown[] = [];
    r.ctx.autosave = () => snapshots.push(JSON.parse(JSON.stringify(m.serialize())));
    const m = mountGame(createCrimeSceneSearch(), r, CFG);
    click(q(r.dom, 'button.is-start'));
    const stage = q(r.dom, '.mg-scene__stage');
    sizeOf(stage, W, H);
    click(stage, { clientX: 0.335 * W, clientY: 0.515 * H });
    expect((snapshots[0] as { t: { found: string[] } }).t.found).toEqual(['pills']);
  });

  it('окончание партии сохраняется: после загрузки снова показан итог, «Далее» отдаёт тот же результат', () => {
    const a = play();
    a.miss();
    a.miss();
    a.miss();
    const saved = JSON.parse(JSON.stringify(a.m.serialize()));
    const b = play();
    b.m.restore(saved);
    expect(q(b.r.dom, '.mg-shell__result').dataset.outcome).toBe('fail');
    expect(q(b.r.dom, '.mg-shell__result').hidden).toBe(false);
    b.next();
    expect(b.r.results).toEqual(['fail']);
  });

  it('остаток времени сохраняется и возвращается', () => {
    vi.useFakeTimers();
    const a = play({ time_limit_ms: 10000 });
    vi.advanceTimersByTime(4000);
    const saved = JSON.parse(JSON.stringify(a.m.serialize())) as { left: number };
    expect(saved.left).toBeGreaterThan(5000);
    expect(saved.left).toBeLessThanOrEqual(6000);
    const b = play({ time_limit_ms: 10000 });
    b.m.restore(saved);
    expect(q(b.r.dom, '.mg-shell__timer-text').textContent).toBe('0:06');
  });

  it('мусор в состоянии игнорируется; неизвестные зоны отбрасываются; промахи не больше лимита', () => {
    const { r, m } = play();
    m.restore('мусор');
    m.restore(null);
    m.restore(42);
    m.restore({ t: 'x', over: 'bogus', hints: -3 });
    expect(m.serialize()).toMatchObject({ over: null, hints: 0, t: { found: [], misses: 0, hinted: [] } });
    m.restore({ hints: 2, t: { found: ['pills', 'pills', 'ghost', 7], misses: 99, hinted: ['photo', 'pills'] } });
    expect(m.serialize()).toMatchObject({ hints: 2, t: { found: ['pills'], misses: 3, hinted: ['photo'] } });
    expect(q(r.dom, '.mg-shell__progress').textContent).toBe('Найдено: 1 из 3');
  });
});

describe('смена языка и уничтожение', () => {
  it('подписи перерисовываются на лету, прогресс сохраняется', () => {
    const { r, zone, miss } = play({}, CFG, { introKey: 'mini.intro' });
    zone('pills');
    miss();
    r.setStrings({
      ...STRINGS,
      'mini.m1.title': 'Scene search',
      'mini.intro': 'Search the room',
      'hs.pills': 'Pills',
      'ui.minigame.found': 'Found: {n} of {total}',
      'ui.minigame.misses': 'Misses: {n} of {max}',
      'ui.minigame.nothing_here': 'Nothing here',
      'ui.minigame.skip': 'Skip',
    });
    r.fireLanguageChange();
    expect(q(r.dom, '.mg-shell__title').textContent).toBe('Scene search');
    expect(q(r.dom, '.mg-shell__intro').textContent).toBe('Search the room');
    expect(q(r.dom, '.mg-shell__progress').textContent).toBe('Found: 1 of 3');
    expect(q(r.dom, '.mg-shell__fails-text').textContent).toBe('Misses: 1 of 3');
    expect(q(r.dom, '.mg-shell__status').textContent).toBe('Nothing here');
    expect(texts(r.dom, '.mg-scene__item.is-found')).toEqual(['1Pills']);
    expect(q(r.dom, '.mg-scene__zone[data-id="pills"] .mg-scene__tag').textContent).toBe('Pills');
    expect(q(r.dom, 'button.is-skip').textContent).toBe('Skip');
  });

  it('итог тоже переводится', () => {
    const { r, miss } = play();
    miss();
    miss();
    miss();
    r.setStrings({ ...STRINGS, 'ui.minigame.fail': 'Failure', 'ui.common.next': 'Next' });
    r.fireLanguageChange();
    expect(q(r.dom, '.mg-shell__result-title').textContent).toBe('Failure');
    expect(q(r.dom, 'button.is-next').textContent).toBe('Next');
  });

  it('destroy убирает разметку, отписывается от смены языка, гасит таймеры; повторный вызов безопасен', () => {
    vi.useFakeTimers();
    const { r, m, zone } = play({ time_limit_ms: 10000 });
    vi.advanceTimersByTime(0); // jsdom ставит нулевой таймер выделения при focus() поля после «Начать осмотр»
    expect(r.listenerCount()).toBe(1);
    m.destroy();
    expect(r.dom.querySelector('.mg-shell')).toBeNull();
    expect(r.listenerCount()).toBe(0);
    m.destroy();
    expect(vi.getTimerCount()).toBe(0);
    zone('glasses'); // нет поля — ничего не происходит
    expect(r.results).toEqual([]);
  });

  it('после destroy тайм-аут не вызывает onResult', () => {
    vi.useFakeTimers();
    const { r, m } = play({ time_limit_ms: 2000 });
    m.destroy();
    vi.advanceTimersByTime(10000);
    expect(r.results).toEqual([]);
  });
});

describe('запасной вариант', () => {
  it('config без зон → grey-box: эпизод остаётся проходимым, пропуск и исходы работают', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bad = { scene_bg: 'bg_x', max_misses: 3 };
    const r = rig(defOf(TYPE, bad), { strings: STRINGS });
    const m = mountGame(createCrimeSceneSearch(), r, bad);
    expect(r.dom.querySelector('.mg-gb')).not.toBeNull();
    expect(r.dom.querySelector('.mg-scene')).toBeNull();
    expect(m.serialize()).toEqual({ hintsShown: 0 });
    m.pause();
    expect(r.dom.querySelector('.mg-gb.is-paused')).not.toBeNull();
    m.resume();
    q(r.dom, '.mg-btn.is-partial').click();
    q(r.dom, '.mg-btn.is-partial').click();
    expect(r.results).toEqual(['partial']);
    m.destroy();
    expect(r.dom.querySelector('.mg-gb')).toBeNull();
  });
});

describe('регистрация', () => {
  it('реестр создаёт настоящую игру для crime_scene_search', () => {
    registerBuiltinMinigames();
    const m = createMinigame(TYPE);
    const r = rig(defOf(TYPE, CFG), { strings: STRINGS });
    mountGame(m, r, CFG);
    expect(r.dom.querySelector('.mg-scene')).not.toBeNull();
    m.destroy();
  });
});

describe.skipIf(!hasRepoContent())('настоящая мини-игра ep01 (mg_scene)', () => {
  const episode = loadEpisode(EP01_PATH);
  const def = episode.minigames?.mg_scene;
  const strings = loadStrings('ru', episode.id);

  it('config валиден для настоящей механики, подписи — из локали ru', () => {
    expect(def).toBeDefined();
    if (!def) return;
    expect(parseSceneConfig(def.config)).not.toBeNull();
    const r = rig(def, { episode, strings: { ...UI, ...strings }, ctx: { introKey: 'ep01.mg_scene.intro' } });
    mountGame(createCrimeSceneSearch(), r, def.config);
    expect(r.dom.querySelector('.mg-gb')).toBeNull();
    expect(q(r.dom, '.mg-shell__title').textContent).toBe('Осмотр квартиры');
    expect(q(r.dom, '.mg-shell__intro').textContent).toContain('Осмотрите квартиру');
    expect(texts(r.dom, '.mg-scene__tag')).toEqual(['Очки на тумбочке', 'Лекарства, разложенные по часам', 'Фотография внука', 'Домашние тапочки у двери']);
    expect(q(r.dom, '.mg-shell__progress').textContent).toBe('Найдено: 0 из 3');
  });

  it('все три обязательные зоны находятся тапом по центру → success; пропуск ждёт первого промаха (after_fails: 1)', () => {
    if (!def) return;
    const cfg = def.config as { hotspots: Array<{ id: string; rect: Rect; required: boolean }> };
    const r = rig(def, { episode, strings: { ...UI, ...strings } });
    const m = mountGame(createCrimeSceneSearch(), r, def.config);
    click(q(r.dom, 'button.is-start'));
    const stage = q(r.dom, '.mg-scene__stage');
    sizeOf(stage, 360, 202); // телефон без панорамы: самый тесный случай
    expect(btn(r.dom, 'is-skip')).toBeNull();
    for (const hs of cfg.hotspots.filter((x) => x.required)) {
      click(stage, { clientX: (hs.rect[0] + hs.rect[2] / 2) * 360, clientY: (hs.rect[1] + hs.rect[3] / 2) * 202 });
    }
    expect(q(r.dom, '.mg-shell__result').dataset.outcome).toBe('success');
    click(btn(r.dom, 'is-next'));
    expect(r.results).toEqual(['success']);
    m.destroy();
  });

  it('первый промах открывает «Пропустить» (after_fails: 1)', () => {
    if (!def) return;
    const r = rig(def, { episode, strings: { ...UI, ...strings } });
    mountGame(createCrimeSceneSearch(), r, def.config);
    click(q(r.dom, 'button.is-start'));
    const stage = q(r.dom, '.mg-scene__stage');
    sizeOf(stage, 360, 202);
    click(stage, { clientX: 0.95 * 360, clientY: 0.05 * 202 });
    expect(btn(r.dom, 'is-skip')).not.toBeNull();
  });
});

describe('режим списка (режим дела)', () => {
  const POOL = Array.from({ length: 12 }, (_, i) => ({
    id: `i${i}`,
    rect: [0.05 + (i % 4) * 0.24, 0.1 + Math.floor(i / 4) * 0.3, 0.06, 0.06],
    label_key: `hs.i${i}`,
    required: i === 7,
  }));
  const LIST = { scene_bg: 'bg_x', list: true, pick: 5, seed: 0, hotspots: POOL, max_misses: 20 };
  const ids = (seed: number, id = 'case_flat'): string[] => parseSceneConfig({ ...LIST, seed }, id)?.hotspots.map((h) => h.id) ?? [];

  it('за заход — pick зон; обязательная всегда в списке; все выбранные обязательны', () => {
    const c = parseSceneConfig(LIST, 'case_flat');
    expect(c?.list).toBe(true);
    expect(c?.hotspots).toHaveLength(5);
    expect(c?.hotspots.map((h) => h.id)).toContain('i7');
    expect(c?.hotspots.every((h) => h.required)).toBe(true);
  });

  it('тот же seed — тот же список и порядок; другой seed — другой набор', () => {
    expect(ids(0)).toEqual(ids(0));
    const sets = new Set([0, 1, 2, 3, 4].map((s) => [...ids(s)].sort().join(',')));
    expect(sets.size).toBeGreaterThan(1);
    for (const s of [0, 1, 2, 3, 4]) expect(ids(s)).toContain('i7');
  });

  it('pick больше пула — берутся все зоны', () => {
    expect(parseSceneConfig({ ...LIST, pick: 50 }, 'x')?.hotspots).toHaveLength(12);
  });

  it('список целей виден сразу; найденная отмечается; тап по невыбранной зоне — промах', () => {
    const g = play({}, LIST);
    const chosen = parseSceneConfig(LIST, g.r.ctx.def.id)?.hotspots ?? [];
    expect(texts(g.r.dom, '.mg-scene__list .mg-scene__item .mg-scene__name')).toEqual(chosen.map((h) => `[hs.${h.id}]`));
    const first = chosen[0];
    if (!first) throw new Error('пустой список');
    g.zone(first.id);
    expect(q(g.r.dom, `.mg-scene__item[data-id="${first.id}"]`).classList.contains('is-found')).toBe(true);
    const outside = POOL.find((h) => !chosen.some((c) => c.id === h.id));
    if (!outside) throw new Error('все зоны выбраны');
    g.zone(outside.id);
    expect(texts(g.r.dom, '.mg-shell__fails-text')[0]).toMatch(/1/);
  });

  it('найдено всё из списка — success; итог виден в serialize до onResult', () => {
    const g = play({}, LIST);
    for (const h of parseSceneConfig(LIST, g.r.ctx.def.id)?.hotspots ?? []) g.zone(h.id);
    const s = g.m.serialize() as { over: string; t: { found: string[]; misses: number } };
    expect(s.over).toBe('success');
    expect(s.t.found).toHaveLength(5);
    g.next();
    expect(g.r.results).toEqual(['success']);
  });
});
