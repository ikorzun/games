/**
 * Быстрое меню: Skip (прочитанное), Notes (заметки: блокнот улик и журнал реплик), Settings. Log и Notebook — действия
 * горячих клавиш L и N (открывают заметки на своей вкладке); Save/Load/Mute — действия и кнопки экрана настроек.
 * Кнопки — иконки (icons.ts); подпись остаётся в разметке скрытым текстом и в title: так кнопку
 * читает скринридер, а смена языка обновляет подсказки.
 */
import { t } from '../core/i18n';
import { h } from './dom';
import { icon } from './icons';

export type QuickAction = 'skip' | 'notes' | 'log' | 'notebook' | 'save' | 'load' | 'mute' | 'settings';

export interface QuickState {
  skip: boolean;
  muted: boolean;
}

/**
 * Сохранение, загрузка и звук живут в настройках (решение владельца 2026-10-11). Блокнот с пробы «Хода следствия»
 * (2026-10-13): выводы игрок делает сам по собранным фактам, и они должны быть под рукой. 2026-10-15 владелец убрал
 * «Авто» и «Скрыть интерфейс», а журнал и блокнот объединил в «Заметки».
 */
const ORDER: readonly QuickAction[] = ['skip', 'notes', 'settings'];
/** Кнопки-переключатели и поле состояния, которое каждая из них показывает. */
const TOGGLE_KEY: Readonly<Partial<Record<QuickAction, keyof QuickState>>> = { skip: 'skip', mute: 'muted' };

export class QuickMenu {
  readonly el: HTMLElement;
  private readonly buttons = new Map<QuickAction, HTMLButtonElement>();
  private readonly labels = new Map<QuickAction, HTMLElement>();
  private state: QuickState = { skip: false, muted: false };

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

  /** Метка «есть новое» (блокнот пополнился): красный квадрат в углу кнопки; с каждой новой записью иконка вздрагивает. */
  setBadge(action: QuickAction, on: boolean): void {
    const b = this.buttons.get(action);
    if (!b) return;
    b.classList.toggle('has-new', on);
    b.classList.remove('is-nudged');
    if (!on) return;
    void b.offsetWidth; // перезапуск анимации
    b.classList.add('is-nudged');
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
