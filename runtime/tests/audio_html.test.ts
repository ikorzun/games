/**
 * Звук: HtmlAudioBackend (HTMLAudioElement, mp3/m4a) и AudioManager. Элементы, часы и таймеры подменены,
 * поэтому кроссфейд, затухание, пул sfx, mute, пауза, разблокировка iOS и отсутствующие файлы
 * проверяются детерминированно, без браузера.
 */
import { describe, expect, it, vi } from 'vitest';
import { AudioManager } from '../src/stage/audio';
import type { IAudioBackend } from '../src/stage/audio';
import { FADE_STEP_MS, HtmlAudioBackend, SFX_POOL, SILENT_WAV, VOICE_WARM_CONCURRENCY, VOICE_WARM_TIMEOUT_MS } from '../src/stage/audio_html';
import { Clock, FakeEl } from './helpers/audio_fakes';

const URLS: Record<string, string> = {
  m_a: './assets/common/music/a.m4a',
  m_b: './assets/common/music/b.m4a',
  m_c: './assets/common/music/c.m4a',
  amb_a: './assets/common/amb/a.mp3',
  amb_b: './assets/common/amb/b.mp3',
  s0: './assets/common/sfx/0.mp3',
  s1: './assets/common/sfx/1.mp3',
  s2: './assets/common/sfx/2.mp3',
  s3: './assets/common/sfx/3.mp3',
  s4: './assets/common/sfx/4.mp3',
  s5: './assets/common/sfx/5.mp3',
  s6: './assets/common/sfx/6.mp3',
};
const resolve = (id: string): string | null => URLS[id] ?? null;

function make(opts: { ios?: boolean } = {}) {
  const clock = new Clock();
  const els: FakeEl[] = [];
  const warns: string[] = [];
  const backend = new HtmlAudioBackend(resolve, {
    createElement: () => {
      const e = new FakeEl(opts.ios === true);
      els.push(e);
      return e;
    },
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    warn: (m) => warns.push(m),
  });
  // порядок создания в конструкторе: музыка ×2, эмбиент ×2, sfx ×SFX_POOL, озвучка ×1
  const music = els.slice(0, 2);
  const ambient = els.slice(2, 4);
  const sfx = els.slice(4, 4 + SFX_POOL);
  const voice = els[4 + SFX_POOL]!;
  return { backend, clock, els, music, ambient, sfx, voice, warns };
}

const play = (b: HtmlAudioBackend, kind: 'music' | 'ambient' | 'sfx', id: string, o: Partial<{ loop: boolean; volume: number; fadeMs: number }> = {}): void =>
  b.play(kind, id, { loop: kind !== 'sfx', volume: 1, fadeMs: 0, ...o });
const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};
const close = (a: number, b: number, eps = 0.06): boolean => Math.abs(a - b) <= eps;

describe('HtmlAudioBackend: музыка', () => {
  it('запускает трек на элементе канала: src, loop, play(); без fade — сразу на полной громкости', () => {
    const { backend, music } = make();
    play(backend, 'music', 'm_a');
    const el = music.find((e) => e.src === URLS.m_a)!;
    expect(el).toBeDefined();
    expect(el.loop).toBe(true);
    expect(el.plays).toBe(1);
    expect(el.paused).toBe(false);
    expect(el.volume).toBe(1);
    expect(backend.state().music).toBe('m_a');
  });

  it('нарастает за fade_ms линейно и в конце ровно на целевой громкости', () => {
    const { backend, music, clock } = make();
    play(backend, 'music', 'm_a', { fadeMs: 1000, volume: 0.8 });
    const el = music.find((e) => e.src === URLS.m_a)!;
    expect(el.volume).toBe(0);
    clock.advance(500);
    expect(close(el.volume, 0.4)).toBe(true);
    clock.advance(500 + FADE_STEP_MS);
    expect(el.volume).toBeCloseTo(0.8, 9);
    expect(backend.state().fading).toBe(0);
  });

  it('кроссфейд: старый трек гаснет, новый нарастает одновременно; старый элемент освобождается и останавливается', () => {
    const { backend, music, clock } = make();
    play(backend, 'music', 'm_a');
    const a = music.find((e) => e.src === URLS.m_a)!;
    play(backend, 'music', 'm_b', { fadeMs: 1000 });
    const b = music.find((e) => e.src === URLS.m_b)!;
    expect(b).not.toBe(a);
    expect(a.paused).toBe(false);
    expect(backend.state().music).toBe('m_b');
    clock.advance(500);
    expect(close(a.volume, 0.5)).toBe(true);
    expect(close(b.volume, 0.5)).toBe(true);
    expect(a.paused).toBe(false);
    clock.advance(500 + FADE_STEP_MS);
    expect(a.paused).toBe(true); // ушёл
    expect(b.volume).toBe(1);
    expect(backend.state().fading).toBe(0);
    // освободившийся элемент годится для следующего трека
    play(backend, 'music', 'm_c');
    expect(music.filter((e) => e.src === URLS.m_c)).toHaveLength(1);
  });

  it('тот же трек повторно не перезапускается (откат и загрузка сейва зовут play снова и снова), громкость обновляется', () => {
    const { backend, music } = make();
    play(backend, 'music', 'm_a', { volume: 1 });
    const el = music.find((e) => e.src === URLS.m_a)!;
    el.currentTime = 42;
    play(backend, 'music', 'm_a', { volume: 0.5, fadeMs: 300 });
    expect(el.plays).toBe(1);
    expect(el.srcHistory.filter((s) => s === URLS.m_a)).toHaveLength(1);
    expect(el.currentTime).toBe(42);
    expect(el.volume).toBe(0.5);
  });

  it('stop с затуханием: трек гаснет и останавливается; без затухания — сразу; состояние «музыки нет» сразу', () => {
    const { backend, music, clock } = make();
    play(backend, 'music', 'm_a');
    const el = music.find((e) => e.src === URLS.m_a)!;
    backend.stop('music', 600);
    expect(backend.state().music).toBeNull();
    clock.advance(300);
    expect(close(el.volume, 0.5)).toBe(true);
    expect(el.paused).toBe(false);
    clock.advance(300 + FADE_STEP_MS);
    expect(el.paused).toBe(true);
    play(backend, 'music', 'm_b');
    backend.stop('music', 0);
    expect(music.find((e) => e.src === URLS.m_b)!.paused).toBe(true);
    backend.stop('music', 0); // повторный stop безопасен
  });

  it('быстрая смена трёх треков подряд: третий забирает элемент самого старого уходящего, звук не накапливается', () => {
    const { backend, music, clock } = make();
    play(backend, 'music', 'm_a');
    play(backend, 'music', 'm_b', { fadeMs: 2000 });
    clock.advance(100);
    play(backend, 'music', 'm_c', { fadeMs: 2000 });
    const playing = music.filter((e) => !e.paused);
    expect(playing.length).toBeLessThanOrEqual(2);
    expect(backend.state().music).toBe('m_c');
    clock.advance(2500);
    expect(music.filter((e) => !e.paused)).toHaveLength(1);
    expect(music.find((e) => !e.paused)!.src).toBe(URLS.m_c);
  });

  it('эмбиент идёт на своём канале и не зависит от музыки', () => {
    const { backend, music, ambient } = make();
    play(backend, 'music', 'm_a');
    play(backend, 'ambient', 'amb_a', { loop: true });
    expect(ambient.some((e) => e.src === URLS.amb_a && e.loop && !e.paused)).toBe(true);
    backend.stop('music', 0);
    expect(ambient.some((e) => e.src === URLS.amb_a && !e.paused)).toBe(true);
    expect(music.every((e) => e.paused)).toBe(true);
    play(backend, 'ambient', 'amb_b', { loop: true });
    expect(backend.state().ambient).toBe('amb_b');
  });
});

describe('HtmlAudioBackend: sfx', () => {
  it('одноразовый эффект: без loop, громкость = громкость шага × канал', () => {
    const { backend, sfx } = make();
    backend.setGain('sfx', 0.5);
    play(backend, 'sfx', 's0', { volume: 0.8 });
    const el = sfx.find((e) => e.src === URLS.s0)!;
    expect(el.loop).toBe(false);
    expect(el.plays).toBe(1);
    expect(el.volume).toBeCloseTo(0.4, 9);
  });

  it('пул: SFX_POOL одновременных эффектов на разных элементах; следующий заменяет самый старый; ended освобождает слот', () => {
    const { backend, sfx, clock } = make();
    for (let i = 0; i < SFX_POOL; i++) {
      clock.advance(10);
      play(backend, 'sfx', `s${i}`);
    }
    expect(new Set(sfx.map((e) => e.src)).size).toBe(SFX_POOL);
    expect(backend.state().sfxBusy).toBe(SFX_POOL);
    clock.advance(10);
    play(backend, 'sfx', 's6'); // пул занят: заменяется самый старый (s0)
    expect(sfx.some((e) => e.src === URLS.s6)).toBe(true);
    expect(sfx.some((e) => e.src === URLS.s0)).toBe(false);
    // эффект доиграл — слот свободен и берётся первым
    const done = sfx.find((e) => e.src === URLS.s3)!;
    done.fire('ended');
    expect(backend.state().sfxBusy).toBe(SFX_POOL - 1);
    play(backend, 'sfx', 's0');
    expect(done.src).toBe(URLS.s0);
  });

  it('при нулевой громкости канала (mute, запрет платформы) эффект не запускается вовсе', () => {
    const { backend, sfx } = make();
    backend.setGain('sfx', 0);
    play(backend, 'sfx', 's0');
    expect(sfx.every((e) => e.plays === 0)).toBe(true);
  });
});

describe('HtmlAudioBackend: громкости, mute, запрет платформы', () => {
  it('setGain меняет громкость идущих треков: трек × затухание × канал; нулевой gain — тишина, но трек идёт дальше', () => {
    const { backend, music } = make();
    play(backend, 'music', 'm_a', { volume: 0.8 });
    const el = music.find((e) => e.src === URLS.m_a)!;
    backend.setGain('music', 0.5);
    expect(el.volume).toBeCloseTo(0.4, 9);
    backend.setGain('music', 0);
    expect(el.volume).toBe(0);
    expect(el.paused).toBe(false); // идёт беззвучно: при включении звука музыка не «перематывается»
    backend.setGain('music', 1);
    expect(el.volume).toBeCloseTo(0.8, 9);
  });

  it('AudioManager: громкости из настроек, mute и запрет платформой доходят до элементов и возвращаются', () => {
    const { backend, music, sfx } = make();
    const audio = new AudioManager(backend);
    audio.setVolumes({ music: 0.6, sfx: 0.5, voice: 1 });
    audio.handle({ t: 'audio', kind: 'music', id: 'm_a', fade_ms: 0, loop: true, volume: 1 });
    const el = music.find((e) => e.src === URLS.m_a)!;
    expect(el.volume).toBeCloseTo(0.6, 9);
    audio.setMuted(true);
    expect(el.volume).toBe(0);
    audio.setMuted(false);
    expect(el.volume).toBeCloseTo(0.6, 9);
    audio.setPlatformEnabled(false);
    expect(el.volume).toBe(0);
    expect(audio.audible).toBe(false);
    audio.handle({ t: 'audio', kind: 'sfx', id: 's0', fade_ms: 0, loop: false, volume: 1 });
    expect(sfx.every((e) => e.plays === 0)).toBe(true); // платформа запретила звук
    audio.setPlatformEnabled(true);
    expect(el.volume).toBeCloseTo(0.6, 9);
    audio.handle({ t: 'audio', kind: 'sfx', id: 's0', fade_ms: 0, loop: false, volume: 1 });
    expect(sfx.find((e) => e.src === URLS.s0)!.volume).toBeCloseTo(0.5, 9);
  });

  it('музыка, начатая при выключенном звуке, идёт беззвучно и слышна после включения', () => {
    const { backend, music } = make();
    const audio = new AudioManager(backend);
    audio.setMuted(true);
    audio.handle({ t: 'audio', kind: 'music', id: 'm_a', fade_ms: 0, loop: true, volume: 1 });
    const el = music.find((e) => e.src === URLS.m_a)!;
    expect(el.volume).toBe(0);
    expect(el.paused).toBe(false);
    audio.setMuted(false);
    expect(el.volume).toBeCloseTo(0.7, 9); // громкость музыки по умолчанию
  });
});

describe('HtmlAudioBackend: автозапуск и разблокировка (iOS)', () => {
  it('play отклонён автозапуском — ошибки нет, трек ждёт; после unlock() он стартует, а свободные элементы «отыгрывают» тишину', async () => {
    const { backend, music, els, warns } = make();
    for (const e of els) e.mode = 'blocked';
    play(backend, 'music', 'm_a');
    await flush();
    const el = music.find((e) => e.src === URLS.m_a)!;
    expect(el.paused).toBe(true);
    expect(warns).toEqual([]);
    expect(backend.state().music).toBe('m_a'); // трек «должен играть»
    for (const e of els) e.mode = 'ok'; // пользователь коснулся экрана
    backend.unlock();
    await flush();
    expect(el.paused).toBe(false);
    expect(el.src).toBe(URLS.m_a);
    // остальные элементы разблокированы тишиной и остановлены
    const idle = els.filter((e) => e !== el);
    expect(idle.every((e) => e.src === SILENT_WAV && e.plays >= 1)).toBe(true);
    expect(idle.every((e) => e.paused)).toBe(true);
    // разблокированному элементу можно менять src и играть без жеста
    play(backend, 'ambient', 'amb_a');
    expect(els.some((e) => e.src === URLS.amb_a && !e.paused)).toBe(true);
  });

  it('unlock безопасен повторно и не трогает играющие треки и эффекты', async () => {
    const { backend, music, sfx } = make();
    play(backend, 'music', 'm_a');
    play(backend, 'sfx', 's0');
    backend.unlock();
    backend.unlock();
    await flush();
    expect(music.find((e) => e.src === URLS.m_a)!.paused).toBe(false);
    expect(sfx.find((e) => e.src === URLS.s0)!.paused).toBe(false);
  });

  it('installUnlock: первый жест (касание, клик, клавиша) разблокирует звук один раз и снимает подписки', () => {
    const { backend } = make();
    const spy = vi.spyOn(backend, 'unlock');
    const added: Array<[string, () => void]> = [];
    const removed: string[] = [];
    const target = {
      addEventListener: (t: string, h: () => void) => void added.push([t, h]),
      removeEventListener: (t: string) => void removed.push(t),
    };
    backend.installUnlock(target as unknown as Document);
    expect(added.map(([t]) => t).sort()).toEqual(['click', 'keydown', 'pointerup', 'touchend']);
    added[0]![1]();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(removed.sort()).toEqual(['click', 'keydown', 'pointerup', 'touchend']);
  });
});

describe('HtmlAudioBackend: отсутствующие файлы', () => {
  it('id без записи в assets — тихий пропуск с одним предупреждением', () => {
    const { backend, music, warns } = make();
    play(backend, 'music', 'm_nowhere');
    play(backend, 'music', 'm_nowhere');
    expect(music.every((e) => e.plays === 0)).toBe(true);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('m_nowhere');
  });

  it('файл не читается (error элемента): один warn на файл, трек снят, повтор молча пропускается', () => {
    const { backend, music, warns } = make();
    play(backend, 'music', 'm_a');
    const el = music.find((e) => e.src === URLS.m_a)!;
    el.fire('error');
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(URLS.m_a);
    expect(backend.state().music).toBeNull();
    expect(backend.state().missing).toContain(URLS.m_a);
    expect(el.paused).toBe(true);
    play(backend, 'music', 'm_a');
    expect(warns).toHaveLength(1);
    expect(music.filter((e) => e.src === URLS.m_a && e.plays > 0)).toHaveLength(1); // второй попытки не было
  });

  it('play() отклонён как NotSupportedError (нет файла / формат) — то же самое, и для эффектов', async () => {
    const { backend, els, warns } = make();
    for (const e of els) e.mode = 'unsupported';
    play(backend, 'music', 'm_b');
    play(backend, 'sfx', 's1');
    await flush();
    expect(warns.filter((w) => w.includes(URLS.m_b))).toHaveLength(1);
    expect(warns.filter((w) => w.includes(URLS.s1))).toHaveLength(1);
    expect(backend.state().music).toBeNull();
    expect(backend.state().missing.sort()).toEqual([URLS.m_b, URLS.s1].sort());
    play(backend, 'sfx', 's1');
    await flush();
    expect(warns).toHaveLength(2); // повторных предупреждений нет
  });

  it('ошибка загрузки эффекта не помечает «отсутствующими» другие эффекты того же слота (обработчик один на слот)', () => {
    const { backend, sfx, warns } = make();
    play(backend, 'sfx', 's0'); // слот 0 играет s0
    const el = sfx.find((e) => e.src === URLS.s0)!;
    el.fire('ended');
    play(backend, 'sfx', 's1'); // тот же слот берёт s1
    expect(el.src).toBe(URLS.s1);
    el.fire('error'); // ошибка относится к s1, а не к s0
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(URLS.s1);
    expect(backend.state().missing).toEqual([URLS.s1]);
    expect(el.listeners('error')).toBe(1);
  });

  it('ошибка, пока слот свободен (разблокировка тишиной, смена src), игнорируется', () => {
    const { backend, sfx, warns } = make();
    sfx[0]!.fire('error');
    expect(warns).toEqual([]);
    expect(backend.state().missing).toEqual([]);
  });
});

describe('HtmlAudioBackend: предзагрузка', () => {
  it('preload прогревает файлы: находит отсутствующие (один warn), игра их потом молча пропускает', async () => {
    const { backend, els, music, warns } = make();
    const before = els.length;
    const p = backend.preload([URLS.m_a, URLS.m_b]);
    const probes = els.slice(before);
    expect(probes).toHaveLength(2);
    expect(probes.map((e) => e.src)).toEqual([URLS.m_a, URLS.m_b]);
    probes[0]!.fire('canplay');
    probes[1]!.fire('error');
    await p;
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(URLS.m_b);
    play(backend, 'music', 'm_b');
    expect(music.every((e) => e.src !== URLS.m_b)).toBe(true);
    // повторная предзагрузка тех же файлов ничего не создаёт
    const n = els.length;
    await backend.preload([URLS.m_a, URLS.m_b]);
    expect(els).toHaveLength(n);
  });

  it('iOS не предзагружает аудио без жеста: события не придут — по таймеру файл считается «неизвестно, но не отсутствует»', async () => {
    const { backend, clock, warns } = make();
    const p = backend.preload([URLS.m_a]);
    clock.advance(4100);
    await p;
    expect(warns).toEqual([]);
    expect(backend.state().missing).toEqual([]);
  });
});

describe('HtmlAudioBackend: пауза платформы', () => {
  it('setPaused останавливает всё играющее и возобновляет с того же места; затухание не «проматывается» за время паузы', () => {
    const { backend, music, clock } = make();
    play(backend, 'music', 'm_a', { fadeMs: 1000 });
    const el = music.find((e) => e.src === URLS.m_a)!;
    clock.advance(400);
    backend.setPaused(true);
    expect(el.paused).toBe(true);
    const v = el.volume;
    clock.advance(5000); // реклама
    expect(el.volume).toBe(v);
    backend.setPaused(false);
    expect(el.paused).toBe(false);
    clock.advance(300);
    expect(el.volume).toBeLessThan(1);
    clock.advance(300 + FADE_STEP_MS);
    expect(el.volume).toBeCloseTo(1, 9);
  });

  it('во время паузы новый трек не стартует до её конца, эффекты не запускаются', () => {
    const { backend, music, sfx } = make();
    backend.setPaused(true);
    play(backend, 'music', 'm_a');
    play(backend, 'sfx', 's0');
    expect(music.every((e) => e.plays === 0)).toBe(true);
    expect(sfx.every((e) => e.plays === 0)).toBe(true);
    backend.setPaused(false);
    expect(music.find((e) => e.src === URLS.m_a)!.plays).toBe(1);
  });
});

describe('HtmlAudioBackend: iPhone (громкость элемента не меняется)', () => {
  it('volumeSettable = false; громкость каналов работает как вкл/выкл через muted, кроссфейд — склейка', () => {
    const { backend, music, clock } = make({ ios: true });
    expect(backend.volumeSettable).toBe(false);
    play(backend, 'music', 'm_a');
    const a = music.find((e) => e.src === URLS.m_a)!;
    expect(a.muted).toBe(false);
    backend.setGain('music', 0);
    expect(a.muted).toBe(true);
    backend.setGain('music', 0.6);
    expect(a.muted).toBe(false);
    // кроссфейд невозможен: предыдущий трек заменяется сразу, fade_ms игнорируется
    play(backend, 'music', 'm_b', { fadeMs: 2000 });
    const playing = music.filter((e) => !e.paused);
    expect(playing).toHaveLength(1); // два трека одновременно не звучат
    expect(playing[0]!.src).toBe(URLS.m_b); // освободившийся элемент сразу занят новым треком
    expect(backend.state().fading).toBe(0);
    expect(a.srcHistory).toEqual([URLS.m_a, URLS.m_b]);
    clock.advance(100);
  });

  it('на десктопе (volume меняется) volumeSettable = true', () => {
    expect(make().backend.volumeSettable).toBe(true);
  });
});

describe('AudioManager: события сценария → бэкенд', () => {
  function spyBackend() {
    const calls: string[] = [];
    const b: IAudioBackend = {
      play: (k, id, o) => void calls.push(`play:${k}:${id}:loop=${o.loop}:vol=${o.volume}:fade=${o.fadeMs}`),
      stop: (k, f) => void calls.push(`stop:${k}:${f}`),
      setGain: (c, g) => void calls.push(`gain:${c}:${g.toFixed(2)}`),
      setPaused: (p) => void calls.push(`paused:${p}`),
    };
    return { calls, audio: new AudioManager(b) };
  }

  it('music / ambient / sfx / stop_* и sync после загрузки сейва', () => {
    const { calls, audio } = spyBackend();
    audio.handle({ t: 'audio', kind: 'music', id: 'm_a', fade_ms: 800, loop: true, volume: 1 });
    audio.handle({ t: 'audio', kind: 'ambient', id: 'amb_a', fade_ms: 800, loop: true, volume: 1 });
    audio.handle({ t: 'audio', kind: 'sfx', id: 's0', fade_ms: 0, loop: false, volume: 0.5 });
    audio.handle({ t: 'audio', kind: 'stop_music', id: null, fade_ms: 600, loop: false, volume: 1 });
    audio.handle({ t: 'audio', kind: 'stop_ambient', id: null, fade_ms: 500, loop: false, volume: 1 });
    expect(calls).toEqual([
      'play:music:m_a:loop=true:vol=1:fade=800',
      'play:ambient:amb_a:loop=true:vol=1:fade=800',
      'play:sfx:s0:loop=false:vol=0.5:fade=0',
      'stop:music:600',
      'stop:ambient:500',
    ]);
    calls.length = 0;
    audio.sync('m_b', 'amb_b');
    expect(calls).toEqual(['play:music:m_b:loop=true:vol=1:fade=300', 'play:ambient:amb_b:loop=true:vol=1:fade=300']);
    calls.length = 0;
    audio.sync('m_b', null); // музыка та же — ничего; эмбиент ушёл
    expect(calls).toEqual(['stop:ambient:300']);
  });

  it('пауза платформы и состояние (что играет, audible) передаются бэкенду и наружу', () => {
    const { calls, audio } = spyBackend();
    audio.setPaused(true);
    expect(calls).toEqual(['paused:true']);
    audio.setVolumes({ music: 0.5, sfx: 0.25, voice: 1 });
    expect(calls).toContain('gain:music:0.50');
    expect(calls).toContain('gain:ambient:0.50'); // эмбиент следует громкости музыки
    expect(calls).toContain('gain:sfx:0.25');
    const seen: number[] = [];
    audio.onChange(() => seen.push(1));
    audio.setMuted(true);
    expect(audio.audible).toBe(false);
    expect(calls.filter((c) => c === 'gain:music:0.00')).toHaveLength(1);
    expect(seen.length).toBeGreaterThan(0);
  });

  it('без бэкенда менеджер только ведёт состояние', () => {
    const audio = new AudioManager();
    audio.handle({ t: 'audio', kind: 'music', id: 'm_a', fade_ms: 0, loop: true, volume: 1 });
    audio.handle({ t: 'audio', kind: 'sfx', id: 's0', fade_ms: 0, loop: false, volume: 1 });
    expect(audio.music).toBe('m_a');
    expect(audio.lastSfx).toBe('s0');
    expect(() => audio.setPaused(true)).not.toThrow();
  });
});

// ───────────────────────────── озвучка реплик ─────────────────────────────

const V1 = './assets/ep01/voice/ru/ep01.s01.l001.mp3';
const V2 = './assets/ep01/voice/ru/ep01.s01.l002.mp3';
const V3 = './assets/ep01/voice/ru/ep01.s01.l003.mp3';

describe('HtmlAudioBackend: озвучка реплик', () => {
  it('клип стартует на своём элементе: src, без loop, play(); пока идёт — playing, по ended — ended, элемент освобождён', () => {
    const { backend, voice } = make();
    const ends: string[] = [];
    const clip = backend.playVoice(V1)!;
    clip.onEnd((how) => ends.push(how));
    expect(clip.url).toBe(V1);
    expect(clip.state).toBe('playing');
    expect(voice.src).toBe(V1);
    expect(voice.loop).toBe(false);
    expect(voice.plays).toBe(1);
    expect(voice.paused).toBe(false);
    expect(backend.state().voice).toBe(V1);
    voice.fire('ended');
    expect(clip.state).toBe('ended');
    expect(ends).toEqual(['ended']);
    expect(voice.paused).toBe(true);
    expect(voice.src).toBe(''); // загрузка отпущена
    expect(backend.state().voice).toBeNull();
    expect(voice.listeners('ended')).toBe(0);
    expect(voice.listeners('error')).toBe(0);
  });

  it('stop() обрывает клип: подписчики получают stopped, элемент молчит, недогруженный клип больше не качается; повтор безопасен', () => {
    const { backend, voice } = make();
    const ends: string[] = [];
    const clip = backend.playVoice(V1)!;
    clip.onEnd((how) => ends.push(how));
    clip.stop();
    expect(clip.state).toBe('stopped');
    expect(ends).toEqual(['stopped']);
    expect(voice.paused).toBe(true);
    expect(voice.src).toBe('');
    clip.stop();
    backend.stopVoice();
    expect(ends).toEqual(['stopped']);
    expect(voice.listeners('ended')).toBe(0);
  });

  it('новый клип обрывает прежний: тот же элемент, прежний получает stopped, позднее ended старого не влияет на новый', () => {
    const { backend, voice } = make();
    const first = backend.playVoice(V1)!;
    const ends: string[] = [];
    first.onEnd((how) => ends.push(`1:${how}`));
    const second = backend.playVoice(V2)!;
    second.onEnd((how) => ends.push(`2:${how}`));
    expect(ends).toEqual(['1:stopped']);
    expect(voice.src).toBe(V2);
    expect(voice.srcHistory).toEqual([V1, V2]); // один элемент на все клипы
    expect(second.state).toBe('playing');
    voice.fire('ended');
    expect(ends).toEqual(['1:stopped', '2:ended']);
    expect(first.state).toBe('stopped'); // не «воскрес»
  });

  it('onEnd у уже закончившегося клипа вызывается сразу; отписка не даёт вызова', () => {
    const { backend, voice } = make();
    const clip = backend.playVoice(V1)!;
    const seen: string[] = [];
    const off = clip.onEnd((how) => seen.push(`a:${how}`));
    off();
    voice.fire('ended');
    expect(seen).toEqual([]);
    clip.onEnd((how) => seen.push(`b:${how}`));
    expect(seen).toEqual(['b:ended']);
  });

  it('громкость: канал voice; нулевой gain — тишина, но клип идёт; на iPhone — вкл/выкл через muted', () => {
    const { backend, voice } = make();
    backend.setGain('voice', 0.6);
    backend.playVoice(V1);
    expect(voice.volume).toBeCloseTo(0.6, 9);
    backend.setGain('voice', 0);
    expect(voice.volume).toBe(0);
    expect(voice.paused).toBe(false);
    backend.setGain('voice', 0.9);
    expect(voice.volume).toBeCloseTo(0.9, 9);

    const ios = make({ ios: true });
    expect(ios.backend.volumeSettable).toBe(false);
    ios.backend.setGain('voice', 0.9);
    ios.backend.playVoice(V1);
    expect(ios.voice.muted).toBe(false);
    ios.backend.setGain('voice', 0);
    expect(ios.voice.muted).toBe(true);
  });

  it('файл из индекса не читается (error): один warn, клип failed; повторная просьба молча даёт null', () => {
    const { backend, voice, warns } = make();
    const ends: string[] = [];
    const clip = backend.playVoice(V1)!;
    clip.onEnd((how) => ends.push(how));
    voice.fire('error');
    expect(ends).toEqual(['failed']);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(V1);
    expect(backend.state().missing).toContain(V1);
    expect(backend.playVoice(V1)).toBeNull();
    expect(warns).toHaveLength(1);
    expect(backend.playVoice(V2)).not.toBeNull(); // другие клипы не затронуты
  });

  it('play() отклонён: автозапуск запрещён — failed без шума; формат/файл не поддержан — failed и один warn', async () => {
    const blocked = make();
    blocked.voice.mode = 'blocked';
    const a = blocked.backend.playVoice(V1)!;
    await flush();
    expect(a.state).toBe('failed');
    expect(blocked.warns).toEqual([]);
    expect(blocked.backend.state().missing).toEqual([]); // файл исправен — просто ждёт жеста

    const bad = make();
    bad.voice.mode = 'unsupported';
    const b = bad.backend.playVoice(V1)!;
    await flush();
    expect(b.state).toBe('failed');
    expect(bad.warns).toHaveLength(1);
    expect(bad.backend.playVoice(V1)).toBeNull();
    expect(bad.warns).toHaveLength(1);
  });

  it('отказ play() у уже остановленного клипа ничего не портит (AbortError после смены src)', async () => {
    const { backend, voice } = make();
    voice.mode = 'unsupported';
    const first = backend.playVoice(V1)!;
    voice.mode = 'ok';
    backend.stopVoice();
    await flush(); // отказ от первого play() приходит позже остановки
    expect(first.state).toBe('stopped');
    const second = backend.playVoice(V2)!;
    await flush();
    expect(second.state).toBe('playing');
  });

  it('пауза платформы: клип встаёт и продолжается с того же места; во время паузы новый не стартует (а прежний обрывается)', () => {
    const { backend, voice } = make();
    const clip = backend.playVoice(V1)!;
    backend.setPaused(true);
    expect(voice.paused).toBe(true);
    expect(clip.state).toBe('playing');
    expect(backend.playVoice(V2)).toBeNull();
    expect(clip.state).toBe('stopped');
    backend.setPaused(false);
    const again = backend.playVoice(V1)!;
    backend.setPaused(true);
    backend.setPaused(false);
    expect(voice.paused).toBe(false);
    expect(voice.src).toBe(V1);
    expect(again.state).toBe('playing');
    voice.fire('ended');
    expect(again.state).toBe('ended');
  });

  it('разблокировка iOS не трогает идущий клип; свободный элемент озвучки «отыгрывает» тишину вместе с остальными', async () => {
    const idle = make();
    idle.backend.unlock();
    await flush();
    expect(idle.voice.src).toBe(SILENT_WAV);
    expect(idle.voice.plays).toBe(1);
    expect(idle.voice.paused).toBe(true);

    const busy = make();
    const clip = busy.backend.playVoice(V1)!;
    busy.backend.unlock();
    await flush();
    expect(busy.voice.src).toBe(V1);
    expect(busy.voice.paused).toBe(false);
    expect(clip.state).toBe('playing');
    // после разблокировки этому же элементу можно играть без жеста
    busy.backend.playVoice(V2);
    expect(busy.voice.src).toBe(V2);
  });

  it('dispose обрывает клип', () => {
    const { backend } = make();
    const clip = backend.playVoice(V1)!;
    backend.dispose();
    expect(clip.state).toBe('stopped');
  });
});

describe('AudioManager: озвучка реплик', () => {
  function rig() {
    const m = make();
    const audio = new AudioManager(m.backend);
    audio.setVolumes({ music: 0.7, sfx: 0.8, voice: 0.9 });
    return { ...m, audio };
  }

  it('громкость — из настроек и множится на «общий мастер» (Mute игрока, запрет звука платформой)', () => {
    const { audio, voice } = rig();
    const clip = audio.playVoice(V1)!;
    expect(clip.state).toBe('playing');
    expect(voice.volume).toBeCloseTo(0.9, 9);
    expect(audio.voicePlaying).toBe(V1);
    audio.setVolumes({ music: 0.7, sfx: 0.8, voice: 0.5 });
    expect(voice.volume).toBeCloseTo(0.5, 9);
    audio.setMuted(true);
    expect(voice.volume).toBe(0);
    audio.setMuted(false);
    expect(voice.volume).toBeCloseTo(0.5, 9);
    audio.setPlatformEnabled(false);
    expect(voice.volume).toBe(0);
    audio.setPlatformEnabled(true);
    expect(voice.volume).toBeCloseTo(0.5, 9);
    expect(clip.state).toBe('playing'); // клип идёт беззвучно и слышен снова после включения звука
  });

  it('озвучка выключена в настройках — клип не запускается вовсе; выключение на ходу обрывает идущий', () => {
    const { audio, voice, backend } = rig();
    audio.setVoiceEnabled(false);
    expect(audio.voiceEnabled).toBe(false);
    expect(audio.voiceAudible).toBe(false);
    expect(audio.playVoice(V1)).toBeNull();
    expect(voice.plays).toBe(0);
    audio.setVoiceEnabled(true);
    const clip = audio.playVoice(V1)!;
    expect(clip.state).toBe('playing');
    audio.setVoiceEnabled(false);
    expect(clip.state).toBe('stopped');
    expect(audio.voicePlaying).toBeNull();
    expect(backend.state().voice).toBeNull();
    audio.setVoiceEnabled(true);
    expect(audio.playVoice(V2)).not.toBeNull(); // включили обратно — играет
  });

  it('Mute, запрет платформы и нулевая громкость озвучки: новые клипы не стартуют (реплика немая, авто-режим считает по тексту)', () => {
    const { audio, voice } = rig();
    audio.setMuted(true);
    expect(audio.playVoice(V1)).toBeNull();
    audio.setMuted(false);
    audio.setPlatformEnabled(false);
    expect(audio.playVoice(V1)).toBeNull();
    audio.setPlatformEnabled(true);
    audio.setVolumes({ music: 0.7, sfx: 0.8, voice: 0 });
    expect(audio.playVoice(V1)).toBeNull();
    expect(voice.plays).toBe(0);
    audio.setVolumes({ music: 0.7, sfx: 0.8, voice: 0.4 });
    expect(audio.playVoice(V1)).not.toBeNull();
  });

  it('новая просьба обрывает прежний клип, даже когда новый не стартует (Mute, озвучка выключена)', () => {
    const { audio } = rig();
    const clip = audio.playVoice(V1)!;
    audio.setMuted(true);
    expect(clip.state).toBe('playing'); // идёт беззвучно
    expect(audio.playVoice(V2)).toBeNull();
    expect(clip.state).toBe('stopped');
    expect(audio.voicePlaying).toBeNull();
  });

  it('sync (загрузка сейва, откат) и stopVoice обрывают клип; запись в журнале для QA', () => {
    const { audio } = rig();
    const clip = audio.playVoice(V1)!;
    expect(audio.log.some((l) => l === `voice ${V1}`)).toBe(true);
    audio.sync(null, null);
    expect(clip.state).toBe('stopped');
    const next = audio.playVoice(V2)!;
    audio.stopVoice();
    expect(next.state).toBe('stopped');
    expect(audio.voicePlaying).toBeNull();
  });

  it('без бэкенда (или бэкенд без озвучки) менеджер молчит и не падает', () => {
    const none = new AudioManager();
    expect(none.playVoice(V1)).toBeNull();
    expect(() => none.stopVoice()).not.toThrow();
    expect(() => none.preloadVoice([V1], 'now')).not.toThrow();
    const noVoice = new AudioManager({ play: () => undefined, stop: () => undefined, setGain: () => undefined });
    expect(noVoice.playVoice(V1)).toBeNull();
  });

  it('выключенная озвучка не прогревает клипы', () => {
    const { audio, els } = rig();
    const before = els.length;
    audio.setVoiceEnabled(false);
    audio.preloadVoice([V1, V2], 'now');
    expect(els).toHaveLength(before);
    audio.setVoiceEnabled(true);
    audio.preloadVoice([V1], 'now');
    expect(els.length).toBe(before + 1);
  });
});

describe('HtmlAudioBackend: прогрев клипов озвучки', () => {
  // у готового зонда src сбрасывается, поэтому порядок запуска читаем по первому присвоенному адресу
  const started = (els: FakeEl[], from: number): Array<string | undefined> => els.slice(from).map((e) => e.srcHistory[0]);

  it('не больше VOICE_WARM_CONCURRENCY загрузок одновременно; следующий стартует, когда предыдущий готов', async () => {
    const { backend, els } = make();
    const before = els.length;
    backend.preloadVoice([V1, V2, V3], 'idle');
    expect(VOICE_WARM_CONCURRENCY).toBe(2);
    expect(started(els, before)).toEqual([V1, V2]);
    els[before]!.fire('canplaythrough');
    await flush();
    expect(started(els, before)).toEqual([V1, V2, V3]);
  });

  it('текущий блок (now) обгоняет следующие (idle), даже если пришёл позже', async () => {
    const { backend, els } = make();
    const before = els.length;
    const idle = ['i0', 'i1', 'i2', 'i3'].map((n) => `./assets/ep01/voice/ru/${n}.mp3`);
    const now = './assets/ep01/voice/ru/n0.mp3';
    backend.preloadVoice(idle, 'idle'); // i0 и i1 уже грузятся, i2 и i3 ждут
    backend.preloadVoice([now], 'now');
    expect(started(els, before)).toEqual([idle[0], idle[1]]);
    els[before]!.fire('canplaythrough');
    await flush();
    expect(started(els, before)).toEqual([idle[0], idle[1], now]);
    els[before + 1]!.fire('canplaythrough');
    await flush();
    els[before + 2]!.fire('canplaythrough');
    await flush();
    expect(started(els, before)).toEqual([idle[0], idle[1], now, idle[2], idle[3]]);
  });

  it('повторы и уже прогретые клипы не греются дважды', async () => {
    const { backend, els } = make();
    const before = els.length;
    backend.preloadVoice([V1, V1, V2], 'now');
    expect(started(els, before)).toEqual([V1, V2]);
    els[before]!.fire('canplaythrough');
    els[before + 1]!.fire('canplaythrough');
    await flush();
    backend.preloadVoice([V2, V1], 'idle');
    expect(started(els, before)).toEqual([V1, V2]);
  });

  it('клип не читается — warn и пометка отсутствующим, очередь идёт дальше; зависшая загрузка не держит очередь', async () => {
    const { backend, els, warns, clock } = make();
    const before = els.length;
    backend.preloadVoice([V1, V2, V3], 'idle');
    els[before]!.fire('error');
    await flush();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(V1);
    expect(backend.state().missing).toContain(V1);
    expect(started(els, before)).toEqual([V1, V2, V3]); // V3 встал на освободившееся место
    clock.advance(VOICE_WARM_TIMEOUT_MS + 100); // V2 и V3 так и не ответили
    await flush();
    expect(warns).toHaveLength(1); // таймаут — не ошибка
    expect(backend.playVoice(V1)).toBeNull(); // известный битый клип не запрашивается
  });
});
