import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../src/core/i18n';
import { defaultProfile, parseProfile } from '../src/core/save';
import { EVENT_ORDER, EVENTS, FLAGS, Narrative, SLOT_OF, SLOTS, actOf, caretakerOf, emptyNarrative, parseNarrative } from '../src/systems/koma';
import { MEMORY_THINGS } from '../src/systems/session';
import { AWAY_S, HUNT_S, KomaFlow, WRITE_S, lineMs } from '../src/ui/koma_flow';

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
function fakeHost(story: Narrative): { host: ConstructorParameters<typeof KomaFlow>[0]; said: string[]; tags: Array<Record<string, unknown> | null>; values: string[]; stamps: string[]; cards: string[][]; saves: () => number; game: { sterile: number; huntHold: boolean; extended: number; limboLook: string | null; metaHold: boolean; kept: number; metaKeep(): void; extendEnd(s: number): void }; decks: () => number } {
  const said: string[] = [];
  const tags: Array<Record<string, unknown> | null> = [];
  const values: string[] = [];
  const stamps: string[] = [];
  const cards: string[][] = [];
  let saves = 0;
  let decks = 0;
  const game = {
    sterile: 0,
    huntHold: false,
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
    card(head: string, rows: readonly { text: string; who: string }[], ms: number, done: () => void): void {
      cards.push([head, ...rows.map((r) => r.text)]);
      setTimeout(done, ms);
    },
  };
  void story;
  return {
    host: { hud: hud as never, game, save: () => void (saves += 1), deck: () => ((decks += 1), false), hint: () => {} },
    said,
    tags,
    values,
    stamps,
    cards,
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
    // В следующем сне сцены первого не повторяются, и ждать после вещей нечего.
    const was = h.game.extended;
    flow.onDream(false);
    expect(flow.onRecall('sh_alarm', false)).toBe(false);
    expect(flow.onRecall('sh_remote', false)).toBe(false);
    expect(h.game.extended).toBe(was);
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
