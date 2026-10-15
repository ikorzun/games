/**
 * Сейвы и профиль: пакетная запись четырёх ключей одним вызовом, слоты (web-plain) против одного
 * быстрого слота (Playgama), миграции по schema_version, согласование сейва с изменившимся контентом.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultViewFor } from '../src/core/interpreter';
import {
  migrateSave,
  prepareLoad,
  registerMigration,
  SAVE_SCHEMA_VERSION,
  SaveManager,
  sanitizeArchive,
  sanitizeProfile,
  sanitizeProgress,
  STORAGE_KEYS,
  unregisterMigration,
} from '../src/core/saves';
import type { SaveFile } from '../src/core/saves';
import { charsPerSecond, DEFAULT_SETTINGS, FONT_SCALE_RANGE, sanitizeSettings } from '../src/core/settings';
import { createInitialState } from '../src/core/state';
import type { Episode, GameState } from '../src/core/types';
import { MemoryStorage } from './helpers/fakes';
import { miniEpisode } from './helpers/mini';

/** Эпизод из двух блоков и трёх сцен с переменными разных типов. */
function twoBlocks(): Episode {
  return miniEpisode(
    {
      s1: { steps: [{ do: 'jump', scene: 's2' }] },
      s2: { steps: [{ do: 'jump', scene: 's3' }] },
      s3: { block: 'b2', stage: { bg: 'bg_b', filter: 'night' }, music: 'mus_b', steps: [{ do: 'end', ending: 'e_main' }] },
    },
    {
      blocks: [
        { id: 'b1', entry_scene: 's1' },
        { id: 'b2', entry_scene: 's3', presentation: 'chronicle' },
      ],
      variables: {
        trust: { type: 'int', default: 2, min: 0, max: 5 },
        met: { type: 'bool', default: false },
        note: { type: 'string', default: 'a' },
        season_karma: { type: 'int', default: 0, scope: 'global' },
      },
    },
  );
}

function saveOf(episode: Episode, over: Partial<GameState> = {}, extra: Partial<SaveFile> = {}): SaveFile {
  const state: GameState = { ...createInitialState(episode, 's2'), ...over };
  return {
    schema_version: SAVE_SCHEMA_VERSION,
    content_version: 'v1',
    saved_at: '2026-10-10T10:00:00.000Z',
    state,
    ...extra,
  };
}

/** Хранилище, считающее вызовы и записывающее, какие ключи в них ушли. */
class SpyStorage extends MemoryStorage {
  readonly saveCalls: string[][] = [];
  readonly loadCalls: string[][] = [];
  override async save(keys: string[], values: unknown[]): Promise<void> {
    this.saveCalls.push([...keys]);
    return super.save(keys, values);
  }
  override async load(keys: string[]): Promise<unknown[]> {
    this.loadCalls.push([...keys]);
    return super.load(keys);
  }
}

describe('SaveManager: пакетная запись (Playgama: один вызов bridge.storage.set)', () => {
  it('init читает profile / progress / settings / archive одним вызовом, из пустого хранилища — умолчания', async () => {
    const st = new SpyStorage();
    const sm = new SaveManager(st, { slots: 0, debounceMs: 0 });
    await sm.init();
    expect(st.loadCalls).toEqual([[...STORAGE_KEYS]]);
    expect(sm.settings).toEqual(DEFAULT_SETTINGS);
    expect(sm.profile).toEqual({ v: 1, read: {}, endings: {}, globals: {} });
    expect(sm.archive).toEqual({ v: 1, items: {} });
    expect(sm.autosave).toBeNull();
    expect(sm.quicksave).toBeNull();
  });

  it('flush пишет все четыре ключа ровно одним вызовом, в фиксированном порядке', async () => {
    const st = new SpyStorage();
    const sm = new SaveManager(st, { slots: 0, debounceMs: 0 });
    await sm.init();
    sm.markRead('ep_mini', 's1:0');
    sm.unlockArchive('ep_mini', 'arc_x');
    sm.recordEnding('ep_mini', 'e_main');
    await sm.flush();
    expect(st.saveCalls.every((keys) => keys.join() === 'profile,progress,settings,archive')).toBe(true);
    expect(st.saveCalls.length).toBeGreaterThan(0);
    const last = st.saveCalls.length - 1;
    expect(st.saveCalls[last]).toEqual(['profile', 'progress', 'settings', 'archive']);
    expect((st.data.get('profile') as { read: Record<string, string[]> }).read).toEqual({ ep_mini: ['s1:0'] });
    expect((st.data.get('archive') as { items: Record<string, string[]> }).items).toEqual({ ep_mini: ['arc_x'] });
  });

  it('несколько правок подряд склеиваются в одну запись (debounce), flush() забирает немедленно', async () => {
    vi.useFakeTimers();
    try {
      const st = new SpyStorage();
      const sm = new SaveManager(st, { slots: 0, debounceMs: 300 });
      await sm.init();
      sm.markRead('e', 'a');
      sm.markRead('e', 'b');
      sm.recordEnding('e', 'x');
      expect(st.saveCalls).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(299);
      expect(st.saveCalls).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(2);
      expect(st.saveCalls).toHaveLength(1);

      sm.markRead('e', 'c');
      await sm.flush(); // без ожидания таймера
      expect(st.saveCalls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1000);
      expect(st.saveCalls).toHaveLength(2); // отложенная запись отменена flush-ем
    } finally {
      vi.useRealTimers();
    }
  });

  it('прогресс режима дела переживает «перезапуск» и пишется копией', async () => {
    const st = new SpyStorage();
    const a = new SaveManager(st, { slots: 0, debounceMs: 0 });
    await a.init();
    const data = { v: 1, stars: 3, done: ['search_flat'] };
    a.writeCase('ep_mini', data);
    data.stars = 99;
    await a.flush();
    const b = new SaveManager(st, { slots: 0, debounceMs: 0 });
    await b.init();
    expect(b.caseProgress('ep_mini')).toEqual({ v: 1, stars: 3, done: ['search_flat'] });
    expect(b.caseProgress('other')).toBeNull();
  });

  it('данные переживают «перезапуск»: новый менеджер читает то, что записал прежний', async () => {
    const st = new SpyStorage();
    const a = new SaveManager(st, { slots: 0, debounceMs: 0 });
    await a.init();
    a.markRead('ep_mini', 's1:3');
    a.unlockArchive('ep_mini', 'arc_y');
    a.recordEnding('ep_mini', 'e_alt');
    a.setGlobals({ season_karma: 3 });
    a.updateSettings({ lang: 'pt', fontScale: 1.25, timers: false });
    await a.flush();

    const b = new SaveManager(st, { slots: 0, debounceMs: 0 });
    await b.init();
    expect(b.isRead('ep_mini', 's1:3')).toBe(true);
    expect(b.isRead('ep_mini', 's1:4')).toBe(false);
    expect(b.archiveOf('ep_mini')).toEqual(['arc_y']);
    expect(b.profile.endings).toEqual({ ep_mini: ['e_alt'] });
    expect(b.profile.globals).toEqual({ season_karma: 3 });
    expect(b.settings).toMatchObject({ lang: 'pt', fontScale: 1.25, timers: false });
  });

  it('сбой чтения хранилища не ломает запуск (умолчания), сбой записи не бросает наружу', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const broken = {
        load: () => Promise.reject(new Error('quota')),
        save: () => Promise.reject(new Error('quota')),
      };
      const sm = new SaveManager(broken, { slots: 0, debounceMs: 0 });
      await expect(sm.init()).resolves.toBeUndefined();
      expect(sm.settings).toEqual(DEFAULT_SETTINGS);
      sm.markRead('e', 'a');
      await expect(sm.flush()).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('повторная отметка прочитанного и повторный архивный материал ничего не дублируют', async () => {
    const sm = new SaveManager(new SpyStorage(), { slots: 0, debounceMs: 0 });
    await sm.init();
    sm.markRead('e', 'a');
    sm.markRead('e', 'a');
    expect(sm.profile.read.e).toEqual(['a']);
    expect(sm.unlockArchive('e', 'x')).toBe(true);
    expect(sm.unlockArchive('e', 'x')).toBe(false);
    sm.recordEnding('e', 'k');
    sm.recordEnding('e', 'k');
    expect(sm.profile.endings.e).toEqual(['k']);
  });
});

describe('SaveManager: слоты', () => {
  let ep: Episode;
  beforeEach(() => {
    ep = twoBlocks();
  });

  it('web-plain: нумерованные слоты лежат в отдельных ключах slot_N и не трогают пакетные ключи', async () => {
    const st = new SpyStorage();
    const sm = new SaveManager(st, { slots: 3, debounceMs: 0 });
    await sm.init();
    expect(sm.manualCount).toBe(3);
    await sm.writeManual(2, saveOf(ep));
    expect(st.saveCalls.at(-1)).toEqual(['slot_2']);
    expect(st.data.has('slot_1')).toBe(false);

    const list = await sm.listManual();
    expect(list.map((x) => x?.state.scene_id ?? null)).toEqual([null, 's2', null]);
    expect((await sm.readManual(2))?.content_version).toBe('v1');
    expect(await sm.readManual(3)).toBeNull();
  });

  it('слоты вне диапазона отклоняются', async () => {
    const sm = new SaveManager(new SpyStorage(), { slots: 3, debounceMs: 0 });
    await sm.init();
    await expect(sm.writeManual(0, saveOf(ep))).rejects.toBeInstanceOf(RangeError);
    await expect(sm.writeManual(4, saveOf(ep))).rejects.toBeInstanceOf(RangeError);
    await expect(sm.readManual(1.5)).rejects.toBeInstanceOf(RangeError);
  });

  it('Playgama (slots: 0): один ручной слот = progress.quick, никаких slot_N ключей', async () => {
    const st = new SpyStorage();
    const sm = new SaveManager(st, { slots: 0, debounceMs: 0 });
    await sm.init();
    expect(sm.manualCount).toBe(1);
    expect(await sm.listManual()).toEqual([null]);
    await sm.writeManual(1, saveOf(ep));
    expect(st.saveCalls.at(-1)).toEqual([...STORAGE_KEYS]);
    expect([...st.data.keys()].some((k) => k.startsWith('slot_'))).toBe(false);
    expect(sm.quicksave?.state.scene_id).toBe('s2');
    expect((await sm.readManual(1))?.state.episode_id).toBe('ep_mini');
    await expect(sm.writeManual(2, saveOf(ep))).rejects.toBeInstanceOf(RangeError);
    await expect(sm.readManual(2)).rejects.toBeInstanceOf(RangeError);
  });

  it('автосейв и быстрый сейв независимы; мусор в хранилище читается как «сейва нет»', async () => {
    const st = new SpyStorage();
    const sm = new SaveManager(st, { slots: 0, debounceMs: 0 });
    await sm.init();
    sm.writeAutosave(saveOf(ep, { scene_id: 's1' }));
    sm.writeQuicksave(saveOf(ep, { scene_id: 's3' }));
    expect(sm.autosave?.state.scene_id).toBe('s1');
    expect(sm.quicksave?.state.scene_id).toBe('s3');
    sm.clearAutosave();
    expect(sm.autosave).toBeNull();
    expect(sm.quicksave?.state.scene_id).toBe('s3');

    sm.progress.quick = { schema_version: 1, state: 'nonsense' };
    expect(sm.quicksave).toBeNull();
  });

  it('записанный сейв — глубокая копия: правка состояния после записи не меняет сохранённое', async () => {
    const sm = new SaveManager(new SpyStorage(), { slots: 0, debounceMs: 0 });
    await sm.init();
    const file = saveOf(ep);
    sm.writeAutosave(file);
    file.state.vars.trust = 5;
    expect(sm.autosave?.state.vars.trust).toBe(2);
  });
});

describe('миграции сейвов (schema_version)', () => {
  afterEach(() => {
    unregisterMigration(1);
    unregisterMigration(2);
  });

  const ep = twoBlocks();

  it('сейв текущей версии читается как есть', () => {
    const file = saveOf(ep);
    expect(migrateSave(file)).toEqual(file);
  });

  it('мусор, чужая форма и версии вне диапазона дают null', () => {
    const file = saveOf(ep);
    expect(migrateSave(null)).toBeNull();
    expect(migrateSave('x')).toBeNull();
    expect(migrateSave([])).toBeNull();
    expect(migrateSave({})).toBeNull();
    expect(migrateSave({ ...file, schema_version: 0 })).toBeNull();
    expect(migrateSave({ ...file, schema_version: 1.5 })).toBeNull();
    expect(migrateSave({ ...file, schema_version: SAVE_SCHEMA_VERSION + 1 })).toBeNull(); // сейв из более новой сборки
    expect(migrateSave({ ...file, schema_version: '1' })).toBeNull();
    expect(migrateSave({ ...file, content_version: 7 })).toBeNull();
    expect(migrateSave({ ...file, state: { ...file.state, step_index: 1.5 } })).toBeNull();
    expect(migrateSave({ ...file, state: { ...file.state, vars: [] } })).toBeNull();
    expect(migrateSave({ ...file, state: { ...file.state, journal: null } })).toBeNull();
  });

  it('цепочка миграций 1 → 2 → 3 выполняется по порядку и не меняет исходный объект', () => {
    const order: number[] = [];
    registerMigration(1, (raw) => {
      order.push(1);
      const state = raw.state as GameState;
      return { ...raw, state: { ...state, scene_id: `${state.scene_id}_v2` } };
    });
    registerMigration(2, (raw) => {
      order.push(2);
      // «Мутирующая» миграция: исходный объект из хранилища всё равно не должен пострадать.
      (raw.state as GameState).vars.migrated = true;
      return raw;
    });
    const old = { ...saveOf(ep), schema_version: 1 };
    const before = JSON.stringify(old);
    const out = migrateSave(old, 3);
    expect(order).toEqual([1, 2]);
    expect(out?.schema_version).toBe(3);
    expect(out?.state.scene_id).toBe('s2_v2');
    expect(out?.state.vars.migrated).toBe(true);
    expect(JSON.stringify(old)).toBe(before);
  });

  it('разрыв в цепочке (нет миграции 2 → 3) — сейв отвергается, а не читается наугад', () => {
    registerMigration(1, (raw) => raw);
    expect(migrateSave({ ...saveOf(ep), schema_version: 1 }, 3)).toBeNull();
  });
});

describe('prepareLoad: сейв против текущего описания эпизода', () => {
  it('сейв другого эпизода не загружается', () => {
    const ep = twoBlocks();
    const foreign = saveOf(ep, { episode_id: 'another' });
    expect(prepareLoad(foreign, ep, 'v1')).toEqual({ ok: false, reason: 'episode_mismatch' });
  });

  it('тот же контент: состояние, шаг, кадр и состояние мини-игры возвращаются без изменений', () => {
    const ep = twoBlocks();
    const view = { ...defaultViewFor(ep, 's2'), bg: 'bg_saved', speaker: 'a' };
    const file = saveOf(ep, { step_index: 0, vars: { trust: 4, met: true, note: 'z' } }, { view, mg: { id: 'mg1', state: { hintsShown: 1 } } });
    const res = prepareLoad(file, ep, 'v1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.notes).toEqual([]);
    expect(res.snapshot.state.vars).toEqual({ trust: 4, met: true, note: 'z' });
    expect(res.snapshot.view.bg).toBe('bg_saved');
    expect(res.snapshot.view.speaker).toBe('a');
    expect(res.mg).toEqual({ id: 'mg1', state: { hintsShown: 1 } });
    // Снимок — копия: правка не должна задеть сейв.
    res.snapshot.view.bg = 'changed';
    expect(file.view?.bg).toBe('bg_saved');
  });

  it('content_version изменился: загружается, в замечаниях — причина; новая переменная получает умолчание, лишняя уходит', () => {
    const ep = twoBlocks();
    const file = saveOf(ep, { vars: { trust: 4, met: true, ghost: 9 } });
    const res = prepareLoad(file, ep, 'v2');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.notes.some((n) => n.includes('v1') && n.includes('v2'))).toBe(true);
    expect(res.snapshot.state.vars).toEqual({ trust: 4, met: true, note: 'a' });
    expect(res.notes.some((n) => n.includes('note'))).toBe(true);
    expect(res.notes.some((n) => n.includes('ghost'))).toBe(true);
    expect(res.snapshot.state.globals).toEqual({ season_karma: 0 });
  });

  it('значение неверного типа сбрасывается к умолчанию, int зажимается в [min, max]', () => {
    const ep = twoBlocks();
    const file = saveOf(ep, { vars: { trust: 99, met: 'yes' as unknown as boolean, note: 'q' } });
    const res = prepareLoad(file, ep, 'v1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.snapshot.state.vars).toEqual({ trust: 5, met: false, note: 'q' });
  });

  it('сцены больше нет: вход в entry_scene блока, где был игрок; кадр и мини-игра отбрасываются', () => {
    const ep = twoBlocks();
    const view = { ...defaultViewFor(ep, 's3'), speaker: 'a' };
    const file = saveOf(ep, { scene_id: 'removed_scene', step_index: 4 }, { view: { ...view, scene: 'removed_scene' }, mg: { id: 'mg1', state: 1 } });
    const res = prepareLoad(file, ep, 'v1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Блок b2 известен из кадра сейва → вход в его entry_scene (s3), шаг с нуля.
    expect(res.snapshot.state.scene_id).toBe('s3');
    expect(res.snapshot.state.step_index).toBe(0);
    expect(res.snapshot.view).toEqual(defaultViewFor(ep, 's3'));
    expect(res.mg).toBeNull();
    expect(res.notes.some((n) => n.includes('removed_scene'))).toBe(true);
  });

  it('сцены больше нет и блок неизвестен: вход в первый блок эпизода', () => {
    const ep = twoBlocks();
    const file = saveOf(ep, { scene_id: 'removed_scene' });
    const res = prepareLoad(file, ep, 'v1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.snapshot.state.scene_id).toBe('s1');
    expect(res.snapshot.view.scene).toBe('s1');
  });

  it('шаг вне сцены: сцена начинается заново, сохранённый кадр не используется', () => {
    const ep = twoBlocks();
    const view = { ...defaultViewFor(ep, 's2'), bg: 'bg_saved' };
    const file = saveOf(ep, { step_index: 17 }, { view, mg: { id: 'x', state: null } });
    const res = prepareLoad(file, ep, 'v1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.snapshot.state.scene_id).toBe('s2');
    expect(res.snapshot.state.step_index).toBe(0);
    expect(res.snapshot.view.bg).toBe(defaultViewFor(ep, 's2').bg);
    expect(res.mg).toBeNull();
    expect(res.notes.some((n) => n.includes('вне сцены'))).toBe(true);
  });

  it('кадр от другой сцены или повреждённый кадр игнорируются — кадр собирается из описания сцены', () => {
    const ep = twoBlocks();
    const other = { ...defaultViewFor(ep, 's1'), bg: 'bg_other' };
    const a = prepareLoad(saveOf(ep, {}, { view: other }), ep, 'v1');
    expect(a.ok && a.snapshot.view.bg).toBe(defaultViewFor(ep, 's2').bg);
    const broken = { scene: 's2', bg: 5, sprites: 'x' } as unknown as SaveFile['view'];
    const b = prepareLoad(saveOf(ep, {}, { view: broken }), ep, 'v1');
    expect(b.ok && b.snapshot.view).toEqual(defaultViewFor(ep, 's2'));
  });
});

describe('очистка данных профиля и настроек', () => {
  it('sanitizeProfile / sanitizeArchive / sanitizeProgress принимают мусор и возвращают валидную форму', () => {
    expect(sanitizeProfile('мусор')).toEqual({ v: 1, read: {}, endings: {}, globals: {} });
    expect(
      sanitizeProfile({
        warning_dismissed: true, // поле старых профилей («Больше не показывать» убрали 2026-10-13) — отбрасывается
        read: { e: ['a', 3, 'b'], f: 'x' },
        endings: [],
        globals: { ok: 1, flag: true, s: 'x', bad: { a: 1 }, nul: null },
      }),
    ).toEqual({
      v: 1,
      read: { e: ['a', 'b'], f: [] },
      endings: {},
      globals: { ok: 1, flag: true, s: 'x' },
    });
    expect(sanitizeArchive({ items: { e: ['x', 1] } })).toEqual({ v: 1, items: { e: ['x'] } });
    expect(sanitizeArchive(7)).toEqual({ v: 1, items: {} });
    expect(sanitizeProgress({ autosave: { a: 1 } })).toEqual({ v: 1, autosave: { a: 1 }, quick: null, cases: {} });
    expect(sanitizeProgress(null)).toEqual({ v: 1, autosave: null, quick: null, cases: {} });
    expect(sanitizeProgress({ cases: { ep: { stars: 2 } } }).cases).toEqual({ ep: { stars: 2 } });
    expect(sanitizeProgress({ cases: [1, 2] }).cases).toEqual({});
  });

  it('sanitizeSettings: неизвестное — к умолчанию, числа зажимаются, язык проверяется по списку', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    const s = sanitizeSettings({
      lang: 'de',
      fontScale: 9,
      textSpeed: 99,
      music: -1,
      sfx: 2,
      voice: 'loud',
      muted: 1,
      timers: false,
      storyOnly: true,
      violenceMode: 'whatever',
      skipUnread: true,
    });
    expect(s.lang).toBeNull();
    expect(s.fontScale).toBe(FONT_SCALE_RANGE.max);
    expect(s.textSpeed).toBe(5);
    expect(s.music).toBe(0);
    expect(s.sfx).toBe(1);
    expect(s.voice).toBe(DEFAULT_SETTINGS.voice);
    expect(s.muted).toBe(false);
    expect(s.timers).toBe(false);
    expect(s.storyOnly).toBe(true);
    expect(s.violenceMode).toBe('full');
    expect(s.skipUnread).toBe(true);
    expect(sanitizeSettings({ lang: 'es', violenceMode: 'schematic' })).toMatchObject({ lang: 'es', violenceMode: 'schematic' });
  });

  it('скорость текста: пять уровней, верхний — мгновенный вывод', () => {
    const speeds = [1, 2, 3, 4, 5].map(charsPerSecond);
    expect(speeds[4]).toBe(Number.POSITIVE_INFINITY);
    expect([...speeds].sort((a, b) => a - b)).toEqual(speeds); // монотонно
    expect(charsPerSecond(0)).toBe(speeds[0]);
    expect(charsPerSecond(99)).toBe(speeds[4]);
  });

  it('updateSettings применяет те же правила очистки и пишет в ключ settings', async () => {
    const st = new SpyStorage();
    const sm = new SaveManager(st, { slots: 0, debounceMs: 0 });
    await sm.init();
    const out = sm.updateSettings({ fontScale: 100, textSpeed: 0 });
    expect(out.fontScale).toBe(FONT_SCALE_RANGE.max);
    expect(out.textSpeed).toBe(1);
    await sm.flush();
    expect((st.data.get('settings') as { fontScale: number }).fontScale).toBe(FONT_SCALE_RANGE.max);
  });
});
