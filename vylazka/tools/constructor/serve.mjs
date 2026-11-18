// Конструктор на своём компьютере (квиз 18.11: «Программа на MacBook»): npm run constructor
//
// Открывает конструктор в отдельном окне браузера. Всё, что ставишь, двигаешь и убираешь, сразу пишется в файлы
// репозитория — src/world/partner/*.json (их берёт игра) и tools/constructor/work/*.json (отметки и заявки на вещи
// каталога); залить в игру — npm run constructor:push (push.mjs). Сеть нужна только для поиска по каталогу Sand3D
// (около 106 тыс. вещей, спейс Sandflow): поиск, картинки и карточки идут через этот сервер.
//
//   npm run constructor               — собрать страницу и открыть окно
//   npm run constructor -- --no-open  — не открывать окно (адрес — в терминале)
//   npm run constructor -- --port 5300
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { buildPage, ROOT } from './page.mjs';

const CATALOG = 'https://sandflow-sand3d-explorer.hf.space';
/** Где лежит каждая коллекция: записи игры — рядом с её кодом, рабочие — у конструктора. */
export const FILES = {
  things: 'src/world/partner/things.json',
  figures: 'src/world/partner/figures.json',
  removed: 'src/world/partner/removed.json',
  verdicts: 'tools/constructor/work/verdicts.json',
  requests: 'tools/constructor/work/requests.json',
};
const CACHE = join(ROOT, 'tools/constructor/work/.cache');
const ID = /^[A-Za-z0-9_.:-]{1,200}$/;

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** Записи коллекции из её файла (нет файла — пусто). */
export function readRows(coll) {
  const f = join(ROOT, FILES[coll]);
  if (!existsSync(f)) return [];
  const v = JSON.parse(readFileSync(f, 'utf8'));
  return Array.isArray(v) ? v : [];
}

/** Записать коллекцию: по времени сохранения, одна запись — одна строка (правки читаются в истории построчно). */
export function writeRows(coll, rows) {
  const f = join(ROOT, FILES[coll]);
  mkdirSync(dirname(f), { recursive: true });
  const sorted = [...rows].sort((a, b) => `${a.at ?? ''}|${a.id}`.localeCompare(`${b.at ?? ''}|${b.id}`));
  const body = `[\n${sorted.map((r) => `  ${JSON.stringify(sortKeys(r))}`).join(',\n')}${sorted.length ? '\n' : ''}]\n`;
  // Сначала во временный файл, потом подмена: вкладку закроют посреди записи — файл останется целым.
  writeFileSync(`${f}.tmp`, body);
  renameSync(`${f}.tmp`, f);
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((ok, bad) => {
    const parts = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1 << 20) bad(new Error('слишком большая запись'));
      else parts.push(c);
    });
    req.on('end', () => ok(Buffer.concat(parts).toString('utf8')));
    req.on('error', bad);
  });

/** Каталог: тот же запрос к спейсу Sandflow; спейс на одном процессоре — отвечает не сразу. */
async function catalog(path) {
  const r = await fetch(CATALOG + path, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`каталог ответил ${r.status}`);
  return r;
}

async function main() {
  console.log('[constructor] собираю страницу…');
  const page = await buildPage({ local: true });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const p = url.pathname;
    try {
      if (req.method === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, page, 'text/html; charset=utf-8');
      if (req.method === 'GET' && p === '/api/work') return send(res, 200, Object.fromEntries(Object.keys(FILES).map((c) => [c, readRows(c)])));
      const w = p.match(/^\/api\/work\/([a-z]+)\/([^/]+)$/);
      if (w) {
        const coll = w[1];
        const id = decodeURIComponent(w[2]);
        if (!(coll in FILES) || !ID.test(id)) return send(res, 400, { error: 'нет такой коллекции или ключа' });
        const rows = readRows(coll).filter((r) => r.id !== id);
        if (req.method === 'PUT') {
          const data = JSON.parse(await readBody(req));
          if (!data || typeof data !== 'object' || Array.isArray(data)) return send(res, 400, { error: 'запись — объект' });
          rows.push({ ...data, id });
        } else if (req.method !== 'DELETE') return send(res, 405, { error: 'PUT или DELETE' });
        writeRows(coll, rows);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && p === '/api/catalog/search') {
        const q = new URLSearchParams();
        for (const k of ['q', 'mode', 'dataset', 'family', 'offset']) if (url.searchParams.get(k)) q.set(k, url.searchParams.get(k));
        q.set('limit', String(Math.min(60, Number(url.searchParams.get('limit')) || 40)));
        return send(res, 200, await (await catalog(`/api/search?${q}`)).text());
      }
      if (req.method === 'GET' && p === '/api/catalog/facets') return send(res, 200, await (await catalog('/api/facets')).text());
      const o = p.match(/^\/api\/catalog\/object\/([^/]+)$/);
      if (req.method === 'GET' && o && ID.test(decodeURIComponent(o[1]))) return send(res, 200, await (await catalog(`/api/object/${o[1]}`)).text());
      const r = p.match(/^\/api\/catalog\/render\/([^/]+)\.png$/);
      if (req.method === 'GET' && r && ID.test(decodeURIComponent(r[1]))) {
        // Картинки — в кэш на диске (в репозиторий он не идёт): спейс медленный, а листают туда и обратно.
        const f = join(CACHE, `${decodeURIComponent(r[1])}.png`);
        if (!existsSync(f)) {
          mkdirSync(CACHE, { recursive: true });
          writeFileSync(f, Buffer.from(await (await catalog(`/r/${r[1]}.png`)).arrayBuffer()));
        }
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=86400' });
        return res.end(readFileSync(f));
      }
      return send(res, 404, { error: 'нет такого адреса' });
    } catch (e) {
      return send(res, 502, { error: String(e?.message ?? e) });
    }
  });
  let port = Number(arg('--port') ?? 5199);
  await new Promise((ok) => {
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE' && port < 5299) server.listen(++port, '127.0.0.1');
      else throw e;
    });
    server.listen(port, '127.0.0.1', ok);
    server.on('listening', ok);
  });
  const link = `http://127.0.0.1:${port}/`;
  console.log(`[constructor] открыт: ${link}`);
  console.log('[constructor] правки сохраняются сами; залить в игру — npm run constructor:push; закрыть — Ctrl+C');
  if (!process.argv.includes('--no-open')) {
    const cmd = process.platform === 'darwin' ? ['open', [link]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', link]] : ['xdg-open', [link]];
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) await main();
