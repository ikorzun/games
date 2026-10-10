// @vitest-environment jsdom
/**
 * Stage с камкордером (src/stage/stage.ts): слои кадра (дрожание только на картинке, текст и интерфейс
 * не затрагиваются), HUD записи только в reconstruction, «оператор поправил кадр» при входе в сцену,
 * fx zoom_in / freeze_frame / vhs_glitch, пауза, мини-игра, ожидание картинок перед сменой сцены.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultViewFor } from '../src/core/interpreter';
import type { Presentation, ViewState } from '../src/core/types';
import { AssetCatalog, AssetStore, StoreSceneAssets } from '../src/stage/assets';
import type { ImageHandle, ImageLoader } from '../src/stage/assets';
import { mulberry32 } from '../src/stage/camcorder';
import type { Overlay2D } from '../src/stage/camcorder_layer';
import { DomSceneRenderer } from '../src/stage/renderer_dom';
import { Stage } from '../src/stage/stage';
import { miniEpisode } from './helpers/mini';

class FakeCtx implements Overlay2D {
  fillStyle: string | CanvasGradient | CanvasPattern = '';
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  fills = 0;
  fillRect(): void {
    this.fills += 1;
  }
  clearRect(): void {
    /* ничего */
  }
  putImageData(): void {
    /* ничего */
  }
  createImageData(w: number, h: number): ImageData {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h } as ImageData;
  }
}

const episode = miniEpisode({ s1: { steps: [{ do: 'end', ending: 'e_main' }] } });
episode.assets = { backgrounds: [{ id: 'bg_a', path: 'assets/ep01/bg/a.webp' }, { id: 'bg_b', path: 'assets/ep01/bg/b.webp' }] };

const view = (presentation: Presentation, over: Partial<ViewState> = {}): ViewState => ({ ...defaultViewFor(episode, 's1'), presentation, ...over });
const flush = async (n = 8): Promise<void> => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

interface Rig {
  stage: Stage;
  ctx: FakeCtx;
  /** Кадры анимации камкордера. */
  frames: (ms: number, from?: number) => void;
  hand: HTMLElement;
  cam: HTMLElement;
  scene: HTMLElement;
  state: { reduced: boolean };
}

const stages: Stage[] = [];

async function rig(opts: { loader?: ImageLoader; reduced?: boolean } = {}): Promise<Rig> {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  let pending: Array<(ts: number) => void> = [];
  const state = { reduced: opts.reduced ?? false };
  const ctx = new FakeCtx();
  const store = new AssetStore({ loadImage: opts.loader ?? (() => Promise.reject(new Error('404'))), warn: () => undefined });
  const assets = new StoreSceneAssets(new AssetCatalog(episode, './'), store);
  const stage = new Stage(new DomSceneRenderer(assets), {
    assets,
    camcorder: {
      rng: mulberry32(4),
      raf: (cb) => (pending.push(cb), pending.length),
      caf: () => {
        pending = [];
      },
      reducedMotion: () => state.reduced,
      onReducedMotionChange: () => () => undefined,
      isHidden: () => false,
      context: ctx,
    },
  });
  stages.push(stage);
  await stage.mount(parent);
  return {
    stage,
    ctx,
    state,
    frames: (ms, from = 0) => {
      for (let t = from; t <= from + ms; t += 16) {
        const batch = pending;
        pending = [];
        for (const cb of batch) cb(t);
      }
    },
    hand: stage.el.querySelector('.vn-stage__hand') as HTMLElement,
    cam: stage.el.querySelector('.vn-stage__cam') as HTMLElement,
    scene: stage.el.querySelector('.vn-stage__scene') as HTMLElement,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
});
afterEach(() => {
  vi.useRealTimers();
  for (const s of stages.splice(0)) s.destroy();
  document.body.replaceChildren();
});

describe('Stage: слои кадра — дрожание только у картинки', () => {
  it('порядок слоёв: host → cam → grade → hand → scene; холст помех и HUD — рядом со сценой, титры — отдельный слой поверх', async () => {
    const { stage } = await rig();
    const q = (sel: string): HTMLElement => stage.el.querySelector(sel) as HTMLElement;
    expect(q('.vn-stage__scene > .vn-stage__hand > .vn-stage__grade > .vn-stage__cam > .vn-stage__host')).not.toBeNull();
    // дрожащая обёртка не содержит ничего, кроме цепочки до картинки
    const hand = q('.vn-stage__hand');
    expect(hand.querySelectorAll(':scope > *')).toHaveLength(1);
    for (const outside of ['.vn-stage__camfx', '.vn-stage__hud', '.vn-stage__captions', '.vn-stage__letterbox', '.vn-stage__vignette']) {
      expect(hand.contains(q(outside)), outside).toBe(false);
      expect(q('.vn-stage__scene').contains(q(outside)), outside).toBe(false);
    }
    // порядок в DOM: холст помех над сценой, но под титрами и HUD (подписи остаются чистыми)
    const order = [...stage.el.children].map((c) => c.className.split(' ')[0]);
    expect(order.indexOf('vn-stage__camfx')).toBeGreaterThan(order.indexOf('vn-stage__scene'));
    expect(order.indexOf('vn-stage__captions')).toBeGreaterThan(order.indexOf('vn-stage__camfx'));
    expect(order.indexOf('vn-stage__hud')).toBeGreaterThan(order.indexOf('vn-stage__camfx'));
    // титры доступны для UI и лежат вне обёртки
    expect(stage.captionsEl.closest('.vn-stage__hand')).toBeNull();
  });

  it('текст, добавленный в слой титров, не попадает под трансформацию обёртки', async () => {
    const { stage, hand, frames } = await rig();
    stage.setView(view('reconstruction'));
    const cap = document.createElement('div');
    cap.className = 'vn-cap';
    cap.textContent = 'МОСКВА, 1993';
    stage.captionsEl.appendChild(cap);
    frames(400);
    expect(hand.style.transform).not.toBe('');
    expect(cap.closest('.vn-stage__hand')).toBeNull();
    expect(cap.style.transform).toBe('');
    expect(stage.captionsEl.style.transform).toBe('');
  });

  it('данные кадра: режим показа, фильтр и тип камеры выставлены классами и атрибутами', async () => {
    const { stage } = await rig();
    stage.setView(view('reconstruction', { filter: 'vhs_heavy', letterbox: true }));
    expect(stage.el.dataset.presentation).toBe('reconstruction');
    expect(stage.el.dataset.filter).toBe('vhs_heavy');
    expect(stage.el.classList.contains('filter-vhs_heavy')).toBe(true);
    expect(stage.el.classList.contains('has-letterbox')).toBe(true);
    stage.setView(view('chronicle'));
    expect(stage.el.classList.contains('filter-archive_photo')).toBe(true); // умолчание пресета
    expect(stage.el.classList.contains('filter-vhs_heavy')).toBe(false);
    expect((stage.el.querySelector('.vn-stage__cam') as HTMLElement).dataset.camera).toBe('ken_burns');
  });
});

describe('Stage: HUD записи и эффекты камеры', () => {
  it('cam-rec (REC и точка) — только в reconstruction при включённых эффектах', async () => {
    const { stage } = await rig();
    for (const [p, rec] of [
      ['reconstruction', true],
      ['procedural', false],
      ['chronicle', false],
      ['talking_head', false],
      ['courtroom', false],
      ['title', false],
      ['montage', false],
    ] as const) {
      stage.setView(view(p));
      expect(stage.el.classList.contains('cam-rec'), p).toBe(rec);
    }
    stage.setView(view('reconstruction'));
    stage.setCameraFx('off');
    expect(stage.el.classList.contains('cam-rec')).toBe(false);
    expect(stage.el.classList.contains('cam-on')).toBe(false);
    stage.setCameraFx('high');
    expect(stage.el.classList.contains('cam-rec')).toBe(true);
    expect(stage.el.dataset.cam).toBe('high');
  });

  it('REC — моноширинная подпись без перевода; точка и текст внутри картинки (в слое HUD)', async () => {
    const { stage } = await rig();
    const hud = stage.el.querySelector('.vn-stage__hud') as HTMLElement;
    expect(hud.querySelector('.vn-rec__text')?.textContent).toBe('REC');
    expect(hud.querySelector('.vn-rec__dot')).not.toBeNull();
    expect(hud.getAttribute('aria-hidden')).toBe('true');
  });

  it('prefers-reduced-motion выключает эффекты принудительно', async () => {
    const { stage } = await rig({ reduced: true });
    stage.setCameraFx('high');
    stage.setView(view('reconstruction'));
    expect(stage.camcorder.effectiveLevel).toBe('off');
    expect(stage.camcorder.running).toBe(false);
    expect(stage.el.classList.contains('cam-rec')).toBe(false);
  });

  it('сцена на экране → камкордер идёт; пауза платформы останавливает; мини-игра гасит и сбрасывает трансформацию', async () => {
    const { stage, frames, hand } = await rig();
    expect(stage.camcorder.running).toBe(false); // сцены ещё нет
    stage.setView(view('reconstruction'));
    expect(stage.camcorder.running).toBe(true);
    frames(300);
    expect(hand.style.transform).not.toBe('');
    stage.setPaused(true);
    expect(stage.camcorder.running).toBe(false);
    expect(stage.paused).toBe(true);
    stage.setPaused(false);
    expect(stage.camcorder.running).toBe(true);
    stage.setMinigameActive(true);
    expect(stage.camcorder.running).toBe(false);
    expect(hand.style.transform).toBe('');
    expect(stage.el.classList.contains('is-minigame')).toBe(true);
    stage.setMinigameActive(false);
    expect(stage.camcorder.running).toBe(true);
  });

  it('«оператор поправил кадр»: при входе в сцену (changeScene), но не при загрузке/откате (setView)', async () => {
    const { stage, frames } = await rig();
    stage.setView(view('reconstruction'));
    frames(500);
    const calm = stage.camcorder.lastFrame!;
    await stage.changeScene(view('reconstruction', { scene: 's2' }), 'cut', false);
    frames(32, 520);
    const kicked = stage.camcorder.lastFrame!;
    expect(Math.max(Math.abs(kicked.tx), Math.abs(kicked.ty), Math.abs(kicked.rot))).toBeGreaterThan(1);
    expect(kicked.scale).toBeGreaterThan(calm.scale);
    // после загрузки сейва (setView) кадр не дёргается
    stage.setView(view('reconstruction', { scene: 's3' }));
    frames(5000, 600);
    const loaded = stage.camcorder.lastFrame!;
    expect(Math.abs(loaded.tx)).toBeLessThanOrEqual(1.2 + 1e-9);
    // мгновенный режим (Skip): поправки нет
    await stage.changeScene(view('reconstruction', { scene: 's4' }), 'cut', true);
    frames(32, 6000);
    expect(Math.abs(stage.camcorder.lastFrame!.tx)).toBeLessThanOrEqual(1.2 + 1e-9);
  });

  it('в хронике (штатив) вход в сцену ничего не двигает', async () => {
    const { stage, frames } = await rig();
    stage.setView(view('chronicle'));
    await stage.changeScene(view('chronicle', { scene: 's2' }), 'cut', false);
    frames(100, 0);
    const f = stage.camcorder.lastFrame!;
    expect([f.tx, f.ty, f.rot, f.scale]).toEqual([0, 0, 0, 1]);
  });
});

describe('Stage: fx камкордера', () => {
  it('freeze_frame: на время эффекта кадр замирает и слегка темнеет (класс fx-freeze), затем всё возвращается', async () => {
    const { stage, frames } = await rig();
    stage.setView(view('reconstruction'));
    frames(300);
    const done = stage.playFx('freeze_frame', 1200, 1, false);
    await flush();
    expect(stage.el.classList.contains('fx-freeze')).toBe(true);
    expect(stage.camcorder.scheduler.isFrozen).toBe(true);
    await vi.advanceTimersByTimeAsync(1300);
    await done;
    expect(stage.el.classList.contains('fx-freeze')).toBe(false);
    expect(stage.camcorder.scheduler.isFrozen).toBe(false);
  });

  it('zoom_in без Web Animations (jsdom): наезд до 1,12 остаётся до конца сцены; intensity масштабирует; смена сцены сбрасывает', async () => {
    const { stage, cam } = await rig();
    stage.setView(view('procedural'));
    const p = stage.playFx('zoom_in', 800, 1, false);
    await vi.advanceTimersByTimeAsync(900);
    await p;
    expect(cam.style.transform).toBe('scale(1.1200)');
    stage.setView(view('procedural', { scene: 's2' }));
    expect(cam.style.transform).toBe('');
    const half = stage.playFx('zoom_in', 700, 0.4, false);
    await vi.advanceTimersByTimeAsync(800);
    await half;
    expect(cam.style.transform).toBe('scale(1.0480)');
    // мгновенный режим (Skip) — сразу итоговое состояние
    stage.setView(view('procedural', { scene: 's3' }));
    await stage.playFx('zoom_in', 900, 1, true);
    expect(cam.style.transform).toBe('scale(1.1200)');
  });

  it('zoom_in с Web Animations: ключевые кадры 1,00 → 1,12 с перелётом и размытием «поиска фокуса»; при выключенных эффектах — без них', async () => {
    const calls: Array<{ kf: Array<{ transform: string; filter: string }>; opts: { duration: number } }> = [];
    const animate = vi.fn((kf: Array<{ transform: string; filter: string }>, opts: { duration: number }) => {
      calls.push({ kf, opts });
      return { finished: Promise.resolve(), cancel: vi.fn() };
    });
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
    try {
      const on = await rig();
      on.stage.setView(view('procedural'));
      const p = on.stage.playFx('zoom_in', 900, 1, false);
      await vi.advanceTimersByTimeAsync(1100);
      await p;
      expect(calls).toHaveLength(1);
      expect(calls[0]!.opts.duration).toBe(900);
      const kf = calls[0]!.kf;
      expect(kf[0]!.transform).toBe('scale(1.0000)');
      expect(kf.at(-1)!.transform).toBe('scale(1.1200)');
      expect(kf.some((k) => Number(/scale\(([\d.]+)\)/.exec(k.transform)![1]) > 1.12)).toBe(true); // перелёт
      expect(kf.some((k) => k.filter.startsWith('blur('))).toBe(true); // поиск фокуса
      expect(on.cam.style.transform).toBe('scale(1.1200)'); // итог закреплён
      const off = await rig();
      off.stage.setCameraFx('off');
      off.stage.setView(view('procedural'));
      const q = off.stage.playFx('zoom_in', 900, 1, false);
      await vi.advanceTimersByTimeAsync(1100);
      await q;
      const kfOff = calls[1]!.kf;
      expect(kfOff.every((k) => k.filter === 'none')).toBe(true);
      expect(Math.max(...kfOff.map((k) => Number(/scale\(([\d.]+)\)/.exec(k.transform)![1])))).toBeLessThanOrEqual(1.12 + 1e-9);
    } finally {
      delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    }
  });

  it('vhs_glitch (fx): разрыв кадра рисует камкордер (CSS-класса нет); при выключенных эффектах — запасной CSS-вариант', async () => {
    const on = await rig();
    on.stage.setView(view('reconstruction'));
    on.frames(100);
    const p = on.stage.playFx('vhs_glitch', 600, 1, false);
    await flush();
    expect(on.scene.classList.contains('fx-glitch')).toBe(false);
    on.frames(700, 116);
    expect(on.ctx.fills).toBeGreaterThan(20); // шумовые полосы разрыва
    await vi.advanceTimersByTimeAsync(700);
    await p;
    const off = await rig();
    off.stage.setCameraFx('off');
    off.stage.setView(view('reconstruction'));
    const q = off.stage.playFx('vhs_glitch', 600, 1, false);
    await flush();
    expect(off.scene.classList.contains('fx-glitch')).toBe(true);
    await vi.advanceTimersByTimeAsync(700);
    await q;
    expect(off.scene.classList.contains('fx-glitch')).toBe(false);
  });

  it('переход vhs_glitch между сценами: смена кадра в середине разрыва', async () => {
    const { stage, frames } = await rig();
    stage.setView(view('reconstruction', { bg: 'bg_a' }));
    frames(100);
    const swapped: string[] = [];
    const p = stage.changeScene(view('reconstruction', { scene: 's2', bg: 'bg_b' }), 'vhs_glitch', false);
    await flush();
    await vi.advanceTimersByTimeAsync(100);
    swapped.push(stage.currentView!.bg);
    await vi.advanceTimersByTimeAsync(200);
    swapped.push(stage.currentView!.bg);
    await vi.advanceTimersByTimeAsync(400);
    await p;
    expect(swapped).toEqual(['bg_a', 'bg_b']); // 460 мс × 0,48 ≈ 220 мс
  });
});

describe('Stage: ожидание картинок перед сменой сцены', () => {
  it('changeScene ждёт загрузки картинок сцены, а setView во время ожидания отменяет устаревшую смену', async () => {
    const waiting = new Map<string, () => void>();
    const loader: ImageLoader = (url) =>
      new Promise<ImageHandle>((resolve) => void waiting.set(url, () => resolve({ url, image: {} as HTMLImageElement, width: 10, height: 10 })));
    const { stage } = await rig({ loader });
    let done = false;
    const p = stage.changeScene(view('procedural', { scene: 's2', bg: 'bg_b' }), 'cut', false).then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    expect(stage.currentView).toBeNull(); // пустоты на экране нет: смена ещё не произошла
    waiting.get('./assets/ep01/bg/b.webp')!();
    await flush();
    expect(stage.currentView?.scene).toBe('s2'); // картинка пришла — сцена сменилась (дальше идёт проявление из чёрного)
    await vi.advanceTimersByTimeAsync(700);
    await p;
    expect(done).toBe(true);
    // загрузка сейва во время ожидания отменяет устаревшую смену
    const p2 = stage.changeScene(view('procedural', { scene: 's3', bg: 'bg_a' }), 'cut', false);
    await flush();
    stage.setView(view('procedural', { scene: 's9', bg: 'bg_b' }));
    waiting.get('./assets/ep01/bg/a.webp')!();
    await flush();
    await p2;
    expect(stage.currentView?.scene).toBe('s9');
  });

  it('картинки уже в памяти или файлов нет совсем — смена кадра без задержки', async () => {
    const { stage } = await rig(); // загрузчик отвечает «404» на всё
    await stage.changeScene(view('procedural', { scene: 's2', bg: 'bg_b' }), 'cut', true);
    expect(stage.currentView?.scene).toBe('s2');
  });
});

describe('Stage: чёрный кадр перед рекламой (поведение не изменилось)', () => {
  it('fadeToBlackAndHold держит чёрный, revealFromBlack проявляет новую сцену', async () => {
    const { stage } = await rig();
    stage.setView(view('procedural'));
    const hold = stage.fadeToBlackAndHold('fade', false);
    await vi.advanceTimersByTimeAsync(400);
    await hold;
    expect(stage.holdingBlack).toBe(true);
    const reveal = stage.revealFromBlack(view('procedural', { scene: 's2', bg: 'bg_b' }), 'fade', false);
    await vi.advanceTimersByTimeAsync(600);
    await reveal;
    expect(stage.holdingBlack).toBe(false);
    expect(stage.currentView?.scene).toBe('s2');
  });
});
