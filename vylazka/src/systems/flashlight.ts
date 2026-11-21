/**
 * Фонарь: заряд, случайные отказы контакта и оживление тряской. Чистый автомат без three.js.
 *
 *   on ──(отказ: сначала предупреждающее мерцание)──▶ dead ──(тряска набрала нужное)──▶ on
 *   on ◀──(кнопка)──▶ off
 *   dead, off ──(палец держат на кнопке, заряд дошёл до полного)──▶ вспышка ──▶ on      (телефон)
 *
 * Отказы чаще при низком заряде, в сырости, в панике и особенно рядом с роем: частое мерцание
 * и есть предупреждение игроку. Тряска шумит — об этом сообщает событие rattle.
 */
import { clamp01, smoothstep } from '../core/math';
import type { Rng } from '../core/rng';

export type LightState = 'on' | 'off' | 'dead';

export interface FlashlightConfig {
  /** Средний интервал между отказами в спокойных условиях, с. */
  meanFailInterval: number;
  /** После оживления отказ невозможен столько секунд. */
  graceAfterRevive: number;
  /** Первый отказ принудительно через столько секунд работы (0 — нет). Нужен обучению и техническому срезу. */
  firstFailAt: number;
  /** Сколько секунд энергичной тряски нужно, от и до. */
  reviveNeed: [number, number];
  /** За сколько секунд горения садится полный заряд. */
  drainSeconds: number;
  /**
   * Севшая батарейка отдыхает: пока фонарь не горит и его не трясут, заряд сам поднимается до rest (доля)
   * со скоростью restRate в секунду — как у настоящей батарейки, которой дали полежать. 0 — не отдыхает.
   */
  rest: number;
  restRate: number;
  /**
   * Зарядка удержанием (телефон; слова партнёра 17.11 08:42: «на нем нужно удерживать палец для зарядки»): пока
   * палец на кнопке фонаря, заряд растёт на crankRate в секунду. Свет зажигается, только когда заряд полный и палец
   * держат не меньше crankMin секунд — случайное касание ничего не включает и не выключает.
   */
  crankRate: number;
  crankMin: number;
  /**
   * Вспышка на полном заряде («после того как полностью заряжается, есть на секунду вспышка света и уже стандартный
   * свет»): сколько длится, с, и во сколько раз луч ярче обычного в первый миг.
   */
  flashTime: number;
  flashPeak: number;
}

/**
 * Фонарь светит до отказа на 30 % дольше прежнего (слова партнёра 16.11 23:41: «Действие фонаря нужно
 * удлинить на 30%»): средний промежуток между отказами, передышка после оживления и заряд батарейки — ×1,3.
 */
export const LIGHT_LONGER = 1.3;

/** Меньше этого заряда тряска не поможет: батарейка села до конца — ей надо полежать (FlashlightConfig.rest). */
export const REVIVE_MIN = 0.02;

export const DEFAULT_FLASHLIGHT: FlashlightConfig = {
  meanFailInterval: 80 * LIGHT_LONGER,
  graceAfterRevive: 14 * LIGHT_LONGER,
  firstFailAt: 0,
  reviveNeed: [0.6, 1.5],
  drainSeconds: 540 * LIGHT_LONGER,
  // Севшая до нуля за полминуты темноты набирает 15 % — ещё на пару минут тусклого света.
  rest: 0.15,
  restRate: 0.005,
  // С нуля до полного — меньше трёх секунд темноты и шума; после обычного отказа — около секунды.
  crankRate: 0.35,
  crankMin: 0.6,
  flashTime: 1,
  flashPeak: 1.6,
};

/** Шум зарядки, 0..1: палец на кнопке трещит динамо — это слышит Осыпь, как тряску. */
export const CRANK_NOISE = 0.5;

/**
 * Горящему фонарю с зарядом выше этого заряжать нечего: касание ничего не меняет. Ровно 1 не годится — горящий
 * садится с первого же шага, и только что заряженный фонарь вспыхивал бы снова от каждого касания.
 */
export const CRANK_FULL = 0.98;

export interface FlashlightEnv {
  /** 0..1. */
  panic: number;
  /** 0..1: сырость вокруг (затопленный участок). */
  wet: number;
  /** 0..1: близость роя. */
  swarm: number;
  /** 0..1: уровень тряски из ShakeMeter. */
  shake: number;
  /**
   * Нужен ли здесь фонарь. false — место светло само (карманные пространства, лимбо): там фонарь сам не глохнет —
   * ни случайно, ни первым, обучающим отказом. Отказ, которого не видно, — не страх, а ловушка: игрок возвращается
   * в темноту с мёртвым фонарём и не знает, когда тот погас. Не задано — нужен.
   */
  needed?: boolean;
  /**
   * Вспышки «почти незаметные» (настройка заставки): мерцание мельче и медленнее, искры и вспышка заряда едва видны.
   * Не задано — мягкие (полных нет: слова партнёра 19.11, 15:59).
   */
  faint?: boolean;
}

/**
 * Мягкость света (слова партнёра 19.11: «вспышки всегда мягкие или почти незаметные»; правило куратора, пачка 50: «мягко —
 * значит медленно, а не темно»): провал мерцания держится не меньше hold секунд — значит, не больше трёх провалов в секунду, —
 * и наступает плавно, за tau; искра — набухает и гаснет, не чаще раза в sparkGap; вспышка полного заряда набухает и спадает
 * за flashTime, в середине — в flashPeak раз ярче («почти незаметные» — faintPeak).
 */
export const SOFT_LIGHT = { hold: 0.17, tau: 0.07, faintTau: 0.12, faintDepth: 0.45, sparkPeak: 0.35, faintSpark: 0.12, sparkGap: 0.34, faintPeak: 1.15 } as const;

export const CALM_ENV: FlashlightEnv = { panic: 0, wet: 0, swarm: 0, shake: 0 };

export interface FlashlightEvents {
  failed: boolean;
  revived: boolean;
  /** Короткая вспышка-искра при тряске заглохшего фонаря. */
  spark: boolean;
  /** Зарядка удержанием дошла до полного: вспышка, дальше обычный свет. */
  charged: boolean;
  clicked: boolean;
  /** Громкость дребезга за шаг, 0..1 (шум, который слышит рой). */
  rattle: number;
}

export class Flashlight {
  state: LightState = 'on';
  /** Заряд батарейки, 0..1. */
  charge = 1;
  /** Итоговая яркость с мерцанием, 0..~1.2: подаётся в шейдер. */
  intensity = 1;
  /** Прогресс оживления, 0..1 (для подсказки на экране). */
  reviveProgress = 0;
  /** Фонарь разобран (идёт замена батарейки): света нет, время не идёт. */
  suspended = false;

  /**
   * Батарейка села до нуля: тряска не поможет, пока она не отлежится до rest. Пока она «села», искр нет и
   * подсказка просит оставить фонарь в покое.
   */
  private flat = false;
  private sinceRevive = 0;
  private litTime = 0;
  private firstFailDone = false;
  /** > 0 — идёт предупреждающее мерцание перед отказом. */
  private dying = 0;
  private forced = false;
  private need = 1;
  private work = 0;
  private sparkLeft = 0;
  /** Сколько длится нынешняя искра, с, и сколько ещё ждать следующей. */
  private sparkLen = 0.15;
  private sparkCool = 0;
  /** > 0 — нестабильное мерцание сразу после оживления. */
  private unstable = 0;
  private flickerValue = 1;
  private flickerTarget = 1;
  private flickerHold = 0;
  /** Вспышка полного заряда сейчас: 0..1 по набуханию (для кадра — game.ts). */
  swell = 0;
  /** Палец на кнопке фонаря (телефон). */
  private holding = false;
  /** Сколько держат палец в этом нажатии, с. */
  private crankT = 0;
  /** Это нажатие уже кончилось вспышкой (или заряжать было нечего): дальше палец ничего не делает. */
  private crankDone = false;
  /** Остаток вспышки полного заряда, с. */
  private flashLeft = 0;

  constructor(
    private readonly rng: Rng,
    private readonly cfg: FlashlightConfig = DEFAULT_FLASHLIGHT,
  ) {}

  /** Кнопка фонаря. У заглохшего фонаря кнопка света не даёт (но щелчок слышен). */
  toggle(): void {
    if (this.state === 'on') this.state = 'off';
    else if (this.state === 'off') {
      this.state = !this.flat && this.charge >= REVIVE_MIN ? 'on' : 'dead';
      if (this.state === 'dead') this.beginDead();
    }
  }

  /**
   * Палец держат на кнопке фонаря (телефон; зовётся каждый шаг). Пока держат, фонарь заряжается; полный — вспышка
   * и обычный свет. Горит он при этом или нет, палец его не гасит: гасят отдельным жестом.
   */
  crank(on: boolean): void {
    if (on && !this.holding) {
      this.crankT = 0;
      // Горящему полному фонарю заряжать нечего: касание ничего не меняет, вспышки нет.
      this.crankDone = this.state === 'on' && this.charge >= CRANK_FULL;
    }
    this.holding = on;
  }

  /** Фонарь сейчас заряжают: палец на кнопке, а полного заряда с вспышкой ещё не было. */
  get cranking(): boolean {
    return this.holding && !this.crankDone && !this.suspended;
  }

  /** Вспышка полного заряда, 0..1: 1 — только что, 0 — прошла. */
  get flash(): number {
    return this.flashLeft / this.cfg.flashTime;
  }

  /** Вставить свежую батарейку: полный заряд, фонарь горит. */
  replaceBattery(): void {
    this.charge = 1;
    this.flat = false;
    this.state = 'on';
    this.dying = 0;
    this.sinceRevive = 0;
    this.unstable = 0.35;
    this.reviveProgress = 0;
  }

  /** Заставить фонарь мигать заданное время, не гася его (пугалка). */
  stutter(seconds: number): void {
    if (this.state === 'on') this.unstable = Math.max(this.unstable, seconds);
  }

  /** Принудительный первый отказ уже был: игрок знает, что фонарь трясут. */
  get taught(): boolean {
    return this.firstFailDone;
  }

  /** Зарядить батарейку полностью, не трогая состояние фонаря (вспомненная вещь возвращает свет). */
  recharge(): void {
    this.charge = 1;
    this.flat = false;
  }

  /** Батарейка села до нуля: тряска не поможет, пока она не отдохнёт. */
  get empty(): boolean {
    return this.charge <= 0;
  }

  /** Батарейка села и ещё не отлежалась: тряска не поможет, нужен покой. */
  get exhausted(): boolean {
    return this.flat;
  }

  /** Принудительный отказ (отладка, сценарные события). */
  forceFail(): void {
    if (this.state !== 'on') return;
    this.dying = 0;
    this.beginDead();
    // Об отказе сообщит следующий шаг: звук и вибрация у принудительного отказа те же, что у случайного.
    this.forced = true;
  }

  private beginDead(): void {
    this.state = 'dead';
    this.work = 0;
    this.reviveProgress = 0;
    const [lo, hi] = this.cfg.reviveNeed;
    this.need = lo + (hi - lo) * this.rng();
  }

  /**
   * Вероятность отказа в секунду при данных условиях. Садящаяся батарейка учащает отказы только на последней
   * четверти заряда, там же, где свет тускнеет: иначе обещанные «+30 % до отказа» таяли бы уже с полной.
   */
  hazard(env: FlashlightEnv): number {
    if (env.needed === false) return 0;
    const low = 1 - clamp01(this.charge / 0.25);
    return (1 / this.cfg.meanFailInterval) * (1 + 2.5 * low * low) * (1 + 2 * env.wet) * (1 + 1.5 * env.panic) * (1 + 6 * env.swarm);
  }

  update(dt: number, env: FlashlightEnv = CALM_ENV): FlashlightEvents {
    const ev: FlashlightEvents = { failed: false, revived: false, spark: false, charged: false, clicked: false, rattle: 0 };
    if (this.suspended) {
      this.intensity = 0;
      return ev;
    }
    this.sinceRevive += dt;
    if (this.forced) {
      this.forced = false;
      ev.failed = true;
    }

    // Фонарь заглох под лежащим пальцем (отказ после вспышки, обучающий отказ): зарядка начинается снова, отпускать и
    // нажимать заново не нужно — палец уже там, куда зовёт подсказка (нашёл куратор).
    if (this.holding && this.crankDone && this.state !== 'on' && !this.suspended) {
      this.crankDone = false;
      this.crankT = 0;
    }
    // Зарядка удержанием. Палец на кнопке держит и контакт: мерцание перед отказом обрывается. Севшей до нуля
    // батарейке отлёживаться не нужно — её заряжают. Не горящий фонарь под пальцем искрит, как динамо.
    if (this.cranking) {
      this.crankT += dt;
      this.flat = false;
      this.dying = 0;
      this.charge = Math.min(1, this.charge + this.cfg.crankRate * dt);
      ev.rattle = CRANK_NOISE;
      if (this.state !== 'on' && this.sparkCool <= 0 && this.rng() < 5 * dt) {
        this.spark();
        ev.spark = true;
      }
      if (this.charge >= 1 && this.crankT >= this.cfg.crankMin) {
        this.crankDone = true;
        if (this.state === 'dead') ev.revived = true;
        this.state = 'on';
        this.sinceRevive = 0;
        this.unstable = 0;
        this.work = 0;
        this.reviveProgress = 0;
        this.flashLeft = this.cfg.flashTime;
        ev.charged = true;
      }
    }

    if (this.state === 'on') {
      this.litTime += dt;
      this.charge = Math.max(0, this.charge - dt / this.cfg.drainSeconds);
      if (this.charge <= 0) {
        this.flat = this.cfg.rest > 0;
        this.beginDead();
        ev.failed = true;
      } else if (this.dying > 0) {
        this.dying -= dt;
        if (this.dying <= 0) {
          this.beginDead();
          ev.failed = true;
        }
      } else {
        // Принудительный первый отказ (обучение) передышку не ждёт; случайные — только после неё. Где светло и без
        // фонаря, обучающий отказ ждёт темноты: его надо увидеть.
        const forced = !this.firstFailDone && this.cfg.firstFailAt > 0 && this.litTime >= this.cfg.firstFailAt && env.needed !== false;
        const random = this.sinceRevive >= this.cfg.graceAfterRevive && this.rng() < this.hazard(env) * dt;
        if (forced || random) {
          this.firstFailDone = true;
          this.dying = 0.5 + this.rng() * 0.9;
        }
      }
    }
    // Отдых: пока фонарь не горит и его не трясут, севшая батарейка понемногу приходит в себя (ей надо
    // полежать). Трясти севшую — только мешать ей.
    if (this.state !== 'on' && env.shake <= 0.05 && this.charge < this.cfg.rest) this.charge = Math.min(this.cfg.rest, this.charge + this.cfg.restRate * dt);
    // Отлежалась — снова можно трясти.
    if (this.flat && this.charge >= this.cfg.rest - 1e-9) this.flat = false;
    if (this.state === 'dead') {
      // Трясти можно до последнего: пока в батарейке есть хоть что-то, тряска фонарь оживит. Севшая до нуля
      // только дребезжит, без искр, — оживлять нечего, пока она не отлежится.
      const can = !this.flat && this.charge >= REVIVE_MIN;
      if (env.shake > 0.05) {
        ev.rattle = env.shake;
        // Вялая тряска почти не помогает: вклад растёт быстрее уровня.
        if (can) this.work += Math.pow(env.shake, 1.3) * dt;
        if (can && this.sparkCool <= 0 && this.rng() < env.shake * 9 * dt) {
          this.spark();
          ev.spark = true;
        }
      }
      this.reviveProgress = clamp01(this.work / this.need);
      if (can && this.work >= this.need) {
        this.state = 'on';
        this.sinceRevive = 0;
        this.unstable = 0.5;
        this.reviveProgress = 0;
        ev.revived = true;
      }
    }

    this.updateIntensity(dt, env);
    return ev;
  }

  /** Искра: набухает и гаснет за 0,12–0,2 с; следующая — не раньше чем через SOFT_LIGHT.sparkGap после начала этой. */
  private spark(): void {
    this.sparkLen = 0.12 + this.rng() * 0.08;
    this.sparkLeft = this.sparkLen;
    this.sparkCool = Math.max(this.sparkLen, SOFT_LIGHT.sparkGap);
  }

  private updateIntensity(dt: number, env: FlashlightEnv): void {
    this.sparkLeft = Math.max(0, this.sparkLeft - dt);
    this.sparkCool = Math.max(0, this.sparkCool - dt);
    this.unstable = Math.max(0, this.unstable - dt);
    // Вспышка начинается с полного шага: первый кадр после заряда — самый яркий.
    const flash = this.flash;
    this.flashLeft = Math.max(0, this.flashLeft - dt);
    this.swell = 0;
    if (this.state === 'off') {
      this.intensity = 0;
      return;
    }
    if (this.state === 'dead') {
      // Искра: свет набухает и гаснет, а не дёргается по кадрам.
      const peak = env.faint ? SOFT_LIGHT.faintSpark : SOFT_LIGHT.sparkPeak;
      this.intensity = this.sparkLeft > 0 ? peak * Math.sin(Math.PI * (1 - this.sparkLeft / this.sparkLen)) : 0;
      return;
    }
    // Садящаяся батарейка: свет тускнеет на последней четверти заряда.
    const base = 0.3 + 0.7 * smoothstep(0, 0.25, this.charge);
    // Мерцание: перед отказом и после оживления — глубокое, рядом с Осыпью и в панике — заметнее. Провал держится не меньше
    // SOFT_LIGHT.hold (не больше трёх в секунду) и наступает плавно: раньше это были ступени по сотым секунды — до десяти
    // резких провалов в секунду (куратор, пачка 50, противоречие 316).
    this.flickerHold -= dt;
    if (this.flickerHold <= 0) {
      const strong = this.dying > 0 || this.unstable > 0;
      const depth = (strong ? 0.85 : 0.04 + 0.5 * env.swarm + 0.12 * env.panic) * (env.faint ? SOFT_LIGHT.faintDepth : 1);
      const chance = strong ? 0.55 : 0.08 + 0.5 * env.swarm;
      this.flickerTarget = this.rng() < chance ? 1 - depth * this.rng() : 1;
      this.flickerHold = SOFT_LIGHT.hold + this.rng() * (strong ? 0.2 : 0.3);
    }
    this.flickerValue += (this.flickerTarget - this.flickerValue) * (1 - Math.exp(-dt / (env.faint ? SOFT_LIGHT.faintTau : SOFT_LIGHT.tau)));
    // Вспышка полного заряда: луч набухает и за секунду спадает к обычному; в середине — в flashPeak раз ярче.
    this.swell = flash > 0 ? Math.sin(Math.PI * (1 - flash)) : 0;
    const peak = env.faint ? SOFT_LIGHT.faintPeak : this.cfg.flashPeak;
    this.intensity = base * this.flickerValue * (1 + (peak - 1) * this.swell);
  }
}
