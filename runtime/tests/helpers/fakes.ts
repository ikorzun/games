/**
 * Заглушки портов для тестов без DOM. Все заглушки пишут в общую хронологию (Timeline),
 * чтобы проверять не только что вызвано, но и в каком порядке.
 */
import type { StoragePort } from '../../src/core/saves';
import type {
  ChoicePending,
  DocumentPending,
  EndPending,
  GameState,
  HoldPending,
  LinePending,
  MinigamePending,
  MinigameResult,
  FxKind,
  SpriteView,
  StageFilter,
  TransitionKind,
  ViewState,
} from '../../src/core/types';
import type { IPlatform, TrackData } from '../../src/platform/types';
import type { BaseContext, HoldContext, LineContext, MinigameContext, SessionUI } from '../../src/session';
import type { AudioEventPayload, CaptionEventPayload, IAudioSink, ICaptionSink, IStage } from '../../src/stage/types';

export type Timeline = string[];

export class FakeStage implements IStage {
  constructor(private readonly t: Timeline) {}
  setView(view: ViewState): void {
    this.t.push(`stage:setView:${view.scene}`);
  }
  async changeScene(view: ViewState, transition: TransitionKind): Promise<void> {
    await Promise.resolve();
    this.t.push(`stage:changeScene:${view.scene}:${transition}`);
  }
  async fadeToBlackAndHold(transition: TransitionKind): Promise<void> {
    await Promise.resolve();
    this.t.push(`stage:fadeToBlackAndHold:${transition}`);
  }
  async revealFromBlack(view: ViewState, transition: TransitionKind): Promise<void> {
    await Promise.resolve();
    this.t.push(`stage:revealFromBlack:${view.scene}:${transition}`);
  }
  showSprite(sprite: SpriteView, existing: boolean, transition: TransitionKind): void {
    this.t.push(`stage:show:${sprite.who}:${existing ? 'update' : 'new'}:${transition}`);
  }
  hideSprite(who: string, transition: TransitionKind): void {
    this.t.push(`stage:hide:${who}:${transition}`);
  }
  async changeBackground(bg: string, filter: StageFilter | null, transition: TransitionKind): Promise<void> {
    await Promise.resolve();
    this.t.push(`stage:bg:${bg}:${filter ?? '-'}:${transition}`);
  }
  async showCg(cg: string, transition: TransitionKind): Promise<void> {
    await Promise.resolve();
    this.t.push(`stage:cg:${cg}:${transition}`);
  }
  async hideCg(transition: TransitionKind): Promise<void> {
    await Promise.resolve();
    this.t.push(`stage:cgHide:${transition}`);
  }
  async showShot(shot: string | null, transition: TransitionKind): Promise<void> {
    await Promise.resolve();
    this.t.push(`stage:shot:${shot ?? '-'}:${transition}`);
  }
  setSpeaker(who: string | null): void {
    this.t.push(`stage:speaker:${who ?? '-'}`);
  }
  async playFx(fx: FxKind): Promise<void> {
    this.t.push(`stage:fx:${fx}`);
  }
}

export class FakeAudio implements IAudioSink {
  constructor(private readonly t: Timeline) {}
  handle(ev: AudioEventPayload): void {
    this.t.push(`audio:${ev.kind}:${ev.id ?? '-'}`);
  }
  sync(music: string | null, ambient: string | null): void {
    this.t.push(`audio:sync:${music ?? '-'}:${ambient ?? '-'}`);
  }
}

export class FakeCaptions implements ICaptionSink {
  constructor(private readonly t: Timeline) {}
  show(ev: CaptionEventPayload): void {
    this.t.push(`caption:${ev.style}:${ev.key}`);
  }
  clear(): void {
    this.t.push('caption:clear');
  }
}

/** Хранилище в памяти с глубоким копированием значений (как JSON-сериализация настоящих платформ). */
export class MemoryStorage implements StoragePort {
  readonly data = new Map<string, unknown>();
  saves = 0;
  async save(keys: string[], values: unknown[]): Promise<void> {
    this.saves += 1;
    keys.forEach((k, i) => this.data.set(k, JSON.parse(JSON.stringify(values[i]))));
  }
  async load(keys: string[]): Promise<unknown[]> {
    return keys.map((k) => (this.data.has(k) ? JSON.parse(JSON.stringify(this.data.get(k))) : null));
  }
}

export class FakePlatform implements IPlatform {
  readonly id = 'web-plain' as const;
  readonly capabilities = { manualSlots: 3, interstitial: true, rewarded: true };
  readonly storage = new MemoryStorage();
  readonly tracked: Array<{ event: string; data: TrackData | undefined }> = [];
  ads = 0;
  readyCalls = 0;

  constructor(
    private readonly t: Timeline = [],
    private readonly adResult: () => Promise<boolean> = () => Promise.resolve(true),
  ) {}

  language(): 'en' {
    return 'en';
  }
  save(keys: string[], values: unknown[]): Promise<void> {
    return this.storage.save(keys, values);
  }
  load(keys: string[]): Promise<unknown[]> {
    return this.storage.load(keys);
  }
  async showInterstitial(): Promise<boolean> {
    this.ads += 1;
    this.t.push('ad:start');
    const shown = await this.adResult();
    this.t.push('ad:end');
    return shown;
  }
  async showRewarded(): Promise<boolean> {
    return true;
  }
  onPause(): () => void {
    return () => undefined;
  }
  onAudio(cb: (enabled: boolean) => void): () => void {
    cb(true);
    return () => undefined;
  }
  ready(): void {
    this.readyCalls += 1;
  }
  track(event: string, data?: TrackData): void {
    this.tracked.push({ event, data });
  }
}

export interface FakeUIOptions {
  /** Выбор по умолчанию — первая доступная опция. */
  choose?: (p: ChoicePending) => string;
  /** Результат мини-игры по умолчанию — success. */
  minigame?: (p: MinigamePending) => MinigameResult;
  /** Реплики ждут явного разрешения теста (release()). */
  manualLines?: boolean;
}

export interface WaitingLine {
  p: LinePending;
  read: boolean;
  release: () => void;
}

export class FakeUI implements SessionUI {
  fastForward = false;
  paused = false;
  resets = 0;
  readonly lines: Array<{ p: LinePending; read: boolean }> = [];
  readonly waiting: WaitingLine[] = [];
  readonly choices: Array<{ id: string; option: string }> = [];
  readonly minigames: Array<{ id: string; restore: unknown }> = [];
  readonly endings: Array<{ ending: string; journal: number; state: GameState }> = [];
  readonly holds: HoldPending[] = [];
  readonly documents: DocumentPending[] = [];
  activeMinigame: { id: string; state: unknown } | null = null;

  constructor(
    private readonly t: Timeline,
    private readonly opts: FakeUIOptions = {},
  ) {}

  showLine(p: LinePending, ctx: LineContext): Promise<void> {
    this.t.push(`ui:line:${p.key}`);
    this.lines.push({ p, read: ctx.read });
    if (!this.opts.manualLines) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waiting.push({ p, read: ctx.read, release: resolve });
    });
  }

  async showChoice(p: ChoicePending, _ctx: BaseContext): Promise<string> {
    const option = this.opts.choose ? this.opts.choose(p) : (p.options.find((o) => o.enabled)?.id ?? '');
    this.choices.push({ id: p.id, option });
    this.t.push(`ui:choice:${p.id}=${option}`);
    return option;
  }

  async hold(p: HoldPending, _ctx: HoldContext): Promise<void> {
    this.holds.push(p);
  }

  async showDocument(p: DocumentPending, _ctx: BaseContext): Promise<void> {
    this.documents.push(p);
  }

  async runMinigame(p: MinigamePending, ctx: MinigameContext): Promise<MinigameResult> {
    this.minigames.push({ id: p.def.id, restore: ctx.restore });
    this.t.push(`ui:minigame:${p.def.id}`);
    return this.opts.minigame ? this.opts.minigame(p) : 'success';
  }

  async showEnding(p: EndPending, state: Readonly<GameState>): Promise<void> {
    this.t.push(`ui:ending:${p.ending.id}`);
    this.endings.push({ ending: p.ending.id, journal: state.journal.length, state: JSON.parse(JSON.stringify(state)) as GameState });
  }

  minigameState(): { id: string; state: unknown } | null {
    return this.activeMinigame;
  }

  reset(): void {
    this.resets += 1;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /** Ждать, пока интерфейс покажет n-ю по счёту реплику (для тестов с manualLines). */
  async untilLines(n: number): Promise<void> {
    for (let i = 0; i < 200 && this.lines.length < n; i++) await new Promise((r) => setTimeout(r, 0));
    if (this.lines.length < n) throw new Error(`реплик показано ${this.lines.length}, ожидали ${n}`);
  }

  /** Разрешить самую свежую ожидающую реплику. */
  releaseLatest(): void {
    const w = this.waiting.pop();
    if (!w) throw new Error('нет ожидающей реплики');
    w.release();
  }
}
