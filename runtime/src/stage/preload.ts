/**
 * Предзагрузка по блокам (docs/architecture/06 §6): при входе в блок — все ассеты его сцен
 * (фоны, спрайты, CG, документы; музыка, эмбиент и sfx греются в фоне), следующие блоки — в фоне,
 * с низким приоритетом. Игра не ждёт больше `timeoutMs`: что не успело, дозагрузится само, а пока
 * рендерер показывает чёрный кадр (идёт загрузка) или плейсхолдер (файла нет).
 *
 * Платформе сообщаем `in_game_loading_started` / `in_game_loading_stopped`, но только когда
 * загрузка действительно блокирует показ (картинки блока ещё не в памяти).
 */
import type { Episode } from '../core/types';
import { collectBlockAssets, nextBlocks } from './assets';
import type { AssetCatalog, AssetStore, BlockAssets } from './assets';

/** Прогрев аудио (реализует звуковой бэкенд). */
export interface AudioPreloader {
  preload(urls: readonly string[]): Promise<void>;
}

export interface PreloadHooks {
  /** Блокирующая загрузка затянулась — показать/убрать индикатор. */
  onLoading?(on: boolean): void;
  track?(event: 'in_game_loading_started' | 'in_game_loading_stopped'): void;
}

export interface BlockPreloaderOptions {
  episode: Episode;
  catalog: AssetCatalog;
  store: AssetStore;
  audio?: AudioPreloader | null;
  hooks?: PreloadHooks;
  /** Дольше этого вход в блок не ждёт картинки. */
  timeoutMs?: number;
  /** Через сколько мс блокирующей загрузки показать индикатор. */
  indicatorDelayMs?: number;
}

export class BlockPreloader {
  private readonly plans = new Map<string, BlockAssets>();
  private current: { block: string; done: Promise<void> } | null = null;
  private readonly timeoutMs: number;
  private readonly indicatorDelayMs: number;

  constructor(private readonly o: BlockPreloaderOptions) {
    this.timeoutMs = o.timeoutMs ?? 15000;
    this.indicatorDelayMs = o.indicatorDelayMs ?? 300;
  }

  /** План ассетов блока (кешируется). */
  plan(blockId: string): BlockAssets {
    let p = this.plans.get(blockId);
    if (!p) {
      p = collectBlockAssets(this.o.episode, this.o.catalog, blockId);
      this.plans.set(blockId, p);
    }
    return p;
  }

  /**
   * Подготовить вход в блок. Резолвится, когда картинки блока в памяти (или вышло время).
   * Повторный вызов для того же блока возвращает тот же промис, пока подготовка идёт.
   */
  enterBlock(blockId: string): Promise<void> {
    if (this.current?.block === blockId) return this.current.done;
    const done = this.run(blockId).finally(() => {
      if (this.current?.done === done) this.current = null;
    });
    this.current = { block: blockId, done };
    return done;
  }

  private async run(blockId: string): Promise<void> {
    const { store, audio, hooks } = this.o;
    const plan = this.plan(blockId);
    const nextIds = nextBlocks(this.o.episode, blockId);
    const nextPlans = nextIds.map((id) => this.plan(id));

    // В памяти держим этот блок и ближайшие следующие; остальное освобождаем.
    const keep = new Set<string>(plan.all);
    for (const p of nextPlans) for (const u of p.all) keep.add(u);
    store.retain(keep);

    if (audio && plan.audio.length > 0) void audio.preload(plan.audio).catch(() => undefined);

    const todo = plan.images.filter((c) => store.peekFirst(c.urls) === undefined);
    if (todo.length > 0) {
      hooks?.track?.('in_game_loading_started');
      let shown = false;
      const indicator = setTimeout(() => {
        shown = true;
        hooks?.onLoading?.(true);
      }, this.indicatorDelayMs);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all(todo.map((c) => store.loadFirst(c.urls, 'now'))).then(() => undefined),
          new Promise<void>((resolve) => {
            timeout = setTimeout(resolve, this.timeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(indicator);
        if (timeout !== undefined) clearTimeout(timeout);
        if (shown) hooks?.onLoading?.(false);
        hooks?.track?.('in_game_loading_stopped');
      }
    }

    // Следующие блоки — в фоне, не мешая игре.
    for (const p of nextPlans) {
      for (const c of p.images) void store.loadFirst(c.urls, 'idle');
      if (audio && p.audio.length > 0) void audio.preload(p.audio).catch(() => undefined);
    }
  }
}
