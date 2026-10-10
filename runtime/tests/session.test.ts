/**
 * Session: цикл партии без DOM на настоящем ep01 с заглушками UI/сцены/платформы.
 * Здесь же — порядок «погасить → реклама → continue() → проявить» на реальных границах блоков.
 */
import { describe, expect, it, vi } from 'vitest';
import { SaveManager } from '../src/core/saves';
import type { SaveFile } from '../src/core/saves';
import type { Episode } from '../src/core/types';
import { Session } from '../src/session';
import { Director } from '../src/stage/director';
import { EP01_PATH, hasRepoContent, loadEpisode } from './helpers/content';
import { FakeAudio, FakeCaptions, FakePlatform, FakeStage, FakeToasts, FakeUI } from './helpers/fakes';
import type { FakeUIOptions, Timeline } from './helpers/fakes';

const run = hasRepoContent() ? describe : describe.skip;

/** Путь канонической концовки ep01: проверять нотариуса, ждать, брать порознь, мини-игры успешно. */
const CANON: FakeUIOptions = {
  choose: (p) => (p.id === 'c_who' ? 'notary' : p.id === 'c_take' ? 'wait' : (p.options.find((o) => o.enabled)?.id ?? '')),
};

async function build(opts: { ui?: FakeUIOptions; episode?: Episode; platform?: FakePlatform } = {}) {
  const episode = opts.episode ?? loadEpisode(EP01_PATH);
  const t: Timeline = [];
  const platform = opts.platform ?? new FakePlatform(t);
  const saves = new SaveManager(platform, { slots: platform.capabilities.manualSlots, debounceMs: 0 });
  await saves.init();
  const ui = new FakeUI(t, { ...CANON, ...opts.ui });
  const warnings: string[] = [];
  let session!: Session;
  const director = new Director({
    stage: new FakeStage(t),
    audio: new FakeAudio(t),
    captions: new FakeCaptions(t),
    toasts: new FakeToasts(t),
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

run('Session на ep01', () => {
  it('проходит эпизод до концовки: реплики, выборы, мини-игры, финал, события платформы', async () => {
    const { session, ui, platform, ended, saves, episode } = await build();
    const outcome = await session.newGame();
    expect(outcome).toMatchObject({ reason: 'ended', ending: { id: 'e_canon' } });
    expect(ended).toEqual(['e_canon']);
    expect(ui.endings).toHaveLength(1);
    expect(ui.endings[0]?.journal).toBeGreaterThan(0);
    expect(ui.choices.map((c) => c.id)).toEqual(['c_start', 'c_who', 'c_take']);
    expect(ui.minigames.map((m) => m.id)).toEqual(['mg_scene', 'mg_docs', 'mg_db', 'mg_board', 'mg_interrogation']);
    const events = platform.tracked.map((x) => x.event);
    expect(events[0]).toBe('level_started');
    expect(platform.tracked[0]?.data).toEqual({ world: 's1', level: 'ep01' });
    expect(events).toContain('level_completed');
    expect(events).toContain('ending_reached');
    expect(events.filter((e) => e === 'minigame_finish')).toHaveLength(5);
    // Итоги записаны в профиль, автосейв после финала очищен.
    expect(saves.profile.endings[episode.id]).toEqual(['e_canon']);
    expect(saves.progress.autosave).toBeNull();
    expect(saves.archiveOf(episode.id)).toContain('arc_newspaper');
  });

  it('реклама только на границах блоков с ad_break_allowed: title, interlude, epilogue', async () => {
    const { session, platform } = await build();
    await session.newGame();
    expect(platform.ads).toBe(3);
    expect(platform.tracked.filter((x) => x.event === 'ad_break').map((x) => x.data?.block)).toEqual([
      'b02_title',
      'b09_interlude',
      'b14_epilogue',
    ]);
  });

  it('на каждой рекламной границе: гашение → реклама → continue() → проявление; новая сцена до рекламы не показывается', async () => {
    const { session, t } = await build();
    // Следим за continue() интерпретатора, чтобы доказать, что проявление идёт после него.
    const original = session.interp.continue.bind(session.interp);
    vi.spyOn(session.interp, 'continue').mockImplementation(() => {
      t.push('interp:continue');
      original();
    });
    await session.newGame();

    const boundaries: Array<[scene: string, hold: string, reveal: string]> = [
      ['s02', 'stage:fadeToBlackAndHold:vhs_glitch', 'stage:revealFromBlack:s02:vhs_glitch'],
      ['s13', 'stage:fadeToBlackAndHold:fade', 'stage:revealFromBlack:s13:fade'],
      ['s20', 'stage:fadeToBlackAndHold:slow_fade', 'stage:revealFromBlack:s20:slow_fade'],
    ];
    for (const [scene, hold, reveal] of boundaries) {
      const iHold = t.indexOf(hold);
      const iAdStart = t.indexOf('ad:start', iHold);
      const iAdEnd = t.indexOf('ad:end', iAdStart);
      const iContinue = t.indexOf('interp:continue', iAdEnd);
      const iReveal = t.indexOf(reveal);
      expect(iHold, `${scene}: гашение`).toBeGreaterThanOrEqual(0);
      expect(iAdStart, `${scene}: старт рекламы после гашения`).toBeGreaterThan(iHold);
      expect(iAdEnd).toBeGreaterThan(iAdStart);
      expect(iContinue, `${scene}: continue() после рекламы`).toBeGreaterThan(iAdEnd);
      expect(iReveal, `${scene}: проявление только после continue()`).toBeGreaterThan(iContinue);
      expect(t.some((e) => e.startsWith(`stage:changeScene:${scene}:`)), `${scene}: обычного перехода нет`).toBe(false);
      // Между гашением и проявлением на сцену ничего не рисуется.
      const between = t.slice(iHold + 1, iReveal).filter((e) => e.startsWith('stage:') && !e.startsWith('stage:fadeToBlackAndHold'));
      expect(between, `${scene}: сцена молчит во время рекламы`).toEqual([]);
    }
  });

  it('если реклама не показалась (web-plain, лимит частоты), экран всё равно проявляется после continue()', async () => {
    const t: Timeline = [];
    const platform = new FakePlatform(t, () => Promise.resolve(false));
    const { session } = await build({ platform });
    const outcome = await session.newGame();
    expect(outcome.reason).toBe('ended');
    expect(platform.tracked.filter((x) => x.event === 'ad_break').every((x) => x.data?.shown === false)).toBe(true);
  });

  it('автосейвы на границах блоков и после выборов; каждый из них возобновляется до той же концовки', async () => {
    const first = await build();
    const files: SaveFile[] = [];
    const spy = vi.spyOn(first.saves, 'writeAutosave').mockImplementation((f) => {
      files.push(JSON.parse(JSON.stringify(f)) as SaveFile);
    });
    const baseline = await first.session.newGame();
    expect(baseline).toMatchObject({ reason: 'ended', ending: { id: 'e_canon' } });
    spy.mockRestore();

    // 14 блоков (часть пропущена веткой) + 3 выбора + 5 мини-игр.
    expect(files.length).toBeGreaterThanOrEqual(14);
    for (const f of files) {
      expect(f.schema_version).toBe(1);
      expect(f.content_version).toBe('test@1');
      expect(f.state.episode_id).toBe('ep01_murylev');
      expect(f.view?.scene).toBe(f.state.scene_id);
    }

    // Загрузка любого из автосейвов и прохождение теми же политиками даёт ту же концовку и тот же журнал.
    for (const f of files) {
      const again = await build();
      const outcome = await again.session.loadSave(f);
      expect(outcome, `сейв в сцене ${f.state.scene_id}`).toMatchObject({ reason: 'ended', ending: { id: 'e_canon' } });
      expect(again.ui.endings[0]?.state.journal.map((j) => j.option)).toEqual(
        first.ui.endings[0]?.state.journal.map((j) => j.option),
      );
    }
  });

  it('загрузка не дублирует рекламу и не вызывает level_started', async () => {
    const first = await build();
    const files: SaveFile[] = [];
    vi.spyOn(first.saves, 'writeAutosave').mockImplementation((f) => {
      files.push(JSON.parse(JSON.stringify(f)) as SaveFile);
    });
    await first.session.newGame();
    const late = files.find((f) => f.state.scene_id === 's20') ?? files[files.length - 1];
    expect(late).toBeDefined();
    const again = await build();
    await again.session.loadSave(late as SaveFile);
    expect(again.platform.tracked.some((x) => x.event === 'level_started')).toBe(false);
    expect(again.platform.ads).toBe(0);
  });

  it('прочитанное запоминается: на втором проходе реплики приходят с read=true', async () => {
    const { session, ui } = await build();
    await session.newGame();
    expect(ui.lines.every((l) => !l.read)).toBe(true);
    const count = ui.lines.length;
    await session.newGame();
    expect(ui.lines.slice(count).every((l) => l.read)).toBe(true);
    expect(ui.lines.length).toBe(count * 2);
  });

  it('журнал реплик (backlog) копится по порядку показа', async () => {
    const { session } = await build();
    await session.newGame();
    expect(session.log[0]).toMatchObject({ kind: 'narrate', key: 'ep01.s01.l001', who: null });
    expect(session.log[1]).toMatchObject({ kind: 'say', key: 'ep01.s01.l002', who: 'neighbor' });
    expect(session.log.length).toBeGreaterThan(30);
  });

  it('политики UI: выбор и исход мини-игры проходят до интерпретатора', async () => {
    const { session, ui } = await build({
      ui: {
        choose: (p) => (p.id === 'c_who' ? 'buyer' : (p.options.find((o) => o.enabled)?.id ?? '')),
        minigame: () => 'fail',
      },
    });
    const outcome = await session.newGame();
    expect(outcome.reason).toBe('ended');
    expect(ui.choices.map((c) => `${c.id}=${c.option}`)).toContain('c_who=buyer');
    expect(ui.choices.map((c) => c.id)).toContain('c_buyer'); // ветка с покупателем
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
      state: { episode_id: 'other', scene_id: 's01', step_index: 0, vars: {}, globals: {}, archive: [], journal: [] },
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
    const t: Timeline = [];
    const first = await build();
    // Остановимся на мини-игре mg_docs: UI мини-игры «висит», пока тест не завершит её.
    let finishMg: ((r: 'success') => void) | null = null;
    first.ui.runMinigame = (p, ctx) => {
      first.ui.minigames.push({ id: p.def.id, restore: ctx.restore });
      if (p.def.id !== 'mg_docs') return Promise.resolve('success');
      first.ui.activeMinigame = { id: 'mg_docs', state: { marked: ['date'] } };
      ctx.autosave();
      return new Promise((resolve) => {
        finishMg = resolve;
      });
    };
    void first.session.newGame();
    for (let i = 0; i < 200 && !finishMg; i++) await new Promise((r) => setTimeout(r, 0));
    const file = first.saves.autosave;
    expect(file?.mg).toEqual({ id: 'mg_docs', state: { marked: ['date'] } });
    expect(file?.state.scene_id).toBe('s07');
    first.session.cancel();

    const again = await build();
    const outcome = await again.session.loadSave(file as SaveFile);
    expect(outcome.reason).toBe('ended');
    expect(again.ui.minigames[0]).toEqual({ id: 'mg_docs', restore: { marked: ['date'] } });
    void t;
  });
});

run('Session: автопилот', () => {
  it('autoplay доводит партию до концовки и открывает экран финала', async () => {
    const { session, ui } = await build();
    const report = await session.autoplay({ choice: 'last', minigame: 'fail' });
    expect(report.ending).not.toBeNull();
    expect(report.truncated).toBe(false);
    expect(report.minigames).toHaveLength(5);
    // Цикл возобновляется на ожидании end — экран финала показывается.
    for (let i = 0; i < 100 && ui.endings.length === 0; i++) await new Promise((r) => setTimeout(r, 0));
    expect(ui.endings).toHaveLength(1);
    expect(ui.endings[0]?.ending).toBe(report.ending);
  });
});
