/**
 * Поиск по картотеке (database_search): карточки БТИ, фильтры по полям, отбор карточек с повторяющимися лицами.
 *
 * Колода генерируется из config (`records`, `fields`, `values`, `pattern`, `seed`) детерминированно и не зависит от
 * языка: `target_count` карточек несут паттерн (например, один нотариус и один представитель), часть «шума» совпадает
 * с паттерном лишь наполовину (поэтому одного фильтра мало), остальное — случайные значения. Значения полей — строки
 * локали (`values[].options[].text_key`; `{n}` в строке — номер квартиры), даты — дд.мм.гггг.
 *
 * Игрок листает карточки, сужает список чипами-фильтрами (поля с 2–8 вариантами), отмечает карточки (крупные строки,
 * отметка видна) и жмёт «Проверить»: подходящие закрепляются, лишние — ошибки (max_mistakes, по умолчанию 4).
 * Итог: найдены все `target_count` и ошибок меньше лимита → success; найдено не меньше `min_for_partial` → partial
 * (без min_for_partial — только «нашёл всё, но слишком много ошибок»); иначе fail.
 * Подсказка (rewarded) включает следующий фильтр паттерна. Клавиатура: Tab, Space/Enter, ↑/↓/Home/End по карточкам.
 */
import type { MinigameOutcomeKind } from '../core/types';
import { h } from '../ui/dom';
import { asInt, asStr, hashString, isRecord, mulberry32, MinigameShell } from './mg_shell';
import type { GameContext, IMinigame, MinigameConfig } from './types';
import './database_search.css';

export const TYPE = 'database_search' as const;

export interface DbOption {
  id: string;
  textKey: string;
}

export interface DbField {
  field: string;
  labelKey: string | null;
  options: DbOption[];
  /** Чипы-фильтры по этому полю. */
  filter: boolean;
  /** Поле заполняется датами (дд.мм.гггг), без вариантов. */
  isDate: boolean;
}

export interface DbConfig {
  /** Поля карточки в порядке config.fields (только те, что можно показать). */
  fields: DbField[];
  records: number;
  /** Поле → id значения, повторяющегося у целевых карточек. */
  pattern: Record<string, string>;
  /** Поля паттерна в порядке fields (для подсказок). */
  patternFields: string[];
  targetCount: number;
  minForPartial: number | null;
  maxMistakes: number;
  seed: number | null;
}

/** Чипы-фильтры получают поля, у которых вариантов не больше этого. */
const MAX_FILTER_OPTIONS = 8;

/** Разобрать config; null — непригоден (оболочка покажет grey-box). */
export function parseDbConfig(cfg: MinigameConfig): DbConfig | null {
  const names = cfg.fields;
  if (!Array.isArray(names) || names.length < 2 || !names.every((n) => asStr(n) !== null)) return null;
  const order = [...new Set(names as string[])];

  const entries = new Map<string, Record<string, unknown>>();
  if (Array.isArray(cfg.values)) {
    for (const v of cfg.values) {
      const field = isRecord(v) ? asStr(v.field) : null;
      if (isRecord(v) && field !== null && order.includes(field)) entries.set(field, v);
    }
  }

  const fields: DbField[] = [];
  for (const name of order) {
    const e = entries.get(name);
    const options: DbOption[] = [];
    if (e && Array.isArray(e.options)) {
      for (const o of e.options) {
        const id = isRecord(o) ? asStr(o.id) : null;
        const textKey = isRecord(o) ? asStr(o.text_key) : null;
        if (id === null || textKey === null || options.some((x) => x.id === id)) return null;
        options.push({ id, textKey });
      }
    }
    const isDate = name === 'date' && options.length === 0;
    // Поле без значений и не дата показать нечем — пропускаем (паттерн на такое поле проверяется ниже).
    if (options.length === 0 && !isDate) continue;
    fields.push({
      field: name,
      labelKey: e ? asStr(e.label_key) : null,
      options,
      filter: !isDate && options.length >= 2 && options.length <= MAX_FILTER_OPTIONS && e?.filter !== false,
      isDate,
    });
  }
  if (fields.length < 2) return null;

  const rawPattern = cfg.pattern;
  if (!isRecord(rawPattern)) return null;
  const pattern: Record<string, string> = {};
  for (const [name, id] of Object.entries(rawPattern)) {
    const f = fields.find((x) => x.field === name);
    if (!f || typeof id !== 'string' || f.options.length < 2 || !f.options.some((o) => o.id === id)) return null;
    pattern[name] = id;
  }
  const patternFields = fields.map((f) => f.field).filter((n) => n in pattern);
  if (patternFields.length === 0) return null;

  const records = asInt(cfg.records, 1);
  const targetCount = asInt(cfg.target_count, 1);
  if (records === null || targetCount === null || targetCount > records) return null;
  const minRaw = asInt(cfg.min_for_partial, 1);
  return {
    fields,
    records,
    pattern,
    patternFields,
    targetCount,
    minForPartial: minRaw === null ? null : Math.min(minRaw, targetCount),
    maxMistakes: asInt(cfg.max_mistakes, 1) ?? 4,
    seed: asInt(cfg.seed),
  };
}

export interface DbCard {
  /** c01…: порядок в картотеке (по дате). */
  id: string;
  /** Номер квартиры/дома для адреса. */
  n: number;
  /** ISO-дата гггг-мм-дд. */
  date: string;
  /** Несёт весь паттерн. */
  target: boolean;
  /** Поле → id значения (для полей с вариантами). */
  values: Record<string, string>;
}

export interface DeckSpec {
  fields: ReadonlyArray<{ field: string; optionIds: readonly string[]; isDate: boolean }>;
  pattern: Readonly<Record<string, string>>;
  records: number;
  targets: number;
  seed: number;
}

const DAY_MS = 86_400_000;
const FIRST_DAY = Date.UTC(1992, 0, 1);
const LAST_DAY = Date.UTC(1994, 2, 31);

/**
 * Колода: `targets` карточек с паттерном; по `⌊шум/4⌋` карточек на каждое поле паттерна совпадают только по нему
 * (при двух и более полях паттерна); остальные не совпадают ни по одному полю паттерна. Порядок — по дате.
 */
export function buildDeck(spec: DeckSpec): DbCard[] {
  const rnd = mulberry32(spec.seed);
  const int = (n: number): number => Math.floor(rnd() * n);
  const optionFields = spec.fields.filter((f) => !f.isDate && f.optionIds.length > 0);
  const patternFields = optionFields.filter((f) => f.field in spec.pattern).map((f) => f.field);
  const noise = Math.max(0, spec.records - spec.targets);
  const nearEach = patternFields.length >= 2 ? Math.min(Math.floor(noise * 0.25), Math.floor(noise / patternFields.length)) : 0;

  const make = (matched: ReadonlySet<string>, target: boolean): DbCard => {
    const values: Record<string, string> = {};
    for (const f of optionFields) {
      const wanted = spec.pattern[f.field];
      if (wanted !== undefined && matched.has(f.field)) values[f.field] = wanted;
      else {
        const pool = wanted === undefined ? f.optionIds : f.optionIds.filter((id) => id !== wanted);
        values[f.field] = pool[int(pool.length)] ?? f.optionIds[0] ?? '';
      }
    }
    const day = FIRST_DAY + int(Math.round((LAST_DAY - FIRST_DAY) / DAY_MS) + 1) * DAY_MS;
    return { id: '', n: 1 + int(180), date: new Date(day).toISOString().slice(0, 10), target, values };
  };

  const cards: DbCard[] = [];
  for (let i = 0; i < spec.targets; i++) cards.push(make(new Set(patternFields), true));
  for (const only of patternFields) {
    if (nearEach === 0) break;
    for (let i = 0; i < nearEach; i++) cards.push(make(new Set([only]), false));
  }
  while (cards.length < spec.records) cards.push(make(new Set(), false));

  // Перемешать (Фишер — Йейтс), затем по дате; одинаковые даты остаются в перемешанном порядке.
  for (let i = cards.length - 1; i > 0; i--) {
    const j = int(i + 1);
    const a = cards[i];
    const b = cards[j];
    if (a && b) {
      cards[i] = b;
      cards[j] = a;
    }
  }
  cards.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  cards.forEach((c, i) => {
    c.id = `c${String(i + 1).padStart(2, '0')}`;
  });
  return cards;
}

/** гггг-мм-дд → дд.мм.гггг. */
export function formatDate(iso: string): string {
  const [y = '', m = '', d = ''] = iso.split('-');
  return `${d}.${m}.${y}`;
}

interface CardEls {
  li: HTMLElement;
  btn: HTMLButtonElement;
  cells: Map<string, HTMLElement>;
  keys: Map<string, HTMLElement>;
  badge: HTMLElement;
}

interface ChipRow {
  field: DbField;
  /** Строка фильтра: подпись и чипы. */
  el: HTMLElement;
  /** Кнопка поля в полосе полей (узкий экран: открывает чипы этого поля). */
  tab: HTMLButtonElement;
  tabLabel: HTMLElement;
  tabValue: HTMLElement;
  label: HTMLElement;
  group: HTMLElement;
  all: HTMLButtonElement;
  chips: Map<string, HTMLButtonElement>;
}

class DatabaseSearch extends MinigameShell {
  protected override readonly type = TYPE;
  protected override readonly cls = 'mg-db';

  private cfg!: DbConfig;
  private deck: DbCard[] = [];
  private fieldByName = new Map<string, DbField>();

  // состояние партии
  private filters: Record<string, string> = {};
  private picked = new Set<string>();
  private found = new Set<string>();
  private rejected = new Set<string>();

  // DOM
  private rows: ChipRow[] = [];
  private filtersBox!: HTMLElement;
  /** Поле, чипы которого раскрыты на узком экране (на широком видны все). */
  private openField: string | null = null;
  private list!: HTMLElement;
  private shown!: HTMLElement;
  private marked!: HTMLElement;
  private empty!: HTMLElement;
  private checkBtn!: HTMLButtonElement;
  private cards = new Map<string, CardEls>();

  protected override parse(cfg: MinigameConfig, ctx: GameContext): boolean {
    const parsed = parseDbConfig(cfg);
    if (!parsed) return false;
    this.cfg = parsed;
    this.fieldByName = new Map(parsed.fields.map((f) => [f.field, f]));
    this.deck = buildDeck({
      fields: parsed.fields.map((f) => ({ field: f.field, optionIds: f.options.map((o) => o.id), isDate: f.isDate })),
      pattern: parsed.pattern,
      records: parsed.records,
      targets: parsed.targetCount,
      seed: parsed.seed ?? hashString(ctx.def.id),
    });
    return true;
  }

  // ───────────────────────────── разметка ─────────────────────────────

  protected override build(): HTMLElement {
    const { cfg } = this;

    let seq = 0;
    this.rows = cfg.fields
      .filter((f) => f.filter)
      .map((f) => {
        const id = `mg-db-${++seq}-${f.field}`;
        const label = h('span', { class: 'mg-db__flabel' });
        const all = h('button', { class: 'mg-db__chip is-all', type: 'button', on: { click: () => this.setFilter(f.field, null) } });
        const chips = new Map(
          f.options.map((o) => [o.id, h('button', { class: 'mg-db__chip', type: 'button', data: { field: f.field, opt: o.id }, on: { click: () => this.setFilter(f.field, o.id) } })] as const),
        );
        const group = h('div', { class: 'mg-db__chips', role: 'group' }, all, ...chips.values());
        const el = h('div', { class: 'mg-db__filter', id, data: { field: f.field } }, label, group);
        const tabLabel = h('span', { class: 'mg-db__ftab-label' });
        const tabValue = h('span', { class: 'mg-db__ftab-value' });
        const tab = h('button', { class: 'mg-db__ftab', type: 'button', aria: { controls: id }, data: { field: f.field }, on: { click: () => this.openFilter(f.field) } }, tabLabel, tabValue);
        return { field: f, el, tab, tabLabel, tabValue, label, group, all, chips };
      });
    this.openField = this.rows[0]?.field.field ?? null;
    // Узкий экран: полоса из полей, под ней чипы выбранного поля (без прокрутки вбок). Широкий: все строки сразу.
    const ftabs = h('div', { class: 'mg-db__ftabs' }, ...this.rows.map((r) => r.tab));
    ftabs.hidden = this.rows.length < 2;
    this.filtersBox = h('div', { class: 'mg-db__filters' }, ftabs, ...this.rows.map((r) => r.el));
    this.filtersBox.hidden = this.rows.length === 0;

    this.shown = h('span', { class: 'mg-db__shown' });
    this.marked = h('span', { class: 'mg-db__marked' });
    const meta = h('div', { class: 'mg-db__meta' }, this.shown, this.marked);

    this.list = h('ul', { class: 'mg-db__list', on: { keydown: (e) => this.onListKey(e) } });
    this.cards.clear();
    const [titleField, ...rest] = cfg.fields;
    for (const card of this.deck) {
      const cells = new Map<string, HTMLElement>();
      const keys = new Map<string, HTMLElement>();
      const cell = (f: DbField, cls: string): HTMLElement => {
        const k = h('span', { class: 'mg-db__k' });
        const v = h('span', { class: 'mg-db__v' });
        cells.set(f.field, v);
        keys.set(f.field, k);
        return h('span', { class: `mg-db__cell ${cls}` }, k, v);
      };
      const dateField = rest.find((f) => f.isDate);
      const badge = h('span', { class: 'mg-db__badge' });
      const top = h('span', { class: 'mg-db__top' }, titleField ? cell(titleField, 'is-title') : null, dateField && dateField !== titleField ? cell(dateField, 'is-date') : null, badge);
      const body = h('span', { class: 'mg-db__cells' }, ...rest.filter((f) => !f.isDate).map((f) => cell(f, '')));
      const btn = h(
        'button',
        { class: 'mg-db__card', type: 'button', role: 'checkbox', aria: { checked: false }, data: { id: card.id }, on: { click: () => this.togglePick(card.id) } },
        h('span', { class: 'mg-db__box', aria: { hidden: true } }),
        h('span', { class: 'mg-db__body' }, top, body),
      );
      const li = h('li', { class: 'mg-db__item' }, btn);
      this.cards.set(card.id, { li, btn, cells, keys, badge });
      this.list.appendChild(li);
    }
    this.empty = h('p', { class: 'mg-db__empty', hidden: true });

    this.checkBtn = h('button', { class: 'mg-btn mg-shell__btn is-check is-primary', type: 'button', on: { click: () => this.verify() } });
    return h('div', { class: 'mg-db__wrap' }, this.filtersBox, meta, this.list, this.empty);
  }

  protected override extraActions(): HTMLElement[] {
    return [this.checkBtn];
  }

  protected override extraActionsVisible(): boolean {
    return true;
  }

  // ───────────────────────────── отрисовка ─────────────────────────────

  private labelOf(f: DbField): string {
    return f.labelKey ? this.t(f.labelKey) : f.field;
  }

  /** Значение поля карточки на текущем языке. */
  private cellText(card: DbCard, f: DbField): string {
    if (f.isDate) return formatDate(card.date);
    const opt = f.options.find((o) => o.id === card.values[f.field]);
    return opt ? this.t(opt.textKey, { n: card.n }) : '—';
  }

  /** Текст варианта для чипа и подсказки (номер квартиры здесь не нужен). */
  private optionText(f: DbField, id: string): string {
    const opt = f.options.find((o) => o.id === id);
    return opt ? this.t(opt.textKey, { n: '' }).trim() : id;
  }

  private visible(card: DbCard): boolean {
    return Object.entries(this.filters).every(([field, id]) => card.values[field] === id);
  }

  protected override paint(): void {
    for (const row of this.rows) {
      const isOpen = this.rows.length < 2 || row.field.field === this.openField;
      row.el.classList.toggle('is-open', isOpen);
      row.tab.classList.toggle('is-open', isOpen);
      row.tab.setAttribute('aria-expanded', String(isOpen));
      row.label.textContent = this.labelOf(row.field);
      row.tabLabel.textContent = this.labelOf(row.field);
      row.group.setAttribute('aria-label', this.labelOf(row.field));
      const active = this.filters[row.field.field] ?? null;
      row.tab.classList.toggle('has-value', active !== null);
      row.tabValue.textContent = active !== null ? this.optionText(row.field, active) : '';
      row.all.textContent = this.t('ui.minigame.all');
      row.all.setAttribute('aria-pressed', String(active === null));
      row.all.classList.toggle('is-on', active === null);
      for (const [id, chip] of row.chips) {
        const opt = row.field.options.find((o) => o.id === id);
        chip.textContent = opt ? this.optionText(row.field, id) : id;
        chip.setAttribute('aria-pressed', String(active === id));
        chip.classList.toggle('is-on', active === id);
      }
    }

    let visible = 0;
    for (const card of this.deck) {
      const els = this.cards.get(card.id);
      if (!els) continue;
      const show = this.visible(card);
      if (show) visible += 1;
      els.li.hidden = !show;
      const isFound = this.found.has(card.id);
      const isRejected = this.rejected.has(card.id);
      const isPicked = this.picked.has(card.id);
      els.btn.classList.toggle('is-picked', isPicked);
      els.btn.classList.toggle('is-found', isFound);
      els.btn.classList.toggle('is-rejected', isRejected);
      els.btn.setAttribute('aria-checked', String(isPicked || isFound));
      els.btn.setAttribute('aria-disabled', String(isFound || isRejected || !this.canAct()));
      els.badge.textContent = isFound ? this.t('ui.minigame.match') : isRejected ? this.t('ui.minigame.no_match') : '';
      for (const f of this.cfg.fields) {
        const v = els.cells.get(f.field);
        const k = els.keys.get(f.field);
        if (v) {
          v.textContent = this.cellText(card, f);
          v.classList.toggle('is-hit', this.filters[f.field] !== undefined && this.filters[f.field] === card.values[f.field]);
        }
        if (k) k.textContent = this.labelOf(f);
      }
    }
    this.shown.textContent = this.t('ui.minigame.shown', { n: visible, total: this.deck.length });
    this.marked.textContent = this.t('ui.minigame.selected', { n: this.picked.size });
    this.empty.hidden = visible > 0;
    this.empty.textContent = this.t('ui.minigame.no_cards');
    this.checkBtn.textContent = `${this.t('ui.minigame.check')}${this.picked.size > 0 ? ` (${this.picked.size})` : ''}`;
    this.checkBtn.disabled = this.picked.size === 0 || !this.canAct();
  }

  // ───────────────────────────── ввод ─────────────────────────────

  /** Изменение, которое не может закончить партию: перерисовать и сохранить. */
  private touch(): void {
    this.render();
    this.ctx.autosave();
  }

  private setFilter(field: string, id: string | null): void {
    if (!this.canAct()) return;
    if (id === null || this.filters[field] === id) delete this.filters[field];
    else this.filters[field] = id;
    this.touch();
  }

  private openFilter(field: string): void {
    if (!this.canAct() || this.openField === field) return;
    this.openField = field;
    this.render();
  }

  private togglePick(id: string): void {
    if (!this.canAct() || this.found.has(id) || this.rejected.has(id)) return;
    if (!this.picked.delete(id)) this.picked.add(id);
    this.touch();
  }

  /** «Проверить»: подходящие закрепляются, лишние — ошибки. */
  private verify(): void {
    if (!this.canAct() || this.picked.size === 0) return;
    let ok = 0;
    let bad = 0;
    for (const card of this.deck) {
      if (!this.picked.has(card.id)) continue;
      if (card.target) {
        this.found.add(card.id);
        ok += 1;
      } else {
        this.rejected.add(card.id);
        bad += 1;
      }
    }
    this.picked.clear();
    this.say(() =>
      [ok > 0 ? `${this.t('ui.minigame.match')}: ${ok}` : '', bad > 0 ? `${this.t('ui.minigame.no_match')}: ${bad}` : ''].filter(Boolean).join(' · '),
    );
    this.moved();
  }

  private onListKey(e: KeyboardEvent): void {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
    const cur = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('button.mg-db__card');
    if (!cur) return;
    const buttons = [...this.list.querySelectorAll<HTMLButtonElement>('li:not([hidden]) > button.mg-db__card')];
    const i = buttons.indexOf(cur);
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : e.key === 'ArrowDown' ? Math.min(buttons.length - 1, i + 1) : Math.max(0, i - 1);
    e.preventDefault();
    buttons[to]?.focus();
  }

  // ───────────────────────────── правила игры ─────────────────────────────

  protected override fails(): number {
    return this.rejected.size;
  }

  protected override failLimit(): number {
    return this.cfg.maxMistakes;
  }

  protected override failLabelKey(): string {
    return 'ui.minigame.mistakes';
  }

  protected override progress(): { n: number; total: number } {
    return { n: this.found.size, total: this.cfg.targetCount };
  }

  protected override isComplete(): boolean {
    return this.found.size >= this.cfg.targetCount;
  }

  protected override evaluate(): MinigameOutcomeKind {
    const found = this.found.size;
    if (found >= this.cfg.targetCount && this.rejected.size < this.cfg.maxMistakes) return 'success';
    return found >= (this.cfg.minForPartial ?? this.cfg.targetCount) ? 'partial' : 'fail';
  }

  /** Подсказка включает по одному фильтру паттерна: сначала первое поле, затем второе… */
  protected override canHint(): boolean {
    return this.hintsUsed < this.cfg.patternFields.length;
  }

  protected override giveHint(): void {
    const name = this.cfg.patternFields[this.hintsUsed - 1];
    const f = name ? this.fieldByName.get(name) : undefined;
    const id = name ? this.cfg.pattern[name] : undefined;
    if (!f || id === undefined) return;
    if (f.filter) {
      this.filters[f.field] = id;
      this.openField = f.field;
      const chip = this.rows.find((r) => r.field === f)?.chips.get(id);
      if (chip && typeof chip.scrollIntoView === 'function') chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    this.say(() => `${this.t('ui.minigame.hint')}: ${this.labelOf(f)} — ${this.optionText(f, id)}`);
  }

  // ───────────────────────────── сейв ─────────────────────────────

  protected override saveState(): Record<string, unknown> {
    // Карточки — в порядке картотеки: состояние не зависит от порядка нажатий.
    const inDeck = (ids: ReadonlySet<string>): string[] => this.deck.filter((c) => ids.has(c.id)).map((c) => c.id);
    return { filters: { ...this.filters }, picked: inDeck(this.picked), found: inDeck(this.found), rejected: inDeck(this.rejected) };
  }

  protected override loadState(s: Record<string, unknown>): void {
    this.filters = {};
    if (isRecord(s.filters)) {
      for (const [field, id] of Object.entries(s.filters)) {
        const f = this.fieldByName.get(field);
        if (f?.filter && typeof id === 'string' && f.options.some((o) => o.id === id)) this.filters[field] = id;
      }
    }
    const byId = new Map(this.deck.map((c) => [c.id, c]));
    const ids = (v: unknown, ok: (c: DbCard) => boolean): Set<string> => {
      const out = new Set<string>();
      if (Array.isArray(v)) {
        for (const x of v) {
          const c = typeof x === 'string' ? byId.get(x) : undefined;
          if (c && ok(c)) out.add(c.id);
        }
      }
      return out;
    };
    this.found = ids(s.found, (c) => c.target);
    this.rejected = ids(s.rejected, (c) => !c.target);
    this.picked = ids(s.picked, (c) => !this.found.has(c.id) && !this.rejected.has(c.id));
  }
}

export function createDatabaseSearch(): IMinigame {
  return new DatabaseSearch();
}
