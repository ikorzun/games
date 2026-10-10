/**
 * Vite-плагин ассетов: каталог ../assets/** (webp, png, mp3, m4a …) отдаётся dev-сервером и копируется
 * в сборку как есть — пути из episode.assets.*[].path (`assets/ep01/bg/yard_summer.webp`) работают
 * относительно корня сборки (`./assets/…`) и в dev, и в dist.
 *
 *   dev:   GET /assets/<путь> → ../assets/<путь> (с Range для mp3 — Safari не играет аудио без него);
 *          нет файла → 404, а не index.html (рантайм показывает плейсхолдер и предупреждает один раз);
 *   build: closeBundle копирует файлы в <outDir>/assets/<путь>, не загружая их в память.
 *
 * Каталог можно подменить переменной окружения VN_ASSETS_DIR (проверка «с файлами» без правки репозитория).
 * В сборку попадают только известные медиа-расширения; файлы и папки на «_» и «.» (черновики,
 * manifest.json, generation-log.md) — нет.
 */
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';

/** Расширения, которые рантайм умеет использовать (mp3 и m4a/AAC — звук, оба играют в iOS Safari; ogg — запасной). */
export const ASSET_EXTENSIONS = ['.webp', '.png', '.jpg', '.jpeg', '.mp3', '.m4a', '.ogg'];

export const MIME = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
};

/** Все файлы ассетов каталога: { rel: 'ep01/bg/x.webp', abs, size }. Порядок — по имени. */
export function collectAssets(dir) {
  const out = [];
  const walk = (cur, rel) => {
    if (!existsSync(cur)) return;
    for (const name of readdirSync(cur).sort()) {
      if (name.startsWith('_') || name.startsWith('.')) continue;
      const abs = join(cur, name);
      const st = statSync(abs);
      const r = rel ? `${rel}/${name}` : name;
      if (st.isDirectory()) walk(abs, r);
      else if (ASSET_EXTENSIONS.includes(extname(name).toLowerCase())) out.push({ rel: r, abs, size: st.size });
    }
  };
  walk(dir, '');
  return out;
}

/** Безопасно сопоставить URL-путь файлу внутри каталога ассетов; null — нельзя (выход за каталог, чужое расширение). */
export function resolveAsset(dir, relUrl) {
  let rel;
  try {
    rel = decodeURIComponent(relUrl);
  } catch {
    return null;
  }
  const parts = rel.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((p) => p === '..' || p === '.' || p.startsWith('_') || p.startsWith('.') || p.includes('\0') || p.includes('\\'))) return null;
  if (!ASSET_EXTENSIONS.includes(extname(parts[parts.length - 1]).toLowerCase())) return null;
  const root = resolve(dir);
  const abs = normalize(join(root, ...parts));
  if (!abs.startsWith(root + sep)) return null;
  return abs;
}

/**
 * Разбор заголовка Range (только одиночный диапазон bytes=a-b, bytes=a-, bytes=-n).
 * @returns {{ start: number, end: number } | null | 'unsatisfiable'} null — заголовка нет или он не наш (отдаём файл целиком)
 */
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === '' && b === '') return null;
  let start;
  let end;
  if (a === '') {
    const n = Number(b);
    if (n === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

/** Копия каталога ассетов в outDir/assets. Возвращает число файлов и байт. */
export function copyAssets(dir, outDir) {
  const files = collectAssets(dir);
  let bytes = 0;
  for (const f of files) {
    const target = join(outDir, 'assets', ...f.rel.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(f.abs, target);
    bytes += f.size;
  }
  return { files: files.length, bytes };
}

export function assetsPlugin(options) {
  const dir = resolve(options.dir);
  let outDir = 'dist';
  return {
    name: 'vn-assets',

    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const raw = (req.url ?? '').split('?')[0] ?? '';
        const url = raw.replace(/^\/+/, '');
        if (!url.startsWith('assets/')) return next();
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const abs = resolveAsset(dir, url.slice('assets/'.length));
        if (!abs || !existsSync(abs) || !statSync(abs).isFile()) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('not found');
          return;
        }
        const size = statSync(abs).size;
        res.setHeader('Content-Type', MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'no-cache');
        const range = parseRange(req.headers.range, size);
        if (range === 'unsatisfiable') {
          res.statusCode = 416;
          res.setHeader('Content-Range', `bytes */${size}`);
          res.end();
          return;
        }
        if (range) {
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
          res.setHeader('Content-Length', String(range.end - range.start + 1));
          if (req.method === 'HEAD') return void res.end();
          createReadStream(abs, { start: range.start, end: range.end }).pipe(res);
          return;
        }
        res.setHeader('Content-Length', String(size));
        if (req.method === 'HEAD') return void res.end();
        createReadStream(abs).pipe(res);
      });
    },

    closeBundle() {
      if (!existsSync(dir)) return;
      const { files, bytes } = copyAssets(dir, outDir);
      if (files > 0) console.log(`[vn-assets] ${files} файлов (${(bytes / 1024 / 1024).toFixed(2)} МБ) → ${outDir}/assets`);
    },
  };
}
