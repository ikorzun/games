/**
 * Клавиатура и мышь. Клавиши читаются по физическому коду (KeyW…), поэтому WASD работает
 * на любой раскладке. Мышь захватывается по клику; потеря захвата ставит игру на паузу.
 * Движение мыши одновременно ведёт луч и кормит детектор тряски.
 */
import type { Lifecycle } from '../lifecycle';
import { emptyInput } from './input';
import type { InputFrame, InputSource } from './input';
import type { ShakeMeter } from './shake';

const SENS = 0.0021;
/** Сколько миллисекунд после захвата или потери мыши её движение не считается. */
export const LOCK_QUIET_MS = 250;
/**
 * Тихое окно действует только на события, созданные не раньше чем за минуту до его конца. Если у
 * браузера время событий мыши и pointerlockchange идёт по разным часам (бывало у старых версий),
 * сравнение бессмысленно — и пусть тогда окно не сработает вовсе, чем мышь перестанет вести луч.
 */
const QUIET_REACH_MS = 60000;

export class DesktopInput implements InputSource {
  private readonly keys = new Set<string>();
  private lookYaw = 0;
  private lookPitch = 0;
  private light = false;
  private pause = false;
  private actionPressed = false;
  private swap = false;
  private readonly off: Array<() => void> = [];
  /** Захват мыши недоступен (песочница iframe): ведём луч мышью с зажатой кнопкой. */
  private dragLook = false;
  private dragging = false;
  /** События мыши, созданные раньше этого момента (часы Event.timeStamp), не считаются: только что сменился захват. */
  private quietUntil = -Infinity;
  /** Захват мыши, каким мы видели его в последний раз. */
  private lockSeen = false;

  constructor(
    private readonly target: HTMLElement,
    private readonly shake: ShakeMeter,
    private readonly lifecycle: Lifecycle,
  ) {
    const on = <K extends keyof DocumentEventMap>(el: Document | HTMLElement | Window, type: K, fn: (e: DocumentEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      el.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    on(window, 'keydown', (e) => {
      if (e.repeat) return;
      if (this.lifecycle.paused) return;
      this.keys.add(e.code);
      if (e.code === 'KeyF') {
        this.light = true;
        // «Стукнуть ладонью»: каждое нажатие — толчок детектору тряски.
        this.shake.pushImpulse(0.3);
      }
      if (e.code === 'KeyP') this.pause = true;
      if (e.code === 'KeyE') this.actionPressed = true;
      if (e.code === 'KeyR') this.swap = true;
      if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    });
    on(window, 'keyup', (e) => this.keys.delete(e.code));
    on(window, 'blur', () => this.release());
    on(document, 'mousemove', (e) => {
      const locked = document.pointerLockElement === this.target;
      // Захват мог смениться, а событие о нём ещё не дошло: элемент захвата браузер выставляет раньше,
      // чем раздаёт pointerlockchange, и движение мыши успевает вклиниться между ними.
      if (locked !== this.lockSeen) this.lockChanged(locked, e.timeStamp);
      if (this.lifecycle.paused) return;
      if (!locked && !(this.dragLook && this.dragging)) return;
      // Захватывая мышь, браузер переносит курсор и может прислать это как «движение» на полэкрана.
      // Такое событие создано до захвата или в его момент, а дойти до страницы может заметно позже
      // (события мыши раздаются перед кадром), поэтому сверяем время создания события, а не время
      // обработки. Величину движения не ограничиваем: резкий рывок мышью — это и есть тряска фонаря.
      const toQuietEnd = this.quietUntil - e.timeStamp;
      if (toQuietEnd > 0 && toQuietEnd < QUIET_REACH_MS) return;
      this.lookYaw -= e.movementX * SENS;
      this.lookPitch -= e.movementY * SENS;
      this.shake.pushMotion(e.movementX, e.movementY);
    });
    on(this.target, 'mousedown', () => {
      this.dragging = true;
      this.capture();
    });
    on(window, 'mouseup', () => {
      this.dragging = false;
    });
    on(document, 'pointerlockchange', (e) => {
      const locked = document.pointerLockElement === this.target;
      this.lockChanged(locked, e.timeStamp);
      // Захват потерян во время игры (Esc, переключение окна) — пауза.
      if (!locked && !this.dragLook) this.lifecycle.set('pointer', true);
    });
    on(document, 'pointerlockerror', () => {
      this.dragLook = true;
    });
  }

  /** Захват мыши сменился (ts — время события, по которому мы это узнали): начать тихое окно. */
  private lockChanged(locked: boolean, ts: number): void {
    this.lockSeen = locked;
    this.quietUntil = ts + LOCK_QUIET_MS;
  }

  /** Захватить мышь. Вызывать из обработчика клика (нужен жест пользователя). */
  capture(): void {
    if (this.dragLook || document.pointerLockElement === this.target) return;
    try {
      const p = this.target.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {
        this.dragLook = true;
      });
    } catch {
      this.dragLook = true;
    }
  }

  /** Отпустить мышь (пауза, реклама). */
  uncapture(): void {
    if (document.pointerLockElement === this.target) document.exitPointerLock();
  }

  poll(): InputFrame {
    const f = emptyInput();
    const k = this.keys;
    const x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const z = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const len = Math.hypot(x, z) || 1;
    f.moveX = x / len;
    f.moveZ = z / len;
    f.run = k.has('ShiftLeft') || k.has('ShiftRight');
    f.action = k.has('KeyE');
    f.actionPressed = this.actionPressed;
    f.swap = this.swap;
    f.showGoals = k.has('Tab');
    f.lookYaw = this.lookYaw;
    f.lookPitch = this.lookPitch;
    f.light = this.light;
    f.pause = this.pause;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.light = false;
    this.pause = false;
    this.actionPressed = false;
    this.swap = false;
    return f;
  }

  release(): void {
    this.keys.clear();
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.light = false;
    this.actionPressed = false;
    this.swap = false;
    this.dragging = false;
  }

  dispose(): void {
    for (const fn of this.off) fn();
    this.off.length = 0;
  }
}
