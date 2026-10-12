/**
 * DOM-рендерер кадра: резерв на случай, если WebGL недоступен (старые WebView, headless без GPU).
 * Рисует то же самое, что Pixi-рендерер, обычными div и img: настоящие картинки из ассетов эпизода,
 * а при отсутствии файла — плейсхолдер. Состояние слота (data-state): `loading` (картинка грузится:
 * остаётся прежняя, у нового спрайта — пустота) → `image` или `placeholder` (файла нет).
 */
import type { ViolenceMode } from '../core/settings';
import type { SpriteView, TransitionKind, ViewState } from '../core/types';
import { h } from '../ui/dom';
import { NO_ASSETS } from './assets';
import type { ImageChain, ImageHandle, SceneAssets } from './assets';
import { hslToCss, placeholderHsl, placeholderLabel } from './placeholders';
import { isOffscreen, SPRITE_FIT, SPRITE_MAX_WIDTH, wantFlip } from './renderer';
import type { ISceneRenderer, SlotState, SlotStates } from './renderer';

type State = 'none' | 'loading' | 'image' | 'placeholder';

interface SpriteEntry {
  view: SpriteView;
  el: HTMLElement;
  img: HTMLImageElement;
  state: State;
  derivedSilhouette: boolean;
  natural: { w: number; h: number } | null;
  token: number;
}

export class DomSceneRenderer implements ISceneRenderer {
  readonly kind = 'dom' as const;

  private root!: HTMLElement;
  private bgEl!: HTMLElement;
  private bgImg!: HTMLImageElement;
  private bgLabel!: HTMLElement;
  private spritesEl!: HTMLElement;
  private cgEl!: HTMLElement;
  private cgImg!: HTMLImageElement;
  private cgLabel!: HTMLElement;
  private shotEl!: HTMLElement;
  private shotImg!: HTMLImageElement;
  private shotLabel!: HTMLElement;
  private readonly nodes = new Map<string, SpriteEntry>();
  private violence: ViolenceMode = 'full';
  private cgId: string | null = null;
  private shotId: string | null = null;
  private bgId = '';
  private speaker: string | null = null;
  private bgToken = 0;
  private cgToken = 0;
  private shotToken = 0;
  private observer: ResizeObserver | null = null;
  private destroyed = false;

  constructor(private readonly assets: SceneAssets = NO_ASSETS) {}

  async mount(host: HTMLElement): Promise<void> {
    this.bgImg = h('img', { class: 'ph-img' });
    this.bgImg.alt = '';
    this.bgImg.draggable = false;
    this.bgLabel = h('span', { class: 'ph-label' });
    this.bgEl = h('div', { class: 'ph-bg', data: { state: 'none' } }, this.bgImg, this.bgLabel, h('span', { class: 'ph-tag', text: 'placeholder' }));
    this.spritesEl = h('div', { class: 'ph-sprites' });
    this.cgImg = h('img', { class: 'ph-img' });
    this.cgImg.alt = '';
    this.cgImg.draggable = false;
    this.cgLabel = h('span', { class: 'ph-label' });
    this.cgEl = h('div', { class: 'ph-cg', hidden: true, data: { state: 'none' } }, this.cgImg, this.cgLabel);
    this.shotImg = h('img', { class: 'ph-img' });
    this.shotImg.alt = '';
    this.shotImg.draggable = false;
    this.shotLabel = h('span', { class: 'ph-label' });
    this.shotEl = h('div', { class: 'ph-shot', hidden: true, data: { state: 'none' } }, this.shotImg, this.shotLabel);
    this.root = h('div', { class: 'ph-scene' }, this.bgEl, this.spritesEl, this.shotEl, this.cgEl);
    host.appendChild(this.root);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.layoutSprites());
      this.observer.observe(this.root);
    }
  }

  setView(view: ViewState): void {
    for (const e of this.nodes.values()) e.el.remove();
    this.nodes.clear();
    this.speaker = view.speaker;
    this.setBackground(view.bg);
    for (const sp of view.sprites) this.showSprite(sp, false, 'cut');
    this.setShot(view.shot ?? null);
    this.setCg(view.cg);
    this.setSpeaker(view.speaker);
  }

  /**
   * Кадр покрытия: поверх фона вместо спрайтов (класс has-shot прячет слой спрайтов), под CG. Пока новый
   * кадр грузится, виден прежний; если файла нет — плейсхолдер не рисуется, остаются спрайты.
   */
  setShot(shot: string | null): void {
    this.shotId = shot;
    this.shotToken += 1;
    this.shotEl.hidden = shot === null;
    if (shot === null) {
      this.shotEl.dataset.state = 'none';
      this.updateShotVisibility();
      return;
    }
    this.shotLabel.textContent = `shot · ${placeholderLabel(shot)}`;
    if (this.shotEl.dataset.state !== 'image') this.shotEl.dataset.state = 'loading';
    this.resolveSlot(this.shotEl, this.shotImg, this.assets.shotChain?.(shot) ?? null, this.shotToken, () => this.shotToken, () => this.updateShotVisibility());
    this.updateShotVisibility();
  }

  private updateShotVisibility(): void {
    this.root.classList.toggle('has-shot', !this.shotEl.hidden && this.shotEl.dataset.state === 'image');
  }

  setBackground(bg: string): void {
    this.bgId = bg;
    this.bgLabel.textContent = placeholderLabel(bg);
    this.bgEl.style.setProperty('--ph-bg', hslToCss(placeholderHsl(bg, 'bg')));
    this.bgToken += 1;
    this.resolveSlot(this.bgEl, this.bgImg, this.assets.bgChain(bg), this.bgToken, () => this.bgToken);
  }

  setCg(cg: string | null): void {
    this.cgId = cg;
    this.cgToken += 1;
    this.cgEl.hidden = cg === null;
    if (cg === null) {
      this.cgEl.dataset.state = 'none';
      return;
    }
    this.cgEl.style.setProperty('--ph-bg', hslToCss(placeholderHsl(cg, 'cg')));
    this.cgEl.classList.toggle('is-schematic', this.violence === 'schematic');
    this.cgLabel.textContent = `CG · ${placeholderLabel(cg)}${this.violence === 'schematic' ? ' · schematic' : ''}`;
    this.resolveSlot(this.cgEl, this.cgImg, this.assets.cgChain(cg), this.cgToken, () => this.cgToken);
  }

  /** Фон / CG: готовая картинка, загрузка (пока прежняя) или плейсхолдер, если файла нет. */
  private resolveSlot(el: HTMLElement, img: HTMLImageElement, chain: ImageChain | null, token: number, current: () => number, after?: () => void): void {
    const apply = (handle: ImageHandle | null): void => {
      if (handle) {
        img.src = handle.url;
        el.dataset.state = 'image';
      } else {
        el.dataset.state = 'placeholder';
      }
      after?.();
    };
    if (!chain) {
      apply(null);
      return;
    }
    if (chain.solid) {
      el.style.setProperty('--solid', chain.solid);
      el.dataset.state = 'solid';
      return;
    }
    const got = this.assets.peek(chain.urls);
    if (got !== undefined) {
      apply(got ? got.handle : null);
      return;
    }
    void this.assets.load(chain.urls).then((res) => {
      if (this.destroyed || current() !== token) return;
      apply(res ? res.handle : null);
    });
  }

  showSprite(sprite: SpriteView, existing: boolean, transition: TransitionKind): void {
    if (isOffscreen(sprite.position)) {
      // Голос за кадром: на сцене не рисуется (контракт в renderer.ts), прежний спрайт убираем.
      this.hideSprite(sprite.who, 'cut');
      return;
    }
    let entry = this.nodes.get(sprite.who);
    const created = !entry;
    if (!entry) {
      const img = h('img', { class: 'ph-img' });
      img.alt = '';
      img.draggable = false;
      const el = h('div', { class: 'ph-sprite', data: { state: 'none' } }, img, h('b', { class: 'ph-name' }), h('i', { class: 'ph-expr' }));
      entry = { view: sprite, el, img, state: 'none', derivedSilhouette: false, natural: null, token: 0 };
      this.nodes.set(sprite.who, entry);
      this.spritesEl.appendChild(el);
    }
    const node = entry.el;
    entry.view = sprite;
    node.dataset.pos = sprite.position;
    node.dataset.who = sprite.who;
    node.classList.toggle('is-silhouette', sprite.silhouette);
    node.style.setProperty('--ph-bg', sprite.silhouette ? '#07070a' : hslToCss(placeholderHsl(sprite.who, 'sprite')));
    const name = node.querySelector('.ph-name');
    const expr = node.querySelector('.ph-expr');
    if (name) name.textContent = sprite.silhouette ? '?' : placeholderLabel(sprite.who);
    if (expr) expr.textContent = sprite.silhouette ? '' : [sprite.expression, sprite.pose].filter(Boolean).join(' · ');
    node.classList.toggle('is-dim', this.dimmed(sprite.who));
    if (created && !existing && transition !== 'cut') {
      node.classList.add('is-entering');
      requestAnimationFrame(() => requestAnimationFrame(() => node.classList.remove('is-entering')));
    }
    this.resolveSprite(entry);
    this.updateFacing();
  }

  /** Поворот к собеседнику: пересчитывается при каждом появлении и уходе спрайта (см. wantFlip). */
  private updateFacing(): void {
    const n = this.nodes.size;
    for (const [who, e] of this.nodes) {
      e.el.classList.toggle('is-flipped', wantFlip(e.view.position, this.assets.spriteFacing?.(who) ?? 'front', n));
    }
  }

  private resolveSprite(entry: SpriteEntry): void {
    entry.token += 1;
    const token = entry.token;
    const chain = this.assets.spriteChain(entry.view);
    const apply = (res: { handle: ImageHandle; index: number } | null): void => {
      if (res) {
        entry.img.src = res.handle.url;
        entry.natural = { w: res.handle.width, h: res.handle.height };
        entry.derivedSilhouette = (chain?.silhouetteFirst ?? false) && res.index > 0;
        entry.state = 'image';
      } else {
        entry.natural = null;
        entry.derivedSilhouette = false;
        entry.state = 'placeholder';
      }
      this.paintSprite(entry);
    };
    if (!chain) {
      apply(null);
      return;
    }
    const got = this.assets.peek(chain.urls);
    if (got !== undefined) {
      apply(got);
      return;
    }
    if (entry.state === 'none') {
      entry.state = 'loading';
      this.paintSprite(entry);
    }
    void this.assets.load(chain.urls).then((res) => {
      if (this.destroyed || entry.token !== token) return;
      apply(res);
    });
  }

  private paintSprite(entry: SpriteEntry): void {
    const { el } = entry;
    el.dataset.state = entry.state;
    el.classList.toggle('has-image', entry.state === 'image');
    el.classList.toggle('is-derived-silhouette', entry.derivedSilhouette);
    this.layoutSprite(entry);
  }

  /** Размер настоящего спрайта: рост ≈ высота сцены, но не шире SPRITE_MAX_WIDTH ширины. */
  private layoutSprite(entry: SpriteEntry): void {
    const { el, natural } = entry;
    if (entry.state !== 'image' || !natural || !this.root) {
      el.style.removeProperty('width');
      el.style.removeProperty('height');
      return;
    }
    const W = this.root.clientWidth;
    const H = this.root.clientHeight;
    if (W <= 0 || H <= 0) return;
    const s = Math.min((H * SPRITE_FIT) / natural.h, (W * SPRITE_MAX_WIDTH) / natural.w);
    el.style.width = `${(natural.w * s).toFixed(1)}px`;
    el.style.height = `${(natural.h * s).toFixed(1)}px`;
  }

  private layoutSprites(): void {
    for (const e of this.nodes.values()) this.layoutSprite(e);
  }

  hideSprite(who: string, transition: TransitionKind): void {
    const entry = this.nodes.get(who);
    if (!entry) return;
    this.nodes.delete(who);
    this.updateFacing();
    entry.token += 1;
    const node = entry.el;
    if (transition === 'cut') {
      node.remove();
      return;
    }
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 300);
  }

  setSpeaker(who: string | null): void {
    this.speaker = who;
    for (const [id, entry] of this.nodes) entry.el.classList.toggle('is-dim', this.dimmed(id));
  }

  /** Затемняем остальных, только если говорящий сам стоит на сцене. */
  private dimmed(id: string): boolean {
    return this.speaker !== null && this.speaker !== id && this.nodes.has(this.speaker);
  }

  slotStates(): SlotStates {
    const state = (el: HTMLElement): SlotState => (el.dataset.state as SlotState | undefined) ?? 'none';
    const sprites: Record<string, SlotState> = {};
    for (const [who, entry] of this.nodes) sprites[who] = entry.state;
    return {
      bg: state(this.bgEl),
      bgId: this.bgId,
      cg: this.cgEl.hidden ? 'none' : state(this.cgEl),
      cgId: this.cgId,
      shot: this.shotEl.hidden ? 'none' : state(this.shotEl),
      shotId: this.shotId,
      sprites,
    };
  }

  setViolenceMode(mode: ViolenceMode): void {
    this.violence = mode;
    if (this.cgId !== null) this.setCg(this.cgId);
  }

  destroy(): void {
    this.destroyed = true;
    this.observer?.disconnect();
    this.root.remove();
    this.nodes.clear();
  }
}
