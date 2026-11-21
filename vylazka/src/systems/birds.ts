/**
 * Птицы. Слова партнёра (15.11): «Еще думаю добавить птиц, пока не понимаю куда и как» — и после
 * разбора (docs/vylazka/tricks.md, §3): «Добавляй все по эффектам и птиц».
 *
 * Птица — первое живое в игре, и нужна она не для украшения. В зале ожидания время идёт, только пока
 * идёт игрок; голуби под стеклянной крышей показывают этот закон без слов. Идёшь — они перелетают
 * с балки на балку. Остановился — видишь снимок: птица висит в воздухе с раскрытыми крыльями. Шагнул —
 * снимок рвётся, и она уже на другой балке: под снимком время шло.
 *
 * Поэтому стая (Flock) — чистая функция времени места: у каждой птицы расписание «сидит — летит —
 * сидит», посчитанное от сида, и позу в любой миг можно спросить заново. Скачок времени вперёд или
 * назад (разрыв снимка, новый день) ничего не ломает.
 *
 * Вторая птица (Leaver) живёт по обычному времени: она сидит, пока к ней не подошли, срывается — и
 * либо улетает вверх и не возвращается (комната под звёздным небом), либо пересаживается под крышу.
 * Это единственное в игре, что уходит само, а не рассыпается от касания.
 *
 * Чистый TS: рендер получает готовые позы (render: setBirds).
 */
import { hash01 } from '../core/rng';
import type { Vec3 } from '../core/types';

/** Место, где птица сидит: точка под лапами и куда она смотрит (поворот вокруг вертикали, рад; 0 — вдоль +z). */
export interface Perch {
  pos: Vec3;
  yaw: number;
}

export interface BirdPose {
  pos: Vec3;
  /** Куда смотрит: поворот вокруг вертикали, наклон носа вверх, крен; рад. */
  yaw: number;
  pitch: number;
  roll: number;
  /** Фаза взмаха, рад. */
  flap: number;
  /** Раскрытие крыльев, 0..1: 0 — сидит, сложив. */
  open: number;
  flying: boolean;
}

export interface BirdsConfig {
  /** Сколько птица сидит на месте, с: от и до. */
  sit: [number, number];
  /** Скорость полёта, м/с, и самый короткий перелёт, с. */
  speed: number;
  minFlight: number;
  /** Перелёт проседает под балки: доля длины пути и пределы, м. */
  dip: number;
  dipMin: number;
  dipMax: number;
  /** Путь изогнут вбок: доля длины. */
  curve: number;
  /** Взмахов в секунду. */
  beat: number;
  /** За сколько секунд крылья раскрываются на взлёте и складываются на посадке. */
  unfold: number;
  /** Спугнутая птица: с какого расстояния срывается, м; сколько секунд её ещё видно; скорость набора высоты, м/с. */
  scare: number;
  leave: number;
  climb: number;
}

export const DEFAULT_BIRDS: BirdsConfig = { sit: [6, 12], speed: 5.5, minFlight: 1.6, dip: 0.16, dipMin: 0.7, dipMax: 2.2, curve: 0.1, beat: 7, unfold: 0.32, scare: 3.6, leave: 5.5, climb: 2.4 };

const TAU = Math.PI * 2;
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Где птица на перелёте из a в b в доле пути u (0..1): проседает под балки и идёт дугой вбок. */
function along(a: Vec3, b: Vec3, u: number, dip: number, bend: number): Vec3 {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const arc = Math.sin(Math.PI * u);
  return [a[0] + dx * u - dz * bend * arc, a[1] + (b[1] - a[1]) * u - dip * arc, a[2] + dz * u + dx * bend * arc];
}

/** Поза в полёте по пути p(u): нос — по скорости, крен — в сторону поворота. */
function flightPose(p: (u: number) => Vec3, u: number, bend: number, flap: number, open: number): BirdPose {
  const e = 0.01;
  const u0 = Math.max(0, Math.min(1 - e, u));
  const a = p(u0);
  const b = p(u0 + e);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const l = Math.hypot(dx, dy, dz) || 1;
  return { pos: p(u), yaw: Math.atan2(dx, dz), pitch: Math.asin(Math.max(-1, Math.min(1, dy / l))), roll: -bend * 3.2 * Math.sin(Math.PI * u), flap, open, flying: true };
}

interface Cursor {
  /** Номер цикла «сидит — летит» и время его начала. */
  k: number;
  start: number;
}

/**
 * Стая под крышей. Расписание птицы i: цикл k начинается на месте a(i, k), птица сидит S(i, k) секунд,
 * потом летит на место a(i, k + 1). Всё — от сида; pose(i, t) можно звать с любым t.
 */
export class Flock {
  private readonly cursor: Cursor[] = [];
  /** Места птицы по циклам: считаются подряд от нулевого, поэтому не зависят от того, в каком порядке спрашивали позы. */
  private readonly seq: number[][] = [];

  /**
   * blocks — то, сквозь что лететь нельзя: столбы (x, z, радиус, м). Перелёт, который задел бы столб,
   * не выбирается.
   */
  constructor(
    readonly perches: readonly Perch[],
    readonly count: number,
    readonly seed: number,
    readonly cfg: BirdsConfig = DEFAULT_BIRDS,
    readonly blocks: readonly (readonly [number, number, number])[] = [],
  ) {
    if (perches.length < 2) this.count = 0;
  }

  private bendOf(i: number, k: number): number {
    return (hash01(i * 23 + 9, k, this.seed ^ 0xbe0d) - 0.5) * 2 * this.cfg.curve;
  }

  /** Свободен ли перелёт птицы i в цикле k с места a на место b: путь идёт дугой, проверяется он сам, а не прямая. */
  private clear(i: number, k: number, a: number, b: number): boolean {
    if (this.blocks.length === 0) return true;
    const pa = this.spot(i, a);
    const pb = this.spot(i, b);
    const bend = this.bendOf(i, k);
    for (let j = 1; j < 12; j++) {
      const p = along(pa, pb, j / 12, 0, bend);
      for (const [x, z, r] of this.blocks) if (Math.hypot(p[0] - x, p[2] - z) < r + 0.45) return false;
    }
    return true;
  }

  /** Место птицы i в цикле k: не то же, что в прошлом цикле, и долететь до него можно, не задев столб. */
  private perchOf(i: number, k: number): number {
    const n = this.perches.length;
    const list = (this.seq[i] ??= []);
    while (list.length <= k) {
      const kk = list.length;
      const at = (tryNo: number): number => Math.floor(hash01(i * 131 + 7 + tryNo * 977, kk * 17 + 3, this.seed ^ 0xb17d) * n) % n;
      const prev = kk > 0 ? list[kk - 1]! : -1;
      let pick = -1;
      for (let tryNo = 0; tryNo < 8 && pick < 0; tryNo++) {
        const c = at(tryNo);
        if (c !== prev && (prev < 0 || this.clear(i, kk - 1, prev, c))) pick = c;
      }
      // Все восемь попыток задели столб (или совпали с прежним местом): берём соседнее место, лишь бы не то же.
      if (pick < 0) pick = (Math.max(0, prev) + 1 + (i % (n - 1))) % n;
      list.push(pick);
    }
    return list[k]!;
  }

  private sitFor(i: number, k: number): number {
    return this.cfg.sit[0] + (this.cfg.sit[1] - this.cfg.sit[0]) * hash01(i * 53 + 11, k * 29 + 5, this.seed ^ 0x51ee);
  }

  /** Точка места с небольшим сдвигом вдоль балки: две птицы на одном месте не сливаются в одну. */
  private spot(i: number, perch: number): Vec3 {
    const p = this.perches[perch]!;
    const o = (hash01(i * 7 + 1, perch, this.seed ^ 0x0ff5) - 0.5) * 0.5;
    // Вдоль балки — поперёк взгляда птицы.
    return [p.pos[0] + Math.cos(p.yaw) * o, p.pos[1], p.pos[2] - Math.sin(p.yaw) * o];
  }

  private flightTime(i: number, k: number): number {
    const a = this.spot(i, this.perchOf(i, k));
    const b = this.spot(i, this.perchOf(i, k + 1));
    return Math.max(this.cfg.minFlight, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / this.cfg.speed);
  }

  /** Цикл, в котором птица i находится в момент t. Время обычно идёт вперёд — поиск продолжается с прошлого раза. */
  private seek(i: number, t: number): Cursor {
    let c = this.cursor[i];
    if (!c || t < c.start) {
      // Начало расписания сдвинуто назад: в нулевой момент птицы уже в разных его местах.
      c = { k: 0, start: -hash01(i * 97 + 13, 1, this.seed ^ 0x57a6) * (this.cfg.sit[1] + this.cfg.minFlight) };
      this.cursor[i] = c;
    }
    for (let guard = 0; guard < 100000; guard++) {
      const len = this.sitFor(i, c.k) + this.flightTime(i, c.k);
      if (t < c.start + len) break;
      c.start += len;
      c.k += 1;
    }
    return c;
  }

  pose(i: number, t: number): BirdPose {
    const c = this.seek(i, t);
    const sit = this.sitFor(i, c.k);
    const from = this.perchOf(i, c.k);
    const a = this.spot(i, from);
    if (t < c.start + sit) {
      // Сидит. Каждый раз садится чуть по-своему: то вдоль взгляда места, то спиной.
      const turn = hash01(i * 19 + 3, c.k, this.seed ^ 0x7a11) < 0.5 ? 0 : Math.PI;
      return { pos: a, yaw: this.perches[from]!.yaw + turn + (hash01(i, c.k * 3 + 1, this.seed) - 0.5) * 0.7, pitch: 0, roll: 0, flap: 0, open: 0, flying: false };
    }
    const b = this.spot(i, this.perchOf(i, c.k + 1));
    const ft = this.flightTime(i, c.k);
    const ts = t - c.start - sit;
    const s = ts / ft;
    const dist = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const dip = Math.max(this.cfg.dipMin, Math.min(this.cfg.dipMax, dist * this.cfg.dip));
    const bend = this.bendOf(i, c.k);
    // Разгон и торможение: у балки птица почти стоит.
    const u = s * s * (3 - 2 * s);
    const open = smooth(0, this.cfg.unfold / ft, s) * (1 - smooth(1 - this.cfg.unfold / ft, 1, s));
    const pose = flightPose((x) => along(a, b, x, dip, bend), u, bend, TAU * this.cfg.beat * ts, open);
    // Перед посадкой нос задирается: птица тормозит крыльями.
    pose.pitch += 0.55 * smooth(0.78, 1, s) * (1 - smooth(0.97, 1, s));
    return pose;
  }

  /** Сколько птиц в воздухе в момент t. */
  flying(t: number): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.pose(i, t).flying) n += 1;
    return n;
  }
}

/**
 * Птица, которую можно спугнуть. Сидит на месте; подошли ближе cfg.scare — срывается. to — куда
 * пересаживается (и остаётся там); null — улетает вверх и пропадает.
 */
export class Leaver {
  state: 'sits' | 'leaves' | 'moved' | 'gone' = 'sits';
  /** Сколько секунд она в воздухе. */
  private air = 0;

  constructor(
    readonly perch: Perch,
    readonly to: Perch | null,
    readonly seed: number,
    readonly cfg: BirdsConfig = DEFAULT_BIRDS,
  ) {}

  /** Сколько длится её полёт, с. */
  get flight(): number {
    if (!this.to) return this.cfg.leave;
    const a = this.perch.pos;
    const b = this.to.pos;
    return Math.max(this.cfg.minFlight, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / this.cfg.speed);
  }

  /** Шаг. dist — расстояние до игрока, м. Возвращает true в тот шаг, когда птица сорвалась. */
  update(dt: number, dist: number): boolean {
    if (this.state === 'sits') {
      if (dist >= this.cfg.scare) return false;
      this.state = 'leaves';
      this.air = 0;
      return true;
    }
    if (this.state === 'leaves') {
      this.air += dt;
      if (this.air >= this.flight) this.state = this.to ? 'moved' : 'gone';
    }
    return false;
  }

  /** Поза; null — её больше нет. */
  pose(): BirdPose | null {
    if (this.state === 'gone') return null;
    if (this.state === 'sits') return { pos: this.perch.pos, yaw: this.perch.yaw, pitch: 0, roll: 0, flap: 0, open: 0, flying: false };
    if (this.state === 'moved') return { pos: this.to!.pos, yaw: this.to!.yaw, pitch: 0, roll: 0, flap: 0, open: 0, flying: false };
    const t = this.air;
    const ft = this.flight;
    const s = Math.min(1, t / ft);
    const flap = TAU * this.cfg.beat * t;
    if (this.to) {
      const a = this.perch.pos;
      const b = this.to.pos;
      const u = s * s * (3 - 2 * s);
      const open = smooth(0, this.cfg.unfold / ft, s) * (1 - smooth(1 - this.cfg.unfold / ft, 1, s));
      // С пола под крышу путь не проседает, а выгибается вверх: птица набирает высоту сразу.
      return flightPose((x) => along(a, b, x, -0.9, 0.12), u, 0.12, flap, open);
    }
    // Вверх по расходящейся спирали: сорвалась вперёд от стены, дальше кругами в небо.
    const turn = hash01(3, 7, this.seed) < 0.5 ? -1 : 1;
    const p = (x: number): Vec3 => {
      const tt = x * ft;
      const r = 0.25 + 0.7 * tt;
      const ang = this.perch.yaw + turn * 1.15 * tt;
      return [this.perch.pos[0] + Math.sin(ang) * r, this.perch.pos[1] + 0.25 * tt + this.cfg.climb * tt * smooth(0, 1.2, tt), this.perch.pos[2] + Math.cos(ang) * r];
    };
    return flightPose(p, s, turn * 0.09, flap, smooth(0, this.cfg.unfold / ft, s));
  }
}

/** Сколько живых птиц в стае при такой стёртости места (0..1): круг за кругом их меньше. */
export function flockSize(base: number, wear: number): number {
  return Math.max(0, Math.round(base * (1 - Math.max(0, Math.min(1, wear)) * 1.25)));
}

/** Девять чисел на птицу для рендера: x, y, z, yaw, pitch, roll, фаза взмаха, раскрытие, размер. */
export const BIRD_STRIDE = 9;
export const BIRDS_MAX = 12;

export function packBird(out: Float32Array, at: number, p: BirdPose, size: number): void {
  const o = at * BIRD_STRIDE;
  out[o] = p.pos[0];
  out[o + 1] = p.pos[1];
  out[o + 2] = p.pos[2];
  out[o + 3] = p.yaw;
  out[o + 4] = p.pitch;
  out[o + 5] = p.roll;
  out[o + 6] = p.flap % TAU;
  out[o + 7] = p.open;
  out[o + 8] = size;
}
