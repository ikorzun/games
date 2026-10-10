/**
 * Каркас интерфейса: корневой контейнер, область сцены, слой текста/выборов/быстрого меню,
 * стек экранов, тосты. Раскладка: ландшафт — окно текста поверх картинки; портрет — текст под
 * картинкой (CSS grid, media (orientation: portrait)). Страница не скроллится, текст не
 * выделяется, контекстное меню по долгому тапу отключено.
 */
import type { QuickAction } from './quick_menu';
import { QuickMenu } from './quick_menu';
import { ChoiceMenu } from './choices';
import { h } from './dom';
import { ScreenHost } from './screen_host';
import { TextBox } from './textbox';
import { ToastLayer } from './toasts';

export class UiKit {
  readonly root: HTMLElement;
  readonly main: HTMLElement;
  /** Слой интерфейса поверх сцены (ландшафт) / панель под сценой (портрет). */
  readonly ui: HTMLElement;
  readonly textbox = new TextBox();
  readonly choices = new ChoiceMenu();
  readonly quick: QuickMenu;
  readonly screens = new ScreenHost();
  readonly toasts: ToastLayer;

  constructor(root: HTMLElement, onQuick: (a: QuickAction) => void, titleKeyOf: (item: string) => string | null) {
    this.root = root;
    this.quick = new QuickMenu(onQuick);
    this.toasts = new ToastLayer(titleKeyOf);
    this.ui = h('div', { class: 'vn-ui' }, this.quick.el, this.textbox.el, this.choices.el);
    this.main = h('div', { class: 'vn-main' }, this.ui);
    root.classList.add('vn-root');
    root.replaceChildren(this.main, this.screens.el, this.toasts.el);
    // Долгий тап и правая кнопка не открывают контекстное меню браузера.
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('dragstart', (e) => e.preventDefault());
  }

  /** Сцена занимает область .vn-main под слоем интерфейса. */
  mountStage(stageEl: HTMLElement): void {
    this.main.insertBefore(stageEl, this.ui);
  }

  setUiHidden(hidden: boolean): void {
    this.root.classList.toggle('ui-hidden', hidden);
  }

  setFontScale(scale: number): void {
    this.root.style.setProperty('--font-scale', String(scale));
  }
}
