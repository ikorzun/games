/**
 * Озвучка реплик на стороне сцены: по реплике (ключ, явное поле `voice`, говорящий) находит клип в индексе
 * (core/voice.ts) и запускает его через звуковой выход (AudioManager → HtmlAudioBackend). Старт и остановку
 * по ходу партии ведёт DomUI: клип стартует вместе с показом реплики и обрывается, когда реплику сменили,
 * партию отменили (откат, загрузка, меню) или пошёл Skip прочитанного.
 *
 * Клипа нет — `start` возвращает null и ничего не просит у сети: игра идёт как без озвучки.
 */
import type { Episode, Lang } from '../core/types';
import { castVoicePolicies, voiceAllowed, voiceLangFor } from '../core/voice';
import type { VoiceClipRef, VoiceIndex, VoiceLineRef } from '../core/voice';
import type { VoicePlayback } from './audio';

/** То, что нужно озвучке от звука: AudioManager. */
export interface VoiceOutput {
  playVoice(url: string): VoicePlayback | null;
  stopVoice(): void;
  preloadVoice?(urls: readonly string[], priority: 'now' | 'idle'): void;
}

/** Порт озвучки для DomUI. */
export interface ILineVoice {
  /** Начать клип реплики. null — клипа нет в индексе, озвучка выключена или звук недоступен. */
  start(line: VoiceLineRef): VoicePlayback | null;
  stop(): void;
}

/** Порт прогрева клипов для BlockPreloader. */
export interface IVoiceWarmer {
  warm(lines: readonly VoiceLineRef[], priority: 'now' | 'idle'): void;
}

export interface LineVoiceOptions {
  episode: Pick<Episode, 'id' | 'cast'>;
  index: VoiceIndex;
  /** Путь относительно корня сборки → адрес файла (с учётом BASE_URL). */
  url: (path: string) => string;
  /** Текущий язык интерфейса: клип берётся на языке его озвучки (voiceLangFor: es и pt — английская). */
  lang: () => Lang;
  output: VoiceOutput;
}

export class LineVoice implements ILineVoice, IVoiceWarmer {
  private readonly policies: ReturnType<typeof castVoicePolicies>;

  constructor(private readonly o: LineVoiceOptions) {
    this.policies = castVoicePolicies(o.episode);
  }

  /** Клип реплики на языке озвучки текущего языка с учётом `cast[].voice`; null — озвучки у этой реплики нет. */
  clipFor(line: VoiceLineRef): VoiceClipRef | null {
    const lang = voiceLangFor(this.o.lang());
    if (line.who && !voiceAllowed(this.policies.get(line.who), lang)) return null;
    return this.o.index.resolve(this.o.episode.id, lang, line);
  }

  /** Адрес клипа реплики (QA и тесты). */
  urlFor(line: VoiceLineRef): string | null {
    const ref = this.clipFor(line);
    return ref ? this.o.url(ref.path) : null;
  }

  start(line: VoiceLineRef): VoicePlayback | null {
    // Озвучка — украшение: любой её сбой не должен ронять показ реплики (цикл партии не обязан про неё знать).
    try {
      const url = this.urlFor(line);
      return url ? this.o.output.playVoice(url) : null;
    } catch (e) {
      console.warn('[voice] клип реплики не запущен:', e);
      return null;
    }
  }

  stop(): void {
    this.o.output.stopVoice();
  }

  /** Прогреть клипы реплик (план блока); тех, кого нет в индексе, это не касается. */
  warm(lines: readonly VoiceLineRef[], priority: 'now' | 'idle'): void {
    try {
      const urls = new Set<string>();
      for (const line of lines) {
        const url = this.urlFor(line);
        if (url) urls.add(url);
      }
      if (urls.size > 0) this.o.output.preloadVoice?.([...urls], priority);
    } catch (e) {
      console.warn('[voice] прогрев клипов не удался:', e);
    }
  }

  /** Сколько клипов у эпизода на языке озвучки текущего языка (`__vn.audio().voice.clips`). */
  get clips(): number {
    return this.o.index.count(this.o.episode.id, voiceLangFor(this.o.lang()));
  }
}
