/**
 * Иллюзорные вещи. Правило партнёра: «всё, к чему касается герой, растворяется в пространстве.
 * Появляется после, если выключить и включить фонарь, но уже может в другом виде или в другом месте.
 * Все объекты сна-воспоминаний иллюзорны».
 *
 * Здесь — предметы обстановки, запечённые в сетку помещения (world/objects.ts). У каждого четыре
 * состояния: стоит → растворяется → нет → собирается. Вернуться он может только после темноты: свет
 * на его месте должен погаснуть и зажечься снова.
 *
 * Каким он вернётся. Слова партнёра (15.11): «Вещи возвращаются на ступень хуже». Ступени — шкала
 * доверия к вещи: настоящая → картонка (плоский снимок) → проекция (картинка из света) → кружево
 * (одни нити по рёбрам) → нет. Каждое касание стирает вещь на ступень; с последней она не
 * возвращается вовсе. Иногда она возвращается ещё и в другом месте — на свободном участке стены
 * в том же помещении. Случайности нет: решают сид уровня, номер предмета и то, в который раз он
 * возвращается, поэтому всё это проверяется тестами без рендера.
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

/** Ступень доверия: 0 — настоящая, 1 — картонка, 2 — проекция, 3 — кружево, 4 — её больше нет. */
export type Form = 0 | 1 | 2 | 3 | 4;
export const FORM_REAL: Form = 0;
export const FORM_CARD: Form = 1;
export const FORM_LIGHT: Form = 2;
export const FORM_LACE: Form = 3;
export const FORM_GONE: Form = 4;

/** Где вещь стоит: у стены на полу, посреди пола, на стене, под потолком (как mount в реестре реквизита). */
export type Mount = 'floor' | 'free' | 'wall' | 'ceiling';

/**
 * Следующая ступень. Не всякая ступень годится всякой вещи: картонке нужен пол, чтобы стоять,
 * проекции — стена, чтобы на неё лечь. Вещь у стены проходит все ступени; настенная минует картонку
 * (она и так плоская); стоящая посреди пола минует проекцию (лечь не на что); потолочная сразу
 * становится кружевом.
 */
export function worse(form: Form, mount: Mount): Form {
  if (form >= FORM_LACE) return FORM_GONE;
  if (form === FORM_LIGHT) return FORM_LACE;
  if (form === FORM_CARD) return mount === 'free' ? FORM_LACE : FORM_LIGHT;
  return mount === 'floor' || mount === 'free' ? FORM_CARD : mount === 'wall' ? FORM_LIGHT : FORM_LACE;
}

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
  /** На какой ступени она сейчас (картонка, запечённая в уровень, начинает с первой). */
  form: Form;
}

/** Как вещь возвращается. */
export type Comeback =
  /** Собой, на том же месте: вещь, которой это положено (экран, проём, предмет варианта комнаты). */
  | { how: 'same'; id: number }
  /**
   * На ступень хуже: form — какой она стала (FORM_GONE — стёрта, не возвращается); slot — если она
   * при этом встала на другое свободное место (номер места в списке уровня).
   */
  | { how: 'step'; id: number; form: Form; slot?: number };

export interface IllusionsConfig {
  /** За сколько вещь растворяется и за сколько собирается, с. */
  goTime: number;
  comeTime: number;
  /** Темно — свет ниже этого; светло — выше этого. Между ними ничего не решается. */
  darkBelow: number;
  litAbove: number;
  /** Доля возвращений «в другом месте» (если свободные места есть). */
  place: number;
  /**
   * С какой доли распада сквозь вещь можно пройти. До этого она ещё держит: игрок упирается, видит,
   * как она пошла трещинами, — и только потом проходит. Без этого он оказывался внутри раньше, чем
   * успевал что-либо заметить.
   */
  yield: number;
}

export const DEFAULT_ILLUSIONS: IllusionsConfig = { goTime: 0.9, comeTime: 0.9, darkBelow: 0.08, litAbove: 0.45, place: 0.25, yield: 0.38 };

/** Из чего выбирать возвращение. */
export interface ComebackOptions {
  /** Вещь возвращается собой и на своё место (у неё своя роль: экран, проём, предмет варианта комнаты). */
  keep: boolean;
  /** Где она стоит: от этого зависит, какие ступени ей доступны. */
  mount: Mount;
  /** Свободные места рядом, куда она может встать вместо прежнего. */
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
    this.list = objects.map((obj) => ({ obj, state: 'here', dis: 0, dark: false, turns: 0, form: obj.flat ? FORM_CARD : FORM_REAL }));
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

  /** Какой вернётся вещь: на ступень хуже; где — решают сид, номер и счёт возвращений. */
  private decide(i: Illusion, opt: ComebackOptions): Comeback {
    const id = i.obj.id;
    if (opt.keep) return { how: 'same', id };
    const form = worse(i.form, opt.mount);
    if (form === FORM_GONE || opt.slots.length === 0) return { how: 'step', id, form };
    const r = hash01(id * 31 + 7, i.turns * 17 + 3, this.seed ^ 0x1115);
    if (r >= this.cfg.place) return { how: 'step', id, form };
    const pick = hash01(id * 13 + 1, i.turns * 29 + 11, this.seed ^ 0x9a5e);
    return { how: 'step', id, form, slot: opt.slots[Math.floor(pick * opt.slots.length)]! };
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

  /**
   * Вещь ушла из сетки помещения насовсем: вместо неё игра поставила отдельную вещь сна (ступенью
   * хуже) — или не поставила ничего, если вещь стёрта. form — какой она стала.
   */
  leave(id: number, form: Form = FORM_GONE): void {
    const i = this.get(id);
    if (!i || i.state !== 'gone') return;
    i.state = 'left';
    i.dark = false;
    i.turns += 1;
    i.form = form;
  }

  /** Чьё состояние изменилось с прошлого вызова (и очистить список). */
  changed(): number[] {
    const ids = [...this.dirty];
    this.dirty.clear();
    return ids;
  }
}
