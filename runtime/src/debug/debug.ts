/**
 * window.__vn — отладочные хуки для headless-прогона (Playwright в CI, ручная проверка):
 * перейти к сцене, выставить переменную, снять состояние, пройти эпизод автопилотом
 * (docs/platform/playgama-constraints.md, «Рекомендуемые практики»).
 * Установлен и в продакшен-сборке: смоук-тест гоняет именно её.
 */
import type { App } from '../app';
import type { AutoplayPolicy, AutoplayReport } from '../core/autoplay';
import type { Settings } from '../core/settings';
import { cloneState } from '../core/state';
import type { GameState, Lang, Pending, Value, ViewState } from '../core/types';

export interface PendingSummary {
  kind: Pending['kind'];
  [key: string]: unknown;
}

export interface VnDebugApi {
  /** Версия формата API хуков. */
  readonly version: 1;
  /** Принудительно перейти к сцене (без рекламы и проверки условий блока). Партия стартует, если не идёт. */
  goto(sceneId: string): void;
  /** Записать переменную (тип и границы проверяются как у эффектов сценария). */
  set(name: string, value: Value): void;
  /** Копия состояния партии или null, если партия не запущена. */
  state(): GameState | null;
  /**
   * Пройти эпизод автоматически. Политика: 'first' | 'last' | 'random' | 'default' или
   * { choice, choices: {id → опция}, minigame, minigames: {id → результат}, seed, maxSteps }.
   * Возвращает отчёт: концовка, посещённые сцены, сделанные решения.
   */
  autoplay(policy?: AutoplayPolicy): Promise<AutoplayReport>;
  /** Новая партия, минуя меню и контент-предупреждение. */
  start(): void;
  /** Что сейчас ждёт игрока: реплика, выбор, мини-игра, финал … */
  pending(): PendingSummary | null;
  /** Снимок кадра (фон, спрайты, CG, фильтр). */
  view(): ViewState | null;
  /** Текущий язык или смена языка: await __vn.lang('es'). */
  lang(lang?: Lang): Promise<Lang>;
  /** Режим Skip. */
  skip(on: boolean): void;
  /** Настройки игрока: без аргумента — текущие, с патчем — применить (очистка как у экрана настроек). Не зависит от платформы хранения. */
  settings(patch?: Partial<Settings>): Settings;
  /** Какой рендерер сцены работает: 'pixi' или 'dom'. */
  renderer(): string;
  /**
   * Ассеты: что загружено, чего нет (по запросам игры). С `true` — ещё и проверка всех файлов из
   * episode.assets HEAD-запросами: { present, missing } (для QA после загрузки графики и звука).
   */
  assets(verify?: boolean): Promise<{ loaded: string[]; missing: string[]; pending: number; inflight: string[]; verify?: { present: string[]; missing: string[] } }>;
  /**
   * Камкордер: уровень эффектов, идёт ли цикл, последний кадр дрожания, HUD записи.
   * `camera('burst' | 'glitch' | 'reframe' | 'angle')` — вызвать помеху / разрыв кадра / поправку сейчас (QA).
   */
  camera(force?: 'burst' | 'glitch' | 'reframe' | 'angle'): {
    setting: string;
    effective: string;
    reducedMotion: boolean;
    /** Самозащита от слабого устройства выключила эффекты (меньше ≈ 20 к/с). */
    degraded: boolean;
    running: boolean;
    rec: boolean;
    transform: string;
    bursts: number[];
  };
  /** Звук: что играет, сколько файлов отмечено отсутствующими. */
  audio(): { music: string | null; ambient: string | null; audible: boolean; log: string[] };
}

declare global {
  interface Window {
    __vn?: VnDebugApi;
  }
}

function summarize(p: Pending): PendingSummary {
  switch (p.kind) {
    case 'line':
      return { kind: p.kind, style: p.style, who: p.who, key: p.key };
    case 'choice':
      return { kind: p.kind, id: p.id, options: p.options.map((o) => ({ id: o.id, enabled: o.enabled })), timer_ms: p.timer_ms, default_option: p.default_option };
    case 'minigame':
      return { kind: p.kind, id: p.def.id, type: p.def.type, skip: p.def.skip.allowed };
    case 'hold':
      return { kind: p.kind, reason: p.reason, ms: p.ms };
    case 'document':
      return { kind: p.kind, doc: p.doc };
    case 'ad_break':
      return { kind: p.kind, block: p.block };
    case 'end':
      return { kind: p.kind, ending: p.ending.id, ending_kind: p.ending.kind };
  }
}

export function installDebug(app: App): VnDebugApi {
  const api: VnDebugApi = {
    version: 1,
    goto: (sceneId) => app.debugGoto(sceneId),
    set: (name, value) => app.debugSet(name, value),
    state: () => (app.session.interp.started ? cloneState(app.session.interp.state) : null),
    autoplay: (policy) => app.debugAutoplay(policy),
    start: () => app.debugStart(),
    pending: () => {
      const p = app.session.pending;
      return p ? summarize(p) : null;
    },
    view: () => (app.session.interp.started ? (JSON.parse(JSON.stringify(app.session.interp.view)) as ViewState) : null),
    lang: async (lang) => {
      const { i18n } = await import('../core/i18n');
      if (lang) await app.setLanguage(lang);
      return i18n.lang;
    },
    skip: (on) => app.ui.setSkip(on),
    settings: (patch) => (patch ? app.updateSettings(patch) : { ...app.settings }),
    renderer: () => app.stage.renderer.kind,
    assets: async (verify) => {
      const a = app.assets;
      if (!a) return { loaded: [], missing: [], pending: 0, inflight: [] };
      const stats = a.store.stats();
      return verify ? { ...stats, verify: await a.verify() } : stats;
    },
    camera: (force) => {
      const c = app.stage.camcorder;
      if (force) c.force(force);
      const hand = app.stage.el.querySelector<HTMLElement>('.vn-stage__hand');
      return {
        setting: app.settings.cameraFx,
        effective: c.effectiveLevel,
        reducedMotion: c.reducedMotion,
        degraded: c.degradedByPerformance,
        running: c.running,
        rec: app.stage.el.classList.contains('cam-rec'),
        transform: hand?.style.transform ?? '',
        bursts: [...c.scheduler.burstLog],
      };
    },
    audio: () => ({ music: app.audio.music, ambient: app.audio.ambient, audible: app.audio.audible, log: [...app.audio.log] }),
  };
  window.__vn = api;
  return api;
}
