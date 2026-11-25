/**
 * Сюжет «Невостребованное» на экране (канон — docs/vylazka/koma/KOMA_NARRATIVE_MASTER_V3_RU.md; как он лёг на игру —
 * koma/adaptation.md). Состояние и условия — systems/koma.ts; здесь — когда что показать.
 *
 * Сон. Вспомнил вещь — на неё заводится бирка: «найдено», имя, «владелец: —». В первом сне три вещи ведут пролог и акт I:
 * первая — приёмка (Смотритель: «сначала запишем»), вторая кажется своей, третья говорит о второй другим голосом — и место,
 * где всё записано, замирает («здесь было больше людей» — «теперь всё на месте»).
 *
 * Лимбо. Экспонат, на который смотрят, получает бирку во весь кадр, и Смотритель дописывает ему владельца — пока на вещь
 * смотрят. Досмотрел — история записана (и вещь «рассказывает» её: обрывок метаслоя). Отвёл взгляд — запись обрывается, на
 * бирке штамп «не подтверждено», а взамен — карточка «известно точно»: коротко, зато правда. Это и есть главный выбор игры, и
 * делается он единственным её глаголом: взглядом. Чем больше дописано, тем неподвижнее следующие сны; честное «не знаю»
 * оставляет их живыми.
 *
 * Дальше (акты II–V) сюжет идёт двумя руслами: сцены во сне — на находке любой вещи, сцены лимбо — у полки, одна глава за
 * лимбо. С акта IV вещь можно не забирать: она остаётся стоять, и отвёл взгляд — «оставлено». Три оставленные вещи, настоящий
 * билет, запись с пустым «дальше» — и эпилог.
 */
import { t } from '../core/i18n';
import { EVENTS, type Line, type Narrative, SLOT_OF } from '../systems/koma';
import { MEMORY_THINGS } from '../systems/session';
import type { Hud } from './hud';

/** Что нужно сюжету от игры и приложения. */
export interface KomaHost {
  hud: Hud;
  game: {
    sterile: number;
    huntHold: boolean;
    keepRecalled: boolean;
    penOn: boolean;
    readonly keptDist: number;
    readonly hunted: boolean;
    limboLook: string | null;
    metaHold: boolean;
    metaKeep(): void;
    extendEnd(seconds: number): void;
    releaseKept(taken: boolean): void;
    /** Тело Смотрителя (A4_E03, один раз за игру): 'come' — встаёт у стола в лимбо, 'go' — рассеивается. */
    caretaker(cmd: 'come' | 'go'): boolean;
  };
  /** Записать профиль. */
  save(): void;
  /** Показать следующий обрывок метаслоя, если он положен; false — нечего. Лимбо отпускает сам обрывок. */
  deck(): boolean;
  /** Пометка для аналитики (короткое слово). */
  hint(id: string): void;
  /** Разовый звук сюжета (палата, у кровати, глухой удар). */
  sound(id: string): void;
  /** Экран конца: позвать done, когда игрок нажал что-нибудь. */
  press(done: () => void): void;
}

type Step = { say: readonly string[] } | { clarify: true } | { sterile: number } | { hunt: true };

/** Первый сон: что ведёт каждая из трёх вещей убежища (пролог и акт I канона). */
const BEATS: Readonly<Record<string, readonly Step[]>> = {
  sh_alarm: [{ say: ['A0_E01', 'A0_E02'] }, { clarify: true }, { say: ['A0_E03'] }],
  sh_kettle: [{ say: ['A1_E01A'] }, { clarify: true }],
  sh_remote: [{ say: ['A1_E01B'] }, { clarify: true }, { sterile: 1 }, { say: ['A1_E02', 'A1_E03'] }, { hunt: true }],
};
/**
 * Дальше сюжет идёт двумя руслами, и ни одно не зависит от того, какое место выпало и какая вещь пришла (места игрок не
 * выбирает): сцены во сне играются на находке любой вещи, сцены лимбо — у полки. Каждое русло берёт первую сцену, чьи условия
 * выполнены; условия — флаги канона (systems/koma.ts), так что порядок держит сам сюжет, а не счёт снов.
 */
export const WORLD: readonly string[] = ['A2_E01', 'A2_E04', 'A3_E02', 'A3_E03'];
export const LIMBO: readonly string[] = ['A2_E02', 'A2_E03', 'A3_E01', 'A3_E04', 'A4_E02', 'A4_E03', 'A5_E02', 'A5_E03', 'F_E01', 'F_E02'];
/** Сцены лимбо, которые идут подряд, одной главой. */
const CHAIN: Readonly<Record<string, string>> = { A4_E02: 'A4_E03', A5_E02: 'A5_E03', A5_E03: 'F_E01', F_E01: 'F_E02' };
/** На сколько дольше стоит место после третьей вещи первого сна: идёт сцена рассортированной комнаты. */
const SORTED_ROOM_S = 19;
/**
 * Охота первого сна (квиз 24.11, «охота после третьей вещи»): Осыпь выходит, когда место замерло и разговор кончился, — и место
 * стоит ещё столько секунд, чтобы она успела дойти. До того — только явления и приметы.
 */
export const HUNT_S = 24;
/** Вещи, у которых Смотритель знает, что дописать (и что о них известно точно); остальным — общая строка. */
const OWNERS: readonly string[] = ['LP01', 'LP02', 'LP03', 'LP04', 'LP05', 'LP06', 'LP07', 'LP08', 'LP09', 'LP10', 'LP11', 'LP13', 'LP14'];
/** За сколько секунд взгляда Смотритель дописывает владельца; сколько секунд без взгляда — и запись оборвана. */
export const WRITE_S = 5;
export const AWAY_S = 1.4;
/** Во сне Смотритель пишет дольше: у игрока должно быть время уйти. */
export const WORLD_WRITE_S = 9;
const WRITE_MAX_S = 12;
/**
 * «Оставить» во сне — уходом (квиз 24.11: отвести взгляд можно нечаянно, убегая от Осыпи; уйти — решение телом). Запись идёт,
 * пока игрок ближе стольких метров к вещи; отошёл дальше — оставлено. Пока Осыпь гонится, не считается ни то ни другое.
 */
export const LEAVE_M = 4.5;
/** Доля записанного в стерильности следующих снов: совсем неподвижным сон делает только полная картотека (акт IV). */
const STERILE_SHARE = 0.7;
/** Экран конца держится, пока игрок не нажмёт, но не дольше (мс): лимбо не должно висеть вечно. */
const END_HOLD_MS = 90000;
/** Полная картотека (A4_E01): через сколько мс после начала сна Смотритель её показывает. */
const ARCHIVE_AT_MS = 6000;
/**
 * Отражение без зеркала (A4_E03): тело Смотрителя сначала собирается из дыма и работает молча — столько мс до первой реплики;
 * договорили — стоит ещё столько, потом рассеивается; глава кончается, когда дым ушёл.
 */
export const BODY_LEAD_MS = 5200;
export const BODY_AFTER_MS = 2400;
const BODY_GO_MS = 1500;

const artOf = (memId: string): string => SLOT_OF[memId] ?? memId;
/** Вид вещи → её записи в сюжете (один чайник бывает вещью разных мест). */
const ARTS_OF_KIND: Readonly<Record<string, string[]>> = (() => {
  const out: Record<string, string[]> = {};
  for (const [memId, kind] of Object.entries(MEMORY_THINGS)) (out[kind] ??= []).push(artOf(memId));
  return out;
})();
const MEM_OF_ART: Readonly<Record<string, string>> = Object.fromEntries(Object.keys(MEMORY_THINGS).map((memId) => [artOf(memId), memId]));
const ownerText = (art: string): string => t(OWNERS.includes(art) ? `koma.owner.${art.toLowerCase()}` : 'koma.owner.other');
const cl = (key: string): Line => ({ key, who: 'caretaker' });
const pl = (key: string): Line => ({ key, who: 'player' });

/** Сколько держится реплика: короткая — полторы секунды, длинная — до четырёх. */
export const lineMs = (text: string): number => Math.max(1500, Math.min(4200, 1100 + 60 * text.length));
const secondsOf = (lines: readonly Line[]): number => lines.reduce((n, l) => n + lineMs(t(l.key)) + 320, 0) / 1000;

interface Writing {
  art: string;
  /** Где пишут: у полки в лимбо (смотрят на экспонат вида kind) или во сне, у оставшейся вещи. */
  where: 'limbo' | 'world';
  kind: string;
  text: string;
  progress: number;
  away: number;
  age: number;
}

export class KomaFlow {
  private run = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private writing: Writing | null = null;
  /** Идёт глава лимбо: пока она идёт, лимбо не отпускает. */
  private busy = false;
  /** В этом лимбо глава уже сыграна: одна на лимбо. */
  private chapterUsed = false;

  constructor(
    private readonly host: KomaHost,
    private readonly story: Narrative,
  ) {}

  private later(ms: number, fn: () => void): void {
    const run = this.run;
    this.timers.push(
      setTimeout(() => {
        if (run !== this.run) return;
        if (this.held) this.heldFns.push({ run, fn });
        else fn();
      }, ms),
    );
  }

  private held = false;
  private heldFns: Array<{ run: number; fn: () => void }> = [];

  /** Пауза игры (меню, свёрнутая вкладка, реклама): всё, чему пришло время, ждёт возврата и идёт дальше с того же места. */
  hold(on: boolean): void {
    this.held = on;
    if (on) return;
    const fns = this.heldFns;
    this.heldFns = [];
    for (const h of fns) if (h.run === this.run) h.fn();
  }

  private cancel(): void {
    this.run += 1;
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
    this.writing = null;
    this.host.game.penOn = false;
  }

  /** Оборвать всё, что идёт (новый сон, лимбо, пауза в меню): таймеры, бирку, разговор; тело Смотрителя, если стоит, рассеивается. */
  stop(): void {
    this.cancel();
    this.host.game.caretaker('go');
    this.busy = false;
    this.host.hud.say([]);
    this.host.hud.tag(null);
    this.host.hud.setKoma(false);
    this.host.hud.veil(null);
  }

  private say(lines: readonly Line[], delay: number, done?: () => void): void {
    const run = this.run;
    this.host.hud.say(
      lines.map((l) => ({ text: t(l.key), who: l.who, ms: lineMs(t(l.key)) })),
      delay,
      () => {
        if (run === this.run) done?.();
      },
    );
  }

  /** Сыграть событие канона: флаги ставятся сразу, строки идут на экран; done — когда договорили (или сразу, если слов нет). */
  private talk(id: string, delay: number, done?: () => void): void {
    const lines = this.story.play(id) ?? [];
    this.host.save();
    this.host.hint(`koma.${id.toLowerCase()}`);
    if (lines.length === 0) done?.();
    else this.say(lines, delay, done);
  }

  /**
   * То же для финальной главы, но событие записывается, только когда его досмотрели: оборвалась глава (свернули вкладку, пауза,
   * реклама) — в следующем лимбо она начнётся с этой же сцены, а не пропадёт (куратор, 411).
   */
  private talkThen(id: string, delay: number, done: () => void): void {
    const lines = EVENTS[id]?.lines ?? [];
    const seal = (): void => {
      this.story.play(id);
      this.host.save();
      this.host.hint(`koma.${id.toLowerCase()}`);
      done();
    };
    if (lines.length === 0) seal();
    else this.say(lines, delay, seal);
  }

  /** Смотритель пишет в поле бирки — по букве, под звук пера. */
  private type(text: string, perMs: number, done: () => void): void {
    this.host.game.penOn = true;
    for (let k = 1; k <= text.length; k++) this.later(perMs * k, () => this.host.hud.tagValue(text.slice(0, k)));
    this.later(perMs * text.length + 400, () => {
      this.host.game.penOn = false;
      done();
    });
  }

  /** «Оставить» предлагается с тех пор, как герой узнал в Смотрителе себя, и до финальной записи. */
  private offering(): boolean {
    return this.story.has('STORY_CARETAKER_REFLECTION') && !this.story.has('STORY_UNFINISHED_RECORD');
  }

  /** Начало сна. first — первый сон игрока. Насколько место замерло — от того, что решено у полки и в прошлых снах. */
  onDream(first: boolean): void {
    this.stop();
    this.settle();
    const g = this.host.game;
    g.sterile = first ? 0 : this.story.stillness(STERILE_SHARE);
    // Первый сон, сюжет ещё не начат: охоту выпускает он сам, после сцены замершей комнаты.
    g.huntHold = first && this.story.canPlay('A0_E01');
    g.keepRecalled = this.offering();
    // Акт IV: Смотритель показывает места, собранные «без ошибок», — весь сон стоит.
    if (!first && this.story.canPlay('A4_E01')) {
      g.sterile = 1;
      this.later(ARCHIVE_AT_MS, () => this.talk('A4_E01', 0));
    }
  }

  /**
   * Вещь вспомнена. true — сюжет сам говорит о ней (строку «вспомнил» приложение не показывает); false — бирка заводится, а
   * строка остаётся прежней.
   */
  onRecall(memId: string, first: boolean): boolean {
    const art = artOf(memId);
    const fresh = this.story.discover(art);
    this.cancel();
    const hud = this.host.hud;
    const g = this.host.game;
    // После финала — сны без бирок: Смотритель молчит, вещь вспоминается как раньше.
    if (this.story.has('STORY_ENDING')) {
      this.host.save();
      return false;
    }
    // Игра оставила эту вещь стоять, если ей так велели до находки; следующей — по тому, где сюжет сейчас.
    const kept = g.keepRecalled && this.offering();
    g.keepRecalled = this.offering();
    hud.tag({ head: t('koma.tag.found'), name: t(`mem.${memId}.task`), key: t('koma.tag.owner'), value: kept ? '' : '—' });
    const steps = first ? BEATS[memId] : undefined;
    const lead = steps?.[0];
    if (steps && lead && 'say' in lead && this.story.canPlay(lead.say[0]!)) {
      this.host.hint(`koma.${memId}`);
      // Сцена, в которой место замирает, идёт после последней вещи сна: место стоит, пока она не кончится.
      if (steps.some((s) => 'sterile' in s)) g.extendEnd(SORTED_ROOM_S);
      this.play(steps, 0);
      return true;
    }
    // Сюжет этот сон не ведёт — охота идёт своим правилом.
    g.huntHold = false;
    if (kept) {
      this.offer(art);
      return true;
    }
    const id = WORLD.find((x) => this.story.canPlay(x));
    if (id) {
      this.worldScene(id, memId);
      return true;
    }
    // Вещь без своей сцены: Смотритель молча ставит «уточнить».
    if (fresh) this.later(1200, () => this.clarify(() => this.later(3200, () => hud.tag(null))));
    else this.later(3200, () => hud.tag(null));
    this.host.save();
    return false;
  }

  private play(steps: readonly Step[], i: number): void {
    const s = steps[i];
    if (!s) {
      this.later(3000, () => this.host.hud.tag(null));
      return;
    }
    const next = (): void => this.play(steps, i + 1);
    if ('say' in s) {
      const lines: Line[] = [];
      for (const id of s.say) lines.push(...(this.story.play(id) ?? []));
      this.host.save();
      if (lines.length === 0) next();
      else this.say(lines, i === 0 ? 500 : 250, next);
    } else if ('clarify' in s) this.clarify(next);
    else if ('sterile' in s) {
      this.host.game.sterile = s.sterile;
      next();
    } else {
      this.host.game.huntHold = false;
      this.host.game.extendEnd(HUNT_S);
      next();
    }
  }

  /** Смотритель вписывает «уточнить» в поле владельца — по букве. */
  private clarify(done: () => void): void {
    this.type(t('koma.tag.clarify'), 90, done);
  }

  /**
   * Сцена во сне (акты II–III): на находке вещи. Бюро (журнал, бейдж) предъявляет сама бирка — нужной вещи игрок мог и не
   * встретить; Рита — воспоминанием; обрыв смены — тёмным кадром и звуком палаты.
   */
  private worldScene(id: string, memId: string): void {
    const hud = this.host.hud;
    const g = this.host.game;
    const lines = this.story.play(id) ?? [];
    this.host.save();
    this.host.hint(`koma.${id.toLowerCase()}`);
    g.extendEnd(secondsOf(lines) + 6);
    const speak = (delay: number): void => this.say(lines, delay, () => this.later(2500, () => hud.tag(null)));
    if (id === 'A2_E01') {
      // Журнал: статус вписан той же рукой, что и «уточнить».
      this.type(t('koma.tag.unclaimed'), 90, () => speak(300));
    } else if (id === 'A2_E04') {
      // Бейдж: на бирке вещи — графа сотрудника.
      hud.tag({ head: t('koma.tag.found'), name: t(`mem.${memId}.task`), key: t('koma.tag.staff'), value: '' });
      this.type(t('koma.tag.bureau'), 90, () => speak(300));
    } else if (id === 'A3_E03') {
      // Обрыв: глухой звук, кадр гаснет на миг — и сквозь него слышно палату. Без аварии и без объяснений.
      hud.tag(null);
      this.host.sound('fall');
      // Под охотой кадр не гасим: вслепую от Осыпи не уйти (куратор, 410) — остаются звук и голоса.
      if (!g.hunted) {
        hud.veil('black');
        this.later(2400, () => hud.veil(null));
      }
      this.later(700, () => this.host.sound('koma_ward'));
      this.say(lines, 2800);
    } else speak(600);
  }

  /**
   * «Оставить» (акты IV–V). Вспомненная вещь осталась стоять; Смотритель дописывает ей владельца, пока игрок рядом. Достоял —
   * записано, вещь уходит на полку. Ушёл — оставлено: вещь стоит где стояла, владельца у неё нет, и месту возвращается
   * движение. Тот же глагол, что у полки, только теперь отказ — не «не знаю», а «не моё».
   */
  private offer(art: string): void {
    this.writing = { art, where: 'world', kind: '', text: ownerText(art), progress: 0, away: 0, age: 0 };
    this.host.game.extendEnd(WORLD_WRITE_S + 14);
    this.host.hint('koma.offer');
    const intro: Line[] = this.story.seen('A4_E04') ? [] : [pl('koma.a4_e04.player_00')];
    this.say([...intro, cl('koma.limbo.caretaker_write')], 300);
  }

  /**
   * Довести начатые сцены сна: если сон кончился раньше разговора (или страницу перезагрузили посреди него), недосказанные
   * события всё равно считаются сыгранными — их флаги нужны дальше, и запирать сюжет паузой нельзя.
   */
  private settle(): void {
    for (const steps of Object.values(BEATS)) {
      const lead = steps[0];
      if (!lead || !('say' in lead) || !this.story.seen(lead.say[0]!)) continue;
      for (const s of steps) if ('say' in s) for (const id of s.say) this.story.play(id);
    }
  }

  private nextLimbo(): string | null {
    return LIMBO.find((id) => this.story.canPlay(id)) ?? null;
  }

  /** Лимбо началось. true — у сюжета здесь есть дело (приложение просит игру ждать взгляда на экспонат). */
  onLimbo(): boolean {
    this.stop();
    this.settle();
    this.chapterUsed = false;
    return this.story.open().length > 0 || this.nextLimbo() !== null;
  }

  /** Игрок посмотрел на экспонат kind. true — сюжет занял это лимбо (бирка или глава); false — пусть решает метаслой. */
  onMeta(kind: string): boolean {
    const open = this.story.open();
    const art = (ARTS_OF_KIND[kind] ?? []).find((a) => open.includes(a));
    if (!art) {
      if (this.chapterUsed || !this.nextLimbo()) return false;
      this.chapter();
      return true;
    }
    const memId = MEM_OF_ART[art]!;
    this.writing = { art, where: 'limbo', kind, text: ownerText(art), progress: 0, away: 0, age: 0 };
    this.host.game.metaKeep();
    this.host.hud.setKoma(true);
    this.host.hud.tag({ head: t('koma.tag.found'), name: t(`mem.${memId}.task`), key: t('koma.tag.owner'), value: '', big: true });
    this.say([cl('koma.limbo.caretaker_write')], 200);
    return true;
  }

  /** Кадр: Смотритель пишет, пока на вещь смотрят. dt — секунды настоящего времени. */
  frame(dt: number): void {
    const g = this.host.game;
    if (this.busy) g.metaKeep();
    const w = this.writing;
    if (!w) return;
    if (w.where === 'world') {
      // Во сне: рядом с вещью — пишет, ушёл — оставлено; под охотой запись стоит.
      if (g.hunted) {
        g.penOn = false;
        return;
      }
      w.age += dt;
      const near = g.keptDist <= LEAVE_M;
      if (near) w.progress = Math.min(1, w.progress + dt / WORLD_WRITE_S);
      g.penOn = near;
      this.host.hud.tagValue(w.text.slice(0, Math.floor(w.progress * w.text.length)));
      if (w.progress >= 1) this.finish(true);
      else if (!near) this.finish(false);
      return;
    }
    w.age += dt;
    const look = g.limboLook === w.kind;
    if (look) {
      w.progress = Math.min(1, w.progress + dt / WRITE_S);
      w.away = 0;
    } else w.away += dt;
    g.penOn = look;
    this.host.hud.tagValue(w.text.slice(0, Math.floor(w.progress * w.text.length)));
    if (w.progress >= 1) this.finish(true);
    else if (w.away > AWAY_S || w.age > WRITE_MAX_S) this.finish(false);
  }

  /** Запись кончилась: дописана (игрок досмотрел) или оборвана (отвёл взгляд). Оба исхода — полноценные. */
  private finish(written: boolean): void {
    const w = this.writing;
    if (!w) return;
    this.writing = null;
    this.host.game.penOn = false;
    if (w.where === 'world') {
      this.finishWorld(w, written);
      return;
    }
    const hud = this.host.hud;
    this.host.game.metaKeep();
    if (written) {
      this.story.label(w.art);
      hud.tagValue(w.text);
      this.host.hint('koma.written');
      this.say([cl('koma.limbo.caretaker_done')], 200, () => this.after(true, w.art));
    } else {
      this.story.markUncertain(w.art);
      hud.tagValue(`${w.text.slice(0, Math.floor(w.progress * w.text.length))}…`, t('koma.tag.unconfirmed'));
      this.host.hint('koma.uncertain');
      this.say([pl('koma.limbo.player_unknown'), cl('koma.limbo.caretaker_later')], 300, () => this.after(false, w.art));
    }
    this.host.save();
  }

  private finishWorld(w: Writing, written: boolean): void {
    const hud = this.host.hud;
    const g = this.host.game;
    const off = (): void => this.later(1800, () => hud.tag(null));
    if (written) {
      this.story.label(w.art);
      hud.tagValue(w.text);
      g.releaseKept(true);
      this.host.hint('koma.written');
      this.say([cl('koma.limbo.caretaker_done')], 200, off);
    } else {
      this.story.release(w.art);
      hud.tagValue('', t('koma.tag.left'));
      g.releaseKept(false);
      this.host.hint('koma.left');
      // Первый раз — сцена канона (A4_E04); второй — две строки; дальше Смотритель уже не спорит.
      let lines: readonly Line[];
      if (this.story.canPlay('A4_E04')) lines = this.story.play('A4_E04') ?? [];
      else if (this.story.state.releasedArtifactIds.length === 2) lines = [cl('koma.a5_e01.caretaker_01'), pl('koma.a5_e01.player_01')];
      else lines = [cl('koma.a5_e01.caretaker_02')];
      g.extendEnd(secondsOf(lines) + 3);
      this.say(lines, 500, off);
    }
    // Оставленное возвращает месту движение, записанное — отнимает (до полной картотеки).
    g.sterile = this.story.stillness(STERILE_SHARE);
    this.host.save();
  }

  /**
   * После бирки у полки: глава сюжета, если её условия выполнены (одна на лимбо); иначе у обоих исходов своя карточка. Дописал —
   * обрывок истории, которую только что записали (метаслой: складная и ничем не подтверждённая). Отказался — «известно точно»:
   * две сухие строки, зато верные. Правда короче выдумки, но «не знаю» — не пустой ход (канон, §3).
   */
  private after(written: boolean, art: string): void {
    const hud = this.host.hud;
    if (!this.chapterUsed && this.nextLimbo()) {
      this.later(900, () => {
        hud.tag(null);
        this.chapter();
      });
      return;
    }
    this.later(1400, () => {
      hud.tag(null);
      hud.setKoma(false);
      this.host.game.metaKeep();
      if (written) {
        if (!this.host.deck()) this.host.game.metaHold = false;
        return;
      }
      const fact = OWNERS.includes(art) ? `koma.fact.${art.toLowerCase()}` : 'koma.fact.other';
      this.host.hint('koma.fact');
      this.card(
        t('koma.fact.head'),
        [
          { text: t(fact), who: 'memory' },
          { text: t('koma.fact.rest'), who: 'memory' },
        ],
        0,
        () => {
          this.host.game.metaHold = false;
        },
      );
    });
  }

  /** Карточка посреди кадра (как обрывки метаслоя): заголовок и строки; done — когда ушла. */
  private card(head: string, rows: readonly { text: string; who: string }[], extraMs: number, done: () => void): void {
    const ms = Math.min(16000, rows.reduce((n, r) => n + lineMs(r.text), 1500) + extraMs);
    const run = this.run;
    this.host.game.metaKeep();
    this.host.hud.card(head, rows, ms, () => {
      if (run === this.run) done();
    });
  }

  /** Глава лимбо: первая сцена, чьи условия выполнены, и те, что идут с ней подряд. Пока идёт — лимбо ждёт. */
  private chapter(): void {
    const id = this.nextLimbo();
    if (!id) {
      this.host.game.metaHold = false;
      return;
    }
    this.chapterUsed = true;
    this.busy = true;
    this.host.game.metaKeep();
    this.scene(id);
  }

  private endChapter(): void {
    this.later(1200, () => {
      this.host.hud.tag(null);
      this.host.hud.setKoma(false);
      this.busy = false;
      this.host.game.metaHold = false;
    });
  }

  private scene(id: string): void {
    const hud = this.host.hud;
    const next = (): void => {
      const n = CHAIN[id];
      if (n && this.story.canPlay(n)) this.scene(n);
      else this.endChapter();
    };
    const big = (head: string, name: string, key: string, value: string): void => {
      hud.setKoma(true);
      hud.tag({ head: t(head), name: t(name), key: t(key), value, big: true });
    };
    const rowsOf = (lines: readonly Line[]): { text: string; who: string }[] => lines.map((l) => ({ text: t(l.key), who: l.who }));
    if (id === 'A2_E02' || id === 'A2_E03') {
      // Старая запись: Рита и он сам; посетитель у стойки. Карточкой, как обрывки метаслоя.
      const lines = this.story.play(id) ?? [];
      this.host.save();
      this.host.hint(id === 'A2_E02' ? 'koma.tape' : 'koma.a2_e03');
      hud.tag(null);
      hud.setKoma(false);
      this.card(t('koma.tape.head'), rowsOf(lines), 0, next);
    } else if (id === 'A3_E01') {
      // Пакет с вещами человека без имени: Смотритель впервые не пишет.
      big('koma.tag.intake', 'koma.tag.effects', 'koma.tag.owner', '—');
      this.talk(id, 900, next);
    } else if (id === 'A3_E04') {
      // Он заполняет бирку героя чужими историями — теми самыми, что дописывал вещам.
      big('koma.tag.unknown', 'koma.tag.effects', 'koma.tag.history', '');
      this.type(`${t('koma.owner.lp05')} ${t('koma.owner.lp01')}`, 45, () =>
        this.talk(id, 300, () => {
          hud.tagValue('—');
          next();
        }),
      );
    } else if (id === 'A4_E02') {
      // Последняя пустая бирка — его собственная.
      big('koma.tag.unknown', 'koma.tag.effects', 'koma.tag.owner', '');
      this.talk(id, 900, next);
    } else if (id === 'A4_E03') {
      // Ранняя сцена сортировки с другого ракурса (канон: «отражение без зеркала»). Его бирка уходит из кадра на стол; у стола —
      // тело Смотрителя, один раз за игру: вполоборота, голова опущена, рука разглаживает бирку и выравнивает её — теми же
      // движениями, что у героя. Без лица, без «я — это ты». Договорили — дым рассеивается (game.caretaker).
      // Строки лимбо по-прежнему убраны: кадр — его.
      hud.tag(null);
      hud.setKoma(true);
      this.host.game.caretaker('come');
      this.talk(id, BODY_LEAD_MS, () =>
        this.later(BODY_AFTER_MS, () => {
          this.host.game.caretaker('go');
          this.later(BODY_GO_MS, next);
        }),
      );
    } else if (id === 'A5_E02') {
      // Настоящий билет: имя на нём есть — и это всё, что он обещает.
      big('koma.tag.ticket', 'koma.ticket.route', 'koma.tag.passenger', '');
      const name = t('koma.hero.name');
      this.type(name, 110, () => {
        hud.tagValue(name, t('koma.tag.unused'));
        this.talkThen(id, 500, next);
      });
    } else if (id === 'A5_E03') {
      // Последняя запись: владелец — имя с билета, история — только проверенное, «дальше» — пусто. Его не заполняет никто.
      const lines = EVENTS[id]!.lines;
      hud.tag(null);
      hud.setKoma(false);
      const rows = [`${t('koma.record.owner')}: ${t('koma.hero.name')}`, `${t('koma.record.history')}: ${t('koma.record.history_text')}`, `${t('koma.record.next')}:`];
      this.card(
        t('koma.record.head'),
        rows.map((text) => ({ text, who: 'caretaker' })),
        secondsOf(lines) * 1000 + 2500,
        () => {
          // Запись закрыта с пустым полем — только теперь она считается сделанной.
          this.story.play(id);
          this.host.save();
          this.host.hint('koma.a5_e03');
          next();
        },
      );
      this.say(lines, 4200);
    } else if (id === 'F_E01') {
      // Эпилог: звук становится обыденным, кадр уходит в свет. Без двери и без награды.
      this.host.sound('koma_bedside');
      hud.veil('white');
      this.later(5200, () => {
        this.story.play(id);
        this.host.save();
        next();
      });
    } else if (id === 'F_E02') {
      this.say(EVENTS[id]!.lines, 400, () =>
        this.later(1400, () =>
          this.card(
            t('koma.final.head'),
            [
              { text: t('koma.final.line_01'), who: 'memory' },
              { text: t('koma.final.line_02'), who: 'memory' },
            ],
            3000,
            () => {
              this.story.play(id);
              this.host.save();
              this.host.hint('koma.ending');
              // Экран конца: название и одна строка, пока игрок не нажмёт. Дальше — сны без бирок.
              const run = this.run;
              let closed = false;
              const close = (): void => {
                if (closed || run !== this.run) return;
                closed = true;
                hud.metaClear();
                hud.veil(null);
                next();
              };
              this.host.hud.card(
                t('koma.end.head'),
                [
                  { text: t('koma.end.line'), who: 'memory' },
                  { text: t('koma.end.next'), who: 'caretaker' },
                ],
                END_HOLD_MS,
                close,
              );
              this.later(1500, () => this.host.press(close));
            },
          ),
        ),
      );
    } else next();
  }
}
