/**
 * Игра: симуляция фиксированным шагом и сборка кадра. Здесь сходятся контроллер, нагрудная камера,
 * фонарь, детектор тряски, вылазка (цели, среда, паника) и рендер. Экраны, пауза и ввод — в app.ts.
 */
import { approach, clamp, lerp } from './core/math';
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
import { DEFAULT_FLASHLIGHT, Flashlight } from './systems/flashlight';
import type { FlashlightConfig } from './systems/flashlight';
import { Sortie } from './systems/sortie';
import type { SortieEvent } from './systems/sortie';
import { ColliderSet } from './world/colliders';
import { buildItemsMesh } from './world/items';
import type { BuiltLevel } from './world/level';

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

export interface StepEvents {
  lightFailed: boolean;
  lightRevived: boolean;
  spark: boolean;
  /** Засчитанных ходов тряски за шаг (для вибрации и звука дребезга). */
  strokes: number;
  fellOut: boolean;
  /** События вылазки: находки, цели, обвалы, конец. */
  sortie: SortieEvent[];
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
  private prevX = 0;
  private prevY = 0;
  private prevZ = 0;
  private spawn: BuiltLevel['spawn'] = { pos: [0, 0, 0], yaw: 0 };
  private lastStrokes = 0;
  private lastRig: RigOutput | null = null;
  private beamDist = 30;

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
      this.renderer.reveal(id);
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
    if (input.light && !swapping && !over) this.light.toggle();
    const level = this.shake.update(dt);
    const ev = this.light.update(dt, { panic: this.panic, wet: s?.inWater ? 1 : 0, swarm: 0, shake: level });
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
      out.push(...s.update(dt, { pos: [b.x, b.y, b.z], eye, aim, light: this.light.intensity, actionPressed: input.actionPressed, actionHeld: input.action, landed: res.landed, swarm: 0 }, los));
      for (const e of out) this.applyEvent(e);
    }
    return { lightFailed: ev.failed, lightRevived: ev.revived, spark: ev.spark, strokes, fellOut: res.fellOut, sortie: out };
  }

  /** Последствия события вылазки для мира и камеры. */
  private applyEvent(e: SortieEvent): void {
    if (e.type === 'picked') this.refreshItems(e.item.tier);
    else if (e.type === 'swap-done') this.light.replaceBattery();
    else if (e.type === 'collapse') {
      for (const b of e.spec.boxes) this.colliders.add(b);
      this.renderer.reveal(e.spec.id);
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

  /** Нарисовать кадр. alpha — доля шага между прошлым и текущим состоянием, dt — реальное время кадра. */
  draw(alpha: number, dt: number): void {
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
    this.frame += 1;
    const hurt = this.sortie ? 1 - this.sortie.health / 100 : 0;
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
      glitch: this.glitch,
      tunnel: clamp(this.panic * 0.6 + hurt * 0.5, 0, 0.95),
      gas: this.gasView,
      fade: this.fade,
      time: this.time,
      frame: this.frame,
    };
    this.renderer.render(view);
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
    };
  }
}
