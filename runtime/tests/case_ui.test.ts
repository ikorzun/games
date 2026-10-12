// @vitest-environment jsdom
/**
 * Режим дела в интерфейсе: разговор играет интерпретатор через Director и порт интерфейса (до конца и с отменой),
 * папка дела (задачи, ★, подозреваемые, приметы, улики), итог поиска и осмотр фото.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CaseDef } from '../src/case/case_def';
import { talkEpisode } from '../src/case/case_def';
import { CaseScreen, PhotoScreen, SearchResultScreen } from '../src/case/case_screen';
import type { CaseView } from '../src/case/case_screen';
import { completeTask, emptyProgress } from '../src/case/case_state';
import { playTalk } from '../src/case/case_talk';
import { i18n } from '../src/core/i18n';
import type { ViewState } from '../src/core/types';
import { Director } from '../src/stage/director';
import { FakeAudio, FakeCaptions, FakeStage, FakeToasts, FakeUI } from './helpers/fakes';
import type { Timeline } from './helpers/fakes';
import { miniEpisode } from './helpers/mini';

const DEF: CaseDef = {
  schema_version: 1,
  episode: 'mini',
  title_key: 'c.title',
  traits: [
    { id: 'volga', label_key: 'tr.volga' },
    { id: 'keys', label_key: 'tr.keys' },
  ],
  suspects: [
    { id: 'lapin', name_key: 's.lapin', who: 'buyer', note_key: 's.lapin.note' },
    { id: 'mur', name_key: 's.mur', note_key: 's.mur.note' },
  ],
  clues: [{ id: 'photo', label_key: 'c.photo' }],
  facts: [{ id: 'f1', suspect: 'mur', text_key: 'f.f1' }],
  scenes: {
    flat: {
      bg: 'bg_a',
      title_key: 'sc.flat',
      brief_key: 'sc.brief',
      pick: 3,
      time_limit_ms: 120000,
      star_time_ms: 60000,
      star_misses: 2,
      items: [{ id: 'photo', rect: [0.2, 0.3, 0.05, 0.1], label_key: 'i.photo', clue: 'photo' }],
    },
  },
  talks: {
    t1: {
      stage: { bg: 'bg_a' },
      steps: [
        { do: 'say', who: 'a', key: 'l.1' },
        { do: 'say', who: 'a', key: 'l.2' },
      ],
    },
  },
  chapters: [
    {
      id: 'ch1',
      title_key: 'ch.1',
      summary_key: 'ch.1.sum',
      tasks: [
        { id: 'search', kind: 'search', title_key: 'task.search', cost: 0, requires: [], scene: 'flat', gives: { clues: ['photo'] } },
        { id: 'talk', kind: 'talk', title_key: 'task.talk', cost: 1, requires: ['search'], talk: 't1', gives: { suspects: ['lapin', 'mur'], traits: ['volga'], facts: ['f1'] } },
        { id: 'later', kind: 'talk', title_key: 'task.later', cost: 1, requires: ['talk'], talk: 't1' },
      ],
    },
    { id: 'ch2', title_key: 'ch.2', locked: true, tasks: [] },
  ],
};

const EP = miniEpisode({ s1: { steps: [{ do: 'end', ending: 'e1' }] } });
EP.assets = { ...EP.assets, sprites: [{ id: 'buyer', base: 'assets/sprites/buyer.webp', expressions: ['neutral'] }] } as typeof EP.assets;

i18n.addStrings('ru', {
  'ui.case.tasks': 'Задачи',
  'ui.case.suspects': 'Подозреваемые',
  'ui.case.traits': 'Приметы',
  'ui.case.clues': 'Улики',
  'ui.case.stars': 'Звёзды: {n}',
  'ui.case.free': 'Бесплатно',
  'ui.case.need_stars': 'Не хватает ★',
  'ui.case.replay': 'Искать снова',
  'ui.case.unknown_trait': 'Не установлено',
  'ui.case.no_face': 'Лицо неизвестно',
  'ui.case.progress': '{n} из {total}',
  'ui.case.result.time': 'Быстрее {time}',
  'ui.case.result.misses': 'Промахов не больше {n}',
  'ui.case.result.earned': '+{n} ★',
  'ui.case.photo.flip': 'Перевернуть',
  'ui.common.next': 'Далее',
  'tr.volga': 'Серая «Волга»',
  's.lapin': 'Лапин',
  's.mur': 'Мурашов',
  'f.f1': 'Галина: Сергей',
  'b.back': 'Бабушке от внука',
});
i18n.setLang('ru');

afterEach(() => {
  document.body.replaceChildren();
});

describe('разговор дела', () => {
  function rigTalk(): { ui: FakeUI; director: Director; t: Timeline; views: Array<(() => ViewState) | null> } {
    const t: Timeline = [];
    const ui = new FakeUI(t, { manualLines: true });
    const director = new Director({ stage: new FakeStage(t), audio: new FakeAudio(t), captions: new FakeCaptions(t), toasts: new FakeToasts(t), checkpoint: () => t.push('checkpoint') });
    return { ui, director, t, views: [] };
  }

  it('играется до служебной концовки: реплики по одной, без чекпоинтов, кадр отдаётся текстовому окну и снимается', async () => {
    const r = rigTalk();
    const ac = new AbortController();
    const done = playTalk(talkEpisode(EP, DEF, 't1'), { director: r.director, ui: r.ui, signal: ac.signal, setView: (v) => r.views.push(v) });
    await r.ui.untilLines(1);
    expect(r.views[0]?.()?.scene).toBe('case_t1');
    r.ui.releaseLatest();
    await r.ui.untilLines(2);
    r.ui.releaseLatest();
    await expect(done).resolves.toBe(true);
    expect(r.ui.lines.map((l) => l.p.key)).toEqual(['l.1', 'l.2']);
    expect(r.t).not.toContain('checkpoint');
    expect(r.ui.endings).toHaveLength(0);
    expect(r.views.at(-1)).toBeNull();
  });

  it('отмена (выход в меню) обрывает ожидание реплики', async () => {
    const r = rigTalk();
    const ac = new AbortController();
    const done = playTalk(talkEpisode(EP, DEF, 't1'), { director: r.director, ui: r.ui, signal: ac.signal, setView: () => undefined });
    await r.ui.untilLines(1);
    ac.abort();
    await expect(done).resolves.toBe(false);
  });
});

describe('папка дела', () => {
  const view = (progress = emptyProgress(), storyOnly = false): CaseView => ({ def: DEF, episode: EP, progress, storyOnly, url: (p) => `/x/${p}` });

  function render(v: CaseView, on: Partial<{ task: string[]; replay: string[]; menu: number }> = {}): CaseScreen {
    const s = new CaseScreen({
      view: () => v,
      onTask: (t) => on.task?.push(t.id),
      onReplay: (t) => on.replay?.push(t.id),
      onMenu: () => (on.menu = (on.menu ?? 0) + 1),
    });
    document.body.appendChild(s.el);
    s.render();
    return s;
  }

  it('в начале: видна только стартовая задача, ★ 0, приметы неизвестны, подозреваемых нет', () => {
    const s = render(view());
    expect([...s.el.querySelectorAll('.vn-case__task')].map((e) => (e as HTMLElement).dataset.id)).toEqual(['search']);
    expect(s.el.querySelector('.vn-case__star-n')?.textContent).toBe('0');
    expect([...s.el.querySelectorAll('.vn-case__trait')].map((e) => e.textContent)).toEqual(['Не установлено', 'Не установлено']);
    expect(s.el.querySelector('.vn-case__suspect')).toBeNull();
    expect(s.el.querySelector('.vn-case__ch.is-locked')).not.toBeNull();
  });

  it('открытая задача по клику; без ★ — недоступна и с подсказкой; выполненный поиск — «Искать снова»', () => {
    const on = { task: [] as string[], replay: [] as string[] };
    const p = completeTask(emptyProgress(), DEF.chapters[0]!.tasks[0]!, false);
    const s = render(view(p), on);
    const talkBtn = s.el.querySelector<HTMLButtonElement>('[data-id="talk"] .vn-case__task-btn');
    expect(talkBtn?.disabled).toBe(true);
    expect(s.el.querySelector('[data-id="talk"] .vn-case__why')?.textContent).toBe('Не хватает ★');
    s.el.querySelector<HTMLButtonElement>('.vn-case__replay')?.click();
    expect(on.replay).toEqual(['search']);
    const rich = render(view({ ...p, stars: 2 }), on);
    rich.el.querySelector<HTMLButtonElement>('[data-id="talk"] .vn-case__task-btn')?.click();
    expect(on.task).toEqual(['talk']);
  });

  it('подозреваемые: портрет из спрайта или «лицо неизвестно»; запись и примета; новое подсвечено', () => {
    let p = { ...emptyProgress(), stars: 1 };
    for (const task of DEF.chapters[0]!.tasks.slice(0, 2)) p = completeTask(p, task, false);
    const s = render(view(p));
    const faces = [...s.el.querySelectorAll<HTMLElement>('.vn-case__face')];
    expect(faces[0]?.style.getPropertyValue('--face')).toContain('/x/assets/sprites/buyer.webp');
    expect(faces[1]?.classList.contains('is-unknown')).toBe(true);
    expect(faces[1]?.getAttribute('aria-label')).toBe('Лицо неизвестно');
    expect(s.el.querySelector('[data-id="mur"] .vn-case__fact')?.textContent).toBe('Галина: Сергей');
    expect(s.el.querySelector('.vn-case__trait.is-known')?.textContent).toBe('Серая «Волга»');
    expect(s.el.querySelectorAll('.vn-case__suspect.is-new')).toHaveLength(2);
  });

  it('итог поиска: три звезды и за что; осмотр фото: оборот по кнопке, затем «Далее»', () => {
    let closed = 0;
    const r = new SearchResultScreen({ titleKey: 'sc.flat', result: { all: true, fast: false, accurate: true, stars: 2 }, starTimeMs: 90000, starMisses: 3, best: 3, onDone: () => (closed += 1) });
    document.body.appendChild(r.el);
    r.render();
    expect(r.el.querySelector('.vn-case-result__stars')?.textContent).toBe('★★☆');
    expect([...r.el.querySelectorAll('.vn-case-result__row')].map((e) => e.classList.contains('is-ok'))).toEqual([true, false, true]);
    expect(r.el.textContent).toContain('Быстрее 1:30');
    r.el.querySelector<HTMLButtonElement>('.vn-btn.is-primary')?.click();
    expect(closed).toBe(1);

    const item = DEF.scenes.flat!.items[0]!;
    const ph = new PhotoScreen({ titleKey: 'task.photo', bgUrl: '/bg.webp', item, backKey: 'b.back', onDone: () => (closed += 1) });
    document.body.appendChild(ph.el);
    ph.render();
    expect(ph.el.querySelector<HTMLElement>('.vn-case-photo__front')?.style.backgroundImage).toContain('/bg.webp');
    ph.el.querySelector<HTMLButtonElement>('.vn-case-photo__flip')?.click();
    expect(ph.el.querySelector('.vn-case-photo__paper')?.classList.contains('is-back')).toBe(true);
    expect(ph.el.querySelector('.vn-case-photo__text')?.textContent).toBe('Бабушке от внука');
    ph.el.querySelector<HTMLButtonElement>('.vn-btn.is-primary')?.click();
    expect(closed).toBe(2);
  });
});
