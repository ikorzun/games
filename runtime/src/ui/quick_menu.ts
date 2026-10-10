/** Быстрое меню: Auto, Skip (прочитанное), Log, Save, Load, Mute, Settings (+ скрыть интерфейс). */
import { t } from '../core/i18n';
import { h } from './dom';

export type QuickAction = 'auto' | 'skip' | 'log' | 'save' | 'load' | 'mute' | 'settings' | 'hide';

export interface QuickState {
  auto: boolean;
  skip: boolean;
  muted: boolean;
}

const ORDER: readonly QuickAction[] = ['auto', 'skip', 'log', 'save', 'load', 'mute', 'settings', 'hide'];
const TOGGLES: ReadonlySet<QuickAction> = new Set(['auto', 'skip', 'mute']);

export class QuickMenu {
  readonly el: HTMLElement;
  private readonly buttons = new Map<QuickAction, HTMLButtonElement>();
  private state: QuickState = { auto: false, skip: false, muted: false };

  constructor(private readonly onAction: (action: QuickAction) => void) {
    this.el = h('div', { class: 'vn-quick', role: 'toolbar' });
    for (const action of ORDER) {
      const btn = h('button', {
        class: `vn-qbtn vn-qbtn--${action}`,
        type: 'button',
        data: { action },
        on: {
          click: (e) => {
            e.stopPropagation();
            this.onAction(action);
          },
        },
      });
      this.buttons.set(action, btn);
      this.el.appendChild(btn);
    }
    this.refresh();
  }

  setState(patch: Partial<QuickState>): void {
    this.state = { ...this.state, ...patch };
    this.applyState();
  }

  setDisabled(action: QuickAction, disabled: boolean): void {
    const b = this.buttons.get(action);
    if (b) b.disabled = disabled;
  }

  /** Подписи заново (смена языка). */
  refresh(): void {
    for (const [action, btn] of this.buttons) {
      btn.textContent = t(`ui.quick.${action}`);
      btn.title = t(`ui.quick.${action}`);
    }
    this.el.setAttribute('aria-label', t('ui.menu.settings'));
    this.applyState();
  }

  private applyState(): void {
    for (const [action, btn] of this.buttons) {
      if (!TOGGLES.has(action)) continue;
      const on = this.state[action as keyof QuickState];
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', String(on));
    }
  }
}
