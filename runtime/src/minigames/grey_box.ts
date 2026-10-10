/**
 * Grey-box мини-игра: заглушка вертикального среза для типов crime_scene_search, document_check,
 * database_search, evidence_board, interrogation_press. Показывает название и бриф из локали,
 * конфиг кратко (технические подписи — для разработчика, заменятся настоящей механикой) и кнопки
 * Успех / Частично / Провал / Пропустить. Пропуск есть только если skip.allowed; что он означает
 * для сюжета, решает интерпретатор (skip.skip_counts_as).
 */
import type { Container } from 'pixi.js';
import type { MinigameResult } from '../core/types';
import { fill, h } from '../ui/dom';
import type { GameContext, IMinigame, MinigameConfig } from './types';

type Row = [label: string, value: string];

const str = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Краткое описание конфига по типу. */
export function summarize(type: string, cfg: MinigameConfig, ctx: GameContext): Row[] {
  const rows: Row[] = [];
  switch (type) {
    case 'crime_scene_search': {
      const hs = arr(cfg.hotspots) as Array<Record<string, unknown>>;
      const required = hs.filter((x) => x.required === true).length;
      rows.push(['hotspots', `${hs.length} (required ${required})`]);
      rows.push(['labels', hs.map((x) => (typeof x.label_key === 'string' ? ctx.t(x.label_key) : str(x.id))).join(' · ')]);
      rows.push(['max_misses', str(cfg.max_misses)]);
      break;
    }
    case 'document_check': {
      rows.push(['documents', arr(cfg.documents).map(str).join(', ')]);
      rows.push(['discrepancies', String(arr(cfg.discrepancies).length)]);
      rows.push(['required / decoys / max_mistakes', `${str(cfg.required)} / ${str(cfg.decoys ?? 0)} / ${str(cfg.max_mistakes)}`]);
      break;
    }
    case 'database_search': {
      rows.push(['fields', arr(cfg.fields).map(str).join(', ')]);
      rows.push(['records', str(cfg.records)]);
      const pattern = cfg.pattern && typeof cfg.pattern === 'object' ? Object.entries(cfg.pattern as Record<string, unknown>) : [];
      rows.push(['pattern', pattern.map(([k, v]) => `${k}=${str(v)}`).join(', ')]);
      rows.push(['target_count / min_for_partial', `${str(cfg.target_count)} / ${str(cfg.min_for_partial ?? '—')}`]);
      break;
    }
    case 'evidence_board': {
      rows.push(['nodes', String(arr(cfg.nodes).length)]);
      rows.push(['required_links / decoy_links', `${arr(cfg.required_links).length} / ${arr(cfg.decoy_links).length}`]);
      rows.push(['max_wrong_links', str(cfg.max_wrong_links)]);
      break;
    }
    case 'interrogation_press': {
      const vars = ctx.vars();
      const statements = arr(cfg.statements) as Array<Record<string, unknown>>;
      for (const st of statements) {
        const req = typeof st.requires === 'string' ? st.requires : null;
        const ok = req === null || Boolean(vars[req]);
        const text = typeof st.text_key === 'string' ? ctx.t(st.text_key) : str(st.id);
        rows.push([`${ok ? '✔' : '✘'} ${str(st.id)}${req ? ` (requires ${req})` : ''}`, text]);
      }
      rows.push(['full / partial / max_mistakes', `${str(cfg.full_threshold)} / ${str(cfg.partial_threshold)} / ${str(cfg.max_mistakes)}`]);
      break;
    }
    default:
      rows.push(['config', JSON.stringify(cfg).slice(0, 160)]);
  }
  return rows;
}

/** Подсказки, доступные за rewarded-рекламу (только там, где они есть в данных). */
export function hintsFor(type: string, cfg: MinigameConfig, ctx: GameContext): string[] {
  if (type === 'document_check') {
    return (arr(cfg.discrepancies) as Array<Record<string, unknown>>)
      .map((d) => (typeof d.hint_key === 'string' ? ctx.t(d.hint_key) : ''))
      .filter(Boolean);
  }
  if (type === 'crime_scene_search') {
    return (arr(cfg.hotspots) as Array<Record<string, unknown>>)
      .filter((x) => x.required === true && typeof x.label_key === 'string')
      .map((x) => ctx.t(x.label_key as string));
  }
  return [];
}

export class GreyBoxMinigame implements IMinigame {
  onResult: (result: MinigameResult) => void = () => undefined;

  private ctx!: GameContext;
  private cfg: MinigameConfig = {};
  private view: HTMLElement | null = null;
  private offLang: (() => void) | null = null;
  private finished = false;
  private paused = false;
  private hintsShown = 0;
  private busyHint = false;

  constructor(private readonly type: string) {}

  mount(_root: Container, dom: HTMLElement, cfg: MinigameConfig, ctx: GameContext): void {
    this.ctx = ctx;
    this.cfg = cfg;
    this.view = h('div', { class: 'mg-gb' });
    dom.appendChild(this.view);
    this.render();
    this.offLang = ctx.onLanguageChange(() => this.render());
  }

  pause(): void {
    this.paused = true;
    this.view?.classList.add('is-paused');
  }

  resume(): void {
    this.paused = false;
    this.view?.classList.remove('is-paused');
  }

  serialize(): unknown {
    return { hintsShown: this.hintsShown };
  }

  restore(state: unknown): void {
    if (typeof state === 'object' && state !== null && 'hintsShown' in state) {
      const n = (state as { hintsShown: unknown }).hintsShown;
      if (typeof n === 'number' && n >= 0) this.hintsShown = Math.floor(n);
    }
    this.render();
  }

  destroy(): void {
    this.offLang?.();
    this.offLang = null;
    this.view?.remove();
    this.view = null;
  }

  private finish(result: MinigameResult): void {
    if (this.finished || this.paused) return;
    this.finished = true;
    this.onResult(result);
  }

  private async askHint(): Promise<void> {
    if (this.busyHint || !this.ctx.showRewarded) return;
    this.busyHint = true;
    this.render();
    try {
      const ok = await this.ctx.showRewarded();
      this.ctx.track('minigame_hint', { id: this.ctx.def.id, rewarded: ok });
      if (ok) {
        this.hintsShown += 1;
        this.ctx.autosave();
      }
    } finally {
      this.busyHint = false;
      this.render();
    }
  }

  private render(): void {
    const view = this.view;
    if (!view) return;
    const { ctx, cfg } = this;
    const def = ctx.def;
    const t = ctx.t;

    const rows = summarize(this.type, cfg, ctx);
    const hints = hintsFor(this.type, cfg, ctx);
    const canHint = def.skip.hint_rewarded_ad === true && ctx.showRewarded !== undefined && hints.length > 0;
    const shown = hints.slice(0, this.hintsShown);

    const btn = (cls: string, label: string, result: MinigameResult): HTMLButtonElement =>
      h('button', { class: `mg-btn ${cls}`, type: 'button', text: label, on: { click: () => this.finish(result) } });

    const actions = h(
      'div',
      { class: 'mg-actions' },
      btn('is-success', t('ui.minigame.success'), 'success'),
      btn('is-partial', t('ui.minigame.partial'), 'partial'),
      btn('is-fail', t('ui.minigame.fail'), 'fail'),
      def.skip.allowed
        ? btn(ctx.settings.storyOnly ? 'is-skip is-primary' : 'is-skip', t('ui.minigame.skip'), 'skipped')
        : null,
      canHint && this.hintsShown < hints.length
        ? h('button', {
            class: 'mg-btn is-hint',
            type: 'button',
            disabled: this.busyHint,
            text: t('ui.minigame.hint_ad'),
            on: { click: () => void this.askHint() },
          })
        : null,
    );

    fill(
      view,
      h('p', { class: 'mg-gb__tag', lang: 'en', text: `grey-box · ${this.type}${def.difficulty ? ` · ${def.difficulty}` : ''}` }),
      h('h2', { class: 'mg-gb__title', text: t(def.title_key) }),
      h('p', { class: 'mg-gb__brief', text: t(def.brief_key) }),
      ctx.introKey ? h('p', { class: 'mg-gb__intro', text: t(ctx.introKey) }) : null,
      rows.length > 0
        ? h(
            'dl',
            { class: 'mg-gb__cfg', lang: 'en' },
            ...rows.flatMap(([k, v]): HTMLElement[] => [h('dt', { text: k }), h('dd', { text: v })]),
          )
        : null,
      shown.length > 0
        ? h('ul', { class: 'mg-gb__hints' }, ...shown.map((x) => h('li', { text: `${t('ui.minigame.hint')}: ${x}` })))
        : null,
      actions,
    );
  }
}
