/**
 * Монтажёр (docs/architecture/08-shot-grammar.md §4): выбирает кадр покрытия для шага сцены.
 *
 * Чистые детерминированные функции: вход — сет сцены, кто на сцене, шаг и память сцены (ShotCtx),
 * выход — кадр и новая память. Никакого случайного: «жребий» перебивки считается хешем от
 * `scene_id:step_index`, поэтому загрузка сейва, откат и автопилот показывают тот же кадр, что видел
 * игрок. Нет подходящего кадра — null: сцена остаётся фоном и спрайтами (запасной вариант §4.9).
 */
import type { Beat, NarrateStyle, Shot, ShotCtx, ShotKind } from './types';

/** Выражения, при которых реплика без явного beat считается напряжённой (§3.2). */
export const TENSE_EXPRESSIONS: ReadonlySet<string> = new Set([
  'tense',
  'angry',
  'scared',
  'cornered',
  'nervous',
  'worried',
  'firm',
  'cold',
  'stern',
  'hurt',
]);
/** Реплика длиннее этого (знаков) — длинная: повод показать реакцию слушающего (§4.4). */
export const LONG_LINE_CHARS = 120;
/** Крупный план говорящего держится не дольше стольких реплик подряд (§4.2). */
export const MAX_HOLD = 3;
/** Не больше стольких крупных планов подряд, дальше medium / wide (§4.5). */
export const MAX_CLOSES = 3;
/** Перебивка angle не чаще раза в столько реплик (§4.2). */
export const ANGLE_EVERY = 8;
/** Реакция слушающего — не чаще каждой такой по счёту длинной реплики (§4.4). */
export const REACTION_EVERY = 4;
/** Крупные планы для правила ритма. */
export const CLOSE_KINDS: ReadonlySet<ShotKind> = new Set<ShotKind>(['close', 'ots', 'reaction']);

export const EMPTY_CTX: Readonly<ShotCtx> = Object.freeze({
  held: 0,
  closes: 0,
  last_angle: -1,
  long_lines: 0,
  speaker: null,
  prev_speaker: null,
  line: 0,
  narr: 0,
});

/** Кадры эпизода по id и по сетам; порядок внутри сета — порядок в assets.shots (он же порядок предпочтения). */
export class ShotIndex {
  private readonly bySet = new Map<string, Shot[]>();
  private readonly byId = new Map<string, Shot>();

  constructor(shots: readonly Shot[] = []) {
    for (const s of shots) {
      this.byId.set(s.id, s);
      const list = this.bySet.get(s.set);
      if (list) list.push(s);
      else this.bySet.set(s.set, [s]);
    }
  }

  get(id: string): Shot | undefined {
    return this.byId.get(id);
  }

  set(set: string): readonly Shot[] {
    return this.bySet.get(set) ?? [];
  }

  hasSet(set: string): boolean {
    return this.bySet.has(set);
  }

  get size(): number {
    return this.byId.size;
  }
}

/** Детерминированный «жребий» по строке (FNV-1a, 32 бита). */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Напряжение реплики: явный beat, иначе tense при напряжённом выражении, иначе calm. */
export function beatOf(beat: Beat | undefined, expression: string | null): Beat {
  if (beat) return beat;
  return expression !== null && TENSE_EXPRESSIONS.has(expression) ? 'tense' : 'calm';
}

/** Все, кто в кадре, стоят на сцене: лишний человек в кадре — ошибка непрерывности, пустое место — нет. */
function fits(shot: Shot, cast: readonly string[]): boolean {
  return shot.cast.every((c) => cast.includes(c.who));
}

function overlap(shot: Shot, cast: readonly string[]): number {
  let n = 0;
  for (const c of shot.cast) if (cast.includes(c.who)) n++;
  return n;
}

/** Кадры вида kind, вписывающиеся в состав; лучшие первыми: больше совпадений, затем порядок списка. */
function candidates(shots: readonly Shot[], kind: ShotKind, cast: readonly string[]): Shot[] {
  return shots
    .map((s, i) => ({ s, i, o: overlap(s, cast) }))
    .filter((x) => x.s.kind === kind && fits(x.s, cast))
    .sort((a, b) => b.o - a.o || a.i - b.i)
    .map((x) => x.s);
}

function wideOf(shots: readonly Shot[], cast: readonly string[]): Shot | null {
  return candidates(shots, 'wide', cast)[0] ?? null;
}

function mediumWith(shots: readonly Shot[], who: string, cast: readonly string[], except: string | null = null): Shot | null {
  return candidates(shots, 'medium', cast).find((s) => s.id !== except && s.cast.some((c) => c.who === who)) ?? null;
}

function exprOf(s: Shot, who: string): string {
  return s.cast.find((c) => c.who === who)?.expression ?? 'neutral';
}

/** Крупный план who ровно с этим выражением (или null). */
function closeExact(shots: readonly Shot[], who: string, expression: string | null, cast: readonly string[]): Shot | null {
  if (expression === null || !cast.includes(who)) return null;
  return shots.find((s) => s.kind === 'close' && s.focus === who && exprOf(s, who) === expression) ?? null;
}

/** Крупный план who: с нужным выражением, иначе neutral, иначе любой; только если who на сцене. */
function closeOf(shots: readonly Shot[], who: string, expression: string | null, cast: readonly string[]): Shot | null {
  if (!cast.includes(who)) return null;
  const closes = shots.filter((s) => s.kind === 'close' && s.focus === who);
  if (closes.length === 0) return null;
  return closeExact(shots, who, expression, cast) ?? closes.find((s) => exprOf(s, who) === 'neutral') ?? closes[0] ?? null;
}

function otsOf(shots: readonly Shot[], from: string, focus: string, cast: readonly string[]): Shot | null {
  if (!cast.includes(from) || !cast.includes(focus)) return null;
  return shots.find((s) => s.kind === 'ots' && s.from === from && s.focus === focus) ?? null;
}

function reactionOf(shots: readonly Shot[], who: string, cast: readonly string[]): Shot | null {
  if (!cast.includes(who)) return null;
  return shots.find((s) => s.kind === 'reaction' && s.focus === who) ?? null;
}

function insertOf(shots: readonly Shot[], n: number): Shot | null {
  const inserts = shots.filter((s) => s.kind === 'insert');
  return inserts.length > 0 ? (inserts[n % inserts.length] ?? null) : null;
}

function angleOf(shots: readonly Shot[], cast: readonly string[], seed: string): Shot | null {
  const angles = candidates(shots, 'angle', cast);
  return angles.length > 0 ? (angles[hashSeed(`${seed}#angle`) % angles.length] ?? null) : null;
}

/** Собеседник говорящего: кто говорил перед ним, а в его же монологе — последний другой говорящий. */
export function listenerOf(ctx: ShotCtx, who: string | null): string | null {
  if (ctx.speaker !== null && ctx.speaker !== who) return ctx.speaker;
  return ctx.prev_speaker !== who ? ctx.prev_speaker : null;
}

/**
 * Вход в сцену (§4.1): wide сета с максимальным совпадением состава; без wide — medium; без него — ots (фон сета —
 * это его общий план, и на нём были бы те, кого в сцене нет); иначе null.
 */
export function entryShot(index: ShotIndex, set: string, cast: readonly string[]): Shot | null {
  const shots = index.set(set);
  return wideOf(shots, cast) ?? candidates(shots, 'medium', cast)[0] ?? candidates(shots, 'ots', cast)[0] ?? null;
}

export interface LineInput {
  set: string;
  /** Говорящий; null — рассказчик. */
  who: string | null;
  expression: string | null;
  beat: Beat;
  narrate: NarrateStyle | null;
  longLine: boolean;
  /** Кто сейчас на сцене (видимые спрайты). */
  cast: readonly string[];
  /** Персонаж игрока: внутренний голос всегда на его лице. */
  pov: string | null;
  current: string | null;
  ctx: ShotCtx;
  /** `scene_id:step_index` — зерно жребия перебивки. */
  seed: string;
}

export interface ShotPick {
  shot: string | null;
  ctx: ShotCtx;
}

interface Choice {
  shot: Shot | null;
  reaction: boolean;
}

function choose(shots: readonly Shot[], cur: Shot | null, inp: LineInput): Choice {
  const { cast, ctx, who } = inp;
  if (shots.length === 0) return { shot: null, reaction: false };

  // §4.3 Рассказчик: inner — лицо персонажа игрока; voiceover / report — wide и insert по очереди.
  if (who === null) {
    if (inp.narrate === 'inner' && inp.pov !== null) {
      const s = closeOf(shots, inp.pov, null, cast) ?? reactionOf(shots, inp.pov, cast);
      if (s) return { shot: s, reaction: false };
    }
    const wide = wideOf(shots, cast);
    const insert = insertOf(shots, ctx.narr >> 1);
    const odd = ctx.narr % 2 === 1;
    return { shot: (odd ? (insert ?? wide) : (wide ?? insert)) ?? cur, reaction: false };
  }

  // §4.1 Общий план входа держится на первой реплике сцены, если говорящий в нём есть: иначе он виден только на время
  // перехода и мелькает (полсекунды) перед первым крупным планом.
  if (ctx.line === 0 && cur !== null && cur.kind === 'wide' && fits(cur, cast) && cur.cast.some((c) => c.who === who)) {
    return { shot: cur, reaction: false };
  }

  const other = listenerOf(ctx, who);

  // §4.4 Реакция слушающего: длинная реплика после крупного плана говорящего, не чаще каждой четвёртой.
  if (inp.longLine && cur !== null && CLOSE_KINDS.has(cur.kind) && cur.focus === who && ctx.long_lines + 1 >= REACTION_EVERY) {
    const r = other !== null ? reactionOf(shots, other, cast) : null;
    if (r) return { shot: r, reaction: true };
  }

  // §4.2 Кадр уже про говорящего и держится меньше трёх реплик — не резать, пока напряжение не растёт:
  // calm держит ots и крупный план; tense на ots режет в крупный план, на крупном плане меняет только
  // выражение (если такой кадр есть); climax режет заново всегда.
  if (cur !== null && cur.focus === who && cur.kind !== 'reaction' && ctx.held < MAX_HOLD && inp.beat !== 'climax') {
    if (inp.beat === 'calm') return { shot: cur, reaction: false };
    if (cur.kind === 'close') {
      const exact = closeExact(shots, who, inp.expression, cast);
      if (exact === null || exact.id === cur.id) return { shot: cur, reaction: false };
    }
  }

  // После перебивки — возврат в покрытие (§4.5), как в спокойной реплике.
  const beat: Beat = cur?.kind === 'angle' ? 'calm' : inp.beat;
  let pick: Shot | null;
  if (beat === 'calm') {
    // Слушатель неизвестен (первая реплика сцены) или к нему нет кадра через плечо — слушает персонаж игрока.
    const povOts = inp.pov !== null && inp.pov !== who ? otsOf(shots, inp.pov, who, cast) : null;
    pick = (other !== null ? otsOf(shots, other, who, cast) : null) ?? povOts ?? mediumWith(shots, who, cast) ?? closeOf(shots, who, inp.expression, cast);
  } else {
    const sinceAngle = ctx.last_angle < 0 ? Infinity : ctx.line - ctx.last_angle;
    if (beat === 'climax' && sinceAngle >= ANGLE_EVERY && hashSeed(inp.seed) % 3 === 0) {
      const a = angleOf(shots, cast, inp.seed);
      if (a) return { shot: a, reaction: false };
    }
    pick = closeOf(shots, who, inp.expression, cast) ?? mediumWith(shots, who, cast);
  }

  // §4.5 Ритм: не больше трёх крупных планов подряд.
  if (pick !== null && CLOSE_KINDS.has(pick.kind) && ctx.closes >= MAX_CLOSES) {
    pick = mediumWith(shots, who, cast) ?? wideOf(shots, cast) ?? pick;
  }
  // Тот же кадр дважды подряд — только при том же говорящем, и не дольше MAX_HOLD реплик.
  if (pick !== null && cur !== null && pick.id === cur.id && (ctx.speaker !== who || ctx.held >= MAX_HOLD)) {
    const alt = mediumWith(shots, who, cast, cur.id) ?? wideOf(shots, cast);
    if (alt !== null && alt.id !== cur.id) pick = alt;
  }
  return { shot: pick ?? wideOf(shots, cast), reaction: false };
}

/** Кадр для реплики (say / narrate) и новая память сцены. */
export function lineShot(index: ShotIndex, inp: LineInput): ShotPick {
  const shots = index.set(inp.set);
  const cur = inp.current !== null ? (index.get(inp.current) ?? null) : null;
  const { ctx, who } = inp;
  const res = choose(shots, cur, inp);
  const s = res.shot;
  const kept = cur !== null && s !== null && s.id === cur.id;
  const next: ShotCtx = {
    held: kept ? ctx.held + 1 : 1,
    closes: s !== null && CLOSE_KINDS.has(s.kind) ? ctx.closes + 1 : 0,
    last_angle: s?.kind === 'angle' ? ctx.line : ctx.last_angle,
    long_lines: res.reaction ? 0 : inp.longLine ? ctx.long_lines + 1 : ctx.long_lines,
    speaker: who ?? ctx.speaker,
    prev_speaker: who !== null && ctx.speaker !== null && ctx.speaker !== who ? ctx.speaker : ctx.prev_speaker,
    line: ctx.line + 1,
    narr: who === null ? ctx.narr + 1 : ctx.narr,
  };
  return { shot: s?.id ?? null, ctx: next };
}

/** Память после явного кадра сценариста (`shot` в шаге): монтажёр подчиняется, но счёт реплик ведёт. */
export function explicitShot(index: ShotIndex, id: string, current: string | null, ctx: ShotCtx, who: string | null): ShotPick {
  const s = index.get(id) ?? null;
  const kept = s !== null && s.id === current;
  return {
    shot: s?.id ?? current,
    ctx: {
      ...ctx,
      held: kept ? ctx.held + 1 : 1,
      closes: s !== null && CLOSE_KINDS.has(s.kind) ? ctx.closes + 1 : 0,
      last_angle: s?.kind === 'angle' ? ctx.line : ctx.last_angle,
      speaker: who ?? ctx.speaker,
      prev_speaker: who !== null && ctx.speaker !== null && ctx.speaker !== who ? ctx.speaker : ctx.prev_speaker,
      line: ctx.line + 1,
    },
  };
}

/** §4.6 Выбор игрока: medium с персонажем игрока или wide; выбор с таймером — крупный план оппонента. */
export function choiceShot(index: ShotIndex, set: string, cast: readonly string[], pov: string | null, timed: boolean, opponent: string | null): Shot | null {
  const shots = index.set(set);
  if (timed && opponent !== null) {
    const c = closeOf(shots, opponent, null, cast);
    if (c) return c;
  }
  return (pov !== null ? mediumWith(shots, pov, cast) : null) ?? wideOf(shots, cast);
}

/** Персонаж ушёл со сцены: кадр с ним больше не годится — wide оставшегося состава (или null — спрайты). */
export function afterHide(index: ShotIndex, set: string, cast: readonly string[], current: string | null, who: string): string | null {
  const cur = current !== null ? index.get(current) : undefined;
  if (!cur || !cur.cast.some((c) => c.who === who)) return current;
  return entryShot(index, set, cast)?.id ?? null;
}
