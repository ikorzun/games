/**
 * Ход времени в зале ожидания (docs/vylazka/station.md).
 *
 * Пока игрок идёт, время места идёт вместе с ним, и он видит место таким, какое оно сейчас: остров
 * вокруг себя, дальше — россыпь точек. Остановился — и видит уже не место, а его снимок: зал собран
 * целиком, до дальней стены, тень не ползёт, никто не шевелится. Снимок красив и неверен: под ним
 * время идёт дальше, втрое медленнее, — просто этого не видно. Чем дольше стоишь, тем сильнее снимок
 * расходится с местом; сперва он начинает дрожать по краям, потом рвётся сам. Первый же шаг рвёт
 * его сразу: всё встаёт туда, где оно есть на самом деле.
 *
 * Неподвижность здесь — то же, что фонарь в тёмных местах: только стоя можно разглядеть и вспомнить.
 * И у неё та же цена: то, что разглядываешь, — уже прошлое.
 *
 * На времени места живёт всё, что в зале меняется: день (от полудня до темноты за DAY секунд), поезд
 * за окнами (раз в минуту-полторы в зале темнеет — за этим возвращается тронутое), Осыпь, распад
 * вещей, строки воспоминаний.
 *
 * Чистый TS: числа считаются здесь и проверяются тестами; случайности нет — поезда идут по сиду.
 */
import { hash01 } from '../core/rng';
import type { Vec3 } from '../core/types';

export interface FlowConfig {
  /** С какой скорости игрок считается идущим, м/с. */
  minSpeed: number;
  /** За сколько секунд время разгоняется и за сколько сходит на нет. */
  up: number;
  down: number;
  /** С какой скоростью время идёт под снимком, пока игрок стоит (доля обычного хода). */
  idle: number;
  /** Сколько секунд снимок держится ровно, и через сколько рвётся сам. */
  hold: number;
  tear: number;
  /** Длина дня в секундах времени места: полдень → темнота. */
  day: number;
  /** Поезд: промежуток между поездами (от и до) и сколько длится темнота, с времени места. */
  trainEvery: readonly [number, number];
  trainLen: number;
  /** Докуда зал собран, когда игрок стоит и когда идёт: [плотно, россыпь], м. */
  scanStill: readonly [number, number];
  scanMove: readonly [number, number];
  /**
   * Конус взгляда, градусы от его оси: [край, середина] — стоя и на ходу. Слова партнёра: «собрано
   * только там, куда смотрит герой». На ходу взгляд узок, как луч фонаря; стоя он раскрывается.
   */
  gazeStill: readonly [number, number];
  gazeMove: readonly [number, number];
  /** Угол зрения на ходу: во столько раз шире в зале и уже в тесном переходе. */
  fovWide: number;
  fovTight: number;
  /** Дрожь кадра на ходу и дрожь снимка перед тем, как он порвётся, радианы (амплитуда). */
  rattle: number;
  tremble: number;
}

export const DEFAULT_FLOW: FlowConfig = { minSpeed: 0.25, up: 0.4, down: 0.6, idle: 0.3, hold: 4, tear: 12, day: 420, trainEvery: [55, 85], trainLen: 3.2, scanStill: [18, 46], scanMove: [3, 11], gazeStill: [62, 36], gazeMove: [52, 25], fovWide: 1.14, fovTight: 0.9, rattle: 0.0022, tremble: 0.0035 };

/** Ниже этого хода времени игрок видит снимок, а не место. */
const FROZEN_BELOW = 0.15;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

export interface Sun {
  /** Направление на солнце (мир, единичный вектор). */
  dir: Vec3;
  /** Цвет прямого света с силой. */
  color: Vec3;
  /** Множитель рассеянного света, 0..1. */
  ambient: number;
}

export class Flow {
  /** Ход времени сейчас: 0 — стоит, 1 — идёт в полную силу. */
  f = 0;
  /** Время места, с. */
  t = 0;
  /** Время на снимке: пока игрок стоит, оно не идёт — он видит место таким, каким оно было. */
  viewT = 0;
  /** Игрок видит снимок. */
  frozen = true;
  /** Сколько секунд снимок уже держится. */
  drift = 0;
  /** Сколько поездов уже прошло и когда следующий (время места). */
  trains = 0;
  /** Сколько дней уже кончилось темнотой: после неё день начинается заново. */
  days = 0;
  private nextTrain: number;
  private trainAt = -1e9;

  constructor(
    private readonly seed: number,
    readonly cfg: FlowConfig = DEFAULT_FLOW,
  ) {
    this.nextTrain = this.gap(0) * 0.6;
  }

  private gap(i: number): number {
    const [a, b] = this.cfg.trainEvery;
    return mix(a, b, hash01(i * 13 + 5 + this.days * 101, 0x7a11, this.seed ^ 0x57a7));
  }

  /**
   * День начинается заново: стемнело, зал закрылся, игрок проснулся в начале. Часы — на полдень, поезда
   * идут по расписанию нового дня. Счёт поездов не сбрасывается: по нему звук узнаёт о новом поезде.
   */
  restart(): void {
    this.days += 1;
    this.t = 0;
    this.viewT = 0;
    this.drift = 0;
    this.trainAt = -1e9;
    this.nextTrain = this.gap(0) * 0.6;
  }

  /**
   * Перевести часы (отладка и тесты): время и снимок — на t. Поезд, который по расписанию ещё впереди
   * и не дальше обычного промежутка, остаётся; иначе следующий придёт через обычный промежуток.
   */
  seek(t: number): void {
    this.t = t;
    this.viewT = t;
    this.trainAt = -1e9;
    if (this.nextTrain <= t || this.nextTrain > t + this.cfg.trainEvery[1]) this.nextTrain = t + this.gap(this.trains);
  }

  /**
   * Шаг: dt — настоящее время кадра, speed — скорость игрока по полу, м/с. Возвращает, сколько прошло
   * времени места, и силу разрыва снимка в этом шаге (0 — снимок цел или его нет; до 1 — он порвался:
   * игрок шагнул или простоял слишком долго).
   */
  update(dt: number, speed: number): { wdt: number; tore: number } {
    const c = this.cfg;
    const target = speed > c.minSpeed ? 1 : 0;
    const tau = target > this.f ? c.up : c.down;
    this.f = target + (this.f - target) * Math.exp(-dt / Math.max(1e-3, tau));
    if (this.f < 1e-3) this.f = 0;
    const wdt = dt * (this.f + (1 - this.f) * c.idle);
    this.t += wdt;
    if (this.t >= this.nextTrain) {
      this.trainAt = this.nextTrain;
      this.trains += 1;
      this.nextTrain += this.gap(this.trains);
    }
    const was = this.frozen;
    this.frozen = this.f < FROZEN_BELOW;
    let tore = 0;
    if (this.frozen) {
      this.drift = was ? this.drift + dt : 0;
      // Снимок не держится вечно: порвался сам — и тут же сложился новый, уже с нынешнего места.
      if (this.drift >= c.tear) {
        tore = 1;
        this.drift = 0;
        this.viewT = this.t;
      }
      // Только что остановился: снимок снят с этой секунды.
      if (!was) this.viewT = this.t;
    } else {
      if (was) tore = clamp01(this.drift / (c.tear * 0.66));
      this.drift = 0;
      this.viewT = this.t;
    }
    return { wdt, tore };
  }

  /** Насколько снимок разошёлся с местом, 0..1: с этого начинается дрожь. */
  get strain(): number {
    return this.frozen ? smooth(this.cfg.hold, this.cfg.tear, this.drift) : 0;
  }

  /** Какая часть дня прошла, 0..1 (по времени места, а не по снимку). */
  get day(): number {
    return clamp01(this.t / this.cfg.day);
  }

  /** День кончился: зал закрывается. */
  get night(): boolean {
    return this.t >= this.cfg.day;
  }

  /** Тень поезда на то время, которое игрок видит, 0..1: быстро падает, держится, медленнее отпускает. */
  get train(): number {
    const x = (this.viewT - this.trainAt) / this.cfg.trainLen;
    if (x < 0 || x > 1) return 0;
    return smooth(0, 0.18, x) * (1 - smooth(0.62, 1, x));
  }

  /** Сколько времени места осталось до следующего поезда, с. */
  get toTrain(): number {
    return Math.max(0, this.nextTrain - this.t);
  }

  /**
   * Солнце: от высокого (62° над горизонтом) к низкому (9°), уходя к западу; к вечеру свет теплеет
   * и слабеет, в последнюю десятую дня гаснет совсем.
   */
  sun(): Sun {
    // Свет — тот, что на снимке: пока игрок стоит, тени не ползут.
    const d = clamp01(this.viewT / this.cfg.day);
    const el = mix(62, 9, smooth(0, 1, d)) * (Math.PI / 180);
    const az = mix(-0.5, 1.15, d);
    const dir: Vec3 = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
    const warm = smooth(0.35, 0.95, d);
    const power = (1 - 0.55 * smooth(0.5, 0.92, d)) * (1 - smooth(0.9, 1, d)) * (1 - 0.92 * this.train);
    const color: Vec3 = [1.5 * power, mix(1.42, 0.98, warm) * power, mix(1.3, 0.55, warm) * power];
    const ambient = (1 - 0.72 * smooth(0.55, 1, d)) * (1 - 0.95 * this.train);
    return { dir, color, ambient };
  }

  /** Докуда зал собран сейчас: [плотно, россыпь], м. */
  scan(): [number, number] {
    const c = this.cfg;
    // Собирается зал не сразу: сперва время должно почти встать.
    const k = smooth(0.05, 0.75, this.f);
    return [mix(c.scanStill[0], c.scanMove[0], k), mix(c.scanStill[1], c.scanMove[1], k)];
  }

  /** Конус взгляда сейчас, градусы: [край, середина]. Раскрывается и сужается вместе с тем, докуда зал собран. */
  gaze(): [number, number] {
    const c = this.cfg;
    const k = smooth(0.05, 0.75, this.f);
    return [mix(c.gazeStill[0], c.gazeMove[0], k), mix(c.gazeStill[1], c.gazeMove[1], k)];
  }

  /** Множитель угла зрения: в просторном месте на ходу шире, в тесном — уже. */
  fov(tight: boolean): number {
    const c = this.cfg;
    return mix(1, tight ? c.fovTight : c.fovWide, smooth(0, 1, this.f));
  }

  /** Дрожь кадра сейчас, радианы: на ходу — от хода времени (сильнее под поездом), стоя — от разошедшегося снимка. */
  rattle(): number {
    return this.cfg.rattle * this.f * (1 + 1.5 * this.train) + this.cfg.tremble * this.strain;
  }
}
