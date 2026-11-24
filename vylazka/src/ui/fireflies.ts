/**
 * Светлячки заставки (слова партнёра 19.11: «На фоне нужно что-то еле заметное, будто летают светлячки из точек как в игре
 * и тут же растворяются, нужно простое и магическое»).
 *
 * Светлячок — точка, как точки мира в игре: проступает за долю секунды, плывёт и тут же рассыпается на несколько точек
 * поменьше, которые расходятся и гаснут — так в игре вещь распадается в точки. Еле заметно: самая яркая точка — четверть
 * белого, тёплого, как луч фонаря; с ореолом и искрой поверх — не больше трети (свет складывается: искры рождаются в самом
 * светлячке, поэтому не вспыхивают, а проступают, пока расходятся; иначе в миг распада точка горела втрое ярче — смоук CI 19.11). Холст 2D под карточкой, без событий мыши; рисуется, только пока заставка на экране.
 * «Меньше движения» в системе — светлячков втрое меньше, плывут втрое медленнее, без распада.
 */

/** Сколько светлячков на миллион пикселей экрана (CSS) и пределы. */
// Партнёр 24.11: «частицы пыли на фоне сделай более заметнее и увеличь их количество» — втрое больше и в полтора раза ярче.
const DENSITY = 110;
const MIN_COUNT = 28;
const MAX_COUNT = 220;
/** Жизнь светлячка, с: проступает (доля RISE), светит, рассыпается. */
const LIFE: readonly [number, number] = [1.4, 3.6];
const RISE = 0.18;
/** На сколько точек рассыпается и за какое время они гаснут, с. */
const SPARKS: readonly [number, number] = [3, 6];
const SPARK_LIFE: readonly [number, number] = [0.5, 1.2];
/** Самая яркая точка (доля белого) и цвет — тёплый, как луч. */
const PEAK = 0.4;
const COLOR = '243, 226, 180';

interface Fly {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Сколько прожил и сколько всего, с. */
  age: number;
  life: number;
  /** Радиус точки, CSS-пиксели. */
  r: number;
  /** Фаза покачивания. */
  phase: number;
  /** Рассыпался ли уже (искры добавлены). */
  burst: boolean;
  /** Искра (true) — мельче, гаснет сразу и не рассыпается сама. */
  spark: boolean;
  /** Яркость в пике, доля PEAK. */
  glow: number;
}

/** Искра проступает за эту долю жизни: родившись в светлячке, она не складывается с ним в одну яркую точку. */
const SPARK_RISE = 0.2;

/** Доля жизни → яркость: быстро проступает, держится, гаснет к концу. */
export function flyAlpha(t: number, spark: boolean): number {
  if (t <= 0 || t >= 1) return 0;
  if (spark) return t < SPARK_RISE ? (t / SPARK_RISE) * (1 - SPARK_RISE) ** 2 : (1 - t) * (1 - t);
  if (t < RISE) return t / RISE;
  const k = (t - RISE) / (1 - RISE);
  return 1 - k * k;
}

/** Сколько светлячков держать на экране такого размера (CSS-пиксели). */
export function flyCount(w: number, h: number, reduced: boolean): number {
  const n = Math.round((w * h * DENSITY) / 1e6);
  const c = Math.min(MAX_COUNT, Math.max(MIN_COUNT, n));
  return reduced ? Math.max(4, Math.round(c / 3)) : c;
}

export class Fireflies {
  readonly el: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private flies: Fly[] = [];
  private raf = 0;
  private last = 0;
  private on = false;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private readonly reduced: boolean;
  private seed = 0x9e3779b9;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('canvas');
    this.el.className = 'vz-fireflies';
    this.el.setAttribute('aria-hidden', 'true');
    parent.prepend(this.el);
    this.ctx = this.el.getContext('2d');
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Показывать (заставка на экране) или нет. */
  setOn(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    if (on && this.ctx) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    } else if (!on) {
      cancelAnimationFrame(this.raf);
      this.flies = [];
      this.ctx?.clearRect(0, 0, this.el.width, this.el.height);
    }
  }

  /** Свой маленький ГСЧ: заставке не нужен общий. */
  private rnd(): number {
    this.seed = (this.seed + 0x6d2b79f5) >>> 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private span(r: readonly [number, number]): number {
    return r[0] + (r[1] - r[0]) * this.rnd();
  }

  private resize(): void {
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.el.width = Math.max(1, Math.round(w * dpr));
    this.el.height = Math.max(1, Math.round(h * dpr));
  }

  /** Новый светлячок в случайном месте; уже живущий — с случайного возраста, чтобы при открытии не вспыхнули все разом. */
  private spawn(midLife: boolean): Fly {
    const speed = (this.reduced ? 2 : 6) + this.rnd() * (this.reduced ? 3 : 10);
    const a = -Math.PI / 2 + (this.rnd() - 0.5) * 2.2;
    const life = this.span(LIFE) * (this.reduced ? 1.6 : 1);
    return {
      x: this.rnd() * this.w,
      y: this.rnd() * this.h,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      age: midLife ? this.rnd() * life : 0,
      life,
      r: 0.8 + this.rnd() * 1.2,
      phase: this.rnd() * Math.PI * 2,
      burst: false,
      spark: false,
      glow: 0.55 + this.rnd() * 0.45,
    };
  }

  /** Светлячок дожил до распада: несколько точек поменьше расходятся из него и гаснут. */
  private scatter(f: Fly): Fly[] {
    const n = Math.round(this.span(SPARKS));
    const out: Fly[] = [];
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2;
      const v = 8 + this.rnd() * 18;
      out.push({ x: f.x, y: f.y, vx: f.vx * 0.4 + Math.cos(a) * v, vy: f.vy * 0.4 + Math.sin(a) * v, age: 0, life: this.span(SPARK_LIFE), r: f.r * (0.35 + this.rnd() * 0.3), phase: 0, burst: true, spark: true, glow: f.glow * 0.8 });
    }
    return out;
  }

  private readonly frame = (now: number): void => {
    if (!this.on || !this.ctx) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.resize();
    if (this.w === 0 || this.h === 0) return;
    const want = flyCount(this.w, this.h, this.reduced);
    const whole = this.flies.filter((f) => !f.spark).length;
    for (let i = whole; i < want; i++) this.flies.push(this.spawn(this.flies.length === 0 || i < want / 2));
    const next: Fly[] = [];
    for (const f of this.flies) {
      f.age += dt;
      // Покачивание — медленный дрейф поперёк хода, как у мошки в луче.
      const sway = f.spark ? 0 : Math.sin(f.phase + f.age * 1.7) * 7;
      f.x += (f.vx + sway) * dt;
      f.y += f.vy * dt;
      if (f.spark) {
        f.vx *= 1 - dt * 1.8;
        f.vy *= 1 - dt * 1.8;
      }
      const t = f.age / f.life;
      // Ближе к концу жизни светлячок рассыпается (при «меньше движения» — просто гаснет).
      if (!f.spark && !f.burst && t > 0.62 && !this.reduced) {
        f.burst = true;
        next.push(...this.scatter(f));
      }
      if (t < 1) next.push(f);
    }
    this.flies = next;
    const c = this.ctx;
    const k = this.dpr;
    c.setTransform(k, 0, 0, k, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    c.globalCompositeOperation = 'lighter';
    for (const f of this.flies) {
      const a = flyAlpha(f.age / f.life, f.spark) * PEAK * f.glow;
      if (a < 0.004) continue;
      // Ореол — шире и вдесятеро тусклее точки: «светлячок», а не пиксель.
      c.fillStyle = `rgba(${COLOR}, ${(a * 0.1).toFixed(4)})`;
      c.beginPath();
      c.arc(f.x, f.y, f.r * 4, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = `rgba(${COLOR}, ${a.toFixed(4)})`;
      c.beginPath();
      c.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      c.fill();
    }
    c.globalCompositeOperation = 'source-over';
  };
}
