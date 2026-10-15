/**
 * Режим дела (docs/architecture/09-case-mode.md): прогресс без DOM — открытие задач, ★, награды, звёзды поиска,
 * сборка поиска и разговора из файла дела; на настоящем деле ep01 — проход главы при худшем и лучшем поиске.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertCase, searchDef, talkEpisode, TALK_ENDING, taskIndex } from '../src/case/case_def';
import type { CaseDef, CaseScene, CaseTask } from '../src/case/case_def';
import { readRun } from '../src/case/case_mode';
import {
  applyGives,
  chapterComplete,
  completeTask,
  costOf,
  currentChapter,
  emptyProgress,
  hasProgress,
  recordSearch,
  sanitizeProgress,
  searchStars,
  taskState,
} from '../src/case/case_state';
import type { CaseProgress } from '../src/case/case_state';
import { Interpreter } from '../src/core/interpreter';
import { EP01_PATH, hasRepoContent, loadEpisode } from './helpers/content';
import { miniEpisode } from './helpers/mini';

const SCENE: CaseScene = {
  bg: 'bg_a',
  title_key: 't.scene',
  brief_key: 't.brief',
  pick: 3,
  time_limit_ms: 120000,
  star_time_ms: 60000,
  star_misses: 2,
  items: [
    { id: 'photo', rect: [0.1, 0.1, 0.05, 0.05], label_key: 'i.photo', clue: 'photo' },
    { id: 'tv', rect: [0.5, 0.5, 0.1, 0.1], label_key: 'i.tv' },
    { id: 'rug', rect: [0.3, 0.1, 0.1, 0.3], label_key: 'i.rug' },
    { id: 'lamp', rect: [0.8, 0.2, 0.1, 0.1], label_key: 'i.lamp' },
    { id: 'vase', rect: [0.2, 0.7, 0.05, 0.05], label_key: 'i.vase' },
  ],
};

const T = (id: string, kind: CaseTask['kind'], cost: number, requires: string[], extra: Partial<CaseTask> = {}): CaseTask => ({
  id,
  kind,
  title_key: `t.${id}`,
  cost,
  requires,
  ...extra,
});

const DEF: CaseDef = {
  schema_version: 1,
  episode: 'mini',
  title_key: 't.case',
  traits: [{ id: 'volga', label_key: 'tr.volga' }],
  suspects: [{ id: 'lapin', name_key: 's.lapin', who: 'buyer', note_key: 's.lapin.note' }],
  clues: [
    { id: 'photo', label_key: 'c.photo' },
    { id: 'contract', label_key: 'c.contract' },
  ],
  facts: [{ id: 'back', text_key: 'f.back' }],
  scenes: { flat: SCENE },
  talks: { lapin: { stage: { bg: 'bg_a' }, steps: [{ do: 'say', who: 'a', key: 'l.1' }] } },
  chapters: [
    {
      id: 'ch1',
      title_key: 'ch1',
      tasks: [
        T('search', 'search', 0, [], { scene: 'flat', gives: { clues: ['photo'] } }),
        T('talk', 'talk', 1, ['search'], { talk: 'lapin', gives: { suspects: ['lapin'], clues: ['contract'] } }),
        T('photo', 'photo', 1, ['talk'], { scene: 'flat', item: 'photo', back_key: 'b', gives: { facts: ['back'], traits: ['volga'] } }),
      ],
    },
    { id: 'ch2', title_key: 'ch2', locked: true, tasks: [] },
  ],
};

const tasks = taskIndex(DEF);
const task = (id: string): CaseTask => tasks.get(id) as CaseTask;

describe('прогресс дела', () => {
  it('стартовая задача открыта и бесплатна, остальные закрыты до requires', () => {
    const p = emptyProgress();
    expect(taskState(p, task('search'), false)).toBe('open');
    expect(taskState(p, task('talk'), false)).toBe('locked');
    expect(hasProgress(p)).toBe(false);
  });

  it('открытая задача без ★ — poor; в режиме «только история» всё бесплатно', () => {
    const p = completeTask(emptyProgress(), task('search'), false);
    expect(taskState(p, task('talk'), false)).toBe('poor');
    expect(taskState(p, task('talk'), true)).toBe('open');
    expect(costOf(task('talk'), true)).toBe(0);
  });

  it('выполненная задача списывает ★ один раз и выдаёт награду с пометкой «новое»', () => {
    let p: CaseProgress = { ...emptyProgress(), stars: 3 };
    p = completeTask(p, task('search'), false);
    p = completeTask(p, task('talk'), false);
    expect(p.stars).toBe(2);
    expect(p.suspects).toEqual(['lapin']);
    expect(p.clues).toEqual(['photo', 'contract']);
    expect(p.fresh).toEqual(['clue:contract', 'suspect:lapin']);
    const again = completeTask(p, task('talk'), false);
    expect(again).toBe(p);
    expect(taskState(p, task('talk'), false)).toBe('done');
  });

  it('награда без новых id — пустой fresh, повторы не дублируются', () => {
    const p = applyGives({ ...emptyProgress(), clues: ['photo'] }, { clues: ['photo'] });
    expect(p.clues).toEqual(['photo']);
    expect(p.fresh).toEqual([]);
  });

  it('звёзды поиска: всё найдено + быстро + точно; без «всё найдено» — ноль', () => {
    expect(searchStars(SCENE, { complete: true, misses: 0, elapsedMs: 30000 })).toEqual({ all: true, fast: true, accurate: true, stars: 3 });
    expect(searchStars(SCENE, { complete: true, misses: 5, elapsedMs: 90000 }).stars).toBe(1);
    expect(searchStars(SCENE, { complete: true, misses: 2, elapsedMs: null })).toMatchObject({ fast: true, accurate: true, stars: 3 });
    expect(searchStars(SCENE, { complete: false, misses: 0, elapsedMs: 1000 }).stars).toBe(0);
  });

  it('заход в сцену: ★ на счёт, лучший результат и счётчик заходов', () => {
    let p = recordSearch(emptyProgress(), 'flat', 2);
    p = recordSearch(p, 'flat', 1);
    expect(p.stars).toBe(3);
    expect(p.best.flat).toBe(2);
    expect(p.plays.flat).toBe(2);
    expect(hasProgress(p)).toBe(true);
  });

  it('глава: текущая — первая незакрытая открытая; закрыта, когда выполнены все задачи', () => {
    let p: CaseProgress = { ...emptyProgress(), stars: 9 };
    expect(currentChapter(DEF, p).id).toBe('ch1');
    for (const id of ['search', 'talk', 'photo']) p = completeTask(p, task(id), false);
    const ch = DEF.chapters[0];
    expect(ch && chapterComplete(ch, p)).toBe(true);
    // ch2 закрыта (locked) — текущей остаётся последняя открытая
    expect(currentChapter(DEF, p).id).toBe('ch1');
  });

  it('sanitizeProgress отбрасывает мусор и id, которых в деле нет', () => {
    const p = sanitizeProgress(
      { stars: 4.7, done: ['search', 'nope', 5], clues: ['photo', 'photo', 'x'], plays: { flat: 2, gone: 1 }, best: { flat: 9 }, intro: ['ch1', 'zz'], fresh: ['clue:photo', 3] },
      DEF,
    );
    expect(p).toMatchObject({ stars: 4, done: ['search'], clues: ['photo'], plays: { flat: 2 }, best: { flat: 3 }, intro: ['ch1'], fresh: ['clue:photo'] });
    expect(sanitizeProgress(null, DEF)).toEqual(emptyProgress());
    expect(sanitizeProgress({ stars: -3 }, DEF).stars).toBe(0);
  });
});

describe('сборка из файла дела', () => {
  it('поиск: режим списка; улика обязательна, пока её нет', () => {
    const fresh = searchDef(DEF, 'flat', [], 0);
    expect(fresh).toMatchObject({ id: 'case_flat', type: 'crime_scene_search', config: { list: true, pick: 3, seed: 0, scene_bg: 'bg_a' } });
    const req = (d: ReturnType<typeof searchDef>): string[] =>
      (d.config.hotspots as Array<{ id: string; required: boolean }>).filter((h) => h.required).map((h) => h.id);
    expect(req(fresh)).toEqual(['photo']);
    expect(req(searchDef(DEF, 'flat', ['photo'], 4))).toEqual([]);
    expect(searchDef(DEF, 'flat', ['photo'], 4).config.seed).toBe(4);
    expect(() => searchDef(DEF, 'nope', [], 0)).toThrow();
  });

  it('разговор: эпизод из одной сцены без автосейва, в конце — служебная концовка', () => {
    const base = miniEpisode({ s1: { steps: [{ do: 'end', ending: 'e1' }] } });
    const ep = talkEpisode(base, DEF, 'lapin');
    expect(ep.blocks).toEqual([expect.objectContaining({ id: 'case_lapin', entry_scene: 'case_lapin', autosave: false })]);
    expect(ep.scenes.case_lapin?.steps.at(-1)).toEqual({ do: 'end', ending: TALK_ENDING });
    expect(ep.endings.map((e) => e.id)).toEqual([TALK_ENDING]);
    // Интерпретатор проходит его как обычную сцену: реплика, затем конец.
    const it = new Interpreter(ep, { warn: () => undefined });
    it.start();
    expect(it.pump().pending.kind).toBe('line');
    it.continue();
    expect(it.pump().pending.kind).toBe('end');
  });

  it('итог захода читается из состояния мини-игры', () => {
    expect(readRun({ over: 'success', left: 50000, t: { misses: 2 } }, SCENE)).toEqual({ complete: true, misses: 2, elapsedMs: 70000 });
    expect(readRun({ over: 'partial', left: null, t: {} }, SCENE)).toEqual({ complete: false, misses: 0, elapsedMs: null });
    expect(readRun('мусор', SCENE)).toEqual({ complete: false, misses: 0, elapsedMs: null });
  });

  it('assertCase: дело другого эпизода и пустое — ошибка', () => {
    const ep = miniEpisode({ s1: { steps: [{ do: 'end', ending: 'e1' }] } });
    expect(() => assertCase({ ...DEF, episode: ep.id }, ep)).not.toThrow();
    expect(() => assertCase({ ...DEF, episode: 'other' }, ep)).toThrow(/другого|эпизода/);
    expect(() => assertCase({}, ep)).toThrow();
  });
});

describe.runIf(hasRepoContent())('дело ep01 (настоящий контент)', () => {
  const casePath = EP01_PATH.replace(/\.json$/, '.case.json');
  const def = JSON.parse(readFileSync(casePath, 'utf8')) as CaseDef;
  const ep = loadEpisode();

  it('форма подходит эпизоду, разговоры играются интерпретатором до концовки', () => {
    expect(() => assertCase(def, ep)).not.toThrow();
    for (const talkId of Object.keys(def.talks)) {
      const it = new Interpreter(talkEpisode(ep, def, talkId), { warn: () => undefined });
      it.start();
      let lines = 0;
      for (let guard = 0; guard < 50; guard++) {
        const p = it.pump().pending;
        if (p.kind === 'end') break;
        expect(p.kind).toBe('line');
        lines += 1;
        it.continue();
      }
      expect(lines, talkId).toBeGreaterThan(0);
      expect(lines, talkId).toBeLessThanOrEqual(4);
    }
  });

  /** Пройти главу: берём первую открытую задачу; нет — повторяем поиск, приносящий `perRun` ★. */
  function playChapter(perRun: number): { runs: number; done: boolean } {
    const ch = def.chapters[0];
    if (!ch) throw new Error('нет глав');
    let p = emptyProgress();
    let runs = 0;
    for (let step = 0; step < 100 && !chapterComplete(ch, p); step++) {
      const open = ch.tasks.find((t) => taskState(p, t, false) === 'open');
      if (open) {
        if (open.kind === 'search' && open.scene) {
          runs += 1;
          p = recordSearch(p, open.scene, perRun);
        }
        p = completeTask(p, open, false);
        continue;
      }
      // Платные задачи ждут ★: повторить уже пройденную сцену поиска.
      const replay = ch.tasks.find((t) => t.kind === 'search' && t.scene && p.done.includes(t.id));
      if (!replay?.scene) break;
      runs += 1;
      p = recordSearch(p, replay.scene, perRun);
    }
    return { runs, done: chapterComplete(ch, p) };
  }

  it('глава 1 проходится и при ★ за заход, и при ★★★; без тупика', () => {
    const worst = playChapter(1);
    const best = playChapter(3);
    expect(worst.done).toBe(true);
    expect(best.done).toBe(true);
    // Лучший игрок почти не повторяет сцены, худший — повторяет, но не бесконечно.
    expect(best.runs).toBeLessThanOrEqual(3);
    expect(worst.runs).toBeLessThanOrEqual(6);
  });

  it('предметы-улики сцены выдаются задачей этой сцены', () => {
    const idx = taskIndex(def);
    for (const [sid, sc] of Object.entries(def.scenes)) {
      const owner = [...idx.values()].find((t) => t.kind === 'search' && t.scene === sid);
      for (const it of sc.items) if (it.clue) expect(owner?.gives?.clues, `${sid}.${it.id}`).toContain(it.clue);
    }
  });
});
