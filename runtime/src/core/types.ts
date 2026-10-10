/**
 * Типы данных рантайма. Модель эпизода повторяет schemas/episode.schema.json 1:1
 * (сценарий — данные; рантайм только исполняет JSON). Если схема меняется — меняйте здесь.
 */

export type Value = boolean | number | string;

export const LANGS = ['ru', 'en', 'es', 'pt'] as const;
export type Lang = (typeof LANGS)[number];

// ───────────────────────────── модель эпизода ─────────────────────────────

export type VarType = 'bool' | 'int' | 'string';

export interface VariableDef {
  type: VarType;
  default: Value;
  scope?: 'episode' | 'global';
  min?: number;
  max?: number;
  doc?: string;
}

export type Presentation =
  | 'reconstruction'
  | 'chronicle'
  | 'talking_head'
  | 'procedural'
  | 'title'
  | 'map'
  | 'courtroom'
  | 'montage'
  | 'document';

export type StageFilter =
  | 'none'
  | 'vhs'
  | 'vhs_heavy'
  | 'archive_photo'
  | 'night'
  | 'sepia'
  | 'desaturated'
  | 'noir';

export const STAGE_FILTERS: readonly StageFilter[] = [
  'none',
  'vhs',
  'vhs_heavy',
  'archive_photo',
  'night',
  'sepia',
  'desaturated',
  'noir',
];

export type Position = 'left' | 'center' | 'right' | 'offscreen_left' | 'offscreen_right';
export type TransitionKind = 'cut' | 'fade' | 'dissolve' | 'wipe' | 'vhs_glitch' | 'flash' | 'slow_fade';
export type CaptionStyle = 'date_stamp' | 'location' | 'lower_third' | 'chapter' | 'fact';
export type NarrateStyle = 'voiceover' | 'inner' | 'report';
export type FxKind =
  | 'fade_out'
  | 'fade_in'
  | 'flash'
  | 'shake'
  | 'vhs_glitch'
  | 'tracking_noise'
  | 'freeze_frame'
  | 'zoom_in'
  | 'slow_motion'
  | 'black_hold'
  | 'static_tv'
  | 'rewind';
export type ChoiceKind = 'investigative' | 'moral' | 'tactical' | 'dialogue' | 'cosmetic';

export type BlockType =
  | 'cold_open'
  | 'title_card'
  | 'chronicle'
  | 'crime'
  | 'discovery'
  | 'investigation'
  | 'dead_end'
  | 'breakthrough'
  | 'pursuit'
  | 'confrontation'
  | 'trial'
  | 'epilogue'
  | 'interlude'
  | 'archive_break'
  | 'editorial';

export type CharacterRole =
  | 'player'
  | 'investigator'
  | 'operative'
  | 'expert'
  | 'witness'
  | 'victim'
  | 'suspect'
  | 'criminal'
  | 'relative'
  | 'journalist'
  | 'official'
  | 'narrator'
  | 'extra';

export interface Character {
  id: string;
  name_key: string;
  short_name_key?: string;
  role: CharacterRole;
  real_person?: boolean;
  sprite_set?: string;
  voice?: 'none' | 'ru_only' | 'all';
  name_color?: string;
  bio_key?: string;
}

export interface Block {
  id: string;
  type: BlockType;
  presentation: Presentation;
  title_key?: string;
  entry_scene: string;
  scenes?: string[];
  act?: number;
  optional?: boolean;
  when?: string;
  ad_break_allowed?: boolean;
  autosave?: boolean;
  timeline?: 'crime' | 'investigation' | 'aftermath';
  date_caption_key?: string;
  music?: string;
}

export interface StageSpec {
  bg: string;
  filter?: StageFilter;
  time_of_day?: 'day' | 'evening' | 'night' | 'dawn';
  weather?: 'clear' | 'rain' | 'snow' | 'fog';
  letterbox?: boolean;
}

export interface Effect {
  var: string;
  op: 'set' | 'add' | 'sub' | 'toggle';
  value?: Value;
}

/** У любого шага может быть условие `when`: ложное — шаг пропускается (schemas/episode.schema.json). */
export interface StepBase {
  when?: string;
}

export interface SayStep extends StepBase {
  do: 'say';
  who: string;
  key: string;
  expression?: string;
  pose?: string;
  position?: Position;
  voice?: string;
}
export interface NarrateStep extends StepBase {
  do: 'narrate';
  key: string;
  style?: NarrateStyle;
  voice?: string;
}
export interface CaptionStep extends StepBase {
  do: 'caption';
  key: string;
  style: CaptionStyle;
  hold_ms?: number;
}
export interface ShowStep extends StepBase {
  do: 'show';
  who: string;
  expression?: string;
  pose?: string;
  position?: Position;
  transition?: TransitionKind;
  silhouette?: boolean;
}
export interface HideStep extends StepBase {
  do: 'hide';
  who: string;
  transition?: TransitionKind;
}
export interface BgStep extends StepBase {
  do: 'bg';
  bg: string;
  filter?: string;
  transition?: TransitionKind;
}
export interface CgStep extends StepBase {
  do: 'cg';
  cg: string;
  transition?: TransitionKind;
  hide_after?: boolean;
}
export interface DocumentStep extends StepBase {
  do: 'document';
  doc: string;
  text_key?: string;
  zoomable?: boolean;
  adds_to_archive?: string;
}
export interface AudioStep extends StepBase {
  do: 'music' | 'sfx' | 'ambient' | 'stop_music' | 'stop_ambient';
  id?: string;
  fade_ms?: number;
  loop?: boolean;
  volume?: number;
}
export interface FxStep extends StepBase {
  do: 'fx';
  fx: FxKind;
  ms?: number;
  intensity?: number;
}
export interface ChoiceOption {
  id: string;
  key: string;
  when?: string;
  hidden_when_false?: boolean;
  effects?: Effect[];
  goto: string;
}
export interface ChoiceStep extends StepBase {
  do: 'choice';
  id: string;
  prompt_key?: string;
  kind?: ChoiceKind;
  timer_ms?: number;
  default_option?: string;
  remember?: boolean;
  options: ChoiceOption[];
}
export interface SetStep extends StepBase {
  do: 'set';
  effects: Effect[];
}
export interface BranchStep extends StepBase {
  do: 'branch';
  cases: Array<{ when: string; goto: string }>;
  default: string;
}
export interface JumpStep extends StepBase {
  do: 'jump';
  scene: string;
  transition?: TransitionKind;
}
export interface MinigameStep extends StepBase {
  do: 'minigame';
  minigame: string;
  intro_key?: string;
}
export interface ArchiveStep extends StepBase {
  do: 'archive_unlock';
  item: string;
  toast?: boolean;
}
export interface EndStep extends StepBase {
  do: 'end';
  ending: string;
}

export type Step =
  | SayStep
  | NarrateStep
  | CaptionStep
  | ShowStep
  | HideStep
  | BgStep
  | CgStep
  | DocumentStep
  | AudioStep
  | FxStep
  | ChoiceStep
  | SetStep
  | BranchStep
  | JumpStep
  | MinigameStep
  | ArchiveStep
  | EndStep;

export interface Scene {
  id: string;
  block: string;
  stage: StageSpec;
  music?: string;
  ambient?: string;
  steps: Step[];
  notes?: string;
}

export type MinigameOutcomeKind = 'success' | 'partial' | 'fail';
/** Что мини-игра сообщает рантайму. `skipped` маппится в `skip.skip_counts_as`. */
export type MinigameResult = MinigameOutcomeKind | 'skipped';

export interface Outcome {
  goto: string;
  effects?: Effect[];
  archive_unlock?: string;
}

export interface MinigameDef {
  id: string;
  type: string;
  title_key: string;
  brief_key: string;
  beat?: string;
  config: Record<string, unknown>;
  difficulty?: 'easy' | 'normal' | 'hard';
  time_limit_ms?: number;
  skip: {
    allowed: boolean;
    after_fails?: number;
    skip_counts_as?: MinigameOutcomeKind;
    hint_rewarded_ad?: boolean;
  };
  outcomes: { success: Outcome; partial?: Outcome; fail: Outcome };
  assets?: string[];
  localized_assets?: string[];
  touch_ready?: boolean;
  notes?: string;
}

export interface Ending {
  id: string;
  title_key: string;
  kind: 'canonical' | 'variant' | 'early' | 'secret';
  epilogue_scene?: string;
  unlocks?: string[];
  counts_toward_completion?: boolean;
}

export interface ArchiveItem {
  id: string;
  kind: 'document' | 'photo' | 'newspaper' | 'object' | 'map' | 'audio' | 'fact';
  title_key: string;
  text_key?: string;
  asset?: string;
  real_fact?: boolean;
}

export interface AssetEntry {
  id: string;
  path: string;
  license?: string;
  localized?: boolean;
  notes?: string;
}
export interface SpriteSet {
  id: string;
  base: string;
  poses?: string[];
  expressions: string[];
  silhouette?: boolean;
}
export interface Assets {
  backgrounds?: AssetEntry[];
  sprites?: SpriteSet[];
  cg?: AssetEntry[];
  documents?: AssetEntry[];
  music?: AssetEntry[];
  sfx?: AssetEntry[];
  ambient?: AssetEntry[];
  voice?: AssetEntry[];
  budget_mb?: number;
}

export type ContentWarning =
  | 'violence'
  | 'murder'
  | 'sexual_violence_implied'
  | 'child_victims'
  | 'suicide'
  | 'drugs'
  | 'torture_implied'
  | 'animal_harm'
  | 'gore_implied'
  | 'strong_language';

export interface Episode {
  schema_version: 1;
  id: string;
  season: number;
  order: number;
  title_key: string;
  logline_key?: string;
  archetype: string;
  template?: string;
  based_on: {
    case_name: string;
    tv_episode?: string;
    years: number[];
    city: string;
    region?: string;
    sources?: string[];
    fictionalization: { level: 'documentary' | 'dramatized' | 'inspired'; names_changed: boolean; notes?: string };
  };
  frame: {
    pov: string;
    narrator: 'voiceover' | 'none';
    editorial_layer?: boolean;
    player_character?: string;
  };
  content_warnings?: ContentWarning[];
  age_rating?: '16+' | '18+';
  estimated_minutes?: number;
  localization?: { source_lang?: 'ru'; status?: Partial<Record<Lang, string>>; glossary?: string };
  cast: Character[];
  variables: Record<string, VariableDef>;
  blocks: Block[];
  scenes: Record<string, Scene>;
  minigames?: Record<string, MinigameDef>;
  endings: Ending[];
  archive_items?: ArchiveItem[];
  assets: Assets;
}

// ───────────────────────────── состояние рантайма ─────────────────────────────

/** Запись журнала решений (choice.remember). Хранит ключи, а не строки: язык можно менять на лету. */
export interface JournalEntry {
  choice: string;
  option: string;
  scene: string;
  kind?: ChoiceKind;
  prompt_key?: string;
  /** Ключ локализации выбранной опции. */
  key: string;
}

/** Состояние партии: ровно то, что описано в docs/architecture/06-engine-and-pipeline.md §5. */
export interface GameState {
  episode_id: string;
  scene_id: string;
  step_index: number;
  vars: Record<string, Value>;
  globals: Record<string, Value>;
  archive: string[];
  journal: JournalEntry[];
}

export interface SpriteView {
  who: string;
  expression: string | null;
  pose: string | null;
  position: Position;
  silhouette: boolean;
}

/**
 * Снимок «что сейчас на сцене». Вместе с GameState позволяет мгновенно восстановить кадр
 * при загрузке сейва и откате (как scene lists в Ren'Py) без повторного проигрывания сцены.
 */
export interface ViewState {
  scene: string;
  block: string;
  presentation: Presentation;
  bg: string;
  /** null — фильтр не задан сценой, действует умолчание пресета показа. */
  filter: StageFilter | null;
  time_of_day: string | null;
  weather: string | null;
  letterbox: boolean;
  sprites: SpriteView[];
  cg: string | null;
  /** Скрыть CG после ближайшей реплики (cg.hide_after). */
  cg_hide_after: boolean;
  music: string | null;
  ambient: string | null;
  speaker: string | null;
}

export interface Snapshot {
  state: GameState;
  view: ViewState;
}

// ───────────────────────────── события и ожидания интерпретатора ─────────────────────────────

export type AudioKind = 'music' | 'sfx' | 'ambient' | 'stop_music' | 'stop_ambient';

/** Неблокирующие команды презентационному слою (сцена, титры, звук). Применяются по порядку. */
export type EngineEvent =
  | { t: 'scene'; view: ViewState; transition: TransitionKind; newBlock: boolean; first: boolean }
  | { t: 'caption'; key: string; style: CaptionStyle; hold_ms: number }
  | { t: 'show'; sprite: SpriteView; existing: boolean; transition: TransitionKind }
  | { t: 'hide'; who: string; transition: TransitionKind }
  | { t: 'bg'; bg: string; filter: StageFilter | null; transition: TransitionKind }
  | { t: 'cg'; cg: string; transition: TransitionKind }
  | { t: 'cg_hide'; transition: TransitionKind }
  | { t: 'speaker'; who: string | null }
  | { t: 'audio'; kind: AudioKind; id: string | null; fade_ms: number; loop: boolean; volume: number }
  | { t: 'archive'; item: string; toast: boolean }
  | { t: 'checkpoint'; reason: 'block' | 'choice' | 'minigame' };

export interface LinePending {
  kind: 'line';
  style: 'say' | 'narrate';
  /** id говорящего; null — рассказчик. */
  who: string | null;
  key: string;
  expression: string | null;
  narrate_style: NarrateStyle | null;
  voice: string | null;
  scene: string;
  index: number;
}

export interface HoldPending {
  kind: 'hold';
  reason: 'caption' | 'fx';
  ms: number;
  caption?: { key: string; style: CaptionStyle };
  fx?: { fx: FxKind; intensity: number };
}

export interface DocumentPending {
  kind: 'document';
  doc: string;
  text_key: string | null;
  zoomable: boolean;
  adds_to_archive: string | null;
}

export interface ChoiceOptionView {
  id: string;
  key: string;
  enabled: boolean;
}

export interface ChoicePending {
  kind: 'choice';
  id: string;
  prompt_key: string | null;
  choice_kind: ChoiceKind | null;
  timer_ms: number | null;
  default_option: string | null;
  remember: boolean;
  options: ChoiceOptionView[];
}

export interface MinigamePending {
  kind: 'minigame';
  def: MinigameDef;
  intro_key: string | null;
}

export interface AdBreakPending {
  kind: 'ad_break';
  block: string;
}

export interface EndPending {
  kind: 'end';
  ending: Ending;
}

export type Pending =
  | LinePending
  | HoldPending
  | DocumentPending
  | ChoicePending
  | MinigamePending
  | AdBreakPending
  | EndPending;

export interface PumpResult {
  events: EngineEvent[];
  pending: Pending;
}
