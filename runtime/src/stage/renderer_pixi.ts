/**
 * PixiJS-рендерер сцены. Рисует настоящие картинки (фон, CG, спрайты) из ассетов эпизода, а если
 * файла нет — плейсхолдер: фон — прямоугольник цвета hash(id) с подписью id, спрайт — прямоугольник
 * с именем и выражением. Подгружается лениво (динамический import из stage_factory), чтобы PixiJS
 * не тормозил первый кадр меню и чтобы при отсутствии WebGL игра продолжила работу на DOM-рендерере.
 *
 * Состояние слота (фон, CG, спрайт): `none` (ничего не просили) → `loading` (картинка грузится:
 * остаётся прежнее, а у нового спрайта — пустота, но не плейсхолдер) → `image` или `placeholder`
 * (файла нет). Кадр рисуется по требованию, а не 60 раз в секунду: в покое WebGL не работает
 * (батарея телефона). Камкордер (camcorder_layer.ts) присылает кадр записи ~30 раз в секунду: движение камеры
 * и искажения аналоговой записи рисует шейдер на всём кадре (vhs_filter.ts) — это и есть перерисовка.
 * Исключение — мини-игры: пока слой мини-игр активен, рендер непрерывный.
 *
 * Спрайты: рост ≈ высота сцены (SPRITE_FIT), но не шире SPRITE_MAX_WIDTH ширины; три позиции
 * left / center / right, offscreen_* не рисуются. Говорящего подсвечивают затемнением остальных
 * (tint), силуэт без собственного файла — чёрный кадр с прозрачностью .85.
 */
import { Application, Container, defaultFilterVert, GlProgram, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import type { WebGLRenderer } from 'pixi.js';
import type { ViolenceMode } from '../core/settings';
import type { SpriteView, TransitionKind, ViewState } from '../core/types';
import { NO_ASSETS } from './assets';
import type { ImageChain, ImageHandle, SceneAssets } from './assets';
import { hslToInt, placeholderHsl, placeholderLabel } from './placeholders';
import { isOffscreen, POSITION_X, SILHOUETTE_ALPHA, SPRITE_FIT, SPRITE_MAX_WIDTH, wantFlip } from './renderer';
import type { ISceneRenderer, SlotStates } from './renderer';
import type { CamFrame, SignalProfile } from './camcorder';
import { VHS_FRAGMENT, VhsFilter } from './vhs_filter';
import { fadeAt, fadeDone, FOCUS_DIM, FOCUS_DIM_MEMORY, FOCUS_FRAGMENT, FOCUS_MS, FocusFilter } from './focus_filter';
import { DITHER_CELL, DITHER_FRAGMENT, DitherFilter } from './dither_filter';
import type { FocusFade } from './focus_filter';

const FONT = 'PT Sans, Noto Sans, Arial, sans-serif';
/** y текстуры фильтра PixiJS идёт сверху вниз (проверено: полоса головок — внизу кадра). */
const VHS_Y_DOWN = true;
/** Бюджет текстур в видеопамяти, байт (≈ 14 кадров 1920×1080). Телефоны выдерживают это с запасом. */
const TEXTURE_BUDGET = 120 * 1024 * 1024;
/** Множитель яркости остальных, когда говорит кто-то другой. */
const DIM_TINT = 0x9e9e9e;

interface Tween {
  from: number;
  to: number;
  t0: number;
  ms: number;
  done?: () => void;
}

type Mode = 'none' | 'loading' | 'image' | 'placeholder' | 'solid';

/** Маска того, на ком внимание, на текущем кадре покрытия: адрес, текстура (null — грузится) и вес во времени. */
interface FocusSlot {
  url: string;
  tex: Texture | null;
  fade: FocusFade;
}

interface SpriteNode {
  view: SpriteView;
  box: Container;
  body: Graphics;
  name: Text;
  expr: Text;
  pic: Sprite;
  mode: Mode;
  /** Силуэт без собственного файла: рисуем чёрным из обычного кадра. */
  derivedSilhouette: boolean;
  url: string | null;
  fade: number;
  dim: number;
  tween: Tween | null;
  token: number;
  /** Зеркалить по горизонтали — поворот к собеседнику (renderer.ts, wantFlip). */
  flip: boolean;
}

interface Slot {
  mode: Mode;
  url: string | null;
  token: number;
  /** Сплошной цвет (режим solid), 0xRRGGBB. */
  color: number;
}

function makeText(size: number, weight: '400' | '700', fill = 0xffffff): Text {
  const t = new Text({
    text: '',
    style: {
      fontFamily: FONT,
      fontSize: size,
      fontWeight: weight,
      fill,
      align: 'center',
      stroke: { color: 0x000000, width: Math.max(2, size / 6) },
      wordWrap: true,
      wordWrapWidth: 300,
    },
  });
  t.anchor.set(0.5);
  return t;
}

/** Кеш текстур по URL: бюджет по оценке байт, вытесняются давно не использованные и не показанные сейчас. */
class TextureCache {
  private readonly map = new Map<string, { tex: Texture; bytes: number; used: number }>();
  private total = 0;
  private clock = 0;

  get(handle: ImageHandle, inUse: ReadonlySet<string>): Texture {
    let e = this.map.get(handle.url);
    if (!e) {
      const tex = Texture.from({ resource: handle.image, autoGenerateMipmaps: true }, true);
      e = { tex, bytes: handle.width * handle.height * 4, used: 0 };
      this.map.set(handle.url, e);
      this.total += e.bytes;
    }
    e.used = ++this.clock;
    this.trim(new Set([...inUse, handle.url]));
    return e.tex;
  }

  private trim(inUse: ReadonlySet<string>): void {
    if (this.total <= TEXTURE_BUDGET) return;
    const victims = [...this.map.entries()].filter(([url]) => !inUse.has(url)).sort((a, b) => a[1].used - b[1].used);
    for (const [url, e] of victims) {
      if (this.total <= TEXTURE_BUDGET) break;
      this.map.delete(url);
      this.total -= e.bytes;
      e.tex.destroy(true);
    }
  }

  destroy(): void {
    for (const e of this.map.values()) e.tex.destroy(true);
    this.map.clear();
    this.total = 0;
  }
}

export class PixiSceneRenderer implements ISceneRenderer {
  readonly kind = 'pixi' as const;
  /** Слой для мини-игр (IMinigame.mount получает его как root). */
  readonly minigameRoot = new Container();

  private app!: Application;
  private host!: HTMLElement;
  /** Шейдер записи камкордера (создаётся при первом кадре камкордера). */
  private vhs: VhsFilter | null = null;
  /** Шейдер проверен: true — работает, false — нет, null — ещё не проверяли. */
  private vhsOk: boolean | null = null;
  private vhsFrame = 0;
  private observer: ResizeObserver | null = null;
  private readonly bgLayer = new Container();
  private readonly spriteLayer = new Container();
  /** Кадр покрытия: между спрайтами и CG; когда показан, слой спрайтов выключен. */
  private readonly shotLayer = new Container();
  private readonly shotPic = new Sprite();
  private readonly cgLayer = new Container();
  /** Растворение: снимок прежнего кадра поверх нового, гаснет (crossfade). */
  private readonly fadeLayer = new Container();
  private fade: { pic: Sprite; t0: number; ms: number; dither: DitherFilter | null } | null = null;
  /** Графика: «Воспоминания» — мягче подсветка, растворение точками; шейдер точек проверен (null — ещё нет). */
  private graphics: 'real' | 'memory' = 'real';
  private ditherOk: boolean | null = null;
  private readonly bgG = new Graphics();
  private readonly bgLabel = makeText(28, '700');
  private readonly bgTag = makeText(14, '400');
  private readonly bgPic = new Sprite();
  private readonly cgG = new Graphics();
  private readonly cgLabel = makeText(24, '700');
  private readonly cgPic = new Sprite();
  private readonly nodes = new Map<string, SpriteNode>();
  private readonly textures = new TextureCache();
  private readonly bgSlot: Slot = { mode: 'none', url: null, token: 0, color: 0 };
  private readonly cgSlot: Slot = { mode: 'none', url: null, token: 0, color: 0 };
  private readonly shotSlot: Slot = { mode: 'none', url: null, token: 0, color: 0 };
  private bgId = '';
  private cgId: string | null = null;
  private shotId: string | null = null;
  private speaker: string | null = null;
  /** Подсветка того, на ком внимание (focus_filter.ts): прежняя маска гаснет, новая проявляется. */
  private focusWho: string | null = null;
  private focusCur: FocusSlot | null = null;
  private focusPrev: FocusSlot | null = null;
  private focusFilter: FocusFilter | null = null;
  private focusOk: boolean | null = null;
  /** Когда сменился кадр: фокус сразу после склейки переключается без перехода. */
  private shotCutAt = -Infinity;
  private violence: ViolenceMode = 'full';
  /** Спрайты, уходящие со сцены: их уже нет в nodes, но анимация исчезновения доигрывается. */
  private readonly leaving = new Set<SpriteNode>();
  private cgFade = 1;
  private destroyed = false;
  /** Рисовать каждый кадр (идёт мини-игра) / нужен один кадр после изменений. */
  private continuous = false;
  private dirty = true;

  constructor(private readonly assets: SceneAssets = NO_ASSETS) {}

  async mount(host: HTMLElement): Promise<void> {
    this.host = host;
    const app = new Application();
    const rect = host.getBoundingClientRect();
    await app.init({
      width: Math.max(2, Math.round(rect.width)),
      height: Math.max(2, Math.round(rect.height)),
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: 'webgl',
    });
    this.app = app;
    host.appendChild(app.canvas);
    app.canvas.classList.add('vn-canvas');

    this.bgPic.anchor.set(0.5);
    this.cgPic.anchor.set(0.5);
    this.shotPic.anchor.set(0.5);
    this.bgPic.visible = false;
    this.cgPic.visible = false;
    this.shotPic.visible = false;
    this.bgLayer.addChild(this.bgG, this.bgLabel, this.bgTag, this.bgPic);
    this.shotLayer.addChild(this.shotPic);
    this.shotLayer.visible = false;
    this.cgLayer.addChild(this.cgG, this.cgLabel, this.cgPic);
    this.cgLayer.visible = false;
    this.minigameRoot.visible = false;
    app.stage.addChild(this.bgLayer, this.spriteLayer, this.shotLayer, this.cgLayer, this.fadeLayer, this.minigameRoot);

    // Кадр по требованию: штатный рендер по тикеру заменяем условным.
    app.ticker.remove(app.render, app);
    app.ticker.add(() => this.tick());

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.layout();
  }

  // ───────────────────────────── ISceneRenderer ─────────────────────────────

  setView(view: ViewState): void {
    for (const node of this.nodes.values()) node.box.destroy({ children: true });
    this.nodes.clear();
    for (const node of this.leaving) node.box.destroy({ children: true });
    this.leaving.clear();
    this.spriteLayer.removeChildren();
    this.speaker = view.speaker;
    for (const sp of view.sprites) this.addSprite(sp, false, 'cut');
    this.updateFacing();
    this.bgId = view.bg;
    this.resolveSlot(this.bgSlot, this.assets.bgChain(view.bg));
    this.shotId = view.shot ?? null;
    this.resolveSlot(this.shotSlot, this.shotChain(this.shotId));
    this.retargetFocus(false);
    this.cgId = view.cg;
    this.cgFade = 1;
    this.resolveSlot(this.cgSlot, view.cg ? this.assets.cgChain(view.cg) : null);
    this.layout();
  }

  /** Кадр покрытия: вместо спрайтов, под CG; грузится — виден прежний, файла нет — спрайты (08 §4.9). */
  setShot(shot: string | null): void {
    this.shotId = shot;
    this.shotCutAt = performance.now();
    this.resolveSlot(this.shotSlot, this.shotChain(shot));
    this.retargetFocus(false);
    this.layout();
  }

  setFocus(who: string | null): void {
    if (who === this.focusWho) return;
    this.focusWho = who;
    this.retargetFocus(performance.now() - this.shotCutAt > 300);
  }

  /** Маска того, на ком внимание, на текущем кадре: прежняя гаснет, новая проявляется (animate) или сразу (склейка). */
  private retargetFocus(animate: boolean): void {
    const now = performance.now();
    const ms = animate ? FOCUS_MS : 0;
    const cur = this.focusCur;
    this.focusPrev = animate && cur?.tex ? { ...cur, fade: { from: fadeAt(cur.fade, now), to: 0, t0: now, ms } } : null;
    this.focusCur = null;
    const chain = this.focusWho !== null && this.shotId !== null ? (this.assets.shotMask?.(this.shotId, this.focusWho) ?? null) : null;
    const url = chain?.urls[0];
    if (chain && url) {
      const slot: FocusSlot = { url, tex: null, fade: { from: 0, to: 1, t0: now, ms } };
      this.focusCur = slot;
      const got = this.assets.peek(chain.urls);
      if (got) slot.tex = this.texture(got.handle);
      else if (got === undefined) {
        void this.assets.load(chain.urls).then((res) => {
          if (this.destroyed || this.focusCur !== slot || !res) return;
          slot.tex = this.texture(res.handle);
          slot.fade = { from: 0, to: 1, t0: performance.now(), ms: FOCUS_MS };
          this.invalidate();
        });
      }
    }
    this.invalidate();
  }

  private shotChain(shot: string | null): ImageChain | null {
    return shot !== null ? (this.assets.shotChain?.(shot) ?? null) : null;
  }

  setBackground(bg: string): void {
    this.bgId = bg;
    this.resolveSlot(this.bgSlot, this.assets.bgChain(bg));
    this.layout();
  }

  setCg(cg: string | null): void {
    this.cgId = cg;
    this.cgFade = 1;
    this.resolveSlot(this.cgSlot, cg ? this.assets.cgChain(cg) : null);
    this.layout();
  }

  showSprite(sprite: SpriteView, existing: boolean, transition: TransitionKind): void {
    this.addSprite(sprite, existing, transition);
    this.updateFacing();
    this.layout();
  }

  hideSprite(who: string, transition: TransitionKind): void {
    const node = this.nodes.get(who);
    if (!node) return;
    this.nodes.delete(who);
    this.updateFacing();
    node.token += 1; // запоздавшая загрузка не должна ничего менять
    if (transition === 'cut') {
      node.box.destroy({ children: true });
      this.invalidate();
      return;
    }
    node.tween = { from: node.fade, to: 0, t0: performance.now(), ms: 260, done: () => node.box.destroy({ children: true }) };
    this.leaving.add(node);
    this.invalidate();
  }

  setSpeaker(who: string | null): void {
    this.speaker = who;
    for (const [id, node] of this.nodes) node.dim = this.dimFor(id);
    this.layout();
  }

  /** Затемняем остальных, только если говорящий сам стоит на сцене (голос за кадром никого не гасит). */
  private dimFor(id: string): number {
    return this.speaker !== null && this.speaker !== id && this.nodes.has(this.speaker) ? 0.62 : 1;
  }

  slotStates(): SlotStates {
    const sprites: Record<string, Mode> = {};
    for (const [who, node] of this.nodes) sprites[who] = node.mode;
    const focus = { who: this.focusWho, mask: (this.focusCur ? (this.focusCur.tex ? 'image' : 'loading') : 'none') as Mode };
    return { bg: this.bgSlot.mode, bgId: this.bgId, cg: this.cgSlot.mode, cgId: this.cgId, shot: this.shotSlot.mode, shotId: this.shotId, focus, sprites };
  }

  setViolenceMode(mode: ViolenceMode): void {
    this.violence = mode;
    this.layout();
  }

  setMinigameActive(active: boolean): void {
    this.minigameRoot.visible = active;
    this.continuous = active;
    this.invalidate();
  }

  destroy(): void {
    this.destroyed = true;
    this.observer?.disconnect();
    this.app.destroy({ removeView: true }, { children: true });
    this.textures.destroy();
  }

  // ───────────────────────────── внутренности ─────────────────────────────

  private invalidate(): void {
    this.dirty = true;
  }

  // ───────────────────────────── камкордер на видеокарте ─────────────────────────────

  /**
   * Кадр камкордера: движение камеры и искажения записи — шейдером на всём кадре. false — шейдер недоступен
   * (не скомпилировался на этом устройстве): камкордер вернётся к CSS-трансформации и холсту помех.
   */
  camera(frame: CamFrame, signal: SignalProfile, timeMs: number): boolean {
    if (!this.app || this.destroyed || !this.vhsUsable()) return false;
    const vhs = (this.vhs ??= new VhsFilter());
    const stage = this.app.stage;
    if (stage.filters?.[0] !== vhs) stage.filters = [vhs];
    this.fitFilterArea();
    vhs.setFrame({ frame, signal, timeMs, frameNo: this.vhsFrame++, heightPx: this.app.canvas.height, yDown: VHS_Y_DOWN });
    this.invalidate();
    return true;
  }

  /** Графика (настройка): «Воспоминания» — мягче подсветка говорящего, растворение точками. */
  setGraphics(mode: 'real' | 'memory'): void {
    this.graphics = mode;
    this.invalidate();
  }

  /**
   * Растворение: текущая картинка застывает поверх и гаснет за ms, а под ней уже рисуется новый кадр (Stage зовёт это
   * до смены сцены). Снимок — без шейдера камкордера: шейдер лежит на всём кадре и сам пройдёт по смеси.
   * false — снимок не удался: Stage сделает прежний «нырок» в полутень.
   */
  crossfade(ms: number, style: 'fade' | 'dither' = 'fade'): boolean {
    if (!this.app || this.destroyed || ms <= 0) return false;
    const stage = this.app.stage;
    const W = this.app.screen.width;
    const H = this.app.screen.height;
    const filters = stage.filters ? [...stage.filters] : null;
    this.dropFade();
    let tex: Texture;
    try {
      stage.filters = [];
      tex = this.app.renderer.generateTexture({ target: stage, frame: new Rectangle(0, 0, W, H) });
    } catch (e) {
      console.warn('[stage] снимок для растворения не удался:', e);
      return false;
    } finally {
      stage.filters = filters;
    }
    const pic = new Sprite(tex);
    pic.width = W;
    pic.height = H;
    // Точками (графика «Воспоминания»): снимок рассыпается по матрице Байера; шейдер не собрался — обычное растворение.
    const dither = style === 'dither' && this.ditherUsable() ? new DitherFilter() : null;
    if (dither) pic.filters = [dither];
    this.fadeLayer.addChild(pic);
    this.fade = { pic, t0: performance.now(), ms, dither };
    this.invalidate();
    return true;
  }

  private dropFade(): void {
    if (!this.fade) return;
    this.fade.pic.destroy({ texture: true, textureSource: true });
    this.fade.dither?.destroy();
    this.fade = null;
  }

  private ditherUsable(): boolean {
    if (this.ditherOk === null) this.ditherOk = this.glslOk(DITHER_FRAGMENT, '[stage] шейдер растворения точками не собрался, обычное растворение:');
    return this.ditherOk;
  }

  /** Снять камкордер с кадра (уровень «выкл», мини-игра, меню). */
  cameraOff(): void {
    if (!this.app || this.destroyed) return;
    if (this.app.stage.filters && this.app.stage.filters.length > 0) {
      this.app.stage.filters = [];
      this.invalidate();
    }
  }

  /** Подсветка: веса масок по времени, фильтр на слое кадра (нет веса или шейдера — фильтра нет). true — идёт переход. */
  private applyFocus(now: number): boolean {
    const prev = this.focusPrev;
    const cur = this.focusCur;
    const wA = prev?.tex ? fadeAt(prev.fade, now) : 0;
    const wB = cur?.tex ? fadeAt(cur.fade, now) : 0;
    const moving = (prev !== null && !fadeDone(prev.fade, now)) || (cur?.tex != null && !fadeDone(cur.fade, now));
    if (prev && fadeDone(prev.fade, now)) this.focusPrev = null;
    if (wA + wB < 0.001 || !this.shotLayer.visible || !this.focusUsable()) {
      if (this.shotLayer.filters) this.shotLayer.filters = null;
      return moving;
    }
    const f = (this.focusFilter ??= new FocusFilter());
    if (this.shotLayer.filters?.[0] !== f) this.shotLayer.filters = [f];
    const W = this.app.screen.width;
    const H = this.app.screen.height;
    const area = this.shotLayer.filterArea;
    if (!area || area.width !== W || area.height !== H) this.shotLayer.filterArea = new Rectangle(0, 0, W, H);
    const b = this.shotPic.getBounds();
    const dim = this.graphics === 'memory' ? FOCUS_DIM_MEMORY : FOCUS_DIM;
    f.setFrame({ maskA: prev?.tex ?? null, maskB: cur?.tex ?? null, wA, wB, shot: { x: b.x, y: b.y, width: b.width, height: b.height }, dim });
    return moving;
  }

  private focusUsable(): boolean {
    if (this.focusOk === null) this.focusOk = this.glslOk(FOCUS_FRAGMENT, '[focus] шейдер подсветки не собрался, кадр без подсветки:');
    return this.focusOk;
  }

  /**
   * Шейдер проверяется один раз: компиляция в том же GL-контексте (WebGL2). Ошибку компиляции PixiJS только
   * пишет в консоль и рисует чёрный кадр — поэтому проверяем заранее и при ошибке не включаем фильтр вовсе.
   */
  private vhsUsable(): boolean {
    if (this.vhsOk === null) this.vhsOk = this.glslOk(VHS_FRAGMENT, '[camcorder] шейдер записи не собрался, остаётся CSS-камкордер:');
    return this.vhsOk;
  }

  /**
   * Фрагментный шейдер собирается на этой видеокарте (WebGL2); нет — warn и false: эффект выключается. Собираем ровно
   * тот текст, что соберёт Pixi: без «#version 300 es» он переводит шейдер в GLSL ES 1.00 макросами.
   */
  private glslOk(fragment: string, warning: string): boolean {
    try {
      const gl = (this.app.renderer as WebGLRenderer).gl as WebGL2RenderingContext | WebGLRenderingContext | undefined;
      if (!gl || typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) return false;
      const sh = gl.createShader(gl.FRAGMENT_SHADER);
      if (!sh) return false;
      gl.shaderSource(sh, new GlProgram({ vertex: defaultFilterVert, fragment, preferredFragmentPrecision: 'highp' }).fragment ?? '');
      gl.compileShader(sh);
      const ok = gl.getShaderParameter(sh, gl.COMPILE_STATUS) === true;
      if (!ok) console.warn(warning, gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return ok;
    } catch (e) {
      console.warn(warning, e);
      return false;
    }
  }

  /** Фильтр — ровно на экран: фон и кадр шире экрана (coverFit), и границы сцены с ним не совпадают. */
  private fitFilterArea(): void {
    const W = this.app.screen.width;
    const H = this.app.screen.height;
    const a = this.app.stage.filterArea;
    if (a && a.width === W && a.height === H) return;
    this.app.stage.filterArea = new Rectangle(0, 0, W, H);
  }

  private resize(): void {
    if (this.destroyed) return;
    const rect = this.host.getBoundingClientRect();
    const w = Math.max(2, Math.round(rect.width));
    const h = Math.max(2, Math.round(rect.height));
    if (w === this.app.screen.width && h === this.app.screen.height) return;
    this.app.renderer.resize(w, h);
    this.layout();
  }

  /** Адреса текстур, которые показываются прямо сейчас (их нельзя вытеснять из кеша). */
  private inUse(): Set<string> {
    const s = new Set<string>();
    if (this.bgSlot.url) s.add(this.bgSlot.url);
    if (this.cgSlot.url) s.add(this.cgSlot.url);
    if (this.shotSlot.url) s.add(this.shotSlot.url);
    if (this.focusCur) s.add(this.focusCur.url);
    if (this.focusPrev) s.add(this.focusPrev.url);
    for (const n of [...this.nodes.values(), ...this.leaving]) if (n.url) s.add(n.url);
    return s;
  }

  private texture(handle: ImageHandle): Texture {
    return this.textures.get(handle, this.inUse());
  }

  /** Фон / CG: выставить результат по цепочке файлов (готово сразу, грузится или файла нет). */
  private resolveSlot(slot: Slot, chain: ImageChain | null): void {
    slot.token += 1;
    const token = slot.token;
    if (!chain) {
      // нет записи в assets (или ассетов нет вовсе) → плейсхолдер, если слот вообще нужен
      const unused = (slot === this.cgSlot && this.cgId === null) || (slot === this.shotSlot && this.shotId === null);
      slot.mode = unused ? 'none' : 'placeholder';
      slot.url = null;
      return;
    }
    if (chain.solid) {
      slot.mode = 'solid';
      slot.url = null;
      slot.color = parseInt(chain.solid.slice(1), 16);
      return;
    }
    const got = this.assets.peek(chain.urls);
    if (got) {
      this.applySlotImage(slot, got.handle);
    } else if (got === null) {
      slot.mode = 'placeholder';
      slot.url = null;
    } else {
      // Идёт загрузка: пока показываем прежнюю картинку (для первого кадра — чёрный экран, не плейсхолдер).
      void this.assets.load(chain.urls).then((res) => {
        if (this.destroyed || slot.token !== token) return;
        if (res) this.applySlotImage(slot, res.handle);
        else {
          slot.mode = 'placeholder';
          slot.url = null;
        }
        this.layout();
      });
    }
  }

  private applySlotImage(slot: Slot, handle: ImageHandle): void {
    const pic = slot === this.bgSlot ? this.bgPic : slot === this.shotSlot ? this.shotPic : this.cgPic;
    pic.texture = this.texture(handle);
    slot.mode = 'image';
    slot.url = handle.url;
  }

  /** Поворот к собеседнику: пересчитывается при каждом появлении и уходе спрайта (см. wantFlip). */
  private updateFacing(): void {
    const n = this.nodes.size;
    for (const [who, node] of this.nodes) node.flip = wantFlip(node.view.position, this.assets.spriteFacing?.(who) ?? 'front', n);
  }

  private addSprite(sp: SpriteView, existing: boolean, transition: TransitionKind): void {
    if (isOffscreen(sp.position)) {
      // Голос за кадром: на сцене не рисуется (контракт в renderer.ts), прежний спрайт убираем.
      this.hideSprite(sp.who, 'cut');
      return;
    }
    let node = this.nodes.get(sp.who);
    const fresh = !node;
    if (!node) {
      const box = new Container();
      const body = new Graphics();
      const name = makeText(18, '700');
      const expr = makeText(14, '400', 0xe6e0d2);
      const pic = new Sprite();
      pic.anchor.set(0.5, 1);
      box.addChild(body, name, expr, pic);
      this.spriteLayer.addChild(box);
      node = { view: sp, box, body, name, expr, pic, mode: 'none', derivedSilhouette: false, url: null, fade: 1, dim: 1, tween: null, token: 0, flip: false };
      this.nodes.set(sp.who, node);
    }
    node.view = sp;
    node.dim = this.dimFor(sp.who);
    if (fresh && !existing && transition !== 'cut') {
      node.fade = 0;
      node.tween = { from: 0, to: 1, t0: performance.now(), ms: 280 };
    }
    this.resolveSprite(node);
  }

  private resolveSprite(node: SpriteNode): void {
    node.token += 1;
    const token = node.token;
    const chain = this.assets.spriteChain(node.view);
    if (!chain) {
      node.mode = 'placeholder';
      node.url = null;
      node.derivedSilhouette = false;
      return;
    }
    const got = this.assets.peek(chain.urls);
    if (got) {
      this.applySpriteImage(node, got.handle, chain.silhouetteFirst && got.index > 0);
    } else if (got === null) {
      node.mode = 'placeholder';
      node.url = null;
      node.derivedSilhouette = false;
    } else {
      if (node.mode === 'none') node.mode = 'loading';
      void this.assets.load(chain.urls).then((res) => {
        if (this.destroyed || node.token !== token) return;
        if (res) this.applySpriteImage(node, res.handle, chain.silhouetteFirst && res.index > 0);
        else {
          node.mode = 'placeholder';
          node.url = null;
          node.derivedSilhouette = false;
        }
        this.layout();
      });
    }
  }

  private applySpriteImage(node: SpriteNode, handle: ImageHandle, derivedSilhouette: boolean): void {
    node.pic.texture = this.texture(handle);
    node.mode = 'image';
    node.url = handle.url;
    node.derivedSilhouette = derivedSilhouette;
  }

  private tween(t: Tween, now: number): number {
    const k = Math.min(1, (now - t.t0) / t.ms);
    return t.from + (t.to - t.from) * (1 - (1 - k) * (1 - k));
  }

  private tick(): void {
    if (this.destroyed) return;
    const now = performance.now();
    let animating = false;
    for (const node of [...this.nodes.values(), ...this.leaving]) {
      const tw = node.tween;
      if (!tw) continue;
      animating = true;
      node.fade = this.tween(tw, now);
      if (now - tw.t0 >= tw.ms) {
        node.fade = tw.to;
        node.tween = null;
        tw.done?.();
        this.leaving.delete(node);
      }
      this.paintNode(node);
    }
    if (this.fade) {
      animating = true;
      const k = Math.min(1, (now - this.fade.t0) / this.fade.ms);
      const e = k * k * (3 - 2 * k);
      if (this.fade.dither) this.fade.dither.setProgress(e, DITHER_CELL * this.app.renderer.resolution, this.app.screen.width, this.app.screen.height);
      else this.fade.pic.alpha = 1 - e;
      if (k >= 1) this.dropFade();
    }
    if (this.applyFocus(now)) animating = true;
    if (animating || this.dirty || this.continuous) {
      this.dirty = false;
      this.app.render();
    }
  }

  private paintNode(node: SpriteNode): void {
    const image = node.mode === 'image';
    node.box.alpha = image ? node.fade : node.fade * node.dim;
    node.pic.tint = node.derivedSilhouette ? 0x000000 : node.dim < 1 ? DIM_TINT : 0xffffff;
    node.pic.alpha = node.derivedSilhouette ? SILHOUETTE_ALPHA : 1;
  }

  private layout(): void {
    if (!this.app || this.destroyed) return;
    this.invalidate();
    const W = this.app.screen.width;
    const H = this.app.screen.height;

    // фон
    const bgMode = this.bgSlot.mode;
    const bgPlaceholder = bgMode === 'placeholder';
    this.bgG.visible = bgPlaceholder || bgMode === 'solid';
    this.bgLabel.visible = this.bgTag.visible = bgPlaceholder;
    this.bgPic.visible = bgMode === 'image';
    if (bgMode === 'solid') this.bgG.clear().rect(0, 0, W, H).fill({ color: this.bgSlot.color });
    if (bgPlaceholder) {
      const bg = hslToInt(placeholderHsl(this.bgId || 'none', 'bg'));
      this.bgG.clear().rect(0, 0, W, H).fill({ color: bg });
      this.bgG.rect(0, H * 0.74, W, H * 0.26).fill({ color: 0x000000, alpha: 0.22 });
      this.bgLabel.style.fontSize = clamp(H * 0.045, 14, 40);
      this.bgLabel.style.wordWrapWidth = W * 0.8;
      this.bgLabel.text = placeholderLabel(this.bgId);
      this.bgLabel.alpha = 0.55;
      this.bgLabel.position.set(W / 2, H * 0.2);
      this.bgTag.style.fontSize = clamp(H * 0.026, 10, 16);
      this.bgTag.text = 'placeholder · background';
      this.bgTag.alpha = 0.4;
      this.bgTag.position.set(W / 2, H * 0.2 + this.bgLabel.height / 2 + 14);
    }
    if (bgMode === 'image') this.coverFit(this.bgPic, W, H);

    // спрайты
    for (const node of [...this.nodes.values(), ...this.leaving]) this.layoutSprite(node, W, H);

    // кадр покрытия: вместо спрайтов, под CG; нет файла — спрайты (запасной вариант)
    const shotOn = this.shotId !== null && this.shotSlot.mode === 'image';
    this.shotLayer.visible = shotOn;
    this.shotPic.visible = shotOn;
    this.spriteLayer.visible = !shotOn;
    if (shotOn) this.coverFit(this.shotPic, W, H);

    // CG
    const cgMode = this.cgSlot.mode;
    this.cgLayer.visible = this.cgId !== null && cgMode !== 'none';
    if (this.cgId !== null) {
      const schematic = this.violence === 'schematic';
      const placeholder = cgMode === 'placeholder';
      this.cgG.visible = this.cgLabel.visible = placeholder;
      this.cgPic.visible = cgMode === 'image';
      if (placeholder) {
        const color = hslToInt(placeholderHsl(this.cgId, 'cg'));
        this.cgG.clear().rect(0, 0, W, H).fill({ color: schematic ? 0x0b0b0d : color });
        this.cgG.rect(W * 0.04, H * 0.06, W * 0.92, H * 0.88).stroke({ width: 2, color: 0xffffff, alpha: 0.3 });
        this.cgLabel.style.fontSize = clamp(H * 0.04, 14, 34);
        this.cgLabel.style.wordWrapWidth = W * 0.8;
        this.cgLabel.text = `CG · ${placeholderLabel(this.cgId)}${schematic ? ' · schematic' : ''}`;
        this.cgLabel.position.set(W / 2, H / 2);
      }
      if (cgMode === 'image') {
        this.coverFit(this.cgPic, W, H);
        // Схематичный режим: настоящий кадр CG с последствиями прячем за затемнением (художник готовит
        // отдельные варианты там, где различие есть; пока — глухой чёрный кадр, как у плейсхолдера).
        this.cgPic.visible = !schematic;
        this.cgG.visible = schematic;
        if (schematic) this.cgG.clear().rect(0, 0, W, H).fill({ color: 0x0b0b0d });
      }
      this.cgLayer.alpha = this.cgFade;
    }
  }

  private coverFit(pic: Sprite, W: number, H: number): void {
    const tex = pic.texture;
    const iw = tex.width || 1;
    const ih = tex.height || 1;
    const s = Math.max(W / iw, H / ih);
    pic.scale.set(s);
    pic.position.set(W / 2, H / 2);
  }

  private layoutSprite(node: SpriteNode, W: number, H: number): void {
    const v = node.view;
    const cx = POSITION_X[v.position] * W;
    const image = node.mode === 'image';
    const placeholder = node.mode === 'placeholder';
    node.body.visible = node.name.visible = node.expr.visible = placeholder;
    node.pic.visible = image;
    node.box.visible = node.mode !== 'loading' && node.mode !== 'none';
    if (image) {
      const tex = node.pic.texture;
      const iw = tex.width || 1;
      const ih = tex.height || 1;
      const s = Math.min((H * SPRITE_FIT) / ih, (W * SPRITE_MAX_WIDTH) / iw);
      node.pic.scale.set(node.flip ? -s : s, s);
      node.box.position.set(cx, H);
      node.pic.position.set(0, 0);
      this.paintNode(node);
      return;
    }
    const sh = H * 0.82;
    const sw = Math.min(sh * 0.52, W * 0.3);
    node.box.position.set(cx - sw / 2, H - sh);
    const color = v.silhouette ? 0x07070a : hslToInt(placeholderHsl(v.who, 'sprite'));
    node.body.clear().roundRect(0, 0, sw, sh, 10).fill({ color, alpha: v.silhouette ? 0.96 : 0.92 });
    node.body.roundRect(0, 0, sw, sh, 10).stroke({ width: 2, color: 0xffffff, alpha: v.silhouette ? 0.12 : 0.35 });
    const fs = clamp(sw * 0.13, 11, 22);
    node.name.style.fontSize = fs;
    node.name.style.wordWrapWidth = sw - 12;
    node.name.text = v.silhouette ? '?' : placeholderLabel(v.who);
    node.name.position.set(sw / 2, sh * 0.3);
    node.expr.style.fontSize = clamp(fs * 0.78, 10, 17);
    node.expr.style.wordWrapWidth = sw - 12;
    node.expr.text = v.silhouette ? '' : [v.expression, v.pose].filter(Boolean).join(' · ');
    node.expr.position.set(sw / 2, sh * 0.3 + fs * 1.7);
    this.paintNode(node);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
