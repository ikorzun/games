/**
 * Плагин ассетов сборки (scripts/assets_plugin.mjs): ../assets/** в dev (с Range для mp3) и в dist.
 * Dev-middleware проверяется на настоящем http-сервере: статусы, заголовки, Range, 404 вместо index.html.
 */
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASSET_EXTENSIONS, assetsPlugin, collectAssets, collectVoiceIndex, copyAssets, MIME, parseRange, resolveAsset, VOICE_INDEX_FILE } from '../scripts/assets_plugin.mjs';

const dirs: string[] = [];
function tree(files: Record<string, string | number>): string {
  const root = mkdtempSync(join(tmpdir(), 'vn-assets-'));
  dirs.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof body === 'number' ? Buffer.alloc(body, 7) : body);
  }
  return root;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const ASSETS = {
  'ep01/bg/yard.webp': 1000,
  'ep01/sprites/zoya/neutral.webp': 500,
  'ep01/sprites/zoya/base.png': 300,
  'common/music/theme.m4a': 2000,
  'common/sfx/door.mp3': 200,
  'common/ui/title_plate.webp': 100,
  'ep01/manifest.json': '{"secret":"https://cdn.example.com/x.png"}', // служебные файлы в сборку не попадают
  'ep01/generation-log.md': '# log',
  'ep01/_drafts/old.webp': 50, // «_» — черновики
  'ep01/.hidden.png': 50,
  'ep01/bg/raw.psd': 50, // чужое расширение
};

describe('collectAssets', () => {
  it('берёт только известные медиа-файлы; manifest.json, markdown, «_»-папки, «.»-файлы и неизвестные расширения пропускает', () => {
    const files = collectAssets(tree(ASSETS)).map((f) => f.rel);
    expect(files).toEqual([
      'common/music/theme.m4a',
      'common/sfx/door.mp3',
      'common/ui/title_plate.webp',
      'ep01/bg/yard.webp',
      'ep01/sprites/zoya/base.png',
      'ep01/sprites/zoya/neutral.webp',
    ]);
    expect(collectAssets(join(tmpdir(), 'vn-no-such-assets'))).toEqual([]);
  });

  it('webp, png, mp3, m4a (музыка эпизода) и mp4 (ролики кадров) — входят в список расширений', () => {
    for (const ext of ['.webp', '.png', '.mp3', '.m4a', '.mp4']) expect(ASSET_EXTENSIONS).toContain(ext);
    expect(MIME['.m4a']).toBe('audio/mp4');
    expect(MIME['.mp4']).toBe('video/mp4'); // ролики кадров «Воспоминаний»
    expect(MIME['.mp3']).toBe('audio/mpeg');
    expect(MIME['.webp']).toBe('image/webp');
  });
});

describe('resolveAsset: безопасное сопоставление URL файлу', () => {
  const dir = tree(ASSETS);

  it('обычные пути — внутри каталога', () => {
    expect(resolveAsset(dir, 'ep01/bg/yard.webp')).toBe(join(dir, 'ep01', 'bg', 'yard.webp'));
    expect(resolveAsset(dir, 'common/music/theme.m4a')).toBe(join(dir, 'common', 'music', 'theme.m4a'));
  });

  it('выход из каталога, «_»-папки, скрытые файлы, обратные слэши, нулевой байт и чужие расширения — отказ', () => {
    for (const bad of ['../secret.png', 'ep01/../../x.png', 'ep01/_drafts/old.webp', 'ep01/.hidden.png', 'ep01\\bg\\yard.webp', 'ep01/bg/yard.webp\0.png', 'ep01/manifest.json', 'ep01/bg/raw.psd', '', '/', '%2e%2e/x.png', 'ep01/%2e%2e/%2e%2e/x.png']) {
      expect(resolveAsset(dir, bad), bad).toBeNull();
    }
    expect(resolveAsset(dir, '%E0%A4%A')).toBeNull(); // битая процентная кодировка
  });
});

describe('parseRange', () => {
  it('bytes=a-b, a-, -n; без заголовка и непонятный заголовок — файл целиком', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 }); // конец обрезается по размеру
    expect(parseRange(undefined, 1000)).toBeNull();
    expect(parseRange('items=0-5', 1000)).toBeNull();
    expect(parseRange('bytes=0-5,10-15', 1000)).toBeNull(); // составные диапазоны не поддерживаются — отдаём целиком
    expect(parseRange('bytes=-', 1000)).toBeNull();
  });

  it('за пределами файла — 416 (unsatisfiable)', () => {
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=5000-6000', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=10-5', 1000)).toBe('unsatisfiable');
  });
});

describe('copyAssets: копия в outDir/assets', () => {
  it('копирует файлы с вложенными папками, считает файлы и байты; служебное не копирует', () => {
    const src = tree(ASSETS);
    const out = tree({});
    const res = copyAssets(src, out);
    expect(res.files).toBe(6);
    expect(res.bytes).toBe(1000 + 500 + 300 + 2000 + 200 + 100);
    expect(readFileSync(join(out, 'assets', 'ep01', 'bg', 'yard.webp'))).toHaveLength(1000);
    expect(existsSync(join(out, 'assets', 'common', 'music', 'theme.m4a'))).toBe(true);
    expect(existsSync(join(out, 'assets', 'ep01', 'manifest.json'))).toBe(false);
    expect(existsSync(join(out, 'assets', 'ep01', '_drafts'))).toBe(false);
  });

  it('closeBundle плагина копирует в outDir сборки; без каталога ассетов — тихо ничего не делает', () => {
    const src = tree(ASSETS);
    const out = tree({});
    const p = assetsPlugin({ dir: src }) as unknown as { configResolved(c: unknown): void; closeBundle(): void };
    p.configResolved({ root: '/', build: { outDir: out } });
    p.closeBundle();
    expect(existsSync(join(out, 'assets', 'ep01', 'bg', 'yard.webp'))).toBe(true);
    const none = assetsPlugin({ dir: join(tmpdir(), 'vn-no-such-assets') }) as unknown as { configResolved(c: unknown): void; closeBundle(): void };
    none.configResolved({ root: '/', build: { outDir: tree({}) } });
    expect(() => none.closeBundle()).not.toThrow();
  });
});

describe('dev-сервер: /assets/**', () => {
  type Mw = (req: unknown, res: unknown, next: () => void) => void;

  async function serve(dir: string): Promise<{ base: string; close: () => Promise<void> }> {
    let mw: Mw | null = null;
    const plugin = assetsPlugin({ dir }) as unknown as { configureServer(s: { middlewares: { use(f: Mw): void } }): void };
    plugin.configureServer({ middlewares: { use: (f) => void (mw = f) } });
    const server = createServer((req, res) => {
      mw!(req, res, () => {
        res.statusCode = 299; // «дальше по цепочке» (в Vite дальше SPA-фолбэк)
        res.end('next');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    return { base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
  }

  it('GET отдаёт файл с правильным типом, длиной и Accept-Ranges', async () => {
    const s = await serve(tree(ASSETS));
    try {
      const r = await fetch(`${s.base}/assets/ep01/bg/yard.webp`);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('image/webp');
      expect(r.headers.get('content-length')).toBe('1000');
      expect(r.headers.get('accept-ranges')).toBe('bytes');
      expect(r.headers.get('cache-control')).toBe('no-cache');
      expect((await r.arrayBuffer()).byteLength).toBe(1000);
      expect((await fetch(`${s.base}/assets/common/music/theme.m4a`)).headers.get('content-type')).toBe('audio/mp4');
      expect((await fetch(`${s.base}/assets/common/sfx/door.mp3`)).headers.get('content-type')).toBe('audio/mpeg');
      // путь с параметрами запроса и кодированием
      expect((await fetch(`${s.base}/assets/ep01/bg/yard.webp?v=3`)).status).toBe(200);
    } finally {
      await s.close();
    }
  });

  it('нет файла → 404 (а не index.html с кодом 200): рантайм покажет плейсхолдер и предупредит один раз', async () => {
    const s = await serve(tree(ASSETS));
    try {
      const r = await fetch(`${s.base}/assets/ep01/bg/missing.webp`);
      expect(r.status).toBe(404);
      expect(r.headers.get('content-type')).toContain('text/plain');
      expect((await fetch(`${s.base}/assets/ep01/manifest.json`)).status).toBe(404);
      // fetch нормализует «..» ещё на стороне клиента, поэтому «сырой» путь отправляем напрямую
      const raw = await new Promise<number>((resolve, reject) => {
        const u = new URL(s.base);
        request({ host: u.hostname, port: u.port, path: '/assets/../../etc/passwd.png' }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        })
          .on('error', reject)
          .end();
      });
      expect(raw).toBe(404);
    } finally {
      await s.close();
    }
  });

  it('Range: 206 с Content-Range для куска, 416 за пределами, HEAD без тела', async () => {
    const s = await serve(tree(ASSETS));
    try {
      const part = await fetch(`${s.base}/assets/common/music/theme.m4a`, { headers: { Range: 'bytes=100-199' } });
      expect(part.status).toBe(206);
      expect(part.headers.get('content-range')).toBe('bytes 100-199/2000');
      expect(part.headers.get('content-length')).toBe('100');
      expect((await part.arrayBuffer()).byteLength).toBe(100);
      const tail = await fetch(`${s.base}/assets/common/music/theme.m4a`, { headers: { Range: 'bytes=-50' } });
      expect(tail.headers.get('content-range')).toBe('bytes 1950-1999/2000');
      const bad = await fetch(`${s.base}/assets/common/music/theme.m4a`, { headers: { Range: 'bytes=5000-' } });
      expect(bad.status).toBe(416);
      expect(bad.headers.get('content-range')).toBe('bytes */2000');
      const head = await fetch(`${s.base}/assets/common/sfx/door.mp3`, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(head.headers.get('content-length')).toBe('200');
      expect(await head.text()).toBe('');
    } finally {
      await s.close();
    }
  });

  it('чужие пути (не /assets/) и методы кроме GET / HEAD пропускаются дальше по цепочке Vite', async () => {
    const s = await serve(tree(ASSETS));
    try {
      expect((await fetch(`${s.base}/episodes/index.json`)).status).toBe(299);
      expect((await fetch(`${s.base}/assets/ep01/bg/yard.webp`, { method: 'POST' })).status).toBe(299);
    } finally {
      await s.close();
    }
  });
});

// ───────────────────────────── озвучка реплик: индекс клипов ─────────────────────────────

const VOICE_ASSETS = {
  'ep01/bg/yard.webp': 100,
  'ep01/voice/ru/ep01.s01.l002.mp3': 30,
  'ep01/voice/ru/ep01.s01.l001.mp3': 30,
  'ep01/voice/ru/alt_take.m4a': 30,
  'ep01/voice/en/ep01.s01.l001.mp3': 30,
  'ep01/voice/pt/readme.txt': 'не клип', // не аудио — молча мимо
  'ep01/voice/ru/Bad Name.mp3': 30, // аудио, но имя не по соглашению
  'ep01/voice/ru/_draft.mp3': 30, // «_» — черновик
  'ep01/voice/_old/ru.mp3': 30,
  'ep01/voice/es/empty_marker.txt': 'x',
  'ep02/voice/ru/ep02.s01.l001.ogg': 30,
  'common/voice/ru/jingle.mp3': 30,
  '_drafts/voice/ru/ep09.s01.l001.mp3': 30,
};

describe('collectVoiceIndex: voice-index.json', () => {
  it('папка эпизода → язык → файлы клипов по имени; папки без клипов, «_»-черновики и чужие файлы не попадают', () => {
    const { index, count } = collectVoiceIndex(tree(VOICE_ASSETS));
    expect(index).toEqual({
      version: 1,
      episodes: {
        common: { ru: ['jingle.mp3'] },
        ep01: { en: ['ep01.s01.l001.mp3'], ru: ['alt_take.m4a', 'ep01.s01.l001.mp3', 'ep01.s01.l002.mp3'] },
        ep02: { ru: ['ep02.s01.l001.ogg'] },
      },
    });
    expect(count).toBe(6);
  });

  it('аудиофайлы с именем не по соглашению перечисляются отдельно (в индекс не идут) — сборка предупредит', () => {
    const { skipped } = collectVoiceIndex(tree(VOICE_ASSETS));
    expect(skipped).toEqual(['ep01/voice/ru/Bad Name.mp3']);
  });

  it('нет каталога ассетов или нет озвучки вовсе — пустой индекс, а не ошибка', () => {
    expect(collectVoiceIndex(join(tmpdir(), 'vn-no-such-assets'))).toEqual({ index: { version: 1, episodes: {} }, skipped: [], count: 0 });
    expect(collectVoiceIndex(tree(ASSETS)).index).toEqual({ version: 1, episodes: {} });
  });

  it('символьные ссылки (папка озвучки на другом диске) читаются так же, как их копирует copyAssets; битая ссылка пропускается', () => {
    const real = tree({ 'ru/ep01.s01.l001.mp3': 5, 'ru/ep01.s01.l002.mp3': 5 });
    const dir = tree({ 'ep01/bg/yard.webp': 5 });
    mkdirSync(join(dir, 'ep01', 'voice'), { recursive: true });
    try {
      symlinkSync(join(real, 'ru'), join(dir, 'ep01', 'voice', 'ru'), 'dir');
      symlinkSync(join(real, 'no-such'), join(dir, 'ep01', 'voice', 'en'), 'dir');
    } catch {
      return; // файловая система без символьных ссылок — проверять нечего
    }
    expect(collectVoiceIndex(dir).index.episodes).toEqual({ ep01: { ru: ['ep01.s01.l001.mp3', 'ep01.s01.l002.mp3'] } });
  });

  it('порядок не зависит от файловой системы: всё отсортировано по имени', () => {
    const a = collectVoiceIndex(tree({ 'ep01/voice/ru/b.mp3': 1, 'ep01/voice/ru/a.mp3': 1, 'ep01/voice/en/z.mp3': 1 })).index;
    expect(Object.keys(a.episodes.ep01)).toEqual(['en', 'ru']);
    expect(a.episodes.ep01.ru).toEqual(['a.mp3', 'b.mp3']);
  });
});

describe('плагин: индекс клипов в сборке и в dev', () => {
  type Plugin = {
    configResolved(c: unknown): void;
    generateBundle(this: unknown): void;
    closeBundle(): void;
    configureServer(s: { middlewares: { use(f: (req: unknown, res: unknown, next: () => void) => void): void } }): void;
  };

  it('сборка кладёт voice-index.json в корень архива; клипы копируются вместе с остальными ассетами', () => {
    const src = tree(VOICE_ASSETS);
    const out = tree({});
    const emitted: Array<{ type: string; fileName: string; source: string }> = [];
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const p = assetsPlugin({ dir: src }) as unknown as Plugin;
      p.configResolved({ root: '/', build: { outDir: out } });
      p.generateBundle.call({ emitFile: (f: { type: string; fileName: string; source: string }) => void emitted.push(f) });
      p.closeBundle();
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({ type: 'asset', fileName: VOICE_INDEX_FILE });
      expect(VOICE_INDEX_FILE).toBe('voice-index.json');
      const index = JSON.parse(emitted[0]!.source) as { version: number; episodes: Record<string, Record<string, string[]>> };
      expect(index.version).toBe(1);
      expect(index.episodes.ep01!.ru).toEqual(['alt_take.m4a', 'ep01.s01.l001.mp3', 'ep01.s01.l002.mp3']);
      // каждый клип из индекса лежит в сборке по пути assets/<папка>/voice/<язык>/<файл>
      for (const [folder, langs] of Object.entries(index.episodes)) {
        for (const [lang, files] of Object.entries(langs)) for (const f of files) expect(existsSync(join(out, 'assets', folder, 'voice', lang, f)), `${folder}/${lang}/${f}`).toBe(true);
      }
      expect(warn.mock.calls.flat().join('\n')).toContain('Bad Name.mp3'); // предупреждение об имени не по соглашению
      expect(log.mock.calls.flat().join('\n')).toContain('озвучка: 6 клипов');
    } finally {
      log.mockRestore();
      warn.mockRestore();
    }
  });

  it('без клипов индекс всё равно есть (пустой): рантайм не получает 404 на старте', () => {
    const emitted: Array<{ fileName: string; source: string }> = [];
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const p = assetsPlugin({ dir: tree(ASSETS) }) as unknown as Plugin;
      p.generateBundle.call({ emitFile: (f: { fileName: string; source: string }) => void emitted.push(f) });
      expect(emitted.map((e) => e.fileName)).toEqual([VOICE_INDEX_FILE]);
      expect(JSON.parse(emitted[0]!.source)).toEqual({ version: 1, episodes: {} });
      expect(log).not.toHaveBeenCalled(); // тихо
      const none = assetsPlugin({ dir: join(tmpdir(), 'vn-no-such-assets') }) as unknown as Plugin;
      none.generateBundle.call({ emitFile: (f: { fileName: string; source: string }) => void emitted.push(f) });
      expect(JSON.parse(emitted[1]!.source)).toEqual({ version: 1, episodes: {} });
    } finally {
      log.mockRestore();
    }
  });

  async function serve(dir: string): Promise<{ base: string; close: () => Promise<void> }> {
    let mw: ((req: unknown, res: unknown, next: () => void) => void) | null = null;
    const plugin = assetsPlugin({ dir }) as unknown as Plugin;
    plugin.configureServer({ middlewares: { use: (f) => void (mw = f) } });
    const server = createServer((req, res) => {
      mw!(req, res, () => {
        res.statusCode = 299;
        res.end('next');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    return { base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
  }

  it('dev-сервер отдаёт /voice-index.json на лету: положили клип — он в индексе при следующем запросе; без кеша', async () => {
    const dir = tree({ 'ep01/voice/ru/ep01.s01.l001.mp3': 10 });
    const s = await serve(dir);
    try {
      const r = await fetch(`${s.base}/${VOICE_INDEX_FILE}`);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toContain('application/json');
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(await r.json()).toEqual({ version: 1, episodes: { ep01: { ru: ['ep01.s01.l001.mp3'] } } });
      writeFileSync(join(dir, 'ep01', 'voice', 'ru', 'ep01.s01.l002.mp3'), 'x');
      const again = (await (await fetch(`${s.base}/${VOICE_INDEX_FILE}?t=2`)).json()) as { episodes: { ep01: { ru: string[] } } };
      expect(again.episodes.ep01.ru).toEqual(['ep01.s01.l001.mp3', 'ep01.s01.l002.mp3']);
      const head = await fetch(`${s.base}/${VOICE_INDEX_FILE}`, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe('');
      // сам клип отдаётся как обычный аудиоассет (mp3 с Range)
      const clip = await fetch(`${s.base}/assets/ep01/voice/ru/ep01.s01.l001.mp3`, { headers: { Range: 'bytes=0-3' } });
      expect(clip.status).toBe(206);
      expect(clip.headers.get('content-type')).toBe('audio/mpeg');
      // клипа нет — честный 404 (рантайм до него не доходит: его нет в индексе)
      expect((await fetch(`${s.base}/assets/ep01/voice/ru/ep01.s01.l999.mp3`)).status).toBe(404);
    } finally {
      await s.close();
    }
  });

  it('dev-сервер без клипов отдаёт пустой индекс (а не 404 и не index.html)', async () => {
    const s = await serve(tree(ASSETS));
    try {
      const r = await fetch(`${s.base}/${VOICE_INDEX_FILE}`);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ version: 1, episodes: {} });
      expect((await fetch(`${s.base}/${VOICE_INDEX_FILE}`, { method: 'POST' })).status).toBe(299); // чужой метод — дальше по цепочке
    } finally {
      await s.close();
    }
  });
});
