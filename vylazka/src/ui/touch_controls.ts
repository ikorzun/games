/**
 * Тач-управление. Коснулся и отпустил — шаг вперёд; держишь палец — идёшь вперёд; ведёшь пальцем —
 * в левой половине экрана это стик ходьбы (появляется под пальцем), в правой — луч. Что значит
 * каждое касание, решает player/touch_gestures.ts; здесь — экран: стик, отметка удержания, кнопки.
 * Кнопка фонаря: короткий тап — включить или выключить; если фонарь заглох — её быстро трут пальцем
 * (это основной жест тряски на телефоне), тап тоже считается ударом.
 */
import { t } from '../core/i18n';
import { emptyInput } from '../player/input';
import type { InputFrame, InputSource } from '../player/input';
import { TOUCH_SCALE } from '../player/shake';
import type { ShakeMeter } from '../player/shake';
import { TouchGestures } from '../player/touch_gestures';

/** Палец на кнопке фонаря: тап или тряска. Остальные касания ведёт TouchGestures. */
interface LightPointer {
  x: number;
  y: number;
  t0: number;
  travel: number;
}

export class TouchControls implements InputSource {
  readonly el: HTMLElement;
  private readonly stickBase: HTMLElement;
  private readonly stickKnob: HTMLElement;
  /** Кольцо под пальцем, который идёт удержанием. */
  private readonly holdMark: HTMLElement;
  private readonly lightBtn: HTMLButtonElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly gestures = new TouchGestures();
  private readonly lightPointers = new Map<number, LightPointer>();
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

  /** Подсветить кнопку фонаря, когда его надо трясти; progress 0..1. */
  setShakePrompt(on: boolean, progress: number): void {
    this.lightBtn.classList.toggle('is-dead', on);
    this.lightBtn.style.setProperty('--vz-progress', String(Math.round(progress * 100)));
  }

  setLit(on: boolean): void {
    this.lightBtn.classList.toggle('is-lit', on);
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
      this.lightPointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t0: performance.now(), travel: 0 });
      return;
    }
    this.gestures.down(e.pointerId, e.clientX, e.clientY, performance.now(), e.clientX < this.el.clientWidth / 2);
  }

  private move(e: PointerEvent): void {
    const p = this.lightPointers.get(e.pointerId);
    if (p) {
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      p.travel += Math.abs(dx) + Math.abs(dy);
      this.shake.pushMotion(dx, dy, TOUCH_SCALE);
      return;
    }
    this.gestures.move(e.pointerId, e.clientX, e.clientY, performance.now());
  }

  private up(e: PointerEvent): void {
    const p = this.lightPointers.get(e.pointerId);
    if (p) {
      this.lightPointers.delete(e.pointerId);
      // Короткое касание без движения — нажатие кнопки; протяжка — тряска.
      if (p.travel < 14 && performance.now() - p.t0 < 400) {
        this.light = true;
        this.shake.pushImpulse(0.3);
      }
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
    f.light = this.light;
    f.pause = this.pause;
    this.light = false;
    this.pause = false;
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
    this.light = false;
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
