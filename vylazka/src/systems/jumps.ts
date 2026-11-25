/**
 * Скачки: когда и куда игрока выбрасывает из убежища. Поводы — простые действия и наблюдения:
 * щёлкнул фонарём, оживил заглохший фонарь, постоял в полной темноте, засмотрелся на вещь, вошёл
 * в «тонкое» помещение. Провал и газ выбрасывают всегда, Осыпь всегда возвращает в начало. Между скачками — пауза, чтобы игрок
 * терялся иногда, а не всё время. Чистая логика: игра исполняет план.
 */
import type { Rng } from '../core/rng';
import type { PocketKind } from '../world/pockets';

export type JumpCause = 'gaze' | 'thin' | 'light' | 'revive' | 'dark' | 'fall' | 'faint' | 'caught' | 'door' | 'return' | 'end' | 'begin' | 'edge' | 'seam';

/**
 * Как выглядит переход: cut — рывок с помехами; dissolve — место рассыпается в пыль;
 * blackout — свет гаснет, потом ты уже не там; whiteout — кадр выбеливается; seam — шов без следа: шагнул в чёрный проём песчаного
 * зала — и стоишь в его проёме, тем же шагом и тем же взглядом (game.ts, world/pocket_dunes.ts); или свет погас у шва офиса и
 * зажёгся — вокруг его жёлтая версия, а стоишь там же (world/seams.ts).
 */
export type JumpStyle = 'cut' | 'dissolve' | 'blackout' | 'whiteout' | 'seam';

/** twin — другая версия того же места на том же плане (шов офис ↔ жёлтые, world/seams.ts). */
export type JumpTarget = PocketKind | 'elsewhere' | 'scene' | 'limbo' | 'session' | 'twin';

export interface JumpPlan {
  cause: JumpCause;
  style: JumpStyle;
  /**
   * Куда: карманное пространство, другое место убежища, следующая сцена сна (другое место — сон из сцен), лимбо
   * между сессиями или новая сессия.
   */
  to: JumpTarget;
  /**
   * Для возврата в убежище (to: 'elsewhere') — куда именно: back — туда, откуда унесло; thing — поближе
   * к искомой вещи (дверь на лугу); far — подальше; start — в начало, туда, где вылазка началась
   * (так возвращает Осыпь); door — обратно в чёрный проём песчаного зала, наружу, тем же шагом. Не задано — решает случай; в сне из сцен такой скачок уносит в другое место
   * (следующую сцену), если она готова (docs/vylazka/pressure.md, §4.7).
   */
  dest?: 'back' | 'thing' | 'far' | 'start' | 'door';
}

export interface JumpsConfig {
  /** Первый случайный скачок не раньше этого времени от начала сессии, с. */
  firstAfter: number;
  /** Пауза между случайными скачками, с: от и до. */
  gapMin: number;
  gapMax: number;
  /** Сколько случайных скачков самое большее за сессию. */
  maxPerSession: number;
  /** Шансы поводов. */
  lightChance: number;
  reviveChance: number;
  /** Сколько стоять в полной темноте до скачка, с. */
  darkIdle: number;
}

export const DEFAULT_JUMPS: JumpsConfig = { firstAfter: 50, gapMin: 45, gapMax: 80, maxPerSession: 6, lightChance: 0.3, reviveChance: 0.35, darkIdle: 7 };

const POCKETS: readonly PocketKind[] = ['void', 'meadow', 'dollhouse', 'sunfield'];
/**
 * Вес кармана в случайном скачке. Красная комната забвения — единственный карман с делом (подсказывает, где забытое), и с
 * полем подсолнухов её доля упала бы с трети до четверти (куратор, 437): у неё двойной вес — после другого кармана она
 * выпадает в двух случаях из четырёх, после себя не выпадает, в итоге — снова треть скачков. Прочие — места без дела, поровну.
 */
export const POCKET_WEIGHT: Readonly<Partial<Record<PocketKind, number>>> = { dollhouse: 2 };

export class Jumps {
  /** Сколько секунд осталось до того, как случайный скачок снова возможен. */
  cooldown: number;
  count = 0;
  private lastPocket: PocketKind | null = null;
  private darkTime = 0;

  constructor(
    private readonly rng: Rng,
    readonly cfg: JumpsConfig = DEFAULT_JUMPS,
  ) {
    this.cooldown = cfg.firstAfter;
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
  }

  private get ready(): boolean {
    return this.cooldown <= 0 && this.count < this.cfg.maxPerSession;
  }

  /** Следующее карманное пространство: не то же, что в прошлый раз. */
  nextPocket(): PocketKind {
    const pool = POCKETS.filter((p) => p !== this.lastPocket);
    const w = (p: PocketKind): number => POCKET_WEIGHT[p] ?? 1;
    let r = this.rng() * pool.reduce((sum, p) => sum + w(p), 0);
    let p: PocketKind = pool[pool.length - 1] ?? 'void';
    for (const q of pool) {
      r -= w(q);
      if (r < 0) {
        p = q;
        break;
      }
    }
    this.lastPocket = p;
    return p;
  }

  private spend(plan: JumpPlan): JumpPlan {
    this.count += 1;
    this.cooldown = this.cfg.gapMin + this.rng() * (this.cfg.gapMax - this.cfg.gapMin);
    this.darkTime = 0;
    return plan;
  }

  /** Куда выбросит случайный скачок: чаще в карман, иногда просто в другое место убежища. */
  private somewhere(): JumpTarget {
    return this.rng() < 0.7 ? this.nextPocket() : 'elsewhere';
  }

  /** Игрок включил фонарь после того, как сам его выключил. */
  onLightOn(): JumpPlan | null {
    if (!this.ready || this.rng() >= this.cfg.lightChance) return null;
    return this.spend({ cause: 'light', style: 'cut', to: this.somewhere() });
  }

  /** Заглохший фонарь ожил. */
  onRevive(): JumpPlan | null {
    if (!this.ready || this.rng() >= this.cfg.reviveChance) return null;
    return this.spend({ cause: 'revive', style: 'cut', to: this.somewhere() });
  }

  /** Шаг в полной темноте: dark — света нет вовсе, still — игрок стоит. */
  onDark(dt: number, dark: boolean, still: boolean): JumpPlan | null {
    this.darkTime = dark && still ? this.darkTime + dt : 0;
    if (!this.ready || this.darkTime < this.cfg.darkIdle) return null;
    return this.spend({ cause: 'dark', style: 'blackout', to: this.somewhere() });
  }

  /** Игрок вошёл в «тонкое» помещение: оно рассыпается. */
  onThin(): JumpPlan | null {
    if (!this.ready) return null;
    return this.spend({ cause: 'thin', style: 'dissolve', to: this.nextPocket() });
  }

  /** Выросшая под взглядом вещь накрыла игрока. to — пространство, в которое ведёт эта вещь. */
  onEngulf(to: PocketKind | null): JumpPlan {
    return this.spend({ cause: 'gaze', style: 'whiteout', to: to ?? this.nextPocket() });
  }

  /**
   * Обязательные скачки: провал, газ, Осыпь. Паузу между случайными они не трогают. Провал и газ
   * выбрасывают в карманное пространство; Осыпь возвращает в начало — туда, где вылазка началась.
   */
  forced(cause: 'fall' | 'faint' | 'caught'): JumpPlan {
    this.darkTime = 0;
    if (cause === 'fall') return { cause, style: 'whiteout', to: this.nextPocket() };
    if (cause === 'faint') return { cause, style: 'dissolve', to: this.nextPocket() };
    return { cause, style: 'blackout', to: 'elsewhere', dest: 'start' };
  }
}
