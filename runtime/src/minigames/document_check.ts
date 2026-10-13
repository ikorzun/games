/**
 * Сверка документов (document_check): игрок сравнивает документы и отмечает то, что не сходится.
 *
 * Документ — бумажный лист: картинка из `assets.documents` (бланк без текста) под текстом из локали;
 * нет файла — бумажный плейсхолдер. Текст документа берётся там же, где его показывает шаг `document`
 * (`text_key` шага или archive_items[asset]); кликабельные фрагменты — `config.fields[].text_key`, строки,
 * которые дословно входят в этот текст. Фрагмент из `discrepancies` — настоящее несоответствие,
 * остальные — ловушки (кликабельны первые `decoys` штук). Нажатие по ловушке — ошибка.
 *
 * Телефон: документы — вкладки (и свайп по листу), фрагменты — крупные тап-зоны (≥ 44 px);
 * широкий экран: листы рядом. Клавиатура: Tab по фрагментам, Enter/Space — отметить, ←/→ — вкладки.
 *
 * Итог: найдено `required` несоответствий → success; хотя бы одно → partial; иначе fail.
 * Игра заканчивается, когда найдено нужное, ошибок стало max_mistakes или вышло время.
 */
import type { Episode, MinigameOutcomeKind } from '../core/types';
import { joinUrl } from '../stage/assets';
import { cssUrl, fill, h } from '../ui/dom';
import { asInt, asStr, isRecord, MinigameShell, warnMissingAsset } from './mg_shell';
import type { GameContext, IMinigame, MinigameConfig } from './types';
import './document_check.css';

export const TYPE = 'document_check' as const;

export interface DocField {
  doc: string;
  field: string;
  textKey: string;
  /** Настоящее несоответствие (есть в discrepancies). */
  discrepancy: boolean;
  hintKey: string | null;
}

export interface DocsConfig {
  documents: string[];
  /** Все фрагменты из config.fields. */
  fields: DocField[];
  /** Кликабельные: несоответствия и первые `decoys` ловушек. */
  active: DocField[];
  required: number;
  maxMistakes: number;
}

export const fieldKey = (doc: string, field: string): string => `${doc}/${field}`;

/** Разобрать config; null — непригоден (оболочка покажет grey-box). */
export function parseDocsConfig(cfg: MinigameConfig): DocsConfig | null {
  const docsRaw = cfg.documents;
  if (!Array.isArray(docsRaw) || docsRaw.length === 0 || !docsRaw.every((d) => asStr(d) !== null)) return null;
  const documents = [...new Set(docsRaw as string[])];

  const fieldsRaw = cfg.fields;
  const discRaw = cfg.discrepancies;
  if (!Array.isArray(fieldsRaw) || fieldsRaw.length === 0 || !Array.isArray(discRaw) || discRaw.length === 0) return null;

  const discrepancies = new Map<string, string | null>();
  for (const d of discRaw) {
    if (!isRecord(d)) return null;
    const doc = asStr(d.doc);
    const field = asStr(d.field);
    if (doc === null || field === null || !documents.includes(doc)) return null;
    discrepancies.set(fieldKey(doc, field), asStr(d.hint_key));
  }

  const fields: DocField[] = [];
  const seen = new Set<string>();
  for (const f of fieldsRaw) {
    if (!isRecord(f)) return null;
    const doc = asStr(f.doc);
    const field = asStr(f.field);
    const textKey = asStr(f.text_key);
    if (doc === null || field === null || textKey === null || !documents.includes(doc)) return null;
    const key = fieldKey(doc, field);
    if (seen.has(key)) return null;
    seen.add(key);
    fields.push({ doc, field, textKey, discrepancy: discrepancies.has(key), hintKey: discrepancies.get(key) ?? null });
  }
  // Каждое несоответствие обязано быть нажимаемым фрагментом.
  for (const key of discrepancies.keys()) if (!seen.has(key)) return null;

  const decoyLimit = asInt(cfg.decoys, 0) ?? Number.POSITIVE_INFINITY;
  let decoys = 0;
  const active = fields.filter((f) => f.discrepancy || decoys++ < decoyLimit);

  const required = Math.min(asInt(cfg.required, 1) ?? discrepancies.size, discrepancies.size);
  return { documents, fields, active, required, maxMistakes: asInt(cfg.max_mistakes, 1) ?? 3 };
}

/** Ключ текста документа: сначала шаги `document` (как их показывает игра), затем archive_items[asset]. */
export function docTextKey(episode: Episode, docId: string): string | null {
  for (const scene of Object.values(episode.scenes)) {
    for (const step of scene.steps) {
      if (step.do === 'document' && step.doc === docId && step.text_key) return step.text_key;
    }
  }
  return episode.archive_items?.find((a) => a.asset === docId && a.text_key)?.text_key ?? null;
}

export type Segment = string | { key: string };

/**
 * Разрезать текст на обычные куски и фрагменты. Фрагмент ищется дословно (неразрывный пробел равен обычному),
 * каждое вхождение занято не больше одного раза; не нашёлся — попадает в `orphans`.
 */
export function segmentText(text: string, snippets: ReadonlyArray<{ key: string; text: string }>): { parts: Segment[]; orphans: string[] } {
  const norm = (s: string): string => s.replace(/ /g, ' ');
  const hay = norm(text);
  const claimed: Array<{ start: number; end: number; key: string }> = [];
  const orphans: string[] = [];
  for (const sn of snippets) {
    const needle = norm(sn.text);
    let at = needle === '' ? -1 : hay.indexOf(needle);
    while (at >= 0 && claimed.some((c) => at < c.end && at + needle.length > c.start)) at = hay.indexOf(needle, at + 1);
    if (at < 0) orphans.push(sn.key);
    else claimed.push({ start: at, end: at + needle.length, key: sn.key });
  }
  claimed.sort((a, b) => a.start - b.start);
  const parts: Segment[] = [];
  let pos = 0;
  for (const c of claimed) {
    if (c.start > pos) parts.push(text.slice(pos, c.start));
    parts.push({ key: c.key });
    pos = c.end;
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return { parts, orphans };
}

interface Sheet {
  doc: string;
  tab: HTMLButtonElement;
  el: HTMLElement;
  cap: HTMLElement;
  text: HTMLElement;
  orphans: HTMLElement;
  /** Подпись содержимого, чтобы не пересобирать абзац (и не терять фокус) без смены текста. */
  signature: string;
}

let seq = 0;

class DocumentCheck extends MinigameShell {
  protected override readonly type = TYPE;
  protected override readonly cls = 'mg-docs';

  private cfg!: DocsConfig;
  private byKey = new Map<string, DocField>();
  /** Ключ текста каждого документа (искать по сценам один раз, а не при каждой перерисовке). */
  private textKeys = new Map<string, string | null>();

  // состояние партии
  private found: string[] = [];
  private wrong: string[] = [];
  private hinted: string[] = [];
  private tab = 0;

  // DOM
  private sheets: Sheet[] = [];
  private tabs!: HTMLElement;
  private notes!: HTMLElement;
  private frags = new Map<string, HTMLButtonElement[]>();

  protected override parse(cfg: MinigameConfig, _ctx: GameContext): boolean {
    const parsed = parseDocsConfig(cfg);
    if (!parsed) return false;
    this.cfg = parsed;
    this.byKey = new Map(parsed.fields.map((f) => [fieldKey(f.doc, f.field), f]));
    this.textKeys = new Map(parsed.documents.map((d) => [d, docTextKey(this.ctx.episode, d)]));
    return true;
  }

  // ───────────────────────────── разметка ─────────────────────────────

  protected override build(): HTMLElement {
    const id = ++seq;
    this.tabs = h('div', { class: 'mg-docs__tabs', role: 'tablist', on: { keydown: (e) => this.onTabKey(e) } });
    const sheetsBox = h('div', { class: 'mg-docs__sheets' });
    this.sheets = this.cfg.documents.map((doc, i) => {
      const tab = h('button', {
        class: 'mg-docs__tab',
        type: 'button',
        role: 'tab',
        id: `mg-docs-${id}-tab-${i}`,
        aria: { controls: `mg-docs-${id}-sheet-${i}` },
        on: { click: () => this.setTab(i, true) },
      });
      const cap = h('header', { class: 'mg-docs__cap' });
      const text = h('p', { class: 'mg-docs__text' });
      const orphans = h('p', { class: 'mg-docs__orphans' });
      const el = h(
        'article',
        { class: 'mg-docs__sheet', role: 'tabpanel', id: `mg-docs-${id}-sheet-${i}`, aria: { labelledby: `mg-docs-${id}-tab-${i}` }, data: { doc } },
        cap,
        text,
        orphans,
      );
      this.loadScan(el, doc);
      this.tabs.appendChild(tab);
      sheetsBox.appendChild(el);
      return { doc, tab, el, cap, text, orphans, signature: '' };
    });
    this.notes = h('ul', { class: 'mg-docs__notes' });
    this.bindSwipe(sheetsBox);
    // Одна вкладка — вкладок не нужно.
    this.tabs.hidden = this.sheets.length < 2;
    return h('div', { class: 'mg-docs__wrap' }, this.tabs, sheetsBox, this.notes);
  }

  /**
   * Картинка документа (бланк без текста) из assets.documents — подложка листа; нет файла — бумага. Бумага с текстом
   * в самой картинке (localized: true) подложкой не годится — текст лёг бы на текст: лист остаётся бумагой.
   */
  private loadScan(sheet: HTMLElement, doc: string): void {
    const entry = this.ctx.episode.assets?.documents?.find((d) => d.id === doc);
    const path = entry && !entry.localized ? entry.path : undefined;
    if (!path) return;
    const url = joinUrl(import.meta.env.BASE_URL, path);
    const img = new Image();
    img.addEventListener('load', () => {
      // Адрес в custom property читается от таблицы стилей, а не от страницы, — поэтому абсолютный (см. cssUrl).
      sheet.style.setProperty('--doc-scan', cssUrl(url));
      sheet.classList.add('has-scan');
    });
    img.addEventListener('error', () => warnMissingAsset(url));
    img.src = url;
  }

  private bindSwipe(box: HTMLElement): void {
    let sx = 0;
    let sy = 0;
    let tracking = false;
    box.addEventListener('pointerdown', (e) => {
      tracking = e.pointerType !== 'mouse';
      sx = e.clientX;
      sy = e.clientY;
    });
    box.addEventListener('pointerup', (e) => {
      if (!tracking) return;
      tracking = false;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (Math.abs(dx) >= 56 && Math.abs(dx) > Math.abs(dy) * 1.5) this.setTab(this.tab + (dx < 0 ? 1 : -1), false);
    });
    box.addEventListener('pointercancel', () => {
      tracking = false;
    });
  }

  private onTabKey(e: KeyboardEvent): void {
    const last = this.sheets.length - 1;
    let to: number;
    if (e.key === 'ArrowRight') to = this.tab >= last ? 0 : this.tab + 1;
    else if (e.key === 'ArrowLeft') to = this.tab <= 0 ? last : this.tab - 1;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = last;
    else return;
    e.preventDefault();
    this.setTab(to, true);
  }

  private setTab(i: number, focus: boolean): void {
    if (!this.canAct()) return;
    const to = Math.min(this.sheets.length - 1, Math.max(0, i));
    if (to === this.tab) return;
    this.tab = to;
    this.paint();
    if (focus) this.sheets[to]?.tab.focus({ preventScroll: true });
    this.ctx.autosave();
  }

  // ───────────────────────────── отрисовка ─────────────────────────────

  protected override paint(): void {
    const { cfg } = this;
    this.sheets.forEach((s, i) => {
      const textKey = this.textKeys.get(s.doc) ?? null;
      const full = textKey ? this.t(textKey) : '';
      const title = this.docTitle(s.doc, full, i);
      s.tab.textContent = title;
      s.tab.title = title;
      s.cap.textContent = title;
      const selected = i === this.tab;
      s.tab.setAttribute('aria-selected', String(selected));
      s.tab.tabIndex = selected ? 0 : -1;
      s.tab.classList.toggle('is-active', selected);
      s.tab.classList.toggle('has-hint', this.hinted.some((k) => this.byKey.get(k)?.doc === s.doc && !this.found.includes(k)));
      s.el.classList.toggle('is-active', selected);

      const mine = cfg.active.filter((f) => f.doc === s.doc);
      const snippets = mine.map((f) => ({ key: fieldKey(f.doc, f.field), text: this.t(f.textKey) }));
      const signature = JSON.stringify([full, snippets]);
      if (signature !== s.signature) {
        s.signature = signature;
        this.rebuildSheet(s, full, snippets, textKey !== null);
      }
    });
    this.paintFragments();
    this.paintNotes();
  }

  private rebuildSheet(s: Sheet, full: string, snippets: Array<{ key: string; text: string }>, hasText: boolean): void {
    // Нет текста документа — фрагменты идут отдельными строками, игра остаётся проходимой.
    const { parts, orphans } = hasText ? segmentText(full, snippets) : { parts: [] as Segment[], orphans: snippets.map((x) => x.key) };
    const texts = new Map(snippets.map((x) => [x.key, x.text]));
    for (const key of [...this.frags.keys()]) if (key.startsWith(`${s.doc}/`)) this.frags.delete(key);
    const make = (key: string, extra = ''): HTMLButtonElement => {
      const f = this.byKey.get(key);
      const b = h('button', {
        class: `mg-docs__frag${extra}`,
        type: 'button',
        text: texts.get(key) ?? '',
        data: { key, doc: f?.doc ?? '', field: f?.field ?? '' },
        on: { click: () => this.mark(key) },
      });
      this.frags.set(key, [...(this.frags.get(key) ?? []), b]);
      return b;
    };
    fill(s.text, ...parts.map((p) => (typeof p === 'string' ? p : make(p.key))));
    fill(s.orphans, ...orphans.map((k) => make(k, ' is-orphan')));
    s.orphans.hidden = orphans.length === 0;
  }

  private paintFragments(): void {
    for (const [key, buttons] of this.frags) {
      const found = this.found.includes(key);
      const wrong = this.wrong.includes(key);
      const hinted = !found && this.hinted.includes(key);
      for (const b of buttons) {
        b.classList.toggle('is-found', found);
        b.classList.toggle('is-wrong', wrong);
        b.classList.toggle('is-hinted', hinted);
        b.setAttribute('aria-disabled', String(found || wrong || !this.canAct()));
      }
    }
  }

  private paintNotes(): void {
    const note = (key: string): string => {
      const hk = this.byKey.get(key)?.hintKey;
      return hk ? this.t(hk) : (this.byKey.get(key)?.field ?? key);
    };
    fill(
      this.notes,
      ...this.found.map((k) => h('li', { class: 'mg-docs__note is-found' }, h('span', { class: 'mg-docs__mark', aria: { hidden: true }, text: '✓' }), note(k))),
      ...this.hinted
        .filter((k) => !this.found.includes(k))
        .map((k) => h('li', { class: 'mg-docs__note is-hint' }, `${this.t('ui.minigame.hint')}: ${note(k)}`)),
    );
  }

  /** Название документа для вкладки: заголовок архивной записи, иначе ЗАГЛАВНЫЙ заголовок текста, иначе «Документ N». */
  private docTitle(doc: string, text: string, index: number): string {
    const item = this.ctx.episode.archive_items?.find((a) => a.asset === doc);
    if (item) return this.t(item.title_key);
    const head = /^([^.!?\n]{3,48})[.\n]/.exec(text)?.[1]?.trim();
    if (head && head === head.toLocaleUpperCase() && head !== head.toLocaleLowerCase()) {
      const lower = head.toLocaleLowerCase(this.ctx.lang);
      return lower.charAt(0).toLocaleUpperCase(this.ctx.lang) + lower.slice(1);
    }
    return this.t('ui.minigame.doc_n', { n: index + 1 });
  }

  // ───────────────────────────── ход ─────────────────────────────

  private mark(key: string): void {
    if (!this.canAct()) return;
    const f = this.byKey.get(key);
    if (!f || this.found.includes(key) || this.wrong.includes(key)) return;
    if (f.discrepancy) {
      this.found.push(key);
      this.hinted = this.hinted.filter((k) => k !== key);
      const hk = f.hintKey;
      this.say(() => (hk ? this.t(hk) : f.field));
    } else {
      this.wrong.push(key);
      this.say(() => this.t('ui.minigame.consistent'));
    }
    this.moved();
  }

  // ───────────────────────────── правила игры ─────────────────────────────

  protected override fails(): number {
    return this.wrong.length;
  }

  protected override failLimit(): number {
    return this.cfg.maxMistakes;
  }

  protected override failLabelKey(): string {
    return 'ui.minigame.mistakes';
  }

  protected override progress(): { n: number; total: number } {
    return { n: Math.min(this.found.length, this.cfg.required), total: this.cfg.required };
  }

  protected override isComplete(): boolean {
    return this.found.length >= this.cfg.required;
  }

  protected override evaluate(): MinigameOutcomeKind {
    return this.found.length >= this.cfg.required ? 'success' : this.found.length >= 1 ? 'partial' : 'fail';
  }

  private hintable(): DocField[] {
    return this.cfg.active.filter((f) => f.discrepancy && !this.found.includes(fieldKey(f.doc, f.field)) && !this.hinted.includes(fieldKey(f.doc, f.field)));
  }

  protected override canHint(): boolean {
    return this.hintable().length > 0;
  }

  protected override giveHint(): void {
    const next = this.hintable()[0];
    if (!next) return;
    const key = fieldKey(next.doc, next.field);
    this.hinted.push(key);
    // Подсказка показывает лист, о котором она.
    const i = this.cfg.documents.indexOf(next.doc);
    if (i >= 0) this.tab = i;
    const hk = next.hintKey;
    this.say(() => `${this.t('ui.minigame.hint')}: ${hk ? this.t(hk) : next.field}`);
  }

  // ───────────────────────────── сейв ─────────────────────────────

  protected override saveState(): Record<string, unknown> {
    return { found: [...this.found], wrong: [...this.wrong], hinted: [...this.hinted], tab: this.tab };
  }

  protected override loadState(s: Record<string, unknown>): void {
    // Берём только известные кликабельные фрагменты нужного вида.
    const pick = (v: unknown, ok: (f: DocField) => boolean): string[] => {
      const out = new Set<string>();
      if (Array.isArray(v)) {
        for (const x of v) {
          const f = typeof x === 'string' ? this.byKey.get(x) : undefined;
          if (f && this.cfg.active.includes(f) && ok(f)) out.add(fieldKey(f.doc, f.field));
        }
      }
      return [...out];
    };
    this.found = pick(s.found, (f) => f.discrepancy);
    this.wrong = pick(s.wrong, (f) => !f.discrepancy);
    this.hinted = pick(s.hinted, (f) => f.discrepancy).filter((k) => !this.found.includes(k));
    const tab = asInt(s.tab, 0);
    this.tab = tab === null ? 0 : Math.min(tab, this.sheets.length - 1);
  }
}

export function createDocumentCheck(): IMinigame {
  return new DocumentCheck();
}
