/**
 * Игра: симуляция фиксированным шагом и сборка кадра. Здесь сходятся контроллер, нагрудная камера,
 * фонарь, детектор тряски, вылазка (цели, среда, паника) и рендер. Экраны, пауза и ввод — в app.ts.
 */
import { approach, clamp, lerp } from './core/math';
import { hash2 } from './core/rng';
import type { Rng } from './core/rng';
import type { Vec3 } from './core/types';
import type { Population } from './gen/populate';
import { createBody, DEFAULT_CONTROLLER, stepPlayer } from './player/controller';
import type { PlayerBody } from './player/controller';
import type { InputFrame } from './player/input';
import { CameraRig, dirFromAngles } from './player/rig';
import type { RigOutput } from './player/rig';
import { ShakeMeter } from './player/shake';
import { AutoExposure, beamAtten } from './render/exposure';
import type { FrameView, GameRenderer } from './render/renderer';
import { nodesInRange, SwarmAI } from './swarm/ai';
import { SwarmBody } from './swarm/body';
import { Anomalies } from './systems/anomalies';
import type { AnomalyEvent, AnomalyState } from './systems/anomalies';
import { Director } from './systems/director';
import type { ScareId } from './systems/director';
import { DEFAULT_FLASHLIGHT, Flashlight } from './systems/flashlight';
import type { FlashlightConfig } from './systems/flashlight';
import { Sortie } from './systems/sortie';
import type { SortieEvent } from './systems/sortie';
import { ColliderSet } from './world/colliders';
import { buildItemsMesh } from './world/items';
import type { BuiltLevel } from './world/level';
import { STAIR_RISE, STAIR_RUN, STAIR_STEPS } from './world/level_build';

export const STEP = 1 / 60;
const WALK_SPEED = 2.3;
const RUN_SPEED = 4.3;
/** В воде идут медленнее. */
const WATER_SPEED = 0.62;
const MAX_PITCH = 1.2;
/** Смещения лучей по ореолу фонаря для оценки яркости кадра: рыскание и тангаж, рад. */
const EXPOSURE_RAYS: readonly (readonly [number, number])[] = [
  [0.2, 0],
  [-0.2, 0],
  [0, 0.17],
  [0, -0.17],
];

/** События страха: для звука и интерфейса. */
/** pos у пугалки — откуда она слышна; без него звук идёт «из рации» или его нет вовсе. */
export type FearEvent = { type: 'scare'; id: ScareId; pos?: Vec3 } | { type: 'swarm'; what: 'apparition' | 'release' | 'cohered' | 'scattered' | 'caught' };

export interface StepEvents {
  lightFailed: boolean;
  lightRevived: boolean;
  /** Игрок щёлкнул выключателем фонаря. */
  lightToggled: boolean;
  spark: boolean;
  /** Засчитанных ходов тряски за шаг (для вибрации и звука дребезга). */
  strokes: number;
  fellOut: boolean;
  /** События вылазки: находки, цели, обвалы, конец. */
  sortie: SortieEvent[];
  /** Пугалки и рой. */
  fear: FearEvent[];
}

export class Game {
  readonly shake = new ShakeMeter();
  light: Flashlight;
  readonly rig = new CameraRig();
  readonly exposure = new AutoExposure();
  colliders = new ColliderSet();
  level: BuiltLevel | null = null;
  /** Текущая вылазка; null — свободная прогулка (тестовый коридор без целей). */
  sortie: Sortie | null = null;
  swarm: SwarmAI | null = null;
  readonly swarmBody = new SwarmBody();
  director: Director | null = null;
  anomalies: Anomalies | null = null;
  /** Близость роя 0..1 на прошлом шаге. */
  swarmNear = 0;
  /** Рой, режиссёр и аномалии выключены (отладка и тесты, проверяющие только цикл вылазки). */
  calm = false;
  body: PlayerBody = createBody(0, 0, 0);
  aimYaw = 0;
  aimPitch = 0;
  /** Игровое время вылазки, с. */
  time = 0;
  frame = 0;
  /** 0 — чёрный экран, 1 — картинка: плавное проявление на старте и затемнение в конце. */
  fade = 0;
  /** Куда стремится fade (0 — затемнить, 1 — проявить). */
  fadeTo = 1;
  glitch = 0;
  /** Толчок камеры (обвал, ушиб): затухает сам. */
  quake = 0;
  private gasView = 0;
  /** Яркость фосфорных надписей и таймер её события (вспышка, затем темнота). */
  private glow = 1;
  private glowTimer = 0;
  /** Клетка «ярус,x,z» → узел навигации. */
  private readonly nodeAt = new Map<string, number>();
  private prevX = 0;
  private prevY = 0;
  private prevZ = 0;
  private spawn: BuiltLevel['spawn'] = { pos: [0, 0, 0], yaw: 0 };
  private lastStrokes = 0;
  private lastRig: RigOutput | null = null;
  private beamDist = 30;
  private stepped = false;
  private scareCount = 0;
  /** Помехи сигнала в последнем кадре, 0..1 (для звука помех). */
  staticLevel = 0;

  constructor(
    readonly renderer: GameRenderer,
    private readonly rng: Rng,
    private readonly lightCfg: Partial<FlashlightConfig> = {},
  ) {
    this.light = new Flashlight(rng, { ...DEFAULT_FLASHLIGHT, ...lightCfg });
  }

  /** Загрузить уровень. pop — наполнение (цели и предметы); без него — свободная прогулка. */
  loadLevel(level: BuiltLevel, pop: Population | null = null): void {
    this.level = level;
    this.colliders = level.colliders;
    this.spawn = level.spawn;
    this.renderer.setWorld(level.chunks, level.stairs);
    this.light = new Flashlight(this.rng, { ...DEFAULT_FLASHLIGHT, ...this.lightCfg });
    this.sortie = pop ? new Sortie(level, pop) : null;
    this.nodeAt.clear();
    for (const n of level.nav) this.nodeAt.set(`${n.tier},${n.cx},${n.cz}`, n.id);
    const tiers = level.layout?.tierCount ?? 1;
    const rank = level.layout?.rank ?? 1;
    if (pop) {
      this.swarm = new SwarmAI(level.nav, this.rng);
      this.director = new Director(this.rng);
      // Лестница на нижний ярус удлиняется дважды — только на объектах, где есть «неправильный» ярус.
      const stair = rank >= 2 && tiers >= 3 ? (level.stairs.find((st) => st.upperTier === tiers - 2) ?? null) : null;
      this.anomalies = new Anomalies(stair, { run: STAIR_RUN, rise: STAIR_RISE, steps: STAIR_STEPS }, level.variants, 2);
    } else {
      this.swarm = null;
      this.director = null;
      this.anomalies = null;
    }
    this.swarmNear = 0;
    this.glow = 1;
    this.glowTimer = 0;
    this.renderer.setGlow(1);
    this.time = 0;
    this.fade = 0;
    this.fadeTo = 1;
    this.glitch = 0;
    this.quake = 0;
    this.gasView = 0;
    this.shake.reset();
    this.refreshItems();
    this.respawn();
  }

  /** Пересобрать геометрию предметов (после находки или загрузки сохранения). */
  refreshItems(tier?: number): void {
    const s = this.sortie;
    const tiers = this.level?.layout?.tierCount ?? 1;
    for (let t = 0; t < tiers; t++) {
      if (tier !== undefined && t !== tier) continue;
      this.renderer.setItems(t, s ? buildItemsMesh(s.pop.items, t, s.taken) : null);
    }
  }

  /** Вернуть в мир завалы, которые уже обрушились (после загрузки сохранения). */
  applyCollapses(): void {
    const s = this.sortie;
    if (!s || !this.level) return;
    for (const id of s.collapsed()) {
      const spec = this.level.collapses.find((c) => c.id === id);
      if (!spec) continue;
      for (const b of spec.boxes) this.colliders.add(b);
      this.renderer.setChunkVisible(id, true);
    }
  }

  /** Узел навигации, в клетке которого стоит игрок (−1 — вне графа). */
  playerNode(): number {
    const b = this.body;
    const cx = Math.round(b.x / 3) + 8;
    const cz = Math.round(b.z / 3) + 8;
    const t = Math.max(0, Math.round(-b.y / 4.5));
    // На лестнице высота между ярусами: узлы марша числятся за верхним ярусом.
    for (const tier of [t, t - 1, t + 1]) {
      const id = this.nodeAt.get(`${tier},${cx},${cz}`);
      if (id !== undefined) return id;
    }
    return -1;
  }

  /** Сдвинуть игрока, не дёрнув камеру (аномалия лестницы). */
  shiftPlayer(dx: number, dy: number, dz: number): void {
    const b = this.body;
    b.x += dx;
    b.y += dy;
    b.z += dz;
    this.prevX += dx;
    this.prevY += dy;
    this.prevZ += dz;
    this.rig.shift(dy);
  }

  /** Применить события аномалий к миру. */
  applyAnomalies(events: readonly AnomalyEvent[]): void {
    for (const e of events) {
      if (e.type === 'shift') this.shiftPlayer(e.dx, e.dy, e.dz);
      else {
        this.renderer.setChunkVisible(e.variant.chunkA, !e.alt);
        this.renderer.setChunkVisible(e.variant.chunkB, e.alt);
        this.colliders.setGroup(e.variant.groupA, !e.alt);
        this.colliders.setGroup(e.variant.groupB, e.alt);
      }
    }
  }

  /** Восстановить аномалии из сохранения. */
  restoreAnomalies(state: AnomalyState): void {
    if (this.anomalies) this.applyAnomalies(this.anomalies.restore(state));
  }

  /** Луч фонаря лежит на рое: в конусе, близко и без преград. */
  private beamOnSwarm(): boolean {
    const sw = this.swarm;
    const rig = this.lastRig;
    if (!sw || !rig || this.light.intensity < 0.3) return false;
    const [lx, ly, lz] = rig.lightPos;
    const tx = sw.pos[0] - lx;
    const ty = sw.pos[1] + 0.2 + sw.cohesion * 0.9 - ly;
    const tz = sw.pos[2] - lz;
    const d = Math.hypot(tx, ty, tz);
    if (d > 16 || d < 0.2) return false;
    const dot = (tx * rig.lightDir[0] + ty * rig.lightDir[1] + tz * rig.lightDir[2]) / d;
    // Широкий допуск вблизи: рой крупный, а луч у самой фигуры узкий.
    if (dot < (d < 4 ? 0.9 : 0.975)) return false;
    return this.colliders.raycast(lx, ly, lz, tx / d, ty / d, tz / d, d) >= d - 0.4;
  }

  /** Узел для явления роя: в 3–5 клетках, на виду у игрока. −1 — подходящего нет. */
  private apparitionNode(from: number): number {
    const sw = this.swarm;
    const rig = this.lastRig;
    if (!sw || !rig || from < 0 || !this.level) return -1;
    for (let i = 0; i < 8; i++) {
      const n = sw.nodeAround(from, 3, 5);
      const node = this.level.nav[n];
      if (!node) continue;
      const dx = node.x - rig.camPos[0];
      const dy = node.y + 1.3 - rig.camPos[1];
      const dz = node.z - rig.camPos[2];
      const d = Math.hypot(dx, dy, dz);
      if (d < 6 || this.colliders.raycast(rig.camPos[0], rig.camPos[1], rig.camPos[2], dx / d, dy / d, dz / d, d) < d - 0.5) continue;
      return n;
    }
    return -1;
  }

  /**
   * Откуда слышна пугалка. Удар и хлопок двери — из дальних помещений, стук — из соседнего,
   * шаги — из-за спины. Рация и мигание источника в мире не имеют.
   */
  private scareSource(id: ScareId, from: number): Vec3 | null {
    const b = this.body;
    if (id === 'steps') return [b.x + Math.sin(this.aimYaw) * 4.5, b.y + 0.1, b.z + Math.cos(this.aimYaw) * 4.5];
    const range = id === 'bang' ? ([7, 13] as const) : id === 'slam' ? ([4, 8] as const) : id === 'knock' ? ([2, 3] as const) : null;
    if (!range || !this.level) return null;
    const near = nodesInRange(this.level.nav, from, range[0], range[1]);
    this.scareCount += 1;
    const n = this.level.nav[near[hash2(this.scareCount, from, 77) % Math.max(1, near.length)] ?? -1];
    // Некуда поместить (тупик, игрок вне графа) — звук приходит просто издалека, из-за спины.
    return n ? [n.x, n.y + 1.2, n.z] : [b.x + Math.sin(this.aimYaw) * 9, b.y + 1, b.z + Math.cos(this.aimYaw) * 9];
  }

  /** Ложное событие: толчок, помехи, мигание — без урона. Звук подключается по id. */
  private applyScare(id: ScareId): void {
    const s = this.sortie;
    if (id === 'bang') {
      this.quake = Math.max(this.quake, 0.18);
      s?.scare(0.06);
    } else if (id === 'slam') {
      this.quake = Math.max(this.quake, 0.32);
      s?.scare(0.1);
    } else if (id === 'steps') s?.scare(0.05);
    else if (id === 'knock') s?.scare(0.08);
    else if (id === 'radio') {
      this.glitch = Math.max(this.glitch, 0.55);
      s?.scare(0.05);
    } else if (id === 'flicker') {
      this.light.stutter(0.7);
      s?.scare(0.05);
    } else {
      // Надписи вспыхивают и гаснут.
      this.glowTimer = 14;
      s?.scare(0.07);
    }
  }

  respawn(): void {
    const [x, y, z] = this.spawn.pos;
    this.teleport(x, y, z, this.spawn.yaw, 0);
  }

  teleport(x: number, y: number, z: number, yaw = this.aimYaw, pitch = this.aimPitch): void {
    this.body = createBody(x, y, z);
    this.prevX = x;
    this.prevY = y;
    this.prevZ = z;
    this.aimYaw = yaw;
    this.aimPitch = pitch;
    this.rig.snap({ x, y, z, aimYaw: yaw, aimPitch: pitch, speed: 0, onGround: true, panic: this.panic, shake: 0 });
  }

  get panic(): number {
    return this.sortie?.panic ?? 0;
  }

  /** Навести луч и камеру на точку мира с того места, где игрок стоит сейчас. */
  aimAt(x: number, y: number, z: number): void {
    const b = this.body;
    const dx = x - b.x;
    const dz = z - b.z;
    this.teleport(b.x, b.y, b.z, Math.atan2(-dx, -dz), clamp(Math.atan2(y - (b.y + 1.42), Math.hypot(dx, dz)), -MAX_PITCH, MAX_PITCH));
  }

  /** Поворот луча: применяется сразу, без ожидания шага симуляции. */
  look(yaw: number, pitch: number): void {
    this.aimYaw += yaw;
    this.aimPitch = clamp(this.aimPitch + pitch, -MAX_PITCH, MAX_PITCH);
  }

  step(dt: number, input: InputFrame): StepEvents {
    this.time += dt;
    this.fade = approach(this.fade, this.fadeTo, this.fadeTo > this.fade ? 0.5 : 0.25, dt);
    this.quake = Math.max(0, this.quake - dt * 1.4);
    const s = this.sortie;
    const over = s?.outcome != null;
    const b = this.body;
    this.prevX = b.x;
    this.prevY = b.y;
    this.prevZ = b.z;

    // Движение — в осях луча: «вперёд» туда, куда светишь. После конца вылазки игрок не управляется.
    const sin = Math.sin(this.aimYaw);
    const cos = Math.cos(this.aimYaw);
    const mx = over ? 0 : input.moveX;
    const mz = over ? 0 : input.moveZ;
    const wishX = cos * mx - sin * mz;
    const wishZ = -sin * mx - cos * mz;
    const speed = (input.run ? RUN_SPEED : WALK_SPEED) * (s?.inWater ? WATER_SPEED : 1);
    const res = stepPlayer(b, wishX, wishZ, speed, dt, this.colliders, DEFAULT_CONTROLLER);
    if (res.fellOut && !s) this.respawn();

    // Фонарь.
    const swapping = (s?.swapping ?? 0) > 0;
    this.light.suspended = swapping;
    const toggled = input.light && !swapping && !over;
    if (toggled) this.light.toggle();
    const level = this.shake.update(dt);
    const ev = this.light.update(dt, { panic: this.panic, wet: s?.inWater ? 1 : 0, swarm: this.swarmNear, shake: level });
    const strokes = this.shake.strokes - this.lastStrokes;
    this.lastStrokes = this.shake.strokes;

    // Вылазка.
    const out: SortieEvent[] = [];
    if (s && !over) {
      // Батарейка села — меняем сами, если есть запасная; R — заменить заранее.
      if ((this.light.empty || (input.swap && this.light.charge < 0.6)) && !swapping) {
        const e = s.startSwap();
        if (e) out.push(e);
      }
      const eye: Vec3 = this.lastRig ? this.lastRig.camPos : [b.x, b.y + 1.42, b.z];
      const aim: Vec3 = this.lastRig ? this.lastRig.lightDir : dirFromAngles(this.aimYaw, this.aimPitch);
      const los = (from: Vec3, to: Vec3): number => {
        const dx = to[0] - from[0];
        const dy = to[1] - from[1];
        const dz = to[2] - from[2];
        const d = Math.hypot(dx, dy, dz) || 1;
        return this.colliders.raycast(from[0], from[1], from[2], dx / d, dy / d, dz / d, d);
      };
      out.push(...s.update(dt, { pos: [b.x, b.y, b.z], eye, aim, light: this.light.intensity, actionPressed: input.actionPressed, actionHeld: input.action, landed: res.landed, swarm: this.swarmNear }, los));
    }
    const fear: FearEvent[] = [];
    if (s && !s.outcome && !this.calm) this.stepFear(dt, input, level, fear, out);
    else if (this.calm) this.swarmNear = 0;
    for (const e of out) this.applyEvent(e);
    this.stepGlow(dt);
    return { lightFailed: ev.failed, lightRevived: ev.revived, lightToggled: toggled, spark: ev.spark, strokes, fellOut: res.fellOut, sortie: out, fear };
  }

  /** Рой, режиссёр и аномалии за шаг. */
  private stepFear(dt: number, input: InputFrame, shakeLevel: number, fear: FearEvent[], out: SortieEvent[]): void {
    const s = this.sortie!;
    const sw = this.swarm;
    const b = this.body;
    const node = this.playerNode();
    const pos: Vec3 = [b.x, b.y, b.z];
    const moving = Math.hypot(b.vx, b.vz);
    // Шум игрока: бег, тряска заглохшего фонаря, паническое дыхание, плеск воды.
    const noise = Math.max(input.run && moving > 3 ? 0.6 : moving > 1 ? 0.12 : 0, this.light.state === 'dead' ? shakeLevel * 0.9 : shakeLevel * 0.4, s.panic > 0.6 ? 0.35 : 0, s.inWater && moving > 0.5 ? 0.5 : 0);

    if (sw) {
      const res = sw.update(dt, { player: pos, playerNode: node, lightOn: this.light.intensity > 0.3, beamOnSwarm: this.beamOnSwarm(), noise });
      if (res.cohered) {
        s.scare(0.2);
        fear.push({ type: 'swarm', what: 'cohered' });
      }
      if (res.scattered) fear.push({ type: 'swarm', what: 'scattered' });
      if (res.caught) {
        fear.push({ type: 'swarm', what: 'caught' });
        out.push(...s.caught());
      }
      this.swarmNear = sw.proximity(pos);
    }

    const dir = this.director;
    if (dir) {
      const tiers = this.level?.layout?.tierCount ?? 1;
      for (const e of dir.update({ time: s.time, tier: Math.max(0, Math.round(-b.y / 4.5)), goalsDone: s.done.size, swarmBusy: sw?.active ?? true, tiers })) {
        if (e.type === 'scare') {
          this.applyScare(e.id);
          const src = this.scareSource(e.id, node);
          fear.push(src ? { type: 'scare', id: e.id, pos: src } : { type: 'scare', id: e.id });
        } else if (e.type === 'apparition' && sw) {
          const n = this.apparitionNode(node);
          if (n >= 0) {
            sw.appear(n, 6);
            this.swarmBody.snap(sw.pos, sw.cohesion);
            fear.push({ type: 'swarm', what: 'apparition' });
          }
        } else if (e.type === 'release' && sw) {
          // Рой выходит подальше от игрока и сам его ищет.
          const n = sw.nodeAround(node, 8, 14);
          sw.activate(n >= 0 ? n : sw.nodeAround(node, 4, 30));
          this.swarmBody.snap(sw.pos, 0);
          fear.push({ type: 'swarm', what: 'release' });
        }
      }
    }

    if (this.anomalies) this.applyAnomalies(this.anomalies.update(pos, node >= 0 ? this.level!.nav[node]!.room : -1, this.swarmNear > 0.2));
  }

  /** Фосфорные надписи: вспышка и темнота по событию; рядом с охотящимся роем гаснут. */
  private stepGlow(dt: number): void {
    let target = this.swarm?.mode === 'hunt' ? 0 : 1;
    if (this.glowTimer > 0) {
      this.glowTimer -= dt;
      target = this.glowTimer > 13.6 ? 7 : this.glowTimer > 1.5 ? 0 : 1;
    }
    const next = approach(this.glow, target, target > this.glow ? 0.05 : 0.25, dt);
    if (Math.abs(next - this.glow) > 1e-3) {
      this.glow = next;
      this.renderer.setGlow(next);
    }
  }

  /** Последствия события вылазки для мира и камеры. */
  private applyEvent(e: SortieEvent): void {
    if (e.type === 'picked') this.refreshItems(e.item.tier);
    else if (e.type === 'swap-done') this.light.replaceBattery();
    else if (e.type === 'collapse') {
      for (const b of e.spec.boxes) this.colliders.add(b);
      this.renderer.setChunkVisible(e.spec.id, true);
      this.quake = 1;
    } else if (e.type === 'hurt') {
      this.quake = Math.max(this.quake, 0.7);
      this.glitch = Math.max(this.glitch, 0.6);
    } else if (e.type === 'ended') {
      this.fadeTo = 0;
      // Запись обрывается помехами; при выходе наверх просто гаснет.
      if (e.outcome !== 'escaped') this.glitch = 1;
    }
  }

  /**
   * Нарисовать кадр. alpha — доля шага между прошлым и текущим состоянием, dt — реальное время кадра.
   * present = false — посчитать камеру, луч и экспозицию, но видеокарту не трогать (пошаговая отладка:
   * из сотни шагов подряд показать нужно только последний).
   */
  draw(alpha: number, dt: number, present = true): void {
    const b = this.body;
    const x = lerp(this.prevX, b.x, alpha);
    const y = lerp(this.prevY, b.y, alpha);
    const z = lerp(this.prevZ, b.z, alpha);
    const dead = this.light.state === 'dead';
    const rig = this.rig.update(
      { x, y, z, aimYaw: this.aimYaw, aimPitch: this.aimPitch, speed: Math.hypot(b.vx, b.vz), onGround: b.onGround, panic: this.panic, shake: Math.max(dead ? this.shake.level : this.shake.level * 0.35, this.quake) },
      dt,
    );
    this.lastRig = rig;
    if (rig.footstep) this.stepped = true;
    const [lx, ly, lz] = rig.lightPos;
    this.beamDist = this.colliders.raycast(lx, ly, lz, rig.lightDir[0], rig.lightDir[1], rig.lightDir[2], 30);
    // Яркость кадра для автоэкспозиции: центр луча и четыре луча по ореолу — берём самое светлое место.
    let lum = beamAtten(this.beamDist);
    const yaw = Math.atan2(-rig.lightDir[0], -rig.lightDir[2]);
    const pitch = Math.asin(clamp(rig.lightDir[1], -1, 1));
    for (const [dy, dp] of EXPOSURE_RAYS) {
      const d = dirFromAngles(yaw + dy, pitch + dp);
      lum = Math.max(lum, 0.3 * beamAtten(this.colliders.raycast(lx, ly, lz, d[0], d[1], d[2], 30)));
    }
    const gain = this.exposure.update(dt, lum * this.light.intensity, this.light.intensity);
    this.gasView = approach(this.gasView, this.sortie?.inGas ? 1 : 0, 0.6, dt);
    if (this.sortie?.outcome == null) this.glitch = Math.max(0, this.glitch - dt * 1.5);
    // Рой: тело тянется за центром. В момент поимки он рывком смыкается в метре перед камерой —
    // не на объективе: сотня червей во весь экран стоила бы кадров, экран закрывает срыв сигнала.
    const sw = this.swarm;
    if (sw && sw.active) {
      const caught = this.sortie?.outcome === 'caught';
      const lunge: Vec3 | null = caught ? [rig.camPos[0] + rig.lightDir[0] * 0.95, rig.camPos[1] - 0.15, rig.camPos[2] + rig.lightDir[2] * 0.95] : null;
      this.swarmBody.update(dt, sw.pos, sw.cohesion, lunge);
      this.renderer.setSwarm(this.swarmBody.heads, this.swarmBody.dirs, this.swarmBody.params, 0.88, this.time);
    } else this.renderer.setSwarm(this.swarmBody.heads, this.swarmBody.dirs, this.swarmBody.params, 0, this.time);
    // Рядом с роем сигнал камеры рвётся.
    const hunting = sw?.mode === 'hunt' || sw?.mode === 'cohere';
    const static_ = hunting ? this.swarmNear * this.swarmNear * 0.42 : this.swarmNear * 0.1;
    this.frame += 1;
    const hurt = this.sortie ? 1 - this.sortie.health / 100 : 0;
    // Глубина 0…1: от входа до нижнего яруса.
    const depth = clamp(-(rig.camPos[1] - 1.42) / 9, 0, 1);
    const view: FrameView = {
      camPos: rig.camPos,
      camYaw: rig.camYaw,
      camPitch: rig.camPitch,
      camRoll: rig.camRoll,
      lightPos: rig.lightPos,
      lightDir: rig.lightDir,
      lightIntensity: this.light.intensity,
      lightWarmth: 1 - clamp(this.light.charge / 0.35, 0, 1),
      beamDist: this.beamDist,
      gain,
      noise: this.exposure.noise(),
      glitch: (this.staticLevel = Math.max(this.glitch, static_)),
      tunnel: clamp(this.panic * 0.6 + hurt * 0.5, 0, 0.95),
      gas: this.gasView,
      decay: 0.25 + 0.6 * depth,
      // Внизу воздух гуще: взвесь, пар от сырых стен; в газу луч упирается в муть.
      haze: (0.008 + 0.004 * depth) * (1 + 9 * this.gasView),
      fade: this.fade,
      time: this.time,
      frame: this.frame,
    };
    if (present) this.renderer.render(view);
  }

  /** Был ли шаг с прошлого вызова (для звука шагов). */
  consumeFootstep(): boolean {
    const s = this.stepped;
    this.stepped = false;
    return s;
  }

  /** Где и куда смотрит камера: «уши» игрока. */
  listener(): { pos: Vec3; yaw: number } {
    const r = this.lastRig;
    return r ? { pos: r.camPos, yaw: r.camYaw } : { pos: [this.body.x, this.body.y + 1.42, this.body.z], yaw: this.aimYaw };
  }

  /** Снимок состояния для отладки и смоука. */
  snapshot(): Record<string, unknown> {
    const b = this.body;
    const s = this.sortie;
    return {
      pos: [b.x, b.y, b.z],
      vel: [b.vx, b.vy, b.vz],
      onGround: b.onGround,
      aim: [this.aimYaw, this.aimPitch],
      cam: this.lastRig ? [this.lastRig.camYaw, this.lastRig.camPitch] : null,
      light: { state: this.light.state, charge: this.light.charge, intensity: this.light.intensity, revive: this.light.reviveProgress },
      shake: this.shake.level,
      beamDist: this.beamDist,
      gain: this.exposure.gain,
      time: this.time,
      frame: this.frame,
      fade: this.fade,
      sortie: s
        ? {
            done: [...s.done],
            taken: [...s.taken],
            finds: [...s.finds],
            spares: s.spares,
            health: s.health,
            panic: s.panic,
            outcome: s.outcome,
            target: s.target ? s.target.kind : null,
            hold: s.hold,
            swapping: s.swapping,
            inWater: s.inWater,
            inGas: s.inGas,
            maxTier: s.maxTier,
            collapsed: s.collapsed(),
          }
        : null,
      swarm: this.swarm ? { mode: this.swarm.mode, pos: [...this.swarm.pos], node: this.swarm.node, cohesion: this.swarm.cohesion, awareness: this.swarm.awareness, aggravation: this.swarm.aggravation, near: this.swarmNear } : null,
      director: this.director ? { phase: this.director.phase } : null,
      anomalies: this.anomalies ? this.anomalies.state() : null,
      node: this.playerNode(),
    };
  }
}
