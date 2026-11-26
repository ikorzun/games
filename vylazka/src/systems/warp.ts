/**
 * Перекрут — то, что делает с героем цепь белой комнаты (партнёр 21.11, 19:06: «задевая который камеру игрока перекручивает и
 * весь мир становится широкоугольными на 5 секунд»; world/furnish_white.ts; design.md, §37).
 *
 * Чистая логика: по времени с касания — поворот камеры вокруг оси взгляда, во сколько раз шире обзор и сколько «бочки»
 * объектива. Камера делает полный оборот за 1,4 с: разгоняется и тормозит мягко, без рывка в начале и в конце. Обзор
 * раскрывается за 0,6 с — мир становится широкоугольным, края кадра растягиваются, — держится до пятой секунды и сходится
 * за 0,9 с. Управление не трогается: оборот — только кадр, ходить и смотреть можно как прежде.
 *
 * Тихий режим (системная настройка «меньше движения» или «почти незаметные» вспышки): без оборота — камеру лишь чуть ведёт
 * в сторону и обратно, а обзор раскрывается вполовину.
 */
import { clamp01, smoothstep } from '../core/math';

export interface WarpConfig {
  /** За сколько секунд камера делает полный оборот. */
  spin: number;
  /** За сколько раскрывается обзор, с. */
  open: number;
  /** До какой секунды с касания обзор широкий. */
  hold: number;
  /** За сколько сходится обратно, с. */
  close: number;
  /** Во сколько раз шире обзор (по вертикали). */
  fov: number;
  /** Сколько «бочки» объектива добавляется, когда обзор раскрыт (множитель BARREL в рендере: +lens). */
  lens: number;
  /** Тихий режим: на сколько радиан камеру ведёт вместо оборота. */
  calmTilt: number;
}

export const WARP: WarpConfig = { spin: 1.4, open: 0.6, hold: 5, close: 0.9, fov: 1.5, lens: 2.6, calmTilt: 0.12 };

export interface WarpFrame {
  /** Поворот камеры вокруг оси взгляда, рад (прибавляется к своему крену). */
  roll: number;
  /** Во сколько раз шире обзор. */
  fov: number;
  /** Сколько «бочки» прибавить к объективу. */
  lens: number;
  /** Насколько обзор раскрыт, 0..1. */
  open: number;
}

/** Плавный разгон и торможение: производная нулевая на концах. */
const ease = (x: number): number => {
  const t = clamp01(x);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** Кадр перекрута через t секунд после касания; dir — в какую сторону крутит; calm — тихий режим. */
export function warpAt(t: number, calm: boolean, dir: 1 | -1 = 1, cfg: WarpConfig = WARP): WarpFrame {
  if (t < 0 || t >= cfg.hold + cfg.close) return { roll: 0, fov: 1, lens: 0, open: 0 };
  const roll = calm ? dir * cfg.calmTilt * Math.sin(Math.PI * clamp01(t / cfg.spin)) : dir * Math.PI * 2 * ease(t / cfg.spin);
  const open = t <= cfg.hold ? smoothstep(0, cfg.open, t) : 1 - smoothstep(cfg.hold, cfg.hold + cfg.close, t);
  const k = calm ? 0.5 : 1;
  return { roll, fov: 1 + (cfg.fov - 1) * k * open, lens: cfg.lens * k * open, open };
}

/** Длится ли ещё перекрут через t секунд после касания. */
export const warpOn = (t: number, cfg: WarpConfig = WARP): boolean => t >= 0 && t < cfg.hold + cfg.close;
