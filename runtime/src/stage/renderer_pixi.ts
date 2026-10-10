/**
 * PixiJS-рендерер сцены. Рисует настоящие картинки (фон, CG, спрайты) из ассетов эпизода, а если
 * файла нет — плейсхолдер: фон — прямоугольник цвета hash(id) с подписью id, спрайт — прямоугольник
 * с именем и выражением. Подгружается лениво (динамический import из stage_factory), чтобы PixiJS
 * не тормозил первый кадр меню и чтобы при отсутствии WebGL игра продолжила работу на DOM-рендерере.
 *
 * Состояние слота (фон, CG, спрайт): `none` (ничего не просили) → `loading` (картинка грузится:
 * остаётся прежнее, а у нового спрайта — пустота, но не плейсхолдер) → `image` или `placeholder`
 * (файла нет). Кадр рисуется по требованию, а не 60 раз в секунду: в покое WebGL не работает
 * (батарея телефона), а камкордер двигает уже готовый canvas CSS-трансформацией (camcorder.ts).
 * Исключение — мини-игры: пока слой мини-игр активен, рендер непрерывный.
 *
 * Спрайты: рост ≈ высота сцены (SPRITE_FIT), но не шире SPRITE_MAX_WIDTH ширины; три позиции
 * left / center / right, offscreen_* не рисуются. Говорящего подсвечивают затемнением остальных
 * (tint), силуэт без собственного файла — чёрный кадр с прозрачностью .85.
 */
import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { ViolenceMode } from '../core/settings';
import type { SpriteView, TransitionKind, ViewState } from '../core/types';
import { NO_ASSETS } from './assets';
import type { ImageChain, ImageHandle, SceneAssets } from './assets';
import { hslToInt, placeholderHsl, placeholderLabel } from './placeholders';
import { isOffscreen, POSITION_X, SILHOUETTE_ALPHA, SPRITE_FIT, SPRITE_MAX_WIDTH } from './renderer';
import type { ISceneRenderer } from './renderer';

const FONT = 'PT Sans, Noto Sans, Arial, sans-serif';
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

type Mode = 'none' | 'loading' | 'image' | 'placeholder';

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
}

interface Slot {
  mode: Mode;
  url: string | null;
  token: number;
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
  private observer: ResizeObserver | null = null;
  private readonly bgLayer = new Container();
  private readonly spriteLayer = new Container();
  private readonly cgLayer = new Container();
  private readonly bgG = new Graphics();
  private readonly bgLabel = makeText(28, '700');
  private readonly bgTag = makeText(14, '400');
  private readonly bgPic = new Sprite();
  private readonly cgG = new Graphics();
  private readonly cgLabel = makeText(24, '700');
  private readonly cgPic = new Sprite();
  private readonly nodes = new Map<string, SpriteNode>();
  private readonly textures = new TextureCache();
  private readonly bgSlot: Slot = { mode: 'none', url: null, token: 0 };
  private readonly cgSlot: Slot = { mode: 'none', url: null, token: 0 };
  private bgId = '';
  private cgId: string | null = null;
  private speaker: string | null = null;
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
    this.bgPic.visible = false;
    this.cgPic.visible = false;
    this.bgLayer.addChild(this.bgG, this.bgLabel, this.bgTag, this.bgPic);
    this.cgLayer.addChild(this.cgG, this.cgLabel, this.cgPic);
    this.cgLayer.visible = false;
    this.minigameRoot.visible = false;
    app.stage.addChild(this.bgLayer, this.spriteLayer, this.cgLayer, this.minigameRoot);

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
    this.bgId = view.bg;
    this.resolveSlot(this.bgSlot, this.assets.bgChain(view.bg));
    this.cgId = view.cg;
    this.cgFade = 1;
    this.resolveSlot(this.cgSlot, view.cg ? this.assets.cgChain(view.cg) : null);
    this.layout();
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
    this.layout();
  }

  hideSprite(who: string, transition: TransitionKind): void {
    const node = this.nodes.get(who);
    if (!node) return;
    this.nodes.delete(who);
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
      slot.mode = slot === this.cgSlot && this.cgId === null ? 'none' : 'placeholder';
      slot.url = null;
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
    const pic = slot === this.bgSlot ? this.bgPic : this.cgPic;
    pic.texture = this.texture(handle);
    slot.mode = 'image';
    slot.url = handle.url;
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
      node = { view: sp, box, body, name, expr, pic, mode: 'none', derivedSilhouette: false, url: null, fade: 1, dim: 1, tween: null, token: 0 };
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
    this.bgG.visible = this.bgLabel.visible = this.bgTag.visible = bgPlaceholder;
    this.bgPic.visible = bgMode === 'image';
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
      node.pic.scale.set(s);
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
