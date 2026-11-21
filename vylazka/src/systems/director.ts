/**
 * Режиссёр страха: когда пугать и чем. Первые минуты — только ложные события; потом рой мелькает
 * вдалеке; потом выходит на охоту. Пугалки сами урона не наносят: звук, толчок камеры, помехи,
 * мигание фонаря. Чистая логика: отдаёт события, исполняет их игра.
 */
import type { Rng } from '../core/rng';

/**
 * Ложные события. Звук к ним подключается по id на этапе звука. Удара по металлу и хлопка двери здесь
 * больше нет (решение партнёра, 15.11): это язык хоррора, а не памяти. Остались шаги за спиной, стук
 * из соседнего помещения, рация, мигание фонаря и вспыхивающие надписи; место озвучивают следы людей —
 * шёпот, смех, разговор за стеной (audio/game_audio.ts).
 */
export const SCARES = ['steps', 'knock', 'radio', 'flicker', 'signs'] as const;
export type ScareId = (typeof SCARES)[number];

export type DirectorEvent =
  | { type: 'scare'; id: ScareId }
  /** Показать фигуру роя вдалеке (без охоты). */
  | { type: 'apparition' }
  /** Выпустить рой на охоту. */
  | { type: 'release' }
  /** Примета без тела: Осыпь проходит по месту вдали — грибы в углах у её пути, далёкий песок (ступени 1–2). */
  | { type: 'trace' };

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
  /**
   * Охота — после стольких вспомненных вещей, но не раньше первого явления (плейтест партнёра 19.11 и квиз: «показать в
   * первые моменты, но не сталкивать»; охота — «после первой вещи»). Не задано — только по времени и глубине.
   */
  releaseAfterGoals?: number;
  /** Через сколько секунд после glimpseAt — первое явление (не задано — через 8–22 с). */
  firstGlimpse?: number;
  /** Пауза между пугалками, от и до, с. */
  scareGap: [number, number];
  /** Глубина и взятые цели торопят рой (спуск на нижний ярус выпускает его сразу). false — только время. */
  byDepth: boolean;
  /** Первая пугалка не раньше этого, с; не задано — через 18–32 с (дать осмотреться). */
  firstScare?: number;
  /**
   * Приметы без тела (K-18): первая — в эту секунду, дальше — с такой паузой, от и до. Только пока рой не мелькал
   * и не охотился; не задано — примет нет.
   */
  traceAt?: number;
  traceGap?: [number, number];
  /**
   * Одна охота за сон (Z-19, приём 5 «Одна охота, потом передышка»): когда охота кончилась (луч рассыпал Осыпь, она поймала
   * или ходит слишком долго), до конца сна — только приметы, с такой паузой, от и до, с; первая — через первую паузу. Ни
   * явлений, ни новой охоты. Не задано — охота идёт, как шла.
   */
  oneHunt?: [number, number];
}

/** Сколько секунд охота «после вещи» ждёт первого явления, если его всё не удаётся поставить. */
export const GLIMPSE_WAIT = 30;

export const DEFAULT_DIRECTOR: DirectorConfig = { glimpseAt: 75, releaseAt: 210, scareGap: [28, 55], byDepth: true };

/**
 * Первая сессия игрока — мягче (слова партнёра 16.11 23:41: «Монстр сильно часто нападает в первой сессии,
 * сложно найти предметы»): рой мелькает с третьей минуты и выходит на охоту только с пятой — по времени, а не
 * по спуску (в первой сессии убежище двухъярусное, и спуск на второй ярус выпускал рой сразу).
 */
export const FIRST_DIRECTOR: DirectorConfig = { glimpseAt: 150, releaseAt: 300, scareGap: [28, 55], byDepth: false };

export class Director {
  /** 0 — только ложные события, 1 — рой мелькает, 2 — рой охотится. */
  phase: 0 | 1 | 2 = 0;
  private nextScare: number;
  private nextGlimpse = Infinity;
  private last: ScareId | null = null;
  private released = false;
  private nextTrace: number;
  /** Сколько явлений удалось показать: охота по найденным вещам ждёт первого (releaseAfterGoals). */
  private glimpses = 0;
  /** Когда начались явления (фаза 1). */
  private glimpseFrom = Infinity;
  /** Охота кончилась насовсем (oneHunt): дальше только приметы. */
  private settled = false;

  constructor(
    private readonly rng: Rng,
    readonly cfg: DirectorConfig = DEFAULT_DIRECTOR,
  ) {
    // Первая пугалка — не сразу: дать осмотреться.
    this.nextScare = cfg.firstScare ?? 18 + rng() * 14;
    this.nextTrace = cfg.traceAt ?? Infinity;
  }

  /** Продолжить после загрузки сохранения: пугалки не сыплются разом; released — рой уже был на охоте и выйдет снова. */
  restore(time: number, released: boolean): void {
    this.nextScare = time + 10 + this.rng() * 15;
    if (this.cfg.traceAt !== undefined) this.nextTrace = Math.max(this.cfg.traceAt, time + 20);
    if (released) this.phase = 2;
  }

  /**
   * Явление не удалось поставить (нет узла на виду): не считать его и попробовать снова через пару секунд — первое
   * явление должно случиться в первую минуту, а не через полминуты-минуту.
   */
  missedGlimpse(time: number): void {
    this.glimpses = Math.max(0, this.glimpses - 1);
    this.nextGlimpse = time + 2;
  }

  /** Явления, которые игра показала. */
  get glimpsed(): number {
    return this.glimpses;
  }

  /** Рой уже выходил на охоту в этой вылазке. */
  get wasReleased(): boolean {
    return this.released;
  }

  /** Охота кончилась насовсем (oneHunt): до конца сна только приметы. */
  get isSettled(): boolean {
    return this.settled;
  }

  /** Через сколько секунд назначенное явление; Infinity — явлений сейчас не будет (не та фаза или охота кончилась). */
  glimpseIn(time: number): number {
    return this.phase === 1 && !this.settled ? this.nextGlimpse - time : Infinity;
  }

  /** Охота кончилась (игра решила: рассыпал, поймала, долго ходит); с oneHunt — насовсем, дальше только приметы. */
  settle(time: number): void {
    const gap = this.cfg.oneHunt;
    if (!gap || this.settled) return;
    this.settled = true;
    this.nextTrace = time + gap[0];
  }

  update(inp: DirectorInput): DirectorEvent[] {
    const ev: DirectorEvent[] = [];
    const c = this.cfg;
    const deep = inp.tier >= 1;
    if (this.phase === 0 && (inp.time >= c.glimpseAt || (deep && c.byDepth))) {
      this.phase = 1;
      this.glimpseFrom = inp.time;
      this.nextGlimpse = inp.time + (c.firstGlimpse ?? 8 + this.rng() * 14);
    }
    // На охоту рой выходит по времени, по глубине или когда игрок, спустившись, взял первую цель; с releaseAfterGoals —
    // когда вспомнено столько вещей и Осыпь уже показалась (а если показать её негде — игрок стоит в тесной комнате, —
    // не дольше GLIMPSE_WAIT после начала явлений: иначе охота не началась бы вовсе).
    const shown = this.glimpses > 0 || inp.time - this.glimpseFrom >= GLIMPSE_WAIT;
    const byGoals = c.releaseAfterGoals !== undefined && inp.goalsDone >= c.releaseAfterGoals && shown;
    if (this.phase === 1 && (inp.time >= c.releaseAt || byGoals || (c.byDepth && (inp.tier >= Math.max(1, inp.tiers - 1) || (deep && inp.goalsDone >= 1))))) this.phase = 2;

    if (this.phase === 1 && !this.settled && inp.time >= this.nextGlimpse && !inp.swarmBusy) {
      ev.push({ type: 'apparition' });
      this.glimpses += 1;
      this.nextGlimpse = inp.time + 35 + this.rng() * 30;
    }
    if (this.phase === 2 && !this.released && !inp.swarmBusy) {
      this.released = true;
      ev.push({ type: 'release' });
    }
    // Приметы — и между явлениями, пока Осыпь не охотится (на ступенях 1–2 она теперь и видна, и оставляет следы); после
    // единственной охоты сна (oneHunt) — только они.
    if ((this.phase <= 1 || this.settled) && inp.time >= this.nextTrace && !inp.swarmBusy) {
      ev.push({ type: 'trace' });
      const [lo, hi] = (this.settled ? this.cfg.oneHunt : undefined) ?? this.cfg.traceGap ?? [90, 140];
      this.nextTrace = inp.time + lo + this.rng() * (hi - lo);
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
