import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../src/core/i18n';
import { defaultProfile, parseProfile } from '../src/core/save';
import { EVENT_ORDER, EVENTS, FLAGS, Narrative, SLOT_OF, SLOTS, actOf, caretakerOf, emptyNarrative, parseNarrative } from '../src/systems/koma';
import { MEMORY_THINGS } from '../src/systems/session';
import { AWAY_S, HUNT_S, KomaFlow, LEAVE_M, LIMBO, WORLD, WORLD_WRITE_S, WRITE_S, lineMs } from '../src/ui/koma_flow';

const locale = (lang: string): Record<string, string> => JSON.parse(readFileSync(new URL(`../locales/${lang}/ui.json`, import.meta.url), 'utf8')) as Record<string, string>;
const RU = locale('ru');

/** Пройти обязательную цепочку канона по порядку; три вещи «оставляются», когда это разрешено. */
function playThrough(n: Narrative, releases = 3): void {
  for (const id of EVENT_ORDER) {
    if (id === 'A5_E02') {
      for (const art of ['LP01', 'LP02', 'LP04'].slice(0, releases)) {
        n.discover(art);
        n.release(art);
      }
    }
    n.play(id);
  }
}

describe('сюжет «Невостребованное»: состояние и условия (канон v3)', () => {
  it('обязательная цепочка проходима по порядку без единой необязательной вещи — до финала', () => {
    const n = new Narrative();
    playThrough(n);
    for (const f of FLAGS) expect(n.has(f), f).toBe(true);
    expect(n.act).toBe('ACT_06');
    expect(n.caretaker).toBe('WITNESS');
    // Найдено только три вещи — те, что оставлены; пятнадцать слотов собирать не нужно.
    expect(Object.keys(n.state.artifacts).length).toBe(3);
  });

  it('финал заперт, пока не оставлены три вещи; сама по себе сортировка к нему не ведёт', () => {
    const n = new Narrative();
    playThrough(n, 2);
    expect(n.has('STORY_RELEASE_2')).toBe(true);
    expect(n.has('STORY_PERSONAL_TICKET')).toBe(false);
    expect(n.has('STORY_UNFINISHED_RECORD')).toBe(false);
    expect(n.has('STORY_ENDING')).toBe(false);
    // Дописать истории всем вещам — не способ дойти до конца.
    for (const art of ['LP05', 'LP10', 'LP13']) {
      n.discover(art);
      n.label(art);
    }
    expect(n.canPlay('A5_E02')).toBe(false);
  });

  it('событие играется один раз и только когда выполнены условия', () => {
    const n = new Narrative();
    expect(n.canPlay('A0_E02')).toBe(false);
    expect(n.play('A0_E02')).toBeNull();
    expect(n.play('A0_E01')?.length).toBe(1);
    expect(n.play('A0_E01')).toBeNull();
    expect(n.play('A0_E02')?.map((l) => l.who)).toEqual(['caretaker', 'player', 'caretaker', 'player', 'caretaker']);
    expect(n.has('STORY_INVENTORY_INTRO')).toBe(true);
    // Вторая версия о вещи — только после первой.
    expect(n.canPlay('A1_E01B')).toBe(false);
    n.play('A1_E01A');
    expect(n.canPlay('A1_E01B')).toBe(true);
    expect(n.canPlay('nope')).toBe(false);
  });

  it('«не подтверждено» — полноценное действие: флаг открыт, дописанная история снята, стерильность ниже', () => {
    const n = new Narrative();
    for (const art of ['LP01', 'LP05', 'LP10']) n.discover(art);
    expect(n.sterility()).toBe(0);
    expect(n.open().sort()).toEqual(['LP01', 'LP05', 'LP10']);
    n.label('LP01');
    n.label('LP05');
    expect(n.sterility()).toBeCloseTo(2 / 3);
    expect(n.markUncertain('LP01')).toBe(true);
    expect(n.artifact('LP01').phase).toBe('uncertain');
    expect(n.artifact('LP01').labelled).toBeUndefined();
    expect(n.has('STORY_UNCERTAIN_EVIDENCE_UNLOCKED')).toBe(true);
    expect(n.sterility()).toBeCloseTo(1 / 3);
    // Неподтверждённой вещи историю не дописать; в «открытых» её больше нет.
    expect(n.label('LP01')).toBe(false);
    expect(n.open()).toEqual(['LP10']);
  });

  it('вещь: находка не награждает дважды; улика не доказывает владельца; оставленная — конечная фаза, но не уничтожение', () => {
    const n = new Narrative();
    expect(n.discover('LP02')).toBe(true);
    expect(n.discover('LP02')).toBe(false);
    n.addEvidence('LP02', 'date');
    n.addEvidence('LP02', 'date');
    expect(n.artifact('LP02')).toEqual({ discovered: true, phase: 'evidence', evidenceIds: ['date'] });
    expect(n.release('LP02')).toBe(true);
    expect(n.release('LP02')).toBe(false);
    expect(n.artifact('LP02').phase).toBe('released');
    expect(n.artifact('LP02').discovered).toBe(true);
    expect(n.state.releasedArtifactIds).toEqual(['LP02']);
    // Ненайденную вещь нельзя ни оставить, ни пометить.
    expect(n.release('LP07')).toBe(false);
    expect(n.markUncertain('LP07')).toBe(false);
  });

  it('акт и фаза Смотрителя считаются из флагов', () => {
    expect(actOf([])).toBe('ACT_00');
    expect(actOf(['STORY_INVENTORY_INTRO'])).toBe('ACT_01');
    expect(actOf(['STORY_INVENTORY_INTRO', 'STORY_FIRST_CONTRADICTION'])).toBe('ACT_02');
    expect(caretakerOf([])).toBe('CLERK');
    expect(caretakerOf(['STORY_FIRST_CONTRADICTION'])).toBe('AUTHOR');
    expect(caretakerOf(['STORY_PERFECT_ARCHIVE'])).toBe('CURATOR');
    expect(caretakerOf(['STORY_CARETAKER_REFLECTION'])).toBe('EXPOSED');
    expect(caretakerOf(['STORY_CARETAKER_INTEGRATED'])).toBe('WITNESS');
  });

  it('сохранение: туда и обратно без потерь; мусор и чужая версия схемы начинают сюжет заново, не трогая профиль', () => {
    const n = new Narrative();
    n.play('A0_E01');
    n.play('A0_E02');
    n.discover('LP05');
    n.label('LP05');
    n.discover('LP01');
    n.markUncertain('LP01');
    n.discover('LP04');
    n.release('LP04');
    const back = parseNarrative(JSON.parse(JSON.stringify(n.state)));
    expect(back).toEqual({ ...n.state, activeEventId: null });
    expect(parseNarrative(null)).toEqual(emptyNarrative());
    expect(parseNarrative({ schemaVersion: 2, flags: ['STORY_ASYA_FOUND'], artifacts: { M01: { discovered: true, phase: 'truth' } } })).toEqual(emptyNarrative());
    const dirty = parseNarrative({ schemaVersion: 3, flags: ['STORY_FIRST_ITEM', 'KNOCK_THREE', 7], seenEvents: ['A0_E01', 'X'], artifacts: { LP01: { phase: 'truth', labelled: true }, 'bad id!': { phase: 'released' }, LP02: { phase: 'released', labelled: true } }, activeEventId: 'A0_E02' });
    expect(dirty.flags).toEqual(['STORY_FIRST_ITEM']);
    expect(dirty.seenEvents).toEqual(['A0_E01']);
    expect(dirty.artifacts.LP01).toEqual({ discovered: false, phase: 'unseen', evidenceIds: [], labelled: true });
    expect(dirty.artifacts.LP02).toEqual({ discovered: true, phase: 'released', evidenceIds: [] });
    expect(Object.keys(dirty.artifacts)).toEqual(['LP01', 'LP02']);
    expect(dirty.releasedArtifactIds).toEqual(['LP02']);
    expect(dirty.activeEventId).toBeNull();
    // Профиль: поле сюжета есть у нового, читается у старого (без поля) и не ломает остальное.
    expect(defaultProfile(1).koma).toEqual(emptyNarrative());
    const old = parseProfile({ v: 1, sorties: 4, successes: 3, archive: ['kettle'], baseSeed: 5 }, 9);
    expect(old.successes).toBe(3);
    expect(old.koma).toEqual(emptyNarrative());
    expect(parseProfile({ v: 1, koma: n.state }, 9).koma.flags).toEqual(n.state.flags);
  });

  it('тексты: у каждой реплики есть строка на трёх языках; в сюжете нет запрещённого каноном (сестра, стук, звонок как ключ)', () => {
    const keys = Object.values(EVENTS).flatMap((e) => e.lines.map((l) => l.key));
    expect(keys.length).toBeGreaterThanOrEqual(23);
    for (const lang of ['ru', 'en', 'es']) {
      const L = locale(lang);
      for (const k of keys) expect(L[k], `${lang}: ${k}`).toBeTruthy();
    }
    for (const k of keys) expect(k).toMatch(/^[a-z0-9_.]+$/);
    const koma = Object.entries(RU).filter(([k]) => k.startsWith('koma.') || k === 'intro.goal' || k === 'swarm.first' || k === 'title.how');
    for (const [k, v] of koma) expect(v, k).not.toMatch(/сестр|стук|постуч|звон|просн|спаси/i);
  });

  it('слоты: вещи игры привязаны к слотам канона, билет героя (LP14) — не тот же слот, что чужой билет (LP02)', () => {
    for (const [mem, slot] of Object.entries(SLOT_OF)) {
      expect(MEMORY_THINGS[mem], mem).toBeTruthy();
      expect(SLOTS[slot], slot).toBeTruthy();
    }
    expect(new Set(Object.values(SLOT_OF)).size).toBe(Object.keys(SLOT_OF).length);
    expect(SLOT_OF.of_ticket).toBe('LP02');
    expect(SLOT_OF.st_ticket).toBe('LP14');
  });
});

/** Экран-заглушка: записывает, что сюжет ему говорит. */
function fakeHost(story: Narrative): { host: ConstructorParameters<typeof KomaFlow>[0]; said: string[]; tags: Array<Record<string, unknown> | null>; values: string[]; stamps: string[]; cards: string[][]; saves: () => number; sounds: string[]; veils: Array<string | null>; game: { sterile: number; huntHold: boolean; keepRecalled: boolean; penOn: boolean; keptDist: number; hunted: boolean; released: boolean[]; releaseKept(taken: boolean): void; extended: number; limboLook: string | null; metaHold: boolean; kept: number; metaKeep(): void; extendEnd(s: number): void }; decks: () => number } {
  const said: string[] = [];
  const tags: Array<Record<string, unknown> | null> = [];
  const values: string[] = [];
  const stamps: string[] = [];
  const cards: string[][] = [];
  const sounds: string[] = [];
  const veils: Array<string | null> = [];
  let saves = 0;
  let decks = 0;
  const game = {
    sterile: 0,
    huntHold: false,
    keepRecalled: false,
    penOn: false,
    keptDist: Infinity,
    hunted: false,
    released: [] as boolean[],
    releaseKept(taken: boolean): void {
      this.released.push(taken);
    },
    extended: 0,
    extendEnd(s: number): void {
      this.extended += s;
    },
    limboLook: null as string | null,
    metaHold: false,
    kept: 0,
    metaKeep(): void {
      this.metaHold = true;
      this.kept += 1;
    },
  };
  const hud = {
    say(lines: readonly { text: string; who: string; ms: number }[], delay = 0, done?: () => void): void {
      for (const l of lines) said.push(`${l.who}: ${l.text}`);
      const total = delay + lines.reduce((n, l) => n + l.ms + 320, 0);
      if (lines.length > 0) setTimeout(() => done?.(), total);
    },
    tag(v: Record<string, unknown> | null): void {
      tags.push(v);
    },
    tagValue(value: string, stamp?: string): void {
      values.push(value);
      if (stamp) stamps.push(stamp);
    },
    setKoma(): void {},
    veil(kind: string | null): void {
      veils.push(kind);
    },
    metaClear(): void {},
    card(head: string, rows: readonly { text: string; who: string }[], ms: number, done: () => void): void {
      cards.push([head, ...rows.map((r) => r.text)]);
      setTimeout(done, ms);
    },
  };
  void story;
  return {
    host: { hud: hud as never, game, save: () => void (saves += 1), deck: () => ((decks += 1), false), hint: () => {}, sound: (id: string) => void sounds.push(id), press: (done: () => void) => void setTimeout(done, 100) },
    said,
    tags,
    values,
    stamps,
    cards,
    sounds,
    veils,
    saves: () => saves,
    game,
    decks: () => decks,
  };
}

describe('сюжет на экране: первый сон и бирка в лимбо', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    i18n.addStrings('ru', RU);
    i18n.setLang('ru');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('первый сон: приёмка, «кажется своим», вторая версия — и место замирает; строки идут по канону', () => {
    const story = new Narrative();
    const h = fakeHost(story);
    const flow = new KomaFlow(h.host, story);
    flow.onDream(true);
    expect(h.game.sterile).toBe(0);
    // Первый сон сюжета: охоту держит он (квиз 24.11) — после первой вещи Осыпь не выходит.
    expect(h.game.huntHold).toBe(true);

    expect(flow.onRecall('sh_alarm', true)).toBe(true);
    expect(h.tags.at(-1)).toMatchObject({ head: 'найдено', name: RU['mem.sh_alarm.task'], key: 'владелец', value: '—' });
    vi.advanceTimersByTime(40000);
    expect(h.said).toEqual(['echo: я точно здесь его оставил.', 'caretaker: подожди. сначала запишем.', 'player: что?', 'caretaker: что нашли.', 'player: а чьё это?', 'caretaker: пока не знаем. положи сюда.', 'player: так можно?', 'caretaker: временно.']);
    // Смотритель вписал «уточнить» по буквам.
    expect(h.values).toContain('у');
    expect(h.values).toContain('уточнить');
    expect(story.has('STORY_FIRST_ITEM') && story.has('STORY_INVENTORY_INTRO')).toBe(true);
    expect(story.artifact('LP05').phase).toBe('association');

    h.said.length = 0;
    expect(flow.onRecall('sh_kettle', true)).toBe(true);
    vi.advanceTimersByTime(20000);
    expect(h.said).toEqual(['echo: я сам налью. я уже большой.', 'player: руки маленькие. кажется, мои.']);
    expect(h.game.sterile).toBe(0);
    // До третьей вещи конец сна никто не отодвигал.
    expect(h.game.extended).toBe(0);
    expect(h.game.huntHold).toBe(true);

    h.said.length = 0;
    expect(flow.onRecall('sh_remote', true)).toBe(true);
    vi.advanceTimersByTime(15000);
    // Вторая версия сказана, «уточнить» вписано — место замерло раньше, чем прозвучало «не сходится».
    expect(h.game.sterile).toBe(1);
    // Разговор ещё идёт — охоты нет.
    expect(h.game.huntHold).toBe(true);
    const room = h.game.extended;
    vi.advanceTimersByTime(20000);
    expect(h.said).toEqual(['echo: нет, это мой чайник. детей в доме не было.', 'caretaker: можно выбрать более ясную.', 'player: выбрать?', 'caretaker: чтобы потом не путаться.', 'player: не сходится.', 'caretaker: пока нет.', 'player: здесь было больше людей.', 'caretaker: теперь всё на месте.']);
    expect(story.has('STORY_FIRST_CONTRADICTION')).toBe(true);
    expect(h.saves()).toBeGreaterThan(3);
    // Реплики укладываются в отведённое месту время.
    const ms = h.said.reduce((n, l) => n + lineMs(l.split(': ')[1]!) + 320, 0);
    expect(room).toBeGreaterThan(10);
    expect(ms / 1000).toBeLessThan(room + 3.5);
    // Разговор кончился — Осыпь отпущена, и место стоит ещё HUNT_S секунд, чтобы она дошла.
    vi.advanceTimersByTime(10000);
    expect(h.game.huntHold).toBe(false);
    expect(h.game.extended).toBe(room + HUNT_S);
  });

  it('охота: сюжет держит её только в первом сне и только пока ведёт его сам', () => {
    const story = new Narrative();
    const h = fakeHost(story);
    const flow = new KomaFlow(h.host, story);
    // Не первый сон — охота идёт своим правилом.
    flow.onDream(false);
    expect(h.game.huntHold).toBe(false);
    // Первый сон, но вещи пришли не в том порядке, в каком идёт сцена: сюжет сон не ведёт и охоту отпускает сразу.
    flow.onDream(true);
    expect(h.game.huntHold).toBe(true);
    expect(flow.onRecall('sh_remote', true)).toBe(false);
    expect(h.game.huntHold).toBe(false);
    expect(h.game.extended).toBe(0);
    // Сюжет уже начат (первый сон оборвали и начали заново) — держать нечего.
    const story2 = new Narrative();
    const h2 = fakeHost(story2);
    const flow2 = new KomaFlow(h2.host, story2);
    flow2.onDream(true);
    flow2.onRecall('sh_alarm', true);
    flow2.onDream(true);
    expect(h2.game.huntHold).toBe(false);
  });

  it('сон кончился раньше разговора — недосказанное считается сыгранным: флаги не теряются', () => {
    const story = new Narrative();
    const h = fakeHost(story);
    const flow = new KomaFlow(h.host, story);
    flow.onDream(true);
    flow.onRecall('sh_alarm', true);
    flow.onRecall('sh_kettle', true);
    flow.onRecall('sh_remote', true);
    // Ни одна секунда не прошла: лимбо.
    expect(flow.onLimbo()).toBe(true);
    expect(story.has('STORY_INVENTORY_INTRO')).toBe(true);
    expect(story.has('STORY_FIRST_CONTRADICTION')).toBe(true);
    expect(story.seen('A1_E03')).toBe(true);
    expect(story.canPlay('A2_E02')).toBe(true);
    // В следующем сне сцены первого не повторяются: на находке играет следующая сцена сюжета (журнал), а потом — ничего.
    flow.onDream(false);
    h.said.length = 0;
    expect(flow.onRecall('sh_alarm', false)).toBe(true);
    expect(story.seen('A2_E01')).toBe(true);
    expect(story.seen('A0_E01') && !h.said.some((l) => l.includes('сначала запишем'))).toBe(true);
    expect(flow.onRecall('sh_remote', false)).toBe(false);
  });

  it('лимбо: досмотрел — история записана и вещь её «рассказывает»; отвёл взгляд — «не подтверждено»; оба исхода принимаются', () => {
    const story = new Narrative();
    const h = fakeHost(story);
    const flow = new KomaFlow(h.host, story);
    for (const m of ['sh_alarm', 'sh_kettle', 'sh_remote']) story.discover(SLOT_OF[m]!);
    expect(flow.onLimbo()).toBe(true);
    // Посмотрел на чайник: бирка во весь кадр, Смотритель пишет, пока смотрят.
    h.game.limboLook = 'kettle';
    expect(flow.onMeta('kettle')).toBe(true);
    expect(h.game.metaHold).toBe(true);
    expect(h.tags.at(-1)).toMatchObject({ big: true, name: RU['mem.sh_kettle.task'], value: '' });
    expect(h.said.at(-1)).toBe('caretaker: смотри сюда. я допишу.');
    for (let i = 0; i < 10; i++) flow.frame(WRITE_S / 20);
    const half = h.values.at(-1)!;
    expect(half.length).toBeGreaterThan(5);
    expect(RU['koma.owner.lp01']!.startsWith(half)).toBe(true);
    // Отвёл взгляд: запись стоит, потом обрывается.
    h.game.limboLook = null;
    flow.frame(AWAY_S * 0.5);
    expect(story.artifact('LP01').phase).toBe('association');
    flow.frame(AWAY_S * 0.6);
    expect(story.artifact('LP01').phase).toBe('uncertain');
    expect(h.stamps).toEqual(['не подтверждено']);
    expect(h.values.at(-1)).toBe(`${half}…`);
    expect(h.said.slice(-2)).toEqual(['player: я не знаю, чьё это.', 'caretaker: …оставим до выяснения.']);
    vi.advanceTimersByTime(20000);
    // Записи с Ритой ещё не положено (противоречия не было). Отказ — не пустой ход (канон, §3): вместо обрывка выдуманной
    // истории — карточка «известно точно», и лимбо отпущено.
    expect(h.cards).toEqual([[RU['koma.fact.head'], RU['koma.fact.lp01'], RU['koma.fact.rest']]]);
    expect(h.game.metaHold).toBe(false);
    expect(h.decks()).toBe(0);

    // Следующее лимбо: будильник — досмотрел до конца.
    expect(flow.onLimbo()).toBe(true);
    h.game.limboLook = 'alarm_clock';
    expect(flow.onMeta('alarm_clock')).toBe(true);
    for (let i = 0; i < 21; i++) flow.frame(WRITE_S / 20);
    expect(story.artifact('LP05').labelled).toBe(true);
    expect(h.values.at(-1)).toBe(RU['koma.owner.lp05']);
    expect(h.said.at(-1)).toBe('caretaker: записал.');
    vi.advanceTimersByTime(20000);
    // Дописанная история — с обрывком метаслоя (если он положен): приложение спросили.
    expect(h.decks()).toBe(1);
    expect(h.game.metaHold).toBe(false);
    expect(story.sterility()).toBeCloseTo(1 / 3);
    // Стерильность следующего сна — от дописанного.
    flow.onDream(false);
    expect(h.game.sterile).toBeGreaterThan(0.2);
    expect(h.game.sterile).toBeLessThan(0.3);
    // На вещь, у которой всё решено, сюжет лимбо не занимает.
    flow.onLimbo();
    expect(flow.onMeta('kettle')).toBe(false);
  });
});

describe('сюжет на экране: акты II–V и эпилог', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    i18n.addStrings('ru', RU);
    i18n.setLang('ru');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Лимбо: посмотреть на экспонат, у которого сюжету писать нечего, — играет глава. */
  const limbo = (flow: KomaFlow, h: ReturnType<typeof fakeHost>): void => {
    expect(flow.onLimbo()).toBe(true);
    h.said.length = 0;
    h.cards.length = 0;
    expect(flow.onMeta('nothing_of_the_story')).toBe(true);
    expect(h.game.metaHold).toBe(true);
    vi.advanceTimersByTime(90000);
    expect(h.game.metaHold, 'лимбо отпущено после главы').toBe(false);
  };

  it('от первого сна до эпилога: каждая сцена приходит в свой черёд, какие бы вещи ни выпали', () => {
    const story = new Narrative();
    const h = fakeHost(story);
    const flow = new KomaFlow(h.host, story);
    // Сон 1 — пролог и акт I.
    flow.onDream(true);
    for (const id of ['sh_alarm', 'sh_kettle', 'sh_remote']) {
      flow.onRecall(id, true);
      vi.advanceTimersByTime(60000);
    }
    // Лимбо 1 — старая запись с Ритой.
    limbo(flow, h);
    expect(h.cards).toEqual([[RU['koma.tape.head'], RU['koma.a2_e02.rita_01'], RU['koma.a2_e02.player_memory_01'], RU['koma.a2_e02.rita_02'], RU['koma.a2_e02.player_memory_02'], RU['koma.a2_e02.rita_03']]]);

    // Сон 2 — журнал: статус на бирке вписан той же рукой; вещь любая.
    flow.onDream(false);
    h.said.length = 0;
    expect(flow.onRecall('ye_sign', false)).toBe(true);
    vi.advanceTimersByTime(30000);
    expect(h.values).toContain(RU['koma.tag.unclaimed']);
    expect(h.said).toEqual(['player: почему я это знаю?', 'caretaker: ты здесь давно.', 'player: где — здесь?', 'caretaker: среди этих вещей.']);
    // Раскрытие бюро заперто, пока посетитель не забрал своё: вторая вещь сна — без сцены.
    expect(flow.onRecall('of_cooler', false)).toBe(false);
    // Лимбо 2 — посетитель у стойки.
    limbo(flow, h);
    expect(h.cards[0]).toEqual([RU['koma.tape.head'], 'она моя.', 'я думал, что…', 'мне просто нужно её забрать.']);
    expect(story.has('STORY_STORIES_NOT_FACTS')).toBe(true);

    // Сон 3 — бюро находок: графа «сотрудник» на бирке чужой вещи (ни журнала, ни бейджа игрок мог не встретить).
    flow.onDream(false);
    h.said.length = 0;
    expect(flow.onRecall('st_cup', false)).toBe(true);
    vi.advanceTimersByTime(40000);
    expect(h.tags.some((v) => v?.key === RU['koma.tag.staff'])).toBe(true);
    expect(h.values).toContain(RU['koma.tag.bureau']);
    expect(h.said.at(-1)).toBe('caretaker: раньше хватало.');
    expect(story.has('STORY_ROLE_REVEALED')).toBe(true);
    // Лимбо 3 — пакет без имени: Смотритель не пишет.
    limbo(flow, h);
    expect(h.tags.some((v) => v?.head === RU['koma.tag.intake'] && v.name === RU['koma.tag.effects'] && v.value === '—' && v.big === true)).toBe(true);
    expect(h.said).toEqual(['player: это моё?', 'caretaker: похоже.', 'player: почему ты не записываешь?', 'caretaker: не хочу ошибиться.']);

    // Сон 4 — обычная смена и обрыв: глухой звук, кадр гаснет на миг, палата. Ни аварии, ни диагноза.
    flow.onDream(false);
    h.said.length = 0;
    expect(flow.onRecall('sh_coat', false)).toBe(true);
    vi.advanceTimersByTime(30000);
    expect(h.said.at(-1)).toBe('rita: вот. уже ближе.');
    expect(story.has('STORY_COMA_REVEALED')).toBe(false);
    h.veils.length = 0;
    expect(flow.onRecall('of_phone', false)).toBe(true);
    vi.advanceTimersByTime(30000);
    expect(h.sounds).toEqual(['fall', 'koma_ward']);
    expect(h.veils).toEqual(['black', null]);
    expect(h.said.slice(-3)).toEqual(['staff: …так и не приходил в себя?', 'staff: нет. вещи его у нас, в пакете.', 'staff: запишите пока без имени.']);
    expect(story.has('STORY_COMA_REVEALED')).toBe(true);
    // Лимбо 4 — его бирку заполняют чужими историями.
    limbo(flow, h);
    expect(h.values).toContain(`${RU['koma.owner.lp05']} ${RU['koma.owner.lp01']}`);
    expect(h.said.at(-1)).toBe('player: но я этого не прожил.');
    expect(story.has('STORY_SELF_MISFILED')).toBe(true);

    // Сон 5 — полная картотека: место стоит с первой секунды.
    flow.onDream(false);
    expect(h.game.sterile).toBe(1);
    h.said.length = 0;
    vi.advanceTimersByTime(30000);
    expect(h.said).toEqual(['caretaker: смотри. ничего не потеряно.', 'player: они перестали двигаться.', 'caretaker: зато мы знаем, где всё лежит.']);
    // «Оставить» ещё не предлагают: вещь уходит как раньше.
    expect(h.game.keepRecalled).toBe(false);
    // Лимбо 5 — последняя пустая бирка и узнавание: две сцены одной главой.
    limbo(flow, h);
    expect(h.said.slice(-3)).toEqual(['caretaker: да.', 'player: я тоже всегда так делал.', 'caretaker: да.']);
    expect(story.has('STORY_CARETAKER_REFLECTION')).toBe(true);

    // Сон 6 — можно не забирать. Место всё ещё стоит; вещь остаётся на месте.
    flow.onDream(false);
    expect(h.game.sterile).toBe(1);
    expect(h.game.keepRecalled).toBe(true);
    const leave = (memId: string): void => {
      h.said.length = 0;
      h.game.keptDist = 1;
      expect(flow.onRecall(memId, false)).toBe(true);
      flow.frame(1);
      // Осыпь гонится — уход от вещи ничего не решает.
      h.game.hunted = true;
      h.game.keptDist = LEAVE_M + 6;
      flow.frame(3);
      expect(story.artifact(SLOT_OF[memId] ?? memId).phase).not.toBe('released');
      // Вернулся, охота кончилась — и ушёл сам.
      h.game.hunted = false;
      h.game.keptDist = 1;
      flow.frame(0.5);
      h.game.keptDist = LEAVE_M + 0.5;
      flow.frame(0.1);
      expect(story.artifact(SLOT_OF[memId] ?? memId).phase).toBe('released');
      vi.advanceTimersByTime(30000);
    };
    leave('of_ticket');
    expect(h.stamps.at(-1)).toBe(RU['koma.tag.left']);
    expect(h.game.released.at(-1)).toBe(false);
    expect(h.said).toEqual(['player: можно не забирать.', 'caretaker: смотри сюда. я допишу.', 'caretaker: и что написать?', 'player: ничего.', 'caretaker: нужно же что-то…', 'caretaker: ладно. пока так.']);
    expect(story.has('STORY_FIRST_UNCLAIMED') && story.has('STORY_RELEASE_1')).toBe(true);
    // Оставленное возвращает месту движение.
    expect(h.game.sterile).toBeCloseTo(2 / 3);
    // Досмотрел — записано: вещь уходит, финал не приближается.
    // Достоял рядом — записано: вещь уходит, финал не приближается.
    h.game.keptDist = 1;
    flow.onRecall('st_key', false);
    for (let i = 0; i < 21; i++) flow.frame(WORLD_WRITE_S / 20);
    expect(story.artifact('LP07').labelled).toBe(true);
    expect(h.game.released.at(-1)).toBe(true);
    expect(story.has('STORY_RELEASE_2')).toBe(false);
    vi.advanceTimersByTime(20000);
    leave('sh_photo');
    expect(h.said.slice(-2)).toEqual(['caretaker: пусто?', 'player: пусто.']);
    leave('ye_clock');
    expect(h.said.at(-1)).toBe('caretaker: оставляю как есть.');
    expect(story.has('STORY_RELEASE_3')).toBe(true);
    expect(h.game.sterile).toBe(0);

    // Лимбо 6 — билет, запись с пустым «дальше», эпилог: одной главой.
    h.sounds.length = 0;
    h.veils.length = 0;
    limbo(flow, h);
    expect(h.tags.some((v) => v?.head === RU['koma.tag.ticket'] && v.key === RU['koma.tag.passenger'])).toBe(true);
    expect(h.values).toContain(RU['koma.hero.name']);
    expect(h.stamps.at(-1)).toBe(RU['koma.tag.unused']);
    const record = h.cards.find((c) => c[0] === RU['koma.record.head'])!;
    expect(record[1]).toBe(`${RU['koma.record.owner']}: ${RU['koma.hero.name']}`);
    // Поле «дальше» пустое, и его не заполняет никто.
    expect(record[3]).toBe(`${RU['koma.record.next']}:`);
    expect(h.said).toContain('caretaker: хорошая причина.');
    expect(h.said.slice(-4)).toEqual(['player: а дальше?', 'caretaker: не знаю.', 'player: я тоже.', 'staff: вы меня слышите?']);
    expect(h.sounds).toEqual(['koma_bedside']);
    expect(h.veils.filter((v) => v !== null)).toEqual(['white']);
    expect(h.veils.at(-1)).toBe(null);
    expect(h.cards.at(-2)).toEqual([RU['koma.final.head'], RU['koma.final.line_01'], RU['koma.final.line_02']]);
    // Экран конца: название и строка, пока игрок не нажмёт.
    expect(h.cards.at(-1)).toEqual([RU['koma.end.head'], RU['koma.end.line'], RU['koma.end.next']]);
    // Имя на билете стёрто (квиз 24.11): только инициалы.
    expect(RU['koma.hero.name']).toBe('н. а. с—');
    // Все флаги канона, кроме одного: «не подтверждено» — выбор игрока у полки, и финал от него не зависит.
    for (const f of FLAGS) expect(story.has(f), f).toBe(f !== 'STORY_UNCERTAIN_EVIDENCE_UNLOCKED');

    // После финала: место живое, вещи уходят как раньше, Смотритель молчит.
    flow.onDream(false);
    expect(h.game.sterile).toBe(0);
    expect(h.game.keepRecalled).toBe(false);
    expect(flow.onRecall('ye_sign', false)).toBe(false);
    expect(flow.onLimbo()).toBe(story.open().length > 0);
  });

  it('русла сюжета покрывают канон: каждая сцена актов II–V стоит в одном из них, и у каждой есть слова', () => {
    const led = new Set([...WORLD, ...LIMBO, 'A4_E01', 'A4_E04']);
    for (const id of EVENT_ORDER) {
      if (id.startsWith('A0') || id.startsWith('A1')) continue;
      expect(led.has(id), id).toBe(true);
      if (id !== 'F_E01') expect(EVENTS[id]!.lines.length, id).toBeGreaterThan(0);
    }
  });

  it('глава, прерванная посередине (перезагрузка), продолжается со следующей сцены, а не запирает сюжет', () => {
    const story = new Narrative();
    for (const id of EVENT_ORDER) {
      if (id === 'A4_E03') break;
      story.play(id);
    }
    expect(story.seen('A4_E02') && !story.seen('A4_E03')).toBe(true);
    const h = fakeHost(story);
    const flow = new KomaFlow(h.host, story);
    limbo(flow, h);
    expect(h.said).toEqual(['player: я тоже всегда так делал.', 'caretaker: да.']);
    expect(story.has('STORY_CARETAKER_REFLECTION')).toBe(true);
  });

  it('финальная глава, оборванная посреди (свернули вкладку), не пропадает: в следующем лимбо идёт с той же сцены', () => {
    const story = new Narrative();
    for (const art of ['LP01', 'LP02', 'LP04']) {
      story.discover(art);
      story.release(art);
    }
    for (const id of EVENT_ORDER) {
      if (id === 'A5_E02') break;
      story.play(id);
    }
    const h = fakeHost(story);
    const flow = new KomaFlow(h.host, story);
    expect(flow.onLimbo()).toBe(true);
    flow.onMeta('nothing_of_the_story');
    // Билет показан, разговор идёт — и тут всё обрывается.
    vi.advanceTimersByTime(4000);
    flow.stop();
    expect(story.has('STORY_PERSONAL_TICKET')).toBe(false);
    limbo(flow, h);
    expect(h.said[0]).toBe('player: я собирался уехать.');
    expect(story.has('STORY_ENDING')).toBe(true);
  });

  it('тот, кто всегда стоит до конца записи, финал не получает — но и не заперт: оставить можно любую следующую вещь', () => {
    const story = new Narrative();
    for (const id of EVENT_ORDER) {
      if (id === 'A4_E04') break;
      story.play(id);
    }
    const h = fakeHost(story);
    const flow = new KomaFlow(h.host, story);
    flow.onDream(false);
    h.game.keptDist = 1;
    for (const memId of ['sh_alarm', 'sh_kettle', 'sh_remote', 'sh_coat']) {
      flow.onRecall(memId, false);
      for (let i = 0; i < 21; i++) flow.frame(WORLD_WRITE_S / 20);
      vi.advanceTimersByTime(10000);
    }
    expect(story.state.releasedArtifactIds.length).toBe(0);
    expect(flow.onLimbo()).toBe(false);
    // Те же вещи приходят снова (цепочки мест идут по кругу) — и записанную можно оставить.
    flow.onDream(false);
    for (const memId of ['sh_alarm', 'sh_kettle', 'sh_remote']) {
      h.game.keptDist = 1;
      flow.onRecall(memId, false);
      flow.frame(0.5);
      h.game.keptDist = LEAVE_M + 1;
      flow.frame(0.1);
      vi.advanceTimersByTime(20000);
    }
    expect(story.has('STORY_RELEASE_3')).toBe(true);
    expect(flow.onLimbo()).toBe(true);
  });
});
