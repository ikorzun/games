// @vitest-environment jsdom
/**
 * Озвучка реплик «насквозь»: настоящие Session → DomUI → LineVoice → AudioManager → HtmlAudioBackend на поддельных
 * аудио-элементах и поддельном времени. Проверяется путь «ключ реплики → адрес клипа → элемент <audio>», приоритет
 * поля `voice`, авто-режим (конец клипа + 300 мс), выключенная озвучка, пустой индекс, и что откат, загрузка сейва,
 * Skip прочитанного и выход в меню обрывают клип.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../src/core/i18n';
import { SaveManager } from '../src/core/saves';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import type { Settings } from '../src/core/settings';
import type { Episode } from '../src/core/types';
import { VoiceIndex } from '../src/core/voice';
import type { VoiceIndexData } from '../src/core/voice';
import { Session } from '../src/session';
import { joinUrl } from '../src/stage/assets';
import { AudioManager } from '../src/stage/audio';
import { HtmlAudioBackend, SFX_POOL } from '../src/stage/audio_html';
import { Director } from '../src/stage/director';
import type { Stage } from '../src/stage/stage';
import { LineVoice } from '../src/stage/voice';
import { CaptionLayer } from '../src/ui/captions';
import { AUTO_VOICE_TAIL_MS, DomUI } from '../src/ui/dom_ui';
import { UiKit } from '../src/ui/kit';
import { FakeEl } from './helpers/audio_fakes';
import { FakeAudio, FakeCaptions, FakePlatform, FakeStage } from './helpers/fakes';
import type { Timeline } from './helpers/fakes';
import { miniEpisode } from './helpers/mini';

const FAKE = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] as const;

const K1 = 'ep01.s01.l001';
const K2 = 'ep01.s01.l002';
const K3 = 'ep01.s01.l003';
const P = (lang: string, id: string, ext = 'mp3'): string => `./assets/ep01/voice/${lang}/${id}.${ext}`;

/** id «ep01_test» → папка ассетов «ep01», как у настоящего ep01_murylev. */
function episode(): Episode {
  const ep = miniEpisode({
    s1: {
      steps: [
        { do: 'narrate', key: K1 },
        { do: 'say', who: 'a', key: K2 },
        { do: 'narrate', key: K3, style: 'inner', voice: 'take_two' },
        { do: 'end', ending: 'e_main' },
      ],
    },
  });
  return { ...ep, id: 'ep01_test' };
}

interface Rig {
  session: Session;
  ui: DomUI;
  audio: AudioManager;
  voiceEl: FakeEl;
  els: FakeEl[];
  settings: Settings;
  warns: string[];
  saves: SaveManager;
}
const rigs: Rig[] = [];

async function makeRig(files: VoiceIndexData['episodes'], over: Partial<Settings> = {}): Promise<Rig> {
  const ep = episode();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const kit = new UiKit(root, () => undefined);
  const captionsHost = document.createElement('div');
  kit.main.appendChild(captionsHost);
  const stage = { minigameRoot: {}, playFx: () => Promise.resolve(), setMinigameActive: () => undefined, setFocus: () => undefined } as unknown as Stage;
  const settings: Settings = { ...DEFAULT_SETTINGS, textSpeed: 5, autoDelayMs: 500, ...over };

  const els: FakeEl[] = [];
  const warns: string[] = [];
  const backend = new HtmlAudioBackend(() => null, {
    createElement: () => {
      const e = new FakeEl();
      els.push(e);
      return e;
    },
    warn: (m) => warns.push(m),
  });
  const voiceEl = els[4 + SFX_POOL]!; // порядок создания: музыка ×2, эмбиент ×2, sfx ×SFX_POOL, озвучка
  const audio = new AudioManager(backend);
  audio.setVoiceEnabled(settings.voiceEnabled);
  audio.setVolumes({ music: settings.music, sfx: settings.sfx, voice: settings.voice });
  const voice = new LineVoice({ episode: ep, index: VoiceIndex.parse({ version: 1, episodes: files }), url: (p) => joinUrl('./', p), lang: () => i18n.lang, output: audio });

  const t: Timeline = [];
  const platform = new FakePlatform(t);
  const saves = new SaveManager(platform, { slots: 3, debounceMs: 0 });
  await saves.init();
  let session!: Session;
  const ui = new DomUI({
    episode: ep,
    kit,
    stage,
    captions: new CaptionLayer(captionsHost),
    platform,
    settings: () => settings,
    view: () => (session.interp.started ? session.interp.view : null),
    env: () => ({}),
    onOpenArchive: () => undefined,
    onAction: () => undefined,
    onRollback: () => void session.rollback(1),
    voice,
  });
  const director = new Director({
    stage: new FakeStage(t),
    audio: new FakeAudio(t),
    captions: new FakeCaptions(t),
    checkpoint: () => undefined,
  });
  session = new Session({ episode: ep, contentVersion: 'test@1', platform, saves, ui, director, warn: () => undefined });
  const rig: Rig = { session, ui, audio, voiceEl, els, settings, warns, saves };
  rigs.push(rig);
  return rig;
}

const tick = async (ms = 0): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: [...FAKE] });
  i18n.addStrings('ru', { [K1]: 'Первая', [K2]: 'Вторая', [K3]: 'Третья', 'mini.cast.a': 'Следователь', 'mini.end.main': 'Конец' });
  i18n.addStrings('en', { [K1]: 'First', [K2]: 'Second', [K3]: 'Third' });
  i18n.setLang('ru');
});

afterEach(() => {
  for (const r of rigs.splice(0)) {
    r.session.cancel();
    r.ui.dispose();
  }
  vi.useRealTimers();
  document.body.replaceChildren();
  i18n.setLang('ru');
});

const ALL_RU = { ep01: { ru: [`${K1}.mp3`, `${K2}.mp3`, `${K3}.mp3`, 'take_two.mp3'] } };

describe('озвучка: ключ реплики → клип → элемент <audio>', () => {
  it('реплика показана — на элементе озвучки src = assets/ep01/voice/ru/<ключ>.mp3; следующая реплика — следующий клип', async () => {
    const { session, ui, voiceEl, audio } = await makeRig(ALL_RU);
    void session.newGame();
    await tick();
    expect(voiceEl.src).toBe(P('ru', K1));
    expect(voiceEl.plays).toBe(1);
    expect(voiceEl.loop).toBe(false);
    expect(audio.voicePlaying).toBe(P('ru', K1));
    expect(voiceEl.volume).toBeCloseTo(0.9, 9); // громкость озвучки по умолчанию
    ui.advance();
    await tick();
    expect(voiceEl.src).toBe(P('ru', K2));
    expect(voiceEl.plays).toBe(2);
  });

  it('явное поле voice имеет приоритет над ключом: клип с этим id в той же папке', async () => {
    const { session, ui, voiceEl } = await makeRig(ALL_RU);
    void session.newGame();
    await tick();
    ui.advance();
    await tick();
    ui.advance();
    await tick();
    expect(voiceEl.src).toBe(P('ru', 'take_two')); // у третьей реплики voice: take_two, а клип по ключу K3 тоже есть
    expect(voiceEl.srcHistory.filter((s) => s.includes(K3))).toEqual([]);
  });

  it('явного клипа в индексе нет — играет клип по ключу; нет и его — реплика немая, элемент не тронут', async () => {
    const { session, ui, voiceEl } = await makeRig({ ep01: { ru: [`${K1}.mp3`, `${K3}.mp3`] } });
    void session.newGame();
    await tick();
    ui.advance(); // K2: клипа нет
    await tick();
    expect(voiceEl.plays).toBe(1);
    expect(voiceEl.src).toBe(''); // клип K1 остановлен при листании, нового нет
    ui.advance(); // K3: voice take_two нет в индексе → клип по ключу
    await tick();
    expect(voiceEl.src).toBe(P('ru', K3));
  });

  it('язык берётся текущий: на en играет en-клип, если его нет — тишина (русский голос под английский текст не подставляется)', async () => {
    const { session, ui, voiceEl } = await makeRig({ ep01: { ru: [`${K1}.mp3`, `${K2}.mp3`], en: [`${K1}.mp3`] } });
    i18n.setLang('en');
    void session.newGame();
    await tick();
    expect(voiceEl.src).toBe(P('en', K1));
    ui.advance();
    await tick();
    expect(voiceEl.src).toBe(''); // en-клипа для K2 нет
    expect(voiceEl.srcHistory).toEqual([P('en', K1)]);
  });

  it('испанский текст — под английскую озвучку (владелец 2026-10-15): на es играет en-клип, русский не подставляется', async () => {
    const { session, voiceEl } = await makeRig({ ep01: { ru: [`${K1}.mp3`, `${K2}.mp3`], en: [`${K1}.mp3`] } });
    i18n.setLang('es');
    void session.newGame();
    await tick();
    expect(voiceEl.src).toBe(P('en', K1));
  });

  it('папка по полному id эпизода (assets/ep01_test/voice/…) тоже принимается', async () => {
    const { session, voiceEl } = await makeRig({ ep01_test: { ru: [`${K1}.mp3`] } });
    void session.newGame();
    await tick();
    expect(voiceEl.src).toBe('./assets/ep01_test/voice/ru/ep01.s01.l001.mp3');
  });
});

describe('озвучка: авто-режим', () => {
  it('ждёт конец клипа + 300 мс, потом листает; пауза по тексту (500 мс) при этом не используется', async () => {
    const { session, ui, voiceEl } = await makeRig(ALL_RU);
    ui.toggleAuto();
    void session.newGame();
    await tick();
    expect(voiceEl.src).toBe(P('ru', K1));
    await tick(4000); // реплика по тексту давно прочитана, клип ещё звучит
    expect(voiceEl.src).toBe(P('ru', K1));
    voiceEl.fire('ended'); // клип доиграл (в 4000 мс)
    await tick(AUTO_VOICE_TAIL_MS - 1);
    expect(voiceEl.src).toBe(''); // клип снят, но следующая реплика ещё не показана
    expect(voiceEl.plays).toBe(1);
    await tick(1);
    expect(voiceEl.src).toBe(P('ru', K2)); // +300 мс — следующая реплика и её клип
    expect(voiceEl.plays).toBe(2);
  });

  it('клипа нет — авто-режим как раньше: пауза по длине текста', async () => {
    const { session, ui, voiceEl } = await makeRig({});
    ui.toggleAuto();
    void session.newGame();
    await tick();
    expect(session.log).toHaveLength(1);
    await tick(500 + 20 * 6 - 1);
    expect(session.log).toHaveLength(1);
    await tick(1);
    expect(session.log).toHaveLength(2);
    expect(voiceEl.plays).toBe(0);
  });

  it('клип не прочитался (error элемента) — один warn и авто-режим переходит на паузу по тексту', async () => {
    const { session, ui, voiceEl, warns } = await makeRig(ALL_RU);
    ui.toggleAuto();
    void session.newGame();
    await tick(1000);
    expect(session.log).toHaveLength(1); // ждём клип
    voiceEl.fire('error');
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(P('ru', K1));
    await tick(500 + 20 * 6);
    expect(session.log).toHaveLength(2);
  });
});

describe('озвучка: выключена, без звука, без клипов', () => {
  it('voiceEnabled = false — клипы не запускаются, элемент не тронут, авто-режим идёт по тексту', async () => {
    const { session, ui, voiceEl, audio } = await makeRig(ALL_RU, { voiceEnabled: false });
    ui.toggleAuto();
    void session.newGame();
    await tick();
    expect(audio.voiceEnabled).toBe(false);
    expect(voiceEl.plays).toBe(0);
    expect(voiceEl.srcHistory).toEqual([]);
    await tick(500 + 20 * 6);
    expect(session.log).toHaveLength(2);
    expect(voiceEl.plays).toBe(0);
  });

  it('озвучку выключили посреди клипа — клип обрывается; включили — со следующей реплики играет снова', async () => {
    const { session, ui, voiceEl, audio } = await makeRig(ALL_RU);
    void session.newGame();
    await tick();
    expect(audio.voicePlaying).toBe(P('ru', K1));
    audio.setVoiceEnabled(false);
    expect(audio.voicePlaying).toBeNull();
    expect(voiceEl.paused).toBe(true);
    audio.setVoiceEnabled(true);
    ui.advance();
    await tick();
    expect(audio.voicePlaying).toBe(P('ru', K2));
  });

  it('Mute игрока и нулевая громкость озвучки: клипы не запускаются', async () => {
    const muted = await makeRig(ALL_RU);
    muted.audio.setMuted(true);
    void muted.session.newGame();
    await tick();
    expect(muted.voiceEl.plays).toBe(0);
    const silent = await makeRig(ALL_RU, { voice: 0 });
    void silent.session.newGame();
    await tick();
    expect(silent.voiceEl.plays).toBe(0);
  });

  it('пустой индекс клипов: эпизод проходится автопилотом интерфейса, звук не трогается, предупреждений нет', async () => {
    const { session, ui, voiceEl, els, warns } = await makeRig({});
    ui.toggleAuto();
    const run = session.newGame();
    await tick(10_000);
    expect(session.log).toHaveLength(3);
    expect(voiceEl.plays).toBe(0);
    expect(voiceEl.srcHistory).toEqual([]);
    expect(els.every((e) => e.plays === 0)).toBe(true);
    expect(warns).toEqual([]);
    session.cancel();
    await run;
  });
});

describe('озвучка: откат, загрузка, Skip, меню', () => {
  it('откат: клип текущей реплики обрывается, прежняя реплика показана заново — её клип играет с начала', async () => {
    const { session, ui, voiceEl, audio } = await makeRig(ALL_RU);
    void session.newGame();
    await tick();
    ui.advance();
    await tick();
    expect(audio.voicePlaying).toBe(P('ru', K2));
    session.rollback(1);
    await tick();
    expect(audio.voicePlaying).toBe(P('ru', K1));
    expect(voiceEl.srcHistory).toEqual([P('ru', K1), P('ru', K2), P('ru', K1)]);
  });

  it('загрузка сейва: клип прежней реплики обрывается; показанная из сейва реплика озвучивается своим клипом', async () => {
    const { session, ui, voiceEl, audio } = await makeRig(ALL_RU);
    void session.newGame();
    await tick();
    ui.advance();
    await tick();
    const file = session.makeSaveFile(); // сейв на K2
    ui.advance();
    await tick();
    expect(audio.voicePlaying).toBe(P('ru', 'take_two'));
    void session.loadSave(file);
    await tick();
    expect(audio.voicePlaying).toBe(P('ru', K2));
    expect(voiceEl.srcHistory.at(-2)).toBe(P('ru', 'take_two'));
  });

  it('выход в меню (Session.cancel) обрывает клип и ничего не запускает', async () => {
    const { session, voiceEl, audio } = await makeRig(ALL_RU);
    void session.newGame();
    await tick();
    expect(audio.voicePlaying).not.toBeNull();
    session.cancel();
    expect(audio.voicePlaying).toBeNull();
    expect(voiceEl.paused).toBe(true);
    const plays = voiceEl.plays;
    await tick(10_000);
    expect(voiceEl.plays).toBe(plays);
  });

  it('Skip прочитанного: прочитанные реплики пролистываются без звука; клип обрывается, а новый не запускается', async () => {
    const { session, ui, voiceEl, audio, saves } = await makeRig(ALL_RU);
    void session.newGame();
    await tick();
    ui.advance();
    await tick();
    ui.advance();
    await tick();
    ui.advance(); // эпизод пройден: реплики K1–K3 прочитаны
    await tick();
    session.cancel();
    expect(saves.isRead('ep01_test', K1)).toBe(true);
    const plays = voiceEl.plays;
    void session.newGame(); // старт партии выключает Skip (ui.reset), поэтому включаем его после
    ui.setSkip(true);
    await tick(2000);
    expect(voiceEl.plays).toBe(plays); // ни одного нового клипа
    expect(audio.voicePlaying).toBeNull();
    expect(session.log.length).toBe(3); // реплики пролистаны
  });

  it('Skip включили на звучащей прочитанной реплике — клип обрывается, реплика пролистывается', async () => {
    const { session, ui, audio, saves } = await makeRig(ALL_RU);
    for (const k of [K1, K2, K3]) saves.markRead('ep01_test', k);
    void session.newGame();
    await tick();
    expect(audio.voicePlaying).toBe(P('ru', K1));
    ui.toggleSkip();
    await tick(200);
    expect(audio.voicePlaying).toBeNull();
    expect(session.log.length).toBe(3);
  });

  it('Skip дошёл до непрочитанной реплики и остановился: клип прочитанной оборван, у непрочитанной звучит свой', async () => {
    const { session, ui, audio, saves } = await makeRig(ALL_RU);
    saves.markRead('ep01_test', K1); // K2 ещё не читали
    void session.newGame();
    await tick();
    ui.toggleSkip();
    await tick(200);
    expect(ui.skipOn).toBe(false);
    expect(audio.voicePlaying).toBe(P('ru', K2));
  });
});
