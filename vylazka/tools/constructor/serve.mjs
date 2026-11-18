// Конструктор на своём компьютере: сервер окна. Его поднимает программа «Конструктор» (app.mjs; партнёр 18.11: «давай
// конструктор отдельной простой программой без этих плясок с терминалом») или, по-старому, npm run constructor.
//
// Всё, что ставишь, двигаешь и убираешь, сразу пишется в файлы репозитория — src/world/partner/*.json (их берёт игра) и
// tools/constructor/work/*.json (отметки и заявки на вещи каталога). «Залить в игру» — кнопка в окне (/api/push, push_lib.mjs)
// или npm run constructor:push. Сеть нужна для поиска по каталогу Sand3D (около 106 тыс. вещей, спейс Sandflow) и для
// отправки на GitHub.
//
//   npm run constructor               — собрать страницу и открыть окно браузера
//   npm run constructor -- --no-open  — не открывать окно (адрес — в терминале)
//   npm run constructor -- --port 5300
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPage, ROOT } from './page.mjs';
import { pushAll, saveToken } from './push_lib.mjs';

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

/**
 * Свои ли пришли. Сервер слушает только этот компьютер, но в обычном браузере партнёра может быть открыта чужая страница:
 * она может прислать запрос на 127.0.0.1 (или прийти под чужим именем, которое указывает сюда же). Поэтому имя хоста — только
 * наше, менять что-то можно только со своей страницы (Origin), а кнопки сервера (POST) — только с меткой x-constructor:
 * чужая страница не может поставить её без предварительного спроса, а на него сервер не отвечает.
 */
function allowed(req, port) {
  const host = String(req.headers.host ?? '');
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return false;
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return false;
  return req.method !== 'POST' || req.headers['x-constructor'] === '1';
}

/** Не наш ли это конструктор на порту (старый запуск, который не закрылся): попросить его уйти. */
async function evictOld(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/hello`, { signal: AbortSignal.timeout(1500) });
    if ((await r.json())?.app !== 'constructor') return false;
    await fetch(`http://127.0.0.1:${port}/api/quit`, { method: 'POST', headers: { 'x-constructor': '1' }, signal: AbortSignal.timeout(1500) }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/**
 * Собрать страницу и поднять сервер. port — желаемый (занят чужим — следующий свободный; занят старым конструктором —
 * если replaceOld, старый уходит, порт тот же: на нём живут черновики окна). note — что сказать в окне при открытии.
 * Ответ: адрес, когда окно последний раз давало о себе знать (lastPing), и close.
 */
export async function startServer({ port = 5199, replaceOld = false, note = '' } = {}) {
  const page = await buildPage({ local: true });
  let lastPing = 0;
  let bound = port;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const p = url.pathname;
    try {
      if (!allowed(req, bound)) return send(res, 403, { error: 'чужим нельзя' });
      if (req.method === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, page, 'text/html; charset=utf-8');
      if (req.method === 'GET' && p === '/api/hello') return send(res, 200, { app: 'constructor', note });
      if (req.method === 'POST' && p === '/api/ping') {
        lastPing = Date.now();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && p === '/api/push') return send(res, 200, await pushAll());
      if (req.method === 'POST' && p === '/api/token') {
        const saved = await saveToken(JSON.parse(await readBody(req))?.token);
        if (!saved.ok) return send(res, 200, saved);
        const result = await pushAll();
        // Вход сохранён, а GitHub всё равно не пускает — токен не тот (нет галочки repo, истёк, другой аккаунт).
        if (result.auth) result.message = 'GitHub не принял этот токен. Сделай новый — с галочкой repo — и вставь его.';
        return send(res, 200, { ok: true, result });
      }
      if (req.method === 'POST' && p === '/api/quit') {
        send(res, 200, { ok: true });
        setTimeout(() => process.exit(0), 50);
        return;
      }
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
  const listen = (at) =>
    new Promise((ok, bad) => {
      const fail = (e) => {
        server.off('listening', done);
        bad(e);
      };
      const done = () => {
        server.off('error', fail);
        ok();
      };
      server.once('error', fail);
      server.once('listening', done);
      server.listen(at, '127.0.0.1');
    });
  for (;;) {
    try {
      await listen(bound);
      break;
    } catch (e) {
      if (e.code !== 'EADDRINUSE' || bound >= port + 100) throw e;
      if (replaceOld && bound === port && (await evictOld(bound))) {
        // Старый уходит не мгновенно — подождать, пока отпустит порт.
        let free = false;
        for (let i = 0; i < 30 && !free; i++) {
          await new Promise((r) => setTimeout(r, 100));
          free = await listen(bound).then(
            () => true,
            () => false,
          );
        }
        if (free) break;
      }
      bound++;
    }
  }
  return { url: `http://127.0.0.1:${bound}/`, port: bound, lastPing: () => lastPing, close: () => server.close() };
}

async function main() {
  console.log('[constructor] собираю страницу…');
  const { url: link } = await startServer({ port: Number(arg('--port') ?? 5199) });
  console.log(`[constructor] открыт: ${link}`);
  console.log('[constructor] правки сохраняются сами; залить в игру — кнопка в окне; закрыть — Ctrl+C');
  if (!process.argv.includes('--no-open')) {
    const cmd = process.platform === 'darwin' ? ['open', [link]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', link]] : ['xdg-open', [link]];
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
