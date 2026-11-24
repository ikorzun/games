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
 * бирке штамп «не подтверждено», а взамен — карточка «известно точно»: коротко, зато правда. Это и есть главный выбор игры, и делается он единственным её глаголом: взглядом. Чем больше
 * дописано, тем неподвижнее следующие сны; честное «не знаю» оставляет их живыми.
 */
import { t } from '../core/i18n';
import { type Line, type Narrative, SLOT_OF } from '../systems/koma';
import { MEMORY_THINGS } from '../systems/session';
import type { Hud } from './hud';

/** Что нужно сюжету от игры и приложения. */
export interface KomaHost {
  hud: Hud;
  game: { sterile: number; limboLook: string | null; metaHold: boolean; metaKeep(): void; extendEnd(seconds: number): void };
  /** Записать профиль. */
  save(): void;
  /** Показать следующий обрывок метаслоя, если он положен; false — нечего. Лимбо отпускает сам обрывок. */
  deck(): boolean;
  /** Пометка для аналитики (короткое слово). */
  hint(id: string): void;
}

type Step = { say: readonly string[] } | { clarify: true } | { sterile: number };

/** Первый сон: что ведёт каждая из трёх вещей убежища (пролог и акт I канона). */
const BEATS: Readonly<Record<string, readonly Step[]>> = {
  sh_alarm: [{ say: ['A0_E01', 'A0_E02'] }, { clarify: true }, { say: ['A0_E03'] }],
  sh_kettle: [{ say: ['A1_E01A'] }, { clarify: true }],
  sh_remote: [{ say: ['A1_E01B'] }, { clarify: true }, { sterile: 1 }, { say: ['A1_E02', 'A1_E03'] }],
};
/** На сколько дольше стоит место после третьей вещи первого сна: идёт сцена рассортированной комнаты. */
const SORTED_ROOM_S = 19;
/** Вещи, у которых Смотритель знает, что дописать; остальным — общая строка. */
const OWNERS: readonly string[] = ['LP01', 'LP05', 'LP10'];
/** Лимбо: за сколько секунд взгляда Смотритель дописывает владельца; сколько секунд без взгляда — и запись оборвана. */
export const WRITE_S = 5;
export const AWAY_S = 1.4;
const WRITE_MAX_S = 12;
/** Доля записанного в стерильности следующих снов: совсем неподвижным сон делает только полная картотека (акт IV). */
const STERILE_SHARE = 0.7;

const artOf = (memId: string): string => SLOT_OF[memId] ?? memId;
/** Вид вещи → её записи в сюжете (один чайник бывает вещью разных мест). */
const ARTS_OF_KIND: Readonly<Record<string, string[]>> = (() => {
  const out: Record<string, string[]> = {};
  for (const [memId, kind] of Object.entries(MEMORY_THINGS)) (out[kind] ??= []).push(artOf(memId));
  return out;
})();
const MEM_OF_ART: Readonly<Record<string, string>> = Object.fromEntries(Object.keys(MEMORY_THINGS).map((memId) => [artOf(memId), memId]));

/** Сколько держится реплика: короткая — полторы секунды, длинная — до четырёх. */
export const lineMs = (text: string): number => Math.max(1500, Math.min(4200, 1100 + 60 * text.length));

export class KomaFlow {
  private run = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private writing: { art: string; kind: string; text: string; progress: number; away: number; age: number } | null = null;

  constructor(
    private readonly host: KomaHost,
    private readonly story: Narrative,
  ) {}

  private later(ms: number, fn: () => void): void {
    const run = this.run;
    this.timers.push(
      setTimeout(() => {
        if (run === this.run) fn();
      }, ms),
    );
  }

  /** Оборвать всё, что идёт (новый сон, лимбо, пауза в меню): таймеры, бирку, разговор. */
  stop(): void {
    this.run += 1;
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
    this.writing = null;
    this.host.hud.say([]);
    this.host.hud.tag(null);
    this.host.hud.setKoma(false);
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

  /** Начало сна. first — первый сон игрока. Стерильность места — от того, сколько историй дописано. */
  onDream(first: boolean): void {
    this.stop();
    this.settle();
    this.host.game.sterile = first ? 0 : this.story.sterility() * STERILE_SHARE;
  }

  /**
   * Вещь вспомнена. true — сюжет сам говорит о ней (строку «вспомнил» приложение не показывает); false — бирка заводится, а
   * строка остаётся прежней.
   */
  onRecall(memId: string, first: boolean): boolean {
    const art = artOf(memId);
    const fresh = this.story.discover(art);
    this.run += 1;
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
    const hud = this.host.hud;
    hud.tag({ head: t('koma.tag.found'), name: t(`mem.${memId}.task`), key: t('koma.tag.owner'), value: '—' });
    const steps = first ? BEATS[memId] : undefined;
    const lead = steps?.[0];
    if (!steps || !lead || !('say' in lead) || !this.story.canPlay(lead.say[0]!)) {
      // Вещь без своей сцены: Смотритель молча ставит «уточнить».
      if (fresh) this.later(1200, () => this.clarify(() => this.later(3200, () => hud.tag(null))));
      else this.later(3200, () => hud.tag(null));
      this.host.save();
      return false;
    }
    this.host.hint(`koma.${memId}`);
    // Сцена, в которой место замирает, идёт после последней вещи сна: место стоит, пока она не кончится.
    if (steps.some((s) => 'sterile' in s)) this.host.game.extendEnd(SORTED_ROOM_S);
    this.play(steps, 0);
    return true;
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
    else {
      this.host.game.sterile = s.sterile;
      next();
    }
  }

  /** Смотритель вписывает «уточнить» в поле владельца — по букве. */
  private clarify(done: () => void): void {
    const text = t('koma.tag.clarify');
    for (let k = 1; k <= text.length; k++) this.later(90 * k, () => this.host.hud.tagValue(text.slice(0, k)));
    this.later(90 * text.length + 400, done);
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

  /** Лимбо началось. true — у сюжета здесь есть дело (приложение просит игру ждать взгляда на экспонат). */
  onLimbo(): boolean {
    this.stop();
    this.settle();
    return this.story.open().length > 0 || this.story.canPlay('A2_E02');
  }

  /** Игрок посмотрел на экспонат kind. true — сюжет занял это лимбо (бирка или запись); false — пусть решает метаслой. */
  onMeta(kind: string): boolean {
    const open = this.story.open();
    const art = (ARTS_OF_KIND[kind] ?? []).find((a) => open.includes(a));
    if (!art) {
      if (!this.story.canPlay('A2_E02')) return false;
      this.tape();
      return true;
    }
    const memId = MEM_OF_ART[art]!;
    const text = t(OWNERS.includes(art) ? `koma.owner.${art.toLowerCase()}` : 'koma.owner.other');
    this.writing = { art, kind, text, progress: 0, away: 0, age: 0 };
    this.host.game.metaKeep();
    this.host.hud.setKoma(true);
    this.host.hud.tag({ head: t('koma.tag.found'), name: t(`mem.${memId}.task`), key: t('koma.tag.owner'), value: '', big: true });
    this.say([{ key: 'koma.limbo.caretaker_write', who: 'caretaker' }], 200);
    return true;
  }

  /** Кадр: в лимбо Смотритель пишет, пока на вещь смотрят. dt — секунды настоящего времени. */
  frame(dt: number): void {
    const w = this.writing;
    if (!w) return;
    w.age += dt;
    if (this.host.game.limboLook === w.kind) {
      w.progress = Math.min(1, w.progress + dt / WRITE_S);
      w.away = 0;
    } else w.away += dt;
    this.host.hud.tagValue(w.text.slice(0, Math.floor(w.progress * w.text.length)));
    if (w.progress >= 1) this.finish(true);
    else if (w.away > AWAY_S || w.age > WRITE_MAX_S) this.finish(false);
  }

  /** Запись кончилась: дописана (игрок досмотрел) или оборвана (отвёл взгляд). Оба исхода — полноценные. */
  private finish(written: boolean): void {
    const w = this.writing;
    if (!w) return;
    this.writing = null;
    const hud = this.host.hud;
    this.host.game.metaKeep();
    if (written) {
      this.story.label(w.art);
      hud.tagValue(w.text);
      this.host.hint('koma.written');
      this.say([{ key: 'koma.limbo.caretaker_done', who: 'caretaker' }], 200, () => this.after(true, w.art));
    } else {
      this.story.markUncertain(w.art);
      hud.tagValue(`${w.text.slice(0, Math.floor(w.progress * w.text.length))}…`, t('koma.tag.unconfirmed'));
      this.host.hint('koma.uncertain');
      this.say(
        [
          { key: 'koma.limbo.player_unknown', who: 'player' },
          { key: 'koma.limbo.caretaker_later', who: 'caretaker' },
        ],
        300,
        () => this.after(false, w.art),
      );
    }
    this.host.save();
  }

  /**
   * После бирки: запись с Ритой (один раз); иначе у обоих исходов своя карточка. Дописал — обрывок истории, которую только что
   * записали (метаслой: складная и ничем не подтверждённая). Отказался — «известно точно»: две сухие строки, зато верные.
   * Правда короче выдумки, но «не знаю» — не пустой ход (канон, §3).
   */
  private after(written: boolean, art: string): void {
    const hud = this.host.hud;
    if (this.story.canPlay('A2_E02')) {
      this.later(900, () => {
        hud.tag(null);
        this.tape();
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
      this.card('koma.fact.head', [
        { key: fact, who: 'memory' },
        { key: 'koma.fact.rest', who: 'memory' },
      ]);
      this.host.hint('koma.fact');
    });
  }

  /** Карточка посреди кадра (как обрывки метаслоя): заголовок и строки; когда уйдёт — лимбо отпускает. */
  private card(headKey: string, lines: readonly Line[]): void {
    const rows = lines.map((l) => ({ text: t(l.key), who: l.who }));
    const ms = Math.min(12500, rows.reduce((n, r) => n + lineMs(r.text), 1500));
    this.host.game.metaKeep();
    this.host.hud.card(t(headKey), rows, ms, () => {
      this.host.game.metaHold = false;
    });
  }

  /** Обрывок старой записи: Рита и он сам, в бюро (акт II, тизер). Карточка — как обрывки метаслоя. */
  private tape(): void {
    const lines = this.story.play('A2_E02');
    this.host.save();
    const hud = this.host.hud;
    hud.setKoma(false);
    if (!lines || lines.length === 0) {
      this.host.game.metaHold = false;
      return;
    }
    this.host.hint('koma.tape');
    this.card('koma.tape.head', lines);
  }
}
