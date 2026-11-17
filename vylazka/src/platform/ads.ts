/**
 * Реклама. Сейчас её нет: решение партнёра (квиз 17.11, «Пока без рекламы») — межстраничная реклама не
 * вызывается нигде, наградной нет. Крючок оставлен выключенным (ADS.interstitial = false): если рекламу
 * включат, она будет здесь — в лимбо между сессиями, естественной паузе игры (пункт 2.1.3 требований Playgama).
 *
 * Как устроен крючок (вики Bridge: обязательный шаг 7, страница Interstitial, гайд Monetization → Best practices):
 *   - игра только отмечает паузы: showInterstitial зовётся в каждом лимбо. Своих таймеров и счётчиков нет —
 *     когда показать на самом деле (задержка перед первой рекламой, промежуток между ними, обычно 120–240 с),
 *     решает Bridge по настройкам площадки. Слишком рано — Bridge сам отвечает `failed`, и игра идёт дальше;
 *   - пока реклама открыта, игра стоит и молчит: Lifecycle по onAd, onPause и onAudio (app.ts);
 *   - следующая сессия встаёт в очередь только после ответа на просьбу о рекламе: иначе долго грузившаяся
 *     реклама открылась бы уже посреди игры;
 *   - id места показа — `limbo`: под ним Bridge пишет свою аналитику рекламы (advertisement_interstitial_*).
 * Документ — docs/vylazka/playgama.md, «Реклама».
 */
import type { IPlatform } from './types';

export interface AdFlags {
  /** Межстраничная реклама в лимбо. false — решение партнёра «пока без рекламы». */
  interstitial: boolean;
}

export const ADS: AdFlags = { interstitial: false };

/** Место показа межстраничной рекламы: лимбо между сессиями. */
export const LIMBO_PLACEMENT = 'limbo';
/** Сколько лимбо идёт до просьбы о рекламе, мс: игрок успевает увидеть итог сессии. */
export const LIMBO_BEAT_MS = 1500;

type Wait = (ms: number) => Promise<void>;
const sleep: Wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class AdBreaks {
  constructor(
    private readonly platform: Pick<IPlatform, 'capabilities' | 'showInterstitial'>,
    private readonly flags: AdFlags = ADS,
    private readonly wait: Wait = sleep,
  ) {}

  /**
   * Лимбо между сессиями. after — сколько ещё длится миг, мс (место стёрто до конца: реклама — после обрыва
   * записи, а не поверх него). Возвращает промис, который разрешается, когда реклама закрылась или не
   * показалась; null — просить рекламу не будем (выключена или площадка её не умеет), и игра идёт как без крючка.
   */
  limbo(after = 0): Promise<void> | null {
    if (!this.flags.interstitial || !this.platform.capabilities.interstitial) return null;
    return this.wait(Math.max(0, after) + LIMBO_BEAT_MS)
      .then(() => this.platform.showInterstitial(LIMBO_PLACEMENT))
      .then(
        () => undefined,
        () => undefined,
      );
  }
}
