/**
 * Тач-управление: левая половина экрана — стик ходьбы (появляется под пальцем), правая — ведёт луч.
 * Кнопка фонаря: короткий тап — включить или выключить; если фонарь заглох — её быстро трут пальцем
 * (это основной жест тряски на телефоне), тап тоже считается ударом.
 */
import { t } from '../core/i18n';
import { emptyInput } from '../player/input';
import type { InputFrame, InputSource } from '../player/input';
import { TOUCH_SCALE } from '../player/shake';
import type { ShakeMeter } from '../player/shake';

const LOOK_SENS = 0.0052;
const STICK_R = 54;

interface Pointer {
  role: 'stick' | 'look' | 'light' | 'act';
  x0: number;
  y0: number;
  x: number;
  y: number;
  t0: number;
  travel: number;
}

export class TouchControls implements InputSource {
  readonly el: HTMLElement;
  private readonly stickBase: HTMLElement;
  private readonly stickKnob: HTMLElement;
  private readonly lightBtn: HTMLButtonElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly actBtn: HTMLButtonElement;
  private readonly goalsBtn: HTMLButtonElement;
  private action = false;
  private actionPressed = false;
  private goalsUntil = 0;
  private readonly pointers = new Map<number, Pointer>();
  private moveX = 0;
  private moveZ = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private light = false;
  private pause = false;

  constructor(
    parent: HTMLElement,
    private readonly shake: ShakeMeter,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'vz-touch';
    this.stickBase = document.createElement('div');
    this.stickBase.className = 'vz-touch__stick';
    this.stickKnob = document.createElement('div');
    this.stickKnob.className = 'vz-touch__knob';
    this.stickBase.append(this.stickKnob);
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
    this.actBtn = document.createElement('button');
    this.actBtn.type = 'button';
    this.actBtn.className = 'vz-touch__btn vz-touch__btn--act';
    // Значок действия: рамка видоискателя с точкой.
    this.actBtn.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 16V8h8M32 8h8v8M40 32v8h-8M16 40H8v-8" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="24" cy="24" r="5" fill="currentColor"/></svg>';
    this.actBtn.hidden = true;
    this.goalsBtn = document.createElement('button');
    this.goalsBtn.type = 'button';
    this.goalsBtn.className = 'vz-touch__btn vz-touch__btn--goals';
    this.goalsBtn.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 14h4M22 14h14M12 24h4M22 24h14M12 34h4M22 34h14" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>';
    this.el.append(this.stickBase, this.lightBtn, this.actBtn, this.pauseBtn, this.goalsBtn);
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
    this.goalsBtn.addEventListener('click', () => {
      // Список целей показывается на несколько секунд.
      this.goalsUntil = performance.now() + 4000;
    });
  }

  relabel(): void {
    this.lightBtn.setAttribute('aria-label', t('touch.light'));
    this.pauseBtn.setAttribute('aria-label', t('touch.pause'));
    this.actBtn.setAttribute('aria-label', t('touch.act'));
    this.goalsBtn.setAttribute('aria-label', t('touch.goals'));
  }

  /** Подсветить кнопку фонаря, когда его надо трясти; progress 0..1. */
  setShakePrompt(on: boolean, progress: number): void {
    this.lightBtn.classList.toggle('is-dead', on);
    this.lightBtn.style.setProperty('--vz-progress', String(Math.round(progress * 100)));
  }

  setLit(on: boolean): void {
    this.lightBtn.classList.toggle('is-lit', on);
  }

  /** Кнопка действия видна, только когда есть что взять, снять или куда подняться; progress — доля удержания. */
  setAction(on: boolean, progress: number): void {
    if (this.actBtn.hidden === on) this.actBtn.hidden = !on;
    this.actBtn.style.setProperty('--vz-progress', String(Math.round(progress * 100)));
    if (!on) this.action = false;
  }

  private down(e: PointerEvent): void {
    if (e.target === this.pauseBtn || e.target === this.goalsBtn) return;
    e.preventDefault();
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* указатель уже отпущен */
    }
    const onLight = e.target === this.lightBtn;
    const onAct = e.target === this.actBtn;
    const left = e.clientX < this.el.clientWidth / 2;
    const hasStick = [...this.pointers.values()].some((p) => p.role === 'stick');
    const role: Pointer['role'] = onLight ? 'light' : onAct ? 'act' : left && !hasStick ? 'stick' : 'look';
    if (onAct) {
      this.action = true;
      this.actionPressed = true;
    }
    this.pointers.set(e.pointerId, { role, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), travel: 0 });
    if (role === 'stick') {
      this.stickBase.style.left = `${e.clientX}px`;
      this.stickBase.style.top = `${e.clientY}px`;
      this.stickBase.classList.add('is-on');
      this.stickKnob.style.transform = 'translate(-50%, -50%)';
    }
  }

  private move(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    p.travel += Math.abs(dx) + Math.abs(dy);
    if (p.role === 'look') {
      this.lookYaw -= dx * LOOK_SENS;
      this.lookPitch -= dy * LOOK_SENS;
    } else if (p.role === 'light') {
      this.shake.pushMotion(dx, dy, TOUCH_SCALE);
    } else if (p.role === 'stick') {
      let sx = p.x - p.x0;
      let sy = p.y - p.y0;
      const len = Math.hypot(sx, sy);
      if (len > STICK_R) {
        sx *= STICK_R / len;
        sy *= STICK_R / len;
      }
      this.moveX = sx / STICK_R;
      this.moveZ = -sy / STICK_R;
      this.stickKnob.style.transform = `translate(calc(-50% + ${sx}px), calc(-50% + ${sy}px))`;
    }
  }

  private up(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (p.role === 'stick') {
      this.moveX = 0;
      this.moveZ = 0;
      this.stickBase.classList.remove('is-on');
    } else if (p.role === 'act') {
      this.action = false;
    } else if (p.role === 'light') {
      // Короткое касание без движения — нажатие кнопки; протяжка — тряска.
      if (p.travel < 14 && performance.now() - p.t0 < 400) {
        this.light = true;
        this.shake.pushImpulse(0.3);
      }
    }
  }

  poll(): InputFrame {
    const f = emptyInput();
    const len = Math.hypot(this.moveX, this.moveZ);
    // Мёртвая зона в центре; стик, отведённый до упора, — бег.
    if (len > 0.14) {
      f.moveX = this.moveX;
      f.moveZ = this.moveZ;
      f.run = len > 0.93;
    }
    f.lookYaw = this.lookYaw;
    f.lookPitch = this.lookPitch;
    f.light = this.light;
    f.pause = this.pause;
    f.action = this.action;
    f.actionPressed = this.actionPressed;
    f.showGoals = performance.now() < this.goalsUntil;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.light = false;
    this.pause = false;
    this.actionPressed = false;
    return f;
  }

  release(): void {
    this.pointers.clear();
    this.moveX = 0;
    this.moveZ = 0;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.light = false;
    this.action = false;
    this.actionPressed = false;
    this.stickBase.classList.remove('is-on');
  }

  setVisible(on: boolean): void {
    this.el.classList.toggle('is-hidden', !on);
  }

  dispose(): void {
    this.el.remove();
  }
}
