/**
 * Session: цикл партии без DOM на настоящем ep01 с заглушками UI/сцены/платформы.
 * Здесь же — порядок «погасить → реклама → continue() → проявить» на реальных границах блоков.
 * Тесты не зашивают сюжет ep01: путь к канонической концовке берётся из исследователя состояний.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { runAutoplay } from '../src/core/autoplay';
import { Interpreter } from '../src/core/interpreter';
import { SaveManager } from '../src/core/saves';
import type { SaveFile } from '../src/core/saves';
import type { Episode, MinigameResult } from '../src/core/types';
import { Session, foundOf } from '../src/session';
import { Director } from '../src/stage/director';
import { EP01_PATH, hasRepoContent, loadEpisode } from './helpers/content';
import { policyFromTrail, sampleEpisode } from './helpers/explore';
import { FakeAudio, FakeCaptions, FakePlatform, FakeStage, FakeUI } from './helpers/fakes';
import { deductionEpisode } from './helpers/mini';
import type { FakeUIOptions, Timeline } from './helpers/fakes';

const run = hasRepoContent() ? describe : describe.skip;

interface CanonPath {
  trail: string[];
  /** Ответы по порядку: дедуктивная развилка после неверного хода спрашивает снова. */
  choices: Record<string, string[]>;
  minigames: Record<string, MinigameResult>;
}

let canon: CanonPath;
const episodeOnDisk = (): Episode => loadEpisode(EP01_PATH);

/**
 * Решения, ведущие к канонической концовке: UI тестов берёт первый ответ из записанных, который сейчас доступен.
 * Без счётчика: тот же UI проходит эпизод дважды, а после загрузки сейва партия идёт с середины. У дедуктивной
 * развилки испробованный неверный ход погашен, поэтому ответы сами идут по порядку. Нет ответа — первое
 * доступное (у дедуктивной развилки — первое верное).
 */
function canonUi(): FakeUIOptions {
  return {
    choose: (p) => {
      const answer = (canon.choices[p.id] ?? []).find((id) => p.options.some((o) => o.id === id && o.enabled));
      return answer ?? p.options.find((o) => o.enabled && o.verdict !== 'wrong')?.id ?? p.options.find((o) => o.enabled)?.id ?? '';
    },
    minigame: (p) => canon.minigames[p.def.id] ?? 'success',
  };
}

async function build(opts: { ui?: FakeUIOptions; episode?: Episode; platform?: FakePlatform } = {}) {
  const episode = opts.episode ?? episodeOnDisk();
  const t: Timeline = [];
  const platform = opts.platform ?? new FakePlatform(t);
  const saves = new SaveManager(platform, { slots: platform.capabilities.manualSlots, debounceMs: 0 });
  await saves.init();
  const ui = new FakeUI(t, { ...canonUi(), ...opts.ui });
  const warnings: string[] = [];
  let session!: Session;
  const director = new Director({
    stage: new FakeStage(t),
    audio: new FakeAudio(t),
    captions: new FakeCaptions(t),
    checkpoint: (r) => session.autosave(r),
    archiveUnlocked: (i) => saves.unlockArchive(episode.id, i),
  });
  const ended: string[] = [];
  session = new Session({
    episode,
    contentVersion: 'test@1',
    platform,
    saves,
    ui,
    director,
    warn: (m) => warnings.push(m),
    onEnded: (e) => ended.push(e.id),
  });
  return { episode, t, platform, saves, ui, director, session, warnings, ended };
}

/** remember выбора по id (по умолчанию true). */
function rememberedChoice(episode: Episode, id: string): boolean {
  for (const sc of Object.values(episode.scenes)) {
    for (const st of sc.steps) if (st.do === 'choice' && st.id === id) return st.remember !== false;
  }
  return true;
}

/** Неверный ход дедуктивной развилки: в журнал решений не пишется. */
function wrongMove(episode: Episode, id: string, option: string): boolean {
  for (const sc of Object.values(episode.scenes)) {
    for (const st of sc.steps) {
      if (st.do === 'choice' && st.id === id) return st.kind === 'deduction' && st.options.some((o) => o.id === option && o.verdict === 'wrong');
    }
  }
  return false;
}

/** Блоки, в которые игрок входит по пути (смена блока между соседними сценами), в порядке входа. */
function blockEntries(episode: Episode, scenes: readonly string[]): string[] {
  const out: string[] = [];
  let prev: string | null = null;
  for (const s of scenes) {
    const block = episode.scenes[s]?.block ?? '';
    if (block !== prev) out.push(block);
    prev = block;
  }
  return out;
}

beforeAll(() => {
  if (!hasRepoContent()) return;
  const report = sampleEpisode(episodeOnDisk(), { runs: 300 });
  const trail = report.witness.get('e_canon');
  if (!trail) throw new Error('в эпизоде не нашлось пути к e_canon');
  canon = { trail, ...policyFromTrail(trail) };
}, 120_000);

run('Session на ep01', () => {
  it('проходит эпизод до канонической концовки: реплики, выборы, мини-игры, финал, события платформы', async () => {
    const { session, ui, platform, ended, saves, episode } = await build();
    const outcome = await session.newGame();
    expect(outcome).toMatchObject({ reason: 'ended', ending: { id: 'e_canon', kind: 'canonical' } });
    expect(ended).toEqual(['e_canon']);
    expect(ui.endings).toHaveLength(1);

    const choices = canon.trail.filter((d) => d.includes('='));
    const minigames = canon.trail.filter((d) => !d.includes('='));
    expect(ui.choices.map((c) => `${c.id}=${c.option}`)).toEqual(choices);
    expect(ui.minigames.map((m) => m.id)).toEqual(minigames.map((d) => d.split(':')[0]));
    // В журнал попадают только выборы с remember (по умолчанию true); dialogue/cosmetic его не пишут,
    // неверные ходы дедуктивных развилок — тоже.
    const remembered = choices.filter((d) => {
      const [id = '', option = ''] = d.split('=');
      return rememberedChoice(episode, id) && !wrongMove(episode, id, option);
    }).length;
    expect(ui.endings[0]?.journal).toBe(remembered);

    const events = platform.tracked.map((x) => x.event);
    expect(events[0]).toBe('level_started');
    expect(platform.tracked[0]?.data).toEqual({ world: `s${episode.season}`, level: 'ep01' });
    expect(events).toContain('level_completed');
    expect(events).toContain('ending_reached');
    const skipped = minigames.filter((d) => d.endsWith(':skipped')).length;
    expect(events.filter((e) => e === 'minigame_finish')).toHaveLength(minigames.length - skipped);
    expect(events.filter((e) => e === 'minigame_skip')).toHaveLength(skipped);

    // Итоги записаны в профиль, автосейв после финала очищен, архив открыт.
    expect(saves.profile.endings[episode.id]).toEqual(['e_canon']);
    expect(saves.progress.autosave).toBeNull();
    expect(saves.archiveOf(episode.id).length).toBeGreaterThan(0);
  });

  it('реклама только на границах блоков с ad_break_allowed — и не перед первым блоком', async () => {
    const { session, platform, episode } = await build();
    await session.newGame();
    const walked = runAutoplay(new Interpreter(episode), canon);
    const entries = blockEntries(episode, walked.scenes);
    const expected = entries.slice(1).filter((b) => episode.blocks.find((x) => x.id === b)?.ad_break_allowed === true);
    expect(expected.length).toBeGreaterThan(0);
    expect(platform.tracked.filter((x) => x.event === 'ad_break').map((x) => x.data?.block)).toEqual(expected);
    expect(platform.ads).toBe(expected.length);
  });

  it('на каждой рекламной границе: гашение → реклама → continue() → проявление; новая сцена до рекламы не показывается', async () => {
    const { session, t, platform } = await build();
    // Следим за continue() интерпретатора, чтобы доказать, что проявление идёт после него.
    const original = session.interp.continue.bind(session.interp);
    vi.spyOn(session.interp, 'continue').mockImplementation(() => {
      t.push('interp:continue');
      original();
    });
    await session.newGame();

    const holds = t.flatMap((e, i) => (e.startsWith('stage:fadeToBlackAndHold:') ? [i] : []));
    expect(holds.length).toBe(platform.ads);
    expect(holds.length).toBeGreaterThan(0);
    for (const iHold of holds) {
      const iAdStart = t.indexOf('ad:start', iHold);
      const iAdEnd = t.indexOf('ad:end', iAdStart);
      const iContinue = t.indexOf('interp:continue', iAdEnd);
      const iReveal = t.findIndex((e, i) => i > iHold && e.startsWith('stage:revealFromBlack:'));
      const reveal = t[iReveal] ?? '';
      const scene = reveal.split(':')[2] ?? '';
      expect(iAdStart, `${scene}: старт рекламы после гашения`).toBeGreaterThan(iHold);
      expect(iAdEnd).toBeGreaterThan(iAdStart);
      expect(iContinue, `${scene}: continue() после рекламы`).toBeGreaterThan(iAdEnd);
      expect(iReveal, `${scene}: проявление только после continue()`).toBeGreaterThan(iContinue);
      expect(t.some((e) => e.startsWith(`stage:changeScene:${scene}:`)), `${scene}: обычного перехода нет`).toBe(false);
      // Между гашением и проявлением на сцену ничего не рисуется.
      const between = t.slice(iHold + 1, iReveal).filter((e) => e.startsWith('stage:'));
      expect(between, `${scene}: сцена молчит во время рекламы`).toEqual([]);
    }
  });

  it('если реклама не показалась (web-plain, лимит частоты), экран всё равно проявляется после continue()', async () => {
    const t: Timeline = [];
    const platform = new FakePlatform(t, () => Promise.resolve(false));
    const { session } = await build({ platform });
    const outcome = await session.newGame();
    expect(outcome.reason).toBe('ended');
    const breaks = platform.tracked.filter((x) => x.event === 'ad_break');
    expect(breaks.length).toBeGreaterThan(0);
    expect(breaks.every((x) => x.data?.shown === false)).toBe(true);
  });

  it('автосейвы на границах блоков, после выборов и мини-игр; каждый из них возобновляется до той же концовки', async () => {
    const first = await build();
    const files: SaveFile[] = [];
    const spy = vi.spyOn(first.saves, 'writeAutosave').mockImplementation((f) => {
      files.push(JSON.parse(JSON.stringify(f)) as SaveFile);
    });
    const baseline = await first.session.newGame();
    expect(baseline).toMatchObject({ reason: 'ended', ending: { id: 'e_canon' } });
    spy.mockRestore();

    const walked = runAutoplay(new Interpreter(first.episode), canon);
    const blocksEntered = blockEntries(first.episode, walked.scenes).filter((b) => first.episode.blocks.find((x) => x.id === b)?.autosave !== false);
    expect(files.length).toBe(blocksEntered.length + walked.choices.length + walked.minigames.length);
    for (const f of files) {
      expect(f.schema_version).toBe(1);
      expect(f.content_version).toBe('test@1');
      expect(f.state.episode_id).toBe(first.episode.id);
      expect(f.view?.scene).toBe(f.state.scene_id);
    }

    // Загрузка любого из автосейвов и прохождение теми же решениями даёт ту же концовку и тот же журнал.
    for (const f of files) {
      const again = await build();
      const outcome = await again.session.loadSave(f);
      expect(outcome, `сейв в сцене ${f.state.scene_id}`).toMatchObject({ reason: 'ended', ending: { id: 'e_canon' } });
      expect(again.ui.endings[0]?.state.journal.map((j) => j.option)).toEqual(first.ui.endings[0]?.state.journal.map((j) => j.option));
    }
  }, 60_000);

  it('загрузка не дублирует рекламу и не вызывает level_started', async () => {
    const first = await build();
    const files: SaveFile[] = [];
    vi.spyOn(first.saves, 'writeAutosave').mockImplementation((f) => {
      files.push(JSON.parse(JSON.stringify(f)) as SaveFile);
    });
    await first.session.newGame();
    const last = files[files.length - 1];
    expect(last).toBeDefined();
    const again = await build();
    await again.session.loadSave(last as SaveFile);
    expect(again.platform.tracked.some((x) => x.event === 'level_started')).toBe(false);
    expect(again.platform.ads).toBe(0);
  });

  it('прочитанное запоминается: на втором проходе реплики приходят с read=true', async () => {
    const { session, ui } = await build();
    await session.newGame();
    // Первый проход: реплика приходит read=true только если её ключ уже показывали в этой же партии
    // (дедуктивная развилка после неверного хода задаёт вопрос снова, и её реплики повторяются).
    const seen = new Set<string>();
    for (const l of ui.lines) {
      expect(l.read, l.p.key).toBe(seen.has(l.p.key));
      seen.add(l.p.key);
    }
    const count = ui.lines.length;
    expect(count).toBeGreaterThan(50);
    await session.newGame();
    expect(ui.lines.length).toBe(count * 2);
    expect(ui.lines.slice(count).every((l) => l.read)).toBe(true);
  });

  it('журнал реплик (backlog) копится по порядку показа и совпадает с тем, что видел игрок', async () => {
    const { session, ui } = await build();
    await session.newGame();
    expect(session.log.map((l) => l.key)).toEqual(ui.lines.map((l) => l.p.key));
    expect(session.log.map((l) => l.who)).toEqual(ui.lines.map((l) => l.p.who));
    expect(session.log.map((l) => l.kind)).toEqual(ui.lines.map((l) => l.p.style));
    expect(session.log.some((l) => l.kind === 'narrate')).toBe(true);
    expect(session.log.some((l) => l.kind === 'say')).toBe(true);
  });

  it('политики UI: выбор и исход мини-игры доходят до интерпретатора', async () => {
    const policy = { choice: 'last' as const, minigame: 'fail' as const };
    const { session, ui, episode } = await build({
      ui: {
        choose: (p) => p.options.filter((o) => o.enabled).at(-1)?.id ?? '',
        minigame: () => 'fail',
      },
    });
    const outcome = await session.newGame();
    const expected = runAutoplay(new Interpreter(episode), policy);
    expect(outcome.reason).toBe('ended');
    expect(ui.endings[0]?.ending).toBe(expected.ending);
    expect(ui.choices.map((c) => `${c.id}=${c.option}`)).toEqual(expected.choices.map((c) => `${c.choice}=${c.option}`));
  });
});

run('Session: откат, отмена, пауза, загрузка', () => {
  it('rollback() возвращает к предыдущей реплике и укорачивает журнал', async () => {
    const { session, ui } = await build({ ui: { manualLines: true } });
    const done = session.newGame();
    await ui.untilLines(1);
    ui.releaseLatest();
    await ui.untilLines(2);
    ui.releaseLatest();
    await ui.untilLines(3);
    expect(session.log).toHaveLength(3);
    expect(session.canRollback).toBe(true);

    const rolled = session.rollback();
    expect(rolled).not.toBeNull();
    await ui.untilLines(4);
    // Показана снова вторая реплика (одна назад от третьей), журнал вернулся к двум.
    expect(ui.lines[3]?.p.key).toBe(ui.lines[1]?.p.key);
    expect(session.log.map((l) => l.key)).toEqual([ui.lines[0]?.p.key, ui.lines[1]?.p.key]);
    expect(await done).toEqual({ reason: 'cancelled' });
    session.cancel();
  });

  it('rollback(n) откатывает сразу на n реплик назад; лишнее — null', async () => {
    const { session, ui } = await build({ ui: { manualLines: true } });
    void session.newGame();
    for (let i = 1; i <= 5; i++) {
      await ui.untilLines(i);
      if (i < 5) ui.releaseLatest();
    }
    expect(session.rollbackDepth).toBe(4);
    expect(session.rollback(5)).toBeNull();
    expect(session.rollback(0)).toBeNull();
    const keys = ui.lines.map((l) => l.p.key);
    const rolled = session.rollback(3);
    expect(rolled).not.toBeNull();
    await ui.untilLines(6);
    expect(ui.lines[5]?.p.key).toBe(keys[1]); // 5-я реплика − 3 = 2-я
    expect(session.log.map((l) => l.key)).toEqual(keys.slice(0, 2));
    expect(session.rollbackDepth).toBe(1);
    session.cancel();
  });

  it('rollback() недоступен, пока не было двух реплик; глубина ограничена', async () => {
    const { session, ui } = await build({ ui: { manualLines: true } });
    expect(session.rollback()).toBeNull();
    void session.newGame();
    await ui.untilLines(1);
    expect(session.canRollback).toBe(false);
    expect(session.rollback()).toBeNull();
    for (let i = 1; i <= 34; i++) {
      ui.releaseLatest();
      await ui.untilLines(i + 1);
    }
    let steps = 0;
    while (session.canRollback && steps < 100) {
      const p = session.rollback();
      if (!p) break;
      steps += 1;
      await ui.untilLines(ui.lines.length + 1);
    }
    expect(steps).toBe(30); // ROLLBACK_LIMIT
    session.cancel();
  });

  it('новый запуск отменяет предыдущий цикл и сбрасывает интерфейс', async () => {
    const { session, ui } = await build({ ui: { manualLines: true } });
    const first = session.newGame();
    await ui.untilLines(1);
    const resetsBefore = ui.resets;
    const second = session.newGame();
    expect(await first).toEqual({ reason: 'cancelled' });
    expect(ui.resets).toBeGreaterThan(resetsBefore);
    await ui.untilLines(2);
    session.cancel();
    expect(await second).toEqual({ reason: 'cancelled' });
  });

  it('loadSave отвергает сейв от другого эпизода', async () => {
    const { session } = await build();
    const bad: SaveFile = {
      schema_version: 1,
      content_version: 'x',
      saved_at: '2026-01-01T00:00:00Z',
      state: { episode_id: 'other', scene_id: 's01', step_index: 0, vars: {}, globals: {}, archive: [], journal: [], deductions: {} },
    };
    expect(await session.loadSave(bad)).toEqual({ reason: 'rejected', detail: 'episode_mismatch' });
  });

  it('пауза платформы сохраняет автосейв и передаёт паузу интерфейсу', async () => {
    const { session, ui, saves } = await build({ ui: { manualLines: true } });
    void session.newGame();
    await ui.untilLines(1);
    ui.releaseLatest();
    await ui.untilLines(2);
    session.setPaused(true);
    expect(ui.paused).toBe(true);
    expect(saves.autosave?.state.scene_id).toBeDefined();
    session.setPaused(false);
    expect(ui.paused).toBe(false);
    session.cancel();
  });

  it('сейв внутри мини-игры несёт её состояние, а при загрузке оно передаётся обратно', async () => {
    const first = await build();
    const mgId = canon.trail.find((d) => !d.includes('='))?.split(':')[0] as string;
    const mgScene = Object.values(first.episode.scenes).find((s) => s.steps.some((st) => st.do === 'minigame' && st.minigame === mgId));
    expect(mgScene).toBeDefined();
    // Остановимся на первой мини-игре пути: UI мини-игры «висит», пока тест не завершит её.
    let hang = false;
    first.ui.runMinigame = (p, ctx) => {
      first.ui.minigames.push({ id: p.def.id, restore: ctx.restore });
      first.ui.activeMinigame = { id: p.def.id, state: { marked: ['date'] } };
      ctx.autosave();
      hang = true;
      return new Promise(() => undefined);
    };
    void first.session.newGame();
    for (let i = 0; i < 400 && !hang; i++) await new Promise((r) => setTimeout(r, 0));
    expect(hang).toBe(true);
    const file = first.saves.autosave;
    expect(file?.mg).toEqual({ id: mgId, state: { marked: ['date'] } });
    expect(file?.state.scene_id).toBe(mgScene?.id);
    first.session.cancel();

    const again = await build();
    const outcome = await again.session.loadSave(file as SaveFile);
    expect(outcome.reason).toBe('ended');
    expect(again.ui.minigames[0]).toEqual({ id: mgId, restore: { marked: ['date'] } });
  });
});

run('Session: автопилот', () => {
  it('autoplay доводит партию до концовки и открывает экран финала', async () => {
    const { session, ui } = await build();
    const report = await session.autoplay({ choice: 'last', minigame: 'fail' });
    expect(report.ending).not.toBeNull();
    expect(report.truncated).toBe(false);
    expect(report.minigames.length).toBeGreaterThan(0);
    // Цикл возобновляется на ожидании end — экран финала показывается.
    for (let i = 0; i < 100 && ui.endings.length === 0; i++) await new Promise((r) => setTimeout(r, 0));
    expect(ui.endings).toHaveLength(1);
    expect(ui.endings[0]?.ending).toBe(report.ending);
  });
});

describe('Session: дедуктивная развилка', () => {
  it('неверный ход: автосейв со счётчиками, телеметрия с вердиктом и числом ошибок; откат в реакцию их сохраняет; журнал с fails', async () => {
    const answers: Record<string, string[]> = { c0: ['skip'], d1: ['w1', 'r'] };
    const { session, ui, platform, saves } = await build({
      episode: deductionEpisode(),
      ui: {
        manualLines: true,
        // Первый ответ, доступный сейчас: испробованный w1 после возврата к вопросу погашен — дальше r.
        choose: (p) => (answers[p.id] ?? []).find((id) => p.options.some((o) => o.id === id && o.enabled)) ?? '',
      },
    });
    const done = session.newGame();
    await ui.untilLines(1);
    expect(ui.lines[0]?.p.key).toBe('k.q_intro');
    ui.releaseLatest();
    await ui.untilLines(2); // w1 → сцена-реакция
    expect(ui.lines[1]?.p.key).toBe('k.no1');
    expect(session.interp.state.deductions).toEqual({ d1: { fails: 1, tried: ['w1'] } });
    expect(saves.autosave?.state.deductions).toEqual({ d1: { fails: 1, tried: ['w1'] } });
    expect(saves.autosave?.state.scene_id).toBe('s_w1');
    expect(platform.tracked.filter((x) => x.event === 'choice').map((x) => x.data)).toEqual([
      { id: 'c0', option: 'skip' },
      { id: 'd1', option: 'w1', verdict: 'wrong', fails: 1 },
    ]);
    ui.releaseLatest();
    await ui.untilLines(3); // jump обратно к вопросу

    const rolled = session.rollback(); // на реплику назад — в реакцию: счётчики и nerves те же
    expect(rolled).not.toBeNull();
    expect(await done).toEqual({ reason: 'cancelled' });
    await ui.untilLines(4);
    expect(ui.lines[3]?.p.key).toBe('k.no1');
    expect(session.interp.state.deductions).toEqual({ d1: { fails: 1, tried: ['w1'] } });
    expect(session.interp.state.vars.nerves).toBe(4);
    ui.releaseLatest();
    await ui.untilLines(5);
    ui.releaseLatest(); // вопрос: w1 погашена — UI берёт r
    await ui.untilLines(6);
    expect(ui.lines[5]?.p.key).toBe('k.ok');
    ui.releaseLatest();
    expect(await rolled).toMatchObject({ reason: 'ended', ending: { id: 'e_main' } });
    expect(ui.choices.map((c) => `${c.id}=${c.option}`)).toEqual(['c0=skip', 'd1=w1', 'd1=r']);
    expect(ui.endings[0]?.state.journal).toEqual([{ choice: 'd1', option: 'r', scene: 's_q', kind: 'deduction', prompt_key: 'k.q', key: 'k.r', fails: 1 }]);
    expect(platform.tracked.filter((x) => x.event === 'choice').at(-1)?.data).toEqual({ id: 'd1', option: 'r', verdict: 'right', fails: 1 });
  });
});

describe('foundOf: находки осмотра из итогового состояния мини-игры', () => {
  it('берёт список строк found, всё остальное — нет списка', () => {
    expect(foundOf({ found: ['photo', 'glasses'], misses: 1 })).toEqual(['photo', 'glasses']);
    expect(foundOf({ found: [] })).toEqual([]);
    expect(foundOf(undefined)).toBeUndefined();
    expect(foundOf(null)).toBeUndefined();
    expect(foundOf({ found: [1, 2] })).toBeUndefined();
    expect(foundOf({ marks: ['x'] })).toBeUndefined();
  });
});
