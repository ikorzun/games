/**
 * Акселерометр телефона как необязательное усиление тряски. В iframe порталов датчик часто
 * запрещён, а на iOS нужен явный запрос по нажатию — поэтому на него нельзя рассчитывать:
 * основной жест на телефоне — тереть кнопку фонаря. Датчик считается рабочим только после
 * первого события с настоящими числами.
 */
import type { ShakeMeter } from './shake';

export type MotionState = 'off' | 'waiting' | 'active' | 'denied' | 'unsupported';

interface MotionPermissionApi {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
}

export class MotionSensor {
  state: MotionState = 'off';
  private last = 0;
  private readonly handler = (e: DeviceMotionEvent): void => this.onMotion(e);

  constructor(private readonly shake: ShakeMeter) {}

  /** Нужно ли спрашивать разрешение отдельной кнопкой (iOS). */
  static needsPermission(): boolean {
    return typeof DeviceMotionEvent !== 'undefined' && typeof (DeviceMotionEvent as unknown as MotionPermissionApi).requestPermission === 'function';
  }

  static supported(): boolean {
    return typeof DeviceMotionEvent !== 'undefined';
  }

  /** Включить датчик. На iOS вызывать только из обработчика нажатия. */
  async enable(): Promise<MotionState> {
    if (!MotionSensor.supported()) {
      this.state = 'unsupported';
      return this.state;
    }
    if (this.state === 'waiting' || this.state === 'active') return this.state;
    const api = DeviceMotionEvent as unknown as MotionPermissionApi;
    if (typeof api.requestPermission === 'function') {
      try {
        const res = await api.requestPermission();
        if (res !== 'granted') {
          this.state = 'denied';
          return this.state;
        }
      } catch {
        this.state = 'denied';
        return this.state;
      }
    }
    window.addEventListener('devicemotion', this.handler);
    this.state = 'waiting';
    return this.state;
  }

  disable(): void {
    window.removeEventListener('devicemotion', this.handler);
    if (this.state === 'waiting' || this.state === 'active') this.state = 'off';
  }

  private onMotion(e: DeviceMotionEvent): void {
    const now = performance.now();
    // Поле interval в разных браузерах в разных единицах — меряем время сами.
    const dt = this.last > 0 ? Math.min(0.1, Math.max(0.004, (now - this.last) / 1000)) : 0.016;
    this.last = now;
    const a = e.acceleration;
    if (a && a.x !== null && a.y !== null && a.z !== null) {
      this.state = 'active';
      this.shake.pushAccel(a.x, a.y, a.z, dt, false);
      return;
    }
    const g = e.accelerationIncludingGravity;
    if (g && g.x !== null && g.y !== null && g.z !== null) {
      this.state = 'active';
      this.shake.pushAccel(g.x, g.y, g.z, dt, true);
    }
  }
}
