/**
 * Осыпь (в коде — рой): поведение. Чистая логика на навигационном графе, без three.js.
 *
 *   dormant ─(режиссёр)→ roam ─(почуяла свет, шум или темноту рядом с игроком)→ stalk ─(подошла)→ cohere → hunt
 *   hunt ─(луч держали на ней)→ scatter ─(переждала)→ stalk …      hunt ─(дотянулась)→ поймала
 *
 * Осыпь — то, что свет отпустил: точки мест, с которых он ушёл. Она тянется к тому, кто несёт
 * фонарь: идёт на свет и на шум, а темнота рядом с игроком зовёт её сильнее всего — погасить фонарь
 * поблизости значит не спрятаться, а позвать. Издалека, в темноте и тишине, она игрока теряет.
 * Прямой луч держит её на месте: под ним она почти не движется, а если держать дольше — «проявляется»
 * до конца, рассыпается и собирается снова поблизости, с каждым разом быстрее. Тряска фонаря шумит.
 */
import { clamp01 } from '../core/math';
import type { Rng } from '../core/rng';
import type { Vec3 } from '../core/types';
import type { NavNode } from '../world/level';

export type SwarmMode = 'dormant' | 'roam' | 'stalk' | 'cohere' | 'hunt' | 'scatter' | 'apparition';

export interface SwarmConfig {
  roamSpeed: number;
  stalkSpeed: number;
  /** Скорость охоты: игрок без света, со светом, и когда луч держат прямо на рое. */
  huntDark: number;
  huntLit: number;
  huntBeam: number;
  /** Сколько секунд прямого луча разваливает рой. */
  burnTime: number;
  /** С какого расстояния рой дотягивается до игрока, м. */
  catchDist: number;
  /** Сколько узлов пути рой видит свет фонаря. */
  sightNodes: number;
  /** За сколько секунд без света и шума рой теряет игрока. */
  forgetTime: number;
  /** На сколько узлов пути чувствуется темнота вокруг игрока, когда его фонарь не светит. */
  darkNodes: number;
}

export const DEFAULT_SWARM: SwarmConfig = {
  roamSpeed: 1.5,
  stalkSpeed: 2.5,
  huntDark: 2.7,
  huntLit: 1.9,
  huntBeam: 0.12,
  burnTime: 1.5,
  catchDist: 0.95,
  sightNodes: 9,
  forgetTime: 8,
  darkNodes: 6,
};

export interface SwarmInput {
  /** Ступни игрока и узел графа, в клетке которого он стоит (−1 — вне графа). */
  player: Vec3;
  playerNode: number;
  /** Фонарь горит. */
  lightOn: boolean;
  /** Луч фонаря лежит на рое (в конусе, без преград). */
  beamOnSwarm: boolean;
  /** Шум игрока 0..1: бег, тряска фонаря, паническое дыхание. */
  noise: number;
}

export interface SwarmOutput {
  caught: boolean;
  /** Рой рассыпался под лучом в этом шаге. */
  scattered: boolean;
  /** Рой собрался в фигуру в этом шаге. */
  cohered: boolean;
}

/** Узлы графа на расстоянии от lo до hi переходов от узла from (в порядке обхода в ширину). */
export function nodesInRange(nav: readonly NavNode[], from: number, lo: number, hi: number): number[] {
  const ok: number[] = [];
  if (from < 0 || from >= nav.length) return ok;
  const dist = new Int16Array(nav.length).fill(-1);
  const q = [from];
  dist[from] = 0;
  for (let h = 0; h < q.length; h++) {
    const cur = q[h]!;
    const d = dist[cur]!;
    if (d >= lo && d <= hi) ok.push(cur);
    if (d >= hi) continue;
    for (const n of nav[cur]!.links) {
      if (dist[n] !== -1) continue;
      dist[n] = d + 1;
      q.push(n);
    }
  }
  return ok;
}

export class SwarmAI {
  mode: SwarmMode = 'dormant';
  /** Центр роя на полу. */
  pos: Vec3 = [0, 0, 0];
  node = -1;
  /** 0 — рассеян по полу, 1 — собран в фигуру. */
  cohesion = 0;
  /** 0..1: насколько рой знает, где игрок. */
  awareness = 0;
  /** Сколько раз его разваливали лучом: с каждым разом собирается быстрее. */
  aggravation = 0;
  private lastKnown = -1;
  private goal = -1;
  private path: number[] = [];
  private repath = 0;
  private burn = 0;
  private timer = 0;

  constructor(
    private readonly nav: readonly NavNode[],
    private readonly rng: Rng,
    readonly cfg: SwarmConfig = DEFAULT_SWARM,
  ) {}

  get active(): boolean {
    return this.mode !== 'dormant';
  }

  /** Выпустить рой в узле графа. */
  activate(node: number): void {
    const n = this.nav[node];
    if (!n) return;
    this.place(node);
    this.mode = 'roam';
    this.cohesion = 0;
    this.awareness = 0;
    this.goal = -1;
  }

  /** Навести рой на узел: он «знает», что игрок там (сценарий, отладка). */
  alert(node: number, awareness = 0.8): void {
    if (this.mode === 'dormant' || node < 0) return;
    this.lastKnown = node;
    this.awareness = Math.max(this.awareness, awareness);
    if (this.mode === 'roam') this.mode = 'stalk';
  }

  /** Явление без охоты: собранная фигура стоит в узле и рассыпается, едва на неё посветили. */
  appear(node: number, seconds: number): void {
    if (!this.nav[node]) return;
    this.place(node);
    this.mode = 'apparition';
    this.cohesion = 0.6;
    this.timer = seconds;
    this.burn = 0;
  }

  private place(node: number): void {
    const n = this.nav[node]!;
    this.node = node;
    this.pos = [n.x, n.y, n.z];
    this.path = [];
  }

  /** Близость роя к игроку 0..1 (1 — вплотную): глушит фонарь, пугает, рвёт сигнал. */
  proximity(player: Vec3): number {
    if (this.mode === 'dormant' || (this.mode === 'scatter' && this.cohesion < 0.05)) return 0;
    const d = Math.hypot(player[0] - this.pos[0], player[1] - this.pos[1], player[2] - this.pos[2]);
    return clamp01(1 - (d - 3) / 11);
  }

  /** Кратчайший путь по графу (в узлах), включая начало и конец; пусто — пути нет. */
  route(from: number, to: number): number[] {
    if (from < 0 || to < 0) return [];
    if (from === to) return [from];
    const prev = new Int32Array(this.nav.length).fill(-1);
    const seen = new Uint8Array(this.nav.length);
    const q = [from];
    seen[from] = 1;
    for (let h = 0; h < q.length; h++) {
      const cur = q[h]!;
      for (const n of this.nav[cur]!.links) {
        if (seen[n]) continue;
        seen[n] = 1;
        prev[n] = cur;
        if (n === to) {
          const out = [to];
          for (let p = prev[to]!; p !== -1; p = prev[p]!) out.push(p);
          return out.reverse();
        }
        q.push(n);
      }
    }
    return [];
  }

  /** Узел на расстоянии от lo до hi переходов от игрока; из подходящих — случайный. */
  nodeAround(from: number, lo: number, hi: number): number {
    const ok = nodesInRange(this.nav, from, lo, hi);
    return ok.length > 0 ? ok[Math.floor(this.rng() * ok.length)]! : -1;
  }

  private moveTo(goal: number, speed: number, dt: number, player: Vec3 | null): void {
    if (goal < 0 || this.node < 0) return;
    this.repath -= dt;
    if (goal !== this.goal || this.repath <= 0 || this.path.length === 0) {
      this.goal = goal;
      this.path = this.route(this.node, goal);
      this.repath = 0.6;
    }
    // Вплотную — идём прямо на игрока, а не к центру клетки.
    let tx: number;
    let ty: number;
    let tz: number;
    if (player && this.path.length <= 2) {
      [tx, ty, tz] = player;
    } else {
      const next = this.nav[this.path[1] ?? this.path[0]!]!;
      tx = next.x;
      ty = next.y;
      tz = next.z;
    }
    const dx = tx - this.pos[0];
    const dy = ty - this.pos[1];
    const dz = tz - this.pos[2];
    const d = Math.hypot(dx, dy, dz);
    const step = speed * dt;
    if (d <= step || d < 1e-4) {
      this.pos = [tx, ty, tz];
      if (this.path.length > 1 && !(player && this.path.length <= 2)) {
        this.node = this.path[1]!;
        this.path.shift();
      }
    } else {
      this.pos = [this.pos[0] + (dx / d) * step, this.pos[1] + (dy / d) * step, this.pos[2] + (dz / d) * step];
    }
    // Узел роя — ближайший из текущего и следующего: нужен, чтобы путь считался от места, где рой на самом деле.
    if (this.path.length > 1) {
      const a = this.nav[this.path[0]!]!;
      const b = this.nav[this.path[1]!]!;
      if (Math.hypot(b.x - this.pos[0], b.z - this.pos[2]) < Math.hypot(a.x - this.pos[0], a.z - this.pos[2])) {
        this.node = this.path[1]!;
        this.path.shift();
      }
    }
  }

  update(dt: number, inp: SwarmInput): SwarmOutput {
    const out: SwarmOutput = { caught: false, scattered: false, cohered: false };
    if (this.mode === 'dormant') return out;
    const c = this.cfg;
    const toPlayer = Math.hypot(inp.player[0] - this.pos[0], inp.player[1] - this.pos[1], inp.player[2] - this.pos[2]);
    const hops = inp.playerNode >= 0 && this.node >= 0 ? this.route(this.node, inp.playerNode).length - 1 : 99;

    if (this.mode === 'apparition') {
      this.cohesion = Math.min(1, this.cohesion + dt * 2);
      this.timer -= dt;
      this.burn = inp.beamOnSwarm ? this.burn + dt : Math.max(0, this.burn - dt);
      if (this.burn > 0.35 || toPlayer < 5 || this.timer <= 0) {
        this.mode = 'dormant';
        this.cohesion = 0;
        out.scattered = true;
      }
      return out;
    }

    // ── Что рой знает об игроке ──
    const sees = inp.lightOn && hops >= 0 && hops <= c.sightNodes;
    const hears = inp.noise > 0.05 && hops >= 0 && hops <= Math.round(2 + inp.noise * 4);
    // Темнота вокруг игрока — её среда: место там уже осыпается ей навстречу.
    const feels = !inp.lightOn && hops >= 0 && hops <= c.darkNodes;
    if (sees || hears || feels) {
      this.awareness = clamp01(this.awareness + ((sees ? 0.5 : 0) + (feels ? 0.7 : 0) + (hears ? inp.noise * 1.5 : 0)) * dt);
      this.lastKnown = inp.playerNode;
    } else this.awareness = clamp01(this.awareness - dt / c.forgetTime);

    if (this.mode === 'roam') {
      this.cohesion = Math.max(0, this.cohesion - dt * 1.5);
      if (this.goal < 0 || this.node === this.goal) this.goal = this.nodeAround(this.node, 3, 8);
      this.moveTo(this.goal, c.roamSpeed, dt, null);
      if (this.awareness > 0.35) this.mode = 'stalk';
    } else if (this.mode === 'stalk') {
      this.cohesion = Math.max(0, this.cohesion - dt * 1.5);
      this.moveTo(this.lastKnown, c.stalkSpeed, dt, null);
      if (this.awareness < 0.05) {
        this.mode = 'roam';
        this.goal = -1;
      } else if (hops <= 3 && this.awareness > 0.5) {
        this.mode = 'cohere';
        this.timer = Math.max(0.5, 1.4 - 0.25 * this.aggravation);
      }
    } else if (this.mode === 'cohere') {
      this.cohesion = Math.min(1, this.cohesion + dt / 1.2);
      this.timer -= dt;
      if (this.timer <= 0 && this.cohesion >= 0.99) {
        this.mode = 'hunt';
        this.burn = 0;
        out.cohered = true;
      }
    } else if (this.mode === 'hunt') {
      this.cohesion = 1;
      this.burn = inp.beamOnSwarm ? this.burn + dt : Math.max(0, this.burn - dt * 0.5);
      if (this.burn >= c.burnTime) {
        // Луч развалил рой: он утекает и соберётся снова неподалёку.
        this.mode = 'scatter';
        this.aggravation += 1;
        this.timer = Math.max(2.5, 8 - 1.5 * this.aggravation);
        this.burn = 0;
        out.scattered = true;
        return out;
      }
      const speed = inp.beamOnSwarm ? c.huntBeam : inp.lightOn ? c.huntLit : c.huntDark;
      const known = this.awareness > 0.2 ? inp.playerNode : this.lastKnown;
      this.moveTo(known, speed, dt, this.awareness > 0.2 ? inp.player : null);
      if (toPlayer < c.catchDist && Math.abs(inp.player[1] - this.pos[1]) < 1.2) out.caught = true;
      else if (this.awareness < 0.05) {
        this.mode = 'roam';
        this.goal = -1;
      }
    } else if (this.mode === 'scatter') {
      const before = this.cohesion;
      this.cohesion = Math.max(0, this.cohesion - dt * 2.5);
      this.timer -= dt;
      // Рассыпавшись, рой уходит в сторону: соберётся в 4–6 клетках от игрока.
      if (before > 0 && this.cohesion === 0) {
        const n = this.nodeAround(inp.playerNode >= 0 ? inp.playerNode : this.node, 4, 6);
        if (n >= 0) this.place(n);
      }
      if (this.timer <= 0) {
        this.mode = 'stalk';
        this.awareness = Math.max(this.awareness, 0.6);
        this.lastKnown = inp.playerNode >= 0 ? inp.playerNode : this.lastKnown;
      }
    }
    return out;
  }
}
