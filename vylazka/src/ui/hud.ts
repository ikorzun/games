/**
 * Надписи поверх кадра, как на записи с нагрудной камеры: REC и номер камеры слева, дата и время
 * справа; ниже — список целей, заряд фонаря, подсказки. Всё — DOM поверх canvas: читаемо при любом
 * разрешении рендера.
 */
import { t } from '../core/i18n';

const pad = (n: number): string => String(n).padStart(2, '0');

/** Дата и время записи: старт 13 ноября 2004, 23:41:07, дальше идут игровые секунды. */
export function recTimestamp(seconds: number): string {
  const start = 23 * 3600 + 41 * 60 + 7;
  const total = start + Math.floor(seconds);
  const day = 13 + Math.floor(total / 86400);
  const s = total % 86400;
  return `2004-11-${pad(day)} ${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export interface GoalLine {
  text: string;
  done: boolean;
}

export class Hud {
  readonly el: HTMLElement;
  private readonly rec: HTMLElement;
  private readonly cam: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly fps: HTMLElement;
  private readonly goals: HTMLElement;
  private readonly bat: HTMLElement;
  private readonly batFill: HTMLElement;
  private readonly batSpare: HTMLElement;
  private readonly act: HTMLElement;
  private readonly actText: HTMLElement;
  private readonly actBar: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly mark: HTMLElement;
  private lastClock = '';
  private lastHint = '';
  private lastPrompt = '';
  private lastGoals = '';
  private lastAct = '';
  private lastBat = '';
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'vz-hud';
    this.el.innerHTML =
      '<div class="vz-hud__top">' +
      '<div class="vz-hud__tl"><span class="vz-hud__dot"></span><span class="vz-hud__rec"></span><span class="vz-hud__cam"></span></div>' +
      '<div class="vz-hud__tr"><span class="vz-hud__clock"></span><span class="vz-hud__fps"></span></div>' +
      '</div>' +
      '<div class="vz-hud__goals"></div>' +
      '<div class="vz-hud__toast"></div>' +
      '<div class="vz-hud__mark"></div>' +
      '<div class="vz-hud__prompt"><span class="vz-hud__prompt-text"></span><span class="vz-hud__bar"><i></i></span></div>' +
      '<div class="vz-hud__act"><span class="vz-hud__act-text"></span><span class="vz-hud__bar"><i></i></span></div>' +
      '<div class="vz-hud__bat"><span class="vz-hud__bat-cell"><i></i></span><span class="vz-hud__bat-spare"></span></div>' +
      '<div class="vz-hud__hint"></div>';
    parent.append(this.el);
    const q = (sel: string): HTMLElement => this.el.querySelector(sel) as HTMLElement;
    this.rec = q('.vz-hud__rec');
    this.cam = q('.vz-hud__cam');
    this.clock = q('.vz-hud__clock');
    this.hint = q('.vz-hud__hint');
    this.prompt = q('.vz-hud__prompt-text');
    this.bar = q('.vz-hud__prompt .vz-hud__bar i');
    this.fps = q('.vz-hud__fps');
    this.goals = q('.vz-hud__goals');
    this.bat = q('.vz-hud__bat');
    this.batFill = q('.vz-hud__bat-cell i');
    this.batSpare = q('.vz-hud__bat-spare');
    this.act = q('.vz-hud__act');
    this.actText = q('.vz-hud__act-text');
    this.actBar = q('.vz-hud__act .vz-hud__bar i');
    this.toastEl = q('.vz-hud__toast');
    this.mark = q('.vz-hud__mark');
    this.relabel();
  }

  relabel(): void {
    this.rec.textContent = t('hud.rec');
    this.cam.textContent = t('hud.cam');
  }

  setTime(seconds: number): void {
    const s = recTimestamp(seconds);
    if (s !== this.lastClock) {
      this.lastClock = s;
      this.clock.textContent = s;
    }
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

  /** Заряд фонаря (0..1) и число запасных батареек. hidden — не показывать вовсе. */
  setBattery(charge: number, spares: number, hidden = false): void {
    const level = Math.max(0, Math.min(5, Math.ceil(charge * 5)));
    const key = `${hidden ? 'h' : ''}${level}:${spares}`;
    if (key === this.lastBat) return;
    this.lastBat = key;
    this.bat.classList.toggle('is-on', !hidden);
    this.bat.classList.toggle('is-low', level <= 1);
    this.batFill.style.width = `${level * 20}%`;
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

  /** Короткое сообщение вверху кадра на несколько секунд. */
  toast(text: string, ms = 3200): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('is-on');
    if (this.toastTimer !== undefined) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('is-on'), ms);
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
