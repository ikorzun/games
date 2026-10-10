/**
 * Сейвы и профиль.
 *
 * Сейв = объект состояния (GameState) + снимок кадра + schema_version + content_version.
 * Хранилище — платформенное (Playgama: bridge.storage одним вызовом с массивом ключей;
 * web-plain: localStorage). Ключи пакетной записи: `profile`, `progress`, `settings`, `archive`.
 * Слоты ручных сохранений — отдельные ключи `slot_<n>` и только там, где платформа их разрешает.
 *
 * При загрузке: миграция по schema_version (цепочка MIGRATIONS), проверка формы, затем
 * приведение к текущему описанию эпизода (content_version мог измениться: новые переменные
 * получают значения по умолчанию, пропавшая сцена заменяется входом в её блок).
 */
import { defaultViewFor } from './interpreter';
import { DEFAULT_SETTINGS, sanitizeSettings } from './settings';
import type { Settings } from './settings';
import { cloneJson, reconcileState } from './state';
import type { Episode, GameState, Snapshot, Value, ViewState } from './types';

export const SAVE_SCHEMA_VERSION = 1;
export const STORAGE_KEYS = ['profile', 'progress', 'settings', 'archive'] as const;

export interface StoragePort {
  save(keys: string[], values: unknown[]): Promise<void>;
  load(keys: string[]): Promise<unknown[]>;
}

export interface SaveFile {
  schema_version: number;
  content_version: string;
  saved_at: string;
  state: GameState;
  /** Что было на сцене в момент сохранения; без него кадр собирается заново из описания сцены. */
  view?: ViewState;
  /** Состояние активной мини-игры (IMinigame.serialize). */
  mg?: { id: string; state: unknown };
}

export interface Profile {
  v: 1;
  /** «Больше не показывать» на экране контент-предупреждения. */
  warning_dismissed: boolean;
  /** Прочитанные реплики по эпизодам (для Skip «только прочитанное»). */
  read: Record<string, string[]>;
  /** Достигнутые концовки по эпизодам. */
  endings: Record<string, string[]>;
  /** Глобальные переменные сезона, перенесённые между эпизодами. */
  globals: Record<string, Value>;
}

export interface ProgressBlob {
  v: 1;
  autosave: unknown;
  quick: unknown;
}

export interface ArchiveBlob {
  v: 1;
  items: Record<string, string[]>;
}

// ───────────────────────────── миграции и проверка формы ─────────────────────────────

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** Миграции «из версии N в N+1». Текущая версия 1 — цепочка пока пуста. */
const MIGRATIONS = new Map<number, Migration>();

/** Для тестов и будущих версий формата: зарегистрировать миграцию «из версии from». */
export function registerMigration(from: number, fn: Migration): void {
  MIGRATIONS.set(from, fn);
}

export function unregisterMigration(from: number): void {
  MIGRATIONS.delete(from);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStateShape(s: unknown): s is GameState {
  return (
    isRecord(s) &&
    typeof s.episode_id === 'string' &&
    typeof s.scene_id === 'string' &&
    typeof s.step_index === 'number' &&
    Number.isInteger(s.step_index) &&
    isRecord(s.vars) &&
    isRecord(s.globals) &&
    Array.isArray(s.archive) &&
    Array.isArray(s.journal)
  );
}

/**
 * Сырые данные из хранилища → SaveFile текущей версии, либо null (мусор, сейв из более новой сборки,
 * разрыв в цепочке миграций). `target` — версия, до которой мигрируем (в приложении всегда текущая;
 * параметр нужен тестам цепочки и будущим форматам).
 */
export function migrateSave(raw: unknown, target: number = SAVE_SCHEMA_VERSION): SaveFile | null {
  if (!isRecord(raw)) return null;
  let cur: Record<string, unknown> = raw;
  let version = typeof cur.schema_version === 'number' ? cur.schema_version : NaN;
  if (!Number.isInteger(version) || version < 1 || version > target) return null;
  // Миграции не должны менять объект, лежащий в хранилище/кэше платформы.
  if (version < target) cur = cloneJson(cur);
  while (version < target) {
    const step = MIGRATIONS.get(version);
    if (!step) return null;
    cur = step(cur);
    version += 1;
    cur.schema_version = version;
  }
  if (!isStateShape(cur.state) || typeof cur.content_version !== 'string') return null;
  return cur as unknown as SaveFile;
}

function viewLooksValid(v: unknown): v is ViewState {
  return (
    isRecord(v) &&
    typeof v.scene === 'string' &&
    typeof v.bg === 'string' &&
    Array.isArray(v.sprites) &&
    v.sprites.every((s) => isRecord(s) && typeof s.who === 'string')
  );
}

export type LoadResult =
  | { ok: true; snapshot: Snapshot; mg: { id: string; state: unknown } | null; notes: string[] }
  | { ok: false; reason: 'episode_mismatch' };

/** Подготовить сейв к загрузке в интерпретатор текущего эпизода. */
export function prepareLoad(file: SaveFile, episode: Episode, contentVersion: string): LoadResult {
  if (file.state.episode_id !== episode.id) return { ok: false, reason: 'episode_mismatch' };

  const { state, notes } = reconcileState(episode, file.state);
  if (file.content_version !== contentVersion) {
    notes.push(`content_version изменился: ${file.content_version} → ${contentVersion}`);
  }

  let keepPosition = true;
  let scene = episode.scenes[state.scene_id];
  if (!scene) {
    const savedBlock = episode.blocks.find((b) => b.id === file.view?.block);
    const fallback = savedBlock?.entry_scene ?? episode.blocks[0]?.entry_scene;
    if (!fallback || !episode.scenes[fallback]) throw new Error('эпизод без сцен: загружать нечего');
    notes.push(`сцена ${state.scene_id} больше не существует; вход в ${fallback}`);
    state.scene_id = fallback;
    state.step_index = 0;
    scene = episode.scenes[fallback];
    keepPosition = false;
  }
  if (scene && (state.step_index < 0 || state.step_index >= scene.steps.length)) {
    notes.push(`шаг ${state.step_index} вне сцены ${state.scene_id}; начинаем сцену с начала`);
    state.step_index = 0;
    keepPosition = false;
  }

  const savedView = keepPosition && viewLooksValid(file.view) && file.view.scene === state.scene_id ? file.view : null;
  const view = savedView ? cloneJson(savedView) : defaultViewFor(episode, state.scene_id);
  const mg = keepPosition && file.mg ? file.mg : null;
  return { ok: true, snapshot: { state, view }, mg, notes };
}

// ───────────────────────────── профиль, архив, прогресс ─────────────────────────────

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function strArrayMap(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (isRecord(v)) for (const [k, arr] of Object.entries(v)) out[k] = strArray(arr);
  return out;
}

export function sanitizeProfile(raw: unknown): Profile {
  const r = isRecord(raw) ? raw : {};
  const globals: Record<string, Value> = {};
  if (isRecord(r.globals)) {
    for (const [k, v] of Object.entries(r.globals)) {
      if (typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') globals[k] = v;
    }
  }
  return {
    v: 1,
    warning_dismissed: r.warning_dismissed === true,
    read: strArrayMap(r.read),
    endings: strArrayMap(r.endings),
    globals,
  };
}

export function sanitizeArchive(raw: unknown): ArchiveBlob {
  return { v: 1, items: strArrayMap(isRecord(raw) ? raw.items : undefined) };
}

export function sanitizeProgress(raw: unknown): ProgressBlob {
  const r = isRecord(raw) ? raw : {};
  return { v: 1, autosave: r.autosave ?? null, quick: r.quick ?? null };
}

// ───────────────────────────── менеджер ─────────────────────────────

export interface SaveManagerOptions {
  /** Сколько нумерованных слотов поддерживает платформа (0 — только автосейв и быстрый сейв). */
  slots: number;
  /** Задержка отложенной записи; 0 — писать сразу. */
  debounceMs?: number;
  now?: () => Date;
}

export class SaveManager {
  profile: Profile = sanitizeProfile(null);
  settings: Settings = { ...DEFAULT_SETTINGS };
  archive: ArchiveBlob = sanitizeArchive(null);
  progress: ProgressBlob = sanitizeProgress(null);

  private readonly readSets = new Map<string, Set<string>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();
  private readonly debounceMs: number;

  constructor(
    private readonly storage: StoragePort,
    private readonly opts: SaveManagerOptions,
  ) {
    this.debounceMs = opts.debounceMs ?? 300;
  }

  get slotCount(): number {
    return this.opts.slots;
  }

  /** Загрузить profile / progress / settings / archive одним вызовом. */
  async init(): Promise<void> {
    let values: unknown[] = [];
    try {
      values = await this.storage.load([...STORAGE_KEYS]);
    } catch (e) {
      console.warn('[saves] не удалось прочитать хранилище:', e);
    }
    this.profile = sanitizeProfile(values[0]);
    this.progress = sanitizeProgress(values[1]);
    this.settings = sanitizeSettings(values[2]);
    this.archive = sanitizeArchive(values[3]);
    this.readSets.clear();
    for (const [ep, keys] of Object.entries(this.profile.read)) this.readSets.set(ep, new Set(keys));
  }

  // — автосейв и быстрый сейв —

  get autosave(): SaveFile | null {
    return migrateSave(this.progress.autosave);
  }

  get quicksave(): SaveFile | null {
    return migrateSave(this.progress.quick);
  }

  writeAutosave(file: SaveFile): void {
    this.progress.autosave = cloneJson(file);
    this.scheduleFlush();
  }

  clearAutosave(): void {
    this.progress.autosave = null;
    this.scheduleFlush();
  }

  writeQuicksave(file: SaveFile): void {
    this.progress.quick = cloneJson(file);
    this.scheduleFlush();
  }

  // — слоты —

  static slotKey(n: number): string {
    return `slot_${n}`;
  }

  async writeSlot(n: number, file: SaveFile): Promise<void> {
    this.assertSlot(n);
    await this.storage.save([SaveManager.slotKey(n)], [cloneJson(file)]);
  }

  async readSlot(n: number): Promise<SaveFile | null> {
    this.assertSlot(n);
    const [raw] = await this.storage.load([SaveManager.slotKey(n)]);
    return migrateSave(raw);
  }

  async listSlots(): Promise<Array<SaveFile | null>> {
    if (this.opts.slots === 0) return [];
    const keys = Array.from({ length: this.opts.slots }, (_, i) => SaveManager.slotKey(i + 1));
    const raws = await this.storage.load(keys);
    return keys.map((_, i) => migrateSave(raws[i]));
  }

  // — ручные слоты, как их видит игрок —

  /**
   * Сколько ручных слотов показывать: нумерованные (web-plain) или один слот на Playgama,
   * где вместо слотов работают автосейв и быстрый сейв (`progress.quick`).
   */
  get manualCount(): number {
    return this.opts.slots > 0 ? this.opts.slots : 1;
  }

  async listManual(): Promise<Array<SaveFile | null>> {
    return this.opts.slots > 0 ? this.listSlots() : [this.quicksave];
  }

  async readManual(n: number): Promise<SaveFile | null> {
    if (this.opts.slots > 0) return this.readSlot(n);
    if (n !== 1) throw new RangeError(`нет слота ${n}`);
    return this.quicksave;
  }

  async writeManual(n: number, file: SaveFile): Promise<void> {
    if (this.opts.slots > 0) {
      await this.writeSlot(n, file);
      return;
    }
    if (n !== 1) throw new RangeError(`нет слота ${n}`);
    this.writeQuicksave(file);
    await this.flush();
  }

  private assertSlot(n: number): void {
    if (!Number.isInteger(n) || n < 1 || n > this.opts.slots) throw new RangeError(`нет слота ${n}`);
  }

  // — прочитанное, архив, концовки, глобальные —

  isRead(episodeId: string, key: string): boolean {
    return this.readSets.get(episodeId)?.has(key) === true;
  }

  markRead(episodeId: string, key: string): void {
    let set = this.readSets.get(episodeId);
    if (!set) {
      set = new Set();
      this.readSets.set(episodeId, set);
    }
    if (set.has(key)) return;
    set.add(key);
    this.profile.read[episodeId] = [...set];
    this.scheduleFlush();
  }

  unlockArchive(episodeId: string, item: string): boolean {
    const list = (this.archive.items[episodeId] ??= []);
    if (list.includes(item)) return false;
    list.push(item);
    this.scheduleFlush();
    return true;
  }

  archiveOf(episodeId: string): readonly string[] {
    return this.archive.items[episodeId] ?? [];
  }

  recordEnding(episodeId: string, endingId: string): void {
    const list = (this.profile.endings[episodeId] ??= []);
    if (!list.includes(endingId)) list.push(endingId);
    this.scheduleFlush();
  }

  setGlobals(globals: Readonly<Record<string, Value>>): void {
    this.profile.globals = { ...this.profile.globals, ...globals };
    this.scheduleFlush();
  }

  setWarningDismissed(v: boolean): void {
    this.profile.warning_dismissed = v;
    this.scheduleFlush();
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.settings = sanitizeSettings({ ...this.settings, ...patch });
    this.scheduleFlush();
    return this.settings;
  }

  // — запись —

  scheduleFlush(): void {
    if (this.debounceMs <= 0) {
      void this.flush();
      return;
    }
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  /** Записать все четыре ключа одним вызовом платформы. */
  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const values = [cloneJson(this.profile), cloneJson(this.progress), cloneJson(this.settings), cloneJson(this.archive)];
    this.writing = this.writing
      .catch(() => undefined)
      .then(() => this.storage.save([...STORAGE_KEYS], values))
      .catch((e: unknown) => {
        console.warn('[saves] не удалось записать хранилище:', e);
      });
    return this.writing;
  }
}
