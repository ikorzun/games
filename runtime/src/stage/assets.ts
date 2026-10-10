/**
 * Ассеты эпизода: каталог путей (episode.assets.* → URL относительно корня сборки), правила
 * подбора файла спрайта, план предзагрузки по блокам и хранилище загруженных картинок.
 *
 * Правила (решение владельца, docs/architecture/06 §6):
 *  - фоны, CG, документы — файл по `path` из episode.assets;
 *  - спрайт: каталог = dirname(sprite.base); файл выражения `<dir>/<expression>.webp`;
 *    цепочка запасных: выражение → `<dir>/neutral.webp` → base (png);
 *    силуэт: `<dir>/silhouette.webp`, а если файла нет — тёмный силуэт из того же кадра (рисует рендерер);
 *  - файла нет → плейсхолдер (рендерер) и ровно одно console.warn на файл (AssetStore.warn);
 *  - пути — относительные (`./assets/…` от корня сборки): dev-сервер и vite build отдают ../assets/**.
 *
 * Ядро (каталог, план, очередь) не трогает DOM и тестируется в node; браузерные части
 * (загрузка <img>) подменяются через опции AssetStore.
 */
import type { Episode, SpriteSet, SpriteView, ViewState } from '../core/types';

// ───────────────────────────── пути ─────────────────────────────

/** Файлы интерфейса вне episode.assets (главное меню, заставка). Нет файла — прежний фон. */
export const UI_ASSETS = {
  menuBackground: 'assets/common/ui/menu_video_salon.webp',
  titlePlate: 'assets/common/ui/title_plate.webp',
} as const;

export const SPRITE_FILE_EXT = 'webp';
export const NEUTRAL_EXPRESSION = 'neutral';
export const SILHOUETTE_NAME = 'silhouette';

/** `base` (BASE_URL сборки: «./» или «/») + путь из эпизода без ведущих «./» и «/». */
export function joinUrl(base: string, path: string): string {
  const clean = path.replace(/^(?:\.\/|\/)+/, '');
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(clean)) return clean; // абсолютный URL — как есть
  return `${base}${clean}`;
}

export function dirnameOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

/** Файл чёрного кадра: его нет в манифесте ассетов и не должно быть — это сплошной цвет. */
const BLACK_FILE = /(?:^|\/)black\.(?:png|webp)$/i;

/** Путь из episode.assets — «чёрный кадр» (сплошной цвет): файла может не быть, его не запрашивают и не проверяют. */
export function isSolidBlackFile(path: string): boolean {
  return BLACK_FILE.test(path);
}

// ───────────────────────────── каталог ─────────────────────────────

/**
 * Цепочка кандидатов для одной картинки: берётся первый файл, который существует.
 * Для спрайта с силуэтом первым стоит `silhouette.webp` (`silhouetteFirst`): если подошёл именно он,
 * рендерер рисует его как есть, иначе — затемняет найденный кадр.
 */
export interface ImageChain {
  readonly urls: readonly string[];
  readonly silhouetteFirst: boolean;
  /**
   * Сплошной цвет вместо картинки (чёрный кадр `bg_black`): файл не запрашивается, предупреждения
   * и плейсхолдера нет — чёрный экран рисует сам рендерер.
   */
  readonly solid?: string;
}

export class AssetCatalog {
  private readonly bg = new Map<string, string>();
  private readonly cg = new Map<string, string>();
  private readonly docs = new Map<string, string>();
  private readonly audio = new Map<string, string>();
  private readonly sets = new Map<string, SpriteSet>();
  private readonly setOfChar = new Map<string, string>();

  constructor(
    episode: Pick<Episode, 'assets' | 'cast'>,
    readonly base = '',
  ) {
    const a = episode.assets ?? {};
    for (const e of a.backgrounds ?? []) this.bg.set(e.id, e.path);
    for (const e of a.cg ?? []) this.cg.set(e.id, e.path);
    for (const e of a.documents ?? []) this.docs.set(e.id, e.path);
    // Музыка, эмбиент, sfx и голос делят одно пространство id (id в эпизоде уникальны по префиксам m_/amb_/sfx_).
    for (const list of [a.music, a.ambient, a.sfx, a.voice]) for (const e of list ?? []) this.audio.set(e.id, e.path);
    for (const s of a.sprites ?? []) this.sets.set(s.id, s);
    for (const c of episode.cast ?? []) if (c.sprite_set) this.setOfChar.set(c.id, c.sprite_set);
  }

  url(path: string): string {
    return joinUrl(this.base, path);
  }

  bgUrl(id: string): string | null {
    const p = this.bg.get(id);
    return p ? this.url(p) : null;
  }

  cgUrl(id: string): string | null {
    const p = this.cg.get(id);
    return p ? this.url(p) : null;
  }

  docUrl(id: string): string | null {
    const p = this.docs.get(id);
    return p ? this.url(p) : null;
  }

  audioUrl(id: string): string | null {
    const p = this.audio.get(id);
    return p ? this.url(p) : null;
  }

  /** Набор спрайтов персонажа: cast.sprite_set, а если у персонажа его нет — набор с тем же id. */
  spriteSetOf(who: string): SpriteSet | null {
    const id = this.setOfChar.get(who) ?? who;
    return this.sets.get(id) ?? null;
  }

  bgChain(id: string): ImageChain | null {
    const path = this.bg.get(id);
    if (!path) return null;
    // Чёрный фон (assets/common/bg/black.png) — не картинка: рисуется сплошным цветом.
    if (BLACK_FILE.test(path)) return { urls: [], silhouetteFirst: false, solid: '#000000' };
    return { urls: [this.url(path)], silhouetteFirst: false };
  }

  cgChain(id: string): ImageChain | null {
    const u = this.cgUrl(id);
    return u ? { urls: [u], silhouetteFirst: false } : null;
  }

  /**
   * Цепочка файлов спрайта: [силуэт] → выражение → neutral → base. null — у персонажа нет набора
   * спрайтов (рисуется плейсхолдер без попыток загрузки).
   */
  spriteChain(sprite: Pick<SpriteView, 'who' | 'expression' | 'silhouette'>): ImageChain | null {
    const set = this.spriteSetOf(sprite.who);
    if (!set) return null;
    const dir = dirnameOf(set.base);
    const file = (name: string): string => this.url(dir ? `${dir}/${name}.${SPRITE_FILE_EXT}` : `${name}.${SPRITE_FILE_EXT}`);
    const urls: string[] = [];
    if (sprite.silhouette) urls.push(file(SILHOUETTE_NAME));
    if (sprite.expression) urls.push(file(sprite.expression));
    urls.push(file(NEUTRAL_EXPRESSION), this.url(set.base));
    return { urls: unique(urls), silhouetteFirst: sprite.silhouette };
  }
}

// ───────────────────────────── план предзагрузки ─────────────────────────────

export interface BlockAssets {
  /** Цепочки картинок (фон, CG, документ, спрайты): из каждой нужен первый существующий файл. */
  images: ImageChain[];
  /** mp3: музыка, эмбиент, sfx. */
  audio: string[];
  /** Все URL картинок и аудио плана — «набор удержания» хранилища. */
  all: Set<string>;
}

function blockSceneIds(episode: Episode, blockId: string): string[] {
  const block = episode.blocks.find((b) => b.id === blockId);
  const ids = new Set<string>(block?.scenes ?? []);
  for (const [id, scene] of Object.entries(episode.scenes)) if (scene.block === blockId) ids.add(id);
  return [...ids].filter((id) => episode.scenes[id] !== undefined);
}

/** Ассеты всех сцен блока. Неизвестные id (нет записи в episode.assets) молча пропускаются: это забота линтера. */
export function collectBlockAssets(episode: Episode, catalog: AssetCatalog, blockId: string): BlockAssets {
  const images = new Map<string, ImageChain>();
  const audio = new Set<string>();
  const addChain = (chain: ImageChain | null): void => {
    if (chain && chain.urls.length > 0) images.set(chain.urls.join('|'), chain);
  };
  const addAudio = (id: string | undefined): void => {
    const u = id ? catalog.audioUrl(id) : null;
    if (u) audio.add(u);
  };
  const addSprite = (who: string, expression: string | undefined, silhouette: boolean): void =>
    addChain(catalog.spriteChain({ who, expression: expression ?? null, silhouette }));

  const block = episode.blocks.find((b) => b.id === blockId);
  addAudio(block?.music);
  for (const sid of blockSceneIds(episode, blockId)) {
    const scene = episode.scenes[sid];
    if (!scene) continue;
    addChain(catalog.bgChain(scene.stage.bg));
    addAudio(scene.music);
    addAudio(scene.ambient);
    for (const step of scene.steps) {
      switch (step.do) {
        case 'bg':
          addChain(catalog.bgChain(step.bg));
          break;
        case 'cg':
          addChain(catalog.cgChain(step.cg));
          break;
        case 'document':
          {
            const u = catalog.docUrl(step.doc);
            if (u) addChain({ urls: [u], silhouetteFirst: false });
          }
          break;
        case 'show':
          addSprite(step.who, step.expression, step.silhouette === true);
          break;
        case 'say':
          // Реплика с выражением может сама вывести персонажа на сцену или сменить его выражение.
          if (step.expression !== undefined) addSprite(step.who, step.expression, false);
          break;
        case 'music':
        case 'sfx':
        case 'ambient':
          addAudio(step.id);
          break;
        default:
          break;
      }
    }
  }
  const all = new Set<string>(audio);
  for (const c of images.values()) for (const u of c.urls) all.add(u);
  return { images: [...images.values()], audio: [...audio], all };
}

/** Куда ведут выходы блока (jump / branch / choice / исходы мини-игр), без самого блока; иначе — следующий по списку. */
export function nextBlocks(episode: Episode, blockId: string): string[] {
  const out: string[] = [];
  const add = (sceneId: string | undefined): void => {
    const b = sceneId ? episode.scenes[sceneId]?.block : undefined;
    if (b && b !== blockId && !out.includes(b)) out.push(b);
  };
  for (const sid of blockSceneIds(episode, blockId)) {
    for (const step of episode.scenes[sid]?.steps ?? []) {
      switch (step.do) {
        case 'jump':
          add(step.scene);
          break;
        case 'branch':
          for (const c of step.cases) add(c.goto);
          add(step.default);
          break;
        case 'choice':
          for (const o of step.options) add(o.goto);
          break;
        case 'minigame': {
          const o = episode.minigames?.[step.minigame]?.outcomes;
          add(o?.success.goto);
          add(o?.partial?.goto);
          add(o?.fail.goto);
          break;
        }
        default:
          break;
      }
    }
  }
  if (out.length === 0) {
    const i = episode.blocks.findIndex((b) => b.id === blockId);
    const next = i >= 0 ? episode.blocks[i + 1] : undefined;
    if (next) out.push(next.id);
  }
  return out;
}

// ───────────────────────────── хранилище картинок ─────────────────────────────

/** Загруженная и декодированная картинка. */
export interface ImageHandle {
  readonly url: string;
  readonly image: HTMLImageElement;
  readonly width: number;
  readonly height: number;
}

export type ImageLoader = (url: string) => Promise<ImageHandle>;
export type LoadPriority = 'now' | 'idle';

export interface AssetStoreOptions {
  loadImage?: ImageLoader;
  /** Предупреждение о недостающем файле; по умолчанию console.warn. Вызывается один раз на файл. */
  warn?: (message: string) => void;
  /** Одновременных загрузок картинок (телефон: 4). */
  concurrency?: number;
}

/** Загрузка через <img> с декодированием. Отсутствующий файл (404, HTML вместо картинки) → отказ. */
export function domImageLoader(url: string): Promise<ImageHandle> {
  return new Promise<ImageHandle>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const done = (): void => resolve({ url, image, width: image.naturalWidth, height: image.naturalHeight });
      // decode() гарантирует, что первый кадр с картинкой не будет ждать расшифровки; сбой decode не фатален.
      if (typeof image.decode === 'function') image.decode().then(done, done);
      else done();
    };
    image.onerror = () => reject(new Error(`не удалось загрузить ${url}`));
    image.src = url;
  });
}

interface Job {
  url: string;
  prio: LoadPriority;
  run: () => void;
}

export class AssetStore {
  private readonly images = new Map<string, ImageHandle>();
  private readonly missing = new Set<string>();
  private readonly inflight = new Map<string, Promise<ImageHandle | null>>();
  private readonly pinned = new Set<string>();
  private readonly warned = new Set<string>();
  private readonly queued = new Map<string, Job>();
  private readonly queues: Record<LoadPriority, Job[]> = { now: [], idle: [] };
  private active = 0;
  private readonly loader: ImageLoader;
  private readonly warnFn: (message: string) => void;
  private readonly max: number;

  constructor(opts: AssetStoreOptions = {}) {
    this.loader = opts.loadImage ?? domImageLoader;
    this.warnFn = opts.warn ?? ((m) => console.warn(m));
    this.max = Math.max(1, opts.concurrency ?? 4);
  }

  /** Готовая картинка | null — файла нет | undefined — ещё не известно (не запрашивали или грузится). */
  peek(url: string): ImageHandle | null | undefined {
    const h = this.images.get(url);
    if (h) return h;
    return this.missing.has(url) ? null : undefined;
  }

  isMissing(url: string): boolean {
    return this.missing.has(url);
  }

  /** Сколько запросов в работе или в очереди. */
  get pending(): number {
    return this.inflight.size;
  }

  /** Есть ли в очереди или в работе ещё не загруженные из этого набора. */
  unresolved(urls: Iterable<string>): string[] {
    const out: string[] = [];
    for (const u of urls) if (this.peek(u) === undefined) out.push(u);
    return out;
  }

  /** Загрузить файл (запросы одного URL сливаются). null — файла нет; предупреждение выдаёт вызывающий через warnMissing. */
  load(url: string, prio: LoadPriority = 'now'): Promise<ImageHandle | null> {
    const have = this.images.get(url);
    if (have) return Promise.resolve(have);
    if (this.missing.has(url)) return Promise.resolve(null);
    const running = this.inflight.get(url);
    if (running) {
      this.bump(url, prio);
      return running;
    }
    const p = new Promise<ImageHandle | null>((resolve) => {
      const job: Job = {
        url,
        prio,
        run: () => {
          this.queued.delete(url);
          this.active += 1;
          this.loader(url).then(
            (h) => {
              this.images.set(url, h);
              resolve(h);
            },
            () => {
              this.missing.add(url);
              resolve(null);
            },
          ).finally(() => {
            this.active -= 1;
            this.inflight.delete(url);
            this.pump();
          });
        },
      };
      this.queued.set(url, job);
      this.queues[prio].push(job);
    });
    this.inflight.set(url, p);
    this.pump();
    return p;
  }

  /**
   * Первый существующий файл цепочки. Если нет ни одного — один раз предупреждаем (по последнему
   * кандидату: для спрайта это base.png) и возвращаем null.
   */
  async loadFirst(urls: readonly string[], prio: LoadPriority = 'now'): Promise<{ handle: ImageHandle; index: number } | null> {
    for (let i = 0; i < urls.length; i++) {
      const handle = await this.load(urls[i]!, prio);
      if (handle) return { handle, index: i };
    }
    this.warnMissing(urls);
    return null;
  }

  /** Синхронный взгляд на цепочку: готово / файлов нет / пока неизвестно (undefined). */
  peekFirst(urls: readonly string[]): { handle: ImageHandle; index: number } | null | undefined {
    for (let i = 0; i < urls.length; i++) {
      const h = this.peek(urls[i]!);
      if (h === undefined) return undefined;
      if (h !== null) return { handle: h, index: i };
    }
    return null;
  }

  /** Одно предупреждение на цепочку; сообщение называет файл, который надо положить. */
  warnMissing(urls: readonly string[]): void {
    const key = urls.join('|');
    if (this.warned.has(key)) return;
    this.warned.add(key);
    const last = urls[urls.length - 1] ?? '?';
    this.warnFn(urls.length > 1 ? `[assets] нет файла спрайта (${urls.join(' → ')}): плейсхолдер` : `[assets] нет файла ${last}: плейсхолдер`);
  }

  /** Оставить в памяти только набор (и закреплённые файлы). Показанные сейчас картинки держат рендереры. */
  retain(keep: ReadonlySet<string>): void {
    for (const url of [...this.images.keys()]) if (!keep.has(url) && !this.pinned.has(url)) this.images.delete(url);
  }

  /** Закрепить файл навсегда (меню, заставка). */
  pin(url: string): void {
    this.pinned.add(url);
  }

  stats(): { loaded: string[]; missing: string[]; pending: number; inflight: string[] } {
    return { loaded: [...this.images.keys()], missing: [...this.missing], pending: this.inflight.size, inflight: [...this.inflight.keys()] };
  }

  private bump(url: string, prio: LoadPriority): void {
    const job = this.queued.get(url);
    if (!job || job.prio === prio || prio !== 'now') return;
    const idle = this.queues.idle;
    const i = idle.indexOf(job);
    if (i >= 0) idle.splice(i, 1);
    job.prio = 'now';
    this.queues.now.push(job);
    this.pump();
  }

  private pump(): void {
    while (this.active < this.max) {
      const job = this.queues.now.shift() ?? this.queues.idle.shift();
      if (!job) return;
      job.run();
    }
  }
}

// ───────────────────────────── ассеты для рендерера ─────────────────────────────

/** Что видит рендерер сцены: подбор картинки по id и синхронный/асинхронный доступ к ней. */
export interface SceneAssets {
  bgChain(id: string): ImageChain | null;
  cgChain(id: string): ImageChain | null;
  spriteChain(sprite: Pick<SpriteView, 'who' | 'expression' | 'silhouette'>): ImageChain | null;
  /** Готовый результат по цепочке: найден / файлов нет (null) / пока неизвестно (undefined). */
  peek(urls: readonly string[]): { handle: ImageHandle; index: number } | null | undefined;
  load(urls: readonly string[], prio?: LoadPriority): Promise<{ handle: ImageHandle; index: number } | null>;
}

/** Без ассетов: рендерер рисует только плейсхолдеры (тесты, режим без каталога). */
export const NO_ASSETS: SceneAssets = {
  bgChain: () => null,
  cgChain: () => null,
  spriteChain: () => null,
  peek: () => null,
  load: () => Promise.resolve(null),
};

export class StoreSceneAssets implements SceneAssets {
  constructor(
    readonly catalog: AssetCatalog,
    readonly store: AssetStore,
  ) {}
  bgChain(id: string): ImageChain | null {
    return this.catalog.bgChain(id);
  }
  cgChain(id: string): ImageChain | null {
    return this.catalog.cgChain(id);
  }
  spriteChain(sprite: Pick<SpriteView, 'who' | 'expression' | 'silhouette'>): ImageChain | null {
    return this.catalog.spriteChain(sprite);
  }
  peek(urls: readonly string[]): { handle: ImageHandle; index: number } | null | undefined {
    return this.store.peekFirst(urls);
  }
  load(urls: readonly string[], prio: LoadPriority = 'now'): Promise<{ handle: ImageHandle; index: number } | null> {
    return this.store.loadFirst(urls, prio);
  }
}

/** Все цепочки кадра: фон, CG и спрайты на сцене (голос за кадром не рисуется). */
export function viewChains(assets: SceneAssets, view: Pick<ViewState, 'bg' | 'cg' | 'sprites'>): ImageChain[] {
  const out: ImageChain[] = [];
  const bg = assets.bgChain(view.bg);
  if (bg) out.push(bg);
  const cg = view.cg ? assets.cgChain(view.cg) : null;
  if (cg) out.push(cg);
  for (const s of view.sprites) {
    if (s.position === 'offscreen_left' || s.position === 'offscreen_right') continue;
    const c = assets.spriteChain(s);
    if (c) out.push(c);
  }
  return out;
}

/** Дождаться картинок кадра (не дольше timeoutMs): после этого смена сцены не покажет «пустоту». */
export async function prepareView(assets: SceneAssets, view: Pick<ViewState, 'bg' | 'cg' | 'sprites'>, timeoutMs = 6000): Promise<void> {
  const chains = viewChains(assets, view).filter((c) => assets.peek(c.urls) === undefined);
  if (chains.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([Promise.all(chains.map((c) => assets.load(c.urls))).then(() => undefined), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
