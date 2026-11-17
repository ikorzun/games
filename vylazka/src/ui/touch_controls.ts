/**
 * Тач-управление. Коснулся и отпустил — шаг вперёд; держишь палец — идёшь вперёд; ведёшь пальцем —
 * в левой половине экрана это стик ходьбы (появляется под пальцем), в правой — луч. Что значит
 * каждое касание, решает player/touch_gestures.ts; здесь — экран: стик, отметка удержания, кнопки.
 * Кнопка фонаря (слова партнёра 17.11 08:42): палец держат на кнопке — фонарь заряжается, кольцо заряда вокруг кнопки
 * становится больше, чтобы его было видно из-под пальца; полный заряд — вспышка и обычный свет (systems/flashlight.ts).
 * Короткий тап — выключатель (слова партнёра 10:04: «Тап на фонарик должен его и гасить и зажигать»; 09:23: «свайп
 * не нужен»). Тап только щёлкает выключателем, не трясёт и не заряжает: от тапов-тряски «все сильно перемешивается»
 * (08:42) — теперь оживляет заглохший только удержание.
 */
import { t } from '../core/i18n';
import { emptyInput } from '../player/input';
import type { InputFrame, InputSource } from '../player/input';
import { TouchGestures } from '../player/touch_gestures';

/** Палец на кнопке фонаря: где сел, где сейчас и когда. Остальные касания ведёт TouchGestures. */
export interface LightPointer {
  x0: number;
  y0: number;
  x: number;
  y: number;
  t0: number;
  /** Палец уехал с места раньше, чем стал удержанием: это протяжка, а не зарядка — до конца касания (нашёл куратор). */
  slid?: boolean;
}

/**
 * Тап по кнопке фонаря — включить или погасить: палец отпущен быстрее чем за ms миллисекунд и почти не сдвинулся
 * (меньше slop пикселей CSS). Считается по отпусканию: иначе каждое удержание начиналось бы со щелчка.
 */
export const TAP = { ms: 250, slop: 14 } as const;
/**
 * Удержание — зарядка: палец на кнопке дольше TAP.ms и почти на месте. Пока не прошло TAP.ms, неизвестно, тап это
 * или удержание, — кольцо не растёт и заряд не идёт. Уехавший дальше slop в первые grace мс — не удержание; после
 * grace палец может немного ползти — держать долго ровно трудно.
 */
export const HOLD = { slop: 30, grace: 600 } as const;

const moved = (p: LightPointer): number => Math.hypot(p.x - p.x0, p.y - p.y0);

/** Что значит палец на кнопке фонаря сейчас: держат (зарядка) или нет. Чистая функция — проверяется тестами. */
export function lightHeld(p: LightPointer, now: number): boolean {
  return !p.slid && now - p.t0 >= TAP.ms && (moved(p) < HOLD.slop || now - p.t0 > HOLD.grace);
}

/** Отметить протяжку: палец ушёл дальше slop, пока ещё не стал удержанием. */
export function markSlid(p: LightPointer, now: number): void {
  if (!p.slid && now - p.t0 <= HOLD.grace && moved(p) >= HOLD.slop) p.slid = true;
}

/** Отпущенный палец был тапом: коротко и на месте. */
export function lightTapped(p: LightPointer, now: number): boolean {
  return now - p.t0 < TAP.ms && moved(p) < TAP.slop;
}

export class TouchControls implements InputSource {
  readonly el: HTMLElement;
  private readonly stickBase: HTMLElement;
  private readonly stickKnob: HTMLElement;
  /** Кольцо под пальцем, который идёт удержанием. */
  private readonly holdMark: HTMLElement;
  private readonly lightBtn: HTMLButtonElement;
  private lastCharge = -1;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly gestures = new TouchGestures();
  private readonly lightPointers = new Map<number, LightPointer>();
  private tap = false;
  private pause = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'vz-touch';
    this.stickBase = document.createElement('div');
    this.stickBase.className = 'vz-touch__stick';
    this.stickKnob = document.createElement('div');
    this.stickKnob.className = 'vz-touch__knob';
    this.stickBase.append(this.stickKnob);
    this.holdMark = document.createElement('div');
    this.holdMark.className = 'vz-touch__hold';
    this.lightBtn = document.createElement('button');
    this.lightBtn.type = 'button';
    this.lightBtn.className = 'vz-touch__btn vz-touch__btn--light';
    // Значок фонаря: корпус, раструб и три луча.
    this.lightBtn.innerHTML =
      '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M5 19h15l8-6h5v22h-5l-8-6H5z" fill="currentColor"/>' +
      '<path d="M38 15l5-3M39 24h6M38 33l5 3" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>';
    this.pauseBtn = document.createElement('button');
    this.pauseBtn.type = 'button';
    this.pauseBtn.className = 'vz-touch__btn vz-touch__btn--pause';
    // Кнопок действия нет: игрок только ходит, смотрит и светит.
    this.el.append(this.stickBase, this.holdMark, this.lightBtn, this.pauseBtn);
    parent.append(this.el);
    this.relabel();

    this.el.addEventListener('pointerdown', (e) => this.down(e));
    this.el.addEventListener('pointermove', (e) => this.move(e));
    const up = (e: PointerEvent): void => this.up(e);
    this.el.addEventListener('pointerup', up);
    this.el.addEventListener('pointercancel', up);
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.pauseBtn.addEventListener('click', () => {
      this.pause = true;
    });
  }

  relabel(): void {
    this.lightBtn.setAttribute('aria-label', t('touch.light'));
    this.pauseBtn.setAttribute('aria-label', t('touch.pause'));
  }

  /** Позвать к кнопке фонаря: он заглох — держите на ней палец. */
  setShakePrompt(on: boolean): void {
    this.lightBtn.classList.toggle('is-dead', on);
  }

  /**
   * Зарядка и вспышка на кнопке: пока заряжают — кольцо светлое и дышит; вспышка полного заряда (flash 1 → 0 за
   * секунду) — кнопка на миг загорается вместе с лучом.
   */
  setCrank(charging: boolean, flash: number): void {
    this.lightBtn.classList.toggle('is-charging', charging);
    this.lightBtn.classList.toggle('is-flash', flash > 0);
    this.lightBtn.style.setProperty('--vz-flash', flash > 0 ? flash.toFixed(2) : '0');
  }

  /** Спрятать кнопку фонаря: там, где фонаря нет (офис), нажимать нечего. */
  setLightHidden(on: boolean): void {
    this.lightBtn.hidden = on;
  }

  setLit(on: boolean): void {
    this.lightBtn.classList.toggle('is-lit', on);
  }

  /**
   * Заряд фонаря (0..1) — обводкой вокруг кнопки фонаря (слова партнёра 17.11 08:19): дуга кольца — доля заряда,
   * на последней четверти — красная. Пока палец на кнопке, кольцо больше (класс is-held).
   */
  setCharge(charge: number): void {
    const pct = Math.max(0, Math.min(100, Math.round(charge * 100)));
    if (pct === this.lastCharge) return;
    this.lastCharge = pct;
    this.lightBtn.style.setProperty('--vz-charge', String(pct));
    this.lightBtn.classList.toggle('is-low', pct <= 25);
  }

  private down(e: PointerEvent): void {
    if (e.target === this.pauseBtn) return;
    e.preventDefault();
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* указатель уже отпущен */
    }
    if (e.target === this.lightBtn) {
      this.lightPointers.set(e.pointerId, { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now() });
      return;
    }
    this.gestures.down(e.pointerId, e.clientX, e.clientY, performance.now(), e.clientX < this.el.clientWidth / 2);
  }

  private move(e: PointerEvent): void {
    const p = this.lightPointers.get(e.pointerId);
    if (p) {
      p.x = e.clientX;
      p.y = e.clientY;
      markSlid(p, performance.now());
      return;
    }
    this.gestures.move(e.pointerId, e.clientX, e.clientY, performance.now());
  }

  private up(e: PointerEvent): void {
    const p = this.lightPointers.get(e.pointerId);
    if (p) {
      this.lightPointers.delete(e.pointerId);
      p.x = e.clientX;
      p.y = e.clientY;
      // Тап — выключатель; удержание (зарядка) при отпускании ничего не делает.
      if (lightTapped(p, performance.now())) this.tap = true;
      return;
    }
    this.gestures.up(e.pointerId, performance.now());
  }

  poll(): InputFrame {
    const f = emptyInput();
    const g = this.gestures.poll(performance.now());
    f.moveX = g.moveX;
    f.moveZ = g.moveZ;
    f.run = g.run;
    f.lookYaw = g.lookYaw;
    f.lookPitch = g.lookPitch;
    const now = performance.now();
    for (const p of this.lightPointers.values()) if (lightHeld(p, now)) f.crank = true;
    f.light = this.tap;
    f.pause = this.pause;
    this.tap = false;
    this.pause = false;
    // Палец на кнопке — кольцо заряда больше: его видно из-под пальца.
    this.lightBtn.classList.toggle('is-held', f.crank);
    // Стик — под пальцем левой половины; кольцо — под пальцем, который идёт удержанием.
    this.stickBase.classList.toggle('is-on', g.stick !== null);
    if (g.stick) {
      this.stickBase.style.left = `${g.stick.x}px`;
      this.stickBase.style.top = `${g.stick.y}px`;
      this.stickKnob.style.transform = `translate(calc(-50% + ${g.stick.dx}px), calc(-50% + ${g.stick.dy}px))`;
    }
    this.stickBase.classList.toggle('is-walk', g.walking && g.stick !== null && g.hold === null);
    this.holdMark.classList.toggle('is-on', g.hold !== null);
    if (g.hold) {
      this.holdMark.style.left = `${g.hold.x}px`;
      this.holdMark.style.top = `${g.hold.y}px`;
    }
    return f;
  }

  release(): void {
    this.gestures.release();
    this.lightPointers.clear();
    this.tap = false;
    this.lightBtn.classList.remove('is-held');
    this.stickBase.classList.remove('is-on', 'is-walk');
    this.holdMark.classList.remove('is-on');
  }

  setVisible(on: boolean): void {
    this.el.classList.toggle('is-hidden', !on);
  }

  dispose(): void {
    this.el.remove();
  }
}
