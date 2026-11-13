/**
 * Игра: симуляция фиксированным шагом и сборка кадра. Здесь сходятся контроллер, нагрудная камера,
 * фонарь, детектор тряски и рендер. Экраны, пауза и ввод с устройств — в app.ts.
 */
import { clamp, lerp } from './core/math';
import type { Rng } from './core/rng';
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
import { ColliderSet } from './world/colliders';
import type { BuiltLevel } from './world/level';

export const STEP = 1 / 60;
const WALK_SPEED = 2.3;
const RUN_SPEED = 4.3;
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
}

export class Game {
  readonly shake = new ShakeMeter();
  readonly light: Flashlight;
  readonly rig = new CameraRig();
  readonly exposure = new AutoExposure();
  colliders = new ColliderSet();
  body: PlayerBody = createBody(0, 0, 0);
  aimYaw = 0;
  aimPitch = 0;
  panic = 0;
  /** Игровое время вылазки, с. */
  time = 0;
  frame = 0;
  /** 0 — чёрный экран, 1 — картинка: плавное проявление на старте. */
  fade = 0;
  glitch = 0;
  private prevX = 0;
  private prevY = 0;
  private prevZ = 0;
  private spawn: BuiltLevel['spawn'] = { pos: [0, 0, 0], yaw: 0 };
  private lastStrokes = 0;
  private lastRig: RigOutput | null = null;
  private beamDist = 30;

  constructor(
    readonly renderer: GameRenderer,
    rng: Rng,
    lightCfg: Partial<FlashlightConfig> = {},
  ) {
    this.light = new Flashlight(rng, { ...DEFAULT_FLASHLIGHT, ...lightCfg });
  }

  loadLevel(level: BuiltLevel): void {
    this.colliders = level.colliders;
    this.spawn = level.spawn;
    this.renderer.setWorld(level.chunks, level.stairs);
    this.respawn();
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

  /** Поворот луча: применяется сразу, без ожидания шага симуляции. */
  look(yaw: number, pitch: number): void {
    this.aimYaw += yaw;
    this.aimPitch = clamp(this.aimPitch + pitch, -MAX_PITCH, MAX_PITCH);
  }

  step(dt: number, input: InputFrame): StepEvents {
    this.time += dt;
    this.fade = Math.min(1, this.fade + dt / 1.2);
    const b = this.body;
    this.prevX = b.x;
    this.prevY = b.y;
    this.prevZ = b.z;

    // Движение — в осях луча: «вперёд» туда, куда светишь.
    const sin = Math.sin(this.aimYaw);
    const cos = Math.cos(this.aimYaw);
    const wishX = cos * input.moveX - sin * input.moveZ;
    const wishZ = -sin * input.moveX - cos * input.moveZ;
    const res = stepPlayer(b, wishX, wishZ, input.run ? RUN_SPEED : WALK_SPEED, dt, this.colliders, DEFAULT_CONTROLLER);
    if (res.fellOut) this.respawn();

    if (input.light) this.light.toggle();
    const level = this.shake.update(dt);
    const ev = this.light.update(dt, { panic: this.panic, wet: 0, swarm: 0, shake: level });
    const strokes = this.shake.strokes - this.lastStrokes;
    this.lastStrokes = this.shake.strokes;
    return { lightFailed: ev.failed, lightRevived: ev.revived, spark: ev.spark, strokes, fellOut: res.fellOut };
  }

  /** Нарисовать кадр. alpha — доля шага между прошлым и текущим состоянием, dt — реальное время кадра. */
  draw(alpha: number, dt: number): void {
    const b = this.body;
    const x = lerp(this.prevX, b.x, alpha);
    const y = lerp(this.prevY, b.y, alpha);
    const z = lerp(this.prevZ, b.z, alpha);
    const rig = this.rig.update(
      { x, y, z, aimYaw: this.aimYaw, aimPitch: this.aimPitch, speed: Math.hypot(b.vx, b.vz), onGround: b.onGround, panic: this.panic, shake: this.light.state === 'dead' ? this.shake.level : this.shake.level * 0.35 },
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
    this.frame += 1;
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
      tunnel: this.panic * 0.6,
      fade: this.fade,
      time: this.time,
      frame: this.frame,
    };
    this.renderer.render(view);
  }

  /** Снимок состояния для отладки и смоука. */
  snapshot(): Record<string, unknown> {
    const b = this.body;
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
    };
  }
}
