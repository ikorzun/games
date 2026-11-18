// «Залить в игру» (партнёр 18.11: «давай конструктор отдельной простой программой без этих плясок с терминалом»): одна и та
// же работа и для кнопки в окне конструктора (serve.mjs, /api/push), и для npm run constructor:push (push.mjs).
// 1) проверить записи партнёра теми же правилами, что в игре (check.ts); 2) закоммитить его файлы; 3) забрать свежее с
// GitHub (git pull --rebase) и отправить (git push). Вход в GitHub — один раз, токеном из окна: его хранит связка ключей Mac
// (saveToken), в файлы проекта и в журнал он не попадает.
import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './page.mjs';

/** Что уходит в игру: записи партнёра (их берёт игра) и рабочие файлы конструктора (отметки, заявки на вещи каталога). */
export const PATHS = ['src/world/partner', 'tools/constructor/work/verdicts.json', 'tools/constructor/work/requests.json'];

// Git — без вопросов в терминал (окна терминала нет: вход — через окно конструктора) и по-английски: по тексту ошибки видно,
// что случилось.
const ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LC_ALL: 'C', LANGUAGE: 'C' };

/** git в папке игры; ответ — строкой; ошибка несёт текст git (stderr). */
export function git(args, { timeout = 120000, input } = {}) {
  return new Promise((ok, bad) => {
    const child = execFile('git', args, { cwd: ROOT, env: ENV, timeout, maxBuffer: 16 << 20, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = String(stderr ?? '');
        bad(err);
      } else ok(String(stdout).trim());
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}

const node = (file) =>
  new Promise((ok, bad) =>
    execFile(process.execPath, [file], { cwd: ROOT, maxBuffer: 16 << 20, encoding: 'utf8' }, (err, stdout, stderr) =>
      err ? bad(new Error(String(stderr || err.message))) : ok(String(stdout)),
    ),
  );

/** Проверка записей партнёра (check.ts собирается на лету: записи читаются из файлов в момент сборки). */
export async function checkAll() {
  const out = join(ROOT, 'e2e/out/constructor_check.cjs');
  await build({ entryPoints: [join(ROOT, 'tools/constructor/check.ts')], bundle: true, platform: 'node', outfile: out, logLevel: 'silent', define: { __VZ_AUDIO__: '[]', __VZ_BUILD__: '"tool"' } });
  return JSON.parse(await node(out));
}

/** Что случилось с git по его тексту: вход, отстали от GitHub, нет связи или другое. */
export function failKind(text) {
  const t = String(text).toLowerCase();
  if (/could not read (username|password)|terminal prompts disabled|authentication failed|invalid username or password|permission to .+ denied|returned error: 40[13]|password authentication was removed|bad credentials/.test(t)) return 'auth';
  if (/non-fast-forward|\[rejected\]|fetch first|updates were rejected/.test(t)) return 'behind';
  if (/could not resolve host|failed to connect|couldn't connect|connection (timed out|refused|reset)|network is unreachable|operation timed out|timed out after/.test(t)) return 'offline';
  return 'other';
}

/** Куда отправляем: протокол, хост (с портом), путь (владелец/репозиторий) и владелец — из адреса origin. */
export function parseRemote(url) {
  const m = String(url).trim().match(/^(https?):\/\/(?:[^@/]+@)?([^/]+)\/(([^/]+)\/[^?#]*?)\/?$/);
  return m ? { protocol: m[1], host: m[2], path: m[3], owner: m[4] } : null;
}

const plural = (n, one, few, many) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many}`;
export const describe = (c) =>
  [plural(c.things, 'вещь', 'вещи', 'вещей'), `передвинуто ${c.moved}`, `убрано ${c.removed}`, plural(c.figures, 'человек', 'человека', 'человек'), plural(c.requests, 'заявка', 'заявки', 'заявок')].join(', ');

/** Последние строки текста git — сказать коротко, без простыни. */
const short = (e) => String(e?.stderr || e?.message || e).trim().split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 300);

/** Кто коммитит. Не настроено (обычно у нового Mac) — именем владельца репозитория, безадресной почтой GitHub. */
async function ensureIdentity() {
  const name = await git(['config', 'user.name']).catch(() => '');
  const email = await git(['config', 'user.email']).catch(() => '');
  if (name && email) return;
  const owner = parseRemote(await git(['remote', 'get-url', 'origin']).catch(() => ''))?.owner;
  if (!name) await git(['config', 'user.name', owner ?? 'Untitled Session constructor']);
  if (!email) await git(['config', 'user.email', owner ? `${owner}@users.noreply.github.com` : 'constructor@localhost']);
}

const OFFLINE = 'Нет связи с GitHub — проверь интернет и нажми ещё раз. Всё сохранено у тебя.';
const AUTH = { ok: false, auth: true, message: 'Нужен вход в GitHub — один раз.' };

/**
 * Ссылка «Сделать токен»: GitHub с уже отмеченной галочкой. Репозиторий открытый — хватает public_repo (токен не видит
 * закрытых репозиториев партнёра); закрытый или не узнали — repo.
 */
export async function tokenUrl() {
  const remote = parseRemote(await git(['remote', 'get-url', 'origin']).catch(() => ''));
  let scope = 'repo';
  if (remote?.host === 'github.com') {
    try {
      const r = await fetch(`https://api.github.com/repos/${remote.path.replace(/\.git$/, '')}`, { signal: AbortSignal.timeout(5000), headers: { 'user-agent': 'untitled-session-constructor' } });
      if (r.ok && (await r.json())?.private === false) scope = 'public_repo';
    } catch {
      // не узнали — repo подходит всегда
    }
  }
  return `https://github.com/settings/tokens/new?scopes=${scope}&description=${encodeURIComponent('Конструктор Untitled Session')}`;
}
const needLogin = async () => ({ ...AUTH, tokenUrl: await tokenUrl() });

/**
 * Правки партнёра не сошлись со свежими с GitHub: не тупик — его коммит уходит отдельной веткой partner/constructor-…,
 * основная модель сводит её сама. Ничего у партнёра не меняется.
 */
async function pushAside(detail) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const branch = `partner/constructor-${stamp}`;
  try {
    await git(['push', 'origin', `HEAD:refs/heads/${branch}`]);
  } catch (e) {
    const kind = failKind(e.stderr || e.message);
    if (kind === 'auth') return needLogin();
    if (kind === 'offline') return { ok: false, message: OFFLINE };
    return { ok: false, message: 'Твои правки не сошлись со свежими с GitHub и отдельно не ушли. Ничего не потеряно — пришли это основной модели.', detail: short(e) };
  }
  return { ok: true, aside: branch, message: `Твои правки не сошлись со свежими с GitHub, поэтому ушли отдельно (${branch}). Ничего не потеряно — напиши в чат «залил», основная модель сведёт.`, detail };
}

/** Забрать свежее перед отправкой; не вышло — вернуть всё как было и сказать почему. */
async function pullFresh() {
  try {
    await git(['pull', '--rebase', '--autostash']);
    return null;
  } catch (e) {
    await git(['rebase', '--abort']).catch(() => undefined);
    const kind = failKind(e.stderr || e.message);
    if (kind === 'offline') return { ok: false, message: OFFLINE };
    if (kind === 'auth') return needLogin();
    return pushAside(short(e));
  }
}

function pushFailed(e) {
  const kind = failKind(e.stderr || e.message);
  if (kind === 'auth') return needLogin();
  if (kind === 'offline') return { ok: false, message: OFFLINE };
  return { ok: false, message: 'GitHub не принял отправку. Всё сохранено у тебя — пришли это основной модели.', detail: short(e) };
}

let busy = false;

/**
 * Проверить, закоммитить и отправить. Ответ — для окна: ok, message; problems — что поправить; auth — нужен вход;
 * nothing — нового нет. status(текст) — что делаем сейчас.
 */
export async function pushAll({ status = () => undefined } = {}) {
  if (busy) return { ok: false, message: 'Уже отправляю — подожди немного.' };
  busy = true;
  try {
    status('Проверяю правилами игры…');
    const { problems, counts } = await checkAll();
    if (problems.length > 0) return { ok: false, problems, message: 'Не отправлено — поправь в конструкторе:' };
    const what = describe(counts);
    await ensureIdentity();
    await git(['add', '--', ...PATHS]);
    const staged = await git(['diff', '--cached', '--name-only', '--', ...PATHS]);
    if (staged) await git(['commit', '-m', `Конструктор: правки партнёра — ${what}`, '--', ...PATHS]);
    const ahead = await git(['rev-list', '--count', '@{u}..HEAD']).then(Number, () => 1);
    if (!staged && ahead === 0) return { ok: true, nothing: true, message: 'Нового нет — всё уже в игре.' };
    status('Забираю свежее с GitHub…');
    const stale = await pullFresh();
    if (stale) return stale;
    status('Отправляю…');
    try {
      await git(['push']);
    } catch (e) {
      if (failKind(e.stderr || e.message) !== 'behind') return pushFailed(e);
      // Пока проверяли, на GitHub пришло новое — забрать и отправить ещё раз.
      const again = await pullFresh();
      if (again) return again;
      try {
        await git(['push']);
      } catch (e2) {
        return pushFailed(e2);
      }
    }
    return { ok: true, message: `Отправлено в игру. Теперь там: ${what}. Напиши в чат «залил» — соберу игру по ссылке.` };
  } catch (e) {
    return { ok: false, message: 'Не получилось отправить. Всё сохранено у тебя — пришли это основной модели.', detail: short(e) };
  } finally {
    busy = false;
  }
}

/** Похоже ли на токен GitHub (классический ghp_… или новый github_pat_…). */
export const isToken = (t) => /^(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})$/.test(String(t ?? '').trim());

/**
 * Запомнить вход в GitHub: токен уходит помощнику git для паролей — на Mac это связка ключей. Помощник не настроен —
 * настраивается для этой папки (osxkeychain). Вход — только для этого репозитория (credential.useHttpPath: запись в
 * связке ключей с путём): другие пароли к github.com — например, сохранённый Safari пароль от сайта — не трогаются и не
 * мешают. Старый вход этого же репозитория сначала стирается.
 */
export async function saveToken(raw) {
  const token = String(raw ?? '').trim();
  if (!isToken(token)) return { ok: false, message: 'Это не похоже на токен GitHub: он начинается с ghp_ или github_pat_. Скопируй его целиком.' };
  const remote = parseRemote(await git(['remote', 'get-url', 'origin']).catch(() => ''));
  if (!remote) return { ok: false, message: 'Не понял, куда отправлять: у папки нет адреса GitHub. Напиши основной модели.' };
  const helpers = await git(['config', '--get-all', 'credential.helper']).catch(() => '');
  if (!helpers.trim()) {
    if (process.platform !== 'darwin') return { ok: false, message: 'Негде хранить вход: на этом компьютере git не настроен хранить пароли.' };
    await git(['config', 'credential.helper', 'osxkeychain']);
  }
  await git(['config', 'credential.useHttpPath', 'true']);
  const where = `protocol=${remote.protocol}\nhost=${remote.host}\npath=${remote.path}\nusername=${remote.owner}\n`;
  await git(['credential', 'reject'], { input: `${where}\n` }).catch(() => undefined);
  await git(['credential', 'approve'], { input: `${where}password=${token}\n\n` });
  return { ok: true };
}
