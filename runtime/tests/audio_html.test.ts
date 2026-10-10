/**
 * Звук: HtmlAudioBackend (HTMLAudioElement, mp3/m4a) и AudioManager. Элементы, часы и таймеры подменены,
 * поэтому кроссфейд, затухание, пул sfx, mute, пауза, разблокировка iOS и отсутствующие файлы
 * проверяются детерминированно, без браузера.
 */
import { describe, expect, it, vi } from 'vitest';
import { AudioManager } from '../src/stage/audio';
import type { IAudioBackend } from '../src/stage/audio';
import { FADE_STEP_MS, HtmlAudioBackend, SFX_POOL, SILENT_WAV } from '../src/stage/audio_html';
import type { AudioElementLike } from '../src/stage/audio_html';

type Handler = (ev?: unknown) => void;

class FakeEl implements AudioElementLike {
  loop = false;
  muted = false;
  currentTime = 0;
  preload = '';
  paused = true;
  plays = 0;
  pauses = 0;
  readonly srcHistory: string[] = [];
  /** Как отвечает play(): ok / blocked (автозапуск запрещён) / unsupported (файла нет). */
  mode: 'ok' | 'blocked' | 'unsupported' = 'ok';
  private _src = '';
  private _volume = 1;
  private readonly handlers = new Map<string, Set<Handler>>();

  constructor(private readonly lockedVolume = false) {}

  get src(): string {
    return this._src;
  }
  set src(v: string) {
    this._src = v;
    this.srcHistory.push(v);
  }
  get volume(): number {
    return this._volume;
  }
  set volume(v: number) {
    if (!this.lockedVolume) this._volume = v; // iPhone: громкость элемента не меняется
  }
  play(): Promise<void> {
    this.plays += 1;
    if (this.mode === 'blocked') return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    if (this.mode === 'unsupported') return Promise.reject(Object.assign(new Error('unsupported'), { name: 'NotSupportedError' }));
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
    this.pauses += 1;
  }
  load(): void {
    /* ничего */
  }
  removeAttribute(name: string): void {
    if (name === 'src') this._src = '';
  }
  addEventListener(type: string, cb: Handler): void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(cb);
  }
  removeEventListener(type: string, cb: Handler): void {
    this.handlers.get(type)?.delete(cb);
  }
  fire(type: string): void {
    for (const cb of [...(this.handlers.get(type) ?? [])]) cb();
  }
  listeners(type: string): number {
    return this.handlers.get(type)?.size ?? 0;
  }
}

/** Ручные часы: таймеры срабатывают по порядку при advance(). */
class Clock {
  t = 0;
  private id = 0;
  private timers: Array<{ id: number; at: number; cb: () => void }> = [];
  now = (): number => this.t;
  setTimer = (cb: () => void, ms: number): number => {
    const id = ++this.id;
    this.timers.push({ id, at: this.t + ms, cb });
    return id;
  };
  clearTimer = (h: unknown): void => {
    this.timers = this.timers.filter((x) => x.id !== h);
  };
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((x) => x !== due);
      this.t = due.at;
      due.cb();
    }
    this.t = end;
  }
}

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
  // порядок создания в конструкторе: музыка ×2, эмбиент ×2, sfx ×SFX_POOL
  const music = els.slice(0, 2);
  const ambient = els.slice(2, 4);
  const sfx = els.slice(4, 4 + SFX_POOL);
  return { backend, clock, els, music, ambient, sfx, warns };
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
