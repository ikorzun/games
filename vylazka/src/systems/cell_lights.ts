/**
 * Свет потолочных панелей по клеткам уровня (офис и жёлтые комнаты).
 *
 * В убежище свет приносит игрок: существует то, на что он светит. В офисе свет даёт само место:
 * панели включаются датчиками движения там, где игрок, и гаснут за его спиной — существует только
 * остров вокруг него. Осыпь свет отнимает: панели гаснут там, где она. По цепочке гаснущих ламп
 * видно, откуда она идёт.
 *
 * В жёлтых комнатах датчиков нет: панели гудят и горят всегда, но неровно — часть мертва, часть
 * мерцает. Рядом с Осыпью они гаснут так же.
 *
 * Чистая логика: уровень света 0..1 на каждый узел навигации и упаковка в текстуру для шейдера мира
 * (render: uCellLight). Рисует сам свет шейдер; лампа-панель светится, пока её клетка освещена.
 */
import { hash01 } from '../core/rng';
import type { NavNode } from '../world/level';
import type { Env } from '../world/pockets';

export type CellLightMode = NonNullable<Env['cells']>;

export interface CellLightsConfig {
  /** Датчики: сколько клеток пути вокруг игрока освещено. */
  reach: number;
  /** Панели впереди загораются по очереди: задержка на каждую клетку пути, с. */
  stagger: number;
  /** За сколько панель разгорается и гаснет (время, за которое остаётся 1/e разницы), с. */
  rise: number;
  fall: number;
  /** Сколько панель ещё горит после того, как игрок ушёл, с. */
  hold: number;
  /** Осыпь гасит панели в стольких клетках пути вокруг себя… */
  driftReach: number;
  /** …и они не загораются ещё столько секунд после того, как она ушла. */
  driftHold: number;
  /** Жёлтые комнаты: доля мёртвых панелей и доля мерцающих. */
  dead: number;
  flicker: number;
}

export const DEFAULT_CELL_LIGHTS: CellLightsConfig = { reach: 2, stagger: 0.11, rise: 0.07, fall: 0.22, hold: 1.6, driftReach: 1, driftHold: 2.5, dead: 0.16, flicker: 0.14 };

/** Мертва ли панель в клетке (жёлтые комнаты): одно и то же знают обстановка и свет. */
export function panelDead(seed: number, cx: number, cz: number, share = DEFAULT_CELL_LIGHTS.dead): boolean {
  return hash01(cx * 31 + 7, cz * 17 + 3, seed ^ 0x1ead) < share;
}

export interface CellLightsInput {
  /** Узел под игроком; −1 — игрока в этом мире нет (карманное пространство). */
  playerNode: number;
  /** Узел, где Осыпь; −1 — её нет или она рассыпана. */
  driftNode: number;
  /** Игровое время, с: по нему идёт мерцание. */
  time: number;
}

export class CellLights {
  /** Свет в узле, 0..1. */
  readonly level: Float32Array;
  /** Текстура size × size, RGBA: r — свет клетки, g — номер помещения (+1; 0 — клетки нет). */
  readonly data: Uint8Array;
  private readonly want: Float32Array;
  private readonly idle: Float32Array;
  private readonly dark: Float32Array;
  private readonly dead: Uint8Array;
  private readonly bad: Uint8Array;
  private readonly hops: Int16Array;
  private readonly queue: number[] = [];

  constructor(
    private readonly nav: readonly NavNode[],
    readonly mode: CellLightMode,
    seed: number,
    readonly size = 16,
    readonly cfg: CellLightsConfig = DEFAULT_CELL_LIGHTS,
  ) {
    const n = nav.length;
    this.level = new Float32Array(n);
    this.want = new Float32Array(n);
    this.idle = new Float32Array(n).fill(1e3);
    this.dark = new Float32Array(n);
    this.dead = new Uint8Array(n);
    this.bad = new Uint8Array(n);
    this.hops = new Int16Array(n);
    this.data = new Uint8Array(size * size * 4);
    if (mode === 'hum') {
      nav.forEach((node, i) => {
        this.dead[i] = panelDead(seed, node.cx, node.cz, cfg.dead) ? 1 : 0;
        this.bad[i] = !this.dead[i] && hash01(node.cx * 13 + 1, node.cz * 29 + 5, seed ^ 0xf11c) < cfg.flicker ? 1 : 0;
        // Жёлтые комнаты освещены сразу: там свет ни от кого не зависит.
        this.level[i] = this.dead[i] ? 0 : this.humBase(i);
      });
    }
    this.pack();
  }

  /** Ровный свет панели в жёлтых комнатах: у каждой свой, от тусклого до полного. */
  private humBase(i: number): number {
    const node = this.nav[i]!;
    return 0.7 + 0.3 * hash01(node.cx * 7 + 11, node.cz * 5 + 2, 0x5eed);
  }

  /** Расстояния в клетках пути от узла from, не дальше limit; остальное — −1. */
  private spread(from: number, limit: number): void {
    this.hops.fill(-1);
    if (from < 0 || from >= this.nav.length) return;
    const q = this.queue;
    q.length = 0;
    q.push(from);
    this.hops[from] = 0;
    for (let head = 0; head < q.length; head++) {
      const cur = q[head]!;
      const d = this.hops[cur]!;
      if (d >= limit) continue;
      for (const l of this.nav[cur]!.links) {
        if (this.hops[l] !== -1) continue;
        this.hops[l] = d + 1;
        q.push(l);
      }
    }
  }

  update(dt: number, inp: CellLightsInput): void {
    const c = this.cfg;
    const n = this.nav.length;

    // Осыпь: вокруг неё панели гаснут и какое-то время не загораются.
    for (let i = 0; i < n; i++) this.dark[i] = Math.max(0, this.dark[i]! - dt);
    if (inp.driftNode >= 0) {
      this.spread(inp.driftNode, c.driftReach);
      for (let i = 0; i < n; i++) if (this.hops[i]! >= 0) this.dark[i] = c.driftHold;
    }

    if (this.mode === 'sensor') {
      // Датчики: клетки в пределах reach шагов пути и всё помещение, где стоит игрок.
      this.spread(inp.playerNode, c.reach);
      const here = inp.playerNode >= 0 ? this.nav[inp.playerNode]! : null;
      for (let i = 0; i < n; i++) {
        const node = this.nav[i]!;
        let h = this.hops[i]!;
        if (h < 0 && here && node.room === here.room && node.tier === here.tier && !this.corridor(here)) h = c.reach;
        if (h >= 0) {
          this.want[i] = this.want[i]! + dt;
          this.idle[i] = 0;
        } else {
          this.want[i] = 0;
          this.idle[i] = this.idle[i]! + dt;
        }
        // Панель загорается, когда до неё «дошла очередь», и горит ещё hold секунд после ухода игрока.
        const on = this.dark[i]! <= 0 && !this.offRooms.has(node.room) && (h >= 0 ? this.want[i]! >= c.stagger * h : this.idle[i]! < c.hold && this.level[i]! > 0.02);
        const target = on ? 1 : 0;
        const tau = target > this.level[i]! ? c.rise : this.dark[i]! > 0 ? c.rise : c.fall;
        this.level[i] = target + (this.level[i]! - target) * Math.exp(-dt / tau);
      }
    } else {
      for (let i = 0; i < n; i++) {
        let target = this.dead[i] ? 0 : this.humBase(i);
        // Плохая лампа: то и дело проваливается почти до нуля.
        if (this.bad[i]) {
          const ph = inp.time * 7.3 + i * 1.7;
          const dip = Math.sin(ph) * Math.sin(ph * 0.37 + 1.3) * Math.sin(ph * 2.9);
          if (dip > 0.28) target *= 0.25;
        }
        if (this.dark[i]! > 0 || this.offRooms.has(this.nav[i]!.room)) target = 0;
        const tau = this.dark[i]! > 0 || target < this.level[i]! ? 0.06 : 0.1;
        this.level[i] = target + (this.level[i]! - target) * Math.exp(-dt / tau);
      }
    }
    this.pack();
  }

  /** Коридор — помещение из одной линии клеток: в нём свет идёт по клеткам, а не разом. */
  private corridor(node: NavNode): boolean {
    return this.corridorRooms.has(node.room);
  }

  /** Номера помещений-коридоров (задаёт игра по плану уровня). */
  readonly corridorRooms = new Set<number>();
  /** Помещения, где света нет вовсе («тёмные»: там и фонарь не светит). */
  readonly offRooms = new Set<number>();

  /** Свет в узле; вне графа — 0. */
  at(node: number): number {
    return node >= 0 && node < this.level.length ? this.level[node]! : 0;
  }

  private pack(): void {
    const d = this.data;
    d.fill(0);
    this.nav.forEach((node, i) => {
      if (node.tier !== 0 || node.cx < 0 || node.cz < 0 || node.cx >= this.size || node.cz >= this.size) return;
      const o = (node.cz * this.size + node.cx) * 4;
      d[o] = Math.round(Math.max(0, Math.min(1, this.level[i]!)) * 255);
      d[o + 1] = (node.room % 250) + 1;
      d[o + 3] = 255;
    });
  }
}
