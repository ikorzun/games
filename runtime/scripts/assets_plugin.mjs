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
 *
 * Озвучка реплик: клипы лежат в <папка эпизода>/voice/<язык>/<ключ реплики>.mp3 (src/core/voice.ts), а плагин
 * строит их индекс — voice-index.json в корне сборки (рядом с episodes/index.json; в dev отдаётся на лету).
 * Рантайм просит только те клипы, что есть в индексе: ни лишних запросов, ни 404 в консоли, даже когда клипов нет.
 */
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';

/** Расширения, которые рантайм умеет использовать (mp3 и m4a/AAC — звук, оба играют в iOS Safari; ogg — запасной; mp4/H.264 — ролики кадров). */
export const ASSET_EXTENSIONS = ['.webp', '.png', '.jpg', '.jpeg', '.mp3', '.m4a', '.ogg', '.mp4'];

export const MIME = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
};

/** Индекс клипов озвучки в корне сборки. */
export const VOICE_INDEX_FILE = 'voice-index.json';

/** Имя клипа по соглашению: ключ локализации или id (`[a-z0-9_.]`) + mp3 / m4a / ogg. */
const VOICE_FILE_RE = /^[a-z0-9_]+(?:\.[a-z0-9_]+)*\.(?:mp3|m4a|ogg)$/;

/**
 * Индекс клипов озвучки: { version: 1, episodes: { <папка>: { <язык>: [файлы…] } } } по
 * <dir>/<папка>/voice/<язык>/*.{mp3,m4a,ogg}. Порядок — по имени, папки без клипов не попадают.
 * @returns {{ index: { version: 1, episodes: Record<string, Record<string, string[]>> }, skipped: string[], count: number }}
 *   skipped — аудиофайлы в папках озвучки с именем не по соглашению (регистр, пробелы): в индекс не попадают.
 */
export function collectVoiceIndex(dir) {
  const episodes = {};
  const skipped = [];
  let count = 0;
  // Как и collectAssets / copyAssets, идём по символьным ссылкам (папка озвучки может лежать на отдельном диске).
  const list = (d) => {
    if (!existsSync(d)) return [];
    const out = [];
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
      let dirLike = e.isDirectory();
      let fileLike = e.isFile();
      if (e.isSymbolicLink()) {
        try {
          const st = statSync(join(d, e.name));
          dirLike = st.isDirectory();
          fileLike = st.isFile();
        } catch {
          /* битая ссылка — пропускаем */
        }
      }
      out.push({ name: e.name, isDirectory: () => dirLike, isFile: () => fileLike });
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  };
  for (const folder of list(dir)) {
    if (!folder.isDirectory()) continue;
    for (const lang of list(join(dir, folder.name, 'voice'))) {
      if (!lang.isDirectory()) continue;
      const files = [];
      for (const f of list(join(dir, folder.name, 'voice', lang.name))) {
        if (!f.isFile()) continue;
        if (VOICE_FILE_RE.test(f.name)) files.push(f.name);
        else if (ASSET_EXTENSIONS.includes(extname(f.name).toLowerCase())) skipped.push(`${folder.name}/voice/${lang.name}/${f.name}`);
      }
      if (files.length === 0) continue;
      (episodes[folder.name] ??= {})[lang.name] = files;
      count += files.length;
    }
  }
  return { index: { version: 1, episodes }, skipped, count };
}

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
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        if (url === VOICE_INDEX_FILE) {
          // Индекс клипов озвучки строится на каждый запрос: положили клип — перезагрузили страницу.
          const body = JSON.stringify(collectVoiceIndex(dir).index) + '\n';
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Content-Length', String(Buffer.byteLength(body)));
          res.end(req.method === 'HEAD' ? undefined : body);
          return;
        }
        if (!url.startsWith('assets/')) return next();
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

    generateBundle() {
      const { index, skipped, count } = collectVoiceIndex(dir);
      for (const f of skipped) console.warn(`[vn-assets] озвучка: ${f} — имя не по соглашению ([a-z0-9_.] и .mp3 / .m4a / .ogg), клип пропущен`);
      if (count > 0) {
        const perLang = Object.values(index.episodes).flatMap((langs) => Object.entries(langs).map(([l, files]) => `${l} ${files.length}`));
        console.log(`[vn-assets] озвучка: ${count} клипов (${perLang.join(', ')}) → ${VOICE_INDEX_FILE}`);
      }
      this.emitFile({ type: 'asset', fileName: VOICE_INDEX_FILE, source: JSON.stringify(index) + '\n' });
    },

    closeBundle() {
      if (!existsSync(dir)) return;
      const { files, bytes } = copyAssets(dir, outDir);
      if (files > 0) console.log(`[vn-assets] ${files} файлов (${(bytes / 1024 / 1024).toFixed(2)} МБ) → ${outDir}/assets`);
    },
  };
}
