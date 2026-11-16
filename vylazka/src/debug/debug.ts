/**
 * Отладочный API window.__vz. Ставится и в боевой сборке: смоук в Chromium гоняет именно её.
 * Симуляцию можно заморозить и шагать вручную — так тесты не зависят от скорости машины.
 */
import type { Decay } from '../systems/decay';
import type { RoomFx } from '../game';
import type { JumpStyle, JumpTarget } from '../systems/jumps';
import { showcaseItems } from '../world/showcase';
import { SIGN } from '../world/signs';
import { normalizeLang } from '../core/i18n';
import type { App } from '../app';
import { STEP } from '../game';
import { emptyInput } from '../player/input';
import type { InputFrame } from '../player/input';
import type { Quality } from '../render/renderer';
import { FIGURE_MATERIALS } from '../world/figures';
import type { FigureMaterial, FigureSpec } from '../world/figures';
import { POSES } from '../world/props_people';
import type { Pose } from '../world/props_people';

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
  /** Облако точек: сколько точек отдано видеокарте и сколько из них не спрятано отбором по расстоянию. */
  cloudUsage(): { drawn: number; shown: number; cells: number };
  /** Пыль тронутых вещей: сколько облаков живо и сколько в них точек. */
  dust(): { clouds: number; points: number };
  /** Проросшие грибы: место, род и насколько выросли (systems/spores.ts). */
  spores(): { pos: number[]; kind: string; grow: number }[];
  /** Стирание места: стёртость сейчас, с какой начат круг и все кривые (systems/decay.ts). */
  wear(): { wear: number; base: number; decay: Decay; forms: Record<string, number> };
  /** Ход времени в зале ожидания (systems/flow.ts); null — в этом мире время обычное. */
  /**
   * Давление помимо Осыпи (systems/pressure.ts): состояние; с видом — начать событие в помещении, где
   * стоит игрок (ok — началось).
   */
  /** Птицы (systems/birds.ts): позы стаи в то время места, которое видит игрок, и состояние тех, кого можно спугнуть. */
  birds(): { flock: { pos: number[]; flying: boolean; open: number }[]; leavers: { state: string; at: number[] }[] };
  pressure(kind?: 'collapse' | 'squeeze'): { ok: boolean; rooms: number[]; here: boolean; active: { kind: string; phase: string; room: number; radius: number; ceil: number; origin: number[]; exits: number[][] } | null; falling: number; count: number; camDrop: number } | null;
  flow(t?: number): { f: number; t: number; viewT: number; frozen: boolean; drift: number; strain: number; day: number; night: boolean; trains: number; toTrain: number; tear: number } | null;
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
  /**
   * Поставить вещь прямо перед камерой на полу (на distance метров) с заданной судьбой; вернуть её номер.
   * facing — повернуть вещь лицом к игроку (иначе она смотрит вдоль +z мира).
   */
  spawnThing(kind: string, fate: 'shrink' | 'dust' | 'grow' | 'jump', distance?: number, facing?: boolean): number;
  /**
   * Поставить фигуру перед игроком (как партнёр ставит в инструменте): материал, поза-заготовка, на
   * сколько впереди, на какой высоте, повернуть (град; 0 — лицом к игроку). Вернёт номер фигуры в списке.
   */
  figure(material: string, pose?: string, distance?: number, lift?: number, turn?: number): number;
  /** Фигуры на уровне: ключ, материал, состояние, растворение частей и где стоят. */
  figures(): { id: string; material: string; state: string; dissolve: number[]; at: number[]; yaw: number }[];
  /** Почему вещь видна или не видна: расстояние, попадание в луч (dot против нужного need), путь луча до преграды. */
  sees(id: number): Record<string, number> | null;
  /** Искомое воспоминание: его id, вещь и где она (null — сейчас ничего не ищут). */
  memory(): { id: string; thing: number; pos: number[] } | null;
  /** Поторопить следующее воспоминание: оно придёт на ближайшем шаге. */
  reveal(): void;
  /**
   * Свет памяти (world/memory_light.ts) у вещи с этим номером, даже если её не ищут; null — снять. false — такой
   * вещи нет. Вещь при этом перестаёт меняться под взглядом, как экспонат лимбо.
   */
  memLight(id: number | null): boolean;
  /** Встать перед вещью искомого воспоминания. */
  gotoMemory(): boolean;
  /**
   * В карманном пространстве: встать перед выходом (красным проёмом) или перед главным предметом (макетом
   * в кукольном домике) и посмотреть на него. distance — с какого расстояния, м. false — такого здесь нет.
   */
  gotoPocket(what: 'exit' | 'focus', distance?: number): boolean;
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
  /** Пустить волну сонара на ближайшем шаге (вариант A): по тихому слою пробегает план. */
  sonar(): void;
  /** Включить или выключить тень фонаря (для сравнения кадров). */
  shadows(on: boolean): void;
  /** Облако точек вкл/выкл: выкл — мир рисуется сплошными поверхностями (для сравнения кадров). */
  scan(on: boolean): void;
  /** Проверка «как в Safari»: у каждой сетки на сценах хватает каждого канала на все вершины (пусто — всё в порядке). */
  geometryAudit(): string[];
  /** Плоские вещи уровня: картонки (standee) и проекции (veil) — что изображено, где стоит и куда смотрит. */
  flats(): Array<Record<string, unknown>>;
  /**
   * Встать перед плоской вещью лицом к ней: distance — на каком расстоянии от её плоскости, side — сдвиг
   * вбок, м (чтобы посмотреть на неё не в лоб). Отрицательное расстояние — встать с изнанки. false — такой нет.
   */
  gotoFlat(index: number, distance?: number, side?: number): boolean;
  /** Показать или скрыть проекции и картинки экранов (чтобы сравнить кадр с ними и без них). */
  slides(on: boolean): void;
  /**
   * Предметы обстановки как объекты (world/objects.ts): имя, место, габариты, есть ли преграда, картонка
   * ли это, и что с ним сейчас: here — стоит, going — растворяется, gone — его нет, coming — собирается,
   * left — вместо него теперь отдельная вещь. group — предмет стоит в варианте комнаты, который
   * может быть скрыт (тогда коснуться его нельзя).
   */
  objects(): Array<{ id: number; name: string; at: number[]; rot: number; min: number[]; max: number[]; solid: boolean; flat: boolean; group: string | null; state: string; dis: number; form: number; keeps: boolean }>;
  /**
   * Встать перед объектом лицом к нему: distance — на каком расстоянии от его передней стороны, м.
   * false — такого объекта нет.
   */
  gotoObject(id: number, distance?: number): boolean;
  /** Какие картинки выставочных экранов загружены из файлов (остальные экраны показывают «нет сигнала»). */
  screens(): string[];
  /** Какие листы бумаги (world/papers.ts) уже загружены. */
  papers(): string[];
  /** Карточки от руки на стенах уровня (world/signs.ts, вид card). */
  notes(): { id: string; at: number[]; n: number[] }[];
  /** Встать перед карточкой номер index на расстоянии distance метров, лицом к ней. */
  gotoNote(index: number, distance?: number): boolean;
  /** Нарисовать кадр и вернуть его яркость сеткой 32×18, строка 0 — верхняя. */
  probe(): number[];
  /** Средний цвет кадра (0..255) и доля красных точек: виден ли красная сетка. */
  probeColor(): { r: number; g: number; b: number; red: number; dark: number };
  missingKeys(): string[];
  /** Какие листы-картинки (плакаты ГО, план убежища) уже загружены. */
  sheets(): string[];
  /**
   * Насколько пёстрая клетка листа в атласе надписей: разброс яркости её точек. У пустого листа он
   * около 10 (только пятна старения), у листа с плакатом — десятки. −1 — такого листа или атласа нет.
   */
  sheetContrast(id: string): number;
  /** Где на уровне висят листы-картинки: id листа, середина и куда он смотрит. */
  sheetMarks(): { id: string; at: number[]; n: number[] }[];
  /** Встать перед листом с этим номером (из sheetMarks) лицом к нему. false — такого листа нет. */
  gotoSheet(index: number, distance?: number): boolean;
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
      profile: { sorties: app.profile.sorties, successes: app.profile.successes, archive: [...app.profile.archive], memories: JSON.parse(JSON.stringify(app.profile.memories ?? {})) },
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
    // Там, где фонаря нет (офис), щёлкать нечем — как и у настоящей кнопки.
    toggleLight: () => {
      if (game().hasLight) game().light.toggle();
    },
    quality: (q) => {
      if (q) app.setQuality(q);
      return game().renderer.quality;
    },
    info: () => ({ ...game().renderer.info(), fps: app.fps }),
    cloudUsage: () => game().renderer.cloudUsage(),
    dust: () => game().renderer.dustInfo(),
    spores: () => (game().spores?.sites ?? []).filter((q) => q.grow > 0.03).map((q) => ({ pos: [...q.pos], kind: q.kind, grow: +q.grow.toFixed(3) })),
    birds: () => {
      const g = game();
      const t = g.flow ? g.flow.viewT : 0;
      const f = g.flock;
      return {
        flock: f ? Array.from({ length: f.count }, (_, i) => f.pose(i, t)).map((p) => ({ pos: p.pos.map((v) => +v.toFixed(2)), flying: p.flying, open: +p.open.toFixed(2) })) : [],
        leavers: g.leavers.map((l) => ({ state: l.state, at: l.perch.pos.map((v) => +v.toFixed(2)) })),
      };
    },
    pressure: (kind) => {
      const g = game();
      const p = g.pressure;
      if (!p) return null;
      const ok = kind ? g.startPressure(kind) : false;
      const a = p.active;
      return {
        ok,
        rooms: [...g.pressureRooms.keys()],
        here: g.pressureHere(),
        active: a ? { kind: a.kind, phase: a.phase, room: a.room.id, radius: a.radius, ceil: a.ceil, origin: [...a.origin], exits: a.room.exits.map((e) => [...e]) } : null,
        falling: p.falling,
        count: p.count,
        camDrop: p.camDrop([g.body.x, g.body.z]),
      };
    },
    flow: (t) => {
      const f = game().flow;
      // С числом — перевести часы места (и снимок) на это время: посмотреть вечер, не дожидаясь его.
      if (f && typeof t === 'number') f.seek(t);
      return f ? { f: f.f, t: f.t, viewT: f.viewT, frozen: f.frozen, drift: f.drift, strain: f.strain, day: f.day, night: f.night, trains: f.trains, toTrain: f.toTrain, tear: game().lastTear } : null;
    },
    wear: () => {
      const forms: Record<string, number> = {};
      for (const i of game().illusions?.list ?? []) forms[String(i.form)] = (forms[String(i.form)] ?? 0) + 1;
      return { wear: game().wear, base: game().wearBase, decay: game().decay, forms };
    },
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
        wear: l.wear ?? 0,
        world: l.world ?? 'shelter',
        rank: l.layout?.rank ?? null,
        tiers: l.layout?.tierCount ?? 1,
        chunks: l.chunks.length,
        triangles: l.chunks.reduce((n, c) => n + c.mesh.index.length / 3, 0),
        colliders: l.colliders.boxes.length,
        spots: l.spots.length,
        spawn: [...l.spawn.pos],
        rooms: (l.layout?.rooms ?? []).map((r) => ({ id: r.id, type: r.type, tier: r.tier, cells: r.cells.length })),
        sky: l.skyRoom ?? null,
        landmarks: l.landmarks.map((m) => ({ id: m.id, room: m.room, tier: m.tier })),
        flats: (l.flats ?? []).map((f) => ({ kind: f.kind, what: f.what, room: f.room, tier: f.tier })),
      };
    },
    flats: () => (app.level.flats ?? []).map((f) => ({ ...f, at: [...f.at], n: [...f.n] })),
    gotoFlat: (index, distance = 3, side = 0) => {
      const f = (app.level.flats ?? [])[index];
      if (!f) return false;
      game().debugHome();
      // Вбок — вдоль плоскости картинки: поворот нормали на четверть оборота вокруг вертикали.
      const x = f.at[0] + f.n[0] * distance + f.n[2] * side;
      const z = f.at[2] + f.n[2] * distance - f.n[0] * side;
      game().teleport(x, f.floor, z, Math.atan2(-(f.at[0] - x), -(f.at[2] - z)), 0);
      return true;
    },
    slides: (on) => {
      game().renderer.debugSlidesOff = !on;
    },
    objects: () =>
      (game().illusions?.list ?? []).map((i) => ({ id: i.obj.id, name: i.obj.name, at: [...i.obj.at], rot: i.obj.rot, min: [...i.obj.min], max: [...i.obj.max], solid: i.obj.solid, flat: i.obj.flat, group: i.obj.group ?? null, state: i.state, dis: +i.dis.toFixed(3), form: i.form, keeps: game().keepsItself(i.obj.id) })),
    gotoObject: (id, distance = 1.6) => {
      const o = game().illusions?.get(id)?.obj;
      if (!o) return false;
      game().debugHome();
      // Перед объектом — со стороны его оси +z (см. Xf.pt): у мебели она смотрит от стены в помещение.
      const fx = o.rot === 1 ? 1 : o.rot === 3 ? -1 : 0;
      const fz = o.rot === 0 ? 1 : o.rot === 2 ? -1 : 0;
      const cx = (o.min[0] + o.max[0]) / 2;
      const cz = (o.min[2] + o.max[2]) / 2;
      // Передняя сторона — край габаритов вдоль оси +z.
      const half = Math.abs(fx) > 0 ? (o.max[0] - o.min[0]) / 2 : (o.max[2] - o.min[2]) / 2;
      const x = cx + fx * (half + distance);
      const z = cz + fz * (half + distance);
      // Пол яруса, на котором стоит объект (ярусы идут через 4,5 м вниз; настенное висит выше пола).
      const floor = Math.floor((o.min[1] + 0.3) / 4.5) * 4.5;
      game().teleport(x, floor, z, Math.atan2(-(cx - x), -(cz - z)), 0);
      return true;
    },
    screens: () => [...app.screenIds],
    papers: () => [...app.paperIds],
    notes: () => (app.level.notes ?? []).map((m) => ({ id: m.id, at: [...m.at], n: [...m.n] })),
    gotoNote: (index, distance = 1.2) => {
      const m = (app.level.notes ?? [])[index];
      if (!m) return false;
      game().debugHome();
      const x = m.at[0] + m.n[0] * distance;
      const z = m.at[2] + m.n[2] * distance;
      const floor = Math.floor((m.at[1] + 0.3) / 4.5) * 4.5;
      game().teleport(x, floor, z, Math.atan2(-(m.at[0] - x), -(m.at[2] - z)), 0);
      return true;
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
    things: () => game().things.list.map((t) => ({ id: t.id, kind: t.kind, state: t.state, fate: t.fate, memory: t.memory, gaze: t.gaze, scale: t.scale, dissolve: t.dissolve, form: t.form, pos: [...t.pos] })),
    spawnThing: (kind, fate, distance = 2.5, facing = false) => {
      const g = game();
      const st = g.snapshot() as { pos: number[]; aim: number[] };
      const yaw = st.aim[0]!;
      const x = st.pos[0]! - Math.sin(yaw) * distance;
      const z = st.pos[2]! - Math.cos(yaw) * distance;
      return g.addThing(kind, [x, st.pos[1]!, z], facing ? yaw : 0, fate).id;
    },
    figure: (material, pose = 'stand', distance = 2.5, lift = 0, turn = 0) => {
      const g = game();
      const st = g.snapshot() as { pos: number[]; aim: number[] };
      const yaw = st.aim[0]!;
      const x = st.pos[0]! - Math.sin(yaw) * distance;
      const z = st.pos[2]! - Math.cos(yaw) * distance;
      const id = `debug_${material}_${pose}`.replace(/[^a-z0-9_]/g, '_').slice(0, 40);
      const base = (POSES as Record<string, Pose>)[pose] ?? POSES.stand;
      const spec: FigureSpec = {
        id,
        name: id,
        pose: JSON.parse(JSON.stringify(base)) as Pose,
        material: (FIGURE_MATERIALS as readonly string[]).includes(material) ? (material as FigureMaterial) : 'wood',
        rule: { worlds: ['shelter', 'office', 'yellow', 'station'], rooms: [], anchor: 'middle', facing: 'player', lift, count: 1 },
        yaw: 0,
        offset: [0, 0],
      };
      // Лицом к игроку: фигура смотрит туда, откуда на неё смотрят (+ доворот).
      g.addDebugFigure(spec, [x, st.pos[1]! + lift, z], yaw + (turn * Math.PI) / 180);
      return g.figures.list.length - 1;
    },
    figures: () => game().figures.list.map((f) => ({ id: f.id, material: f.material, state: f.state, dissolve: f.pieces.map((p) => p.dissolve), at: [...f.at], yaw: f.yaw })),
    gotoThing: (id, distance = 2.2) => {
      const g = game();
      const t = g.things.list.find((x) => x.id === id);
      if (!t) return false;
      const [x, y, z] = t.pos;
      const aimY = y + Math.max(0.2, t.radius * 0.6);
      const tryFrom = (px: number, py: number, pz: number): boolean => {
        // Встать можно только туда, где есть пол: точка за стеной уровня — не место (вещь у самой стены
        // «видна» и оттуда — в пределах допуска на мебель, — но игрок там падает).
        if (g.colliders.raycast(px, py + 1, pz, 0, -1, 0, 1.6) >= 1.6) return false;
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
    memLight: (id) => {
      const g = game();
      const t = id === null ? null : (g.things.list.find((x) => x.id === id) ?? null);
      // Под взглядом такая вещь не меняется (как экспонат лимбо): иначе разглядывание её и рассыпает.
      if (t) t.still = true;
      g.memLightDebug = t;
      return id === null || t !== null;
    },
    gotoMemory: () => {
      const t = game().things.list.find((x) => x.memory);
      return t ? api.gotoThing(t.id, 2.2) : false;
    },
    gotoPocket: (what, distance = what === 'exit' ? 1.6 : 1.5) => {
      const g = game();
      const p = g.pocket;
      const at = what === 'exit' ? p?.exit : p?.focus;
      if (!p || !at) return false;
      // К макету подходим со стороны точки появления; к выходу — по его оси (проём стоит поперёк z и
      // смотрит на точку появления).
      const dx = what === 'exit' ? 0 : p.spawn.pos[0] - at[0];
      const dz = what === 'exit' ? 1 : p.spawn.pos[2] - at[2];
      const d = Math.hypot(dx, dz) || 1;
      g.teleport(at[0] + (dx / d) * distance, p.spawn.pos[1], at[2] + (dz / d) * distance);
      app.advance(emptyInput(), 2, 1, STEP);
      g.aimAt(at[0], what === 'exit' ? at[1] + 1.2 : at[1], at[2]);
      app.advance(emptyInput(), 2, 1, STEP);
      return true;
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
    sonar: () => {
      game().pingSonar();
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
    geometryAudit: () => game().renderer.geometryAudit(),
    probe: () => {
      game().draw(1, 0);
      return game().renderer.probe();
    },
    probeColor: () => {
      game().draw(1, 0);
      return game().renderer.probeColor();
    },
    missingKeys: () => [...app.i18n.missing],
    sheets: () => [...app.sheetIds],
    sheetContrast: (id) => {
      const s = SIGN[id];
      const g = app.signsCanvas?.getContext('2d');
      if (!s || !g) return -1;
      const d = g.getImageData(s.x, s.y, s.pw, s.ph).data;
      let sum = 0;
      let sq = 0;
      let n = 0;
      for (let i = 0; i < d.length; i += 28) {
        const l = 0.3 * d[i]! + 0.59 * d[i + 1]! + 0.11 * d[i + 2]!;
        sum += l;
        sq += l * l;
        n += 1;
      }
      const mean = sum / n;
      return Math.sqrt(Math.max(0, sq / n - mean * mean));
    },
    sheetMarks: () => app.level.sheets.map((m) => ({ id: m.id, at: [...m.at], n: [...m.n] })),
    gotoSheet: (index, distance = 1.4) => {
      const m = app.level.sheets[index];
      if (!m) return false;
      game().debugHome();
      const x = m.at[0] + m.n[0] * distance;
      const z = m.at[2] + m.n[2] * distance;
      // Пол — у ближайшего узла того же яруса (лист висит на уровне глаз); у тестового уровня узлов нет.
      const floor = app.level.nav.filter((n) => Math.abs(n.y + 1.7 - m.at[1]) < 1.2).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
      game().teleport(x, floor ? floor.y : 0, z);
      app.advance(emptyInput(), 2, 1, STEP);
      game().aimAt(m.at[0], m.at[1], m.at[2]);
      app.advance(emptyInput(), 2, 1, STEP);
      return true;
    },
    audio: () => app.sound.status(),
    showcase: () => showcaseItems(app.params.get('props')?.split(',') ?? null),
    mute: (on) => app.setMuted(on),
  };
  window.__vz = api;
}
