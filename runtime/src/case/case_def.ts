/**
 * Дело (режим поиска улик, docs/architecture/09-case-mode.md): типы файла episodes/s<N>/<id>.case.json
 * (schemas/case.schema.json) и сборка из него того, что исполняет рантайм:
 *   - сцена поиска → config мини-игры crime_scene_search в режиме списка;
 *   - разговор → маленький эпизод из одной сцены, который играет обычный интерпретатор.
 * Полная проверка файла — tools/validate_case.py; здесь только форма, без которой рантайм не может работать.
 */
import type { Block, Ending, Episode, MinigameDef, Presentation, Scene, StageSpec, Step } from '../core/types';
import type { Rect } from '../minigames/crime_scene_search';

export type TaskKind = 'search' | 'talk' | 'photo' | 'minigame';

export interface CaseGives {
  clues?: string[];
  suspects?: string[];
  traits?: string[];
  facts?: string[];
}

export interface CaseTask {
  id: string;
  kind: TaskKind;
  title_key: string;
  /** ★ за задачу; списываются, когда задача выполнена. */
  cost: number;
  requires: string[];
  scene?: string;
  item?: string;
  back_key?: string;
  talk?: string;
  minigame?: string;
  gives?: CaseGives;
}

export interface CaseChapter {
  id: string;
  title_key: string;
  locked?: boolean;
  intro?: string;
  outro?: string;
  summary_key?: string;
  tasks: CaseTask[];
}

export interface CaseItem {
  id: string;
  rect: Rect;
  label_key: string;
  clue?: string;
}

export interface CaseScene {
  bg: string;
  title_key: string;
  brief_key: string;
  pick: number;
  time_limit_ms: number;
  star_time_ms: number;
  star_misses: number;
  items: CaseItem[];
}

export interface CaseTalk {
  stage: StageSpec;
  presentation?: Presentation;
  steps: Step[];
}

export interface CaseSuspect {
  id: string;
  name_key: string;
  /** Актёр эпизода: портрет — его спрайт; нет — силуэт. */
  who?: string;
  note_key: string;
}

export interface CaseDef {
  schema_version: 1;
  episode: string;
  title_key: string;
  traits: Array<{ id: string; label_key: string }>;
  suspects: CaseSuspect[];
  clues: Array<{ id: string; label_key: string }>;
  facts?: Array<{ id: string; suspect?: string; text_key: string }>;
  scenes: Record<string, CaseScene>;
  talks: Record<string, CaseTalk>;
  chapters: CaseChapter[];
}

/** Минимальная проверка формы: без неё рантайм не построит экран дела. Ошибка — дела нет, игра идёт как новелла. */
export function assertCase(json: unknown, episode: Episode): asserts json is CaseDef {
  const c = json as Partial<CaseDef> | null;
  const problems: string[] = [];
  if (!c || typeof c !== 'object') problems.push('это не объект');
  else {
    if (c.schema_version !== 1) problems.push(`schema_version=${String(c.schema_version)}`);
    if (c.episode !== episode.id) problems.push(`дело эпизода ${String(c.episode)}, а загружен ${episode.id}`);
    if (!Array.isArray(c.chapters) || c.chapters.length === 0) problems.push('нет глав');
    if (!c.scenes || typeof c.scenes !== 'object') problems.push('нет scenes');
    if (!c.talks || typeof c.talks !== 'object') problems.push('нет talks');
    for (const k of ['traits', 'suspects', 'clues'] as const) if (!Array.isArray(c[k])) problems.push(`нет ${k}`);
  }
  if (problems.length > 0) throw new Error(`дело: ${problems.join('; ')}`);
}

/** Все задачи дела по id. */
export function taskIndex(def: CaseDef): Map<string, CaseTask> {
  const out = new Map<string, CaseTask>();
  for (const ch of def.chapters) for (const t of ch.tasks) out.set(t.id, t);
  return out;
}

/** id мини-игры поиска: зерно списка (crime_scene_search) и телеметрия. */
export function searchId(sceneId: string): string {
  return `case_${sceneId}`;
}

/**
 * Заход в сцену поиска: config crime_scene_search в режиме списка. Предметы-улики, которых у игрока ещё нет,
 * обязательны (всегда в списке); остальное выбирается по зерну `seed` (номер захода).
 */
export function searchDef(def: CaseDef, sceneId: string, owned: readonly string[], seed: number): MinigameDef {
  const sc = def.scenes[sceneId];
  if (!sc) throw new Error(`дело: нет сцены поиска ${sceneId}`);
  return {
    id: searchId(sceneId),
    type: 'crime_scene_search',
    beat: 'crime_scene',
    title_key: sc.title_key,
    brief_key: sc.brief_key,
    config: {
      scene_bg: sc.bg,
      list: true,
      pick: sc.pick,
      seed,
      hotspots: sc.items.map((it) => ({
        id: it.id,
        rect: it.rect,
        label_key: it.label_key,
        required: it.clue !== undefined && !owned.includes(it.clue),
      })),
      max_misses: 20,
      time_limit_ms: sc.time_limit_ms,
      hint_after_misses: 5,
    },
    difficulty: 'normal',
    skip: { allowed: true, after_fails: 8, skip_counts_as: 'fail' },
    outcomes: { success: { goto: '' }, fail: { goto: '' } },
  };
}

export const TALK_ENDING = 'case_back';

/**
 * Разговор как эпизод из одной сцены: актёры, спрайты, фоны и переменные — из эпизода дела, в конце — переход
 * в служебную концовку (рантайм дела на ней останавливается и финал не показывает). Блок без автосейва.
 */
export function talkEpisode(base: Episode, def: CaseDef, talkId: string): Episode {
  const talk = def.talks[talkId];
  if (!talk) throw new Error(`дело: нет разговора ${talkId}`);
  const id = `case_${talkId}`;
  const block: Block = { id, type: 'investigation', presentation: talk.presentation ?? 'procedural', entry_scene: id, scenes: [id], autosave: false };
  const scene: Scene = { id, block: id, stage: talk.stage, steps: [...talk.steps, { do: 'end', ending: TALK_ENDING }] };
  const ending: Ending = { id: TALK_ENDING, title_key: base.title_key, kind: 'canonical', counts_toward_completion: false };
  return { ...base, blocks: [block], scenes: { [id]: scene }, endings: [ending] };
}
