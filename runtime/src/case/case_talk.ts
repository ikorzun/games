/**
 * Разговор дела: обычный интерпретатор над эпизодом из одной сцены (case_def.talkEpisode) и короткий цикл показа —
 * те же Director, текстовое окно, выборы и документы, что у новеллы. Без сейвов, журнала и финала: на служебной
 * концовке цикл просто заканчивается. Отмена (выход в меню) обрывает ожидание реплики.
 */
import { t } from '../core/i18n';
import { Interpreter } from '../core/interpreter';
import type { Episode, ViewState } from '../core/types';
import type { SessionUI } from '../session';
import type { Director } from '../stage/director';

export interface TalkPorts {
  director: Director;
  ui: SessionUI;
  signal: AbortSignal;
  /** Кадр разговора для текстового окна (пресет показа: окно и имя говорящего). */
  setView: (view: (() => ViewState) | null) => void;
  warn?: (message: string) => void;
}

/** Промис, который при отмене завершается сразу (ожидание реплики само по себе не завершится никогда). */
function untilAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise<T | null>((resolve, reject) => {
    const onAbort = (): void => resolve(null);
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Сыграть разговор до конца (true) или до отмены (false). */
export async function playTalk(episode: Episode, ports: TalkPorts): Promise<boolean> {
  const { director, ui, signal } = ports;
  const interp = new Interpreter(episode, { ...(ports.warn ? { warn: ports.warn } : {}), lineLength: (key) => t(key).length });
  interp.start();
  ports.setView(() => interp.view);
  try {
    for (;;) {
      const r = interp.pump();
      await director.present(r, { cancelled: () => signal.aborted });
      if (signal.aborted) return false;
      const p = r.pending;
      switch (p.kind) {
        case 'line':
          await untilAbort(ui.showLine(p, { signal, read: false }), signal);
          if (signal.aborted) return false;
          interp.continue();
          break;
        case 'hold':
          await untilAbort(ui.hold(p, { signal, instant: false }), signal);
          if (signal.aborted) return false;
          interp.continue();
          break;
        case 'document':
          await untilAbort(ui.showDocument(p, { signal }), signal);
          if (signal.aborted) return false;
          interp.continue();
          break;
        case 'choice': {
          const option = await untilAbort(ui.showChoice(p, { signal }), signal);
          if (option === null) return false;
          interp.choose(option);
          break;
        }
        case 'ad_break':
          interp.continue();
          break;
        case 'minigame':
        case 'end':
          // В разговорах дела мини-игр нет (линтер), конец — служебная концовка.
          return true;
      }
    }
  } finally {
    ports.setView(null);
  }
}
