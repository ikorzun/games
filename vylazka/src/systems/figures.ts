/**
 * Фигуры партнёра в игре: как они себя ведут (слова партнёра).
 * - Дымная висит в воздухе и при подходе рассеивается: «при подходе к дымным фигурам, они рассеиваются».
 *   Дым собирается снова сам, когда игрок отошёл, — это дым, ему не нужен погасший свет.
 * - Волосатая растворяется по анатомии — «от рук к телу»: кисти, предплечья, плечи, ступни, голени,
 *   бёдра, тело, голова (задержки — world/figure_mesh.ts, HAIR_ORDER). Растворяется, когда игрок почти
 *   вплотную, а возвращается по общему правилу вещей: «коснулся — растворилось; вернулось, когда свет
 *   погас и зажёгся» — в обратном порядке, от головы к рукам.
 * - Остальные — от касания, целиком, и возвращаются так же, после темноты.
 * Преград у фигур нет: сквозь них проходят, и как раз поэтому они уходят раньше, чем их коснёшься телом.
 *
 * Чистая логика: рендер читает поля фигуры, игра даёт положение глаз и свет.
 */
import type { Vec3 } from '../core/types';
import type { FigureMaterial } from '../world/figures';

export interface FigurePieceLive {
  /** Часть тела или вся фигура. */
  part: string;
  /** Задержка распада этой части от начала, с. */
  delay: number;
  /** 0 — на месте, 1 — растворилась. */
  dissolve: number;
}

export interface FigureLive {
  /** Ключ фигуры и номер экземпляра на уровне. */
  id: string;
  k: number;
  material: FigureMaterial;
  /** Точка фигуры (подошвы стоящего) и поворот. */
  at: Vec3;
  yaw: number;
  /** Середина тела в мире: от неё меряется, подошёл ли игрок. */
  core: Vec3;
  pieces: FigurePieceLive[];
  /** here — стоит; going — растворяется; gone — её нет; coming — собирается. */
  state: 'here' | 'going' | 'gone' | 'coming';
  /** Время в этом состоянии, с. */
  t: number;
  /** После того как она ушла, свет уже гас: зажжётся — вернётся. */
  dark: boolean;
  /** Сколько секунд подряд темно на её месте (мигание фонаря — не «свет погас»). */
  darkT: number;
  /** Подъём над точкой, м: дымная медленно ходит вверх-вниз. */
  bob: number;
  /** Редкость точек дымной (0 — сплошная). */
  dots: number;
  /** Фаза покачивания (своя у каждой). */
  phase: number;
}

export interface FiguresConfig {
  /** Дымная рассеивается, когда середина тела ближе, м; за сколько, с. */
  smokeNear: number;
  smokeGo: number;
  /** Дым собирается, когда игрок дальше этого, м, и не раньше чем через smokeRest, с; за smokeCome, с. */
  smokeAway: number;
  smokeRest: number;
  smokeCome: number;
  /** Волосатая растворяется, когда игрок ближе, м; одна часть растворяется за partTime, с. */
  hairNear: number;
  partTime: number;
  /** Остальные растворяются от касания (ближе touchNear, м) за goTime, с. */
  touchNear: number;
  goTime: number;
  /** Вернувшаяся после темноты собирается за comeTime, с; только если игрок не ближе comeAway, м. */
  comeTime: number;
  comeAway: number;
  /** Сколько секунд темнота должна продержаться, чтобы считаться «свет погас» (аудит K-21). */
  darkArm: number;
  /** Покачивание дымной: размах, м, и период, с. */
  bobAmp: number;
  bobPeriod: number;
}

export const DEFAULT_FIGURES: FiguresConfig = {
  smokeNear: 2.3,
  smokeGo: 1.5,
  smokeAway: 6,
  smokeRest: 7,
  smokeCome: 3.2,
  hairNear: 1.3,
  partTime: 0.7,
  touchNear: 0.75,
  goTime: 0.9,
  comeTime: 1.6,
  comeAway: 3,
  darkArm: 0.4,
  bobAmp: 0.035,
  bobPeriod: 5.3,
};

/** Что случилось с фигурой за шаг: ушла или вернулась (для звука). */
export interface FigureEvent {
  figure: FigureLive;
  what: 'gone' | 'back';
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export class Figures {
  readonly list: FigureLive[] = [];

  constructor(readonly cfg: FiguresConfig = DEFAULT_FIGURES) {}

  /** Поставить фигуру. core — середина тела в координатах фигуры; pieces — её части с задержками. */
  add(id: string, k: number, material: FigureMaterial, at: Vec3, yaw: number, core: Vec3, pieces: readonly { part: string; delay: number }[], dots: number): FigureLive {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const f: FigureLive = {
      id,
      k,
      material,
      at,
      yaw,
      core: [at[0] + core[0] * c + core[2] * s, at[1] + core[1], at[2] - core[0] * s + core[2] * c],
      pieces: pieces.map((p) => ({ part: p.part, delay: p.delay, dissolve: 0 })),
      state: 'here',
      t: 0,
      dark: false,
      darkT: 0,
      bob: 0,
      dots,
      phase: ((k * 0.61 + id.length * 0.37) % 1) * Math.PI * 2,
    };
    this.list.push(f);
    return f;
  }

  clear(): void {
    this.list.length = 0;
  }

  /** Насколько близко игрок должен подойти, чтобы фигура ушла, м. */
  near(f: FigureLive): number {
    return f.material === 'smoke' ? this.cfg.smokeNear : f.material === 'hair' ? this.cfg.hairNear : this.cfg.touchNear;
  }

  /** Самая долгая задержка части фигуры, с. */
  private span(f: FigureLive): number {
    let m = 0;
    for (const p of f.pieces) m = Math.max(m, p.delay);
    return m;
  }

  /**
   * Шаг: eye — глаза игрока; light(f) — сколько света там, где стоит фигура (0..1; гаснет ниже 0,08,
   * горит выше 0,45 — как у вещей). Возвращает, какие фигуры ушли и какие вернулись.
   */
  update(dt: number, eye: Vec3, time: number, light: (f: FigureLive) => number): FigureEvent[] {
    const cfg = this.cfg;
    const ev: FigureEvent[] = [];
    for (const f of this.list) {
      // Середина тела против груди игрока: высоко висящую фигуру проходят под ней, не задев.
      const d = Math.hypot(f.core[0] - eye[0], f.core[1] - (eye[1] - 0.45), f.core[2] - eye[2]);
      const smoke = f.material === 'smoke';
      const hair = f.material === 'hair';
      f.t += dt;
      // Дым покачивается только вверх от своего места: сидящая на скамье фигура не уходит в сиденье (куратор, пачка 52, 341).
      if (smoke) f.bob = cfg.bobAmp * (0.5 + 0.5 * Math.sin((time * Math.PI * 2) / cfg.bobPeriod + f.phase));
      // Подошёл к стоящей или к той, что ещё собирается, — уходит (с того, что успело собраться).
      if (f.state === 'here' || f.state === 'coming') {
        if (d < this.near(f)) {
          f.state = 'going';
          f.t = 0;
          ev.push({ figure: f, what: 'gone' });
        }
      }
      if (f.state === 'going') {
        const go = smoke ? cfg.smokeGo : hair ? cfg.partTime : cfg.goTime;
        let all = true;
        for (const p of f.pieces) {
          if (f.t >= (hair ? p.delay : 0)) p.dissolve = clamp01(p.dissolve + dt / go);
          if (p.dissolve < 1) all = false;
        }
        if (all) {
          f.state = 'gone';
          f.t = 0;
          f.dark = false;
          f.darkT = 0;
        }
      } else if (f.state === 'gone') {
        if (smoke) {
          if (f.t > cfg.smokeRest && d > cfg.smokeAway) {
            f.state = 'coming';
            f.t = 0;
            ev.push({ figure: f, what: 'back' });
          }
        } else {
          const l = light(f);
          if (l < 0.08) {
            f.darkT += dt;
            if (f.darkT >= cfg.darkArm) f.dark = true;
          } else {
            f.darkT = 0;
            if (f.dark && l > 0.45 && d > cfg.comeAway) {
              f.state = 'coming';
              f.t = 0;
              ev.push({ figure: f, what: 'back' });
            }
          }
        }
      } else if (f.state === 'coming') {
        // Собирается в обратном порядке: волосатая — от головы к рукам.
        const come = smoke ? cfg.smokeCome : hair ? cfg.partTime : cfg.comeTime;
        const span = hair ? this.span(f) : 0;
        let all = true;
        for (const p of f.pieces) {
          if (f.t >= (hair ? span - p.delay : 0)) p.dissolve = clamp01(p.dissolve - dt / come);
          if (p.dissolve > 0) all = false;
        }
        if (all) {
          f.state = 'here';
          f.t = 0;
        }
      }
    }
    return ev;
  }
}
