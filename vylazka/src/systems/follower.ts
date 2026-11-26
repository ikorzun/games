/**
 * Шаги в такт (Z-19, приём 3; куратор, пачка 55): на долгом пути за спиной, в 4–6 м, — шаги, повторяющие твои с опозданием на
 * полшага; остановился — ещё один шаг и тишина; обернулся — никого, и призрака нет. Это не Осыпь (у неё нет ног, её знак —
 * песок): это жуть места, «тот, кто идёт следом» (story.md, §6; sensations.md, §2). Раз-два за сон: чаще — выучат, и иллюзия
 * пропадёт. Шаги — тот же клип, что у игрока, тише и ниже (audio/game_audio.ts); звучат там, где игрок сам прошёл несколько
 * шагов назад, — за поворотом они за поворотом, а не в стене.
 *
 * Чистая логика: кадр отдаёт шаг игрока, где уши и куда смотрят; обратно — где прозвучали шаги следом.
 */
import type { Vec3 } from '../core/types';

export const FOLLOW = {
  /** Сколько секунд игрок должен идти без остановки, чтобы за спиной кто-то пошёл. */
  walkFor: 5,
  /** Сколько раз за сон. */
  perDream: 2,
  /** Не раньше этой секунды сна и не чаще чем раз в столько секунд. */
  from: 25,
  gap: 70,
  /** Опоздание на полшага, с. */
  lag: 0.27,
  /** Сколько шагов идёт следом, от и до; дальше замолкает сам — посреди пути. */
  steps: [6, 10] as const,
  /** На каком расстоянии пути за спиной, от и до, м. */
  dist: [4, 6] as const,
  /** Игрок встал (шага нет столько секунд) — ещё один шаг и тишина. */
  stopAfter: 0.75,
  /** Последний шаг — через столько секунд после того, как игрок встал. */
  lastBeat: 0.35,
  /** Обернулся: косинус угла между взглядом и направлением на шаги больше этого — тишина без последнего шага. */
  facing: 0.45,
  /** Сколько своих шагов помнит путь. */
  trail: 24,
} as const;

export interface FollowInput {
  /** Часы сна, с. */
  time: number;
  /** Реальное время кадра, с. */
  dt: number;
  /** Игрок сделал шаг в этом кадре. */
  footstep: boolean;
  /** Где ноги игрока сейчас. */
  feet: Vec3;
  /** Где уши и куда смотрит камера (yaw: 0 — взгляд на −z). */
  ears: Vec3;
  yaw: number;
  /** Можно: игрок в месте, не в скачке, Осыпи нет, сон идёт. */
  calm: boolean;
}

export class Follower {
  /** Сколько секунд подряд игрок идёт. */
  private walking = 0;
  private sinceStep = Infinity;
  private count = 0;
  private lastAt = -Infinity;
  private on = false;
  private left = 0;
  private dist = 5;
  /** Шаги следом, которые ещё прозвучат: через сколько секунд и где. */
  private queue: { in: number; at: Vec3 }[] = [];
  /** Свои шаги — где ступал игрок (последние trail). */
  private trail: Vec3[] = [];
  /** Где прозвучал последний шаг следом. */
  private last: Vec3 | null = null;
  private rnd: number;

  constructor(seed: number) {
    this.rnd = seed >>> 0 || 1;
  }

  /** Свой счётчик случайных чисел: ГСЧ игры не трогаем — от него зависят уровни и проверки. */
  private next(): number {
    this.rnd = (Math.imul(this.rnd, 1664525) + 1013904223) >>> 0;
    return this.rnd / 4294967296;
  }

  /** Сколько раз за этот сон шли следом. */
  get times(): number {
    return this.count;
  }

  /** Идут ли сейчас следом. */
  get following(): boolean {
    return this.on;
  }

  /** Где на пути игрока точка в dist метрах позади (по его же шагам); null — путь короче. */
  private behind(dist: number, feet: Vec3): Vec3 | null {
    let acc = 0;
    let prev = feet;
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const p = this.trail[i]!;
      acc += Math.hypot(p[0] - prev[0], p[2] - prev[2]);
      if (acc >= dist) return [p[0], p[1], p[2]];
      prev = p;
    }
    return null;
  }

  /** Кадр: какие шаги следом прозвучали сейчас. */
  update(inp: FollowInput): Vec3[] {
    const out: Vec3[] = [];
    if (inp.footstep) {
      this.trail.push([inp.feet[0], inp.feet[1], inp.feet[2]]);
      if (this.trail.length > FOLLOW.trail) this.trail.shift();
      this.walking += Math.min(this.sinceStep, 1);
      this.sinceStep = 0;
    } else {
      this.sinceStep += inp.dt;
      if (this.sinceStep > FOLLOW.stopAfter) this.walking = 0;
    }
    // Шаги следом, чей срок пришёл.
    for (const q of this.queue) q.in -= inp.dt;
    while (this.queue.length > 0 && this.queue[0]!.in <= 0) {
      const q = this.queue.shift()!;
      out.push(q.at);
      this.last = q.at;
    }
    if (!this.on) {
      if (inp.calm && inp.footstep && this.walking >= FOLLOW.walkFor && this.count < FOLLOW.perDream && inp.time >= FOLLOW.from && inp.time - this.lastAt >= FOLLOW.gap) {
        const d = FOLLOW.dist[0] + (FOLLOW.dist[1] - FOLLOW.dist[0]) * this.next();
        if (this.behind(d, inp.feet)) {
          this.on = true;
          this.count += 1;
          this.lastAt = inp.time;
          this.dist = d;
          this.left = FOLLOW.steps[0] + Math.floor((FOLLOW.steps[1] - FOLLOW.steps[0] + 1) * this.next());
          this.last = null;
        }
      }
      if (!this.on) return out;
    }
    const stop = (): Vec3[] => {
      this.on = false;
      this.queue = [];
      return out;
    };
    // Покоя больше нет (Осыпь, скачок, ушёл из места) — замолкает сразу.
    if (!inp.calm) return stop();
    // Обернулся к шагам — никого: тишина, и последнего шага нет.
    const src = this.last ?? this.behind(this.dist, inp.feet);
    if (src) {
      const dx = src[0] - inp.ears[0];
      const dz = src[2] - inp.ears[2];
      const l = Math.hypot(dx, dz);
      if (l > 1e-3 && (dx * -Math.sin(inp.yaw) + dz * -Math.cos(inp.yaw)) / l > FOLLOW.facing) return stop();
    }
    if (inp.footstep) {
      if (this.left <= 0) return stop();
      const at = this.behind(this.dist, inp.feet);
      if (at) {
        this.queue.push({ in: FOLLOW.lag, at });
        this.left -= 1;
      }
    } else if (this.sinceStep > FOLLOW.stopAfter && this.sinceStep - inp.dt <= FOLLOW.stopAfter) {
      // Игрок встал: ещё один шаг — и тишина.
      const at = this.behind(this.dist * 0.85, inp.feet) ?? this.last;
      this.on = false;
      if (at) this.queue.push({ in: FOLLOW.lastBeat, at });
    }
    return out;
  }
}
