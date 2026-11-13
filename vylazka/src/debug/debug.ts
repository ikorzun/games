/**
 * Отладочный API window.__vz. Ставится и в боевой сборке: смоук в Chromium гоняет именно её.
 * Симуляцию можно заморозить и шагать вручную — так тесты не зависят от скорости машины.
 */
import { normalizeLang } from '../core/i18n';
import type { App } from '../app';
import { STEP } from '../game';
import { emptyInput } from '../player/input';
import type { InputFrame } from '../player/input';
import type { Quality } from '../render/renderer';

export interface VzDebugApi {
  /** Игра загрузилась и показала первый кадр. */
  ready(): boolean;
  state(): Record<string, unknown>;
  /** Остановить автоматическую симуляцию (кадры рисуются только по render()). */
  freeze(on: boolean): void;
  /** Сделать n шагов симуляции с заданным вводом и нарисовать кадр. */
  step(n: number, input?: Partial<InputFrame>): Record<string, unknown>;
  /**
   * n оборотов главного цикла при замороженной симуляции: настоящий ввод с устройств → поворот луча →
   * один шаг → кадр. Так проверяется путь ввода (клавиши, тач) без зависимости от частоты кадров.
   */
  tick(n: number): Record<string, unknown>;
  render(): void;
  teleport(x: number, y: number, z: number, yaw?: number, pitch?: number): void;
  look(yaw: number, pitch: number): void;
  /** Заглушить фонарь. */
  fail(): void;
  /** Трясти фонарь с уровнем level в течение seconds игрового времени. */
  shake(level: number, seconds: number): Record<string, unknown>;
  toggleLight(): void;
  quality(q?: Quality): Quality;
  info(): Record<string, unknown>;
  start(): void;
  pause(on: boolean): void;
  lang(code?: string): string;
  loseContext(ms?: number): void;
  /** Включить или выключить тень фонаря (для сравнения кадров). */
  shadows(on: boolean): void;
  /** Нарисовать кадр и вернуть его яркость сеткой 32×18, строка 0 — верхняя. */
  probe(): number[];
  missingKeys(): string[];
}

declare global {
  interface Window {
    __vz?: VzDebugApi;
  }
}

export function installDebug(app: App): void {
  const game = (): App['game'] => app.game;
  const api: VzDebugApi = {
    ready: () => app.ready,
    state: () => ({ ...game().snapshot(), paused: app.lifecycle.paused, pauseReasons: app.lifecycle.list(), overlay: app.overlay.mode, platform: app.platform.id, touch: app.touchMode, motion: app.motion.state }),
    freeze: (on) => {
      app.frozen = on;
    },
    step: (n, input) => {
      const f = { ...emptyInput(), ...input };
      if (input?.lookYaw || input?.lookPitch) game().look(f.lookYaw, f.lookPitch);
      for (let i = 0; i < n; i++) {
        app.handleEvents(game().step(STEP, f));
        f.light = false;
        game().draw(1, STEP);
      }
      app.updateHud();
      return api.state();
    },
    tick: (n) => {
      for (let i = 0; i < n; i++) {
        const input = app.pollInput();
        if (input.pause) {
          app.lifecycle.set('user', true);
          break;
        }
        game().look(input.lookYaw, input.lookPitch);
        app.handleEvents(game().step(STEP, input));
        game().draw(1, STEP);
      }
      app.updateHud();
      return api.state();
    },
    render: () => game().draw(1, STEP),
    teleport: (x, y, z, yaw, pitch) => game().teleport(x, y, z, yaw, pitch),
    look: (yaw, pitch) => game().look(yaw, pitch),
    fail: () => game().light.forceFail(),
    shake: (level, seconds) => {
      const steps = Math.round(seconds / STEP);
      const f = emptyInput();
      for (let i = 0; i < steps; i++) {
        // Удерживаем уровень: детектор сам затухает между толчками.
        game().shake.level = Math.max(game().shake.level, level);
        app.handleEvents(game().step(STEP, f));
        game().draw(1, STEP);
      }
      app.updateHud();
      return api.state();
    },
    toggleLight: () => game().light.toggle(),
    quality: (q) => {
      if (q) app.setQuality(q);
      return game().renderer.quality;
    },
    info: () => ({ ...game().renderer.info(), fps: app.fps }),
    start: () => app.start(),
    pause: (on) => app.lifecycle.set('user', on),
    lang: (code) => {
      if (code) app.setLang(normalizeLang(code));
      return app.i18n.lang;
    },
    loseContext: (ms) => game().renderer.debugLoseContext(ms),
    shadows: (on) => {
      game().renderer.debugShadowsOff = !on;
    },
    probe: () => {
      game().draw(1, 0);
      return game().renderer.probe();
    },
    missingKeys: () => [...app.i18n.missing],
  };
  window.__vz = api;
}
