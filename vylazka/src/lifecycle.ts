/**
 * Единая пауза. Причины складываются: площадка (реклама, событие Bridge), скрытая вкладка,
 * пауза игрока, потеря захвата мыши, загрузка. Игра идёт, только когда причин нет.
 * Esc игрой не используется (правило площадки): пауза — клавиша P и потеря захвата мыши.
 */
export type PauseReason = 'boot' | 'platform' | 'hidden' | 'user' | 'pointer' | 'ad' | 'context';

type Listener = (paused: boolean) => void;

export class Lifecycle {
  private readonly reasons = new Set<PauseReason>();
  private readonly listeners = new Set<Listener>();

  get paused(): boolean {
    return this.reasons.size > 0;
  }

  has(reason: PauseReason): boolean {
    return this.reasons.has(reason);
  }

  list(): PauseReason[] {
    return [...this.reasons];
  }

  set(reason: PauseReason, on: boolean): void {
    const before = this.paused;
    if (on) this.reasons.add(reason);
    else this.reasons.delete(reason);
    if (this.paused !== before) for (const cb of [...this.listeners]) cb(this.paused);
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
