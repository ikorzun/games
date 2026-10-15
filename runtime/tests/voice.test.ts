/**
 * Озвучка реплик, ядро: соглашение о файлах (ключ → путь клипа, приоритет явного поля `voice`), индекс клипов
 * (voice-index.json), политика персонажа и LineVoice — выбор клипа по реплике, языку и индексу.
 * Пустой индекс: ничего не запрашивается и ничего не ломается.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Lang } from '../src/core/types';
import {
  castVoicePolicies,
  clipIdsOf,
  episodeCode,
  parseClipFile,
  VOICE_EXTENSIONS,
  VOICE_INDEX_FILE,
  VoiceIndex,
  voiceAllowed,
  voiceFolders,
  voiceLangFor,
  voicePath,
} from '../src/core/voice';
import type { VoiceIndexData } from '../src/core/voice';
import { VoiceClip } from '../src/stage/audio';
import { joinUrl } from '../src/stage/assets';
import { LineVoice } from '../src/stage/voice';
import type { VoiceOutput } from '../src/stage/voice';
import { EP01_PATH, hasRepoContent, loadEpisode } from './helpers/content';
import { miniEpisode } from './helpers/mini';

const data = (episodes: VoiceIndexData['episodes']): VoiceIndexData => ({ version: 1, episodes });

describe('соглашение о файлах', () => {
  it('папка эпизода — первый сегмент id (как у остальных ассетов: assets/ep01/…); полный id тоже принимается', () => {
    expect(episodeCode('ep01_murylev')).toBe('ep01');
    expect(voiceFolders('ep01_murylev')).toEqual(['ep01', 'ep01_murylev']);
    expect(voiceFolders('ep02')).toEqual(['ep02']); // без «_» папка одна
    expect(VOICE_INDEX_FILE).toBe('voice-index.json');
  });

  it('assets/<эпизод>/voice/<язык>/<ключ>.<ext>', () => {
    expect(voicePath('ep01', 'ru', 'ep01.s12.l003', 'mp3')).toBe('assets/ep01/voice/ru/ep01.s12.l003.mp3');
    expect(voicePath('ep01', 'pt', 'take_two', 'ogg')).toBe('assets/ep01/voice/pt/take_two.ogg');
    expect([...VOICE_EXTENSIONS]).toEqual(['mp3', 'm4a', 'ogg']); // mp3 — канон, как эмбиент и эффекты
  });

  it('клип реплики: явное поле voice имеет приоритет над ключом; повтор не удваивается', () => {
    expect(clipIdsOf({ key: 'ep01.s12.l003', voice: null })).toEqual(['ep01.s12.l003']);
    expect(clipIdsOf({ key: 'ep01.s12.l003', voice: 'take_two' })).toEqual(['take_two', 'ep01.s12.l003']);
    expect(clipIdsOf({ key: 'x.y', voice: 'x.y' })).toEqual(['x.y']);
  });

  it('имя файла: ключ локализации или id + mp3 / m4a / ogg в нижнем регистре; остальное не по соглашению', () => {
    expect(parseClipFile('ep01.s12.l003.mp3')).toEqual({ id: 'ep01.s12.l003', ext: 'mp3' });
    expect(parseClipFile('take_two.ogg')).toEqual({ id: 'take_two', ext: 'ogg' });
    expect(parseClipFile('a.b.m4a')).toEqual({ id: 'a.b', ext: 'm4a' });
    for (const bad of ['.mp3', 'mp3', 'EP01.s12.mp3', 'a b.mp3', 'a.MP3', 'a.wav', 'a.webp', 'ep01..x.mp3', 'x.', '', 'привет.mp3', '../x.mp3']) {
      expect(parseClipFile(bad), bad).toBeNull();
    }
  });
});

describe('VoiceIndex', () => {
  const index = VoiceIndex.parse(
    data({
      ep01: {
        ru: ['ep01.s01.l001.mp3', 'ep01.s01.l002.mp3', 'alt_take.mp3', 'only_m4a.m4a'],
        en: ['ep01.s01.l001.mp3'],
      },
    }),
  );
  const line = (key: string, voice: string | null = null) => ({ key, voice });

  it('ключ → путь клипа на текущем языке; чего нет в индексе — null (файл не запрашивается)', () => {
    expect(index.resolve('ep01_murylev', 'ru', line('ep01.s01.l001'))).toEqual({
      id: 'ep01.s01.l001',
      ext: 'mp3',
      folder: 'ep01',
      lang: 'ru',
      path: 'assets/ep01/voice/ru/ep01.s01.l001.mp3',
    });
    expect(index.resolve('ep01_murylev', 'ru', line('ep01.s01.l099'))).toBeNull();
    expect(index.find('ep01_murylev', 'ru', 'nothing')).toBeNull();
    expect(index.resolve('ep99_other', 'ru', line('ep01.s01.l001'))).toBeNull(); // чужой эпизод
  });

  it('язык строгий: клип другого языка не подставляется (текст en под русский голос — путаница)', () => {
    expect(index.resolve('ep01_murylev', 'en', line('ep01.s01.l001'))?.path).toBe('assets/ep01/voice/en/ep01.s01.l001.mp3');
    expect(index.resolve('ep01_murylev', 'en', line('ep01.s01.l002'))).toBeNull(); // есть только ru
    expect(index.resolve('ep01_murylev', 'es', line('ep01.s01.l001'))).toBeNull();
    expect(index.resolve('ep01_murylev', 'pt', line('ep01.s01.l001'))).toBeNull();
  });

  it('явное поле voice — приоритет: клип с этим id в той же папке; нет его в индексе — запасной клип по ключу', () => {
    expect(index.resolve('ep01_murylev', 'ru', line('ep01.s01.l001', 'alt_take'))?.path).toBe('assets/ep01/voice/ru/alt_take.mp3');
    expect(index.resolve('ep01_murylev', 'ru', line('ep01.s01.l001', 'not_recorded_yet'))?.path).toBe('assets/ep01/voice/ru/ep01.s01.l001.mp3');
    // ни явного, ни по ключу
    expect(index.resolve('ep01_murylev', 'ru', line('ep01.s01.l099', 'not_recorded_yet'))).toBeNull();
    // явный клип есть только на другом языке — на этом языке его нет
    expect(index.resolve('ep01_murylev', 'en', line('ep01.s01.l002', 'alt_take'))).toBeNull();
  });

  it('формат: берётся первый из mp3 > m4a > ogg независимо от порядка в файле; одиночный m4a годится', () => {
    const many = VoiceIndex.parse(data({ ep01: { ru: ['a.ogg', 'a.m4a', 'a.mp3', 'b.ogg', 'b.m4a', 'c.ogg'] } }));
    expect(many.find('ep01_x', 'ru', 'a')?.ext).toBe('mp3');
    expect(many.find('ep01_x', 'ru', 'b')?.ext).toBe('m4a');
    expect(many.find('ep01_x', 'ru', 'c')?.ext).toBe('ogg');
    expect(many.size).toBe(3);
    expect(index.find('ep01_murylev', 'ru', 'only_m4a')?.path).toBe('assets/ep01/voice/ru/only_m4a.m4a');
  });

  it('папка по полному id эпизода тоже работает; при одном и том же клипе в обеих короткая папка первая', () => {
    const full = VoiceIndex.parse(data({ ep01_murylev: { ru: ['k.a.mp3'] } }));
    expect(full.find('ep01_murylev', 'ru', 'k.a')?.path).toBe('assets/ep01_murylev/voice/ru/k.a.mp3');
    const both = VoiceIndex.parse(data({ ep01_murylev: { ru: ['k.a.mp3'] }, ep01: { ru: ['k.a.m4a'] } }));
    expect(both.find('ep01_murylev', 'ru', 'k.a')?.path).toBe('assets/ep01/voice/ru/k.a.m4a');
  });

  it('счётчики: size — всего, count — по эпизоду и языку', () => {
    expect(index.size).toBe(5);
    expect(index.count('ep01_murylev', 'ru')).toBe(4);
    expect(index.count('ep01_murylev', 'en')).toBe(1);
    expect(index.count('ep01_murylev', 'es')).toBe(0);
    expect(index.count('ep02_x', 'ru')).toBe(0);
  });

  it('пустой индекс и мусор вместо индекса: ничего не находится, ничего не бросается', () => {
    const junk: unknown[] = [
      null,
      undefined,
      42,
      'text',
      [],
      {},
      { version: 2, episodes: { ep01: { ru: ['a.mp3'] } } },
      { version: 1 },
      { version: 1, episodes: null },
      { version: 1, episodes: { ep01: 'x' } },
      { version: 1, episodes: { ep01: { ru: 'a.mp3' } } },
      { version: 1, episodes: { ep01: { ru: [1, null, {}, 'BAD NAME.mp3', 'a.wav'] } } },
    ];
    for (const j of junk) {
      const idx = VoiceIndex.parse(j);
      expect(idx.size, JSON.stringify(j)).toBe(0);
      expect(idx.resolve('ep01_murylev', 'ru', line('a'))).toBeNull();
      expect(idx.count('ep01_murylev', 'ru')).toBe(0);
    }
    expect(VoiceIndex.empty().size).toBe(0);
    expect(VoiceIndex.empty().resolve('ep01_murylev', 'ru', line('a'))).toBeNull();
    expect(VoiceIndex.parse(data({})).size).toBe(0);
  });

  it('ключи вроде __proto__ в индексе безвредны', () => {
    const idx = VoiceIndex.parse(JSON.parse('{"version":1,"episodes":{"__proto__":{"ru":["a.mp3"]},"ep01":{"__proto__":["b.mp3"]}}}'));
    expect(idx.find('x', 'ru', 'a')).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('язык озвучки при языке игры (владелец 2026-10-15)', () => {
  it('ru и en — свой голос; es и pt — английская озвучка под своим текстом', () => {
    const langs: Lang[] = ['ru', 'en', 'es', 'pt'];
    expect(langs.map(voiceLangFor)).toEqual(['ru', 'en', 'en', 'en']);
  });
});

describe('политика озвучки персонажа (cast[].voice)', () => {
  it('none — не озвучен; ru_only — только на русском; all и не задано — на всех языках', () => {
    const langs: Lang[] = ['ru', 'en', 'es', 'pt'];
    expect(langs.map((l) => voiceAllowed('none', l))).toEqual([false, false, false, false]);
    expect(langs.map((l) => voiceAllowed('ru_only', l))).toEqual([true, false, false, false]);
    expect(langs.map((l) => voiceAllowed('all', l))).toEqual([true, true, true, true]);
    expect(langs.map((l) => voiceAllowed(undefined, l))).toEqual([true, true, true, true]);
  });

  it('castVoicePolicies собирает только заданные', () => {
    const ep = miniEpisode({ s1: { steps: [{ do: 'end', ending: 'e_main' }] } });
    ep.cast[0] = { ...ep.cast[0]!, voice: 'ru_only' };
    expect([...castVoicePolicies(ep)]).toEqual([['a', 'ru_only']]);
  });
});

describe('LineVoice: выбор клипа по реплике', () => {
  const episode = miniEpisode({ s1: { steps: [{ do: 'end', ending: 'e_main' }] } }); // id «ep_mini», папка ассетов «ep»
  const BASE = './';

  function make(files: VoiceIndexData['episodes'], opts: { lang?: Lang; reply?: boolean; cast?: 'none' | 'ru_only' | 'all' } = {}) {
    const calls: string[] = [];
    let lang: Lang = opts.lang ?? 'ru';
    const output: VoiceOutput = {
      playVoice: (url) => {
        calls.push(`play:${url}`);
        return opts.reply === false ? null : new VoiceClip(url);
      },
      stopVoice: () => void calls.push('stop'),
      preloadVoice: (urls, prio) => void calls.push(`warm:${prio}:${urls.join(',')}`),
    };
    const ep = opts.cast ? { ...episode, cast: episode.cast.map((c) => (c.id === 'a' ? { ...c, voice: opts.cast } : c)) } : episode;
    const voice = new LineVoice({ episode: ep, index: VoiceIndex.parse(data(files)), url: (p) => joinUrl(BASE, p), lang: () => lang, output });
    return { voice, calls, setLang: (l: Lang) => void (lang = l) };
  }
  const L = (key: string, who: string | null = 'a', voice: string | null = null) => ({ key, voice, who });

  it('ключ → адрес клипа (с BASE_URL), клип стартует через звуковой выход', () => {
    const { voice, calls } = make({ ep: { ru: ['k.one.mp3'] } });
    const clip = voice.start(L('k.one'));
    expect(clip).not.toBeNull();
    expect(calls).toEqual(['play:./assets/ep/voice/ru/k.one.mp3']);
    expect(voice.urlFor(L('k.one'))).toBe('./assets/ep/voice/ru/k.one.mp3');
  });

  it('реплика рассказчика (who = null) и явное поле voice', () => {
    const { voice, calls } = make({ ep: { ru: ['k.one.mp3', 'take_two.mp3'] } });
    voice.start(L('k.one', null));
    voice.start(L('k.one', 'a', 'take_two'));
    expect(calls).toEqual(['play:./assets/ep/voice/ru/k.one.mp3', 'play:./assets/ep/voice/ru/take_two.mp3']);
  });

  it('клипа нет в индексе — null, звуковой выход не трогается вовсе (никаких запросов)', () => {
    const { voice, calls } = make({ ep: { ru: ['k.one.mp3'] } });
    expect(voice.start(L('k.two'))).toBeNull();
    expect(calls).toEqual([]);
  });

  it('пустой индекс: start / warm ничего не делают и не ломаются; clips = 0', () => {
    const { voice, calls } = make({});
    expect(voice.start(L('k.one'))).toBeNull();
    voice.warm([L('k.one'), L('k.two')], 'now');
    expect(calls).toEqual([]);
    expect(voice.clips).toBe(0);
    voice.stop();
    expect(calls).toEqual(['stop']);
  });

  it('язык берётся в момент вызова: смена языка на лету меняет клип или отнимает его; es — английский клип', () => {
    const { voice, calls, setLang } = make({ ep: { ru: ['k.one.mp3', 'k.only_ru.mp3'], en: ['k.one.mp3', 'k.only_en.mp3'] } });
    voice.start(L('k.one'));
    setLang('en');
    voice.start(L('k.one'));
    voice.start(L('k.only_en'));
    expect(voice.start(L('k.only_ru'))).toBeNull(); // русский голос под английский текст не подставляется
    setLang('es');
    voice.start(L('k.one')); // испанский текст — английская озвучка (владелец 2026-10-15)
    expect(voice.start(L('k.only_ru'))).toBeNull();
    expect(calls).toEqual([
      'play:./assets/ep/voice/ru/k.one.mp3',
      'play:./assets/ep/voice/en/k.one.mp3',
      'play:./assets/ep/voice/en/k.only_en.mp3',
      'play:./assets/ep/voice/en/k.one.mp3',
    ]);
    expect(voice.clips).toBe(2);
    setLang('ru');
    expect(voice.clips).toBe(2);
    setLang('en');
    expect(voice.clips).toBe(2);
  });

  it('cast.voice: none — персонаж не озвучен, ru_only — только на русском; рассказчика это не касается', () => {
    const files = { ep: { ru: ['k.one.mp3'], en: ['k.one.mp3'] } };
    const none = make(files, { cast: 'none' });
    expect(none.voice.start(L('k.one', 'a'))).toBeNull();
    expect(none.voice.start(L('k.one', 'b'))).not.toBeNull(); // у «b» политики нет
    expect(none.voice.start(L('k.one', null))).not.toBeNull();
    const ruOnly = make(files, { cast: 'ru_only' });
    expect(ruOnly.voice.start(L('k.one', 'a'))).not.toBeNull();
    ruOnly.setLang('en');
    expect(ruOnly.voice.start(L('k.one', 'a'))).toBeNull();
    expect(ruOnly.voice.start(L('k.one', 'b'))).not.toBeNull();
  });

  it('звук недоступен (выход вернул null: озвучка выключена, Mute, нулевая громкость) — null, реплика немая', () => {
    const { voice } = make({ ep: { ru: ['k.one.mp3'] } }, { reply: false });
    expect(voice.start(L('k.one'))).toBeNull();
  });

  it('сбой звукового выхода не ломает показ реплики: start возвращает null, warm молчит (одно предупреждение в консоль)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const boom: VoiceOutput = {
        playVoice: () => {
          throw new Error('звук сломан');
        },
        stopVoice: () => undefined,
        preloadVoice: () => {
          throw new Error('звук сломан');
        },
      };
      const voice = new LineVoice({ episode, index: VoiceIndex.parse(data({ ep: { ru: ['k.one.mp3'] } })), url: (p) => joinUrl(BASE, p), lang: () => 'ru', output: boom });
      expect(voice.start(L('k.one'))).toBeNull();
      expect(() => voice.warm([L('k.one')], 'now')).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it('warm: только клипы из индекса, без повторов, с приоритетом блока', () => {
    const { voice, calls } = make({ ep: { ru: ['k.one.mp3', 'k.two.mp3'] } });
    voice.warm([L('k.one'), L('k.none'), L('k.two'), L('k.one'), L('k.one', 'a', 'missing_take')], 'idle');
    expect(calls).toEqual(['warm:idle:./assets/ep/voice/ru/k.one.mp3,./assets/ep/voice/ru/k.two.mp3']);
    calls.length = 0;
    voice.warm([L('k.none')], 'now');
    expect(calls).toEqual([]);
  });
});

const real = hasRepoContent() ? describe : describe.skip;

real('озвучка на настоящем ep01', () => {
  const episode = loadEpisode(EP01_PATH);
  const lines: Array<{ key: string; voice: string | null; who: string | null }> = [];
  for (const scene of Object.values(episode.scenes)) {
    for (const st of scene.steps) {
      if (st.do === 'say') lines.push({ key: st.key, voice: st.voice ?? null, who: st.who });
      else if (st.do === 'narrate') lines.push({ key: st.key, voice: st.voice ?? null, who: null });
    }
  }

  it('каждая реплика эпизода получает путь assets/ep01/voice/<язык>/<ключ>.mp3; ключи локализации укладываются в имя файла', () => {
    expect(lines.length).toBeGreaterThan(600);
    const files = [...new Set(lines.map((l) => l.voice ?? l.key))].map((k) => `${k}.mp3`);
    for (const f of files) expect(parseClipFile(f), f).not.toBeNull();
    const idx = VoiceIndex.parse(data({ ep01: { ru: files } }));
    expect(idx.count(episode.id, 'ru')).toBe(files.length);
    for (const l of lines) {
      const ref = idx.resolve(episode.id, 'ru', l);
      expect(ref?.path, l.key).toBe(`assets/ep01/voice/ru/${l.voice ?? l.key}.mp3`);
    }
    expect(idx.resolve(episode.id, 'en', lines[0]!)).toBeNull();
  });

  it('LineVoice на настоящем эпизоде: политика cast читается из эпизода (в ep01 она не задана — озвучены все)', () => {
    const files = [...new Set(lines.map((l) => `${l.key}.mp3`))];
    const output: VoiceOutput = { playVoice: (url) => new VoiceClip(url), stopVoice: vi.fn() };
    const voice = new LineVoice({ episode, index: VoiceIndex.parse(data({ ep01: { ru: files } })), url: (p) => joinUrl('./', p), lang: () => 'ru', output });
    expect(lines.every((l) => voice.clipFor(l) !== null)).toBe(true);
    expect(voice.clips).toBe(files.length);
  });
});
