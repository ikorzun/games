/**
 * Director — режиссёр показа: превращает события интерпретатора (PumpResult.events) в вызовы
 * сцены, звука, титров и тостов. Без DOM и таймеров — порядок проверяется юнит-тестами.
 *
 * ПРАВИЛО РЕКЛАМНОЙ ПАУЗЫ. Интерпретатор входит в блок с ad_break_allowed раньше, чем
 * просит рекламу: в одном PumpResult приходят событие `scene` новой сцены и pending
 * `ad_break` (состояние уже в новой сцене — на этом держатся сейвы, интерпретатор не меняем).
 * Для Playgama интерстишл должен идти на границе блока поверх чёрного кадра, поэтому Director:
 *   1. НЕ показывает новую сцену, а гасит старую в чёрный (fade / slow_fade) и УДЕРЖИВАЕТ
 *      чёрный кадр (IStage.fadeToBlackAndHold);
 *   2. пока идёт реклама, остальные события пачки (музыка нового блока) откладываются,
 *      а checkpoint (автосейв) выполняется сразу — сейв уже указывает на новую сцену;
 *   3. проявление новой сцены (IStage.revealFromBlack) происходит только в release(),
 *      который вызывается ПОСЛЕ interp.continue() по окончании рекламы.
 * Правило действует для любого перехода входа в блок (fade и slow_fade — как договорено;
 * vhs_glitch, dissolve и прочие тоже гасятся в чёрный, иначе новая сцена попала бы на экран
 * до рекламы). Если игрок загрузил другой сейв во время удержания — reset() снимает его.
 */
import type { EngineEvent, PumpResult, TransitionKind, ViewState } from '../core/types';
import type { IAudioSink, ICaptionSink, IStage } from './types';

/** Порт предзагрузки ассетов: вход в блок ждёт картинки блока (но не дольше таймаута), следующие блоки греются в фоне. */
export interface IBlockLoader {
  enterBlock(blockId: string): Promise<void>;
}

export interface DirectorSinks {
  stage: IStage;
  audio: IAudioSink;
  captions: ICaptionSink;
  /** Предзагрузка ассетов по блокам (без неё сцена просто показывает то, что успело загрузиться). */
  loader?: IBlockLoader;
  /** checkpoint-события интерпретатора: границы блоков и решения. */
  checkpoint: (reason: 'block' | 'choice' | 'minigame') => void;
  /** Новый архивный материал открыт (общий архив профиля); toast — сценарий хочет, чтобы игрок это заметил. */
  archiveUnlocked?: (item: string, toast: boolean) => void;
}

export interface PresentOptions {
  /** Skip / автопилот: без анимаций. */
  instant?: boolean;
  /** Партию отменили (загрузка, откат): оставшиеся события применять нельзя. */
  cancelled?: () => boolean;
}

interface HeldScene {
  view: ViewState;
  transition: TransitionKind;
  deferred: EngineEvent[];
  /** Подготовка ассетов нового блока, запущенная на время рекламы. */
  prep: Promise<void>;
}

/** События, меняющие картинку: при удержании чёрного кадра промежуточные из них не нужны. */
function isVisual(ev: EngineEvent): boolean {
  return ev.t === 'scene' || ev.t === 'show' || ev.t === 'hide' || ev.t === 'bg' || ev.t === 'cg' || ev.t === 'cg_hide' || ev.t === 'shot' || ev.t === 'speaker';
}

export class Director {
  private held: HeldScene | null = null;

  constructor(private readonly sinks: DirectorSinks) {}

  /** Чёрный кадр удерживается до release() (идёт или предстоит реклама). */
  get holdingBlack(): boolean {
    return this.held !== null;
  }

  async present(result: PumpResult, opts: PresentOptions = {}): Promise<void> {
    const instant = opts.instant === true;
    const { events, pending } = result;

    // Индекс последнего события scene — именно оно вводит блок, перед которым стоит реклама.
    let adScene = -1;
    if (pending.kind === 'ad_break') {
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i]?.t === 'scene') {
          adScene = i;
          break;
        }
      }
    }

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (!ev) continue;
      if (opts.cancelled?.()) return;
      if (adScene >= 0) {
        // Промежуточные кадры цепочки неблокирующих переходов перед рекламой показывать незачем.
        if (i < adScene && isVisual(ev)) continue;
        if (i === adScene && ev.t === 'scene') {
          this.sinks.captions.clear();
          // Пока экран гаснет и идёт реклама, картинки нового блока грузятся.
          const prep = this.prepare(ev.view.block);
          await this.sinks.stage.fadeToBlackAndHold(ev.transition, instant);
          if (opts.cancelled?.()) return;
          const rest = events.slice(i + 1);
          for (const r of rest) if (r.t === 'checkpoint') this.sinks.checkpoint(r.reason);
          this.held = { view: ev.view, transition: ev.transition, deferred: rest.filter((r) => r.t !== 'checkpoint'), prep };
          return;
        }
      }
      await this.apply(ev, instant);
    }
  }

  /** Реклама закончилась и interp.continue() вызван: проявить удержанную сцену. */
  async release(opts: PresentOptions = {}): Promise<void> {
    const held = this.held;
    if (!held) return;
    this.held = null;
    const instant = opts.instant === true;
    await held.prep;
    if (opts.cancelled?.()) return;
    await this.sinks.stage.revealFromBlack(held.view, held.transition, instant);
    for (const ev of held.deferred) {
      if (opts.cancelled?.()) return;
      await this.apply(ev, instant);
    }
  }

  /** Сбросить показ (загрузка, откат, отмена партии); view — кадр, который нужно выставить. */
  reset(view: ViewState | null): void {
    this.held = null;
    this.sinks.captions.clear();
    if (view) {
      void this.prepare(view.block); // догрузка картинок блока; рендерер показывает их по мере готовности
      this.sinks.stage.setView(view);
      this.sinks.audio.sync(view.music, view.ambient);
    }
  }

  /** Подготовка блока (никогда не отклоняется: сбой загрузки — не повод ронять показ). */
  private prepare(blockId: string): Promise<void> {
    const loader = this.sinks.loader;
    if (!loader) return Promise.resolve();
    return loader.enterBlock(blockId).catch(() => undefined);
  }

  private async apply(ev: EngineEvent, instant: boolean): Promise<void> {
    const { stage, audio, captions } = this.sinks;
    switch (ev.t) {
      case 'scene':
        captions.clear();
        if (ev.newBlock) await this.prepare(ev.view.block);
        await stage.changeScene(ev.view, ev.transition, instant);
        break;
      case 'caption':
        captions.show(ev);
        break;
      case 'show':
        stage.showSprite(ev.sprite, ev.existing, ev.transition, instant);
        break;
      case 'hide':
        stage.hideSprite(ev.who, ev.transition, instant);
        break;
      case 'bg':
        await stage.changeBackground(ev.bg, ev.filter, ev.transition, instant);
        break;
      case 'cg':
        await stage.showCg(ev.cg, ev.transition, instant);
        break;
      case 'cg_hide':
        await stage.hideCg(ev.transition, instant);
        break;
      case 'shot':
        await stage.showShot(ev.shot, ev.transition, instant);
        break;
      case 'speaker':
        stage.setSpeaker(ev.who);
        break;
      case 'audio':
        audio.handle(ev);
        break;
      case 'archive':
        // Тоста «Новый материал» нет (решение владельца 2026-10-13): метка — в шапке документа и на кнопке блокнота.
        this.sinks.archiveUnlocked?.(ev.item, ev.toast);
        break;
      case 'checkpoint':
        this.sinks.checkpoint(ev.reason);
        break;
    }
  }
}
