/**
 * Сюжет «KOMA — Невостребованное», канон v3 (docs/vylazka/koma/KOMA_NARRATIVE_MASTER_V3_RU.md; партнёр 24.11: «примени как
 * основной геймплей»). Здесь — только состояние и правила: флаги, фазы вещей, события с условиями, сохранение. Что эти события
 * значат на экране, решает приложение (koma_flow.ts); к каким вещам и местам игры привязаны слоты — koma/mapping.md.
 *
 * Герой собирает личность из чужих вещей. Вещь проходит фазы: не видел → ассоциация (кажется своим) → улика (есть проверяемый
 * факт) → не подтверждено (версии спорят) → оставлено (герой перестал считать её своей). Фазы «правда» нет: ни одна вещь не
 * хранит объективной сцены. Честное «не знаю» — полноценное действие, а не провал.
 *
 * Сверх канона (дописано основной моделью, koma/adaptation.md): у вещи есть отметка labelled — Смотритель дописал ей историю
 * (игрок досмотрел, как он пишет). Из неё считается «стерильность» мира: чем больше дописано, тем неподвижнее место.
 */

export type MemoryPhase = 'unseen' | 'association' | 'evidence' | 'uncertain' | 'released';
export type CaretakerPhase = 'CLERK' | 'AUTHOR' | 'CURATOR' | 'EXPOSED' | 'WITNESS';
export type Speaker = 'caretaker' | 'player' | 'echo' | 'rita' | 'memory' | 'staff';

export const FLAGS = [
  'STORY_FIRST_ITEM',
  'STORY_INVENTORY_INTRO',
  'STORY_FIRST_CONTRADICTION',
  'STORY_UNCERTAIN_EVIDENCE_UNLOCKED',
  'STORY_RITA_INTRODUCED',
  'STORY_STORIES_NOT_FACTS',
  'STORY_ROLE_REVEALED',
  'STORY_PERSONAL_EFFECTS',
  'STORY_COMA_REVEALED',
  'STORY_SELF_MISFILED',
  'STORY_PERFECT_ARCHIVE',
  'STORY_CARETAKER_REFLECTION',
  'STORY_FIRST_UNCLAIMED',
  'STORY_RELEASE_1',
  'STORY_RELEASE_2',
  'STORY_RELEASE_3',
  'STORY_PERSONAL_TICKET',
  'STORY_UNFINISHED_RECORD',
  'STORY_CARETAKER_INTEGRATED',
  'STORY_ENDING',
] as const;
export type Flag = (typeof FLAGS)[number];
const isFlag = (v: unknown): v is Flag => typeof v === 'string' && (FLAGS as readonly string[]).includes(v);

/** Смысловые слоты вещей (канон, §5). required — без него сюжет не складывается; остальные финал не запирают. */
export const SLOTS: Readonly<Record<string, { required: boolean }>> = {
  LP01: { required: true },
  LP02: { required: true },
  LP03: { required: false },
  LP04: { required: true },
  LP05: { required: false },
  LP06: { required: false },
  LP07: { required: false },
  LP08: { required: true },
  LP09: { required: true },
  LP10: { required: true },
  LP11: { required: true },
  LP12: { required: true },
  LP13: { required: true },
  LP14: { required: true },
  LP15: { required: true },
};

export interface ArtifactState {
  discovered: boolean;
  phase: MemoryPhase;
  evidenceIds: string[];
  /** Смотритель дописал историю владельца (сверх канона). */
  labelled?: boolean;
}

export interface NarrativeSaveV3 {
  schemaVersion: 3;
  flags: string[];
  artifacts: Record<string, ArtifactState>;
  seenEvents: string[];
  currentAct: string;
  releasedArtifactIds: string[];
  activeEventId?: string | null;
}

export interface Line {
  /** Ключ локали (нижний регистр: правило репозитория; в каноне — KOMA.A2_E02.RITA_01). */
  key: string;
  who: Speaker;
}

export interface KomaEvent {
  id: string;
  act: string;
  requires: readonly Flag[];
  /** Событие идёт после этих событий (для мест, где канон не даёт отдельного флага). */
  after?: readonly string[];
  once: boolean;
  lines: readonly Line[];
  sets: readonly Flag[];
}

const c = (key: string): Line => ({ key, who: 'caretaker' });
const p = (key: string): Line => ({ key, who: 'player' });
const e = (key: string): Line => ({ key, who: 'echo' });
const r = (key: string): Line => ({ key, who: 'rita' });
const m = (key: string): Line => ({ key, who: 'memory' });
const s = (key: string): Line => ({ key, who: 'staff' });

/**
 * События канона по порядку, все со строками (F_E01 — без слов: это звук). По условиям проверяется, что обязательная цепочка
 * проходима без необязательных вещей (tests/koma.test.ts).
 */
const LIST: readonly KomaEvent[] = [
  // Пролог — приёмка.
  { id: 'A0_E01', act: 'ACT_00', requires: [], once: true, lines: [e('koma.a0_e01.echo_01')], sets: ['STORY_FIRST_ITEM'] },
  {
    id: 'A0_E02',
    act: 'ACT_00',
    requires: ['STORY_FIRST_ITEM'],
    once: true,
    lines: [c('koma.a0_e02.caretaker_01'), p('koma.a0_e02.player_01'), c('koma.a0_e02.caretaker_02'), p('koma.a0_e02.player_02'), c('koma.a0_e02.caretaker_03')],
    sets: ['STORY_INVENTORY_INTRO'],
  },
  { id: 'A0_E03', act: 'ACT_00', requires: ['STORY_INVENTORY_INTRO'], once: true, lines: [p('koma.a0_e03.player_01'), c('koma.a0_e03.caretaker_01')], sets: [] },
  // Акт I — чужое кажется своим.
  { id: 'A1_E01A', act: 'ACT_01', requires: ['STORY_INVENTORY_INTRO'], once: true, lines: [e('koma.a1_e01.echo_01'), p('koma.a1_e01.player_01')], sets: [] },
  {
    id: 'A1_E01B',
    act: 'ACT_01',
    requires: ['STORY_INVENTORY_INTRO'],
    after: ['A1_E01A'],
    once: true,
    lines: [e('koma.a1_e01.echo_02'), c('koma.a1_e01.caretaker_01'), p('koma.a1_e01.player_02'), c('koma.a1_e01.caretaker_02')],
    sets: [],
  },
  { id: 'A1_E02', act: 'ACT_01', requires: ['STORY_INVENTORY_INTRO'], after: ['A1_E01B'], once: true, lines: [p('koma.a1_e02.player_01'), c('koma.a1_e02.caretaker_01')], sets: ['STORY_FIRST_CONTRADICTION'] },
  { id: 'A1_E03', act: 'ACT_01', requires: ['STORY_INVENTORY_INTRO'], once: true, lines: [p('koma.a1_e03.player_01'), c('koma.a1_e03.caretaker_01')], sets: [] },
  { id: 'A1_E04', act: 'ACT_01', requires: ['STORY_INVENTORY_INTRO'], once: true, lines: [], sets: ['STORY_UNCERTAIN_EVIDENCE_UNLOCKED'] },
  // Акт II — бюро находок.
  { id: 'A2_E01', act: 'ACT_02', requires: ['STORY_FIRST_CONTRADICTION'], once: true, lines: [p('koma.a2_e01.player_01'), c('koma.a2_e01.caretaker_01'), p('koma.a2_e01.player_02'), c('koma.a2_e01.caretaker_02')], sets: [] },
  {
    id: 'A2_E02',
    act: 'ACT_02',
    requires: ['STORY_FIRST_CONTRADICTION'],
    once: true,
    lines: [r('koma.a2_e02.rita_01'), m('koma.a2_e02.player_memory_01'), r('koma.a2_e02.rita_02'), m('koma.a2_e02.player_memory_02'), r('koma.a2_e02.rita_03')],
    sets: ['STORY_RITA_INTRODUCED'],
  },
  { id: 'A2_E03', act: 'ACT_02', requires: ['STORY_RITA_INTRODUCED'], once: true, lines: [e('koma.a2_e03.visitor_01'), m('koma.a2_e03.player_memory_01'), e('koma.a2_e03.visitor_02')], sets: ['STORY_STORIES_NOT_FACTS'] },
  // Раскрытие бюро: журнал или бейдж предъявляет сама сцена — необязательная улика его не запирает.
  { id: 'A2_E04', act: 'ACT_02', requires: ['STORY_FIRST_CONTRADICTION', 'STORY_STORIES_NOT_FACTS'], once: true, lines: [p('koma.a2_e04.player_01'), c('koma.a2_e04.caretaker_01'), p('koma.a2_e04.player_02'), c('koma.a2_e04.caretaker_02'), p('koma.a2_e04.player_03'), c('koma.a2_e04.caretaker_03')], sets: ['STORY_ROLE_REVEALED'] },
  // Акт III — поступление без владельца.
  { id: 'A3_E01', act: 'ACT_03', requires: ['STORY_ROLE_REVEALED'], once: true, lines: [p('koma.a3_e01.player_01'), c('koma.a3_e01.caretaker_01'), p('koma.a3_e01.player_02'), c('koma.a3_e01.caretaker_02')], sets: ['STORY_PERSONAL_EFFECTS'] },
  { id: 'A3_E02', act: 'ACT_03', requires: ['STORY_PERSONAL_EFFECTS'], once: true, lines: [r('koma.a3_e02.rita_01'), m('koma.a3_e02.player_memory_01'), r('koma.a3_e02.rita_02'), m('koma.a3_e02.player_memory_02'), r('koma.a3_e02.rita_03')], sets: [] },
  // Обрыв смены: реплики персонала дописаны (канон даёт только рамку: осторожно, неполно, без диагноза).
  { id: 'A3_E03', act: 'ACT_03', requires: ['STORY_PERSONAL_EFFECTS'], after: ['A3_E02'], once: true, lines: [s('koma.a3_e03.staff_01'), s('koma.a3_e03.staff_02'), s('koma.a3_e03.staff_03')], sets: ['STORY_COMA_REVEALED'] },
  { id: 'A3_E04', act: 'ACT_03', requires: ['STORY_COMA_REVEALED'], once: true, lines: [p('koma.a3_e04.player_01'), c('koma.a3_e04.caretaker_01'), p('koma.a3_e04.player_02'), c('koma.a3_e04.caretaker_02'), p('koma.a3_e04.player_03')], sets: ['STORY_SELF_MISFILED'] },
  // Акт IV — полная картотека.
  { id: 'A4_E01', act: 'ACT_04', requires: ['STORY_SELF_MISFILED'], once: true, lines: [c('koma.a4_e01.caretaker_01'), p('koma.a4_e01.player_01'), c('koma.a4_e01.caretaker_02')], sets: ['STORY_PERFECT_ARCHIVE'] },
  { id: 'A4_E02', act: 'ACT_04', requires: ['STORY_PERFECT_ARCHIVE'], once: true, lines: [c('koma.a4_e02.caretaker_01'), p('koma.a4_e02.player_01'), c('koma.a4_e02.caretaker_02'), p('koma.a4_e02.player_02'), c('koma.a4_e02.caretaker_03')], sets: [] },
  { id: 'A4_E03', act: 'ACT_04', requires: ['STORY_SELF_MISFILED'], after: ['A4_E02'], once: true, lines: [p('koma.a4_e03.player_01'), c('koma.a4_e03.caretaker_01')], sets: ['STORY_CARETAKER_REFLECTION'] },
  // «Оставить»: строки звучат после первого отказа забрать вещь.
  { id: 'A4_E04', act: 'ACT_04', requires: ['STORY_CARETAKER_REFLECTION'], once: true, lines: [c('koma.a4_e04.caretaker_01'), p('koma.a4_e04.player_01'), c('koma.a4_e04.caretaker_02'), c('koma.a4_e04.caretaker_03')], sets: ['STORY_FIRST_UNCLAIMED'] },
  // Акт V — невостребованное. Три «оставленных» ставит release(); здесь — билет и запись.
  { id: 'A5_E02', act: 'ACT_05', requires: ['STORY_RELEASE_1', 'STORY_RELEASE_2', 'STORY_RELEASE_3'], once: true, lines: [p('koma.a5_e02.player_01'), c('koma.a5_e02.caretaker_01'), p('koma.a5_e02.player_02'), c('koma.a5_e02.caretaker_02'), p('koma.a5_e02.player_03'), c('koma.a5_e02.caretaker_03')], sets: ['STORY_PERSONAL_TICKET'] },
  {
    id: 'A5_E03',
    act: 'ACT_05',
    requires: ['STORY_RELEASE_1', 'STORY_RELEASE_2', 'STORY_RELEASE_3', 'STORY_PERSONAL_TICKET'],
    once: true,
    lines: [p('koma.a5_e03.player_01'), c('koma.a5_e03.caretaker_01'), p('koma.a5_e03.player_02')],
    sets: ['STORY_UNFINISHED_RECORD', 'STORY_CARETAKER_INTEGRATED'],
  },
  // Эпилог.
  { id: 'F_E01', act: 'ACT_06', requires: ['STORY_UNFINISHED_RECORD'], once: true, lines: [], sets: [] },
  { id: 'F_E02', act: 'ACT_06', requires: ['STORY_UNFINISHED_RECORD'], after: ['F_E01'], once: true, lines: [s('koma.f_e02.staff_01')], sets: ['STORY_ENDING'] },
];
export const EVENTS: Readonly<Record<string, KomaEvent>> = Object.fromEntries(LIST.map((x) => [x.id, x]));
export const EVENT_ORDER: readonly string[] = LIST.map((x) => x.id);

export function emptyNarrative(): NarrativeSaveV3 {
  return { schemaVersion: 3, flags: [], artifacts: {}, seenEvents: [], currentAct: 'ACT_00', releasedArtifactIds: [], activeEventId: null };
}

const PHASES: readonly MemoryPhase[] = ['unseen', 'association', 'evidence', 'uncertain', 'released'];
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * Разобрать сохранение. Чужая версия схемы (сюжет v2 — сестра, стук, авария) не переносится: смыслы вещей и условия другие,
 * подмена по именам дала бы ложный прогресс. Такое сохранение сюжета начинается заново; остальной профиль игрока цел.
 */
export function parseNarrative(raw: unknown): NarrativeSaveV3 {
  const out = emptyNarrative();
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== 3) return out;
  out.flags = [...new Set(strs(o.flags).filter(isFlag))];
  out.seenEvents = [...new Set(strs(o.seenEvents).filter((id) => id in EVENTS))];
  if (o.artifacts && typeof o.artifacts === 'object') {
    for (const [id, v] of Object.entries(o.artifacts as Record<string, unknown>)) {
      if (!/^[A-Za-z0-9_.]{1,40}$/.test(id) || !v || typeof v !== 'object') continue;
      const a = v as Record<string, unknown>;
      const phase = PHASES.includes(a.phase as MemoryPhase) ? (a.phase as MemoryPhase) : 'unseen';
      out.artifacts[id] = { discovered: a.discovered === true || phase !== 'unseen', phase, evidenceIds: [...new Set(strs(a.evidenceIds))], ...(a.labelled === true && phase !== 'released' && phase !== 'uncertain' ? { labelled: true } : {}) };
    }
  }
  out.releasedArtifactIds = Object.keys(out.artifacts).filter((id) => out.artifacts[id]!.phase === 'released');
  out.currentAct = actOf(out.flags);
  // Прерванное посреди сцены событие после перезагрузки не «доигрывается»: оно либо уже записано в seenEvents, либо начнётся снова.
  out.activeEventId = null;
  return out;
}

/** Акт — из флагов: второго источника истины нет. */
export function actOf(flags: readonly string[]): string {
  const has = (f: Flag): boolean => flags.includes(f);
  if (has('STORY_UNFINISHED_RECORD')) return 'ACT_06';
  if (has('STORY_FIRST_UNCLAIMED')) return 'ACT_05';
  if (has('STORY_SELF_MISFILED')) return 'ACT_04';
  if (has('STORY_ROLE_REVEALED')) return 'ACT_03';
  if (has('STORY_FIRST_CONTRADICTION')) return 'ACT_02';
  if (has('STORY_INVENTORY_INTRO')) return 'ACT_01';
  return 'ACT_00';
}

/** Смотритель — тоже из флагов: клерк → автор → куратор → раскрыт → свидетель. */
export function caretakerOf(flags: readonly string[]): CaretakerPhase {
  const has = (f: Flag): boolean => flags.includes(f);
  if (has('STORY_CARETAKER_INTEGRATED')) return 'WITNESS';
  if (has('STORY_CARETAKER_REFLECTION')) return 'EXPOSED';
  if (has('STORY_PERFECT_ARCHIVE')) return 'CURATOR';
  if (has('STORY_FIRST_CONTRADICTION')) return 'AUTHOR';
  return 'CLERK';
}

export class Narrative {
  constructor(public state: NarrativeSaveV3 = emptyNarrative()) {}

  has(flag: Flag): boolean {
    return this.state.flags.includes(flag);
  }

  seen(eventId: string): boolean {
    return this.state.seenEvents.includes(eventId);
  }

  setFlag(flag: Flag): void {
    if (!this.has(flag)) this.state.flags.push(flag);
    this.state.currentAct = actOf(this.state.flags);
  }

  get act(): string {
    return this.state.currentAct;
  }

  get caretaker(): CaretakerPhase {
    return caretakerOf(this.state.flags);
  }

  canPlay(eventId: string): boolean {
    const ev = EVENTS[eventId];
    if (!ev) return false;
    if (ev.once && this.seen(eventId)) return false;
    return ev.requires.every((f) => this.has(f)) && (ev.after ?? []).every((id) => this.seen(id));
  }

  /** Сыграть событие: строки для экрана; null — нельзя (условия не выполнены или уже было). Флаги ставятся сразу. */
  play(eventId: string): readonly Line[] | null {
    if (!this.canPlay(eventId)) return null;
    const ev = EVENTS[eventId]!;
    if (!this.seen(eventId)) this.state.seenEvents.push(eventId);
    for (const f of ev.sets) this.setFlag(f);
    this.state.activeEventId = null;
    return ev.lines;
  }

  artifact(id: string): ArtifactState {
    return (this.state.artifacts[id] ??= { discovered: false, phase: 'unseen', evidenceIds: [] });
  }

  /** Нашёл и осмотрел: первая ассоциация. Повторно — ничего не меняет (награда не выдаётся дважды). */
  discover(id: string): boolean {
    const a = this.artifact(id);
    if (a.discovered) return false;
    a.discovered = true;
    a.phase = 'association';
    return true;
  }

  /** Нашёлся проверяемый факт. Улика — не доказанная история владельца. */
  addEvidence(id: string, evidenceId: string): void {
    const a = this.artifact(id);
    if (!a.evidenceIds.includes(evidenceId)) a.evidenceIds.push(evidenceId);
    if (a.phase === 'unseen' || a.phase === 'association') {
      a.discovered = true;
      a.phase = 'evidence';
    }
  }

  /** Смотритель дописал историю (игрок досмотрел). Оставленной и неподтверждённой вещи история не дописывается. */
  label(id: string): boolean {
    const a = this.artifact(id);
    if (!a.discovered || a.phase === 'released' || a.phase === 'uncertain') return false;
    a.labelled = true;
    return true;
  }

  /** «Не подтверждено»: версия не доказана, и это записано. Полноценное действие; история, дописанная раньше, снимается. */
  markUncertain(id: string): boolean {
    const a = this.artifact(id);
    if (!a.discovered || a.phase === 'released') return false;
    a.phase = 'uncertain';
    delete a.labelled;
    this.setFlag('STORY_UNCERTAIN_EVIDENCE_UNLOCKED');
    if (!this.seen('A1_E04')) this.state.seenEvents.push('A1_E04');
    return true;
  }

  /** «Оставить»: герой больше не считает вещь своей. Не уничтожение. Три первых обязательных слота ставят флаги выпуска. */
  release(id: string): boolean {
    const a = this.artifact(id);
    if (!a.discovered || a.phase === 'released') return false;
    a.phase = 'released';
    delete a.labelled;
    if (!this.state.releasedArtifactIds.includes(id)) this.state.releasedArtifactIds.push(id);
    const n = this.state.releasedArtifactIds.length;
    if (n >= 1) this.setFlag('STORY_RELEASE_1');
    if (n >= 2) this.setFlag('STORY_RELEASE_2');
    if (n >= 3) this.setFlag('STORY_RELEASE_3');
    return true;
  }

  /**
   * Стерильность 0…1: доля найденных вещей, которым Смотритель дописал историю. Неподтверждённые и оставленные её снижают —
   * они и есть то, что в мире ещё движется само.
   */
  sterility(): number {
    const found = Object.values(this.state.artifacts).filter((a) => a.discovered);
    if (found.length === 0) return 0;
    return found.filter((a) => a.labelled === true).length / found.length;
  }

  /**
   * Насколько место замерло, 0…1. До полной картотеки (акт IV) — доля дописанного; с неё — всё стоит, и движение возвращает
   * только «оставленное»: три оставленные вещи — и место снова живое. После финальной записи — живое.
   */
  stillness(share: number): number {
    if (this.has('STORY_UNFINISHED_RECORD')) return 0;
    if (this.has('STORY_PERFECT_ARCHIVE')) return Math.max(0, 1 - this.state.releasedArtifactIds.length / 3);
    return this.sterility() * share;
  }

  /** Вещи, которым в лимбо ещё можно дописать историю или отказать в ней. */
  open(): string[] {
    return Object.keys(this.state.artifacts).filter((id) => {
      const a = this.state.artifacts[id]!;
      return a.discovered && a.labelled !== true && a.phase !== 'uncertain' && a.phase !== 'released';
    });
  }
}

/** Привязка вещей воспоминаний игры к смысловым слотам канона (подробно — docs/vylazka/koma/mapping.md). */
export const SLOT_OF: Readonly<Record<string, string>> = {
  sh_alarm: 'LP05',
  sh_kettle: 'LP01',
  sh_remote: 'LP10',
  sh_coat: 'LP03',
  sh_photo: 'LP04',
  of_ticket: 'LP02',
  of_terminal: 'LP08',
  of_chair: 'LP13',
  of_phone: 'LP06',
  st_key: 'LP07',
  st_note: 'LP09',
  st_ticket: 'LP14',
  st_coat: 'LP11',
};
