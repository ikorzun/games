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
 *
 * Сканы (решение владельца 2026-10-14: «интерфейс — под реальный»; «Два скана, тап по листу»): если у каждого документа
 * есть настоящий скан с текстом (assets.documents, localized: true), язык игры — язык скана и у несоответствий есть зоны
 * (`fields[].rects`), сверка идёт на самих листах, без текстовых панелей, в раскладке 'stage' (как осмотр): листы рядом,
 * тап по полю с rects судится (несоответствие — красный кружок карандашом, ловушка — ошибка и галочка), тап по пустой
 * бумаге и по тексту без поля — «нечего сверять», без ошибки. Лупа: мышью — над листом всегда; пальцем — подержать или
 * повести (отпустил — отметки нет), быстрый тап — отметка. Клавиатура: Tab по полям (невидимые кнопки), Enter / Space.
 */
import type { Episode, MinigameOutcomeKind } from '../core/types';
import { joinUrl } from '../stage/assets';
import { cssUrl, fill, h } from '../ui/dom';
import { hitTest } from './crime_scene_search';
import type { Rect } from './crime_scene_search';
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
  /** Где фрагмент на скане (доли картинки, по строке на прямоугольник); пусто — только текстовый режим. */
  rects: Rect[];
}

export interface DocsConfig {
  documents: string[];
  /** Все фрагменты из config.fields. */
  fields: DocField[];
  /** Кликабельные: несоответствия и первые `decoys` ловушек. */
  active: DocField[];
  /** На сканах судятся все поля с rects. */
  scanFields: DocField[];
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
    fields.push({ doc, field, textKey, discrepancy: discrepancies.has(key), hintKey: discrepancies.get(key) ?? null, rects: parseRects(f.rects) });
  }
  // Каждое несоответствие обязано быть нажимаемым фрагментом.
  for (const key of discrepancies.keys()) if (!seen.has(key)) return null;

  const decoyLimit = asInt(cfg.decoys, 0) ?? Number.POSITIVE_INFINITY;
  let decoys = 0;
  const active = fields.filter((f) => f.discrepancy || decoys++ < decoyLimit);

  const required = Math.min(asInt(cfg.required, 1) ?? discrepancies.size, discrepancies.size);
  const scanFields = fields.filter((f) => f.rects.length > 0);
  return { documents, fields, active, scanFields, required, maxMistakes: asInt(cfg.max_mistakes, 1) ?? 3 };
}

/** Зоны поля на скане: [x, y, w, h] в долях картинки; кривые и пустые пропускаются. */
function parseRects(v: unknown): Rect[] {
  if (!Array.isArray(v)) return [];
  const out: Rect[] = [];
  for (const r of v) {
    if (!Array.isArray(r) || r.length !== 4 || !r.every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
    const [x, y, w, hh] = (r as number[]).map((n) => Math.min(1, Math.max(0, n))) as [number, number, number, number];
    if (w > 0 && hh > 0) out.push([x, y, w, hh]);
  }
  return out;
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

/** Лист-скан на столе (режим сканов). */
interface Page {
  doc: string;
  url: string;
  el: HTMLElement;
  marks: HTMLElement;
  flash: HTMLElement;
  zones: HTMLButtonElement[];
}

/** Пальцем: столько держать (мс) или на столько повести (px), чтобы вместо отметки появилась лупа. */
const HOLD_MS = 260;
const MOVE_PX = 8;
/** Мышь точнее пальца: зона — как нарисована, плюс запас в несколько пикселей. */
const MOUSE_SLOP_PX = 4;
/** После жеста с лупой браузер может прислать click — его не засчитываем. */
const SWALLOW_MS = 450;

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

  // режим сканов
  /** Адреса сканов по документам; null — текстовый режим. */
  private scans: Map<string, string> | null = null;
  private pages: Page[] = [];
  private desk!: HTMLElement;
  private list!: HTMLElement;
  private loupe!: HTMLElement;
  private loupePage: Page | null = null;
  private loupeSize = 180;
  private zoom = 2.5;
  private lastPointer = 'mouse';
  private swallowUntil = 0;
  private resizer: ResizeObserver | null = null;
  private dockWatched = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  protected override parse(cfg: MinigameConfig, _ctx: GameContext): boolean {
    const parsed = parseDocsConfig(cfg);
    if (!parsed) return false;
    this.cfg = parsed;
    this.byKey = new Map(parsed.fields.map((f) => [fieldKey(f.doc, f.field), f]));
    this.textKeys = new Map(parsed.documents.map((d) => [d, docTextKey(this.ctx.episode, d)]));
    this.scans = this.scanUrls();
    return true;
  }

  /**
   * Сверка на сканах: у каждого документа — скан с текстом (localized), язык игры — язык скана (сканы пока русские),
   * у каждого несоответствия есть зоны. Иначе — текстовый режим.
   */
  private scanUrls(): Map<string, string> | null {
    const { episode, lang } = this.ctx;
    if (lang !== (episode.localization?.source_lang ?? 'ru')) return null;
    if (this.cfg.fields.some((f) => f.discrepancy && f.rects.length === 0)) return null;
    const urls = new Map<string, string>();
    for (const doc of this.cfg.documents) {
      const entry = episode.assets?.documents?.find((d) => d.id === doc);
      if (!entry?.localized || !entry.path) return null;
      urls.set(doc, joinUrl(import.meta.env.BASE_URL, entry.path));
    }
    return urls;
  }

  protected override layout(): 'card' | 'stage' {
    return this.scans ? 'stage' : 'card';
  }

  protected override panelList(): HTMLElement | null {
    return this.scans ? this.list : null;
  }

  protected override startLabelKey(): string {
    return 'ui.minigame.start_check';
  }

  protected override introNote(): string {
    if (!this.scans) return '';
    const loupe = this.t('ui.minigame.body_loupe');
    // Узкий вертикальный экран: листы мелкие и друг под другом — подсказать повернуть телефон (владелец 2026-10-15).
    const portrait = globalThis.matchMedia?.('(orientation: portrait) and (max-width: 600px)').matches ?? false;
    return portrait ? `${loupe} ${this.t('ui.minigame.body_rotate')}` : loupe;
  }

  protected override focusField(): void {
    if (!this.scans) return;
    this.layoutPages();
    this.desk.focus({ preventScroll: true });
  }

  // ───────────────────────────── разметка ─────────────────────────────

  protected override build(): HTMLElement {
    if (this.scans) return this.buildScans(this.scans);
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
    if (this.scans) return this.paintScans();
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

  // ───────────────────────────── сканы ─────────────────────────────

  /** Стол со сканами рядом, лупа, невидимые кнопки полей для клавиатуры и скринридера. */
  private buildScans(urls: Map<string, string>): HTMLElement {
    this.list = h('ol', { class: 'mg-scene__list mg-docs__list' });
    this.loupe = h('div', { class: 'mg-docs__loupe', hidden: true, aria: { hidden: true } });
    this.pages = this.cfg.documents.map((doc) => {
      const url = urls.get(doc) ?? '';
      const img = h('img', { class: 'mg-docs__scan' });
      img.alt = '';
      img.draggable = false;
      const marks = h('div', { class: 'mg-docs__marks', aria: { hidden: true } });
      const flash = h('span', { class: 'mg-docs__flash', aria: { hidden: true } });
      const zones = this.cfg.scanFields
        .filter((f) => f.doc === doc)
        .map((f) => {
          const key = fieldKey(f.doc, f.field);
          return h('button', { class: 'mg-docs__zone', type: 'button', data: { key }, style: boxStyle(unionRect(f.rects)), on: { click: () => this.mark(key) } });
        });
      const el = h('div', { class: 'mg-docs__page', data: { doc } }, img, marks, ...zones, flash);
      img.addEventListener('error', () => {
        warnMissingAsset(url);
        el.classList.add('is-missing');
      });
      img.src = url;
      const page: Page = { doc, url, el, marks, flash, zones };
      this.bindPage(page);
      return page;
    });
    this.desk = h('div', { class: 'mg-docs__desk', tabindex: -1 }, ...this.pages.map((p) => p.el), this.loupe);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizer = new ResizeObserver(() => this.layoutPages());
      this.resizer.observe(this.desk);
    }
    return this.desk;
  }

  /**
   * Размер листов: оба целиком, 3:4, рядом; блок по умолчанию стоит справа (на вертикальном экране — снизу) — листы
   * сдвигаются от него. Лупа — по размеру листа: крупнее лист — меньше увеличение.
   */
  private layoutPages(): void {
    const d = this.desk;
    if (!d || this.pages.length === 0) return;
    const W = d.clientWidth;
    const H = d.clientHeight;
    if (W <= 0 || H <= 0) return;
    const dock = d.closest('.mg-stage')?.querySelector<HTMLElement>('.mg-stage__dock');
    // блок наблюдаем тоже: он появляется после «Начать», и листы надо сдвинуть
    if (dock && this.resizer && !this.dockWatched) {
      this.dockWatched = true;
      this.resizer.observe(dock);
    }
    const shown = dock !== null && dock !== undefined && !dock.hidden;
    const wide = W >= H;
    const pad = Math.round(Math.min(W, H) * 0.03) + 6;
    const right = shown && wide ? (dock?.offsetWidth ?? 0) + pad * 2 : pad;
    const bottom = shown && !wide ? (dock?.offsetHeight ?? 0) + pad * 2 : pad;
    const n = this.pages.length;
    // Рядом или друг под другом — как листы крупнее: на вертикальном телефоне друг под другом (владелец 2026-10-15).
    const row = Math.floor(Math.min((W - pad - right - pad * (n - 1)) / n, (H - pad - bottom) * 0.75));
    const col = Math.floor(Math.min(W - pad - right, ((H - pad - bottom - pad * (n - 1)) / n) * 0.75));
    const stack = col > row;
    const pw = Math.max(60, stack ? col : row);
    Object.assign(d.style, { padding: `${pad}px ${right}px ${bottom}px ${pad}px`, gap: `${pad}px`, flexDirection: stack ? 'column' : 'row' });
    for (const p of this.pages) Object.assign(p.el.style, { width: `${pw}px`, height: `${Math.round(pw / 0.75)}px` });
    this.loupeSize = Math.round(Math.min(230, Math.max(130, pw * 0.42)));
    // увеличение — почти до разрешения скана (1536 px по ширине): под лупой видна и стёртая цифра
    this.zoom = Math.min(4.5, Math.max(2.5, 1300 / pw));
    Object.assign(this.loupe.style, { width: `${this.loupeSize}px`, height: `${this.loupeSize}px` });
  }

  /** Мышь: лупа над листом всегда, клик — отметка. Палец: подержал или повёл — лупа (отметки нет), быстрый тап — отметка. */
  private bindPage(page: Page): void {
    const el = page.el;
    let hold: { id: number; x0: number; y0: number; on: boolean; timer: ReturnType<typeof setTimeout> | null } | null = null;
    el.addEventListener('pointerdown', (e) => {
      this.lastPointer = e.pointerType || 'mouse';
      if (e.pointerType === 'mouse' || !this.canAct()) return;
      const cur: NonNullable<typeof hold> = { id: e.pointerId, x0: e.clientX, y0: e.clientY, on: false, timer: null };
      cur.timer = this.later(() => {
        if (hold !== cur) return;
        cur.on = true;
        this.showLoupe(page, cur.x0, cur.y0, true);
      }, HOLD_MS);
      hold = cur;
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') {
        if (this.canAct()) this.showLoupe(page, e.clientX, e.clientY, false);
        return;
      }
      if (!hold || e.pointerId !== hold.id) return;
      if (!hold.on && Math.hypot(e.clientX - hold.x0, e.clientY - hold.y0) > MOVE_PX) hold.on = true;
      if (hold.on) this.showLoupe(page, e.clientX, e.clientY, true);
    });
    const end = (e: PointerEvent): void => {
      if (!hold || e.pointerId !== hold.id) return;
      if (hold.timer !== null) {
        clearTimeout(hold.timer);
        this.timers.delete(hold.timer);
      }
      if (hold.on) this.swallowUntil = performance.now() + SWALLOW_MS;
      hold = null;
      this.hideLoupe();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.hideLoupe();
    });
    el.addEventListener('click', (e) => this.onPageClick(page, e));
    // долгое нажатие не открывает меню картинки
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onPageClick(page: Page, e: MouseEvent): void {
    if (!this.canAct()) return;
    // Enter / Space по невидимой кнопке поля — её собственный клик (координат у него нет)
    if (e.target instanceof Element && e.target.closest('.mg-docs__zone')) return;
    if (performance.now() < this.swallowUntil) return;
    const r = page.el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const u = (e.clientX - r.left) / r.width;
    const v = (e.clientY - r.top) / r.height;
    if (u < 0 || u > 1 || v < 0 || v > 1) return;
    const type = (e as Partial<PointerEvent>).pointerType || this.lastPointer;
    const zones = this.cfg.scanFields.filter((f) => f.doc === page.doc).flatMap((f) => f.rects.map((rect) => ({ id: fieldKey(f.doc, f.field), rect })));
    const key = type === 'mouse' ? hitTest(zones, u, v, r.width, r.height, 0, MOUSE_SLOP_PX) : hitTest(zones, u, v, r.width, r.height);
    if (key) this.mark(key, [u, v]);
    else this.flashAt(page, u, v, this.t('ui.minigame.nothing_to_check'), 'is-blank');
  }

  private showLoupe(page: Page, cx: number, cy: number, touch: boolean): void {
    const r = page.el.getBoundingClientRect();
    const d = this.desk.getBoundingClientRect();
    const px = cx - r.left;
    const py = cy - r.top;
    if (r.width <= 0 || px < 0 || py < 0 || px > r.width || py > r.height) {
      this.hideLoupe();
      return;
    }
    const L = this.loupeSize;
    const Z = this.zoom;
    // пальцем — над пальцем, чтобы он не закрывал увеличенное
    const lx = Math.min(Math.max(0, cx - d.left - L / 2), Math.max(0, d.width - L));
    const ly = Math.min(Math.max(0, cy - d.top - L / 2 - (touch ? L * 0.85 : 0)), Math.max(0, d.height - L));
    const st = this.loupe.style;
    if (this.loupePage !== page) {
      this.loupePage = page;
      st.backgroundImage = cssUrl(page.url);
    }
    st.left = `${lx}px`;
    st.top = `${ly}px`;
    st.backgroundSize = `${r.width * Z}px ${r.height * Z}px`;
    st.backgroundPosition = `${L / 2 - px * Z}px ${L / 2 - py * Z}px`;
    this.loupe.hidden = false;
  }

  private hideLoupe(): void {
    if (this.loupe) this.loupe.hidden = true;
  }

  /** Короткая надпись карандашом у места тапа: «сходится», «нечего сверять». */
  private flashAt(page: Page, u: number, v: number, text: string, cls: string): void {
    // одна надпись за раз: прежняя (на этом или другом листе) гаснет
    for (const p of this.pages) p.flash.classList.remove('is-on');
    const f = page.flash;
    f.textContent = text;
    f.className = `mg-docs__flash ${cls}`;
    Object.assign(f.style, { left: `${(u * 100).toFixed(2)}%`, top: `${(v * 100).toFixed(2)}%` });
    // перезапуск анимации
    void f.offsetWidth;
    f.classList.add('is-on');
  }

  private later(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
    return id;
  }

  private paintScans(): void {
    if (!this.canAct()) this.hideLoupe();
    for (const p of this.pages) {
      for (const z of p.zones) {
        const key = z.dataset.key ?? '';
        const f = this.byKey.get(key);
        z.setAttribute('aria-label', f ? this.t(f.textKey) : key);
        z.setAttribute('aria-disabled', String(this.found.includes(key) || this.wrong.includes(key) || !this.canAct()));
      }
      // Отметки на листе: найденное — красный кружок, ловушка — галочка, подсказка — пунктир.
      const marks: HTMLElement[] = [];
      for (const f of this.cfg.scanFields.filter((x) => x.doc === p.doc)) {
        const key = fieldKey(f.doc, f.field);
        if (this.found.includes(key)) for (const r of f.rects) marks.push(h('span', { class: 'mg-docs__ring', style: boxStyle(grow(r, 0.06, 0.45)) }));
        else if (this.hinted.includes(key)) for (const r of f.rects) marks.push(h('span', { class: 'mg-docs__hintbox', style: boxStyle(grow(r, 0.02, 0.2)) }));
        if (this.wrong.includes(key)) {
          const r = f.rects[f.rects.length - 1] as Rect;
          marks.push(h('span', { class: 'mg-docs__tick', style: { left: `${((r[0] + r[2]) * 100).toFixed(2)}%`, top: `${(r[1] * 100).toFixed(2)}%`, height: `${(r[3] * 100).toFixed(2)}%` } }));
        }
      }
      fill(p.marks, ...marks);
    }
    // Блок: найденное — номер на белом и фрагмент; подсказанное — «Подсказка: …»; ещё не найденное — бледно.
    const row = (n: number, text: string, cls: string): HTMLElement =>
      h('li', { class: `mg-scene__item${cls}` }, h('span', { class: 'mg-scene__num', text: String(n) }), h('span', { class: 'mg-scene__name', text }));
    const rows = this.found.map((k, i) => row(i + 1, this.fragment(k), ' is-found'));
    const hints = this.hinted.filter((k) => !this.found.includes(k));
    const base = rows.length;
    for (let i = base; i < this.cfg.required; i++) {
      const k = hints[i - base];
      const hk = k ? this.byKey.get(k)?.hintKey : null;
      rows.push(k ? row(i + 1, `${this.t('ui.minigame.hint')}: ${hk ? this.t(hk) : this.fragment(k)}`, ' is-hint') : row(i + 1, this.t('ui.minigame.find_item'), ''));
    }
    fill(this.list, ...rows);
  }

  /** Фрагмент документа в кавычках — как его называет блок и экран итога. */
  private fragment(key: string): string {
    const f = this.byKey.get(key);
    return f ? `«${this.t(f.textKey)}»` : key;
  }

  protected override resultDetails(): HTMLElement[] {
    if (!this.scans || this.found.length === 0) return [];
    const rows = this.found.map((k, i) => {
      const hk = this.byKey.get(k)?.hintKey;
      return h(
        'li',
        { class: 'mg-scene__find', data: { key: k } },
        h('span', { class: 'mg-scene__num', text: String(i + 1) }),
        h('div', { class: 'mg-scene__find-text' }, h('span', { class: 'mg-scene__name', text: this.fragment(k) }), hk ? h('p', { class: 'mg-scene__why', text: this.t(hk) }) : null),
      );
    });
    return [h('ol', { class: 'mg-scene__finds' }, ...rows)];
  }

  // ───────────────────────────── ход ─────────────────────────────

  /** at — где тапнули на скане (доли листа); нет — клавиатура или текстовый режим. */
  private mark(key: string, at?: readonly [number, number]): void {
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
      const page = this.pages.find((p) => p.doc === f.doc);
      const r = f.rects[0];
      if (page && r) this.flashAt(page, at?.[0] ?? r[0] + r[2] / 2, at?.[1] ?? r[1], this.t('ui.minigame.consistent'), 'is-wrong');
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
    this.tab = tab === null ? 0 : Math.min(tab, Math.max(0, this.sheets.length - 1));
  }

  override destroy(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.resizer?.disconnect();
    this.resizer = null;
    super.destroy();
  }
}

/** Общий прямоугольник строк поля (кнопка для клавиатуры). */
function unionRect(rects: readonly Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r[0]));
  const y0 = Math.min(...rects.map((r) => r[1]));
  const x1 = Math.max(...rects.map((r) => r[0] + r[2]));
  const y1 = Math.max(...rects.map((r) => r[1] + r[3]));
  return [x0, y0, x1 - x0, y1 - y0];
}

/** Прямоугольник шире на dx и выше на dy (доли своих размеров с каждой стороны) — кружок карандашом не по буквам. */
function grow(r: Rect, dx: number, dy: number): Rect {
  return [r[0] - r[2] * dx, r[1] - r[3] * dy, r[2] * (1 + 2 * dx), r[3] * (1 + 2 * dy)];
}

function boxStyle(r: Rect): Record<string, string> {
  const pc = (n: number): string => `${(n * 100).toFixed(2)}%`;
  return { left: pc(r[0]), top: pc(r[1]), width: pc(r[2]), height: pc(r[3]) };
}

export function createDocumentCheck(): IMinigame {
  return new DocumentCheck();
}
