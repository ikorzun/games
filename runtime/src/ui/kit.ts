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
  /** Индикатор загрузки ассетов блока (появляется, только если загрузка затянулась). */
  readonly loading: HTMLElement;

  constructor(root: HTMLElement, onQuick: (a: QuickAction) => void) {
    this.root = root;
    this.quick = new QuickMenu(onQuick);
    this.toasts = new ToastLayer();
    this.ui = h('div', { class: 'vn-ui' }, this.quick.el, this.textbox.el, this.choices.el);
    this.main = h('div', { class: 'vn-main' }, this.ui);
    this.loading = h('div', { class: 'vn-loading', aria: { hidden: true } }, h('i'), h('i'), h('i'));
    root.classList.add('vn-root');
    root.replaceChildren(this.main, this.screens.el, this.toasts.el, this.loading);
    // Долгий тап и правая кнопка не открывают контекстное меню браузера.
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('dragstart', (e) => e.preventDefault());
  }

  /** Сцена занимает область .vn-main под слоем интерфейса. */
  mountStage(stageEl: HTMLElement): void {
    this.main.insertBefore(stageEl, this.ui);
  }

  setLoading(on: boolean): void {
    this.loading.classList.toggle('is-on', on);
  }

  setFontScale(scale: number): void {
    this.root.style.setProperty('--font-scale', String(scale));
  }
}
