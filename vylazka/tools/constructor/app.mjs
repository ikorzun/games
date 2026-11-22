// Программа «Конструктор» на Mac (партнёр 18.11: «давай конструктор отдельной простой программой без этих плясок с
// терминалом»). Окно даёт оболочка (mac/main.swift, ставит её mac/install.mjs); всё, что раньше делалось руками в Терминале,
// делает этот файл — при каждом запуске программы:
// 1) забирает свежее с GitHub (git pull --ff-only: если у партнёра свои неотправленные правки, ничего не трогает);
// 2) ставит пакеты, если package-lock.json поменялся (npm ci);
// 3) собирает страницу и поднимает сервер (serve.mjs, уже свежий: подгружается после шага 1);
// 4) говорит оболочке адрес. Строки для оболочки: STATUS <текст>, READY <адрес>, FAIL <текст>.
// Оболочка старше нынешней — пересобирает её в фоне (со следующего запуска будет новая).
//
//   node tools/constructor/app.mjs            — для оболочки (выходит, когда оболочка закрылась)
//   node tools/constructor/app.mjs --browser  — запасной путь без оболочки: окно браузера; выходит сам, когда страницу закрыли
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BROWSER = process.argv.includes('--browser');
const LOG = join(ROOT, 'tools/constructor/work/app.log');
const LOCK = join(ROOT, 'package-lock.json');
const STAMP = join(ROOT, 'node_modules/.constructor-lock');
/** Ставлю пакеты прямо сейчас: остался с прошлого раза — установку прервали, ставить заново. */
const BUSY = join(ROOT, 'tools/constructor/work/.installing');

function log(line) {
  try {
    mkdirSync(dirname(LOG), { recursive: true });
    if (existsSync(LOG) && statSync(LOG).size > 256 << 10) writeFileSync(LOG, '');
    appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // журнал — подспорье; не записался — не беда
  }
}
/** Строка оболочке (одна строка: переносы — пробелами) и в журнал. */
function say(kind, text) {
  const line = `${kind} ${String(text).replace(/\s*\n\s*/g, ' ')}`;
  process.stdout.write(`${line}\n`);
  log(line);
}

/** Запустить и дождаться: ok, вывод и текст ошибки. */
function run(cmd, args, { timeout = 120000, env } = {}) {
  return new Promise((ok) =>
    execFile(cmd, args, { cwd: ROOT, timeout, maxBuffer: 32 << 20, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', LANGUAGE: 'C', ...env } }, (err, stdout, stderr) =>
      ok({ ok: !err, out: String(stdout ?? ''), err: String(stderr || err?.message || '') }),
    ),
  );
}
const short = (t) => String(t).trim().split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 240);
const lockHash = () => (existsSync(LOCK) ? createHash('sha1').update(readFileSync(LOCK)).digest('hex') : '');

/**
 * Перед шагом 1: прошлую отправку могли оборвать (выключили Mac посреди «Отправляю…») — недоделанная пересадка правок
 * (rebase) или замок .git/index.lock остались бы и ломали всё дальше. Пересадку — отменить (правки партнёра вернутся как
 * были), замок — снять: при запуске программы git больше никто не держит.
 */
async function repair() {
  const r = await run('git', ['rev-parse', '--absolute-git-dir']);
  if (!r.ok) return;
  const dir = r.out.trim();
  // Сначала замок: без него git ничего, в том числе отмену пересадки, не сделает.
  if (existsSync(join(dir, 'index.lock'))) {
    log('замок .git/index.lock остался — снимаю');
    rmSync(join(dir, 'index.lock'), { force: true });
  }
  if (existsSync(join(dir, 'rebase-merge')) || existsSync(join(dir, 'rebase-apply'))) {
    log('недоделанная пересадка правок — отменяю');
    const a = await run('git', ['rebase', '--abort']);
    if (!a.ok) log(`отменить не вышло: ${short(a.err)}`);
  }
}

/** Шаг 1: свежее с GitHub. Ответ — что сказать в окне (пусто — всё хорошо). */
async function update() {
  await repair();
  // package-lock.json партнёр не правит, а npm на его Mac мог переписать — вернуть как в репозитории, иначе git не обновит.
  await run('git', ['checkout', '--', 'package-lock.json']);
  const r = await run('git', ['pull', '--ff-only'], { timeout: 90000 });
  if (r.ok) return '';
  log(`git pull: ${r.err}`);
  if (/could not resolve host|failed to connect|couldn't connect|timed out|network is unreachable/i.test(r.err)) return 'Свежее с GitHub не забрал — нет связи. Работаю с тем, что есть.';
  if (/would be overwritten|not possible to fast-forward|diverg/i.test(r.err)) return 'Свежее с GitHub пока не забрал: у тебя есть неотправленные правки. Нажми «Залить в игру» — свежее заберётся заодно.';
  return `Свежее с GitHub не забрал: ${short(r.err)}`;
}

/** Где npm: рядом с node (так ставят nodejs.org, Homebrew и nvm); иначе — какой найдётся. */
/**
 * Общая память Claude Code на этом Mac (~/.claude/CLAUDE.md; квиз партнёра 22.11 — «Через Конструктор»): правила партнёра для
 * всех проектов. Блок между метками заменяется целиком, остальное в файле не трогается; текст — claude_memory.md рядом.
 */
const MEM_START = '<!-- constructor:rules -->';
const MEM_END = '<!-- /constructor:rules -->';
export function mergeMemory(old, rules) {
  const block = `${MEM_START}\n${rules.trim()}\n${MEM_END}`;
  const a = old.indexOf(MEM_START);
  const b = old.indexOf(MEM_END);
  if (a >= 0 && b > a) return old.slice(0, a) + block + old.slice(b + MEM_END.length);
  return old.trim() ? `${old.replace(/\s*$/, '')}\n\n${block}\n` : `${block}\n`;
}
function memory() {
  try {
    const src = join(ROOT, 'tools/constructor/claude_memory.md');
    if (!existsSync(src)) return;
    const file = join(homedir(), '.claude', 'CLAUDE.md');
    const old = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const next = mergeMemory(old, readFileSync(src, 'utf8'));
    if (next === old) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, next);
    log('память Claude Code: правила партнёра записаны');
  } catch (e) {
    log(`память Claude Code: ${String(e?.message ?? e)}`);
  }
}

function npm() {
  const cli = join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
  return existsSync(cli) ? [process.execPath, [cli]] : ['npm', []];
}

/** Шаг 2: пакеты. before — package-lock.json до шага 1. */
async function packages(before) {
  const now = lockHash();
  const have = existsSync(join(ROOT, 'node_modules')) && !existsSync(BUSY);
  if (have && existsSync(STAMP) && readFileSync(STAMP, 'utf8').trim() === now) return true;
  // Пакеты уже стоят (их ставили руками), а package-lock.json не менялся — переставлять незачем.
  if (have && !existsSync(STAMP) && before === now) {
    writeFileSync(STAMP, now);
    return true;
  }
  say('STATUS', 'Ставлю пакеты — это только после обновлений…');
  writeFileSync(BUSY, now);
  const [cmd, pre] = npm();
  const r = await run(cmd, [...pre, 'ci', '--no-audit', '--no-fund'], { timeout: 600000, env: { PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}` } });
  if (!r.ok) {
    say('FAIL', `Не получилось поставить пакеты: ${short(r.err)}`);
    return false;
  }
  writeFileSync(STAMP, now);
  rmSync(BUSY, { force: true });
  return true;
}

/** Запасной путь: окно браузера — отдельным окном Chrome, если он есть, иначе вкладкой в браузере по умолчанию. */
function openWindow(url) {
  if (process.platform !== 'darwin') return;
  const chrome = existsSync('/Applications/Google Chrome.app');
  const [cmd, args] = chrome ? ['open', ['-na', 'Google Chrome', '--args', `--app=${url}`]] : ['open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
}

/** Оболочка из старой версии — пересобрать (mac/install.mjs); заработает со следующего запуска. Ответ — пересобрана ли. */
async function refreshShell() {
  const have = Number(process.env.CONSTRUCTOR_SHELL ?? 0);
  const bundle = process.env.CONSTRUCTOR_BUNDLE;
  if (process.platform !== 'darwin' || !bundle || !have) return false;
  const { SHELL_VERSION, refreshApp } = await import('./mac/install.mjs');
  if (have >= SHELL_VERSION) return false;
  log(`оболочка ${have} → ${SHELL_VERSION}: пересобираю ${bundle}`);
  const r = await refreshApp(bundle).catch((e) => ({ ok: false, why: String(e?.message ?? e) }));
  log(r.ok ? 'оболочка пересобрана' : `оболочку пересобрать не вышло: ${r.why}`);
  return r.ok;
}

async function main() {
  if (!BROWSER) {
    // Оболочка закрылась или упала — её конец трубы обрывается, уходим и мы.
    process.stdin.on('end', () => process.exit(0));
    process.stdin.on('error', () => process.exit(0));
    process.stdin.resume();
  }
  process.on('SIGTERM', () => process.exit(0));
  log(`запуск: node ${process.version}, ${BROWSER ? 'браузер' : `оболочка ${process.env.CONSTRUCTOR_SHELL ?? '?'}`}`);
  const before = lockHash();
  say('STATUS', 'Забираю свежее с GitHub…');
  const note = await update();
  if (note) log(note);
  memory();
  if (!(await packages(before))) return;
  say('STATUS', 'Собираю конструктор…');
  const { startServer } = await import('./serve.mjs');
  const srv = await startServer({ port: 5199, replaceOld: true, note });
  say('READY', srv.url);
  if (BROWSER) {
    openWindow(srv.url);
    // Окно шлёт отметку раз в 15 с; нет её 2 минуты (а в первые 3 минуты — ни одной) — страницу закрыли, уходим.
    const started = Date.now();
    setInterval(() => {
      const last = srv.lastPing();
      if (Date.now() - (last || started) > (last ? 120000 : 180000)) process.exit(0);
    }, 10000);
  }
  const fresh = await refreshShell().catch((e) => {
    log(`оболочка: ${String(e?.message ?? e)}`);
    return false;
  });
  if (fresh) srv.setNote('Программа обновилась. Закрой её (⌘Q) и открой снова — будет новый вид.');
}

main().catch((e) => say('FAIL', `Не получилось открыть: ${short(e?.stack ?? e)}`));
