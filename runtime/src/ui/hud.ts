/** Отладочная панель (?debug=1 или dev-сервер): где мы в графе эпизода и что в переменных. */
import type { Session } from '../session';
import type { AudioManager } from '../stage/audio';
import type { Stage } from '../stage/stage';
import { h } from './dom';
import type { DomUI } from './dom_ui';

export class Hud {
  readonly el: HTMLElement;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly session: Session,
    private readonly stage: Stage,
    private readonly audio: AudioManager,
    private readonly ui: DomUI,
  ) {
    this.el = h('pre', { class: 'vn-hud', aria: { hidden: true } });
  }

  start(): void {
    this.update();
    this.timer = setInterval(() => this.update(), 300);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.el.remove();
  }

  private update(): void {
    const interp = this.session.interp;
    if (!interp.started) {
      this.el.textContent = `renderer: ${this.stage.renderer.kind}\n(игра не запущена)`;
      return;
    }
    const s = interp.state;
    const v = interp.view;
    const p = interp.pending;
    const vars = { ...s.globals, ...s.vars };
    this.el.textContent = [
      `renderer ${this.stage.renderer.kind} · ${v.presentation} · filter ${v.filter ?? '(preset)'}`,
      `scene ${s.scene_id} #${s.step_index} · block ${v.block}`,
      `pending ${p ? p.kind : '-'} · auto ${this.ui.autoOn ? 'on' : 'off'} · skip ${this.ui.skipOn ? 'on' : 'off'}`,
      `music ${this.audio.music ?? '-'} · amb ${this.audio.ambient ?? '-'} · audible ${this.audio.audible}`,
      `archive ${s.archive.length} · journal ${s.journal.length} · rollback ${this.session.rollbackDepth}`,
      JSON.stringify(vars),
    ].join('\n');
  }
}
