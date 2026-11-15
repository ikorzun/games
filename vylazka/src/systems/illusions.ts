/**
 * Иллюзорные вещи. Правило владельца: «всё, к чему касается герой, растворяется в пространстве.
 * Появляется после, если выключить и включить фонарь, но уже может в другом виде или в другом месте.
 * Все объекты сна-воспоминаний иллюзорны».
 *
 * Здесь — предметы обстановки, запечённые в сетку помещения (world/objects.ts). У каждого четыре
 * состояния: стоит → растворяется → нет → собирается. Вернуться он может только после темноты: свет
 * на его месте должен погаснуть и зажечься снова. Каким он вернётся — тем же, другим предметом или
 * на другом свободном месте, — решают сид уровня, номер предмета и то, в который раз он возвращается;
 * случайности нет, поэтому проверяется это тестами без рендера.
 *
 * «Свет на месте» у каждого мира свой: в убежище и в жёлтых комнатах это фонарь игрока, в офисе —
 * потолочная панель над предметом. Что считать светом, решает игра; сюда приходит число 0..1.
 *
 * Отдельные вещи сна (systems/things.ts) живут по тому же правилу, но своим автоматом.
 * Чистый TS.
 */
import { hash01 } from '../core/rng';
import type { LevelObject } from '../world/objects';

export type IllusionState = 'here' | 'going' | 'gone' | 'coming' | 'left';

export interface Illusion {
  obj: LevelObject;
  /** left — ушла насовсем: вместо неё теперь стоит отдельная вещь (другая или в другом месте). */
  state: IllusionState;
  /** 0 — на месте, 1 — растворена. */
  dis: number;
  /** После того как она пропала, свет на её месте уже гас. */
  dark: boolean;
  /** В который раз она возвращается. */
  turns: number;
}

/** Как вещь возвращается. */
export type Comeback =
  /** Та же, на том же месте. */
  | { how: 'same'; id: number }
  /** На её месте — другой предмет. */
  | { how: 'kind'; id: number; kind: string }
  /** Тот же предмет, но на другом свободном месте (номер места в списке уровня). */
  | { how: 'place'; id: number; slot: number };

export interface IllusionsConfig {
  /** За сколько вещь растворяется и за сколько собирается, с. */
  goTime: number;
  comeTime: number;
  /** Темно — свет ниже этого; светло — выше этого. Между ними ничего не решается. */
  darkBelow: number;
  litAbove: number;
  /** Доля возвращений «той же на том же месте» и «другим предметом»; остальное — «на другом месте». */
  same: number;
  kind: number;
  /**
   * С какой доли распада сквозь вещь можно пройти. До этого она ещё держит: игрок упирается, видит,
   * как она пошла трещинами, — и только потом проходит. Без этого он оказывался внутри раньше, чем
   * успевал что-либо заметить.
   */
  yield: number;
}

export const DEFAULT_ILLUSIONS: IllusionsConfig = { goTime: 0.9, comeTime: 0.9, darkBelow: 0.08, litAbove: 0.45, same: 0.5, kind: 0.3, yield: 0.38 };

/** Из чего выбирать возвращение: какие предметы годятся на это место и какие свободные места есть рядом. */
export interface ComebackOptions {
  kinds: readonly string[];
  slots: readonly number[];
}

export class Illusions {
  readonly list: Illusion[];
  /** Номера вещей, чьё состояние изменилось с прошлого вызова changed(): рендеру и преградам. */
  private readonly dirty = new Set<number>();

  constructor(
    objects: readonly LevelObject[],
    private readonly seed: number,
    readonly cfg: IllusionsConfig = DEFAULT_ILLUSIONS,
  ) {
    this.list = objects.map((obj) => ({ obj, state: 'here', dis: 0, dark: false, turns: 0 }));
  }

  get(id: number): Illusion | undefined {
    return this.list[id - 1];
  }

  /** Сквозь вещь можно пройти: её нет — или она уже достаточно рассыпалась. Собирающаяся держит сразу. */
  open(id: number): boolean {
    const i = this.get(id);
    if (!i) return false;
    return i.state === 'gone' || i.state === 'left' || (i.state === 'going' && i.dis >= this.cfg.yield);
  }

  /** Игрок коснулся вещи. true — она начала растворяться. */
  touch(id: number): boolean {
    const i = this.get(id);
    if (!i || i.state !== 'here') return false;
    i.state = 'going';
    i.dark = false;
    this.dirty.add(id);
    return true;
  }

  /**
   * Шаг: растворение и сборка идут по времени; свет решает, кому пора вернуться.
   * light — сколько света на месте вещи (0..1); blocked — там стоит игрок (вернуть нельзя: он окажется
   * внутри); options — из чего выбирать. Возвращает решения о возврате — их исполняет игра
   * (comeBack или leave).
   */
  update(dt: number, light: (o: LevelObject) => number, blocked: (o: LevelObject) => boolean, options: (o: LevelObject) => ComebackOptions): Comeback[] {
    const c = this.cfg;
    const out: Comeback[] = [];
    for (const i of this.list) {
      if (i.state === 'here' || i.state === 'left') continue;
      const id = i.obj.id;
      if (i.state === 'going') {
        i.dis = Math.min(1, i.dis + dt / c.goTime);
        if (i.dis >= 1) i.state = 'gone';
        this.dirty.add(id);
        continue;
      }
      if (i.state === 'coming') {
        i.dis = Math.max(0, i.dis - dt / c.comeTime);
        if (i.dis <= 0) i.state = 'here';
        this.dirty.add(id);
        continue;
      }
      // gone: ждёт темноты, потом света.
      const l = light(i.obj);
      if (l < c.darkBelow) i.dark = true;
      else if (i.dark && l > c.litAbove && !blocked(i.obj)) out.push(this.decide(i, options(i.obj)));
    }
    return out;
  }

  /** Какой вернётся вещь: решают сид, номер и счёт возвращений. */
  private decide(i: Illusion, opt: ComebackOptions): Comeback {
    const id = i.obj.id;
    const r = hash01(id * 31 + 7, i.turns * 17 + 3, this.seed ^ 0x1115);
    const pick = hash01(id * 13 + 1, i.turns * 29 + 11, this.seed ^ 0x9a5e);
    const kind = (): Comeback | null => (opt.kinds.length > 0 ? { how: 'kind', id, kind: opt.kinds[Math.floor(pick * opt.kinds.length)]! } : null);
    const place = (): Comeback | null => (opt.slots.length > 0 ? { how: 'place', id, slot: opt.slots[Math.floor(pick * opt.slots.length)]! } : null);
    if (r < this.cfg.same) return { how: 'same', id };
    if (r < this.cfg.same + this.cfg.kind) return kind() ?? place() ?? { how: 'same', id };
    return place() ?? kind() ?? { how: 'same', id };
  }

  /** Вещь собирается на прежнем месте. */
  comeBack(id: number): void {
    const i = this.get(id);
    if (!i || i.state !== 'gone') return;
    i.state = 'coming';
    i.dark = false;
    i.turns += 1;
    this.dirty.add(id);
  }

  /** Вещь ушла насовсем: вместо неё игра поставила отдельную вещь сна. */
  leave(id: number): void {
    const i = this.get(id);
    if (!i || i.state !== 'gone') return;
    i.state = 'left';
    i.dark = false;
    i.turns += 1;
  }

  /** Чьё состояние изменилось с прошлого вызова (и очистить список). */
  changed(): number[] {
    const ids = [...this.dirty];
    this.dirty.clear();
    return ids;
  }
}
