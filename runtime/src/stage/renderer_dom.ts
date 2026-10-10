/**
 * DOM-рендерер плейсхолдеров: резерв на случай, если WebGL недоступен (старые WebView,
 * headless без GPU). Рисует то же самое, что Pixi-рендерер, обычными div'ами.
 */
import type { ViolenceMode } from '../core/settings';
import type { SpriteView, TransitionKind, ViewState } from '../core/types';
import { h } from '../ui/dom';
import { hslToCss, placeholderHsl, placeholderLabel } from './placeholders';
import { isOffscreen } from './renderer';
import type { ISceneRenderer } from './renderer';

export class DomSceneRenderer implements ISceneRenderer {
  readonly kind = 'dom' as const;

  private root!: HTMLElement;
  private bgEl!: HTMLElement;
  private bgLabel!: HTMLElement;
  private spritesEl!: HTMLElement;
  private cgEl!: HTMLElement;
  private cgLabel!: HTMLElement;
  private readonly nodes = new Map<string, HTMLElement>();
  private violence: ViolenceMode = 'full';
  private cgId: string | null = null;
  private speaker: string | null = null;

  async mount(host: HTMLElement): Promise<void> {
    this.bgLabel = h('span', { class: 'ph-label' });
    this.bgEl = h('div', { class: 'ph-bg' }, this.bgLabel, h('span', { class: 'ph-tag', text: 'placeholder' }));
    this.spritesEl = h('div', { class: 'ph-sprites' });
    this.cgLabel = h('span', { class: 'ph-label' });
    this.cgEl = h('div', { class: 'ph-cg', hidden: true }, this.cgLabel);
    this.root = h('div', { class: 'ph-scene' }, this.bgEl, this.spritesEl, this.cgEl);
    host.appendChild(this.root);
  }

  setView(view: ViewState): void {
    this.setBackground(view.bg);
    for (const node of this.nodes.values()) node.remove();
    this.nodes.clear();
    for (const sp of view.sprites) this.showSprite(sp, false, 'cut');
    this.setCg(view.cg);
    this.setSpeaker(view.speaker);
  }

  setBackground(bg: string): void {
    this.bgEl.style.background = hslToCss(placeholderHsl(bg, 'bg'));
    this.bgLabel.textContent = placeholderLabel(bg);
  }

  setCg(cg: string | null): void {
    this.cgId = cg;
    this.cgEl.hidden = cg === null;
    if (cg === null) return;
    this.cgEl.style.background = hslToCss(placeholderHsl(cg, 'cg'));
    this.cgEl.classList.toggle('is-schematic', this.violence === 'schematic');
    this.cgLabel.textContent = `CG · ${placeholderLabel(cg)}${this.violence === 'schematic' ? ' · schematic' : ''}`;
  }

  showSprite(sprite: SpriteView, existing: boolean, transition: TransitionKind): void {
    if (isOffscreen(sprite.position)) {
      // Голос за кадром: на сцене не рисуется (контракт в renderer.ts), прежний спрайт убираем.
      this.hideSprite(sprite.who, 'cut');
      return;
    }
    let node = this.nodes.get(sprite.who);
    const created = !node;
    if (!node) {
      node = h('div', { class: 'ph-sprite' }, h('b', { class: 'ph-name' }), h('i', { class: 'ph-expr' }));
      this.nodes.set(sprite.who, node);
      this.spritesEl.appendChild(node);
    }
    node.dataset.pos = sprite.position;
    node.dataset.who = sprite.who;
    node.classList.toggle('is-silhouette', sprite.silhouette);
    node.style.background = sprite.silhouette ? '' : hslToCss(placeholderHsl(sprite.who, 'sprite'));
    const name = node.querySelector('.ph-name');
    const expr = node.querySelector('.ph-expr');
    if (name) name.textContent = sprite.silhouette ? '?' : placeholderLabel(sprite.who);
    if (expr) expr.textContent = sprite.silhouette ? '' : [sprite.expression, sprite.pose].filter(Boolean).join(' · ');
    node.classList.toggle('is-dim', this.dimmed(sprite.who));
    if (created && !existing && transition !== 'cut') {
      node.classList.add('is-entering');
      requestAnimationFrame(() => requestAnimationFrame(() => node?.classList.remove('is-entering')));
    }
  }

  hideSprite(who: string, transition: TransitionKind): void {
    const node = this.nodes.get(who);
    if (!node) return;
    this.nodes.delete(who);
    if (transition === 'cut') {
      node.remove();
      return;
    }
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 300);
  }

  setSpeaker(who: string | null): void {
    this.speaker = who;
    for (const [id, node] of this.nodes) node.classList.toggle('is-dim', this.dimmed(id));
  }

  /** Затемняем остальных, только если говорящий сам стоит на сцене. */
  private dimmed(id: string): boolean {
    return this.speaker !== null && this.speaker !== id && this.nodes.has(this.speaker);
  }

  setViolenceMode(mode: ViolenceMode): void {
    this.violence = mode;
    if (this.cgId !== null) this.setCg(this.cgId);
  }

  destroy(): void {
    this.root.remove();
    this.nodes.clear();
  }
}
