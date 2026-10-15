/**
 * Экраны режима дела (docs/architecture/09-case-mode.md):
 *   - CaseScreen — папка следователя: задачи главы с ценой в ★, подозреваемые, приметы убийцы, улики;
 *   - SearchResultScreen — итог захода в сцену поиска: три звезды и за что они;
 *   - PhotoScreen — осмотр улики: фрагмент сцены крупно, по кнопке — оборот с надписью.
 * Новое после задачи подсвечено («Новое»). Строки — ключи ui.case.* и ключи дела; при смене языка render().
 */
import { t } from '../core/i18n';
import type { Episode } from '../core/types';
import { cssUrl, fill, h } from '../ui/dom';
import type { Screen } from '../ui/screen_host';
import type { CaseDef, CaseItem, CaseTask } from './case_def';
import type { CaseProgress, SearchStars } from './case_state';
import { chapterComplete, costOf, currentChapter, taskState } from './case_state';
import './case.css';

export interface CaseView {
  def: CaseDef;
  episode: Episode;
  progress: CaseProgress;
  storyOnly: boolean;
  /** Адрес файла ассета (портрет — спрайт актёра); null — файла нет. */
  url: (path: string) => string | null;
}

export interface CaseHandlers {
  view: () => CaseView;
  onTask: (task: CaseTask) => void;
  onReplay: (task: CaseTask) => void;
  onMenu: () => void;
}

const STAR = '★';
const NO_STAR = '☆';

function stars(n: number, of = 3): string {
  return STAR.repeat(n) + NO_STAR.repeat(Math.max(0, of - n));
}

abstract class CaseBase implements Screen {
  readonly el: HTMLElement;
  readonly dismissible = false;

  constructor(cls: string) {
    this.el = h('div', { class: cls, role: 'dialog', aria: { modal: true } });
  }

  abstract render(): void;
}

// ───────────────────────────── папка дела ─────────────────────────────

export class CaseScreen extends CaseBase {
  constructor(private readonly hd: CaseHandlers) {
    super('vn-case');
    this.el.tabIndex = -1;
    // Пробел и Enter, которыми листали разговор, не прокручивают папку (фокус на ней самой — case_mode.showFolder).
    this.el.addEventListener('keydown', (e) => {
      if (e.target === this.el && (e.key === ' ' || e.key === 'Enter')) e.preventDefault();
    });
  }

  render(): void {
    const v = this.hd.view();
    const { def, progress: p } = v;
    const ch = currentChapter(def, p);
    const total = ch.tasks.length;
    const done = ch.tasks.filter((x) => p.done.includes(x.id)).length;
    const fresh = new Set(p.fresh);
    const visible = ch.tasks.filter((x) => taskState(p, x, v.storyOnly) !== 'locked');
    const closed = chapterComplete(ch, p);

    fill(
      this.el,
      h(
        'div',
        { class: 'vn-case__frame' },
        h(
          'header',
          { class: 'vn-case__head' },
          h('button', { class: 'vn-btn vn-case__menu', type: 'button', text: t('ui.case.menu'), on: { click: this.hd.onMenu } }),
          h(
            'div',
            { class: 'vn-case__titles' },
            h('p', { class: 'vn-case__kicker', text: t(def.title_key) }),
            h('h1', { class: 'vn-case__chapter', text: t(ch.title_key) }),
          ),
          h(
            'p',
            { class: 'vn-case__stars', aria: { label: t('ui.case.stars', { n: p.stars }) } },
            h('span', { class: 'vn-case__star', aria: { hidden: true }, text: STAR }),
            h('span', { class: 'vn-case__star-n', aria: { hidden: true }, text: String(p.stars) }),
          ),
        ),
        h(
          'div',
          { class: 'vn-case__body' },
          h(
            'section',
            { class: 'vn-case__tasks', aria: { label: t('ui.case.tasks') } },
            h('h2', { class: 'vn-case__h' }, t('ui.case.tasks'), h('span', { class: 'vn-case__count', text: t('ui.case.progress', { n: done, total }) })),
            h('ul', { class: 'vn-case__list' }, ...visible.map((task) => this.task(task, v))),
            closed && ch.summary_key
              ? h(
                  'div',
                  { class: 'vn-case__summary' },
                  h('strong', { text: t('ui.case.chapter_done') }),
                  h('p', { text: t(ch.summary_key) }),
                )
              : null,
            h(
              'ol',
              { class: 'vn-case__chapters' },
              ...def.chapters.map((c) =>
                h(
                  'li',
                  { class: `vn-case__ch${c.id === ch.id ? ' is-current' : ''}${c.locked ? ' is-locked' : ''}` },
                  h('span', { text: t(c.title_key) }),
                  c.locked ? h('span', { class: 'vn-case__soon', text: t('ui.case.soon') }) : null,
                ),
              ),
            ),
          ),
          h(
            'aside',
            { class: 'vn-case__file' },
            this.suspects(v, fresh),
            this.traits(v, fresh),
            this.clues(v, fresh),
          ),
        ),
      ),
    );
  }

  private task(task: CaseTask, v: CaseView): HTMLElement {
    const p = v.progress;
    const state = taskState(p, task, v.storyOnly);
    const cost = costOf(task, v.storyOnly);
    const best = task.kind === 'search' && task.scene ? (p.best[task.scene] ?? 0) : null;
    const kind = h('span', { class: 'vn-case__kind', text: t(`ui.case.kind.${task.kind}`) });
    const title = h('span', { class: 'vn-case__task-title', text: t(task.title_key) });
    if (state === 'done') {
      return h(
        'li',
        { class: 'vn-case__task is-done', data: { id: task.id } },
        h(
          'div',
          { class: 'vn-case__task-row' },
          kind,
          title,
          h('span', { class: 'vn-case__cost', text: best !== null ? stars(best) : '✓', aria: { label: t('ui.case.done') } }),
        ),
        task.kind === 'search'
          ? h('button', { class: 'vn-btn vn-case__replay', type: 'button', text: t('ui.case.replay'), on: { click: () => this.hd.onReplay(task) } })
          : null,
      );
    }
    return h(
      'li',
      { class: `vn-case__task is-${state}`, data: { id: task.id } },
      h(
        'button',
        {
          class: 'vn-case__task-row vn-case__task-btn',
          type: 'button',
          disabled: state !== 'open',
          on: { click: () => this.hd.onTask(task) },
        },
        kind,
        title,
        h('span', { class: 'vn-case__cost', text: cost > 0 ? `${STAR} ${cost}` : t('ui.case.free') }),
      ),
      state === 'poor' ? h('p', { class: 'vn-case__why', text: t('ui.case.need_stars') }) : null,
    );
  }

  private section(titleKey: string, body: HTMLElement): HTMLElement {
    return h('section', { class: 'vn-case__sec' }, h('h2', { class: 'vn-case__h', text: t(titleKey) }), body);
  }

  private suspects(v: CaseView, fresh: ReadonlySet<string>): HTMLElement {
    const { def, progress: p, episode } = v;
    const list = def.suspects.filter((s) => p.suspects.includes(s.id));
    const facts = def.facts ?? [];
    if (list.length === 0) return this.section('ui.case.suspects', h('p', { class: 'vn-case__empty', text: '—' }));
    return this.section(
      'ui.case.suspects',
      h(
        'ul',
        { class: 'vn-case__suspects' },
        ...list.map((s) => {
          const sprite = s.who ? episode.assets?.sprites?.find((x) => x.id === s.who)?.base : undefined;
          const url = sprite ? v.url(sprite) : null;
          const notes = facts.filter((f) => f.suspect === s.id && p.facts.includes(f.id));
          const isNew = fresh.has(`suspect:${s.id}`) || notes.some((f) => fresh.has(`fact:${f.id}`));
          return h(
            'li',
            { class: `vn-case__suspect${isNew ? ' is-new' : ''}`, data: { id: s.id } },
            h('div', {
              class: `vn-case__face${url ? '' : ' is-unknown'}`,
              role: 'img',
              aria: { label: url ? t(s.name_key) : t('ui.case.no_face') },
              ...(url ? { style: { '--face': cssUrl(url) } } : {}),
            }),
            h(
              'div',
              { class: 'vn-case__who' },
              h('h3', { class: 'vn-case__name', text: t(s.name_key) }),
              isNew ? h('span', { class: 'vn-badge', text: t('ui.case.new') }) : null,
              h('p', { class: 'vn-case__note', text: t(s.note_key) }),
              ...notes.map((f) => h('p', { class: `vn-case__fact${fresh.has(`fact:${f.id}`) ? ' is-new' : ''}`, text: t(f.text_key) })),
            ),
          );
        }),
      ),
    );
  }

  private traits(v: CaseView, fresh: ReadonlySet<string>): HTMLElement {
    const { def, progress: p } = v;
    return this.section(
      'ui.case.traits',
      h(
        'ol',
        { class: 'vn-case__traits' },
        ...def.traits.map((tr) => {
          const known = p.traits.includes(tr.id);
          return h(
            'li',
            { class: `vn-case__trait${known ? ' is-known' : ''}${fresh.has(`trait:${tr.id}`) ? ' is-new' : ''}` },
            known ? t(tr.label_key) : t('ui.case.unknown_trait'),
          );
        }),
      ),
    );
  }

  private clues(v: CaseView, fresh: ReadonlySet<string>): HTMLElement {
    const { def, progress: p } = v;
    const list = def.clues.filter((c) => p.clues.includes(c.id));
    const loose = (def.facts ?? []).filter((f) => !f.suspect && p.facts.includes(f.id));
    if (list.length === 0 && loose.length === 0) return this.section('ui.case.clues', h('p', { class: 'vn-case__empty', text: '—' }));
    return this.section(
      'ui.case.clues',
      h(
        'ul',
        { class: 'vn-case__clues' },
        ...list.map((c) => h('li', { class: `vn-case__clue${fresh.has(`clue:${c.id}`) ? ' is-new' : ''}`, text: t(c.label_key) })),
        ...loose.map((f) => h('li', { class: `vn-case__clue is-fact${fresh.has(`fact:${f.id}`) ? ' is-new' : ''}`, text: t(f.text_key) })),
      ),
    );
  }
}

// ───────────────────────────── итог поиска ─────────────────────────────

export interface SearchSummary {
  titleKey: string;
  result: SearchStars;
  starTimeMs: number;
  starMisses: number;
  best: number;
  onDone: () => void;
}

function mmss(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class SearchResultScreen extends CaseBase {
  constructor(private readonly s: SearchSummary) {
    super('vn-case-result');
  }

  render(): void {
    const { result: r } = this.s;
    const row = (ok: boolean, text: string): HTMLElement =>
      h('li', { class: `vn-case-result__row${ok ? ' is-ok' : ''}` }, h('span', { class: 'vn-case-result__mark', aria: { hidden: true }, text: ok ? STAR : NO_STAR }), text);
    fill(
      this.el,
      h(
        'div',
        { class: 'vn-card vn-case-result__card' },
        h('p', { class: 'vn-case__kicker', text: t(this.s.titleKey) }),
        h('h2', { class: 'vn-card__title', text: t('ui.case.result.title') }),
        h('p', { class: 'vn-case-result__stars', aria: { label: t('ui.case.stars', { n: r.stars }) }, text: stars(r.stars) }),
        h(
          'ul',
          { class: 'vn-case-result__list' },
          row(r.all, t('ui.case.result.all')),
          row(r.fast, t('ui.case.result.time', { time: mmss(this.s.starTimeMs) })),
          row(r.accurate, t('ui.case.result.misses', { n: this.s.starMisses })),
        ),
        h('p', { class: 'vn-case-result__earned', text: r.stars > 0 ? t('ui.case.result.earned', { n: r.stars }) : t('ui.case.result.none') }),
        h('p', { class: 'vn-muted', text: `${t('ui.case.result.best')}: ${stars(this.s.best)}` }),
        h('div', { class: 'vn-actions' }, h('button', { class: 'vn-btn is-primary', type: 'button', text: t('ui.common.next'), on: { click: this.s.onDone } })),
      ),
    );
  }
}

// ───────────────────────────── осмотр фото ─────────────────────────────

export interface PhotoSpec {
  titleKey: string;
  /** Адрес фона сцены; null — файла нет, вместо фрагмента серая карточка. */
  bgUrl: string | null;
  item: CaseItem;
  backKey: string;
  onDone: () => void;
}

/** Фрагмент кадра вокруг предмета: рамка предмета с запасом PAD с каждой стороны, в долях кадра. */
const PAD = 0.45;

export class PhotoScreen extends CaseBase {
  private flipped = false;

  constructor(private readonly s: PhotoSpec) {
    super('vn-case-photo');
  }

  render(): void {
    const [x, y, w, hh] = this.s.item.rect;
    const cw = Math.min(1, w * (1 + 2 * PAD));
    const ch = Math.min(1, hh * (1 + 2 * PAD));
    const cx = Math.min(Math.max(0, x - w * PAD), 1 - cw);
    const cy = Math.min(Math.max(0, y - hh * PAD), 1 - ch);
    const front = h('div', {
      class: `vn-case-photo__front${this.s.bgUrl ? '' : ' is-empty'}`,
      style: {
        'aspect-ratio': `${(cw * 16).toFixed(4)} / ${(ch * 9).toFixed(4)}`,
        ...(this.s.bgUrl
          ? {
              'background-image': cssUrl(this.s.bgUrl),
              'background-size': `${(100 / cw).toFixed(3)}% ${(100 / ch).toFixed(3)}%`,
              'background-position': `${cw < 1 ? ((cx / (1 - cw)) * 100).toFixed(3) : 0}% ${ch < 1 ? ((cy / (1 - ch)) * 100).toFixed(3) : 0}%`,
            }
          : {}),
      },
    });
    const back = h('div', { class: 'vn-case-photo__back' }, h('p', { class: 'vn-case-photo__text', text: t(this.s.backKey) }));
    fill(
      this.el,
      h(
        'div',
        { class: 'vn-card vn-case-photo__card' },
        h('h2', { class: 'vn-card__title', text: t(this.s.titleKey) }),
        h('div', { class: `vn-case-photo__paper${this.flipped ? ' is-back' : ''}` }, front, back),
        h(
          'div',
          { class: 'vn-actions' },
          this.flipped
            ? h('button', { class: 'vn-btn is-primary', type: 'button', text: t('ui.common.next'), on: { click: this.s.onDone } })
            : h(
                'button',
                {
                  class: 'vn-btn is-primary vn-case-photo__flip',
                  type: 'button',
                  text: t('ui.case.photo.flip'),
                  on: {
                    click: () => {
                      this.flipped = true;
                      this.render();
                      this.el.querySelector<HTMLButtonElement>('.vn-btn.is-primary')?.focus({ preventScroll: true });
                    },
                  },
                },
              ),
        ),
      ),
    );
  }
}
