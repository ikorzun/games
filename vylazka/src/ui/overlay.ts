/**
 * Экраны поверх игры: загрузка, заставка, пауза, отчёт, титры. Посередине — название, строка и подсказка; весь экран —
 * кнопка «дальше».
 *
 * Заставка (слова партнёра 19.11): «Оставляем название и сразу под ним про сон и начать играть»; на фоне — светлячки из точек
 * (ui/fireflies.ts); «весь ряд кнопок унести под иконку настроек в правый верхний угол и сделать выпадающим списком, а части,
 * которые можно переключать, — сегмент-контролами»; шрифты тонкие, название — DM Mono. Предупреждение о вспышках и счётчик
 * сессий ушли со строк под названием: предупреждение — тихой строкой у нижнего края (знать о вспышках игрок должен до первой
 * вспышки: куратор, пачка 50, противоречие 308), счёт — внизу выпадающего списка.
 */
import { i18n, t } from '../core/i18n';
import type { FlashLevel, Level3 } from '../core/save';
import { LANGS } from '../core/types';
import type { Lang } from '../core/types';
import type { Quality } from '../render/renderer';
import { Fireflies } from './fireflies';

/** Строки авторства для титров: мебель полки и вещи памяти (как в их файлах авторства, целиком). */
export interface Credits {
  furniture: readonly string[];
  things: readonly string[];
}

/** Из строки авторства — что это и чьё: «"Название" by Автор, …» или «Название by Автор, …»; сделанное для игры — own. */
export function creditParts(line: string): { work: string; by: string; own: boolean } {
  const own = /^([^:]+): made for /.exec(line);
  if (own) return { work: own[1]!.trim(), by: '', own: true };
  const m = /^(?:[^"]*?:\s*)?"([^"]+)"\s+by\s+([^,;]+)/.exec(line) ?? /^(.+?)\s+by\s+([^,;]+)/.exec(line);
  if (m) return { work: m[1]!.trim(), by: m[2]!.trim(), own: false };
  const [a, b] = line.split(',');
  return { work: (a ?? line).trim(), by: (b ?? '').trim(), own: false };
}

/**
 * Титры лентой, как в кино (партнёр 24.11: «какое-то месиво, посмотри как собирают титры в фильмах… и сделай так же»): лента
 * медленно идёт снизу вверх; раздел — мелкой разрядкой; в строке слева, прижато к середине, — что это, справа — чьё; между
 * разделами воздух. Ссылки и лицензии — не в строках, а мелким блоком в самом конце, как юридическая строка фильма.
 */
function creditsRoll(c: Credits): HTMLElement {
  const el = (cls: string, text = ''): HTMLDivElement => {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = text;
    return d;
  };
  const wrap = el('vz-credits');
  const roll = el('vz-credits__roll');
  wrap.append(roll);
  roll.append(el('vz-credits__name', t('ui.title')));
  let rows = 0;
  const section = (head: string, pairs: readonly (readonly [string, string])[]): void => {
    if (pairs.length === 0) return;
    roll.append(el('vz-credits__head', head));
    for (const [what, who] of pairs) {
      const row = el('vz-credits__row');
      row.append(el('vz-credits__what', what), el('vz-credits__who', who));
      roll.append(row);
      rows += 1;
    }
  };
  const parts = (lines: readonly string[]): ReturnType<typeof creditParts>[] => lines.map(creditParts);
  const things = parts(c.things);
  section(t('credits.furniture'), parts(c.furniture).map((p) => [p.work, p.by] as const));
  section(t('credits.things'), things.filter((p) => !p.own).map((p) => [p.work, p.by] as const));
  const own = things.filter((p) => p.own).map((p) => p.work);
  if (own.length > 0) {
    roll.append(el('vz-credits__head', t('credits.own')), el('vz-credits__list', own.join(' · ')));
    rows += 2;
  }
  section(t('credits.sound'), [['', t('credits.sound.who')]]);
  section(t('credits.engine'), [['', t('credits.engine.who')]]);
  section(t('credits.type'), [['', t('credits.type.who')]]);
  const legal = el('vz-credits__legal');
  legal.append(el('vz-credits__legal-head', t('credits.legal')));
  for (const line of [...c.furniture, ...c.things.filter((x) => !/: made for /.test(x))]) legal.append(el('vz-credits__legal-line', line));
  roll.append(legal, el('vz-credits__name vz-credits__name--end', t('ui.title')));
  // Скорость ленты — как в кино: около двух строк в секунду чтения не требует, а раздел успевает прочитаться.
  roll.style.setProperty('--vz-roll', `${Math.round(24 + rows * 1.15 + (c.furniture.length + c.things.length) * 0.5)}s`);
  return wrap;
}

export type OverlayMode = 'hidden' | 'loading' | 'start' | 'paused' | 'report' | 'error' | 'credits';

export interface OverlayHandlers {
  onStart(): void;
  onResume(): void;
  /** Нажатие на экране отчёта: следующая вылазка. */
  onNext(): void;
  onQuality(next: Quality): void;
  /** Долгое нажатие на качество: строка проверки для телефона вкл/выкл (адрес #diag туда не доходит). */
  onDiag?(): void;
  /** Кнопка «трясти телефоном» (только там, где нужен явный запрос разрешения). */
  onMotion?(): void;
  /** Звук: включить или выключить. */
  onSound?(on: boolean): void;
  /** Чувствительность обзора и яркость: ниже, средне, выше. */
  onSens?(level: Level3): void;
  onBright?(level: Level3): void;
  /** Вспышки: мягкие или почти незаметные. */
  onFlash?(level: FlashLevel): void;
  /** Язык. */
  onLang?(lang: Lang): void;
  /** Сменить место вылазки (только на заставке): убежище → офис → жёлтые комнаты. */
  onPlace?(): void;
  /** Начать место заново: стёртость и круги места — с нуля, план тот же (только на заставке). */
  onRestartPlace?(): void;
}

/** Строка карточки: обычная, выполненная цель или подзаголовок. */
export interface CardLine {
  text: string;
  kind?: 'plain' | 'done' | 'todo' | 'head' | 'dim';
}

export interface Card {
  title: string;
  sub: string;
  lines: readonly CardLine[];
  prompt: string;
}

const ORDER: readonly Quality[] = ['low', 'med', 'high'];
/** Четвёртая ступень — высокое качество с зерном вдвое мельче: только на компьютере с большим экраном (setFineStep). */
const ORDER_DESK: readonly Quality[] = [...ORDER, 'ultra'];
const LEVELS: readonly Level3[] = [0, 1, 2];
const LEVEL_KEY = ['low', 'med', 'high'] as const;
const FLASHES: readonly FlashLevel[] = ['soft', 'faint'];
/** Названия языков — каждое на своём языке: так их находят, даже не понимая текущего. */
const LANG_NAME: Readonly<Record<string, string>> = { ru: 'Русский', en: 'English', es: 'Español', pt: 'Português' };

/** Шестерёнка: восемь зубцов тонкой линией и ось — своя, рисуется кодом. */
function gearSvg(): string {
  const n = 8;
  const step = (Math.PI * 2) / n;
  const p = (r: number, a: number): string => `${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`;
  const d: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = i * step - Math.PI / 2;
    d.push(`${i === 0 ? 'M' : 'L'}${p(7.4, a - step * 0.42)}`, `L${p(10, a - step * 0.2)}`, `L${p(10, a + step * 0.2)}`, `L${p(7.4, a + step * 0.42)}`);
  }
  return `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"><path d="${d.join(' ')}Z"/><circle cx="12" cy="12" r="3.1"/></svg>`;
}

/** Глобус — значок выбора языка. */
function globeSvg(): string {
  return '<svg class="vz-settings__globe" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9s1.3-6.4 3.9-9z"/></svg>';
}

/** Сегмент-контрол: ряд взаимоисключающих кнопок (role=radiogroup). Кнопки пересоздаются, только когда меняется их число. */
class Seg<T extends string | number> {
  readonly el: HTMLElement;
  private values: readonly T[] = [];
  private current: T | null = null;

  constructor(
    name: string,
    private readonly pick: (v: T) => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = `vz-seg vz-seg--${name}`;
    this.el.setAttribute('role', 'radiogroup');
    // Стрелки ходят по вариантам, как у системного сегмент-контрола.
    this.el.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const i = this.current === null ? 0 : this.values.indexOf(this.current);
      const next = this.values[(i + (e.key === 'ArrowRight' ? 1 : this.values.length - 1)) % this.values.length];
      if (next === undefined) return;
      this.pick(next);
      (this.el.children[this.values.indexOf(next)] as HTMLElement | undefined)?.focus();
    });
  }

  set(values: readonly T[], labels: readonly string[], current: T, aria: string): void {
    this.el.setAttribute('aria-label', aria);
    if (values.length !== this.values.length || values.some((v, i) => v !== this.values[i])) {
      this.el.replaceChildren(
        ...values.map((v) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'vz-seg__opt';
          b.setAttribute('role', 'radio');
          b.dataset.v = String(v);
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            if (v !== this.current) this.pick(v);
          });
          return b;
        }),
      );
      this.values = values;
    }
    this.current = current;
    values.forEach((v, i) => {
      const b = this.el.children[i] as HTMLButtonElement;
      b.textContent = labels[i] ?? String(v);
      const on = v === current;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle('is-on', on);
    });
  }
}

export class Overlay {
  readonly el: HTMLElement;
  mode: OverlayMode = 'hidden';
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly body: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly rotate: HTMLElement;
  private readonly note: HTMLElement;
  private readonly gear: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly info: HTMLElement;
  private readonly labels = new Map<string, HTMLElement>();
  private readonly rows = new Map<string, HTMLElement>();
  private readonly soundSeg: Seg<'on' | 'off'>;
  private readonly qualitySeg: Seg<Quality>;
  private readonly sensSeg: Seg<Level3>;
  private readonly brightSeg: Seg<Level3>;
  private readonly flashSeg: Seg<FlashLevel>;
  private readonly langSeg: Seg<Lang>;
  private readonly motionBtn: HTMLButtonElement;
  private readonly placeBtn: HTMLButtonElement;
  private readonly restartBtn: HTMLButtonElement;
  private readonly creditsBtn: HTMLButtonElement;
  private readonly fireflies: Fireflies;
  private open = false;
  /** Строки авторства моделей (полка Sand3D, CC-BY 4.0): что показывают титры. Пусто — кнопки нет. */
  private credits: Credits = { furniture: [], things: [] };
  /** Нижние строки выпадающего списка (счёт сессий) и тихая строка у нижнего края заставки (предупреждение). */
  private infoLines: readonly string[] = [];
  private noteText = '';
  /** С какого экрана открыли титры: туда и возвращает нажатие. */
  private beforeCredits: OverlayMode = 'start';
  /** Можно ли начать место заново (у места есть круги или стёртость) и ждёт ли кнопка второго нажатия. */
  private canRestart = false;
  private restartArmed = 0;
  private place = 'shelter';
  private placePick = true;
  private flash: FlashLevel = 'soft';
  private sens: Level3 = 1;
  private bright: Level3 = 1;
  private sound = true;
  private quality: Quality = 'med';
  private touch = false;
  private fineStep = false;
  private errorText = '';
  private card: Card | null = null;
  private shownAt = 0;

  constructor(
    parent: HTMLElement,
    private readonly handlers: OverlayHandlers,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'vz-overlay';
    this.el.innerHTML =
      '<div class="vz-overlay__box">' +
      '<div class="vz-overlay__title"></div><div class="vz-overlay__sub"></div>' +
      '<div class="vz-overlay__body"></div>' +
      '<div class="vz-overlay__prompt"></div></div>' +
      '<div class="vz-overlay__foot"><div class="vz-overlay__note"></div><div class="vz-overlay__rotate"></div></div>' +
      `<button type="button" class="vz-overlay__gear" aria-haspopup="true" aria-expanded="false" aria-controls="vz-settings">${gearSvg()}</button>` +
      // Выпадающий список настроек. data-scroll: на очень низком экране он прокручивается внутри себя.
      '<div class="vz-settings" id="vz-settings" role="group" data-scroll hidden><div class="vz-settings__rows"></div>' +
      '<div class="vz-settings__acts">' +
      '<button type="button" class="vz-overlay__opt vz-overlay__opt--place"></button>' +
      '<button type="button" class="vz-overlay__opt vz-overlay__opt--restart"></button>' +
      '<button type="button" class="vz-overlay__opt vz-overlay__opt--credits"></button>' +
      '<button type="button" class="vz-overlay__opt vz-overlay__opt--motion"></button></div>' +
      '<div class="vz-settings__info"></div></div>';
    parent.append(this.el);
    const q = (sel: string): HTMLElement => this.el.querySelector(sel) as HTMLElement;
    this.title = q('.vz-overlay__title');
    this.sub = q('.vz-overlay__sub');
    this.body = q('.vz-overlay__body');
    this.prompt = q('.vz-overlay__prompt');
    this.rotate = q('.vz-overlay__rotate');
    this.note = q('.vz-overlay__note');
    this.gear = q('.vz-overlay__gear') as HTMLButtonElement;
    this.panel = q('.vz-settings');
    this.info = q('.vz-settings__info');
    this.fireflies = new Fireflies(this.el);

    this.soundSeg = new Seg('sound', (v) => this.handlers.onSound?.(v === 'on'));
    this.qualitySeg = new Seg('quality', (v) => this.handlers.onQuality(v));
    this.sensSeg = new Seg('sens', (v) => this.handlers.onSens?.(v));
    this.brightSeg = new Seg('bright', (v) => this.handlers.onBright?.(v));
    this.flashSeg = new Seg('flash', (v) => this.handlers.onFlash?.(v));
    this.langSeg = new Seg('lang', (v) => this.handlers.onLang?.(v));
    const rows = q('.vz-settings__rows');
    for (const [name, seg] of [
      ['sound', this.soundSeg],
      ['quality', this.qualitySeg],
      ['sens', this.sensSeg],
      ['bright', this.brightSeg],
      ['flash', this.flashSeg],
      ['lang', this.langSeg],
    ] as const) {
      const row = document.createElement('div');
      row.className = `vz-settings__row vz-settings__row--${name}`;
      const label = document.createElement('span');
      label.className = 'vz-settings__label';
      // Язык — со значком глобуса: его находят, не зная языка интерфейса (Playgama, пункт 3.4.4).
      if (name === 'lang') label.innerHTML = globeSvg();
      const text = document.createElement('span');
      label.append(text);
      row.append(label, seg.el);
      rows.append(row);
      this.labels.set(name, text);
      this.rows.set(name, row);
    }

    this.motionBtn = q('.vz-overlay__opt--motion') as HTMLButtonElement;
    this.motionBtn.hidden = true;
    this.motionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handlers.onMotion?.();
    });
    this.placeBtn = q('.vz-overlay__opt--place') as HTMLButtonElement;
    this.placeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handlers.onPlace?.();
    });
    // Начать место заново — вторым нажатием: окна «вы уверены?» в игре нет, а стереть круги случайно легко.
    this.restartBtn = q('.vz-overlay__opt--restart') as HTMLButtonElement;
    this.restartBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const now = performance.now();
      if (now - this.restartArmed < 4000) {
        this.restartArmed = 0;
        this.handlers.onRestartPlace?.();
      } else this.restartArmed = now;
      this.refresh();
    });
    // Титры: авторы моделей мебели (лицензия CC-BY 4.0 требует их назвать). Адреса — простым текстом, не ссылками.
    this.creditsBtn = q('.vz-overlay__opt--credits') as HTMLButtonElement;
    this.creditsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.mode !== 'credits') this.beforeCredits = this.mode;
      this.setOpen(false);
      this.show('credits');
    });

    // Подержать качество полторы секунды — строка проверки (во встроенном просмотре Claude адрес страницы с #diag до игры
    // не доходит). Отпущенное раньше — обычное нажатие.
    let holdTimer: number | undefined;
    let held = false;
    const qEl = this.qualitySeg.el;
    qEl.addEventListener('pointerdown', () => {
      held = false;
      if (holdTimer !== undefined) clearTimeout(holdTimer);
      holdTimer = window.setTimeout(() => {
        held = true;
        this.handlers.onDiag?.();
      }, 1500);
    });
    const cancelHold = (): void => {
      if (holdTimer !== undefined) clearTimeout(holdTimer);
      holdTimer = undefined;
    };
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) qEl.addEventListener(type, cancelHold);
    qEl.addEventListener('contextmenu', (e) => e.preventDefault());
    // Отпущенное после долгого нажатия не переключает качество.
    qEl.addEventListener(
      'click',
      (e) => {
        if (!held) return;
        held = false;
        e.stopPropagation();
        e.preventDefault();
      },
      { capture: true },
    );

    this.gear.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setOpen(!this.open);
    });
    // Нажатия внутри списка не начинают игру. Закрывается список шестерёнкой или нажатием мимо него; Esc игра не трогает
    // (docs/platform/playgama-constraints.md).
    this.panel.addEventListener('click', (e) => e.stopPropagation());
    // Весь экран — кнопка «начать», «продолжить» или «дальше». Открытый список сначала закрывается: мимо него не начинают.
    this.el.addEventListener('click', () => {
      if (this.open) {
        this.setOpen(false);
        return;
      }
      if (this.mode === 'start') this.handlers.onStart();
      else if (this.mode === 'paused') this.handlers.onResume();
      // Отчёт нельзя пролистнуть случайным нажатием сразу после конца вылазки.
      else if (this.mode === 'report' && performance.now() - this.shownAt > 900) this.handlers.onNext();
      else if (this.mode === 'credits') this.show(this.beforeCredits);
    });
  }

  /** Открыть или закрыть список настроек. */
  setOpen(open: boolean): void {
    const can = this.gearShown();
    this.open = open && can;
    this.panel.hidden = !this.open;
    this.gear.setAttribute('aria-expanded', String(this.open));
    this.el.classList.toggle('is-settings', this.open);
  }

  /** Открыт ли список настроек. */
  get settingsOpen(): boolean {
    return this.open;
  }

  private gearShown(): boolean {
    return this.mode === 'start' || this.mode === 'paused' || this.mode === 'report';
  }

  setTouch(touch: boolean): void {
    this.touch = touch;
    this.refresh();
  }

  /** Есть ли в качестве четвёртая ступень (мелкое зерно): решает приложение — по устройству и экрану. */
  setFineStep(on: boolean): void {
    this.fineStep = on;
    this.refresh();
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.refresh();
  }

  setSound(on: boolean): void {
    this.sound = on;
    this.refresh();
  }

  /** Уровни чувствительности и яркости: 0 — ниже, 1 — средняя, 2 — выше. */
  setLevels(sens: Level3, bright: Level3): void {
    this.sens = sens;
    this.bright = bright;
    this.refresh();
  }

  /** Показать кнопку датчика движения (label — её подпись) или скрыть (null). */
  setMotionButton(label: string | null): void {
    this.motionBtn.hidden = label === null;
    if (label !== null) this.motionBtn.textContent = label;
  }

  /** Вспышки: мягкие или почти незаметные. */
  setFlash(level: FlashLevel): void {
    this.flash = level;
    this.refresh();
  }

  /** Место вылазки, которое выбрано сейчас. */
  setPlace(place: string): void {
    this.place = place;
    this.refresh();
  }

  /**
   * Можно ли выбрать место кнопкой. Место игрок не выбирает (решение партнёра 16.11): кнопка — только в петле одного места,
   * для проверок (знак #place, ?loop=1).
   */
  setPlacePick(on: boolean): void {
    this.placePick = on;
    this.refresh();
  }

  /** Есть ли что начинать заново: у места есть пройденные круги или стёртость. */
  setRestart(can: boolean): void {
    this.canRestart = can;
    if (!can) this.restartArmed = 0;
    this.refresh();
  }

  /** Строки авторства для титров (приходят с куском моделей полки, world/sand3d.ts). */
  setCredits(lines: Credits): void {
    this.credits = lines;
    this.refresh();
  }

  /** Нижние строки списка настроек: счёт сессий и воспоминаний. */
  setInfo(lines: readonly string[]): void {
    this.infoLines = lines;
    this.refresh();
  }

  /** Тихая строка у нижнего края заставки: предупреждение о вспышках (пусто — нет строки). */
  setNote(text: string): void {
    this.noteText = text;
    this.refresh();
  }

  setCard(card: Card | null): void {
    this.card = card;
    this.refresh();
  }

  show(mode: OverlayMode, errorText = ''): void {
    if (mode !== this.mode) this.shownAt = performance.now();
    this.mode = mode;
    this.errorText = errorText;
    if (!this.gearShown()) this.setOpen(false);
    this.refresh();
  }

  refresh(): void {
    const m = this.mode;
    const card = m === 'start' || m === 'report' ? this.card : null;
    this.el.classList.toggle('is-on', m !== 'hidden');
    this.el.dataset.mode = m;
    this.fireflies.setOn(m === 'start');
    this.title.textContent = card ? card.title : m === 'paused' ? t('ui.paused') : m === 'credits' ? '' : t('ui.title');
    this.sub.textContent = card ? card.sub : m === 'paused' || m === 'credits' ? '' : t('ui.subtitle');
    this.body.replaceChildren();
    const lines: readonly CardLine[] = card?.lines ?? [];
    if (m === 'credits') this.body.append(creditsRoll(this.credits));
    for (const line of lines) {
      const row = document.createElement('div');
      row.className = `vz-overlay__line vz-overlay__line--${line.kind ?? 'plain'}`;
      row.textContent = line.text;
      this.body.append(row);
    }
    const sfx = this.touch ? '.touch' : '';
    this.prompt.textContent = card ? card.prompt : m === 'loading' ? t('ui.loading') : m === 'start' ? t(`ui.start${sfx}`) : m === 'paused' ? t(`ui.resume${sfx}`) : m === 'credits' ? t(`ui.credits.back${sfx}`) : m === 'error' ? this.errorText : '';

    // Шестерёнка и список настроек.
    const gear = this.gearShown();
    this.gear.hidden = !gear;
    this.gear.setAttribute('aria-label', t('ui.settings'));
    this.gear.title = t('ui.settings');
    this.panel.setAttribute('aria-label', t('ui.settings'));
    const label = (name: string, key: string): void => {
      this.labels.get(name)!.textContent = t(key);
    };
    label('sound', 'ui.sound');
    label('quality', 'ui.quality');
    label('sens', 'ui.sens');
    label('bright', 'ui.bright');
    label('flash', 'ui.flash');
    label('lang', 'ui.lang');
    this.soundSeg.set(['on', 'off'], [t('ui.sound.on'), t('ui.sound.off')], this.sound ? 'on' : 'off', t('ui.sound'));
    const order = this.fineStep || this.quality === 'ultra' ? ORDER_DESK : ORDER;
    this.qualitySeg.set(
      order,
      order.map((x) => t(`ui.quality.${x}`)),
      this.quality,
      t('ui.quality'),
    );
    const levels = LEVELS.map((l) => t(`ui.level.${LEVEL_KEY[l]}`));
    this.sensSeg.set(LEVELS, levels, this.sens, t('ui.sens'));
    this.brightSeg.set(LEVELS, levels, this.bright, t('ui.bright'));
    this.flashSeg.set(
      FLASHES,
      FLASHES.map((f) => t(`ui.flash.${f}`)),
      this.flash,
      t('ui.flash'),
    );
    this.langSeg.set(
      LANGS,
      LANGS.map((l) => LANG_NAME[l] ?? l),
      i18n.lang,
      t('ui.lang'),
    );
    // Место выбирают до начала: посреди вылазки его не сменить. И только в петле одного места: сон выбирает сам.
    this.placeBtn.textContent = t(`ui.place.${this.place}`);
    this.placeBtn.hidden = m !== 'start' || !this.placePick;
    const armed = performance.now() - this.restartArmed < 4000;
    // Место на заставке не выбирают — кнопка говорит, какое место начнётся заново (куратор, противоречие 223).
    this.restartBtn.textContent = armed ? t('ui.restart.sure') : t('ui.restart.place', { place: t(`cam.place.${this.place}`) });
    this.restartBtn.classList.toggle('is-armed', armed);
    this.restartBtn.hidden = m !== 'start' || !this.canRestart;
    this.creditsBtn.textContent = t('ui.credits');
    this.creditsBtn.hidden = (m !== 'start' && m !== 'paused') || this.credits.furniture.length + this.credits.things.length === 0;
    this.info.replaceChildren(
      ...this.infoLines.map((text) => {
        const d = document.createElement('div');
        d.className = 'vz-settings__note';
        d.textContent = text;
        return d;
      }),
    );
    this.note.textContent = m === 'start' ? this.noteText : '';
    this.rotate.textContent = t('ui.rotate');
  }
}
