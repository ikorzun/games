/**
 * Странные комнаты (партнёр 21.11, 19:06: «еще придумай 5 комнат с подобных подходом»; поручение строить — 25.11; карточки
 * K-29, K-31, K-32, K-33 в docs/vylazka/ideas.md; design.md, §37.1). Подход — как у белой комнаты (systems/warp.ts): одна
 * вещь посередине, касание даёт пять секунд другого ощущения, потом оно мягко уходит.
 *
 * Чистая логика: по времени с касания — что сейчас с кадром, шагом и звуком. Сама комната — world/furnish_odd.ts, кадр — game.ts.
 *
 * Баян — сжатие: стены сходятся к герою, кадр сужается (телевик), слышно сердце, баян тянет аккорд; через пять секунд вдох.
 * Потолок не провисает: провисающий потолок — знак настоящей угрозы (давление), его здесь нет (куратор, K-31).
 * Аквариум — тяжесть героя, а не время мира: шаг втрое медленнее, звук глохнет, как под водой, за движением тянется след.
 * Зал ожидания остаётся единственным местом, где время идёт вместе с игроком (куратор, K-29, противоречие 374).
 * Телевизор — дребезжание: кадр мелко дрожит, без скачков яркости (куратор, K-32, противоречие 373).
 * Шарик — расширение и невесомость: потолок уходит вверх, обзор чуть раскрывается, героя мягко поднимает, ход — скольжением.
 * Камера всегда ровная: ни крена, ни поворотов, которых игрок не делал.
 *
 * Тихий режим (системная «меньше движения» или «почти незаметные» вспышки): движения вполовину, дрожи нет вовсе, следа нет.
 */
import { clamp01, smoothstep } from '../core/math';

export type OddKind = 'bayan' | 'aquarium' | 'tv' | 'balloon';
export const ODD_KINDS: readonly OddKind[] = ['bayan', 'aquarium', 'tv', 'balloon'];

/** Ход ощущения: за сколько набирается (in), до какой секунды с касания держится (hold) и за сколько уходит (out), с. */
export interface OddTiming {
  in: number;
  hold: number;
  out: number;
}

/**
 * Пять секунд у всех (hold). Баян выдыхает за секунду и вдыхает дольше; тяжесть наваливается быстро и отпускает вздохом;
 * дрожь — сразу; шарик поднимает и опускает медленнее всех.
 */
export const ODD_TIMING: Readonly<Record<OddKind, OddTiming>> = {
  bayan: { in: 1.0, hold: 5, out: 1.8 },
  aquarium: { in: 0.8, hold: 5, out: 1.6 },
  tv: { in: 0.35, hold: 5, out: 0.9 },
  balloon: { in: 1.8, hold: 5, out: 2.4 },
};

/** Сколько секунд после того, как ощущение ушло, вещь не отзывается снова (куратор 25.11: «с коротким перерывом»). */
export const ODD_COOLDOWN = 8;

/**
 * Сила ощущений. bayan: squeeze — какую долю расстояния до героя стены проходят к нему, fov — во сколько раз уже кадр.
 * aquarium: speed — множитель шага, muffle — насколько глохнет весь звук (0..1), trail — след длинной выдержки.
 * tv: jitter — размах дрожи кадра, рад. balloon: lift — на сколько поднимает героя, м; rise — на сколько уходит вверх потолок,
 * м; fov — во сколько раз шире кадр; glide — разгон и торможение, с (скольжение вместо шага).
 */
export const ODD = {
  bayan: { squeeze: 0.2, fov: 0.78 },
  aquarium: { speed: 1 / 3, muffle: 0.85, trail: 1 },
  tv: { jitter: 0.006 },
  balloon: { lift: 0.42, rise: 1.1, fov: 1.14, glide: 0.9 },
} as const;

export interface OddFrame {
  /** Насколько ощущение здесь, 0..1. */
  k: number;
  /** Баян: какую долю расстояния до героя стены прошли к нему (0 — на месте). */
  squeeze: number;
  /** Шарик: на сколько метров ушёл вверх потолок. */
  rise: number;
  /** Во сколько раз шире обзор (меньше единицы — уже). */
  fov: number;
  /** Множитель скорости шага. */
  speed: number;
  /** Время разгона и торможения шага, с (0 — как обычно). */
  glide: number;
  /** На сколько метров подняло камеру. */
  lift: number;
  /** Насколько глохнет весь звук, 0..1. */
  muffle: number;
  /** Сила следа длинной выдержки, 0..1. */
  trail: number;
  /** Размах дрожи кадра, рад. */
  jitter: number;
  /** Звук: сердце, аккорд баяна, тихие помехи телевизора, тон пустоты под шариком — 0..1. */
  heart: number;
  chord: number;
  hum: number;
  float: number;
}

export const ODD_NONE: OddFrame = { k: 0, squeeze: 0, rise: 0, fov: 1, speed: 1, glide: 0, lift: 0, muffle: 0, trail: 0, jitter: 0, heart: 0, chord: 0, hum: 0, float: 0 };

/** Насколько ощущение здесь через t секунд после касания: мягко набирается, держится до hold, мягко уходит. */
export function oddEnvelope(kind: OddKind, t: number): number {
  const c = ODD_TIMING[kind];
  if (t < 0 || t >= c.hold + c.out) return 0;
  return t <= c.hold ? smoothstep(0, c.in, t) : 1 - smoothstep(c.hold, c.hold + c.out, t);
}

/** Длится ли ещё ощущение через t секунд после касания. */
export const oddOn = (kind: OddKind, t: number): boolean => t >= 0 && t < ODD_TIMING[kind].hold + ODD_TIMING[kind].out;

/** Кадр ощущения через t секунд после касания; calm — тихий режим. */
export function oddAt(kind: OddKind, t: number, calm: boolean): OddFrame {
  const k = oddEnvelope(kind, t);
  if (k <= 0) return ODD_NONE;
  const half = calm ? 0.5 : 1;
  const f: OddFrame = { ...ODD_NONE, k };
  if (kind === 'bayan') {
    f.squeeze = ODD.bayan.squeeze * half * k;
    f.fov = 1 - (1 - ODD.bayan.fov) * half * k;
    // Сердце — сразу, как мехи пошли; аккорд — на выдохе, и тянется, пока комната не вдохнёт.
    f.heart = k;
    f.chord = k;
  } else if (kind === 'aquarium') {
    f.speed = 1 - (1 - ODD.aquarium.speed) * k;
    f.muffle = ODD.aquarium.muffle * k;
    // След — смаз кадра: в тихом режиме его нет.
    f.trail = calm ? 0 : ODD.aquarium.trail * k;
  } else if (kind === 'tv') {
    // «Почти незаметные» и «меньше движения» — без дрожи вовсе (куратор, K-32); остаются тихие помехи в звуке.
    f.jitter = calm ? 0 : ODD.tv.jitter * k;
    f.hum = k;
  } else {
    f.lift = ODD.balloon.lift * half * k;
    f.rise = ODD.balloon.rise * half * k;
    f.fov = 1 + (ODD.balloon.fov - 1) * half * k;
    f.glide = ODD.balloon.glide * (calm ? 0.6 : 1) * clamp01(k * 1.5);
    f.float = k;
  }
  return f;
}

/**
 * Дрожь кадра телевизора: сдвиг взгляда (рад, yaw и pitch) в миг time при размахе amp. Не случайный шум, а сумма несоизмеримых
 * синусов около 9–14 Гц: мелко и ровно, без рывков и без скачков яркости — двигается кадр, а не свет.
 */
export function oddJitter(time: number, amp: number): [number, number] {
  if (amp <= 0) return [0, 0];
  const y = Math.sin(time * 61.3) * 0.55 + Math.sin(time * 87.1 + 1.3) * 0.3 + Math.sin(time * 9.7 + 0.4) * 0.15;
  const p = Math.sin(time * 73.9 + 2.1) * 0.55 + Math.sin(time * 54.7 + 0.7) * 0.3 + Math.sin(time * 11.3 + 2.6) * 0.15;
  return [y * amp, p * amp];
}
