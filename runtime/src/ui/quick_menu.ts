/**
 * Быстрое меню: Auto, Skip (прочитанное), Log (папка), Notebook (блокнот улик), Settings, Hide. Save/Load/Mute остаются действиями
 * (клавиши S/L/M не меняются… точнее, горячие клавиши) и кнопками экрана настроек.
 * Кнопки — иконки (icons.ts); подпись остаётся в разметке скрытым текстом и в title: так кнопку
 * читает скринридер, а смена языка обновляет подсказки.
 */
import { t } from '../core/i18n';
import { h } from './dom';
import { icon } from './icons';

export type QuickAction = 'auto' | 'skip' | 'log' | 'notebook' | 'save' | 'load' | 'mute' | 'settings' | 'hide';

export interface QuickState {
  auto: boolean;
  skip: boolean;
  muted: boolean;
}

/**
 * Сохранение, загрузка и звук живут в настройках (решение владельца 2026-10-11). Блокнот — шестая кнопка с пробы
 * «Хода следствия» (2026-10-13): выводы игрок делает сам по собранным фактам, и они должны быть под рукой.
 */
const ORDER: readonly QuickAction[] = ['auto', 'skip', 'log', 'notebook', 'settings', 'hide'];
/** Кнопки-переключатели и поле состояния, которое каждая из них показывает. */
const TOGGLE_KEY: Readonly<Partial<Record<QuickAction, keyof QuickState>>> = { auto: 'auto', skip: 'skip', mute: 'muted' };

export class QuickMenu {
  readonly el: HTMLElement;
  private readonly buttons = new Map<QuickAction, HTMLButtonElement>();
  private readonly labels = new Map<QuickAction, HTMLElement>();
  private state: QuickState = { auto: false, skip: false, muted: false };

  constructor(private readonly onAction: (action: QuickAction) => void) {
    this.el = h('div', { class: 'vn-quick', role: 'toolbar' });
    for (const action of ORDER) {
      const label = h('span', { class: 'vn-sr vn-qbtn__label' });
      const btn = h(
        'button',
        {
          class: `vn-qbtn vn-qbtn--${action}`,
          type: 'button',
          data: { action },
          on: {
            click: (e) => {
              e.stopPropagation();
              this.onAction(action);
              // Фокус не должен «залипать» на кнопке: Space/Enter продвигают сюжет, а не повторяют действие.
              (e.currentTarget as HTMLElement).blur();
            },
          },
        },
        icon(action),
        label,
      );
      this.buttons.set(action, btn);
      this.labels.set(action, label);
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
      const text = t(`ui.quick.${action}`);
      const label = this.labels.get(action);
      if (label) label.textContent = text;
      btn.title = text;
    }
    this.el.setAttribute('aria-label', t('ui.menu.settings'));
    this.applyState();
  }

  private applyState(): void {
    for (const [action, btn] of this.buttons) {
      const key = TOGGLE_KEY[action];
      if (!key) continue;
      const on = this.state[key];
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', String(on));
    }
  }
}
