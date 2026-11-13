/**
 * Отладочный API window.__vz. Ставится и в боевой сборке: смоук в Chromium гоняет именно её.
 * Симуляцию можно заморозить и шагать вручную — так тесты не зависят от скорости машины.
 */
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
  /** Цели вылазки: тип, ярус, выполнена ли, где находится. */
  goals(): Array<Record<string, unknown>>;
  /** Предметы уровня. */
  items(): Array<Record<string, unknown>>;
  /** Встать перед предметом лицом к нему. */
  gotoItem(id: number): boolean;
  /** Встать перед целью вылазки (предметом или приметой) лицом к ней. */
  gotoGoal(index: number): boolean;
  /** Встать у лестницы на выход. */
  gotoExit(): void;
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
  /** Нарисовать кадр и вернуть его яркость сеткой 32×18, строка 0 — верхняя. */
  probe(): number[];
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
    goals: () => {
      const srt = game().sortie;
      if (!srt) return [];
      return srt.objectives.map((o) => {
        const it = o.type === 'take' ? srt.pop.items[o.item!]! : null;
        const p = it ?? o.landmark!;
        return { id: o.id, type: o.type, tier: o.tier, done: srt.done.has(o.id), what: it ? it.find : o.landmark!.id, pos: [p.x, p.y, p.z] };
      });
    },
    items: () => {
      const srt = game().sortie;
      return srt ? srt.pop.items.map((i) => ({ id: i.id, type: i.type, find: i.find ?? null, tier: i.tier, taken: srt.taken.has(i.id), pos: [i.x, i.y, i.z] })) : [];
    },
    gotoItem: (id) => {
      const srt = game().sortie;
      const it = srt?.pop.items[id];
      if (!it) return false;
      // Встаём в метре от предмета: пробуем подойти с разных сторон, пока он не окажется под рукой.
      // Предмет может лежать на столе посреди клетки — тогда контроллер вытолкнет игрока из стола,
      // поэтому целимся уже после того, как игрок встал.
      const floor = -it.tier * 4.5;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        game().teleport(it.x + Math.cos(a) * 1.0, floor, it.z + Math.sin(a) * 1.0);
        app.advance(emptyInput(), 2, 1, STEP);
        game().aimAt(it.x, it.y, it.z);
        app.advance(emptyInput(), 2, 1, STEP);
        const tg = srt.target;
        if (tg?.kind === 'item' && tg.item.id === id) return true;
      }
      return false;
    },
    gotoGoal: (index) => {
      const o = game().sortie?.objectives[index];
      if (!o) return false;
      if (o.type === 'take') return api.gotoItem(o.item!);
      const idx = app.level.landmarks.filter((m) => m.id === o.landmark!.id).indexOf(o.landmark!);
      return api.gotoLandmark(o.landmark!.id, Math.max(0, idx), 2.4);
    },
    gotoExit: () => {
      const [x, y, z] = app.level.exit;
      game().teleport(x, y, z + 0.5, 0, 0);
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
    audio: () => app.sound.status(),
    showcase: () => showcaseItems(app.params.get('props')?.split(',') ?? null),
    mute: (on) => app.setMuted(on),
  };
  window.__vz = api;
}
