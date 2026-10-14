/** Конструктор миниатюрных эпизодов для юнит-тестов интерпретатора. */
import type { Block, Episode, MinigameDef, Scene, Shot, StageSpec, Step, VariableDef } from '../../src/core/types';

export interface MiniScene {
  block?: string;
  stage?: StageSpec;
  music?: string;
  ambient?: string;
  /** Сет кадров покрытия (монтажёр). */
  coverage?: string;
  /** Варианты сета по условию (coverage_alt). */
  coverage_alt?: Scene['coverage_alt'];
  steps: Step[];
}

export interface MiniOptions {
  blocks?: Array<Partial<Block> & { id: string; entry_scene: string }>;
  variables?: Record<string, VariableDef>;
  minigames?: Record<string, MinigameDef>;
  archive?: string[];
  /** Кадры покрытия (assets.shots). */
  shots?: Shot[];
  /** Персонаж игрока (frame.player_character). */
  pov?: string;
}

export function miniEpisode(scenes: Record<string, MiniScene>, opts: MiniOptions = {}): Episode {
  const sceneMap: Record<string, Scene> = {};
  for (const [id, sc] of Object.entries(scenes)) {
    sceneMap[id] = {
      id,
      block: sc.block ?? 'b1',
      stage: sc.stage ?? { bg: 'bg_a' },
      ...(sc.music ? { music: sc.music } : {}),
      ...(sc.ambient ? { ambient: sc.ambient } : {}),
      ...(sc.coverage ? { coverage: sc.coverage } : {}),
      ...(sc.coverage_alt ? { coverage_alt: sc.coverage_alt } : {}),
      steps: sc.steps,
    };
  }
  const first = Object.keys(scenes)[0] ?? 's1';
  const blocks: Block[] = (opts.blocks ?? [{ id: 'b1', entry_scene: first }]).map((b) => ({
    type: 'investigation',
    presentation: 'procedural',
    ...b,
  }));
  return {
    schema_version: 1,
    id: 'ep_mini',
    season: 1,
    order: 1,
    title_key: 'mini.title',
    archetype: 'fraud',
    based_on: { case_name: 'x', years: [1993], city: 'x', fictionalization: { level: 'inspired', names_changed: true } },
    frame: { pov: 'investigator', narrator: 'voiceover', ...(opts.pov ? { player_character: opts.pov } : {}) },
    cast: [
      { id: 'a', name_key: 'mini.cast.a', role: 'investigator', name_color: '#ffffff', title_key: 'mini.cast.a_title' },
      { id: 'b', name_key: 'mini.cast.b', role: 'witness' },
    ],
    variables: opts.variables ?? {},
    blocks,
    scenes: sceneMap,
    ...(opts.minigames ? { minigames: opts.minigames } : {}),
    endings: [
      { id: 'e_main', title_key: 'mini.end.main', kind: 'canonical' },
      { id: 'e_alt', title_key: 'mini.end.alt', kind: 'variant', unlocks: ['arc_x'] },
    ],
    archive_items: (opts.archive ?? ['arc_x', 'arc_y']).map((id) => ({ id, kind: 'fact' as const, title_key: `mini.${id}` })),
    assets: opts.shots ? { shots: opts.shots } : {},
  };
}

export function mg(id: string, over: Partial<MinigameDef> = {}): MinigameDef {
  return {
    id,
    type: 'document_check',
    title_key: `mini.${id}.title`,
    brief_key: `mini.${id}.brief`,
    config: {},
    skip: { allowed: true },
    outcomes: { success: { goto: 's_ok' }, fail: { goto: 's_bad' } },
    ...over,
  };
}

/**
 * Дедуктивная развилка в миниатюре (02-narrative-blocks §5a). s0: обычный выбор c0 (remember: false) — «look»
 * открывает улику arc_card (фото), «skip» — нет. Вопрос s_q: show + реплика + choice d1 последним шагом; два
 * неверных хода ведут в сцены-реакции s_w1 / s_w2, которые jump'ом возвращаются к вопросу; опция-улика ev
 * (верная, только при arc_card в архиве) и всегда доступная верная r. Цена ошибки — nerves −1 (5..0); после
 * развилки nerves читает branch: ≤ 1 ошибки — e_main, 2 — e_alt.
 */
export function deductionEpisode(over: { hint_after?: number } = {}): Episode {
  const ep = miniEpisode(
    {
      s0: {
        steps: [
          {
            do: 'choice',
            id: 'c0',
            remember: false,
            options: [
              { id: 'look', key: 'k.look', effects: [{ var: 'has_card', op: 'set', value: true }], goto: 's1' },
              { id: 'skip', key: 'k.skip', goto: 's1' },
            ],
          },
        ],
      },
      s1: { steps: [{ do: 'archive_unlock', item: 'arc_card', when: 'has_card' }, { do: 'jump', scene: 's_q' }] },
      s_q: {
        steps: [
          { do: 'show', who: 'b', position: 'right' },
          { do: 'say', who: 'b', key: 'k.q_intro' },
          {
            do: 'choice',
            id: 'd1',
            kind: 'deduction',
            prompt_key: 'k.q',
            ...(over.hint_after !== undefined ? { hint_after: over.hint_after } : {}),
            penalty: [{ var: 'nerves', op: 'sub', value: 1 }],
            options: [
              { id: 'w1', key: 'k.w1', verdict: 'wrong', goto: 's_w1' },
              { id: 'w2', key: 'k.w2', verdict: 'wrong', effects: [{ var: 'pushed', op: 'set', value: true }], goto: 's_w2' },
              { id: 'ev', key: 'k.ev', item: 'arc_card', goto: 's_r' },
              { id: 'r', key: 'k.r', verdict: 'right', goto: 's_r' },
            ],
          },
        ],
      },
      s_w1: { steps: [{ do: 'say', who: 'b', key: 'k.no1' }, { do: 'jump', scene: 's_q' }] },
      s_w2: { steps: [{ do: 'say', who: 'b', key: 'k.no2' }, { do: 'jump', scene: 's_q' }] },
      s_r: { steps: [{ do: 'say', who: 'a', key: 'k.ok' }, { do: 'branch', cases: [{ when: 'nerves >= 4', goto: 's_calm' }], default: 's_shaken' }] },
      s_calm: { steps: [{ do: 'end', ending: 'e_main' }] },
      s_shaken: { steps: [{ do: 'end', ending: 'e_alt' }] },
    },
    {
      variables: {
        nerves: { type: 'int', default: 5, min: 0, max: 5 },
        has_card: { type: 'bool', default: false },
        pushed: { type: 'bool', default: false },
      },
    },
  );
  ep.archive_items = [
    { id: 'arc_card', kind: 'photo', title_key: 'mini.arc_card' },
    { id: 'arc_x', kind: 'fact', title_key: 'mini.arc_x' },
  ];
  return ep;
}
