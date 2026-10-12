/**
 * Поддельные части звука для тестов без браузера: HTMLAudioElement (FakeEl) и ручные часы (Clock).
 * Общие для tests/audio_html.test.ts и tests/voice_playback.test.ts.
 */
import type { AudioElementLike } from '../../src/stage/audio_html';

type Handler = (ev?: unknown) => void;

export class FakeEl implements AudioElementLike {
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
export class Clock {
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
