/** Крошечный помощник построения DOM без фреймворка: h('button', { class: 'x', on: { click } }, 'текст'). */

export type Child = Node | string | number | null | undefined | false;

type Handlers = { [K in keyof HTMLElementEventMap]?: (ev: HTMLElementEventMap[K]) => void };

export interface Attrs {
  class?: string;
  id?: string;
  text?: string;
  title?: string;
  role?: string;
  type?: string;
  name?: string;
  value?: string | number;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  lang?: string;
  hidden?: boolean;
  disabled?: boolean;
  checked?: boolean;
  tabindex?: number;
  data?: Record<string, string | number | boolean>;
  aria?: Record<string, string | number | boolean>;
  /** Строка CSS или набор свойств (в том числе пользовательских --x). */
  style?: string | Record<string, string>;
  on?: Handlers;
}

const PROPS = new Set(['class', 'id', 'text', 'title', 'role', 'type', 'name', 'value', 'min', 'max', 'step', 'lang', 'hidden', 'disabled', 'checked', 'tabindex', 'data', 'aria', 'style', 'on']);

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const key of Object.keys(attrs)) {
    if (!PROPS.has(key)) throw new Error(`h(): неизвестный атрибут ${key}`);
  }
  if (attrs.class) el.className = attrs.class;
  if (attrs.id) el.id = attrs.id;
  if (attrs.title) el.title = attrs.title;
  if (attrs.role) el.setAttribute('role', attrs.role);
  if (attrs.type) el.setAttribute('type', attrs.type);
  if (attrs.name) el.setAttribute('name', attrs.name);
  if (attrs.lang) el.setAttribute('lang', attrs.lang);
  if (attrs.min !== undefined) el.setAttribute('min', String(attrs.min));
  if (attrs.max !== undefined) el.setAttribute('max', String(attrs.max));
  if (attrs.step !== undefined) el.setAttribute('step', String(attrs.step));
  if (attrs.tabindex !== undefined) el.tabIndex = attrs.tabindex;
  if (attrs.hidden) el.hidden = true;
  if (attrs.disabled && 'disabled' in el) (el as unknown as HTMLButtonElement).disabled = true;
  if (attrs.value !== undefined && 'value' in el) (el as unknown as HTMLInputElement).value = String(attrs.value);
  if (attrs.checked !== undefined && 'checked' in el) (el as unknown as HTMLInputElement).checked = attrs.checked;
  if (attrs.data) for (const [k, v] of Object.entries(attrs.data)) el.dataset[k] = String(v);
  if (attrs.aria) for (const [k, v] of Object.entries(attrs.aria)) el.setAttribute(`aria-${k}`, String(v));
  if (typeof attrs.style === 'string') el.setAttribute('style', attrs.style);
  else if (attrs.style) for (const [k, v] of Object.entries(attrs.style)) el.style.setProperty(k, v);
  if (attrs.on) {
    for (const [k, fn] of Object.entries(attrs.on)) el.addEventListener(k, fn as EventListener);
  }
  if (attrs.text !== undefined) el.textContent = attrs.text;
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Заменить содержимое элемента; null / undefined / false пропускаются. */
export function fill(el: Element, ...children: Child[]): void {
  el.replaceChildren(...children.filter((c): c is Node | string | number => c !== null && c !== undefined && c !== false).map((c) => (typeof c === 'number' ? String(c) : c)));
}

/** Ожидание в миллисекундах; можно прервать сигналом (резолвится досрочно, не бросает). */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}
