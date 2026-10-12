/**
 * Прогресс дела без DOM: какие задачи открыты, ★ на счету, награды задач, звёзды за поиск.
 * Правила (docs/architecture/09-case-mode.md):
 *   - задача открыта, когда выполнены все её requires; ★ списываются, когда задача выполнена (брошенная — бесплатна);
 *   - в режиме «только история» задачи бесплатны;
 *   - заход в сцену поиска: ★ за то, что найдено всё, ★ за скорость (star_time_ms), ★ за точность (star_misses);
 *     повтор сцены бесплатен и снова приносит ★ — так игрок копит их на следующие задачи.
 */
import type { CaseChapter, CaseDef, CaseGives, CaseScene, CaseTask } from './case_def';

export interface CaseProgress {
  v: 1;
  /** ★ на счету. */
  stars: number;
  done: string[];
  clues: string[];
  suspects: string[];
  traits: string[];
  facts: string[];
  /** Заходов в сцену поиска: следующий заход берёт это число зерном списка. */
  plays: Record<string, number>;
  /** Лучший заход сцены, ★ 0–3. */
  best: Record<string, number>;
  /** Главы, вступление / итог которых показаны. */
  intro: string[];
  outro: string[];
  /** Что принесла последняя задача: `clue:photo`, `suspect:lapin`, … — папка подсвечивает «новое». */
  fresh: string[];
}

export type TaskState = 'done' | 'locked' | 'open' | 'poor';

export function emptyProgress(): CaseProgress {
  return { v: 1, stars: 0, done: [], clues: [], suspects: [], traits: [], facts: [], plays: {}, best: {}, intro: [], outro: [], fresh: [] };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function ids(v: unknown, known: ReadonlySet<string>): string[] {
  return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && known.has(x)))] : [];
}

function counts(v: unknown, known: ReadonlySet<string>, max: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(v)) return out;
  for (const [k, n] of Object.entries(v)) {
    if (known.has(k) && typeof n === 'number' && Number.isFinite(n) && n >= 0) out[k] = Math.min(max, Math.floor(n));
  }
  return out;
}

/** Прогресс из хранилища: мусор и id, которых в деле больше нет, отбрасываются. */
export function sanitizeProgress(raw: unknown, def: CaseDef): CaseProgress {
  const r = isRecord(raw) ? raw : {};
  const tasks = new Set(def.chapters.flatMap((c) => c.tasks.map((t) => t.id)));
  const chapters = new Set(def.chapters.map((c) => c.id));
  const scenes = new Set(Object.keys(def.scenes));
  const fresh = Array.isArray(r.fresh) ? r.fresh.filter((x): x is string => typeof x === 'string') : [];
  const stars = typeof r.stars === 'number' && Number.isFinite(r.stars) ? Math.max(0, Math.floor(r.stars)) : 0;
  return {
    v: 1,
    stars,
    done: ids(r.done, tasks),
    clues: ids(r.clues, new Set(def.clues.map((x) => x.id))),
    suspects: ids(r.suspects, new Set(def.suspects.map((x) => x.id))),
    traits: ids(r.traits, new Set(def.traits.map((x) => x.id))),
    facts: ids(r.facts, new Set((def.facts ?? []).map((x) => x.id))),
    plays: counts(r.plays, scenes, Number.MAX_SAFE_INTEGER),
    best: counts(r.best, scenes, 3),
    intro: ids(r.intro, chapters),
    outro: ids(r.outro, chapters),
    fresh,
  };
}

/** Цена задачи: в режиме «только история» всё бесплатно. */
export function costOf(task: CaseTask, storyOnly: boolean): number {
  return storyOnly ? 0 : task.cost;
}

export function taskState(p: CaseProgress, task: CaseTask, storyOnly: boolean): TaskState {
  if (p.done.includes(task.id)) return 'done';
  if (!task.requires.every((r) => p.done.includes(r))) return 'locked';
  return p.stars >= costOf(task, storyOnly) ? 'open' : 'poor';
}

/** Текущая глава: первая открытая (не locked) с невыполненными задачами; всё выполнено — последняя открытая. */
export function currentChapter(def: CaseDef, p: CaseProgress): CaseChapter {
  const open = def.chapters.filter((c) => !c.locked);
  return open.find((c) => !chapterComplete(c, p)) ?? open[open.length - 1] ?? (def.chapters[0] as CaseChapter);
}

export function chapterComplete(ch: CaseChapter, p: CaseProgress): boolean {
  return ch.tasks.length > 0 && ch.tasks.every((t) => p.done.includes(t.id));
}

function add(list: string[], items: readonly string[] | undefined, tag: string, fresh: string[]): string[] {
  const out = [...list];
  for (const i of items ?? []) {
    if (out.includes(i)) continue;
    out.push(i);
    fresh.push(`${tag}:${i}`);
  }
  return out;
}

/** Награда: улики, подозреваемые, приметы, записи. Новые id попадают в fresh. */
export function applyGives(p: CaseProgress, gives: CaseGives | undefined): CaseProgress {
  const fresh: string[] = [];
  const next: CaseProgress = {
    ...p,
    clues: add(p.clues, gives?.clues, 'clue', fresh),
    suspects: add(p.suspects, gives?.suspects, 'suspect', fresh),
    traits: add(p.traits, gives?.traits, 'trait', fresh),
    facts: add(p.facts, gives?.facts, 'fact', fresh),
  };
  next.fresh = fresh;
  return next;
}

/** Задача выполнена: ★ списаны (один раз), награда выдана. Повторный вызов ничего не меняет. */
export function completeTask(p: CaseProgress, task: CaseTask, storyOnly: boolean): CaseProgress {
  if (p.done.includes(task.id)) return p;
  const next = applyGives(p, task.gives);
  next.done = [...p.done, task.id];
  next.stars = Math.max(0, p.stars - costOf(task, storyOnly));
  return next;
}

export interface SearchRun {
  /** Найдено всё из списка. */
  complete: boolean;
  misses: number;
  /** Сколько длился заход, мс; null — таймер выключен (настройки доступности): ★ за скорость даётся. */
  elapsedMs: number | null;
}

export interface SearchStars {
  all: boolean;
  fast: boolean;
  accurate: boolean;
  /** 0–3: без «всё найдено» звёзд нет. */
  stars: number;
}

export function searchStars(scene: CaseScene, run: SearchRun): SearchStars {
  const all = run.complete;
  const fast = all && (run.elapsedMs === null || run.elapsedMs <= scene.star_time_ms);
  const accurate = all && run.misses <= scene.star_misses;
  return { all, fast, accurate, stars: all ? 1 + Number(fast) + Number(accurate) : 0 };
}

/** Заход в сцену поиска окончен: ★ на счёт, лучший результат, счётчик заходов (зерно следующего списка). */
export function recordSearch(p: CaseProgress, sceneId: string, stars: number): CaseProgress {
  return {
    ...p,
    stars: p.stars + stars,
    plays: { ...p.plays, [sceneId]: (p.plays[sceneId] ?? 0) + 1 },
    best: { ...p.best, [sceneId]: Math.max(p.best[sceneId] ?? 0, stars) },
  };
}

/** Есть ли что продолжать (меню показывает «продолжить», а не «начать»). */
export function hasProgress(p: CaseProgress): boolean {
  return p.done.length > 0 || p.intro.length > 0 || Object.keys(p.plays).length > 0;
}
