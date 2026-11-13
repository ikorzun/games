/**
 * Вылазка: цели, находки, батарейки, паника, здоровье и опасности среды. Чистая логика без three.js
 * и DOM: получает положение игрока и состояние фонаря, отдаёт события. Рендер, звук и экраны — снаружи.
 */
import { clamp01 } from '../core/math';
import type { Vec3 } from '../core/types';
import type { LevelItem, Objective, Population } from '../gen/populate';
import type { BuiltLevel, CollapseSpec, Zone } from '../world/level';

export type Outcome = 'escaped' | 'fell' | 'gassed' | 'caught';

export interface SortieConfig {
  /** С какого расстояния можно взять предмет, м. */
  reach: number;
  /** С какого расстояния можно снять примету, м. */
  shootRange: number;
  /** Сколько держать примету в кадре, с. */
  shootTime: number;
  /** Сколько держать кнопку у лестницы, чтобы подняться, с. */
  exitTime: number;
  /** Сколько длится замена батарейки, с. */
  swapTime: number;
}

export const DEFAULT_SORTIE: SortieConfig = { reach: 1.9, shootRange: 6, shootTime: 1.5, exitTime: 1.0, swapTime: 1.8 };

/** Что сейчас под рукой у игрока. */
export type Target =
  | { kind: 'item'; item: LevelItem }
  | { kind: 'shoot'; objective: Objective }
  | { kind: 'exit' };

export interface SortieInput {
  /** Ступни игрока. */
  pos: Vec3;
  /** Камера и направление луча (единичный вектор). */
  eye: Vec3;
  aim: Vec3;
  /** Яркость фонаря, 0..1. */
  light: number;
  /** Кнопка действия: нажата в этом шаге и удерживается. */
  actionPressed: boolean;
  actionHeld: boolean;
  /** Скорость удара о землю в этом шаге (0 — приземления не было). */
  landed: number;
  /** Близость роя, 0..1. */
  swarm: number;
}

export type SortieEvent =
  | { type: 'picked'; item: LevelItem }
  | { type: 'objective'; objective: Objective }
  | { type: 'all-done' }
  | { type: 'swap-start' }
  | { type: 'swap-done' }
  | { type: 'collapse'; spec: CollapseSpec }
  | { type: 'gas-enter' }
  | { type: 'cough' }
  | { type: 'hurt'; amount: number }
  | { type: 'scare'; amount: number }
  | { type: 'ended'; outcome: Outcome };

const inZone = (z: Zone, p: Vec3): boolean => p[0] >= z.minX && p[0] <= z.maxX && p[2] >= z.minZ && p[2] <= z.maxZ && p[1] >= z.minY && p[1] <= z.maxY;

export class Sortie {
  readonly taken = new Set<number>();
  readonly done = new Set<number>();
  /** id находок, собранных за вылазку (в архив попадут, только если выбраться). */
  readonly finds: string[] = [];
  spares = 0;
  health = 100;
  panic = 0;
  time = 0;
  /** Самый глубокий ярус, на который спустился игрок. */
  maxTier = 0;
  outcome: Outcome | null = null;
  /** Текущая цель под рукой и прогресс удержания (0..1). */
  target: Target | null = null;
  hold = 0;
  /** > 0 — идёт замена батарейки: фонарь не горит. */
  swapping = 0;
  /** Зоны, в которых сейчас игрок. */
  inWater = false;
  inGas = false;
  private gasTime = 0;
  private coughIn = 0;
  /** Игрок уже отходил от люка: до этого «подняться наверх» не предлагается — он только что спустился. */
  private leftHatch = false;
  private readonly collapseState = new Map<string, 'idle' | 'primed' | 'done'>();

  constructor(
    readonly level: BuiltLevel,
    readonly pop: Population,
    readonly cfg: SortieConfig = DEFAULT_SORTIE,
  ) {
    for (const c of level.collapses) this.collapseState.set(c.id, 'idle');
  }

  get objectives(): readonly Objective[] {
    return this.pop.objectives;
  }

  get allDone(): boolean {
    return this.pop.objectives.every((o) => this.done.has(o.id));
  }

  /** Обвалы, которые уже случились (их преграды нужно вернуть в мир после загрузки сохранения). */
  collapsed(): string[] {
    return [...this.collapseState].filter(([, s]) => s === 'done').map(([id]) => id);
  }

  /** Восстановить состояние из сохранения. */
  restore(save: { taken: number[]; done: number[]; finds: string[]; spares: number; time: number; maxTier: number; collapsed?: string[] }): void {
    for (const id of save.taken) this.taken.add(id);
    for (const id of save.done) this.done.add(id);
    this.finds.push(...save.finds);
    this.spares = save.spares;
    this.time = save.time;
    this.maxTier = save.maxTier;
    // Продолженная вылазка: игрок уже уходил от люка.
    this.leftHatch = save.time > 0;
    for (const id of save.collapsed ?? []) if (this.collapseState.has(id)) this.collapseState.set(id, 'done');
  }

  /** Что под рукой: предмет рядом и в поле зрения, цель съёмки в луче или лестница на выход. */
  findTarget(inp: SortieInput, losDistance: (from: Vec3, to: Vec3) => number): Target | null {
    const [ex, ey, ez] = inp.eye;
    let best: Target | null = null;
    let bestScore = Infinity;
    for (const it of this.pop.items) {
      if (this.taken.has(it.id)) continue;
      const dx = it.x - ex;
      const dy = it.y - ey;
      const dz = it.z - ez;
      const d = Math.hypot(dx, dy, dz);
      if (d > this.cfg.reach) continue;
      const dot = (dx * inp.aim[0] + dy * inp.aim[1] + dz * inp.aim[2]) / (d || 1);
      // Близкий предмет берётся почти не глядя, дальний — только если на него смотрят.
      if (dot < (d < 0.9 ? 0.2 : 0.72)) continue;
      const score = d * (1.6 - dot);
      if (score < bestScore) {
        bestScore = score;
        best = { kind: 'item', item: it };
      }
    }
    if (best) return best;

    for (const o of this.pop.objectives) {
      if (o.type !== 'shoot' || this.done.has(o.id) || !o.landmark) continue;
      const lm = o.landmark;
      const to: Vec3 = [lm.x, lm.y, lm.z];
      const d = Math.hypot(lm.x - ex, lm.y - ey, lm.z - ez);
      if (d > this.cfg.shootRange || d < 0.4) continue;
      const dot = ((lm.x - ex) * inp.aim[0] + (lm.y - ey) * inp.aim[1] + (lm.z - ez) * inp.aim[2]) / d;
      // Примета должна быть в луче, а луч — гореть: камера снимает только освещённое.
      if (dot < 0.955 || inp.light < 0.3) continue;
      // И ничем не заслонена: луч до приметы не упирается в преграду раньше.
      if (losDistance(inp.eye, to) < d - 1.0) continue;
      return { kind: 'shoot', objective: o };
    }

    const [x, y, z] = this.level.exit;
    const toHatch = Math.hypot(inp.pos[0] - x, inp.pos[2] - z);
    if (toHatch > 5 || Math.abs(inp.pos[1] - y) > 1) this.leftHatch = true;
    if (this.leftHatch && toHatch < 1.7 && Math.abs(inp.pos[1] - y) < 1) return { kind: 'exit' };
    return null;
  }

  /** Шаг вылазки. speedFactor и wet читаются после вызова из полей inWater/inGas. */
  update(dt: number, inp: SortieInput, losDistance: (from: Vec3, to: Vec3) => number): SortieEvent[] {
    const ev: SortieEvent[] = [];
    if (this.outcome) return ev;
    this.time += dt;
    const tier = Math.max(0, Math.round(-inp.pos[1] / 4.5));
    if (tier > this.maxTier) this.maxTier = tier;

    // ── Зоны среды ──
    let water = false;
    let gas = false;
    for (const z of this.level.zones) {
      if (!inZone(z, inp.pos)) continue;
      if (z.kind === 'pit') {
        this.end('fell', ev);
        return ev;
      }
      if (z.kind === 'water') water = true;
      else gas = true;
    }
    this.inWater = water;
    if (gas && !this.inGas) ev.push({ type: 'gas-enter' });
    this.inGas = gas;
    if (gas) {
      this.gasTime += dt;
      this.coughIn -= dt;
      // Первые секунды газ только першит; дальше — душит.
      if (this.gasTime > 2.5) {
        this.health -= 7 * dt;
        if (this.coughIn <= 0) {
          ev.push({ type: 'cough' });
          this.coughIn = 1.6;
        }
      }
    } else {
      this.gasTime = Math.max(0, this.gasTime - dt * 2);
      this.health = Math.min(100, this.health + 1.5 * dt);
    }

    // ── Падение ──
    if (inp.landed > 10) {
      this.end('fell', ev);
      return ev;
    }
    if (inp.landed > 7.5) {
      this.health -= 40;
      ev.push({ type: 'hurt', amount: 40 });
      this.panic = clamp01(this.panic + 0.3);
    }
    if (this.health <= 0) {
      this.end(gas ? 'gassed' : 'fell', ev);
      return ev;
    }

    // ── Паника: растёт в темноте, в газу и рядом с роем; спадает на свету ──
    const dark = inp.light < 0.15;
    const rise = (dark ? 0.035 : 0) + (gas ? 0.08 : 0) + inp.swarm * 0.12;
    this.panic = clamp01(this.panic + (rise > 0 ? rise : -0.05) * dt);

    // ── Обвалы: клетка «взводится», когда игрок проходит по ней, и рушится за спиной ──
    for (const c of this.level.collapses) {
      const st = this.collapseState.get(c.id);
      if (st === 'done') continue;
      const d = Math.hypot(inp.pos[0] - c.center[0], inp.pos[2] - c.center[2]);
      const sameTier = Math.abs(inp.pos[1] - c.center[1]) < 1.5;
      if (st === 'idle' && sameTier && d < 1.3) this.collapseState.set(c.id, 'primed');
      else if (st === 'primed' && (d > 4.2 || !sameTier)) {
        this.collapseState.set(c.id, 'done');
        this.panic = clamp01(this.panic + 0.35);
        ev.push({ type: 'collapse', spec: c });
      }
    }

    // ── Замена батарейки ──
    if (this.swapping > 0) {
      this.swapping -= dt;
      if (this.swapping <= 0) {
        this.swapping = 0;
        ev.push({ type: 'swap-done' });
      }
    }

    // ── Взаимодействие ──
    const target = this.swapping > 0 ? null : this.findTarget(inp, losDistance);
    const same = target !== null && this.target !== null && target.kind === this.target.kind && (target.kind !== 'item' || (this.target.kind === 'item' && target.item.id === this.target.item.id)) && (target.kind !== 'shoot' || (this.target.kind === 'shoot' && target.objective.id === this.target.objective.id));
    if (!same) this.hold = 0;
    this.target = target;
    if (target?.kind === 'item') {
      if (inp.actionPressed) this.pick(target.item, ev);
    } else if (target) {
      const need = target.kind === 'shoot' ? this.cfg.shootTime : this.cfg.exitTime;
      if (inp.actionHeld) {
        this.hold = Math.min(1, this.hold + dt / need);
        if (this.hold >= 1) {
          this.hold = 0;
          if (target.kind === 'shoot') this.complete(target.objective, ev);
          else this.end('escaped', ev);
        }
      } else this.hold = Math.max(0, this.hold - dt * 2);
    }
    return ev;
  }

  private pick(item: LevelItem, ev: SortieEvent[]): void {
    this.taken.add(item.id);
    if (item.type === 'battery') this.spares += 1;
    else if (item.find) this.finds.push(item.find);
    ev.push({ type: 'picked', item });
    const o = this.pop.objectives.find((x) => x.type === 'take' && x.item === item.id);
    if (o) this.complete(o, ev);
    this.target = null;
  }

  private complete(o: Objective, ev: SortieEvent[]): void {
    if (this.done.has(o.id)) return;
    this.done.add(o.id);
    ev.push({ type: 'objective', objective: o });
    if (this.allDone) ev.push({ type: 'all-done' });
  }

  private end(outcome: Outcome, ev: SortieEvent[]): void {
    this.outcome = outcome;
    this.target = null;
    this.hold = 0;
    ev.push({ type: 'ended', outcome });
  }

  /** Начать замену батарейки, если есть запасная. Возвращает false, если менять нечем или уже меняем. */
  startSwap(): SortieEvent | null {
    if (this.swapping > 0 || this.spares <= 0 || this.outcome) return null;
    this.spares -= 1;
    this.swapping = this.cfg.swapTime;
    return { type: 'swap-start' };
  }

  /** Внешний испуг (пугалка, рой): добавить панику. */
  scare(amount: number): void {
    this.panic = clamp01(this.panic + amount);
  }

  /** Поймал рой. */
  caught(): SortieEvent[] {
    const ev: SortieEvent[] = [];
    if (!this.outcome) this.end('caught', ev);
    return ev;
  }
}
