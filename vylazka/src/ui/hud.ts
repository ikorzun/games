/**
 * Надписи поверх кадра, как на записи с нагрудной камеры: REC и номер камеры слева, дата и время
 * справа; ниже — список целей, заряд фонаря, подсказки. Всё — DOM поверх canvas: читаемо при любом
 * разрешении рендера.
 */
import { t } from '../core/i18n';

const pad = (n: number): string => String(n).padStart(2, '0');
/** Сколько уходит обрывок метаслоя (transition у .vz-hud__meta в styles.css). */
const META_FADE_MS = 1200;
/** Сколько гаснет вспышка воспоминания (transition у .vz-hud__flash в styles.css). */
/** Пауза между репликами разговора, мс. */
const SAY_GAP_MS = 320;
const FLASH_FADE_MS = 1600;

/** Дата и время записи: старт 13 ноября 2004, 23:41:07, дальше идут игровые секунды. */
/** С какой секунды суток идёт запись: 23:41:07. */
const REC_START = 23 * 3600 + 41 * 60 + 7;
/** Сколько секунд записи от её начала до полуночи — до мига. */
export const MIDNIGHT = 24 * 3600 - REC_START;

/**
 * Время на камере подходит к мигу и само до него не доходит: последние две минуты (slow) секунды тянутся всё дольше, часы
 * замирают на 23:59:5x. Наступает миг, только когда место стирается до конца, — тогда запись обрывается (ответ партнёра
 * в квизе 17.11: «Запись обрывается»; Hud.cut).
 */
export function towardMidnight(seconds: number, slow = 120): number {
  const d = MIDNIGHT - seconds;
  if (d >= slow) return seconds;
  // Не ближе миллисекунды: в плавающей точке хвост кривой иначе сливается с самой полуночью.
  return Math.min(MIDNIGHT - 1e-3, MIDNIGHT - slow * Math.exp((d - slow) / slow));
}

export function recTimestamp(seconds: number): string {
  const start = REC_START;
  const total = start + Math.floor(seconds);
  const day = 13 + Math.floor(total / 86400);
  const s = total % 86400;
  return `2004-11-${pad(day)} ${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export interface GoalLine {
  text: string;
  done: boolean;
}

/** Сколько миллисекунд после смены места рядом с номером камеры видно имя места. */
const CAM_CAPTION_MS = 5200;

export class Hud {
  readonly el: HTMLElement;
  private readonly rec: HTMLElement;
  private readonly cam: HTMLElement;
  /** Имя места под временем и кругом — на телефоне (на компьютере оно рядом с номером камеры). */
  private readonly placeEl: HTMLElement;
  /** Номер круга петли рядом с камерой (вариант A; партнёр: «Да» — номер круга виден на экране). */
  private readonly lapEl: HTMLElement;
  private lapN: number | null = null;
  /** Камера места: какое место, до какого мига рядом с номером видно имя места и видно ли сейчас. */
  private camWorld = '';
  private camUntil = 0;
  private camOn = false;
  private readonly clock: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly fps: HTMLElement;
  private readonly goals: HTMLElement;
  private readonly bat: HTMLElement;
  private readonly batArc: HTMLElement;
  private readonly batSpare: HTMLElement;
  private readonly act: HTMLElement;
  private readonly actText: HTMLElement;
  private readonly actBar: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly flashEl: HTMLElement;
  private readonly limboEl: HTMLElement;
  private readonly sayEl: HTMLElement;
  private readonly tagEl: HTMLElement;
  private sayTimer: ReturnType<typeof setTimeout> | undefined;
  private sayRun = 0;
  private readonly metaEl: HTMLElement;
  private metaTimer: ReturnType<typeof setTimeout> | undefined;
  private metaStop: (() => void) | null = null;
  private metaDone: (() => void) | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | undefined;
  private lastLimbo = '';
  private readonly mark: HTMLElement;
  private lastClock = '';
  private lastHint = '';
  private lastPrompt = '';
  private lastGoals = '';
  private lastAct = '';
  private lastBat = '';
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  /** Сообщение, которое ждёт конца вспышки. */
  private toastWait: ReturnType<typeof setTimeout> | undefined;
  private toastPending: { text: string; ms: number } | null = null;
  /** До какого времени (Date.now) горит или гаснет вспышка. */
  private flashUntil = 0;
  /** Вспышка, поставленная в очередь: ждёт, пока догорит нынешняя (flash(…, queue)). */
  private flashPending: { text: string; ms: number } | null = null;
  private flashWait: ReturnType<typeof setTimeout> | undefined;
  /** Миг: до какого времени (Date.now) кадр чёрный и часы стоят на 00:00:00. */
  private cutUntil = 0;
  private cutTimers: ReturnType<typeof setTimeout>[] = [];

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'vz-hud';
    this.el.innerHTML =
      '<div class="vz-hud__top">' +
      '<div class="vz-hud__tl"><span class="vz-hud__dot"></span><span class="vz-hud__rec"></span><span class="vz-hud__cam"></span></div>' +
      // Номер круга — под временем записи: слева на телефоне под строкой REC стоит кнопка паузы, и
      // вторая строка там упиралась в неё (смоук, матрица раскладки с длинным переводом).
      // Имя места на телефоне — тоже здесь, под кругом: рядом с номером камеры оно уходило за край или на кнопку паузы.
      '<div class="vz-hud__tr"><span class="vz-hud__clock"></span><span class="vz-hud__lap"></span><span class="vz-hud__place"></span><span class="vz-hud__fps"></span></div>' +
      '</div>' +
      '<div class="vz-hud__goals"></div>' +
      '<div class="vz-hud__toast"></div>' +
      '<div class="vz-hud__flash"></div>' +
      '<div class="vz-hud__limbo"></div>' +
      // Сюжет «Невостребованное» (koma_flow.ts): реплики под серединой кадра и бирка вещи.
      '<div class="vz-hud__say"></div>' +
      '<div class="vz-hud__tag"><div class="vz-hud__tag-head"></div><div class="vz-hud__tag-name"></div><div class="vz-hud__tag-row"><span class="vz-hud__tag-key"></span><span class="vz-hud__tag-val"></span></div><div class="vz-hud__tag-stamp"></div></div>' +
      // Обрывок метаслоя (ui/meta_card.ts): в лимбо, вместо его строк.
      '<div class="vz-hud__meta"></div>' +
      '<div class="vz-hud__mark"></div>' +
      '<div class="vz-hud__prompt"><span class="vz-hud__prompt-text"></span><span class="vz-hud__bar"><i></i></span></div>' +
      '<div class="vz-hud__act"><span class="vz-hud__act-text"></span><span class="vz-hud__bar"><i></i></span></div>' +
      // Заряд фонаря — обводкой вокруг его значка (слова партнёра 17.11 08:19): дуга кольца — доля заряда.
      '<div class="vz-hud__bat"><svg class="vz-hud__bat-ring" viewBox="0 0 48 48" aria-hidden="true">' +
      '<circle class="vz-hud__bat-track" cx="24" cy="24" r="21"/>' +
      '<circle class="vz-hud__bat-arc" cx="24" cy="24" r="21" pathLength="100" transform="rotate(-90 24 24)"/>' +
      '<g transform="translate(10.5 11) scale(0.54)"><path d="M5 19h15l8-6h5v22h-5l-8-6H5z" fill="currentColor"/>' +
      '<path d="M38 15l5-3M39 24h6M38 33l5 3" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></g>' +
      '</svg><span class="vz-hud__bat-spare"></span></div>' +
      '<div class="vz-hud__hint"></div>' +
      // Миг: чёрный кадр поверх всего, кроме часов.
      '<div class="vz-hud__cut"></div>';
    parent.append(this.el);
    const q = (sel: string): HTMLElement => this.el.querySelector(sel) as HTMLElement;
    this.rec = q('.vz-hud__rec');
    this.cam = q('.vz-hud__cam');
    this.placeEl = q('.vz-hud__place');
    this.lapEl = q('.vz-hud__lap');
    this.clock = q('.vz-hud__clock');
    this.hint = q('.vz-hud__hint');
    this.prompt = q('.vz-hud__prompt-text');
    this.bar = q('.vz-hud__prompt .vz-hud__bar i');
    this.fps = q('.vz-hud__fps');
    this.goals = q('.vz-hud__goals');
    this.bat = q('.vz-hud__bat');
    this.batArc = q('.vz-hud__bat-arc');
    this.batSpare = q('.vz-hud__bat-spare');
    this.act = q('.vz-hud__act');
    this.actText = q('.vz-hud__act-text');
    this.actBar = q('.vz-hud__act .vz-hud__bar i');
    this.toastEl = q('.vz-hud__toast');
    this.flashEl = q('.vz-hud__flash');
    this.metaEl = q('.vz-hud__meta');
    this.limboEl = q('.vz-hud__limbo');
    this.sayEl = q('.vz-hud__say');
    this.tagEl = q('.vz-hud__tag');
    this.mark = q('.vz-hud__mark');
    this.relabel();
  }

  relabel(): void {
    this.rec.textContent = t('hud.rec');
    this.renderCam();
    this.lapEl.textContent = this.lapN === null ? '' : t('hud.lap', { n: this.lapN });
  }

  /**
   * Камера места (связка куратора «Камера переключилась», пачка 39): у каждого места свой номер камеры; announce — место
   * сменилось, и несколько секунд рядом с номером видно его имя. Это подпись записи, а не заголовок уровня.
   */
  setCamera(world: string, announce: boolean): void {
    this.camWorld = world;
    this.camUntil = announce ? performance.now() + CAM_CAPTION_MS : 0;
    this.renderCam();
  }

  private renderCam(): void {
    const cam = this.camWorld ? t(`hud.cam.${this.camWorld}`) : t('hud.cam');
    this.camOn = performance.now() < this.camUntil;
    const place = this.camOn ? t(`cam.place.${this.camWorld}`) : '';
    // На телефоне слева под строкой REC — кнопка паузы, а строка «КАМ-12Б · жёлтые комнаты» на 360 px уходила за край
    // или, перенесённая, на кнопку (CI 17.11, матрица раскладки): там имя места — справа, под временем и кругом.
    const touch = this.el.closest('.is-touch') !== null;
    this.cam.textContent = place && !touch ? t('hud.cam.with', { cam, place }) : cam;
    this.placeEl.textContent = place && touch ? place : '';
  }

  /** Номер круга петли места; null — не показывать (меню, карманы до первой сессии). */
  setLap(n: number | null): void {
    this.lapN = n;
    this.lapEl.textContent = n === null ? '' : t('hud.lap', { n });
  }

  /** Время на камере, как оно сейчас в углу кадра. */
  clockText(): string {
    return this.lastClock;
  }

  setTime(seconds: number): void {
    // Имя места у номера камеры гаснет само.
    if (this.camOn && performance.now() >= this.camUntil) this.renderCam();
    if (Date.now() < this.cutUntil) return;
    const s = recTimestamp(towardMidnight(seconds));
    if (s !== this.lastClock) {
      this.lastClock = s;
      this.clock.textContent = s;
    }
  }

  /**
   * Миг (ответ партнёра в квизе 17.11): место стёрто до конца — часы встают на 00:00:00, REC гаснет, кадр обрывается в
   * черноту; через миг гаснут и часы, потом чернота сходит. Словами ничего не объясняется.
   */
  cut(ms: number): void {
    for (const id of this.cutTimers) clearTimeout(id);
    this.cutUntil = Date.now() + ms;
    this.lastClock = recTimestamp(MIDNIGHT);
    this.clock.textContent = this.lastClock;
    this.el.classList.add('is-cut');
    this.el.classList.remove('is-cut-dark');
    // Кнопки телефона лежат поверх HUD — в миг их не видно (критика куратора 17.11).
    document.documentElement.classList.add('vz-cutting');
    this.cutTimers = [
      setTimeout(() => this.el.classList.add('is-cut-dark'), Math.round(ms * 0.55)),
      setTimeout(() => {
        this.el.classList.remove('is-cut', 'is-cut-dark');
        document.documentElement.classList.remove('vz-cutting');
        this.cutUntil = 0;
      }, ms),
    ];
  }

  /** Идёт ли миг (для проверок). */
  get cutting(): boolean {
    return this.el.classList.contains('is-cut');
  }

  /** Подсказка внизу кадра; пустая строка — скрыть. */
  setHint(text: string): void {
    if (text === this.lastHint) return;
    this.lastHint = text;
    this.hint.textContent = text;
    this.hint.classList.toggle('is-on', text !== '');
  }

  /** Крупная подсказка «трясите фонарь» с полосой прогресса. */
  setShakePrompt(text: string, progress: number): void {
    if (text !== this.lastPrompt) {
      this.lastPrompt = text;
      this.prompt.textContent = text;
      this.el.classList.toggle('is-shake', text !== '');
    }
    this.bar.style.width = `${Math.round(progress * 100)}%`;
  }

  /** Список целей вылазки. visible — показать панель; пустой список — панели нет. */
  setGoals(title: string, lines: readonly GoalLine[], visible: boolean): void {
    const key = `${title}|${lines.map((l) => (l.done ? '+' : '-') + l.text).join('|')}`;
    if (key !== this.lastGoals) {
      this.lastGoals = key;
      this.goals.replaceChildren();
      if (lines.length > 0) {
        const h = document.createElement('div');
        h.className = 'vz-hud__goals-title';
        h.textContent = title;
        this.goals.append(h);
        for (const l of lines) {
          const row = document.createElement('div');
          row.className = `vz-hud__goal${l.done ? ' is-done' : ''}`;
          row.textContent = l.text;
          this.goals.append(row);
        }
      }
    }
    this.goals.classList.toggle('is-on', visible && lines.length > 0);
  }

  /**
   * Заряд фонаря (0..1) и число запасных батареек. hidden — не показывать вовсе. Заряд — дуга кольца вокруг
   * значка фонаря (по процентам: кольцо убывает плавно); на последней четверти (там же, где свет тускнеет
   * и отказы учащаются) — красная и мигает.
   */
  setBattery(charge: number, spares: number, hidden = false): void {
    const pct = Math.max(0, Math.min(100, Math.round(charge * 100)));
    const key = `${hidden ? 'h' : ''}${pct}:${spares}`;
    if (key === this.lastBat) return;
    this.lastBat = key;
    this.bat.classList.toggle('is-on', !hidden);
    this.bat.classList.toggle('is-low', pct <= 25);
    this.bat.dataset.charge = String(pct);
    this.batArc.style.strokeDasharray = `${pct} 100`;
    this.batSpare.textContent = spares > 0 ? `+${spares}` : '';
  }

  /** Подсказка действия («взять», «снять», «подняться») и доля удержания. Пустой текст — скрыть. */
  setAction(text: string, progress: number): void {
    if (text !== this.lastAct) {
      this.lastAct = text;
      this.actText.textContent = text;
      this.act.classList.toggle('is-on', text !== '');
    }
    this.actBar.style.width = `${Math.round(progress * 100)}%`;
    this.actBar.parentElement!.classList.toggle('is-on', progress > 0);
  }

  /**
   * Короткое сообщение вверху кадра на несколько секунд. Пока горит или гаснет вспышка, сообщение ждёт:
   * на высоком экране длинная подсказка дорастает до середины кадра и ложится на строку вспышки (кадр
   * партнёра с телефона: подсказка про касание поверх «it only looks still.»).
   */
  toast(text: string, ms = 3200): void {
    if (this.toastWait !== undefined) clearTimeout(this.toastWait);
    this.toastWait = undefined;
    this.toastPending = null;
    const wait = this.flashUntil - Date.now();
    if (wait > 0) {
      this.toastPending = { text, ms };
      this.toastWait = setTimeout(() => this.toast(text, ms), wait);
      return;
    }
    this.toastEl.textContent = text;
    this.toastEl.classList.add('is-on');
    if (this.toastTimer !== undefined) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('is-on'), ms);
  }

  /**
   * Вспышка воспоминания: строка посреди кадра, появляется рывком и медленно гаснет. queue — не гасить горящую вспышку, а
   * дождаться, пока она догорит (первый сон: вещь приходит, пока горит строка Осыпи, и гасила её на полуслове — Z-19, приём 1).
   */
  flash(text: string, ms = 5200, queue = false): void {
    const wait = this.flashUntil - Date.now();
    if (queue && wait > 0) {
      this.flashPending = { text, ms };
      this.armFlashWait(wait);
      return;
    }
    // Вспышка важнее прочих сообщений: они стоят почти там же и легли бы строкой на строку. Горящее
    // сообщение гаснет, ждущее — ждёт дальше (до конца новой вспышки и её угасания, 1,6 с в стилях).
    this.flashUntil = Date.now() + ms + FLASH_FADE_MS;
    // Вспышка из очереди ждёт и эту, новую.
    if (this.flashPending) this.armFlashWait(ms + FLASH_FADE_MS);
    const pending = this.toastPending;
    if (pending) this.toast(pending.text, pending.ms);
    this.toastEl.classList.remove('is-on');
    this.flashEl.textContent = text;
    this.flashEl.classList.remove('is-on');
    // Перезапуск анимации появления.
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('is-on');
    if (this.flashTimer !== undefined) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flashEl.classList.remove('is-on'), ms);
  }

  /**
   * Обрывок метаслоя посреди кадра на ms мс; строки лимбо на это время уходят. stop — остановить то, что карточка крутит сама
   * (кадры записи); done — когда карточка ушла совсем.
   */
  meta(card: HTMLElement, ms: number, stop: () => void, done: () => void): void {
    this.metaClear();
    this.metaEl.replaceChildren(card);
    this.el.classList.add('is-meta');
    // Перезапуск появления.
    void this.metaEl.offsetWidth;
    this.metaEl.classList.add('is-on');
    this.metaStop = stop;
    this.metaDone = done;
    this.metaTimer = setTimeout(() => {
      this.metaEl.classList.remove('is-on');
      this.metaTimer = setTimeout(() => this.metaClear(), META_FADE_MS);
    }, ms);
  }

  /** Карточка сюжета тем же местом: заголовок и строки (запись, «известно точно»). done — когда ушла совсем. */
  card(head: string, rows: readonly { text: string; who: string }[], ms: number, done: () => void): void {
    const card = document.createElement('div');
    card.className = 'vz-meta vz-meta--tape';
    const top = document.createElement('div');
    top.className = 'vz-meta__tape-head';
    top.textContent = head;
    card.append(top);
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = `vz-meta__tape-line is-${r.who}`;
      row.textContent = r.text;
      card.append(row);
    }
    this.meta(card, ms, () => {}, done);
  }

  /** Убрать обрывок (и сказать тому, кто ждал, что он ушёл). */
  metaClear(): void {
    if (this.metaTimer !== undefined) clearTimeout(this.metaTimer);
    this.metaTimer = undefined;
    this.metaStop?.();
    this.metaStop = null;
    this.metaEl.classList.remove('is-on');
    this.metaEl.replaceChildren();
    this.el.classList.remove('is-meta');
    const done = this.metaDone;
    this.metaDone = null;
    done?.();
  }

  /** Показать вспышку из очереди через wait мс. */
  private armFlashWait(wait: number): void {
    if (this.flashWait !== undefined) clearTimeout(this.flashWait);
    this.flashWait = setTimeout(() => {
      this.flashWait = undefined;
      const p = this.flashPending;
      this.flashPending = null;
      if (p) this.flash(p.text, p.ms, true);
    }, wait);
  }

  /**
   * Реплики сюжета по одной, под серединой кадра: who — чей голос (стиль строки), ms — сколько держится. Новый разговор обрывает
   * прежний. Вспышка из очереди (строка пришедшей вещи) ждёт конца разговора: две строки разом не читаются. done — когда
   * разговор кончился сам (не оборван).
   */
  say(lines: readonly { text: string; who: string; ms: number }[], delay = 0, done?: () => void): void {
    const run = ++this.sayRun;
    if (this.sayTimer !== undefined) clearTimeout(this.sayTimer);
    const total = delay + lines.reduce((n, l) => n + l.ms + SAY_GAP_MS, 0);
    if (lines.length > 0) {
      this.flashUntil = Math.max(this.flashUntil, Date.now() + total);
      if (this.flashPending) this.armFlashWait(this.flashUntil - Date.now());
    }
    const step = (i: number): void => {
      if (run !== this.sayRun) return;
      const l = lines[i];
      if (!l) {
        this.sayEl.classList.remove('is-on');
        this.sayTimer = undefined;
        done?.();
        return;
      }
      this.sayEl.className = `vz-hud__say is-${l.who}`;
      this.sayEl.textContent = l.text;
      void this.sayEl.offsetWidth;
      this.sayEl.classList.add('is-on');
      this.sayTimer = setTimeout(() => {
        this.sayEl.classList.remove('is-on');
        this.sayTimer = setTimeout(() => step(i + 1), SAY_GAP_MS);
      }, l.ms);
    };
    if (lines.length === 0) {
      this.sayEl.classList.remove('is-on');
      this.sayTimer = undefined;
      return;
    }
    this.sayTimer = setTimeout(() => step(0), delay);
  }

  /** Идёт ли разговор. */
  get saying(): boolean {
    return this.sayTimer !== undefined;
  }

  /**
   * Бирка вещи: заголовок («найдено»), имя вещи, поле (ключ и значение — «владелец: —»), штамп («не подтверждено»). null —
   * убрать. big — посреди кадра (лимбо), иначе — сбоку. Значение поля меняется отдельно (tagValue): Смотритель пишет по буквам.
   */
  tag(v: { head: string; name: string; key: string; value: string; stamp?: string; big?: boolean } | null): void {
    if (!v) {
      this.tagEl.classList.remove('is-on');
      return;
    }
    this.tagEl.querySelector('.vz-hud__tag-head')!.textContent = v.head;
    this.tagEl.querySelector('.vz-hud__tag-name')!.textContent = v.name;
    this.tagEl.querySelector('.vz-hud__tag-key')!.textContent = v.key;
    this.tagEl.querySelector('.vz-hud__tag-val')!.textContent = v.value;
    this.tagEl.querySelector('.vz-hud__tag-stamp')!.textContent = v.stamp ?? '';
    this.tagEl.classList.toggle('is-stamped', !!v.stamp);
    this.tagEl.classList.toggle('is-big', v.big === true);
    this.tagEl.classList.add('is-on');
  }

  /** Лимбо: бирка сюжета на экране — строки лимбо уходят, как при обрывке метаслоя. */
  setKoma(on: boolean): void {
    this.el.classList.toggle('is-koma', on);
  }

  /** Значение поля бирки (пишется по буквам) и, если есть, штамп. */
  tagValue(value: string, stamp?: string): void {
    this.tagEl.querySelector('.vz-hud__tag-val')!.textContent = value;
    if (stamp !== undefined) {
      this.tagEl.querySelector('.vz-hud__tag-stamp')!.textContent = stamp;
      this.tagEl.classList.toggle('is-stamped', stamp !== '');
    }
  }

  /** Строки лимбо посреди кадра; пустой список — убрать. */
  setLimbo(lines: readonly string[]): void {
    const key = lines.join('\n');
    if (key === this.lastLimbo) return;
    this.lastLimbo = key;
    // Последняя вспышка воспоминания ещё может гореть: лимбо её гасит, иначе строки лягут друг на друга.
    if (lines.length > 0) {
      this.flashEl.classList.remove('is-on');
      this.toastEl.classList.remove('is-on');
      this.flashPending = null;
    }
    this.limboEl.replaceChildren();
    for (const l of lines) {
      const row = document.createElement('div');
      row.textContent = l;
      this.limboEl.append(row);
    }
    this.limboEl.classList.toggle('is-on', lines.length > 0);
  }

  /** Рамка видоискателя вокруг предмета или приметы под рукой: x, y — доли кадра. */
  setMarker(x: number, y: number, visible: boolean, locked = false): void {
    this.mark.classList.toggle('is-on', visible);
    if (!visible) return;
    this.mark.classList.toggle('is-locked', locked);
    this.mark.style.left = `${(x * 100).toFixed(2)}%`;
    this.mark.style.top = `${(y * 100).toFixed(2)}%`;
  }

  setFps(text: string): void {
    this.fps.textContent = text;
  }

  setVisible(on: boolean): void {
    this.el.classList.toggle('is-hidden', !on);
  }
}
