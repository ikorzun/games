/**
 * «Камкордер»: ядро презентации под документальную съёмку бытовой видеокамерой 1995–2000
 * (решение владельца 2026-10-10). Картинки в игре чистые — дрожание, помехи и зерно добавляет
 * рантайм поверх них. Этот модуль — ЧИСТОЕ ядро без DOM, времени и случайности «снаружи»:
 * ГСЧ и время приходят аргументами, поэтому поведение полностью проверяется тестами
 * (tests/camcorder.test.ts). DOM-часть (CSS-трансформация обёртки кадра, один canvas шума,
 * HUD) — camcorder_layer.ts.
 *
 * Что считает планировщик (CameraScheduler):
 *  - ручная камера: непрерывный медленный шум (сумма синусов со случайными фазами, веса ~ 1/f).
 *    Предел при уровне «слабо»: сдвиг ≤ 1,2 % кадра, поворот ≤ 0,5°, масштаб 1,00–1,03. Масштаб —
 *    «кроп стабилизатора»: ровно столько, чтобы края картинки никогда не показывались;
 *    сила по режиму показа — presets.ts (reconstruction 1, procedural и montage 0,5, talking_head 0,25,
 *    остальные — штатив);
 *  - «оператор поправил кадр» при входе в сцену: быстрый сдвиг/наклон 2–4 % за 300–500 мс (ease-out),
 *    в ~25 % случаев — «неожиданный ракурс»: поворот до 2° и смещение, оседающее 2–3 с;
 *  - помехи: раз в 20–45 с (в `vhs_heavy` — 6–12 с, чуть сильнее) всплеск 150–500 мс: полоса трекинга,
 *    мерцание яркости, хроматический сдвиг;
 *  - короткий «разрыв кадра» для fx vhs_glitch (рывки по вертикали и горизонтали + шумовая полоса);
 *  - стоп-кадр (freeze): движение и помехи замирают.
 *
 * Время внутри планировщика — собственные «часы»: step(now) прибавляет не больше MAX_DT мс, поэтому
 * после паузы платформы или скрытой вкладки движение продолжается плавно, а помеха не вылетает сразу.
 */
import type { CameraFx } from '../core/settings';
import type { StageFilter } from '../core/types';

export type { CameraFx } from '../core/settings';

// ───────────────────────────── случайность ─────────────────────────────

/** Источник случайных чисел [0, 1). В игре — mulberry32 от времени, в тестах — фиксированное зерно. */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (rng: Rng, lo: number, hi: number): number => lo + (hi - lo) * rng();
const sign = (rng: Rng): number => (rng() < 0.5 ? -1 : 1);
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// ───────────────────────────── пределы и уровни ─────────────────────────────

/** Предел дрожания при уровне «слабо» (числа владельца). */
export const SHAKE = {
  /** Сдвиг по каждой оси, % кадра. */
  shiftPct: 1.2,
  /** Поворот, градусы. */
  rotDeg: 0.5,
  /** Верхняя граница масштаба в покое. */
  scaleMax: 1.03,
  /** «Дыхание»: медленное колебание масштаба, доля. */
  breath: 0.006,
} as const;

/** Масштаб, который допустим на время «оператор поправил кадр» (кроп стабилизатора). */
export const REFRAME_SCALE_MAX = 1.12;

/** Предел шага часов, мс: длинные паузы между вызовами step() «схлопываются». */
export const MAX_DT = 100;

/** Доля реконструкций, где вместо обычной поправки случается «неожиданный ракурс». */
export const ANGLE_SHARE = 0.25;

export interface LevelProfile {
  /** Множитель амплитуды дрожания. */
  amp: number;
  /** Верхняя граница масштаба в покое (кроп стабилизатора). */
  scaleMax: number;
  /** Множитель размаха «оператор поправил кадр». */
  reframe: number;
  /** Интервал между всплесками помех, мс [мин, макс]. */
  burstGap: readonly [number, number];
  /** В фильтре vhs_heavy. */
  heavyGap: readonly [number, number];
  /** Длительность всплеска, мс. */
  burstMs: readonly [number, number];
  burstStrength: number;
  /** Максимальная непрозрачность зерна (доля, 0.05 = 5 %). */
  grain: number;
  /** Мягкая виньетка камкордера (непрозрачность слоя). */
  vignette: number;
  /** Непрозрачность строк интерлейса в vhs_heavy. */
  interlace: number;
}

/** «Слабо» (по умолчанию) — числа владельца; «сильно» — заметнее и чаще. «Выкл» профиля не имеет. */
export const LEVELS: Readonly<Record<Exclude<CameraFx, 'off'>, LevelProfile>> = {
  low: {
    amp: 1,
    scaleMax: SHAKE.scaleMax,
    reframe: 1,
    burstGap: [20_000, 45_000],
    heavyGap: [6_000, 12_000],
    burstMs: [150, 500],
    burstStrength: 1,
    grain: 0.045,
    vignette: 0.28,
    interlace: 0.07,
  },
  high: {
    amp: 1.6,
    scaleMax: 1.05,
    reframe: 1.35,
    burstGap: [10_000, 24_000],
    heavyGap: [4_000, 8_000],
    burstMs: [200, 600],
    burstStrength: 1.5,
    grain: 0.065,
    vignette: 0.36,
    interlace: 0.11,
  },
};

/** В `vhs_heavy` помехи «чуть сильнее». */
export const HEAVY_STRENGTH = 1.3;

export function levelProfile(level: CameraFx): LevelProfile | null {
  return level === 'off' ? null : LEVELS[level];
}

/** Максимальный байт альфы зерна (0..255) для уровня: непрозрачность × 255, округление вниз. */
export function grainAlphaMax(level: CameraFx): number {
  const p = levelProfile(level);
  return p ? Math.floor(p.grain * 255) : 0;
}

// ───────────────────────────── геометрия: кроп стабилизатора ─────────────────────────────

/**
 * Минимальный масштаб, при котором картинка, сдвинутая на (tx, ty) % кадра и повёрнутая на rotDeg,
 * всё ещё закрывает кадр целиком. aspect = ширина / высота кадра.
 */
export function coverScale(tx: number, ty: number, rotDeg: number, aspect: number): number {
  const W = aspect;
  const H = 1;
  const t = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const ox = (tx / 100) * W;
  const oy = (ty / 100) * H;
  let need = 1;
  for (const cx of [-W / 2, W / 2]) {
    for (const cy of [-H / 2, H / 2]) {
      // точка кадра относительно центра картинки, возвращённая обратным поворотом
      const dx = cx - ox;
      const dy = cy - oy;
      const px = cos * dx + sin * dy;
      const py = -sin * dx + cos * dy;
      need = Math.max(need, Math.abs(px) / (W / 2), Math.abs(py) / (H / 2));
    }
  }
  return need;
}

export interface Transform {
  /** % ширины кадра. */
  tx: number;
  /** % высоты кадра. */
  ty: number;
  rot: number;
  scale: number;
}

/**
 * Привести желаемое движение к пределу масштаба: масштаб = max(base, coverScale); если и он больше
 * maxScale — само движение пропорционально уменьшается, пока картинка не уложится.
 */
export function fitTransform(tx: number, ty: number, rot: number, aspect: number, base: number, maxScale: number): Transform {
  let k = 1;
  for (let i = 0; i < 8; i++) {
    const need = coverScale(tx * k, ty * k, rot * k, aspect);
    const scale = Math.max(base, need);
    if (scale <= maxScale + 1e-9) return { tx: tx * k, ty: ty * k, rot: rot * k, scale };
    k *= ((maxScale - 1) / (need - 1)) * 0.98;
  }
  return { tx: 0, ty: 0, rot: 0, scale: Math.min(base, maxScale) };
}

// ───────────────────────────── ручная камера: шум ─────────────────────────────

/** Частоты составляющих, Гц (медленно: оператор держит камеру, а не трясёт ею). */
const PARTIALS = [0.13, 0.31, 0.67, 1.3] as const;
const CHANNELS = 4; // x, y, поворот, дыхание

/** Сумма синусов со случайными фазами и весами ~ 1/f^0,7, нормированная так, что |значение| ≤ 1. */
export class HandheldNoise {
  private readonly freq: number[][] = [];
  private readonly phase: number[][] = [];
  private readonly weight: number[];

  constructor(rng: Rng) {
    const raw = PARTIALS.map((f) => Math.pow(f, -0.7));
    const sum = raw.reduce((a, b) => a + b, 0);
    this.weight = raw.map((w) => w / sum);
    for (let c = 0; c < CHANNELS; c++) {
      this.freq.push(PARTIALS.map((f) => f * between(rng, 0.9, 1.1)));
      this.phase.push(PARTIALS.map(() => rng() * Math.PI * 2));
    }
  }

  /** Канал 0..3 в момент t (секунды): значение в [-1, 1]. */
  value(channel: number, t: number): number {
    const f = this.freq[channel]!;
    const p = this.phase[channel]!;
    let v = 0;
    for (let j = 0; j < f.length; j++) v += this.weight[j]! * Math.sin(2 * Math.PI * f[j]! * t + p[j]!);
    return v;
  }
}

// ───────────────────────────── события ─────────────────────────────

export interface Reframe {
  t0: number;
  dur: number;
  dx: number;
  dy: number;
  drot: number;
  /** «Неожиданный ракурс»: поворот до 2° и долгое оседание. */
  angle: boolean;
}

/** Параметры «оператор поправил кадр» — выбираются при входе в сцену. */
export function makeReframe(rng: Rng, t0: number, strength: number): Reframe {
  const angle = rng() < ANGLE_SHARE;
  if (angle) {
    const mag = between(rng, 1.5, 3) * strength;
    const dir = rng() * Math.PI * 2;
    return {
      t0,
      dur: between(rng, 2000, 3000),
      dx: Math.cos(dir) * mag,
      dy: Math.sin(dir) * mag * 0.7,
      drot: sign(rng) * between(rng, 1.2, 2) * Math.min(1, strength),
      angle: true,
    };
  }
  const mag = between(rng, 2, 4) * strength;
  const dir = rng() * Math.PI * 2;
  return {
    t0,
    dur: between(rng, 300, 500),
    dx: Math.cos(dir) * mag,
    dy: Math.sin(dir) * mag * 0.7,
    drot: sign(rng) * between(rng, 0.4, 1) * Math.min(1, strength),
    angle: false,
  };
}

/** Остаток поправки в момент t (ease-out: сначала быстро, потом оседает). null — закончилась. */
export function reframeAt(r: Reframe, t: number): { dx: number; dy: number; drot: number } | null {
  const u = (t - r.t0) / r.dur;
  if (u >= 1) return null;
  const left = Math.pow(1 - Math.max(0, u), 3);
  return { dx: r.dx * left, dy: r.dy * left, drot: r.drot * left };
}

export interface Burst {
  t0: number;
  dur: number;
  strength: number;
  bandY0: number;
  bandSpeed: number;
  bandH: number;
  flickerHz: number;
  flickerPhase: number;
}

export interface BurstFrame {
  /** 0..1 — как далеко всплеск. */
  progress: number;
  /** Огибающая (вход/выход), 0..1. */
  envelope: number;
  strength: number;
  /** Центр полосы трекинга и её высота, доли высоты кадра. */
  bandY: number;
  bandH: number;
  /** Сдвиг яркости −1..1 (знак — светлее/темнее). */
  flicker: number;
  /** Хроматический сдвиг, доля ширины кадра. */
  chroma: number;
  /** Плотность «снега» в полосе, 0..1. */
  snow: number;
}

export function makeBurst(rng: Rng, t0: number, profile: LevelProfile, heavy: boolean): Burst {
  return {
    t0,
    dur: between(rng, profile.burstMs[0], profile.burstMs[1]),
    strength: between(rng, 0.6, 1) * profile.burstStrength * (heavy ? HEAVY_STRENGTH : 1),
    bandY0: between(rng, 0.08, 0.7),
    bandSpeed: between(rng, 0.0006, 0.0016),
    bandH: between(rng, 0.06, 0.14),
    flickerHz: between(rng, 14, 24),
    flickerPhase: rng() * Math.PI * 2,
  };
}

export function burstAt(b: Burst, t: number): BurstFrame | null {
  const el = t - b.t0;
  if (el < 0 || el >= b.dur) return null;
  const p = el / b.dur;
  const envelope = Math.min(1, p / 0.12, (1 - p) / 0.2);
  const e = Math.max(0, envelope);
  return {
    progress: p,
    envelope: e,
    strength: b.strength,
    bandY: b.bandY0 + b.bandSpeed * el,
    bandH: b.bandH,
    flicker: clamp(0.5 * b.strength * Math.sin(2 * Math.PI * b.flickerHz * (el / 1000) + b.flickerPhase) * e, -1, 1),
    chroma: 0.004 * b.strength * e,
    snow: clamp(b.strength * e, 0, 1),
  };
}

/** Один рывок «разрыва кадра». */
export interface Jolt {
  t0: number;
  dur: number;
  /** % кадра. */
  dx: number;
  dy: number;
  /** Положение шумовой полосы шва, доля высоты. */
  seamY: number;
  seamH: number;
}

export interface TearFrame {
  dx: number;
  dy: number;
  seamY: number;
  seamH: number;
  snow: number;
}

/** Серия рывков на `ms` миллисекунд: 3–6 рывков по 50–90 мс, амплитуда спадает к концу. */
export function makeTear(rng: Rng, t0: number, ms: number, strength = 1): Jolt[] {
  const n = clamp(Math.round(ms / 120), 3, 6);
  const out: Jolt[] = [];
  for (let i = 0; i < n; i++) {
    const dur = between(rng, 50, 90);
    const slot = Math.max(0, ms - dur) / n;
    const fade = 1 - (i / n) * 0.6;
    out.push({
      t0: t0 + i * slot + rng() * slot * 0.6,
      dur,
      dx: sign(rng) * between(rng, 0.5, 2.5) * fade * strength,
      dy: sign(rng) * between(rng, 3, 7) * fade * strength,
      seamY: between(rng, 0.2, 0.8),
      seamH: between(rng, 0.04, 0.09),
    });
  }
  return out;
}

export function tearAt(jolts: readonly Jolt[], t: number): TearFrame | null {
  for (const j of jolts) {
    if (t >= j.t0 && t < j.t0 + j.dur) return { dx: j.dx, dy: j.dy, seamY: j.seamY, seamH: j.seamH, snow: 1 };
  }
  return null;
}

// ───────────────────────────── кадр планировщика ─────────────────────────────

export interface CamFrame extends Transform {
  /** Помехи: полоса трекинга, мерцание, хроматический сдвиг. */
  burst: BurstFrame | null;
  /** «Разрыв кадра» (fx vhs_glitch); сдвиг tear добавляется к трансформации как есть. */
  tear: TearFrame | null;
  /** Стоп-кадр. */
  frozen: boolean;
  /** Эффекты камеры включены (уровень не off). */
  on: boolean;
}

export const IDLE_FRAME: CamFrame = { tx: 0, ty: 0, rot: 0, scale: 1, burst: null, tear: null, frozen: false, on: false };

export interface CameraContext {
  /** Сила дрожания режима показа, 0..1 (presets.handheld). */
  handheld: number;
  /** «Оператор поправил кадр» разрешён режимом показа. */
  reframe: boolean;
  filter: StageFilter;
}

export interface SchedulerOptions {
  rng: Rng;
  /** ширина / высота кадра. */
  aspect?: number;
  level?: CameraFx;
}

export class CameraScheduler {
  private readonly rng: Rng;
  private readonly noise: HandheldNoise;
  private aspect: number;
  private level: CameraFx;
  private ctx: CameraContext = { handheld: 0, reframe: false, filter: 'none' };
  private clock = 0;
  private shakeClock = 0;
  private last: number | null = null;
  private frozen = false;
  private reframes: Reframe[] = [];
  private jolts: Jolt[] = [];
  private burst: Burst | null = null;
  private nextBurstAt = Number.POSITIVE_INFINITY;
  /** Начала всплесков (для тестов и отладки). */
  readonly burstLog: number[] = [];

  constructor(opts: SchedulerOptions) {
    this.rng = opts.rng;
    this.noise = new HandheldNoise(opts.rng);
    this.aspect = opts.aspect ?? 16 / 9;
    this.level = opts.level ?? 'low';
    this.scheduleBurst(this.clock);
  }

  get currentLevel(): CameraFx {
    return this.level;
  }

  setAspect(aspect: number): void {
    if (Number.isFinite(aspect) && aspect > 0.2) this.aspect = aspect;
  }

  setLevel(level: CameraFx): void {
    if (level === this.level) return;
    this.level = level;
    this.reframes = [];
    this.jolts = [];
    this.burst = null;
    this.scheduleBurst(this.clock);
  }

  setContext(ctx: CameraContext): void {
    const heavyChanged = (ctx.filter === 'vhs_heavy') !== (this.ctx.filter === 'vhs_heavy');
    this.ctx = ctx;
    if (heavyChanged && this.burst === null) this.scheduleBurst(this.clock);
  }

  /** Вход в сцену: оператор поправляет кадр (если режим показа и уровень разрешают). */
  enterScene(): void {
    const p = levelProfile(this.level);
    if (!p || !this.ctx.reframe || this.ctx.handheld <= 0) return;
    this.reframes = [makeReframe(this.rng, this.shakeClock, p.reframe)];
  }

  /** Короткий «разрыв кадра» на ms (fx vhs_glitch и переход vhs_glitch). */
  glitch(ms: number): void {
    const p = levelProfile(this.level);
    if (!p) return;
    this.jolts = makeTear(this.rng, this.clock, ms, Math.min(1.4, p.burstStrength));
  }

  setFrozen(frozen: boolean): void {
    this.frozen = frozen;
  }

  get isFrozen(): boolean {
    return this.frozen;
  }

  /** Часы планировщика, мс (для тестов). */
  get time(): number {
    return this.clock;
  }

  private scheduleBurst(from: number): void {
    const p = levelProfile(this.level);
    if (!p) {
      this.nextBurstAt = Number.POSITIVE_INFINITY;
      return;
    }
    const gap = this.ctx.filter === 'vhs_heavy' ? p.heavyGap : p.burstGap;
    this.nextBurstAt = from + between(this.rng, gap[0], gap[1]);
  }

  /** Продвинуть часы до `now` (мс, любой монотонный источник) и вычислить кадр. */
  step(now: number): CamFrame {
    const dt = this.last === null ? 0 : clamp(now - this.last, 0, MAX_DT);
    this.last = now;
    this.clock += dt;
    const p = levelProfile(this.level);
    if (!p) return IDLE_FRAME;
    if (!this.frozen) this.shakeClock += dt;

    // помехи: всплеск начинается в назначенный момент и планирует следующий (отсчёт от начала всплеска)
    if (!this.frozen && this.burst === null && this.clock >= this.nextBurstAt) {
      const heavy = this.ctx.filter === 'vhs_heavy';
      this.burst = makeBurst(this.rng, this.nextBurstAt, p, heavy);
      this.burstLog.push(this.burst.t0);
      this.scheduleBurst(this.burst.t0);
    }
    let burstFrame: BurstFrame | null = null;
    if (this.burst) {
      burstFrame = burstAt(this.burst, this.clock);
      if (!burstFrame && this.clock >= this.burst.t0 + this.burst.dur) this.burst = null;
    }

    // ручная камера
    const a = this.ctx.handheld * p.amp;
    const t = this.shakeClock / 1000;
    let tx = this.noise.value(0, t) * SHAKE.shiftPct * a;
    let ty = this.noise.value(1, t) * SHAKE.shiftPct * a;
    let rot = this.noise.value(2, t) * SHAKE.rotDeg * a;
    const breath = (0.5 + 0.5 * this.noise.value(3, t)) * SHAKE.breath * a;

    // поправка оператора (пока она идёт, допустимый масштаб больше); время поправки — часы дрожания,
    // поэтому стоп-кадр замораживает и её
    let maxScale = p.scaleMax;
    this.reframes = this.reframes.filter((r) => reframeAt(r, this.shakeClock) !== null);
    for (const r of this.reframes) {
      const o = reframeAt(r, this.shakeClock);
      if (!o) continue;
      tx += o.dx;
      ty += o.dy;
      rot += o.drot;
      maxScale = REFRAME_SCALE_MAX;
    }

    let fit: Transform = { tx: 0, ty: 0, rot: 0, scale: 1 };
    if (a > 0 || this.reframes.length > 0) fit = fitTransform(tx, ty, rot, this.aspect, 1 + breath, maxScale);

    // разрыв кадра: рывки добавляются как есть (открывшийся край закрывает шумовая полоса оверлея)
    const tear = this.jolts.length > 0 ? tearAt(this.jolts, this.clock) : null;
    if (this.jolts.length > 0 && this.clock > Math.max(...this.jolts.map((j) => j.t0 + j.dur))) this.jolts = [];

    return {
      tx: fit.tx + (tear?.dx ?? 0),
      ty: fit.ty + (tear?.dy ?? 0),
      rot: fit.rot,
      scale: fit.scale,
      burst: burstFrame,
      tear,
      frozen: this.frozen,
      on: true,
    };
  }
}

// ───────────────────────────── зерно (пиксели оверлея) ─────────────────────────────

/**
 * Один кадр зерна для canvas низкого разрешения: RGBA, серая точка случайной яркости с альфой
 * 0..maxAlpha (≤ 5 % = 13/255 при уровне «слабо»). Чистая функция от ГСЧ — проверяется тестом.
 */
export function fillGrain(buf: Uint8ClampedArray, rng: Rng, maxAlpha: number): void {
  for (let i = 0; i < buf.length; i += 4) {
    const bright = rng() < 0.5 ? 255 : 0;
    buf[i] = bright;
    buf[i + 1] = bright;
    buf[i + 2] = bright;
    buf[i + 3] = Math.floor(rng() * (maxAlpha + 1));
  }
}

// ───────────────────────────── моторный зум ─────────────────────────────

/** Амплитуда зума fx zoom_in при intensity 1: 1,00 → 1,12. */
export const ZOOM_AMOUNT = 0.12;
/** Перелёт: доля амплитуды, на которую зум проскакивает цель. */
export const ZOOM_OVERSHOOT = 0.12;
/** Максимальное размытие «поиска фокуса», px. */
export const ZOOM_HUNT_PX = 1;

const smooth = (u: number): number => u * u * (3 - 2 * u);

export interface ZoomSample {
  scale: number;
  /** Размытие, px. */
  blur: number;
}

/**
 * Кривая моторного зума камкордера: плавный разгон и торможение до `target` с небольшим перелётом,
 * затем возврат к цели; в конце «поиск фокуса» — размытие 0 → hunt px → 0. u ∈ [0, 1]. С fancy=false
 * (эффекты камеры выключены) — гладкий зум без перелёта и размытия.
 */
export function zoomCurve(u: number, target: number, fancy = true, hunt = ZOOM_HUNT_PX): ZoomSample {
  const x = clamp(u, 0, 1);
  if (!fancy) return { scale: 1 + (target - 1) * smooth(x), blur: 0 };
  const peak = target + (target - 1) * ZOOM_OVERSHOOT;
  const split = 0.72;
  let scale: number;
  if (x <= split) scale = 1 + (peak - 1) * smooth(x / split);
  else scale = peak + (target - peak) * smooth((x - split) / (1 - split));
  const f0 = 0.55;
  const blur = x <= f0 ? 0 : hunt * Math.pow(Math.sin(Math.PI * ((x - f0) / (1 - f0))), 2);
  return { scale, blur };
}

export interface ZoomKeyframe {
  offset: number;
  transform: string;
  filter: string;
}

/** Кривая зума, нарезанная на ключевые кадры для Web Animations API. */
export function zoomKeyframes(target: number, fancy = true, steps = 24): ZoomKeyframe[] {
  const out: ZoomKeyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const s = zoomCurve(u, target, fancy);
    out.push({ offset: u, transform: `scale(${s.scale.toFixed(4)})`, filter: s.blur > 0.01 ? `blur(${s.blur.toFixed(2)}px)` : 'none' });
  }
  return out;
}
