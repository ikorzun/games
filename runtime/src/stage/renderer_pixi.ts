/**
 * PixiJS-рендерер плейсхолдеров. Фон — прямоугольник цвета hash(id) с подписью id; спрайт —
 * прямоугольник с именем и выражением; CG — прямоугольник с подписью. Подгружается лениво
 * (динамический import из stage_factory), чтобы PixiJS не тормозил первый кадр меню и чтобы
 * при отсутствии WebGL игра продолжила работу на DOM-рендерере.
 */
import { Application, Container, Graphics, Text } from 'pixi.js';
import type { ViolenceMode } from '../core/settings';
import type { SpriteView, TransitionKind, ViewState } from '../core/types';
import { hslToInt, placeholderHsl, placeholderLabel } from './placeholders';
import { isOffscreen, POSITION_X } from './renderer';
import type { ISceneRenderer } from './renderer';

const FONT = 'PT Sans, Noto Sans, Arial, sans-serif';

interface Tween {
  from: number;
  to: number;
  t0: number;
  ms: number;
  done?: () => void;
}

interface SpriteNode {
  view: SpriteView;
  box: Container;
  body: Graphics;
  name: Text;
  expr: Text;
  fade: number;
  dim: number;
  tween: Tween | null;
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
  private readonly cgG = new Graphics();
  private readonly cgLabel = makeText(24, '700');
  private readonly nodes = new Map<string, SpriteNode>();
  private bgId = '';
  private cgId: string | null = null;
  private speaker: string | null = null;
  private violence: ViolenceMode = 'full';
  /** Спрайты, уходящие со сцены: их уже нет в nodes, но анимация исчезновения доигрывается. */
  private readonly leaving = new Set<SpriteNode>();
  private cgFade = 1;

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

    this.bgLayer.addChild(this.bgG, this.bgLabel, this.bgTag);
    this.cgLayer.addChild(this.cgG, this.cgLabel);
    this.cgLayer.visible = false;
    this.minigameRoot.visible = false;
    app.stage.addChild(this.bgLayer, this.spriteLayer, this.cgLayer, this.minigameRoot);
    app.ticker.add(() => this.tick());

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.layout();
  }

  // ───────────────────────────── ISceneRenderer ─────────────────────────────

  setView(view: ViewState): void {
    this.bgId = view.bg;
    for (const node of this.nodes.values()) node.box.destroy({ children: true });
    this.nodes.clear();
    this.spriteLayer.removeChildren();
    for (const sp of view.sprites) this.addSprite(sp, false, 'cut');
    this.cgId = view.cg;
    this.cgFade = 1;
    this.speaker = view.speaker;
    this.layout();
  }

  setBackground(bg: string): void {
    this.bgId = bg;
    this.layout();
  }

  setCg(cg: string | null): void {
    this.cgId = cg;
    this.cgFade = 1;
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
    if (transition === 'cut') {
      node.box.destroy({ children: true });
      return;
    }
    node.tween = { from: node.fade, to: 0, t0: performance.now(), ms: 260, done: () => node.box.destroy({ children: true }) };
    this.leaving.add(node);
  }

  setSpeaker(who: string | null): void {
    this.speaker = who;
    for (const [id, node] of this.nodes) node.dim = this.dimFor(id);
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
  }

  destroy(): void {
    this.observer?.disconnect();
    this.app.destroy({ removeView: true }, { children: true });
  }

  // ───────────────────────────── внутренности ─────────────────────────────

  private resize(): void {
    const rect = this.host.getBoundingClientRect();
    const w = Math.max(2, Math.round(rect.width));
    const h = Math.max(2, Math.round(rect.height));
    if (w === this.app.screen.width && h === this.app.screen.height) return;
    this.app.renderer.resize(w, h);
    this.layout();
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
      box.addChild(body, name, expr);
      this.spriteLayer.addChild(box);
      node = { view: sp, box, body, name, expr, fade: 1, dim: 1, tween: null };
      this.nodes.set(sp.who, node);
    }
    node.view = sp;
    node.dim = this.dimFor(sp.who);
    if (fresh && !existing && transition !== 'cut') {
      node.fade = 0;
      node.tween = { from: 0, to: 1, t0: performance.now(), ms: 280 };
    }
  }

  private tween(t: Tween, now: number): number {
    const k = Math.min(1, (now - t.t0) / t.ms);
    return t.from + (t.to - t.from) * (1 - (1 - k) * (1 - k));
  }

  private tick(): void {
    const now = performance.now();
    for (const node of [...this.nodes.values(), ...this.leaving]) {
      const tw = node.tween;
      if (!tw) continue;
      node.fade = this.tween(tw, now);
      if (now - tw.t0 >= tw.ms) {
        node.fade = tw.to;
        node.tween = null;
        tw.done?.();
        this.leaving.delete(node);
      }
      node.box.alpha = node.fade * node.dim;
    }
    for (const node of this.nodes.values()) node.box.alpha = node.fade * node.dim;
  }

  private layout(): void {
    if (!this.app) return;
    const W = this.app.screen.width;
    const H = this.app.screen.height;

    // фон
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

    // спрайты
    const sh = H * 0.82;
    const sw = Math.min(sh * 0.52, W * 0.3);
    for (const node of this.nodes.values()) {
      const v = node.view;
      const cx = POSITION_X[v.position] * W;
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
      node.box.alpha = node.fade * node.dim;
    }

    // CG
    this.cgLayer.visible = this.cgId !== null;
    if (this.cgId !== null) {
      const schematic = this.violence === 'schematic';
      const color = hslToInt(placeholderHsl(this.cgId, 'cg'));
      this.cgG.clear().rect(0, 0, W, H).fill({ color: schematic ? 0x0b0b0d : color });
      this.cgG.rect(W * 0.04, H * 0.06, W * 0.92, H * 0.88).stroke({ width: 2, color: 0xffffff, alpha: 0.3 });
      this.cgLabel.style.fontSize = clamp(H * 0.04, 14, 34);
      this.cgLabel.style.wordWrapWidth = W * 0.8;
      this.cgLabel.text = `CG · ${placeholderLabel(this.cgId)}${schematic ? ' · schematic' : ''}`;
      this.cgLabel.position.set(W / 2, H / 2);
      this.cgLayer.alpha = this.cgFade;
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
