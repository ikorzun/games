/**
 * Выбор: кнопки с вариантами. Таймер (timer_ms) включается только если разрешён в настройках
 * и игрок не в режиме «только история»; по истечении выбирается default_option. Недоступные
 * опции показываются выключенными — игрок видит, что что-то упустил.
 *
 * Дедуктивная развилка (p.deduction, 02-narrative-blocks §5a): над кнопками — шкала цены ошибок
 * (точки, подпись, aria «Самообладание: 3 из 5»); опция-улика — карточка с иконкой по виду материала;
 * испробованная — погашена, со значком ✕ и пометкой «уже пробовали» для скринридера; подсвеченная
 * подсказкой — мягкая подсветка и значок, под кнопками одна строка «Подсказка: верный ход подсвечен».
 * Смысл никогда не передаётся одним цветом: значок + класс + текст.
 */
import { t } from '../core/i18n';
import type { ChoiceOptionView, ChoicePending, DeductionMeter } from '../core/types';
import { h } from './dom';
import { icon } from './icons';
import type { IconName } from './icons';

/** Иконка карточки-улики по виду материала (archive_items[].kind); неизвестный вид — документ. */
const ITEM_ICONS: Readonly<Record<string, IconName>> = {
  document: 'document',
  photo: 'photo',
  newspaper: 'newspaper',
  object: 'object',
  map: 'map',
  audio: 'audio',
  fact: 'fact',
};

export function itemIcon(kind: string): IconName {
  return ITEM_ICONS[kind] ?? 'document';
}

let menuSeq = 0;

export interface AskOptions {
  /** Разрешён ли таймер (настройки). */
  timers: boolean;
  signal: AbortSignal;
}

export class ChoiceMenu {
  readonly el: HTMLElement;

  private pending: ChoicePending | null = null;
  private buttons: HTMLButtonElement[] = [];
  private promptEl: HTMLElement | null = null;
  private timerWrap: HTMLElement | null = null;
  private timerBar: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private remaining = 0;
  private startedAt = 0;
  private paused = false;
  private pick: ((id: string) => void) | null = null;
  /** id строки подсказки: на неё ссылаются aria-describedby подсвеченных вариантов. */
  private readonly hintId = `vn-choices-hint-${++menuSeq}`;

  constructor() {
    this.el = h('div', { class: 'vn-choices', hidden: true, role: 'group', tabindex: -1 });
  }

  get active(): boolean {
    return this.pending !== null;
  }

  ask(p: ChoicePending, opts: AskOptions): Promise<string> {
    this.close();
    this.pending = p;
    return new Promise<string>((resolve) => {
      this.pick = (id) => {
        this.close();
        resolve(id);
      };
      opts.signal.addEventListener('abort', () => this.close(), { once: true });
      this.render();
      this.el.hidden = false;
      // Фокус — на группе, а не на первом варианте: иначе после клавиатуры первый вариант сразу выглядит выбранным
      // (решение владельца 2026-10-13). Tab ведёт к вариантам, цифры 1–9 выбирают.
      this.el.focus({ preventScroll: true });
      const useTimer = opts.timers && p.timer_ms !== null && p.default_option !== null;
      if (useTimer && p.timer_ms !== null) this.startTimer(p.timer_ms);
    });
  }

  /** Номер варианта с клавиатуры (1..n); true — нажатие обработано. */
  chooseByIndex(index: number): boolean {
    const btn = this.buttons[index];
    if (!this.pending || !btn || btn.disabled) return false;
    btn.click();
    return true;
  }

  /** Язык сменили: перерисовать подписи, сохранив выбранную кнопку и таймер. */
  refresh(): void {
    if (!this.pending) return;
    const focusedId = this.el.querySelector<HTMLElement>(':focus')?.dataset.id;
    this.render();
    if (focusedId) this.el.querySelector<HTMLButtonElement>(`[data-id="${focusedId}"]`)?.focus({ preventScroll: true });
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (!this.timerBar) return;
    if (paused) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.remaining = Math.max(0, this.remaining - (performance.now() - this.startedAt));
      this.timerBar.style.animationPlayState = 'paused';
    } else {
      this.timerBar.style.animationPlayState = 'running';
      this.arm(this.remaining);
    }
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timerBar = null;
    this.timerWrap = null;
    this.pending = null;
    this.pick = null;
    this.paused = false;
    this.el.hidden = true;
    this.el.classList.remove('is-deduction');
    this.el.replaceChildren();
    this.buttons = [];
  }

  // ───────────────────────────── внутренности ─────────────────────────────

  private render(): void {
    const p = this.pending;
    if (!p) return;
    this.el.classList.toggle('is-deduction', p.deduction !== null);
    this.promptEl = p.prompt_key ? h('p', { class: 'vn-choices__prompt', text: t(p.prompt_key) }) : null;
    this.buttons = p.options.map((o, i) => this.option(o, i));
    this.el.setAttribute('aria-label', p.prompt_key ? t(p.prompt_key) : '');
    const kids: Node[] = [];
    // По макету (Figma «Claude», узел 1232:1660): вопрос, под ним тонкая линия, затем варианты одним списком —
    // список нужен, чтобы при наведении на вариант остальные гасли (CSS .vn-choices__list:hover).
    if (this.promptEl) kids.push(this.promptEl, h('hr', { class: 'vn-choices__rule' }));
    if (p.deduction?.meter) kids.push(this.meter(p.deduction.meter));
    kids.push(h('div', { class: 'vn-choices__list' }, ...this.buttons));
    if (p.options.some((o) => o.hinted)) kids.push(h('p', { class: 'vn-choices__hint', id: this.hintId, text: t('ui.choice.hint') }));
    if (this.timerWrap) kids.push(this.timerWrap);
    this.el.replaceChildren(...kids);
  }

  private option(o: ChoiceOptionView, i: number): HTMLButtonElement {
    const label = t(o.key);
    const cls = ['vn-choice'];
    if (!o.enabled) cls.push('is-disabled');
    if (o.tried) cls.push('is-tried');
    if (o.hinted) cls.push('is-hint');
    if (o.item) cls.push('is-card');
    const aria: Record<string, string | boolean> = { disabled: !o.enabled };
    if (o.tried) aria.label = `${label} — ${t('ui.choice.tried')}`;
    if (o.hinted) aria.describedby = this.hintId;
    let mark: SVGSVGElement | null = null;
    if (o.tried || o.hinted) {
      mark = icon(o.tried ? 'cross' : 'hint');
      mark.classList.add('vn-choice__mark');
    }
    return h(
      'button',
      {
        class: cls.join(' '),
        type: 'button',
        disabled: !o.enabled,
        data: o.item ? { id: o.id, item: o.item.id, kind: o.item.kind } : { id: o.id },
        aria,
        on: { click: () => o.enabled && this.pick?.(o.id) },
      },
      h('span', { class: 'vn-choice__n', text: String(i + 1) }),
      o.item ? h('span', { class: 'vn-choice__item' }, icon(itemIcon(o.item.kind))) : null,
      h('span', { class: 'vn-choice__label', text: label }),
      mark,
    );
  }

  /** Шкала цены ошибок: точки по max, заполнено value; для скринридера — одна фраза. */
  private meter(m: DeductionMeter): HTMLElement {
    const max = Math.max(0, Math.floor(m.max));
    const value = Math.max(0, Math.min(max, Math.floor(m.value)));
    const dots = Array.from({ length: max }, (_, i) => h('i', { class: i < value ? 'vn-choices__dot is-on' : 'vn-choices__dot' }));
    return h(
      'div',
      { class: 'vn-choices__meter', role: 'img', data: { var: m.var }, aria: { label: t('ui.choice.meter_aria', { value, max }) } },
      h('span', { class: 'vn-choices__meter-label', aria: { hidden: true }, text: t('ui.choice.meter') }),
      h('span', { class: 'vn-choices__dots', aria: { hidden: true } }, ...dots),
    );
  }

  private startTimer(ms: number): void {
    const bar = h('i', { class: 'vn-choices__timer-bar', style: { 'animation-duration': `${ms}ms` } });
    const wrap = h('div', { class: 'vn-choices__timer', aria: { hidden: true } }, bar);
    this.timerBar = bar;
    this.timerWrap = wrap;
    this.el.appendChild(wrap);
    this.arm(ms);
  }

  private arm(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.startedAt = performance.now();
    this.remaining = ms;
    this.timer = setTimeout(() => {
      const def = this.pending?.default_option;
      if (def) this.pick?.(def);
    }, ms);
  }
}
