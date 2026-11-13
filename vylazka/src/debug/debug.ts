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
  /** Сводка уровня: помещения, приметы, число мест для находок. */
  level(): Record<string, unknown>;
  /** Встать в помещении рядом с приметой (по её id и номеру среди одноимённых) лицом к ней. false — такой нет. */
  gotoLandmark(id: string, index?: number, distance?: number): boolean;
  /** Встать в центр клетки помещения. */
  gotoRoom(roomId: number, yawDeg?: number): boolean;
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
    level: () => {
      const l = app.level;
      return {
        seed: l.layout?.seed ?? null,
        rank: l.layout?.rank ?? null,
        tiers: l.layout?.tierCount ?? 1,
        chunks: l.chunks.length,
        triangles: l.chunks.reduce((n, c) => n + c.mesh.index.length / 3, 0),
        colliders: l.colliders.boxes.length,
        spots: l.spots.length,
        rooms: (l.layout?.rooms ?? []).map((r) => ({ id: r.id, type: r.type, tier: r.tier, cells: r.cells.length })),
        landmarks: l.landmarks.map((m) => ({ id: m.id, room: m.room, tier: m.tier })),
      };
    },
    gotoLandmark: (id, index = 0, distance = 2.2) => {
      const l = app.level;
      const m = l.landmarks.filter((x) => x.id === id)[index];
      if (!m) return false;
      // Встаём в узле того же помещения, ближайшем к нужной дистанции от приметы.
      const nodes = l.nav.filter((n) => n.room === m.room);
      let best = nodes[0];
      let bestErr = Infinity;
      for (const n of nodes) {
        const err = Math.abs(Math.hypot(n.x - m.x, n.z - m.z) - distance);
        if (err < bestErr) {
          bestErr = err;
          best = n;
        }
      }
      if (!best) return false;
      const dx = m.x - best.x;
      const dz = m.z - best.z;
      const d = Math.hypot(dx, dz) || 1;
      // Не дальше distance от приметы: из центра клетки подходим ближе по прямой.
      const k = Math.max(0, (d - distance) / d);
      const px = best.x + dx * k;
      const pz = best.z + dz * k;
      const feet = best.y;
      game().teleport(px, feet, pz, Math.atan2(-(m.x - px), -(m.z - pz)), Math.atan2(m.y - (feet + 1.42), Math.hypot(m.x - px, m.z - pz)));
      return true;
    },
    gotoRoom: (roomId, yawDeg = 0) => {
      const n = app.level.nav.find((x) => x.room === roomId);
      if (!n) return false;
      game().teleport(n.x, n.y, n.z, (yawDeg * Math.PI) / 180, 0);
      return true;
    },
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
