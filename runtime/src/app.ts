/**
 * App — склейка всего: каркас интерфейса, сцена, Session, DomUI, платформа, сейвы, настройки,
 * меню и экраны. Здесь же маршрутизация быстрого меню и смена языка на лету.
 */
import type { CaseDef } from './case/case_def';
import { CaseMode } from './case/case_mode';
import type { AutoplayPolicy, AutoplayReport } from './core/autoplay';
import { i18n, t } from './core/i18n';
import type { SeasonInfo } from './core/loader';
import type { SaveFile, SaveManager } from './core/saves';
import type { Settings } from './core/settings';
import type { ArchiveItem, Episode, Lang, Value, ViewState } from './core/types';
import type { IPlatform } from './platform/types';
import { Session } from './session';
import type { RunOutcome } from './session';
import type { AppAssets } from './stage/app_assets';
import { NO_ASSETS } from './stage/assets';
import type { AudioManager } from './stage/audio';
import { Director } from './stage/director';
import { createStage } from './stage/stage_factory';
import type { RendererChoice } from './stage/stage_factory';
import type { Stage } from './stage/stage';
import type { ICaptionSink } from './stage/types';
import type { LineVoice } from './stage/voice';
import { CaptionLayer } from './ui/captions';
import { DomUI } from './ui/dom_ui';
import { Hud } from './ui/hud';
import { UiKit } from './ui/kit';
import type { QuickAction } from './ui/quick_menu';
import {
  ArchiveScreen,
  DocumentScreen,
  ErrorScreen,
  LogScreen,
  MenuScreen,
  SaveLoadScreen,
  SettingsScreen,
  WarningScreen,
} from './ui/screens';
import type { MenuSeason } from './ui/screens';

export interface AppInit {
  root: HTMLElement;
  platform: IPlatform;
  saves: SaveManager;
  episode: Episode;
  contentVersion: string;
  audio: AudioManager;
  /** Озвучка реплик (клипы по индексу voice-index.json); без неё реплики немые. */
  voice?: LineVoice;
  /** Ассеты эпизода (картинки, предзагрузка по блокам, картинки интерфейса); без них игра рисует плейсхолдеры. */
  assets?: AppAssets;
  /** Догрузить строки языка (и цепочку его фолбэков), если их ещё нет. */
  loadLang: (lang: Lang) => Promise<void>;
  /** Рамка сезона для полки эпизодов главного меню (episodes/s<N>/season.json); нет — только текущий эпизод. */
  season?: SeasonInfo | null;
  /** Дело эпизода (режим поиска улик, docs/architecture/09-case-mode.md); есть — клик по эпизоду открывает папку дела. */
  caseDef?: CaseDef | null;
  renderer?: RendererChoice;
  debug?: boolean;
}

/** id главной темы передачи в assets.music (общие ассеты). */
const THEME_MUSIC = 'm_theme_main';

export class App {
  readonly kit: UiKit;
  readonly stage: Stage;
  readonly captions: CaptionLayer;
  readonly director: Director;
  readonly ui: DomUI;
  readonly session: Session;

  /** Режим дела; null — эпизод играется как новелла. */
  readonly caseMode: CaseMode | null = null;

  private hud: Hud | null = null;
  /** Кадр разговора дела для текстового окна (у разговоров свой интерпретатор). */
  private talkView: (() => ViewState) | null = null;
  private settingsScreen: SettingsScreen | null = null;
  private settingsOpen = false;
  /**
   * Записи блокнота, пришедшие с тех пор, как игрок его открывал: метка на кнопке «Блокнот» и штамп на бумажке.
   * Только в памяти партии: после загрузки сейва и в архиве меню ничего не помечено.
   */
  private readonly freshNotes = new Set<string>();

  /** Собрать приложение: каркас → сцена (PixiJS или DOM) → всё остальное. */
  static async create(init: AppInit): Promise<App> {
    // Быстрое меню создаётся до App, поэтому обращается к нему через замыкание.
    let app: App | null = null;
    const kit = new UiKit(init.root, (a) => app?.onAction(a));
    const stage = await createStage(kit.main, init.renderer ?? 'auto', init.assets?.scene ?? NO_ASSETS);
    app = new App(init, kit, stage);
    return app;
  }

  private constructor(
    private readonly d: AppInit,
    kit: UiKit,
    stage: Stage,
  ) {
    const ep = d.episode;
    this.kit = kit;
    this.stage = stage;
    this.captions = new CaptionLayer(stage.captionsEl);
    this.captions.setPlate(d.assets?.art.plate ?? null);

    // Титры и текстовое окно принадлежат сцене: при смене сцены очищаются вместе.
    const captionSink: ICaptionSink = {
      show: (ev) => this.captions.show(ev),
      clear: () => {
        this.captions.clear();
        this.kit.textbox.hide();
      },
    };
    this.director = new Director({
      stage,
      audio: d.audio,
      ...(d.assets ? { loader: d.assets.preloader } : {}),
      captions: captionSink,
      checkpoint: (reason) => this.session.autosave(reason),
      archiveUnlocked: (item, toast) => {
        d.saves.unlockArchive(ep.id, item);
        if (toast) this.markNote(item);
      },
    });
    this.ui = new DomUI({
      episode: ep,
      kit,
      stage,
      captions: this.captions,
      platform: d.platform,
      settings: () => d.saves.settings,
      view: () => this.talkView?.() ?? (this.session.interp.started ? this.session.interp.view : null),
      env: () => (this.session.interp.started ? this.session.interp.env() : {}),
      onOpenArchive: () => this.openArchive(),
      onAction: (a) => this.onAction(a),
      onRollback: () => this.rollback(1),
      ...(d.assets ? { documentArt: (id: string) => d.assets!.document(id), portraitArt: (who: string) => d.assets!.catalog.portraitUrl(who) } : {}),
      ...(d.voice ? { voice: d.voice } : {}),
    });
    this.session = new Session({
      episode: ep,
      contentVersion: d.contentVersion,
      platform: d.platform,
      saves: d.saves,
      ui: this.ui,
      director: this.director,
      warn: (m) => console.warn(`[engine] ${m}`),
      onEnded: () => this.showMenu(),
      onError: (e) => this.showError(e),
    });

    this.applySettings(d.saves.settings);
    document.documentElement.lang = i18n.lang;
    document.title = t(ep.title_key);

    // Индикатор загрузки блока и телеметрия платформы (in_game_loading_started / stopped).
    if (d.assets) {
      d.assets.hooks.onLoading = (on) => kit.setLoading(on);
      d.assets.hooks.track = (event) => d.platform.track(event);
    }

    // Платформа: пауза (реклама, вкладка в фоне) и разрешение звука.
    d.platform.onPause((paused) => {
      this.session.setPaused(paused);
      this.stage.setPaused(paused);
      d.audio.setPaused(paused);
    });
    d.platform.onAudio((enabled) => d.audio.setPlatformEnabled(enabled));
    window.addEventListener('pagehide', () => this.persist());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.persist();
    });
    kit.screens.onChange(() => this.trackSettingsPause());
    i18n.onChange(() => this.ui.refreshLanguage());

    if (d.caseDef) {
      this.caseMode = new CaseMode({
        def: d.caseDef,
        episode: ep,
        kit,
        ui: this.ui,
        // Свой режиссёр: у сцен дела нет блоков эпизода, предзагрузка по блокам им не нужна (картинки грузит сцена).
        director: new Director({ stage, audio: d.audio, captions: captionSink, checkpoint: () => undefined }),
        saves: d.saves,
        platform: d.platform,
        settings: () => d.saves.settings,
        url: (path) => d.assets?.catalog.url(path) ?? path,
        setTalkView: (view) => (this.talkView = view),
        setInGame: (on) => this.kit.root.classList.toggle('in-game', on),
        onMenu: () => this.showMenu(),
      });
    }

    if (d.debug) {
      this.hud = new Hud(this.session, stage, d.audio, this.ui);
      kit.root.appendChild(this.hud.el);
      this.hud.start();
    }
  }

  // ───────────────────────────── вход в игру ─────────────────────────────

  /**
   * Главная тема передачи в главном меню (m_theme_main из общих ассетов); в партии музыкой управляет сценарий.
   * Если браузер запрещает автозапуск звука без жеста, бэкенд помечает трек заблокированным и включает его при
   * первом касании, клике или клавише на странице (HtmlAudioBackend.installUnlock).
   */
  private playTheme(): void {
    const has = (this.d.episode.assets.music ?? []).some((m) => m.id === THEME_MUSIC);
    if (!has || this.d.audio.music === THEME_MUSIC) return;
    this.d.audio.handle({ t: 'audio', kind: 'music', id: THEME_MUSIC, fade_ms: 600, loop: true, volume: 1 });
  }

  /** Показать главное меню (при запуске, после финала). */
  showMenu(): void {
    this.caseMode?.stop();
    this.session.cancel();
    this.kit.screens.closeAll();
    this.clearNotes();
    this.kit.root.classList.remove('in-game');
    this.ui.setSkip(false);
    if (this.ui.autoOn) this.ui.toggleAuto();
    this.ui.setUiHidden(false);
    this.playTheme();
    const ep = this.d.episode;
    const saves = this.d.saves;
    const season = this.menuSeason();
    const cm = this.caseMode;
    const menu = new MenuScreen(ep, {
      ...(this.d.assets ? { art: this.d.assets.art } : {}),
      ...(season ? { season } : {}),
      hasContinue: () => (cm ? cm.started : this.continuable() !== null),
      completed: () => (cm ? cm.completed : (saves.profile.endings[ep.id]?.length ?? 0) > 0),
      onContinue: () => (cm ? this.openCase() : this.continueGame()),
      onNew: () => (cm ? this.newCase() : void this.startNewGame()),
      onArchive: () => this.openArchive(),
      onSettings: () => this.openSettings(),
      onLanguage: (lang) => void this.setLanguage(lang),
    });
    this.kit.screens.open(menu);
  }

  /**
   * Полка эпизодов: слоты рамки сезона с обложками; открыт слот текущего эпизода, остальные — «скоро». Слот ищется по
   * номеру: у эпизода 1 есть прежние варианты (новелла и режим дела), их открывают по адресу ?episode=ep01_murylev.
   */
  private menuSeason(): MenuSeason | null {
    const s = this.d.season;
    if (!s) return null;
    const cover = (p?: string): string | null => (p ? (this.d.assets?.catalog.url(p) ?? p) : null);
    return {
      n: s.season,
      titleKey: s.title_key,
      years: s.years ?? null,
      slots: s.episodes.map((x) => ({ order: x.order, year: x.year ?? null, current: x.order === this.d.episode.order, cover: cover(x.cover) })),
    };
  }

  private continuable(): SaveFile | null {
    const f = this.d.saves.autosave;
    return f && f.state.episode_id === this.d.episode.id ? f : null;
  }

  /** «Новая игра»: сначала экран «Основано на реальных событиях», затем партия. */
  async startNewGame(opts: { skipWarning?: boolean } = {}): Promise<void> {
    if (!opts.skipWarning) {
      this.openWarning(() => this.beginGame(() => this.session.newGame()));
      return;
    }
    this.beginGame(() => this.session.newGame());
  }

  /** Дело с начала: экран «Основано на реальных событиях», прогресс дела сбрасывается, вступление главы. */
  newCase(opts: { skipWarning?: boolean } = {}): void {
    const go = (): void => {
      this.caseMode?.reset();
      this.openCase();
    };
    if (!opts.skipWarning) this.openWarning(go);
    else go();
  }

  /** Папка дела (продолжение с того места, где игрок остановился). */
  openCase(): void {
    if (!this.caseMode) return;
    this.session.cancel();
    this.kit.screens.closeAll();
    this.kit.root.classList.remove('in-game');
    void this.caseMode.enter();
  }

  continueGame(): void {
    const file = this.continuable();
    if (!file) {
      void this.startNewGame();
      return;
    }
    this.beginGame(() => this.session.loadSave(file));
  }

  loadFile(file: SaveFile): void {
    this.beginGame(() => this.session.loadSave(file));
  }

  private beginGame(start: () => Promise<RunOutcome>): void {
    // Тема меню уступает место музыке сценария (первая сцена включит свою, если она задана).
    if (this.d.audio.music === THEME_MUSIC) this.d.audio.handle({ t: 'audio', kind: 'stop_music', id: null, fade_ms: 600, loop: false, volume: 0 });
    this.kit.screens.closeAll();
    this.clearNotes();
    this.kit.root.classList.add('in-game');
    void start().then((outcome) => {
      if (outcome.reason === 'rejected') {
        console.warn('[app] сейв отклонён:', outcome.detail);
        this.kit.toasts.push(`${t('ui.save.empty')} (${outcome.detail})`);
        this.showMenu();
      }
    });
  }

  private openWarning(onGo: () => void): void {
    const saves = this.d.saves;
    const screen: WarningScreen = new WarningScreen(this.d.episode, {
      settings: () => saves.settings,
      onContinue: onGo,
      onBack: () => this.kit.screens.close(screen),
      logo: this.d.assets?.art.logo ?? null,
    });
    this.kit.screens.open(screen);
  }

  // ───────────────────────────── быстрое меню и экраны ─────────────────────────────

  private get inGame(): boolean {
    return this.kit.root.classList.contains('in-game');
  }

  onAction(action: QuickAction): void {
    if (!this.inGame && action !== 'settings' && action !== 'mute') return;
    switch (action) {
      case 'auto':
        this.ui.toggleAuto();
        break;
      case 'skip':
        this.ui.toggleSkip();
        break;
      case 'log':
        this.openLog();
        break;
      case 'notebook':
        this.openArchive('ui.quick.notebook');
        break;
      case 'save':
        this.openSaveLoad('save');
        break;
      case 'load':
        this.openSaveLoad('load');
        break;
      case 'mute':
        this.updateSettings({ muted: !this.d.saves.settings.muted });
        break;
      case 'settings':
        this.openSettings();
        break;
      case 'hide':
        this.ui.toggleHidden();
        break;
    }
  }

  openSettings(): void {
    if (this.settingsScreen && this.kit.screens.has(this.settingsScreen)) return;
    const screen: SettingsScreen = new SettingsScreen({
      settings: () => this.d.saves.settings,
      reducedMotion: () => this.stage.camcorder.reducedMotion,
      effectiveCameraFx: () => this.stage.camcorder.effectiveLevel,
      onChange: (patch) => this.updateSettings(patch),
      onLanguage: (lang) => void this.setLanguage(lang),
      onClose: () => this.kit.screens.close(screen),
      // Сохранение и загрузка — только в партии новеллы: у разговора дела своего сейва нет, а загрузка запустила бы
      // вторую партию поверх него.
      inGame: () => this.inGame && this.session.interp.started,
      muted: () => this.d.saves.settings.muted,
      onSave: () => this.openSaveLoad('save'),
      onLoad: () => this.openSaveLoad('load'),
      onMute: () => this.updateSettings({ muted: !this.d.saves.settings.muted }),
    });
    this.settingsScreen = screen;
    this.kit.screens.open(screen);
  }

  openLog(): void {
    const screen: LogScreen = new LogScreen(this.d.episode, {
      entries: () => this.session.log,
      maxRollback: () => this.session.rollbackDepth,
      onRollback: (steps) => {
        this.kit.screens.close(screen);
        this.rollback(steps);
      },
      onClose: () => this.kit.screens.close(screen),
    });
    this.kit.screens.open(screen);
  }

  openSaveLoad(mode: 'save' | 'load'): void {
    if (mode === 'save' && (!this.session.interp.started || this.session.interp.isEnded)) return;
    if (mode === 'load' && this.inGame && !this.session.interp.started) return; // идёт разговор дела
    const saves = this.d.saves;
    const screen: SaveLoadScreen = new SaveLoadScreen(this.d.episode, {
      mode,
      autosave: () => this.continuable(),
      listManual: () => saves.listManual(),
      onLoad: (file) => this.loadFile(file),
      onSave: (slot) => this.session.saveToSlot(slot),
      onClose: () => this.kit.screens.close(screen),
    });
    this.kit.screens.open(screen);
  }

  openArchive(titleKey?: string): void {
    this.d.platform.track('archive_opened');
    const ep = this.d.episode;
    const assets = this.d.assets;
    // Штампы «новый материал» держатся, пока блокнот открыт; закрыли — всё прочитано, метка с кнопки снята.
    const fresh = new Set(this.freshNotes);
    const screen: ArchiveScreen = new ArchiveScreen(
      ep,
      () => [...new Set([...this.d.saves.archiveOf(ep.id), ...(this.session.interp.started ? this.session.interp.state.archive : [])])],
      () => this.kit.screens.close(screen),
      titleKey,
      {
        isNew: (id) => fresh.has(id),
        onOpenDocument: (item) => this.openNoteDocument(item),
        ...(assets ? { documentArt: (id: string) => assets.document(id) } : {}),
      },
    );
    screen.onClose = () => this.clearNotes();
    this.kit.screens.open(screen);
  }

  /** Бумага из блокнота крупно: окно документа поверх блокнота, без метки «новый материал»; закрыли — снова блокнот. */
  private openNoteDocument(item: ArchiveItem): void {
    const art = item.asset ? this.d.assets?.document(item.asset) : undefined;
    const screen: DocumentScreen = new DocumentScreen(
      this.d.episode,
      item.asset ?? item.id,
      item.text_key ?? null,
      item.id,
      () => this.kit.screens.close(screen),
      art?.url ?? null,
      art?.textInImage === true,
      false,
    );
    this.kit.screens.open(screen);
    void art?.ready.then((url) => {
      if (url && this.kit.screens.has(screen)) screen.setImage(url);
    });
  }

  private markNote(item: string): void {
    this.freshNotes.add(item);
    this.kit.quick.setBadge('notebook', true);
  }

  private clearNotes(): void {
    this.freshNotes.clear();
    this.kit.quick.setBadge('notebook', false);
  }

  private showError(e: unknown): void {
    console.error('[app]', e);
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    const screen: ErrorScreen = new ErrorScreen(msg, () => {
      this.kit.screens.close(screen);
      this.showMenu();
    });
    this.kit.screens.open(screen);
  }

  private rollback(steps: number): void {
    if (this.kit.screens.count > 0 || !this.inGame) return;
    this.session.rollback(steps);
  }

  // ───────────────────────────── настройки и язык ─────────────────────────────

  /** Ассеты эпизода (для отладки и QA). */
  get assets(): AppAssets | null {
    return this.d.assets ?? null;
  }

  get audio(): AudioManager {
    return this.d.audio;
  }

  /** Озвучка реплик (для отладки и QA); null — не подключена. */
  get voice(): LineVoice | null {
    return this.d.voice ?? null;
  }

  /** Текущие настройки игрока (только чтение). */
  get settings(): Readonly<Settings> {
    return this.d.saves.settings;
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const s = this.d.saves.updateSettings(patch);
    // явный выбор уровня камеры (даже прежнего) снимает самозащиту от слабого устройства
    this.applySettings(s, patch.cameraFx !== undefined);
    return s;
  }

  private applySettings(s: Settings, retryCamera = false): void {
    this.kit.setFontScale(s.fontScale);
    this.d.audio.setMuted(s.muted);
    this.d.audio.setVoiceEnabled(s.voiceEnabled);
    this.d.audio.setVolumes({ music: s.music, sfx: s.sfx, voice: s.voice });
    this.kit.quick.setState({ muted: s.muted });
    this.stage.setViolenceMode(s.violenceMode);
    this.stage.setCameraFx(s.cameraFx, retryCamera);
    this.stage.setGraphics(s.graphics);
  }

  /** Смена языка на лету: догрузить строки, перерисовать текущий шаг, не трогая сцену и состояние. */
  async setLanguage(lang: Lang): Promise<void> {
    if (lang === i18n.lang) return;
    await this.d.loadLang(lang);
    i18n.setLang(lang); // подписчик перерисует интерфейс (ui.refreshLanguage)
    this.d.saves.updateSettings({ lang });
    document.title = t(this.d.episode.title_key);
  }

  private trackSettingsPause(): void {
    const open = this.settingsScreen !== null && this.kit.screens.has(this.settingsScreen);
    if (open === this.settingsOpen) return;
    this.settingsOpen = open;
    const ep = this.d.episode;
    this.d.platform.track(open ? 'level_paused' : 'level_resumed', { world: `s${ep.season}`, level: ep.id.split('_')[0] ?? ep.id });
  }

  /** Сохранить прогресс перед уходом со страницы / сворачиванием. */
  persist(): void {
    this.session.autosave('persist');
    void this.d.saves.flush();
  }

  // ───────────────────────────── отладка ─────────────────────────────

  /** window.__vn.start(): новая партия без экранов меню и предупреждения. */
  debugStart(): void {
    void this.startNewGame({ skipWarning: true });
  }

  /** window.__vn.goto(sceneId). */
  debugGoto(sceneId: string): void {
    if (!this.session.interp.scene(sceneId)) throw new Error(`нет сцены ${sceneId}`);
    this.kit.screens.closeAll();
    this.kit.root.classList.add('in-game');
    void this.session.jumpTo(sceneId);
  }

  debugSet(name: string, value: Value): void {
    if (!this.session.interp.started) throw new Error('партия не запущена: сначала __vn.start()');
    this.session.interp.setVar(name, value);
  }

  /** window.__vn.unlock(item): материал архива в партию (улика для дедуктивной развилки), без тоста. */
  debugUnlock(item: string): void {
    if (!this.session.interp.started) throw new Error('партия не запущена: сначала __vn.start()');
    this.session.interp.unlockItem(item);
  }

  async debugAutoplay(policy?: AutoplayPolicy): Promise<AutoplayReport> {
    this.kit.screens.closeAll();
    this.kit.root.classList.add('in-game');
    return this.session.autoplay(policy);
  }
}
