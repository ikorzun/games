/** Конструктор миниатюрных эпизодов для юнит-тестов интерпретатора. */
import type { Block, Episode, MinigameDef, Scene, StageSpec, Step, VariableDef } from '../../src/core/types';

export interface MiniScene {
  block?: string;
  stage?: StageSpec;
  music?: string;
  ambient?: string;
  steps: Step[];
}

export interface MiniOptions {
  blocks?: Array<Partial<Block> & { id: string; entry_scene: string }>;
  variables?: Record<string, VariableDef>;
  minigames?: Record<string, MinigameDef>;
  archive?: string[];
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
    frame: { pov: 'investigator', narrator: 'voiceover' },
    cast: [
      { id: 'a', name_key: 'mini.cast.a', role: 'investigator', name_color: '#ffffff' },
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
    assets: {},
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
