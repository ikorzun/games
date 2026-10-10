/**
 * Плагин ассетов сборки (scripts/assets_plugin.mjs): ../assets/** в dev (с Range для mp3) и в dist.
 * Dev-middleware проверяется на настоящем http-сервере: статусы, заголовки, Range, 404 вместо index.html.
 */
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ASSET_EXTENSIONS, assetsPlugin, collectAssets, copyAssets, MIME, parseRange, resolveAsset } from '../scripts/assets_plugin.mjs';

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

  it('webp, png, mp3 — и m4a (музыка эпизода) — входят в список расширений', () => {
    for (const ext of ['.webp', '.png', '.mp3', '.m4a']) expect(ASSET_EXTENSIONS).toContain(ext);
    expect(MIME['.m4a']).toBe('audio/mp4');
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
