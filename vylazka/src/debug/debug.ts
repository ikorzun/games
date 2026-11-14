/**
 * Отладочный API window.__vz. Ставится и в боевой сборке: смоук в Chromium гоняет именно её.
 * Симуляцию можно заморозить и шагать вручную — так тесты не зависят от скорости машины.
 */
import type { RoomFx } from '../game';
import type { JumpStyle, JumpTarget } from '../systems/jumps';
import { showcaseItems } from '../world/showcase';
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
  /** Вещи сна: что стоит, что с ним станет под взглядом, в каком оно состоянии. */
  things(): Array<Record<string, unknown>>;
  /** Встать перед вещью лицом к ней. */
  gotoThing(id: number, distance?: number): boolean;
  /** Почему вещь видна или не видна: расстояние, попадание в луч (dot против нужного need), путь луча до преграды. */
  sees(id: number): Record<string, number> | null;
  /** Искомое воспоминание: его id, вещь и где она (null — сейчас ничего не ищут). */
  memory(): { id: string; thing: number; pos: number[] } | null;
  /** Поторопить следующее воспоминание: оно придёт на ближайшем шаге. */
  reveal(): void;
  /** Встать перед вещью искомого воспоминания. */
  gotoMemory(): boolean;
  /** Начать скачок: в карманное пространство ('void', 'meadow', 'dollhouse'), в другое место ('elsewhere') или в лимбо. */
  jump(to: JumpTarget, style?: JumpStyle): boolean;
  /** Встать в помещение с особенностью: 'strobe', 'dark', 'wire', 'thin'. */
  gotoFx(fx: RoomFx): boolean;
  /** Считать всё вспомненным: место рассыплется, игрок попадёт в лимбо. */
  finish(): void;
  /** Вспышки помягче (как в настройке игрока). */
  calmFlash(on: boolean): void;
  /** Зоны среды и обвалы уровня. */
  hazards(): Record<string, unknown>;
  /** Выпустить рой в hops клетках от игрока (сразу настороже) либо показать его фигурой без охоты. */
  swarm(cmd: 'release' | 'appear' | 'sleep', hops?: number): boolean;
  /** Поставить фазу режиссёра страха: 0 — ложные события, 1 — рой мелькает, 2 — охотится. */
  phase(n: 0 | 1 | 2): void;
  /** Лестницы уровня и комнаты-аномалии. */
  anomalies(): Record<string, unknown>;
  /** Выключить рой, режиссёра и аномалии: для проверок, которым они мешают. */
  calm(on: boolean): void;
  /** Включить или выключить тень фонаря (для сравнения кадров). */
  shadows(on: boolean): void;
  /** Облако точек вкл/выкл: выкл — мир рисуется сплошными поверхностями (для сравнения кадров). */
  scan(on: boolean): void;
  /** Нарисовать кадр и вернуть его яркость сеткой 32×18, строка 0 — верхняя. */
  probe(): number[];
  /** Средний цвет кадра (0..255) и доля красных точек: виден ли красная сетка. */
  probeColor(): { r: number; g: number; b: number; red: number; dark: number };
  missingKeys(): string[];
  /** Состояние звука: загружено, что просили и что прозвучало, какие петли идут. */
  /** Предметы витрины (?level=show) по порядку расстановки: имя, крепление, высота. */
  showcase(): { name: string; mount: string; h: number; y: number }[];
  audio(): ReturnType<import('../audio/engine').AudioEngine['status']>;
  mute(on: boolean): void;
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
    state: () => ({
      ...game().snapshot(),
      paused: app.lifecycle.paused,
      pauseReasons: app.lifecycle.list(),
      overlay: app.overlay.mode,
      screen: app.screen,
      seed: app.seed,
      rank: app.rank,
      profile: { sorties: app.profile.sorties, successes: app.profile.successes, archive: [...app.profile.archive] },
      platform: app.platform.id,
      touch: app.touchMode,
      drag: app.dragMode,
      motion: app.motion.state,
    }),
    freeze: (on) => {
      app.frozen = on;
    },
    step: (n, input) => {
      const f = { ...emptyInput(), ...input };
      if (input?.lookYaw || input?.lookPitch) game().look(f.lookYaw, f.lookPitch);
      // Кадр на экран — только после последнего шага: остальные считают камеру и свет без видеокарты.
      for (let i = 0; i < n; i++) app.advance(f, 1, 1, STEP, i === n - 1);
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
        app.advance(input, 1, 1, STEP, i === n - 1);
      }
      return api.state();
    },
    render: () => game().draw(1, STEP),
    teleport: (x, y, z, yaw, pitch) => game().teleport(x, y, z, yaw, pitch),
    look: (yaw, pitch) => game().look(yaw, pitch),
    fail: () => game().light.forceFail(),
    shake: (level, seconds) => {
      const steps = Math.round(seconds / STEP);
      for (let i = 0; i < steps; i++) {
        // Удерживаем уровень: детектор сам затухает между толчками.
        game().shake.level = Math.max(game().shake.level, level);
        app.advance(emptyInput(), 1, 1, STEP, i === steps - 1);
      }
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
      game().debugHome();
      // Пробуем встать в узлах помещения приметы и соседних с ним: подходим на нужную дистанцию,
      // даём контроллеру вытолкнуть игрока из мебели и только потом целимся.
      const own = l.nav.filter((n) => n.room === m.room);
      const near = own.flatMap((n) => n.links.map((i) => l.nav[i]!)).filter((n) => n.room !== m.room);
      const nodes = [...own, ...near].sort((a, b) => Math.abs(Math.hypot(a.x - m.x, a.z - m.z) - distance) - Math.abs(Math.hypot(b.x - m.x, b.z - m.z) - distance));
      for (const n of nodes) {
        const dx = m.x - n.x;
        const dz = m.z - n.z;
        const d = Math.hypot(dx, dz) || 1;
        const k = Math.max(0, (d - distance) / d);
        game().teleport(n.x + dx * k, n.y, n.z + dz * k);
        app.advance(emptyInput(), 2, 1, STEP);
        game().aimAt(m.x, m.y, m.z);
        app.advance(emptyInput(), 2, 1, STEP);
        const st = game().snapshot() as { pos: number[]; beamDist: number };
        const dist = Math.hypot(m.x - st.pos[0]!, m.y - (st.pos[1]! + 1), m.z - st.pos[2]!);
        // Примета видна: луч доходит до неё, а не упирается в преграду раньше.
        if (dist > 0.6 && dist < 6 && st.beamDist >= dist - 1.2) return true;
      }
      return false;
    },
    things: () => game().things.list.map((t) => ({ id: t.id, kind: t.kind, state: t.state, fate: t.fate, memory: t.memory, gaze: t.gaze, scale: t.scale, dissolve: t.dissolve, pos: [...t.pos] })),
    gotoThing: (id, distance = 2.2) => {
      const g = game();
      const t = g.things.list.find((x) => x.id === id);
      if (!t) return false;
      const [x, y, z] = t.pos;
      const aimY = y + Math.max(0.2, t.radius * 0.6);
      const tryFrom = (px: number, py: number, pz: number): boolean => {
        g.teleport(px, py, pz);
        app.advance(emptyInput(), 2, 1, STEP);
        g.aimAt(x, aimY, z);
        app.advance(emptyInput(), 2, 1, STEP);
        // Вещь видна так же строго, как это требует игра: в луче и не заслонена от камеры.
        const v = api.sees(id);
        return v !== null && v.d! > 0.4 && v.d! < 5.5 && v.dot! >= v.need! + 0.01 && v.los! >= v.d! - 0.45;
      };
      // Пол яруса (или карманного пространства) под вещью.
      const floor = Math.floor((y + 0.3) / 4.5) * 4.5;
      // Сначала вплотную с разных сторон, потом — с расстояния: вещь может стоять среди мебели.
      for (const r of [1.1, distance, 1.7, 3]) {
        for (let i = 0; i < 12; i++) {
          const a = (i * Math.PI) / 6;
          if (tryFrom(x + Math.cos(a) * r, floor, z + Math.sin(a) * r)) return true;
        }
      }
      return false;
    },
    sees: (id) => {
      const g = game();
      const t = g.things.list.find((x) => x.id === id);
      const st = g.snapshot() as { eye: number[]; lightDir: number[]; light: { intensity: number } };
      if (!t) return null;
      const target = [t.pos[0], t.pos[1] + Math.max(0.2, t.radius * 0.6), t.pos[2]];
      const dx = target[0]! - st.eye[0]!;
      const dy = target[1]! - st.eye[1]!;
      const dz = target[2]! - st.eye[2]!;
      const d = Math.hypot(dx, dy, dz);
      const los = g.colliders.raycast(st.eye[0]!, st.eye[1]!, st.eye[2]!, dx / d, dy / d, dz / d, d);
      return { d, dot: (dx * st.lightDir[0]! + dy * st.lightDir[1]! + dz * st.lightDir[2]!) / d, need: 0.972 - Math.min(0.12, (t.radius / d) * 0.45), los, light: st.light.intensity, radius: t.radius };
    },
    memory: () => {
      const m = game().session?.active;
      const t = game().things.list.find((x) => x.memory);
      return m && t ? { id: m.def.id, thing: t.id, pos: [...t.pos] } : null;
    },
    reveal: () => {
      game().session?.rush();
    },
    gotoMemory: () => {
      const t = game().things.list.find((x) => x.memory);
      return t ? api.gotoThing(t.id, 2.2) : false;
    },
    jump: (to, style = 'cut') => game().beginJump({ cause: 'gaze', style, to }, []),
    gotoFx: (fx) => {
      for (const [room, kind] of game().roomFx) if (kind === fx) return api.gotoRoom(room);
      return false;
    },
    finish: () => game().debugFinish(),
    calmFlash: (on) => {
      game().calmFlash = on;
    },
    hazards: () => ({
      zones: app.level.zones.map((z) => ({ kind: z.kind, tier: z.tier, center: [(z.minX + z.maxX) / 2, z.maxY, (z.minZ + z.maxZ) / 2] })),
      collapses: app.level.collapses.map((c) => ({ id: c.id, tier: c.tier, center: c.center })),
    }),
    swarm: (cmd, hops = 5) => {
      const g = game();
      const sw = g.swarm;
      if (!sw) return false;
      if (cmd === 'sleep') {
        sw.mode = 'dormant';
        sw.cohesion = 0;
        return true;
      }
      const n = sw.nodeAround(g.playerNode(), hops, hops);
      if (n < 0) return false;
      if (cmd === 'appear') sw.appear(n, 8);
      else {
        sw.activate(n);
        sw.alert(g.playerNode());
      }
      g.swarmBody.snap(sw.pos, sw.cohesion);
      return true;
    },
    phase: (n) => {
      const d = game().director;
      if (d) d.phase = n;
    },
    calm: (on) => {
      game().calm = on;
      if (on && game().swarm) {
        game().swarm!.mode = 'dormant';
        game().swarm!.cohesion = 0;
      }
    },
    anomalies: () => ({ stairs: app.level.stairs, variants: app.level.variants, state: game().anomalies?.state() ?? null }),
    gotoRoom: (roomId, yawDeg = 0) => {
      const n = app.level.nav.find((x) => x.room === roomId);
      if (!n) return false;
      // «Встать в помещение убежища» — значит быть в убежище, а не в карманном пространстве.
      game().debugHome();
      game().teleport(n.x, n.y, n.z, (yawDeg * Math.PI) / 180, 0);
      return true;
    },
    shadows: (on) => {
      game().renderer.debugShadowsOff = !on;
    },
    scan: (on) => game().renderer.debugScan(on),
    probe: () => {
      game().draw(1, 0);
      return game().renderer.probe();
    },
    probeColor: () => {
      game().draw(1, 0);
      return game().renderer.probeColor();
    },
    missingKeys: () => [...app.i18n.missing],
    audio: () => app.sound.status(),
    showcase: () => showcaseItems(app.params.get('props')?.split(',') ?? null),
    mute: (on) => app.setMuted(on),
  };
  window.__vz = api;
}
