/**
 * Аномалии нижнего яруса. Базовый уровень неизменен; аномалии — малое состояние поверх него:
 *   - лестница вниз длиннее, чем должна быть: на спуске игрока незаметно возвращают на десять
 *     ступеней назад (сдвиг равен периоду геометрии и рисунка стен);
 *   - комната меняется, пока на неё не смотрят: побывал, ушёл далеко — обстановка стала другой.
 * Чистая логика: отдаёт события, исполняет их игра. Состояние попадает в сохранение.
 */
import type { Vec3 } from '../core/types';
import type { RoomVariant, StairLink } from '../world/level';

export type AnomalyEvent =
  /** Сдвинуть игрока (лестница). */
  | { type: 'shift'; dx: number; dy: number; dz: number }
  /** Показать вариант обстановки комнаты: alt — второй, иначе первый. */
  | { type: 'variant'; variant: RoomVariant; alt: boolean };

export interface AnomalyState {
  loops: number;
  /** id комнат, у которых сейчас показан второй вариант. */
  alt: number[];
}

/** Сколько ступеней и метров в одном «лишнем» пролёте. */
export interface StairGeometry {
  run: number;
  rise: number;
  steps: number;
}

export class Anomalies {
  /** Сколько раз лестница ещё удлинится. */
  loops: number;
  readonly alt = new Set<number>();
  private readonly visited = new Set<number>();
  private lastS = -1;

  constructor(
    /** Лестница на нижний ярус (null — аномалии лестницы нет). */
    private readonly stair: StairLink | null,
    private readonly geo: StairGeometry,
    private readonly variants: readonly RoomVariant[],
    loops: number,
  ) {
    this.loops = stair ? loops : 0;
  }

  state(): AnomalyState {
    return { loops: this.loops, alt: [...this.alt] };
  }

  restore(s: AnomalyState): AnomalyEvent[] {
    this.loops = this.stair ? Math.max(0, Math.floor(s.loops)) : 0;
    const ev: AnomalyEvent[] = [];
    for (const id of s.alt) {
      const v = this.variants.find((x) => x.room === id);
      if (!v) continue;
      this.alt.add(id);
      ev.push({ type: 'variant', variant: v, alt: true });
    }
    return ev;
  }

  /**
   * Темнота: пока свет не горит, место никто не держит, и комната неподалёку (не та, где стоит
   * игрок, и на его ярусе) меняет обстановку — вернётся свет, и она окажется другой.
   */
  flipInDark(pos: Vec3, room: number): AnomalyEvent[] {
    const ev: AnomalyEvent[] = [];
    for (const v of this.variants) {
      if (room === v.room) continue;
      if (Math.hypot(pos[0] - v.center[0], pos[2] - v.center[2]) > 24 || Math.abs(pos[1] - v.center[1]) > 2) continue;
      const alt = !this.alt.has(v.room);
      if (alt) this.alt.add(v.room);
      else this.alt.delete(v.room);
      this.visited.delete(v.room);
      ev.push({ type: 'variant', variant: v, alt });
    }
    return ev;
  }

  /**
   * Шаг. pos — ступни игрока; room — id помещения, в котором он стоит (−1 — неизвестно);
   * blocked — рядом рой: аномалии не срабатывают, чтобы не сломать погоню.
   */
  update(pos: Vec3, room: number, blocked: boolean): AnomalyEvent[] {
    const ev: AnomalyEvent[] = [];

    // ── Лестница ──
    const st = this.stair;
    if (st) {
      // Ось марша: от верхней площадки к нижней. s — пройдено по горизонтали от верхней кромки.
      const ax = Math.sign(st.bottom[0] - st.top[0]);
      const az = Math.sign(st.bottom[2] - st.top[2]);
      const s = (pos[0] - st.top[0]) * ax + (pos[2] - st.top[2]) * az - 1.5;
      const lateral = Math.abs((pos[0] - st.top[0]) * az) + Math.abs((pos[2] - st.top[2]) * ax);
      const flight = this.geo.steps * this.geo.run;
      const onFlight = s > 0 && s < flight && lateral < 1.4 && pos[1] < st.top[1] + 0.2 && pos[1] > st.bottom[1] - 0.2;
      const period = 10 * this.geo.run;
      // Срабатывает на спуске, когда пройдена дюжина ступеней: верх уже за спиной, низ ещё далеко.
      const trigger = 12 * this.geo.run;
      if (onFlight && this.loops > 0 && !blocked && this.lastS >= 0 && this.lastS < trigger && s >= trigger) {
        this.loops -= 1;
        ev.push({ type: 'shift', dx: -ax * period, dy: 10 * this.geo.rise, dz: -az * period });
        this.lastS = s - period;
      } else this.lastS = onFlight ? s : -1;
    }

    // ── Комнаты ──
    for (const v of this.variants) {
      if (room === v.room) {
        this.visited.add(v.room);
        continue;
      }
      if (!this.visited.has(v.room) || blocked) continue;
      const d = Math.hypot(pos[0] - v.center[0], pos[2] - v.center[2]);
      // Ушёл за угол и далеко (или на другой ярус) — комнату уже не видно.
      if (d > 13 || Math.abs(pos[1] - v.center[1]) > 2) {
        this.visited.delete(v.room);
        const alt = !this.alt.has(v.room);
        if (alt) this.alt.add(v.room);
        else this.alt.delete(v.room);
        ev.push({ type: 'variant', variant: v, alt });
      }
    }
    return ev;
  }
}
