/**
 * Режиссёр страха: когда пугать и чем. Первые минуты — только ложные события; потом рой мелькает
 * вдалеке; потом выходит на охоту. Пугалки сами урона не наносят: звук, толчок камеры, помехи,
 * мигание фонаря. Чистая логика: отдаёт события, исполняет их игра.
 */
import type { Rng } from '../core/rng';

/** Ложные события. Звук к ним подключается по id на этапе звука. */
export const SCARES = ['bang', 'slam', 'steps', 'knock', 'radio', 'flicker', 'signs'] as const;
export type ScareId = (typeof SCARES)[number];

export type DirectorEvent =
  | { type: 'scare'; id: ScareId }
  /** Показать фигуру роя вдалеке (без охоты). */
  | { type: 'apparition' }
  /** Выпустить рой на охоту. */
  | { type: 'release' };

export interface DirectorInput {
  /** Время вылазки, с. */
  time: number;
  /** Ярус, на котором игрок. */
  tier: number;
  goalsDone: number;
  /** Рой уже выпущен или стоит фигурой. */
  swarmBusy: boolean;
  /** Число ярусов объекта. */
  tiers: number;
}

export interface DirectorConfig {
  /** Когда начинаются явления роя, с (или раньше — со спуском на второй ярус). */
  glimpseAt: number;
  /** Когда рой выходит на охоту, с (или раньше — по глубине и целям). */
  releaseAt: number;
  /** Пауза между пугалками, от и до, с. */
  scareGap: [number, number];
}

export const DEFAULT_DIRECTOR: DirectorConfig = { glimpseAt: 75, releaseAt: 210, scareGap: [28, 55] };

export class Director {
  /** 0 — только ложные события, 1 — рой мелькает, 2 — рой охотится. */
  phase: 0 | 1 | 2 = 0;
  private nextScare: number;
  private nextGlimpse = Infinity;
  private last: ScareId | null = null;
  private released = false;

  constructor(
    private readonly rng: Rng,
    readonly cfg: DirectorConfig = DEFAULT_DIRECTOR,
  ) {
    // Первая пугалка — не сразу: дать осмотреться.
    this.nextScare = 18 + rng() * 14;
  }

  /** Продолжить после загрузки сохранения: пугалки не сыплются разом; released — рой уже был на охоте и выйдет снова. */
  restore(time: number, released: boolean): void {
    this.nextScare = time + 10 + this.rng() * 15;
    if (released) this.phase = 2;
  }

  /** Рой уже выходил на охоту в этой вылазке. */
  get wasReleased(): boolean {
    return this.released;
  }

  update(inp: DirectorInput): DirectorEvent[] {
    const ev: DirectorEvent[] = [];
    const c = this.cfg;
    const deep = inp.tier >= 1;
    if (this.phase === 0 && (inp.time >= c.glimpseAt || deep)) {
      this.phase = 1;
      this.nextGlimpse = inp.time + 8 + this.rng() * 14;
    }
    // На охоту рой выходит по времени, по глубине или когда игрок, спустившись, взял первую цель.
    if (this.phase === 1 && (inp.time >= c.releaseAt || inp.tier >= Math.max(1, inp.tiers - 1) || (deep && inp.goalsDone >= 1))) this.phase = 2;

    if (this.phase === 1 && inp.time >= this.nextGlimpse && !inp.swarmBusy) {
      ev.push({ type: 'apparition' });
      this.nextGlimpse = inp.time + 35 + this.rng() * 30;
    }
    if (this.phase === 2 && !this.released && !inp.swarmBusy) {
      this.released = true;
      ev.push({ type: 'release' });
    }
    if (inp.time >= this.nextScare) {
      // Не повторяем одно и то же подряд; «гаснущие надписи» — только на нижних ярусах.
      const pool = SCARES.filter((s) => s !== this.last && (s !== 'signs' || deep));
      const id = pool[Math.floor(this.rng() * pool.length)]!;
      this.last = id;
      ev.push({ type: 'scare', id });
      const [lo, hi] = c.scareGap;
      // Когда рой на охоте, ложных событий меньше: страшно и без них.
      this.nextScare = inp.time + (lo + this.rng() * (hi - lo)) * (this.phase === 2 ? 1.6 : 1);
    }
    return ev;
  }
}
